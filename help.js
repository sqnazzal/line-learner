'use strict';

// Help & troubleshooting: instructions for each kind of device, opening on the one you're using.
// Loaded after app.js and uses its helpers.

const IS_ANDROID = /Android/i.test(navigator.userAgent);
const TIP_URL = 'https://venmo.com/u/shannonnazzal';
const DEVICE_TABS = { ios: 'iPhone & iPad', android: 'Android', computer: 'Computer' };
const help = { tab: IS_IOS ? 'ios' : IS_ANDROID ? 'android' : 'computer' };

const topic = (title, body, open = false) => `<details class="card help-topic"${open ? ' open' : ''}><summary>${title}</summary><div class="help-body">${body}</div></details>`;

const HELP = {
  ios: [
    ['Getting started', `<ol>
      <li>Open the app in <b>Safari</b> (best for checking your lines) or Chrome.</li>
      <li>To get an app icon: tap <b>Share</b> &gt; <b>Add to Home Screen</b>.</li>
      <li>Tap <b>Play</b> to start anything: iPhones only play sound after a tap.</li>
      <li>The app's talking stops if the phone locks, so keep the screen on while you practice, <b>or</b> use <b>Listen, screen off</b> on a script: it makes the scene into one audio track that keeps playing with the phone locked (pause and skip from the lock screen or AirPods). It uses the AI voices.</li></ol>`],
    ['Microphone (checking your lines)', `<ul>
      <li><b>Safari:</b> tap <b>aA</b> in the address bar &gt; <b>Website Settings</b> &gt; <b>Microphone</b> &gt; <b>Allow</b>. For every site: iPhone <b>Settings</b> &gt; <b>Apps</b> &gt; <b>Safari</b> &gt; <b>Microphone</b> &gt; <b>Allow</b>.</li>
      <li><b>Chrome:</b> iPhone <b>Settings</b> &gt; <b>Apps</b> &gt; <b>Chrome</b>: turn <b>Microphone</b> on, then tap <b>Allow</b> when the site asks.</li>
      <li>Checking lines needs an internet connection (it uses Apple's speech service).</li>
      <li>Listen mode hears you say your line and moves on when you finish (turn it off in Practice settings).</li>
      <li>Stuck in a scene? Say <i>"line"</i> and it reads your line to you.</li></ul>`],
    ['Sound and voices', `<ul>
      <li>No sound? Turn the volume up and check the phone isn't in <b>Silent mode</b> (the switch or Action button); the chimes are quiet in Silent mode.</li>
      <li>Better built-in voices: open <b>Settings</b>, search <b>"Voices"</b>, choose <b>English</b>, and download an <b>Enhanced</b> or <b>Premium</b> US voice (such as Ava, Zoe or Evan).</li>
      <li>Most natural: AI voices. In one of Shannon's groups? Sign in, then open a script &gt; <b>Voices for each character</b> &gt; tick <b>Use Shannon's shared voices</b>, no key needed (each person gets a monthly share). Or add your own OpenAI key there.</li>
      <li>Each character's voice, gender and speed can be changed in <b>Voices for each character</b>.</li>
      <li>Sharing a device? Add a <b>PIN</b> under Voices for each character so AI voices you've paid for can't be changed without it.</li></ul>`],
    ['Songs and Spotify', `<ul>
      <li>The player inside the page only plays <b>previews</b> on iPhone (Apple blocks it from seeing your Spotify login).</li>
      <li>For full songs: <b>Connect Spotify</b> (needs Premium), then in Sing along choose <b>Spotify app (full song)</b>.</li>
      <li>"Spotify is asleep"? Tap <b>Open Spotify</b>, then come straight back (tap <b>◀ Safari</b> in the top-left corner, or swipe right along the bottom edge); the song starts by itself. iPhones can't switch back automatically.</li>
      <li>Playing on the wrong speaker? Tap <b>Change device</b>.</li>
      <li>"Not allowed" when connecting? Spotify lets 5 people use Line Learner's connection; anyone else with Premium can tap <b>Use your own Spotify app</b> and follow the steps.</li>
      <li>Highlight out of step? Tap <b>It's early</b> / <b>It's late</b>, or <b>Re-time lyrics</b>.</li></ul>`],
    ['Importing a script', `<ul>
      <li><b>PDF:</b> New script &gt; <b>Import PDF or .txt</b>.</li>
      <li><b>Paper script:</b> in the <b>Notes</b> app, tap the camera icon &gt; <b>Scan Documents</b>, save, then <b>Share</b> &gt; <b>Save to Files</b> as a PDF. Import that PDF and tap <b>Read pages</b>.</li>
      <li><b>A few pages or screenshots:</b> use <b>Take photo</b> (again for each page) or <b>Choose photos</b>, then <b>Read pages</b>. Uses your OpenAI key.</li>
      <li>Afterwards, check the character list and use <b>Find and fix</b> or <b>Fix or merge character names</b> (at the top of Edit) to tidy names.</li></ul>`],
    ['Sync and groups', `<ul>
      <li><b>Sync</b>: tap <b>Sign in</b> at the top and sign in with Google on each of your devices. Your scripts, songs and progress then stay the same everywhere, automatically.</li>
      <li><b>Download backup</b> (on the Sync and backup screen) saves everything to a file you can keep or restore on a new device.</li>
      <li><b>Sign in</b> (top of the screen) with Google to create or join a group and share scripts.</li>
      <li>Sign-in window doesn't open? iPhone <b>Settings</b> &gt; <b>Apps</b> &gt; <b>Safari</b> &gt; turn off <b>Block Pop-ups</b>, then try again.</li></ul>`],
  ],
  android: [
    ['Getting started', `<ol>
      <li>Open the app in <b>Chrome</b>.</li>
      <li>To get an app icon: tap <b>⋮</b> &gt; <b>Add to Home screen</b> (or <b>Install app</b>).</li>
      <li>The app's talking stops if the screen turns off, so keep it on while you practice, <b>or</b> use <b>Listen, screen off</b> on a script: one audio track of the scene that keeps playing with the screen off. It uses the AI voices.</li></ol>`],
    ['Microphone (checking your lines)', `<ul>
      <li>Tap the icon at the left of the address bar &gt; <b>Permissions</b> &gt; <b>Microphone</b> &gt; <b>Allow</b>.</li>
      <li>Still blocked? Phone <b>Settings</b> &gt; <b>Apps</b> &gt; <b>Chrome</b> &gt; <b>Permissions</b> &gt; <b>Microphone</b> &gt; <b>Allow</b>.</li>
      <li>Checking lines needs an internet connection.</li>
      <li>Listen mode hears you say your line and moves on when you finish (turn it off in Practice settings).</li>
      <li>Stuck in a scene? Say <i>"line"</i> and it reads your line to you.</li></ul>`],
    ['Sound and voices', `<ul>
      <li>Better built-in voices: phone <b>Settings</b> &gt; search <b>"Text-to-speech"</b> &gt; <b>Speech Services by Google</b> &gt; install <b>English (US)</b> voice data. (Menus differ a little between phones.)</li>
      <li>Most natural: AI voices. In one of Shannon's groups? Sign in, then open a script &gt; <b>Voices for each character</b> &gt; tick <b>Use Shannon's shared voices</b>, no key needed (each person gets a monthly share). Or add your own OpenAI key there.</li>
      <li>Each character's voice, gender and speed can be changed in <b>Voices for each character</b>.</li>
      <li>Sharing a device? Add a <b>PIN</b> under Voices for each character so AI voices you've paid for can't be changed without it.</li></ul>`],
    ['Songs and Spotify', `<ul>
      <li>If you're signed in to Spotify in Chrome, the page player may play full songs; otherwise it plays previews.</li>
      <li>For full songs either way: <b>Connect Spotify</b> (needs Premium), then choose <b>Spotify app (full song)</b> in Sing along.</li>
      <li>Playing on the wrong speaker? Tap <b>Change device</b>.</li>
      <li>"Not allowed" when connecting? Spotify lets 5 people use Line Learner's connection; anyone else with Premium can tap <b>Use your own Spotify app</b> and follow the steps.</li></ul>`],
    ['Importing a script', `<ul>
      <li><b>PDF:</b> New script &gt; <b>Import PDF or .txt</b>.</li>
      <li><b>Paper script:</b> in the <b>Google Drive</b> app, tap <b>+</b> &gt; <b>Scan</b> to make a PDF, then import it and tap <b>Read pages</b>.</li>
      <li><b>A few pages or screenshots:</b> use <b>Take photo</b> or <b>Choose photos</b>, then <b>Read pages</b>. Uses your OpenAI key.</li>
      <li>Afterwards, use <b>Find and fix</b> or <b>Fix or merge character names</b> (at the top of Edit) to tidy names.</li></ul>`],
    ['Sync and groups', `<ul>
      <li><b>Sync</b>: sign in with Google (top of the screen) on each of your devices and your scripts stay the same everywhere, automatically.</li>
      <li><b>Download backup</b> (on the Sync and backup screen) saves everything to a file you can keep or restore on a new device.</li>
      <li><b>Sign in</b> (top of the screen) with Google to create or join a group and share scripts.</li></ul>`],
  ],
  computer: [
    ['Getting started', `<ol>
      <li>Use <b>Google Chrome</b> or <b>Microsoft Edge</b> (Firefox can read lines aloud but can't check them).</li>
      <li>Keyboard shortcuts while practicing: <kbd>Space</kbd> play/pause, <kbd>←</kbd> <kbd>→</kbd> lines, <kbd>H</kbd> hint, <kbd>L</kbd> hear the line, <kbd>Enter</kbd> done speaking.</li>
      <li>Bookmark the page, or in Chrome/Edge use the <b>Install</b> icon in the address bar for an app window.</li></ol>`],
    ['Microphone (checking your lines)', `<ul>
      <li>Click the icon at the left of the address bar &gt; <b>Microphone</b> &gt; <b>Allow</b>, then reload.</li>
      <li><b>Windows:</b> Settings &gt; Privacy &amp; security &gt; <b>Microphone</b>: turn on access for apps and desktop apps.</li>
      <li><b>Mac:</b> System Settings &gt; Privacy &amp; Security &gt; <b>Microphone</b>: turn on your browser. In Safari: Safari &gt; Settings for This Website &gt; Microphone &gt; Allow.</li>
      <li>Checking lines needs an internet connection.</li>
      <li>Listen mode hears you say your line and moves on when you finish (turn it off in Practice settings). Stuck in a scene? Say <i>"line"</i>.</li></ul>`],
    ['Sound and voices', `<ul>
      <li><b>Edge</b> has natural-sounding voices built in; Chrome's are more robotic.</li>
      <li>Most natural: AI voices. In one of Shannon's groups? Sign in, then open a script &gt; <b>Voices for each character</b> &gt; tick <b>Use Shannon's shared voices</b>, no key needed (each person gets a monthly share). Or add your own OpenAI key there.</li>
      <li>Each character's voice, gender and speed can be changed in <b>Voices for each character</b>.</li>
      <li>Sharing a device? Add a <b>PIN</b> under Voices for each character so AI voices you've paid for can't be changed without it.</li></ul>`],
    ['Songs and Spotify', `<ul>
      <li>Signed in at <b>open.spotify.com</b> in the same browser? The page player plays full songs. Otherwise it plays previews.</li>
      <li>Or: <b>Connect Spotify</b> (Premium) and choose <b>Spotify app (full song)</b> to play in the Spotify desktop app.</li>
      <li>"Not allowed" when connecting? Spotify lets 5 people use Line Learner's connection; anyone else with Premium can use <b>Use your own Spotify app</b>.</li></ul>`],
    ['Importing a script', `<ul>
      <li><b>PDF or .txt:</b> New script &gt; <b>Import PDF or .txt</b>, or drag the file onto the text box.</li>
      <li><b>Scanned PDF or screenshots:</b> they go into the pages list; tap <b>Read pages</b> (uses your OpenAI key).</li>
      <li>Afterwards, use <b>Find and fix</b> or <b>Fix or merge character names</b> (at the top of Edit) to tidy names.</li></ul>`],
    ['Sync and groups', `<ul>
      <li><b>Sync</b>: sign in with Google (top of the screen) on your computer and phone and your scripts stay the same on both, automatically.</li>
      <li><b>Download backup</b> (on the Sync and backup screen) saves everything to a file you can keep or restore on a new device.</li>
      <li><b>Sign in</b> with Google to create or join a group. If the sign-in window doesn't open, allow pop-ups for this site.</li></ul>`],
  ],
};

