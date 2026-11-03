'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
async function waitForHealth(base, child) {
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error('Sync server exited before it became ready');
    try {
      const response = await fetch(base + '/api/health');
      if (response.ok) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Sync server did not become ready');
}
async function request(base, endpoint, method = 'GET', body, token) {
  const response = await fetch(base + endpoint, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  return { status: response.status, data };
}
async function runRound(round) {
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  const dbPath = path.join(os.tmpdir(), `roomwallet-test-${process.pid}-${round}.json`);
  try { fs.unlinkSync(dbPath); } catch (_) {}
  const serverEnv = { ...process.env, PORT: String(port), HOST: '127.0.0.1', ROOM_WALLET_DB: dbPath };
  let child = spawn(process.execPath, ['server.js'], { cwd: root, env: serverEnv, stdio: 'ignore' });
  try {
    await waitForHealth(base, child);
    const room = 'Regression Room ' + round;
    const members = [{ id: `h-${round}`, name: 'Harsha' }, { id: `c-${round}`, name: 'Charan' }, { id: `r-${round}`, name: 'Ravi' }];
    const initial = { wallets: [{ id: `w-${round}`, name: 'Room Expenses', limit: 5000 }], tx: [], members, hist: [], updated: Date.now() };

    const health = await request(base, '/api/health');
    assert.equal(health.status, 200); assert.equal(health.data.ok, true);
    const create = await request(base, '/api/sync', 'POST', { account: room, password: 'roompass123', members, state: initial, mode: 'create' });
    assert.equal(create.status, 200); assert.equal(create.data.members.length, 3);
    const wrongPassword = await request(base, '/api/sync', 'POST', { account: room, password: 'wrongpass', members, state: initial, mode: 'join' });
    assert.equal(wrongPassword.status, 401);
    const join = await request(base, '/api/sync', 'POST', { account: room.toUpperCase(), password: 'roompass123', members: [], state: { wallets: [], tx: [], members: [], updated: 0 }, mode: 'join' });
    assert.equal(join.status, 200); assert.deepEqual(join.data.members.map(x => x.name), ['Harsha', 'Charan', 'Ravi']);
    assert.equal(join.data.state.wallets.length, 1);
    const duplicateCreate = await request(base, '/api/sync', 'POST', { account: room, password: 'roompass123', members, state: initial, mode: 'create' });
    assert.equal(duplicateCreate.status, 409);
    const missingJoin = await request(base, '/api/sync', 'POST', { account: 'Missing Room ' + round, password: 'roompass123', members: [], state: initial, mode: 'join' });
    assert.equal(missingJoin.status, 404);

    const transaction = { id: `tx-${round}`, w: `w-${round}`, amt: 325 + round, type: 'spend', note: 'Groceries test ' + round, t: Date.now() };
    const latest = { ...create.data.state, tx: [transaction], updated: Date.now() + 5000 };
    const write = await request(base, '/api/state', 'PUT', { state: latest }, create.data.token);
    assert.equal(write.status, 200); assert.equal(write.data.ok, true);
    const crossDeviceRead = await request(base, '/api/state', 'GET', null, join.data.token);
    assert.equal(crossDeviceRead.status, 200); assert.equal(crossDeviceRead.data.state.tx[0].amt, transaction.amt);
    const staleWrite = await request(base, '/api/state', 'PUT', { state: { ...initial, updated: Date.now() - 60000 } }, join.data.token);
    assert.equal(staleWrite.status, 200); assert.equal(staleWrite.data.conflict, true); assert.equal(staleWrite.data.state.tx.length, 1);
    const invalidWrite = await request(base, '/api/state', 'PUT', { state: { ...latest, tx: [{ w: 'missing-wallet', amt: -5, type: 'spend', t: 1 }], updated: Date.now() + 9000 } }, create.data.token);
    assert.equal(invalidWrite.status, 400);
    child.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 150));
    child = spawn(process.execPath, ['server.js'], { cwd: root, env: serverEnv, stdio: 'ignore' });
    await waitForHealth(base, child);
    const afterRestartLogin = await request(base, '/api/sync', 'POST', { account: room, password: 'roompass123', members: [], state: { wallets: [], tx: [], updated: 0 }, mode: 'join' });
    assert.equal(afterRestartLogin.status, 200);
    assert.equal(afterRestartLogin.data.state.tx[0].amt, transaction.amt, 'room data survives server restart');
    const unauthorized = await request(base, '/api/state');
    assert.equal(unauthorized.status, 401);
    const html = await fetch(base + '/');
    assert.equal(html.status, 200); assert.match(await html.text(), /Room Wallet/);
    const missing = await request(base, '/not-found');
    assert.equal(missing.status, 404);
    console.log(`PASS round ${round}: room create/join, wrong password, member preservation, cross-device sync, restart persistence, stale-write guard, validation, auth, static app`);
  } finally {
    child.kill('SIGTERM');
    try { fs.unlinkSync(dbPath); } catch (_) {}
    try { fs.unlinkSync(dbPath + '.tmp'); } catch (_) {}
  }
}
function testUpiParser() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const match = html.match(/function parseUpi\(s\)\{[^\n]+\}\nvar UPIRE=([^;]+);/);
  assert.ok(match, 'UPI parser source exists');
  const api = vm.runInNewContext(match[0].replace(/\nvar UPIRE=/, '\nvar UPIRE=') + ';({parseUpi:parseUpi,UPIRE:UPIRE})', { URL });
  const qr = api.parseUpi('upi://pay?pa=merchant%40okaxis&pn=Test%20Shop&am=125.50&tn=Lunch');
  assert.equal(qr.pa, 'merchant@okaxis'); assert.equal(qr.pn, 'Test Shop'); assert.equal(qr.am, '125.50'); assert.equal(qr.tn, 'Lunch');
  assert.equal(api.parseUpi('merchant@okaxis').pa, 'merchant@okaxis');
  assert.equal(api.parseUpi('https://pay.example/upi?pa=merchant%40okaxis&am=99').am, '99');
  assert.equal(api.parseUpi('https://example.com/not-a-payment').pa, '');
  console.log('PASS UPI QR parsing: deep link, encoded payee, amount, note, plain UPI ID, HTTP UPI URL, unsupported URL');
}

