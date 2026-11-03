# RoomWallet V3 — Multi-account / multi-room

## Features in this release
- Individual email/password accounts with unique `RW-XXXXXXXX` Account IDs.
- Private personal wallet per account.
- Create multiple shared rooms; initial member count is a planning value, not a hard cap.
- Invite existing accounts by Account ID; invitee must accept before joining.
- Multiple memberships per account; each room has its own shared transaction ledger.
- Owner/admin/member role model; current UI creates owner and members. Owner/admin only can invite or remove.
- Profile settings, sign out, bottom navigation, modal close and Android/browser back handling.
- PostgreSQL persistence using `DATABASE_URL`; local JSON fallback for development only.
- PWA manifest, icons and service worker.

## Deploy
Node.js 18+. Set Build Command `npm install`, Start Command `npm start`. Configure `DATABASE_URL` with a persistent PostgreSQL database and `PGSSL=true` where required. Do not use Render's ephemeral filesystem as the production database. Health check: `/api/health`.

## Run locally
`npm install && npm start`, then open `http://localhost:3000`.

## Tests
`npm test` runs API integration tests across three isolated data rounds: registration, unique IDs, personal wallet isolation, room creation, Account ID invitation, invite acceptance, multi-room membership, transaction isolation, authorization, persistence/reload and validation.

## Notes / limitations
This is an expense ledger, not a bank or payment processor. It does not initiate UPI payments. The first V3 release focuses on account and room foundations; QR payment capture, backup/restore UI, room deletion/ownership transfer and advanced roles are not included yet. Existing V2 room JSON is not automatically migrated; export and reconcile old records before switching live traffic. Do not overwrite the current deployment until the migration and acceptance tests pass.
