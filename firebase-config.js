// Configuration Firebase de Threadmill Mate.
// Où la trouver : console.firebase.google.com › ton projet › Paramètres du projet (roue dentée)
//   › Général › Vos applications › application Web › « Configuration du SDK » (objet firebaseConfig).
// Ces valeurs ne sont pas secrètes (elles finissent de toute façon dans le navigateur) :
// la sécurité vient des règles Firestore (firestore.rules) qui limitent chaque compte à ses données.
// Laisser à null = app en mode local seulement (données sur cet appareil, comme avant).
window.TM_FIREBASE_CONFIG = null;
/* Exemple :
window.TM_FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "threadmill-mate.firebaseapp.com",
  projectId: "threadmill-mate",
  storageBucket: "threadmill-mate.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
};
*/
