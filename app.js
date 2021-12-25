//jshint esversion:6

const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const app = express();
const common = require(__dirname + "/common.js");
const mongoose = require("mongoose");
// const dbConnectUrl = "mongodb://localhost:27017/eventDB";
const db_username = "admin-henrygu";
const db_password = "KooGHB2021";
const db_cluster = "cluster0.x4qhr";
const db_name = "eventDB";

// const connectString = "mongodb+srv://admin-henry:KooGHB2021@cluster0.x4qhr.mongodb.net/eventDB";

const connectString =
  "mongodb://admin-henry:KooGHB2021@cluster0-shard-00-00.x4qhr.mongodb.net:27017,cluster0-shard-00-01.x4qhr.mongodb.net:27017,cluster0-shard-00-02.x4qhr.mongodb.net:27017/eventDB?ssl=true&replicaSet=atlas-10ngp0-shard-0&authSource=admin&retryWrites=true&w=majority";

mongoose.connect(connectString);

// const MongoClient = require("mongodb").MongoClient;
// MongoClient.connect(uri, function (err, client) {
//   const collection = client.db("test").collection("devices");
//   // perform actions on the collection object
//   client.close();
// });

const eventSchema = {
  id: String,
  title: String,
  timeStamp: String,
  type: String,
  topic: String,
  facts: String,
  payload: String,
};
// Create index
// eventSchema.index({ title: "text", payload: "text" });
// eventSchema.index({ '$xx': "text" });

const Event = mongoose.model("Event", eventSchema);

app.use(
  express.urlencoded({
    extended: true,
  })
);
app.use(express.json());
app.use(express.static("public"));
app.set("view engine", "ejs");

app.get("/", function (req, res) {
  // find all event
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

app.get("/event/:eventId", function (req, res) {
  // const requestId = req.params.eventId.replace(/-/g, "");
  const requestEventId = req.params.eventId;
  console.log(common.ChinaDateTime() + " --> HTTP GET: '/events/" + requestEventId);

  Event.findOne({ id: requestEventId }, function (err, event) {
    if (!err) {
      res.render("event", {
        title: event.title,
        payload: event.payload,
      });
      console.log(common.ChinaDateTime() + " --> SUCEESS: event [" + event.id + " ] is found.");
    } else {
      console.log(common.ChinaDateTime() + " --> ERROR: event [" + event.id + " ] is NOT found.");
    }
  });
});

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

app.post("/eventsearch", function (req, res) {
  const searchText = req.body.keyword;
  const queryOptions = {
    payload: {
      $regex: searchText,
      $options: "i",
    },
  };
  console.log("--> SEARCH KEYWORD: " + searchText);
  console.log("--> QUERY OPTION: " + JSON.stringify(queryOptions));

  Event.find(queryOptions, function (err, events) {
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

app.post("/eventlistener", function (req, res) {
  const eventId = req.body.id;
  const eventTopic = req.body.topic;
  const eventPayload = JSON.stringify(req.body, null, 4);
  const eventFacts = JSON.stringify(req.body.facts, null, 4);

  const eventTimeStamp = common.ChinaDateTime().slice(0, -4);
  const eventType = req.body.eventType;
  const eventTitle = `[${eventTimeStamp}][${eventTopic}][${eventType}][${eventId}]`;
  console.log(common.ChinaDateTime() + " --> event received: [event id: " + eventId + "]");

  const newEvent = new Event({
    id: eventId,
    title: eventTitle,
    timeStamp: eventTimeStamp,
    type: eventType,
    topic: eventTopic,
    facts: eventFacts,
    payload: eventPayload,
  });

  newEvent.save(function (err) {
    if (!err) {
      console.log(common.ChinaDateTime() + " --> event saved: [event id: " + eventId + "]");
      res.send(eventId);
    } else {
      console.log(common.ChinaDateTime() + " --> event save error!");
    }
  });
});

let port = process.env.PORT;
if (port == null || port == "") {
  port = 3030;
}

app.listen(port, function (req, res) {
  console.log("Server listening at port " + port);
});