const SYNC_HELP = topic('Syncing between your devices', `<ol>
    <li>Tap <b>Sign in</b> at the top and sign in with Google.</li>
    <li>Do the same, with the <b>same Google account</b>, on your other phone, tablet or computer.</li>
    <li>That's it: your scripts, songs, categories and practice progress fill in on each device by themselves.</li></ol>
  <ul>
    <li><b>When it syncs:</b> a few seconds after any change, and whenever you open the app. To pull the latest right away, tap <b>Sync</b> (top right) &gt; <b>Sync now</b>.</li>
    <li><b>Private:</b> other people can't see your synced scripts; people in your groups only see what you choose to <b>Share to group</b>. The app's admin (Shannon) can remove accounts and their synced data if needed.</li>
    <li><b>Edited on two devices?</b> The most recent edit of a script wins. Practice progress is combined line by line, so practice anywhere counts. Deleting a script on one device deletes it on the others.</li>
    <li><b>Stays on each device:</b> computer voices, AI voices already made, your recordings and saved screen-off tracks. (They're re-made or re-recorded on the other device as needed.)</li>
    <li><b>The Sync button says "Sync problem"?</b> Tap it to see why. Usually it's no internet for a moment; it tries again by itself. If it says sync was refused, tell Shannon.</li>
    <li><b>Very long scripts:</b> one script bigger than about 900 KB of text (far longer than a normal play) can't sync; the app will say so. Use <b>Download backup</b> to keep it safe.</li>
    <li><b>Advanced:</b> people who already use GitHub can sync through it instead (Sync &gt; <b>Advanced: sync with GitHub instead</b>). Most people don't need this.</li>
    <li><b>Backup file:</b> on the Sync screen, <b>Download backup</b> saves everything to a file you can keep or <b>Restore</b> on any device, signed in or not.</li></ul>`);

