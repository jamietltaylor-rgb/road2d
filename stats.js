// ---------------------------------------------------------------------------
// Jamie's visitor counter, error log, feedback box, announcement banner and the
// data behind the hidden admin panel. It serves all four sites (Revise, Shared
// List, PackSmart and Lost Roads). Each site loads one small script
// (jt-stats.js) that talks to /api/stats/* here.
//
// Privacy: visitors are a random anonymous id kept on their own device. No
// names, no email addresses (unless someone types one into the feedback box)
// and no IP numbers are stored. Country comes from Cloudflare and is kept as a
// two-letter code only. Numbers live in the D1 database bound as STATS; the
// admin password is checked here, never in the browser.
// ---------------------------------------------------------------------------

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const SITE_HOSTS = {
  'revision.jamietaylor.org': 'revise',
  'sharedlist.jamietaylor.org': 'sharedlist',
  'jamietaylor.org': 'sharedlist',
  'packsmart.jamietaylor.org': 'packsmart',
  'roads2d.jamietaylor.org': 'roads2d'
};
export const SITE_IDS = ['revise', 'sharedlist', 'packsmart', 'roads2d'];

// Feature counters each app may report (anything else is ignored).
export const EVENTS = {
  revise: ['quiz_started', 'quiz_finished', 'exam_taken', 'exam_added', 'question_added', 'ai_questions', 'ai_marked'],
  sharedlist: ['list_created', 'list_joined', 'item_added', 'meal_list_created'],
  packsmart: ['trip_created', 'item_added', 'list_printed'],
  roads2d: ['hitchhiker_dropped', 'fuel_filled', 'game_over']
};

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|uptime|curl|wget|python|node-fetch|axios|go-http|java\//i;
const NOISE = /ResizeObserver|Script error|Non-Error promise|extension:|chrome-extension|moz-extension|safari-extension|Load failed$|Failed to fetch$|NetworkError/i;

const SOURCE_HOSTS = [
  ['mail.google.com', 'email'], ['outlook.', 'email'],
  ['tiktok.com', 'tiktok'], ['instagram.com', 'instagram'], ['facebook.com', 'facebook'], ['fb.com', 'facebook'],
  ['t.co', 'x'], ['twitter.com', 'x'], ['x.com', 'x'], ['youtube.com', 'youtube'], ['youtu.be', 'youtube'],
  ['google.', 'google'], ['bing.com', 'bing'], ['duckduckgo.com', 'duckduckgo'], ['reddit.com', 'reddit'],
  ['whatsapp.com', 'whatsapp'], ['wa.me', 'whatsapp'], ['snapchat.com', 'snapchat'], ['pinterest.', 'pinterest'],
  ['linkedin.com', 'linkedin'], ['lnkd.in', 'linkedin'], ['github.com', 'github'], ['lovable.', 'lovable'], ['claude.ai', 'claude']
];

/* ------------------------------------------------------------------ helpers */
export async function hashPassword(password, saltHex) {
  const salt = saltHex ? Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16))) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 20000 }, key, 256);
  return `${hex(salt)}:${hex(bits)}`;
}
const sha256Hex = async (text) => hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
const sameText = (a, b) => { let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

export function londonNow(date = new Date()) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday);
  return { day: `${p.year}-${p.month}-${p.day}`, hour: String(parseInt(p.hour, 10)).padStart(2, '0'), dow: String(Math.max(0, dow)) };
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
}

export function parseUA(ua, touch) {
  const ipadDesktop = /Macintosh/.test(ua) && touch > 1;
  const os = /iPhone|iPad|iPod/.test(ua) || ipadDesktop ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'ChromeOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const device = /iPad|Tablet|PlayBook|Silk/.test(ua) || ipadDesktop || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'tablet'
    : /Mobi|iPhone|iPod|Android/.test(ua) ? 'phone' : 'computer';
  return { os, device };
}

