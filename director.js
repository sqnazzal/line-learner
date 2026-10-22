'use strict';

// Director's mode. A group's creator can make members directors. Directors see how the cast is doing on the
// group's scripts, and set at-home rehearsals (assignments) for everyone or for chosen people.
//
// Each member's progress is a small summary per shared script (their character; how many of their lines are
// solid, being worked on or new; when they last practiced; rehearsal plan sessions done), kept at
// groups/{gid}/progress/{their id}. It's only written for groups that have a director, and only that person and
// the group's directors can read it. Anyone can stop sharing theirs (optOut); their assignment ticks still show.
// Assignments are at groups/{gid}/assignments/{id}; members see theirs on the Group screen and the home screen.
// Loaded after plan.js and uses its helpers.

const LS_ASG_DONE = 'lineLearner.assignDone';
const LS_PROGRESS_SIG = 'lineLearner.progressSig';
const ASG_MODES = { rehearse: 'Rehearse', listen: 'Listen', drill: 'Drill weak lines', type: 'Type your lines' };
const dir = {
  asg: {}, unsub: {}, mine: {},     // gid -> assignments; their live listeners; gid -> your own progress doc
  done: loadJSON(LS_ASG_DONE, {}),   // assignment id -> when you finished it
  cast: {}, castLoading: {},         // gid -> everyone's progress docs (directors only)
  draft: null,                       // the assignment being written or changed
  sig: loadJSON(LS_PROGRESS_SIG, {}), timer: 0,
};
const isDirector = g => !!g && !!fb.user && (g.directors || []).includes(fb.user.uid);
const hasDirector = g => !!(g?.directors || []).length;

Object.assign(fb, {
  watchAssignments(gid, cb) {
    const { F, db } = fb.api;
    return F.onSnapshot(F.collection(db, 'groups', gid, 'assignments'), snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => cb([]));
  },
  saveAssignment(gid, a) {
    const { F, db } = fb.api;
    const { id, ...data } = a;
    return F.setDoc(id ? F.doc(db, 'groups', gid, 'assignments', id) : F.doc(F.collection(db, 'groups', gid, 'assignments')), data);
  },
  deleteAssignment(gid, id) {
    const { F, db } = fb.api;
    return F.deleteDoc(F.doc(db, 'groups', gid, 'assignments', id));
  },
  setDirectors(gid, list) {
    const { F, db } = fb.api;
    return F.updateDoc(F.doc(db, 'groups', gid), { directors: list });
  },
  async myProgress(gid) {
    const { F, db } = fb.api;
    const snap = await F.getDoc(F.doc(db, 'groups', gid, 'progress', fb.user.uid));
    return snap.exists() ? snap.data() : {};
  },
  // Writes just the named fields (each one replaced whole), keeping the rest of your progress document.
  saveProgress(gid, data, fields) {
    const { F, db } = fb.api;
    return F.setDoc(F.doc(db, 'groups', gid, 'progress', fb.user.uid), { uid: fb.user.uid, name: fb.user.name, ...data }, { mergeFields: ['uid', 'name', ...fields] });
  },
  unmarkAssignment(gid, id) {
    const { F, db } = fb.api;
    return F.updateDoc(F.doc(db, 'groups', gid, 'progress', fb.user.uid), { [`done.${id}`]: F.deleteField() });
  },
  async castProgress(gid) {
    const { F, db } = fb.api;
    return (await F.getDocs(F.collection(db, 'groups', gid, 'progress'))).docs.map(d => ({ id: d.id, ...d.data() }));
  },
  deleteProgress(gid, uid = fb.user.uid) {
    const { F, db } = fb.api;
    return F.deleteDoc(F.doc(db, 'groups', gid, 'progress', uid));
  },
});

