// jshint esversion:11
require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const mongoose = require("mongoose");
const cron = require("node-cron");
const common = require("./common.js");

const DEFAULT_PORT = 3030;
const DEFAULT_RECORD_AGE_DAYS = 7;
const PAGE_SIZE = 10;
const SEARCH_RESULT_LIMIT = 100;
const MAX_SEARCH_LENGTH = 100;
const MAX_EVENT_ID_LENGTH = 256;

const eventSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    timeStamp: { type: Date, required: true, index: true },
    receivedAt: { type: Date, required: true, default: Date.now, index: true },
    type: { type: String, default: "" },
    topic: { type: String, default: "" },
    facts: { type: String, default: "{}" },
    geolocation: { type: String, default: "N/A" },
    payload: { type: String, required: true },
    correlationId: { type: String, default: "" },
    clientIpAddress: { type: String, default: "" },
  },
  { versionKey: false, autoIndex: false }
);

const Event = mongoose.models.Event || mongoose.model("Event", eventSchema);

class HttpError extends Error {
  constructor(status, publicMessage) {
    super(publicMessage);
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

function requiredEnvironment(name, environment) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(String(value)) || Number(value) < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(value);
}

function trustProxySetting(value) {
  if (value === undefined || value === "") return false;
  return positiveInteger(value, 0, "TRUST_PROXY");
}

function loadConfig(environment = process.env) {
  return {
    dbConnectString: requiredEnvironment("DB_CONNECT_STRING", environment),
    port: positiveInteger(environment.PORT, DEFAULT_PORT, "PORT"),
    recordAgeDays: positiveInteger(
      environment.RECORD_AGE,
      DEFAULT_RECORD_AGE_DAYS,
      "RECORD_AGE"
    ),
    leuUser: requiredEnvironment("LEU_USER", environment),
    leuPassword: requiredEnvironment("LEU_PASSWORD", environment),
    adminUser: requiredEnvironment("ADMIN_USER", environment),
    adminPassword: requiredEnvironment("ADMIN_PASSWORD", environment),
    trustProxy: trustProxySetting(environment.TRUST_PROXY),
    production: environment.NODE_ENV === "production",
  };
}

function secureEqual(actual, expected) {
  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function basicCredentials(header) {
  if (typeof header !== "string" || !header.startsWith("Basic ")) return null;

  const encoded = header.slice(6).trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;

  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

function basicAuth(expectedUser, expectedPassword, realm) {
  return function authenticate(req, res, next) {
    const credentials = basicCredentials(req.headers.authorization);
    const authenticated =
      credentials &&
      secureEqual(credentials.username, expectedUser) &&
      secureEqual(credentials.password, expectedPassword);

    if (!authenticated) {
      res.set("WWW-Authenticate", `Basic realm="${realm}", charset="UTF-8"`);
      res.set("Cache-Control", "no-store");
      return res.status(401).send("Unauthorized");
    }
    res.set("Cache-Control", "no-store");
    return next();
  };
}

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((cookies, part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return cookies;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(value);
      } catch (_error) {
        // Ignore malformed cookie values instead of failing the request.
      }
    }
    return cookies;
  }, {});
}

function csrfToken(req, res, production) {
  const cookies = parseCookies(req.headers.cookie);
  const existing = cookies.csrf_token;
  const token = /^[a-f0-9]{64}$/.test(existing || "")
    ? existing
    : crypto.randomBytes(32).toString("hex");

  if (token !== existing) {
    res.cookie("csrf_token", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: production,
      path: "/",
    });
  }
  return token;
}

