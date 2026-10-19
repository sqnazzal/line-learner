// Line Learner shared voices: a Cloudflare Worker that keeps Shannon's OpenAI key off everyone's phones.
//
// The app sends the signed-in person's Firebase sign-in token. This Worker checks it really came from
// Google for this Firebase project, checks the person is in one of Shannon's groups, keeps a rough monthly
// spend per person (if a D1 database is attached), and only then calls OpenAI with the key it holds.
//
// Settings (Cloudflare dashboard > the Worker > Settings > Variables and Secrets):
//   OPENAI_API_KEY      Secret. The OpenAI key (ideally from a separate project with its own budget).
//   OWNER_UID           Shannon's account ID (shown in the app on the Group screen).
//   FIREBASE_PROJECT_ID line-learner-45bd1
//   ALLOWED_ORIGIN      https://sqnazzal.github.io
//   USER_MONTHLY_USD    Optional. Each person's monthly allowance in dollars (default 2). The owner has none.
// Optional binding: a D1 database named DB, with this table (run once in the D1 console):
//   CREATE TABLE usage (uid TEXT, month TEXT, usd REAL, PRIMARY KEY (uid, month));
// Without DB there are no per-person allowances; the OpenAI project's budget still caps the total.
// For Admin > Reports to show spending by day and by kind (voices, page reading), also run once:
//   CREATE TABLE spend (day TEXT, uid TEXT, kind TEXT, n INTEGER, usd REAL, PRIMARY KEY (day, uid, kind));
//
// Optional, so Admin > Reports shows what OpenAI actually billed (not just the estimate):
//   OPENAI_ADMIN_KEY    Secret. An OpenAI Admin key (platform.openai.com > Settings > Organization > Admin keys,
//                       read-only is enough). It can see the organization's costs, so keep it only here.
//   OPENAI_PROJECT_ID   Optional. The project the voices key belongs to (proj_...), to leave out other projects.
//
// Optional, for an email when someone sends feedback (uses Resend, resend.com):
//   RESEND_API_KEY      Secret. An API key from resend.com (API Keys > Create, "Sending access").
//   FEEDBACK_EMAIL      The address you signed up to Resend with (its free test sender only mails that address).
//
// Needed for feedback emails, and so Admin > People lists everyone who has signed in with Google:
//   GOOGLE_SERVICE_ACCOUNT  Secret. The whole JSON key of a Google service account with only the
//                           "Firebase Authentication Viewer" and "Cloud Datastore Viewer" roles (see server/README.md).
//
// For rehearsal reminders (push notifications), also needs GOOGLE_SERVICE_ACCOUNT, plus:
//   VAPID_PUBLIC_KEY    The reminders key (the same as PUSH_KEY in plan.js).
//   VAPID_PRIVATE_KEY   Secret. Its private half.
//   A Cron Trigger (Settings > Trigger events > Cron): */5 * * * *

