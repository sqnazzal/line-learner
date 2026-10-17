'use strict';

// Converts a public-domain play from Project Gutenberg plain text into Line Learner's script format:
//   # ACT I
//   (Enter Hamlet.)
//   HAMLET: To be, or not to be...
// Used only by tools/build-library.html when (re)building the built-in library.

const HEADING_RE = /^(act|scene|prologue|epilogue|induction|(first|second|third|fourth|fifth|last) act)\b/i;
const NOT_NAMES = new Set(['SONG', 'CONTENTS', 'FINIS', 'THE END', 'END', 'CURTAIN', 'ACT', 'SCENE', 'DRAMATIS PERSONAE', 'DRAMATIS PERSONÆ',
  'PERSONS OF THE PLAY', 'PERSONS REPRESENTED', 'CHARACTERS', 'THE CHARACTERS', 'NOTE', 'PREFACE', 'INTERMISSION', 'TABLEAU', 'SCENE', 'TIME', 'PLACE',
  'THE SCENE', 'SCENES', 'CAST', 'THE PERSONS', 'I', 'A', 'O']);

// Plain paragraphs that are stage business rather than someone talking.
const STAGE_WORDS = /^(enter|exit|exeunt|re-enter|manet|manent|flourish|alarums?|sennet|music|thunder|trumpets?|drums?|hautboys|a (flourish|sennet|tucket)|retreat|dies|dumb show)\b/i;

// Gutenberg marks italics with underscores and directions with [brackets]; turn those into (directions).
const tidy = s => s
  .replace(/\[_?\s*([^\]]*?)\s*_?\]/g, '($1)')
  .replace(/_/g, '')
  .replace(/\s*\u2014\s*/g, ' \u2013 ') // long dashes become spaced short dashes
  .replace(/\s+/g, ' ')
  .trim();