export function sourceOf(body, ua) {
  const tag = String(body.from || '').toLowerCase();
  if (/^[a-z0-9_-]{1,30}$/.test(tag)) return tag;
  const ref = String(body.ref || '').toLowerCase().replace(/^www\./, '');
  if (ref && /^[a-z0-9.-]{3,80}$/.test(ref)) {
    if (SITE_HOSTS[ref] || ref.endsWith('.jamietaylor.org')) return 'my other sites';
    for (const [h, name] of SOURCE_HOSTS) {
      if (h.endsWith('.') ? ref.includes(h) : ref === h || ref.endsWith('.' + h)) return name;
    }
    return ref.slice(0, 40);
  }
  if (/musical_ly|BytedanceWebview|TikTok/i.test(ua)) return 'tiktok';
  if (/Instagram/i.test(ua)) return 'instagram';
  if (/FBAN|FBAV/.test(ua)) return 'facebook';
  return 'direct';
}

export function cleanPath(raw) {
  const [pathPart, hash] = String(raw || '/').split('#');
  let path = '/' + pathPart.split('?')[0].replace(/^\/+/, '').slice(0, 80);
  path = path.replace(/^\/(list|join|l|g)\/[^/]+/i, '/$1/:code');
  path = path.split('/').map((seg) => (/^[0-9a-f]{8,}(-[0-9a-f]{4,}){0,4}$/i.test(seg) || /^\d{5,}$/.test(seg) || seg.length > 24 ? ':id' : seg)).join('/');
  if (hash && /^[a-z][a-z0-9_-]{0,30}$/i.test(hash)) path += '#' + hash.toLowerCase();
  return path.slice(0, 80);
}

// Is this username one the admin has blocked? Tolerates 0/1/3 style swaps and punctuation.
export function nameBlocked(name, words) {
  const norm = (s) => String(s).toLowerCase().replace(/[$]/g, 's').replace(/@/g, 'a').replace(/0/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/[^a-z]/g, '');
  const n = norm(name);
  return (words || []).some((w) => { const x = norm(w); return x.length >= 2 && n.includes(x); });
}

/* ----------------------------------------------------------------- settings */
const DEFAULT_CONFIG = {
  banner: { text: '', style: 'info', sites: [] },
  maintenance: { on: false, text: '', sites: [] },
  feedback: { sites: SITE_IDS.slice() }
};
async function getConfig(db) {
  const row = await db.prepare("SELECT v FROM stats_config WHERE k = 'config'").first();
  let cfg = {};
  try { cfg = row ? JSON.parse(row.v) : {}; } catch { /* use defaults */ }
  return {
    banner: { ...DEFAULT_CONFIG.banner, ...(cfg.banner || {}) },
    maintenance: { ...DEFAULT_CONFIG.maintenance, ...(cfg.maintenance || {}) },
    feedback: { ...DEFAULT_CONFIG.feedback, ...(cfg.feedback || {}) }
  };
}
const onlySites = (list) => (Array.isArray(list) ? list.filter((s) => SITE_IDS.includes(s)) : []);
function sanitizeConfig(c) {
  const style = (s) => (s === 'warning' ? 'warning' : 'info');
  return {
    banner: { text: clip(c.banner && c.banner.text, 300).trim(), style: style(c.banner && c.banner.style), sites: onlySites(c.banner && c.banner.sites) },
    maintenance: { on: !!(c.maintenance && c.maintenance.on), text: clip(c.maintenance && c.maintenance.text, 300).trim(), sites: onlySites(c.maintenance && c.maintenance.sites) },
    feedback: { sites: onlySites(c.feedback && c.feedback.sites) }
  };
}
export async function getBlockedWords(db) {
  const row = await db.prepare("SELECT v FROM stats_config WHERE k = 'blocked_words'").first();
  try { return row ? JSON.parse(row.v) : []; } catch { return []; }
}