// ---------- Keeping up with your groups ----------
// Called whenever your list of groups changes: listens for each group's assignments and refreshes your progress.
window.directorGroupsChanged = () => {
  const ids = new Set(grp.groups.map(g => g.id));
  for (const gid of Object.keys(dir.unsub)) if (!ids.has(gid)) { dir.unsub[gid](); delete dir.unsub[gid]; delete dir.asg[gid]; }
  for (const g of grp.groups) {
    if (dir.unsub[g.id]) continue;
    dir.unsub[g.id] = fb.watchAssignments(g.id, list => {
      dir.asg[g.id] = list;
      if (app.view === 'library' || app.view === 'group') render();
    });
    loadMine(g.id);
  }
  scheduleProgress();
};
// Signing out: stop listening and forget the last account's groups.
window.directorReset = () => {
  for (const off of Object.values(dir.unsub)) off();
  Object.assign(dir, { asg: {}, unsub: {}, mine: {}, cast: {}, castLoading: {}, draft: null });
};

// Your own progress document in a group: whether you've stopped sharing, and the assignments you've ticked
// (merged with this device's ticks, so another device's show here too).
async function loadMine(gid) {
  try {
    dir.mine[gid] = await fb.myProgress(gid);
    Object.assign(dir.done, dir.mine[gid].done || {});
    saveJSON(LS_ASG_DONE, dir.done);
    if (app.view === 'library' || app.view === 'group') render();
  } catch { dir.mine[gid] = dir.mine[gid] || null; }
}

// ---------- Sharing your progress ----------
function progressSummary(s) {
  const mine = s.myChar ? s.lines.filter(l => isMine(s, l)) : [];
  const plan = s.plan?.sessions || [];
  return {
    title: s.title.slice(0, 200), char: s.myChar ? titleCase(s.myChar).slice(0, 80) : '', mine: mine.length,
    solid: mine.filter(l => isSolid(s, l)).length, working: mine.filter(l => isWorking(s, l)).length,
    last: mine.reduce((t, l) => Math.max(t, statOf(s, l)?.at || 0), 0),
    planDone: plan.filter(x => x.done).length, planTotal: plan.length,
  };
}

// A few seconds after you practice: one write per group with a director, only when something changed.
function scheduleProgress() {
  clearTimeout(dir.timer);
  dir.timer = setTimeout(publishProgress, 4000);
}
window.scheduleProgress = scheduleProgress;

async function publishProgress() {
  if (!fb.user || !fb.api) return;
  for (const g of grp.groups) {
    if (!hasDirector(g)) continue;
    if (dir.mine[g.id] === undefined) await loadMine(g.id);
    if (!dir.mine[g.id] || dir.mine[g.id].optOut) continue;
    const items = {};
    for (const s of scripts) if (s.groupItem?.gid === g.id && s.kind !== 'song') items[s.groupItem.id] = progressSummary(s);
    const sig = `${fb.user.uid}:${JSON.stringify(items)}`;
    if (dir.sig[g.id] === sig) continue;
    try {
      await fb.saveProgress(g.id, { updated: Date.now(), items }, ['updated', 'items']);
      dir.sig[g.id] = sig;
      saveJSON(LS_PROGRESS_SIG, dir.sig);
    } catch { /* rules not published yet, or offline: try again next time */ }
  }
}

// ---------- Assignments ----------
const forMe = a => (a.for?.length ? a.for.includes(fb.user?.uid) : a.by !== fb.user?.uid);
const asgWhat = a => `${ASG_MODES[a.mode] || 'Rehearse'}: ${a.scene || 'the whole script'}`;
const dueDays = a => (a.due ? Math.round((new Date(a.due + 'T12:00') - new Date(todayStr() + 'T12:00')) / DAY_MS) : null);
function dueText(a) {
  const d = dueDays(a);
  if (d == null) return '';
  return d < 0 ? `Was due ${fmtDate(a.due)}` : d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : `Due ${fmtDate(a.due)}`;
}

