# Line Learner

An app for learning lines for shows and auditions, built for people who learn by **listening** and **saying it out loud**.

Nothing to install. It runs in Microsoft Edge or Google Chrome and uses the browser's built-in voices and speech recognition.

## Start it

Double-click **`Start Line Learner.cmd`**. A small window opens (keep it open while you practice) and the app opens in Google Chrome at <http://localhost:8765> (or your default browser if Chrome isn't installed).

The first time you rehearse, the browser asks for microphone access. Click **Allow**.

> Use Edge or Chrome. Firefox can read lines aloud but can't check them by microphone, so the app falls back to "Got it / Missed it" buttons there. Checking lines by microphone also needs an internet connection, because the browser sends the audio to its speech service.

## On your iPhone

Open **<https://sqnazzal.github.io/line-learner/>** in **Safari** (Safari is the browser that can check your lines by microphone on iPhone).

- To get an app icon: tap the Share button, then **Add to Home Screen**.
- When Safari asks for the microphone, tap **Allow**. To stop it asking every visit: Settings > Apps > Safari > Microphone > Allow.
- Tap **Play** to start; iPhones only allow sound that starts from a tap.
- The screen stays on while a scene plays. If the phone locks, the speech stops, so keep the screen on.
- Headphones with a mic work well for Listen mode on the go.
- Turn on **Sync** (below) to have the same scripts and progress on your phone and PC.

## Sync between phone and PC

Tap **Sync** at the top right and follow the steps. You create a GitHub access key that can only touch Gists, paste it in, and you're done. Do this once on each device.

- Your scripts and progress are stored in one secret Gist on your GitHub account. It isn't listed anywhere, but anyone with its link could read it, so don't share that link.
- Syncing happens on its own a few seconds after a change, and whenever you open the app. **Sync now** pulls the latest right away.
- If you edit the same script on both devices, the most recent edit wins. Practice progress merges line by line, so practice on either device counts.
- Voices and recordings stay on each device.
- On the PC, use the same web address as the phone (<https://sqnazzal.github.io/line-learner/>). The `Start Line Learner.cmd` version keeps its own separate copy unless you connect Sync there too.

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

- **PDFs:** the text is pulled out of the PDF, wrapped lines are rejoined, and page numbers and repeated page headers are removed. Skim the result before saving, since title pages, cast lists or unusual layouts may need a quick tidy. Scanned PDFs (photos of pages with no selectable text) can't be read.

See `sample-script.txt` for a complete example.

## Settings

Open **Practice settings** under the player to change reading speed, how much of your line is shown as a hint, how strict the scoring is, how long it waits after you stop talking, and more.

## Where your stuff is saved

Scripts, progress and recordings are saved in your browser for `localhost:8765`. They stay there between sessions, but are tied to that browser. Clearing your browser's site data for localhost will remove them, so keep a copy of your script text.

## Files

- `index.html`, `styles.css`, `app.js`: the app
- `serve.ps1`, `Start Line Learner.cmd`: tiny local web server (PowerShell, built into Windows)
- `sample-script.txt`: an example scene
- `vendor/pdfjs`: Mozilla's PDF.js 3.11.174 (Apache 2.0 license), used to read PDF scripts
