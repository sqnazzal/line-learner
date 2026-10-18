'use strict';

// Line Learner: hear your scenes, then run them out loud with a scene partner that never gets tired.

// ---------- Helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const titleCase = s => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  toast.at = Date.now();
  clearTimeout(toast.timer);
  toast.timer = setTimeout(hideToast, Math.min(12000, 3500 + Math.max(0, msg.length - 70) * 45));
}
// Clears the message too, so an old error isn't left for screen readers (or shown) on another page.
function hideToast() {
  const el = $('#toast');
  clearTimeout(toast.timer);
  el.classList.remove('show');
  setTimeout(() => { if (!el.classList.contains('show')) el.textContent = ''; }, 400);
}
$('#toast')?.addEventListener('click', hideToast);

// The last few unexpected errors, so a bug report can include them. An error in the app's own code also
// gets a friendly note (at most once a minute) pointing to Send feedback.
const recentErrors = [];
function noteError(text) {
  recentErrors.push(`${new Date().toLocaleTimeString()} ${typeof app === 'undefined' ? '' : app.view}: ${String(text).slice(0, 300)}`);
  if (recentErrors.length > 8) recentErrors.shift();
}
addEventListener('error', e => {
  noteError(`${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`);
  if (!e.filename?.startsWith(location.origin) || Date.now() - (noteError.shown || 0) < 60000) return;
  noteError.shown = Date.now();
  toast("Something flubbed a line (that's on us). Try that again, and if it keeps happening, tap Send feedback at the bottom.");
});
addEventListener('unhandledrejection', e => noteError(e.reason?.stack?.split('\n')[0] || e.reason?.message || e.reason));

// ---------- Storage ----------
const LS_SCRIPTS = 'lineLearner.scripts';
const LS_SETTINGS = 'lineLearner.settings';
const DEFAULT_SETTINGS = {
  rate: 1,
  myLines: 'gapThenSpeak', // Listen mode: gapThenSpeak | gap | speak | skip
  hint: 'first',           // Rehearse mode: hidden | first | initials | full
  cueLength: 'full',       // full | last
  passScore: 80,
  silenceMs: 1600,
  readDirections: false,
  useRecordings: true,
  loop: false,
  skipCuts: false,         // reading pages: leave out printed lines crossed out by hand
  listenHears: true,       // Listen mode: hear you say your line and move on when you finish
  textSize: 'normal',      // normal | large | huge (bigger words for a phone on a stand)
  typeCues: 'show',        // Type mode: show (silent) | speak (headphones)
  shortcuts: true,         // single-key shortcuts in the player (Space, arrows, H, L, Enter); can be turned off
};

function loadJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { toast(`Out of room backstage: couldn't save (${e.message}). Download a backup on the Sync screen, then delete saved tracks or scripts you're done with.`); }
}

let scripts = loadJSON(LS_SCRIPTS, []);
const settings = { ...DEFAULT_SETTINGS, ...loadJSON(LS_SETTINGS, {}) };
const saveScripts = () => { saveJSON(LS_SCRIPTS, scripts); scheduleSync(); };
const saveSettings = () => saveJSON(LS_SETTINGS, settings);
const applyTextSize = () => { document.documentElement.dataset.textSize = settings.textSize; };
applyTextSize();

// Where you stopped in each script's Listen or Rehearse run, so a long scene can pick up from there.
const LS_RESUME = 'lineLearner.resume';
const resumeAt = loadJSON(LS_RESUME, {});
// Your last run (script, mode, cues only), for the "Continue" shortcut on the home screen.
const LS_LAST = 'lineLearner.lastRun';
let lastRun = loadJSON(LS_LAST, null);