// Yours across all your groups: not done first, soonest due first.
function myAssignments() {
  const out = [];
  for (const g of grp.groups) for (const a of dir.asg[g.id] || []) if (forMe(a)) out.push({ g, a });
  const due = x => x.a.due || '9999';
  return out.sort((x, y) => !!dir.done[x.a.id] - !!dir.done[y.a.id] || due(x).localeCompare(due(y)));
}

function asgButtons(g, a) {
  const done = dir.done[a.id];
  return `<div class="row wrap">
    ${done ? '' : `<button class="btn primary" data-action="asg-start" data-gid="${esc(g.id)}" data-id="${esc(a.id)}">${icon('play')} Start</button>`}
    <button class="btn ghost" data-action="asg-done" data-gid="${esc(g.id)}" data-id="${esc(a.id)}"${done ? '' : ' data-on="1"'}>${done ? 'Not done yet' : `${icon('check')} Mark done`}</button>
  </div>`;
}

// The home screen: the next thing your director asked for.
window.assignmentCardHtml = () => {
  if (!fb.user) return '';
  const open = myAssignments().filter(x => !dir.done[x.a.id]);
  if (!open.length) return '';
  const { g, a } = open[0], d = dueDays(a);
  return `<div class="card stack-sm asg-card">
    <span class="muted small">From your director${a.byName ? ` ${esc(a.byName)}` : ''} · ${esc(g.name)}</span>
    <b>${esc(asgWhat(a))} <span class="muted">of ${esc(a.itemTitle)}</span></b>
    ${a.due ? `<span class="small${d < 0 ? ' overdue' : ''}">${esc(dueText(a))}</span>` : ''}
    ${a.note ? `<p class="small asg-note">${esc(a.note)}</p>` : ''}
    ${asgButtons(g, a)}
    ${open.length > 1 ? `<button class="link-btn small" data-action="asg-all" data-gid="${esc(g.id)}">${open.length - 1} more from your director</button>` : ''}
  </div>`;
};

async function startAssignment(gid, id) {
  const a = (dir.asg[gid] || []).find(x => x.id === id);
  if (!a) return;
  let s = scripts.find(x => x.groupItem?.id === a.itemId || x.id === a.itemId);
  if (!s) {
    const item = await fb.getItem(gid, a.itemId).catch(() => null);
    if (!item) { toast("That script isn't shared in the group anymore. Ask your director."); return; }
    const was = grp.current;
    grp.current = gid;
    s = takeItem(item);
    grp.current = was;
    toast(`Added "${item.title}" to your scripts.`);
  }
  // The scene by its name (the same in everyone's copy), or the whole script.
  const sc = a.scene ? planScenes({ ...s, myChar: '' }).find(x => x[2] === a.scene) : null;
  if (a.scene && !sc) toast(`Couldn't find "${a.scene}" in your copy, so it's the whole script.`);
  [s.rangeStart, s.rangeEnd] = sc ? [sc[0], sc[1]] : [0, s.lines.length];
  saveScripts();
  openScript(s.id);
  app.cuesOnly = false;
  const drill = a.mode === 'drill' && s.myChar && weakCount(s);
  const ok = drill ? await startPlayer('rehearse', weakOrder(s), 0, true) : await startPlayer(a.mode === 'drill' ? 'rehearse' : a.mode || 'rehearse');
  if (ok) P.assignment = { gid, id };
  else if (!s.myChar) toast(`Pick who you're playing in "${s.title}", then tap Start on the home screen again.`);
}

async function markAssignment(gid, id, on) {
  if (on) dir.done[id] = Date.now();
  else delete dir.done[id];
  saveJSON(LS_ASG_DONE, dir.done);
  render();
  try {
    if (on) await fb.saveProgress(gid, { done: { [id]: dir.done[id] } }, [`done.${id}`]);
    else await fb.unmarkAssignment(gid, id);
  } catch { /* kept on this device; it'll show for the director once the rules are published */ }
}

