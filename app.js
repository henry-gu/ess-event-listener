//jshint esversion:6
require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const app = express();
const common = require(__dirname + "/common.js");
const mongoose = require("mongoose");

const connectString = process.env.DB_CONNECT_STRING;

mongoose.connect(connectString);

const eventSchema = {
  id: String,
  timeStamp: String,
  type: String,
  topic: String,
  facts: String,
  geolocation: String,
  payload: String,
};

const Event = mongoose.model("Event", eventSchema);

app.use(
  express.urlencoded({
    extended: true,
  })
);
app.use(express.json());
app.use(express.static("public"));
app.set("view engine", "ejs");

////////////////////////////////////////////////////
let port = process.env.PORT;
if (port == null || port == "") {
  port = 3030;
}

app.listen(port, function (req, res) {
  console.log("Server listening at port " + port);
});

///////////////////////////////////////////////////////
app.post("/eventlistener", function (req, res) {
  const eventId = req.body.id;
  const eventTopic = req.body.topic;
  const eventPayload = JSON.stringify(req.body, null, 4);
  const eventFacts = JSON.stringify(req.body.facts, null, 4);
  const eventTimeStamp = common.ChinaDateTime().slice(0, -4);
  const eventType = req.body.eventType;

  let eventFactsHref = req.body.facts.href;
  let eventGeolocation = eventFactsHref ? eventFactsHref.substring(eventFactsHref.lastIndexOf("//") + 2, eventFactsHref.indexOf(".")).toUpperCase() : "";

  console.log(common.ChinaDateTime() + " --> Event received: [event id: " + eventId + "]");
  console.log(eventGeolocation);
  const newEvent = new Event({
    id: eventId,
    timeStamp: eventTimeStamp,
    type: eventType,
    topic: eventTopic,
    facts: eventFacts,
    geolocation: eventGeolocation,
    payload: eventPayload,
  });

  newEvent.save(function (err) {
    if (!err) {
      console.log(common.ChinaDateTime() + " --> Event payload saved: [event id: " + eventId + "]");
      res.send(eventId);
    } else {
      console.log(common.ChinaDateTime() + " --> Event payload save error!");
    }
  });
});

//////////////////////////////////////////////////////
app.get("/", function (req, res) {
  // find all event
  console.log(common.ChinaDateTime() + " --> HTTP GET: '/'");
  res.redirect("events/1");
});

//////////////////////////////////////////////////////
app.get("/events", function (req, res) {
  console.log(common.ChinaDateTime() + " --> HTTP GET: '/events'");
  Event.find({})
    .sort({ timeStamp: "desc" })
    .exec(function (err, events) {
      if (!err) {
        console.log(common.ChinaDateTime() + " --> HTTP GET: '/'");
        res.render("home", {
          events: events,
        });
      }
    });
});

//////////////////////////////////////////////////////
app.get("/events/:page", function (req, res) {
  // find all event
  const perPage = 10;
  const page = req.params.page || 1;

  console.log(common.ChinaDateTime() + " --> HTTP GET: '/events/:page'");
  Event.find({})
    .sort({ timeStamp: "desc" })
    .skip(perPage * page - perPage)
    .limit(perPage)
    .exec(function (err, events) {
      Event.count().exec(function (errCount, count) {
        if (errCount) return next(errCount);
        res.render("events", {
          events: events,
          current: page,
          pages: Math.ceil(count / perPage),
        });
      });
    });
});

///////////////////////////////////////////////////////

app.get("/event/:eventId", function (req, res) {
  // const requestId = req.params.eventId.replace(/-/g, "");
  const requestEventId = req.params.eventId;
  console.log(common.ChinaDateTime() + " --> HTTP GET: '/event/" + requestEventId);

  Event.findOne({ id: requestEventId }, function (err, event) {
    if (!err) {
      res.render("event", {
        id: event.id,
        timeStamp: event.timeStamp,
        type: event.type,
        topic: event.topic,
        geolocation: event.geolocation,
        payload: event.payload,
      });
      console.log(common.ChinaDateTime() + " --> SUCEESS: event [" + event.id + " ] is found.");
    } else {
      console.log(common.ChinaDateTime() + " --> ERROR: event [" + event.id + " ] is NOT found.");
    }
  });
});

///////////////////////////////////////////////////////
app.post("/eventdelete/:eventId", function (req, res) {
  // const requestId = req.params.eventId.replace(/-/g, "");
  const requestEventId = req.params.eventId;
  console.log(common.ChinaDateTime() + " --> HTTP POST: '/eventdelete/" + requestEventId + "/delete");

  Event.findOneAndDelete({ id: requestEventId }, function (err) {
    if (!err) {
      res.redirect("/");
      console.log(common.ChinaDateTime() + " --> SUCEESS: event [" + requestEventId + " ] is deleted.");
    } else {
      console.log(common.ChinaDateTime() + " --> ERROR: delete event [" + requestEventId + " ] error.");
    }
  });
});

///////////////////////////////////////////////////////
app.post("/eventsearch", function (req, res) {
  console.log(common.ChinaDateTime() + " --> HTTP POST: '/eventsearch/");
  const searchText = req.body.keyword;
  const queryOptions = {
    payload: {
      $regex: searchText,
      $options: "i",
    },
  };
  Event.find(queryOptions)
    .sort({ timeStamp: "desc" })
    .exec(function (err, events) {
      if (!err) {
        console.log("--> SUCCESS: Search Text [" + searchText + "], found " + events.length + " records.");
        res.render("results", {
          events: events,
          keyword: searchText,
        });
      } else {
        console.log("--> ERROR: Search Text [" + searchText + "]");
      }
    });
});

///////////////////////////////////////////////////////
app.post("/eventsearch/", function (req, res) {
  console.log(common.ChinaDateTime() + " --> HTTP POST: '/eventsearch/");
  const searchText = req.body.keyword;
  const queryOptions = {
    payload: {
      $regex: searchText,
      $options: "i",
    },
  };
  Event.find(queryOptions)
    .sort({ timeStamp: "desc" })
    .exec(function (err, events) {
      if (!err) {
        console.log("--> SUCCESS: Search Text [" + searchText + "], found " + events.length + " records.");
        res.render("results", {
          events: events,
          keyword: searchText,
        });
      } else {
        console.log("--> ERROR: Search Text [" + searchText + "]");
      }
    });
});
