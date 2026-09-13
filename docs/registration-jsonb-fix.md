# Registration JSONB incident fix

## Source and root cause

The initial local checkout was SQLite v7 at `d26d958`. It already used `JSON.stringify(events)` with a TEXT column and could not produce the reported PostgreSQL error. The clean checkout was fast-forwarded to GitHub `main` (`52b0cef951703e19d7f6435dc33fc5b8fd132cbe`) before this fix. Existing upstream branding and PostgreSQL changes are preserved.

There is one registration POST route (`/api/register`) and one registration INSERT. The frontend sends multipart FormData with `events=JSON.stringify(selected)`. Multer parses its text fields. The backend parsed events into a JavaScript array, then bound that array as the 12th value. `pg` serializes JavaScript arrays as PostgreSQL arrays (`{"25m Freestyle"}`), which JSONB rejects with `22P02`.

The latest upstream fix put `JSON.stringify(events)` in the SQL column list instead of the values array; it still bound `events` at index 11. This also introduces invalid SQL syntax. The reported JSON error is consistent with the preceding INSERT, but Railway's active deployment cannot be identified from repository contents alone.

Startup is `npm start` → `node server.js`; no build output, Dockerfile, Railway config, duplicate server, or alternate registration route exists in the fetched tree. Railway dashboard overrides and live schema have not been inspected.

## Exact essential correction

```diff
- guardian_name,JSON.stringify(events),amount
+ guardian_name,events_json,amount
- $11,$12,$13
+ $11,$12::jsonb,$13
- ...,events,amount,...
+ ...,eventsJson,amount,...
```

`eventsJson = JSON.stringify(normalizedEvents)` is computed after normalization and validation. Inputs can be arrays, JSON strings, or a single recognized event name. Missing/empty events, unknown names, non-string members, duplicates, invalid required fields and dates are rejected before database writes. Existing maximum of four individual events plus optional relay is preserved.

The schema already declares `events_json JSONB NOT NULL` in `src/db.js`; no migration is required for that schema. Registration and WhatsApp queue writes remain in the same transaction. Success is returned after commit. Existing unique idempotency keys prevent duplicate rows; a concurrent conflict returns 409 and a retry retrieves the existing registration.

## Complete INSERT mapping

| Parameter | Column | Node value |
|---|---|---|
| $1 | registration_id | registrationId |
| $2 | ticket_token | ticketToken |
| $3 | idempotency_key | b.idempotencyKey |
| $4 | full_name | b.fullName.trim() |
| $5 | school_name | b.schoolName.trim() |
| $6 | gender | b.gender |
| $7 | dob | b.dob |
| $8 | age_category | c.name |
| $9 | phone | b.phone.trim() |
| $10 | email | trimmed email or null |
| $11 | guardian_name | trimmed guardianName or null |
| **$12::jsonb** | **events_json** | **eventsJson (string)** |
| $13 | amount | amount |
| $14 | participant_photo | photo.buffer |
| $15 | participant_photo_mime | photo.mimetype |
| $16 | payment_proof | proof.buffer |
| $17 | payment_proof_mime | proof.mimetype |
| $18 | payment_utr | trimmed paymentUtr or null |

## Files changed by this fix

- `server.js`: normalization/validation, corrected column and binding, optional diagnostic logging, useful JSON errors, startup revision logging, export for integration tests.
- `package.json`: `npm test` and development-only embedded PostgreSQL dependency.
- `package-lock.json`: reproducible dependency versions.
- `test/registration.test.js`: regression and HTTP/database integration checks.
- `docs/registration-jsonb-fix.md`: incident evidence and deployment instructions.

`git diff -- server.js package.json` shows the exact application changes. Frontend and database schema were not changed by this fix.

## Validation

Run `npm ci` then `npm test` with Node 20 or later. No existing test script or tests existed upstream. The tests use PGlite (embedded PostgreSQL) with the installed `pg` serializer, actual HTTP/multipart requests, application routes and transaction helper. No production records are created.

Checks cover the original `22P02` reproduction; one/two/four events; Under-6 event names with spaces; four individuals plus relay; array, fallback and single-string inputs; malformed/empty/duplicate/unknown events; required fields; all 18 bindings; JSONB array round-trip; generated IDs; ticket and authenticated admin participant APIs; idempotent retries; rollback at either INSERT followed by a successful retry. This is not an end-to-end Railway network or browser UI test.

Live read-only check: `https://bsf-swimming-competition-2026-production.up.railway.app/health` returned `{"ok":true,"database":"postgres"}`. The public registration HTML matches the fetched main file and submits serialized events to `/api/register`. This does not expose the deployed backend SHA or prove registration writes succeed. Latest local test run: **27 passed, 0 failed**.

## Railway deployment and live verification

1. Commit and push this fix to the branch configured for the Railway web service. Do not deploy the old SQLite checkout. No push or deployment was performed during this repair.
2. In Railway, confirm service source repository `krish2147/bsf-swimming-competition-2026`, intended branch (`main` if unchanged), root directory containing this `package.json`, and start command `npm start` / `node server.js`. Confirm the new deployment's commit SHA matches the pushed fix.
3. Keep the existing PostgreSQL `DATABASE_URL`, `ADMIN_PIN`, `SESSION_SECRET` and other production settings. Set `REGISTRATION_EVENTS_DEBUG=true` temporarily, then deploy the new commit. Startup logs include Railway commit, branch and entrypoint when Railway provides those variables.
4. Verify `/health` returns `{"ok":true,"database":"postgres"}`. Using Railway's database console, confirm the live column type:

   ```sql
   SELECT table_schema, column_name, data_type
   FROM information_schema.columns
   WHERE table_name = 'registrations' AND column_name = 'events_json';
   ```

   Expected `jsonb` (or review explicitly if different). Do not blindly alter the live schema.
5. Submit an authorized test registration. Expect `eventsJson: '["25m Freestyle","25m Backstroke"]'`, `type: 'string'`, `isArray: false` in the debug log. Confirm the success ticket and participant visibility in the admin event list and payments view. Inspect the returned registration ID:

   ```sql
   SELECT registration_id, events_json, jsonb_typeof(events_json), amount
   FROM registrations WHERE registration_id = '<returned-registration-id>';
   SELECT registration_id, COUNT(*) FROM whatsapp_queue
   WHERE registration_id = '<returned-registration-id>' GROUP BY registration_id;
   ```

   Expect the exact selected events, JSONB type `array`, correct fee, and one queued ticket. Retry with the same submission key to confirm the same ID; do not make another payment.
6. Set `REGISTRATION_EVENTS_DEBUG=false` after verification. The diagnostic contains event selections only, with no participant details or files.
