"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");

const {
  createApp,
  deleteOldRecords,
  escapeRegex,
  eventTimeStamp,
  loadConfig,
  pageNumber,
} = require("../app.js");

const config = {
  adminUser: "admin",
  adminPassword: "admin:password",
  leuUser: "listener",
  leuPassword: "listener:password",
  production: false,
  recordAgeDays: 7,
  trustProxy: false,
};

function authorization(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

class FakeQuery {
  constructor(records) {
    this.records = records;
  }

  sort() {
    this.records.sort((a, b) => new Date(b.timeStamp) - new Date(a.timeStamp));
    return this;
  }

  skip(count) {
    this.records = this.records.slice(count);
    return this;
  }

  limit(count) {
    this.records = this.records.slice(0, count);
    return this;
  }

  lean() {
    return this;
  }

  async exec() {
    return this.records.map((record) => ({ ...record }));
  }
}

class FakeSingleQuery {
  constructor(value) {
    this.value = value;
  }

  lean() {
    return this;
  }

  async exec() {
    return this.value ? { ...this.value } : null;
  }
}

class FakeEvent {
  static records = [];

  constructor(data) {
    Object.assign(this, data);
  }

  async save() {
    if (FakeEvent.records.some((event) => event.id === this.id)) {
      const error = new Error("duplicate");
      error.code = 11000;
      throw error;
    }
    FakeEvent.records.push({ ...this });
  }

  static find(filter = {}) {
    let records = [...FakeEvent.records];
    if (filter.topic) records = records.filter((event) => event.topic === filter.topic);
    if (filter.payload && filter.payload.$regex) {
      const regex = new RegExp(filter.payload.$regex, filter.payload.$options);
      records = records.filter((event) => regex.test(event.payload));
    }
    return new FakeQuery(records);
  }

  static countDocuments(filter = {}) {
    const records = filter.topic
      ? FakeEvent.records.filter((event) => event.topic === filter.topic)
      : FakeEvent.records;
    return { exec: async () => records.length };
  }

  static findOne(filter) {
    return new FakeSingleQuery(FakeEvent.records.find((event) => event.id === filter.id));
  }

  static findOneAndDelete(filter) {
    const index = FakeEvent.records.findIndex((event) => event.id === filter.id);
    const removed = index >= 0 ? FakeEvent.records.splice(index, 1)[0] : null;
    return { exec: async () => removed };
  }

  static async deleteMany(filter) {
    if (!filter || Object.keys(filter).length === 0) {
      const deletedCount = FakeEvent.records.length;
      FakeEvent.records = [];
      return { deletedCount };
    }
    const cutoff = filter.receivedAt && filter.receivedAt.$lt;
    const originalCount = FakeEvent.records.length;
    FakeEvent.records = FakeEvent.records.filter((event) => event.receivedAt >= cutoff);
    return { deletedCount: originalCount - FakeEvent.records.length };
  }
}

function buildApp() {
  FakeEvent.records = [];
  return createApp({ EventModel: FakeEvent, config });
}

test("management and webhook routes reject unauthenticated requests", async () => {
  const app = buildApp();
  await request(app).get("/events/1").expect(401).expect("WWW-Authenticate", /ESS Event Admin/);
  await request(app).post("/eventlistener").send({ id: "event-1" }).expect(401);
});

test("webhook validates input, supports colon passwords, and handles duplicate ids idempotently", async () => {
  const app = buildApp();
  const auth = authorization(config.leuUser, config.leuPassword);

  await request(app)
    .post("/eventlistener")
    .set("Authorization", auth)
    .send({ id: "event-1", timeStamp: "not-a-date" })
    .expect(400, /timeStamp is invalid/);

  const payload = {
    id: "event-1",
    timeStamp: "2026-08-09T00:00:00Z",
    topic: "public.concur.request",
    facts: { href: "https://us.api.example.com/event/1" },
  };
  await request(app).post("/eventlistener").set("Authorization", auth).send(payload).expect(200);
  await request(app).post("/eventlistener").set("Authorization", auth).send(payload).expect(200);
  assert.equal(FakeEvent.records.length, 1);
  assert.equal(FakeEvent.records[0].geolocation, "US");
  assert.ok(FakeEvent.records[0].timeStamp instanceof Date);
});

test("search escapes reflected HTML and emits restrictive security headers", async () => {
  const app = buildApp();
  const keyword = '<img src=x onerror="alert(1)">';
  const response = await request(app)
    .get("/eventsearch")
    .query({ keyword })
    .set("Authorization", authorization(config.adminUser, config.adminPassword))
    .expect(200);

  assert.doesNotMatch(response.text, /<img src=x/);
  assert.match(response.text, /&lt;img src=x/);
  assert.match(response.headers["content-security-policy"], /script-src 'self'/);
});

test("destructive routes require a matching CSRF cookie and form token", async () => {
  const app = buildApp();
  const auth = authorization(config.adminUser, config.adminPassword);

  await request(app).post("/deleteallevents").set("Authorization", auth).expect(403);

  const page = await request(app).get("/events/1").set("Authorization", auth).expect(200);
  const cookie = page.headers["set-cookie"][0].split(";")[0];
  const token = page.text.match(/name="_csrf" value="([a-f0-9]{64})"/)[1];
  await request(app)
    .post("/deleteallevents")
    .set("Authorization", auth)
    .set("Cookie", cookie)
    .type("form")
    .send({ _csrf: token })
    .expect(302);
});

test("topic filtering is paginated and retention uses server receipt time", async () => {
  const now = Date.now();
  FakeEvent.records = Array.from({ length: 11 }, (_, index) => ({
    id: `a-${index}`,
    topic: "topic-a",
    type: "test",
    facts: "{}",
    payload: "{}",
    geolocation: "N/A",
    timeStamp: new Date(now - index * 1000),
    receivedAt: new Date(now),
  }));
  FakeEvent.records.push({
    id: "expired",
    topic: "topic-b",
    type: "test",
    facts: "{}",
    payload: "{}",
    geolocation: "N/A",
    timeStamp: new Date(now + 30 * 24 * 60 * 60 * 1000),
    receivedAt: new Date(now - 8 * 24 * 60 * 60 * 1000),
  });
  const app = createApp({ EventModel: FakeEvent, config });
  const response = await request(app)
    .get("/events/2")
    .query({ eventTopic: "topic-a" })
    .set("Authorization", authorization(config.adminUser, config.adminPassword))
    .expect(200);

  assert.match(response.text, /a-10/);
  assert.doesNotMatch(response.text, /expired/);
  await deleteOldRecords(FakeEvent, 7);
  assert.equal(FakeEvent.records.some((event) => event.id === "expired"), false);
});

test("query helpers treat search text literally and reject invalid pages", () => {
  assert.equal(escapeRegex("(a+)+$"), "\\(a\\+\\)\\+\\$");
  assert.equal(pageNumber("1"), 1);
  assert.throws(() => pageNumber("-1"), /Invalid page number/);
  assert.throws(() => eventTimeStamp("invalid"), /timeStamp is invalid/);
});

test("configuration fails closed when credentials are absent", () => {
  assert.throws(
    () => loadConfig({ DB_CONNECT_STRING: "mongodb://localhost/test" }),
    /LEU_USER/
  );
});
