'use strict';

// Listen, screen off: builds part of a script into one audio file (cue lines in their voices, a pause for
// each of your lines, then your line, following the Listen settings). A plain audio file keeps playing when
// the phone locks and shows lock-screen controls, unlike the app's speaking voices. Finished tracks are kept
// on this device, so you can make one per scene, play them any time, and delete them when you're done.
// Uses the AI voices (and your own recordings), since the phone's built-in voices can't be saved as audio.
// Loaded after app.js and uses its helpers.

const TRACK_RATE = 16000; // plenty for speech, and keeps a long scene's file a manageable size
const TRACK_MAX_MIN = 45;
const track = {
  building: false, stop: false, done: 0, total: 0, started: 0, error: '',
  scriptId: null, from: 0, to: 0,     // the part of the script to make next
  cuesOnly: false,                    // just your cues and lines (off unless you tick it)
  list: null, playing: null, url: '', // saved tracks for this script, and the one in the player
};

// The part of the script chosen for the next track: [first index, index after the last].
function trackPart(s) {
  if (track.scriptId !== s.id) Object.assign(track, { scriptId: s.id, list: null, playing: null, error: '', cuesOnly: false }, { from: rangeBounds(s)[0], to: rangeBounds(s)[1] });
  const from = clamp(track.from, 0, Math.max(0, s.lines.length - 1));
  return [from, clamp(track.to, from + 1, s.lines.length)];
}

const sectionsOf = s => s.lines.map((l, i) => (l.type === 'section' ? i : -1)).filter(i => i >= 0);

// The lines that go into the track: the whole part, or (Just my cues and lines) only your lines and the
// line before each, plus section headings so the track keeps its chapters.
function trackItems(s, [from, to]) {
  const all = s.lines.slice(from, to);
  if (!track.cuesOnly || !s.myChar) return all;
  const keep = new Set();
  for (let i = from; i < to; i++) {
    if (!isMine(s, s.lines[i])) continue;
    keep.add(i);
    const cue = prevLineIndex(s, i);
    if (cue >= from) keep.add(cue);
  }
  return all.filter((l, k) => l.type === 'section' || keep.has(from + k));
}
const trackName = (s, part) => partLabel(s, part) + (track.cuesOnly && s.myChar ? ' (cues only)' : '');

function partLabel(s, [from, to]) {
  if (from === 0 && to >= s.lines.length) return 'Whole script';
  const inside = sectionsOf(s).filter(i => i >= from && i < to);
  const first = s.lines[from]?.type === 'section' ? s.lines[from].text : inside.length ? s.lines[inside[0]].text : 'From the start';
  return inside.length > 1 ? `${first} to ${s.lines[inside.at(-1)].text}` : first;
}

// What a track depends on: the part, the lines, their voices, and the Listen settings that shape it.
function trackSig(s, part) {
  return hash(JSON.stringify([s.id, s.updated, part, s.myChar, track.cuesOnly && !!s.myChar, s.aiVoices, s.aiStyles, s.genders,
    settings.myLines, settings.rate, settings.useRecordings, aiReady()]));
}

function trackReady(s, [from, to]) {
  if (aiReady()) return true;
  // Without AI voices, every line that has to be heard needs one of your recordings.
  return trackItems(s, [from, to]).filter(l => l.type === 'line' && (!isMine(s, l) || ['speak', 'gapThenSpeak'].includes(settings.myLines)))
    .every(l => settings.useRecordings && recorded.has(lineKey(l)));
}

async function loadTrackList(s) {
  try {
    track.list = (await savedTracks.all()).filter(t => t.scriptId === s.id).sort((a, b) => b.created - a.created);
  } catch {
    track.list = [];
  }
  if (app.view === 'track') render();
}

const mb = bytes => `${(bytes / 1048576).toFixed(bytes > 10485760 ? 0 : 1)} MB`;