// Recordings live in IndexedDB, keyed by a hash of speaker + line text so they survive script edits.
// AI-generated line audio is cached there too ('tts'), so each line is only paid for once.
let dbPromise;
function openDb() {
  return dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('line-learner', 3);
    req.onupgradeneeded = () => {
      for (const name of ['recordings', 'tts', 'tracks']) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idb(mode, fn, store = 'recordings') {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}
const recordings = {
  get: key => idb('readonly', st => st.get(key)),
  put: (key, blob) => idb('readwrite', st => st.put(blob, key)),
  del: key => idb('readwrite', st => st.delete(key)),
  keys: () => idb('readonly', st => st.getAllKeys()),
};
const ttsCache = {
  get: key => idb('readonly', st => st.get(key), 'tts'),
  put: (key, blob) => idb('readwrite', st => st.put(blob, key), 'tts'),
};
// Screen-off tracks you've made, kept on this device: { id, scriptId, label, blob, minutes, sections, sig, created }.
const savedTracks = {
  all: () => idb('readonly', st => st.getAll(), 'tracks'),
  put: t => idb('readwrite', st => st.put(t, t.id), 'tracks'),
  del: id => idb('readwrite', st => st.delete(id), 'tracks'),
};
let recorded = new Set();

// ---------- Parsing ----------
// Accepts "NAME: line", "NAME. line", screenplay style (NAME alone in caps, speech below),
// (stage directions) in brackets, and "# Scene" / "Act 1" / "Scene 2" section headings.
// Text with no character names at all is treated as a monologue: one line per paragraph.
const SECTION_RE = /^(act|scene)\s+([ivxlc]+|\d+|one|two|three|four|five|six)\b|^(prologue|epilogue)\b\W*$|^(int|ext|int\/ext|i\/e)[.\s]/i;

const spokenText = s => s.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
const cleanName = n => n.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

function isNameLike(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length <= 4 && parts.every(p => /^[\p{Lu}\p{N}]/u.test(p)) && !SECTION_RE.test(name);
}

function parseScript(raw) {
  const out = [];
  let cur = null;
  for (const rawLine of raw.replace(/\r/g, '').split('\n')) {
    const t = rawLine.trim();
    if (!t) { if (cur && cur.text) cur = null; continue; }
    let m;
    if ((m = t.match(/^#+\s*(.+)$/)) || (SECTION_RE.test(t) && t.length <= 80)) {
      out.push({ type: 'section', text: m ? m[1].trim() : t });
      cur = null;
      continue;
    }
    if (/^[([].*[)\]]$/.test(t)) {
      if (cur) cur.text += (cur.text ? ' ' : '') + t;
      else out.push({ type: 'direction', text: t.slice(1, -1).trim() });
      continue;
    }
    if ((m = t.match(/^([^:()]{1,40}?)\s*(\([^)]*\))?\s*:\s*(.*)$/)) && isNameLike(m[1])) {
      cur = { type: 'line', speaker: cleanName(m[1]), text: [m[2], m[3]].filter(Boolean).join(' ').trim() };
      out.push(cur);
      continue;
    }
    if ((m = t.match(/^([\p{Lu}][\p{Lu}\p{N}'&\- ]{1,30})\.\s+(.+)$/u)) && isNameLike(m[1])) {
      cur = { type: 'line', speaker: cleanName(m[1]), text: m[2] };
      out.push(cur);
      continue;
    }
    if (/^[\p{Lu}][\p{Lu}\p{N}'&\-. ]{1,30}(\s*\([^)]*\))?$/u.test(t) && !/\.$/.test(t) && isNameLike(cleanName(t))) {
      cur = { type: 'line', speaker: cleanName(t), text: '' };
      out.push(cur);
      continue;
    }
    if (cur) { cur.text += (cur.text ? ' ' : '') + t; continue; }
    out.push({ type: 'direction', text: t });
  }
  const items = out.filter(x => x.type !== 'line' || spokenText(x.text));
  return items.some(x => x.type === 'line') ? items : parseMonologue(raw);
}

function parseMonologue(raw) {
  return raw.replace(/\r/g, '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean).map(b => {
    const m = b.match(/^#+\s*(.+)$/);
    if (m && !b.includes('\n')) return { type: 'section', text: m[1] };
    return { type: 'line', speaker: 'YOU', text: b.replace(/\s*\n\s*/g, ' ') };
  }).filter(x => x.type !== 'line' || spokenText(x.text));
}

function sentences(text) {
  return (text.match(/[^.!?;]+(?:[.!?;]+["'’”)]*|$)/g) || []).map(p => p.trim()).filter(Boolean);
}

// Splits a speech into bite-sized pieces for Build-up mode, folding tiny fragments into neighbours.
function buildParts(text) {
  const parts = [];
  for (const sentence of sentences(spokenText(text))) {
    const last = parts[parts.length - 1];
    if (last && (last.split(' ').length < 4 || sentence.split(' ').length < 3)) parts[parts.length - 1] = last + ' ' + sentence;
    else parts.push(sentence);
  }
  return parts;
}

const fmt = s => esc(s).replace(/(\([^)]*\)|\[[^\]]*\])/g, '<em class="dir">$1</em>');

// ---------- Scoring ----------
const NUMS = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' ');
// Words speech recognition commonly swaps; mapped to one spelling so they still count as correct.
const SOUNDALIKE = {
  their: 'there', theyre: 'there', youre: 'your', too: 'to', two: 'to', hear: 'here', know: 'no',
  write: 'right', okay: 'ok', oh: 'o', ay: 'i', aye: 'i', eye: 'i', whose: 'whos', yeah: 'yes',
};
// Run-together ways of saying two words; spelled out so "wanna" passes for "want to" (and the other way round).
const RUN_TOGETHER = {
  dammit: 'damn it', wanna: 'want to', gonna: 'going to', gotta: 'got to', hafta: 'have to', kinda: 'kind of',
  sorta: 'sort of', outta: 'out of', lotta: 'lot of', lemme: 'let me', gimme: 'give me', dunno: 'dont know',
  gotcha: 'got you', betcha: 'bet you', whaddya: 'what do you', cmon: 'come on', yall: 'you all',
  alright: 'all right', cannot: 'can not', oughta: 'ought to', shoulda: 'should have', coulda: 'could have',
  woulda: 'would have', musta: 'must have', aint: 'is not',
};

function words(s) {
  return spokenText(s).toLowerCase()
    .replace(/['‘’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ').filter(Boolean)
    .map(w => (/^\d+$/.test(w) && +w <= 20 ? NUMS[+w] : w))
    .flatMap(w => (RUN_TOGETHER[w] ? RUN_TOGETHER[w].split(' ') : [w]))
    .map(w => SOUNDALIKE[w] || w);
}

// A rough "how it sounds" spelling, so Dotty and Dottie, Jon and John, or till and 'til count as the same word.
function soundKey(w) {
  return w
    .replace(/ph/g, 'f').replace(/ck|q/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
    .replace(/^wr/, 'r').replace(/^kn/, 'n').replace(/(?!^)h(?![aeiou])/g, '')
    .replace(/(ie|ey|ee|y)(s?)$/, 'i$2')
    .replace(/(.)\1+/g, '$1');
}

// True when two words are the same, sound the same, or are one letter apart (forgives small recognition slips).
function near(a, b) {
  if (a === b) return true;
  if (a.length > 2 && b.length > 2 && soundKey(a) === soundKey(b)) return true;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// Recognition sometimes splits an old or unusual word ("wherefore" heard as "where for"); glue those back.
function joinSplitWords(said, expected) {
  const out = [];
  for (let j = 0; j < said.length; j++) {
    const joined = said[j] + said[j + 1];
    if (j + 1 < said.length && !expected.has(said[j]) && [...expected].some(w => near(w, joined))) { out.push(joined); j++; }
    else out.push(said[j]);
  }
  return out;
}

// Aligns what was said against the script (longest common subsequence) and marks each scripted word.
function compare(expected, said) {
  const a = words(expected), b = joinSplitWords(words(said), new Set(a));
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = near(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hit = new Array(n).fill(false);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (near(a[i], b[j])) { hit[i++] = true; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const score = n ? Math.round(100 * hit.filter(Boolean).length / n) : 100;
  return { score, hit };
}

function diffHtml(text, cmp) {
  let wi = 0;
  return spokenText(text).split(' ').filter(Boolean).map(tok => {
    const n = words(tok).length;
    const ok = cmp.hit.slice(wi, wi + n).every(Boolean);
    wi += n;
    return `<span class="${n === 0 ? '' : ok ? 'hit' : 'miss'}">${esc(tok)}</span>`;
  }).join(' ');
}

const REVEAL = ['hidden', 'first', 'initials', 'full'];
const blank = w => `<span class="blank" role="img" aria-label="blank" style="width:${(Math.min(w.length, 12) * 0.5 + 0.5).toFixed(1)}em"></span>`;
function hintHtml(text, level) {
  const toks = spokenText(text).split(' ').filter(Boolean);
  if (level === 'full') return fmt(text);
  if (level === 'first') {
    const n = clamp(Math.floor(toks.length / 2), 1, 3);
    return [esc(toks.slice(0, n).join(' ')), ...toks.slice(n).map(blank)].join(' ');
  }
  if (level === 'initials') return toks.map(w => esc(w.replace(/^([^\p{L}\p{N}]*[\p{L}\p{N}])[\p{L}\p{N}'’-]*/u, '$1'))).join(' ');
  return toks.map(blank).join(' ');
}

// ---------- Cancellation ----------
function makeToken() {
  const subs = new Set();
  return {
    cancelled: false,
    onCancel(fn) {
      if (this.cancelled) { fn(); return () => {}; }
      subs.add(fn);
      return () => subs.delete(fn);
    },
    cancel() {
      if (this.cancelled) return;
      this.cancelled = true;
      [...subs].forEach(fn => fn());
      subs.clear();
    },
  };
}

function sleep(ms, token) {
  return new Promise(resolve => {
    let off = () => {};
    const t = setTimeout(() => { off(); resolve(); }, ms);
    off = token.onCancel(() => { clearTimeout(t); resolve(); });
  });
}

// ---------- Speaking ----------
const synth = window.speechSynthesis;
const liveUtterances = new Set(); // keeps utterances referenced so Chrome reliably fires their end events

// Browsers don't say whether a voice is female or male, so we recognise the common American voices
// on Windows/Edge, Chrome, iPhone and Mac by name.
const wordSet = s => new Set(s.split(/\s+/));
const FEMALE_VOICES = wordSet('aria jenny michelle ana ava emma zira susan samantha victoria allison zoe nicky joelle noelle kathy flo grandma sandy shelley ashley cora elizabeth jane monica nancy sara amber kendra kimberly salli joanna ivy karen moira tessa fiona serena female');
const MALE_VOICES = wordSet('guy christopher eric roger steffan andrew brian david mark alex fred tom aaron evan nathan junior ralph eddy grandpa reed rocko daniel davis jason tony justin joey matthew male');
// Apple's novelty voices (sound effects and singing) are no good for reading a script.
const NOVELTY_VOICES = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|deranged|hysterical)\b/i;
const FUN_VOICES = /\b(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|junior|ralph|kathy|fred)\b/i;

function voiceGender(v) {
  const n = v.name.toLowerCase().replace(/multilingual/g, ' ');
  if (/google us english/.test(n)) return 'f';
  for (const w of n.split(/[^a-z]+/)) {
    if (FEMALE_VOICES.has(w)) return 'f';
    if (MALE_VOICES.has(w)) return 'm';
  }
  return '';
}

const voiceLabel = v => v.name.replace(/^(Microsoft|Google|Apple)\s+/, '').replace(/Multilingual/, '').replace(/\s+Online/, '').replace(/\s*-\s*English.*$/, '').trim();

// American English voices first (then other English, then anything), most natural-sounding first.
function voiceList() {
  if (!synth) return [];
  const all = synth.getVoices().filter(v => !NOVELTY_VOICES.test(v.name));
  const lang = v => v.lang.replace('_', '-').toLowerCase();
  const us = all.filter(v => lang(v) === 'en-us');
  const en = all.filter(v => lang(v).startsWith('en'));
  const rank = v => (/natural|neural|online|enhanced|premium|siri/i.test(v.name) ? 0 : FUN_VOICES.test(v.name) ? 2 : 1);
  return (us.length ? us : en.length ? en : all).slice().sort((a, b) => rank(a) - rank(b));
}

const FEMALE_WORDS = wordSet('lady queen mother mom mum mama nurse woman girl wife sister daughter aunt grandma grandmother granny mrs ms miss madam madame duchess princess countess witch maid maiden nun abbess actress hostess waitress mistress widow bride gentlewoman niece empress goddess');
const MALE_WORDS = wordSet('lord king father dad papa man boy husband brother son uncle grandpa grandfather mr sir duke prince count earl baron friar priest monk gentleman knight emperor waiter actor nephew groom bishop cardinal master');
const FEMALE_NAMES = wordSet('mary patricia jennifer linda elizabeth barbara susan jessica sarah karen lisa nancy betty margaret sandra ashley kimberly emily donna michelle carol amanda dorothy melissa deborah stephanie rebecca sharon laura cynthia kathleen amy angela shirley anna brenda pamela emma nicole helen samantha katherine christine debra rachel carolyn janet catherine maria heather diane ruth julie olivia joyce virginia victoria kelly lauren christina joan evelyn judith megan andrea cheryl hannah jacqueline martha gloria teresa ann sara madison frances kathryn janice jean abigail alice judy sophia grace denise amber doris marilyn danielle beverly isabella theresa diana natalie brittany charlotte marie kayla alexis lori ava mia ella chloe zoe lily sophie lucy annie jane kate katie molly maggie sally blanche stella eliza elle wendy belle ariel jasmine cinderella glinda elphaba nessarose fiona tracy penny velma roxie maureen mimi joanne nina vanessa eponine cosette fantine meg carlotta anita rosalia juliet ophelia gertrude portia rosalind celia viola beatrice hero hermia helena titania hippolyta desdemona emilia bianca cordelia goneril regan miranda katherina cressida cleopatra imogen perdita hermione paulina lavinia tamora mariana nerissa audrey phebe calpurnia lysistrata medea antigone ismene electra nora hedda masha irina olga natasha arkadina sonya yelena dolly mame sarah adelaide golde tzeitel hodel chava yente');
const MALE_NAMES = wordSet('james robert john michael david william richard joseph thomas charles christopher daniel matthew anthony mark donald steven paul andrew joshua kenneth kevin brian george timothy ronald edward jason jeffrey ryan jacob gary nicholas eric jonathan stephen larry justin scott brandon benjamin samuel gregory alexander frank patrick raymond jack dennis jerry tyler aaron jose adam nathan henry douglas zachary peter kyle noah ethan jeremy walter christian keith roger terry austin sean gerald carl harold dylan arthur lawrence jordan jesse bryan billy bruce gabriel joe logan albert willie alan eugene russell vincent philip bobby johnny bradley roy ralph louis harry fred tom tim mike jim bob bill sam max ben jake luke leo oliver lucas mason liam owen eli alex danny tony stanley willy biff happy marius javert valjean enjolras raoul kenickie sky nicely tevye motel perchik seymour hamlet romeo mercutio tybalt benvolio capulet montague paris balthasar sampson claudius polonius laertes horatio fortinbras rosencrantz guildenstern macbeth banquo macduff duncan malcolm fleance lennox ross othello iago cassio roderigo brabantio lear edmund edgar gloucester kent albany cornwall prospero caliban ferdinand antonio sebastian gonzalo alonso stephano trinculo petruchio lucentio baptista grumio tranio orsino malvolio toby feste benedick claudio pedro dogberry leonato oberon lysander demetrius theseus egeus bottom quince flute snout snug starveling shylock bassanio gratiano lorenzo launcelot orlando jaques touchstone frederick brutus cassius caesar antony octavius casca hal falstaff hotspur bardolph pistol poins coriolanus timon titus pericles leontes polixenes florizel posthumus cymbeline oedipus creon agamemnon orestes vladimir estragon pozzo lucky mitch hickey treplev trigorin vanya astrov tuzenbach vershinin puck');

// 'f', 'm', or '' when the name gives no clue.
function guessGender(speaker) {
  const parts = speaker.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  for (const w of parts) {
    if (FEMALE_WORDS.has(w) || FEMALE_NAMES.has(w)) return 'f';
    if (MALE_WORDS.has(w) || MALE_NAMES.has(w)) return 'm';
  }
  return '';
}

// Each character's gender (your choice, else a guess from the name; unclear names alternate) and the
// voice picked for them automatically, spreading different voices across characters of the same gender.
function castVoices(s) {
  const list = voiceList();
  const pools = { f: list.filter(v => voiceGender(v) === 'f'), m: list.filter(v => voiceGender(v) === 'm') };
  const used = { f: 0, m: 0 };
  let unclear = 0;
  const cast = new Map();
  for (const speaker of characters(s).keys()) {
    const gender = s.genders?.[speaker] || guessGender(speaker) || (unclear++ % 2 ? 'm' : 'f');
    const pool = pools[gender].length ? pools[gender] : list;
    cast.set(speaker, { gender, voice: pool.length ? pool[used[gender]++ % pool.length] : null });
  }
  return cast;
}

function voiceFor(speaker) {
  const s = current();
  const chosen = s?.voices?.[speaker];
  if (chosen && synth) {
    const v = synth.getVoices().find(x => x.voiceURI === chosen);
    if (v) return v;
  }
  return (s && castVoices(s).get(speaker)?.voice) || voiceList()[0] || null;
}

function speakChunk(text, voice, token, rate) {
  return new Promise(resolve => {
    if (token.cancelled || !synth || !text) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) { u.voice = voice; u.lang = voice.lang; }
    u.rate = rate;
    let settled = false, off = () => {}, guard = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      liveUtterances.delete(u);
      off();
      resolve();
    };
    off = token.onCancel(() => { synth.cancel(); finish(); });
    guard = setTimeout(finish, 4000 + text.split(/\s+/).length * 700 / rate);
    u.onend = u.onerror = finish;
    liveUtterances.add(u);
    synth.speak(u);
  });
}

// Long utterances can stall in some browsers, so speak a sentence or two at a time.
function chunksOf(text, max = 180) {
  const out = [];
  let buf = '';
  for (const s of sentences(text)) {
    if (buf && (buf + ' ' + s).length > max) { out.push(buf); buf = s; }
    else buf = buf ? buf + ' ' + s : s;
  }
  if (buf) out.push(buf);
  return out;
}

async function speakText(text, voice, token, rate = settings.rate) {
  for (const chunk of chunksOf(spokenText(text))) {
    if (token.cancelled) return;
    await speakChunk(chunk, voice, token, rate);
  }
}

// iPhones only allow sound that starts from a tap. The first tap unlocks speech, chimes and one shared
// audio element, which every recording then plays through.
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const sharedAudio = new Audio();
let audioUnlocked = false, stopSharedAudio = null;

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth?.speak(u);
  } catch { /* no speech engine */ }
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
  } catch { /* no Web Audio */ }
  sharedAudio.src = SILENT_WAV;
  sharedAudio.play().catch(() => {});
}

function playBlob(blob, token, rate = 1) {
  stopSharedAudio?.();
  return new Promise(resolve => {
    if (token.cancelled) return resolve();
    const url = URL.createObjectURL(blob);
    const audio = sharedAudio;
    let settled = false, off = () => {}, guard = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      audio.pause();
      audio.onended = audio.onerror = audio.onloadedmetadata = null;
      URL.revokeObjectURL(url);
      if (stopSharedAudio === finish) stopSharedAudio = null;
      off();
      resolve();
    };
    stopSharedAudio = finish;
    off = token.onCancel(finish);
    audio.onended = audio.onerror = finish;
    // Never wait forever on audio that won't finish: allow its length plus a margin.
    guard = setTimeout(finish, 15000);
    audio.onloadedmetadata = () => {
      if (!isFinite(audio.duration)) return;
      clearTimeout(guard);
      guard = setTimeout(finish, (audio.duration / rate) * 1000 + 3000);
    };
    audio.src = url;
    audio.playbackRate = rate;
    audio.play().catch(finish);
  });
}

// Keeps the screen on while a scene is playing; a locked phone stops speaking.
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && P.running) keepAwake(true);
});

// Plays your own recording of a line if there is one, otherwise the computer voice for that character.
async function sayLine(item, token, text = item.text) {
  const key = lineKey(item);
  if (settings.useRecordings && recorded.has(key)) {
    const blob = await recordings.get(key).catch(() => null);
    if (blob) return playBlob(blob, token, speedOf(item.speaker));
  }
  return speakAs(item.speaker, text, token);
}

// Each character's speed slider scales the overall reading speed (1 = same as everyone else).
const speedOf = speaker => current()?.speeds?.[speaker] ?? 1;

// Speaks a character's line with their natural AI voice when that's set up, otherwise the device voice.
async function speakAs(speaker, text, token) {
  const s = current();
  const rate = settings.rate * speedOf(speaker);
  if (s && aiReady()) {
    try {
      const voice = aiVoiceFor(s, speaker), instructions = aiInstructions(s, speaker, text);
      for (const piece of chunksOf(spokenText(text), 3000)) {
        if (token.cancelled) return;
        const blob = await aiAudio(voice, instructions, piece);
        if (token.cancelled) return;
        await playBlob(blob, token, rate);
      }
      return;
    } catch (e) {
      aiFailed(e);
    }
  }
  return speakText(text, voiceFor(speaker), token, rate);
}

// ---------- Natural AI voices (OpenAI text to speech) ----------
const LS_AI = 'lineLearner.ai';
const AI_MODEL = 'gpt-4o-mini-tts';
const AI_VOICES = { f: ['marin', 'coral', 'nova', 'shimmer', 'sage', 'alloy'], m: ['cedar', 'ash', 'onyx', 'echo', 'verse', 'ballad'] };
const AI_ALL = [...AI_VOICES.f, ...AI_VOICES.m];
const ai = loadJSON(LS_AI, {}); // { key, on } : the key stays on this device and never syncs
const aiInflight = new Map();
let aiWarned = false;

// Shannon's shared voices: a small server (server/voices-worker.js on Cloudflare) holds Shannon's OpenAI key, and
// people in Shannon's groups use it by signing in, with no key of their own. Empty until the server is set up.
const SHARED_VOICES_URL = 'https://line-learner-voices.sqnazzal.workers.dev';
const usingShared = () => !ai.key && !!ai.shared && !!SHARED_VOICES_URL && !!signedInUser();
// The Google sign-in (from groups.js, loaded after this file; its "fb" isn't a property of window).
const signedInUser = () => (typeof fb !== 'undefined' ? fb.user : null);
const aiReady = () => !!(ai.on && (ai.key || usingShared()));
const aiAvailable = () => !!(ai.key || usingShared()); // for reading pages, whether or not voices are on

async function sharedFetch(path, body) {
  const token = await fb.api.auth.currentUser.getIdToken();
  const res = await fetch(SHARED_VOICES_URL.replace(/\/+$/, '') + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).error || ''; } catch { /* no details */ }
    const err = new Error(msg || `The shared voices server answered with an error (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return res;
}

// This month's use of the shared voices, from the server (used and limit in dollars).
const shared = { status: null, loading: false };
async function loadSharedStatus() {
  if (shared.loading || !usingShared()) return;
  shared.loading = true;
  try { shared.status = await (await sharedFetch('/status')).json(); } catch (e) { shared.status = { error: e.message }; }
  shared.loading = false;
  const el = $('#shared-status');
  if (el) el.textContent = sharedStatusText();
}
function sharedStatusText() {
  const st = shared.status;
  if (!st) return 'Checking your share…';
  if (st.error) return st.error;
  if (st.owner || !st.limit) return `Used about $${st.used.toFixed(2)} this month.`;
  return `Your share this month: about $${st.used.toFixed(2)} of $${st.limit}.`;
}
const capital = w => w[0].toUpperCase() + w.slice(1);

// Same gender casting as the device voices, spreading the AI voices across characters.
function aiCast(s) {
  const used = { f: 0, m: 0 };
  const cast = new Map();
  for (const [speaker, { gender }] of castVoices(s)) cast.set(speaker, AI_VOICES[gender][used[gender]++ % AI_VOICES[gender].length]);
  return cast;
}

function aiVoiceFor(s, speaker) {
  const chosen = s.aiVoices?.[speaker];
  return AI_ALL.includes(chosen) ? chosen : aiCast(s).get(speaker) || 'marin';
}

// Tells the voice how to perform: the character's note, an American accent, and the line's own stage directions.
function aiInstructions(s, speaker, text) {
  const style = s.aiStyles?.[speaker];
  const dirs = (text.match(/\([^)]*\)|\[[^\]]*\]/g) || []).map(d => d.slice(1, -1).trim()).filter(Boolean).join('; ');
  return `Voice: ${style || 'a natural, expressive stage actor'}. Accent: General American. `
    + 'This is a line of dialogue in a play: say it with the emotion and timing the words call for, like a real actor, not a narrator.'
    + (dirs ? ` Stage direction for this line: ${dirs}.` : '');
}

async function aiAudio(voice, instructions, input) {
  const raw = [AI_MODEL, voice, instructions, input].join('|');
  const key = `${hash(raw)}-${hash('~' + raw)}-${input.length}`;
  const cached = await ttsCache.get(key).catch(() => null);
  if (cached) return cached;
  if (aiInflight.has(key)) return aiInflight.get(key);
  checkAiBudget();
  const job = (async () => {
    const res = !ai.key ? await sharedFetch('/speech', { voice, input, instructions }) : await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + ai.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: AI_MODEL, voice, input, instructions, response_format: 'mp3' }),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch { /* no details */ }
      const err = new Error(res.status === 401 ? "OpenAI didn't accept your key. Check it in Voices for each character."
        : res.status === 429 ? 'OpenAI says you are out of credit or over your limit.'
        : `OpenAI couldn't make the voice (${res.status}). ${detail}`);
      err.status = res.status;
      throw err;
    }
    const blob = await res.blob();
    ttsCache.put(key, blob).catch(() => {});
    countAiUse({ chars: input.length + instructions.length / 4 });
    return blob;
  })();
  aiInflight.set(key, job);
  try { return await job; } finally { aiInflight.delete(key); }
}

// ---------- Spending limit (an estimate, per device) ----------
// OpenAI only shows exact charges in its own dashboard, so the app keeps a rough count: about $15 per
// million characters of speech, and about a fifth of a cent per page read from a photo. When this month's
// estimate reaches the limit, new AI audio and page reading pause; everything already made still plays.
const COST_PER_CHAR = 15 / 1e6, COST_PER_PAGE = 0.002;
const thisMonth = () => new Date().toISOString().slice(0, 7);

function aiUsage() {
  if (ai.usage?.month !== thisMonth()) ai.usage = { month: thisMonth(), chars: 0, pages: 0 };
  return ai.usage;
}
const aiSpent = () => aiUsage().chars * COST_PER_CHAR + aiUsage().pages * COST_PER_PAGE;
const aiCap = () => (ai.capUsd == null ? 5 : ai.capUsd); // dollars a month on this device; 0 means no limit

function checkAiBudget() {
  if (!ai.key) return; // shared voices: the server keeps each person's allowance
  if (aiCap() > 0 && aiSpent() >= aiCap()) {
    const err = new Error(`This month's OpenAI limit on this device (about $${aiCap()}) is reached. Lines already made still play; raise the limit under Voices for each character, or wait until next month.`);
    err.status = 'limit';
    throw err;
  }
}

function countAiUse({ chars = 0, pages = 0 }) {
  const u = aiUsage();
  u.chars += chars;
  u.pages += pages;
  saveJSON(LS_AI, ai);
}

const money = n => (n < 0.01 && n > 0 ? 'under 1¢' : `$${n.toFixed(2)}`);

function aiBudgetHtml() {
  const spent = aiSpent(), cap = aiCap(), month = new Date().toLocaleString(undefined, { month: 'long' });
  const pct = cap > 0 ? Math.min(100, Math.round(100 * spent / cap)) : 0;
  return `<div class="stack-sm budget">
    <div class="row wrap"><b class="small">Monthly limit on this device</b>
      <span class="row"><span class="small">$</span><input id="ai-cap" type="number" min="0" step="1" value="${cap}" aria-label="Monthly limit in dollars" class="cap-input"${aiLocked() ? ' disabled' : ''}>
      <button class="btn ghost" data-action="ai-cap"${aiLocked() ? ' disabled' : ''}>Set</button></span></div>
    ${cap > 0 ? `<div class="bar" aria-hidden="true"><div style="width:${pct}%"></div></div>` : ''}
    <p class="muted small">Used about ${money(spent)} in ${month}${cap > 0 ? ` of $${cap}` : ' (no limit set)'}. An estimate: for a hard limit, set a monthly budget in your OpenAI account (Settings &gt; Limits). 0 means no limit here.</p>
    <p class="muted small">Enjoying the voices? <a href="https://venmo.com/u/shannonnazzal" target="_blank" rel="noopener">☕ Tip jar on Venmo</a> helps cover them.</p>
  </div>`;
}

function aiFailed(e) {
  if (aiWarned) return;
  aiWarned = true;
  toast((e.status ? e.message : "Couldn't reach OpenAI.") + ' Using the device voice for now.');
}

// Starts generating upcoming lines in the background so they're ready when their turn comes.
function aiPrefetch(s, indices) {
  if (!aiReady()) return;
  for (const i of indices) {
    const l = s.lines[i];
    if (!l || l.type !== 'line' || (settings.useRecordings && recorded.has(lineKey(l)))) continue;
    const voice = aiVoiceFor(s, l.speaker), instructions = aiInstructions(s, l.speaker, l.text);
    for (const piece of chunksOf(spokenText(l.text), 3000)) aiAudio(voice, instructions, piece).catch(() => {});
  }
}

async function aiPrepareAll() {
  const s = current();
  const lines = s.lines.filter(l => l.type === 'line');
  const prog = app.aiProgress = { done: 0, total: lines.length, stop: false };
  render();
  for (const l of lines) {
    if (prog.stop) break;
    try {
      const voice = aiVoiceFor(s, l.speaker), instructions = aiInstructions(s, l.speaker, l.text);
      for (const piece of chunksOf(spokenText(l.text), 3000)) await aiAudio(voice, instructions, piece);
    } catch (e) {
      toast(e.status ? e.message : "Couldn't reach OpenAI. Check your connection and try again.");
      break;
    }
    prog.done++;
    const el = $('#ai-progress');
    if (el) el.textContent = `Preparing voices: ${prog.done} of ${prog.total}`;
  }
  shared.status = null; // fetch the shared-voices total again now that new lines were made
  if (prog.done === prog.total) toast('All lines are ready. They play instantly, even offline.');
  app.aiProgress = null;
  if (app.view === 'script') render();
}

// The shared-voices part of the panel, for people without their own key.
function sharedPanelHtml() {
  if (!SHARED_VOICES_URL) return '';
  if (!signedInUser()) {
    return `<div class="stack-sm"><b>Shannon's shared voices</b>
      <p class="small">No key needed: sign in with Google and join one of Shannon's groups (ask Shannon for an invite).</p>
      <div><button class="btn" data-action="group">Sign in</button></div></div>`;
  }
  if (ai.shared) loadSharedStatus();
  const prog = app.aiProgress;
  return `<div class="stack-sm">
    <label class="check-row"><input type="checkbox" id="ai-shared" ${ai.shared ? 'checked' : ''}><b>Use Shannon's shared voices</b></label>
    ${ai.shared ? `<p class="muted small" id="shared-status">${esc(sharedStatusText())}</p>
      <div class="row wrap">${prog
        ? `<span id="ai-progress" class="muted small">Preparing voices: ${prog.done} of ${prog.total}</span><button class="btn ghost" data-action="ai-stop">Stop</button>`
        : '<button class="btn" data-action="ai-prepare">Prepare all lines now</button>'}</div>
      <p class="muted small">Lines are made once and saved on this device, so replays don't use your share.</p>` : '<p class="muted small">Human-sounding, computer-generated voices for people in Shannon\'s groups, no key needed.</p>'}
  </div>`;
}

function aiPanelHtml() {
  if (!ai.key) {
    const sharedHtml = sharedPanelHtml();
    return `<div class="ai-card stack-sm">
      ${sharedHtml}
      ${sharedHtml ? '<details class="own-key"><summary class="small">Or use your own OpenAI key</summary><div class="stack-sm">' : ''}
      <b>Natural AI voices</b>
      <p class="muted small">Human-sounding, computer-generated voices from OpenAI that act out stage directions like (angrily) or (whispering). Each line costs a little the first time it's read, then replays free, even offline.</p>
      <ol class="steps-list small">
        <li>Sign in at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a> and add a few dollars of credit under Billing.</li>
        <li>Tap <b>Create new secret key</b>, copy it, and paste it here.</li>
      </ol>
      <div class="row wrap"><input id="ai-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-…" aria-label="OpenAI key"><button class="btn primary" data-action="ai-save">Save key</button></div>
      <label class="field small"><span>Voice lock PIN (recommended if anyone else uses this device)</span>
        <input id="ai-pin" type="password" inputmode="numeric" autocomplete="off" placeholder="4 or more digits" aria-label="Voice lock PIN"></label>
      <p class="muted small">The key is saved only on this device. With a PIN, AI voices, "how they sound" notes and Female/Male can only be changed (and the key removed) by someone who knows it, so audio you've paid for isn't re-made. Tip: set a monthly spending limit in your OpenAI account.</p>
      ${sharedHtml ? '</div></details>' : ''}
    </div>`;
  }
  const prog = app.aiProgress;
  const lockHtml = !ai.pinHash
    ? `<div class="row wrap"><input id="ai-pin" type="password" inputmode="numeric" autocomplete="off" placeholder="New PIN" aria-label="New voice lock PIN" class="pin"><button class="btn ghost" data-action="ai-set-pin">Lock voices with a PIN</button></div>`
    : aiLocked()
      ? `<p class="small">🔒 <b>Voices are locked.</b> Only the key owner can change AI voices.</p>
         <div class="row wrap"><input id="ai-pin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN" aria-label="Voice lock PIN" class="pin"><button class="btn ghost" data-action="ai-unlock">Unlock</button></div>`
      : '<div class="row wrap"><span class="small">🔓 Voices unlocked on this device until you close the app.</span><button class="btn ghost" data-action="ai-lock">Lock now</button></div>';
  return `<div class="ai-card stack-sm">
    <label class="check-row"><input type="checkbox" id="ai-on" ${ai.on ? 'checked' : ''}><b>Use natural AI voices</b></label>
    ${ai.on ? `<div class="row wrap">${prog
      ? `<span id="ai-progress" class="muted small">Preparing voices: ${prog.done} of ${prog.total}</span><button class="btn ghost" data-action="ai-stop">Stop</button>`
      : '<button class="btn" data-action="ai-prepare">Prepare all lines now</button><span class="muted small">Makes every line ahead of time, so practice starts instantly and works offline.</span>'}</div>` : ''}
    ${aiBudgetHtml()}
    ${lockHtml}
    ${aiLocked() ? '' : '<div><button class="link-btn small" data-action="ai-remove">Remove key from this device</button></div>'}
  </div>`;
}

// ---------- Voice lock ----------
// Once AI audio has been paid for, a PIN keeps others on this device from changing voices (which would
// re-make, and re-pay for, every line). Unlocking lasts until the app is closed.
const SS_AI_UNLOCKED = 'lineLearner.aiUnlocked';
const pinHash = pin => hash('line-learner-pin|' + pin) + hash('|' + pin + '|pin');
const aiLocked = () => !!ai.pinHash && sessionStorage.getItem(SS_AI_UNLOCKED) !== ai.pinHash;
// Female/Male also picks the AI voice, so it stays locked even while AI voices are switched off.
const voiceEditsLocked = () => !!ai.key && aiLocked();
const speedLabel = v => (v === 1 ? 'Normal' : `${v.toFixed(2)}x`);
const sayHello = speaker => preview(t => speakAs(speaker, `Hello. I'll be reading ${titleCase(speaker)}.`, t));

let previewToken = makeToken();
function preview(fn) {
  previewToken.cancel();
  previewToken = makeToken();
  return fn(previewToken);
}

let audioCtx;
function chime(ok) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    (ok ? [660, 880] : [330, 247]).forEach((f, n) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime + n * 0.12;
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.3);
    });
  } catch { /* sound is a nicety */ }
}

// ---------- Listening ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const COMMAND_RE = /^(line|line please|prompt|whats my line)$/;

// Resolves with { reason, text } once you stop talking, finish the line, say "line", or the run is cancelled.
function listen(token, expected) {
  return new Promise(resolve => {
    let finalText = '', interim = '', heard = false, settled = false, timer = 0, off = () => {};
    const rec = new SR();
    rec.lang = navigator.language || 'en-US';
    // Safari's continuous mode is unreliable, so on iPhone each pause ends a session and we restart it below.
    rec.continuous = !IS_IOS;
    rec.interimResults = true;
    const said = () => (finalText + ' ' + interim).replace(/\s+/g, ' ').trim();
    const finish = reason => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      off();
      P.finishListen = null;
      try { rec.abort(); } catch { /* already stopped */ }
      resolve({ reason, text: said() });
    };
    const arm = ms => { clearTimeout(timer); timer = setTimeout(() => finish(heard ? 'silence' : 'timeout'), ms); };
    rec.onresult = e => {
      heard = true;
      interim = '';
      for (let r = e.resultIndex; r < e.results.length; r++) {
        const res = e.results[r];
        if (res.isFinal) finalText += ' ' + res[0].transcript;
        else interim += ' ' + res[0].transcript;
      }
      setTranscript(said());
      if (!interim.trim() && COMMAND_RE.test(words(finalText).join(' '))) return finish('prompt');
      if (compare(expected, said()).score === 100) return finish('complete');
      arm(settings.silenceMs);
    };
    rec.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      finish('error:' + e.error);
    };
    // Browsers end recognition after a stretch of silence; keep going until we decide we're done.
    rec.onend = () => {
      if (settled) return;
      try { rec.start(); } catch { finish('error:restart'); }
    };
    off = token.onCancel(() => finish('cancel'));
    P.finishListen = finish;
    arm(9000);
    try { rec.start(); } catch { finish('error:start'); }
  });
}

function setTranscript(text) {
  P.transcript = text;
  const el = $('#transcript');
  if (el) el.textContent = text;
}

// How to switch the microphone on for this site, in words for the browser you're using.
function micHelp() {
  if (IS_IOS) return 'Missed our entrance: the microphone is blocked. In Safari, tap the "aA" button in the address bar > Website Settings > Microphone > Allow (in Chrome: the site\'s settings, or iPhone Settings > Chrome > Microphone). Then press play.';
  return 'Missed our entrance: the microphone is blocked. Click the icon at the left of the address bar, set Microphone to Allow, then press play.';
}

// Asks for the microphone as soon as you start (while your tap still counts), so the browser's question
// never pops up in the middle of a scene and swallows your first line. If it's already allowed, nothing shows.
// Without one, the run carries on without it (see noMic) and says so.
async function ensureMic(mode) {
  noMic = false;
  if (!SR || !navigator.mediaDevices?.getUserMedia) return;
  try {
    const state = await navigator.permissions?.query({ name: 'microphone' }).then(p => p.state).catch(() => '');
    if (state === 'granted') return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
  } catch (e) {
    noMic = true;
    const why = e?.name === 'NotFoundError' ? 'No microphone found.' : 'The microphone is blocked (Help explains how to allow it).';
    toast(`${why} ${NO_MIC_FALLBACK[mode === 'listen' ? 'listen' : 'rehearse']}`);
  }
}

// Set when the microphone can't be used this time: Listen then pauses for a set time at your lines,
// and Rehearse and Build up let you mark yourself.
let noMic = false;
const micOn = () => !!SR && !noMic;
const NO_MIC_FALLBACK = {
  listen: 'Listen will pause for a set time at your lines instead.',
  rehearse: 'Say each line, then mark yourself (Got it / Missed it). Or try Type your lines.',
};

// A microphone problem that won't fix itself mid-scene: carry on without the microphone.
const lostMic = code => ['not-allowed', 'service-not-allowed', 'audio-capture'].includes(code);
function carryOnWithoutMic(code) {
  noMic = true;
  P.note = `${code === 'audio-capture' ? 'No microphone found.' : 'The microphone is blocked.'} ${NO_MIC_FALLBACK[P.mode === 'listen' ? 'listen' : 'rehearse']}`;
  if (app.view === 'player') render(); // the mode label and settings show it's off for now
}

