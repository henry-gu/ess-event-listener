# ESS Event Listener

ESS Event Listener is a Node.js application for receiving, storing, and inspecting event notifications from SAP Concur Event Subscription Service (ESS). It provides a protected webhook endpoint and a lightweight administration interface for development, integration testing, and event troubleshooting.

## Features

- Receive JSON events delivered by SAP Concur ESS.
- Store the event payload, topic, timestamp, correlation ID, and source IP in MongoDB.
- Browse events chronologically with pagination and topic filtering.
- Search event payloads by keyword.
- View the complete payload of an individual event.
- Delete individual events or clear all stored events.
- Automatically remove expired records based on server-controlled receipt time.
- Handle repeated notifications idempotently through a unique event ID index.

## How It Works

```text
SAP Concur ESS
      │  HTTP Basic Auth
      ▼
POST /eventlistener
      │  Validate, normalize, and save idempotently
      ▼
   MongoDB
      │
      ▼
Admin UI ── Browse / Filter / Search / Delete
```

The webhook uses `LEU_USER` and `LEU_PASSWORD`. The administration interface uses a separate `ADMIN_USER` and `ADMIN_PASSWORD`. Do not reuse credentials between these two access paths.

## Technology Stack

- Node.js 20.19+
- Express 5
- MongoDB 4.2+
- Mongoose 9
- EJS 6
- node-cron
- Node.js Test Runner and Supertest

## Project Structure

```text
.
├── app.js                  # Application, routes, data model, authentication, and cleanup
├── common.js               # Date and time utilities
├── public/                 # Browser-side CSS, JavaScript, and images
├── views/                  # EJS pages and shared partials
├── test/                   # Automated tests
├── .env.example            # Environment variable template
├── Procfile                # Process startup declaration
├── package.json            # Dependencies and scripts
└── LICENSE                 # MIT License
```

## Quick Start

1. Install the dependencies:

   ```sh
   npm install
   ```

2. Create a local configuration file:

   ```sh
   cp .env.example .env
   ```

3. Replace the database URI and all credentials in `.env`.

4. Run the tests and start the application:

   ```sh
   npm test
   npm start
   ```

5. Open `http://localhost:3030/` and sign in with the administration credentials.

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DB_CONNECT_STRING` | Yes | — | MongoDB connection URI |
| `LEU_USER` | Yes | — | Username for ESS webhook delivery and connection testing |
| `LEU_PASSWORD` | Yes | — | Password for ESS webhook delivery and connection testing |
| `ADMIN_USER` | Yes | — | Administration interface username |
| `ADMIN_PASSWORD` | Yes | — | Administration interface password |
| `PORT` | No | `3030` | HTTP server port |
| `RECORD_AGE` | No | `7` | Event retention period in days |
| `TRUST_PROXY` | No | Disabled | Number of trusted reverse proxies, such as `1` |
| `NODE_ENV` | No | — | Set to `production` to enable secure cookies and HSTS |

The application refuses to start when the database URI or either credential pair is missing. Production deployments must use HTTPS.

## HTTP Endpoints

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `POST` | `/eventlistener` | LEU | Receive an ESS event notification |
| `GET` | `/system/v1.0/testconnection` | LEU | Verify ESS connection credentials |
| `GET` | `/events/:page` | Admin | Browse and filter paginated events |
| `GET` | `/event/:eventId` | Admin | View an event |
| `GET` | `/eventsearch?keyword=...` | Admin | Search event payloads |
| `POST` | `/eventdelete/:eventId` | Admin + CSRF | Delete an event |
| `POST` | `/deleteallevents` | Admin + CSRF | Delete all events |

Example webhook request:

```sh
curl --user "$LEU_USER:$LEU_PASSWORD" \
  --header "Content-Type: application/json" \
  --data '{
    "id": "event-123",
    "timeStamp": "2026-08-09T00:00:00Z",
    "topic": "public.concur.request",
    "eventType": "UPDATED",
    "facts": { "href": "https://us.api.example.com/requests/123" }
  }' \
  http://localhost:3030/eventlistener
```

A successfully accepted notification returns HTTP `200` with the event ID. Re-delivery of the same ID also returns success but does not create a duplicate record.

## Data and Retention

Each record contains the following primary fields:

- `id`: the ESS event ID, protected by a unique index.
- `timeStamp`: the event occurrence time, stored as a MongoDB `Date`.
- `receivedAt`: the time at which the server received the event.
- `topic`, `type`, `facts`, and `payload`: event content.
- `correlationId` and `clientIpAddress`: diagnostic information.

The cleanup task runs every day at 01:00 in the `Asia/Shanghai` time zone. Records older than `RECORD_AGE` are deleted according to `receivedAt`, which cannot be controlled by the event sender. On startup, the application automatically migrates legacy string timestamps and missing receipt times.

If the existing database contains duplicate non-empty event IDs, resolve those duplicates before deployment. Otherwise, MongoDB cannot create the unique index and the application will stop safely during startup.

## Security

- The webhook and administration interface use separate HTTP Basic credentials.
- Request bodies, field lengths, timestamps, and pagination parameters are validated.
- JSON request bodies are limited to 1 MB.
- Destructive forms require a SameSite cookie and a matching CSRF token.
- Search terms are escaped and treated as literal text rather than raw regular expressions.
- Pages use Content Security Policy, HSTS, cache prevention, and other security headers.
- Internal exception details are not returned in HTTP responses.

HTTP Basic authentication does not provide transport encryption. Production deployments must use TLS. MongoDB should also use authentication, network access controls, and backups.

## Testing

```sh
npm test
npm audit --omit=dev
```

The test suite covers authentication, webhook validation, duplicate events, XSS output handling, CSRF protection, pagination and filtering, data retention, and configuration failure paths.

## License

This project is available under the [MIT License](./LICENSE). You may use, copy, modify, publish, and distribute the software as long as the copyright and license notices are retained.
