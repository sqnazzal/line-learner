# Line Learner

An app for learning lines for shows and auditions, built for people who learn by **listening** and **saying it out loud**.

Nothing to install. It runs in Microsoft Edge or Google Chrome and uses the browser's built-in voices and speech recognition.

## Start it

Open **<https://sqnazzal.github.io/line-learner/>** on any phone, tablet or computer. Use that same address everywhere, so Sync and groups see the same scripts.

The first time you practice, the browser asks for microphone access. Click **Allow**.

> Use Edge or Chrome. Firefox can read lines aloud but can't check them by microphone, so the app falls back to "Got it / Missed it" buttons there. Checking lines by microphone also needs an internet connection, because the browser sends the audio to its speech service.

## On your iPhone

Open **<https://sqnazzal.github.io/line-learner/>** in **Safari** (Safari is the browser that can check your lines by microphone on iPhone).

- To get an app icon: tap the Share button, then **Add to Home Screen**.
- When Safari asks for the microphone, tap **Allow**. To stop it asking every visit: Settings > Apps > Safari > Microphone > Allow.
- Tap **Play** to start; iPhones only allow sound that starts from a tap.
- The screen stays on while a scene plays. If the phone locks, the speech stops, so keep the screen on.
- Headphones with a mic work well for Listen mode on the go.
- Tap the sun/moon button at the top to switch between Light, Dark, and matching your phone.
- Turn on **Sync** (below) to have the same scripts and progress on your phone and PC.

## Sync between phone and PC

Tap **Sync** at the top right and follow the steps. You create a GitHub access key that can only touch Gists, paste it in, and you're done. Do this once on each device.