function micError(code) {
  if (code === 'not-allowed' || code === 'service-not-allowed') return micHelp();
  if (code === 'network') return 'Lost the signal backstage. Checking your lines needs the internet: reconnect, then press play.';
  if (code === 'audio-capture') return 'No microphone in the wings. Plug one in (or check your headphones are connected), then press play.';
  return `The microphone dropped its cue (${code}). Press play to try again.`;
}

// ---------- Recording your own voice ----------
async function toggleRecord(key) {
  if (app.rec) {
    const same = app.rec.key === key;
    app.rec.recorder.stop();
    if (same) return;
  }
  previewToken.cancel();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toast(micHelp());
    return;
  }
  const chunks = [];
  const recorder = new MediaRecorder(stream);
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    if (app.rec?.recorder === recorder) app.rec = null;
    const blob = new Blob(chunks, { type: recorder.mimeType });
    if (blob.size) {
      try { await recordings.put(key, blob); recorded.add(key); } catch { toast('Could not save that recording.'); }
    }
    if (app.view === 'script') render();
  };
  recorder.start();
  app.rec = { key, recorder };
  render();
}

function stopRecording() {
  if (app.rec) app.rec.recorder.stop();
}

// ---------- Script helpers ----------
const app = { view: 'library', scriptId: null, editing: null, rec: null, voicesOpen: false, cuesOnly: false }; // cuesOnly: Just my cues and lines, off each time a script opens
let sampleScript = null; // "Try a sample scene": kept in memory only, never in your scripts
const current = () => scripts.find(s => s.id === app.scriptId) || (sampleScript?.id === app.scriptId ? sampleScript : undefined);
const lineKey = l => hash(l.speaker + '|' + spokenText(l.text));
const isMine = (s, l) => l.type === 'line' && l.speaker === s.myChar;
const statOf = (s, l) => s.stats[lineKey(l)];
// A line is Not practiced (never tried), Solid (passed last time without help), or Working on it (missed, or
// got it with help: a hint showing half the line or more, Hint, Hear it / Show me, or saying "line").
const lineState = (s, l) => {
  const st = statOf(s, l);
  if (!st?.tries) return 'new';
  return st.last >= settings.passScore && !st.helped ? 'solid' : 'working';
};
const isSolid = (s, l) => lineState(s, l) === 'solid';
const isWorking = (s, l) => lineState(s, l) === 'working';

// How much of the line the hint gave away when you said it: half the words or more counts as help.
function hintHelped(text, level) {
  if (level === 'hidden') return false;
  if (level !== 'first') return true;
  const n = spokenText(text).split(' ').filter(Boolean).length;
  return clamp(Math.floor(n / 2), 1, 3) * 2 >= n;
}

function characters(s) {
  const m = new Map();
  for (const l of s.lines) if (l.type === 'line') m.set(l.speaker, (m.get(l.speaker) || 0) + 1);
  return m;
}

function makeScript(title, raw) {
  const lines = parseScript(raw);
  const chars = [...characters({ lines }).keys()];
  return { id: uid(), title: title || 'Untitled script', raw, lines, myChar: chars.length === 1 ? chars[0] : '', voices: {}, stats: {}, updated: Date.now(), category: defaultCategory() };
}

function rangeBounds(s) {
  const start = clamp(s.rangeStart || 0, 0, Math.max(0, s.lines.length - 1));
  const end = clamp(s.rangeEnd ?? s.lines.length, start + 1, s.lines.length);
  return [start, end];
}
// When a script's text changes (an edit, or the group's updated copy), keeps your place: Start at / Stop and
// Pick up where you left off follow the same lines, matched by who says them and the words, not by position.
// Progress needs nothing: it's kept per line by speaker and words, so unchanged lines keep theirs and changed
// lines start fresh.
function keepPlace(s, oldLines) {
  const placeKey = l => `${l.type}|${l.speaker || ''}|${spokenText(l.text)}`;
  const follow = i => {
    const l = oldLines[i];
    if (!l) return -1;
    const k = placeKey(l), nth = oldLines.slice(0, i).filter(x => placeKey(x) === k).length;
    const hits = s.lines.map((x, j) => (placeKey(x) === k ? j : -1)).filter(j => j >= 0);
    return hits.length ? hits[Math.min(nth, hits.length - 1)] : -1;
  };
  if (s.rangeStart) { const j = follow(s.rangeStart); if (j > 0) s.rangeStart = j; else delete s.rangeStart; }
  if (s.rangeEnd != null) {
    const j = s.rangeEnd >= oldLines.length ? -1 : follow(s.rangeEnd);
    if (j > (s.rangeStart || 0)) s.rangeEnd = j; else delete s.rangeEnd;
  }
  const r = resumeAt[s.id];
  if (r) {
    const j = follow(r.line);
    if (j >= 0) r.line = j; else delete resumeAt[s.id];
    saveJSON(LS_RESUME, resumeAt);
  }
}

const span = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);
const rangeOrder = s => span(...rangeBounds(s));

function prevLineIndex(s, i) {
  for (let j = i - 1; j >= 0; j--) {
    if (s.lines[j].type === 'line') return j;
    if (s.lines[j].type === 'section') return -1;
  }
  return -1;
}

// Each of your lines with the line just before it (your cue), skipping the rest of the scene. With onlyWeak,
// just the lines you've tried and are still working on (Drill weak lines); untried lines aren't "weak".
function cueOrder(s, onlyWeak = false) {
  const order = [];
  for (const i of rangeOrder(s)) {
    const l = s.lines[i];
    if (!isMine(s, l) || (onlyWeak && !isWorking(s, l))) continue;
    const cue = prevLineIndex(s, i);
    if (cue >= 0 && !isMine(s, s.lines[cue]) && order[order.length - 1] !== cue) order.push(cue);
    order.push(i);
  }
  return order;
}
const weakOrder = s => cueOrder(s, true);
// What Listen and Rehearse play: the whole scene, or just your cues and lines (a checkbox on the script page).
const playOrder = s => (app.cuesOnly && s.myChar ? cueOrder(s) : rangeOrder(s));
const weakCount = s => weakOrder(s).filter(i => isMine(s, s.lines[i])).length;

// ---------- Icons ----------
const ICONS = {
  play: '<path d="M7 4v16l13-8z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 4h4v16H7zM13 4h4v16h-4z" fill="currentColor" stroke="none"/>',
  prev: '<path d="M19 5v14L9 12z" fill="currentColor"/><path d="M6 5v14"/>',
  next: '<path d="M5 5v14l10-7z" fill="currentColor"/><path d="M18 5v14"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  stairs: '<path d="M4 20h5v-5h5v-5h5V5"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
const bar = frac => `<div class="bar"><div style="width:${Math.round(frac * 100)}%"></div></div>`;

// ---------- Views ----------
function supportNote() {
  const notes = [];
  if (!SR) {
    notes.push(IS_IOS
      ? 'To have your lines checked by microphone on iPhone, open this page in Safari. Here you can still rehearse and mark yourself.'
      : 'Checking your lines by microphone needs Google Chrome or Microsoft Edge. In this browser you can still rehearse and mark yourself.');
  }
  if (!synth) notes.push("This browser can't read lines aloud. Try Microsoft Edge or Google Chrome.");
  if (location.protocol === 'file:') notes.push('Open Line Learner from its web address, https://sqnazzal.github.io/line-learner/, so the microphone works and your scripts sync.');
  return notes.map(n => `<p class="note">${esc(n)}</p>`).join('');
}

// ---------- Categories for your scripts ----------
// Current, Audition, Fun, Other and Past, plus any you make (like a show's name). Past always comes last.
const CAT_LABELS = { current: 'Current', audition: 'Audition', fun: 'Fun', other: 'Other', past: 'Past' };
const LS_LIB_CAT = 'lineLearner.libraryCategory';
const catOf = s => s.category || 'current';
const catLabel = c => CAT_LABELS[c] || c;

function allCategories() {
  const custom = [...new Set([...(settings.customCats || []), ...scripts.map(catOf)])].filter(c => !CAT_LABELS[c]).sort((a, b) => a.localeCompare(b));
  return ['current', 'audition', ...custom, 'fun', 'other', 'past'];
}

// New scripts go into the category you're looking at.
function defaultCategory() {
  const c = loadJSON(LS_LIB_CAT, 'all');
  return c === 'all' ? 'current' : c;
}

const categoryOptions = sel => allCategories().map(c => `<option value="${esc(c)}"${c === sel ? ' selected' : ''}>${esc(catLabel(c))}</option>`).join('')
  + '<option value="__new">New category…</option>';

function scriptCardHtml(s) {
  const mine = s.lines.filter(l => isMine(s, l));
  const solid = mine.filter(l => isSolid(s, l)).length;
  return `<li class="script-item"><button class="card script-card" data-action="open" data-id="${s.id}">
      <span class="card-title">${s.kind === 'song' ? '<span class="tag">Song</span> ' : ''}${esc(s.title)}</span>
      <span class="muted">${s.myChar ? `As ${esc(titleCase(s.myChar))}: ${progressText(s, mine)}` : 'Pick your character to start'}</span>
      ${mine.length ? bar(solid / mine.length) : ''}
    </button>
    <select class="cat-pick" data-cat-id="${s.id}" aria-label="Category for ${esc(s.title)}">${categoryOptions(catOf(s))}</select></li>`;
}

function yourScriptsHtml() {
  if (!scripts.length) return '';
  const cats = allCategories(), sel = loadJSON(LS_LIB_CAT, 'all');
  const counts = Object.fromEntries(cats.map(c => [c, scripts.filter(s => catOf(s) === c).length]));
  const shown = sel !== 'all' && !counts[sel] && !(settings.customCats || []).includes(sel) && !CAT_LABELS[sel] ? 'all' : sel;
  const tab = (c, label, n) => `<button class="chip${shown === c ? ' on' : ''}" data-action="lib-cat" data-cat="${esc(c)}" aria-pressed="${shown === c}">${esc(label)} <span class="muted">${n}</span></button>`;
  const tabs = tab('all', 'All', scripts.length) + cats.filter(c => counts[c] || c === shown).map(c => tab(c, catLabel(c), counts[c])).join('');
  const byNewest = list => list.sort((a, b) => b.updated - a.updated).map(scriptCardHtml).join('');
  const body = shown === 'all'
    ? cats.filter(c => counts[c]).map(c => `<h3 class="cat-head">${esc(catLabel(c))}</h3><ul class="cards">${byNewest(scripts.filter(s => catOf(s) === c))}</ul>`).join('')
    : counts[shown] ? `<ul class="cards">${byNewest(scripts.filter(s => catOf(s) === shown))}</ul>` : `<p class="muted">Nothing in ${esc(catLabel(shown))} yet. Move a script here with its category menu.</p>`;
  return `<div class="stack-sm"><h2>Your scripts</h2><div class="row wrap chips cat-tabs" role="group" aria-label="Categories">${tabs}</div>${body}</div>`;
}

function setCategory(s, value) {
  if (value === '__new') {
    const name = (prompt('Name the new category (for example, a show you\'re in):') || '').trim().slice(0, 30);
    if (!name) { render(); return; }
    const key = Object.keys(CAT_LABELS).find(k => CAT_LABELS[k].toLowerCase() === name.toLowerCase()) || name;
    if (!CAT_LABELS[key]) settings.customCats = [...new Set([...(settings.customCats || []), key])];
    saveSettings();
    value = key;
  }
  s.category = value;
  s.updated = Date.now();
  saveScripts();
  toast(`Moved to ${catLabel(value)}.`);
  render();
}

// One short line on what signing in does, since it's optional and that isn't obvious from the buttons.
function accountLineHtml() {
  const user = signedInUser();
  if (user) {
    const syncing = typeof gsync !== 'undefined' && gsync.conf.on;
    return `<p class="muted small account-line">Signed in as ${esc(user.name)}. ${syncing ? 'Your scripts, songs and progress sync to your other devices.' : 'Turn on <button class="link-btn" data-action="sync-view">Sync</button> to keep your scripts the same on your other devices.'}</p>`;
  }
  return `<p class="muted small account-line">Signing in is optional. Everything works on this device without it. <button class="link-btn" data-action="group">Sign in with Google</button> to keep your scripts in sync across your devices and to share with a cast or group (ages 13 and up).</p>`;
}

// "Continue Hamlet as Horatio · Act 1, Scene 2 · Rehearse": straight back into your last run, same mode,
// section and Just my cues setting, from where you stopped if it was a long scene.
function continueHtml() {
  const s = lastRun && scripts.find(x => x.id === lastRun.id);
  if (!s || s.kind === 'song' || (lastRun.mode !== 'listen' && !s.myChar)) return '';
  const r = resumeAt[s.id]?.mode === lastRun.mode ? resumeAt[s.id] : null;
  const at = r ? r.line : rangeBounds(s)[0];
  let section = '';
  for (let i = at; i >= 0; i--) if (s.lines[i]?.type === 'section') { section = s.lines[i].text; break; }
  const bits = [s.myChar && `as ${titleCase(s.myChar)}`, section, { listen: 'Listen', rehearse: 'Rehearse', type: 'Type' }[lastRun.mode] + (lastRun.cuesOnly ? ', cues only' : ''), r && `line ${r.pos} of ${r.total}`].filter(Boolean);
  return `<div class="card resume-card">
    <span><b>Continue ${esc(s.title)}</b> <span class="muted">${esc(bits.join(' · '))}</span></span>
    <button class="btn primary" data-action="continue-last">${icon('play')} Continue</button>
  </div>`;
}

function renderLibrary() {
  const has = scripts.length > 0;
  return `<section class="stack">
    <div class="hero">
      <h1 class="tagline">Because your family is tired of running lines with you.</h1>
      <p class="lede">Paste your script, pick your part, and let’s rehearse. Listen on repeat, work through tricky speeches, or run the whole scene out loud. Forget a line? Just say “line.” We can do this all night.</p>
      <div class="row wrap">
        <button class="btn primary" data-action="new">+ New script</button>
        <button class="btn" data-action="new-song">+ New song</button>
        <button class="btn" data-action="browse">Browse free scripts &amp; monologues</button>
        <button class="btn ghost" data-action="sample">Try a sample scene</button>
      </div>
      ${accountLineHtml()}
    </div>
    ${continueHtml()}
    ${supportNote()}
    ${(() => {
      const d = pendingDraft();
      return d ? `<div class="note row between wrap"><span>You have an unsaved script${d.title ? ` ("${esc(d.title)}")` : ''}. It isn't in your list or synced until you save it.</span>
        <span class="row"><button class="btn primary" data-action="resume-draft">Continue editing</button><button class="btn ghost" data-action="discard-draft">Discard</button></span></div>` : '';
    })()}
    ${yourScriptsHtml()}
    ${has ? '' : `<div class="card how">
      <h2>How to practice</h2>
      <ol>
        <li><b>Listen</b> on repeat while you commute or cook. It pauses where your lines go so you can say them, then plays them so you hear how they go.</li>
        <li><b>Rehearse</b> out loud. Your cues are read to you, the mic listens, and you get a word-by-word check. Stuck? Say <i>"line"</i> like you would in a real rehearsal.</li>
        <li><b>Build up</b> long speeches and audition monologues one sentence at a time, always from the top.</li>
        <li><b>Drill weak lines</b> to go straight to the ones that need work.</li>
      </ol>
    </div>`}
  </section>`;
}

function renderEdit() {
  const e = app.editing;
  if (e.kind === 'song') {
    return `<section class="stack">
      <h1>${e.id ? 'Edit song' : 'New song'}</h1>
      <label class="field"><span>Title</span><input id="ed-title" value="${esc(e.title)}" placeholder="e.g. Defying Gravity (Wicked)"></label>
      ${songPanelHtml(e)}
      ${trayHtml()}
      ${findBarHtml()}
      <label class="field"><span>Lyrics</span><textarea id="ed-raw" rows="14" spellcheck="false" placeholder="One line of the song per line">${esc(e.raw)}</textarea></label>
      <div id="ed-preview" class="muted stack-sm"></div>
      <p class="muted small rights-note">Only add scripts and lyrics you have the right to use this way: a public-domain text, your own writing, or one your production's license or the publisher allows (including reading it with AI voices). It stays private to you unless you share it.</p>
            <div class="row wrap">
        <span class="spacer"></span>
        <button class="btn ghost" data-action="cancel-edit">Cancel</button>
        <button class="btn primary" data-action="save-edit">Save</button>
      </div>
    </section>`;
  }
  return `<section class="stack">
    <h1>${e.id ? 'Edit script' : 'New script'}</h1>
    <label class="field"><span>Title</span><input id="ed-title" value="${esc(e.title)}" placeholder="e.g. Romeo and Juliet, balcony scene"></label>
    <details class="help card">
      <summary>How should I format it?</summary>
      <p>Put each speech on its own line, starting with the character's name:</p>
      <pre>ROMEO: But soft, what light through yonder window breaks?
JULIET: Ay me!</pre>
      <ul>
        <li><b>Names:</b> "ROMEO: line", "ROMEO. line", or the name alone in capitals with the speech underneath (screenplay style).</li>
        <li><b>Stage directions:</b> put them in (parentheses) or [brackets]. They show up but are never read as part of a line.</li>
        <li><b>Scenes:</b> a line starting with # (or "Act 1", "Scene 2") starts a section you can practice on its own.</li>
        <li><b>Audition monologue?</b> Paste it with no names. Each paragraph becomes one of your lines.</li>
        <li><b>Paper script or screenshots:</b> tap Take photo for each page (or Choose photos for many at once), then Read pages. They're read in order by OpenAI using the key you added for AI voices, and added to the end of the text.</li>
        <li><b>Long paper script?</b> Scanning it with the iPhone Notes app (Scan Documents, then share as a PDF) is quickest. Import that PDF here and its pages are read the same way.</li>
        <li><b>PDF scripts:</b> import or drag in the PDF, then skim the text. Page numbers and repeated headers are removed, but cast lists, title pages or odd layouts may need a quick tidy.</li>
      </ul>
    </details>
    <div class="row wrap"><label class="btn">Import PDF or .txt<input type="file" id="ed-file" accept=".pdf,.txt,application/pdf,text/plain" hidden></label></div>
    ${trayHtml()}
    ${findBarHtml(true)}
    <label class="field"><span>Script</span><textarea id="ed-raw" rows="16" spellcheck="false" placeholder="Paste your scene or monologue here">${esc(e.raw)}</textarea></label>
    <div id="ed-preview" class="muted stack-sm"></div>
    <p class="muted small rights-note">Only add scripts and lyrics you have the right to use this way: a public-domain text, your own writing, or one your production's license or the publisher allows (including reading it with AI voices). It stays private to you unless you share it.</p>
        <div class="row wrap">
      <span class="spacer"></span>
      <button class="btn ghost" data-action="cancel-edit">Cancel</button>
      <button class="btn primary" data-action="save-edit">Save</button>
    </div>
  </section>`;
}

function updatePreview() {
  const el = $('#ed-preview');
  if (!el) return;
  const raw = $('#ed-raw').value;
  if (!raw.trim()) { el.textContent = ''; return; }
  if (app.editing?.kind === 'song') {
    const { times } = parseSong(raw);
    const timedCount = times.filter(t => t != null).length;
    el.innerHTML = `Found <b>${times.length}</b> lines${timedCount ? `, ${timedCount === times.length ? 'all' : timedCount} timed to the music` : ''}.`;
    return;
  }
  const lines = parseScript(raw);
  const n = lines.filter(l => l.type === 'line').length;
  if (!n) { el.textContent = 'No lines found yet. See the format tips above.'; updateMergeBox(lines); return; }
  const cast = [...characters({ lines })];
  const count = type => lines.filter(l => l.type === type).length;
  const plural = (k, word) => `<b>${k}</b> ${word}${k === 1 ? '' : 's'}`;
  const totals = [plural(cast.length, 'character'), count('section') && plural(count('section'), 'scene'), plural(n, 'speech').replace('speechs', 'speeches'),
    count('direction') && plural(count('direction'), 'stage direction')].filter(Boolean).join(' · ');
  const cut = (t, k = 90) => (t.length > k ? t.slice(0, k).replace(/\s+\S*$/, '') + '…' : t);
  const sample = lines.filter(l => l.type !== 'section').slice(0, 4).map(l => (l.type === 'line'
    ? `<li><b>${esc(titleCase(l.speaker))}:</b> ${esc(cut(l.text))}</li>` : `<li><i>(${esc(cut(l.text))})</i></li>`)).join('');
  const flags = scriptFlags(lines, cast).slice(0, 5).map(f => `<li>${f.html} <button class="link-btn" data-action="preview-find" data-q="${esc(f.q)}">Show me</button></li>`).join('');
  el.innerHTML = `<p>Found ${totals}.</p>
    <p class="small">Characters: ${cast.map(([c, k]) => `${esc(titleCase(c))} (${k})`).join(', ')}</p>
    <details class="small"><summary>How the start reads</summary><ul class="parse-sample">${sample}</ul></details>
    ${flags ? `<div class="note small"><b>Worth a look before you rehearse:</b><ul>${flags}</ul></div>` : ''}`;
  updateMergeBox(lines);
}

// Things that often mean the text was read wrong: a page header taken for a character, dialogue taken
// for a stage direction, or two speeches run together.
function scriptFlags(lines, cast) {
  const out = [];
  const firstWords = t => t.split(/\s+/).slice(0, 4).join(' ');
  for (const [c, k] of cast) {
    if (k > 2) continue;
    if (/\d|\b(page|act|scene|continued|cont|draft|revised|script|copyright)\b/i.test(c) || c.split(/\s+/).length > 3) {
      out.push({ html: `<b>${esc(c)}</b> speaks ${k === 1 ? 'once' : 'twice'}. A page header or title, not a character?`, q: c });
    }
  }
  for (const l of lines) {
    if (l.type === 'direction' && words(l.text).length > 45) out.push({ html: `A long stage direction (“${esc(firstWords(l.text))}…”). Is it really dialogue?`, q: firstWords(l.text) });
    else if (l.type === 'line' && /(?:^|[.!?]\s+)[A-Z][A-Z.'’ -]{2,}:\s/.test(l.text)) out.push({ html: `${esc(titleCase(l.speaker))}’s speech (“${esc(firstWords(l.text))}…”) seems to have another name inside it. Two speeches run together?`, q: firstWords(l.text) });
    else if (l.type === 'line' && words(l.text).length > 300) out.push({ html: `${esc(titleCase(l.speaker))} has a very long speech (“${esc(firstWords(l.text))}…”). Two speeches run together?`, q: firstWords(l.text) });
  }
  return out;
}

// ---------- Merging characters (e.g. "MRS" and "MRS. PECK" are the same person) ----------
const merger = { sig: '', undo: null };

// Writes parsed lines back as plain text in the app's own format, so a merge can rewrite who says what.
function scriptToText(lines) {
  return lines.map(l => (l.type === 'section' ? `# ${l.text}` : l.type === 'direction' ? `(${l.text})` : `${l.speaker}: ${l.text}`)).join('\n\n') + '\n';
}

const nameKey = n => n.replace(/\([^)]*\)/g, '').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

// Pairs that are probably the same character: one name starts the other ("MRS" / "MRS. PECK"), the same
// name with extras ("HAMLET (CONT'D)"), or a near-misspelling ("HAMLLET"). The rarer one merges into the commoner.
function mergeSuggestions(chars) {
  const out = [];
  for (const [a, na] of chars) {
    for (const [b, nb] of chars) {
      if (a === b || na > nb || (na === nb && a > b)) continue;
      const ka = nameKey(a), kb = nameKey(b);
      if (!ka || !kb) continue;
      const alike = ka === kb || kb.startsWith(ka) || ka.startsWith(kb)
        || (Math.min(ka.length, kb.length) >= 4 && editDistance(ka, kb) <= (Math.min(ka.length, kb.length) >= 7 ? 2 : 1));
      if (alike) out.push({ from: a, to: b, nFrom: na, nTo: nb });
    }
  }
  return out.slice(0, 6);
}

function updateMergeBox(lines) {
  const box = $('#merge-box');
  if (!box) return;
  const chars = [...characters({ lines })];
  const sig = chars.map(c => c.join('=')).join('|');
  if (sig === merger.sig) return; // only redraw when the cast changes, so choices aren't reset while typing
  merger.sig = sig;
  const dupes = $('#find-dupes');
  if (chars.length < 2) { box.innerHTML = merger.undo != null ? undoMergeHtml() : ''; if (dupes) dupes.textContent = ''; return; }
  const opts = sel => chars.map(([c, n]) => `<option value="${esc(c)}"${c === sel ? ' selected' : ''}>${esc(titleCase(c))} (${n})</option>`).join('');
  const sugg = mergeSuggestions(chars);
  if (dupes) dupes.textContent = sugg.length ? ` · ${sugg.length} possible duplicate ${sugg.length === 1 ? 'name' : 'names'}` : '';
  if (sugg.length && !$('#find-box')?.open) { merger.autoOpened = true; $('#find-box')?.setAttribute('open', ''); }
  box.innerHTML = `<hr class="find-split"><b>Fix or merge character names</b>
    <div class="stack-sm">
      ${sugg.length ? `<p class="small">These look like the same person:</p><ul class="share-list">${sugg.map(s => `<li class="share-row">
          <span>${esc(titleCase(s.from))} (${s.nFrom}) <span class="muted">into</span> <b>${esc(titleCase(s.to))}</b> (${s.nTo})</span>
          <button class="btn" data-action="merge-chars" data-from="${esc(s.from)}" data-to="${esc(s.to)}">Merge</button></li>`).join('')}</ul>` : ''}
      <p class="small">${sugg.length ? "Or move" : "Move"} every line from one character to another:</p>
      <div class="row wrap"><select id="merge-from" aria-label="Move lines from">${opts(sugg[0]?.from || chars[chars.length - 1][0])}</select>
        <span class="muted small">to</span>
        <select id="merge-to" aria-label="Move lines to">${opts(sugg[0]?.to || chars[0][0])}</select>
        <button class="btn" data-action="merge-chars">Move lines</button></div>
      ${merger.undo != null ? undoMergeHtml() : ''}
    </div>`;
}

const undoMergeHtml = () => '<div><button class="btn ghost" data-action="merge-undo">Undo merge</button></div>';

// ---------- Importing files ----------
let pdfjsPromise;
function loadPdfJs() {
  return pdfjsPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/pdfjs/pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror = () => { pdfjsPromise = null; reject(new Error('Could not load the PDF reader.')); };
    document.head.appendChild(s);
  });
}