const REAL_HELP = topic('Rehearsing for real: phone on a stand, headphones, long scenes', `<ul>
    <li><b>Phone on a stand:</b> open <b>Practice settings</b> (under the player) &gt; <b>Text size</b> &gt; <b>Extra large</b>. The play button stays at the bottom of the screen, and the screen stays on while a scene plays. Hands busy? Say <i>"line"</i> when you're stuck.</li>
    <li><b>Headphones:</b> wired or Bluetooth both work. On many phones the play/pause and skip buttons on them work the player too (most reliably with the AI voices). Bluetooth earbuds use their own microphone, which can be less clear; if good lines keep getting marked wrong, lower <b>Score needed to pass</b> a little.</li>
    <li><b>Just your part:</b> on a script, tick <b>Just my cues and lines</b> and Listen and Rehearse play only the line before each of yours, then yours, skipping the rest of the show. <b>Listen, screen off</b> has the same choice when you make a track.</li>
    <li><b>Long scenes:</b> leave any time and the script page offers <b>Pick up where you left off</b>. Lines like <code># Act 2</code> or <code>Scene 3</code> in the script make sections you can pick with <b>Start at</b>, and the play icon on any of your lines starts Rehearse from there.</li></ul>`);

const COMMON = topic("Something's not working?", `<ul>
  <li><b>Reload the page.</b> Updates arrive automatically, but a reload makes sure you have the latest.</li>
  <li><b>Check your internet connection:</b> checking lines, AI voices, lyrics, sync and groups need it.</li>
  <li><b>Your scripts live in this browser.</b> Clearing this site's data (or browsing privately) can remove them, so turn on <b>Sync</b> or save a <b>Download backup</b> file now and then.</li>
  <li>Still stuck? <button class="link-btn" data-action="feedback">Send feedback</button> (add a screenshot of the message if there is one) and Shannon will take a look.</li></ul>`)
  + topic('Tip jar', `<p>Line Learner is free. The natural AI voices and page reading cost a little to run, so if it's helping you get off book, a tip toward the voices is very welcome (and never expected).</p>
  <p><a class="btn primary" href="${TIP_URL}" target="_blank" rel="noopener">☕ Tip Shannon on Venmo</a></p>`);

