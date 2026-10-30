// Lost Roads accounts: a tiny API that runs on Cloudflare next to the game.
// It stores usernames (with safely hashed passwords), saved progress and postcards
// in a Cloudflare D1 database. Everything that isn't /api/... is the game itself.

const SESSION_DAYS = 120;
const MAX_SAVE_BYTES = 200 * 1024;
const MAX_CARD_BYTES = 1500 * 1024;
const MAX_CARDS = 80;
const PBKDF2_ITERATIONS = 100000;

let schemaReady = false;

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS saves (
      user_id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      updated INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS cards (
      user_id INTEGER NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      created INTEGER NOT NULL,
      PRIMARY KEY (user_id, id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS attempts (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset INTEGER NOT NULL)`)
  ]);
  schemaReady = true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
const fail = (message, status = 400) => json({ error: message }, status);

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
const randomHex = (n) => toHex(crypto.getRandomValues(new Uint8Array(n)));

async function sha256(text) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return toHex(bits);
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readJson(request, limit) {
  const text = await request.text();
  if (text.length > limit) throw new Error('too-big');
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('bad-json');
  }
}

async function newSession(db, userId) {
  const token = randomHex(32);
  const expires = Date.now() + SESSION_DAYS * 86400000;
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, expires).run();
  // tidy up old sessions now and then
  if (Math.random() < 0.05) await db.prepare('DELETE FROM sessions WHERE expires < ?').bind(Date.now()).run();
  return token;
}

async function currentUser(db, request) {
  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer ([a-f0-9]{64})$/);
  if (!m) return null;
  const row = await db.prepare(
    'SELECT users.id AS id, users.username AS username, sessions.expires AS expires, sessions.token_hash AS th FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?'
  ).bind(await sha256(m[1])).first();
  if (!row || row.expires < Date.now()) return null;
  return row;
}

// Slow down password guessing: 10 failed tries per username per 15 minutes
async function tooManyAttempts(db, key) {
  const row = await db.prepare('SELECT count, reset FROM attempts WHERE key = ?').bind(key).first();
  return !!(row && row.reset > Date.now() && row.count >= 10);
}
async function noteFailure(db, key) {
  const now = Date.now();
  const row = await db.prepare('SELECT count, reset FROM attempts WHERE key = ?').bind(key).first();
  if (!row || row.reset < now) {
    await db.prepare('INSERT OR REPLACE INTO attempts (key, count, reset) VALUES (?, 1, ?)').bind(key, now + 15 * 60000).run();
  } else {
    await db.prepare('UPDATE attempts SET count = count + 1 WHERE key = ?').bind(key).run();
  }
}

const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
async function handleApi(request, env, path) {
  const db = env.DB;
  if (!db) return fail('Accounts aren’t set up on this site yet.', 503);
  await ensureSchema(db);
  const method = request.method;

  if (path === '/api/signup' && method === 'POST') {
    let body;
    try { body = await readJson(request, 2000); } catch (e) { return fail('Something went wrong. Please try again.'); }
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!USERNAME.test(username)) return fail('Usernames are 3 to 20 letters, numbers, - or _.');
    if (password.length < 8) return fail('Passwords need at least 8 characters.');
    if (password.length > 200) return fail('That password is too long.');
    const exists = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (exists) return fail('That username is taken. Try another one.', 409);
    const salt = randomHex(16);
    const hash = await hashPassword(password, salt);
    const res = await db.prepare('INSERT INTO users (username, hash, salt, created) VALUES (?, ?, ?, ?)')
      .bind(username, hash, salt, Date.now()).run();
    const userId = res.meta.last_row_id;
    const token = await newSession(db, userId);
    return json({ token, username });
  }

  if (path === '/api/login' && method === 'POST') {
    let body;
    try { body = await readJson(request, 2000); } catch (e) { return fail('Something went wrong. Please try again.'); }
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const key = 'login:' + username.toLowerCase();
    if (await tooManyAttempts(db, key)) return fail('Too many tries. Wait 15 minutes and try again.', 429);
    const user = await db.prepare('SELECT id, username, hash, salt FROM users WHERE username = ?').bind(username).first();
    const hash = await hashPassword(password, user ? user.salt : '00'.repeat(16));
    if (!user || !sameText(hash, user.hash)) {
      await noteFailure(db, key);
      return fail('That username and password don’t match.', 401);
    }
    const token = await newSession(db, user.id);
    return json({ token, username: user.username });
  }

  const user = await currentUser(db, request);
  if (!user) return fail('Please sign in again.', 401);

  if (path === '/api/logout' && method === 'POST') {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user.th).run();
    return json({ ok: true });
  }

  if (path === '/api/me' && method === 'GET') {
    return json({ username: user.username });
  }

  if (path === '/api/save' && method === 'GET') {
    const row = await db.prepare('SELECT data, updated FROM saves WHERE user_id = ?').bind(user.id).first();
    return json(row ? { data: JSON.parse(row.data), updated: row.updated } : { data: null, updated: 0 });
  }

  if (path === '/api/save' && method === 'PUT') {
    let body;
    try { body = await readJson(request, MAX_SAVE_BYTES); } catch (e) { return fail('That save is too large.', 413); }
    const now = Date.now();
    await db.prepare('INSERT INTO saves (user_id, data, updated) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated = excluded.updated')
      .bind(user.id, JSON.stringify(body), now).run();
    return json({ ok: true, updated: now });
  }

  if (path === '/api/cards' && method === 'GET') {
    const { results } = await db.prepare('SELECT data FROM cards WHERE user_id = ? ORDER BY created DESC').bind(user.id).all();
    return json({ cards: results.map((r) => JSON.parse(r.data)) });
  }

  if (path === '/api/cards' && method === 'POST') {
    let card;
    try { card = await readJson(request, MAX_CARD_BYTES); } catch (e) { return fail('That postcard is too large.', 413); }
    if (!card || !card.id || typeof card.img !== 'string' || !card.img.startsWith('data:image/jpeg')) return fail('That isn’t a postcard.');
    const count = await db.prepare('SELECT COUNT(*) AS n FROM cards WHERE user_id = ?').bind(user.id).first();
    if (count.n >= MAX_CARDS) return fail(`Your online album is full (${MAX_CARDS} postcards). Remove some to make room.`, 409);
    await db.prepare('INSERT OR IGNORE INTO cards (user_id, id, data, created) VALUES (?, ?, ?, ?)')
      .bind(user.id, String(card.id), JSON.stringify(card), Number(card.id) || Date.now()).run();
    return json({ ok: true });
  }

  const del = path.match(/^\/api\/cards\/([A-Za-z0-9_-]{1,40})$/);
  if (del && method === 'DELETE') {
    await db.prepare('DELETE FROM cards WHERE user_id = ? AND id = ?').bind(user.id, del[1]).run();
    return json({ ok: true });
  }

  return fail('Not found.', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url.pathname);
      } catch (err) {
        console.error(err);
        return fail('The save server had a problem. Your progress is still saved on this device.', 500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