function testSessionPolicy() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const begin = html.indexOf('var SESSION_KEY="room-wallet-last-activity-v2"');
  const end = html.indexOf('function setMode(next)', begin);
  assert.ok(begin >= 0 && end > begin, 'session policy source exists');
  let now = 1_800_000_000_000;
  const store = new Map();
  const fakeDate = { now: () => now };
  const classList = { contains: () => false, add: () => {}, remove: () => {} };
  const fakeElement = { classList, value: '', textContent: '' };
  const document = { body: { classList }, addEventListener: () => {}, getElementById: () => fakeElement };
  const window = { addEventListener: () => {} };
  const localStorage = { getItem: key => store.has(key) ? store.get(key) : null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) };
  const snippet = html.slice(begin, end) + ';({sessionValid:sessionValid,touchSession:touchSession,SESSION_MS:SESSION_MS})';
  const api = vm.runInNewContext(snippet, { Date: fakeDate, document, window, localStorage, setTimeout: () => 1, clearTimeout: () => {} });
  assert.equal(api.SESSION_MS, 600000);
  assert.equal(api.sessionValid(), false);
  store.set('room-wallet-last-activity-v2', String(now));
  assert.equal(api.sessionValid(), true);
  now += 9 * 60 * 1000;
  assert.equal(api.sessionValid(), true);
  api.touchSession();
  now += 9 * 60 * 1000;
  assert.equal(api.sessionValid(), true, 'interaction refreshes the inactivity window');
  now += 10 * 60 * 1000 + 1;
  assert.equal(api.sessionValid(), false, 'session expires after 10 minutes without interaction');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(sw, /pathname\.startsWith\(\"\/api\/\"\)/, 'service worker bypasses cached API responses');
  console.log('PASS session policy: 10-minute inactivity timeout and activity refresh; API responses are never cached');
}

(async () => {
  testUpiParser();
  testSessionPolicy();
  for (let round = 1; round <= 3; round++) await runRound(round);
  console.log('ALL TESTS PASSED (3 independent data rounds)');
})().catch(error => { console.error(error); process.exitCode = 1; });
