'use strict';

// Help & troubleshooting (instructions for each kind of device, opening on the one you're using), plus the
// About, What's new and Send feedback screens.
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
      <li>For full songs with any Spotify account: in Sing along choose <b>Play it in Spotify yourself</b>, tap <b>Open in Spotify</b>, play the song, come back and tap the line being sung. The lyrics follow from there; if you pause or skip in Spotify, do the same here. (In the Nazzal only group, or set up with your own Spotify app? <b>Connect Spotify</b> and choose <b>Spotify app, connected</b> to stay in step automatically.)</li>
      <li>"Spotify is asleep"? Tap <b>Open Spotify</b>, then come straight back (tap <b>◀ Safari</b> in the top-left corner, or swipe right along the bottom edge); the song starts by itself. iPhones can't switch back automatically.</li>
      <li>Playing on the wrong speaker? Tap <b>Change device</b>.</li>
      <li>"Not allowed" when connecting? Line Learner's own Spotify connection is only for Shannon's Nazzal only group (signed in); anyone else with Premium can tap <b>Use your own Spotify app</b> and follow the steps.</li>
      <li>Highlight out of step? Tap <b>It's early</b> / <b>It's late</b>, or <b>Re-time lyrics</b>.</li></ul>`],
    ['Importing a script', `<ul>
      <li><b>PDF:</b> New script &gt; <b>Import PDF or .txt</b>.</li>
      <li><b>Paper script:</b> in the <b>Notes</b> app, tap the camera icon &gt; <b>Scan Documents</b>, save, then <b>Share</b> &gt; <b>Save to Files</b> as a PDF. Import that PDF and tap <b>Read pages</b>.</li>
      <li><b>A few pages or screenshots:</b> use <b>Take photo</b> (again for each page) or <b>Choose photos</b>, then <b>Read pages</b>. Reading pages uses Shannon's shared access (sign in, in one of Shannon's groups, with shared voices on) or your own OpenAI key.</li>
      <li>Afterwards, check the character list and use <b>Find and fix</b> (in Edit) to tidy text and character names.</li></ul>`],
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
      <li>For full songs with any Spotify account: choose <b>Play it in Spotify yourself</b> in Sing along, start the song in Spotify, then tap the line being sung. (Connected to Spotify? Choose <b>Spotify app, connected</b> to stay in step automatically.)</li>
      <li>Playing on the wrong speaker? Tap <b>Change device</b>.</li>
      <li>"Not allowed" when connecting? Line Learner's own Spotify connection is only for Shannon's Nazzal only group (signed in); anyone else with Premium can tap <b>Use your own Spotify app</b> and follow the steps.</li></ul>`],
    ['Importing a script', `<ul>
      <li><b>PDF:</b> New script &gt; <b>Import PDF or .txt</b>.</li>
      <li><b>Paper script:</b> in the <b>Google Drive</b> app, tap <b>+</b> &gt; <b>Scan</b> to make a PDF, then import it and tap <b>Read pages</b>.</li>
      <li><b>A few pages or screenshots:</b> use <b>Take photo</b> or <b>Choose photos</b>, then <b>Read pages</b>. Reading pages uses Shannon's shared access (sign in, in one of Shannon's groups, with shared voices on) or your own OpenAI key.</li>
      <li>Afterwards, use <b>Find and fix</b> (in Edit) to tidy text and character names.</li></ul>`],
  ],
  computer: [
    ['Getting started', `<ol>
      <li>Use <b>Google Chrome</b> or <b>Microsoft Edge</b> (Firefox can read lines aloud but can't check them by microphone; <b>Type your lines</b> works everywhere).</li>
      <li>Keyboard shortcuts while practicing: <kbd>Space</kbd> play/pause, <kbd>←</kbd> <kbd>→</kbd> lines, <kbd>H</kbd> hint, <kbd>L</kbd> hear the line, <kbd>Enter</kbd> done speaking. Turn them off under <b>Practice settings</b> &gt; <b>Advanced</b> if they get in the way of a screen reader or voice control.</li>
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
      <li>Or: choose <b>Play it in Spotify yourself</b>, play the song in Spotify, and tap the line being sung. Connected to Spotify? <b>Spotify app, connected</b> keeps in step by itself.</li>
      <li>"Not allowed" when connecting? Line Learner's own Spotify connection is only for Shannon's Nazzal only group (signed in); anyone else with Premium can use <b>Use your own Spotify app</b>.</li></ul>`],
    ['Importing a script', `<ul>
      <li><b>PDF or .txt:</b> New script &gt; <b>Import PDF or .txt</b>, or drag the file onto the text box.</li>
      <li><b>Scanned PDF or screenshots:</b> they go into the pages list; tap <b>Read pages</b> (uses Shannon's shared access if you're in one of Shannon's groups, or your own OpenAI key).</li>
      <li>Afterwards, use <b>Find and fix</b> (in Edit) to tidy text and character names.</li></ul>`],
  ],
};

