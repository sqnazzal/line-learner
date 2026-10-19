'use strict';

// Rehearsal plan: you give a script's opening night, the days and time you're free and how long a session can
// be, and it spreads rehearsals out until then. Early sessions learn one scene (with your lines) at a time,
// with drills of weak lines mixed in; then full run-throughs, more often as opening gets close, and a last
// run of just your cues and lines. Every session can be moved, deleted or ticked off, and finishing a run on
// a session's day ticks it off by itself. The plan is kept on the script, so it syncs with it.
//
// Reminders (optional, needs Google sign-in): each device that turns them on saves its push address in
// users/{uid}/meta/push, and the upcoming sessions are kept in reminders/{uid}_{id} (when, script title and
// what you're working on). The voices Worker checks every 5 minutes and sends the ones due, through sw.js.
// Loaded after groups.js and uses its Firebase helpers.

const PUSH_KEY = 'BI_uxonlbPLiYFSIqN8sq1G63IMDvWuulgNgdd3E-nFNc3Iqxgi1tiWmqpwVlRtq9PTQh8pZfwSVzFKLzdpPb24'; // public half of the VAPID key (the Worker holds the private half)
const LS_REMIND = 'lineLearner.reminders';
const DAY_MS = 24 * 60 * 60 * 1000;
const PLAN_MAX = 120;
const remind = { conf: loadJSON(LS_REMIND, { on: false, subId: '', sig: '' }), busy: false, syncing: false, again: false, checked: false, error: '' };
const planUi = { open: null, editing: false, showAll: false, draft: null, adding: null };
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const saveRemind = () => saveJSON(LS_REMIND, remind.conf);
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------- Making the plan ----------
// The scenes you're in, in order: [heading index, index after the scene, name, heading text]. A script without
// headings is one "scene". With separate act and scene headings, a scene's name includes its act
// ("Act 2, Scene 1"), so each act's Scene 1 is told apart.
function planScenes(s) {
  const heads = s.lines.map((l, i) => (l.type === 'section' ? i : -1)).filter(i => i >= 0);
  if (!heads.length) return [[0, s.lines.length, '', '']];
  let act = '';
  const seen = {};
  const all = heads.map((h, k) => {
    const text = s.lines[h].text;
    if (/^\s*act\b/i.test(text)) act = text;
    let name = act && !/\bact\b/i.test(text) ? `${act}, ${text}` : text;
    seen[name] = (seen[name] || 0) + 1;
    if (seen[name] > 1) name += ` (${seen[name]})`;
    return [h, heads[k + 1] ?? s.lines.length, name, text];
  });
  if (heads[0] > 0) all.unshift([0, heads[0], '', '']); // lines before the first heading
  const mine = all.filter(([a, z]) => s.lines.slice(a, z).some(l => isMine(s, l)));
  return mine.length ? mine : all;
}

// Plans made before scenes were named with their act stored just "Scene 1": the first such session gets the
// first Scene 1, the next one the second, and so on.
function fixSceneNames(s) {
  const all = planScenes(s), names = new Set(all.map(sc => sc[2])), used = {};
  for (const x of s.plan?.sessions || []) {
    if (x.kind !== 'learn' || !x.scenes || x.scenes.every(t => names.has(t))) continue;
    x.scenes = x.scenes.map(t => {
      if (names.has(t)) return t;
      const hits = all.filter(sc => sc[3] === t), k = used[t] = (used[t] ?? -1) + 1;
      return (hits[k] || hits[0])?.[2] ?? t;
    });
  }
}

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const atTime = (d, time) => { const [h, m] = time.split(':').map(Number); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h || 0, m || 0).getTime(); };

// Session times from now until the day before opening: every free day in the last two weeks, about three a
// week up to five weeks out, about two a week before that.
function planTimes(conf, skip) {
  const opening = new Date(conf.opening + 'T00:00').getTime();
  const today = new Date();
  const days = [];
  for (let d = new Date(today.getFullYear(), today.getMonth(), today.getDate()); d.getTime() < opening; d.setDate(d.getDate() + 1)) {
    const at = atTime(d, conf.time);
    if (at > Date.now() + 15 * 60 * 1000 && !skip.some(t => sameDay(t, at))) days.push([at, d.getDay()]);
  }
  let free = days.filter(([, wd]) => conf.days.includes(wd));
  if (!free.length) free = days; // no free day left before opening: use every day
  const out = [];
  let last = -Infinity;
  for (const [at] of free) {
    const left = (opening - at) / DAY_MS;
    const gap = left <= 14 ? 1 : left <= 35 ? 2 : 3;
    if ((at - last) / DAY_MS > gap - 0.5) { out.push(at); last = at; }
  }
  return out.slice(-PLAN_MAX);
}

