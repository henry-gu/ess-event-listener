//jshint esversion:6
require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const app = express();
const common = require(__dirname + "/common.js");
const mongoose = require("mongoose");
const cron = require("node-cron"); // added on Sept 6, 2023

const connectString = process.env.DB_CONNECT_STRING;
const port = parseInt(process.env.PORT) || 3030;

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

////////////////////////////////////////////////////
// Added on Sept 6, 2023
function deleteOldRecords() {
  const recordAge = parseInt(process.env.RECORD_AGE) || 7; // Get RECORD_AGE from environment variable, default to 7 days if not set
  const deleteDate = new Date();
  deleteDate.setDate(deleteDate.getDate() - recordAge); // Calculate the date based on the record age

  Event.deleteMany({ timeStamp: { $lt: deleteDate.toISOString() } }, (err) => {
    if (err) {
      console.error("Error deleting old records:", err);
    } else {
      console.log(common.getUTCDateTime() + `--> Records older than ${recordAge} days are deleted.`);
    }
  });
}

// Schedule the deleteOldRecords function to run every day at midnight (00:00)
cron.schedule(
  "0 0 * * *",
  () => {
    deleteOldRecords();
  },
  {
    timezone: "Asia/Shanghai", // Set the timezone to match China's timezone
  }
);

/////////////////////////////////////////////////////
///  EJS

app.use(
  express.urlencoded({
    extended: true,
  })
);
app.use(express.json());
app.use(express.static("public"));
app.set("view engine", "ejs");

////////////////////////////////////////////////////
app.listen(port, function (req, res) {
  console.log("Server listening at port " + port);
});

///////////////////////////////////////////////////////
app.post("/eventlistener", function (req, res) {
  const eventId = req.body.id;
  const eventTopic = req.body.topic;
  const eventPayload = JSON.stringify(req.body, null, 4);
  const eventFacts = JSON.stringify(req.body.facts, null, 4);
  const eventTimeStamp = common.getUTCDateTime().slice(0, -4);
  const eventType = req.body.eventType;

  let eventFactsHref = "";
  switch (eventTopic) {
    case "public.concur.request":
      eventFactsHref = req.body.facts.href;
      break;
    case "public.concur.expense.report":
      eventFactsHref = req.body.facts.href;
      break;
    case "public.concur.travel.itinerary":
      eventFactsHref = JSON.stringify(req.body.facts.hrefs, null, 4);
      break;
    case "public.concur.user.profile.identity":
      eventFactsHref = req.body.facts.userHref;
      break;
    case "public.concur.user.provisioning":
      eventFactsHref = req.body.facts.provisionStatusHref;
      break;
    case "public.concur.spend.accountingintegration":
      if (req.body.facts && req.body.facts.data) {
          const factsData = JSON.parse(req.body.facts.data);
        if (factsData && factsData.links && factsData.links.length > 0) {
          eventFactsHref = factsData.link[0].href;
          }
        }
        break;
    default:
      eventFactsHref = req.body.facts.href;
  }

  let eventGeolocation = eventFactsHref
    ? eventFactsHref
        .substring(
          eventFactsHref.lastIndexOf("//") + 2,
          eventFactsHref.indexOf(".")
        )
        .toUpperCase()
    : "";

  console.log(
    common.getUTCDateTime() + " --> Event received: [event id: " + eventId + "]"
  );
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
      console.log(
        common.getUTCDateTime() +
          " --> Event payload saved: [event id: " +
          eventId +
          "]"
      );
      res.send(eventId);
    } else {
      console.log(common.getUTCDateTime() + " --> Event payload save error!");
    }
  });
});

//////////////////////////////////////////////////////
app.get("/", function (req, res) {
  // find all event
  console.log(common.getUTCDateTime() + " --> HTTP GET: '/'");
  res.redirect("events/1");
});

