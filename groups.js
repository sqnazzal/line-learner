'use strict';

// Groups: sign in with Google, create or join a group with an invite code, and share scripts and songs
// with everyone in it. Shared items are copied into each person's own scripts, so progress, recordings
// and personal scripts stay private. Uses Google Firebase (Authentication + Firestore); its code is
// loaded from Google only when needed. Loaded after app.js and uses its helpers.

// Firebase web settings for this app. Not secret: access is controlled by firestore.rules.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyA6TSHgcgIBquR7WMGxnTXlJWCO9-chLHQ',
  authDomain: 'line-learner-45bd1.firebaseapp.com',
  projectId: 'line-learner-45bd1',
  storageBucket: 'line-learner-45bd1.firebasestorage.app',
  messagingSenderId: '1080618070614',
  appId: '1:1080618070614:web:b769242c7eeb15b5ffc1f7',
};
const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const LS_GROUP_USED = 'lineLearner.groupsUsed';
const SS_JOIN = 'lineLearner.pendingJoin';

// ---------- Firebase access (kept in one place so it can be swapped for a stand-in in tests) ----------
const fb = {
  api: null,
  loading: null,
  user: null,

  load() {
    return fb.loading ||= (async () => {
      const [{ initializeApp }, A, F] = await Promise.all(['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map(f => import(FIREBASE_SDK + f)));
      const appRef = initializeApp(FIREBASE_CONFIG);
      const auth = A.getAuth(appRef), db = F.getFirestore(appRef);
      fb.api = { A, F, auth, db };
      A.onAuthStateChanged(auth, u => {
        fb.user = u ? { uid: u.uid, name: u.displayName || u.email || 'Someone', email: u.email || '' } : null;
        onUserChanged();
      });
    })().catch(e => { fb.loading = null; throw e; });
  },

  signIn() {
    const { A, auth } = fb.api;
    return A.signInWithPopup(auth, new A.GoogleAuthProvider());
  },
  signOut() { return fb.api.A.signOut(fb.api.auth); },

  // Live list of the groups you're in.
  watchGroups(cb) {
    const { F, db } = fb.api;
    return F.onSnapshot(F.query(F.collection(db, 'groups'), F.where('members', 'array-contains', fb.user.uid)),
      snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(it => !it.removed)), e => groupError(e));
  },

  // Live list of what's shared in a group.
  watchItems(gid, cb) {
    const { F, db } = fb.api;
    return F.onSnapshot(F.collection(db, 'groups', gid, 'items'),
      snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))), e => groupError(e));
  },

  async createGroup(name) {
    const { F, db } = fb.api;
    const ref = F.doc(F.collection(db, 'groups'));
    const code = inviteCode();
    const batch = F.writeBatch(db);
    batch.set(ref, { name, ownerUid: fb.user.uid, members: [fb.user.uid], memberNames: { [fb.user.uid]: fb.user.name }, inviteCode: code, created: F.serverTimestamp() });
    batch.set(F.doc(db, 'invites', code), { gid: ref.id });
    await batch.commit();
    return ref.id;
  },

  async joinWithCode(code) {
    const { F, db } = fb.api;
    const inv = await F.getDoc(F.doc(db, 'invites', code));
    if (!inv.exists()) throw new Error("That invite code doesn't match a group. Check it and try again.");
    const gid = inv.data().gid;
    await F.updateDoc(F.doc(db, 'groups', gid), {
      members: F.arrayUnion(fb.user.uid), [`memberNames.${fb.user.uid}`]: fb.user.name, lastJoinCode: code,
    });
    return gid;
  },

  leaveGroup(gid) {
    const { F, db } = fb.api;
    return F.updateDoc(F.doc(db, 'groups', gid), { members: F.arrayRemove(fb.user.uid) });
  },

  // Sharing again keeps the version it replaces (prevRaw), so a bad update can be undone; the security
  // rules require this, so no one can quietly overwrite a shared script.
  async shareItem(gid, item) {
    const { F, db } = fb.api;
    const ref = F.doc(db, 'groups', gid, 'items', item.id);
    const snap = await F.getDoc(ref);
    const prev = snap.exists() ? snap.data() : null;
    const full = { ...item };
    if (prev && prev.raw !== item.raw) Object.assign(full, { prevRaw: prev.raw, prevTitle: prev.title || '', prevUpdated: prev.updated || 0 });
    else if (prev?.prevRaw != null) Object.assign(full, { prevRaw: prev.prevRaw, prevTitle: prev.prevTitle || '', prevUpdated: prev.prevUpdated || 0 });
    return F.setDoc(ref, full);
  },

  // Unsharing hides an item rather than deleting it, so only the admin can delete for good (and can restore it).
  removeItem(gid, id) {
    const { F, db } = fb.api;
    return F.updateDoc(F.doc(db, 'groups', gid, 'items', id), { removed: Date.now() });
  },

  // The shared copy of an item in a group, or null if it isn't shared there.
  async getItem(gid, id) {
    const { F, db } = fb.api;
    const snap = await F.getDoc(F.doc(db, 'groups', gid, 'items', id));
    return snap.exists() && !snap.data().removed ? { id: snap.id, ...snap.data() } : null;
  },
};

