'use strict';

// Song practice: lyrics (found on LRCLIB, a free lyrics database, or pasted), the real track through
// Spotify's embedded player, the current line highlighted in time, and words hidden as you learn them.
// Loaded after app.js and uses its helpers.

// Your Spotify app's Client ID, from developer.spotify.com/dashboard. It isn't secret.
const SPOTIFY_CLIENT_ID = '9ba62f10431b4c3c8812fc288e3b71de';

// ---------- Lyrics text ----------
// Lyrics are kept as text, optionally in LRC format: "[01:23.45] a line" marks when each line starts.
const LRC_TIME = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;

function parseSong(raw) {
  const lines = [], times = [];
  for (const rawLine of raw.replace(/\r/g, '').split('\n')) {
    let t = rawLine.trim();
    if (!t || /^\[[a-z]+:[^\]]*\]$/i.test(t)) continue; // blank, or LRC details like [ar: Artist]
    let time = null;
    t = t.replace(LRC_TIME, (_, m, s) => {
      if (time === null) time = +m * 60 + parseFloat(s.replace(':', '.'));
      return '';
    }).trim();
    const heading = t.match(/^[[(]([^\])]+)[\])]$/);
    if (heading && time === null) { lines.push({ type: 'section', text: heading[1] }); continue; }
    if (!t) continue; // a timed gap (instrumental)
    lines.push({ type: 'line', speaker: 'YOU', text: t });
    times.push(time);
  }
  return { lines, times };
}

const fmtTime = sec => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const enc = encodeURIComponent;

// ---------- Lyrics search (LRCLIB) ----------
async function lrclib(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try { res = await fetch('https://lrclib.net/api/' + path); } catch { throw new Error("Couldn't reach the lyrics service. Check your connection."); }
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    if (res.status !== 503 && res.status !== 429) throw new Error(`The lyrics service answered with an error (${res.status}).`);
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); // it's often briefly busy
  }
  throw new Error('The lyrics service is busy right now. Try again in a minute, or paste the lyrics.');
}
const lyricsSearch = q => lrclib('search?q=' + enc(q));
const lyricsFor = tr => lrclib(`get?track_name=${enc(tr.title)}&artist_name=${enc(tr.artist.split(',')[0])}${tr.duration ? '&duration=' + Math.round(tr.duration) : ''}`);
const lyricsText = hit => hit.syncedLyrics || hit.plainLyrics || '';

// ---------- Spotify sign-in (PKCE: no secret needed in the app) ----------
const LS_SPOTIFY = 'lineLearner.spotify';
const LS_SPOTIFY_AUTH = 'lineLearner.spotifyAuth';
const SPOTIFY_REDIRECT = location.origin + location.pathname.replace(/index\.html$/, '');
const spotify = loadJSON(LS_SPOTIFY, {}); // { access, refresh, expires }
const spotifyReady = () => !!(SPOTIFY_CLIENT_ID && spotify.refresh);
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Reading and controlling playback lets the app play full songs in your own Spotify app (Premium).
const PLAYER_SCOPES = 'user-read-playback-state user-modify-playback-state';
const canControlApp = () => spotifyReady() && (spotify.scope || '').includes('user-modify-playback-state');

async function spotifyLogin() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
  // Come back to the same place: the song being written, or the song being sung.
  saveJSON(LS_SPOTIFY_AUTH, { verifier, state, view: app.view, scriptId: app.scriptId });
  saveDraft();
  location.href = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    response_type: 'code', client_id: SPOTIFY_CLIENT_ID, redirect_uri: SPOTIFY_REDIRECT, state,
    scope: `playlist-read-private playlist-read-collaborative user-library-read ${PLAYER_SCOPES}`,
    code_challenge_method: 'S256', code_challenge: challenge,
  });
}

async function spotifyToken(body) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: SPOTIFY_CLIENT_ID, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description ? `Spotify: ${data.error_description}` : `Spotify sign-in failed (${res.status}).`);
  Object.assign(spotify, { access: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 });
  if (data.refresh_token) spotify.refresh = data.refresh_token;
  if (data.scope) spotify.scope = data.scope;
  saveJSON(LS_SPOTIFY, spotify);
}

// Finishes signing in when Spotify sends you back to the app with ?code=…
async function finishSpotifyLogin() {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return;
  const saved = loadJSON(LS_SPOTIFY_AUTH, null);
  history.replaceState(null, '', SPOTIFY_REDIRECT);
  try { localStorage.removeItem(LS_SPOTIFY_AUTH); } catch { /* nothing saved */ }
  if (params.get('error') || !saved || saved.state !== params.get('state')) { toast('Spotify sign-in was cancelled.'); return; }
  try {
    await spotifyToken({ grant_type: 'authorization_code', code: params.get('code'), redirect_uri: SPOTIFY_REDIRECT, code_verifier: saved.verifier });
    toast('Spotify connected.');
  } catch (e) {
    toast(e.message);
  }
  const d = pendingDraft();
  if (saved.view === 'sing' && scripts.some(x => x.id === saved.scriptId)) { app.scriptId = saved.scriptId; app.view = 'sing'; render(); }
  else if (d?.kind === 'song') { app.editing = d; app.view = 'edit'; render(); }
}

