# Vikunja -> CalDAV Sync Webhook

Production-oriented microservice that receives Vikunja task webhooks and syncs them to a CalDAV calendar as VEVENT objects.

## Features

- Fastify webhook endpoint: `POST /webhook/vikunja`
- Event support: `task.created`, `task.updated`, `task.deleted`
- Optional HMAC verification via `X-Vikunja-Signature`
- Idempotency via deterministic UID + relevant-field hash persisted in SQLite
- Debounce guard (`DEBOUNCE_MS`) to avoid noisy repeated writes
- CalDAV discovery by calendar display name (`CALDAV_CALENDAR_NAME`, e.g. `Алиса`)
- Deterministic object path (`${UID}.ics`) and ETag-aware updates (`If-Match`)
- Retry with exponential backoff for transient CalDAV/network errors
- Structured logs and probes:
  - `GET /healthz` (DB + calendar discovery)
  - `GET /readyz` (DB + discovered calendar auth/ping)

## Architecture

- `src/routes/webhook.ts`: webhook ingestion and validation
- `src/services/task-queue.ts`: in-process async per-task queueing
- `src/services/sync-service.ts`: sync policy + idempotency rules
- `src/services/caldav-client.ts`: CalDAV discovery and CRUD
- `src/repositories/state-repository.ts`: SQLite persistence for sync state
- `src/utils/ics.ts`: deterministic VEVENT generation

## Environment

Copy and edit:

```bash
cp .env.example .env
```

Variables:

- `PORT=3000`
- `LOG_LEVEL=info|debug`
- `VIKUNJA_WEBHOOK_SECRET=` optional, enables signature verification
- `VIKUNJA_BASE_URL=https://...` used in VEVENT description link
- `UID_DOMAIN=example.local`
- `DEFAULT_DURATION_MINUTES=30`
- `DONE_BEHAVIOR=keep|cancel|delete`
- `DEBOUNCE_MS=0`
- `CALDAV_BASE_URL=https://caldav.yandex.ru`
- `CALDAV_USERNAME=...`
- `CALDAV_PASSWORD=...` (app password)
- `CALDAV_CALENDAR_NAME=
- `SQLITE_PATH=./data/state.sqlite`
  .

## Local run

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm start
```

## Docker run

```bash
docker build -t vikunja-webhook-caldav-sync .
docker run --rm -p 3000:3000 --env-file .env -v "$(pwd)/data:/app/data" vikunja-webhook-caldav-sync
```

Use [docker-compose.snippet.yml](./docker-compose.snippet.yml) as a template for Traefik deployment.

## Vikunja webhook setup

In Vikunja webhook settings:

- URL: `https://<your-domain>/webhook/vikunja`
- Events:
  - `task.created`
  - `task.updated`
  - `task.deleted` (recommended)
- Secret: use the same value as `VIKUNJA_WEBHOOK_SECRET`

## Event processing rules

- Create/update VEVENT when task has `start_date` or `due_date`.
- `DTSTART` priority: `start_date`, fallback `due_date`.
- `DTEND`:
  - use `end_date` when present;
  - else timed event gets `DEFAULT_DURATION_MINUTES`;
  - date-only event gets all-day span (`DTEND` next day).
- If task has no date signal, existing VEVENT is deleted.
- Done behavior:
  - `keep` (default): no special status change
  - `cancel`: upsert with `STATUS:CANCELLED`
  - `delete`: delete VEVENT

## Example payload

```json
{
  "event_name": "task.updated",
  "data": {
    "task": {
      "id": 123,
      "title": "Doctor visit",
      "description": "Bring test results",
      "start_date": "2026-03-01T10:00:00Z",
      "end_date": "2026-03-01T10:30:00Z",
      "due_date": null,
      "done": false,
      "priority": 3,
      "project_id": 10,
      "labels": [{ "title": "health" }]
    }
  }
}
```

Expected behavior:

- Service computes hash of relevant fields.
- If changed, it upserts `UID: vikunja-task-123@<UID_DOMAIN>` to calendar
- Stores latest hash + href + etag in SQLite.

## Tests

Run:

```bash
npm test
```

Included unit tests:

- hash computation
- ICS generation (timed + all-day)
- signature verification

## Notes

- One-way sync only: Vikunja -> CalDAV.