// ---------- Sync through your Google sign-in ----------
// Each person's scripts are kept privately under users/{their id}/scripts in Firestore (one document per
// script, stored as text; the line-by-line breakdown is rebuilt from the script text on arrival). Merging
// works like the GitHub sync: newest edit wins, progress merges line by line, deletions carry over.
const LS_GSYNC = 'lineLearner.googleSync';
const gsync = { conf: loadJSON(LS_GSYNC, { on: true, pushed: {} }), busy: false, error: '', timer: 0 };
const saveGsync = () => saveJSON(LS_GSYNC, gsync.conf);
const slimScript = s => { const { lines, voices, ...rest } = s; return rest; };
const rehydrate = r => ({ ...r, lines: r.kind === 'song' ? parseSong(r.raw || '').lines : parseScript(r.raw || '') });
const MAX_DOC = 900000; // Firestore documents top out around 1 MB

Object.assign(fb, {
  async pullMine() {
    const { F, db } = fb.api, uid = fb.user.uid;
    const [snap, del] = await Promise.all([
      F.getDocs(F.collection(db, 'users', uid, 'scripts')),
      F.getDoc(F.doc(db, 'users', uid, 'meta', 'deleted')),
    ]);
    return { scripts: snap.docs.map(d => JSON.parse(d.data().json)), deleted: del.exists() ? del.data().map || {} : {} };
  },
  async pushMine(list, deletedMap, removeIds) {
    const { F, db } = fb.api, uid = fb.user.uid;
    for (let i = 0; i < list.length; i += 5) { // a few at a time: big scripts are big documents
      const batch = F.writeBatch(db);
      for (const s of list.slice(i, i + 5)) batch.set(F.doc(db, 'users', uid, 'scripts', s.id), { json: JSON.stringify(slimScript(s)), updated: s.updated || 0 });
      await batch.commit();
    }
    const batch = F.writeBatch(db);
    batch.set(F.doc(db, 'users', uid, 'meta', 'deleted'), { map: deletedMap });
    for (const id of removeIds) batch.delete(F.doc(db, 'users', uid, 'scripts', id));
    await batch.commit();
  },
});

function googleSyncState() {
  return fb.user ? { on: gsync.conf.on, busy: gsync.busy, error: gsync.error } : null;
}