// Builds (or rebuilds, keeping sessions already done) the plan's sessions.
function buildPlan(s, conf) {
  const keep = (s.plan?.sessions || []).filter(x => x.done);
  const learned = new Set(keep.filter(x => x.kind === 'learn').flatMap(x => x.scenes || []));
  const times = planTimes(conf, keep.map(x => x.at));
  const n = times.length;
  const kinds = [];
  if (n) {
    const rest = n - 1, runs = rest >= 3 ? Math.max(1, Math.round(rest * 0.25)) : 0, learnPart = rest - runs;
    const todo = planScenes(s).map(sc => sc[2]).filter(t => !learned.has(t));
    if (!todo.length) for (let k = 0; k < learnPart; k++) kinds.push({ kind: k % 2 ? 'run' : 'drill' });
    else if (learnPart >= todo.length) {
      let extra = learnPart - todo.length;
      todo.forEach((t, k) => {
        kinds.push({ kind: 'learn', scenes: [t] });
        if (extra && k % 2 === 1) { kinds.push({ kind: 'drill' }); extra--; }
      });
      for (let k = 0; k < extra; k++) kinds.push({ kind: k % 2 ? 'run' : 'drill' });
    } else if (learnPart) {
      const per = Math.ceil(todo.length / learnPart);
      for (let k = 0; k < todo.length; k += per) kinds.push({ kind: 'learn', scenes: todo.slice(k, k + per) });
    }
    for (let k = 0; k < runs; k++) kinds.push({ kind: 'run' });
    kinds.push({ kind: 'final' });
  }
  // Full runs take as long as the show; the last, cues-only run about half that.
  const runMin = conf.runMin || conf.min;
  const minFor = kind => (kind === 'run' ? runMin : kind === 'final' ? Math.max(conf.min, Math.round(runMin / 10) * 5) : conf.min);
  const made = times.map((at, k) => ({ id: uid().slice(-8), at, min: minFor(kinds[k]?.kind), ...kinds[k] }));
  return { ...conf, lead: s.plan?.lead ?? 15, sessions: [...keep, ...made].sort((a, b) => a.at - b.at) };
}

