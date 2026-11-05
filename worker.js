// Lost Roads server: serves the game's files and keeps accounts, saves,
// postcards and the leaderboard in Cloudflare's own storage (a Durable Object
// with a small SQLite database). No email addresses and no outside services.
import { DurableObject } from 'cloudflare:workers';
import { handleStats, getBlockedWords, nameBlocked } from './stats.js';

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
        if (this.env.STATS && nameBlocked(username, await getBlockedWords(this.env.STATS))) fail('name_not_allowed');
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
      // ---- Admin tools. Only reachable from the stats code in the Worker (it checks the
      // admin password first); the public Worker route blocks /api/admin* and strips the header.
      case 'admin_counts': {
        const n = (q, ...a) => this.one(q, ...a).n;
        const day = 864e5;
        return {
          players: n('SELECT COUNT(*) AS n FROM players'),
          withScore: n('SELECT COUNT(*) AS n FROM players WHERE best_km > 0'),
          saves: n('SELECT COUNT(*) AS n FROM saves'),
          postcards: n('SELECT COUNT(*) AS n FROM cards'),
          active7: n('SELECT COUNT(DISTINCT player_id) AS n FROM sessions WHERE used_at > ?', Date.now() - 7 * day),
          active30: n('SELECT COUNT(DISTINCT player_id) AS n FROM sessions WHERE used_at > ?', Date.now() - 30 * day),
          bestKm: this.one('SELECT COALESCE(MAX(best_km), 0) AS n FROM players').n
        };
      }
      case 'admin_players':
        return { rows: this.sql.exec('SELECT id, username, best_km, updated_at FROM players ORDER BY best_km DESC, updated_at DESC LIMIT 300').toArray() };
      case 'admin_rename': {
        const name = String(b.name || '').trim();
        if (!USERNAME.test(name)) fail('bad_username');
        const taken = this.one('SELECT id FROM players WHERE lower_name = ?', name.toLowerCase());
        if (taken && taken.id !== Number(b.id)) fail('username_taken');
        this.sql.exec('UPDATE players SET username = ?, lower_name = ? WHERE id = ?', name, name.toLowerCase(), Number(b.id));
        return { ok: true, username: name };
      }
      case 'admin_unscore':
        this.sql.exec('UPDATE players SET best_km = 0 WHERE id = ?', Number(b.id));
        return { ok: true };
      case 'admin_delete': {
        const id = Number(b.id);
        for (const t of ['sessions', 'saves', 'cards']) this.sql.exec(`DELETE FROM ${t} WHERE player_id = ?`, id);
        this.sql.exec('DELETE FROM players WHERE id = ?', id);
        return { ok: true };
      }
      default:
        fail('unknown_action');
    }
  }

  async fetch(request) {
    const action = new URL(request.url).pathname.replace(/^\/api\//, '');
    if (action.startsWith('admin_') && request.headers.get('x-jt-admin') !== 'yes') return Response.json({ error: 'unknown_action' }, { status: 404 });
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/stats/')) return handleStats(request, env);
    if (url.pathname.startsWith('/api/')) {
      if (/^\/api\/admin/i.test(url.pathname)) return Response.json({ error: 'unknown_action' }, { status: 404 });
      const headers = new Headers(request.headers);
      headers.delete('x-jt-admin'); // only the stats code may use the admin tools
      const res = await env.DB.get(env.DB.idFromName('lost-roads')).fetch(new Request(request, { headers }));
      const out = new Response(res.body, res);
      out.headers.set('cache-control', 'no-store');
      return out;
    }
    return env.ASSETS.fetch(request);
  }
};