const SYNC_HELP = topic('Sync, groups and backups', `<h2>Syncing your devices</h2>
  <ol>
    <li>Tap <b>Sign in</b> at the top and sign in with Google.</li>
    <li>Do the same, with the <b>same Google account</b>, on your other phone, tablet or computer.</li>
    <li>That's it: your scripts, songs, categories and practice progress fill in on each device by themselves.</li></ol>
  <ul>
    <li><b>When it syncs:</b> a few seconds after any change, and whenever you open the app. To pull the latest right away, tap <b>Sync</b> (top right) &gt; <b>Sync now</b>.</li>
    <li><b>Edited on two devices?</b> The most recent edit of a script wins. Practice progress is combined line by line, so practice anywhere counts. Deleting a script on one device deletes it on the others.</li>
    <li><b>Recordings:</b> with <b>Back up my recordings too</b> ticked (Sync screen, on by default), your recordings are saved to your account as well and come back on any device you sign in on. Only you can hear them.</li>
    <li><b>Stays on each device:</b> computer voices, AI voices already made, and saved screen-off tracks.</li>
    <li><b>The Sync button says "Sync problem"?</b> Tap it to see why. Usually it's no internet for a moment; it tries again by itself. If it says sync was refused, tell Shannon.</li>
    <li><b>Very long scripts:</b> one script bigger than about 900 KB of text (far longer than a normal play) can't sync; the app will say so. Use <b>Download backup</b> to keep it safe.</li>
    <li><b>Advanced:</b> people who already use GitHub can sync through it instead (Sync &gt; <b>Advanced: sync with GitHub instead</b>). Most people don't need this.</li></ul>
  <h2>Groups</h2>
  <ul>
    <li><b>Sign in</b> (top of the screen) to create a group or join one from an invite, then <b>Share to group</b> from a script so your cast can add it. Only share what your production's license (or the publisher) allows: sharing asks for the show's last performance date and a tick confirming permission (can't confirm? keep it private). Whoever shares is responsible; Line Learner and Shannon don't check licenses. After that date, or once the sharer taps <b>Mark inactive</b>, no one new can add it, and people who have it see a note.</li>
    <li><b>Private:</b> other people can't see your synced scripts; people in your groups only see what you choose to share. The app's admin (Shannon) can remove accounts and their synced data if needed.</li>
    <li><b>Sign-in window doesn't open?</b> Allow pop-ups for this site. On iPhone: <b>Settings</b> &gt; <b>Apps</b> &gt; <b>Safari</b> &gt; turn off <b>Block Pop-ups</b>, then try again.</li></ul>
  <h2>Backups</h2>
  <ul>
    <li><b>Download backup</b> (Sync screen) saves your scripts, progress and settings to a file you can keep, then <b>Restore</b> on any device, signed in or not.</li>
    <li><b>Not in the backup:</b> your recordings. Use <b>Download recordings</b> next to it for those (the same Restore button brings them back), or let Google sync back them up.</li>
    <li><b>iPhone and iPad:</b> removing the app's home screen icon deletes everything it saved on the device (recordings, your OpenAI key, saved tracks and AI voices), and the phone can clear it when space runs low. Keep Google sync on, or download a backup and your recordings first.</li></ul>`);