// ---------- Describing a session ----------
const scenesLabel = sc => (!sc?.length || !sc[0] ? 'your lines' : sc.length === 1 ? sc[0] : `${sc[0]} to ${sc[sc.length - 1]}`);
function sessionLabel(x) {
  if (x.kind === 'learn') return `Learn ${scenesLabel(x.scenes)}`;
  if (x.kind === 'drill') return 'Drill weak lines';
  if (x.kind === 'run') return 'Full run-through';
  if (x.kind === 'final') return 'Last run: just your cues and lines';
  return 'Rehearse';
}
const SESSION_HOW = {
  learn: 'Listen to it once, then rehearse it until it sticks.',
  drill: 'Work on the lines that are still shaky, or rehearse what you have so far.',
  run: 'Rehearse the whole thing, start to finish.',
  final: 'A light, confident pass before opening.',
};
const clock = at => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
function whenText(at) {
  const d = new Date(at), today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const day = sameDay(d, today) ? 'Today' : sameDay(d, tomorrow) ? 'Tomorrow'
    : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day}, ${clock(at)}`;
}
const localInput = at => { const d = new Date(at); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const planScripts = () => scripts.filter(s => s.plan && !s.sample && catOf(s) !== 'past');
const planOf = id => scripts.find(x => x.id === id);
const missed = x => !x.done && x.at < Date.now() && !sameDay(x.at, Date.now());

// The next session not done yet (today's count even if their time has passed), across all your scripts.
function nextSession() {
  const start = new Date().setHours(0, 0, 0, 0);
  let best = null;
  for (const s of planScripts()) for (const x of s.plan.sessions) if (!x.done && x.at >= start && (!best || x.at < best.x.at)) best = { s, x };
  return best;
}

// ---------- Home screen: the next rehearsal ----------
// The part of the script a session rehearses: its scenes for a Learn session, otherwise the whole script.
function sessionRange(s, x) {
  const scenes = x.kind === 'learn' ? planScenes(s).filter(sc => x.scenes?.includes(sc[2])) : [];
  return scenes.length ? [scenes[0][0], scenes[scenes.length - 1][1]] : [0, s.lines.length];
}

// How far into a session you got once you've started it: where Rehearse stopped (on this device) if it kept a place.
// A Rehearse run of the script in the last two days counts toward its next session too, even if not started from the plan.
function sessionProgress(s, x) {
  if (x.done) return null;
  // Where you stopped: this device's saved place, or the one synced with the plan from another device, whichever is newer.
  const here = resumeAt[s.id]?.mode === 'rehearse' ? resumeAt[s.id] : null;
  const r = [here, x.progress].filter(Boolean).sort((p, q) => q.at - p.at)[0] || null;
  const first = s.plan.sessions.find(y => !y.done) === x;
  const started = x.started || (first && r && r.at > Date.now() - 2 * DAY_MS ? r.at : 0);
  if (!started) return null;
  const [a, z] = sessionRange(s, x);
  return r && r.at >= started && x.kind !== 'drill' && r.line >= a && r.line < z ? r : { started };
}
const progressNote = p => (p.total ? `${Math.round(100 * p.pos / p.total)}% through: up to line ${p.pos} of ${p.total}` : 'Started, not finished yet');
// The home screen's Continue card steps aside when it would only repeat the rehearsal in progress.
window.planInProgress = id => { const n = nextSession(); return !!(n && n.s.id === id && sessionProgress(n.s, n.x)); };

function sessionButtons(s, x, p, startLabel) {
  return p
    ? `<div class="row wrap"><button class="btn primary" data-action="plan-start" data-sid="${s.id}" data-id="${x.id}" data-resume="1">${icon('play')} Pick up</button><button class="btn ghost" data-action="plan-start" data-sid="${s.id}" data-id="${x.id}">Start over</button></div>`
    : `<div><button class="btn primary" data-action="plan-start" data-sid="${s.id}" data-id="${x.id}">${icon('play')} ${startLabel}</button></div>`;
}

function nextRehearsalHtml() {
  const n = nextSession();
  if (n) fixSceneNames(n.s);
  if (!n) return '';
  const p = sessionProgress(n.s, n.x);
  return `<div class="card stack-sm">
    <span><b>${p ? 'Rehearsal in progress' : 'Next rehearsal'}: ${esc(n.s.title)}</b> <span class="muted">${esc(whenText(n.x.at))} · ${esc(sessionLabel(n.x))} · ${n.x.min} min</span></span>
    ${p ? (p.total ? `<div class="meter">${bar(p.pos / p.total)}<span class="muted small">This session: ${progressNote(p)}</span></div>` : '<span class="muted small">This session: started, not finished yet</span>') : ''}
    ${(() => {
      const all = n.s.plan.sessions, done = all.filter(x => x.done).length;
      return `<div class="meter">${bar(done / all.length)}<span class="muted small">Plan: ${done} of ${all.length} sessions done</span></div>`;
    })()}
    ${sessionButtons(n.s, n.x, p, 'Start')}
  </div>`;
}

// ---------- The plan card on a script ----------
function planDraft(s) {
  if (planUi.draft?.sid === s.id) return planUi.draft;
  const p = s.plan;
  return planUi.draft = { sid: s.id, opening: p?.opening || '', time: p?.time || '19:00', min: p?.min || 30, runMin: p?.runMin || runEstimate(s), days: p?.days || [1, 2, 3, 4, 5] };
}

const MINUTES = [15, 20, 30, 45, 60, 75, 90, 120, 150, 180];
const minuteOptions = sel => [...new Set([...MINUTES, +sel])].sort((a, b) => a - b).map(m => `<option value="${m}" ${m === +sel ? 'selected' : ''}>${m} minutes</option>`).join('');
// A first guess at a full run: the words of the whole script at about 130 a minute, to the nearest 15 minutes.
function runEstimate(s) {
  const n = s.lines.reduce((sum, l) => sum + (l.type === 'line' ? words(l.text).length : 0), 0);
  return clamp(Math.round(n / 130 / 15) * 15, 15, 180);
}

function planFormHtml(s) {
  const d = planDraft(s);
  const tomorrow = new Date(Date.now() + DAY_MS).toLocaleDateString('en-CA');
  return `<p class="muted small">Tell me when you open and when you're free, and I'll spread rehearsals out until then: each scene you're in first, with drills of your shaky lines, then full run-throughs, more often as opening gets close. You can move, add or delete any session after.</p>
    <div class="row wrap">
      <label class="field inline"><span>Opening night</span><input type="date" id="plan-opening" min="${tomorrow}" value="${esc(d.opening)}"></label>
      <label class="field inline"><span>Usual time</span><input type="time" id="plan-time" step="300" value="${esc(d.time)}"></label>
      <label class="field inline"><span>Each session</span><select id="plan-min">${minuteOptions(d.min)}</select></label>
      <label class="field inline"><span>A full run-through</span><select id="plan-run-min">${minuteOptions(d.runMin)}</select></label>
    </div>
    <fieldset class="plan-days"><legend>Days I can rehearse</legend>
      ${DAY_NAMES.map((n, k) => `<label class="check-row"><input type="checkbox" data-plan-day="${k}" ${d.days.includes(k) ? 'checked' : ''}><span>${n}</span></label>`).join('')}
    </fieldset>
    <div class="row wrap"><button class="btn primary" data-action="plan-make">${s.plan ? 'Make a new plan' : 'Make my plan'}</button>${s.plan ? '<button class="btn ghost" data-action="plan-cancel">Cancel</button>' : ''}</div>
    ${s.plan ? '<p class="muted small">A new plan keeps the sessions you\'ve already done.</p>' : ''}`;
}

function sessionRowHtml(s, x) {
  const state = x.done ? 'done' : missed(x) ? 'missed' : '';
  return `<li class="plan-row${state ? ' ' + state : ''}">
    <div class="plan-what"><b>${esc(sessionLabel(x))}</b> <span class="muted small">${esc(whenText(x.at))} · ${x.min} min${x.done ? ' · done' : state === 'missed' ? ' · missed' : ''}</span></div>
    <div class="tools">
      ${x.done ? '' : `<button class="icon-btn" data-action="plan-change" data-id="${x.id}" title="Change this session" aria-label="Change this session">${icon('edit')}</button>`}
      ${x.done ? '' : `<button class="icon-btn" data-action="plan-start" data-sid="${s.id}" data-id="${x.id}" title="Start this session" aria-label="Start this session">${icon('play')}</button>`}
      <button class="icon-btn${x.done ? ' on' : ''}" data-action="plan-done" data-id="${x.id}" title="${x.done ? 'Not done after all' : 'Mark done'}" aria-label="${x.done ? 'Mark not done' : 'Mark done'}" aria-pressed="${!!x.done}">${icon('check')}</button>
      <button class="icon-btn" data-action="plan-del" data-id="${x.id}" title="Delete this session" aria-label="Delete this session">${icon('trash')}</button>
    </div>
  </li>`;
}

function remindHtml(s) {
  const lead = s.plan.lead ?? 15;
  let body;
  if (!pushSupported()) {
    body = IS_IOS
      ? 'To get reminders on iPhone or iPad, open Line Learner from its Home Screen icon (iOS 16.4 or later).'
      : "This browser can't show reminders. Chrome, Edge, Firefox and Safari can.";
    body = `<p class="muted small">${body}</p>`;
  } else if (!fb.user) {
    if (!fb.api) loadGroups();
    body = `<p class="muted small">Sign in with Google to get a notification before each session, on this device and any other you turn them on for.</p>
      <div><button class="btn" data-action="group-signin"${fb.api ? '' : ' disabled'}>Sign in with Google</button></div>`;
  } else if (Notification.permission === 'denied') {
    body = `<p class="note small">Notifications are blocked for Line Learner. ${IS_IOS ? 'Allow them in the Settings app > Notifications > Line Learner' : 'Allow them in your browser\'s site settings (the icon beside the address)'}, then come back here.</p>`;
  } else if (remind.conf.on && Notification.permission === 'granted') {
    body = `<p class="small">${icon('check')} Reminders are on for this device.</p>
      <div class="row wrap">
        <label class="field inline"><span>Remind me</span><select id="plan-lead">${[[0, 'when it starts'], [15, '15 minutes before'], [60, '1 hour before']].map(([v, t]) => `<option value="${v}" ${v === lead ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <button class="btn ghost" data-action="remind-test">Send a test</button>
        <button class="btn ghost" data-action="remind-off">Turn off on this device</button>
      </div>`;
  } else {
    body = `<p class="muted small">Get a notification before each session${IS_IOS ? '' : ', even when Line Learner is closed'}. Turn them on on each device you want them on.</p>
      <div><button class="btn" data-action="remind-on"${remind.busy ? ' disabled' : ''}>Turn on reminders</button></div>`;
  }
  return `<div class="stack-sm plan-remind"><b>Reminders</b>${body}${remind.error ? `<p class="note small">${esc(remind.error)}</p>` : ''}</div>`;
}