async function googleSync() {
  if (!fb.user || !gsync.conf.on || gsync.busy) return;
  if (P.running) { sync.pending = true; return; } // after the scene, not in the middle of it
  gsync.busy = true;
  gsync.error = '';
  showSyncStatus();
  try {
    const remote = await fb.pullMine();
    const remoteIds = new Set(remote.scripts.map(s => s.id));
    mergeRemote({ scripts: remote.scripts.map(rehydrate), deleted: remote.deleted });
    saveJSON(LS_SCRIPTS, scripts);
    saveJSON(LS_DELETED, deleted);
    // Send what changed since last time, and remove scripts deleted here.
    const pushed = gsync.conf.pushed || {};
    const sig = s => hash(JSON.stringify(slimScript(s)));
    const changed = scripts.filter(s => sig(s) !== pushed[s.id] || !remoteIds.has(s.id));
    const tooBig = changed.filter(s => JSON.stringify(slimScript(s)).length > MAX_DOC);
    const toPush = changed.filter(s => !tooBig.includes(s));
    const removeIds = [...remoteIds].filter(id => !scripts.some(s => s.id === id));
    await fb.pushMine(toPush, deleted, removeIds);
    for (const s of toPush) pushed[s.id] = sig(s);
    for (const id of removeIds) delete pushed[id];
    Object.assign(gsync.conf, { pushed, last: Date.now() });
    saveGsync();
    if (tooBig.length) gsync.error = `"${tooBig[0].title}" is too big to sync. Keep it safe with Download backup.`;
    if (app.view === 'script' && !current()) app.view = 'library';
    if (['library', 'script', 'sync'].includes(app.view) && !app.rec) render();
  } catch (e) {
    gsync.error = String(e?.code || '').includes('permission')
      ? 'Sync was refused. The Firebase security rules need the "users" section (ask Shannon).'
      : "Couldn't sync just now. Check your connection; it will try again.";
    if (app.view === 'sync') render();
  } finally {
    gsync.busy = false;
    showSyncStatus();
  }
}

function scheduleGoogleSync() {
  if (!fb.user || !gsync.conf.on) return;
  clearTimeout(gsync.timer);
  gsync.timer = setTimeout(googleSync, 4000);
}

function googleSyncHtml() {
  if (!fb.api || !fb.user) {
    if (!fb.api) loadGroups();
    return `<div class="card stack-sm">
      <b>Sync with your Google account (easiest)</b>
      <p>Sign in with Google on each of your devices, and your scripts, songs, categories and progress stay the same everywhere. No keys or setup.</p>
      <div><button class="btn primary" data-action="group-signin"${fb.api ? '' : ' disabled'}>${fb.api ? 'Sign in with Google' : 'Loading…'}</button></div>
    </div>`;
  }
  const c = gsync.conf;
  return `<div class="card stack-sm">
    <b>Sync with your Google account</b>
    <label class="check-row"><input type="checkbox" id="gsync-on" ${c.on ? 'checked' : ''}><span>Sync my scripts with ${esc(fb.user.name)}'s Google account</span></label>
    ${c.on ? `<p class="small">${gsync.busy ? 'Syncing now…' : c.last ? `Last synced ${ago(c.last)}. ${scripts.length} ${scripts.length === 1 ? 'script' : 'scripts'}.` : 'Not synced yet.'}</p>
      ${gsync.error ? `<p class="note small">${esc(gsync.error)}</p>` : ''}
      <div><button class="btn" data-action="gsync-now"${gsync.busy ? ' disabled' : ''}>Sync now</button></div>
      <p class="muted small">Sign in with the same Google account on your other devices and they fill in by themselves. Only you can see your synced scripts. Voices and recordings stay on each device.</p>` : ''}
  </div>`;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && fb.user && gsync.conf.on && Date.now() - (gsync.conf.last || 0) > 30000) googleSync();
});

// Six letters and digits, without look-alikes (0/O, 1/I/L).
function inviteCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), b => chars[b % chars.length]).join('');
}

function groupError(e) {
  const code = e?.code || '';
  toast(code.includes('permission-denied') ? "The group service refused that. If you just set it up, check the security rules were published."
    : code.includes('popup-blocked') ? 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.'
    : code.includes('unauthorized-domain') ? 'Sign-in isn\'t allowed from this address yet: add sqnazzal.github.io under Authorized domains in Firebase.'
    : code.includes('popup-closed') || code.includes('cancelled-popup') ? 'Sign-in was cancelled.'
    : e?.message || 'Something went wrong with the group.');
}

// ---------- State ----------
const grp = { groups: [], items: [], current: null, unsubGroups: null, unsubItems: null, error: '' };

// The top-bar button: "Sign in" until you're signed in, then "Group".
function showGroupButton() {
  const b = $('#group-btn');
  if (b) b.textContent = fb.user ? 'Group' : 'Sign in';
}