function renderTrack() {
  const s = current();
  const part = trackPart(s);
  if (!track.list) loadTrackList(s);
  const sections = sectionsOf(s);
  const myLinesText = { gapThenSpeak: 'a pause for you to say it, then your line', gap: 'a pause for you to say it', speak: 'your line read aloud', skip: 'nothing (skipped)' }[settings.myLines];
  const sig = trackSig(s, part);
  const already = (track.list || []).find(t => t.sig === sig);

  // The player, for the saved track you picked.
  const p = track.playing;
  const player = p ? `<div class="card stack-sm">
      <b>${esc(p.label)}</b>
      <audio id="track-audio" controls playsinline preload="auto" src="${track.url}"></audio>
      <p class="muted small">${p.minutes} min · Lock your phone and it keeps playing. Pause and skip from the lock screen or your AirPods.</p>
      ${p.sections.length > 1 ? `<div class="row wrap chips">${p.sections.map((x, i) => `<button class="chip" data-action="track-jump" data-i="${i}">${esc(x.label)}</button>`).join('')}</div>` : ''}
      <div class="row wrap"><button class="btn ghost" data-action="track-save">Save as a file</button><button class="btn ghost" data-action="track-delete" data-id="${esc(p.id)}">Delete track</button></div>
    </div>` : '';

  // Saved tracks for this script.
  const list = track.list?.length ? `<div class="stack-sm"><h2>Saved tracks</h2><ul class="share-list">${track.list.map(t => `<li class="share-row">
      <div class="lib-main"><b>${esc(t.label)}</b><span class="muted small">${t.minutes} min · ${mb(t.blob.size)}${t.sig === sig ? '' : ' · made before your latest changes'}</span></div>
      <div class="row"><button class="btn${p?.id === t.id ? '' : ' primary'}" data-action="track-play" data-id="${esc(t.id)}">${p?.id === t.id ? 'Playing' : 'Play'}</button>
        <button class="btn ghost" data-action="track-delete" data-id="${esc(t.id)}">Delete</button></div></li>`).join('')}</ul>
      <p class="muted small">Saved on this device, so they play even offline. Delete ones you're done with to free up space.</p></div>` : '';

  // Making a new track.
  let maker;
  if (!trackReady(s, part)) {
    maker = `<div class="note"><p><b>This needs the AI voices.</b> The phone's built-in voices can't be saved as audio, so a screen-off track uses the natural AI voices (or your own recordings of every line).</p>
      <p class="small">Add an OpenAI key on the script page under <b>Voices for each character</b>, then come back.</p></div>`;
  } else if (track.building) {
    const pct = Math.round(100 * track.done / Math.max(1, track.total));
    const mins = track.done ? (Date.now() - track.started) / track.done * (track.total - track.done) / 60000 : 0;
    maker = `<div class="card stack-sm tray-status" role="status">
      <div class="bar" aria-hidden="true"><div style="width:${pct}%"></div></div>
      <p class="small"><b>Making “${esc(trackName(s, part))}”: line ${track.done} of ${track.total}</b>${track.done && mins >= 0.1 ? ` · about ${Math.max(1, Math.round(mins))} min left` : ''}</p>
      <p class="muted small">Lines already made play free; new ones use your OpenAI key. Keep this screen open.</p>
      <div><button class="btn ghost" data-action="track-stop">Stop</button></div></div>`;
  } else {
    const fromOpts = `<option value="0"${part[0] === 0 ? ' selected' : ''}>The beginning</option>` + sections.map(i => `<option value="${i}"${i === part[0] ? ' selected' : ''}>${esc(s.lines[i].text)}</option>`).join('');
    const toOpts = `<option value="${s.lines.length}"${part[1] >= s.lines.length ? ' selected' : ''}>The end</option>` + sections.filter(i => i > part[0]).map(i => `<option value="${i}"${i === part[1] ? ' selected' : ''}>Before ${esc(s.lines[i].text)}</option>`).join('');
    const lines = trackItems(s, part).filter(l => l.type === 'line').length;
    maker = `<div class="card stack-sm">
      <b>Make a track</b>
      ${sections.length ? `<div class="row wrap">
        <label class="field inline"><span>From</span><select id="track-from">${fromOpts}</select></label>
        <label class="field inline"><span>Stop</span><select id="track-to">${toOpts}</select></label></div>` : ''}
      ${s.myChar ? `<label class="check-row"><input type="checkbox" id="track-cues" ${track.cuesOnly ? 'checked' : ''}><span><b>Just my cues and lines</b> (skip the rest of the scene)</span></label>` : ''}
      <p class="small">“${esc(trackName(s, part))}”: ${lines} lines. Other characters in their voices; for your lines, ${myLinesText} (change this in Listen's Practice settings).</p>
      ${track.error ? `<p class="note small">${esc(track.error)}</p>` : ''}
      ${already ? `<p class="small">This part is already saved. <button class="link-btn" data-action="track-play" data-id="${esc(already.id)}">Play it</button></p>` : ''}
      <div><button class="btn ${already ? '' : 'primary'}" data-action="track-make">${already ? 'Make it again' : 'Make the track'}</button></div>
    </div>`;
  }

  return `<section class="stack">
    <div class="row between wrap"><button class="btn ghost" data-action="back">${icon('back')} Script</button><span class="mode-tag">Listen, screen off${s.myChar ? ` · as ${esc(titleCase(s.myChar))}` : ''}</span></div>
    <h1>${esc(s.title)}</h1>
    ${player}
    ${maker}
    ${list}
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
  const part = trackPart(s);
  const items = trackItems(s, part);
  Object.assign(track, { building: true, stop: false, done: 0, total: items.filter(l => l.type === 'line').length, started: Date.now(), error: '' });
  keepAwake(true);
  render();
  const parts = [], sections = [];
  let samples = 0;
  const add = a => { parts.push(a); samples += a.length; };
  // Gaps are sped up along with the track at playback, so stretch them to match.
  const gapSec = l => gapMs(l.text) / 1000 * settings.rate;
  try {
    for (const l of items) {
      if (track.stop) break;
      if (samples / TRACK_RATE / 60 > TRACK_MAX_MIN) { track.error = `Stopped at ${TRACK_MAX_MIN} minutes to keep the file manageable. Make the rest as another track.`; break; }
      if (l.type === 'section') { sections.push({ label: l.text, t: samples / TRACK_RATE }); add(silence(1.2)); continue; }
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
    if (!sections.length || sections[0].t > 0) sections.unshift({ label: 'Start', t: 0 });
    const saved = {
      id: uid(), scriptId: s.id, label: trackName(s, part) + (track.stop ? ' (stopped early)' : ''), created: Date.now(),
      blob: new Blob([wavHeader(samples * 2), ...parts], { type: 'audio/wav' }),
      minutes: Math.max(1, Math.round(samples / TRACK_RATE / 60 / settings.rate)), sections, sig: trackSig(s, part),
    };
    try {
      await savedTracks.put(saved);
      navigator.storage?.persist?.().catch(() => {}); // ask the phone not to clear saved tracks when space is low
    } catch {
      track.error = "Made the track, but there wasn't room to keep it on this device. Use Save as a file to keep it.";
    }
    track.list = [saved, ...(track.list || [])];
    playTrack(saved);
  } catch (e) {
    track.error = (e.message || "Couldn't make the track.") + ' Lines made so far are saved, so trying again picks up quickly.';
  } finally {
    track.building = false;
    keepAwake(false);
    render();
  }
}

function playTrack(t) {
  if (track.url) URL.revokeObjectURL(track.url);
  track.playing = t;
  track.url = URL.createObjectURL(t.blob);
}

// Lock-screen title and skip buttons.
function setupTrackPlayer() {
  const audio = $('#track-audio');
  if (!audio) return;
  audio.playbackRate = settings.rate;
  audio.preservesPitch = audio.webkitPreservesPitch = true;
  audio.onplay = () => { audio.playbackRate = settings.rate; };
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.playing?.label || 'Line Learner', artist: current()?.title || 'Line Learner' });
    const skip = d => { audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + d)); };
    try {
      navigator.mediaSession.setActionHandler('seekbackward', () => skip(-10));
      navigator.mediaSession.setActionHandler('seekforward', () => skip(10));
    } catch { /* not supported here */ }
  }
}

// Removes a script's saved tracks (when the script itself is deleted).
async function deleteTracksFor(scriptId) {
  try {
    for (const t of await savedTracks.all()) if (t.scriptId === scriptId) await savedTracks.del(t.id);
  } catch { /* nothing saved */ }
}

Object.assign(actions, {
  track() { leave(); app.view = 'track'; render(); window.scrollTo(0, 0); },
  'track-make'() { return buildTrack(); },
  'track-stop'() { track.stop = true; },
  'track-play'(b) {
    const t = track.list?.find(x => x.id === b.dataset.id);
    if (!t) return;
    playTrack(t);
    render();
    window.scrollTo(0, 0);
    $('#track-audio')?.play().catch(() => {});
  },
  async 'track-delete'(b) {
    const t = track.list?.find(x => x.id === b.dataset.id);
    if (!t || !confirm(`Delete the track "${t.label}"? You can make it again later.`)) return;
    await savedTracks.del(t.id).catch(() => {});
    track.list = track.list.filter(x => x.id !== t.id);
    if (track.playing?.id === t.id) {
      URL.revokeObjectURL(track.url);
      Object.assign(track, { playing: null, url: '' });
    }
    toast('Track deleted.');
    render();
  },
  'track-jump'(b, i) {
    const audio = $('#track-audio'), sec = track.playing?.sections[i]?.t;
    if (!audio || sec == null) return;
    audio.currentTime = sec;
    audio.play().catch(() => {});
  },
  'track-save'() {
    if (!track.playing) return;
    const a = document.createElement('a');
    a.href = track.url;
    a.download = `${(current()?.title || 'scene').replace(/[^\w\s-]+/g, '').trim() || 'scene'} - ${track.playing.label.replace(/[^\w\s-]+/g, '').trim()}.wav`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  },
});

document.addEventListener('change', e => {
  if (e.target.id === 'track-cues') { track.cuesOnly = e.target.checked; track.error = ''; render(); return; }
  if (e.target.id === 'track-from' || e.target.id === 'track-to') {
    const s = current();
    const [from, to] = trackPart(s);
    if (e.target.id === 'track-from') { track.from = +e.target.value; if (to <= track.from) track.to = s.lines.length; }
    else { track.from = from; track.to = +e.target.value; }
    track.error = '';
    render();
  }
});

VIEWS.track = renderTrack;
