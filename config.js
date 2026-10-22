// Firebase-Konfiguration für die geräteübergreifende Synchronisierung.
//
// Solange hier null steht, läuft die App wie bisher nur lokal auf dem Gerät.
// Einrichtung: siehe README → "Synchronisierung einrichten".
//
// Diese Werte sind nicht geheim – sie identifizieren nur das Firebase-Projekt.
// Geschützt werden die Daten durch Anmeldung + Sicherheitsregeln (firestore.rules).
window.FIREBASE_CONFIG = null;

// Beispiel:
// window.FIREBASE_CONFIG = {
//   apiKey: '…',
//   authDomain: 'spiele-tracker-xxxx.firebaseapp.com',
//   projectId: 'spiele-tracker-xxxx',
//   storageBucket: 'spiele-tracker-xxxx.firebasestorage.app',
//   messagingSenderId: '…',
//   appId: '…'
// };