/* ----------------------------------------------------------------- recording */
async function recordHit(db, site, body, request) {
  const ua = request.headers.get('user-agent') || '';
  const vid = String(body.vid || '');
  if (!ua || BOT.test(ua) || !/^[a-z0-9]{12,40}$/.test(vid)) return;
  const t = londonNow();
  const day = t.day;
  const isVisit = !(body.s === 0 || body.s === '0');
  const stmts = [];
  const dim = (kind, val) => stmts.push(db.prepare('INSERT INTO stats_dim (site, day, kind, val, n) VALUES (?1, ?2, ?3, ?4, 1) ON CONFLICT (site, day, kind, val) DO UPDATE SET n = n + 1').bind(site, day, kind, val));
  dim('page', cleanPath(body.path));
  if (isVisit) {
    stmts.push(db.prepare('INSERT INTO stats_days (site, day, vid, n) VALUES (?1, ?2, ?3, 1) ON CONFLICT (site, day, vid) DO UPDATE SET n = n + 1').bind(site, day, vid));
    stmts.push(db.prepare('INSERT OR IGNORE INTO stats_first (site, vid, first_day) VALUES (?1, ?2, ?3)').bind(site, vid, day));
    const { os, device } = parseUA(ua, Number(body.mt) || 0);
    const country = String((request.cf && request.cf.country) || 'XX').toUpperCase();
    const mode = body.mode === 'app' ? 'app' : 'web';
    dim('source', sourceOf(body, ua));
    dim('country', /^[A-Z0-9]{2}$/.test(country) ? country : 'XX');
    dim('device', device);
    dim('os', os);
    dim('hour', t.hour);
    dim('dow', t.dow);
    dim('mode', mode);
    if (mode === 'app') stmts.push(db.prepare('INSERT OR IGNORE INTO stats_installed (site, vid, day) VALUES (?1, ?2, ?3)').bind(site, vid, day));
  }
  await db.batch(stmts);
}

async function recordEvent(db, site, body, request) {
  const ua = request.headers.get('user-agent') || '';
  const name = String(body.name || '');
  if (!ua || BOT.test(ua) || !(EVENTS[site] || []).includes(name)) return;
  const v = Math.min(100000, Math.max(0, Number(body.v) || 0));
  await db.prepare('INSERT INTO stats_events (site, day, name, n, v) VALUES (?1, ?2, ?3, 1, ?4) ON CONFLICT (site, day, name) DO UPDATE SET n = n + 1, v = v + ?4').bind(site, londonNow().day, name, v).run();
}

// A signed-in person was seen on this site. Only a scrambled version of their account id is kept.
async function recordAcct(db, site, body, request) {
  const ua = request.headers.get('user-agent') || '';
  const id = String(body.acct || '');
  const vid = String(body.vid || '');
  if (!ua || BOT.test(ua) || !/^[a-z0-9]{12,40}$/.test(vid) || !/^[0-9a-fA-F-]{36}$/.test(id) || site === 'roads2d') return;
  const h = (await sha256Hex('acct:' + site + ':' + id.toLowerCase())).slice(0, 24);
  const day = londonNow().day;
  await db.prepare('INSERT INTO stats_accts (site, h, first_day, last_day) VALUES (?1, ?2, ?3, ?3) ON CONFLICT (site, h) DO UPDATE SET last_day = ?3').bind(site, h, day).run();
}

async function recordError(db, site, body, request) {
  const ua = request.headers.get('user-agent') || '';
  const msg = clip(body.msg, 200).trim();
  if (!ua || BOT.test(ua) || !msg || NOISE.test(msg)) return;
  const src = clip(body.src, 60);
  const line = Math.max(0, parseInt(body.line, 10) || 0);
  const path = cleanPath(body.path);
  const id = (await sha256Hex(`${site}|${msg}|${src}|${line}`)).slice(0, 16);
  const now = Date.now();
  await db.prepare('INSERT INTO stats_errors (id, site, msg, src, line, path, first_at, last_at, n) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 1) ON CONFLICT (id) DO UPDATE SET n = n + 1, last_at = ?7, path = ?6')
    .bind(id, site, msg, src, line, path, now).run();
  await db.prepare('DELETE FROM stats_errors WHERE id IN (SELECT id FROM stats_errors ORDER BY last_at DESC LIMIT -1 OFFSET 200)').run();
}

async function recordFeedback(db, site, body, request) {
  if (body.hp) return { ok: true };            // hidden field filled in: a robot
  const msg = clip(body.msg, 1000).trim();
  if (msg.length < 3) return { error: 'too_short' };
  const kind = ['idea', 'problem', 'other'].includes(body.kind) ? body.kind : 'other';
  const key = 'fb:' + (await sha256Hex('ip:' + (request.headers.get('cf-connecting-ip') || '?')));
  const now = Date.now();
  const t = await db.prepare('SELECT fails, at FROM stats_tries WHERE k = ?').bind(key).first();
  const fresh = t && now - t.at < 3600000;
  if (fresh && t.fails >= 5) return { error: 'too_many' };
  await db.prepare('INSERT INTO stats_tries (k, fails, at) VALUES (?1, 1, ?2) ON CONFLICT (k) DO UPDATE SET fails = CASE WHEN ?2 - at < 3600000 THEN fails + 1 ELSE 1 END, at = CASE WHEN ?2 - at < 3600000 THEN at ELSE ?2 END').bind(key, now).run();
  await db.prepare('INSERT INTO stats_feedback (site, at, kind, msg, contact, path, seen) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)').bind(site, now, kind, msg, clip(body.contact, 120).trim(), cleanPath(body.path)).run();
  await db.prepare('DELETE FROM stats_feedback WHERE id IN (SELECT id FROM stats_feedback ORDER BY at DESC LIMIT -1 OFFSET 500)').run();
  return { ok: true };
}

