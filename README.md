# RoomWallet V4

Personal wallet + shared rooms for roommates/friends. Node 18+, PostgreSQL in production.

## What's new vs V3
- Sessions last 30 days and survive server restarts (V3 logged everyone out after 10 minutes).
- Shared room = common pot (add money / spend) + bill splitting (who owes whom, settle up).
- Monthly limit per room and for the personal wallet (warns, you can record anyway), per-member summary, Stats (today / week / month, 7-day chart, day by day, month picker).
- Roles: owner / admin / member. Invite by Account ID, remove, leave, make admin, transfer ownership, delete room, edit room.
- Delete entries (author or admin), auto-refresh every 8 seconds, JSON/CSV backup, restore personal wallet.
- UPI: scan a payee QR and pay from a wallet, "My QR" to receive. The app never moves money; it records what you confirm.
- Security: static file whitelist (V3 could serve the database file and server.js), login rate limit, CSP and security headers.

## Deploy on Render
1. Push this folder to GitHub (file names exactly as in the zip; `.gitignore` must start with a dot).
2. Render: New > Web Service, Build `npm install`, Start `npm start`, health check `/api/health`.
3. Create a PostgreSQL database, copy its Internal URL into the env var `DATABASE_URL` (add `PGSSL=false` if you use the internal URL).
4. Keep the same database as V3: tables are compatible, old accounts and rooms carry over automatically.
5. Free instances sleep and free databases can expire. Check your plan and download a backup every month.

## Run locally
`npm install && npm start` then open http://localhost:3000 (local JSON file is used when `DATABASE_URL` is not set).

## Tests
`npm test` (API tests: accounts, isolation, limits, rooms, split/settle, permissions, restart persistence, static whitelist, rate limit).

## Limits
Expense ledger only, not a bank. Whole database is one JSON row, fine for friend groups, not thousands of users. QR scan/generate needs internet (CDN libraries). Room entries are not restorable from backup yet (personal wallet is).
