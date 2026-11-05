// Lost Roads server: serves the game's files and keeps accounts, saves,
// postcards and the leaderboard in Cloudflare's own storage (a Durable Object
// with a small SQLite database). No email addresses and no outside services.
import { DurableObject } from 'cloudflare:workers';

const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hashPassword(password, saltHex) {
  const salt = saltHex ? Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16))) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 20000 }, key, 256);
  return `${hex(salt)}:${hex(bits)}`;
}

class Fail extends Error {}
const fail = (code) => { throw new Fail(code); };

export class LostRoadsDB extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        lower_name TEXT NOT NULL UNIQUE,
        pass TEXT NOT NULL,
        best_km REAL NOT NULL DEFAULT 0,
        fails INTEGER NOT NULL DEFAULT 0,
        failed_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        player_id INTEGER NOT NULL,
        used_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS saves (
        player_id INTEGER PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cards (
        player_id INTEGER NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, id)
      );
    `);
  }

  one(query, ...args) {
    const rows = this.sql.exec(query, ...args).toArray();
    return rows[0] || null;
  }

  player(token) {
    const s = token && this.one('SELECT player_id, used_at FROM sessions WHERE token = ?', String(token));
    if (!s || s.used_at < Date.now() - 180 * 864e5) fail('signed_out');
    this.sql.exec('UPDATE sessions SET used_at = ? WHERE token = ?', Date.now(), String(token));
    return s.player_id;
  }

  newSession(playerId) {
    const token = crypto.randomUUID();
    this.sql.exec('INSERT INTO sessions (token, player_id, used_at) VALUES (?, ?, ?)', token, playerId, Date.now());
    return token;
  }

  async handle(action, b) {
    switch (action) {
      case 'signup': {
        const username = String(b.username || '').trim();
        if (!USERNAME.test(username)) fail('bad_username');
        if (String(b.password || '').length < 8) fail('short_password');
        if (this.one('SELECT id FROM players WHERE lower_name = ?', username.toLowerCase())) fail('username_taken');
        const pass = await hashPassword(String(b.password));
        const row = this.one('INSERT INTO players (username, lower_name, pass, updated_at) VALUES (?, ?, ?, ?) RETURNING id', username, username.toLowerCase(), pass, Date.now());
        return { token: this.newSession(row.id), username };
      }
      case 'signin': {
        const p = this.one('SELECT * FROM players WHERE lower_name = ?', String(b.username || '').trim().toLowerCase());
        if (!p) fail('wrong_login');
        const recent = p.failed_at > Date.now() - 10 * 60000;
        if (recent && p.fails >= 10) fail('too_many_tries');
        const [salt] = p.pass.split(':');
        if ((await hashPassword(String(b.password || ''), salt)) !== p.pass) {
          this.sql.exec('UPDATE players SET fails = ?, failed_at = ? WHERE id = ?', recent ? p.fails + 1 : 1, Date.now(), p.id);
          fail('wrong_login');
        }
        this.sql.exec('UPDATE players SET fails = 0 WHERE id = ?', p.id);
        return { token: this.newSession(p.id), username: p.username };
      }
      case 'signout':
        this.sql.exec('DELETE FROM sessions WHERE token = ?', String(b.token || ''));
        return { ok: true };
      case 'getSave': {
        const r = this.one('SELECT data FROM saves WHERE player_id = ?', this.player(b.token));
        return { data: r ? JSON.parse(r.data) : null };
      }
      case 'putSave': {
        const id = this.player(b.token);
        this.sql.exec('INSERT INTO saves (player_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (player_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at', id, JSON.stringify(b.data || {}), Date.now());
        return { ok: true };
      }
      case 'getCards': {
        const rows = this.sql.exec('SELECT data FROM cards WHERE player_id = ? ORDER BY created_at DESC', this.player(b.token)).toArray();
        return { cards: rows.map((r) => JSON.parse(r.data)) };
      }
      case 'putCard': {
        const id = this.player(b.token);
        if (this.one('SELECT COUNT(*) AS n FROM cards WHERE player_id = ?', id).n >= 200) fail('too_many_cards');
        this.sql.exec('INSERT OR IGNORE INTO cards (player_id, id, data, created_at) VALUES (?, ?, ?, ?)', id, String(b.id), JSON.stringify(b.data || {}), Date.now());
        return { ok: true };
      }
      case 'deleteCard':
        this.sql.exec('DELETE FROM cards WHERE player_id = ? AND id = ?', this.player(b.token), String(b.id));
        return { ok: true };
      case 'submitBest': {
        const km = Math.min(100000, Math.max(0, Number(b.km) || 0));
        this.sql.exec('UPDATE players SET best_km = ?, updated_at = ? WHERE id = ? AND best_km < ?', km, Date.now(), this.player(b.token), km);
        return { ok: true };
      }
      case 'leaderboard': {
        const limit = Math.min(200, Math.max(1, Number(b.limit) || 50));
        const rows = this.sql.exec('SELECT username, best_km FROM players WHERE best_km > 0 ORDER BY best_km DESC, updated_at ASC LIMIT ?', limit).toArray();
        return { rows };
      }
      default:
        fail('unknown_action');
    }
  }

  async fetch(request) {
    const action = new URL(request.url).pathname.replace(/^\/api\//, '');
    let body = {};
    if (request.method === 'POST') body = await request.json().catch(() => ({}));
    else body = Object.fromEntries(new URL(request.url).searchParams);
    try {
      return Response.json(await this.handle(action, body));
    } catch (e) {
      if (e instanceof Fail) return Response.json({ error: e.message }, { status: 400 });
      return Response.json({ error: 'server_error' }, { status: 500 });
    }
  }
}

// ---------------------------------------------------------------------------
// Visit counter for all four of Jamie's sites (Revise, Shared List, PackSmart,
// Lost Roads). Every site's small script (jt-stats.js) reports to /api/stats/hit
// with a random anonymous id kept on the visitor's own device. No names, no
// addresses and no IP numbers are stored. The numbers live in the D1 database
// bound as STATS, and the hidden admin panel reads them with a password.
// ---------------------------------------------------------------------------
const STATS_SITES = {
  'revision.jamietaylor.org': 'revise',
  'sharedlist.jamietaylor.org': 'sharedlist',
  'jamietaylor.org': 'sharedlist',
  'packsmart.jamietaylor.org': 'packsmart',
  'roads2d.jamietaylor.org': 'roads2d'
};
const STATS_IDS = ['revise', 'sharedlist', 'packsmart', 'roads2d'];
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|uptime|curl|wget|python|node-fetch|axios|go-http|java\//i;

const londonDay = (date = new Date()) => date.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const sha256Hex = async (text) => hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
const sameText = (a, b) => { let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };

function statsJson(body, status, cors) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
}

async function statsSummary(db) {
  const today = londonDay();
  const d7 = addDays(today, -6);
  const d30 = addDays(today, -29);
  const d14 = addDays(today, -13);
  const rows = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
  const [all, wToday, w7, w30, daily, back, new7, new30] = await Promise.all([
    rows('SELECT site, SUM(n) AS visits, COUNT(DISTINCT vid) AS people, MIN(day) AS since FROM stats_days GROUP BY site'),
    rows('SELECT site, SUM(n) AS visits, COUNT(DISTINCT vid) AS people FROM stats_days WHERE day >= ? GROUP BY site', today),
    rows('SELECT site, SUM(n) AS visits, COUNT(DISTINCT vid) AS people FROM stats_days WHERE day >= ? GROUP BY site', d7),
    rows('SELECT site, SUM(n) AS visits, COUNT(DISTINCT vid) AS people FROM stats_days WHERE day >= ? GROUP BY site', d30),
    rows('SELECT site, day, SUM(n) AS visits, COUNT(*) AS people FROM stats_days WHERE day >= ? GROUP BY site, day', d14),
    rows('SELECT site, COUNT(*) AS c FROM (SELECT site, vid FROM stats_days GROUP BY site, vid HAVING COUNT(DISTINCT day) > 1) GROUP BY site'),
    rows('SELECT site, COUNT(*) AS c FROM stats_first WHERE first_day >= ? GROUP BY site', d7),
    rows('SELECT site, COUNT(*) AS c FROM stats_first WHERE first_day >= ? GROUP BY site', d30)
  ]);
  const by = (list, site) => list.find((r) => r.site === site) || {};
  const win = (list, site) => ({ visits: by(list, site).visits || 0, people: by(list, site).people || 0 });
  const sites = STATS_IDS.map((id) => {
    const series = [];
    for (let i = 13; i >= 0; i--) {
      const day = addDays(today, -i);
      const r = daily.find((x) => x.site === id && x.day === day);
      series.push({ day, visits: r ? r.visits : 0, people: r ? r.people : 0 });
    }
    return {
      id,
      since: by(all, id).since || null,
      visits: by(all, id).visits || 0,
      people: by(all, id).people || 0,
      cameBack: by(back, id).c || 0,
      today: win(wToday, id),
      days7: win(w7, id),
      days30: win(w30, id),
      new7: by(new7, id).c || 0,
      new30: by(new30, id).c || 0,
      daily: series
    };
  });
  return { today, sites };
}

async function handleStats(request, env) {
  const url = new URL(request.url);
  const action = url.pathname.replace(/^\/api\/stats\//, '');
  let originHost = '';
  try { originHost = new URL(request.headers.get('origin') || '').hostname; } catch { /* no origin */ }
  const host = originHost || url.hostname; // no Origin header means a same-site request
  const site = STATS_SITES[host];
  const cors = originHost && site
    ? { 'access-control-allow-origin': request.headers.get('origin'), 'vary': 'Origin', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' }
    : {};
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'access-control-max-age': '86400' } });
  if (request.method !== 'POST') return statsJson({ error: 'method' }, 405, cors);
  if (!site) return statsJson({ error: 'origin' }, 403, {});
  if (!env.STATS) return statsJson({ error: 'not_set_up' }, 503, cors);

  let body = {};
  try { body = JSON.parse(await request.text()); } catch { /* ignore */ }
  if (!body || typeof body !== 'object') body = {};

  try {
    if (action === 'hit') {
      const ua = request.headers.get('user-agent') || '';
      const vid = String(body.vid || '');
      if (!ua || BOT.test(ua) || !/^[a-z0-9]{12,40}$/.test(vid)) return new Response(null, { status: 204, headers: cors });
      const day = londonDay();
      await env.STATS.batch([
        env.STATS.prepare('INSERT INTO stats_days (site, day, vid, n) VALUES (?1, ?2, ?3, 1) ON CONFLICT (site, day, vid) DO UPDATE SET n = n + 1').bind(site, day, vid),
        env.STATS.prepare('INSERT OR IGNORE INTO stats_first (site, vid, first_day) VALUES (?1, ?2, ?3)').bind(site, vid, day)
      ]);
      return new Response(null, { status: 204, headers: cors });
    }

    if (action !== 'summary' && action !== 'password') return statsJson({ error: 'unknown_action' }, 404, cors);

    // Everything below needs the admin password. Wrong guesses are slowed down per visitor.
    const key = await sha256Hex('ip:' + (request.headers.get('cf-connecting-ip') || '?'));
    const now = Date.now();
    const tries = await env.STATS.prepare('SELECT fails, at FROM stats_tries WHERE k = ?').bind(key).first();
    const recent = tries && now - tries.at < 15 * 60000;
    if (recent && tries.fails >= 8) return statsJson({ error: 'locked' }, 429, cors);
    const admin = await env.STATS.prepare('SELECT pass FROM stats_admin WHERE id = 1').first();
    let ok = false;
    if (admin && typeof body.password === 'string' && body.password.length <= 200) {
      const [salt] = admin.pass.split(':');
      ok = sameText(await hashPassword(body.password, salt), admin.pass);
    }
    if (!ok) {
      await env.STATS.prepare('INSERT INTO stats_tries (k, fails, at) VALUES (?1, 1, ?2) ON CONFLICT (k) DO UPDATE SET fails = CASE WHEN ?2 - at < 900000 THEN fails + 1 ELSE 1 END, at = ?2').bind(key, now).run();
      return statsJson({ error: 'wrong_password' }, 401, cors);
    }
    if (tries) await env.STATS.prepare('DELETE FROM stats_tries WHERE k = ?').bind(key).run();

    if (action === 'summary') return statsJson(await statsSummary(env.STATS), 200, cors);

    const next = String(body.newPassword || '');
    if (next.length < 8 || next.length > 100) return statsJson({ error: 'short_password' }, 400, cors);
    await env.STATS.prepare('UPDATE stats_admin SET pass = ? WHERE id = 1').bind(await hashPassword(next)).run();
    return statsJson({ ok: true }, 200, cors);
  } catch (e) {
    return statsJson({ error: 'server_error' }, 500, cors);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/stats/')) return handleStats(request, env);
    if (url.pathname.startsWith('/api/')) {
      const res = await env.DB.get(env.DB.idFromName('lost-roads')).fetch(request);
      const out = new Response(res.body, res);
      out.headers.set('cache-control', 'no-store');
      return out;
    }
    return env.ASSETS.fetch(request);
  }
};
