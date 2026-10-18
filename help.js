'use strict';

// Help & troubleshooting: instructions for each kind of device, opening on the one you're using.
// Loaded after app.js and uses its helpers.

const IS_ANDROID = /Android/i.test(navigator.userAgent);
const DEVICE_TABS = { ios: 'iPhone & iPad', android: 'Android', computer: 'Computer' };
const help = { tab: IS_IOS ? 'ios' : IS_ANDROID ? 'android' : 'computer' };

const topic = (title, body, open = false) => `<details class="card help-topic"${open ? ' open' : ''}><summary>${title}</summary><div class="help-body">${body}</div></details>`;

const HELP = {
  ios: [
    ['Getting started', `<ol>
      <li>Open the app in <b>Safari</b> (best for checking your lines) or Chrome.</li>
      <li>To get an app icon: tap <b>Share</b> &gt; <b>Add to Home Screen</b>.</li>
      <li>Tap <b>Play</b> to start anything: iPhones only play sound after a tap.</li>
      <li>Keep the screen on while practicing. If the phone locks, speech stops.</li></ol>`],
    ['Microphone (checking your lines)', `<ul>
      <li><b>Safari:</b> tap <b>aA</b> in the address bar &gt; <b>Website Settings</b> &gt; <b>Microphone</b> &gt; <b>Allow</b>. For every site: iPhone <b>Settings</b> &gt; <b>Apps</b> &gt; <b>Safari</b> &gt; <b>Microphone</b> &gt; <b>Allow</b>.</li>
      <li><b>Chrome:</b> iPhone <b>Settings</b> &gt; <b>Apps</b> &gt; <b>Chrome</b>: turn <b>Microphone</b> on, then tap <b>Allow</b> when the site asks.</li>
      <li>Checking lines needs an internet connection (it uses Apple's speech service).</li>
      <li>Stuck in a scene? Say <i>"line"</i> and it reads your line to you.</li></ul>`],
    ['Sound and voices', `<ul>
      <li>No sound? Turn the volume up and check the phone isn't in <b>Silent mode</b> (the switch or Action button); the chimes are quiet in Silent mode.</li>
      <li>Better built-in voices: open <b>Settings</b>, search <b>"Voices"</b>, choose <b>English</b>, and download an <b>Enhanced</b> or <b>Premium</b> US voice (such as Ava, Zoe or Evan).</li>
      <li>Most natural: AI voices. Open a script &gt; <b>Voices for each character</b> &gt; add an OpenAI key.</li>
      <li>Each character's voice, gender and speed can be changed in <b>Voices for each character</b>.</li></ul>`],
    ['Songs and Spotify', `<ul>
      <li>The player inside the page only plays <b>previews</b> on iPhone (Apple blocks it from seeing your Spotify login).</li>
      <li>For full songs: <b>Connect Spotify</b> (needs Premium), then in Sing along choose <b>Spotify app (full song)</b>.</li>
      <li>"Spotify is asleep"? Tap <b>Open Spotify</b>, then come straight back; the song starts by itself.</li>
      <li>Playing on the wrong speaker? Tap <b>Change device</b>.</li>
      <li>Highlight out of step? Tap <b>It's early</b> / <b>It's late</b>, or <b>Re-time lyrics</b>.</li></ul>`],
    ['Importing a script', `<ul>
      <li><b>PDF:</b> New script &gt; <b>Import PDF or .txt</b>.</li>
      <li><b>Paper script:</b> in the <b>Notes</b> app, tap the camera icon &gt; <b>Scan Documents</b>, save, then <b>Share</b> &gt; <b>Save to Files</b> as a PDF. Import that PDF and tap <b>Read pages</b>.</li>
      <li><b>A few pages or screenshots:</b> use <b>Take photo</b> (again for each page) or <b>Choose photos</b>, then <b>Read pages</b>. Uses your OpenAI key.</li>
      <li>Afterwards, check the character list and use <b>Find and fix</b> or <b>Merge characters</b> to tidy names.</li></ul>`],
    ['Sync and groups', `<ul>
      <li><b>Sync</b> keeps scripts and progress the same on your phone and computer (a free GitHub key, set up once per device).</li>
      <li><b>Sign in</b> (top of the screen) with Google to create or join a group and share scripts.</li>
      <li>Sign-in window doesn't open? iPhone <b>Settings</b> &gt; <b>Apps</b> &gt; <b>Safari</b> &gt; turn off <b>Block Pop-ups</b>, then try again.</li></ul>`],
  ],
  android: [
    ['Getting started', `<ol>
      <li>Open the app in <b>Chrome</b>.</li>
      <li>To get an app icon: tap <b>⋮</b> &gt; <b>Add to Home screen</b> (or <b>Install app</b>).</li>
      <li>Keep the screen on while practicing.</li></ol>`],
    ['Microphone (checking your lines)', `<ul>
      <li>Tap the icon at the left of the address bar &gt; <b>Permissions</b> &gt; <b>Microphone</b> &gt; <b>Allow</b>.</li>
      <li>Still blocked? Phone <b>Settings</b> &gt; <b>Apps</b> &gt; <b>Chrome</b> &gt; <b>Permissions</b> &gt; <b>Microphone</b> &gt; <b>Allow</b>.</li>
      <li>Checking lines needs an internet connection.</li>
      <li>Stuck in a scene? Say <i>"line"</i> and it reads your line to you.</li></ul>`],
    ['Sound and voices', `<ul>
      <li>Better built-in voices: phone <b>Settings</b> &gt; search <b>"Text-to-speech"</b> &gt; <b>Speech Services by Google</b> &gt; install <b>English (US)</b> voice data. (Menus differ a little between phones.)</li>
      <li>Most natural: AI voices. Open a script &gt; <b>Voices for each character</b> &gt; add an OpenAI key.</li>
      <li>Each character's voice, gender and speed can be changed in <b>Voices for each character</b>.</li></ul>`],
    ['Songs and Spotify', `<ul>
      <li>If you're signed in to Spotify in Chrome, the page player may play full songs; otherwise it plays previews.</li>
      <li>For full songs either way: <b>Connect Spotify</b> (needs Premium), then choose <b>Spotify app (full song)</b> in Sing along.</li>
      <li>Playing on the wrong speaker? Tap <b>Change device</b>.</li></ul>`],
    ['Importing a script', `<ul>
      <li><b>PDF:</b> New script &gt; <b>Import PDF or .txt</b>.</li>
      <li><b>Paper script:</b> in the <b>Google Drive</b> app, tap <b>+</b> &gt; <b>Scan</b> to make a PDF, then import it and tap <b>Read pages</b>.</li>
      <li><b>A few pages or screenshots:</b> use <b>Take photo</b> or <b>Choose photos</b>, then <b>Read pages</b>. Uses your OpenAI key.</li>
      <li>Afterwards, use <b>Find and fix</b> or <b>Merge characters</b> to tidy names.</li></ul>`],
    ['Sync and groups', `<ul>
      <li><b>Sync</b> keeps scripts and progress the same on all your devices.</li>
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
      <li>Checking lines needs an internet connection.</li></ul>`],
    ['Sound and voices', `<ul>
      <li><b>Edge</b> has natural-sounding voices built in; Chrome's are more robotic.</li>
      <li>Most natural: AI voices. Open a script &gt; <b>Voices for each character</b> &gt; add an OpenAI key.</li>
      <li>Each character's voice, gender and speed can be changed in <b>Voices for each character</b>.</li></ul>`],
    ['Songs and Spotify', `<ul>
      <li>Signed in at <b>open.spotify.com</b> in the same browser? The page player plays full songs. Otherwise it plays previews.</li>
      <li>Or: <b>Connect Spotify</b> (Premium) and choose <b>Spotify app (full song)</b> to play in the Spotify desktop app.</li></ul>`],
    ['Importing a script', `<ul>
      <li><b>PDF or .txt:</b> New script &gt; <b>Import PDF or .txt</b>, or drag the file onto the text box.</li>
      <li><b>Scanned PDF or screenshots:</b> they go into the pages list; tap <b>Read pages</b> (uses your OpenAI key).</li>
      <li>Afterwards, use <b>Find and fix</b> or <b>Merge characters</b> to tidy names.</li></ul>`],
    ['Sync and groups', `<ul>
      <li><b>Sync</b> keeps scripts and progress the same on your computer and phone.</li>
      <li><b>Sign in</b> with Google to create or join a group. If the sign-in window doesn't open, allow pop-ups for this site.</li></ul>`],
  ],
};