const PAGE_NUMBER_RE = /^(page\s*)?\d+\.?$/i;
const PAGE_MARKER_RE = /^\(?(cont'?d|continued|more)\)?:?$/i;

// Rebuilds readable lines from a PDF's positioned text: words on the same baseline become one line,
// and a visibly bigger gap between lines becomes a blank line.
async function pdfToText(file) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const { items } = await (await doc.getPage(n)).getTextContent();
    const rows = [];
    for (const it of items) {
      if (!it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
      let row = rows.find(r => Math.abs(r.y - y) < h * 0.5);
      if (!row) rows.push(row = { y, h, parts: [] });
      row.parts.push({ x, str: it.str, w: it.width });
    }
    rows.sort((a, b) => b.y - a.y);
    const lines = [];
    let prev = null;
    for (const row of rows) {
      row.parts.sort((a, b) => a.x - b.x);
      let text = '', end = null;
      for (const p of row.parts) {
        if (end !== null && p.x - end > row.h * 0.15 && !/\s$/.test(text)) text += ' ';
        text += p.str;
        end = p.x + p.w;
      }
      text = text.replace(/\s+/g, ' ').trim();
      if (PAGE_NUMBER_RE.test(text) || PAGE_MARKER_RE.test(text)) continue;
      if (prev && prev.y - row.y > Math.max(prev.h, row.h) * 1.9) lines.push('');
      lines.push(text);
      prev = row;
    }
    pages.push(lines);
  }
  // Drop running headers and footers (the same line at the top or bottom of most pages).
  const edgeCounts = new Map();
  for (const lines of pages) {
    for (const t of new Set([lines[0], lines[lines.length - 1]])) if (t) edgeCounts.set(t, (edgeCounts.get(t) || 0) + 1);
  }
  const looksLikeSpeech = t => { const m = t.match(/^([^:]{1,40}):\s*\S/); return !!m && isNameLike(m[1]); };
  const repeated = t => pages.length >= 3 && (edgeCounts.get(t) || 0) >= pages.length / 2 && !looksLikeSpeech(t);
  const text = pages.map(lines => lines.filter((t, k) => !((k === 0 || k === lines.length - 1) && repeated(t))).join('\n')).join('\n');
  if (!text.trim()) {
    const err = new Error('This PDF has no text inside (it is scanned pictures of pages).');
    err.code = 'NO_TEXT';
    throw err;
  }
  return text.replace(/\n{3,}/g, '\n\n');
}

async function importFile(f) {
  if (isImage(f)) return addPages([f], false);
  const isPdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
  try {
    if (isPdf) toast('Reading PDF…');
    const text = isPdf ? await pdfToText(f) : await f.text();
    putImportedText(text, f.name.replace(/\.[^.]+$/, ''), false);
    if (isPdf && app.view === 'edit') toast('PDF imported. Check the character list below and tidy anything that came through oddly, then tap Save.');
  } catch (e) {
    if (e.code !== 'NO_TEXT') { toast(e.message || 'Could not read that file.'); return; }
    // A scanned PDF: read its pages as pictures instead.
    try {
      const pages = await pdfPagesToImages(f);
      const title = $('#ed-title');
      if (title && !title.value) title.value = f.name.replace(/\.[^.]+$/, '');
      addPages(pages, false);
      toast(`This PDF is scanned pages, so they've been added below (${pages.length}). Tap Read ${pages.length} pages.`);
    } catch (err) {
      tray.progress = '';
      refreshTray();
      toast(err.message || "Couldn't open the PDF's pages.");
    }
  }
}

// Puts imported text in the editor (or, if you've moved on, keeps it as an unsaved draft so it's never lost).
function putImportedText(text, title, append) {
  if (app.view !== 'edit') {
    const d = pendingDraft() || app.editing || { id: null, title: '', raw: '' };
    saveJSON(LS_DRAFT, { ...d, title: d.title || title, raw: append && d.raw.trim() ? d.raw.trimEnd() + '\n\n' + text : text });
    toast('Your import is ready. Tap "Continue editing" on the home screen to finish it.');
    if (app.view === 'library') render();
    return;
  }
  const box = $('#ed-raw');
  box.value = append && box.value.trim() ? box.value.trimEnd() + '\n\n' + text : text;
  if (!$('#ed-title').value) $('#ed-title').value = title;
  updatePreview();
  saveDraft();
}

// ---------- Free script library (public-domain plays and monologues in library/) ----------
const lib = { plays: null, monologues: null, error: '', tab: 'monologues', q: '', gender: '', tone: '', open: null };

async function loadLibrary() {
  if (lib.plays || lib.loading) return;
  lib.loading = true;
  try {
    const [plays, monologues] = await Promise.all(['library/plays.json', 'library/monologues.json'].map(async u => {
      const res = await fetch(u, { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      return res.json();
    }));
    Object.assign(lib, { plays, monologues, error: '' });
  } catch {
    lib.error = location.protocol === 'file:'
      ? 'The free library needs the app opened from its web address, https://sqnazzal.github.io/line-learner/.'
      : "Couldn't load the free library. Check your connection and try again.";
  } finally {
    lib.loading = false;
    if (app.view === 'browse') render();
  }
}

const minutesFor = words => Math.max(0.5, Math.round(words / 130 * 2) / 2); // about 130 spoken words a minute
const libMatch = (q, ...fields) => !q || fields.join(' ').toLowerCase().replace(/[’‘]/g, "'").includes(q);

function renderBrowse() {
  loadLibrary();
  const q = lib.q.trim().toLowerCase().replace(/[’‘]/g, "'");
  const tab = (id, label) => `<button class="seg${lib.tab === id ? ' on' : ''}" data-action="lib-tab" data-tab="${id}" aria-pressed="${lib.tab === id}">${label}</button>`;
  const chip = (key, val, label) => `<button class="chip${lib[key] === val ? ' on' : ''}" data-action="lib-filter" data-key="${key}" data-val="${val}" aria-pressed="${lib[key] === val}">${label}</button>`;
  return `<section class="stack">
    <div class="row between wrap"><h1>Free scripts</h1><button class="btn ghost" data-action="home">${icon('back')} Your scripts</button></div>
    <p class="lede">Classic plays and audition monologues that are free to use. Add one and it's ready to listen to and rehearse.</p>
    <div class="row wrap">
      <div class="segmented" role="group" aria-label="What to show">${tab('monologues', 'Monologues')}${tab('plays', 'Full plays')}</div>
      <input id="lib-q" class="search" type="search" value="${esc(lib.q)}" placeholder="Search by play, character, author or words" aria-label="Search the free library">
    </div>
    ${lib.tab === 'monologues' ? `<div class="row wrap chips">${chip('gender', '', 'Everyone')}${chip('gender', 'f', 'Female')}${chip('gender', 'm', 'Male')}<span class="chip-gap"></span>${chip('tone', '', 'Any tone')}${chip('tone', 'Dramatic', 'Dramatic')}${chip('tone', 'Comedic', 'Comedic')}</div>` : ''}
    <div id="lib-results">${libResultsHtml(q)}</div>
    <p class="muted small">These are public-domain texts. Plays by Chekhov, Ibsen, Molière and Rostand are older English translations, so the wording may differ from the edition your production or audition uses. Modern plays are under copyright: import your own copy, if your production's license or the publisher allows it. Something here that shouldn't be? <button class="link-btn" data-action="feedback" data-kind="copyright">Report a copyright concern</button>.</p>
  </section>`;
}

// Where a library text comes from (and who translated it), so it can be checked against your edition.
function libSourceHtml(p) {
  if (!p?.gutenberg) return '';
  const by = p.translator ? `Translated by ${esc(p.translator)}` : p.translator === '' ? 'Older English translation (translator not named)' : '';
  return `<span class="muted small">${by ? `${by} · ` : ''}Public domain, from <a href="https://www.gutenberg.org/ebooks/${p.gutenberg}" target="_blank" rel="noopener">Project Gutenberg #${p.gutenberg}</a></span>`;
}

function libResultsHtml(q) {
  if (lib.error) return `<p class="note">${esc(lib.error)}</p>`;
  if (!lib.plays) return '<p class="muted">Loading the library…</p>';
  if (lib.tab === 'plays') {
    const plays = lib.plays.filter(p => libMatch(q, p.title, p.author, p.genre, p.cast.join(' ')));
    if (!plays.length) return '<p class="muted">No plays match that search.</p>';
    return `<ul class="lib-list">${plays.map(p => `<li class="card lib-card">
      <div class="lib-main"><b>${esc(p.title)}</b><span class="muted small">${esc(p.author)} · ${esc(p.genre)} · ${p.speeches.toLocaleString()} speeches</span>
      <span class="small">${esc(p.cast.slice(0, 8).map(titleCase).join(', '))}</span>
      ${libSourceHtml(p)}</div>
      <button class="btn primary" data-action="lib-add-play" data-slug="${esc(p.slug)}">Add</button></li>`).join('')}</ul>`;
  }
  const monos = lib.monologues
    .map((m, i) => ({ ...m, i }))
    .filter(m => (!lib.gender || m.gender === lib.gender) && (!lib.tone || m.tone === lib.tone))
    .filter(m => libMatch(q, m.character, m.play, m.author, m.tone, m.text))
    // Best matches first: the famous opening words, the character or the play, before a word deep in the speech.
    .sort((a, b) => (libMatch(q, b.firstWords, b.character, b.play) ? 1 : 0) - (libMatch(q, a.firstWords, a.character, a.play) ? 1 : 0));
  if (!monos.length) return '<p class="muted">No monologues match. Try another word or filter.</p>';
  return `<ul class="lib-list">${monos.map(m => `<li class="card lib-card">
    <div class="lib-main">
      <b>${esc(titleCase(m.character))}</b><span class="muted small">${esc(m.play)} · ${esc(m.author)}</span>
      <span class="small">“${esc(m.firstWords.replace(/[\s.,;:!?]+$/, ''))}…”</span>
      ${libSourceHtml(lib.plays.find(p => p.title.toLowerCase() === m.play.toLowerCase()))}
      <span class="row wrap tags"><span class="tag">${m.gender === 'f' ? 'Female' : 'Male'}</span><span class="tag">${esc(m.tone)}</span><span class="tag">About ${minutesFor(m.words)} min</span></span>
      ${lib.open === m.i ? `<p class="lib-preview">${fmt(m.text)}</p>` : ''}
    </div>
    <div class="lib-actions">
      <button class="btn primary" data-action="lib-add-mono" data-i="${m.i}">Add</button>
      <button class="btn ghost" data-action="lib-preview" data-i="${m.i}">${lib.open === m.i ? 'Hide' : 'Read'}</button>
    </div></li>`).join('')}</ul>`;
}

function addLibraryScript(title, raw, myChar) {
  const s = makeScript(title, raw);
  if (myChar) s.myChar = myChar;
  scripts.push(s);
  saveScripts();
  openScript(s.id);
}

// ---------- Unsaved script drafts ----------
// The editor's text is kept as you type or import, so leaving the page or tapping elsewhere never loses it.
const LS_DRAFT = 'lineLearner.draft';
function saveDraft() {
  const t = $('#ed-title'), r = $('#ed-raw');
  if (!t || !r || !app.editing) return;
  Object.assign(app.editing, { title: t.value, raw: r.value });
  saveJSON(LS_DRAFT, app.editing);
}
function clearDraft() {
  try { localStorage.removeItem(LS_DRAFT); } catch { /* nothing saved */ }
}
function pendingDraft() {
  const d = loadJSON(LS_DRAFT, null);
  return d && typeof d.raw === 'string' && d.raw.trim() ? d : null;
}

// ---------- Importing screenshots (read by OpenAI) ----------
const VISION_MODEL = 'gpt-6-luna';
const SHOT_PROMPT = `These are photos or screenshots of a theatre script or audition sides, in reading order. Transcribe them into plain text in exactly this format:
- Transcribe only the PRINTED or typed script. Ignore everything handwritten: blocking notes (like "X DSL", "cross to chair", "sit"), arrows, circles, brackets, margin notes, pencil or pen marks, sticky notes and doodles. Never copy a handwritten word into the script.
- Each speech on its own line as CHARACTER NAME: the words they say. Join speeches that wrap across lines or continue onto the next screenshot.
- Stage directions in (parentheses), on their own line or inside the speech where they appear.
- Act or scene headings on their own line starting with "# ".
- Keep every spoken word exactly as written. Do not summarize, correct or add anything.
- Leave out page numbers, running headers, watermarks, and any phone or app interface (status bar, buttons, toolbars).
- If it's a monologue with no character names, write each paragraph on its own line without a name.
Reply with only the transcribed script.`;

const isImage = f => (f.type || '').startsWith('image/') || /\.(png|jpe?g|heic|heif|webp|gif)$/i.test(f.name);

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Couldn't open ${file.name}.`)); };
    img.src = url;
  });
}

// Shrinks big photos so uploads stay quick, while keeping script text sharp enough to read.
async function imageToDataUrl(file, max = 2400) {
  const img = await loadImage(file);
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

const LYRICS_PROMPT = `These are screenshots of song lyrics or sheet music, in order. Transcribe only the sung words:
- One sung line per line, with a blank line between verses or sections.
- Keep a section label like [Chorus] or [Verse 2] on its own line if the screenshot shows one.
- Leave out chord symbols, musical notation, page numbers, and any phone or app interface.
- Keep every word exactly as written. Reply with only the lyrics.
- Transcribe only printed or typed lyrics. Ignore everything handwritten: notes, breath marks, arrows, circles, pencil or pen marks.`;

// How to treat printed lines that have been crossed out or marked by hand (actors often cross out cuts).
const markedTextRule = skipCuts => skipCuts
  ? '\n- Printed text that has been crossed out or struck through by hand is a cut: leave it out. Printed text that is only highlighted, underlined or circled stays in.'
  : '\n- Keep all printed text, even where it has been highlighted, underlined, circled or crossed out by hand.';

async function readScreenshots(images, prompt = SHOT_PROMPT) {
  checkAiBudget();
  if (!ai.key) {
    const { text = '' } = await (await sharedFetch('/read', { prompt, images })).json();
    countAiUse({ pages: images.length });
    return text.replace(/^```[a-z]*\n?|```\s*$/gi, '').trim();
  }
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + ai.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL,
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt },...images.map(url => ({ type: 'input_image', image_url: url, detail: 'high' }))] }],
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch { /* no details */ }
    throw new Error(res.status === 401 ? "OpenAI didn't accept your key. Check it under Voices for each character."
      : res.status === 429 ? 'OpenAI says you are out of credit or over your limit.'
      : `OpenAI couldn't read the screenshots (${res.status}). ${detail}`);
  }
  const data = await res.json();
  countAiUse({ pages: images.length });
  const text = data.output_text ?? (data.output || []).flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('');
  return text.replace(/^```[a-z]*\n?|```\s*$/gi, '').trim();
}

// ---------- Pages tray: photos, screenshots or scanned-PDF pages waiting to be read ----------
// Pages collect here (take photos one after another, or choose many at once), then are read in order,
// six at a time. Long scripts can take a while, so progress shows, the screen stays on, a failed batch is
// retried once, and if it stops, what's read so far is kept and the rest stay here to continue.
const tray = { pages: [], reading: false, stop: false, progress: '' };
const BATCH = 6;

function addPages(files, sortByTime) {
  files = files.filter(isImage);
  if (!files.length) return;
  // Screenshots and photos chosen together are put in the order they were taken.
  if (sortByTime) files.sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const f of files) tray.pages.push({ blob: f, url: URL.createObjectURL(f) });
  tray.progress = '';
  refreshTray();
  toast(`${files.length === 1 ? 'Page' : `${files.length} pages`} added. ${tray.pages.length} ready to read.`);
}

// Kept for any caller that hands over images directly.
const importScreenshots = files => addPages(files, true);

// Who pays for reading photos and scanned pages: Shannon's shared access (it covers reading pages as well as
// voices) or your own OpenAI key.
function readingAccessNote() {
  if (ai.key) return 'Uses your OpenAI key.';
  if (usingShared()) return "Uses Shannon's shared access (it covers reading pages, not just voices), from your monthly share.";
  return "Needs one of these, both under <b>Voices for each character</b> on any script: in one of Shannon's groups, sign in and turn on <b>Use Shannon's shared voices</b> (that covers reading pages too, no key needed); or add your own OpenAI key.";
}

function trayHtml() {
  const n = tray.pages.length, song = app.editing?.kind === 'song';
  const shown = tray.pages.slice(0, 48);
  return `<div class="card stack-sm tray" id="tray">
    <b>${song ? 'Lyrics from photos or screenshots' : 'Script from photos or screenshots'}${n ? ` <span class="muted small">· ${n} ${n === 1 ? 'page' : 'pages'} ready</span>` : ''}</b>
    <p class="muted small">Take a photo of each page (tap Take photo again for the next one), or choose screenshots. They're read in order and added to the end of the text. ${readingAccessNote()}</p>
    <div class="row wrap">
      <label class="btn">Take photo<input type="file" id="ed-cam" accept="image/*" capture="environment" hidden></label>
      <label class="btn">Choose photos<input type="file" id="ed-shots" accept="image/*" multiple hidden></label>
      ${n && !tray.reading ? `<button class="btn primary" data-action="tray-read">Read ${n} ${n === 1 ? 'page' : 'pages'}</button><button class="btn ghost" data-action="tray-clear">Clear</button>` : ''}
      ${tray.reading ? '<button class="btn ghost" data-action="tray-stop">Stop</button>' : ''}
    </div>
    <p class="muted small">${song ? 'Only the printed lyrics are read; handwritten notes are ignored.' : 'Handwriting (blocking, notes, arrows) is ignored; only the printed script is read.'}</p>
    ${song ? "" : `<label class="check-row small"><input type="checkbox" data-setting="skipCuts" ${settings.skipCuts ? 'checked' : ''}${tray.reading ? ' disabled' : ''}><span>Leave out lines crossed out by hand (cuts)</span></label>`}
    ${trayStatusHtml()}
    ${n ? `<div class="thumbs">${shown.map((p, i) => `<figure class="thumb"><img src="${p.url}" alt="Page ${i + 1}" loading="lazy"><figcaption>${i + 1}</figcaption>
      ${tray.reading ? '' : `<button class="thumb-x" data-action="tray-remove" data-i="${i}" aria-label="Remove page ${i + 1}">×</button>`}</figure>`).join('')}
      ${n > shown.length ? `<span class="muted small">and ${n - shown.length} more</span>` : ''}</div>` : ''}
  </div>`;
}

