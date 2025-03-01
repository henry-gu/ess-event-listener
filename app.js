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
  correlationId: String,
  clientIpAddress: String,
};
const Event = mongoose.model("Event", eventSchema);

////////////////////////////////////////////////////

function deleteOldRecords() {
  const recordAge = parseInt(process.env.RECORD_AGE) || 7; // Get RECORD_AGE from environment variable, default to 7 days if not set
  const lastDeleteDate = common.getLastDeleteDate() || new Date(0); // Get the last delete date from common module, default to the epoch if not set

  const currentDate = new Date();
  const minimumDeleteDate = new Date(currentDate);
  minimumDeleteDate.setDate(minimumDeleteDate.getDate() - recordAge); // Calculate the minimum delete date based on the record age

  if (currentDate - lastDeleteDate >= 24 * 60 * 60 * 1000) {
    // Check if the current date is at least 24 hours after the last delete date
    Event.deleteMany(
      { timeStamp: { $lt: minimumDeleteDate.toISOString() } },
      (err) => {
        if (err) {
          console.error(
            common.getUTCDateTime() +
              " >>> ERROR: FAILED TO DELETE OLD RECORDS. ERR:",
            err
          );
        } else {
          console.log(
            common.getUTCDateTime() +
              ` >>> SUCCESS: RECORDS OLDER THAN ${recordAge} DAYS ARE DELETED.`
          );

          // Update the lastDeleteDate in the common module
          common.setLastDeleteDate(currentDate);
        }
      }
    );
  }
}

// Schedule the deleteOldRecords function to run every 2 days at 01:00AM
cron.schedule(
  "0 0 1 */2 * *",
  () => {
    console.log(common.getUTCDateTime() + " CRON JOB STARTS.");
    deleteOldRecords();
  },
  {
    scheduled: true,
    timezone: "Asia/Shanghai", // Set the timezone to match China's timezone
  }
);

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
  console.log("SERVER IS LISTENING AT PORT " + port + "......");
});