/* ------------------------------------------------------------------- reports */
async function summary(db) {
  const today = londonNow().day;
  const d7 = addDays(today, -6), d30 = addDays(today, -29), d14 = addDays(today, -13);
  const rows = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
  const [all, wToday, w7, w30, daily, back, new7, new30, r1, r7, installed, errs, fb] = await Promise.all([
    rows('SELECT site, SUM(n) AS visits, COUNT(DISTINCT vid) AS people, MIN(day) AS since FROM stats_days GROUP BY site'),
    rows('SELECT site, SUM(n) AS visits, COUNT(DISTINCT vid) AS people FROM stats_days WHERE day >= ? GROUP BY site', today),
    rows('SELECT site, SUM(n) AS visits, COUNT(DISTINCT vid) AS people FROM stats_days WHERE day >= ? GROUP BY site', d7),
    rows('SELECT site, SUM(n) AS visits, COUNT(DISTINCT vid) AS people FROM stats_days WHERE day >= ? GROUP BY site', d30),
    rows('SELECT site, day, SUM(n) AS visits, COUNT(*) AS people FROM stats_days WHERE day >= ? GROUP BY site, day', d14),
    rows('SELECT site, COUNT(*) AS c FROM (SELECT site, vid FROM stats_days GROUP BY site, vid HAVING COUNT(DISTINCT day) > 1) GROUP BY site'),
    rows('SELECT site, COUNT(*) AS c FROM stats_first WHERE first_day >= ? GROUP BY site', d7),
    rows('SELECT site, COUNT(*) AS c FROM stats_first WHERE first_day >= ? GROUP BY site', d30),
    rows("SELECT f.site AS site, COUNT(*) AS cohort, SUM(EXISTS (SELECT 1 FROM stats_days d WHERE d.site = f.site AND d.vid = f.vid AND d.day = date(f.first_day, '+1 day'))) AS back FROM stats_first f WHERE f.first_day <= ? GROUP BY f.site", addDays(today, -1)),
    rows("SELECT f.site AS site, COUNT(*) AS cohort, SUM(EXISTS (SELECT 1 FROM stats_days d WHERE d.site = f.site AND d.vid = f.vid AND d.day > f.first_day AND d.day <= date(f.first_day, '+7 days'))) AS back FROM stats_first f WHERE f.first_day <= ? GROUP BY f.site", addDays(today, -7)),
    rows('SELECT site, COUNT(*) AS c FROM stats_installed GROUP BY site'),
    rows('SELECT site, COUNT(*) AS c FROM stats_errors WHERE last_at > ? GROUP BY site', Date.now() - 7 * 864e5),
    rows('SELECT site, COUNT(*) AS c FROM stats_feedback WHERE seen = 0 GROUP BY site')
  ]);
  const by = (list, site) => list.find((r) => r.site === site) || {};
  const win = (list, site) => ({ visits: by(list, site).visits || 0, people: by(list, site).people || 0 });
  const sites = SITE_IDS.map((id) => {
    const series = [];
    for (let i = 13; i >= 0; i--) {
      const day = addDays(today, -i);
      const r = daily.find((x) => x.site === id && x.day === day);
      series.push({ day, visits: r ? r.visits : 0, people: r ? r.people : 0 });
    }
    return {
      id, since: by(all, id).since || null, visits: by(all, id).visits || 0, people: by(all, id).people || 0,
      cameBack: by(back, id).c || 0, today: win(wToday, id), days7: win(w7, id), days30: win(w30, id),
      new7: by(new7, id).c || 0, new30: by(new30, id).c || 0,
      day1: { cohort: by(r1, id).cohort || 0, back: by(r1, id).back || 0 },
      day7: { cohort: by(r7, id).cohort || 0, back: by(r7, id).back || 0 },
      fromHomeScreen: by(installed, id).c || 0,
      errors7: by(errs, id).c || 0, feedbackNew: by(fb, id).c || 0,
      daily: series
    };
  });
  return { today, sites };
}

