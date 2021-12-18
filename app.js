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

mongoose.connect("mongodb+srv://admin-henry:KooGHB2021@cluster0.x4qhr.mongodb.net/eventDB");
//mongoose.connect(`mongodb+srv://${db_username}:${db_password}@${db_cluster}.mongodb.net/${db_name}?retryWrites=true&w=majority`);
// mongoose.connect(`mongodb+srv://${db_username}:${db_password}@${db_cluster}.mongodb.net/${db_name}?retryWrites=true&w=majority`, { useNewUrlParser: true });

const eventSchema = {
  id: String,
  title: String,
  timeStamp: String,
  type: String,
  topic: String,
  facts: String,
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

app.post("/eventlistener", function (req, res) {
  const eventId = req.body.id;
  const eventTopic = req.body.topic;
  const eventPayload = JSON.stringify(req.body, null, 4);
  const eventFacts = JSON.stringify(req.body.facts, null, 4);

  const eventTimeStamp = common.ChinaDateTime();
  const eventType = req.body.eventType;
  const eventTitle = `${eventTimeStamp};${eventTopic};${eventType};${eventId}`;
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
      res.send(eventFacts);
    } else {
      console.log(common.ChinaDateTime() + " --> event save error!");
    }
  });
});

// app.post("/eventlistener", function (req, res) {
//   const receiveDataTime = common.ChinaDateTime().slice(0, -4);
//   const eventId = req.body.id.replace(/-/g, "");
//   const eventTimeStamp = req.body.timeStamp.slice(0, -1);
//   const eventType = req.body.eventType;
//   const eventTopic = req.body.topic;
//   const eventPayload = JSON.stringify(req.body, null, 4);
//   const eventFacts = JSON.stringify(req.body.facts, null, 4);
//   const eventTitle = `[${eventTimeStamp}]-[${eventTopic}]-[${eventType}] `;
//   console.log("Event Received at: " + receiveDataTime);
//   console.log("Event Payload:" + eventPayload);
//   const event = {
//     id: eventId,
//     title: eventTitle,
//     facts: eventFacts,
//     payload: eventPayload,
//   };
//   events.push(event);
//   res.send("Event Received.");
// });

let port = process.env.PORT;
if (port == null || port == "") {
  port = 3030;
}

app.listen(port, function (req, res) {
  console.log("Server listening at port " + port);
});
