# Under-6 floater notice

Under-6 **25m Freestyle** is also displayed as **25m Freestyle with Floaters**, with the same mandatory acknowledgement and ticket reminder. Its stored name remains unchanged.

The Under-6 board event is now displayed as **25m Freestyle Kick with Board / Floaters**, as requested. Its stored event name remains `25m Freestyle Kick with Board` so existing registrations, IDs and admin filters continue to work. Under-8 board entries are unchanged.

`src/competition.js` marks the Under-6 event using `floaterEvents` and provides its display label. `public/floater-policy.js` is shared by the form and backend: the warning is required only for Under-6 and a selected marked event (or an event explicitly named “with Floaters”).

The form shows the requested warning and required acknowledgement immediately below the selected events. Deselecting the last applicable event hides the notice and clears/disables the checkbox. Switching to another category clears the acknowledgement. Draft restoration restores event selection but requires a fresh acknowledgement.

The registration API independently determines the category and applicable events, then rejects missing or invalid acknowledgement with HTTP 400 and `FLOATERS_ACKNOWLEDGEMENT_REQUIRED` before either database INSERT. It accepts only boolean `true` or the multipart string `true`. The JSONB binding, transaction and idempotency protections are preserved. No database schema migration was needed; this change validates acknowledgement on submission rather than adding a historical consent record.

The ticket API derives a `requiresFloaters` flag from the saved category/events. The success-page artwork includes the requested reminder only when applicable; the same reminder appears in PNG/PDF output and accessible ticket text. Existing Under-6 board registrations also receive the reminder when their ticket is opened.

## Verification

- `npm test`: **51 passed, 0 failed**, including registration/admin regressions, direct API bypass attempts, malformed acknowledgement values, events_json fallback, applicable ticket flags and unrelated-category exclusions.
- `npm run test:floaters-ui`: desktop 1440px and mobile emulation 390px passed: notice visibility, multiple floater selections, deselection, DOB/category changes, draft restoration, blocked unacknowledged submission, successful acknowledged registration, downloaded warning artwork and QR decoding.
- `npm run test:ticket-ui`: desktop/mobile/long-content tickets, conditional reminders, PNG QR decoding and one-page PDF checks.

Extra events used in API test fixtures do not change the production catalogue. The browser test exercises the two actual Under-6 floater events. No deployment has been performed.
