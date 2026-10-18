# AARK Swimming Competition Platform v6

Current build flow:

Registration → UPI/QR payment → payment proof upload → DB-confirmed success → secure ticket → check-in → heat/lane race card → timing entry → draft podium → mic announcement → publish → public Results + Timings.

## v6 additions

- Heat/lane creation per event (configurable lanes per heat)
- Heat-specific race card for the timing operator
- Save each swimmer timing independently
- Payment-proof review desk: Pending / Verified / Issue
- Admin audit trail for timing/result/payment/check-in actions
- Registration draft now saves text fields in localStorage **and image/payment proof blobs in IndexedDB** on the same device, so switching to UPI and returning is safer
- Idempotent registration submission to prevent duplicate records on retries
- Success is returned only after the database transaction commits
- Public timings/results remain hidden until an authorised operator publishes the event after the microphone announcement

## Local run

```bash
npm install
cp .env.example .env
npm start
```

Admin: `/admin/`

Default development PIN: `2468` — change it before launch.

## After the competition

The whole public site stays up once the meet is over — only the ticket desk closes.
`Find My Ticket` keeps its page and menu entry, but the lookup form is replaced with a note asking parents to
contact BSF customer care, and `POST /api/ticket-recovery` answers `410 TICKET_DESK_CLOSED`.

| Variable | Effect |
| --- | --- |
| `TICKET_DESK=open` | Reopens ticket and certificate recovery (set it for next year's meet). |
| `SUPPORT_PHONE` | The `Call customer care` button on the closed page. Defaults to BSF customer care, `+91 93132 41071`. |
| `SUPPORT_EMAIL` | Shown as an email button. |
| `SUPPORT_WHATSAPP_URL` | Overrides the WhatsApp group link used by the `Message BSF on WhatsApp` button. |

## Before production launch

1. Replace payment QR/UPI placeholders.
2. Connect the approved WhatsApp provider for ticket delivery.
3. Add the final ticket visual template.
4. Configure Google Wallet / Apple Wallet issuer credentials if required.
5. Move uploads to durable object storage.
6. Prefer managed PostgreSQL/MySQL for public high-traffic launch.
7. Put the app behind HTTPS and a production reverse proxy/load balancer.
8. Load-test registration and image uploads with realistic concurrency.
9. Back up registration data continuously during the event.
10. Avoid storing Aadhaar scans/numbers unless explicitly required; event-day physical verification is the intended design.