async function detail(db, daysParam) {
  const days = [7, 30, 90].includes(Number(daysParam)) ? Number(daysParam) : 30;
  const from = addDays(londonNow().day, -(days - 1));
  const dims = (await db.prepare('SELECT site, kind, val, SUM(n) AS n FROM stats_dim WHERE day >= ? GROUP BY site, kind, val').bind(from).all()).results;
  const events = (await db.prepare('SELECT site, name, SUM(n) AS n, SUM(v) AS v FROM stats_events WHERE day >= ? GROUP BY site, name').bind(from).all()).results;
  const out = { days, sites: {} };
  const top = { page: 15, source: 12, country: 15, device: 5, os: 8, mode: 3 };
  for (const id of SITE_IDS) {
    const s = { page: [], source: [], country: [], device: [], os: [], mode: [], hour: Array(24).fill(0), dow: Array(7).fill(0), events: [] };
    for (const r of dims) {
      if (r.site !== id) continue;
      if (r.kind === 'hour') s.hour[parseInt(r.val, 10)] = r.n;
      else if (r.kind === 'dow') s.dow[parseInt(r.val, 10)] = r.n;
      else if (s[r.kind]) s[r.kind].push({ val: r.val, n: r.n });
    }
    for (const k of Object.keys(top)) s[k] = s[k].sort((a, b) => b.n - a.n).slice(0, top[k]);
    s.events = events.filter((e) => e.site === id).map((e) => ({ name: e.name, n: e.n, v: e.v }));
    out.sites[id] = s;
  }
  return out;
}

const SQL_COMMON = (site, token, extra) => `-- Counts-only function for the admin panel. Safe to run more than once.
-- Run it in: Supabase -> SQL Editor -> New query -> paste -> Run.
create or replace function public.admin_counts(p_token text)
returns json
language plpgsql
security definer
set search_path = public, auth
as $fn$
begin
  if p_token is null or p_token <> '${token}' then
    raise exception 'not allowed';
  end if;
  return json_build_object(
    'accounts', (select count(*) from auth.users),
    'active7',  (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'active30', (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days')${extra}
  );
end;
$fn$;

revoke all on function public.admin_counts(text) from public;
grant execute on function public.admin_counts(text) to anon, authenticated;
`;
const SQL_EXTRA = {
  revise: `,\n    'saves',    (select count(*) from public.revise_data)`,
  sharedlist: `,\n    'groups',   (select count(*) from public.groups),\n    'items',    (select count(*) from public.items),\n    'members',  (select count(*) from public.group_members)`,
  packsmart: `,\n    'lists',    (select count(*) from public.packing_lists)`
};

/* ---------------------------------------------------------- Lost Roads server */
async function lostRoads(env, action, args = {}) {
  const stub = env.DB.get(env.DB.idFromName('lost-roads'));
  const res = await stub.fetch(new Request('https://lost-roads/api/' + action, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-jt-admin': 'yes' }, body: JSON.stringify(args)
  }));
  return res.json();
}

async function accounts(env) {
  const out = {};
  try { out.roads2d = { ok: true, counts: await lostRoads(env, 'admin_counts') }; } catch { out.roads2d = { ok: false, reason: 'error' }; }
  const links = (await env.STATS.prepare('SELECT site, url, key, token FROM stats_links').all()).results;
  // Always available, needs no setup: signed-in people the apps have reported themselves
  const today = londonNow().day;
  const d7 = addDays(today, -6), d30 = addDays(today, -29);
  let seenRows = [];
  try {
    seenRows = (await env.STATS.prepare('SELECT site, COUNT(*) AS seen, SUM(last_day >= ?1) AS seen7, SUM(last_day >= ?2) AS seen30, MIN(first_day) AS since FROM stats_accts GROUP BY site').bind(d7, d30).all()).results;
  } catch { /* table not there yet: shown as zero */ }
  await Promise.all(['revise', 'sharedlist', 'packsmart'].map(async (id) => {
    const s = seenRows.find((x) => x.site === id) || {};
    const seen = { source: 'seen', counts: { seen: s.seen || 0, seen7: s.seen7 || 0, seen30: s.seen30 || 0 }, since: s.since || null };
    const l = links.find((x) => x.site === id);
    if (!l) { out[id] = { ok: true, ...seen, exact: 'not_set_up' }; return; }
    try {
      const headers = { apikey: l.key, 'content-type': 'application/json' };
      if (/^eyJ/.test(l.key)) headers.authorization = 'Bearer ' + l.key;
      const res = await fetch(`${l.url}/rest/v1/rpc/admin_counts`, { method: 'POST', headers, body: JSON.stringify({ p_token: l.token }), signal: AbortSignal.timeout(6000) });
      if (!res.ok) { out[id] = { ok: true, ...seen, exact: 'not_connected' }; return; }
      out[id] = { ok: true, source: 'exact', counts: await res.json(), since: seen.since };
    } catch { out[id] = { ok: true, ...seen, exact: 'unreachable' }; }
  }));
  return out;
}

