'use strict';

// Admin: lets the app's owner (ADMIN_UID) see who uses the app and manage people and groups: remove from
// groups, block, reset a shared-voices allowance, delete synced scripts, delete shared items and groups.
// The Firebase security rules (firestore.rules) and the voices server enforce these powers; this screen is
// only the controls. Deleting a sign-in account itself happens in the Firebase console.
// Loaded after groups.js and uses its helpers.

const ADMIN_UID = 'tEUc6ZFsyENufRbOSoVtCaF7sV62'; // Shannon's account ID (Group screen > Account ID); must match isAdmin() in firestore.rules
const FIREBASE_USERS_URL = 'https://console.firebase.google.com/project/line-learner-45bd1/authentication/users';
const isAdmin = () => !!ADMIN_UID && fb.user?.uid === ADMIN_UID;

Object.assign(fb, {
  // Everyone's own profile (name, email, last seen), written when they sign in.
  saveProfile() {
    const { F, db } = fb.api;
    return F.setDoc(F.doc(db, 'profiles', fb.user.uid), { name: fb.user.name, email: fb.user.email, lastSeen: Date.now() }, { merge: true })
      .then(() => fb.logUse({ open: 1 }));
  },
  // Today's use, kept on your own profile for Admin > Reports: counts only (app opens, practice runs by
  // mode, minutes practiced), never what was practiced.
  logUse(counts) {
    if (!fb.user || !fb.api) return null;
    const { F, db } = fb.api, up = {};
    for (const [k, n] of Object.entries(counts)) if (n) up[`days.${dayKey(isoDay(new Date()))}.${k}`] = F.increment(n);
    return Object.keys(up).length ? F.updateDoc(F.doc(db, 'profiles', fb.user.uid), up).catch(() => {}) : null;
  },
  // Send feedback (anyone, signed in or not). Only the admin can read the inbox.
  async sendFeedback(note) {
    await fb.load();
    const { F, db } = fb.api;
    const ref = await F.addDoc(F.collection(db, 'feedback'), { ...note, at: Date.now(), ...(fb.user ? { uid: fb.user.uid, name: fb.user.name } : {}) });
    // Asks the voices server to email Shannon about it. Best effort: the note is saved either way.
    if (SHARED_VOICES_URL) {
      fetch(`${SHARED_VOICES_URL}/notify-feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ref.id }) }).catch(() => {});
    }
    return ref;
  },
  async adminFeedback() {
    const { F, db } = fb.api;
    return (await F.getDocs(F.collection(db, 'feedback'))).docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.at - a.at);
  },
  adminDeleteFeedback(id) {
    const { F, db } = fb.api;
    return F.deleteDoc(F.doc(db, 'feedback', id));
  },
  async adminLoad() {
    const { F, db } = fb.api;
    const [profiles, groups, blocked] = await Promise.all(['profiles', 'groups', 'blocked'].map(c => F.getDocs(F.collection(db, c))));
    const all = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return { profiles: all(profiles), groups: all(groups), blocked: new Set(blocked.docs.map(d => d.id)) };
  },
  async adminItems(gid) {
    const { F, db } = fb.api;
    return (await F.getDocs(F.collection(db, 'groups', gid, 'items'))).docs.map(d => ({ id: d.id, ...d.data() }));
  },
  adminRemoveMember(gid, uid) {
    const { F, db } = fb.api;
    return F.updateDoc(F.doc(db, 'groups', gid), { members: F.arrayRemove(uid) });
  },
  adminDeleteItem(gid, id) {
    const { F, db } = fb.api;
    return F.deleteDoc(F.doc(db, 'groups', gid, 'items', id));
  },
  // Brings back something its sharer unshared.
  adminRestoreItem(gid, id) {
    const { F, db } = fb.api;
    return F.updateDoc(F.doc(db, 'groups', gid, 'items', id), { removed: F.deleteField() });
  },
  // Puts back the version before the last update (and keeps the undone one, so it can be swapped back).
  adminUndoItem(gid, it) {
    const { F, db } = fb.api;
    return F.updateDoc(F.doc(db, 'groups', gid, 'items', it.id), {
      raw: it.prevRaw, title: it.prevTitle || it.title, updated: Date.now(), prevRaw: it.raw, prevTitle: it.title, prevUpdated: it.updated || 0,
    });
  },
  async adminDeleteGroup(g) {
    const { F, db } = fb.api;
    for (const it of await fb.adminItems(g.id)) await F.deleteDoc(F.doc(db, 'groups', g.id, 'items', it.id));
    for (const sub of ['assignments', 'progress']) { // director's mode (director.js)
      for (const d of (await F.getDocs(F.collection(db, 'groups', g.id, sub))).docs) await F.deleteDoc(d.ref);
    }
    if (g.inviteCode) await F.deleteDoc(F.doc(db, 'invites', g.inviteCode)).catch(() => {});
    await F.deleteDoc(F.doc(db, 'groups', g.id));
  },
  adminBlock(uid, on) {
    const { F, db } = fb.api;
    return on ? F.setDoc(F.doc(db, 'blocked', uid), { at: Date.now(), by: fb.user.uid }) : F.deleteDoc(F.doc(db, 'blocked', uid));
  },
  adminDeleteProfile(uid) {
    const { F, db } = fb.api;
    return F.deleteDoc(F.doc(db, 'profiles', uid));
  },
  async adminDeleteSynced(uid) {
    const { F, db } = fb.api;
    const snap = await F.getDocs(F.collection(db, 'users', uid, 'scripts'));
    for (const d of snap.docs) await F.deleteDoc(d.ref);
    await F.deleteDoc(F.doc(db, 'users', uid, 'meta', 'deleted')).catch(() => {});
    const recs = await F.getDocs(F.collection(db, 'users', uid, 'recordings'));
    for (const d of recs.docs) await F.deleteDoc(d.ref);
    await F.deleteDoc(F.doc(db, 'users', uid, 'meta', 'recordings')).catch(() => {});
    await F.deleteDoc(F.doc(db, 'users', uid, 'meta', 'push')).catch(() => {});
    const rems = await F.getDocs(F.query(F.collection(db, 'reminders'), F.where('uid', '==', uid)));
    for (const d of rems.docs) await F.deleteDoc(d.ref);
    return snap.size;
  },
});

// ---------- The voices server's admin side (allowances) ----------
async function voicesAdmin(path, body) {
  if (!SHARED_VOICES_URL) return null;
  return (await sharedFetch(path, body)).json();
}

// ---------- Screen ----------
const adm = {
  data: null, usage: {}, loading: false, error: '', open: null, items: {}, sort: loadJSON('lineLearner.peopleSort', 'recent'),
  filter: loadJSON('lineLearner.peopleFilter', 'all'), search: '', expanded: new Set(), // People: which ones, and which are opened up
};
document.addEventListener('change', e => {
  if (e.target.id === 'people-sort') { adm.sort = e.target.value; saveJSON('lineLearner.peopleSort', adm.sort); render(); }
  if (e.target.id === 'people-filter') { adm.filter = e.target.value; saveJSON('lineLearner.peopleFilter', adm.filter); render(); }
});
// Search narrows the list as you type, without redrawing the screen.
document.addEventListener('input', e => {
  if (e.target.id !== 'people-search') return;
  adm.search = e.target.value;
  const q = adm.search.trim().toLowerCase();
  let n = 0;
  document.querySelectorAll('.people-list > li[data-find]').forEach(li => { li.hidden = !!q && !li.dataset.find.includes(q); n += !li.hidden; });
  const c = $('#people-count');
  if (c) c.textContent = peopleCount(n, Number(c.dataset.total));
});
document.addEventListener('toggle', e => {
  const uid = e.target.dataset?.person;
  if (uid != null) e.target.open ? adm.expanded.add(uid) : adm.expanded.delete(uid);
}, true);
const peopleCount = (n, total) => (n === total ? `${total} ${total === 1 ? 'person' : 'people'}` : `Showing ${n} of ${total}`);

async function loadAdmin() {
  if (adm.loading) return;
  adm.loading = true;
  adm.error = '';
  try {
    adm.data = await fb.adminLoad();
    adm.feedback = await fb.adminFeedback().catch(() => null); // null until the rules with 'feedback' are published
    adm.usage = {};
    try { for (const row of (await voicesAdmin('/admin/usage'))?.rows || []) adm.usage[row.uid] = row.usd; } catch { /* server not updated yet */ }
    // Every Google sign-in, from the voices server (null until it's set up for that).
    adm.accounts = null;
    try { adm.accounts = (await voicesAdmin('/admin/users'))?.users || null; } catch { /* server not updated yet */ }
  } catch (e) {
    adm.error = String(e?.code || '').includes('permission')
      ? 'Firebase refused: publish the latest firestore.rules (with your account ID as admin).'
      : "Couldn't load. Check your connection and try again.";
  }
  adm.loading = false;
  if (app.view === 'admin' || app.view === 'report') render();
}

// Profiles (written when someone opens the app signed in) plus every Google sign-in the server knows of,
// most recently active first.
function allPeople() {
  const byId = new Map(adm.data.profiles.map(p => [p.id, { ...p }]));
  for (const a of adm.accounts || []) {
    const p = byId.get(a.uid);
    if (p) p.lastSignIn = a.lastSignIn;
    else byId.set(a.uid, { id: a.uid, name: a.name, email: a.email, lastSignIn: a.lastSignIn });
  }
  return [...byId.values()];
}

// How the People list is ordered (remembered on this device).
const PEOPLE_SORTS = { recent: 'Most recently active', name: 'Name (A to Z)', email: 'Email', groups: 'Most groups', voices: 'Most shared voices use', blocked: 'Blocked first' };
function sortPeople(list, groupsOf) {
  const active = p => Math.max(p.lastSeen || 0, p.lastSignIn || 0);
  const by = {
    recent: (a, b) => active(b) - active(a),
    name: (a, b) => (a.name || '~').localeCompare(b.name || '~'),
    email: (a, b) => (a.email || '~').localeCompare(b.email || '~'),
    groups: (a, b) => groupsOf(b.id).length - groupsOf(a.id).length,
    voices: (a, b) => (adm.usage[b.id] || 0) - (adm.usage[a.id] || 0),
    blocked: (a, b) => adm.data.blocked.has(b.id) - adm.data.blocked.has(a.id),
  }[adm.sort] || ((a, b) => active(b) - active(a));
  return list.sort((a, b) => by(a, b) || active(b) - active(a));
}

// Which people the list shows (remembered on this device). Each group is a filter too.
const PEOPLE_FILTERS = {
  all: 'Everyone', week: 'Active in the last 7 days', month: 'Active in the last 30 days', quiet: 'Not active for 30+ days',
  new: 'Signed up in the last 30 days', grouped: 'In a group', solo: 'Not in any group', voices: 'Used shared voices this month', blocked: 'Blocked',
};
function peopleFilter(groupsOf) {
  const active = p => Math.max(p.lastSeen || 0, p.lastSignIn || 0), since = days => Date.now() - days * DAY_MS;
  const created = p => adm.accounts?.find(a => a.uid === p.id)?.created || 0;
  if (adm.filter.startsWith('g:')) return p => groupsOf(p.id).some(g => g.id === adm.filter.slice(2));
  return {
    week: p => active(p) >= since(7), month: p => active(p) >= since(30), quiet: p => active(p) < since(30),
    new: p => created(p) >= since(30), grouped: p => groupsOf(p.id).length > 0, solo: p => !groupsOf(p.id).length,
    voices: p => (adm.usage[p.id] || 0) > 0, blocked: p => adm.data.blocked.has(p.id),
  }[adm.filter] || (() => true);
}

// One line per person (name, when, groups, voices); tap to see their email, groups and the actions.
function personHtml(p, gs) {
  const isBlocked = adm.data.blocked.has(p.id), me = p.id === fb.user.uid, usd = adm.usage[p.id];
  const last = Math.max(p.lastSeen || 0, p.lastSignIn || 0), q = adm.search.trim().toLowerCase();
  const find = `${p.name || ''} ${p.email || ''}`.toLowerCase();
  const meta = [last ? ago(last) : 'never', gs.length ? `${gs.length} ${gs.length === 1 ? 'group' : 'groups'}` : '', usd ? `$${usd.toFixed(2)}` : ''].filter(Boolean).join(' · ');
  return `<li data-find="${esc(find)}"${q && !find.includes(q) ? ' hidden' : ''}><details class="person" data-person="${esc(p.id)}"${adm.expanded.has(p.id) ? ' open' : ''}>
    <summary><span class="person-who"><b>${esc(p.name || 'Unknown')}</b>${me ? ' <span class="muted small">(you)</span>' : ''}${isBlocked ? ' <span class="tag">Blocked</span>' : ''}</span>
      <span class="muted small person-meta">${esc(meta)}</span></summary>
    <div class="person-more stack-sm">
      ${p.email ? `<a class="small person-email" href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '<span class="muted small">No email on file</span>'}
      <span class="small">${p.lastSeen ? `Last seen in the app ${when(p.lastSeen)}` : `Signed in ${when(p.lastSignIn)}, not seen in the app since the Admin screen was added`}${adm.accounts?.find(a => a.uid === p.id)?.created ? ` · signed up ${esc(new Date(adm.accounts.find(a => a.uid === p.id).created).toLocaleDateString())}` : ''}</span>
      <span class="small">${gs.length ? `In: ${esc(gs.map(g => g.name).join(', '))}` : 'Not in any group'}${usd != null ? ` · shared voices this month: about $${usd.toFixed(2)}` : ''}</span>
      ${me ? '' : `<div class="row wrap">
        ${gs.length ? `<button class="btn ghost" data-action="admin-kick-all" data-uid="${esc(p.id)}">Remove from all groups</button>` : ''}
        <button class="btn ghost" data-action="admin-block" data-uid="${esc(p.id)}" data-on="${isBlocked ? '' : '1'}">${isBlocked ? 'Unblock' : 'Block'}</button>
        ${usd ? `<button class="btn ghost" data-action="admin-reset" data-uid="${esc(p.id)}">Reset voices share</button>` : ''}
        <button class="btn ghost" data-action="admin-wipe" data-uid="${esc(p.id)}">Delete their data</button>
      </div>`}
    </div></details></li>`;
}

const nameOf = uid => adm.data?.profiles.find(p => p.id === uid)?.name || adm.accounts?.find(a => a.uid === uid)?.name || 'Unknown person';
const when = t => (t ? ago(t) : 'never');

function renderAdmin() {
  const head = `<div class="row between wrap"><h1>Admin</h1><div class="row wrap"><button class="btn" data-action="report">Reports</button><button class="btn ghost" data-action="group">${icon('back')} Group</button></div></div>`;
  if (!isAdmin()) return `<section class="stack">${head}<p class="muted">This screen is only for the app's admin.</p></section>`;
  if (!adm.data && !adm.error) { loadAdmin(); return `<section class="stack">${head}<p class="muted">Loading…</p></section>`; }
  if (adm.error) return `<section class="stack">${head}<p class="note">${esc(adm.error)}</p><div><button class="btn" data-action="admin-reload">Try again</button></div></section>`;
  const { groups, blocked } = adm.data, profiles = allPeople();
  const groupsOf = uid => groups.filter(g => (g.members || []).includes(uid));
  if (adm.filter.startsWith('g:') && !groups.some(g => `g:${g.id}` === adm.filter)) adm.filter = 'all';
  const shown = sortPeople(profiles.filter(peopleFilter(groupsOf)), groupsOf);
  const q = adm.search.trim().toLowerCase();
  const visible = shown.filter(p => !q || `${p.name || ''} ${p.email || ''}`.toLowerCase().includes(q)).length;
  const people = shown.map(p => personHtml(p, groupsOf(p.id))).join('');
  const filterOptions = Object.entries(PEOPLE_FILTERS).map(([k, v]) => [k, v])
    .concat(groups.slice().sort((a, b) => a.name.localeCompare(b.name)).map(g => [`g:${g.id}`, `In ${g.name}`]))
    .map(([k, v]) => `<option value="${esc(k)}"${adm.filter === k ? ' selected' : ''}>${esc(v)}</option>`).join('');
  const groupRows = groups.slice().sort((a, b) => a.name.localeCompare(b.name)).map(g => {
    const open = adm.open === g.id, items = adm.items[g.id];
    return `<li class="card admin-row">
      <div class="row between wrap"><div class="lib-main"><b>${esc(g.name)}</b>
        <span class="muted small">Made by ${esc(nameOf(g.ownerUid))} · ${(g.members || []).length} members · invite ${esc(g.inviteCode || '')}</span></div>
        <div class="row"><button class="btn ghost" data-action="admin-open" data-gid="${esc(g.id)}">${open ? 'Close' : 'Manage'}</button>
        <button class="btn ghost" data-action="admin-del-group" data-gid="${esc(g.id)}">Delete group</button></div></div>
      ${open ? `<div class="stack-sm">
        <b class="small">Members</b>
        <ul class="share-list">${(g.members || []).map(uid => `<li class="share-row"><span>${esc(g.memberNames?.[uid] || nameOf(uid))}${uid === g.ownerUid ? ' <span class="muted small">(made the group)</span>' : ''}</span>
          <button class="btn ghost" data-action="admin-kick" data-gid="${esc(g.id)}" data-uid="${esc(uid)}">Remove</button></li>`).join('')}</ul>
        <b class="small">Shared scripts and songs</b>
        ${!items ? '<p class="muted small">Loading…</p>' : items.length ? `<ul class="share-list">${items.map(it => `<li class="share-row"><span>${esc(it.title)} <span class="muted small">by ${esc(it.addedByName || nameOf(it.addedBy))}${it.updated ? ` · updated ${ago(it.updated)}` : ''}</span>${shareState(it).label ? ` <span class="tag${shareState(it).live ? '' : ' ended'}">${esc(shareState(it).label)}</span>` : ''}${it.removed ? ` <span class="tag">Unshared ${ago(it.removed)}</span>` : ''}</span>
          <span class="row wrap">${it.removed ? `<button class="btn" data-action="admin-restore-item" data-gid="${esc(g.id)}" data-id="${esc(it.id)}">Restore</button>` : ''}
          ${it.prevRaw != null ? `<button class="btn ghost" data-action="admin-undo-item" data-gid="${esc(g.id)}" data-id="${esc(it.id)}" title="Version from ${it.prevUpdated ? ago(it.prevUpdated) : 'before'}">Undo last update</button>` : ''}
          <button class="btn ghost" data-action="admin-del-item" data-gid="${esc(g.id)}" data-id="${esc(it.id)}">Delete for good</button></span></li>`).join('')}</ul>` : '<p class="muted small">Nothing shared.</p>'}
      </div>` : ''}
    </li>`;
  }).join('');
  return `<section class="stack admin">
    ${head}
    <p class="muted">You're the app's admin. Changes here affect other people right away. <button class="link-btn" data-action="admin-reload">Refresh</button></p>
    ${feedbackHtml()}
    <h2>People (${profiles.length})</h2>
    <div class="people-tools">
      <label class="field"><span>Search</span><input id="people-search" type="search" value="${esc(adm.search)}" placeholder="Name or email" autocomplete="off"></label>
      <label class="field"><span>Show</span><select id="people-filter">${filterOptions}</select></label>
      <label class="field"><span>Sort by</span><select id="people-sort">${Object.entries(PEOPLE_SORTS).map(([k, v]) => `<option value="${k}"${adm.sort === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    </div>
    <p class="muted small"><span id="people-count" data-total="${shown.length}" aria-live="polite">${peopleCount(visible, shown.length)}</span>${adm.filter !== 'all' ? ` (${esc(PEOPLE_FILTERS[adm.filter] || `In ${groups.find(g => `g:${g.id}` === adm.filter)?.name || 'a group'}`)})` : ''}</p>
    ${adm.accounts ? '' : '<p class="muted small">Showing people who have opened the app since the Admin screen was added. To list everyone who has ever signed in, set up GOOGLE_SERVICE_ACCOUNT on the voices server (server/README.md, step 7).</p>'}
    ${people ? `<ul class="people-list card">${people}</ul>` : `<p class="muted">${profiles.length ? 'No one matches.' : 'No one has signed in yet.'}</p>`}
    <p class="muted small"><b>Block</b> stops someone using groups, sharing and the shared voices (their own scripts on their own device are unaffected). To delete someone's Google sign-in completely, use <a href="${FIREBASE_USERS_URL}" target="_blank" rel="noopener">Firebase > Authentication > Users</a> after removing and blocking them here.</p>
    <h2>Groups (${groups.length})</h2>
    <ul class="lib-list">${groupRows || '<li class="muted">No groups yet.</li>'}</ul>
  </section>`;
}

const FEEDBACK_TAGS = { bug: 'Bug', idea: 'Idea', other: 'Other', privacy: 'Privacy', copyright: 'Copyright' };

function feedbackHtml() {
  const list = adm.feedback;
  if (!list) return '<h2 id="admin-feedback">Feedback</h2><p class="note">Firebase refused: publish the latest firestore.rules (it adds the feedback inbox).</p>';
  const rows = list.map(f => `<li class="card admin-row stack-sm">
    <div class="row between wrap"><span><span class="tag">${FEEDBACK_TAGS[f.kind] || 'Other'}</span> <b>${esc(f.name || f.contact || 'Someone (not signed in)')}</b>
      <span class="muted small">${when(f.at)}${f.contact && f.name ? ` · ${esc(f.contact)}` : ''}</span></span>
      <button class="btn ghost" data-action="admin-del-feedback" data-id="${esc(f.id)}">Delete</button></div>
    <p class="fb-message">${esc(f.message)}</p>
    ${f.screenshot ? `<details><summary class="small">Screenshot</summary><img class="fb-shot" src="${esc(f.screenshot)}" alt="Screenshot"></details>` : ''}
    ${f.details ? `<details><summary class="small">Device details</summary><pre class="fb-details">${esc(f.details)}</pre></details>` : ''}
  </li>`).join('');
  return `<h2 id="admin-feedback">Feedback (${list.length})</h2>
    <ul class="lib-list">${rows || '<li class="muted">No feedback yet.</li>'}</ul>`;
}

// Runs an admin change, then reloads the lists.
async function adminDo(confirmText, job, done) {
  if (confirmText && !confirm(confirmText)) return;
  try {
    await job();
    if (done) toast(done);
  } catch (e) {
    toast(String(e?.code || '').includes('permission') ? 'Firebase refused. Is the latest firestore.rules published?' : e?.message || 'That didn\'t work.');
  }
  await loadAdmin();
}

Object.assign(actions, {
  admin() { leave(); adm.data = null; app.view = 'admin'; render(); window.scrollTo(0, 0); },
  'admin-reload'() { adm.data = null; adm.items = {}; render(); },
  async 'admin-open'(b) {
    const gid = b.dataset.gid;
    adm.open = adm.open === gid ? null : gid;
    render();
    if (adm.open) { adm.items[gid] = await fb.adminItems(gid).catch(() => []); render(); }
  },
  'admin-kick'(b) {
    const { gid, uid } = b.dataset, g = adm.data.groups.find(x => x.id === gid);
    adminDo(`Remove ${g.memberNames?.[uid] || nameOf(uid)} from "${g.name}"?`, () => fb.adminRemoveMember(gid, uid), 'Removed from the group.');
  },
  'admin-kick-all'(b) {
    const uid = b.dataset.uid, gs = adm.data.groups.filter(g => (g.members || []).includes(uid));
    adminDo(`Remove ${nameOf(uid)} from all ${gs.length} of their groups?`, () => Promise.all(gs.map(g => fb.adminRemoveMember(g.id, uid))), 'Removed from all groups.');
  },
  'admin-block'(b) {
    const uid = b.dataset.uid, on = !!b.dataset.on;
    adminDo(on ? `Block ${nameOf(uid)}? They won't be able to use groups, sharing or the shared voices (within about 10 minutes for the voices).` : `Unblock ${nameOf(uid)}?`,
      () => fb.adminBlock(uid, on), on ? 'Blocked.' : 'Unblocked.');
  },
  'admin-reset'(b) {
    const uid = b.dataset.uid;
    adminDo(`Reset ${nameOf(uid)}'s shared voices allowance for this month to $0?`, () => voicesAdmin('/admin/reset', { uid }), 'Allowance reset.');
  },
  // What the privacy note promises: their synced scripts, their profile, and their place in every group.
  'admin-wipe'(b) {
    const uid = b.dataset.uid, gs = adm.data.groups.filter(g => (g.members || []).includes(uid));
    adminDo(`Delete ${nameOf(uid)}'s data? This removes them from ${gs.length} ${gs.length === 1 ? 'group' : 'groups'} and deletes their synced scripts and profile. Copies on their own devices stay. If they sign in again, a new profile starts. This can't be undone.`,
      async () => {
        await Promise.all(gs.map(g => fb.deleteProgress(g.id, uid).catch(() => {})));
        await Promise.all(gs.map(g => fb.adminRemoveMember(g.id, uid)));
        const n = await fb.adminDeleteSynced(uid);
        await fb.adminDeleteProfile(uid);
        toast(`Deleted: ${n} synced ${n === 1 ? 'script' : 'scripts'}, their profile and group memberships. To remove their Google sign-in too, use Firebase > Authentication > Users.`);
      });
  },
  'admin-restore-item'(b) {
    const { gid, id } = b.dataset, it = adm.items[gid]?.find(x => x.id === id);
    adminDo(`Restore "${it?.title}" to the group?`, async () => {
      await fb.adminRestoreItem(gid, id);
      delete it.removed;
    }, 'Restored.');
  },
  'admin-undo-item'(b) {
    const { gid, id } = b.dataset, it = adm.items[gid]?.find(x => x.id === id);
    adminDo(`Put "${it?.title}" back to the version from ${it?.prevUpdated ? ago(it.prevUpdated) : 'before its last update'}? (You can undo this the same way.)`, async () => {
      await fb.adminUndoItem(gid, it);
      Object.assign(it, { raw: it.prevRaw, title: it.prevTitle || it.title, prevRaw: it.raw, prevTitle: it.title, prevUpdated: it.updated, updated: Date.now() });
    }, 'Put back. People see "Update my copy" for it.');
  },
  'admin-del-item'(b) {
    const { gid, id } = b.dataset, it = adm.items[gid]?.find(x => x.id === id);
    adminDo(`Delete "${it?.title}" from the group for good? This can't be undone. Copies people already added stay with them.`, async () => {
      await fb.adminDeleteItem(gid, id);
      adm.items[gid] = adm.items[gid].filter(x => x.id !== id);
    }, 'Deleted.');
  },
  'admin-del-feedback'(b) {
    adminDo('Delete this feedback?', () => fb.adminDeleteFeedback(b.dataset.id), 'Deleted.');
  },
  'admin-del-group'(b) {
    const g = adm.data.groups.find(x => x.id === b.dataset.gid);
    adminDo(`Delete the group "${g.name}" and everything shared in it? Members keep the copies they added. This can't be undone.`, () => fb.adminDeleteGroup(g), 'Group deleted.');
  },
});

// ---------- Counting use (for Reports) ----------
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayKey = iso => `d${iso.replace(/-/g, '')}`;

// Counts a practice run once, plus the minutes since it began (or since it was last counted). Called when
// leaving the player or Sing, and when the app goes into the background.
window.logPractice = run => {
  if (!fb.user || !run?.began) return;
  const now = Date.now(), min = Math.min(180, (now - (run.logAt || run.began)) / 60000);
  fb.logUse({ [run.drill ? 'drill' : run.mode]: run.logged ? 0 : 1, min: min >= 0.1 ? Math.round(min * 10) / 10 : 0 });
  Object.assign(run, { logged: true, logAt: now });
};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  if (app.view === 'player') window.logPractice(P);
  if (app.view === 'sing') window.logPractice(window.singRun);
});

// ---------- Reports: app use and money spent ----------
// Use comes from the counts above, on each signed-in person's profile (so people who never sign in aren't
// counted). Money comes from the voices server: its estimate (per person by month; per day and kind once the
// spend table exists) and, with OPENAI_ADMIN_KEY, what OpenAI actually billed.
const REPORT_RANGES = { 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days', 365: 'Last 12 months' };
const PRACTICE_KINDS = { rehearse: 'Rehearse', listen: 'Listen', drill: 'Drill weak lines', type: 'Type', buildup: 'Build up a speech', sing: 'Sing' };
const SPEND_KINDS = { voice: 'AI voices', pages: 'Reading pages from photos' };
const rpt = { days: loadJSON('lineLearner.reportDays', 30), money: null, moneyFor: 0, loading: false };
document.addEventListener('change', e => {
  if (e.target.id === 'report-range') { rpt.days = Number(e.target.value); saveJSON('lineLearner.reportDays', rpt.days); render(); }
});

async function loadReportMoney() {
  if (rpt.loading) return;
  rpt.loading = true;
  const days = Number(rpt.days);
  try { rpt.money = (await voicesAdmin(`/admin/report?days=${days}`)) || { error: 'no voices server' }; } catch (e) { rpt.money = { error: e.message || 'unreachable' }; }
  rpt.moneyFor = days;
  rpt.loading = false;
  if (app.view === 'report') render();
}

const fmtMin = m => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);
const usd = n => `$${(n || 0).toFixed(2)}`;
const monthName = ym => new Date(`${ym}-15T12:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
const dayName = iso => new Date(`${iso}T12:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Everything the report shows, for the chosen range.
function reportData() {
  const n = Number(rpt.days), t = new Date();
  const days = [...Array(n)].map((_, i) => isoDay(new Date(t.getFullYear(), t.getMonth(), t.getDate() - (n - 1 - i))));
  const byDay = new Map(days.map(d => [d, { day: d, who: new Set(), open: 0, runs: 0, min: 0, est: 0, billed: 0 }]));
  const people = new Map(), modes = {}, kinds = {}, items = {};
  let shares = 0;
  const person = (id, p = {}) => {
    if (!people.has(id)) people.set(id, { id, name: p.name || nameOf(id), email: p.email || '', days: 0, open: 0, runs: 0, min: 0, est: 0, last: '' });
    return people.get(id);
  };
  const all = allPeople();
  for (const p of all) {
    const u = person(p.id, p);
    for (const d of days) {
      const c = p.days?.[dayKey(d)];
      if (!c) continue;
      const row = byDay.get(d), runs = Object.keys(PRACTICE_KINDS).reduce((sum, k) => sum + (c[k] || 0), 0);
      for (const k in PRACTICE_KINDS) if (c[k]) modes[k] = (modes[k] || 0) + c[k];
      row.who.add(p.id); row.open += c.open || 0; row.runs += runs; row.min += c.min || 0;
      shares += c.share || 0;
      u.days++; u.open += c.open || 0; u.runs += runs; u.min += c.min || 0; u.last = d;
    }
  }
  const m = rpt.moneyFor === n ? rpt.money || {} : {};
  if (m.days) {
    for (const r of m.days) {
      const row = byDay.get(r.day);
      if (!row) continue;
      row.est += r.usd;
      kinds[r.kind] = (kinds[r.kind] || 0) + r.usd;
      person(r.uid).est += r.usd;
    }
  } else if (m.months) {
    // Only monthly totals: the whole of each month that overlaps the range.
    for (const r of m.months) if (r.month >= days[0].slice(0, 7)) person(r.uid).est += r.usd;
  }
  for (const r of m.openai?.rows || []) {
    const row = byDay.get(r.day);
    if (!row) continue;
    row.billed += r.usd;
    items[r.item || 'Other'] = (items[r.item || 'Other'] || 0) + r.usd;
  }
  const list = [...people.values()];
  const sum = k => list.reduce((s, u) => s + u[k], 0);
  const since = new Date(`${days[0]}T00:00`).getTime();
  return {
    rows: [...byDay.values()], people: list.sort((a, b) => b.runs - a.runs || b.days - a.days || b.est - a.est), modes, kinds, items, m,
    total: {
      people: all.length, active: list.filter(u => u.days).length,
      newcomers: adm.accounts ? adm.accounts.filter(a => a.created >= since).length : null,
      open: sum('open'), runs: sum('runs'), min: sum('min'), est: sum('est'), shares,
      billed: m.openai?.rows ? Object.values(items).reduce((s, v) => s + v, 0) : null,
    },
  };
}

// Days, or months for the 12-month range, so the bars stay readable.
function reportBuckets(rows) {
  if (rows.length <= 90) return rows.map(r => ({ ...r, people: r.who.size, label: dayName(r.day) }));
  const by = new Map();
  for (const r of rows) {
    const k = r.day.slice(0, 7), b = by.get(k) || { label: monthName(k), who: new Set(), open: 0, runs: 0, min: 0, est: 0, billed: 0 };
    for (const f of ['open', 'runs', 'min', 'est', 'billed']) b[f] += r[f];
    r.who.forEach(id => b.who.add(id));
    by.set(k, b);
  }
  return [...by.values()].map(b => ({ ...b, people: b.who.size }));
}

function barsHtml(title, rows, val, fmt) {
  const vals = rows.map(val), max = Math.max(0, ...vals), total = vals.reduce((s, v) => s + v, 0);
  return `<figure class="report-chart">
    <figcaption><b>${esc(title)}</b></figcaption>
    <div class="bars" role="img" aria-label="${esc(`${title}, ${rows[0].label} to ${rows.at(-1).label}: highest ${fmt(max)}`)}">
      ${rows.map((r, i) => `<span class="bar" style="--h:${max ? Math.max(vals[i] ? 3 : 0, Math.round(100 * vals[i] / max)) : 0}%" title="${esc(`${r.label}: ${fmt(vals[i])}`)}"></span>`).join('')}
    </div>
    <div class="bars-axis muted small"><span>${esc(rows[0].label)}</span><span>Top ${esc(fmt(max))}${total !== max ? ` · total ${esc(fmt(total))}` : ''}</span><span>${esc(rows.at(-1).label)}</span></div>
  </figure>`;
}

function shareRowsHtml(obj, names, fmt) {
  const list = Object.entries(obj).sort((a, b) => b[1] - a[1]), total = list.reduce((s, [, v]) => s + v, 0);
  if (!list.length) return '<p class="muted small">Nothing yet in this range.</p>';
  return `<ul class="report-share">${list.map(([k, v]) => `<li><span>${esc(names[k] || k)}</span><span class="share-bar" aria-hidden="true"><span style="width:${total ? Math.round(100 * v / total) : 0}%"></span></span><span class="small">${esc(fmt(v))}${total ? ` (${Math.round(100 * v / total)}%)` : ''}</span></li>`).join('')}</ul>`;
}

function renderReport() {
  const head = `<div class="row between wrap"><h1>Reports</h1><button class="btn ghost" data-action="admin">${icon('back')} Admin</button></div>`;
  if (!isAdmin()) return `<section class="stack">${head}<p class="muted">This screen is only for the app's admin.</p></section>`;
  if (!adm.data && !adm.error) { loadAdmin(); return `<section class="stack">${head}<p class="muted">Loading…</p></section>`; }
  if (adm.error) return `<section class="stack">${head}<p class="note">${esc(adm.error)}</p><div><button class="btn" data-action="report-reload">Try again</button></div></section>`;
  const moneyWait = rpt.moneyFor !== Number(rpt.days);
  if (moneyWait) loadReportMoney();
  const r = reportData(), b = reportBuckets(r.rows), t = r.total, m = r.m;
  const tile = (label, value, note = '') => `<div class="card report-tile"><span class="muted small">${label}</span><b>${value}</b>${note ? `<span class="muted small">${note}</span>` : ''}</div>`;
  const notes = [];
  if (!moneyWait && m.error) notes.push(`Couldn't get spending from the voices server (${esc(m.error)}).`);
  if (!moneyWait && !m.error && !m.days) notes.push('Spending shows whole-month totals per person. For spending by day and by kind, add the spend table to the voices server (server/README.md, step 9).');
  if (!moneyWait && !m.error && m.openai?.error === 'not set up') notes.push("To see what OpenAI actually billed, not only the app's estimate, add an OpenAI Admin key to the voices server (server/README.md, step 9).");
  else if (!moneyWait && m.openai?.error) notes.push(`OpenAI's bill couldn't be read (${esc(m.openai.error)}). Check the OPENAI_ADMIN_KEY secret.`);
  const peopleRows = r.people.filter(u => u.days || u.est).map(u => `<tr><th scope="row">${esc(u.name || 'Unknown')}</th><td>${u.days}</td><td>${u.open}</td><td>${u.runs}</td><td>${esc(fmtMin(u.min))}</td><td>${usd(u.est)}</td><td>${u.last ? esc(dayName(u.last)) : ''}</td></tr>`).join('');
  return `<section class="stack report">
    ${head}
    <div class="row between wrap">
      <label class="field inline"><span>Show</span><select id="report-range">${Object.entries(REPORT_RANGES).map(([k, v]) => `<option value="${k}"${Number(rpt.days) === Number(k) ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <div class="row wrap"><button class="btn ghost" data-action="report-csv" data-what="days">Download by day (CSV)</button><button class="btn ghost" data-action="report-csv" data-what="people">Download by person (CSV)</button></div>
    </div>
    <h2>App use</h2>
    <div class="report-tiles">
      ${tile('Active people', t.active, `of ${t.people} signed up`)}
      ${t.newcomers != null ? tile('New sign-ins', t.newcomers) : ''}
      ${tile('App opens', t.open)}
      ${tile('Practice runs', t.runs)}
      ${tile('Time practicing', esc(fmtMin(t.min)))}
      ${tile('Shared the app', t.shares)}
    </div>
    <div class="report-charts">
      ${barsHtml(b.length < r.rows.length ? 'People active each month' : 'People active each day', b, x => x.people, String)}
      ${barsHtml('Practice runs', b, x => x.runs, String)}
      ${barsHtml('Time practicing', b, x => x.min, fmtMin)}
    </div>
    <h3>How people practice</h3>
    ${shareRowsHtml(r.modes, PRACTICE_KINDS, v => `${v} ${v === 1 ? 'run' : 'runs'}`)}
    <h2>Money spent</h2>
    ${moneyWait ? '<p class="muted">Loading spending…</p>' : `<div class="report-tiles">
      ${tile('Shared voices', usd(t.est), m.days ? "the app's estimate" : "the app's estimate, whole months")}
      ${t.billed != null ? tile('OpenAI billed', usd(t.billed), 'from OpenAI') : ''}
    </div>
    <div class="report-charts">
      ${m.days ? barsHtml('Shared voices (estimate)', b, x => x.est, usd) : ''}
      ${t.billed != null ? barsHtml('OpenAI billed', b, x => x.billed, usd) : ''}
    </div>
    ${m.days ? `<h3>Spending by kind</h3>${shareRowsHtml(r.kinds, SPEND_KINDS, usd)}` : ''}
    ${t.billed != null ? `<h3>OpenAI bill by item</h3>${shareRowsHtml(r.items, {}, usd)}` : ''}`}
    ${notes.map(n => `<p class="note small">${n}</p>`).join('')}
    <h2>By person</h2>
    ${peopleRows ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Use and spending by person"><table class="report-table">
      <thead><tr><th scope="col">Person</th><th scope="col">Days active</th><th scope="col">Opens</th><th scope="col">Runs</th><th scope="col">Practice</th><th scope="col">Spend</th><th scope="col">Last active</th></tr></thead>
      <tbody>${peopleRows}</tbody></table></div>` : '<p class="muted small">No one has been active in this range yet.</p>'}
    <p class="muted small">Use is counted only for people who are signed in, starting October 19, 2026: app opens, practice runs by mode, and minutes, never what anyone practiced. Spending is the voices server's estimate for the shared voices (about $15 per million characters, a fifth of a cent per page). People's own OpenAI keys aren't included.</p>
  </section>`;
}

function reportCsv(what) {
  const r = reportData();
  const rows = what === 'people'
    ? [['person', 'email', 'days active', 'app opens', 'practice runs', 'minutes practicing', 'estimated spend usd', 'last active'],
      ...r.people.map(u => [u.name, u.email, u.days, u.open, u.runs, Math.round(u.min), u.est.toFixed(4), u.last])]
    : [['date', 'people active', 'app opens', 'practice runs', 'minutes practicing', 'estimated spend usd', 'openai billed usd'],
      ...r.rows.map(x => [x.day, x.who.size, x.open, x.runs, Math.round(x.min), x.est.toFixed(4), x.billed.toFixed(4)])];
  const cell = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map(row => row.map(cell).join(',')).join('\n')], { type: 'text/csv' }));
  a.download = `line-learner-${what === 'people' ? 'people' : 'daily'}-${isoDay(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

Object.assign(actions, {
  report() { leave(); app.view = 'report'; render(); window.scrollTo(0, 0); },
  'report-reload'() { adm.data = null; rpt.moneyFor = 0; render(); },
  'report-csv'(b) { reportCsv(b.dataset.what); },
});

VIEWS.admin = renderAdmin;
VIEWS.report = renderReport;
