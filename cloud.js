// Synchronisation Firebase : compte Google + Firestore, « local d'abord ».
// L'app fonctionne toujours sur ses données locales (localStorage) ; ce module recopie
// chaque modification dans Firestore et applique celles venues des autres appareils.
// Données (une seule zone par utilisateur, protégée par firestore.rules) :
//   users/{uid}                       réglages { unit, strava, hud (tableau de bord vidéo), hrz (zones cardio) } + un horodatage par champ (unitU…)
//   users/{uid}/items/{kind}_{id}     une séance ou une course { kind, id, u, data | chunks, del? }
//   users/{uid}/chunks/{kind}_{id}_{u}_{n}  morceaux des gros éléments (GPX longs), limite Firestore 1 Mo / document
// Chaque élément porte `u` (horodatage de sa dernière modification) : le plus récent gagne.
// Une suppression laisse une pierre tombale { del: true } pour ne pas ressusciter l'élément ailleurs.
window.TM_CLOUD_VERSION = '2026.10.19-4';   // doit valoir APP_VERSION d'index.html (sinon : ancien fichier en cache)
const V = '10.12.2', BASE = 'https://www.gstatic.com/firebasejs/' + V + '/';
const CH = 700000;            // caractères par document (marge sous 1 Mo)
const KINDS = ['sessions', 'history'], SETTINGS = ['unit', 'strava', 'hud', 'hrz'];
const LEGACY = ['unit', 'strava'];
const cfg = window.TM_FIREBASE_CONFIG;
const app = window.tmApp;     // passerelle exposée par index.html

if (!cfg || !cfg.apiKey) app.cloudState('off');
else start().catch(e => { console.error('[cloud]', e); app.cloudState('error', String(e && e.message || e)); });