function onUserChanged() {
  showGroupButton();
  grp.unsubGroups?.(); grp.unsubItems?.();
  Object.assign(grp, { groups: [], items: [], unsubGroups: null, unsubItems: null, loaded: false });
  if (fb.user) {
    saveJSON(LS_GROUP_USED, true);
    Promise.resolve(fb.saveProfile?.()).catch(() => {}); // so the admin can see who uses the app (admin.js)
    grp.unsubGroups = fb.watchGroups(groups => {
      grp.groups = groups.sort((a, b) => a.name.localeCompare(b.name));
      grp.loaded = true;
      if (!groups.some(g => g.id === grp.current)) selectGroup(groups[0]?.id || null);
      window.checkSpotifyAccess?.();
      refreshGroupUi();
    });
    const pending = sessionStorage.getItem(SS_JOIN);
    if (pending) { sessionStorage.removeItem(SS_JOIN); joinGroup(pending); }
    googleSync();
  }
  window.checkSpotifyAccess?.();
  refreshGroupUi();
  showSyncStatus();
}

function selectGroup(gid) {
  grp.unsubItems?.();
  Object.assign(grp, { current: gid, items: [], unsubItems: null });
  if (gid) {
    grp.unsubItems = fb.watchItems(gid, items => {
      grp.items = items.sort((a, b) => (b.updated || 0) - (a.updated || 0));
      refreshGroupUi();
    });
  }
}

// Redraw what depends on the group: the Group screen, or a script page's Share to group button.
function refreshGroupUi() {
  if (app.view === 'group' || app.view === 'sync') render();
  else if (app.view === 'script' && current() && !app.rec) render();
}

const currentGroup = () => grp.groups.find(g => g.id === grp.current);
const inviteLink = code => `${location.origin}${location.pathname.replace(/index\.html$/, '')}?join=${code}`;

// The shared copy of a script: just what's needed to recreate it (no progress, voices or recordings).
function itemFromScript(s) {
  const item = { id: s.groupItem?.id || s.id, title: s.title, raw: s.raw, kind: s.kind || 'script', updated: Date.now(), addedBy: fb.user.uid, addedByName: fb.user.name };
  if (s.kind === 'song') item.song = { spotify: s.song?.spotify || null, times: s.song?.times || [], instrumental: s.song?.instrumental || null, instTimes: s.song?.instTimes || null, offsets: s.song?.offsets || {} };
  return item;
}

const localCopyOf = item => scripts.find(x => x.groupItem?.id === item.id || x.id === item.id);

// Adds a shared item to your scripts, or refreshes your copy, keeping your own progress and voices.
function takeItem(item) {
  let s = localCopyOf(item);
  const fresh = item.kind === 'song'
    ? { kind: 'song', ...parseSong(item.raw), myChar: 'YOU', song: { ...item.song } }
    : (() => { const m = makeScript(item.title, item.raw); return { lines: m.lines, myChar: m.myChar }; })();
  delete fresh.times;
  if (s) {
    const oldLines = s.lines;
    const keepChar = s.myChar && fresh.lines.some(l => l.type === 'line' && l.speaker === s.myChar);
    Object.assign(s, fresh, { title: item.title, raw: item.raw, updated: Date.now() }, keepChar ? { myChar: s.myChar } : {});
    if (fresh.lines) keepPlace(s, oldLines);
  } else {
    s = { id: uid(), voices: {}, stats: {}, ...fresh, title: item.title, raw: item.raw, updated: Date.now(), category: defaultCategory() };
    scripts.push(s);
  }
  s.groupItem = { gid: grp.current, id: item.id, updated: item.updated };
  saveScripts();
  return s;
}

