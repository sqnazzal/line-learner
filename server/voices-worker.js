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
      const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      if (!token) return json({ error: 'Sign in to use the shared voices.' }, 401);
      let user;
      try { user = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID); } catch { return json({ error: 'Your sign-in has expired. Sign in again.' }, 401); }
      const isOwner = user.sub === env.OWNER_UID;
      if (!isOwner && !(await inOwnersGroup(user.sub, token, env))) {
        return json({ error: "The shared voices are for people in Shannon's groups. Ask her for an invite." }, 403);
      }

      const path = new URL(request.url).pathname.replace(/\/+$/, '');
      const month = new Date().toISOString().slice(0, 7);
      const limit = isOwner ? 0 : Number(env.USER_MONTHLY_USD ?? 2);
      const used = await getUsage(env, user.sub, month);

      if (path.endsWith('/status')) return json({ ok: true, owner: isOwner, used, limit });
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
        await addUsage(env, user.sub, month, (input.length + instructions.length / 4) * COST_PER_CHAR);
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
        await addUsage(env, user.sub, month, images.length * COST_PER_PAGE);
        return json({ text });
      }

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: 'The voices server had a problem. Try again in a moment.' }, 500);
    }
  },
};

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
async function addUsage(env, uid, month, usd) {
  if (!env.DB || !usd) return;
  await env.DB.prepare('INSERT INTO usage (uid, month, usd) VALUES (?, ?, ?) ON CONFLICT (uid, month) DO UPDATE SET usd = usd + excluded.usd')
    .bind(uid, month, usd).run();
}
