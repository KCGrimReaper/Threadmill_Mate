// Configuration Firebase de Threadmill Mate.
// Où la trouver : console.firebase.google.com › ton projet › Paramètres du projet (roue dentée)
//   › Général › Vos applications › application Web › « Configuration du SDK » (objet firebaseConfig).
// Ces valeurs ne sont pas secrètes (elles finissent de toute façon dans le navigateur) :
// la sécurité vient des règles Firestore (firestore.rules) qui limitent chaque compte à ses données.
// Mettre à null = app en mode local seulement (données sur cet appareil).
window.TM_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCUotF1kk7Fot53RFq3zOn0OuuQIbl1Ut0",
  authDomain: "threadmill-mate.firebaseapp.com",
  projectId: "threadmill-mate",
  storageBucket: "threadmill-mate.firebasestorage.app",
  messagingSenderId: "751548964925",
  appId: "1:751548964925:web:dc95c117a0724b3def8a54"
};
