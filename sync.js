// Synchronisierung über Firebase (Auth + Firestore).
// Datenmodell:
//   users/{uid}                    Profil: players {p1,p2}, groupId
//   users/{uid}/games|matches      PRIVATE Spiele/Partien – nur für mich sichtbar
//   groups/{gid}                   Gruppe: members [uid], players {p1:{name,color,uid}, p2:…}, inviteCode
//   groups/{gid}/games|matches     GETEILTE Spiele/Partien – für alle Mitglieder
//   invites/{CODE}                 Einladung: groupId, freeSlot, names
// Jede Partie ist ein eigenes Dokument mit fester ID → keine Duplikate bei Wiederholungen,
// gleichzeitige Einträge auf zwei Geräten kollidieren nicht. Offline-Änderungen puffert Firestore
// in IndexedDB und überträgt sie automatisch, sobald wieder Verbindung besteht.

const cfg = window.FIREBASE_CONFIG;
const Cloud = window.Cloud = { configured: !!cfg, user: null };

const notify = (name, detail) => { const fn = window[name]; if (typeof fn === 'function') fn(detail); };

if (!cfg) {
  notify('onCloudAuth', null);
} else {
  start().catch(err => { console.error(err); notify('onCloudAuth', null); });
}

async function start() {
  const FB = await import(window.__FB_MODULE__ || './vendor/firebase.js');
  const app = FB.initializeApp(cfg);
  const auth = FB.initializeAuth(app, { persistence: [FB.indexedDBLocalPersistence, FB.browserLocalPersistence] });

  let db;
  try {
    db = FB.initializeFirestore(app, {
      localCache: FB.persistentLocalCache({ tabManager: FB.persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true
    });
  } catch (e) {
    db = FB.initializeFirestore(app, { localCache: FB.memoryLocalCache(), ignoreUndefinedProperties: true });
  }
  if (cfg.emulator) {
    FB.connectAuthEmulator(auth, `http://${cfg.emulator}:9099`, { disableWarnings: true });
    FB.connectFirestoreEmulator(db, cfg.emulator, 8080);
  }

  /* ---------- interner Zustand ---------- */
  const DEFAULT_PLAYERS = { p1: { name: 'Jakob', color: '#7c5cff' }, p2: { name: 'Emma', color: '#ff5c8a' } };
  let uid = null, profile = null, profileLoaded = false, group = null, groupId = null;
  let createdProfile = false;
  const data = { me: { games: new Map(), matches: new Map() }, grp: { games: new Map(), matches: new Map() } };
  let unsubs = [], groupUnsubs = [];
  const pendingBy = new Map();

  const other = s => (s === 'p1' ? 'p2' : 'p1');
  const ref = (...p) => FB.doc(db, ...p);
  const root = space => (space === 'grp' ? ['groups', groupId] : ['users', uid]);
  const docIn = (space, kind, id) => ref(...root(space), kind, id);
  const clean = o => { const c = { ...o }; delete c.space; return c; };
  const norm = s => String(s || '').trim().toLowerCase();

  /* ---------- Status (synchronisiert / offline / ausstehend) ---------- */
  let lastStatus = '';
  function status() {
    const pending = [...pendingBy.values()].some(Boolean);
    return !navigator.onLine ? 'offline' : pending ? 'syncing' : 'synced';
  }
  function pushStatus() {
    const s = status();
    if (s !== lastStatus) { lastStatus = s; notify('onCloudStatus', s); }
  }
  window.addEventListener('online', pushStatus);
  window.addEventListener('offline', pushStatus);

  /* ---------- Zustand für die App zusammenbauen ---------- */
  const toArr = players => ['p1', 'p2'].map(id => ({ id, ...DEFAULT_PLAYERS[id], ...((players || {})[id] || {}) }));

  function effectivePlayers() {
    return (group && group.players) || (profile && profile.players) || DEFAULT_PLAYERS;
  }

  function build() {
    const games = [], matches = [];
    for (const space of ['me', 'grp']) {
      if (space === 'grp' && !group) continue;
      const gs = data[space].games;
      for (const g of gs.values()) games.push({ ...g, space });
      // Partien ohne Spiel (z. B. offline eingetragen, während das Spiel gelöscht wurde) ausblenden
      for (const m of data[space].matches.values()) if (gs.has(m.gameId)) matches.push({ ...m, space });
    }
    games.sort((a, b) => (a.created || 0) - (b.created || 0) || a.name.localeCompare(b.name));
    return { players: toArr(effectivePlayers()), games, matches };
  }

  let emitQueued = false;
  function emit() {
    if (emitQueued) return;
    emitQueued = true;
    queueMicrotask(() => {
      emitQueued = false;
      if (!uid || !profileLoaded) return;
      notify('onCloudState', build());
      pushStatus();
    });
  }

  /* ---------- Listener ---------- */
  // Welche Listen schon einmal vom Server bestätigt wurden (vorher kein automatisches Aufräumen)
  const confirmed = new Set();
  function listenSpace(space, list) {
    for (const kind of ['games', 'matches']) {
      const key = space + kind;
      list.push(FB.onSnapshot(FB.collection(db, ...root(space), kind), { includeMetadataChanges: true }, snap => {
        const map = data[space][kind];
        map.clear();
        snap.docs.forEach(d => map.set(d.id, { ...d.data(), id: d.id }));
        pendingBy.set(key, snap.metadata.hasPendingWrites);
        if (!snap.metadata.fromCache) confirmed.add(key);
        if (key === 'grpgames') scheduleTidy();
        emit();
      }, err => console.warn(key, err)));
    }
  }

  // Sobald ein Spiel geteilt wird, das man selbst noch leer (ohne Partien) privat hat → privates Duplikat entfernen
  let tidyTimer = null;
  function scheduleTidy() {
    clearTimeout(tidyTimer);
    tidyTimer = setTimeout(() => Cloud.tidyDuplicates && Cloud.tidyDuplicates().catch(() => {}), 1500);
  }

  function stopGroup() {
    groupUnsubs.forEach(u => u());
    groupUnsubs = [];
    group = null;
    groupId = null;
    data.grp.games.clear();
    data.grp.matches.clear();
    pendingBy.delete('grpgames');
    pendingBy.delete('grpmatches');
    confirmed.delete('grpgames');
    confirmed.delete('grpmatches');
    pendingBy.delete('group');
  }

  function startGroup(gid) {
    stopGroup();
    groupId = gid;
    groupUnsubs.push(FB.onSnapshot(ref('groups', gid), { includeMetadataChanges: true }, snap => {
      if (!snap.exists()) { if (!snap.metadata.fromCache) leaveLocalOnly(); return; }
      const g = snap.data();
      if (!(g.members || []).includes(uid)) { leaveLocalOnly(); return; }
      group = { id: gid, ...g };
      pendingBy.set('group', snap.metadata.hasPendingWrites);
      emit();
    }, err => {
      // Kein Zugriff mehr (z. B. aus Gruppe entfernt) → Verweis im Profil aufräumen
      if (err.code === 'permission-denied') leaveLocalOnly();
    }));
    listenSpace('grp', groupUnsubs);
  }

  function leaveLocalOnly() {
    stopGroup();
    if (uid) FB.setDoc(ref('users', uid), { groupId: FB.deleteField() }, { merge: true }).catch(() => {});
    emit();
  }

  function stopAll() {
    unsubs.forEach(u => u());
    unsubs = [];
    stopGroup();
    data.me.games.clear();
    data.me.matches.clear();
    pendingBy.clear();
    confirmed.clear();
    profile = null;
    profileLoaded = false;
    createdProfile = false;
  }

  FB.onAuthStateChanged(auth, user => {
    stopAll();
    uid = user ? user.uid : null;
    Cloud.user = user ? { uid: user.uid, email: user.email } : null;
    if (!user) { notify('onCloudAuth', null); return; }

    unsubs.push(FB.onSnapshot(ref('users', uid), { includeMetadataChanges: true }, snap => {
      if (!snap.exists()) {
        // Neues Konto: Profil anlegen (nur wenn der Server bestätigt, dass es wirklich fehlt)
        if (!snap.metadata.fromCache && !createdProfile) {
          createdProfile = true;
          const local = (window.localSnapshot && window.localSnapshot()) || null;
          const players = local ? Object.fromEntries(local.players.map(p => [p.id, { name: p.name, color: p.color }])) : DEFAULT_PLAYERS;
          FB.setDoc(ref('users', uid), { players, created: Date.now() }, { merge: true }).catch(console.warn);
        }
        return;
      }
      profile = snap.data();
      const firstLoad = !profileLoaded;
      profileLoaded = true;
      pendingBy.set('profile', snap.metadata.hasPendingWrites);
      if ((profile.groupId || null) !== groupId) {
        if (profile.groupId) startGroup(profile.groupId); else stopGroup();
      }
      if (firstLoad) notify('onCloudAuth', { ...Cloud.user, isNew: createdProfile });
      emit();
    }, err => console.warn('profile', err)));
    listenSpace('me', unsubs);
  });

  /* ---------- Schreiben ---------- */
  function chunkedBatches(ops) {
    // Firestore erlaubt 500 Operationen pro Batch
    const commits = [];
    for (let i = 0; i < ops.length; i += 450) {
      const b = FB.writeBatch(db);
      ops.slice(i, i + 450).forEach(([op, r, d, o]) => (op === 'delete' ? b.delete(r) : o ? b.set(r, d, o) : b.set(r, d)));
      commits.push(b.commit());
    }
    return Promise.all(commits);
  }

  const swapMatch = m => {
    const s = { ...m };
    if (m.winner === 'p1' || m.winner === 'p2') s.winner = other(m.winner);
    if (m.scores) s.scores = { p1: m.scores.p2, p2: m.scores.p1 };
    return s;
  };
  // Stehen die Namen über Kreuz (lokal p1 = "Emma", Ziel p2 = "Emma"), müssen die Slots getauscht werden
  function needsSwap(fromPlayers, toPlayers) {
    const f = id => norm((fromPlayers[id] || {}).name), t = id => norm((toPlayers[id] || {}).name);
    if (f('p1') === t('p1') || f('p2') === t('p2')) return false;
    return (f('p1') && f('p1') === t('p2')) || (f('p2') && f('p2') === t('p1'));
  }

  Object.assign(Cloud, {
    signIn: (email, pw) => FB.signInWithEmailAndPassword(auth, email.trim(), pw),
    signUp: (email, pw) => FB.createUserWithEmailAndPassword(auth, email.trim(), pw),
    resetPassword: email => FB.sendPasswordResetEmail(auth, email.trim()),
    signOut: () => FB.signOut(auth),

    info() {
      if (!uid) return null;
      let g = null;
      if (group) {
        const mySlot = ['p1', 'p2'].find(s => (group.players[s] || {}).uid === uid) || 'p1';
        g = {
          id: group.id, inviteCode: group.inviteCode, members: (group.members || []).length,
          mySlot, partnerSlot: other(mySlot)
        };
      }
      return { ...Cloud.user, group: g, status: status() };
    },

    addMatch: (m, space) => FB.setDoc(docIn(space, 'matches', m.id), clean(m)),
    deleteMatch: m => FB.deleteDoc(docIn(m.space, 'matches', m.id)),
    saveGame: g => FB.setDoc(docIn(g.space, 'games', g.id), clean(g)),

    deleteGame(g) {
      const ops = [['delete', docIn(g.space, 'games', g.id)]];
      for (const m of data[g.space].matches.values()) if (m.gameId === g.id) ops.push(['delete', docIn(g.space, 'matches', m.id)]);
      return chunkedBatches(ops);
    },

    setPlayer(id, key, val) {
      const target = group ? ref('groups', groupId) : ref('users', uid);
      return FB.setDoc(target, { players: { [id]: { [key]: val } } }, { merge: true });
    },

    // Spiel samt Partien zwischen privat ('me') und geteilt ('grp') verschieben.
    // Gibt es im Ziel schon ein Spiel mit gleichem Namen und gleicher Wertung, werden die Partien dort einsortiert.
    moveGame(game, to) {
      const from = game.space;
      if (from === to || (to === 'grp' && !group)) return Promise.resolve();
      const twin = [...data[to].games.values()].find(x => norm(x.name) === norm(game.name) && x.type === game.type);
      const targetId = twin ? twin.id : game.id;
      const ops = [];
      if (!twin) ops.push(['set', docIn(to, 'games', targetId), clean({ ...game, id: targetId })]);
      for (const m of data[from].matches.values()) {
        if (m.gameId !== game.id) continue;
        ops.push(['set', docIn(to, 'matches', m.id), clean({ ...m, gameId: targetId })]);
        ops.push(['delete', docIn(from, 'matches', m.id)]);
      }
      ops.push(['delete', docIn(from, 'games', game.id)]);
      return chunkedBatches(ops);
    },

    async shareAllPrivate() {
      for (const g of [...data.me.games.values()]) await Cloud.moveGame({ ...g, space: 'me' }, 'grp');
    },

    // Lokale Safari-Daten ins private Konto übernehmen (IDs bleiben erhalten → mehrfaches Ausführen erzeugt keine Duplikate)
    migrateLocal(local) {
      const targetPlayers = effectivePlayers();
      const localPlayers = Object.fromEntries(local.players.map(p => [p.id, p]));
      const swap = needsSwap(localPlayers, targetPlayers);
      const ops = [];
      const idMap = {};
      let t = Date.now();
      const existing = [...data.me.games.values(), ...(group ? data.grp.games.values() : [])];
      for (const g of local.games) {
        const twin = existing.find(x => norm(x.name) === norm(g.name) && x.type === g.type);
        if (twin && data.me.games.has(twin.id)) { idMap[g.id] = twin.id; continue; }
        idMap[g.id] = g.id;
        ops.push(['set', docIn('me', 'games', g.id), clean({ ...g, created: g.created || t++ })]);
      }
      for (const m of local.matches) {
        if (!idMap[m.gameId]) continue;
        const mm = { ...(swap ? swapMatch(m) : m), gameId: idMap[m.gameId] };
        ops.push(['set', docIn('me', 'matches', m.id), clean(mm)]);
      }
      if (!profile || !profile.players) {
        ops.push(['set', ref('users', uid), { players: Object.fromEntries(local.players.map(p => [p.id, { name: p.name, color: p.color }])) }, { merge: true }]);
      }
      return chunkedBatches(ops);
    },

    async createGroup(mySlot) {
      if (group) throw new Error('Du bist schon in einer Gruppe.');
      const gid = FB.doc(FB.collection(db, 'groups')).id;
      const code = await freshCode();
      const p = effectivePlayers();
      const players = {
        p1: { name: p.p1.name, color: p.p1.color },
        p2: { name: p.p2.name, color: p.p2.color }
      };
      players[mySlot].uid = uid;
      const freeSlot = other(mySlot);
      const b = FB.writeBatch(db);
      b.set(ref('groups', gid), { owner: uid, members: [uid], players, inviteCode: code, created: Date.now() });
      b.set(ref('invites', code), { groupId: gid, createdBy: uid, freeSlot, names: { p1: players.p1.name, p2: players.p2.name }, created: Date.now() });
      b.set(ref('users', uid), { groupId: gid }, { merge: true });
      await b.commit();
      return code;
    },

    async newInvite() {
      if (!group) return null;
      const code = await freshCode();
      const freeSlot = Cloud.info().group.partnerSlot;
      const b = FB.writeBatch(db);
      b.set(ref('invites', code), { groupId, createdBy: uid, freeSlot, names: { p1: group.players.p1.name, p2: group.players.p2.name }, created: Date.now() });
      b.set(ref('groups', groupId), { inviteCode: code }, { merge: true });
      await b.commit();
      return code;
    },

    async previewInvite(code) {
      const snap = await FB.getDocFromServer(ref('invites', code.trim().toUpperCase()));
      if (!snap.exists()) throw Object.assign(new Error('Code nicht gefunden'), { code: 'invite/not-found' });
      const inv = { code: snap.id, ...snap.data() };
      if (Date.now() - (inv.created || 0) > 7 * 24 * 3600 * 1000) throw Object.assign(new Error('Code abgelaufen'), { code: 'invite/expired' });
      if (inv.createdBy === uid) throw Object.assign(new Error('Das ist dein eigener Code'), { code: 'invite/own' });
      return inv;
    },

    async joinGroup(code) {
      if (group) throw new Error('Du bist schon in einer Gruppe.');
      const inv = await Cloud.previewInvite(code);
      const myPlayers = effectivePlayers();
      await FB.updateDoc(ref('groups', inv.groupId), {
        members: FB.arrayUnion(uid),
        [`players.${inv.freeSlot}.uid`]: uid,
        joinCode: inv.code
      });
      // Eigene private Partien an die Spieler-Reihenfolge der Gruppe anpassen
      if (needsSwap(myPlayers, inv.names ? { p1: { name: inv.names.p1 }, p2: { name: inv.names.p2 } } : myPlayers)) {
        const ops = [...data.me.matches.values()].map(m => ['set', docIn('me', 'matches', m.id), clean(swapMatch(m))]);
        await chunkedBatches(ops);
      }
      await FB.setDoc(ref('users', uid), { groupId: inv.groupId }, { merge: true });
      FB.deleteDoc(ref('invites', inv.code)).catch(() => {});
      return inv;
    },

    // Nach dem Beitritt: leere private Spiele löschen, die es in der Gruppe schon gibt
    tidyDuplicates() {
      if (!group || !['megames', 'mematches', 'grpgames'].every(k => confirmed.has(k))) return Promise.resolve();
      const ops = [];
      for (const g of data.me.games.values()) {
        const twin = [...data.grp.games.values()].find(x => norm(x.name) === norm(g.name) && x.type === g.type);
        const used = [...data.me.matches.values()].some(m => m.gameId === g.id);
        if (twin && !used) ops.push(['delete', docIn('me', 'games', g.id)]);
      }
      return chunkedBatches(ops);
    },

    async leaveGroup() {
      if (!group) return;
      const slot = Cloud.info().group.mySlot;
      const gid = groupId;
      await FB.updateDoc(ref('groups', gid), { members: FB.arrayRemove(uid), [`players.${slot}.uid`]: FB.deleteField() });
      await FB.setDoc(ref('users', uid), { groupId: FB.deleteField() }, { merge: true });
    }
  });

  async function freshCode() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 5; i++) {
      const rnd = crypto.getRandomValues(new Uint32Array(6));
      const code = [...rnd].map(n => abc[n % abc.length]).join('');
      try {
        const s = await FB.getDocFromServer(ref('invites', code));
        if (!s.exists()) return code;
      } catch (e) {
        if (e.code === 'permission-denied') return code;
        throw Object.assign(new Error('Für eine Einladung wird eine Internetverbindung benötigt.'), { code: 'unavailable' });
      }
    }
    throw new Error('Kein freier Code gefunden');
  }
}