async function start() {
  const libs = window.__tmFirebaseLibs || await Promise.all([
    import(BASE + 'firebase-app.js'), import(BASE + 'firebase-auth.js'), import(BASE + 'firebase-firestore.js')]);
  const [{ initializeApp }, A, F] = libs;
  const fb = initializeApp(cfg);
  const auth = A.getAuth(fb);
  let db;
  try { db = F.initializeFirestore(fb, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
  catch (e) { db = F.getFirestore(fb); }
  // tests seulement : émulateurs Firebase locaux (jamais actif dans l'app : window.__tmEmulator n'existe pas)
  if (window.__tmEmulator) { A.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); F.connectFirestoreEmulator(db, '127.0.0.1', 8085); window.__tmTest = { A, F, auth, db }; }

  let uid = null, meta = {}, unsub = [], merged = false, settingsMerged = false;
  const itemRef = key => F.doc(db, 'users', uid, 'items', key);
  const chunkRef = (key, u, i) => F.doc(db, 'users', uid, 'chunks', key + '_' + u + '_' + i);
  const fail = e => { console.error('[cloud]', e); app.cloudState('error', String(e && e.message || e)); };

  async function put(kind, item) {
    if (!uid) return;
    const key = kind + '_' + item.id, u = item.u || 1, json = JSON.stringify(item);
    const n = json.length > CH ? Math.ceil(json.length / CH) : 0, old = meta[key];
    const b = F.writeBatch(db);
    for (let i = 0; i < n; i++) b.set(chunkRef(key, u, i), { d: json.slice(i * CH, (i + 1) * CH) });
    const head = { kind, id: item.id, u };
    if (item.date) head.date = item.date;
    b.set(itemRef(key), n ? Object.assign(head, { chunks: n }) : Object.assign(head, { data: json }));
    if (old && old.chunks && old.u !== u) for (let i = 0; i < old.chunks; i++) b.delete(chunkRef(key, old.u, i));
    meta[key] = { u, chunks: n };
    return b.commit().catch(fail);
  }
  async function del(kind, id) {
    if (!uid) return;
    const key = kind + '_' + id, u = Date.now(), old = meta[key];
    const b = F.writeBatch(db);
    b.set(itemRef(key), { kind, id, u, del: true });
    if (old && old.chunks) for (let i = 0; i < old.chunks; i++) b.delete(chunkRef(key, old.u, i));
    meta[key] = { u, del: true };
    return b.commit().catch(fail);
  }
  function putSettings() {
    if (!uid) return;
    return F.setDoc(F.doc(db, 'users', uid), app.settings(), { merge: true }).catch(fail);   // merge : ne jamais retirer un champ d'une version plus récente
  }
  async function readItem(key, d) {
    if (d.data) return JSON.parse(d.data);
    let json = '';
    for (let i = 0; i < d.chunks; i++) {
      const c = await F.getDoc(chunkRef(key, d.u, i));
      if (!c.exists()) return null;   // morceaux pas encore arrivés : la prochaine notification les apportera
      json += c.data().d;
    }
    return JSON.parse(json);
  }

  async function onItems(snap) {
    for (const ch of snap.docChanges()) {
      const key = ch.doc.id, d = ch.doc.data();
      if (ch.type === 'removed') { delete meta[key]; continue; }
      if (!KINDS.includes(d.kind)) continue;
      meta[key] = { u: d.u, chunks: d.chunks || 0, del: !!d.del };
      const loc = app.localItem(d.kind, d.id), lu = loc ? (loc.u || 0) : -1;
      if (d.del) { if (loc && lu <= d.u) app.remove(d.kind, d.id); continue; }
      if (d.u > lu && app.wants(d.kind, d)) {
        try { const item = await readItem(key, d); if (item) app.apply(d.kind, item); } catch (e) { fail(e); }
      }
    }
    // première réponse du serveur : envoie ce que l'appareil a de plus récent (ou n'a jamais envoyé)
    if (!merged && !snap.metadata.fromCache) {
      merged = true;
      KINDS.forEach(kind => app.localList(kind).forEach(it => {
        const m = meta[kind + '_' + it.id];
        if (!m || (it.u || 0) > m.u) put(kind, it);
      }));
      app.cloudState('ok');
    }
  }
  // Réglages fusionnés champ par champ : le plus récent gagne ; à égalité (deux valeurs jamais modifiées
  // depuis la synchro, u = 0), une valeur l'emporte sur une absence (une connexion Strava n'est jamais
  // effacée par un appareil qui n'en a simplement pas). Ancien format { unit, strava, u } : u = 1 voulait dire « jamais modifié ».
  // Un champ absent du document (écrit par une ancienne version de l'app qui ne le connaît pas) ne vaut jamais
  // « effacé » : on l'ignore et l'appareil renvoie sa valeur. Seuls unit et strava existaient dans l'ancien format { unit, strava, u }.
  function remoteField(d, f) {
    if (!d) return null;
    if (d[f + 'U'] != null) return { v: d[f] === undefined ? null : d[f], u: d[f + 'U'] };
    if (d[f] === undefined || !LEGACY.includes(f)) return null;
    return { v: d[f], u: d.u > 1 ? d.u : 0 };
  }
  function onSettings(snap) {
    const d = snap.exists() ? snap.data() : null, loc = app.settings(), upd = {};
    let push = !d, missing = false;
    SETTINGS.forEach(f => {
      const r = remoteField(d, f), lv = loc[f] == null ? null : loc[f], lu = loc[f + 'U'] || 0;
      if (!r) { if (lv != null || lu) { push = true; missing = true; } return; }
      if (r.u > lu || (r.u === lu && lv == null && r.v != null)) upd[f] = r;
      else if (r.u < lu || (r.u === lu && lv != null && r.v == null)) push = true;
    });
    if (Object.keys(upd).length) app.applySettings(upd);
    if (!settingsMerged && !snap.metadata.fromCache) {
      settingsMerged = true;
      if (push) putSettings();
    } else if (settingsMerged && missing && !snap.metadata.hasPendingWrites) putSettings();   // document réécrit par une ancienne version : on y remet nos champs
  }

  A.onAuthStateChanged(auth, user => {
    unsub.forEach(f => f()); unsub = []; meta = {}; merged = false; settingsMerged = false;
    uid = user ? user.uid : null;
    if (!user) { app.cloudState('out'); app.setUser(null); return; }
    app.switchUser(user.uid);   // autre compte que la dernière fois : on repart d'un appareil vide
    app.setUser({ name: user.displayName || '', email: user.email || '' });
    app.cloudState('syncing');
    unsub.push(F.onSnapshot(F.collection(db, 'users', uid, 'items'), { includeMetadataChanges: true }, onItems, fail));
    unsub.push(F.onSnapshot(F.doc(db, 'users', uid), { includeMetadataChanges: true }, onSettings, fail));
  });

  window.TMCloud = {
    put, del, putSettings,
    async login() {
      const p = new A.GoogleAuthProvider();
      try { await A.signInWithPopup(auth, p); }
      catch (e) {
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') return A.signInWithRedirect(auth, p);
        if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
        if (e.code === 'auth/unauthorized-domain') return app.cloudState('error', 'Domaine non autorisé : ajoute « ' + location.hostname + ' » dans Firebase › Authentication › Paramètres › Domaines autorisés.');
        fail(e);
      }
    },
    logout() { return A.signOut(auth); }
  };
}