const ACCESS_HELP = topic('Accessibility', `<ul>
    <li><b>Screen readers and keyboard:</b> every button works from the keyboard, and in the player, results like <i>"Not quite, 60 percent. Missed: glad, see"</i> are announced. Shortcuts: <kbd>Space</kbd> play/pause, <kbd>&larr;</kbd> <kbd>&rarr;</kbd> move, <kbd>H</kbd> hint, <kbd>L</kbd> hear the line, <kbd>Enter</kbd> done speaking. Turn them off under <b>Practice settings</b> &gt; <b>Advanced</b> if they get in the way of a screen reader or voice control.</li>
    <li><b>Can't or don't want to speak?</b> <b>Type your lines</b> checks typed lines with no microphone, and without mic support, Rehearse lets you mark each line yourself.</li>
    <li><b>Seeing the words:</b> <b>Practice settings</b> &gt; <b>Text size</b> goes up to Extra large, the colors button at the top switches Light and Dark, and your browser's zoom works everywhere.</li>
    <li><b>Hearing:</b> everything read aloud is also shown on screen.</li>
    <li><b>Something in the way?</b> Please <button class="link-btn" data-action="feedback">tell Shannon</button> and it'll get fixed.</li></ul>`);

const REAL_HELP = topic('Rehearsing for real: phone on a stand, headphones, long scenes', `<ul>
    <li><b>Phone on a stand:</b> open <b>Practice settings</b> (under the player) &gt; <b>Text size</b> &gt; <b>Extra large</b>. The play button stays at the bottom of the screen, and the screen stays on while a scene plays. Hands busy? Say <i>"line"</i> when you're stuck.</li>
    <li><b>Headphones:</b> wired or Bluetooth both work. On many phones the play/pause and skip buttons on them work the player too (most reliably with the AI voices). Bluetooth earbuds use their own microphone, which can be less clear; if good lines keep getting marked wrong, lower <b>Score needed to pass</b> a little.</li>
    <li><b>Can't talk out loud</b> (train, library, backstage)? Use <b>Type your lines</b>: your cues show on screen, you type each line, and it gets the same word-by-word check. Spelling slips and sound-alikes (Dottie or Dotty, wanna or want to) still count. Want to hear the cues? <b>Practice settings</b> &gt; <b>Cues in Type mode</b> &gt; <b>Read them aloud</b>, with headphones.</li>
    <li><b>Just your part:</b> on a script, tick <b>Just my cues and lines</b> and Listen, Rehearse and Type play only the line before each of yours, then yours, skipping the rest of the show. <b>Listen, screen off</b> has the same choice when you make a track.</li>
    <li><b>Long scenes:</b> leave any time and the script page offers <b>Pick up where you left off</b>. Lines like <code># Act 2</code> or <code>Scene 3</code> in the script make sections you can pick with <b>Start at</b>, and the play icon on any of your lines starts Rehearse from there.</li></ul>`);