/* -------------------------------------------------------------- the endpoint */
export async function handleStats(request, env) {
  const url = new URL(request.url);
  const action = url.pathname.replace(/^\/api\/stats\//, '');
  let originHost = '';
  try { originHost = new URL(request.headers.get('origin') || '').hostname; } catch { /* no origin */ }
  const site = SITE_HOSTS[originHost || url.hostname];
  const cors = originHost && site
    ? { 'access-control-allow-origin': request.headers.get('origin'), 'vary': 'Origin', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' }
    : {};
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'access-control-max-age': '86400' } });
  if (!site) return json({ error: 'origin' }, 403, {});
  if (!env.STATS) return json({ error: 'not_set_up' }, 503, cors);
  const db = env.STATS;
  const quiet = () => new Response(null, { status: 204, headers: cors });

  try {
    // Public: what should this site show (banner, maintenance message, feedback button)?
    if (action === 'config' && request.method === 'GET') {
      const cfg = await getConfig(db);
      const banner = cfg.banner.text && cfg.banner.sites.includes(site)
        ? { id: (await sha256Hex(cfg.banner.text + '|' + cfg.banner.style)).slice(0, 10), text: cfg.banner.text, style: cfg.banner.style } : null;
      const maintenance = cfg.maintenance.on && cfg.maintenance.sites.includes(site) ? { text: cfg.maintenance.text } : null;
      return new Response(JSON.stringify({ banner, maintenance, feedback: cfg.feedback.sites.includes(site) }), {
        status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60', ...cors }
      });
    }
    if (request.method !== 'POST') return json({ error: 'method' }, 405, cors);

    let body = {};
    try { body = JSON.parse(await request.text()); } catch { /* ignore */ }
    if (!body || typeof body !== 'object') body = {};

    // Public: things the apps report.
    if (action === 'hit') { await recordHit(db, site, body, request); return quiet(); }
    if (action === 'event') { await recordEvent(db, site, body, request); return quiet(); }
    if (action === 'acct') { await recordAcct(db, site, body, request); return quiet(); }
    if (action === 'error') { await recordError(db, site, body, request); return quiet(); }
    if (action === 'feedback') {
      const r = await recordFeedback(db, site, body, request);
      return json(r, r.error ? (r.error === 'too_many' ? 429 : 400) : 200, cors);
    }

    // Everything else needs the admin password. Wrong guesses are slowed down per visitor.
    const ADMIN = ['summary', 'detail', 'errors', 'errors_clear', 'feedback_list', 'feedback_seen', 'feedback_delete', 'config_get', 'config_set',
      'accounts', 'link_sql', 'players', 'player_rename', 'player_unscore', 'player_delete', 'blocked_get', 'blocked_set', 'password'];
    if (!ADMIN.includes(action)) return json({ error: 'unknown_action' }, 404, cors);

    const key = await sha256Hex('ip:' + (request.headers.get('cf-connecting-ip') || '?'));
    const now = Date.now();
    const tries = await db.prepare('SELECT fails, at FROM stats_tries WHERE k = ?').bind(key).first();
    const recent = tries && now - tries.at < 15 * 60000;
    if (recent && tries.fails >= 8) return json({ error: 'locked' }, 429, cors);
    const admin = await db.prepare('SELECT pass FROM stats_admin WHERE id = 1').first();
    let ok = false;
    if (admin && typeof body.password === 'string' && body.password.length <= 200) {
      const [salt] = admin.pass.split(':');
      ok = sameText(await hashPassword(body.password, salt), admin.pass);
    }
    if (!ok) {
      await db.prepare('INSERT INTO stats_tries (k, fails, at) VALUES (?1, 1, ?2) ON CONFLICT (k) DO UPDATE SET fails = CASE WHEN ?2 - at < 900000 THEN fails + 1 ELSE 1 END, at = ?2').bind(key, now).run();
      return json({ error: 'wrong_password' }, 401, cors);
    }
    if (tries) await db.prepare('DELETE FROM stats_tries WHERE k = ?').bind(key).run();

    switch (action) {
      case 'summary': return json(await summary(db), 200, cors);
      case 'detail': return json(await detail(db, body.days), 200, cors);
      case 'errors': return json({ rows: (await db.prepare('SELECT id, site, msg, src, line, path, first_at, last_at, n FROM stats_errors ORDER BY last_at DESC LIMIT 100').all()).results }, 200, cors);
      case 'errors_clear':
        if (body.id) await db.prepare('DELETE FROM stats_errors WHERE id = ?').bind(String(body.id)).run();
        else await db.prepare('DELETE FROM stats_errors').run();
        return json({ ok: true }, 200, cors);
      case 'feedback_list': return json({ rows: (await db.prepare('SELECT id, site, at, kind, msg, contact, path, seen FROM stats_feedback ORDER BY at DESC LIMIT 200').all()).results }, 200, cors);
      case 'feedback_seen':
        if (body.id) await db.prepare('UPDATE stats_feedback SET seen = 1 WHERE id = ?').bind(Number(body.id)).run();
        else await db.prepare('UPDATE stats_feedback SET seen = 1').run();
        return json({ ok: true }, 200, cors);
      case 'feedback_delete':
        await db.prepare('DELETE FROM stats_feedback WHERE id = ?').bind(Number(body.id)).run();
        return json({ ok: true }, 200, cors);
      case 'config_get': return json(await getConfig(db), 200, cors);
      case 'config_set': {
        const cfg = sanitizeConfig(body.config || {});
        await db.prepare("INSERT INTO stats_config (k, v) VALUES ('config', ?1) ON CONFLICT (k) DO UPDATE SET v = ?1").bind(JSON.stringify(cfg)).run();
        return json(cfg, 200, cors);
      }
      case 'accounts': return json(await accounts(env), 200, cors);
      case 'link_sql': {
        const links = (await db.prepare('SELECT site, token FROM stats_links').all()).results;
        const sql = {};
        for (const l of links) if (SQL_EXTRA[l.site] != null) sql[l.site] = SQL_COMMON(l.site, l.token, SQL_EXTRA[l.site]);
        return json({ sql }, 200, cors);
      }
      case 'players': case 'player_rename': case 'player_unscore': case 'player_delete': {
        const map = { players: ['admin_players', {}], player_rename: ['admin_rename', { id: Number(body.id), name: String(body.name || '') }],
          player_unscore: ['admin_unscore', { id: Number(body.id) }], player_delete: ['admin_delete', { id: Number(body.id) }] };
        const out = await lostRoads(env, map[action][0], map[action][1]);
        return json(out, out.error ? 400 : 200, cors);
      }
      case 'blocked_get': return json({ words: await getBlockedWords(db) }, 200, cors);
      case 'blocked_set': {
        const words = [...new Set((Array.isArray(body.words) ? body.words : []).map((w) => String(w).trim().toLowerCase().replace(/[^a-z0-9]/g, '')).filter((w) => w.length >= 2 && w.length <= 20))].slice(0, 200);
        await db.prepare("INSERT INTO stats_config (k, v) VALUES ('blocked_words', ?1) ON CONFLICT (k) DO UPDATE SET v = ?1").bind(JSON.stringify(words)).run();
        return json({ words }, 200, cors);
      }
      case 'password': {
        const next = String(body.newPassword || '');
        if (next.length < 8 || next.length > 100) return json({ error: 'short_password' }, 400, cors);
        await db.prepare('UPDATE stats_admin SET pass = ? WHERE id = 1').bind(await hashPassword(next)).run();
        return json({ ok: true }, 200, cors);
      }
    }
    return json({ error: 'unknown_action' }, 404, cors);
  } catch (e) {
    return json({ error: 'server_error' }, 500, cors);
  }
}