///////////////////////////////////////////////////////
app.post("/eventlistener", async function (req, res) {
  try {
    let eventId = req.body.id || "";
    let eventTopic = req.body.topic || "";
    let correlationId = req.body.correlationId || "";
    let eventPayload = JSON.stringify(req.body, null, 4);
    let eventFacts = JSON.stringify(req.body.facts, null, 4);
    let eventType = req.body.eventType || "";
    let eventFactsHref = "";

    let eventTimeStamp = "";
    if (req.body.timeStamp) {
      eventTimeStamp = req.body.timeStamp.slice(0, 23);
    } else {
      eventTimeStamp = common.getUTCDateTime().slice(0, 23);
    }

    console.log(common.getUTCDateTime() + " >>> RECEIVED EVENT NOTIFICATION. ");

    const clientIpAddress = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    console.log(
      common.getUTCDateTime() + " >>> CLIENT IP ADDRESS: " + clientIpAddress
    );

    // Handle different event topics as needed
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
      case "public.concur.document.tax.compliance":
        eventFactsHref = req.body.facts.href;
        break;
      case "public.concur.financialintegration":
        eventFactsHref = req.body.facts.href;
        break;
      case "public.concur.spend.accountingintegration":
        if (req.body.facts && req.body.facts.data) {
          const factsData = JSON.parse(req.body.facts.data);
          if (factsData && factsData.links && factsData.links.length > 0) {
            eventFactsHref = factsData.links[0].href;
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
      : "N/A";

    console.log(
      common.getUTCDateTime() +
        " >>> SUCCESS: EVENT RECEIVED. eventId:[" +
        eventId +
        "]"
    );

    const newEvent = new Event({
      id: eventId,
      timeStamp: eventTimeStamp,
      type: eventType,
      topic: eventTopic,
      facts: eventFacts,
      geolocation: eventGeolocation,
      payload: eventPayload,
      correlationId,
      clientIpAddress,
    });

    await newEvent.save();
    console.log(
      common.getUTCDateTime() +
        " >>> SUCCESS: EVENT PAYLOAD SAVED: eventId[ " +
        eventId +
        "]"
    );
    res.status(200).send(eventId);
  } catch (err) {
    console.error(common.getUTCDateTime() + " >>> ERROR: FAILED TO PROCESS EVENT. ERR:", err);
    res.status(500).json({
      error: "Failed to process event",
      message: err.message,
      timestamp: common.getUTCDateTime()
    });
  }
});

//////////////////////////////////////////////////////
app.get("/", function (req, res) {
  // find all event
  console.log(common.getUTCDateTime() + " >>> HTTP GET: '/'");
  res.redirect("events/1");
});

//////////////////////////////////////////////////////
app.get("/events", async function (req, res) {
  try {
    const selectedTopic = req.query.eventTopic || "";
    const filter = selectedTopic ? { topic: selectedTopic } : {};

    console.log(
      common.getUTCDateTime() +
        " >>> HTTP GET: '/events/eventTopic='" +
        selectedTopic
    );

    const events = await Event.find(filter)
      .sort({ timeStamp: "desc" })
      .exec();

    console.log(
      common.getUTCDateTime() +
        " >>> SUCCESS: RETRIEVED " + events.length + 
        " EVENTS FOR TOPIC: '" + selectedTopic + "'"
    );

    res.render("home", {
      selectedTopic: selectedTopic,
      events: events,
    });
  } catch (err) {
    console.error(
      common.getUTCDateTime() +
        " >>> ERROR: FAILED TO RETRIEVE EVENTS. ERR: " +
        err
    );
    res.status(500).json({
      error: "Failed to retrieve events",
      message: err.message,
      timestamp: common.getUTCDateTime()
    });
  }
});

//////////////////////////////////////////////////////
app.get("/events/:page", async function (req, res) {
  try {
    const perPage = 10;
    const page = req.params.page || 1;
    const selectedTopic = req.query.eventTopic || "";

    console.log(common.getUTCDateTime() + " >>> HTTP GET: '/events/:page'");

    const [events, count] = await Promise.all([
      Event.find({})
        .sort({ timeStamp: "desc" })
        .skip(perPage * page - perPage)
        .limit(perPage)
        .exec(),
      Event.countDocuments().exec()
    ]);

    res.render("events", {
      events: events,
      current: page,
      selectedTopic: selectedTopic,
      pages: Math.ceil(count / perPage),
    });

    console.log(
      common.getUTCDateTime() + 
      " >>> SUCCESS: RETRIEVED EVENTS FOR PAGE " + page
    );
  } catch (err) {
    console.error(
      common.getUTCDateTime() + 
      " >>> ERROR: FAILED TO RETRIEVE EVENTS. ERR:", 
      err
    );
    res.status(500).json({
      error: "Failed to retrieve events",
      message: err.message,
      timestamp: common.getUTCDateTime()
    });
  }
});
///////////////////////////////////////////////////////

app.get('/robots.txt', function(req, res){
  res.type('text/plain');
  res.send('User-agent: *\nDisallow: /');
});

app.get("/event/:eventId", async function (req, res) {
  try {
    const requestEventId = req.params.eventId;
    console.log(
      common.getUTCDateTime() + " >>> HTTP GET: '/event/" + requestEventId
    );

    const event = await Event.findOne({ id: requestEventId }).exec();
    
    if (!event) {
      throw new Error(`Event with ID ${requestEventId} not found`);
    }

    res.render("event", {
      id: event.id,
      timeStamp: event.timeStamp,
      type: event.type,
      topic: event.topic,
      geolocation: event.geolocation,
      payload: event.payload,
      correlationId: event.correlationId,
      clientIpAddress: event.clientIpAddress,
    });

    console.log(
      common.getUTCDateTime() +
        " >>> SUCCESS: RETRIEVE EVENT: eventId [" +
        event.id +
        " ]."
    );
  } catch (err) {
    console.error(
      common.getUTCDateTime() +
        " >>> ERROR: RETRIEVE EVENT. ERR: " +
        err
    );
    res.status(404).json({
      error: "Event not found",
      message: err.message,
      timestamp: common.getUTCDateTime()
    });
  }
});

///////////////////////////////////////////////////////
app.post("/eventdelete/:eventId", async function (req, res) {
  try {
    const requestEventId = req.params.eventId;
    console.log(
      common.getUTCDateTime() + " >>> HTTP POST: '/eventdelete/" + requestEventId
    );

    const result = await Event.findOneAndDelete({ id: requestEventId }).exec();
    
    if (!result) {
      throw new Error(`Event with ID ${requestEventId} not found`);
    }

    res.redirect("/");
    console.log(
      common.getUTCDateTime() +
        " >>> SUCCESS: DELETE EVENT: eventId [" +
        requestEventId +
        " ]"
    );
  } catch (err) {
    console.error(
      common.getUTCDateTime() +
        " >>> ERROR: DELETE EVENT. ERR: " +
        err
    );
    res.status(404).json({
      error: "Failed to delete event",
      message: err.message,
      timestamp: common.getUTCDateTime()
    });
  }
});

///////////////////////////////////////////////////////
app.post("/deleteallevents", async function (req, res) {
  try {
    console.log(common.getUTCDateTime() + " >>> HTTP POST: '/deleteallevents/");

    const result = await Event.deleteMany({}).exec();
    
    if (result.deletedCount === 0) {
      throw new Error("No events found to delete");
    }

    res.redirect("/");
    console.log(
      common.getUTCDateTime() + 
      " >>> SUCCESS: DELETED " + result.deletedCount + " EVENTS"
    );
  } catch (err) {
    console.error(
      common.getUTCDateTime() +
        " >>> ERROR: DELETE ALL EVENTS FAILED. ERR: " +
        err
    );
    res.status(500).json({
      error: "Failed to delete all events",
      message: err.message,
      timestamp: common.getUTCDateTime()
    });
  }
});

///////////////////////////////////////////////////////
app.post("/eventsearch", async function (req, res) {
  try {
    const searchText = req.body.keyword;
    console.log(common.getUTCDateTime() + " >>> HTTP POST: '/eventsearch/");

    // Validate search text is a non-empty string
    if (typeof searchText !== 'string' || searchText.trim().length === 0) {
      throw new Error('Search keyword must be a non-empty string');
    }

    const queryOptions = {
      payload: {
        $regex: searchText.trim(),
        $options: "i",
      },
    };

    const events = await Event.find(queryOptions)
      .sort({ timeStamp: "desc" })
      .exec();

    console.log(
      common.getUTCDateTime() +
        " >>> SUCCESS: SEARCH TEXT [" +
        searchText +
        "], FOUND " +
        events.length +
        " RECORDS."
    );

    res.render("results", {
      events: events,
      keyword: searchText,
    });
  } catch (err) {
    console.error(
      common.getUTCDateTime() +
        " >>> ERROR: SEARCH TEXT FAILED. ERR: " +
        err
    );
    res.status(500).json({
      error: "Search failed",
      message: err.message,
      timestamp: common.getUTCDateTime()
    });
  }
});