//////////////////////////////////////////////////////
app.get("/events", function (req, res) {
  // Added on Sept 6, 2023
  // Call the deleteOldRecords function before rendering the events page
  deleteOldRecords();

  // Added on Sept 6, 2023
  // Retrieve the selected event topic from the query parameters
  const selectedTopic = req.query.eventTopic || '';

  // Added on Sept 6, 2023
  // Define a filter object based on the selected topic
  const filter = selectedTopic ? { topic: selectedTopic } : {};

  console.log(common.getUTCDateTime() + " --> HTTP GET: '/events/eventTopic='"+selectedTopic);
  Event.find(filter)
    .sort({ timeStamp: "desc" })
    .exec(function (err, events) {
      if (!err) {
        console.log(common.getUTCDateTime() + "--> HTTP GET: '/events/eventTopic='"+selectedTopic);
        res.render("home", {
          selectedTopic: selectedTopic,
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

  // Added on Sept 6, 2023
  // Call the deleteOldRecords function before rendering the events page
  deleteOldRecords();

  // Added on Sept 6, 2023
  // Retrieve the selected event topic from the query parameters
  const selectedTopic = req.query.eventTopic || '';

  console.log(common.getUTCDateTime() + " --> HTTP GET: '/events/:page'");
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
          selectedTopic: selectedTopic, // Pass the selectedTopic to the template
          pages: Math.ceil(count / perPage),
        });
      });
    });
});
///////////////////////////////////////////////////////

app.get("/event/:eventId", function (req, res) {
  // const requestId = req.params.eventId.replace(/-/g, "");
  const requestEventId = req.params.eventId;
  console.log(
    common.getUTCDateTime() + " --> HTTP GET: '/event/" + requestEventId
  );

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
      console.log(
        common.getUTCDateTime() +
          " --> SUCEESS: event [" +
          event.id +
          " ] is found."
      );
    } else {
      console.log(
        common.getUTCDateTime() +
          " --> ERROR: event [" +
          event.id +
          " ] is NOT found."
      );
    }
  });
});

///////////////////////////////////////////////////////
app.post("/eventdelete/:eventId", function (req, res) {
  // const requestId = req.params.eventId.replace(/-/g, "");
  const requestEventId = req.params.eventId;
  console.log(
    common.getUTCDateTime() +
      " --> HTTP POST: '/eventdelete/" +
      requestEventId +
      "/delete"
  );

  Event.findOneAndDelete({ id: requestEventId }, function (err) {
    if (!err) {
      res.redirect("/");
      console.log(
        common.getUTCDateTime() +
          " --> SUCEESS: event [" +
          requestEventId +
          " ] is deleted."
      );
    } else {
      console.log(
        common.getUTCDateTime() +
          " --> ERROR: delete event [" +
          requestEventId +
          " ] error."
      );
    }
  });
});

///////////////////////////////////////////////////////
app.post("/deleteallevents", function (req, res) {
  // const requestId = req.params.eventId.replace(/-/g, "");
  console.log(common.getUTCDateTime() + " --> HTTP GET: '/deleteallevents/");

  Event.deleteMany({}, function (err) {
    if (!err) {
      res.redirect("/");
      console.log(
        common.getUTCDateTime() + " --> SUCEESS: all events are deleted."
      );
    } else {
      console.log(
        common.getUTCDateTime() + " --> ERROR: delete all events error."
      );
    }
  });
});

///////////////////////////////////////////////////////
app.post("/eventsearch", function (req, res) {
  console.log(common.getUTCDateTime() + " --> HTTP POST: '/eventsearch/");
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
        console.log(
          "--> SUCCESS: Search Text [" +
            searchText +
            "], found " +
            events.length +
            " records."
        );
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
  console.log(common.getUTCDateTime() + " --> HTTP POST: '/eventsearch/");
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
        console.log(
          "--> SUCCESS: Search Text [" +
            searchText +
            "], found " +
            events.length +
            " records."
        );
        res.render("results", {
          events: events,
          keyword: searchText,
        });
      } else {
        console.log("--> ERROR: Search Text [" + searchText + "]");
      }
    });
});