// ---------- Views ----------
function renderGroup() {
  const head = `<div class="row between wrap"><h1>Group</h1><span class="row">${typeof isAdmin === 'function' && isAdmin() ? '<button class="btn" data-action="admin">Admin</button>' : ''}<button class="btn ghost" data-action="home">${icon('back')} Your scripts</button></span></div>`;
  if (!fb.api) {
    loadGroups();
    return `<section class="stack">${head}<p class="muted">${grp.error ? esc(grp.error) : 'Loading…'}</p></section>`;
  }
  if (!fb.user) {
    return `<section class="stack">${head}
      <p class="lede">Signing in is optional. Sign in with Google to share scripts and songs with your cast, friends or family, to sync your scripts across your devices, and to use Shannon's shared voices if you're in one of Shannon's groups. Each person keeps their own progress. Sign-in is for ages 13 and up; younger actors can use everything else without signing in, with a parent. <button class="link-btn" data-action="privacy">Privacy</button></p>
      ${sessionStorage.getItem(SS_JOIN) ? '<p class="note">Sign in to join the group you were invited to.</p>' : ''}
      <div><button class="btn primary" data-action="group-signin">Sign in with Google</button></div>
    </section>`;
  }
  const g = currentGroup();
  const switcher = grp.groups.length > 1 ? `<div class="segmented group-tabs" role="group" aria-label="Your groups">${grp.groups.map(x =>
    `<button class="seg${x.id === grp.current ? ' on' : ''}" data-action="group-switch" data-gid="${esc(x.id)}" aria-pressed="${x.id === grp.current}">${esc(x.name)}</button>`).join('')}</div>` : '';
  const createJoin = `<div class="card stack-sm">
      <b>${grp.groups.length ? 'Another group' : 'Start or join a group'}</b>
      <div class="row wrap"><input id="group-name" type="search" class="search" placeholder="New group name, e.g. Into the Woods cast" aria-label="New group name"><button class="btn" data-action="group-create">Create group</button></div>
      <div class="row wrap"><input id="group-code" type="search" class="search" placeholder="Invite code" aria-label="Invite code" autocapitalize="characters"><button class="btn" data-action="group-join">Join</button></div>
    </div>`;
  if (!g) {
    return `<section class="stack">${head}<p class="muted">Signed in as ${esc(fb.user.name)}. <button class="link-btn" data-action="group-signout">Sign out</button></p>${createJoin}${accountIdHtml()}</section>`;
  }
  const members = Object.entries(g.memberNames || {}).filter(([id]) => (g.members || []).includes(id)).map(([, n]) => n);
  const list = grp.items.length ? `<ul class="lib-list">${grp.items.map(it => {
    const mine = localCopyOf(it);
    const state = !mine ? `<button class="btn primary" data-action="group-take" data-id="${esc(it.id)}">Add to my scripts</button>`
      : (mine.groupItem?.updated || 0) < it.updated && it.addedBy !== fb.user.uid ? `<button class="btn primary" data-action="group-take" data-id="${esc(it.id)}">Update my copy</button>`
      : `<button class="btn ghost" data-action="open" data-id="${esc(mine.id)}">Open</button>`;
    const canRemove = it.addedBy === fb.user.uid; // only the person who shared it
    return `<li class="card lib-card"><div class="lib-main">
        <b>${it.kind === 'song' ? '<span class="tag">Song</span> ' : ''}${esc(it.title)}</b>
        <span class="muted small">Shared by ${esc(it.addedBy === fb.user.uid ? 'you' : it.addedByName || 'someone')}${it.updated ? ' · ' + ago(it.updated) : ''}</span></div>
      <div class="lib-actions">${state}${canRemove ? `<button class="btn ghost" data-action="group-remove" data-id="${esc(it.id)}">Unshare</button>` : ''}</div></li>`;
  }).join('')}</ul>` : '<p class="muted">Nothing shared yet. Open any script or song and tap <b>Share to group</b>.</p>';
  return `<section class="stack">${head}
    ${switcher}
    <div class="card stack-sm">
      <div class="row between wrap"><b class="group-name">${esc(g.name)}</b><span class="muted small">${members.length} ${members.length === 1 ? 'member' : 'members'}: ${esc(members.join(', '))}</span></div>
      <p class="small">Invite people with code <b class="code">${esc(g.inviteCode)}</b> or this link:</p>
      <div class="row wrap"><input id="invite-link" type="text" readonly value="${esc(inviteLink(g.inviteCode))}" aria-label="Invite link" class="search"><button class="btn" data-action="group-copy">Copy link</button></div>
    </div>
    <h2>Shared scripts and songs</h2>
    ${list}
    ${createJoin}
    <p class="muted small">Signed in as ${esc(fb.user.name)}. <button class="link-btn" data-action="group-signout">Sign out</button> · <button class="link-btn" data-action="group-leave">Leave ${esc(g.name)}</button></p>
    ${accountIdHtml()}
  </section>`;
}

