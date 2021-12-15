//jshint esversion:6

const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const app = express();
const common = require(__dirname + "/common.js");

const homeStartingContent = "Concur Event Notification List:";
const aboutContent = "About Event Notification Listener.";

const events = [];

app.use(
  express.urlencoded({
    extended: true,
  })
);
app.use(express.json());
app.use(express.static("public"));
app.set("view engine", "ejs");

app.get("/", function (req, res) {
  console.log(common.currentDateTime() + " HTTP GET: '/'");
  res.render("home", {
    events: events,
  });
});

app.get("/event/:id", function (req, res) {
  const requestId = req.params.id.replace(/-/g, "");
  console.log(common.currentDateTime() + " HTTP GET: '/eventlist/" + requestId + "'");
  events.forEach((eventItem) => {
    let currentId = eventItem.id;
    if (currentId === requestId) {
      res.render("event", {
        title: eventItem.title,
        payload: eventItem.payload,
      });
      console.log("-- Display Event Payload: " + requestId);
    }
  });
});

app.post("/eventlistener", function (req, res) {
  const receiveDataTime = common.currentDateTime().slice(0, -4);
  const eventId = req.body.id.replace(/-/g, "");
  const eventTimeStamp = req.body.timeStamp.slice(0, -1);
  const eventType = req.body.eventType;
  const eventTopic = req.body.topic;
  const eventPayload = JSON.stringify(req.body, null, 4);
  const eventFacts = JSON.stringify(req.body.facts, null, 4);
  const eventTitle = `[${eventTimeStamp}]-[${eventTopic}]-[${eventType}] `;
  console.log("Event Received at: " + receiveDataTime);
  console.log("Event Payload:" + eventPayload);
  const event = {
    id: eventId,
    title: eventTitle,
    summary: eventFacts,
    payload: eventPayload,
  };
  events.push(event);
  res.send("Event Received.");
});

let port = process.env.PORT;
if (port == null || port == "") {
  port = 3030;
}

app.listen(port, function (req, res) {
  console.log("Server listening at port " + port);
});