function renderHelp() {
  const tabs = Object.entries(DEVICE_TABS).map(([k, v]) =>
    `<button class="seg${help.tab === k ? ' on' : ''}" data-action="help-tab" data-tab="${k}" aria-pressed="${help.tab === k}">${v}</button>`).join('');
  return `<section class="stack help-page">
    <div class="row between wrap"><h1>Help</h1><button class="btn ghost" data-action="home">${icon('back')} Your scripts</button></div>
    <p class="lede">How to set things up and fix common problems. Pick your device:</p>
    <div class="segmented" role="group" aria-label="Your device">${tabs}</div>
    ${HELP[help.tab].map(([t, b], i) => topic(t, b, i === 0)).join('')}
    ${REAL_HELP}
    ${SYNC_HELP}
    ${COMMON}
  </section>`;
}

Object.assign(actions, {
  help() { leave(); app.view = 'help'; render(); window.scrollTo(0, 0); },
  'help-tab'(b) { help.tab = b.dataset.tab; render(); },
});

VIEWS.help = renderHelp;

// ---------- Send feedback / Report a bug ----------
// Goes to the app's Firestore 'feedback' inbox, which only the admin can read (Admin screen). Works signed
// in or not. Device details help track down bugs; no scripts are included.
const fbk = { kind: 'bug', from: '', shot: '', sent: false, busy: false };
const FEEDBACK_KINDS = {
  bug: ['Report a bug', 'What happened, and what did you expect? What were you doing just before?'],
  idea: ['Idea', 'What would make rehearsing easier?'],
  other: ['Something else', "What's on your mind?"],
};