const TTS_MODEL = 'gpt-4o-mini-tts';
const VISION_MODEL = 'gpt-6-luna';
const VOICES = ['marin', 'cedar', 'coral', 'nova', 'shimmer', 'sage', 'alloy', 'ash', 'onyx', 'echo', 'verse', 'ballad'];
const COST_PER_CHAR = 15 / 1e6, COST_PER_PAGE = 0.002; // rough estimates, same as the app's
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      // Feedback alerts need no sign-in: the note is read from Firestore, so only real, new notes are emailed.
      if (new URL(request.url).pathname.replace(/\/+$/, '').endsWith('/notify-feedback') && request.method === 'POST') {
        const { id } = await request.json().catch(() => ({}));
        return json(await emailFeedback(String(id || ''), env));
      }

      const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      if (!token) return json({ error: 'Sign in to use the shared voices.' }, 401);
      let user;
      try { user = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID); } catch { return json({ error: 'Your sign-in has expired. Sign in again.' }, 401); }
      // Rehearsal reminders are for everyone signed in, not only Shannon's groups: a test one, sent right away.
      if (new URL(request.url).pathname.replace(/\/+$/, '').endsWith('/test-reminder') && request.method === 'POST') {
        return json(await testReminder(user.sub, env));
      }
      const isOwner = user.sub === env.OWNER_UID;
      if (!isOwner && !(await inOwnersGroup(user.sub, token, env))) {
        return json({ error: "The shared voices are for people in Shannon's groups. Ask Shannon for an invite." }, 403);
      }

      const path = new URL(request.url).pathname.replace(/\/+$/, '');
      const month = new Date().toISOString().slice(0, 7);
      const limit = isOwner ? 0 : Number(env.USER_MONTHLY_USD ?? 2);
      const used = await getUsage(env, user.sub, month);

      if (path.endsWith('/status')) return json({ ok: true, owner: isOwner, used, limit });

      // Admin (the owner only): everyone's use this month, and resetting someone's allowance.
      if (path.includes('/admin/')) {
        if (!isOwner) return json({ error: 'Only the admin can do that.' }, 403);
        if (path.endsWith('/admin/users')) return json(await signInAccounts(env));
        if (path.endsWith('/admin/report')) return json(await adminReport(env, Number(new URL(request.url).searchParams.get('days')) || 30));
        if (!env.DB) return json({ rows: [] });
        if (path.endsWith('/admin/usage')) {
          const { results = [] } = await env.DB.prepare('SELECT uid, usd FROM usage WHERE month = ?').bind(month).all();
          return json({ rows: results });
        }
        if (path.endsWith('/admin/reset') && request.method === 'POST') {
          const { uid } = await request.json();
          await env.DB.prepare('DELETE FROM usage WHERE uid = ? AND month = ?').bind(String(uid || ''), month).run();
          return json({ ok: true });
        }
        return json({ error: 'Not found' }, 404);
      }
      if (request.method !== 'POST') return json({ error: 'Not found' }, 404);
      if (limit > 0 && used >= limit) {
        return json({ error: `You've used this month's share of the voices (about $${limit}). It resets next month; ask Shannon if you need more.` }, 429);
      }
      const body = await request.json();

      if (path.endsWith('/speech')) {
        const input = String(body.input || ''), instructions = String(body.instructions || ''), voice = String(body.voice || '');
        if (!input || input.length > 4000 || instructions.length > 1500 || !VOICES.includes(voice)) return json({ error: 'That request looks wrong.' }, 400);
        const res = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: TTS_MODEL, voice, input, instructions, response_format: 'mp3' }),
        });
        if (!res.ok) return json({ error: `OpenAI couldn't make the voice (${res.status}).` }, res.status === 429 ? 503 : 502);
        await addUsage(env, user.sub, month, (input.length + instructions.length / 4) * COST_PER_CHAR, 'voice', input.length);
        return new Response(res.body, { headers: { ...cors, 'Content-Type': 'audio/mpeg' } });
      }

      if (path.endsWith('/read')) {
        const images = Array.isArray(body.images) ? body.images : [], prompt = String(body.prompt || '');
        if (!images.length || images.length > 6 || !prompt || prompt.length > 6000
          || images.some(u => typeof u !== 'string' || !u.startsWith('data:image/') || u.length > 8_000_000)) {
          return json({ error: 'That request looks wrong.' }, 400);
        }
        const res = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: VISION_MODEL, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...images.map(u => ({ type: 'input_image', image_url: u, detail: 'high' }))] }] }),
        });
        if (!res.ok) return json({ error: `OpenAI couldn't read the pages (${res.status}).` }, res.status === 429 ? 503 : 502);
        const data = await res.json();
        const text = data.output_text ?? (data.output || []).flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('');
        await addUsage(env, user.sub, month, images.length * COST_PER_PAGE, 'pages', images.length);
        return json({ text });
      }

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: 'The voices server had a problem. Try again in a moment.' }, 500);
    }
  },

  // The Cron Trigger (every 5 minutes) sends the rehearsal reminders that are due.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendReminders(event.scheduledTime, env));
  },
};

