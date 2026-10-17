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
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3500);
}

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
};

function loadJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { toast('Could not save: ' + e.message); }
}

let scripts = loadJSON(LS_SCRIPTS, []);
const settings = { ...DEFAULT_SETTINGS, ...loadJSON(LS_SETTINGS, {}) };
const saveScripts = () => { saveJSON(LS_SCRIPTS, scripts); scheduleSync(); };
const saveSettings = () => saveJSON(LS_SETTINGS, settings);

// Recordings live in IndexedDB, keyed by a hash of speaker + line text so they survive script edits.
let dbPromise;
function openDb() {
  return dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('line-learner', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('recordings');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idb(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', mode);
    const req = fn(tx.objectStore('recordings'));
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
  return parts.length <= 3 && parts.every(p => /^[\p{Lu}\p{N}]/u.test(p)) && !SECTION_RE.test(name);
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

function words(s) {
  return spokenText(s).toLowerCase()
    .replace(/['‘’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ').filter(Boolean)
    .map(w => (/^\d+$/.test(w) && +w <= 20 ? NUMS[+w] : w))
    .map(w => SOUNDALIKE[w] || w);
}

// True when two words are the same or one letter apart (forgives small recognition slips).
function near(a, b) {
  if (a === b) return true;
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
const blank = w => `<span class="blank" style="width:${(Math.min(w.length, 12) * 0.5 + 0.5).toFixed(1)}em"></span>`;
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
function chunksOf(text) {
  const out = [];
  let buf = '';
  for (const s of sentences(text)) {
    if (buf && (buf + ' ' + s).length > 180) { out.push(buf); buf = s; }
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

function playBlob(blob, token) {
  stopSharedAudio?.();
  return new Promise(resolve => {
    if (token.cancelled) return resolve();
    const url = URL.createObjectURL(blob);
    const audio = sharedAudio;
    let settled = false, off = () => {};
    const finish = () => {
      if (settled) return;
      settled = true;
      audio.pause();
      audio.onended = audio.onerror = null;
      URL.revokeObjectURL(url);
      if (stopSharedAudio === finish) stopSharedAudio = null;
      off();
      resolve();
    };
    stopSharedAudio = finish;
    off = token.onCancel(finish);
    audio.onended = audio.onerror = finish;
    audio.src = url;
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
    if (blob) return playBlob(blob, token);
  }
  return speakText(text, voiceFor(item.speaker), token);
}

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

function micError(code) {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'I need microphone access. Allow it in the address bar, then press play.';
  if (code === 'network') return 'Checking your lines needs an internet connection. Reconnect, then press play.';
  if (code === 'audio-capture') return 'No microphone found. Plug one in, then press play.';
  return `The microphone stopped (${code}). Press play to try again.`;
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
    toast('Microphone blocked. Allow it in the address bar and try again.');
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
const app = { view: 'library', scriptId: null, editing: null, rec: null, voicesOpen: false };
const current = () => scripts.find(s => s.id === app.scriptId);
const lineKey = l => hash(l.speaker + '|' + spokenText(l.text));
const isMine = (s, l) => l.type === 'line' && l.speaker === s.myChar;
const statOf = (s, l) => s.stats[lineKey(l)];
const isSolid = (s, l) => (statOf(s, l)?.last ?? -1) >= settings.passScore;

function characters(s) {
  const m = new Map();
  for (const l of s.lines) if (l.type === 'line') m.set(l.speaker, (m.get(l.speaker) || 0) + 1);
  return m;
}

function makeScript(title, raw) {
  const lines = parseScript(raw);
  const chars = [...characters({ lines }).keys()];
  return { id: uid(), title: title || 'Untitled script', raw, lines, myChar: chars.length === 1 ? chars[0] : '', voices: {}, stats: {}, updated: Date.now() };
}

function rangeBounds(s) {
  const start = clamp(s.rangeStart || 0, 0, Math.max(0, s.lines.length - 1));
  const end = clamp(s.rangeEnd ?? s.lines.length, start + 1, s.lines.length);
  return [start, end];
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

// Your shaky lines in the current range, each preceded by the cue line that leads into it.
function weakOrder(s) {
  const order = [];
  for (const i of rangeOrder(s)) {
    const l = s.lines[i];
    if (!isMine(s, l) || isSolid(s, l)) continue;
    const cue = prevLineIndex(s, i);
    if (cue >= 0 && !isMine(s, s.lines[cue]) && order[order.length - 1] !== cue) order.push(cue);
    order.push(i);
  }
  return order;
}
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
  back: '<path d="M15 5l-7 7 7 7"/>',
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
  if (location.protocol === 'file:') notes.push('Tip: open Line Learner with "Start Line Learner.cmd" so the microphone works smoothly and your scripts are always saved in the same place.');
  return notes.map(n => `<p class="note">${esc(n)}</p>`).join('');
}

function renderLibrary() {
  const cards = scripts.slice().sort((a, b) => b.updated - a.updated).map(s => {
    const mine = s.lines.filter(l => isMine(s, l));
    const solid = mine.filter(l => isSolid(s, l)).length;
    return `<li><button class="card script-card" data-action="open" data-id="${s.id}">
      <span class="card-title">${esc(s.title)}</span>
      <span class="muted">${s.myChar ? `As ${esc(titleCase(s.myChar))}: ${solid} of ${mine.length} lines solid` : 'Pick your character to start'}</span>
      ${mine.length ? bar(solid / mine.length) : ''}
    </button></li>`;
  }).join('');
  return `<section class="stack">
    <div class="hero">
      <h1>Learn your lines by ear.</h1>
      <p class="lede">Paste a scene or monologue and pick your part. Listen to it like an audio track, then run it out loud while the app reads your cues and checks your lines.</p>
      <div class="row wrap">
        <button class="btn primary" data-action="new">+ New script</button>
        <button class="btn" data-action="sample">Try a sample scene</button>
      </div>
    </div>
    ${supportNote()}
    ${scripts.length ? `<h2>Your scripts</h2><ul class="cards">${cards}</ul>` : ''}
    <div class="card how">
      <h2>How to practice</h2>
      <ol>
        <li><b>Listen</b> on repeat while you commute or cook. It pauses where your lines go so you can say them, then plays them so you hear how they go.</li>
        <li><b>Rehearse</b> out loud. Your cues are read to you, the mic listens, and you get a word-by-word check. Stuck? Say <i>"line"</i> like you would in a real rehearsal.</li>
        <li><b>Build up</b> long speeches and audition monologues one sentence at a time, always from the top.</li>
        <li><b>Drill weak lines</b> to go straight to the ones that need work.</li>
      </ol>
    </div>
  </section>`;
}

function renderEdit() {
  const e = app.editing;
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
        <li><b>PDF scripts:</b> import or drag in the PDF, then skim the text. Page numbers and repeated headers are removed, but cast lists, title pages or odd layouts may need a quick tidy. Scanned PDFs (pictures of pages) can't be read.</li>
      </ul>
    </details>
    <label class="field"><span>Script</span><textarea id="ed-raw" rows="16" spellcheck="false" placeholder="Paste your scene or monologue here">${esc(e.raw)}</textarea></label>
    <p id="ed-preview" class="muted"></p>
    <div class="row wrap">
      <label class="btn">Import PDF or .txt<input type="file" id="ed-file" accept=".pdf,.txt,application/pdf,text/plain" hidden></label>
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
  const lines = parseScript(raw);
  const n = lines.filter(l => l.type === 'line').length;
  const chars = [...characters({ lines })].map(([c, k]) => `${esc(titleCase(c))} (${k})`).join(', ');
  el.innerHTML = n ? `Found <b>${n}</b> speeches. Characters: ${chars}` : 'No lines found yet. See the format tips above.';
}

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
  if (!text.trim()) throw new Error("This PDF has no selectable text (it's probably a scan), so it can't be imported.");
  return text.replace(/\n{3,}/g, '\n\n');
}

async function importFile(f) {
  const isPdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
  try {
    if (isPdf) toast('Reading PDF…');
    const text = isPdf ? await pdfToText(f) : await f.text();
    if (app.view !== 'edit') return;
    $('#ed-raw').value = text;
    if (!$('#ed-title').value) $('#ed-title').value = f.name.replace(/\.[^.]+$/, '');
    updatePreview();
    if (isPdf) toast('PDF imported. Check the character list below and tidy anything that came through oddly.');
  } catch (e) {
    toast(e.message || 'Could not read that file.');
  }
}

function statDot(st) {
  if (!st) return '<span class="dot new" title="Not rehearsed yet"></span>';
  const cls = st.last >= settings.passScore ? 'solid' : st.last >= 50 ? 'close' : 'weak';
  return `<span class="dot ${cls}" title="Last run ${st.last}%, best ${st.best}%"></span>`;
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
      <div class="row"><button class="btn ghost" data-action="edit-script">Edit</button><button class="btn ghost" data-action="delete-script">Delete</button></div>
    </div>
    ${supportNote()}
    <div class="card stack-sm">
      <label class="field inline"><span>I'm playing</span><select id="my-char">
        <option value="">Choose a character…</option>
        ${chars.map(([c, n]) => `<option value="${esc(c)}" ${c === s.myChar ? 'selected' : ''}>${esc(titleCase(c))} (${n} ${n === 1 ? 'line' : 'lines'})</option>`).join('')}
      </select></label>
      ${rangeHtml}
      ${mine.length ? `<div class="meter">${bar(solid / mine.length)}<span class="muted small">${solid} of ${mine.length} lines solid</span></div>` : ''}
    </div>
    <div class="modes">
      <button class="mode" data-action="listen">${icon('headphones')}<b>Listen</b><span>Hear the scene like an audio track. It pauses for you to say your lines.</span></button>
      <button class="mode" data-action="rehearse" ${s.myChar ? '' : 'disabled'}>${icon('mic')}<b>Rehearse</b><span>Your cues are read aloud. Say your lines and the mic checks them.</span></button>
      <button class="mode" data-action="weak" ${s.myChar && weak ? '' : 'disabled'}>${icon('target')}<b>Drill weak lines</b><span>${s.myChar ? (weak ? `${weak} ${weak === 1 ? 'line needs' : 'lines need'} work` : 'Nothing shaky right now') : 'Pick your character first'}</span></button>
    </div>
    <details id="voices" class="card" ${app.voicesOpen ? 'open' : ''}>
      <summary>Voices for each character</summary>
      ${voices.length ? chars.map(([c]) => {
        const { gender, voice: auto } = cast.get(c);
        const chosen = s.voices?.[c] || '';
        const opt = o => `<option value="${esc(o.voiceURI)}" ${o.voiceURI === chosen ? 'selected' : ''}>${esc(voiceLabel(o))}</option>`;
        const matching = voices.filter(o => voiceGender(o) === gender), others = voices.filter(o => voiceGender(o) !== gender);
        return `<div class="voice-row"><span class="voice-name">${esc(titleCase(c))}</span>
          <select data-gender-char="${esc(c)}" aria-label="${esc(titleCase(c))}: female or male">
            <option value="f" ${gender === 'f' ? 'selected' : ''}>Female</option>
            <option value="m" ${gender === 'm' ? 'selected' : ''}>Male</option>
          </select>
          <select data-voice-char="${esc(c)}" aria-label="${esc(titleCase(c))}: voice">
            <option value="">Automatic${auto ? `: ${esc(voiceLabel(auto))}` : ''}</option>
            ${matching.length ? `<optgroup label="${gender === 'f' ? 'Female' : 'Male'} voices">${matching.map(opt).join('')}</optgroup>` : ''}
            ${others.length ? `<optgroup label="Other voices">${others.map(opt).join('')}</optgroup>` : ''}
          </select>
          <button class="icon-btn" data-action="test-voice" data-char="${esc(c)}" title="Test this voice" aria-label="Test this voice">${icon('speaker')}</button></div>`;
      }).join('') : '<p class="muted">No computer voices found in this browser.</p>'}
      <p class="muted small">Voices are picked to match each character. Change Female/Male or pick a specific voice for anyone. ${IS_IOS ? 'For more natural voices on iPhone, download "Enhanced" or "Premium" English (US) voices in Settings > Accessibility > Spoken Content > Voices.' : ''}</p>
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
  self: 'Say it, then mark yourself', paused: 'Paused',
};

function newPlayer(mode, order) {
  return {
    mode, order, orderPos: 0, status: 'idle', reveal: settings.hint, result: null, transcript: '', note: '',
    running: false, token: null, run: { lines: 0, solid: 0 }, bu: null, finishListen: null, choose: null,
  };
}
let P = newPlayer('listen', []);

const pill = () => (STATUS_TEXT[P.status] ? `<span class="pill ${P.status}">${STATUS_TEXT[P.status]}</span>` : '');

function renderPlayer() {
  const s = current();
  const label = { buildup: 'Build up', listen: 'Listen', rehearse: 'Rehearse' }[P.mode];
  return `<section class="player stack">
    <div class="row between">
      <button class="btn ghost" data-action="back">${icon('back')} Script</button>
      <span class="mode-tag">${label}${s.myChar ? ` · as ${esc(titleCase(s.myChar))}` : ''}</span>
    </div>
    <div id="stage" class="stage"></div>
    <div id="controls" class="controls"></div>
    <p class="muted small center keys"><kbd>Space</kbd> play/pause · <kbd>←</kbd> <kbd>→</kbd> move · <kbd>H</kbd> hint · <kbd>L</kbd> hear line · <kbd>Enter</kbd> done speaking</p>
    ${settingsHtml()}
  </section>`;
}

function refreshPlayer() {
  if (app.view !== 'player') return;
  const s = current();
  $('#stage').innerHTML = P.status === 'done' ? doneHtml(s) : P.mode === 'buildup' ? buildUpStageHtml(s) : lineStageHtml(s);
  $('#controls').innerHTML = `
    <button class="ctrl" data-action="prev" aria-label="Previous">${icon('prev')}</button>
    <button class="ctrl big" data-action="toggle" aria-label="${P.running ? 'Pause' : 'Play'}">${icon(P.running ? 'pause' : 'play')}</button>
    <button class="ctrl" data-action="next" aria-label="Next">${icon('next')}</button>`;
}

function myActions() {
  return `<div class="row wrap card-actions">
    <button class="btn" data-action="hint" ${P.reveal === 'full' ? 'disabled' : ''}>${icon('bulb')} Hint</button>
    <button class="btn" data-action="hearit">${icon('speaker')} Hear it</button>
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
      ${P.mode === 'rehearse' && SR ? `<p id="transcript" class="transcript">${esc(P.transcript)}</p>` : ''}
      ${myActions()}
    </div>`;
  } else {
    card = `<div class="card stage-card"><div class="card-head"><span class="who">${esc(titleCase(item.speaker))}</span>${pill()}</div><p class="script-text">${fmt(item.text)}</p></div>`;
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
      ${SR ? `<p id="transcript" class="transcript">${esc(P.transcript)}</p>` : ''}
      ${myActions()}
    </div>`;
}

function doneHtml(s) {
  const weak = s.myChar ? weakCount(s) : 0;
  let msg;
  if (P.mode === 'buildup') msg = "You've built the whole speech. Now try it in Rehearse with hints turned off.";
  else if (P.mode === 'listen') msg = 'Play it again, or switch to Rehearse and say your lines out loud.';
  else msg = `You got <b>${P.run.solid}</b> of <b>${P.run.lines}</b> lines on the first try.`;
  return `<div class="card stage-card done-card">
    <h2>${P.mode === 'buildup' ? 'Speech complete' : 'Scene complete'}</h2>
    <p>${msg}</p>
    <div class="row wrap">
      <button class="btn primary" data-action="restart">${P.mode === 'buildup' ? 'Build it again' : 'Run it again'}</button>
      ${weak && P.mode !== 'buildup' ? `<button class="btn" data-action="weak">Drill weak lines (${weak})</button>` : ''}
      <button class="btn ghost" data-action="back">Back to script</button>
    </div>
  </div>`;
}

function settingsHtml() {
  const sel = (key, opts) => `<select data-setting="${key}">${opts.map(([v, t]) => `<option value="${v}" ${String(settings[key]) === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const chk = key => `<input type="checkbox" data-setting="${key}" ${settings[key] ? 'checked' : ''}>`;
  const rng = (key, min, max, step) => `<span class="range"><input type="range" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${settings[key]}"><output>${settingLabel(key)}</output></span>`;
  return `<details class="card settings">
    <summary>Practice settings</summary>
    <div class="settings-grid">
      <label><span>Reading speed</span>${rng('rate', 0.6, 1.5, 0.05)}</label>
      <label><span>Your lines in Listen mode</span>${sel('myLines', [['gapThenSpeak', 'Pause for me, then read them'], ['gap', 'Pause for me only'], ['speak', 'Read them aloud'], ['skip', 'Skip them']])}</label>
      <label><span>Hints when it's your line</span>${sel('hint', [['hidden', 'No words, just blanks'], ['first', 'First few words'], ['initials', 'First letter of each word'], ['full', 'Show the whole line']])}</label>
      <label><span>Cue before your line (Rehearse)</span>${sel('cueLength', [['full', 'Read the whole line'], ['last', 'Last sentence only']])}</label>
      <label><span>Score needed to pass</span>${rng('passScore', 50, 100, 5)}</label>
      <label><span>Wait after you stop talking</span>${rng('silenceMs', 800, 4000, 100)}</label>
      <label class="check">${chk('readDirections')}<span>Read stage directions aloud</span></label>
      <label class="check">${chk('useRecordings')}<span>Use recorded voices when available</span></label>
      <label class="check">${chk('loop')}<span>Loop the scene in Listen mode</span></label>
    </div>
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
  stopRun();
  stopRecording();
  previewToken.cancel();
  if (sync.pending) { sync.pending = false; scheduleSync(); }
}

function startPlayer(mode, order) {
  const s = current();
  if (mode !== 'listen' && !s.myChar) { toast('Pick your character first.'); return; }
  order ||= rangeOrder(s);
  if (!order.length) { toast('Nothing to practice here yet.'); return; }
  leave();
  P = newPlayer(mode, order);
  app.view = 'player';
  render();
  run(0);
}

function startBuildUp(i) {
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
    if (item.type === 'section') await sleep(700, token);
    else if (item.type === 'direction') {
      if (settings.readDirections) { P.status = 'speaking'; refreshPlayer(); await speakText(item.text, voiceList()[0], token); }
    } else if (isMine(s, item)) await (P.mode === 'rehearse' ? rehearseLine(item, token) : listenMine(item, token));
    else { P.status = 'speaking'; refreshPlayer(); await playCue(s, p, token); }
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
  if (P.mode === 'rehearse' && settings.cueLength === 'last' && next && isMine(s, next)) {
    const parts = sentences(spokenText(text));
    text = parts[parts.length - 1] || text;
  }
  return sayLine(item, token, text);
}

const gapMs = text => Math.max(2500, words(text).length * 450 / settings.rate + 1500);

async function listenMine(item, token) {
  if (settings.myLines === 'skip') return;
  if (settings.myLines === 'speak') { P.status = 'you'; refreshPlayer(); return sayLine(item, token); }
  P.status = 'gap';
  refreshPlayer();
  await sleep(gapMs(item.text), token);
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
  if (!SR) {
    P.status = 'self';
    refreshPlayer();
    const choice = await new Promise(resolve => { P.choose = resolve; token.onCancel(() => resolve('cancel')); });
    P.choose = null;
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

const IDLE_NOTE = "Paused because I didn't hear anything. Press play when you're ready.";

async function rehearseLine(item, token) {
  const s = current(), key = lineKey(item);
  let tries = 0, idle = 0, first = null;
  // The first attempt in a run is what counts toward "solid"; best keeps your best ever.
  const note = score => {
    const st = s.stats[key] || { tries: 0, best: 0, last: 0 };
    if (first === null) {
      first = score;
      st.tries++;
      st.last = score;
      P.run.lines++;
      if (score >= settings.passScore) P.run.solid++;
    }
    st.best = Math.max(st.best, score);
    st.at = Date.now();
    s.stats[key] = st;
    saveScripts();
  };
  while (!token.cancelled) {
    const r = await attempt(item.text, token);
    if (token.cancelled) return;
    if (r.reason === 'error') return pauseRun(micError(r.error));
    if (r.reason === 'timeout' && ++idle >= 2) return pauseRun(IDLE_NOTE);
    if (r.reason === 'prompt' || r.reason === 'timeout') {
      note(0);
      P.status = 'prompting';
      refreshPlayer();
      await sayLine(item, token);
      continue;
    }
    note(r.score);
    tries++;
    if (r.score >= settings.passScore) {
      chime(true);
      P.status = 'good';
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
    await sayLine(item, token);
    if (tries >= 2) return;
  }
}

async function runBuildUp(fromK) {
  const s = current();
  const token = beginRun();
  const { i, parts } = P.bu;
  const voice = voiceFor(s.lines[i].speaker);
  for (let k = fromK; k < parts.length; k++) {
    if (token.cancelled) return;
    Object.assign(P, { result: null, transcript: '', status: 'speaking', reveal: settings.hint });
    Object.assign(P.bu, { k, phase: 'listen' });
    refreshPlayer();
    await speakText(parts[k], voice, token);
    await sleep(250, token);
    const expected = parts.slice(0, k + 1).join(' ');
    let tries = 0, idle = 0;
    while (!token.cancelled) {
      P.bu.phase = 'recite';
      P.reveal = settings.hint;
      const r = await attempt(expected, token);
      if (token.cancelled) return;
      if (r.reason === 'error') return pauseRun(micError(r.error));
      if (r.reason === 'timeout' && ++idle >= 2) return pauseRun(IDLE_NOTE);
      if (r.score != null && r.score >= settings.passScore) {
        chime(true);
        P.status = 'good';
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
      await speakText(expected, voice, token);
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
    let p = P.orderPos;
    do { p += delta; } while (p > 0 && p < P.order.length - 1 && s.lines[P.order[p]].type !== 'line');
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
  app.view = 'script';
  render();
  window.scrollTo(0, 0);
}

const actions = {
  home() { leave(); app.view = 'library'; render(); },
  new() { leave(); app.editing = { id: null, title: '', raw: '' }; app.view = 'edit'; render(); $('#ed-title').focus(); },
  sample() {
    const s = makeScript('Romeo and Juliet: the balcony (sample)', SAMPLE);
    s.myChar = 'JULIET';
    scripts.push(s);
    saveScripts();
    openScript(s.id);
  },
  open(b) { openScript(b.dataset.id); },
  'edit-script'() {
    const s = current();
    leave();
    app.editing = { id: s.id, title: s.title, raw: s.raw };
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
  'cancel-edit'() { app.view = app.editing.id ? 'script' : 'library'; render(); },
  'save-edit'() {
    const title = $('#ed-title').value.trim(), raw = $('#ed-raw').value;
    const lines = parseScript(raw);
    if (!lines.some(l => l.type === 'line')) { toast("I couldn't find any lines yet. Check the format tips."); return; }
    let s = app.editing.id && scripts.find(x => x.id === app.editing.id);
    if (s) {
      Object.assign(s, { title: title || s.title, raw, lines, updated: Date.now() });
      delete s.rangeStart;
      delete s.rangeEnd;
    } else {
      s = makeScript(title, raw);
      scripts.push(s);
    }
    const chars = characters(s);
    if (!chars.has(s.myChar)) s.myChar = chars.size === 1 ? [...chars.keys()][0] : '';
    saveScripts();
    openScript(s.id);
  },
  listen() { startPlayer('listen'); },
  rehearse() { startPlayer('rehearse'); },
  weak() { startPlayer('rehearse', weakOrder(current())); },
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
    preview(t => speakText(`Hello. I'll be reading ${titleCase(c)}.`, voiceFor(c), t));
  },
  back() { leave(); app.view = 'script'; render(); },
  toggle: togglePlay,
  prev() { jump(-1); },
  next() { jump(1); },
  hint() { P.reveal = REVEAL[Math.min(REVEAL.length - 1, REVEAL.indexOf(P.reveal) + 1)]; refreshPlayer(); },
  hearit() {
    if (P.status === 'listening') return P.finishListen?.('prompt');
    if (P.status === 'self') return P.choose?.('hear');
    if (P.running) return;
    const s = current();
    if (P.mode === 'buildup') {
      const { i, parts, k } = P.bu;
      return preview(t => speakText(parts.slice(0, k + 1).join(' '), voiceFor(s.lines[i].speaker), t));
    }
    const item = s.lines[P.order[P.orderPos]];
    if (item?.type === 'line') preview(t => sayLine(item, t));
  },
  'done-speaking'() { P.finishListen?.('manual'); },
  choose(b) { P.choose?.(b.dataset.choice); },
  restart() {
    P.status = 'idle';
    if (P.mode === 'buildup') { P.bu.k = 0; runBuildUp(0); }
    else { P.run = { lines: 0, solid: 0 }; run(0); }
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
  if (el.type === 'range') el.nextElementSibling.textContent = settingLabel(key);
  if (key === 'hint' && !P.result) { P.reveal = settings.hint; refreshPlayer(); }
}

document.addEventListener('change', e => {
  const el = e.target, s = current();
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
    preview(t => speakText(`Hello. I'll be reading ${titleCase(el.dataset.voiceChar)}.`, voiceFor(el.dataset.voiceChar), t));
  } else if (el.dataset.genderChar) {
    const c = el.dataset.genderChar;
    (s.genders ||= {})[c] = el.value;
    delete s.voices?.[c];
    s.updated = Date.now();
    saveScripts();
    render();
    preview(t => speakText(`Hello. I'll be reading ${titleCase(c)}.`, voiceFor(c), t));
  }
  else if (el.dataset.setting) applySetting(el);
  else if (el.id === 'ed-file' && el.files[0]) {
    importFile(el.files[0]);
    el.value = '';
  }
});

document.addEventListener('dragover', e => { if (e.target.id === 'ed-raw') e.preventDefault(); });
document.addEventListener('drop', e => {
  if (e.target.id !== 'ed-raw' || !e.dataTransfer.files[0]) return;
  e.preventDefault();
  importFile(e.dataTransfer.files[0]);
});

document.addEventListener('input', e => {
  if (e.target.id === 'ed-raw') updatePreview();
  else if (e.target.dataset.setting && e.target.type === 'range') applySetting(e.target);
});

document.addEventListener('toggle', e => { if (e.target.id === 'voices') app.voicesOpen = e.target.open; }, true);

document.addEventListener('keydown', e => {
  if (app.view !== 'player' || e.ctrlKey || e.metaKey || e.altKey) return;
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
  scripts = scripts.filter(s => !((deleted[s.id] || 0) >= (s.updated || 0)));
}

function scheduleSync() {
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
  b.textContent = !syncConf.token ? 'Sync' : sync.busy ? 'Syncing…' : sync.error ? 'Sync problem' : 'Synced';
  b.classList.toggle('problem', !!(syncConf.token && sync.error));
}

function renderSync() {
  if (syncConf.token) {
    return `<section class="stack">
      <h1>Sync between devices</h1>
      <div class="card stack-sm">
        <p><b>This device is connected.</b> ${sync.busy ? 'Syncing now…' : syncConf.lastSync ? `Last synced ${ago(syncConf.lastSync)}.` : 'Not synced yet.'}</p>
        ${sync.error ? `<p class="note">${esc(sync.error)}</p>` : ''}
        <p class="muted">Changes sync on their own a few seconds after you make them, and whenever you open the app. Tap Sync now to pull the latest from your other device.</p>
        <div class="row wrap">
          <button class="btn primary" data-action="sync-now" ${sync.busy ? 'disabled' : ''}>Sync now</button>
          <button class="btn ghost" data-action="sync-disconnect">Disconnect this device</button>
        </div>
      </div>
      <p class="muted small">Your scripts and progress are kept in a secret Gist on your GitHub account. It isn't listed anywhere, but anyone with its link could read it, so don't share that link. Voices and recordings stay on each device.</p>
    </section>`;
  }
  return `<section class="stack">
    <h1>Sync between devices</h1>
    <p class="lede">Keep the same scripts and progress on your phone and computer. You set this up once on each device.</p>
    ${sync.error ? `<p class="note">${esc(sync.error)}</p>` : ''}
    <div class="card stack-sm">
      <ol class="steps-list">
        <li>Open <a href="${TOKEN_URL}" target="_blank" rel="noopener">GitHub's new access key page</a> and sign in. It comes pre-filled with only the <b>gist</b> box ticked, which is all Line Learner needs.</li>
        <li>Choose an expiration (or "No expiration"), then tap <b>Generate token</b> at the bottom.</li>
        <li>Copy the key (it starts with <code>ghp_</code>) and paste it here:</li>
      </ol>
      <label class="field"><span>GitHub access key</span><input id="sync-token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ghp_…"></label>
      <div class="row"><button class="btn primary" data-action="sync-connect" ${sync.busy ? 'disabled' : ''}>${sync.busy ? 'Connecting…' : 'Connect'}</button></div>
    </div>
    <p class="muted small">Then do the same on your other device. Making a second key there is easiest; the app finds your existing scripts automatically. The key is saved only in this browser.</p>
  </section>`;
}

Object.assign(actions, {
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
function render() {
  const view = { library: renderLibrary, edit: renderEdit, script: renderScript, player: renderPlayer, sync: renderSync }[app.view];
  $('#app').innerHTML = view();
  if (app.view === 'player') refreshPlayer();
  if (app.view === 'edit') updatePreview();
  $('#crumb').textContent = app.view === 'script' || app.view === 'player' ? current()?.title ?? '' : '';
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
showSyncStatus();
runSync();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - (syncConf.lastSync || 0) > 30000) runSync();
});