function deviceDetails() {
  const version = (document.querySelector('script[src*="app.js?v="]')?.getAttribute('src') || '').split('v=')[1] || 'dev';
  return [
    `App version: ${version}`,
    `Browser: ${navigator.userAgent}`,
    `Screen: ${screen.width}x${screen.height}, window ${innerWidth}x${innerHeight}, ${devicePixelRatio}x`,
    `Was on: ${fbk.from || 'library'} screen`,
    `Checking lines by mic: ${SR ? 'available' : 'not available in this browser'}`,
    `Voices: ${usingShared() ? "Shannon's shared voices" : ai.key ? 'own OpenAI key' : 'device voices'}`,
    `Signed in: ${signedInUser() ? 'yes' : 'no'} · scripts on device: ${scripts.length} · text size: ${settings.textSize}`,
    `Recent errors: ${recentErrors.length ? '\n' + recentErrors.join('\n') : 'none'}`,
  ].join('\n');
}

function renderFeedback() {
  const head = `<div class="row between wrap"><h1>Send feedback</h1><button class="btn ghost" data-action="home">${icon('back')} Your scripts</button></div>`;
  if (fbk.sent) {
    return `<section class="stack feedback">${head}
      <div class="card stack-sm"><h2>Thanks! Message received.</h2>
        <p>Shannon reads every one. Notes like this are how the app gets better.</p>
        <div class="row wrap"><button class="btn primary" data-action="home">Back to your scripts</button><button class="btn ghost" data-action="feedback">Send another</button></div></div>
    </section>`;
  }
  const kinds = Object.entries(FEEDBACK_KINDS).map(([k, [label]]) =>
    `<button class="seg${fbk.kind === k ? ' on' : ''}" data-action="fb-kind" data-kind="${k}" aria-pressed="${fbk.kind === k}">${label}</button>`).join('');
  return `<section class="stack feedback">
    ${head}
    <p class="lede">Found a bug, have an idea, or a line it keeps getting wrong? Tell Shannon here. Especially while it's new, every note helps.</p>
    <div class="card stack-sm">
      <div class="segmented" role="group" aria-label="What kind of feedback">${kinds}</div>
      <label class="field"><span>Message</span><textarea id="fb-msg" rows="6" maxlength="5000" placeholder="${esc(FEEDBACK_KINDS[fbk.kind][1])}"></textarea></label>
      <label class="field"><span>Your name or email, if you'd like a reply (optional)</span><input id="fb-contact" maxlength="200" value="${esc(signedInUser()?.email || '')}" autocomplete="email"></label>
      <label class="field"><span>Screenshot (optional)</span><input id="fb-shot" type="file" accept="image/*"></label>
      ${fbk.shot ? `<div class="row"><img class="fb-thumb" src="${fbk.shot}" alt="Your screenshot"><button class="btn ghost" data-action="fb-unshot">Remove</button></div>` : ''}
      <label class="check-row"><input type="checkbox" id="fb-details" checked><span>Include device details (browser, screen, app version, recent errors). No scripts are sent.</span></label>
      <details class="small"><summary>See the device details</summary><pre class="fb-details">${esc(deviceDetails())}</pre></details>
      <div><button class="btn primary" data-action="fb-send"${fbk.busy ? ' disabled' : ''}>${fbk.busy ? 'Sending…' : 'Send'}</button></div>
    </div>
  </section>`;
}

