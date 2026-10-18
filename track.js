'use strict';

// Listen, screen off: builds the scene into one audio file (cue lines in their voices, a pause for each of
// your lines, then your line, following the Listen settings). A plain audio file keeps playing when the
// phone locks and shows lock-screen controls, unlike the app's speaking voices.
// Uses the AI voices (and your own recordings), since the phone's built-in voices can't be saved as audio.
// Loaded after app.js and uses its helpers.

const TRACK_RATE = 16000; // plenty for speech, and keeps a long scene's file a manageable size
const TRACK_MAX_MIN = 45;
const track = { building: false, stop: false, done: 0, total: 0, started: 0, url: '', blob: null, sig: '', sections: [], minutes: 0, error: '' };

// What the track depends on: the lines, their voices, and the Listen settings that shape it.
function trackSig(s) {
  return hash(JSON.stringify([s.id, s.updated, rangeBounds(s), s.myChar, s.aiVoices, s.aiStyles, s.genders,
    settings.myLines, settings.rate, settings.useRecordings, aiReady()]));
}

function trackReady(s) {
  if (aiReady()) return true;
  // Without AI voices, every line that has to be heard needs one of your recordings.
  return rangeOrder(s).map(i => s.lines[i]).filter(l => l.type === 'line' && (!isMine(s, l) || ['speak', 'gapThenSpeak'].includes(settings.myLines)))
    .every(l => settings.useRecordings && recorded.has(lineKey(l)));
}

function renderTrack() {
  const s = current();
  const ready = trackReady(s);
  const fresh = track.url && track.sig === trackSig(s);
  const myLinesText = { gapThenSpeak: 'a pause for you to say it, then your line', gap: 'a pause for you to say it', speak: 'your line read aloud', skip: 'nothing (skipped)' }[settings.myLines];
  let body;
  if (!ready) {
    body = `<div class="note"><p><b>This needs the AI voices.</b> The phone's built-in voices can't be saved as audio, so a screen-off track uses the natural AI voices (or your own recordings of every line).</p>
      <p class="small">Add an OpenAI key on the script page under <b>Voices for each character</b>, then come back.</p></div>`;
  } else if (track.building) {
    const pct = Math.round(100 * track.done / Math.max(1, track.total));
    const mins = track.done ? (Date.now() - track.started) / track.done * (track.total - track.done) / 60000 : 0;
    body = `<div class="card stack-sm tray-status" role="status">
      <div class="bar" aria-hidden="true"><div style="width:${pct}%"></div></div>
      <p class="small"><b>Making the track: line ${track.done} of ${track.total}</b>${track.done && mins >= 0.1 ? ` · about ${Math.max(1, Math.round(mins))} min left` : ''}</p>
      <p class="muted small">Lines already made play free; new ones use your OpenAI key. Keep this screen open.</p>
      <div><button class="btn ghost" data-action="track-stop">Stop</button></div></div>`;
  } else if (fresh) {
    body = `<div class="card stack-sm">
      <audio id="track-audio" controls playsinline preload="auto" src="${track.url}"></audio>
      <p class="muted small">${track.minutes} min · Lock your phone and it keeps playing. Pause and skip from the lock screen or your AirPods.</p>
      ${track.sections.length > 1 ? `<div class="row wrap chips">${track.sections.map((x, i) => `<button class="chip" data-action="track-jump" data-i="${i}">${esc(x.label)}</button>`).join('')}</div>` : ''}
      <div class="row wrap"><button class="btn ghost" data-action="track-save">Save as a file</button><button class="btn ghost" data-action="track-make">Make it again</button></div>
    </div>`;
  } else {
    body = `<div class="card stack-sm">
      <p>The track plays the ${rangeBounds(s)[0] > 0 || rangeBounds(s)[1] < s.lines.length ? 'part of the script you chose (Start at / Stop)' : 'whole script'}: other characters' lines in their voices, and for your lines, ${myLinesText}.</p>
      <p class="muted small">Change these in Listen's Practice settings. Very long scripts make very long files, so pick a scene or act with Start at / Stop.</p>
      ${track.error ? `<p class="note small">${esc(track.error)}</p>` : ''}
      <div><button class="btn primary" data-action="track-make">${track.url ? 'Make the track again' : 'Make the track'}</button></div>
    </div>`;
  }
  return `<section class="stack">
    <div class="row between wrap"><button class="btn ghost" data-action="back">${icon('back')} Script</button><span class="mode-tag">Listen, screen off${s.myChar ? ` · as ${esc(titleCase(s.myChar))}` : ''}</span></div>
    <h1>${esc(s.title)}</h1>
    ${body}
  </section>`;
}

// ---------- Building the audio ----------
const silence = sec => new Int16Array(Math.max(0, Math.round(sec * TRACK_RATE)));

function toInt16(buf) {
  const n = buf.length, out = new Int16Array(n), chans = buf.numberOfChannels;
  const data = Array.from({ length: chans }, (_, c) => buf.getChannelData(c));
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let c = 0; c < chans; c++) v += data[c][i];
    v = Math.max(-1, Math.min(1, v / chans));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