// Finishing the run you started from an assignment ticks it off.
window.assignmentRunDone = ref => {
  if (!ref || dir.done[ref.id]) return;
  markAssignment(ref.gid, ref.id, true);
  toast('Nice work. Marked done for your director.');
};

// ---------- The Group screen ----------
// Everyone in a group with a director: what you've been asked to do, and what's shared about your practice.
// Directors also get the cast's progress and the assignments they've set.
window.directorSectionHtml = g => {
  if (!g) return '';
  const names = (g.directors || []).filter(id => (g.members || []).includes(id)).map(id => g.memberNames?.[id] || 'Someone');
  const mine = (dir.asg[g.id] || []).filter(forMe), sharing = !dir.mine[g.id]?.optOut;
  const asgList = mine.length ? `<ul class="lib-list">${mine.sort((x, y) => !!dir.done[x.id] - !!dir.done[y.id] || (x.due || '9').localeCompare(y.due || '9')).map(a => `<li class="card stack-sm${dir.done[a.id] ? ' asg-done' : ''}">
      <b>${esc(asgWhat(a))} <span class="muted">of ${esc(a.itemTitle)}</span>${dir.done[a.id] ? ' <span class="tag">Done</span>' : ''}</b>
      <span class="small${!dir.done[a.id] && dueDays(a) < 0 ? ' overdue' : ''}">${esc([dueText(a), a.byName && `from ${a.byName}`].filter(Boolean).join(' · '))}</span>
      ${a.note ? `<p class="small asg-note">${esc(a.note)}</p>` : ''}
      ${asgButtons(g, a)}</li>`).join('')}</ul>` : '';
  const member = hasDirector(g) ? `
    ${mine.length ? `<h2>From your director</h2>${asgList}` : ''}
    <p class="muted small">${names.length === 1 ? `${esc(names[0])} is this group's director` : `This group's directors are ${esc(names.join(', '))}`}${sharing
      ? ` and can see your progress on its scripts: your character, how many of your lines are solid, when you last practiced, and rehearsal plan sessions done (never your recordings or what you say). <button class="link-btn" data-action="progress-share" data-gid="${esc(g.id)}">Stop sharing my progress</button>`
      : `. You've stopped sharing your progress (they still see assignments you mark done). <button class="link-btn" data-action="progress-share" data-gid="${esc(g.id)}" data-on="1">Share it again</button>`}</p>` : '';
  return `${isDirector(g) ? directorHtml(g) : ''}${member}`;
};

// For the group's creator: who directs. Shown in the group's card.
window.directorsManageHtml = g => {
  if (!g || g.ownerUid !== fb.user?.uid) {
    const names = (g?.directors || []).map(id => g.memberNames?.[id]).filter(Boolean);
    return names.length ? `<p class="small">Director${names.length > 1 ? 's' : ''}: ${esc(names.join(', '))}</p>` : '';
  }
  const members = (g.members || []).map(id => [id, g.memberNames?.[id] || 'Someone']).sort((a, b) => a[1].localeCompare(b[1]));
  const dirs = g.directors || [];
  return `<details class="directors-manage"${dir.manageOpen ? ' open' : ''}><summary class="small">Directors${dirs.length ? `: ${esc(dirs.map(id => g.memberNames?.[id] || 'Someone').join(', '))}` : ' (none yet)'}</summary>
    <p class="muted small">Directors see the cast's progress on this group's scripts and can set at-home rehearsals.</p>
    <div class="stack-sm">${members.map(([id, n]) => `<label class="check"><input type="checkbox" data-director="${esc(id)}"${dirs.includes(id) ? ' checked' : ''}><span>${esc(n)}${id === fb.user.uid ? ' (you)' : ''}</span></label>`).join('')}</div>
  </details>`;
};

