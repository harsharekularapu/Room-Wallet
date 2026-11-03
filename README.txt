ROOM WALLET — FINAL TESTED PACKAGE
==================================

FEATURES
- Clear Create room / Join room choices on the first screen.
- Create a shared room using a room name, password and member list.
- Join an existing room from another phone using the exact room name and password; choose your member profile when prompted.
- Existing room members and balances are loaded from the server.
- First-time joining devices choose their member profile by entering the saved member name.
- Up to 10 members per room.
- Shared wallets, expenses, history and balances.
- Cross-device sync: the app checks for changes every 4 seconds while open and sends local edits to the server.
- Stale older writes are rejected so an older phone cannot silently overwrite newer room data.
- UPI payment QR scanner reads standard upi://pay links, plain UPI IDs and compatible HTTP UPI links. Only values encoded in the QR can auto-fill.
- The app opens the user's UPI app; it does not execute or verify payments. The user confirms payment and records the expense.
- 10-minute inactivity lock. Navigation between app screens does not lock the app. Any interaction resets the inactivity timer. Reopening the app within the active window continues the session.
- PWA install support, offline static shell, backup/restore, CSV export, undo/redo, dark mode and responsive mobile layout.

RUN LOCALLY
1. Install Node.js 18 or later.
2. Extract this ZIP.
3. Open a terminal in the Room_Wallet_PWA folder.
4. Run: npm start
5. Open http://localhost:3000 on the phone/computer.

RUN TESTS
Run: npm test
The included regression suite performs three independent data rounds and tests room creation, joining, wrong passwords, cross-device state reads/writes, stale-write protection, validation, authentication, static app serving and UPI QR parsing.

REAL MULTI-PHONE USE
This package must be hosted on a Node.js-compatible service that runs server.js and preserves its writable data file (room-wallet-db.json). A static-only Netlify deploy cannot run this API server by itself. Use one Node-capable HTTPS host for this entire folder and share that HTTPS address with every member. HTTPS is required for camera QR scanning on phones.

DATA & SECURITY NOTES
- Passwords are stored as salted scrypt hashes; raw passwords are not written to the database.
- Room transactions and wallet details are stored in room-wallet-db.json. Restrict server access and configure regular backups and persistent disk storage.
- Use HTTPS in production. Do not use a public shared password.
- This is a shared expense tracker, not a bank account or payment processor. UPI transfers happen only in the selected UPI app.
- Browser camera permissions and QR support vary by device. If scanning is unavailable, enter the UPI ID manually.