- Your scripts and progress are stored in one secret Gist on your GitHub account. It isn't listed anywhere, but anyone with its link could read it, so don't share that link.
- Syncing happens on its own a few seconds after a change, and whenever you open the app. **Sync now** pulls the latest right away.
- If you edit the same script on both devices, the most recent edit wins. Practice progress merges line by line, so practice on either device counts.
- Voices and recordings stay on each device.
- On the PC, use the same web address as the phone (<https://sqnazzal.github.io/line-learner/>).

## Ways to practice

| Mode | What happens | Good for |
| --- | --- | --- |
| **Listen** | The whole scene is read aloud like an audio track. At your lines it pauses so you can say them, then plays them so you hear how they go. Turn on **Loop** and leave it running. | Commuting, chores, the first week of learning |
| **Rehearse** | Your cue lines are read aloud, then the mic listens to you. You get a word-by-word check (green = right, red = missed). Miss it and you hear the line, then try again. | Running lines with a partner who never gets tired |
| **Build up** | For long speeches and audition monologues. Hear one sentence, say it from the top; hear the next, say it all from the top again, until you have the whole thing. Click the stairs icon on any of your longer lines. | Monologues, big speeches |
| **Drill weak lines** | Only the lines you missed last time, each with its cue. | Right before rehearsal |

**Stuck mid-rehearsal?** Say **"line"** (just like calling for a line in a real rehearsal) and it will feed it to you.

### Natural AI voices (optional)

For voices that sound like real actors, open a script, expand **Voices for each character**, and paste an OpenAI key (from <https://platform.openai.com/api-keys>, with a few dollars of credit added under Billing).

- Each character gets a female or male AI voice with an American accent. You can pick a different one, and add a note on how they sound ("warm and elderly", "nervous teenager").
- Stage directions in a line, like *(angrily)* or *(whispering)*, are acted out.
- Each line is made once and saved on the device, so replays are free and work offline. **Prepare all lines now** makes the whole script ahead of time.
- Your script text is sent to OpenAI to make the audio. The key is saved only on that device (enter it on each device). Setting a monthly spending limit in your OpenAI account is a good idea.
- If OpenAI can't be reached, the app falls back to the device's built-in voices.

### Record real voices

Click the mic icon on any line to record it. Recordings play instead of the computer voice. Record your own lines to hear yourself saying them, or have a castmate record their cues so you practice with the real rhythm.

### Keyboard shortcuts (while practicing)

`Space` play/pause, `Left`/`Right` previous/next line, `H` hint, `L` hear the line, `Enter` "I'm done speaking".

## Formatting a script

Paste the text, or import a **PDF** or `.txt` file (click **Import PDF or .txt**, or drag the file onto the text box). Any of these work:

```
ROMEO: But soft, what light through yonder window breaks?
JULIET. Ay me!

NURSE
Madam! Your mother calls.
```

- Stage directions go in `(parentheses)` or `[brackets]`. They're shown but never read as part of a line.
- A line starting with `#`, or like `Act 1` / `Scene 2`, starts a section. You can choose which section to practice.
- For an audition monologue, paste it with no names. Each paragraph becomes one of your lines.

- **Paper scripts and screenshots:** in the editor, tap **Take photo** for each page (tap it again for the next page) or **Choose photos** to pick many at once, then **Read pages**. Pages are read in order with your OpenAI key, six at a time, with progress shown; if it stops, what's read is kept and the rest stay ready to continue. A progress bar shows how far it's got and roughly how long is left. To correct misread words (like a character's name), open **Find and fix** above the text box: Previous/Next step through matches, **Replace** or **Replace all** (with **Undo**), and **Match case**. Handwriting is ignored (blocking notes, arrows, margin notes, pencil marks); only the printed script is read. Tick **Leave out lines crossed out by hand (cuts)** if crossed-out lines in your copy are cuts. For a long paper script, scanning it with the iPhone Notes app (Scan Documents, then share as PDF) is quickest: import that PDF and its pages are read the same way.
- **PDFs:** the text is pulled out of the PDF, wrapped lines are rejoined, and page numbers and repeated page headers are removed. Skim the result before saving, since title pages, cast lists or unusual layouts may need a quick tidy. Scanned PDFs (photos of pages with no selectable text) can't be read.

- **Same character under two names** (like "MRS" and "MRS. PECK")? Under the character list in the editor, **Merge characters** suggests likely duplicates and moves all of one character's lines to another, with **Undo**. On a saved script, tap **Fix or merge character names**.

See `sample-script.txt` for a complete example.

## Settings

Open **Practice settings** under the player to change reading speed, how much of your line is shown as a hint, how strict the scoring is, how long it waits after you stop talking, and more.

## Where your stuff is saved

Scripts, progress and recordings are saved in your browser for `localhost:8765`. They stay there between sessions, but are tied to that browser. Clearing your browser's site data for localhost will remove them, so keep a copy of your script text.

## Files

- `index.html`, `styles.css`, `app.js`: the app
- `serve.ps1`: tiny local web server (PowerShell) used by the library build tools
- `sample-script.txt`: an example scene
- `vendor/pdfjs`: Mozilla's PDF.js 3.11.174 (Apache 2.0 license), used to read PDF scripts

## Free script library

**Browse free scripts & monologues** on the home screen offers 31 classic plays (Shakespeare, Wilde, Ibsen, Chekhov, Shaw, Molière, Rostand and more) and 44 well-known audition monologues, searchable and filterable by gender and tone. Tap **Add** and it's ready to practice. All are public domain; translated plays use older public-domain translations, so check which translation your production or audition uses.

The library lives in `library/`. To rebuild it (for example after adding a play to the list in `tools/build-library.html`), run:

```
powershell -ExecutionPolicy Bypass -File tools\build-library.ps1
```

It downloads the source texts from Project Gutenberg into `tools/raw/` (not committed), converts them with `tools/convert.js`, and writes `library/plays/*.txt`, `library/plays.json` and `library/monologues.json`.

## Songs

Tap **+ New song** on the home screen.

1. **The song:** paste a Spotify song link (in Spotify: Share > Copy Song Link). Once Spotify is connected you can search Spotify or pick from your playlists and liked songs instead.
2. **The lyrics:** they're looked up automatically on LRCLIB (a free lyrics database), or tap **Find lyrics**, paste them, or use **From screenshots**. Timed lyrics highlight along with the music; untimed lyrics can be timed by tapping along (**Time the lyrics**).

**Full songs on iPhone:** Spotify's player inside a web page can only play previews on iPhone (every iPhone browser blocks it from seeing your Spotify login). With Spotify connected (Premium), Sing along offers **Spotify app (full song)**: the song plays in your own Spotify app and the lyrics follow along on the page. If it says Spotify isn't open anywhere, open the Spotify app, play any song for a second, and come back. Songs play on this device's own Spotify app (so through your AirPods if they're connected), never on a speaker just because it was last used; tap **Change device** to pick another, like a speaker or your computer.

**Instrumental:** with Spotify connected, the app looks for instrumental and karaoke versions when you pick a song (or paste a link to one). Sing along then has an **Original | Instrumental** switch. Each version keeps its own timing: if the highlight is out of step on the instrumental, tap **It's early** / **It's late** to nudge it, or re-time it by tapping along.

A **player bar** stays at the bottom of the screen while you sing: Play/Pause, previous and next line, and where you are. Scrolling the lyrics yourself stops the page from jumping to the current line; tap **Follow along** (or wait a few seconds) to pick it back up.

**Sing along** plays the real track in Spotify's player with the current line highlighted. Hide words as you learn (**First letters**, **Fill in as I sing**, **Hidden**), tap a line to jump there, and **Repeat this line** to loop a tricky bit. Spotify decides whether the player plays the full track or a preview, depending on whether you're signed in to Spotify in that browser.

Connecting a Spotify account needs a Spotify developer app: set its Redirect URI to `https://sqnazzal.github.io/line-learner/`, put its Client ID in `SPOTIFY_CLIENT_ID` at the top of `songs.js`, and add anyone else who signs in under User Management. Since February 2026 Spotify only runs personal developer apps like this when the app's owner has Spotify Premium, allows 5 users per app, and only lets apps open playlists you own or collaborate on. Pasting a song link works without any of this.

## Groups (cast, friends and family)

Tap **Sign in** at the top (next to Sync) and sign in with Google; it then says **Group**.

- **Create a group** and share its invite code or link. People who open the link and sign in join automatically.
- Open any script or song and tap **Share to group**: a panel lists all your groups, showing where it's shared, with **Share**, **Update** and **Unshare** for each. Everyone in a group sees shared items under **Shared scripts and songs** and taps **Add to my scripts** to practice them; after an update they get an **Update my copy** button that keeps their progress and character. Only the person who shared an item can update or unshare it (enforced by the security rules, not just the app). Groups can't be deleted, and members can only remove themselves.
- In more than one group? Switch between them with the tabs at the top of the Group screen.
- Each person's progress, recordings, voices and personal scripts stay private. Only what you share goes to the group.

Groups use Google Firebase (project `line-learner-45bd1`): Authentication with Google sign-in, and Firestore for groups and shared items. Access is controlled by `firestore.rules`; paste it into **Databases and storage > Firestore > Rules** in the Firebase console and tap **Publish** whenever it changes. Sign-in only works from domains listed under **Security > Authentication > Settings > Authorized domains** (add `sqnazzal.github.io`).

## Your scripts and categories

The home screen lists your scripts under category tabs: **Current**, **Audition**, **Fun**, **Other** and **Past**, plus any you create (like a show's name) with **New category…**. Move a script with the small category menu on its card or on its page. New scripts go into the tab you're looking at.

## Listen, screen off

**Listen, screen off** on a script builds the part you pick with **From** / **Stop** into one audio file that keeps playing when your phone locks, with lock-screen controls, scene jumps and **Save as a file**. Finished tracks are saved on the device, listed under **Saved tracks** to play any time (even offline), and each has **Delete**. It uses the AI voices (and your recordings), following the Listen settings for your own lines. Listen mode itself now hears you say your line and moves on when you finish (Practice settings: **move on as soon as I finish my line**).

## Backup, voice lock and your own Spotify

- **Sync and backup** screen: **Download backup** saves all scripts, progress and settings to a file; **Restore backup** brings them back on any device.
- **Voice lock:** add a PIN when saving the OpenAI key (or later, under Voices for each character). AI voices, notes, Female/Male and removing the key then need the PIN, so paid-for audio isn't re-made.
- **Your own Spotify app:** Spotify limits each personal app to 5 people. Others with Premium can make a free Spotify app and paste its Client ID under **Use your own Spotify app** when connecting.

## Help

**Help & troubleshooting** (on the home screen and at the bottom of every page) has setup steps and fixes for each kind of device, with tabs for iPhone & iPad, Android and computers. It opens on the tab for the device you're using.