// Synge-style "_slowly as she writes._" then a long dash and the speech: an italic direction opening a speech.
const LEAD_ITALIC_DIR = /^\s*_([^_]+)_\s*[\u2014-]*\s*/;
const UPPER_TOKEN = /^[A-ZÀ-ÖØ-Þ0-9'’&-]+[.:,]?$/;
const hasTwoLetters = s => (s.match(/[A-ZÀ-ÖØ-Þ]/g) || []).length >= 2;

// Every way the start of a paragraph could be a speaker's name, with what follows it.
function nameCandidates(par) {
  const firstLine = par.split('\n')[0].trim();
  const out = [];
  // "HAMLET." or "CYRANO:" or "LIGNIÈRE (drawing Christian aside):" alone on the first line.
  let m = firstLine.match(/^([A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9 .'’&-]*?)\s*(\([^)]*\))?\s*[.:]$/);
  if (m && hasTwoLetters(m[1])) out.push({ name: m[1], dir: m[2] || '', rest: par.split('\n').slice(1).join('\n'), strong: true });
  const flat = par.replace(/\s*\n\s*/g, ' ').trim();
  const tokens = flat.split(' ');
  let prefix = [];
  for (let k = 0; k < Math.min(tokens.length, 6); k++) {
    const t = tokens[k];
    if (!UPPER_TOKEN.test(t)) {
      // "THE NOTE TAKER [turning on him] And how..." : name runs straight into a direction.
      if (/^[[(]/.test(t) && prefix.length && hasTwoLetters(prefix.join(' '))) {
        const after = flat.slice(prefix.join(' ').length).trim();
        const d = after.match(/^(\[[^\]]*\]|\([^)]*\))\s*[.:]?\s*(.*)$/);
        if (d) out.push({ name: prefix.join(' '), dir: d[1], rest: d[2], strong: false });
      }
      break;
    }
    prefix.push(t);
    // "NORA. Text" / "SHYLOCK: Text": a name ending in . or : followed by the speech.
    if (/[.:]$/.test(t) && k + 1 < tokens.length) {
      const name = prefix.join(' ').replace(/[.:]$/, '');
      if (hasTwoLetters(name)) out.push({ name, dir: '', rest: tokens.slice(k + 1).join(' '), strong: false });
    }
  }
  // "  CLEANTE" alone on the first line (no period), with the speech on the lines below.
  m = firstLine.match(/^([A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ .'’&-]*[A-ZÀ-ÖØ-Þ])$/);
  if (m && hasTwoLetters(m[1]) && par.includes('\n')) out.push({ name: m[1], dir: '', rest: par.split('\n').slice(1).join('\n'), strong: false });
  // "FIRST FELLOW  Now, gentlemen" : name followed by two spaces.
  m = firstLine.match(/^([A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ .'’&-]*[A-ZÀ-ÖØ-Þ])\s{2,}(\S.*)$/);
  if (m && hasTwoLetters(m[1])) out.push({ name: m[1], dir: '', rest: flat.slice(m[1].length).trim(), strong: false });
  return out.map(c => ({ ...c, name: c.name.replace(/[.,]+$/, '').replace(/\s+/g, ' ').trim() }))
    .filter(c => c.name && !NOT_NAMES.has(c.name) && !HEADING_RE.test(c.name) && c.name.split(' ').length <= 4);
}

function gutenbergToScript(raw) {
  let text = raw.replace(/\r/g, '');
  const start = text.search(/\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n/i);
  if (start >= 0) text = text.slice(text.indexOf('\n', start) + 1);
  const end = text.search(/\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG/i);
  if (end >= 0) text = text.slice(0, end);

  const pars = text.split(/\n[ \t]*\n+/).map(p => p.replace(/^\n+|\s+$/g, '')).filter(p => p.trim());

  // Learn the cast: names that open several speeches (or open one in the unmistakable "NAME." layout).
  const counts = new Map(), strong = new Set();
  for (const p of pars) {
    for (const c of nameCandidates(p)) {
      counts.set(c.name, (counts.get(c.name) || 0) + 1);
      if (c.strong) strong.add(c.name);
    }
  }
  const isCast = n => (counts.get(n) || 0) >= 2 || strong.has(n);

  // Does this edition put every stage direction in [brackets]? (Gutenberg's Shakespeare does.)
  const bracketStyle = pars.filter(p => /^\s*\[/.test(p)).length >= 20;

  const items = [];
  let pending = null; // a name that stood alone in its own paragraph, waiting for its speech
  for (const p of pars) {
    const first = p.trim().split('\n')[0].trim();
    if (HEADING_RE.test(first) && p.length < 300) {
      items.push({ kind: 'heading', text: tidy(p.replace(/\s*\n\s*/g, ' ')).replace(/--/g, ': ') });
      pending = null;
      continue;
    }
    const speaker = nameCandidates(p).filter(c => isCast(c.name)).sort((a, b) => b.name.length - a.name.length)[0];
    if (speaker) {
      const dir = speaker.dir ? `(${tidy(speaker.dir.slice(1, -1))}) ` : '';
      const words = tidy(speaker.rest.replace(LEAD_ITALIC_DIR, "[$1] ").replace(/\s*\n\s*/g, ' '));
      if (words) items.push({ kind: 'line', name: speaker.name, text: (dir + words).trim() });
      else pending = { name: speaker.name, dir };
      continue;
    }
    if (pending) {
      items.push({ kind: 'line', name: pending.name, text: (pending.dir + tidy(p.replace(LEAD_ITALIC_DIR, "[$1] ").replace(/\s*\n\s*/g, ' '))).trim() });
      pending = null;
      continue;
    }
    const last = items[items.length - 1];
    const flat = tidy(p.replace(/\s*\n\s*/g, ' '));
    // Indented verse or a song inside a speech belongs to that speech.
    if (last?.kind === 'line' && /^\s{3,}\S/.test(p)) { last.text += ' ' + flat; continue; }
    // Where directions are always [bracketed], plain text right after a speech (or after a direction
    // inside one, like "[Exit Messenger.]") is the same character still talking.
    const bracketed = /^\s*\[/.test(p);
    const speakerSoFar = [...items].reverse().find(i => i.kind !== 'direction');
    if (bracketStyle && !bracketed && !STAGE_WORDS.test(p.trim()) && speakerSoFar?.kind === 'line'
      && (last.kind === 'line' || last.bracketed)) {
      if (last.kind === 'line') last.text += ' ' + flat;
      else items.push({ kind: 'line', name: speakerSoFar.name, text: flat });
      continue;
    }
    const body = flat.replace(/^\((.*)\)$/, '$1').replace(/^\[\s*|\s*\]$/g, '');
    if (/[\p{L}\p{N}]/u.test(body)) items.push({ kind: 'direction', text: body, bracketed });
  }

  // Keep just the play: from the heading just before the first speech to the last speech
  // (dropping prefaces, cast lists, contents, afterwords and appendices).
  // The play proper starts where speeches come thick and fast (front matter can contain a stray "NAME:").
  // A cast list ("THE POPE: CARDINAL OF LORRAIN. THE EMPEROR...") is mostly capitalised names, not dialogue.
  const castLike = i => (i.text.match(/\b[A-Z][A-Z'-]{2,}\b/g) || []).length >= 4;
  const dense = k => items.slice(k, k + 10).filter(i => i.kind === 'line').length >= 6;
  const firstLine = items.findIndex((i, k) => i.kind === 'line' && !castLike(i) && dense(k));
  if (firstLine < 0) return '';
  // Start at the nearest act/scene heading before it, keeping the scene-setting directions in between.
  let from = firstLine;
  for (let k = firstLine - 1; k >= 0 && firstLine - k <= 8 && items[k].kind !== 'line'; k--) {
    if (items[k].kind !== 'heading') continue;
    from = k;
    if (/^(act|prologue|induction|(first|second|third|fourth|fifth) act)\b/i.test(items[k].text)) break;
  }
  let to = items.length - 1;
  while (to > firstLine && items[to].kind !== 'line') to--;
  for (let k = to + 1; k < items.length && k <= to + 2; k++) if (items[k].kind === 'direction' && items[k].text.length < 120) to = k;

  return items.slice(from, to + 1).map(i => i.kind === 'heading' ? `# ${i.text}`
    : i.kind === 'direction' ? `(${i.text})`
    : `${i.name}: ${i.text}`).join('\n\n') + '\n';
}

if (typeof module !== 'undefined') module.exports = { gutenbergToScript };