// ---------- Every Google sign-in account (for the admin's People list) ----------
// Uses a Google service account that can only view sign-in accounts (role "Firebase Authentication Viewer").
async function signInAccounts(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT) return { users: null, reason: 'not set up' };
  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT);
  const token = await googleAccessToken(sa);
  const users = [];
  let page = '';
  do {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:batchGet?maxResults=1000${page ? `&nextPageToken=${encodeURIComponent(page)}` : ''}`,
      { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { users: null, reason: `Google answered ${res.status}` };
    const data = await res.json();
    for (const u of data.users || []) {
      users.push({ uid: u.localId, email: u.email || '', name: u.displayName || '', created: Number(u.createdAt) || 0, lastSignIn: Number(u.lastLoginAt) || 0 });
    }
    page = data.nextPageToken || '';
  } while (page);
  return { users };
}

let saToken = { token: '', until: 0 };
async function googleAccessToken(sa) {
  if (saToken.token && Date.now() < saToken.until) return saToken.token;
  const now = Math.floor(Date.now() / 1000);
  const b64url = obj => btoa(JSON.stringify(obj)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  const jwt = `${unsigned}.${btoa(String.fromCharCode(...sig)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  const data = await res.json();
  saToken = { token: data.access_token, until: Date.now() + (data.expires_in - 120) * 1000 };
  return saToken.token;
}

// ---------- Checking the Firebase sign-in token (RS256, signed by Google) ----------
let jwksCache = { keys: null, until: 0 };
async function googleKeys() {
  if (jwksCache.keys && Date.now() < jwksCache.until) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  const maxAge = Number((res.headers.get('Cache-Control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  jwksCache = { keys: (await res.json()).keys, until: Date.now() + maxAge * 1000 };
  return jwksCache.keys;
}

const b64urlBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
const b64urlJson = s => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

async function verifyFirebaseToken(token, projectId) {
  const [h, p, sig] = token.split('.');
  const header = b64urlJson(h), payload = b64urlJson(p), now = Date.now() / 1000;
  if (header.alg !== 'RS256' || !payload.sub
    || payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`
    || payload.exp < now || payload.iat > now + 300) throw new Error('bad token');
  const jwk = (await googleKeys()).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('unknown key');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('bad signature');
  return payload;
}

// ---------- Is this person in one of Shannon's groups? ----------
// Asks Firestore as the person themselves (their token), so the group security rules apply.
const memberCache = new Map(); // uid -> { ok, until }
async function inOwnersGroup(uid, token, env) {
  const hit = memberCache.get(uid);
  if (hit && Date.now() < hit.until) return hit.ok;
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'groups' }],
      where: { fieldFilter: { field: { fieldPath: 'members' }, op: 'ARRAY_CONTAINS', value: { stringValue: uid } } },
    } }),
  });
  const rows = res.ok ? await res.json() : [];
  const ok = rows.some(r => r.document?.fields?.ownerUid?.stringValue === env.OWNER_UID);
  memberCache.set(uid, { ok, until: Date.now() + 10 * 60 * 1000 });
  return ok;
}

// ---------- Rough monthly spend per person (only with a D1 database bound as DB) ----------
async function getUsage(env, uid, month) {
  if (!env.DB) return 0;
  const row = await env.DB.prepare('SELECT usd FROM usage WHERE uid = ? AND month = ?').bind(uid, month).first();
  return row?.usd || 0;
}
async function addUsage(env, uid, month, usd, kind, n) {
  if (!env.DB || !usd) return;
  await env.DB.prepare('INSERT INTO usage (uid, month, usd) VALUES (?, ?, ?) ON CONFLICT (uid, month) DO UPDATE SET usd = usd + excluded.usd')
    .bind(uid, month, usd).run();
  // The daily detail for Admin > Reports, once the spend table exists (see the top of this file).
  await env.DB.prepare('INSERT INTO spend (day, uid, kind, n, usd) VALUES (?, ?, ?, ?, ?) ON CONFLICT (day, uid, kind) DO UPDATE SET n = n + excluded.n, usd = usd + excluded.usd')
    .bind(new Date().toISOString().slice(0, 10), uid, kind, n, usd).run().catch(() => {});
}

// ---------- Admin > Reports: spending over the last few days or months ----------
async function adminReport(env, days) {
  days = Math.min(Math.max(Math.round(days), 1), 400);
  const since = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);
  const out = { months: null, days: null, openai: await openaiCosts(env, days) };
  if (env.DB) {
    out.months = (await env.DB.prepare('SELECT uid, month, usd FROM usage WHERE month >= ?').bind(since.slice(0, 7)).all()).results || [];
    try { out.days = (await env.DB.prepare('SELECT day, uid, kind, n, usd FROM spend WHERE day >= ?').bind(since).all()).results || []; } catch { /* no spend table yet */ }
  }
  return out;
}

// What OpenAI actually billed, per day and line item (needs OPENAI_ADMIN_KEY).
async function openaiCosts(env, days) {
  if (!env.OPENAI_ADMIN_KEY) return { error: 'not set up' };
  const start = (Math.floor(Date.now() / 864e5) - days + 1) * 86400;
  const project = env.OPENAI_PROJECT_ID ? `&project_ids=${encodeURIComponent(env.OPENAI_PROJECT_ID)}` : '';
  const rows = [];
  let page = '', grouped = true;
  for (let pages = 0; pages < 10;) {
    const res = await fetch(`https://api.openai.com/v1/organization/costs?start_time=${start}&bucket_width=1d&limit=180${grouped ? '&group_by=line_item' : ''}${project}${page ? `&page=${encodeURIComponent(page)}` : ''}`,
      { headers: { Authorization: `Bearer ${env.OPENAI_ADMIN_KEY}` } });
    if (!res.ok) {
      if (grouped && !page) { grouped = false; continue; } // try once more without the line items
      return { error: `OpenAI answered ${res.status}` };
    }
    const data = await res.json();
    for (const b of data.data || []) {
      for (const r of b.results || []) rows.push({ day: new Date(b.start_time * 1000).toISOString().slice(0, 10), item: r.line_item || '', usd: Number(r.amount?.value) || 0 });
    }
    if (!data.has_more || !data.next_page) break;
    page = data.next_page;
    pages++;
  }
  return { rows };
}

// ---------- Email Shannon when someone sends feedback (only with RESEND_API_KEY and FEEDBACK_EMAIL) ----------
// The app sends just the new note's ID. The note is read from Firestore, and only notes from the last
// 10 minutes are emailed, so the email can't be faked or replayed later.
const emailed = new Set();
// Feedback notes are private (only the admin can read them in the app), so the Worker reads each one with its
// own Google service account, never as the public. At most EMAILS_PER_HOUR alerts go out, so a flood of
// notes can't flood the inbox (they still all appear in Admin).
const EMAILS_PER_HOUR = 20;
let emailWindow = { start: 0, count: 0 };
async function emailFeedback(id, env) {
  if (!env.RESEND_API_KEY || !env.FEEDBACK_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT) return { ok: false, reason: 'not set up' };
  if (!/^[A-Za-z0-9]{10,40}$/.test(id) || emailed.has(id)) return { ok: false };
  if (Date.now() - emailWindow.start > 3600_000) emailWindow = { start: Date.now(), count: 0 };
  if (emailWindow.count >= EMAILS_PER_HOUR) return { ok: false, reason: 'busy' };
  const token = await googleAccessToken(JSON.parse(env.GOOGLE_SERVICE_ACCOUNT));
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/feedback/${id}`,
    { headers: { Authorization: `Bearer ${token}` } });
  // The reasons say which part of the setup needs fixing (they never include the note or any key).
  if (!res.ok) return { ok: false, reason: `can't read the note (Google said ${res.status}; check the service account's Firestore role)` };
  const f = (await res.json()).fields || {};
  const str = k => f[k]?.stringValue || '';
  const at = Number(f.at?.integerValue ?? f.at?.doubleValue ?? 0);
  if (Date.now() - at > 10 * 60 * 1000) return { ok: false, reason: 'too old' };
  emailed.add(id);
  emailWindow.count++;

  const kind = { bug: 'Bug report', idea: 'Idea', privacy: 'Privacy request', copyright: 'Copyright concern', other: 'Feedback' }[str('kind')] || 'Feedback';
  const who = str('name') || str('contact') || 'someone (not signed in)';
  const contact = str('contact');
  const text = [
    `${kind} from ${who}${contact && contact !== who ? ` (${contact})` : ''}`,
    '',
    str('message'),
    '',
    str('details') ? `Device details:\n${str('details')}` : '',
    '',
    'See it (and delete it) in Line Learner > Group > Admin: https://sqnazzal.github.io/line-learner/',
  ].join('\n');
  const shot = str('screenshot').match(/^data:image\/(\w+);base64,(.+)$/);
  const mail = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Line Learner <onboarding@resend.dev>',
      to: [env.FEEDBACK_EMAIL],
      subject: `Line Learner: ${kind.toLowerCase()} from ${who}`,
      text,
      ...(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact) ? { reply_to: contact } : {}),
      ...(shot ? { attachments: [{ filename: `screenshot.${shot[1] === 'jpeg' ? 'jpg' : shot[1]}`, content: shot[2] }] } : {}),
    }),
  });
  if (!mail.ok) return { ok: false, reason: `Resend said ${mail.status}: ${(await mail.text()).slice(0, 300)}` };
  return { ok: true };
}

// ---------- Rehearsal reminders (push notifications) ----------
// The app keeps each upcoming reminder in Firestore (reminders/{uid}_{id}: when, title and text) and each
// device's push address in users/{uid}/meta/push. Every 5 minutes this reads the ones due in the next 5
// minutes (with GOOGLE_SERVICE_ACCOUNT) and sends each through the device's push service (Apple, Google,
// Mozilla or Microsoft), encrypted so only that device can read it (RFC 8291) and signed with the VAPID key.
// A push address that has expired just fails; the app saves a fresh one each time it opens.
const REMIND_EVERY = 5 * 60 * 1000;
const PUSH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//;
const firestoreBase = env => `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const pushReady = env => !!(env.GOOGLE_SERVICE_ACCOUNT && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

async function sendReminders(when, env) {
  if (!pushReady(env)) return { sent: 0, reason: 'not set up' };
  const token = await googleAccessToken(JSON.parse(env.GOOGLE_SERVICE_ACCOUNT));
  const at = (op, ms) => ({ fieldFilter: { field: { fieldPath: 'at' }, op, value: { integerValue: String(ms) } } });
  const res = await fetch(`${firestoreBase(env)}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'reminders' }],
      where: { compositeFilter: { op: 'AND', filters: [at('GREATER_THAN_OR_EQUAL', when), at('LESS_THAN', when + REMIND_EVERY)] } },
      limit: 500,
    } }),
  });
  if (!res.ok) return { sent: 0, reason: `Google said ${res.status}` };
  const subsOf = new Map();
  let sent = 0;
  for (const { document: d } of await res.json()) {
    const f = d?.fields || {}, uid = f.uid?.stringValue;
    if (!uid) continue;
    if (!subsOf.has(uid)) subsOf.set(uid, await pushSubs(uid, token, env));
    const msg = { title: f.title?.stringValue || 'Time to rehearse', body: f.body?.stringValue || '', url: f.url?.stringValue || '', tag: d.name.split('/').pop() };
    for (const sub of subsOf.get(uid)) if (await sendPush(sub, msg, env).catch(() => false)) sent++;
  }
  return { sent };
}

// "Send a test reminder" in the app: one notification to each of this person's devices, right away.
const lastTest = new Map();
async function testReminder(uid, env) {
  if (!pushReady(env)) return { ok: false, reason: 'Reminders aren\'t set up on the server yet.' };
  if (Date.now() - (lastTest.get(uid) || 0) < 20000) return { ok: false, reason: 'Just sent one. Give it a moment.' };
  lastTest.set(uid, Date.now());
  const subs = await pushSubs(uid, await googleAccessToken(JSON.parse(env.GOOGLE_SERVICE_ACCOUNT)), env);
  let sent = 0;
  for (const sub of subs) if (await sendPush(sub, { title: 'Line Learner reminders are on', body: 'This is how your rehearsal reminders will look.', tag: 'test' }, env).catch(() => false)) sent++;
  return { ok: sent > 0, sent, devices: subs.length };
}

async function pushSubs(uid, token, env) {
  const res = await fetch(`${firestoreBase(env)}/users/${encodeURIComponent(uid)}/meta/push`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const subs = (await res.json()).fields?.subs?.mapValue?.fields || {};
  return Object.values(subs).map(v => v.mapValue?.fields || {})
    .map(f => ({ endpoint: f.endpoint?.stringValue || '', p256dh: f.p256dh?.stringValue || '', auth: f.auth?.stringValue || '' }))
    .filter(s => PUSH_HOSTS.test(s.endpoint) && s.p256dh && s.auth);
}

async function sendPush(sub, msg, env) {
  const body = await encryptPush(new TextEncoder().encode(JSON.stringify(msg)), b64urlBytes(sub.p256dh), b64urlBytes(sub.auth));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidAuth(sub.endpoint, env), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'high' },
    body,
  });
  return res.ok;
}

const bytesB64url = u8 => btoa(String.fromCharCode(...u8)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const joinBytes = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

// The VAPID header: proves to the push service that the reminder comes from this app's server.
async function vapidAuth(endpoint, env) {
  const now = Math.floor(Date.now() / 1000), enc = obj => bytesB64url(new TextEncoder().encode(JSON.stringify(obj)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: new URL(endpoint).origin, exp: now + 12 * 3600, sub: 'https://sqnazzal.github.io/line-learner/' })}`;
  const pub = b64urlBytes(env.VAPID_PUBLIC_KEY);
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY, x: bytesB64url(pub.slice(1, 33)), y: bytesB64url(pub.slice(33, 65)) },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned)));
  return `vapid t=${unsigned}.${bytesB64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// Web Push message encryption (aes128gcm, RFC 8291). `fixed` (keys and salt) is only for checking against the RFC's example.
async function encryptPush(plain, uaPublic, authSecret, fixed = {}) {
  const te = new TextEncoder();
  const asKeys = fixed.keys || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256);
  const hkdf = async (salt, ikm, info, bytes) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info },
    await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), bytes * 8));
  const ikm = await hkdf(authSecret, ecdh, joinBytes(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = fixed.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, joinBytes(plain, new Uint8Array([2]))));
  const header = new Uint8Array(21); // salt, record size 4096, key length 65
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  return joinBytes(header, asPublic, sealed);
}
