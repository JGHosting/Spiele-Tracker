// Firebase-Konfiguration für die geräteübergreifende Synchronisierung.
//
// Solange hier null steht, läuft die App wie bisher nur lokal auf dem Gerät.
// Einrichtung: siehe README → "Synchronisierung einrichten".
//
// Diese Werte sind nicht geheim – sie identifizieren nur das Firebase-Projekt.
// Geschützt werden die Daten durch Anmeldung + Sicherheitsregeln (firestore.rules).
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB5L6HNWPn8NS411g2GymiKtTGBF9WRmLI',
  authDomain: 'spieletracker-app.firebaseapp.com',
  projectId: 'spieletracker-app',
  storageBucket: 'spieletracker-app.firebasestorage.app',
  messagingSenderId: '679923620143',
  appId: '1:679923620143:web:40b6102ebe07e2c5d0a9da'
};

// Beispiel:
// window.FIREBASE_CONFIG = {
//   apiKey: '…',
//   authDomain: 'spiele-tracker-xxxx.firebaseapp.com',
//   projectId: 'spiele-tracker-xxxx',
//   storageBucket: 'spiele-tracker-xxxx.firebasestorage.app',
//   messagingSenderId: '…',
//   appId: '…'
// };