// Adding a session, or changing one (a.id set).
function addFormHtml(s) {
  const a = planUi.adding;
  const kinds = [
    ...planScenes(s).map((sc, k) => [`learn:${k}`, `Learn ${scenesLabel([sc[2]])}`]),
    ['drill', 'Drill weak lines'], ['run', 'Full run-through'], ['final', 'Run just your cues and lines'],
  ];
  return `<div class="note stack-sm plan-add">
    <b>${a.id ? 'Change this session' : 'Add a session'}</b>
    <label class="field inline"><span>What</span><select id="plan-add-kind">${kinds.map(([v, t]) => `<option value="${v}" ${v === a.kind ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
    <label class="field inline"><span>When</span><input type="datetime-local" id="plan-add-at" value="${localInput(a.at)}"></label>
    <label class="field inline"><span>How long</span><select id="plan-add-min">${minuteOptions(a.min)}</select></label>
    <div class="row wrap"><button class="btn primary" data-action="plan-add-save">${a.id ? 'Save' : 'Add it'}</button><button class="btn ghost" data-action="plan-add-cancel">Cancel</button></div>
  </div>`;
}

// A plan counts as active until opening night has passed.
window.planActive = s => !!(s?.plan && !s.sample && new Date(s.plan.opening + 'T23:59') >= new Date());

function planCardHtml(s) {
  if (s.sample || s.kind === 'song') return '';
  if (s.plan) fixSceneNames(s);
  const p = s.plan;
  let inner;
  if (!s.myChar) inner = '<p class="muted">Pick who you\'re playing (under "I\'m playing" above) to make a rehearsal plan.</p>';
  else if (!p || planUi.editing) inner = planFormHtml(s);
  else {
    const all = p.sessions, done = all.filter(x => x.done).length;
    const ahead = all.filter(x => !x.done && !missed(x)), gone = all.filter(missed);
    const left = Math.round((new Date(p.opening + 'T00:00') - new Date().setHours(0, 0, 0, 0)) / DAY_MS);
    const shown = planUi.showAll ? all : ahead.slice(0, 6);
    const next = ahead[0], nextP = next && sessionProgress(s, next);
    inner = `<p>Opening night: <b>${esc(new Date(p.opening + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))}</b>${left > 0 ? ` <span class="muted">(in ${left} ${left === 1 ? 'day' : 'days'})</span>` : left === 0 ? ' <span class="muted">(today: break a leg!)</span>' : ''}</p>
      ${all.length ? `<div class="meter">${bar(done / all.length)}</div>` : ''}
      ${next ? `<div class="note stack-sm"><span><b>${nextP ? 'In progress' : 'Next'}: ${esc(whenText(next.at))}</b> · ${esc(sessionLabel(next))}, ${next.min} min</span><span class="small">${nextP ? progressNote(nextP) + '.' : SESSION_HOW[next.kind] || ''}</span>
        ${sessionButtons(s, next, nextP, 'Start now')}</div>` : left > 0 ? '<p class="muted small">No sessions left. Add one, or make a new plan.</p>' : ''}
      ${gone.length && left > 0 ? `<p class="note small row between wrap"><span>${gone.length} ${gone.length === 1 ? 'session was' : 'sessions were'} missed. Spread what's left over the days you have?</span><button class="btn" data-action="plan-replan">Re-plan from today</button></p>` : ''}
      <details class="plan-more"${planUi.listOpen || planUi.adding?.sid === s.id ? ' open' : ''}><summary>All sessions and reminders</summary><div class="stack-sm">
      ${shown.length ? `<ol class="plan-list">${shown.map(x => sessionRowHtml(s, x)).join('')}</ol>` : ''}
      <div class="row wrap">
        ${all.length > shown.length || planUi.showAll ? `<button class="btn ghost" data-action="plan-all">${planUi.showAll ? 'Show upcoming only' : `Show all ${all.length} sessions`}</button>` : ''}
        ${planUi.adding ? '' : '<button class="btn ghost" data-action="plan-add">+ Add a session</button>'}
        <button class="btn ghost" data-action="plan-edit">Change dates or days</button>
        <button class="btn ghost" data-action="plan-delete">Delete plan</button>
      </div>
      ${planUi.adding?.sid === s.id ? addFormHtml(s) : ''}
      ${remindHtml(s)}
      </div></details>`;
  }
  return `<details id="plan" class="card"${(planUi.open ?? !!p) ? ' open' : ''}>
    <summary>Rehearsal plan${p ? `: ${p.sessions.filter(x => x.done).length} of ${p.sessions.length} done` : ''}</summary>
    <div class="stack-sm">${inner}</div>
  </details>`;
}

// ---------- Changes ----------
function planChanged(s) {
  s.updated = Date.now();
  saveScripts();
  scheduleReminders();
  render();
}
const findSession = (s, id) => s?.plan?.sessions.find(x => x.id === id);

// Leaving a run (or the app) keeps the session's place with the plan, so your other devices show it too.
window.planSaveProgress = s => {
  const r = resumeAt[s?.id];
  if (!s?.plan || r?.mode !== 'rehearse') return;
  const a = planUi.active;
  const x = (a?.sid === s.id && findSession(s, a.id)) || s.plan.sessions.find(y => !y.done && sessionProgress(s, y));
  if (!x || x.done || x.progress?.at === r.at) return;
  const [from, to] = sessionRange(s, x);
  if (r.line < from || r.line >= to) return;
  x.progress = { line: r.line, pos: r.pos, total: r.total, at: r.at };
  s.updated = Date.now();
  saveScripts();
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && app.view === 'player') window.planSaveProgress(current()); });

// Finishing a run ticks off the session you started from the plan, or else today's session for this script.
window.planRunDone = s => {
  if (!s?.plan) return;
  const a = planUi.active;
  const x = (a?.sid === s.id && findSession(s, a.id)) || s.plan.sessions.find(y => !y.done && y.started)
    || s.plan.sessions.find(y => !y.done && sameDay(y.at, Date.now()));
  planUi.active = null;
  if (!x || x.done) return;
  x.done = Date.now();
  s.updated = Date.now();
  saveScripts();
  scheduleReminders();
  const n = s.plan.sessions.filter(y => y.done).length;
  toast(`Rehearsal done: ${n} of ${s.plan.sessions.length} for ${s.title}.`);
};

Object.assign(actions, {
  'plan-make'() {
    const s = current(), d = planDraft(s);
    if (!d.opening) { toast('When is opening night? Pick the date first.'); $('#plan-opening')?.focus(); return; }
    if (!d.days.length) { toast('Pick at least one day you can rehearse.'); return; }
    if (new Date(d.opening + 'T00:00') <= new Date()) { toast('Opening night needs to be after today.'); return; }
    s.plan = buildPlan(s, { opening: d.opening, time: d.time || '19:00', min: +d.min || 30, runMin: +d.runMin || +d.min || 30, days: d.days });
    planUi.editing = false;
    planUi.open = true;
    planChanged(s);
    const n = s.plan.sessions.filter(x => !x.done).length;
    toast(n ? `Planned ${n} ${n === 1 ? 'session' : 'sessions'} before opening night.` : 'No time left for sessions before opening night. Add one yourself if you can.');
  },
  'plan-replan'() {
    const s = current();
    s.plan = buildPlan(s, s.plan);
    planChanged(s);
    toast('Re-planned from today.');
  },
  'plan-edit'() { planUi.editing = true; planUi.draft = null; render(); },
  'plan-cancel'() { planUi.editing = false; render(); },
  'plan-all'() { planUi.showAll = !planUi.showAll; render(); },
  'plan-delete'() {
    const s = current();
    if (!confirm(`Delete the rehearsal plan for "${s.title}"? Your progress on the lines stays.`)) return;
    delete s.plan;
    planUi.draft = null;
    planChanged(s);
  },
  'plan-done'(b) {
    const s = current(), x = findSession(s, b.dataset.id);
    if (!x) return;
    if (x.done) delete x.done; else x.done = Date.now();
    planChanged(s);
  },
  'plan-del'(b) {
    const s = current();
    s.plan.sessions = s.plan.sessions.filter(x => x.id !== b.dataset.id);
    planChanged(s);
  },
  // Opens the Add a session form, set to the next day without a session, at the usual time.
  'plan-add'() {
    const s = current(), p = s.plan;
    let d = new Date(Date.now() + DAY_MS);
    while (p.sessions.some(x => sameDay(x.at, d)) && d < new Date(p.opening + 'T00:00')) d = new Date(d.getTime() + DAY_MS);
    planUi.adding = { sid: s.id, kind: 'run', at: atTime(d, p.time), min: p.min };
    render();
    $('#plan-add-kind')?.focus();
  },
  'plan-change'(b) {
    const s = current(), x = findSession(s, b.dataset.id);
    if (!x) return;
    const k = x.kind === 'learn' ? planScenes(s).findIndex(sc => x.scenes?.includes(sc[2])) : -1;
    planUi.adding = { sid: s.id, id: x.id, kind: x.kind === 'learn' ? `learn:${Math.max(0, k)}` : x.kind, at: x.at, min: x.min };
    render();
    $('.plan-add')?.scrollIntoView({ block: 'nearest' });
    $('#plan-add-kind')?.focus({ preventScroll: true });
  },
  'plan-add-cancel'() { planUi.adding = null; render(); },
  'plan-add-save'() {
    const s = current(), a = planUi.adding;
    if (!a || !s.plan || !a.at) return;
    const [kind, scene] = a.kind.split(':');
    const old = a.id && findSession(s, a.id);
    const x = old || { id: uid().slice(-8) };
    Object.assign(x, { at: a.at, min: a.min, kind });
    if (kind === 'learn') x.scenes = [planScenes(s)[+scene]?.[2] ?? '']; else delete x.scenes;
    if (!old) s.plan.sessions.push(x);
    s.plan.sessions.sort((p, q) => p.at - q.at);
    planUi.adding = null;
    planChanged(s);
    toast(`${old ? 'Changed' : 'Added'}: ${sessionLabel(x)}, ${whenText(x.at)}.`);
  },
  'plan-start'(b) {
    const s = planOf(b.dataset.sid), x = findSession(s, b.dataset.id);
    if (!s || !x) return;
    fixSceneNames(s);
    if (app.view !== 'script' || app.scriptId !== s.id) openScript(s.id);
    planUi.active = { sid: s.id, id: x.id };
    const resume = b.dataset.resume && sessionProgress(s, x);
    if (!x.started) { x.started = Date.now(); s.updated = Date.now(); }
    if (!resume) delete x.progress; // Start over
    [s.rangeStart, s.rangeEnd] = sessionRange(s, x);
    saveScripts();
    app.cuesOnly = x.kind === 'final';
    if (x.kind === 'drill' && weakCount(s)) actions.weak();
    else if (resume?.total) { const order = playOrder(s); startPlayer('rehearse', order, Math.max(0, order.indexOf(resume.line))); }
    else startPlayer('rehearse');
  },

  // Reminders
  async 'remind-on'() {
    const perm = await Notification.requestPermission(); // first thing in the tap, which iPhone needs
    if (perm !== 'granted') { toast(perm === 'denied' ? 'Notifications are blocked. Allow them in settings to get reminders.' : 'No reminders for now.'); render(); return; }
    remind.busy = true;
    remind.error = '';
    render();
    try {
      await subscribePush();
      remind.conf.on = true;
      remind.conf.sig = '';
      saveRemind();
      await syncReminders();
      toast('Reminders are on for this device.');
    } catch (e) {
      remind.error = "Couldn't turn on reminders here. Try again in a moment.";
      noteError('Reminders on: ' + (e?.name || '') + ' ' + (e?.message || e));
    } finally {
      remind.busy = false;
      render();
    }
  },
  async 'remind-off'() {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      await sub?.unsubscribe();
      if (remind.conf.subId) await fb.forgetPushSub(remind.conf.subId);
    } catch (e) { noteError('Reminders off: ' + (e?.message || e)); }
    Object.assign(remind.conf, { on: false, subId: '', sig: '' });
    saveRemind();
    syncReminders();
    toast('Reminders are off for this device.');
    render();
  },
  async 'remind-test'() {
    try {
      const r = await (await sharedFetch('/test-reminder', { now: true })).json();
      toast(r.ok ? 'Sent. It should pop up in a moment.' : r.reason || "That didn't go through. Turn reminders off and on again.");
    } catch (e) { toast(e.status ? e.message : "Couldn't reach the reminders server. Check your connection."); }
  },
});

document.addEventListener('change', e => {
  const s = app.view === 'script' ? current() : null;
  if (!s) return;
  const d = planUi.draft?.sid === s.id ? planUi.draft : null;
  if (d && e.target.id === 'plan-opening') d.opening = e.target.value;
  if (d && e.target.id === 'plan-time') d.time = e.target.value;
  if (d && e.target.id === 'plan-min') d.min = +e.target.value;
  if (d && e.target.id === 'plan-run-min') d.runMin = +e.target.value;
  if (d && e.target.dataset.planDay != null) {
    const k = +e.target.dataset.planDay;
    d.days = e.target.checked ? [...new Set([...d.days, k])].sort() : d.days.filter(x => x !== k);
  }
  const a = planUi.adding?.sid === s.id ? planUi.adding : null;
  if (a && e.target.id === 'plan-add-kind') a.kind = e.target.value;
  if (a && e.target.id === 'plan-add-at') a.at = new Date(e.target.value).getTime() || a.at;
  if (a && e.target.id === 'plan-add-min') a.min = +e.target.value;
  if (e.target.id === 'plan-lead' && s.plan) { s.plan.lead = +e.target.value; planChanged(s); }
});
document.addEventListener('toggle', e => {
  if (e.target.id === 'plan') planUi.open = e.target.open;
  if (e.target.classList?.contains('plan-more')) planUi.listOpen = e.target.open;
}, true);

// ---------- Push subscription ----------
const keyBytes = k => Uint8Array.from(atob(k.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(k.length / 4) * 4, '=')), c => c.charCodeAt(0));

async function subscribePush() {
  const reg = await navigator.serviceWorker.register('sw.js');
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && new Uint8Array(sub.options?.applicationServerKey || []).join() !== keyBytes(PUSH_KEY).join()) { await sub.unsubscribe(); sub = null; }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUSH_KEY) });
  const j = sub.toJSON();
  const id = 'd' + hash(j.endpoint);
  if (remind.conf.subId && remind.conf.subId !== id) await fb.forgetPushSub(remind.conf.subId).catch(() => {});
  await fb.savePushSub(id, { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, at: Date.now() });
  remind.conf.subId = id;
  saveRemind();
}

Object.assign(fb, {
  async pushSubCount() {
    const { F, db } = fb.api;
    const snap = await F.getDoc(F.doc(db, 'users', fb.user.uid, 'meta', 'push'));
    return snap.exists() ? Object.keys(snap.data().subs || {}).length : 0;
  },
  savePushSub(id, sub) {
    const { F, db } = fb.api;
    return F.setDoc(F.doc(db, 'users', fb.user.uid, 'meta', 'push'), { subs: { [id]: sub } }, { merge: true });
  },
  async forgetPushSub(id) {
    const { F, db } = fb.api;
    await F.updateDoc(F.doc(db, 'users', fb.user.uid, 'meta', 'push'), { [`subs.${id}`]: F.deleteField() }).catch(() => {});
  },
  async myReminders() {
    const { F, db } = fb.api;
    const snap = await F.getDocs(F.query(F.collection(db, 'reminders'), F.where('uid', '==', fb.user.uid)));
    return new Map(snap.docs.map(d => [d.id, d.data()]));
  },
  async writeReminders(put, drop) {
    const { F, db } = fb.api;
    const ops = [...put.map(([id, r]) => b => b.set(F.doc(db, 'reminders', id), r)), ...drop.map(id => b => b.delete(F.doc(db, 'reminders', id)))];
    for (let i = 0; i < ops.length; i += 400) {
      const batch = F.writeBatch(db);
      for (const op of ops.slice(i, i + 400)) op(batch);
      await batch.commit();
    }
  },
});

// ---------- Keeping the reminders server up to date ----------
// The next 60 sessions not done (from scripts not in Past), as the reminders the server should send.
function wantedReminders() {
  const out = [];
  for (const s of planScripts()) {
    const lead = s.plan.lead ?? 15;
    for (const x of s.plan.sessions) {
      const at = Math.round(x.at - lead * 60000);
      if (x.done || at < Date.now() + 60000) continue;
      const soon = lead === 60 ? 'In an hour' : lead ? `In ${lead} minutes` : 'Now';
      out.push([`${fb.user.uid}_${s.id}${x.id}`, {
        uid: fb.user.uid, at, url: s.id,
        title: `Rehearsal: ${s.title}`.slice(0, 200),
        body: `${soon}: ${sessionLabel(x)} (${x.min} min). Tap to start.`.slice(0, 300),
      }]);
    }
  }
  return out.sort((a, b) => a[1].at - b[1].at).slice(0, 60);
}

let remindTimer = 0;
function scheduleReminders() {
  clearTimeout(remindTimer);
  remindTimer = setTimeout(syncReminders, 3000);
}

// Writes the reminders that changed and removes ones no longer wanted. With no device signed up for
// reminders on this account, it removes them all, so nothing is kept that isn't needed.
async function syncReminders() {
  if (!fb.user || !fb.api) return;
  if (remind.syncing) { remind.again = true; return; }
  remind.syncing = true;
  try {
    // Once per visit: make sure this device's push address is still the one saved (they can change).
    if (remind.conf.on && !remind.checked && pushSupported() && Notification.permission === 'granted') {
      remind.checked = true;
      await subscribePush().catch(e => noteError('Reminders refresh: ' + (e?.message || e)));
    }
    if (remind.conf.on && Notification.permission !== 'granted' && pushSupported()) {
      if (remind.conf.subId) await fb.forgetPushSub(remind.conf.subId);
      Object.assign(remind.conf, { on: false, subId: '' });
      saveRemind();
    }
    const want = (await fb.pushSubCount()) ? wantedReminders() : [];
    const sig = hash(JSON.stringify(want));
    if (sig === remind.conf.sig) return;
    const have = await fb.myReminders();
    const wanted = new Set(want.map(([id]) => id));
    const put = want.filter(([id, r]) => !sameReminder(have.get(id), r));
    const drop = [...have.keys()].filter(id => !wanted.has(id));
    await fb.writeReminders(put, drop);
    remind.conf.sig = sig;
    saveRemind();
  } catch (e) {
    noteError('Reminders: ' + (e?.code || e?.message || e));
  } finally {
    remind.syncing = false;
    if (remind.again) { remind.again = false; scheduleReminders(); }
  }
}
const sameReminder = (a, b) => !!a && ['uid', 'at', 'url', 'title', 'body'].every(k => a[k] === b[k]);
window.syncReminders = syncReminders;

// ---------- Opening the app from a reminder ----------
function openFromReminder(id) {
  if (!planOf(id)) return;
  openScript(id);
  planUi.open = true;
  render();
}
navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.openScript != null) openFromReminder(e.data.openScript); });
(() => {
  const params = new URLSearchParams(location.search);
  const id = params.get('rehearse');
  if (id) {
    history.replaceState(null, '', location.pathname);
    openFromReminder(id);
  }
  if (remind.conf.on && pushSupported()) navigator.serviceWorker.register('sw.js').catch(() => {});
  for (const s of planScripts()) window.planSaveProgress(s); // a place saved on this device before progress synced
})();