// Decodes MP3/recordings, resampled to the track's rate by the decoder itself.
let trackDecoder;
async function decode(blob) {
  trackDecoder ||= new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, TRACK_RATE, TRACK_RATE);
  return toInt16(await trackDecoder.decodeAudioData(await blob.arrayBuffer()));
}

async function lineAudio(s, l) {
  const key = lineKey(l);
  if (settings.useRecordings && recorded.has(key)) {
    const blob = await recordings.get(key).catch(() => null);
    if (blob) return [await decode(blob)];
  }
  const voice = aiVoiceFor(s, l.speaker), instructions = aiInstructions(s, l.speaker, l.text);
  const out = [];
  for (const piece of chunksOf(spokenText(l.text), 3000)) out.push(await decode(await aiAudio(voice, instructions, piece)));
  return out;
}

function wavHeader(dataBytes) {
  const b = new ArrayBuffer(44), v = new DataView(b);
  const put = (o, str) => [...str].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  put(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); put(8, 'WAVE'); put(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, TRACK_RATE, true); v.setUint32(28, TRACK_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  put(36, 'data'); v.setUint32(40, dataBytes, true);
  return b;
}

async function buildTrack() {
  const s = current();
  if (track.building) return;
  const items = rangeOrder(s).map(i => s.lines[i]);
  Object.assign(track, { building: true, stop: false, done: 0, total: items.filter(l => l.type === 'line').length, started: Date.now(), error: '', sections: [] });
  if (track.url) URL.revokeObjectURL(track.url);
  Object.assign(track, { url: '', blob: null });
  keepAwake(true);
  render();
  const parts = [];
  let samples = 0;
  const add = a => { parts.push(a); samples += a.length; };
  // Gaps are sped up along with the track at playback, so stretch them to match.
  const gapSec = l => gapMs(l.text) / 1000 * settings.rate;
  try {
    for (const l of items) {
      if (track.stop) break;
      if (samples / TRACK_RATE / 60 > TRACK_MAX_MIN) { track.error = `Stopped at ${TRACK_MAX_MIN} minutes to keep the file manageable. Pick a shorter part with Start at / Stop for the rest.`; break; }
      if (l.type === 'section') { track.sections.push({ label: l.text, t: samples / TRACK_RATE }); add(silence(1.2)); continue; }
      if (l.type !== 'line') continue;
      if (isMine(s, l)) {
        if (settings.myLines !== 'skip') {
          if (settings.myLines !== 'speak') add(silence(gapSec(l)));
          if (settings.myLines !== 'gap') for (const a of await lineAudio(s, l)) add(a);
        }
      } else {
        for (const a of await lineAudio(s, l)) add(a);
      }
      add(silence(0.35));
      track.done++;
      if (track.done % 3 === 0 || track.done === track.total) render();
    }
    if (!samples) throw new Error('Nothing to play in this part of the script.');
    if (!track.sections.length || track.sections[0].t > 0) track.sections.unshift({ label: 'Start', t: 0 });
    const blob = new Blob([wavHeader(samples * 2), ...parts], { type: 'audio/wav' });
    Object.assign(track, { blob, url: URL.createObjectURL(blob), sig: trackSig(s), minutes: Math.max(1, Math.round(samples / TRACK_RATE / 60 / settings.rate)) });
    if (track.stop) track.error = 'Stopped early: the track has the lines made so far.';
  } catch (e) {
    track.error = (e.status ? e.message : e.message || "Couldn't make the track.") + ' Lines made so far are saved, so trying again picks up quickly.';
  } finally {
    track.building = false;
    keepAwake(false);
    render();
  }
}

// Lock-screen title and skip buttons.
function setupTrackPlayer() {
  const audio = $('#track-audio');
  if (!audio) return;
  audio.playbackRate = settings.rate;
  audio.preservesPitch = audio.webkitPreservesPitch = true;
  audio.onplay = () => { audio.playbackRate = settings.rate; };
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: current()?.title || 'Line Learner', artist: 'Line Learner' });
    const skip = d => { audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + d)); };
    try {
      navigator.mediaSession.setActionHandler('seekbackward', () => skip(-10));
      navigator.mediaSession.setActionHandler('seekforward', () => skip(10));
    } catch { /* not supported here */ }
  }
}

Object.assign(actions, {
  track() { leave(); app.view = 'track'; render(); window.scrollTo(0, 0); },
  'track-make'() { return buildTrack(); },
  'track-stop'() { track.stop = true; },
  'track-jump'(b, i) {
    const audio = $('#track-audio'), sec = track.sections[i]?.t;
    if (!audio || sec == null) return;
    audio.currentTime = sec;
    audio.play().catch(() => {});
  },
  'track-save'() {
    if (!track.blob) return;
    const a = document.createElement('a');
    a.href = track.url;
    a.download = `${(current()?.title || 'scene').replace(/[^\w\s-]+/g, '').trim() || 'scene'} - Line Learner.wav`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  },
});

VIEWS.track = renderTrack;