function verifyCsrf(req, _res, next) {
  const cookieToken = parseCookies(req.headers.cookie).csrf_token || "";
  const bodyToken = req.body && typeof req.body._csrf === "string" ? req.body._csrf : "";
  if (!secureEqual(cookieToken, bodyToken) || !/^[a-f0-9]{64}$/.test(cookieToken)) {
    return next(new HttpError(403, "Invalid CSRF token"));
  }
  return next();
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function stringField(value, name, { required = false, max = 512 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `${name} is required`);
    return "";
  }
  if (typeof value !== "string") throw new HttpError(400, `${name} must be a string`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new HttpError(400, `${name} is required`);
  if (trimmed.length > max) throw new HttpError(400, `${name} is too long`);
  return trimmed;
}

function eventTimeStamp(value) {
  if (value === undefined || value === null || value === "") return new Date();
  if (typeof value !== "string") throw new HttpError(400, "timeStamp must be a string");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, "timeStamp is invalid");
  return parsed;
}

function extractFactsHref(topic, facts) {
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) return "";

  if (topic === "public.concur.travel.itinerary") {
    return Array.isArray(facts.hrefs)
      ? facts.hrefs.find((href) => typeof href === "string") || ""
      : "";
  }
  if (topic === "public.concur.user.profile.identity") return facts.userHref || "";
  if (topic === "public.concur.user.provisioning") return facts.provisionStatusHref || "";
  if (topic === "public.concur.spend.accountingintegration" && facts.data) {
    let data;
    try {
      data = typeof facts.data === "string" ? JSON.parse(facts.data) : facts.data;
    } catch (_error) {
      throw new HttpError(400, "facts.data contains invalid JSON");
    }
    return data && Array.isArray(data.links) && data.links[0]
      ? data.links[0].href || ""
      : "";
  }
  return typeof facts.href === "string" ? facts.href : "";
}