function directorHtml(g) {
  if (!dir.cast[g.id] && !dir.castLoading[g.id]) loadCast(g.id);
  const cast = dir.cast[g.id], members = (g.members || []).map(id => ({ id, name: g.memberNames?.[id] || 'Someone' })).sort((a, b) => a.name.localeCompare(b.name));
  const docOf = id => cast?.find(d => d.id === id);
  const scriptsShared = grp.items.filter(it => it.kind !== 'song' && !it.removed);
  const all = (dir.asg[g.id] || []).slice().sort((x, y) => (x.due || '9').localeCompare(y.due || '9'));
  const asgRows = all.map(a => {
    const who = a.for?.length ? members.filter(m => a.for.includes(m.id)) : members.filter(m => m.id !== a.by);
    const done = who.filter(m => docOf(m.id)?.done?.[a.id] || (m.id === fb.user.uid && dir.done[a.id]));
    return `<li class="card stack-sm">
      <div class="row between wrap"><b>${esc(asgWhat(a))} <span class="muted">of ${esc(a.itemTitle)}</span></b>
        <span class="row"><button class="icon-btn" data-action="asg-edit" data-id="${esc(a.id)}" aria-label="Change this assignment" title="Change">${icon('edit')}</button>
        <button class="icon-btn" data-action="asg-delete" data-id="${esc(a.id)}" aria-label="Delete this assignment" title="Delete">${icon('trash')}</button></span></div>
      <span class="small${dueDays(a) < 0 ? ' overdue' : ''}">${esc([dueText(a), a.for?.length ? `For ${who.map(m => m.name).join(', ')}` : 'For everyone'].filter(Boolean).join(' · '))}</span>
      ${a.note ? `<p class="small asg-note">${esc(a.note)}</p>` : ''}
      <details><summary class="small">${cast ? `${done.length} of ${who.length} done` : 'Loading…'}</summary>
        <ul class="asg-who">${who.map(m => { const at = docOf(m.id)?.done?.[a.id]; return `<li>${at ? icon('check') : '<span class="dot" aria-hidden="true"></span>'} ${esc(m.name)} <span class="muted small">${at ? `done ${ago(at)}` : 'not yet'}</span></li>`; }).join('')}</ul></details>
    </li>`;
  }).join('');
  const progress = !cast ? '<p class="muted small">Loading the cast\'s progress…</p>' : scriptsShared.length ? scriptsShared.map(it => {
    const rows = members.map(m => {
      const d = docOf(m.id), p = d?.items?.[it.id];
      if (d?.optOut) return `<tr><th scope="row">${esc(m.name)}</th><td colspan="4" class="muted">Not sharing progress</td></tr>`;
      if (!p) return `<tr><th scope="row">${esc(m.name)}</th><td colspan="4" class="muted">Not added yet</td></tr>`;
      const pct = p.mine ? Math.round(100 * p.solid / p.mine) : 0;
      return `<tr><th scope="row">${esc(m.name)}</th><td>${esc(p.char || 'No character yet')}</td>
        <td><span class="cast-bar" aria-hidden="true"><span style="width:${pct}%"></span></span> ${p.mine ? `${p.solid} of ${p.mine} solid${p.working ? `, ${p.working} working on` : ''}` : ''}</td>
        <td>${p.last ? esc(ago(p.last)) : 'Not yet'}</td><td>${p.planTotal ? `${p.planDone} of ${p.planTotal}` : ''}</td></tr>`;
    }).join('');
    return `<h3>${esc(it.title)}</h3><div class="table-scroll" tabindex="0" role="region" aria-label="Cast progress on ${esc(it.title)}"><table class="report-table cast-table">
      <thead><tr><th scope="col">Cast member</th><th scope="col">Playing</th><th scope="col">Lines</th><th scope="col">Last practiced</th><th scope="col">Plan sessions</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }).join('') : '<p class="muted small">Share a script to the group to see the cast\'s progress on it.</p>';
  return `<div class="card stack director">
    <div class="row between wrap"><h2>Director</h2><button class="link-btn small" data-action="cast-refresh" data-gid="${esc(g.id)}">Refresh</button></div>
    <h3>At-home rehearsals</h3>
    ${dir.draft?.gid === g.id ? asgFormHtml(g, scriptsShared, members) : `<div><button class="btn" data-action="asg-new"${scriptsShared.length ? '' : ' disabled'}>+ New at-home rehearsal</button>${scriptsShared.length ? '' : ' <span class="muted small">Share a script to the group first.</span>'}</div>`}
    ${asgRows ? `<ul class="lib-list">${asgRows}</ul>` : '<p class="muted small">None set yet. Each one shows on the cast\'s home screen with a Start button that opens the right scene.</p>'}
    <h3>Cast progress</h3>
    ${progress}
    <p class="muted small">Progress comes from each person's own app (it updates a few seconds after they practice, while signed in). People who stop sharing show as "Not sharing progress".</p>
  </div>`;
}

async function loadCast(gid) {
  dir.castLoading[gid] = true;
  try { dir.cast[gid] = await fb.castProgress(gid); } catch { dir.cast[gid] = []; toast("Couldn't load the cast's progress. Is the latest firestore.rules published?"); }
  dir.castLoading[gid] = false;
  if (app.view === 'group') render();
}

// The new (or changed) assignment form.
function asgFormHtml(g, items, members) {
  const d = dir.draft, item = items.find(it => it.id === d.itemId) || items[0];
  const lines = item ? parseScript(item.raw || '') : [];
  const scenes = planScenes({ lines, myChar: '' }).filter(([a, z, n]) => n && lines.slice(a, z).some(l => l.type === 'line')).map(sc => sc[2]);
  return `<div class="card stack-sm asg-form">
    <b>${d.id ? 'Change this at-home rehearsal' : 'New at-home rehearsal'}</b>
    <label class="field"><span>Script</span><select id="asg-item">${items.map(it => `<option value="${esc(it.id)}"${it.id === item?.id ? ' selected' : ''}>${esc(it.title)}</option>`).join('')}</select></label>
    <label class="field"><span>Which part</span><select id="asg-scene"><option value="">The whole script</option>${scenes.map(n => `<option${n === d.scene ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
    <label class="field"><span>How</span><select id="asg-mode">${Object.entries(ASG_MODES).map(([k, v]) => `<option value="${k}"${k === d.mode ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="field"><span>Due</span><input id="asg-due" type="date" value="${esc(d.due || '')}" min="${todayStr()}"></label>
    <fieldset class="asg-for"><legend>For</legend>
      <label class="check"><input type="radio" name="asg-for" value="all"${d.everyone ? ' checked' : ''}><span>Everyone</span></label>
      <label class="check"><input type="radio" name="asg-for" value="some"${d.everyone ? '' : ' checked'}><span>Just these people</span></label>
      ${d.everyone ? '' : `<div class="asg-people">${members.map(m => `<label class="check"><input type="checkbox" data-asg-person="${esc(m.id)}"${d.for.includes(m.id) ? ' checked' : ''}><span>${esc(m.name)}</span></label>`).join('')}</div>`}
    </fieldset>
    <label class="field"><span>Note for the cast (optional)</span><textarea id="asg-note" rows="2" maxlength="500" placeholder="e.g. Off book for this scene by Thursday">${esc(d.note || '')}</textarea></label>
    <div class="row wrap"><button class="btn primary" data-action="asg-save">${d.id ? 'Save' : 'Send to the cast'}</button><button class="btn ghost" data-action="asg-cancel">Cancel</button></div>
  </div>`;
}

// Keeps what's typed in the form when it redraws (picking another script changes the list of scenes).
function readDraft() {
  const d = dir.draft;
  if (!d || !$('#asg-item')) return d;
  Object.assign(d, {
    itemId: $('#asg-item').value, scene: $('#asg-scene').value, mode: $('#asg-mode').value, due: $('#asg-due').value,
    note: $('#asg-note').value, everyone: $('input[name="asg-for"]:checked')?.value !== 'some',
  });
  if (!d.everyone) d.for = [...document.querySelectorAll('[data-asg-person]')].filter(c => c.checked).map(c => c.dataset.asgPerson);
  return d;
}

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'asg-item') { readDraft(); dir.draft.scene = ''; render(); }
  else if (t.name === 'asg-for') { readDraft(); render(); }
  else if (t.dataset?.director != null) {
    const g = currentGroup(), list = new Set(g.directors || []);
    t.checked ? list.add(t.dataset.director) : list.delete(t.dataset.director);
    dir.manageOpen = true;
    fb.setDirectors(g.id, [...list]).then(() => toast(t.checked ? 'Made a director.' : 'No longer a director.'), e2 => { t.checked = !t.checked; groupError(e2); });
  }
});

Object.assign(actions, {
  'asg-start'(b) { startAssignment(b.dataset.gid, b.dataset.id); },
  'asg-all'(b) { actions.group(); selectGroup(b.dataset.gid); render(); },
  'asg-done'(b) { markAssignment(b.dataset.gid, b.dataset.id, !!b.dataset.on); },
  'asg-new'() {
    const g = currentGroup();
    dir.draft = { gid: g.id, itemId: grp.items.find(it => it.kind !== 'song' && !it.removed)?.id || '', scene: '', mode: 'rehearse', due: '', note: '', everyone: true, for: [] };
    render();
    $('#asg-item')?.focus();
  },
  'asg-edit'(b) {
    const g = currentGroup(), a = (dir.asg[g.id] || []).find(x => x.id === b.dataset.id);
    if (!a) return;
    dir.draft = { gid: g.id, id: a.id, itemId: a.itemId, scene: a.scene || '', mode: a.mode, due: a.due || '', note: a.note || '', everyone: !a.for?.length, for: a.for || [], created: a.created };
    render();
    $('.asg-form')?.scrollIntoView({ block: 'center' });
  },
  'asg-cancel'() { dir.draft = null; render(); },
  async 'asg-save'() {
    const d = readDraft(), g = currentGroup(), item = grp.items.find(it => it.id === d.itemId);
    if (!item) { toast('Pick a script.'); return; }
    if (!d.everyone && !d.for.length) { toast('Pick at least one person, or choose Everyone.'); return; }
    const a = {
      id: d.id, itemId: item.id, itemTitle: item.title.slice(0, 300), scene: d.scene || '', mode: d.mode, due: d.due || '', note: (d.note || '').trim().slice(0, 500),
      for: d.everyone ? [] : d.for, by: fb.user.uid, byName: fb.user.name.slice(0, 100), created: d.created || Date.now(), updated: Date.now(),
    };
    try {
      await fb.saveAssignment(g.id, a);
      dir.draft = null;
      toast(d.id ? 'Changed.' : 'Sent. It shows on the cast\'s home screen.');
      render();
    } catch (e) { groupError(e); }
  },
  async 'asg-delete'(b) {
    const g = currentGroup();
    if (!confirm('Delete this at-home rehearsal? It disappears for the cast too.')) return;
    try { await fb.deleteAssignment(g.id, b.dataset.id); } catch (e) { groupError(e); }
  },
  'cast-refresh'(b) { delete dir.cast[b.dataset.gid]; render(); },
  async 'progress-share'(b) {
    const gid = b.dataset.gid, on = !!b.dataset.on;
    if (!on && !confirm('Stop sharing your progress with the director? They\'ll still see assignments you mark done.')) return;
    try {
      await fb.saveProgress(gid, { optOut: !on, items: {}, updated: Date.now() }, ['optOut', 'items', 'updated']);
      dir.mine[gid] = { ...dir.mine[gid], optOut: !on };
      delete dir.sig[gid];
      if (on) scheduleProgress();
      toast(on ? 'Sharing your progress again.' : 'Stopped sharing your progress.');
      render();
    } catch (e) { groupError(e); }
  },
});
