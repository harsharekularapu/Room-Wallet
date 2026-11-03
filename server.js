'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DB = process.env.ROOM_WALLET_DB || path.join(__dirname, 'room-wallet-db.json');
const MAX_BODY = 8 * 1024 * 1024;
const SESSION_TTL = 24 * 60 * 60 * 1000;
const sessions = new Map();

function readDB() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB, 'utf8'));
    return parsed && parsed.accounts && typeof parsed.accounts === 'object' ? parsed : { accounts: {} };
  } catch (_) { return { accounts: {} }; }
}
function writeDB(next) {
  const tmp = DB + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB);
}
let db = readDB();
function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 32); }
function safeEqual(a, b) { return a.length === b.length && crypto.timingSafeEqual(a, b); }
function makeToken() { return crypto.randomBytes(32).toString('hex'); }
function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '', tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY) { tooLarge = true; reject(Object.assign(new Error('Request too large'), { status: 413 })); }
    });
    req.on('end', () => {
      if (tooLarge) return;
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (_) { reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function accountKey(value) { return String(value || '').trim().normalize('NFKC').toLowerCase(); }
function normalizeMembers(members) {
  if (!Array.isArray(members)) return [];
  const seen = new Set();
  return members.slice(0, 10).map((member, i) => {
    const name = String(member && member.name || '').trim().slice(0, 60);
    const id = String(member && member.id || ('m' + i)).slice(0, 80);
    const normalized = name.toLocaleLowerCase();
    if (!name || seen.has(normalized)) return null;
    seen.add(normalized);
    return { id, name };
  }).filter(Boolean);
}
function normalizeState(state, authoritativeMembers) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw Object.assign(new Error('Invalid state'), { status: 400 });
  const wallets = Array.isArray(state.wallets) ? state.wallets.slice(0, 200) : [];
  const tx = Array.isArray(state.tx) ? state.tx.slice(-20000) : [];
  const hist = Array.isArray(state.hist) ? state.hist.slice(-24) : [];
  for (const wallet of wallets) {
    if (!wallet || typeof wallet.id !== 'string' || typeof wallet.name !== 'string') throw Object.assign(new Error('Invalid wallet data'), { status: 400 });
  }
  const walletIds = new Set(wallets.map(w => w.id));
  for (const item of tx) {
    if (!item || typeof item.w !== 'string' || !walletIds.has(item.w) || !Number.isFinite(Number(item.amt)) || Number(item.amt) < 0 || !Number.isFinite(Number(item.t)) || !['add', 'spend'].includes(item.type)) {
      throw Object.assign(new Error('Invalid transaction data'), { status: 400 });
    }
  }
  return {
    wallets, tx,
    members: authoritativeMembers,
    hist,
    month: typeof state.month === 'string' ? state.month.slice(0, 10) : null,
    updated: Number.isFinite(Number(state.updated)) ? Number(state.updated) : Date.now()
  };
}
function getSession(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) { sessions.delete(token); return null; }
  return session;
}
function samePassword(password, account) {
  const actual = hashPassword(password, account.salt);
  const expected = Buffer.from(account.passwordHash, 'hex');
  return safeEqual(actual, expected);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, service: 'Room Wallet Sync', version: 2 });

    if (req.method === 'POST' && url.pathname === '/api/sync') {
      const input = await parseBody(req);
      const key = accountKey(input.account);
      const password = String(input.password || '');
      if (key.length < 2 || key.length > 80 || password.length < 4 || password.length > 200) return send(res, 400, { error: 'Enter a room name and a password of at least 4 characters.' });
      const mode = String(input.mode || 'auto');
      if (!['auto', 'create', 'join'].includes(mode)) return send(res, 400, { error: 'Invalid room action.' });
      let account = db.accounts[key];
      if (!account && mode === 'join') return send(res, 404, { error: 'Room not found. Check the room name or create a new room.' });
      if (account && mode === 'create') return send(res, 409, { error: 'This room already exists. Choose Join room.' });
      if (!account) {
        const members = normalizeMembers(input.members);
        if (!members.length) return send(res, 400, { error: 'Add at least one unique member before creating a room.' });
        const salt = crypto.randomBytes(16).toString('hex');
        const state = normalizeState(input.state || {}, members);
        account = { account: key, displayName: String(input.account).trim().slice(0, 80), salt, passwordHash: hashPassword(password, salt).toString('hex'), members, state };
        const next = { ...db, accounts: { ...db.accounts, [key]: account } };
        writeDB(next); db = next;
      } else if (!samePassword(password, account)) {
        return send(res, 401, { error: 'Wrong room name or password.' });
      }
      const token = makeToken();
      sessions.set(token, { key, expiresAt: Date.now() + SESSION_TTL });
      return send(res, 200, { ok: true, token, members: account.members, state: account.state, accountName: account.displayName });
    }

    const session = getSession(req);
    if (req.method === 'GET' && url.pathname === '/api/state') {
      if (!session) return send(res, 401, { error: 'Session expired. Sign in again.' });
      const account = db.accounts[session.key];
      if (!account) return send(res, 404, { error: 'Room not found.' });
      return send(res, 200, { state: account.state, members: account.members });
    }
    if (req.method === 'PUT' && url.pathname === '/api/state') {
      if (!session) return send(res, 401, { error: 'Session expired. Sign in again.' });
      const input = await parseBody(req);
      const account = db.accounts[session.key];
      if (!account) return send(res, 404, { error: 'Room not found.' });
      const incoming = normalizeState(input.state, account.members);
      if (incoming.updated < Number(account.state.updated || 0)) {
        return send(res, 200, { ok: true, conflict: true, state: account.state, members: account.members });
      }
      const nextAccount = { ...account, state: incoming };
      const next = { ...db, accounts: { ...db.accounts, [session.key]: nextAccount } };
      writeDB(next); db = next;
      return send(res, 200, { ok: true, updated: incoming.updated });
    }

    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'API route not found.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' });
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch (_) { return send(res, 400, { error: 'Invalid path.' }); }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const root = path.resolve(__dirname);
    const file = path.resolve(root, relative);
    if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, { error: 'Forbidden.' });
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'Not found.' });
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': path.basename(file) === 'index.html' ? 'no-cache' : 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (error) {
    if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : 'Server error.' });
    else res.destroy();
    if (!error.status) console.error(error);
  }
});
server.listen(PORT, HOST, () => console.log(`Room Wallet Sync listening on ${HOST}:${PORT}`));