// Kept in step with what the app actually stores and sends (and the access firestore.rules gives); update it
// when either changes.
const PRIVACY_DATE = 'October 18, 2026';
const privacyHtml = () => `<details class="card help-topic" id="privacy"${help.privacyOpen ? ' open' : ''}><summary>Privacy: what's stored and where</summary><div class="help-body">
  <p class="muted small">Last updated ${PRIVACY_DATE}.</p>
  <p>Line Learner is a free app Shannon made for friends, family and fellow actors. It has no ads and no analytics or advertising trackers, and nothing is ever sold. The services it uses (below) may keep their own technical logs, such as your IP address, under their own policies.</p>
  <p><b>Stays on your device</b> (in this browser):</p>
  <ul>
    <li>Your scripts, songs, categories and practice progress</li>
    <li>Your voice recordings (backed up to your own account only if you turn on Google sync with <b>Back up my recordings too</b>; never shared with anyone)</li>
    <li>Saved screen-off tracks and AI voice audio</li>
    <li>Your own OpenAI key, if you add one, and your Spotify connection</li>
  </ul>
  <p><b>If you sign in with Google</b> (optional, ages 13 and up), Shannon's Firebase project (run by Google) keeps:</p>
  <ul>
    <li>Your name, email and when you last used the app, so Shannon can see who's using it</li>
    <li>Your synced scripts, songs, categories and progress, and your recordings if you back them up. Other people can't see them. Shannon, as the app's admin, has access to them and to your account details, and uses it only to delete data you ask to have removed or to fix a problem you report</li>
    <li>The groups you're in, and anything you <b>Share to group</b>, which everyone in that group can see</li>
  </ul>
  <p><b>Sent to other services, only when you use a feature that needs them:</b></p>
  <ul>
    <li><b>AI voices and reading pages:</b> the lines being voiced, or the page photos, go to <a href="https://openai.com/policies/privacy-policy/" target="_blank" rel="noopener">OpenAI</a>. With Shannon's shared voices they pass through Shannon's small server on <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener">Cloudflare</a>, which keeps only a monthly cost total for your account. AI voices are computer-generated, not real people.</li>
    <li><b>Checking your lines by microphone:</b> your browser's own speech recognition (from Apple or Google) hears what you say. Line Learner doesn't keep the audio or make voiceprints.</li>
    <li><b>Songs:</b> song names go to <a href="https://lrclib.net" target="_blank" rel="noopener">LRCLIB</a> to find lyrics. Playing a song uses <a href="https://www.spotify.com/legal/privacy-policy/" target="_blank" rel="noopener">Spotify</a>, whose player can set its own cookies.</li>
    <li><b>Send feedback:</b> your message, anything you add (contact details, a screenshot) and, if ticked, device details are stored for Shannon to read in the app, and emailed to Shannon through <a href="https://resend.com/legal/privacy-policy" target="_blank" rel="noopener">Resend</a>. Only Shannon can read them.</li>
    <li><b>GitHub sync</b> (optional, advanced): your scripts and progress go to a secret Gist in your own GitHub account, using the access key you paste in, which stays on this device. A secret Gist isn't listed anywhere, but anyone with its link can read it.</li>
    <li><b>The app itself</b> is hosted on <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener">GitHub Pages</a>; sign-in and sync use <a href="https://firebase.google.com/support/privacy" target="_blank" rel="noopener">Google Firebase</a>.</li>
  </ul>
  <p><b>How long it's kept:</b> what's on your device stays until you delete it or clear this site's data. Your account details and synced data stay until you delete them or ask Shannon to. Feedback stays until Shannon deletes it. Monthly voice cost totals are kept as simple per-month numbers. Something you unshare from a group is hidden from the group, and kept (so it can be restored if it was a mistake) until Shannon deletes it.</p>
  <p><b>Deleting your data:</b> delete scripts in the app any time (with sync on, that removes them from your synced copy too); clearing this site's data in your browser removes everything on this device. To have your synced data, profile and group memberships deleted, <button class="link-btn" data-action="feedback" data-kind="privacy">send a privacy request</button> while signed in. Things you shared to a group stay there until you unshare them (or ask Shannon to remove them), and copies other people already added to their own scripts stay on their devices; no one can take those back.</p>
  <p><b>Questions, or a copyright concern?</b> <button class="link-btn" data-action="feedback" data-kind="privacy">Privacy request</button> · <button class="link-btn" data-action="feedback" data-kind="copyright">Copyright concern</button></p>
</div></details>`;

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
    ${ACCESS_HELP}
    ${privacyHtml()}
  </section>`;
}

Object.assign(actions, {
  help() { leave(); app.view = 'help'; render(); window.scrollTo(0, 0); },
  'help-tab'(b) { help.tab = b.dataset.tab; render(); },
  privacy() {
    help.privacyOpen = true;
    actions.help();
    help.privacyOpen = false;
    $('#privacy')?.scrollIntoView({ block: 'start' });
  },
});

VIEWS.help = renderHelp;

// ---------- About ----------
const renderAbout = () => `<section class="stack about-page">
  <div class="row between wrap"><h1>About Line Learner</h1><button class="btn ghost" data-action="home">${icon('back')} Your scripts</button></div>
  <div class="card stack">
    <h2>About the creator</h2>
    <p>Hi! I'm Shannon Nazzal, an actor, audiobook narrator, and apparently now an app developer. Who knew?</p>
    <p>Like most actors, I've spent plenty of time trying to convince family members to read lines with me, recording myself saying everyone else's parts, or talking to an empty room. I tried some of the line-learning apps out there, too, but even the paid ones didn't quite do what I wanted.</p>
    <p>So, instead of just learning my lines like a normal person, I decided to build my own app. 😂</p>
    <p>Naturally, I overthought it, overengineered it, and kept adding features because "wouldn't it be cool if it could also…" apparently isn't a question I know how to stop asking.</p>
    <p>The result? A free rehearsal partner that reads your cues, listens for your lines, helps you practice at your own pace, and doesn't complain when you want to run the same scene for the 47th time.</p>
    <p>Line Learner started as a way to make my own rehearsals easier and somehow turned into something I thought other actors might actually find useful.</p>
    <p>Oh, and "Line Learner" is a working title. Apparently, I had time to build an entire app but couldn't come up with a more creative name. Suggestions welcome! 😂</p>
    <p>It's free, it's a work in progress, and I'm learning as I go. I hope it makes your rehearsals a little easier, too!</p>
    <p>Curious what's changed lately? <button class="link-btn" data-action="updates">See what's new</button></p>
    <div><h3>Find me elsewhere</h3>
    <ul class="about-links">
      <li><a href="https://www.instagram.com/shannonnazzal.music/" target="_blank" rel="noopener">Instagram @shannonnazzal.music</a>: acting, voiceover, music, and whatever else I'm getting myself into.</li>
      <li><a href="https://www.backstage.com/tal/shannon-nazzal" target="_blank" rel="noopener">Backstage profile</a>: my acting credits and projects.</li>
    </ul></div>
  </div>
  <div class="card stack">
    <h2>Say hello or help out</h2>
    <p>Have an idea? Find something broken? Have a better name for this thing? Just want to tell me you love it (or that I should stick to acting)? I'd love to hear from you!</p>
    <p>I built this for fun and plan to keep it free. If you find it useful and feel like buying me a coffee, there's a tip jar below. Absolutely no pressure!</p>
    <div class="row wrap"><button class="btn" data-action="feedback">Send feedback</button><a class="btn" href="${TIP_URL}" target="_blank" rel="noopener">☕ Tip jar on Venmo</a></div>
  </div>