// Your account ID, needed once when setting up the shared voices server (its OWNER_UID).
function accountIdHtml() {
  return `<details class="small account-id"><summary class="muted">Account ID (for setting up shared voices)</summary>
    <div class="row wrap"><code id="my-uid">${esc(fb.user.uid)}</code><button class="btn ghost" data-action="copy-uid">Copy</button></div></details>`;
}

function loadGroups() {
  fb.load().then(() => { grp.error = ''; refreshGroupUi(); }).catch(() => {
    grp.error = "Couldn't load the group service. Check your connection and try again.";
    if (app.view === 'group') render();
  });
}

// ---------- Sharing from a script's page ----------
// The same id is used in every group, so a script can be shared to several groups and found again.
const itemIdOf = s => s.groupItem?.id || s.id;
const share = { open: null, status: {} }; // status: gid -> shared item, null (not shared) or 'loading'

function shareButtonHtml(s) {
  if (!fb.user || !grp.groups.length) return '';
  return `<button class="btn ghost" data-action="group-share-panel" aria-expanded="${share.open === s.id}">${share.open === s.id ? 'Close sharing' : 'Share to group'}</button>`;
}

function sharePanelHtml(s) {
  if (!fb.user || share.open !== s.id) return '';
  const rows = grp.groups.map(g => {
    const st = share.status[g.id];
    // Only the person who shared an item can update or unshare it (the security rules enforce this too).
    const mine = st && st !== 'loading' && st.addedBy === fb.user.uid;
    const actionsHtml = st === 'loading' ? '<span class="muted small">Checking…</span>'
      : !st ? `<button class="btn primary" data-action="group-share-to" data-gid="${esc(g.id)}">Share</button>`
      : mine ? `<button class="btn" data-action="group-share-to" data-gid="${esc(g.id)}">Update</button>
         <button class="btn ghost" data-action="group-unshare" data-gid="${esc(g.id)}">Unshare</button>`
      : '';
    const note = st && st !== 'loading'
      ? `Shared${st.addedBy === fb.user.uid ? '' : ` by ${esc(st.addedByName || 'someone')}`}${st.updated ? ' · ' + ago(st.updated) : ''}`
      : st === null ? 'Not shared' : '';
    return `<li class="share-row"><div class="lib-main"><b>${esc(g.name)}</b><span class="muted small">${note}</span></div><div class="row">${actionsHtml}</div></li>`;
  }).join('');
  return `<div class="card stack-sm share-panel"><b>Share “${esc(s.title)}” with</b><ul class="share-list">${rows}</ul>
    <p class="muted small">Shared copies go to everyone in that group. Only share if your production's license (or the publisher) allows giving the cast digital copies. Only you can update or unshare what you share. Unsharing removes it from the group's list, but copies people already added stay with them and can't be taken back. Nobody's copy changes until they choose <b>Update my copy</b>.</p></div>`;
}

async function loadShareStatus(s) {
  const id = itemIdOf(s);
  for (const g of grp.groups) share.status[g.id] = 'loading';
  render();
  await Promise.all(grp.groups.map(async g => {
    try { share.status[g.id] = await fb.getItem(g.id, id); } catch (e) { share.status[g.id] = null; groupError(e); }
  }));
  if (share.open === s.id && app.view === 'script') render();
}

async function joinGroup(code) {
  code = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) { toast('Type the invite code first.'); return; }
  try {
    const gid = await fb.joinWithCode(code);
    selectGroup(gid);
    toast('You joined the group.');
  } catch (e) {
    if (e?.code) groupError(e); else toast(e.message);
  }
}