// Progress while preparing a scanned PDF's pages or reading pages: a bar, where it's up to, and a rough time left.
function trayStatusHtml() {
  const job = tray.job;
  if (!job) return tray.progress ? `<p class="small" role="status">${esc(tray.progress)}</p>` : '';
  const pct = Math.round(100 * job.done / Math.max(1, job.total));
  let left = '';
  if (job.done > 0 && job.done < job.total) {
    const mins = (Date.now() - job.started) / job.done * (job.total - job.done) / 60000;
    left = mins < 1 ? ' · under a minute left' : ` · about ${Math.round(mins)} min left`;
  }
  return `<div class="tray-status" role="status">
    <div class="bar" aria-hidden="true"><div style="width:${pct}%"></div></div>
    <p class="small"><b>${esc(job.label)}</b>${left}</p>
    ${tray.progress ? `<p class="muted small">${esc(tray.progress)}</p>` : ''}
  </div>`;
}

function refreshTray() {
  const el = $('#tray');
  if (el) el.outerHTML = trayHtml();
}

// The last speaker read so far, so a speech that runs over a page break keeps its name.
const lastSpeaker = text => (text.match(/^([^:\n()#]{1,40}):/gm) || []).at(-1)?.slice(0, -1).trim() || '';

async function readTray() {
  if (tray.reading || !tray.pages.length) return;
  if (!aiAvailable()) { toast('Reading pages needs the AI: add your own OpenAI key or turn on shared voices under "Voices for each character" on any script, or paste the text instead.'); return; }
  Object.assign(tray, { reading: true, stop: false });
  keepAwake(true);
  const total = tray.pages.length, song = app.editing?.kind === 'song';
  let done = 0, readAny = false;
  tray.job = { label: '', done: 0, total, started: Date.now() };
  try {
    while (tray.pages.length && !tray.stop) {
      const batch = tray.pages.slice(0, BATCH);
      Object.assign(tray.job, { done, label: `Reading pages ${done + 1} to ${done + batch.length} of ${total}` });
      tray.progress = 'Keep this screen open until it finishes.';
      refreshTray();
      const sofar = $('#ed-raw')?.value || pendingDraft()?.raw || '';
      const who = song ? '' : lastSpeaker(sofar);
      const prompt = (song ? LYRICS_PROMPT : SHOT_PROMPT) + markedTextRule(settings.skipCuts)
        + (who ? `\nThe previous page ended with ${who} speaking. If the first page starts in the middle of a speech, begin with "${who}: ".` : '');
      let text;
      for (let attempt = 0; ; attempt++) {
        try {
          text = await readScreenshots(await Promise.all(batch.map(p => imageToDataUrl(p.blob))), prompt);
          break;
        } catch (e) {
          if (attempt >= 1 || /key|credit|limit/i.test(e.message)) throw e;
          await new Promise(r => setTimeout(r, 2500)); // one retry for a hiccup
        }
      }
      if (text) { putImportedText(text, '', true); readAny = true; }
      batch.forEach(p => URL.revokeObjectURL(p.url));
      tray.pages.splice(0, batch.length);
      done += batch.length;
    }
    tray.progress = tray.stop && tray.pages.length ? `Stopped after ${done} of ${total} pages. Tap Read to carry on with the rest.` : '';
    if (!tray.pages.length) toast(readAny ? `All ${total} ${total === 1 ? 'page' : 'pages'} read. Check the text and the character list, then tap Save.` : "I couldn't find any text in those pages.");
  } catch (e) {
    tray.progress = `Stopped at page ${done + 1} of ${total}: ${e.message || 'something went wrong.'} Pages already read are in the text box. Tap Read to try the rest again.`;
  } finally {
    tray.reading = false;
    tray.job = null;
    keepAwake(false);
    refreshTray();
  }
}

// A scanned PDF (pictures of pages, no text inside) becomes pages in the tray, one image per page.
async function pdfPagesToImages(file) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  tray.job = { label: '', done: 0, total: doc.numPages, started: Date.now() };
  for (let n = 1; n <= doc.numPages; n++) {
    Object.assign(tray.job, { done: n - 1, label: `Preparing the scanned pages: ${n} of ${doc.numPages}` });
    tray.progress = '';
    refreshTray();
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, 1800 / Math.max(base.width, base.height)) });
    const c = document.createElement('canvas');
    c.width = Math.round(viewport.width);
    c.height = Math.round(viewport.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    out.push(new File([blob], `page-${n}.jpg`, { type: 'image/jpeg', lastModified: n }));
  }
  tray.progress = '';
  tray.job = null;
  return out;
}

// ---------- Find and fix (in the editor) ----------
const finder = { idx: -1, undo: null };

// Find and replace in the text box. In the script editor it also holds Fix or merge character names.
function findBarHtml(names = false) {
  return `<details class="card find" id="find-box"${app.findOpen ? ' open' : ''}>
    <summary>Find and fix<span id="find-dupes" class="muted small"></span></summary>
    <div class="stack-sm">
      <div class="row wrap"><input id="find-q" type="search" class="search" placeholder="Find, e.g. a misread name" aria-label="Find" autocapitalize="off" spellcheck="false">
        <span id="find-count" class="muted small" role="status"></span></div>
      <div class="row wrap"><input id="find-r" type="search" class="search" placeholder="Replace with" aria-label="Replace with" autocapitalize="off" spellcheck="false"></div>
      <div class="row wrap">
        <button class="btn ghost" data-action="find-prev">Previous</button>
        <button class="btn ghost" data-action="find-next">Next</button>
        <button class="btn" data-action="find-replace">Replace</button>
        <button class="btn" data-action="find-all">Replace all</button>
        <label class="check-row small"><input type="checkbox" id="find-case"><span>Match case</span></label>
        <button class="btn ghost" data-action="find-undo" id="find-undo" hidden>Undo replace all</button>
      </div>
      ${names ? '<div id="merge-box" class="stack-sm"></div>' : ''}
    </div>
  </details>`;
}

function findMatches() {
  const q = $('#find-q')?.value || '', box = $('#ed-raw');
  if (!q || !box) return [];
  const exact = $('#find-case')?.checked;
  const hay = exact ? box.value : box.value.toLowerCase(), needle = exact ? q : q.toLowerCase();
  const out = [];
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) out.push(at);
  return out;
}

function updateFindCount() {
  const el = $('#find-count');
  if (!el) return;
  const n = findMatches().length, q = $('#find-q').value;
  el.textContent = !q ? '' : !n ? 'No matches' : finder.idx >= 0 ? `${finder.idx + 1} of ${n}` : `${n} ${n === 1 ? 'match' : 'matches'}`;
}

// Scrolls the text box so the selection is in view, by measuring the text before it in a hidden copy.
function scrollBoxTo(box, at) {
  const mirror = document.createElement('div');
  const cs = getComputedStyle(box);
  Object.assign(mirror.style, {
    position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
    width: box.clientWidth + 'px', font: cs.font, lineHeight: cs.lineHeight, padding: cs.padding, letterSpacing: cs.letterSpacing,
  });
  mirror.textContent = box.value.slice(0, at) + '.';
  document.body.appendChild(mirror);
  box.scrollTop = Math.max(0, mirror.scrollHeight - box.clientHeight / 2);
  mirror.remove();
}

function showMatch(step) {
  const ms = findMatches(), box = $('#ed-raw');
  if (!ms.length) { finder.idx = -1; updateFindCount(); return; }
  finder.idx = finder.idx < 0 ? (step > 0 ? 0 : ms.length - 1) : (finder.idx + step + ms.length) % ms.length;
  const at = ms[finder.idx];
  box.focus({ preventScroll: true });
  box.setSelectionRange(at, at + $('#find-q').value.length);
  scrollBoxTo(box, at);
  box.closest('label')?.scrollIntoView({ block: 'nearest' });
  updateFindCount();
}

function textChanged() {
  updatePreview();
  saveDraft();
}

function statDot(st) {
  const dot = (cls, label) => `<span class="dot ${cls}" role="img" aria-label="${label}" title="${label}"></span>`;
  if (!st?.tries) return dot('new', 'Not practiced yet');
  if (st.last >= settings.passScore) return st.helped ? dot('close', `Working on it: got it with help (${st.last}%)`) : dot('solid', `Solid: ${st.last}%, best ${st.best}%`);
  return dot(st.last >= 50 ? 'close' : 'weak', `Working on it: last run ${st.last}%, best ${st.best}%`);
}

// "3 solid · 2 working on it · 5 not practiced"
function progressText(s, mine) {
  const n = { solid: 0, working: 0, new: 0 };
  for (const l of mine) n[lineState(s, l)]++;
  if (n.new === mine.length) return `${mine.length} ${mine.length === 1 ? 'line' : 'lines'}, not practiced yet`;
  return [n.solid && `${n.solid} solid`, n.working && `${n.working} working on it`, n.new && `${n.new} not practiced`].filter(Boolean).join(' · ');
}

function resumeHtml(s) {
  const r = resumeAt[s.id];
  if (!r || s.kind === 'song' || !s.lines[r.line]) return '';
  return `<div class="card resume-card">
    <span><b>Pick up where you left off?</b> <span class="muted">Line ${r.pos} of ${r.total} in ${{ listen: 'Listen', rehearse: 'Rehearse', type: 'Type' }[r.mode]}, ${ago(r.at)}.</span></span>
    <button class="btn primary" data-action="resume-run">${icon('play')} Pick up</button>
  </div>`;
}