async function spotifyApi(path, opts = {}, retried = false) {
  if (!spotify.access || Date.now() > spotify.expires) await spotifyToken({ grant_type: 'refresh_token', refresh_token: spotify.refresh });
  const res = await fetch('https://api.spotify.com/v1' + path, {
    method: opts.method || 'GET',
    headers: { Authorization: 'Bearer ' + spotify.access, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && !retried) { spotify.expires = 0; return spotifyApi(path, opts, true); }
  if (res.status === 404 && path.startsWith('/me/player')) {
    const err = new Error("Spotify isn't open anywhere. Open the Spotify app on this phone, play any song for a second, then come back and tap Play.");
    err.status = 404;
    throw err;
  }
  if (!res.ok) {
    const said = (await res.json().catch(() => ({}))).error?.message || '';
    // Since February 2026 Spotify only serves personal (Development Mode) apps whose owner has Premium,
    // and only to the few users added in the app's User Management.
    const err = new Error(res.status === 403
      ? `Spotify refused${said ? ` ("${said}")` : ''}. Spotify only allows personal apps like this one when the app's owner has Spotify Premium, and only for people added under User Management.`
      : `Spotify answered with an error (${res.status}${said ? `: ${said}` : ''}).`);
    err.status = res.status;
    throw err;
  }
  // Player commands answer with no body ("204 No Content"); so does currently-playing when nothing plays.
  const text = res.status === 204 ? '' : await res.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// Plays the song in your own Spotify app (full song, your account) and follows its position, so the
// lyrics stay in time. Same shape as Spotify's embedded player controller: togglePlay, resume, seek, destroy.
// Which of your Spotify devices plays the song. Unless you pick one, it's this device's own Spotify app
// (so it comes out of whatever this phone is connected to, like AirPods), never a speaker that happens to be active.
const LS_SPOTIFY_DEVICE = 'lineLearner.spotifyDevice';
const THIS_DEVICE_TYPE = IS_IOS || /Android|Mobi/i.test(navigator.userAgent) ? 'Smartphone' : 'Computer';

async function spotifyDevices() {
  return ((await spotifyApi('/me/player/devices')) || {}).devices || [];
}

// Your pick if you've made one; otherwise the only device of this kind (phone or computer). With several
// phones on the account we can't tell which one this is, so we ask rather than guess.
function chooseDevice(devices) {
  const saved = loadJSON(LS_SPOTIFY_DEVICE, null);
  const picked = saved && devices.find(d => d.id === saved.id || d.name === saved.name);
  if (picked) return picked;
  const sameKind = devices.filter(d => d.type === THIS_DEVICE_TYPE && !d.is_restricted);
  return sameKind.length === 1 ? sameKind[0] : null;
}

async function showDevicePicker(question) {
  const box = $('#device-list');
  if (!box) return;
  const devices = await spotifyDevices();
  const current = loadJSON(LS_SPOTIFY_DEVICE, null);
  box.innerHTML = devices.length
    ? `<p class="small"><b>${esc(question)}</b></p><ul class="pick-list">${devices.map(d => `<li><button class="pick" data-action="sing-pick-device" data-id="${esc(d.id)}" data-name="${esc(d.name)}"${d.is_restricted ? ' disabled' : ''}>
        <b>${esc(d.name)}${current?.id === d.id ? ' ✓' : ''}</b><span class="muted small">${esc(d.type)}${d.is_active ? ' · playing now' : ''}</span></button></li>`).join('')}</ul>`
    : '<p class="muted small">No Spotify devices found. Open the Spotify app on this phone, play any song for a second, then try again.</p>';
}

function appController(uri) {
  let stopped = false, loaded = false, queue = Promise.resolve();
  const run = job => (queue = queue.then(job).catch(e => toast(e.message || "Couldn't control Spotify.")));
  const showDevice = d => {
    sing.device = d || null;
    const el = $('#app-device');
    if (el) el.textContent = d ? `Playing on ${d.name}` : '';
  };
  const poll = setInterval(async () => {
    if (stopped) return;
    const st = await spotifyApi('/me/player').catch(() => null);
    if (stopped) return;
    const mine = st?.item?.uri === uri;
    loaded = mine;
    Object.assign(sing, { pos: mine ? st.progress_ms || 0 : sing.pos, at: performance.now(), paused: !mine || !st?.is_playing });
    if (mine && st.device) showDevice(st.device);
    const btn = $('#app-play');
    if (btn) btn.textContent = sing.paused ? 'Play' : 'Pause';
  }, 1000);
  const ctl = {
    togglePlay: () => (sing.paused ? ctl.resume() : run(async () => { await spotifyApi('/me/player/pause', { method: 'PUT' }); sing.paused = true; })),
    // Always names the device, so the song never starts on a speaker that just happened to be active.
    // Carries on if our song is already loaded there, otherwise starts it from the current lyric line.
    resume: () => run(async () => {
      const devices = await spotifyDevices();
      const device = chooseDevice(devices);
      const kind = THIS_DEVICE_TYPE === 'Smartphone' ? 'phone' : 'computer';
      if (!device) {
        if (devices.filter(d => d.type === THIS_DEVICE_TYPE).length > 1) {
          await showDevicePicker(`Your Spotify account has more than one ${kind}. Which one is this ${kind}? (You only need to choose once.)`);
          return;
        }
        throw new Error(`Open the Spotify app on this ${kind}, play any song for a second, then come back and tap Play. (Or tap "Change device".)`);
      }
      if (!loadJSON(LS_SPOTIFY_DEVICE, null)) toast(`Playing on ${device.name}. Not right? Tap "Change device".`);
      const st = await spotifyApi('/me/player').catch(() => null);
      const sameSpot = st?.item?.uri === uri && st?.device?.id === device.id;
      await spotifyApi(`/me/player/play?device_id=${device.id}`, { method: 'PUT', body: sameSpot ? undefined : { uris: [uri], position_ms: Math.round(sing.pos) } });
      loaded = true;
      showDevice(device);
      Object.assign(sing, { paused: false, at: performance.now() });
    }),
    seek: sec => {
      Object.assign(sing, { pos: sec * 1000, at: performance.now() });
      if (!loaded) return queue; // not playing our song yet: Play will start it from here
      return run(() => spotifyApi(`/me/player/seek?position_ms=${Math.round(sec * 1000)}`, { method: 'PUT' }).catch(e => { if (e.status !== 404) throw e; }));
    },
    destroy: () => { stopped = true; clearInterval(poll); },
  };
  return ctl;
}

const trackInfo = t => t && t.id && {
  id: t.id, uri: t.uri, title: t.name, artist: (t.artists || []).map(a => a.name).join(', '),
  duration: t.duration_ms / 1000, image: (t.album?.images || []).at(-1)?.url || '',
};

const SPOTIFY_TRACK_RE = /(?:open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/;

// Works without signing in: Spotify's public oEmbed gives the song's name for a pasted link.
async function trackFromLink(link) {
  const id = (link.match(SPOTIFY_TRACK_RE) || [])[1];
  if (!id) throw new Error("That doesn't look like a Spotify song link. In Spotify, tap Share > Copy Song Link.");
  if (spotifyReady()) return trackInfo(await spotifyApi('/tracks/' + id));
  const res = await fetch('https://open.spotify.com/oembed?url=' + enc('https://open.spotify.com/track/' + id));
  const data = res.ok ? await res.json() : {};
  return { id, uri: 'spotify:track:' + id, title: data.title || 'Spotify song', artist: '', duration: 0, image: data.thumbnail_url || '' };
}

// ---------- Song editor (a panel on the normal editor) ----------
const songUi = { results: [], resultKind: '', lyrics: [], busy: '', inst: [] };

// Instrumental and karaoke versions are usually released by karaoke labels under a different artist, so
// search for both words and rank by how well the length and names match the original.
const INST_WORDS = /instrumental|karaoke|backing track|minus one|sing ?along|accompaniment|playback/i;
async function findInstrumentals(track) {
  const artist = track.artist.split(',')[0];
  const queries = [`${track.title} ${artist} instrumental`, `${track.title} karaoke`, `${track.title} instrumental`];
  const seen = new Set(), found = [];
  for (const q of queries) {
    const data = await spotifyApi(`/search?type=track&limit=10&q=${enc(q)}`);
    for (const t of (data.tracks?.items || []).map(trackInfo).filter(Boolean)) {
      if (seen.has(t.id) || t.id === track.id) continue;
      seen.add(t.id);
      const name = `${t.title} ${t.artist}`.toLowerCase();
      if (!INST_WORDS.test(name) || !name.includes(track.title.toLowerCase().replace(/\s*[(-].*$/, '').trim())) continue;
      const score = (artist && name.includes(artist.toLowerCase()) ? 2 : 0) + (/instrumental/.test(name) ? 1 : 0)
        - (track.duration && t.duration ? Math.abs(track.duration - t.duration) / 20 : 0);
      found.push({ ...t, score });
    }
  }
  return found.sort((a, b) => b.score - a.score).slice(0, 8);
}

function songPanelHtml(e) {
  const t = e.song?.spotify;
  const trackHtml = t ? `<div class="track">${t.image ? `<img src="${esc(t.image)}" alt="" width="44" height="44">` : ''}
      <div class="lib-main"><b>${esc(t.title)}</b><span class="muted small">${esc(t.artist)}${t.duration ? ' · ' + fmtTime(t.duration) : ''}</span></div>
      <button class="btn ghost" data-action="song-clear-track">Change</button></div>` : '';
  let findTrack = '';
  if (!t) {
    findTrack = spotifyReady()
      ? `<div class="row wrap"><input id="sp-q" type="search" class="search" placeholder="Search Spotify for the song" aria-label="Search Spotify"><button class="btn" data-action="song-sp-search">Search</button></div>
         <div class="row wrap"><button class="btn ghost" data-action="song-sp-playlists">My playlists</button><button class="btn ghost" data-action="song-sp-liked">Liked songs</button></div>`
      : `<div class="row wrap"><input id="sp-link" type="search" class="search" placeholder="Paste a Spotify song link" aria-label="Spotify song link"><button class="btn" data-action="song-sp-link">Use this song</button></div>
         ${SPOTIFY_CLIENT_ID ? '<div><button class="btn ghost" data-action="song-sp-login">Connect Spotify to pick from your playlists</button></div>' : '<p class="muted small">In Spotify, tap Share > Copy Song Link, then paste it here.</p>'}`;
  }
  const results = songUi.resultKind ? `<ul class="pick-list">${songUi.results.map((r, i) => songUi.resultKind === 'playlists'
    ? `<li><button class="pick" data-action="song-sp-open-playlist" data-i="${i}" ${r.locked ? 'disabled' : ''}><b>${esc(r.name)}</b><span class="muted small">${r.locked
      ? `By ${esc(r.owner || 'someone else')}. Spotify doesn't let apps open playlists you didn't make`
      : `${r.count} songs`}</span></button></li>`
    : `<li><button class="pick" data-action="song-pick-track" data-i="${i}"><b>${esc(r.title)}</b><span class="muted small">${esc(r.artist)}</span></button></li>`).join('')
    || '<li class="muted small">Nothing found.</li>'}</ul>` : '';
  const lyricHits = songUi.lyrics.length ? `<ul class="pick-list">${songUi.lyrics.map((h, i) => `<li><button class="pick" data-action="song-pick-lyrics" data-i="${i}">
      <b>${esc(h.trackName)} <span class="by">by ${esc(h.artistName)}</span></b><span class="muted small">${esc(h.albumName || '')}${h.duration ? ' · ' + fmtTime(h.duration) : ''}${h.syncedLyrics ? ' · timed ✓' : ''}</span></button></li>`).join('')}</ul>` : '';
  const inst = e.song?.instrumental;
  const instHtml = !t ? '' : `<b>Instrumental to sing with <span class="muted small">(optional)</span></b>
    ${inst ? `<div class="track">${inst.image ? `<img src="${esc(inst.image)}" alt="" width="44" height="44">` : ''}
        <div class="lib-main"><b>${esc(inst.title)}</b><span class="muted small">${esc(inst.artist)}${inst.duration ? ' · ' + fmtTime(inst.duration) : ''}</span></div>
        <button class="btn ghost" data-action="song-clear-inst">Remove</button></div>`
      : `${spotifyReady() ? '<div><button class="btn ghost" data-action="song-find-inst">Find an instrumental or karaoke version</button></div>' : ''}
        ${songUi.inst.length ? `<ul class="pick-list">${songUi.inst.map((r, i) => `<li><button class="pick" data-action="song-pick-inst" data-i="${i}"><b>${esc(r.title)} <span class="by">by ${esc(r.artist)}</span></b><span class="muted small">${r.duration ? fmtTime(r.duration) : ''}${t.duration && r.duration ? ` (original ${fmtTime(t.duration)})` : ''}</span></button></li>`).join('')}</ul>` : ''}
        <div class="row wrap"><input id="inst-link" type="search" class="search" placeholder="Or paste a Spotify link to an instrumental" aria-label="Instrumental Spotify link"><button class="btn" data-action="song-inst-link">Use</button></div>`}`;
  return `<div class="card stack-sm song-panel">
    <b>The song on Spotify</b>
    ${trackHtml}${findTrack}${results}
    ${instHtml}
    <b>The lyrics</b>
    ${t && !t.artist ? `<p class="note small">Spotify didn't say who sings this${SPOTIFY_CLIENT_ID && !spotifyReady() ? ' (it does once you connect Spotify on this device)' : ''}. Add the artist after the song name so the right lyrics are found.</p>` : ''}
    <div class="row wrap"><input id="ly-q" type="search" class="search" value="${esc(t ? `${t.title} ${t.artist.split(',')[0]}`.trim() + (t.artist ? '' : ' ') : '')}" placeholder="Song name and artist" aria-label="Find lyrics"><button class="btn" data-action="song-find-lyrics">Find lyrics</button></div>
    ${songUi.busy ? `<p class="muted small">${esc(songUi.busy)}</p>` : ''}
    ${lyricHits}
    <p class="muted small">Or paste them below (or use From screenshots). Timed lyrics highlight along with the music; untimed ones can be timed by tapping along.</p>
  </div>`;
}

function refreshSongPanel() {
  if (app.view !== 'edit' || app.editing?.kind !== 'song') return;
  const panel = $('.song-panel');
  if (panel) panel.outerHTML = songPanelHtml(app.editing);
}

async function songBusy(label, job) {
  songUi.busy = label;
  refreshSongPanel();
  try { await job(); } catch (e) { toast(e.message || 'Something went wrong.'); } finally { songUi.busy = ''; refreshSongPanel(); }
}

function setSongLyrics(text) {
  const box = $('#ed-raw');
  if (!box) return;
  if (box.value.trim() && box.value.trim() !== text.trim() && !confirm('Replace the lyrics already in the box?')) return;
  box.value = text;
  updatePreview();
  saveDraft();
}

async function useTrack(track) {
  app.editing.song = { ...(app.editing.song || {}), spotify: track };
  const title = $('#ed-title');
  if (title && !title.value.trim()) title.value = track.artist ? `${track.title} (${track.artist.split(',')[0]})` : track.title;
  songUi.resultKind = '';
  songUi.inst = [];
  saveDraft();
  refreshSongPanel();
  if (spotifyReady() && track.artist && !app.editing.song.instrumental) {
    findInstrumentals(track).then(list => { songUi.inst = list; refreshSongPanel(); }).catch(() => {});
  }
  // Without the artist a title-only search can land on a different song with the same name, so wait for it.
  if (!track.artist) { $('#ly-q')?.focus(); return; }
  if (!$('#ed-raw').value.trim()) {
    await songBusy('Looking for the lyrics…', async () => {
      const hit = track.artist ? await lyricsFor(track) : null;
      if (hit && lyricsText(hit)) { setSongLyrics(lyricsText(hit)); toast(hit.syncedLyrics ? 'Found timed lyrics.' : 'Found the lyrics (not timed; you can time them by tapping along).'); }
      else songUi.lyrics = (await lyricsSearch(`${track.title} ${track.artist.split(',')[0]}`) || []).slice(0, 8);
    });
  }
}

function saveSong() {
  const e = app.editing;
  const title = $('#ed-title').value.trim(), raw = $('#ed-raw').value;
  const { lines, times } = parseSong(raw);
  if (!lines.some(l => l.type === 'line')) { toast('Add the lyrics first: find them, paste them, or use screenshots.'); return; }
  let s = e.id && scripts.find(x => x.id === e.id);
  if (!s) {
    s = { id: uid(), voices: {}, stats: {} };
    scripts.push(s);
  }
  const prev = e.song || {};
  const sameLines = (prev.instTimes || []).length === times.length; // the instrumental's own timing still fits
  Object.assign(s, {
    kind: 'song', title: title || prev.spotify?.title || 'Untitled song', raw, lines, myChar: 'YOU', updated: Date.now(),
    song: {
      spotify: prev.spotify || null, times,
      instrumental: prev.instrumental || null,
      instTimes: sameLines ? prev.instTimes : null,
      offsets: prev.offsets || {},
    },
  });
  clearDraft();
  saveScripts();
  openScript(s.id);
}

Object.assign(actions, {
  'new-song'() {
    leave();
    const d = pendingDraft();
    app.editing = d?.kind === 'song' && !d.id ? d : { id: null, kind: 'song', title: '', raw: '', song: {} };
    Object.assign(songUi, { results: [], resultKind: '', lyrics: [] });
    app.view = 'edit';
    render();
  },
  'song-sp-login'() { spotifyLogin(); },
  'song-clear-track'() { app.editing.song = { ...app.editing.song, spotify: null, instrumental: null }; songUi.inst = []; saveDraft(); refreshSongPanel(); },
  'song-find-inst'() {
    songBusy('Looking for instrumental versions…', async () => {
      songUi.inst = await findInstrumentals(app.editing.song.spotify);
      if (!songUi.inst.length) toast('No instrumental found on Spotify. If you know one, paste its link.');
    });
  },
  'song-pick-inst'(b, i) { app.editing.song.instrumental = songUi.inst[i]; songUi.inst = []; saveDraft(); refreshSongPanel(); },
  'song-inst-link'() {
    const link = $('#inst-link').value.trim();
    songBusy('Getting the instrumental…', async () => {
      app.editing.song.instrumental = await trackFromLink(link);
      saveDraft();
    });
  },
  'song-clear-inst'() { app.editing.song.instrumental = null; saveDraft(); refreshSongPanel(); },
  'song-sp-link'() {
    const link = $('#sp-link').value.trim();
    songBusy('Getting the song…', async () => useTrack(await trackFromLink(link)));
  },
  'song-sp-search'() {
    const q = $('#sp-q').value.trim();
    if (!q) return;
    songBusy('Searching Spotify…', async () => {
      const data = await spotifyApi(`/search?type=track&limit=10&q=${enc(q)}`); // 10 is Spotify's maximum
      Object.assign(songUi, { resultKind: 'tracks', results: (data.tracks?.items || []).map(trackInfo).filter(Boolean) });
    });
  },
  'song-sp-liked'() {
    songBusy('Loading your liked songs…', async () => {
      const data = await spotifyApi('/me/tracks?limit=50');
      Object.assign(songUi, { resultKind: 'tracks', results: (data.items || []).map(i => trackInfo(i.track)).filter(Boolean) });
    });
  },
  'song-sp-playlists'() {
    songBusy('Loading your playlists…', async () => {
      const [me, data] = await Promise.all([spotifyApi('/me'), spotifyApi('/me/playlists?limit=50')]);
      // Spotify only lets apps open playlists you made or collaborate on; list those first and mark the rest.
      const results = (data.items || []).filter(Boolean).map(p => ({
        id: p.id, name: p.name, count: p.items?.total ?? p.tracks?.total ?? '',
        locked: p.owner?.id !== me.id && !p.collaborative, owner: p.owner?.display_name || '',
      }));
      results.sort((a, b) => a.locked - b.locked);
      Object.assign(songUi, { resultKind: 'playlists', results });
    });
  },
  'song-sp-open-playlist'(b, i) {
    const p = songUi.results[i];
    songBusy(`Loading ${p.name}…`, async () => {
      let data;
      try {
        data = await spotifyApi(`/playlists/${p.id}/items?limit=50`);
      } catch (e) {
        if (e.status === 403 || e.status === 404) throw new Error("Spotify only lets apps open playlists you made or collaborate on. Try Liked songs or Search instead.");
        throw e;
      }
      // Each entry's song is now in "item" ("track" can be a plain true/false).
      const tracks = (data.items || []).map(i => trackInfo(typeof i.item === 'object' ? i.item : i.track)).filter(Boolean);
      Object.assign(songUi, { resultKind: 'tracks', results: tracks });
      if (!tracks.length) toast('No songs found in that playlist.');
    });
  },
  'song-pick-track'(b, i) { useTrack(songUi.results[i]); },
  'song-find-lyrics'() {
    const q = $('#ly-q').value.trim();
    if (!q) { toast('Type the song name and artist.'); return; }
    const t = app.editing.song?.spotify;
    if (t && !t.artist && q.toLowerCase() === t.title.toLowerCase()) { toast(`Add the artist after "${t.title}" so the right song is found.`); $('#ly-q').focus(); return; }
    songBusy('Searching for lyrics…', async () => {
      songUi.lyrics = ((await lyricsSearch(q)) || []).filter(h => lyricsText(h)).slice(0, 8);
      if (!songUi.lyrics.length) toast('No lyrics found. Try different words, or paste them.');
    });
  },
  'song-pick-lyrics'(b, i) {
    const hit = songUi.lyrics[i];
    // The lyrics match tells us the artist Spotify's public link left out.
    const t = app.editing.song?.spotify;
    if (t && !t.artist) t.artist = hit.artistName;
    setSongLyrics(lyricsText(hit));
    songUi.lyrics = [];
    refreshSongPanel();
  },
  sing() { leave(); app.view = 'sing'; render(); window.scrollTo(0, 0); },
  'sing-mode'(b) { sing.mode = b.dataset.mode; renderLyrics(); $$('.sing-modes .chip').forEach(c => c.classList.toggle('on', c.dataset.mode === sing.mode)); },
  'sing-loop'() { sing.loop = sing.loop == null ? sing.idx : null; updateSing(true); },
  'sing-line'(b) { seekToLine(+b.dataset.li); },
  'sing-time'() { startTiming(); },
  'sing-tap'() { tapTiming(); },
  'sing-play'() { sing.controller?.togglePlay(); },
  'sing-devices'() {
    if ($('#device-list')?.innerHTML) { $('#device-list').innerHTML = ''; return; }
    showDevicePicker('Where should songs play?').catch(e => toast(e.message));
  },
  'sing-pick-device'(b) {
    saveJSON(LS_SPOTIFY_DEVICE, { id: b.dataset.id, name: b.dataset.name });
    $('#device-list').innerHTML = '';
    toast(`Songs will play on ${b.dataset.name}.`);
    if (sing.paused) sing.controller?.resume();
    // Move what's playing there now, if it's our song.
    else spotifyApi('/me/player', { method: 'PUT', body: { device_ids: [b.dataset.id], play: true } }).catch(e => toast(e.message));
  },
  'sing-player'(b) {
    saveJSON(LS_PLAYER, b.dataset.p);
    stopSing();
    render();
  },
  'sing-version'(b) {
    if (sing.version === b.dataset.v) return;
    sing.version = b.dataset.v;
    stopSing();
    render();
  },
  'sing-nudge'(b) {
    const s = current(), key = versionKey(s);
    s.song.offsets = { ...(s.song.offsets || {}) };
    s.song.offsets[key] = Math.round(((s.song.offsets[key] || 0) + +b.dataset.d) * 10) / 10;
    s.updated = Date.now();
    saveScripts();
    renderLyrics();
    $('#nudge-label').textContent = nudgeLabel(s);
  },
});

// ---------- Sing along ----------
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const sing = { mode: 'all', version: 'original', controller: null, pos: 0, at: 0, paused: true, idx: -1, loop: null, timer: 0, timing: false, tapIdx: 0, newTimes: null };
const SING_MODES = { all: 'Show all', initials: 'First letters', reveal: 'Fill in as I sing', hidden: 'Hidden' };

const songLines = s => s.lines.filter(l => l.type === 'line');
const usingInst = s => sing.version === 'instrumental' && !!s.song?.instrumental;
const versionTrack = s => (usingInst(s) ? s.song.instrumental : s.song?.spotify);
const versionKey = s => (usingInst(s) ? 'instrumental' : 'original');

// Line start times for the version playing: an instrumental can have its own timing (its intro is often
// a different length), and each version can be nudged earlier or later.
function songTimes(s) {
  if (sing.timing) return sing.newTimes || [];
  const base = (usingInst(s) && s.song.instTimes) || s.song?.times || [];
  const off = s.song?.offsets?.[versionKey(s)] || 0;
  return off ? base.map(t => (t == null ? t : Math.max(0, t + off))) : base;
}
const timed = s => songTimes(s).some(t => t != null);

function renderSing() {
  const s = current();
  const sp = s.song?.spotify;
  const chips = Object.entries(SING_MODES).map(([k, v]) => `<button class="chip${sing.mode === k ? ' on' : ''}" data-action="sing-mode" data-mode="${k}">${v}</button>`).join('');
  return `<section class="stack sing">
    <div class="row between wrap"><button class="btn ghost" data-action="back">${icon('back')} Song</button><span class="mode-tag">Sing along</span></div>
    ${s.song?.instrumental ? `<div class="segmented" role="group" aria-label="Which version plays">
      <button class="seg${usingInst(s) ? '' : ' on'}" data-action="sing-version" data-v="original" aria-pressed="${!usingInst(s)}">Original</button>
      <button class="seg${usingInst(s) ? ' on' : ''}" data-action="sing-version" data-v="instrumental" aria-pressed="${usingInst(s)}">Instrumental</button></div>` : ''}
    ${sp ? playerChoiceHtml() : ''}
    ${!sp ? '<p class="note">Add the song from Spotify (Edit, at the top of the song page) to sing along with the real track. For now you can read and learn the lyrics here.</p>'
      : playsInApp() ? `<div class="card app-player"><div class="row wrap">
          <button class="btn primary" id="app-play" data-action="sing-play">Play</button>
          <div class="lib-main"><b>${esc(versionTrack(s).title)}</b><span class="muted small">Plays in your Spotify app, full song. Keep this page open for the lyrics.</span>
            <span class="row wrap"><span class="small" id="app-device"></span><button class="link-btn small" data-action="sing-devices">Change device</button></span></div></div>
          <div id="device-list"></div></div>`
      : '<div id="sp-embed" class="sp-embed"></div>'}
    <div class="row wrap chips sing-modes">${chips}</div>
    <div class="row wrap">
      ${timed(s) ? `<button class="btn ghost" data-action="sing-loop" id="loop-btn">Repeat this line</button>` : ''}
      ${sp ? `<button class="btn ghost" data-action="sing-time">${timed(s) ? 'Re-time lyrics' : 'Time the lyrics'}${s.song?.instrumental ? ` (${usingInst(s) ? 'instrumental' : 'original'})` : ''}</button>` : ''}
    </div>
    ${timed(s) && sp ? `<div class="row wrap nudge"><span class="muted small">Highlight out of step?</span>
      <button class="chip" data-action="sing-nudge" data-d="0.5">It's early</button>
      <button class="chip" data-action="sing-nudge" data-d="-0.5">It's late</button>
      <span class="muted small" id="nudge-label">${nudgeLabel(s)}</span></div>` : ''}
    ${usingInst(s) && !s.song.instTimes && timed(s) ? '<p class="muted small">Using the original timing for the instrumental. If its intro is a different length, nudge the highlight or re-time it for the instrumental.</p>' : ''}
    <div id="timing-bar"></div>
    <ol class="lyrics" id="lyrics"></ol>
  </section>`;
}

// Where the song plays: Spotify's player in this page (previews unless the browser is signed in to
// Spotify, which iPhones block) or your own Spotify app via Spotify Connect (full songs, Premium).
const LS_PLAYER = 'lineLearner.songPlayer';
const playsInApp = () => canControlApp() && (loadJSON(LS_PLAYER, 'app') === 'app');

function playerChoiceHtml() {
  if (!SPOTIFY_CLIENT_ID) return '';
  if (!canControlApp()) {
    return `<p class="note small">Only hearing a preview? ${spotifyReady() ? 'Reconnect' : 'Connect'} Spotify to play full songs in your Spotify app (needs Premium).
      <button class="btn ghost" data-action="song-sp-login">${spotifyReady() ? 'Reconnect Spotify' : 'Connect Spotify'}</button></p>`;
  }
  const inApp = playsInApp();
  return `<div class="segmented" role="group" aria-label="Where the song plays">
    <button class="seg${inApp ? ' on' : ''}" data-action="sing-player" data-p="app" aria-pressed="${inApp}">Spotify app (full song)</button>
    <button class="seg${inApp ? '' : ' on'}" data-action="sing-player" data-p="embed" aria-pressed="${!inApp}">This page</button></div>`;
}

function nudgeLabel(s) {
  const off = s.song?.offsets?.[versionKey(s)] || 0;
  return off ? `Shifted ${Math.abs(off)}s ${off > 0 ? 'later' : 'earlier'}` : '';
}

function lyricHtml(text, i) {
  const m = sing.mode;
  if (m === 'all' || (m === 'reveal' && i < sing.idx)) return esc(text);
  if (m === 'initials') return hintHtml(text, 'initials');
  return hintHtml(text, 'hidden');
}

function renderLyrics() {
  const s = current(), el = $('#lyrics');
  if (!el) return;
  const times = songTimes(s);
  el.innerHTML = songLines(s).map((l, i) => `<li data-li="${i}"><button class="lyric" data-action="sing-line" data-li="${i}">${times[i] != null ? `<span class="t">${fmtTime(times[i])}</span>` : ''}<span class="w">${lyricHtml(l.text, i)}</span></button></li>`).join('');
  updateSing(true);
}

function estimatePos() {
  return sing.pos + (sing.paused ? 0 : performance.now() - sing.at);
}

// Highlights the line being sung, keeps it in view, and handles repeating a line.
function updateSing(force) {
  const s = current();
  if (app.view !== 'sing' || !s) return;
  const times = songTimes(s), pos = estimatePos() / 1000;
  let idx = sing.idx;
  if (sing.timing) idx = sing.tapIdx - 1;
  else if (timed(s)) { idx = -1; times.forEach((t, i) => { if (t != null && t <= pos + 0.15) idx = i; }); }
  if (sing.loop != null && !sing.timing && times[sing.loop + 1] != null && pos >= times[sing.loop + 1] - 0.1) {
    sing.controller?.seek(Math.floor(times[sing.loop]));
    idx = sing.loop;
  }
  if (idx === sing.idx && !force) return;
  const prev = sing.idx;
  sing.idx = idx;
  $$('#lyrics li').forEach((li, i) => {
    li.classList.toggle('now', i === idx);
    li.classList.toggle('past', i < idx);
    li.classList.toggle('looping', i === sing.loop);
    if (sing.mode === 'reveal' && (i === prev || i === idx || force)) li.querySelector('.w').innerHTML = lyricHtml(songLines(s)[i].text, i);
  });
  const loopBtn = $('#loop-btn');
  if (loopBtn) loopBtn.textContent = sing.loop != null ? 'Stop repeating' : 'Repeat this line';
  if (idx >= 0 && idx !== prev) $(`#lyrics li[data-li="${idx}"]`)?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function seekToLine(i) {
  const s = current(), t = songTimes(s)[i];
  if (sing.timing) return;
  if (t == null || !sing.controller) { sing.idx = i; updateSing(true); return; }
  if (sing.loop != null) sing.loop = i;
  sing.controller.seek(Math.floor(t));
  if (sing.paused) sing.controller.resume();
}

// Timing by tapping: play the song and tap as each line starts.
function startTiming() {
  const s = current();
  Object.assign(sing, { timing: true, tapIdx: 0, loop: null, newTimes: songLines(s).map(() => null) });
  $('#timing-bar').innerHTML = `<div class="card timing"><p>Tap the button the moment each line starts. Line <b id="tap-count">1</b> of ${songLines(s).length}.</p>
    <div class="row wrap"><button class="btn primary big-tap" data-action="sing-tap">Tap: next line starts</button><button class="btn ghost" data-action="back">Cancel</button></div></div>`;
  renderLyrics();
  sing.controller?.seek(0);
  sing.controller?.resume();
}

function tapTiming() {
  const s = current();
  if (!sing.timing) return;
  sing.newTimes[sing.tapIdx] = Math.max(0, estimatePos() / 1000 - 0.2);
  sing.tapIdx++;
  const count = $('#tap-count');
  if (count) count.textContent = Math.min(sing.tapIdx + 1, songLines(s).length);
  renderLyrics();
  if (sing.tapIdx >= songLines(s).length) {
    const offsets = { ...(s.song?.offsets || {}), [versionKey(s)]: 0 };
    if (usingInst(s)) {
      s.song = { ...s.song, instTimes: sing.newTimes, offsets };
    } else {
      s.song = { ...(s.song || {}), times: sing.newTimes, offsets };
      let n = 0;
      s.raw = s.lines.map(l => (l.type === 'line' ? `[${fmtLrc(sing.newTimes[n++])}] ${l.text}` : `[${l.text}]`)).join('\n');
    }
    s.updated = Date.now();
    sing.timing = false;
    saveScripts();
    $('#timing-bar').innerHTML = '';
    toast('Lyrics timed. They now highlight along with the song.');
    render();
  }
}
const fmtLrc = sec => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${(sec % 60).toFixed(2).padStart(5, '0')}`;

// Spotify's embedded player, controlled through its iFrame API.
let iframeApi = null;
const iframeApiReady = new Promise(resolve => { window.onSpotifyIframeApiReady = api => { iframeApi = api; resolve(api); }; });
function loadIframeApi() {
  if (!document.querySelector('script[data-spotify-iframe]')) {
    const tag = document.createElement('script');
    tag.src = 'https://open.spotify.com/embed/iframe-api/v1';
    tag.async = true;
    tag.dataset.spotifyIframe = '';
    document.head.appendChild(tag);
  }
  return iframeApiReady;
}

async function mountSing() {
  const s = current();
  Object.assign(sing, { idx: -1, loop: null, timing: false, pos: 0, paused: true });
  renderLyrics();
  clearInterval(sing.timer);
  sing.timer = setInterval(() => updateSing(false), 200);
  if (s.song?.spotify && playsInApp()) { sing.controller = appController(versionTrack(s).uri); return; }
  const box = $('#sp-embed');
  if (!box || !s.song?.spotify) return;
  const api = await loadIframeApi();
  if (app.view !== 'sing' || !$('#sp-embed')) return;
  api.createController($('#sp-embed'), { uri: versionTrack(s).uri, width: '100%', height: 152 }, controller => {
    sing.controller = controller;
    controller.addListener('playback_update', e => {
      Object.assign(sing, { pos: e.data.position, at: performance.now(), paused: e.data.isPaused || e.data.isBuffering });
    });
  });
}

function stopSing() {
  clearInterval(sing.timer);
  try { sing.controller?.destroy(); } catch { /* already gone */ }
  Object.assign(sing, { controller: null, timing: false, loop: null });
}

document.addEventListener('keydown', e => {
  if (app.view !== 'sing' || /INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)) return;
  if (e.key === ' ') { e.preventDefault(); if (sing.timing) tapTiming(); else sing.controller?.togglePlay(); }
});

VIEWS.sing = renderSing;
window.stopSing = stopSing;
finishSpotifyLogin();