Object.assign(actions, {
  group() { leave(); app.view = 'group'; render(); window.scrollTo(0, 0); },
  'gsync-now'() { googleSync(); render(); },
  'copy-uid'() {
    const id = fb.user?.uid || '';
    navigator.clipboard?.writeText(id).then(() => toast('Account ID copied.'), () => toast(id));
  },
  'group-switch'(b) { selectGroup(b.dataset.gid); render(); },
  'group-signin'() { fb.signIn().catch(groupError); },
  'group-signout'() { fb.signOut().catch(groupError); },
  async 'group-create'() {
    const name = $('#group-name').value.trim();
    if (!name) { toast('Give the group a name first.'); return; }
    try { selectGroup(await fb.createGroup(name)); toast('Group created. Share the invite link with your people.'); } catch (e) { groupError(e); }
  },
  'group-join'() { joinGroup($('#group-code').value); },
  'group-copy'() {
    const box = $('#invite-link');
    navigator.clipboard?.writeText(box.value).then(() => toast('Invite link copied.'), () => { box.select(); toast('Select and copy the link.'); });
  },
  async 'group-leave'() {
    const g = currentGroup();
    if (!g || !confirm(`Leave "${g.name}"? Scripts you added to your own list stay there.`)) return;
    try { await fb.leaveGroup(g.id); toast(`You left ${g.name}.`); } catch (e) { groupError(e); }
  },
  'group-share-panel'() {
    const s = current();
    if (share.open === s.id) { share.open = null; render(); return; }
    share.open = s.id;
    loadShareStatus(s);
  },
  async 'group-share-to'(b) {
    const s = current(), gid = b.dataset.gid, g = grp.groups.find(x => x.id === gid);
    try {
      const prev = share.status[gid];
      if (prev && prev.addedBy !== fb.user.uid) { toast(`Only ${prev.addedByName || 'the person who shared it'} can change this.`); return; }
      const item = itemFromScript(s);
      await fb.shareItem(gid, item);
      share.status[gid] = item;
      if (!s.groupItem) s.groupItem = { gid, id: item.id, updated: item.updated };
      else if (s.groupItem.gid === gid) s.groupItem.updated = item.updated;
      saveScripts();
      toast(prev ? `Updated in ${g?.name || 'the group'}.` : `Shared with ${g?.name || 'the group'}.`);
      render();
    } catch (e) { groupError(e); }
  },
  async 'group-unshare'(b) {
    const s = current(), gid = b.dataset.gid, g = grp.groups.find(x => x.id === gid);
    if (!confirm(`Unshare "${s.title}" from ${g?.name || 'this group'}? Copies people already added stay with them.`)) return;
    try {
      await fb.removeItem(gid, itemIdOf(s));
      share.status[gid] = null;
      toast(`Unshared from ${g?.name || 'the group'}.`);
      render();
    } catch (e) { groupError(e); }
  },
  'group-take'(b) {
    const item = grp.items.find(it => it.id === b.dataset.id);
    if (!item) return;
    const existed = !!localCopyOf(item);
    const s = takeItem(item);
    toast(existed ? 'Your copy is up to date.' : 'Added to your scripts.');
    openScript(s.id);
  },
  async 'group-remove'(b) {
    const item = grp.items.find(it => it.id === b.dataset.id);
    if (!item || !confirm(`Unshare "${item.title}" from ${currentGroup()?.name || 'the group'}? Copies people already added stay with them.`)) return;
    try { await fb.removeItem(grp.current, item.id); } catch (e) { groupError(e); }
  },
});

document.addEventListener('change', e => {
  if (e.target.id === 'group-pick') { selectGroup(e.target.value); render(); }
  if (e.target.id === 'gsync-on') {
    gsync.conf.on = e.target.checked;
    saveGsync();
    if (gsync.conf.on) googleSync();
    render();
    showSyncStatus();
  }
});

VIEWS.group = renderGroup;

// An invite link (?join=CODE) opens the Group screen and joins after signing in.
(() => {
  const params = new URLSearchParams(location.search);
  const code = params.get('join');
  if (code) {
    sessionStorage.setItem(SS_JOIN, code);
    history.replaceState(null, '', location.pathname);
    app.view = 'group';
    render();
  } else if (loadJSON(LS_GROUP_USED, false)) {
    loadGroups(); // signed in before: reconnect quietly so Share to group is ready
  }
})();
