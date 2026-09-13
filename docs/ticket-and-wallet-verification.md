# Ticket experience: implementation, verification and wallet setup

## What changed

The old success page used basic HTML, a print-only button labelled as a download, and Google/Apple buttons that only displayed alerts. Both wallet API routes returned 501; there was no signing implementation.

The success page now presents a BSF entry pass with the original logo, competition name, successful-registration state, participant name, prominent registration ID, school, category, gender, selected events, check-in QR, payment-review status, competition date and published location. The source website lists 4 October 2026 and Vadodara, Gujarat; no specific pool venue is configured, so none was invented.

The pass is drawn at 2× resolution (1360 pixels wide, content-dependent height). This is the artwork used for the screen, PNG and print, so downloading cannot accidentally capture navigation or buttons. Layout wraps long names, school names and events, including unbroken strings. Font readiness, logo loading, QR loading and final image decoding complete before download/print buttons enable. The canvas uses the local logo, server-generated QR data URL and system Arial font, with no CDN or DOM-screenshot dependency. Accessible structured ticket text accompanies the image.

Download filename: `BSF-Ticket-{REGISTRATION_ID}.png`. Downloads run directly from a user click against an already prepared PNG blob. Print/Save as PDF uses browser printing, ticket-only CSS and A4 page sizing without a PDF library. The existing successful-registration back-navigation guard is preserved. Missing/invalid ticket links show a useful error and cannot download empty tickets.

The QR retains the existing `${BASE_URL}/admin/checkin.html?token=...` payload. The ticket API renders it at 720px with a four-module quiet zone; its token and content do not change on rerender. Set Railway `BASE_URL` to the actual public HTTPS origin. Downloaded tickets are snapshots: payment review status reflects the status when the pass was generated.

## Files changed

- `public/success.html`: new success-page layout, download/print actions, accessible ticket container, honest wallet availability notice.
- `public/ticket.css`: screen/mobile/print layout.
- `public/ticket.js`: wrapped high-resolution ticket renderer, original images/QR, PNG download, printing, loading/errors and existing navigation guard.
- `server.js`: only the ticket GET route changed in this task; adds payment status/date/location/check-in URL and a higher-resolution QR. Registration POST/transaction/JSONB handling is unchanged.
- `scripts/verify-ticket.cjs`: complete ticket download/QR/print browser checks.
- `scripts/verify-admin.cjs`: uses the new rendered-ticket selector for existing ticket checks.
- `package.json`, `package-lock.json`: ticket test command and development-only PNG/QR decoding dependencies. No new production dependency.
- `docs/ticket-and-wallet-verification.md`: this report.

## Wallet credential audit

Repository files, ignored local environment/certificate filenames and wallet-related process environment names were inspected without printing secret values. Only `.env.example` was found, with `GOOGLE_WALLET_ENABLED=false` and `APPLE_WALLET_ENABLED=false`. No issuer ID, service account configuration, signing key, Apple certificate, Pass Type ID, Team ID or WWDR certificate was found in the accessible local project/environment. No wallet signing code exists. Railway's private environment is not connected here and was not inspected.

The placeholder buttons are removed. A clear **Wallet passes — Coming soon** notice directs parents to PNG/PDF. Existing unsupported wallet endpoints are not invoked. No unsigned/fake pass, JWT or `.pkpass` is produced. Setting the old `*_WALLET_ENABLED` flags alone will not activate wallet support.

### Google Wallet setup required

1. Create/complete the Google Wallet issuer account in the Google Pay & Wallet Console and record the issuer ID. Complete publishing access before offering passes broadly; test mode alone does not establish public availability.
2. Enable the Google Wallet API in the associated Google Cloud project and create a service account. Grant its email the appropriate access to the Wallet issuer account.
3. Provide the service-account email and private signing key through server-side secret storage, never frontend JavaScript or a committed credential file.
4. Establish the BSF event ticket class and its stable class ID (`issuerId.classSuffix`), event date/location and approved branding assets. Confirm the production site origin and accessible HTTPS image URLs.
5. After setup, implement/review the server-side EventTicket class/object integration. Reuse a deterministic object ID derived from the unique registration ID. Sign the save JWT server-side and return the official Google save URL. Verify with a real authorized account before displaying an enabled button.

Suggested configuration to supply for that implementation: issuer ID, class ID, service-account email, private key (or a server-side service-account JSON secret), and production site origin. These are required inputs for future signing code, not currently wired switches.

Official sources: [Google Wallet authentication setup](https://developers.google.com/wallet/generic/getting-started/auth/rest), [signed JWT requirements](https://developers.google.com/wallet/generic/use-cases/jwt), [web onboarding example](https://codelabs.developers.google.com/add-to-wallet-web).

### Apple Wallet setup required

1. Use an Apple Developer account to register a Pass Type ID and record the Apple Team Identifier.
2. Issue a Pass Type ID certificate for that identifier. Retain its matching private key; provide a securely stored PKCS#12 bundle/password or the certificate/key pair for server-side use.
3. Obtain the applicable Apple WWDR intermediate certificate for the signing chain and verify certificate validity/expiry.
4. Prepare the required pass icon/logo sizes using BSF branding and provide the exact pass type/team identifiers.
5. After setup, implement/review generation of the real signed pass bundle: `pass.json`, image assets, manifest hashes and detached signature, packaged as `.pkpass` and served as `application/vnd.apple.pkpass`. Use the registration ID as a stable unique serial number and the existing check-in URL as its barcode payload. Test installation on a physical iPhone before enabling Add to Apple Wallet.

Certificates, private keys and passwords must stay in backend secret storage. A valid Pass Type ID certificate and matching identifiers are prerequisites; there is no working Apple pass to distribute without them.

Official sources: [Apple Wallet onboarding](https://developer.apple.com/wallet/get-started/), [create Wallet identifiers and certificates](https://developer.apple.com/help/account/capabilities/create-wallet-identifiers-and-certificates), [pass bundle/signature requirements](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/PassKit_PG/Creating.html).

## Verification

- `npm test`: **38 passed, 0 failed**, retaining all registration/admin API regressions.
- `npm run test:ticket-ui`: desktop 1440px, mobile 390px and long-content 320px scenarios passed. Each downloads the actual PNG, verifies its dimensions and footer, decodes the QR with jsQR and compares it to the existing check-in URL, verifies stable QR content across API calls, checks all event/detail text, checks print-only CSS, and generates a one-page A4 PDF. Invalid/missing links are checked separately. No successful-flow console errors or wallet endpoint requests.
- `npm run test:admin-ui`: existing registration-to-admin workflows also rerun with the new success page.
- Visual review covered mobile and long-content PNGs, confirming logo proportions, full content and footer.

Tests use real application routes, embedded PostgreSQL and headless Chrome. Mobile checks are browser emulation, not physical-device testing. The QR was decoded from the saved PNG bytes, not merely from the source API QR. Wallet installation cannot be verified until real signing setup exists.

Reproduce with Node 20+:

```sh
npm ci
npm test
npx playwright install chromium
npm run test:ticket-ui
npm run test:admin-ui
```

Alternatively set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an installed Chrome binary. PNG/PDF/screenshots are generated under the OS temporary directory in `bsf-ticket-verification`; set `TICKET_TEST_ARTIFACTS` to override that location.

No deployment was performed. Deploy this commit with the existing registration/admin fixes, verify Railway's public `BASE_URL`, then smoke-test a live ticket download and its QR. PNG/PDF ticket use does not depend on wallet setup.
