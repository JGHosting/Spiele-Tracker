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

## Auf GitHub Pages veröffentlichen
1. Dateien liegen im Repo-Root.
2. Im Repo: **Settings → Pages → Source: Deploy from a branch → `main` / `root`** → Save.
3. Nach ca. 1 Minute läuft die App unter `https://jghosting.github.io/Spiele-Tracker/`.

## Aufs Handy
- **iPhone (Safari):** Teilen → „Zum Home-Bildschirm“
- **Android (Chrome):** Menü → „App installieren“

## Hinweise
- Daten liegen im `localStorage` des jeweiligen Geräts/Browsers. Am besten ein Handy zum Eintragen nutzen und regelmäßig ein Backup exportieren.
- Nach Code-Änderungen in `sw.js` die `VERSION` hochzählen, damit installierte Apps das Update laden.