</section>`;

actions.about = () => { leave(); app.view = 'about'; render(); window.scrollTo(0, 0); };
VIEWS.about = renderAbout;

// ---------- What's new ----------
// Newest first. Add a dated entry (or add to today's) whenever something people would notice changes.
const UPDATES = [
  ['2026-10-18', [
    '<b>Type your lines:</b> practice quietly (on a train, say) by typing your lines. Cues show on screen, or can be read aloud.',
    '<b>Sound-alikes count:</b> different spellings that sound the same (Dotty / Dottie) and run-together words (damn it / dammit, want to / wanna) now pass.',
    '<b>No microphone? No problem:</b> Listen and Rehearse keep going with timed pauses instead.',
    '<b>Clearer progress:</b> each line is Not practiced, Working on it or Solid, and lines you needed help with don\'t count as solid yet.',
    '<b>Continue</b> on the home screen picks up where you left off, and your place is kept when a script is edited.',
    '<b>Script preview</b> before saving, with warnings about anything that looks off.',
    '<b>Settings</b> split into everyday ones and an Advanced section.',
    '<b>Backups</b> say clearly what\'s not included, and your own recordings can be saved separately.',
    '<b>Safer group sharing:</b> sharing asks you to confirm you have permission and for the show\'s last performance date; shared scripts show when the license has ended or they\'re inactive; something unshared by mistake can be restored.',
    '<b>Accessibility:</b> better screen reader support, keyboard focus and headings throughout.',
    '<b>Privacy notice</b> rewritten in plain language, with privacy and copyright requests in Send feedback.',
    '<b>Home screen icon:</b> theatre masks instead of a gray letter (remove and re-add the app to see it).',
    '<b>Drill weak lines</b> cues you properly when the line before yours is also yours (a speech split by a stage direction): you hear the other character\'s cue and come in from the start of your speech.',
    '<b>Recordings backup:</b> with Google sync on, your recordings are backed up to your account too and come back on any device you sign in on (Sync screen, <b>Back up my recordings too</b>).',
    '<b>Warning on iPhone:</b> removing the home screen icon deletes the app\'s recordings, key and tracks on that device; Help and the Sync screen now say so.',
    '<b>Licensed show reminder</b> next to Read pages, AI voices and screen-off tracks: these send text to OpenAI, and some show licenses don\'t allow that.',
    '<b>Screen-off tracks</b> now start and end with a short spoken notice, "For private, non-commercial use only", and the title (and author, for library plays). Remake a track to add it.',
    '<b>About Line Learner</b> page and this <b>What\'s new</b> page.',
    '<b>Fixed:</b> Check could stop responding after skipping lines in Type mode, and going back could bounce forward again.',
  ]],
  ['2026-10-17', [
    '<b>Line Learner opens!</b> Learn lines by listening, then rehearse out loud while it listens and checks you.',
    '<b>Voices</b> matched to each character, with a speed for each, plus optional natural AI voices.',
    '<b>Import scripts</b> from screenshots and photos of paper pages, with handwriting ignored.',
    '<b>Library</b> of free public-domain plays and monologues.',
    '<b>Sing along:</b> practice songs with lyrics that follow Spotify.',
    '<b>Groups:</b> sign in with Google to share scripts and songs with your cast.',
    '<b>Sync</b> your scripts and progress between devices.',
    '<b>Screen-off tracks</b> to listen with your phone locked, and <b>Just my cues and lines</b> to run only your parts.',
    '<b>Help</b>, <b>Send feedback</b>, light and dark themes, and a tip jar.',
  ]],
];

const renderUpdates = () => `<section class="stack updates-page">
  <div class="row between wrap"><h1>What's new</h1><button class="btn ghost" data-action="home">${icon('back')} Your scripts</button></div>
  <p class="lede">Changes to Line Learner, newest first. Reload the page to get the latest.</p>
  ${UPDATES.map(([d, items]) => `<div class="card stack">
    <h2>${new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</h2>
    <ul class="update-list">${items.map(i => `<li>${i}</li>`).join('')}</ul>
  </div>`).join('')}
  <p class="muted small">Something not working, or an idea? <button class="link-btn" data-action="feedback">Send feedback</button></p>