const COMMON = topic("Something's not working?", `<ul>
  <li><b>Reload the page.</b> Updates arrive automatically, but a reload makes sure you have the latest.</li>
  <li><b>Check your internet connection:</b> checking lines, AI voices, lyrics, sync and groups need it.</li>
  <li><b>Your scripts live in this browser.</b> Clearing this site's data (or browsing privately) can remove them, so turn on <b>Sync</b> as a backup.</li>
  <li>Still stuck? Take a screenshot of the message and send it to Shannon.</li></ul>`);

function renderHelp() {
  const tabs = Object.entries(DEVICE_TABS).map(([k, v]) =>
    `<button class="seg${help.tab === k ? ' on' : ''}" data-action="help-tab" data-tab="${k}" aria-pressed="${help.tab === k}">${v}</button>`).join('');
  return `<section class="stack help-page">
    <div class="row between wrap"><h1>Help</h1><button class="btn ghost" data-action="home">${icon('back')} Your scripts</button></div>
    <p class="lede">How to set things up and fix common problems. Pick your device:</p>
    <div class="segmented" role="group" aria-label="Your device">${tabs}</div>
    ${HELP[help.tab].map(([t, b], i) => topic(t, b, i === 0)).join('')}
    ${COMMON}
  </section>`;
}

Object.assign(actions, {
  help() { leave(); app.view = 'help'; render(); window.scrollTo(0, 0); },
  'help-tab'(b) { help.tab = b.dataset.tab; render(); },
});

VIEWS.help = renderHelp;