function renderScript() {
  const s = current();
  const chars = [...characters(s)];
  const mine = s.lines.filter(l => isMine(s, l));
  const solid = mine.filter(l => isSolid(s, l)).length;
  const weak = weakCount(s);
  const sections = s.lines.map((l, i) => (l.type === 'section' ? i : -1)).filter(i => i >= 0);
  const [start, end] = rangeBounds(s);
  const voices = voiceList();
  const cast = castVoices(s);

  const rangeHtml = sections.length ? `<div class="row wrap">
      <label class="field inline"><span>Start at</span><select id="range-start">
        <option value="0">The beginning</option>
        ${sections.map(i => `<option value="${i}" ${i === start ? 'selected' : ''}>${esc(s.lines[i].text)}</option>`).join('')}
      </select></label>
      <label class="field inline"><span>Stop</span><select id="range-end">
        <option value="${s.lines.length}">At the end</option>
        ${sections.filter(i => i > start).map(i => `<option value="${i}" ${i === end ? 'selected' : ''}>Before ${esc(s.lines[i].text)}</option>`).join('')}
      </select></label>
    </div>` : '';

  const rows = s.lines.map((l, i) => {
    const out = i < start || i >= end ? ' out' : '';
    if (l.type === 'section') return `<li class="sec${out}">${esc(l.text)}</li>`;
    if (l.type === 'direction') return `<li class="dir${out}">${esc(l.text)}</li>`;
    const me = isMine(s, l), key = lineKey(l), has = recorded.has(key), recOn = app.rec?.key === key;
    return `<li class="ln${me ? ' mine' : ''}${out}">
      <div class="who">${esc(titleCase(l.speaker))}${me ? statDot(statOf(s, l)) : ''}${has ? '<span class="badge">recorded</span>' : ''}</div>
      <div class="txt">${fmt(l.text)}</div>
      <div class="tools">
        <button class="icon-btn" data-action="hear" data-i="${i}" title="Hear this line" aria-label="Hear this line">${icon('speaker')}</button>
        <button class="icon-btn${recOn ? ' rec-on' : ''}" data-action="rec" data-i="${i}" title="${recOn ? 'Stop recording' : has ? 'Record this line again' : 'Record this line in your own voice'}" aria-label="${recOn ? 'Stop recording' : 'Record this line'}">${icon(recOn ? 'stop' : 'mic')}</button>
        ${has ? `<button class="icon-btn" data-action="del-rec" data-i="${i}" title="Delete recording" aria-label="Delete recording">${icon('trash')}</button>` : ''}
        ${me ? `<button class="icon-btn" data-action="from-here" data-i="${i}" title="Rehearse from here" aria-label="Rehearse from here">${icon('play')}</button>` : ''}
        ${me && buildParts(l.text).length > 1 ? `<button class="icon-btn" data-action="buildup" data-i="${i}" title="Build up this speech one sentence at a time" aria-label="Build up this speech">${icon('stairs')}</button>` : ''}
      </div>
    </li>`;
  }).join('');

  return `<section class="stack">
    <div class="row between wrap">
      <h1>${esc(s.title)}</h1>
      ${s.sample ? '' : `<div class="row wrap">${typeof shareButtonHtml === 'function' ? shareButtonHtml(s) : ''}<button class="btn ghost" data-action="edit-script">Edit</button><button class="btn ghost" data-action="delete-script">Delete</button></div>`}
    </div>
    ${s.groupItem && typeof sharedStatusNote === 'function' ? sharedStatusNote(s) : ''}
    ${s.sample ? '<p class="muted">A sample scene to try things out. It isn\'t saved to your scripts, so play with it freely.</p>' : typeof sharePanelHtml === 'function' ? sharePanelHtml(s) : ''}
    ${supportNote()}
    <div class="card stack-sm">
      ${s.sample ? '' : `<label class="field inline"><span>Category</span><select data-cat-id="${s.id}" aria-label="Category">${categoryOptions(catOf(s))}</select></label>`}
      <label class="field inline"><span>I'm playing</span><select id="my-char">
        <option value="">Choose a character…</option>
        ${chars.map(([c, n]) => `<option value="${esc(c)}" ${c === s.myChar ? 'selected' : ''}>${esc(titleCase(c))} (${n} ${n === 1 ? 'line' : 'lines'})</option>`).join('')}
      </select></label>
      ${rangeHtml}
      ${s.kind !== 'song' && s.myChar ? `<label class="check-row"><input type="checkbox" id="cues-only" ${app.cuesOnly ? 'checked' : ''}><span><b>Just my cues and lines.</b> Listen, Rehearse and Type play only the line before each of yours, then yours, and skip the rest.</span></label>` : ''}
      ${mine.length ? `<div class="meter">${bar(solid / mine.length)}<span class="muted small">${progressText(s, mine)}</span></div>` : ''}
    </div>
    ${resumeHtml(s)}
    <div class="modes">
      ${s.kind === 'song' ? `<button class="mode" data-action="sing">${icon('headphones')}<b>Sing along</b><span>${s.song?.spotify ? 'Play the real song with the lyrics highlighted, and hide words as you learn them.' : 'Learn the lyrics. Add the Spotify song (Edit) to sing with the track.'}</span></button>` : ''}
      <button class="mode" data-action="listen">${icon('headphones')}<b>Listen</b><span>Hear the scene like an audio track. It pauses for you to say your lines.</span></button>
      ${s.kind !== 'song' ? `<button class="mode" data-action="track">${icon('headphones')}<b>Listen, screen off</b><span>One audio track of the scene that keeps playing when your phone locks, like a podcast.${aiReady() ? '' : ' <i>Needs the AI voices (set up under Voices below) or your recordings of every line.</i>'}</span></button>` : ''}
      <button class="mode" data-action="rehearse" ${s.myChar ? '' : 'disabled'}>${icon('mic')}<b>Rehearse</b><span>Your cues are read aloud. Say your lines and the mic checks them.</span></button>
      <button class="mode" data-action="type" ${s.myChar ? '' : 'disabled'}>${icon('keyboard')}<b>Type your lines</b><span>For the train or anywhere you can't talk. Read your cues, type your lines, and get the same word-by-word check.</span></button>
      <button class="mode" data-action="weak" ${s.myChar && weak ? '' : 'disabled'}>${icon('target')}<b>Drill weak lines</b><span>${s.myChar ? (weak ? `${weak} ${weak === 1 ? 'line' : 'lines'} you're working on` : mine.some(l => isSolid(s, l)) ? 'Nothing shaky right now' : 'Nothing to drill yet: rehearse first') : 'Pick your character first'}</span></button>
    </div>
    <details id="voices" class="card" ${app.voicesOpen ? 'open' : ''}>
      <summary>Voices for each character</summary>
      ${aiPanelHtml()}
      <p class="muted small">Want a real voice instead? The record button on any line records it on this device (recordings are never uploaded or shared). Recording a friend or castmate? Ask them first.</p>
      ${voices.length || aiReady() ? chars.map(([c]) => {
        const { gender, voice: auto } = cast.get(c);
        const lockAttr = voiceEditsLocked() ? ' disabled title="Locked: unlock with the PIN above to change AI voices"' : '';
        const label = esc(titleCase(c));
        let voicePicker;
        if (aiReady()) {
          const chosen = s.aiVoices?.[c] || '';
          const opt = v => `<option value="${v}" ${v === chosen ? 'selected' : ''}>${capital(v)}</option>`;
          const other = gender === 'f' ? 'm' : 'f';
          voicePicker = `<select data-ai-voice-char="${esc(c)}"${lockAttr} aria-label="${label}: voice">
            <option value="">Automatic: ${capital(aiCast(s).get(c))}</option>
            <optgroup label="${gender === 'f' ? 'Female' : 'Male'} voices">${AI_VOICES[gender].map(opt).join('')}</optgroup>
            <optgroup label="${other === 'f' ? 'Female' : 'Male'} voices">${AI_VOICES[other].map(opt).join('')}</optgroup>
          </select>`;
        } else {
          const chosen = s.voices?.[c] || '';
          const opt = o => `<option value="${esc(o.voiceURI)}" ${o.voiceURI === chosen ? 'selected' : ''}>${esc(voiceLabel(o))}</option>`;
          const matching = voices.filter(o => voiceGender(o) === gender), others = voices.filter(o => voiceGender(o) !== gender);
          voicePicker = `<select data-voice-char="${esc(c)}" aria-label="${label}: voice">
            <option value="">Automatic${auto ? `: ${esc(voiceLabel(auto))}` : ''}</option>
            ${matching.length ? `<optgroup label="${gender === 'f' ? 'Female' : 'Male'} voices">${matching.map(opt).join('')}</optgroup>` : ''}
            ${others.length ? `<optgroup label="Other voices">${others.map(opt).join('')}</optgroup>` : ''}
          </select>`;
        }
        return `<div class="voice-row"><span class="voice-name">${label}</span>
          <select data-gender-char="${esc(c)}"${lockAttr} aria-label="${label}: female or male">
            <option value="f" ${gender === 'f' ? 'selected' : ''}>Female</option>
            <option value="m" ${gender === 'm' ? 'selected' : ''}>Male</option>
          </select>
          ${voicePicker}
          <button class="icon-btn" data-action="test-voice" data-char="${esc(c)}" title="Test this voice" aria-label="Test this voice">${icon('speaker')}</button>
          ${aiReady() ? `<input class="voice-style" data-style-char="${esc(c)}"${lockAttr} value="${esc(s.aiStyles?.[c] || '')}" placeholder="How they sound (optional), e.g. warm and elderly, nervous teenager" aria-label="${label}: how they sound">` : ''}
          <label class="voice-speed"><span>Speed</span>
            <input type="range" min="0.5" max="1.5" step="0.05" value="${speedOf(c)}" data-speed-char="${esc(c)}" aria-label="${label}: speed">
            <output>${speedLabel(speedOf(c))}</output>
          </label></div>`;
      }).join('') : '<p class="muted">No computer voices found in this browser.</p>'}
      <p class="muted small">Voices are picked to match each character. Change Female/Male, pick a specific voice, or speed anyone up or down (on top of the overall reading speed in Practice settings). ${IS_IOS ? 'For more natural voices on iPhone, open the Settings app, search for "Voices", and download an "Enhanced" or "Premium" English (US) voice.' : ''}</p>
      <p class="muted small">Tip: use the ${icon('mic')} button on any line to record it yourself (or have a friend read your cues). Recordings play instead of the computer voice.</p>
    </details>
    <h2>Script</h2>
    <ol class="lines">${rows}</ol>
  </section>`;
}

// ---------- Player ----------
const STATUS_TEXT = {
  speaking: 'Speaking', you: 'Your line', gap: 'Your turn: say it out loud', answer: 'Here is how it goes',
  listening: 'Listening… say your line', prompting: 'Here is your line', good: 'Nailed it', missed: 'Not quite',
  self: 'Say it, then mark yourself', paused: 'Paused', typing: 'Your line: type it', reading: 'Cue',
};

// Type mode with the cues shown on screen instead of read aloud (the quiet way, for a train or a library).
const quiet = () => P.mode === 'type' && settings.typeCues !== 'speak';

function newPlayer(mode, order) {
  return {
    mode, order, orderPos: 0, status: 'idle', reveal: settings.hint, result: null, transcript: '', note: '',
    running: false, token: null, run: { lines: 0, solid: 0, helped: 0 }, bu: null, finishListen: null, choose: null,
  };
}
let P = newPlayer('listen', []);

const pill = () => (STATUS_TEXT[P.status] ? `<span class="pill ${P.status}">${(P.status === 'good' && P.goodText) || STATUS_TEXT[P.status]}</span>` : '');

// A little variety when a line lands, and a special word for one that used to give you trouble.
const GOOD_WORDS = ['Nailed it', 'Right on cue', 'Off book!', 'Solid', 'Bravo'];
const goodWord = wasShaky => (wasShaky ? "That line's looking solid" : GOOD_WORDS[Math.floor(Math.random() * GOOD_WORDS.length)]);

function renderPlayer() {
  const s = current();
  const label = { buildup: 'Build up', listen: 'Listen', rehearse: 'Rehearse', type: 'Type' }[P.mode];
  return `<section class="player stack">
    <h1 class="sr-only">${label}: ${esc(s.title)}</h1>
    <p id="sr-status" class="sr-only" aria-live="polite"></p>
    <div class="row between">
      <button class="btn ghost" data-action="back">${icon('back')} Script</button>
      <span class="mode-tag">${label}${s.myChar ? ` · as ${esc(titleCase(s.myChar))}` : ''}${P.drill ? ' · weak lines' : P.cuesOnly ? ' · cues only' : ''}${noMic && P.mode !== 'type' ? ` · ${P.mode === 'listen' ? 'timed pauses, ' : ''}no microphone` : ''}</span>
    </div>
    <div id="stage" class="stage"></div>
    <div id="controls" class="controls"></div>
    <p class="muted small center keys"${settings.shortcuts ? '' : ' hidden'}><kbd>Space</kbd> play/pause · <kbd>←</kbd> <kbd>→</kbd> move · <kbd>H</kbd> hint · <kbd>L</kbd> hear line · <kbd>Enter</kbd> done speaking</p>
    ${settingsHtml()}
  </section>`;
}

function refreshPlayer() {
  if (app.view !== 'player') return;
  const s = current(), key = focusKey(document.activeElement);
  announce(s);
  $('#stage').innerHTML = P.status === 'done' ? doneHtml(s) : P.mode === 'buildup' ? buildUpStageHtml(s) : lineStageHtml(s);
  $('#controls').innerHTML = `
    <button class="ctrl" data-action="prev" aria-label="Previous">${icon('prev')}</button>
    <button class="ctrl big" data-action="toggle" aria-label="${P.running ? 'Pause' : 'Play'}">${icon(P.running ? 'pause' : 'play')}</button>
    <button class="ctrl" data-action="next" aria-label="Next">${icon('next')}</button>`;
  restoreFocus(key);
  const box = $('#typed');
  if (box && document.activeElement?.id !== 'typed') {
    box.focus({ preventScroll: true });
    box.selectionStart = box.selectionEnd = box.value.length;
  }
}

// Tells screen readers what just happened in the player (the result of a line, whose turn it is).
// Lines read aloud by the app aren't repeated; in quiet Type mode the text is included, since nothing is spoken.
function announce(s) {
  const el = $('#sr-status');
  if (!el || P.mode === 'buildup') return;
  const item = s.lines[P.order[P.orderPos]];
  let msg = '';
  if (P.status === 'done') msg = "That's a wrap.";
  else if (P.status === 'paused') msg = `Paused. ${P.note}`;
  else if (P.status === 'typing') msg = 'Your line. Type it, then press Enter.';
  else if (P.status === 'listening') msg = 'Your line. Say it.';
  else if (P.status === 'reading' && item) msg = `${titleCase(item.speaker)}: ${spokenText(item.text)}`;
  else if (P.status === 'prompting' && quiet() && item) msg = `Your line is: ${spokenText(item.text)}`;
  else if ((P.status === 'good' || P.status === 'missed') && P.result) {
    const missed = words(item.text).filter((w, i) => !P.result.hit[i]);
    msg = `${pill().replace(/<[^>]+>/g, '')}, ${P.result.score} percent.${missed.length ? ` Missed: ${missed.join(', ')}.` : ''}`;
  }
  if (P.status === 'typing' && quiet() && item) {
    const cue = s.lines[prevLineIndex(s, P.order[P.orderPos])];
    if (cue) msg = `${titleCase(cue.speaker)}: ${spokenText(cue.text)}. ${msg}`;
  }
  if (msg && el.dataset.said !== P.status + P.orderPos + msg) { el.dataset.said = P.status + P.orderPos + msg; el.textContent = msg; }
}

function myActions() {
  return `<div class="row wrap card-actions">
    <button class="btn" data-action="hint" ${P.reveal === 'full' ? 'disabled' : ''}>${icon('bulb')} Hint</button>
    ${quiet() ? (P.status === 'typing' ? `<button class="btn" data-action="hearit">${icon('bulb')} Show me</button>` : '')
      : `<button class="btn" data-action="hearit">${icon('speaker')} Hear it</button>`}
    ${P.status === 'typing' ? `<button class="btn primary" data-action="type-check">${icon('check')} Check</button>` : ''}
    ${P.status === 'prompting' && quiet() ? '<button class="btn primary" data-action="choose">Try again</button>' : ''}
    ${P.status === 'listening' ? `<button class="btn primary" data-action="done-speaking">${icon('check')} Done</button>` : ''}
    ${P.status === 'self' ? '<button class="btn good" data-action="choose" data-choice="got">Got it</button><button class="btn bad" data-action="choose" data-choice="miss">Missed it</button>' : ''}
  </div>`;
}

function myLineBody(text) {
  if (['prompting', 'answer', 'you'].includes(P.status)) return fmt(text);
  if (P.result) return diffHtml(text, P.result);
  return hintHtml(text, P.reveal);
}

function lineStageHtml(s) {
  const pos = P.orderPos, item = s.lines[P.order[pos]];
  let prevIdx = -1;
  for (let p = pos - 1; p >= 0; p--) if (s.lines[P.order[p]].type === 'line') { prevIdx = P.order[p]; break; }
  const prev = prevIdx >= 0 && item.type === 'line'
    ? `<div class="context"><span class="who">${esc(titleCase(s.lines[prevIdx].speaker))}</span> ${fmt(s.lines[prevIdx].text)}</div>` : '';

  let card;
  if (item.type === 'section') card = `<div class="card stage-card section-card"><h2>${esc(item.text)}</h2></div>`;
  else if (item.type === 'direction') card = `<div class="card stage-card direction-card">${pill()}<p><em>${esc(item.text)}</em></p></div>`;
  else if (isMine(s, item)) {
    card = `<div class="card stage-card mine-card">
      <div class="card-head"><span class="who">You${s.myChar !== 'YOU' ? ` (${esc(titleCase(s.myChar))})` : ''}</span>${pill()}${P.result && P.status !== 'prompting' ? `<span class="score">${P.result.score}%</span>` : ''}</div>
      <p class="script-text">${myLineBody(item.text)}</p>
      ${micOn() && (P.mode === 'rehearse' || (P.mode === 'listen' && settings.listenHears)) ? `<p id="transcript" class="transcript">${esc(P.transcript)}</p>` : ''}
      ${P.status === 'typing' ? `<textarea id="typed" class="typed" rows="3" placeholder="Type your line, then Check (or press Enter)" autocapitalize="sentences" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Type your line">${esc(P.typed || '')}</textarea>` : ''}
      ${P.mode === 'type' && P.result && P.typed && P.status !== 'typing' ? `<p class="transcript">You typed: ${esc(P.typed)}</p>` : ''}
      ${myActions()}
    </div>`;
  } else {
    const go = P.status === 'reading' ? '<div class="row card-actions"><button class="btn" data-action="choose">Continue</button></div>' : '';
    card = `<div class="card stage-card"><div class="card-head"><span class="who">${esc(titleCase(item.speaker))}</span>${pill()}</div><p class="script-text">${fmt(item.text)}</p>${go}</div>`;
  }
  return `<div class="progress" aria-hidden="true"><div style="width:${Math.round(100 * (pos + 1) / P.order.length)}%"></div></div>
    <p class="muted small">${pos + 1} of ${P.order.length}</p>
    ${P.note ? `<p class="note">${esc(P.note)}</p>` : ''}
    ${prev}${card}`;
}

function buildUpStageHtml(s) {
  const { parts, k, phase } = P.bu;
  const expected = parts.slice(0, k + 1).join(' ');
  let body;
  if (P.status === 'prompting') body = esc(expected);
  else if (P.result) body = diffHtml(expected, P.result);
  else body = parts.slice(0, k + 1).map((p, j) => `<span class="${j === k ? 'new-part' : ''}">${j === k && phase === 'listen' ? esc(p) : hintHtml(p, P.reveal)}</span>`).join(' ');
  const steps = parts.map((_, j) => `<span class="step${j < k ? ' done' : j === k ? ' now' : ''}"></span>`).join('');
  return `<div class="steps" aria-hidden="true">${steps}</div>
    <p class="muted small">Piece ${k + 1} of ${parts.length}: ${phase === 'listen' ? 'listen to the next piece' : 'now say it all from the top'}</p>
    ${P.note ? `<p class="note">${esc(P.note)}</p>` : ''}
    <div class="card stage-card mine-card">
      <div class="card-head"><span class="who">You</span>${pill()}${P.result && P.status !== 'prompting' ? `<span class="score">${P.result.score}%</span>` : ''}</div>
      <p class="script-text">${body}</p>
      ${micOn() ? `<p id="transcript" class="transcript">${esc(P.transcript)}</p>` : ''}
      ${myActions()}
    </div>`;
}

function doneHtml(s) {
  const weak = s.myChar ? weakCount(s) : 0;
  const { solid, lines, helped = 0 } = P.run;
  const withHelp = helped ? ` <b>${helped}</b> more with help (they'll count once you get them without).` : '';
  let title = "That's a wrap!", msg;
  if (P.mode === 'buildup') { title = "That's the whole speech!"; msg = 'Now try it in Rehearse with hints turned off.'; }
  else if (P.mode === 'listen') msg = 'Play it again, or switch to Rehearse and say your lines out loud.';
  else if (P.drill) {
    title = solid === lines ? 'Nothing shaky left!' : "That's a wrap on the drill!";
    msg = solid === lines ? `All <b>${lines}</b> of those lines landed. Nice work.` : `<b>${solid}</b> of <b>${lines}</b> shaky lines landed on your own this time.${withHelp} The rest will get there.`;
  } else if (lines && solid === lines) msg = `Every line on the first try, no help (<b>${lines}</b> of <b>${lines}</b>). Take a bow.`;
  else msg = `You got <b>${solid}</b> of <b>${lines}</b> lines on the first try on your own.${withHelp}${lines && solid / lines >= 0.7 ? ' Looking good.' : ' Every run makes the next one easier.'}`;
  return `<div class="card stage-card done-card">
    <h2>${title}</h2>
    <p>${msg}</p>
    <div class="row wrap">
      <button class="btn primary" data-action="restart">${P.mode === 'buildup' ? 'Build it again' : 'Run it again'}</button>
      ${weak && P.mode !== 'buildup' ? `<button class="btn" data-action="weak">Drill weak lines (${weak})</button>` : ''}
      <button class="btn ghost" data-action="back">Back to script</button>
    </div>
  </div>`;
}

// Everyday choices up front; scoring and microphone timing under Advanced. Only what affects the mode you're in shows.
function settingsHtml() {
  const sel = (key, opts) => `<select data-setting="${key}">${opts.map(([v, t]) => `<option value="${v}" ${String(settings[key]) === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const chk = key => `<input type="checkbox" data-setting="${key}" ${settings[key] ? 'checked' : ''}>`;
  const rng = (key, min, max, step) => `<span class="range"><input type="range" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${settings[key]}"><output>${settingLabel(key)}</output></span>`;
  const m = P.mode, spoken = !quiet(), checked = m !== 'listen';
  const usesMic = SR && !noMic && (m === 'rehearse' || m === 'buildup' || (m === 'listen' && settings.listenHears));
  const everyday = [
    `<label><span>Text size</span>${sel('textSize', [['normal', 'Normal'], ['large', 'Large'], ['huge', 'Extra large (phone on a stand)']])}</label>`,
    spoken && `<label><span>Reading speed</span>${rng('rate', 0.6, 1.5, 0.05)}</label>`,
    m === 'listen' && `<label><span>Your lines</span>${sel('myLines', [['gapThenSpeak', 'Pause for me, then read them'], ['gap', 'Pause for me only'], ['speak', 'Read them aloud'], ['skip', 'Skip them']])}</label>`,
    `<label><span>Hints when it's your line</span>${sel('hint', [['hidden', 'No words, just blanks'], ['first', 'First few words'], ['initials', 'First letter of each word'], ['full', 'Show the whole line']])}<small class="muted">A line counts as solid only when you get it without help (a hint showing half the line or more counts as help).</small></label>`,
    m === 'type' && `<label><span>Cues</span>${sel('typeCues', [['show', 'Show them on screen (silent)'], ['speak', 'Read them aloud (headphones)']])}</label>`,
    m === 'rehearse' && `<label><span>Cue before your line</span>${sel('cueLength', [['full', 'Read the whole line'], ['last', 'Last sentence only']])}</label>`,
    m === 'listen' && `<label class="check">${chk('loop')}<span>Loop the scene</span></label>`,
    m === 'listen' && SR && (noMic
      ? '<label class="check"><input type="checkbox" disabled><span>Move on as soon as I finish my line: <b>off for now, microphone unavailable</b> (timed pauses instead)</span></label>'
      : `<label class="check">${chk('listenHears')}<span>Move on as soon as I finish my line (uses the microphone)</span></label>`),
  ];
  const advanced = [
    checked && `<label><span>Score needed to pass</span>${rng('passScore', 50, 100, 5)}</label>`,
    usesMic && `<label><span>Wait after you stop talking</span>${rng('silenceMs', 800, 4000, 100)}</label>`,
    m !== 'buildup' && `<label class="check">${chk('readDirections')}<span>${spoken ? 'Read stage directions aloud' : 'Show stage directions'}</span></label>`,
    spoken && `<label class="check">${chk('useRecordings')}<span>Use recorded voices when available</span></label>`,
    `<label class="check">${chk('shortcuts')}<span>Keyboard shortcuts (Space, arrows, H, L, Enter)</span></label>`,
  ].filter(Boolean);
  return `<details class="card settings">
    <summary>Practice settings</summary>
    <div class="settings-grid">${everyday.filter(Boolean).join('')}</div>
    ${advanced.length ? `<details class="settings-advanced"><summary class="small">Advanced</summary><div class="settings-grid">${advanced.join('')}</div></details>` : ''}
  </details>`;
}

function settingLabel(key) {
  if (key === 'rate') return `${(+settings.rate).toFixed(2)}x`;
  if (key === 'passScore') return `${settings.passScore}%`;
  if (key === 'silenceMs') return `${(settings.silenceMs / 1000).toFixed(1)}s`;
  return '';
}

// ---------- Running a scene ----------
function stopRun() {
  if (P.token) P.token.cancel();
  P.running = false;
  keepAwake(false);
}

function beginRun() {
  stopRun();
  P.running = true;
  P.note = '';
  keepAwake(true);
  return P.token = makeToken();
}

function finishRun() {
  P.running = false;
  P.status = 'done';
  saveResume();
  keepAwake(false);
  refreshPlayer();
}

function pauseRun(note = '') {
  stopRun();
  P.status = 'paused';
  P.note = note;
  refreshPlayer();
}

function leave() {
  if (app.view === 'player') saveResume();
  stopRun();
  stopRecording();
  previewToken.cancel();
  window.stopSing?.();
  if (sync.pending) { sync.pending = false; scheduleSync(); }
}

async function startPlayer(mode, order, from = 0, drill = false) {
  const s = current();
  if (mode !== 'listen' && !s.myChar) { toast('Who are you playing? Pick your character under "I\'m playing" first.'); return false; }
  const cuesOnly = !order && app.cuesOnly && !!s.myChar;
  order ||= playOrder(s);
  if (!order.length) { toast('Empty stage: nothing to practice here yet. Tap Edit to add some lines.'); return false; }
  // Settles microphone permission before anything plays, so it never pops up mid-scene.
  if (mode === 'rehearse' || (mode === 'listen' && settings.listenHears)) await ensureMic(mode);
  leave();
  P = newPlayer(mode, order);
  Object.assign(P, { drill, cuesOnly });
  if (!drill && !s.sample) saveJSON(LS_LAST, lastRun = { id: s.id, mode, cuesOnly, at: Date.now() });
  app.view = 'player';
  render();
  headphoneControls();
  run(from);
  return true;
}

// Play/pause and skip buttons on headphones (and the lock screen) work the player while it's open.
function headphoneControls() {
  if (!('mediaSession' in navigator)) return;
  const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch { /* not supported here */ } };
  set('play', () => app.view === 'player' && !P.running && togglePlay());
  set('pause', () => app.view === 'player' && P.running && togglePlay());
  set('nexttrack', () => app.view === 'player' && jump(1));
  set('previoustrack', () => app.view === 'player' && jump(-1));
}

// Remembers the line you're on in a long Listen or Rehearse run (not drills), so you can pick up there.
function saveResume() {
  const s = current();
  if (!s || P.drill || !['listen', 'rehearse', 'type'].includes(P.mode) || P.order.length < 30) return;
  if (P.status === 'done' || P.orderPos < 3) delete resumeAt[s.id];
  else resumeAt[s.id] = { mode: P.mode, line: P.order[P.orderPos], pos: P.orderPos + 1, total: P.order.length, at: Date.now() };
  saveJSON(LS_RESUME, resumeAt);
}

async function startBuildUp(i) {
  await ensureMic('buildup');
  leave();
  P = newPlayer('buildup', [i]);
  P.bu = { i, parts: buildParts(current().lines[i].text), k: 0, phase: 'listen' };
  app.view = 'player';
  render();
  runBuildUp(0);
}

async function run(from) {
  const s = current();
  const token = beginRun();
  for (let p = from; p < P.order.length; p++) {
    if (token.cancelled) return;
    const item = s.lines[P.order[p]];
    Object.assign(P, { orderPos: p, result: null, transcript: '', reveal: settings.hint, status: 'idle' });
    refreshPlayer();
    saveResume();
    if (!quiet()) aiPrefetch(s, P.order.slice(p, p + 4));
    if (item.type === 'section') await sleep(700, token);
    else if (item.type === 'direction') {
      if (settings.readDirections && quiet()) await waitRead(readMs(item.text), token);
      else if (settings.readDirections) { P.status = 'speaking'; refreshPlayer(); await speakText(item.text, voiceList()[0], token); }
    } else if (isMine(s, item)) await (P.mode === 'listen' ? listenMine(item, token) : rehearseLine(item, token));
    else if (quiet()) {
      // The cue right before your line shows above your line, so only the others wait to be read.
      const next = s.lines[P.order[p + 1]];
      if (!next || !isMine(s, next)) { P.status = 'reading'; await waitRead(readMs(item.text), token); }
    } else { P.status = 'speaking'; refreshPlayer(); await playCue(s, p, token); }
    if (token.cancelled) return;
    await sleep(300, token);
    if (P.mode === 'listen' && settings.loop && p === P.order.length - 1) p = -1;
  }
  if (!token.cancelled) finishRun();
}

function playCue(s, p, token) {
  const item = s.lines[P.order[p]];
  const next = s.lines[P.order[p + 1]];
  let text = item.text;
  if (P.mode !== 'listen' && settings.cueLength === 'last' && next && isMine(s, next)) {
    const parts = sentences(spokenText(text));
    text = parts[parts.length - 1] || text;
  }
  return sayLine(item, token, text);
}

const gapMs = text => Math.max(2500, words(text).length * 450 / settings.rate + 1500);
const readMs = text => Math.max(1500, words(text).length * 300 / settings.rate + 800);

// Quiet Type mode: leaves text on screen long enough to read, or until Continue / Try again is tapped.
async function waitRead(ms, token) {
  refreshPlayer();
  await waitChoice(token, ms);
}

// Waits for a tap that answers P.choose (Check, Got it, Continue…), the run being cancelled ('cancel'), or ms.
// Only clears P.choose if it's still this wait's: skipping starts the next line's wait straight away, before
// this one finishes, and clearing that one would leave its buttons doing nothing.
function waitChoice(token, ms = 0) {
  return new Promise(resolve => {
    const done = v => { if (P.choose === done) P.choose = null; resolve(v); };
    P.choose = done;
    if (ms) setTimeout(() => done(undefined), ms);
    token.onCancel(() => done('cancel'));
  });
}

// Feeds you the line: read aloud, or in quiet Type mode shown in full for a moment.
const feedLine = (item, token) => (quiet() ? waitRead(gapMs(item.text) + 1500, token) : sayLine(item, token));

async function listenMine(item, token) {
  if (settings.myLines === 'skip') return;
  if (settings.myLines === 'speak') { P.status = 'you'; refreshPlayer(); return sayLine(item, token); }
  P.status = 'gap';
  P.transcript = '';
  refreshPlayer();
  if (settings.listenHears && micOn()) {
    // Hands-free: listen while you say it and carry on as soon as you finish (or after a pause if you don't).
    const r = await listen(token, item.text);
    if (r.reason.startsWith('error:')) {
      if (lostMic(r.reason.slice(6))) { carryOnWithoutMic(r.reason.slice(6)); refreshPlayer(); }
      await sleep(gapMs(item.text), token);
    }
  } else {
    await sleep(gapMs(item.text), token);
  }
  if (settings.myLines === 'gapThenSpeak' && !token.cancelled) {
    P.status = 'answer';
    refreshPlayer();
    await sayLine(item, token);
  }
}

// One try at saying a line: by microphone if the browser supports it, otherwise you mark yourself.
async function attempt(expected, token) {
  P.result = null;
  P.transcript = '';
  if (P.mode === 'type') {
    P.status = 'typing';
    P.typed = '';
    refreshPlayer();
    const typed = await waitChoice(token);
    if (typeof typed === 'string') return { reason: typed }; // 'cancel' or 'prompt' (Show me)
    if (!typed.text.trim()) return { reason: 'prompt' };
    P.result = compare(expected, typed.text);
    return { score: P.result.score };
  }
  if (!micOn()) {
    P.status = 'self';
    refreshPlayer();
    const choice = await waitChoice(token);
    if (choice === 'got') return { score: 100 };
    if (choice === 'miss') return { score: 0 };
    return { reason: choice === 'hear' ? 'prompt' : 'cancel' };
  }
  P.status = 'listening';
  refreshPlayer();
  const r = await listen(token, expected);
  if (['cancel', 'prompt', 'timeout'].includes(r.reason)) return { reason: r.reason };
  if (r.reason.startsWith('error:')) return { reason: 'error', error: r.reason.slice(6) };
  P.result = compare(expected, r.text);
  return { score: P.result.score };
}

const IDLE_NOTE = "Holding for you: I didn't hear anything. If you were talking, check the microphone (and your headphones). Press play when you're ready.";

async function rehearseLine(item, token) {
  const s = current(), key = lineKey(item);
  const wasShaky = isWorking(s, item);
  let tries = 0, idle = 0, first = null;
  // The first attempt in a run is what counts toward "solid" (if no help was needed); best keeps your best ever.
  const note = score => {
    const st = s.stats[key] || { tries: 0, best: 0, last: 0 };
    if (first === null) {
      first = score;
      st.tries++;
      st.last = score;
      st.helped = score >= settings.passScore && hintHelped(item.text, P.reveal);
      P.run.lines++;
      if (score >= settings.passScore) P.run[st.helped ? 'helped' : 'solid']++;
    }
    st.best = Math.max(st.best, score);
    st.at = Date.now();
    s.stats[key] = st;
    saveScripts();
  };
  while (!token.cancelled) {
    const r = await attempt(item.text, token);
    if (token.cancelled) return;
    if (r.reason === 'error' && lostMic(r.error)) { carryOnWithoutMic(r.error); continue; }
    if (r.reason === 'error') return pauseRun(micError(r.error));
    if (r.reason === 'timeout' && ++idle >= 2) return pauseRun(IDLE_NOTE);
    if (r.reason === 'prompt' || r.reason === 'timeout') {
      note(0);
      P.status = 'prompting';
      refreshPlayer();
      await feedLine(item, token);
      continue;
    }
    note(r.score);
    tries++;
    if (r.score >= settings.passScore) {
      chime(true);
      P.status = 'good';
      P.goodText = goodWord(wasShaky);
      refreshPlayer();
      await sleep(900, token);
      return;
    }
    chime(false);
    P.status = 'missed';
    refreshPlayer();
    await sleep(1400, token);
    if (token.cancelled) return;
    P.status = 'prompting';
    refreshPlayer();
    await feedLine(item, token);
    if (tries >= 2) return;
  }
}

async function runBuildUp(fromK) {
  const s = current();
  const token = beginRun();
  const { i, parts } = P.bu;
  const speaker = s.lines[i].speaker;
  for (let k = fromK; k < parts.length; k++) {
    if (token.cancelled) return;
    Object.assign(P, { result: null, transcript: '', status: 'speaking', reveal: settings.hint });
    Object.assign(P.bu, { k, phase: 'listen' });
    refreshPlayer();
    await speakAs(speaker, parts[k], token);
    await sleep(250, token);
    const expected = parts.slice(0, k + 1).join(' ');
    let tries = 0, idle = 0;
    while (!token.cancelled) {
      P.bu.phase = 'recite';
      P.reveal = settings.hint;
      const r = await attempt(expected, token);
      if (token.cancelled) return;
      if (r.reason === 'error' && lostMic(r.error)) { carryOnWithoutMic(r.error); continue; }
      if (r.reason === 'error') return pauseRun(micError(r.error));
      if (r.reason === 'timeout' && ++idle >= 2) return pauseRun(IDLE_NOTE);
      if (r.score != null && r.score >= settings.passScore) {
        chime(true);
        P.status = 'good';
        P.goodText = goodWord(false);
        refreshPlayer();
        await sleep(900, token);
        break;
      }
      if (r.score != null) {
        chime(false);
        P.status = 'missed';
        refreshPlayer();
        await sleep(1400, token);
      }
      P.status = 'prompting';
      refreshPlayer();
      await speakAs(speaker, expected, token);
      if (++tries >= 3) break;
    }
  }
  if (!token.cancelled) finishRun();
}

function togglePlay() {
  if (P.running) return pauseRun();
  if (P.status === 'done') return actions.restart();
  if (P.mode === 'buildup') runBuildUp(P.bu.k);
  else run(P.orderPos);
}

function jump(delta) {
  previewToken.cancel();
  const wasRunning = P.running;
  if (P.status === 'done') P.status = 'idle';
  if (P.mode === 'buildup') {
    P.bu.k = clamp(P.bu.k + delta, 0, P.bu.parts.length - 1);
    Object.assign(P.bu, { phase: 'listen' });
    if (wasRunning) return runBuildUp(P.bu.k);
  } else {
    const s = current();
    // Lands on a line that's actually played or waits for you: not a heading or stage direction, and in quiet
    // Type mode not the cue just before your line (that cue shows on your line's card and is passed straight by).
    const passedBy = q => {
      const l = s.lines[P.order[q]], next = s.lines[P.order[q + 1]];
      return l.type !== 'line' || (quiet() && !isMine(s, l) && !!next && isMine(s, next));
    };
    let p = P.orderPos;
    do { p += delta; } while (p > 0 && p < P.order.length - 1 && passedBy(p));
    P.orderPos = clamp(p, 0, P.order.length - 1);
    if (wasRunning) return run(P.orderPos);
  }
  Object.assign(P, { result: null, transcript: '', status: 'idle', reveal: settings.hint });
  refreshPlayer();
}

// ---------- Actions ----------
function openScript(id) {
  leave();
  app.scriptId = id;
  app.cuesOnly = false;
  app.view = 'script';
  render();
  window.scrollTo(0, 0);
}

const actions = {
  home() { leave(); app.view = 'library'; render(); },
  new() {
    leave();
    const d = pendingDraft();
    app.editing = d && !d.id && d.kind !== 'song' ? d : { id: null, title: '', raw: '' };
    app.view = 'edit';
    render();
    if (d && !d.id && d.kind !== 'song') toast('Picked up your unsaved script where you left off.');
    else $('#ed-title').focus();
  },
  browse() { leave(); app.view = 'browse'; render(); window.scrollTo(0, 0); },
  'lib-tab'(b) { lib.tab = b.dataset.tab; lib.open = null; render(); },
  'lib-filter'(b) { lib[b.dataset.key] = b.dataset.val; render(); },
  'lib-preview'(b, i) { lib.open = lib.open === i ? null : i; $('#lib-results').innerHTML = libResultsHtml(lib.q.trim().toLowerCase()); },
  'lib-add-mono'(b, i) {
    const m = lib.monologues[i];
    addLibraryScript(`${titleCase(m.character)}: ${m.firstWords.split(' ').slice(0, 5).join(' ')}… (${m.play})`,
      `# ${m.play} (${m.author})\n\n${m.character}: ${m.text}\n`, m.character);
    toast('Added. Try Build up to learn it a sentence at a time.');
  },
  async 'lib-add-play'(b) {
    const p = lib.plays.find(x => x.slug === b.dataset.slug);
    b.disabled = true;
    b.textContent = 'Adding…';
    try {
      const res = await fetch(`library/plays/${p.slug}.txt`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      addLibraryScript(`${p.title} (${p.author})`, await res.text());
      toast('Added. Choose your character, and pick a scene with "Start at".');
    } catch {
      b.disabled = false;
      b.textContent = 'Add';
      toast('That play missed its train. Check your connection and try again.');
    }
  },
  'backup-download'() { downloadBackup(); },
  'backup-recordings'() { downloadRecordings(); },
  'lib-cat'(b) { saveJSON(LS_LIB_CAT, b.dataset.cat); render(); },
  'merge-chars'(b) {
    const from = b.dataset.from || $('#merge-from').value, to = b.dataset.to || $('#merge-to').value;
    if (!from || !to || from === to) { toast('Pick two different characters.'); return; }
    const box = $('#ed-raw');
    const lines = parseScript(box.value);
    const moved = lines.filter(l => l.type === 'line' && l.speaker === from).length;
    merger.undo = box.value;
    for (const l of lines) if (l.type === 'line' && l.speaker === from) l.speaker = to;
    box.value = scriptToText(lines);
    merger.sig = '';
    textChanged();
    toast(`Moved ${moved} ${moved === 1 ? 'line' : 'lines'} from ${titleCase(from)} to ${titleCase(to)}.`);
  },
  'merge-undo'() {
    if (merger.undo == null) return;
    $('#ed-raw').value = merger.undo;
    merger.undo = null;
    merger.sig = '';
    textChanged();
    toast('Merge undone.');
  },
  'find-next'() { showMatch(1); },
  'preview-find'(b) {
    const box = $('#find-box'), q = $('#find-q');
    if (!box || !q) return;
    if (!box.open) { merger.autoOpened = true; box.open = true; }
    q.value = b.dataset.q;
    finder.idx = -1;
    showMatch(1);
  },
  'find-prev'() { showMatch(-1); },
  'find-replace'() {
    const box = $('#ed-raw'), q = $('#find-q').value, rep = $('#find-r').value;
    if (!q) { toast('Type what to find first.'); return; }
    const ms = findMatches();
    const at = ms[finder.idx];
    const selected = at != null && box.selectionStart === at && box.selectionEnd === at + q.length;
    if (!selected) { showMatch(1); return; } // first press shows the match; the next replaces it
    box.setRangeText(rep, at, at + q.length, 'end');
    textChanged();
    finder.idx -= 1; // the next match now sits where this one was
    showMatch(1);
  },
  'find-all'() {
    const box = $('#ed-raw'), q = $('#find-q').value, rep = $('#find-r').value;
    const ms = findMatches();
    if (!ms.length) { toast(q ? 'No matches.' : 'Type what to find first.'); return; }
    finder.undo = box.value;
    let out = box.value;
    for (const at of [...ms].reverse()) out = out.slice(0, at) + rep + out.slice(at + q.length);
    box.value = out;
    textChanged();
    finder.idx = -1;
    updateFindCount();
    $('#find-undo').hidden = false;
    toast(`Replaced ${ms.length} ${ms.length === 1 ? 'match' : 'matches'}.`);
  },
  'find-undo'() {
    if (finder.undo == null) return;
    $('#ed-raw').value = finder.undo;
    finder.undo = null;
    textChanged();
    updateFindCount();
    $('#find-undo').hidden = true;
    toast('Undone.');
  },
  'tray-read'() { readTray(); },
  'tray-stop'() { tray.stop = true; tray.progress = 'Stopping after the pages being read now…'; refreshTray(); },
  'tray-clear'() {
    if (tray.pages.length > 3 && !confirm(`Remove all ${tray.pages.length} pages from the list?`)) return;
    tray.pages.forEach(p => URL.revokeObjectURL(p.url));
    Object.assign(tray, { pages: [], progress: '' });
    refreshTray();
  },
  'tray-remove'(b, i) {
    const [p] = tray.pages.splice(i, 1);
    if (p) URL.revokeObjectURL(p.url);
    refreshTray();
  },
  'resume-draft'() {
    const d = pendingDraft();
    if (!d) return;
    leave();
    if (d.id && !scripts.some(x => x.id === d.id)) d.id = null;
    app.editing = d;
    app.scriptId = d.id || app.scriptId;
    app.view = 'edit';
    render();
  },
  'discard-draft'() {
    if (!confirm('Discard your unsaved script?')) return;
    clearDraft();
    render();
  },
  // The sample opens without joining your scripts, so it never clutters the list or syncs.
  sample() {
    if (!sampleScript) {
      sampleScript = makeScript('Romeo and Juliet: the balcony (sample)', SAMPLE);
      Object.assign(sampleScript, { id: 'sample', myChar: 'JULIET', sample: true });
    }
    openScript(sampleScript.id);
  },
  open(b) { openScript(b.dataset.id); },
  'edit-script'() {
    const s = current();
    leave();
    const d = pendingDraft();
    app.editing = d?.id === s.id ? d : { id: s.id, title: s.title, raw: s.raw, ...(s.kind === 'song' ? { kind: 'song', song: s.song || {} } : {}) };
    app.view = 'edit';
    render();
  },
  'delete-script'() {
    const s = current();
    if (!confirm(`Delete "${s.title}"? This can't be undone.`)) return;
    leave();
    scripts = scripts.filter(x => x !== s);
    deleted[s.id] = Date.now();
    saveJSON(LS_DELETED, deleted);
    window.deleteTracksFor?.(s.id);
    saveScripts();
    // Remove recordings no other script still uses.
    const keep = new Set(scripts.flatMap(x => x.lines.filter(l => l.type === 'line').map(lineKey)));
    for (const l of s.lines) {
      if (l.type !== 'line') continue;
      const k = lineKey(l);
      if (!keep.has(k) && recorded.has(k)) { recorded.delete(k); recordings.del(k).catch(() => {}); }
    }
    app.view = 'library';
    render();
  },
  'cancel-edit'() {
    const raw = $('#ed-raw').value;
    const original = app.editing.id ? scripts.find(x => x.id === app.editing.id)?.raw ?? '' : '';
    if (raw.trim() && raw !== original && !confirm('Discard your changes to this script?')) return;
    clearDraft();
    app.view = app.editing.id ? 'script' : 'library';
    render();
  },
  'save-edit'() {
    if (app.editing.kind === 'song') return saveSong();
    const title = $('#ed-title').value.trim(), raw = $('#ed-raw').value;
    const lines = parseScript(raw);
    if (!lines.some(l => l.type === 'line')) { toast("I couldn't find any lines yet. Check the format tips."); return; }
    let s = app.editing.id && scripts.find(x => x.id === app.editing.id);
    if (s) {
      const oldLines = s.lines;
      Object.assign(s, { title: title || s.title, raw, lines, updated: Date.now() });
      keepPlace(s, oldLines);
    } else {
      s = makeScript(title, raw);
      scripts.push(s);
    }
    const chars = characters(s);
    if (!chars.has(s.myChar)) s.myChar = chars.size === 1 ? [...chars.keys()][0] : '';
    clearDraft();
    saveScripts();
    openScript(s.id);
  },
  listen() { startPlayer('listen'); },
  rehearse() { startPlayer('rehearse'); },
  type() { startPlayer('type'); },
  weak() { startPlayer(app.view === 'player' && P.mode === 'type' ? 'type' : 'rehearse', weakOrder(current()), 0, true); },
  'type-check'() { P.choose?.({ text: P.typed = $('#typed')?.value ?? P.typed ?? '' }); },
  'continue-last'() {
    const { id, mode, cuesOnly } = lastRun;
    openScript(id);
    app.cuesOnly = !!cuesOnly;
    if (resumeAt[id]?.mode === mode) actions['resume-run']();
    else startPlayer(mode);
  },
  'resume-run'() {
    const r = resumeAt[current().id], order = playOrder(current());
    startPlayer(r.mode, order, Math.max(0, order.indexOf(r.line)));
  },
  'from-here'(b, i) {
    const s = current();
    const [a, z] = rangeBounds(s);
    const end = i >= a && i < z ? z : s.lines.length;
    const cue = prevLineIndex(s, i);
    startPlayer('rehearse', span(cue >= 0 ? cue : i, end));
  },
  buildup(b, i) { startBuildUp(i); },
  hear(b, i) { const l = current().lines[i]; preview(t => sayLine(l, t)); },
  rec(b, i) { toggleRecord(lineKey(current().lines[i])); },
  async 'del-rec'(b, i) {
    const key = lineKey(current().lines[i]);
    await recordings.del(key).catch(() => {});
    recorded.delete(key);
    render();
  },
  'test-voice'(b) {
    const c = b.dataset.char;
    sayHello(c);
  },
  back() { leave(); app.view = 'script'; render(); },
  toggle: togglePlay,
  prev() { jump(-1); },
  next() { jump(1); },
  hint() { P.reveal = REVEAL[Math.min(REVEAL.length - 1, REVEAL.indexOf(P.reveal) + 1)]; refreshPlayer(); },
  hearit() {
    if (P.status === 'listening') return P.finishListen?.('prompt');
    if (P.status === 'self') return P.choose?.('hear');
    if (P.status === 'typing') return P.choose?.('prompt');
    if (quiet()) return;
    if (P.running) return;
    const s = current();
    if (P.mode === 'buildup') {
      const { i, parts, k } = P.bu;
      return preview(t => speakAs(s.lines[i].speaker, parts.slice(0, k + 1).join(' '), t));
    }
    const item = s.lines[P.order[P.orderPos]];
    if (item?.type === 'line') preview(t => sayLine(item, t));
  },
  'done-speaking'() { P.finishListen?.('manual'); },
  choose(b) { P.choose?.(b.dataset.choice); },
  restart() {
    P.status = 'idle';
    if (P.mode === 'buildup') { P.bu.k = 0; runBuildUp(0); }
    else { P.run = { lines: 0, solid: 0, helped: 0 }; run(0); }
  },
};

document.addEventListener('click', e => {
  unlockAudio();
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const i = b.dataset.i != null ? +b.dataset.i : null;
  actions[b.dataset.action]?.(b, i, e);
});

function applySetting(el) {
  const key = el.dataset.setting;
  settings[key] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
  saveSettings();
  if (key === 'textSize') applyTextSize();
  if (key === 'shortcuts') $('.keys')?.toggleAttribute('hidden', !settings.shortcuts);
  if (el.type === 'range') el.nextElementSibling.textContent = settingLabel(key);
  if (key === 'hint' && !P.result) { P.reveal = settings.hint; refreshPlayer(); }
}

document.addEventListener('change', e => {
  const el = e.target, s = current();
  if (el.id === 'cues-only') { app.cuesOnly = el.checked; return; }
  if (el.id === 'my-char') { s.myChar = el.value; s.updated = Date.now(); saveScripts(); render(); }
  else if (el.id === 'range-start') {
    s.rangeStart = +el.value;
    if ((s.rangeEnd ?? Infinity) <= s.rangeStart) delete s.rangeEnd;
    s.updated = Date.now();
    saveScripts();
    render();
  } else if (el.id === 'range-end') { s.rangeEnd = +el.value; s.updated = Date.now(); saveScripts(); render(); }
  else if (el.dataset.voiceChar) {
    s.voices ||= {};
    if (el.value) s.voices[el.dataset.voiceChar] = el.value;
    else delete s.voices[el.dataset.voiceChar];
    saveScripts();
    sayHello(el.dataset.voiceChar);
  } else if (el.dataset.speedChar) {
    sayHello(el.dataset.speedChar);
  } else if ((el.dataset.aiVoiceChar || el.dataset.styleChar || el.dataset.genderChar) && voiceEditsLocked()) {
    toast('AI voices are locked. Unlock with the PIN first.');
    render(); // put the old choice back
  } else if (el.dataset.aiVoiceChar || el.dataset.styleChar) {
    const c = el.dataset.aiVoiceChar || el.dataset.styleChar;
    const field = el.dataset.aiVoiceChar ? 'aiVoices' : 'aiStyles';
    const value = el.value.trim();
    s[field] ||= {};
    if (value) s[field][c] = value;
    else delete s[field][c];
    s.updated = Date.now();
    saveScripts();
    sayHello(c);
  } else if (el.id === 'ai-shared') {
    Object.assign(ai, { shared: el.checked, on: el.checked });
    aiWarned = false;
    shared.status = null;
    saveJSON(LS_AI, ai);
    render();
  } else if (el.id === 'ai-on') {
    ai.on = el.checked;
    aiWarned = false;
    saveJSON(LS_AI, ai);
    render();
  } else if (el.dataset.genderChar) {
    const c = el.dataset.genderChar;
    (s.genders ||= {})[c] = el.value;
    delete s.voices?.[c];
    delete s.aiVoices?.[c];
    s.updated = Date.now();
    saveScripts();
    render();
    sayHello(c);
  }
  else if (el.dataset.setting) applySetting(el);
  else if (el.id === 'ed-file' && el.files[0]) {
    importFile(el.files[0]);
    el.value = '';
  } else if (el.dataset.catId) {
    const target = scripts.find(x => x.id === el.dataset.catId);
    if (target) setCategory(target, el.value);
  } else if (el.id === 'restore-file' && el.files[0]) {
    restoreBackup(el.files[0]);
    el.value = '';
  } else if ((el.id === 'ed-shots' || el.id === 'ed-cam') && el.files.length) {
    addPages([...el.files], el.id === 'ed-shots');
    el.value = '';
  }
});

document.addEventListener('dragover', e => { if (e.target.id === 'ed-raw') e.preventDefault(); });
document.addEventListener('drop', e => {
  if (e.target.id !== 'ed-raw' || !e.dataTransfer.files.length) return;
  e.preventDefault();
  const files = [...e.dataTransfer.files];
  if (files.every(isImage)) importScreenshots(files);
  else importFile(files[0]);
});

document.addEventListener('input', e => {
  if (e.target.id === 'lib-q') {
    lib.q = e.target.value;
    lib.open = null;
    $('#lib-results').innerHTML = libResultsHtml(lib.q.trim().toLowerCase().replace(/[’‘]/g, "'"));
    return;
  }
  if (e.target.id === 'ed-raw' || e.target.id === 'ed-title') saveDraft();
  if (e.target.id === 'ed-raw') { updatePreview(); updateFindCount(); }
  if (e.target.id === 'find-q') { finder.idx = -1; updateFindCount(); }
  else if (e.target.dataset.setting && e.target.type === 'range') applySetting(e.target);
  else if (e.target.dataset.speedChar) {
    const s = current(), c = e.target.dataset.speedChar, v = +e.target.value;
    s.speeds ||= {};
    if (v === 1) delete s.speeds[c];
    else s.speeds[c] = v;
    s.updated = Date.now();
    saveScripts();
    e.target.nextElementSibling.textContent = speedLabel(v);
  }
});

document.addEventListener('toggle', e => {
  if (e.target.id === 'voices') app.voicesOpen = e.target.open;
  if (e.target.id === 'find-box') {
    app.findOpen = e.target.open;
    if (e.target.open && !merger.autoOpened) $('#find-q')?.focus(); // not when it opened itself for duplicate names
    merger.autoOpened = false;
  }
}, true);

// Find and fix: Enter jumps to the next match; Match case recounts.
document.addEventListener('keydown', e => {
  if (e.target.id === 'find-q' && e.key === 'Enter') { e.preventDefault(); showMatch(e.shiftKey ? -1 : 1); }
  // Type mode: Enter checks the line (Shift+Enter for a new line).
  if (e.target.id === 'typed' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); actions['type-check'](); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'typed') P.typed = e.target.value;
});
document.addEventListener('change', e => {
  if (e.target.id === 'find-case') { finder.idx = -1; updateFindCount(); }
});

document.addEventListener('keydown', e => {
  if (app.view !== 'player' || !settings.shortcuts || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = e.target.tagName;
  if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
  if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'arrowright') jump(1);
  else if (k === 'arrowleft') jump(-1);
  else if (k === 'h') actions.hint();
  else if (k === 'l') actions.hearit();
  else if (k === 'enter') actions['done-speaking']();
});

// ---------- Sync between devices (through a secret GitHub Gist) ----------
// Script edits: the newest version wins. Progress merges line by line. Deletions carry over.
// Voices and recordings stay on each device.
const LS_SYNC = 'lineLearner.sync';
const LS_DELETED = 'lineLearner.deleted';
const GIST_FILE = 'line-learner.json';
const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Line%20Learner';
const syncConf = loadJSON(LS_SYNC, {}); // { token, gistId, lastSync }
let deleted = loadJSON(LS_DELETED, {}); // script id -> when it was deleted
const sync = { busy: false, error: '', pending: false, timer: 0 };

async function gh(path, opts = {}) {
  const res = await fetch('https://api.github.com' + path, {
    ...opts,
    cache: 'no-store',
    headers: {
      Authorization: 'Bearer ' + syncConf.token,
      Accept: 'application/vnd.github+json',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (res.ok) return res.json();
  const err = new Error(res.status === 401 || res.status === 403
    ? "GitHub didn't accept your access key. Make sure it has the gist permission and hasn't expired."
    : `GitHub answered with an error (${res.status}). Try again in a moment.`);
  err.status = res.status;
  throw err;
}

const syncPayload = () => JSON.stringify({
  app: 'line-learner', version: 1, saved: Date.now(), deleted,
  scripts: scripts.map(({ voices, ...s }) => s),
});

async function findOrCreateGist() {
  for (let page = 1; page <= 10; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`);
    const hit = list.find(g => g.files[GIST_FILE]);
    if (hit) return hit.id;
    if (list.length < 100) break;
  }
  const created = await gh('/gists', {
    method: 'POST',
    body: JSON.stringify({ description: 'Line Learner scripts (synced by the app)', public: false, files: { [GIST_FILE]: { content: syncPayload() } } }),
  });
  return created.id;
}

async function readRemote() {
  const g = await gh('/gists/' + syncConf.gistId);
  const f = g.files[GIST_FILE];
  if (!f) return null;
  const text = f.truncated ? await (await fetch(f.raw_url, { cache: 'no-store' })).text() : f.content;
  try { return JSON.parse(text); } catch { return null; }
}

function mergeStats(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, theirs] of Object.entries(b)) {
    const mine = out[k];
    const newer = !mine || (theirs.at || 0) > (mine.at || 0) ? theirs : mine;
    out[k] = { ...newer, best: Math.max(theirs.best || 0, mine?.best || 0), tries: Math.max(theirs.tries || 0, mine?.tries || 0) };
  }
  return out;
}

// Merges in place so a script that is open keeps pointing at the same object.
function mergeRemote(remote) {
  if (!remote || !Array.isArray(remote.scripts)) return;
  for (const [id, t] of Object.entries(remote.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, t);
  for (const r of remote.scripts) {
    const mine = scripts.find(s => s.id === r.id);
    if (!mine) { scripts.push({ ...r, voices: {} }); continue; }
    const stats = mergeStats(mine.stats, r.stats);
    if ((r.updated || 0) > (mine.updated || 0)) {
      const voices = mine.voices || {};
      for (const k of Object.keys(mine)) delete mine[k];
      Object.assign(mine, r, { voices });
    }
    mine.stats = stats;
  }
  scripts = scripts.filter(s => !(deleted[s.id] && deleted[s.id] >= (s.updated || 0)));
}

// The Google sign-in sync lives in groups.js (it needs Firebase); these hand off to it when it's loaded.
const googleSyncPanel = () => (typeof googleSyncHtml === 'function' ? googleSyncHtml() : '');

function scheduleSync() {
  if (typeof scheduleGoogleSync === 'function') scheduleGoogleSync();
  if (!syncConf.token) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(runSync, 4000);
}

async function runSync() {
  if (!syncConf.token || sync.busy) return;
  if (P.running) { sync.pending = true; return; }
  sync.busy = true;
  sync.error = '';
  showSyncStatus();
  try {
    syncConf.gistId ||= await findOrCreateGist();
    let remote;
    try {
      remote = await readRemote();
    } catch (e) {
      if (e.status !== 404) throw e;
      syncConf.gistId = await findOrCreateGist(); // the Gist was deleted on GitHub
      remote = await readRemote();
    }
    mergeRemote(remote);
    saveJSON(LS_SCRIPTS, scripts);
    saveJSON(LS_DELETED, deleted);
    await gh('/gists/' + syncConf.gistId, { method: 'PATCH', body: JSON.stringify({ files: { [GIST_FILE]: { content: syncPayload() } } }) });
    syncConf.lastSync = Date.now();
    saveJSON(LS_SYNC, syncConf);
    if (app.view === 'script' && !current()) app.view = 'library';
    if (['library', 'script', 'sync'].includes(app.view) && !app.rec) render();
  } catch (e) {
    sync.error = e.status ? e.message : "Couldn't reach GitHub. Check your connection; I'll try again next time.";
    if (app.view === 'sync') render();
  } finally {
    sync.busy = false;
    showSyncStatus();
  }
}

function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

function showSyncStatus() {
  const b = $('#sync-btn');
  if (!b) return;
  const g = typeof googleSyncState === 'function' ? googleSyncState() : null; // { on, busy, error }
  const on = !!syncConf.token || !!g?.on, busy = sync.busy || g?.busy, error = sync.error || g?.error;
  b.textContent = !on ? 'Sync' : busy ? 'Syncing…' : error ? 'Sync problem' : 'Synced';
  b.classList.toggle('problem', !!(on && error));
}

// ---------- Backup file ----------
// A file with all your scripts, progress and settings (not keys or recordings), to keep somewhere safe
// or move to a new device. Restoring merges it with what's here, the same way Sync does.
function backupCardHtml() {
  return `<div class="card stack-sm">
    <b>Backup file</b>
    <p class="muted small">Save all ${scripts.length} ${scripts.length === 1 ? 'script' : 'scripts'}, your progress and settings to a file (keep it in Files, iCloud or email it to yourself). Restoring adds anything missing and keeps the newest version of each script.</p>
    <p class="note small"><b>Not in the backup:</b> your voice recordings${recorded.size ? ` (${recorded.size} on this device)` : ''}, AI voices already made, saved tracks and keys.${recorded.size ? ' Recordings have their own file: <b>Download recordings</b>.' : ''}</p>
    <div class="row wrap"><button class="btn" data-action="backup-download">Download backup</button>
      ${recorded.size ? `<button class="btn" data-action="backup-recordings">Download recordings (${recorded.size})</button>` : ''}
      <label class="btn ghost">Restore a backup or recordings<input type="file" id="restore-file" accept=".json,application/json" hidden></label></div>
  </div>`;
}

// Your recordings in a file of their own (it can be big), restored with the same Restore button.
async function downloadRecordings() {
  toast('Gathering your recordings…');
  const out = {};
  for (const key of await recordings.keys().catch(() => [])) {
    const blob = await recordings.get(key).catch(() => null);
    if (blob) out[key] = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => resolve(null); r.readAsDataURL(blob); });
  }
  const file = new Blob([JSON.stringify({ app: 'line-learner', kind: 'recordings', version: 1, saved: Date.now(), recordings: out })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = `line-learner-recordings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast(`Saved ${Object.keys(out).length} recordings to a file.`);
}

async function restoreRecordings(data) {
  let n = 0;
  for (const [key, url] of Object.entries(data.recordings || {})) {
    try { await recordings.put(key, await (await fetch(url)).blob()); recorded.add(key); n++; } catch { /* skip a damaged one */ }
  }
  toast(`Recordings restored: ${n}.`);
  render();
}

function downloadBackup() {
  const data = { app: 'line-learner', kind: 'backup', version: 1, saved: Date.now(), scripts, deleted, settings };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `line-learner-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast('Backup saved. Keep the file somewhere safe.');
}

async function restoreBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { data = null; }
  if (data?.app === 'line-learner' && data.kind === 'recordings') return restoreRecordings(data);
  if (data?.app !== 'line-learner' || !Array.isArray(data.scripts)) { toast("That file isn't a Line Learner backup."); return; }
  const before = new Set(scripts.map(s => s.id));
  mergeRemote({ scripts: data.scripts, deleted: data.deleted || {} });
  // Bring back this device's voice choices where the backup has them.
  for (const s of scripts) if (!before.has(s.id)) s.voices = data.scripts.find(b => b.id === s.id)?.voices || {};
  saveScripts();
  saveJSON(LS_DELETED, deleted);
  const added = scripts.filter(s => !before.has(s.id)).length;
  toast(`Backup restored: ${added} ${added === 1 ? 'script' : 'scripts'} added, the rest kept up to date.`);
  render();
}

function renderSync() {
  if (syncConf.token) {
    return `<section class="stack">
      <h1>Sync and backup</h1>
    <p class="lede">Optional. Your scripts are always saved on this device. Sync keeps your scripts, songs, categories and progress the same on your phone and computer. Voices, recordings and saved tracks stay on each device.</p>
      ${googleSyncPanel()}
      <div class="card stack-sm">
        <b>GitHub sync</b>
        <p><b>This device is connected.</b> ${sync.busy ? 'Syncing now…' : syncConf.lastSync ? `Last synced ${ago(syncConf.lastSync)}.` : 'Not synced yet.'}</p>
        ${syncConf.lastSync && !sync.busy ? `<p class="muted">${scripts.length} ${scripts.length === 1 ? 'script' : 'scripts'} on this device and in your GitHub copy.${pendingDraft() ? ' Your unsaved script is not included until you save it.' : ''}</p>` : ''}
        ${sync.error ? `<p class="note">${esc(sync.error)}</p>` : ''}
        <p class="muted">Changes sync on their own a few seconds after you make them, and whenever you open the app. Tap Sync now to pull the latest from your other device.</p>
        <div class="row wrap">
          <button class="btn primary" data-action="sync-now" ${sync.busy ? 'disabled' : ''}>Sync now</button>
          <button class="btn ghost" data-action="sync-disconnect">Disconnect this device</button>
        </div>
      </div>
      <details class="card">
        <summary>Change key</summary>
        <div class="stack-sm">
          <p class="muted small">GitHub only shows a key once, so to change it you make a new one: open <a href="${TOKEN_URL}" target="_blank" rel="noopener">GitHub's new access key page</a> (or find "Line Learner" at <a href="https://github.com/settings/tokens" target="_blank" rel="noopener">github.com/settings/tokens</a> and tap Regenerate token), copy the key, and paste it here.</p>
          <label class="field"><span>New GitHub access key</span><input id="sync-new-token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ghp_…"></label>
          <div class="row"><button class="btn" data-action="sync-change-key" ${sync.busy ? 'disabled' : ''}>Save new key</button></div>
        </div>
      </details>
      <p class="muted small">Your scripts and progress are kept in a secret Gist on your GitHub account. It isn't listed anywhere, but anyone with its link could read it, so don't share that link. Voices and recordings stay on each device.</p>
      ${backupCardHtml()}
    </section>`;
  }
  return `<section class="stack">
    <h1>Sync and backup</h1>
    <p class="lede">Optional. Your scripts are always saved on this device. Sync keeps your scripts, songs, categories and progress the same on your phone and computer. Voices, recordings and saved tracks stay on each device.</p>
    ${googleSyncPanel()}
    ${sync.error ? `<p class="note">${esc(sync.error)}</p>` : ''}
    <details class="card stack-sm">
      <summary>Advanced: sync with GitHub instead</summary>
      <p class="muted small">For people who already use GitHub. Most people should use Google sign-in above.</p>
      <ol class="steps-list">
        <li>Open <a href="${TOKEN_URL}" target="_blank" rel="noopener">GitHub's new access key page</a> and sign in. It comes pre-filled with only the <b>gist</b> box ticked, which is all Line Learner needs.</li>
        <li>Choose an expiration (or "No expiration"), then tap <b>Generate token</b> at the bottom.</li>
        <li>Copy the key (it starts with <code>ghp_</code>) and paste it here:</li>
      </ol>
      <label class="field"><span>GitHub access key</span><input id="sync-token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ghp_…"></label>
      <div class="row"><button class="btn" data-action="sync-connect" ${sync.busy ? 'disabled' : ''}>${sync.busy ? 'Connecting…' : 'Connect'}</button></div>
      <p class="muted small">Then do the same on your other device. Making a second key there is easiest; the app finds your existing scripts automatically. The key is saved only in this browser.</p>
    </details>
    ${backupCardHtml()}
  </section>`;
}

// ---------- Light / dark ----------
const LS_THEME = 'lineLearner.theme';
const THEMES = { auto: 'Match device', light: 'Light', dark: 'Dark' };

function savedTheme() {
  try { return THEMES[localStorage.getItem(LS_THEME)] ? localStorage.getItem(LS_THEME) : 'auto'; } catch { return 'auto'; }
}

function applyTheme(theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const b = $('#theme-btn');
  if (!b) return;
  b.innerHTML = icon(theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'contrast');
  b.title = `Colors: ${THEMES[theme]}. Tap to change.`;
  b.setAttribute('aria-label', b.title);
}

Object.assign(actions, {
  theme() {
    const order = Object.keys(THEMES);
    const next = order[(order.indexOf(savedTheme()) + 1) % order.length];
    try { localStorage.setItem(LS_THEME, next); } catch { /* still applies for this visit */ }
    applyTheme(next);
    toast(`Colors: ${THEMES[next]}`);
  },
  'ai-save'() {
    const key = $('#ai-key').value.trim();
    if (!key) { toast('Paste your OpenAI key first.'); return; }
    const pin = $('#ai-pin')?.value.trim() || '';
    if (pin && pin.length < 4) { toast('Use at least 4 digits for the PIN, or leave it blank.'); return; }
    Object.assign(ai, { key, on: true });
    if (pin) ai.pinHash = pinHash(pin);
    aiWarned = false;
    saveJSON(LS_AI, ai);
    app.voicesOpen = true;
    render();
    const first = characters(current()).keys().next().value;
    if (first) sayHello(first);
  },
  'ai-remove'() {
    if (aiLocked()) { toast('Unlock with the PIN first.'); return; }
    if (!confirm('Remove your OpenAI key from this device? Lines already made will keep playing.')) return;
    for (const k of Object.keys(ai)) delete ai[k];
    saveJSON(LS_AI, ai);
    render();
  },
  'ai-prepare'() { aiPrepareAll(); },
  'ai-cap'() {
    if (aiLocked()) { toast('Unlock with the PIN first.'); return; }
    const v = Math.max(0, Math.round(+$('#ai-cap').value || 0));
    ai.capUsd = v;
    saveJSON(LS_AI, ai);
    toast(v ? `Limit set: about $${v} a month on this device.` : 'No monthly limit on this device. Keep a budget set in your OpenAI account.');
    render();
  },
  'ai-set-pin'() {
    const pin = $('#ai-pin').value.trim();
    if (pin.length < 4) { toast('Use at least 4 digits.'); return; }
    ai.pinHash = pinHash(pin);
    saveJSON(LS_AI, ai);
    sessionStorage.removeItem(SS_AI_UNLOCKED);
    toast('Voices locked. Changing them now needs the PIN.');
    render();
  },
  'ai-unlock'() {
    if (pinHash($('#ai-pin').value.trim()) !== ai.pinHash) { toast("That PIN isn't right."); return; }
    sessionStorage.setItem(SS_AI_UNLOCKED, ai.pinHash);
    toast('Unlocked until you close the app.');
    render();
  },
  'ai-lock'() { sessionStorage.removeItem(SS_AI_UNLOCKED); render(); },
  'ai-stop'() { if (app.aiProgress) app.aiProgress.stop = true; },
  'sync-view'() { leave(); app.view = 'sync'; render(); },
  'sync-now'() { runSync(); },
  async 'sync-connect'() {
    const token = $('#sync-token').value.trim();
    if (!token) { toast('Paste your GitHub access key first.'); return; }
    Object.assign(syncConf, { token, gistId: null, lastSync: null });
    sync.error = '';
    render();
    await runSync();
    if (sync.error) {
      delete syncConf.token;
      saveJSON(LS_SYNC, syncConf);
    } else {
      toast(`Connected. ${scripts.length} ${scripts.length === 1 ? 'script' : 'scripts'} synced.`);
    }
    if (app.view === 'sync') render();
    showSyncStatus();
  },
  // Tries the new key; if GitHub refuses it, the old one stays in place.
  async 'sync-change-key'() {
    const token = $('#sync-new-token').value.trim();
    if (!token) { toast('Paste the new key first.'); return; }
    const old = syncConf.token;
    syncConf.token = token;
    await runSync();
    if (sync.error) {
      syncConf.token = old;
      toast("GitHub didn't accept that key, so the old one is still in use.");
    } else {
      toast('New key saved.');
    }
    saveJSON(LS_SYNC, syncConf);
    if (app.view === 'sync') render();
    showSyncStatus();
  },
  'sync-disconnect'() {
    if (!confirm('Disconnect this device? Your scripts stay here and in your GitHub account.')) return;
    for (const k of Object.keys(syncConf)) delete syncConf[k];
    saveJSON(LS_SYNC, syncConf);
    sync.error = '';
    render();
    showSyncStatus();
  },
});

// ---------- Boot ----------
// songs.js adds its Sing along view here.
const VIEWS = { library: renderLibrary, edit: renderEdit, script: renderScript, player: renderPlayer, sync: renderSync, browse: renderBrowse };

// Redrawing the page throws away whatever had keyboard focus; these put it back (or on the new page's heading),
// so keyboard and screen reader users don't get dropped at the top of the page.
function focusKey(el) {
  if (!el || el === document.body || !$('#app').contains(el)) return null;
  if (el.id) return '#' + CSS.escape(el.id);
  if (!el.dataset.action) return null;
  return `[data-action="${CSS.escape(el.dataset.action)}"]` + ['i', 'tab', 'cat', 'kind', 'choice', 'gid', 'char']
    .filter(k => el.dataset[k] != null).map(k => `[data-${k}="${CSS.escape(el.dataset[k])}"]`).join('');
}
function restoreFocus(key) {
  if (document.activeElement && document.activeElement !== document.body) return;
  if (key) $(key)?.focus({ preventScroll: true });
}

function render() {
  const key = focusKey(document.activeElement), newView = !!document.body.dataset.view && document.body.dataset.view !== app.view;
  $('#app').innerHTML = VIEWS[app.view]();
  if (newView) {
    if (Date.now() - (toast.at || 0) > 1500) hideToast(); // an old message belongs to the last page
    const h = $('#app h1');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  } else restoreFocus(key);
  if (app.view === 'player') refreshPlayer();
  if (app.view === 'edit') { merger.sig = ''; updatePreview(); }
  document.body.dataset.view = app.view;
  if (app.view === 'sing') mountSing();
  if (app.view === 'track') setupTrackPlayer();
  $('#crumb').textContent = ['script', 'player', 'sing'].includes(app.view) ? current()?.title ?? '' : '';
}

const SAMPLE = `# Act 2, Scene 2: The balcony

(Capulet's orchard. Juliet appears above at a window.)

ROMEO: But soft, what light through yonder window breaks? It is the east, and Juliet is the sun.
JULIET: Ay me!
ROMEO: She speaks. O, speak again, bright angel!
JULIET: O Romeo, Romeo, wherefore art thou Romeo? Deny thy father and refuse thy name. Or if thou wilt not, be but sworn my love, and I'll no longer be a Capulet.
ROMEO: (aside) Shall I hear more, or shall I speak at this?
JULIET: 'Tis but thy name that is my enemy. Thou art thyself, though not a Montague. What's Montague? It is nor hand, nor foot, nor arm, nor face, nor any other part belonging to a man. O, be some other name! What's in a name? That which we call a rose by any other name would smell as sweet.
ROMEO: I take thee at thy word. Call me but love, and I'll be new baptized. Henceforth I never will be Romeo.
JULIET: What man art thou that, thus bescreened in night, so stumblest on my counsel?
ROMEO: By a name I know not how to tell thee who I am. My name, dear saint, is hateful to myself, because it is an enemy to thee.
JULIET: My ears have not yet drunk a hundred words of thy tongue's uttering, yet I know the sound. Art thou not Romeo, and a Montague?
ROMEO: Neither, fair saint, if either thee dislike.`;

if (synth) synth.onvoiceschanged = () => { if (app.view === 'script') render(); };
recordings.keys().then(keys => { recorded = new Set(keys); }).catch(() => {}).finally(render);
render();
applyTheme(savedTheme());
showSyncStatus();
runSync();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - (syncConf.lastSync || 0) > 30000) runSync();
  if (document.visibilityState === 'visible') checkForUpdate();
});

// GitHub Pages lets browsers keep using the page for up to 10 minutes after an update. When a newer
// version is out, reload (only on the home, script or library screens, so nothing in progress is cut off).
async function checkForUpdate() {
  if (location.protocol === 'file:' || new URLSearchParams(location.search).has('code')) return;
  if (!['library', 'script', 'browse', 'sync', 'help', 'about'].includes(app.view)) return;
  try {
    const mine = (document.querySelector('script[src*="app.js?v="]')?.getAttribute('src') || '').split('v=')[1];
    const html = await (await fetch(location.pathname, { cache: 'no-store' })).text();
    const live = (html.match(/app\.js\?v=(\d+)/) || [])[1];
    if (!mine || !live || live === mine || sessionStorage.getItem('lineLearner.reloadedFor') === live) return;
    sessionStorage.setItem('lineLearner.reloadedFor', live); // never loop if the browser serves the old page again
    location.reload();
  } catch { /* offline: carry on with this version */ }
}
checkForUpdate();