</section>`;

actions.updates = () => { leave(); app.view = 'updates'; render(); window.scrollTo(0, 0); };
VIEWS.updates = renderUpdates;

// ---------- Send feedback / Report a bug ----------
// Goes to the app's Firestore 'feedback' inbox, which only the admin can read (Admin screen). Works signed
// in or not. Device details help track down bugs; no scripts are included.
const fbk = { kind: 'bug', from: '', shot: '', sent: false, busy: false };
const FEEDBACK_KINDS = {
  bug: ['Report a bug', 'What happened, and what did you expect? What were you doing just before?'],
  idea: ['Idea', 'What would make rehearsing easier?'],
  privacy: ['Privacy or delete my data', 'What would you like to know, see or have deleted? Sign in first if it is about your account, so we know it is you.'],
  copyright: ['Copyright concern', 'Which script or song, where it appears (Browse, or a group), what you own or represent, and how to reach you. Please leave a contact below.'],
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
    `On this device: ${storageInfo}`,
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
      <div class="segmented wrap-seg" role="group" aria-label="What kind of feedback">${kinds}</div>
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
  feedback(b) { if (app.view !== 'feedback') fbk.from = app.view; leave(); Object.assign(fbk, { sent: false, shot: '', busy: false, ...(FEEDBACK_KINDS[b?.dataset?.kind] ? { kind: b.dataset.kind } : {}) }); app.view = 'feedback'; render(); window.scrollTo(0, 0);
    checkStorage().then(() => { const pre = $('.fb-details'); if (pre) pre.textContent = deviceDetails(); });
  },
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
