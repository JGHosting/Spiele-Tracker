# 🎲 Spieleabend

Kleine Web-App (PWA), um Spiele zu zweit zu tracken: Siege, Punkte und Statistiken.
Läuft komplett ohne Server über GitHub Pages und lässt sich aufs Handy installieren.

## Features
- Spiele anlegen mit Emoji und Wertungsart:
  - **Höchste Punkte gewinnen** (Kniffel, Qwixx, Ganz schön clever)
  - **Wenigste Punkte gewinnen** (Skyjo, Golf …)
  - **Verlierer bekommt Minuspunkte** (Rummikub – optional bekommt der Gewinner sie als Plus)
  - **Nur Sieg / Niederlage**
- Partien eintragen, Gewinner wird automatisch bestimmt
- Verlauf mit Filter pro Spiel
- Statistik: Gesamtstand, Siegquote, Serien, Form, pro Spiel Ø-Punkte, Bestwert, Bilanz, Punkteverlauf
- Spielernamen und Farben anpassbar
- Backup als JSON exportieren/importieren
- Hell/Dunkel automatisch, offline nutzbar
- Optional: **Synchronisierung zwischen Geräten** mit Konto, privaten und geteilten Spielen

## Auf GitHub Pages veröffentlichen
1. Dateien liegen im Repo-Root.
2. Im Repo: **Settings → Pages → Source: Deploy from a branch → `main` / `root`** → Save.
3. Nach ca. 1 Minute läuft die App unter `https://jghosting.github.io/Spiele-Tracker/`.

## Aufs Handy
- **iPhone (Safari):** Teilen → „Zum Home-Bildschirm“
- **Android (Chrome):** Menü → „App installieren“

## Synchronisierung zwischen Geräten

Ohne Einrichtung läuft die App wie bisher nur lokal (Safari-Speicher). Mit einem kostenlosen
Firebase-Projekt kann sich jede Person mit eigenem Konto anmelden.

**So funktioniert es**
- **Konto (E-Mail + Passwort)** pro Person. Funktioniert auch in der App vom Home-Bildschirm.
- **Privat ist Standard:** Eigene Spiele und Partien liegen unter `users/{uid}` und sind nur für einen selbst sichtbar.
- **Gezielt teilen:** Eine Person erstellt unter *Mehr → Gemeinsam spielen* eine Gruppe und gibt den 6-stelligen Code weiter (7 Tage gültig). Danach lässt sich jedes Spiel über ✎ → *Sichtbarkeit* teilen (👥) oder privat halten (🔒). Partien wandern beim Umschalten mit.
- **Lokale Daten werden übernommen:** Beim ersten Anmelden fragt die App, ob die Daten dieses Geräts ins Konto sollen. Die lokale Kopie bleibt als Sicherung erhalten. IDs bleiben gleich, mehrfaches Übernehmen erzeugt also keine Duplikate.
- **Offline:** Firestore speichert alles zusätzlich in IndexedDB. Eintragen geht auch ohne Netz, die Änderungen werden beim nächsten Verbindungsaufbau übertragen. Das Wolken-Symbol oben zeigt den Status (grün = synchron, orange = wird übertragen, grau = offline).
- **Konflikte:** Jede Partie ist ein eigenes Dokument mit eindeutiger ID. Gleichzeitige Einträge auf zwei Handys kollidieren deshalb nie. Bei Änderungen am selben Spiel gewinnt die zuletzt übertragene. Partien zu einem inzwischen gelöschten Spiel werden ausgeblendet.

**Einrichtung (einmalig, ca. 10 Minuten, am besten am Computer)**
1. [console.firebase.google.com](https://console.firebase.google.com) → *Projekt erstellen* (z. B. `spiele-tracker`, Google Analytics aus). Der kostenlose Spark-Tarif reicht bei Weitem.
2. *Build → Authentication → Jetzt starten → Anmeldemethode*: **E-Mail/Passwort** aktivieren.
3. *Build → Firestore Database → Datenbank erstellen*: Standort **eur3 (Europa)** oder `europe-west3` (Frankfurt), **Produktionsmodus**.
4. *Firestore → Regeln*: Inhalt von [`firestore.rules`](firestore.rules) komplett einfügen → **Veröffentlichen**.
5. *Projekteinstellungen (Zahnrad) → Allgemein → Meine Apps → Web (`</>`)*: App registrieren (Hosting nicht nötig), das angezeigte `firebaseConfig`-Objekt kopieren und in [`config.js`](config.js) als `window.FIREBASE_CONFIG = { … };` eintragen.
6. *Authentication → Einstellungen → Autorisierte Domains*: `jghosting.github.io` hinzufügen.

Die Werte in `config.js` sind nicht geheim, sie benennen nur das Projekt. Geschützt werden die Daten durch Anmeldung und die Sicherheitsregeln.

**Firebase-Bundle neu bauen** (nur bei SDK-Update nötig):
```bash
npm i firebase@12.19.0 esbuild
npx esbuild vendor/firebase-entry.js --bundle --format=esm --minify --outfile=vendor/firebase.js
```

## Hinweise
- Ohne Konto liegen die Daten im `localStorage` des jeweiligen Geräts/Browsers. Regelmäßig ein Backup exportieren.
- Nach Code-Änderungen in `sw.js` die `VERSION` hochzählen, damit installierte Apps das Update laden.
