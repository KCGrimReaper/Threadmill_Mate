# Consignes pour Claude — Threadmill Mate

## Flux de travail

1. Claude code et pousse sur la branche `develop` (jamais sur `main`).
2. Le propriétaire fait `git pull` dans VS Code et teste avec Live Server (http://127.0.0.1:5500).
3. Si c'est bon, il déploie lui-même sur Netlify (`threadmill-mate.netlify.app`) : fusion dans `main` / mise en ligne = **toujours par le propriétaire**.

Pas de chaîne de build : site statique (racine publiée telle quelle par Netlify, `netlify.toml`) + une fonction Netlify. Tout fichier ajouté à la racine est publié : rien de secret dans le dépôt.

## Architecture

- `index.html` : toute l'app (une page, JavaScript sans framework, rendu par chaînes HTML dans `render()`, état global `st`). Interface en français, sombre, police Barlow, couleur d'accent `#CBF24E`, largeur max 430 px (usage téléphone posé sur le tapis).
  - Bluetooth (Web Bluetooth, Chrome, HTTPS ou localhost) : tapis FTMS (`setupTreadmill`, consignes vitesse `sendSpeed` / pente `sendIncline` via le point de contrôle, données `parseData`), ceinture cardio (`setupHr`), reconnexion aux appareils connus (`loadKnown`).
  - Boucle 1 Hz `tick()` : distance, D+, enregistrement `rec` (une mesure / s, gardée une sur 5 dans l'historique), avancement des séances `playAdvance`.
  - Séances (`st.sessions`) : intervalles (`segments` {name, dur s, spd km/h, inc %}) ou GPX importé (`onGpx` : tronçons de 50 m `segs` {d0, d1, grade, spd}, trace `track` {d, lat, lon, ele}).
  - Historique (`st.history`, 50 courses au plus en local) : export FIT (`buildFit`), publication Strava (`stravaPublish` → fonction Netlify), forme décorative du tracé pour les courses sans GPX (`virtualPos`).
  - Allure « km-effort » : `metrics()` (v × (1 + pente/10)).
- `netlify/functions/strava.js` : échange OAuth et envoi du FIT à Strava (secrets `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` dans les variables Netlify).
- Strava : **une seule app Strava (Client ID 277538) partagée** avec Trail Planner Pro et Renfo Ultra-Trail ; domaine de retour unique `trailplannerpro.com`, dont la page `/strava-relay/` renvoie ici (state `tm`). Les pages `strava-tpp/` et `strava-renfo/` sont des relais Strava en service. **Ne jamais toucher à ce qui concerne Strava (relais, fonction Netlify, connexion) sans demande explicite du propriétaire**, ni changer le domaine de retour chez Strava sans changer les trois apps.

## Synchronisation Firebase (`cloud.js`)

- « Local d'abord » : l'app lit et écrit toujours `localStorage` (`tm_sessions`, `tm_history`, `tm_unit`, `tm_strava`) et marche sans compte ni réseau. `cloud.js` (module chargé en fin de page) recopie dans Firestore et applique les changements des autres appareils via la passerelle `window.tmApp` d'`index.html`.
- Config : `firebase-config.js` (`window.TM_FIREBASE_CONFIG`, valeurs publiques ; `null` = synchro désactivée, carte « Non configurée »). Règles : `firestore.rules` (chaque compte limité à `users/{uid}`), à coller dans la console Firebase. Connexion Google (popup, redirection en secours). SDK Firebase chargé depuis gstatic (version `V` dans `cloud.js`), cache Firestore persistant (écritures hors ligne mises en file).
- Données : `users/{uid}` = réglages {unit, strava, u} ; `users/{uid}/items/{sessions|history}_{id}` = {kind, id, u, data (JSON) | chunks, date?, del?} ; gros éléments (GPX longs) découpés en morceaux de 700 000 caractères dans `users/{uid}/chunks/{clé}_{u}_{n}` (limite Firestore 1 Mo par document).
- Règles de fusion : chaque élément porte `u` (horodatage de sa dernière modification), le plus récent gagne ; suppression = pierre tombale `del: true` (jamais de résurrection par un appareil resté hors ligne) ; à la première réponse du serveur, l'appareil envoie ce qu'il a de plus récent ou jamais envoyé (premier passage = migration des données locales). Autre compte que le précédent sur l'appareil (`tm_cloud_uid`) : données locales effacées avant la fusion.
- **Toute modification d'une séance ou d'une course doit passer par `cloudPut(kind, item)` (pose `u`) ou `cloudDel(kind, id)`, et tout réglage synchronisé par `settingsChanged()`.** Nouveau type de donnée à synchroniser : l'ajouter à `KINDS` (cloud.js) et à `LS_KEY` (index.html).
- Mise à jour venue d'un autre appareil : `softRender()` (pas de rendu pendant l'édition d'une séance ou un renommage, pour ne pas casser la saisie).

## Vérification

Pas de tests dans le dépôt. Avant de pousser : `node --check cloud.js`, contrôle de la syntaxe du script d'`index.html`, et un passage dans Chromium (Playwright, `executablePath` vers le Chromium installé) avec un faux SDK Firebase injecté par `window.__tmFirebaseLibs` (lu par `cloud.js` à la place des imports gstatic) pour la synchro.
