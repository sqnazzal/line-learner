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
    return F.setDoc(F.doc(db, 'profiles', fb.user.uid), { name: fb.user.name, email: fb.user.email, lastSeen: Date.now() }, { merge: true });
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
  async adminDeleteGroup(g) {
    const { F, db } = fb.api;
    for (const it of await fb.adminItems(g.id)) await F.deleteDoc(F.doc(db, 'groups', g.id, 'items', it.id));
    if (g.inviteCode) await F.deleteDoc(F.doc(db, 'invites', g.inviteCode)).catch(() => {});
    await F.deleteDoc(F.doc(db, 'groups', g.id));
  },
  adminBlock(uid, on) {
    const { F, db } = fb.api;
    return on ? F.setDoc(F.doc(db, 'blocked', uid), { at: Date.now(), by: fb.user.uid }) : F.deleteDoc(F.doc(db, 'blocked', uid));
  },
  async adminDeleteSynced(uid) {
    const { F, db } = fb.api;
    const snap = await F.getDocs(F.collection(db, 'users', uid, 'scripts'));
    for (const d of snap.docs) await F.deleteDoc(d.ref);
    await F.deleteDoc(F.doc(db, 'users', uid, 'meta', 'deleted')).catch(() => {});
    return snap.size;
  },
});

// ---------- The voices server's admin side (allowances) ----------
async function voicesAdmin(path, body) {
  if (!SHARED_VOICES_URL) return null;
  return (await sharedFetch(path, body)).json();
}

// ---------- Screen ----------
const adm = { data: null, usage: {}, loading: false, error: '', open: null, items: {} };

async function loadAdmin() {
  if (adm.loading) return;
  adm.loading = true;
  adm.error = '';
  try {
    adm.data = await fb.adminLoad();
    adm.feedback = await fb.adminFeedback().catch(() => null); // null until the rules with 'feedback' are published
    adm.usage = {};
    try { for (const row of (await voicesAdmin('/admin/usage'))?.rows || []) adm.usage[row.uid] = row.usd; } catch { /* server not updated yet */ }
  } catch (e) {
    adm.error = String(e?.code || '').includes('permission')
      ? 'Firebase refused: publish the latest firestore.rules (with your account ID as admin).'
      : "Couldn't load. Check your connection and try again.";
  }
  adm.loading = false;
  if (app.view === 'admin') render();
}

const nameOf = uid => adm.data?.profiles.find(p => p.id === uid)?.name || 'Unknown person';
const when = t => (t ? ago(t) : 'never');

function renderAdmin() {
  const head = `<div class="row between wrap"><h1>Admin</h1><button class="btn ghost" data-action="group">${icon('back')} Group</button></div>`;
  if (!isAdmin()) return `<section class="stack">${head}<p class="muted">This screen is only for the app's admin.</p></section>`;
  if (!adm.data && !adm.error) { loadAdmin(); return `<section class="stack">${head}<p class="muted">Loading…</p></section>`; }
  if (adm.error) return `<section class="stack">${head}<p class="note">${esc(adm.error)}</p><div><button class="btn" data-action="admin-reload">Try again</button></div></section>`;
  const { profiles, groups, blocked } = adm.data;
  const groupsOf = uid => groups.filter(g => (g.members || []).includes(uid));
  const people = profiles.slice().sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)).map(p => {
    const gs = groupsOf(p.id), isBlocked = blocked.has(p.id), me = p.id === fb.user.uid;
    return `<li class="card admin-row">
      <div class="lib-main"><b>${esc(p.name || 'Unknown')}${me ? ' (you)' : ''}${isBlocked ? ' <span class="tag">Blocked</span>' : ''}</b>
        <span class="muted small">${esc(p.email || '')} · last seen ${when(p.lastSeen)}</span>
        <span class="small">${gs.length ? `In: ${esc(gs.map(g => g.name).join(', '))}` : 'Not in any group'}${adm.usage[p.id] != null ? ` · shared voices this month: about $${adm.usage[p.id].toFixed(2)}` : ''}</span></div>
      ${me ? '' : `<div class="row wrap">
        ${gs.length ? `<button class="btn ghost" data-action="admin-kick-all" data-uid="${esc(p.id)}">Remove from all groups</button>` : ''}
        <button class="btn ghost" data-action="admin-block" data-uid="${esc(p.id)}" data-on="${isBlocked ? '' : '1'}">${isBlocked ? 'Unblock' : 'Block'}</button>
        ${adm.usage[p.id] ? `<button class="btn ghost" data-action="admin-reset" data-uid="${esc(p.id)}">Reset voices share</button>` : ''}
        <button class="btn ghost" data-action="admin-wipe" data-uid="${esc(p.id)}">Delete synced scripts</button>
      </div>`}</li>`;
  }).join('');
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
        ${!items ? '<p class="muted small">Loading…</p>' : items.length ? `<ul class="share-list">${items.map(it => `<li class="share-row"><span>${esc(it.title)} <span class="muted small">by ${esc(it.addedByName || nameOf(it.addedBy))}</span></span>
          <button class="btn ghost" data-action="admin-del-item" data-gid="${esc(g.id)}" data-id="${esc(it.id)}">Delete</button></li>`).join('')}</ul>` : '<p class="muted small">Nothing shared.</p>'}
      </div>` : ''}
    </li>`;
  }).join('');
  return `<section class="stack admin">
    ${head}
    <p class="muted">You're the app's admin. Changes here affect other people right away. <button class="link-btn" data-action="admin-reload">Refresh</button></p>
    ${feedbackHtml()}
    <h2>People (${profiles.length})</h2>
    <ul class="lib-list">${people || '<li class="muted">No one has signed in yet.</li>'}</ul>
    <p class="muted small"><b>Block</b> stops someone using groups, sharing and the shared voices (their own scripts on their own device are unaffected). To delete someone's Google sign-in completely, use <a href="${FIREBASE_USERS_URL}" target="_blank" rel="noopener">Firebase > Authentication > Users</a> after removing and blocking them here.</p>
    <h2>Groups (${groups.length})</h2>
    <ul class="lib-list">${groupRows || '<li class="muted">No groups yet.</li>'}</ul>
  </section>`;
}

const FEEDBACK_TAGS = { bug: 'Bug', idea: 'Idea', other: 'Other' };

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
  'admin-wipe'(b) {
    const uid = b.dataset.uid;
    adminDo(`Delete ${nameOf(uid)}'s synced scripts from the cloud? Copies on their own devices stay unless they sync again. This can't be undone.`,
      async () => toast(`Deleted ${await fb.adminDeleteSynced(uid)} synced scripts.`));
  },
  'admin-del-item'(b) {
    const { gid, id } = b.dataset, it = adm.items[gid]?.find(x => x.id === id);
    adminDo(`Delete "${it?.title}" from the group? Copies people already added stay with them.`, async () => {
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

VIEWS.admin = renderAdmin;