function geolocationFromHref(href) {
  if (typeof href !== "string" || !href) return "N/A";
  try {
    const hostname = new URL(href).hostname;
    return hostname ? hostname.split(".")[0].toUpperCase() : "N/A";
  } catch (_error) {
    return "N/A";
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pageNumber(value) {
  if (!/^[1-9]\d*$/.test(String(value))) throw new HttpError(400, "Invalid page number");
  const page = Number(value);
  if (!Number.isSafeInteger(page) || page > 1_000_000) {
    throw new HttpError(400, "Invalid page number");
  }
  return page;
}

function formatEvent(event) {
  return {
    ...event,
    displayTimeStamp:
      event.timeStamp instanceof Date
        ? event.timeStamp.toISOString().slice(0, 23)
        : new Date(event.timeStamp).toISOString().slice(0, 23),
  };
}

async function deleteOldRecords(EventModel, recordAgeDays) {
  const cutoff = new Date(Date.now() - recordAgeDays * 24 * 60 * 60 * 1000);
  const result = await EventModel.deleteMany({ receivedAt: { $lt: cutoff } });
  console.log(
    `${common.getUTCDateTime()} >>> SUCCESS: DELETED ${result.deletedCount} RECORDS OLDER THAN ${recordAgeDays} DAYS.`
  );
}

async function migrateLegacyEvents(EventModel) {
  await EventModel.collection.updateMany(
    { $or: [{ id: { $not: { $type: "string" } } }, { id: "" }] },
    [{ $set: { id: { $concat: ["legacy-", { $toString: "$_id" }] } } }]
  );
  await EventModel.collection.updateMany(
    { timeStamp: { $not: { $type: "date" } } },
    [
      {
        $set: {
          timeStamp: {
            $convert: { input: "$timeStamp", to: "date", onError: "$$NOW", onNull: "$$NOW" },
          },
        },
      },
    ]
  );
  await EventModel.collection.updateMany(
    { receivedAt: { $exists: false } },
    [
      {
        $set: {
          receivedAt: {
            $convert: { input: "$_id", to: "date", onError: "$$NOW", onNull: "$$NOW" },
          },
        },
      },
    ]
  );
}

function createApp({ EventModel = Event, config }) {
  const app = express();
  const adminAuth = basicAuth(config.adminUser, config.adminPassword, "ESS Event Admin");
  const leuAuth = basicAuth(config.leuUser, config.leuPassword, "ESS Event Listener");

  if (config.trustProxy) app.set("trust proxy", config.trustProxy);
  app.disable("x-powered-by");
  app.set("view engine", "ejs");
  app.use(express.urlencoded({ extended: false, limit: "64kb", parameterLimit: 50 }));
  app.use(express.json({ limit: "1mb", strict: true }));
  app.use((_req, res, next) => {
    res.set({
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self' https://cdn.jsdelivr.net; img-src 'self' data:; " +
        "script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    if (config.production) {
      res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });
  app.use(express.static("public"));

  app.post(
    "/eventlistener",
    leuAuth,
    asyncRoute(async (req, res) => {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        throw new HttpError(400, "Request body must be a JSON object");
      }

      const id = stringField(req.body.id, "id", { required: true, max: MAX_EVENT_ID_LENGTH });
      if (!/^[A-Za-z0-9._:-]+$/.test(id)) {
        throw new HttpError(400, "id contains unsupported characters");
      }
      const topic = stringField(req.body.topic, "topic", { max: 256 });
      const type = stringField(req.body.eventType, "eventType", { max: 256 });
      const correlationId = stringField(req.body.correlationId, "correlationId", { max: 512 });
      const facts = req.body.facts;
      if (facts !== undefined && (typeof facts !== "object" || facts === null || Array.isArray(facts))) {
        throw new HttpError(400, "facts must be an object");
      }

      const href = extractFactsHref(topic, facts);
      const event = new EventModel({
        id,
        timeStamp: eventTimeStamp(req.body.timeStamp),
        receivedAt: new Date(),
        type,
        topic,
        facts: JSON.stringify(facts || {}, null, 2),
        geolocation: geolocationFromHref(href),
        payload: JSON.stringify(req.body, null, 2),
        correlationId,
        clientIpAddress: req.ip || req.socket.remoteAddress || "",
      });

      try {
        await event.save();
      } catch (error) {
        if (error && error.code === 11000) return res.status(200).send(id);
        throw error;
      }
      return res.status(200).send(id);
    })
  );

  app.get("/system/v1.0/testconnection", leuAuth, (_req, res) => res.status(200).send());

  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send("User-agent: *\nDisallow: /");
  });

  app.get("/", adminAuth, (_req, res) => res.redirect("/events/1"));
  app.get("/events", adminAuth, (req, res) => {
    const query = req.query.eventTopic ? `?eventTopic=${encodeURIComponent(req.query.eventTopic)}` : "";
    res.redirect(`/events/1${query}`);
  });

  app.get(
    "/events/:page",
    adminAuth,
    asyncRoute(async (req, res) => {
      const page = pageNumber(req.params.page);
      const selectedTopic = stringField(req.query.eventTopic, "eventTopic", { max: 256 });
      const filter = selectedTopic ? { topic: selectedTopic } : {};
      const [events, count] = await Promise.all([
        EventModel.find(filter)
          .sort({ timeStamp: -1 })
          .skip(PAGE_SIZE * (page - 1))
          .limit(PAGE_SIZE)
          .lean()
          .exec(),
        EventModel.countDocuments(filter).exec(),
      ]);
      const pages = Math.ceil(count / PAGE_SIZE);
      if (pages > 0 && page > pages) throw new HttpError(404, "Page not found");

      res.render("events", {
        events: events.map(formatEvent),
        current: page,
        selectedTopic,
        pages,
        csrfToken: csrfToken(req, res, config.production),
      });
    })
  );

  app.get(
    "/event/:eventId",
    adminAuth,
    asyncRoute(async (req, res) => {
      const eventId = stringField(req.params.eventId, "eventId", {
        required: true,
        max: MAX_EVENT_ID_LENGTH,
      });
      const event = await EventModel.findOne({ id: eventId }).lean().exec();
      if (!event) throw new HttpError(404, "Event not found");
      res.render("event", { ...event, displayTimeStamp: formatEvent(event).displayTimeStamp });
    })
  );

  app.post(
    "/eventdelete/:eventId",
    adminAuth,
    verifyCsrf,
    asyncRoute(async (req, res) => {
      const result = await EventModel.findOneAndDelete({ id: req.params.eventId }).exec();
      if (!result) throw new HttpError(404, "Event not found");
      res.redirect("/events/1");
    })
  );

  app.post(
    "/deleteallevents",
    adminAuth,
    verifyCsrf,
    asyncRoute(async (_req, res) => {
      await EventModel.deleteMany({});
      res.redirect("/events/1");
    })
  );

  app.get(
    "/eventsearch",
    adminAuth,
    asyncRoute(async (req, res) => {
      const keyword = stringField(req.query.keyword, "keyword", {
        required: true,
        max: MAX_SEARCH_LENGTH,
      });
      const found = await EventModel.find({
        payload: { $regex: escapeRegex(keyword), $options: "i" },
      })
        .sort({ timeStamp: -1 })
        .limit(SEARCH_RESULT_LIMIT + 1)
        .lean()
        .exec();
      const truncated = found.length > SEARCH_RESULT_LIMIT;
      const events = found.slice(0, SEARCH_RESULT_LIMIT).map(formatEvent);
      res.render("results", {
        events,
        keyword,
        truncated,
        csrfToken: csrfToken(req, res, config.production),
      });
    })
  );

  app.use((req, _res, next) => next(new HttpError(404, "Not found")));
  app.use((error, req, res, _next) => {
    const status = error.status || (error.type === "entity.too.large" ? 413 : 500);
    const publicMessage =
      error.publicMessage ||
      (status === 413
        ? "Request body is too large"
        : status === 400
          ? "Invalid request body"
          : "Internal server error");
    if (status >= 500) {
      console.error(`${common.getUTCDateTime()} >>> ${req.method} ${req.originalUrl}:`, error);
    } else {
      console.warn(
        `${common.getUTCDateTime()} >>> ${req.method} ${req.originalUrl}: ${status} ${publicMessage}`
      );
    }
    res.status(status).json({ error: publicMessage, timestamp: common.getUTCDateTime() });
  });

  return app;
}

async function start() {
  const config = loadConfig();
  if (config.port > 65535) throw new Error("PORT must be at most 65535");
  await mongoose.connect(config.dbConnectString, { serverSelectionTimeoutMS: 10_000 });
  await migrateLegacyEvents(Event);
  await Event.createIndexes();
  const app = createApp({ config });
  const server = app.listen(config.port, () => {
    console.log(`SERVER IS LISTENING AT PORT ${config.port}......`);
  });

  let cleanupRunning = false;
  const cleanupTask = cron.schedule(
    "0 0 1 * * *",
    async () => {
      if (cleanupRunning) return;
      cleanupRunning = true;
      try {
        await deleteOldRecords(Event, config.recordAgeDays);
      } catch (error) {
        console.error(`${common.getUTCDateTime()} >>> ERROR: FAILED TO DELETE OLD RECORDS:`, error);
      } finally {
        cleanupRunning = false;
      }
    },
    { timezone: "Asia/Shanghai" }
  );

  async function shutdown(signal) {
    console.log(`${signal} received; shutting down.`);
    cleanupTask.stop();
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  }
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

if (require.main === module) {
  start().catch((error) => {
    console.error(`${common.getUTCDateTime()} >>> FATAL STARTUP ERROR:`, error);
    process.exit(1);
  });
}

module.exports = {
  Event,
  HttpError,
  basicCredentials,
  createApp,
  deleteOldRecords,
  escapeRegex,
  eventTimeStamp,
  geolocationFromHref,
  loadConfig,
  migrateLegacyEvents,
  pageNumber,
  secureEqual,
  start,
};