document.addEventListener('change', async e => {
  if (e.target.id !== 'fb-shot' || !e.target.files[0]) return;
  try {
    fbk.shot = await imageToDataUrl(e.target.files[0], 1400);
    if (fbk.shot.length > 850000) fbk.shot = await imageToDataUrl(e.target.files[0], 900);
  } catch { fbk.shot = ''; toast("Couldn't open that picture. Try a PNG or JPEG screenshot."); }
  const keep = { msg: $('#fb-msg')?.value, contact: $('#fb-contact')?.value };
  render();
  $('#fb-msg').value = keep.msg || '';
  $('#fb-contact').value = keep.contact ?? '';
});

Object.assign(actions, {
  feedback() { if (app.view !== 'feedback') fbk.from = app.view; leave(); Object.assign(fbk, { sent: false, shot: '', busy: false }); app.view = 'feedback'; render(); window.scrollTo(0, 0); },
  'fb-kind'(b) {
    fbk.kind = b.dataset.kind;
    for (const x of document.querySelectorAll('[data-action="fb-kind"]')) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }
    $('#fb-msg').placeholder = FEEDBACK_KINDS[fbk.kind][1];
  },
  'fb-unshot'() { fbk.shot = ''; $('.fb-thumb')?.parentElement.remove(); $('#fb-shot').value = ''; },
  async 'fb-send'(b) {
    const message = $('#fb-msg').value.trim();
    if (!message) { toast("Type a message first: what happened, or what you'd like."); $('#fb-msg').focus(); return; }
    fbk.busy = true;
    b.disabled = true;
    b.textContent = 'Sending…';
    try {
      await fb.sendFeedback({
        kind: fbk.kind, message, contact: $('#fb-contact').value.trim(),
        details: $('#fb-details').checked ? deviceDetails() : '', ...(fbk.shot ? { screenshot: fbk.shot } : {}),
      });
      fbk.sent = true;
      render();
      window.scrollTo(0, 0);
    } catch (e) {
      noteError(e?.code || e?.message);
      toast("That didn't go through (no internet?). Try again in a moment, or take a screenshot and send it to Shannon.");
      b.disabled = false;
      b.textContent = 'Send';
    }
    fbk.busy = false;
  },
});

VIEWS.feedback = renderFeedback;
