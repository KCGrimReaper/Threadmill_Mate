# Consignes pour Claude — Threadmill Mate

## Flux de travail

1. Claude code et pousse **directement sur `main`** (décision du propriétaire, 18/10/2026 ; l'ancienne branche `develop` n'est plus utilisée).
2. Le propriétaire fait `git pull` dans VS Code et teste avec Live Server (http://127.0.0.1:5500, ouvrir `index.html` de la racine : Live Server démarre sur le fichier HTML actif de l'éditeur).
3. Netlify est relié au dépôt : **chaque push sur `main` lance un déploiement en production** (`threadmill-mate.netlify.app`). Netlify bloque le déploiement si la valeur d'une variable d'environnement apparaît dans les fichiers (contrôle des secrets) : `STRAVA_CLIENT_ID` (public) en est exclu dans `netlify.toml` ; ne jamais écrire `STRAVA_CLIENT_SECRET` nulle part.

Pas de chaîne de build : site statique (racine publiée telle quelle par Netlify, `netlify.toml`) + une fonction Netlify. Tout fichier ajouté à la racine est publié : rien de secret dans le dépôt.

## Architecture

- `index.html` : toute l'app (une page, JavaScript sans framework, rendu par chaînes HTML dans `render()`, état global `st`). Interface en français, sombre, police Barlow, couleur d'accent `#CBF24E`, largeur max 430 px (usage téléphone posé sur le tapis).
  - Bluetooth (Web Bluetooth, Chrome, HTTPS ou localhost) : tapis FTMS (`setupTreadmill`, consignes vitesse `sendSpeed` / pente `sendIncline` via le point de contrôle, données `parseData`), ceinture cardio (`setupHr`), reconnexion aux appareils connus (`loadKnown`).
  - Boucle 1 Hz `tick()` : distance, D+, enregistrement `rec` (une mesure / s, gardée une sur 5 dans l'historique), avancement des séances `playAdvance`.
  - Séances (`st.sessions`) : intervalles (`segments` {name, dur s, spd km/h, inc %}) ou GPX importé (`onGpx` : tronçons de 50 m `segs` {d0, d1, grade, spd}, trace `track` {d, lat, lon, ele}).
  - Historique (`st.history`, 50 courses au plus en local) : export FIT (`buildFit`), publication Strava (`stravaPublish` → fonction Netlify), forme décorative du tracé pour les courses sans GPX (`virtualPos`).
  - Allure « km-effort » : `metrics()` (v × (1 + pente/10)).
  - Simulation sans tapis (feuille Appareils › Simulation, `sim` / `simBelt`) : `sendSpeed` / `sendIncline` agissent directement sur `st.speed` / `st.incReal`, courroie lancée par le bouton de `simBar()` ; une course simulée n'est jamais archivée (`archiveRun`). Sert à essayer séances et vidéo sans tapis.
- `netlify/functions/strava.js` : échange OAuth et envoi du FIT à Strava (secrets `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` dans les variables Netlify).
- Strava : **une seule app Strava (Client ID 277538) partagée** avec Trail Planner Pro et Renfo Ultra-Trail ; domaine de retour unique `trailplannerpro.com`, dont la page `/strava-relay/` renvoie ici (state `tm`). Les pages `strava-tpp/` et `strava-renfo/` sont des relais Strava en service. **Ne jamais toucher à ce qui concerne Strava (relais, fonction Netlify, connexion) sans demande explicite du propriétaire**, ni changer le domaine de retour chez Strava sans changer les trois apps.

## Vidéo GoPro calée sur un GPX (`gopro.js` + section « vidéo » d'`index.html`)

- `gopro.js` (fonctions pures, `window.TMGoPro`, testables sous Node) : `readMp4Gps(file)` lit la piste de télémétrie `gpmd` du MP4 (boîte moov au début ou à la fin, stco / co64, stsc) sans charger la vidéo, `parseGpmf` décode GPS5 (HERO5–10) et GPS9 (HERO11+) en filtrant fix < 2 et précision > 5 ; `buildVideoMap(track, fichiers)` projette chaque point GPS sur le tracé (toujours vers l'avant, fenêtre de 600 m : allers-retours et boucles ; points à plus de 150 m ignorés ; refus si plus de la moitié hors tracé) et rend `map` = [[d (m), n° de fichier, t (s)]] tous les 5 m (premier instant où la vidéo atteint chaque distance : arrêts filmés sautés) ; `linearVideoMap` = sans GPS, début de la vidéo = départ, fin = arrivée ; `videoAt(video, d)` → {fi, t, vs (vitesse filmée, m/s)}. Lecteur validé contre `gopro-telemetry` sur les échantillons HERO5 à HERO11.
- Séance GPX : `sess.video` = {files: [{name, size, dur}], src: 'gps' | 'linear', d0, d1, map} (synchronisé avec la séance). Les fichiers vidéo ne quittent jamais l'appareil : `vidFiles[id]` en mémoire, poignées `showOpenFilePicker` gardées dans IndexedDB (`tm` / `vid`, clé `h_<id>`) quand le navigateur le permet, sinon fichier rechoisi à chaque lancement (contrôle nom de fichier + taille). Plusieurs fichiers GoPro (chapitres GH01…, GH02…) triés par `goproKey`.
- Lecture : élément `<video id="tmv">` permanent dans `#vbox`, **hors de `#ui`** (que `render()` réécrit chaque seconde), posé sur l'emplacement `#vslot` de la vue course par `placeVideo()` ; `videoSync()` toutes les 250 ms : instant cible pour la distance courue (interpolée depuis `lastTickAt`), vitesse de lecture = vitesse tapis ÷ vitesse filmée, corrigée de l'écart, saut au-delà de 3 s, pause tapis arrêté ; plein écran `st.vfull` (toucher la vidéo) avec les chiffres (`videoHud`).

## Synchronisation Firebase (`cloud.js`)

- « Local d'abord » : l'app lit et écrit toujours `localStorage` (`tm_sessions`, `tm_history`, `tm_unit`, `tm_strava`) et marche sans compte ni réseau. `cloud.js` (module chargé en fin de page) recopie dans Firestore et applique les changements des autres appareils via la passerelle `window.tmApp` d'`index.html`.
- Config : `firebase-config.js` (`window.TM_FIREBASE_CONFIG`, valeurs publiques ; `null` = synchro désactivée, carte « Non configurée »). Règles : `firestore.rules` (chaque compte limité à `users/{uid}`), à coller dans la console Firebase. Connexion Google (popup, redirection en secours). SDK Firebase chargé depuis gstatic (version `V` dans `cloud.js`), cache Firestore persistant (écritures hors ligne mises en file).
- Données : `users/{uid}` = réglages {unit, unitU, strava, stravaU} (fusion champ par champ, horodatages locaux `tm_unit_u` / `tm_strava_u`, 0 = jamais modifié depuis la synchro : à égalité une valeur l'emporte sur une absence, pour qu'un appareil sans Strava n'efface jamais la connexion d'un autre ; unité jamais choisie = absente ; ancien format {unit, strava, u}) ; `users/{uid}/items/{sessions|history}_{id}` = {kind, id, u, data (JSON) | chunks, date?, del?} ; gros éléments (GPX longs) découpés en morceaux de 700 000 caractères dans `users/{uid}/chunks/{clé}_{u}_{n}` (limite Firestore 1 Mo par document).
- Règles de fusion : chaque élément porte `u` (horodatage de sa dernière modification), le plus récent gagne ; suppression = pierre tombale `del: true` (jamais de résurrection par un appareil resté hors ligne) ; à la première réponse du serveur, l'appareil envoie ce qu'il a de plus récent ou jamais envoyé (premier passage = migration des données locales). Autre compte que le précédent sur l'appareil (`tm_cloud_uid`) : données locales effacées avant la fusion.
- **Toute modification d'une séance ou d'une course doit passer par `cloudPut(kind, item)` (pose `u`) ou `cloudDel(kind, id)`, et tout réglage synchronisé par `settingsChanged('<champ>')` (champ ajouté aussi à `SETTINGS` de cloud.js et à `settings` / `applySettings` de `tmApp`).** Nouveau type de donnée à synchroniser : l'ajouter à `KINDS` (cloud.js) et à `LS_KEY` (index.html).
- Mise à jour venue d'un autre appareil : `softRender()` (pas de rendu pendant l'édition d'une séance ou un renommage, pour ne pas casser la saisie).

## Vérification

Pas de tests dans le dépôt. Avant de pousser : `node --check cloud.js gopro.js`, contrôle de la syntaxe du script d'`index.html`, et un passage dans Chromium (Playwright, `executablePath` vers le Chromium installé) avec un faux SDK Firebase injecté par `window.__tmFirebaseLibs` (lu par `cloud.js` à la place des imports gstatic) pour la synchro.
