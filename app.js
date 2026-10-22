'use strict';

/* ---------- Grundlagen ---------- */
const KEY = 'spieleabend.v1';
const APP_VERSION = 17;

const TYPES = {
  high:       { label: 'Höchste Punkte gewinnen',       short: 'Punkte ↑',    desc: 'z. B. Kniffel, Qwixx – wer mehr Punkte hat, gewinnt' },
  low:        { label: 'Wenigste Punkte gewinnen',      short: 'Punkte ↓',    desc: 'z. B. Skyjo, Golf – wer weniger Punkte hat, gewinnt' },
  loserMinus: { label: 'Verlierer bekommt Minuspunkte', short: 'Minuspunkte', desc: 'z. B. Rummikub – Gewinner wählen, Verlierer zahlt' },
  winOnly:    { label: 'Nur Sieg / Niederlage',         short: 'Sieg',        desc: 'z. B. Schach – nur wer gewinnt, zählt' }
};

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function defaults() {
  return {
    players: [
      { id: 'p1', name: 'Jakob', color: '#7c5cff' },
      { id: 'p2', name: 'Emma', color: '#ff5c8a' }
    ],
    games: [
      { id: uid(), name: 'Kniffel', emoji: '🎲', type: 'high' },
      { id: uid(), name: 'Qwixx', emoji: '✖️', type: 'high' },
      { id: uid(), name: 'Ganz schön clever', emoji: '🧠', type: 'high' },
      { id: uid(), name: 'Rummikub', emoji: '🀄', type: 'loserMinus', winnerGetsPoints: true }
    ],
    matches: []
  };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.players) && Array.isArray(s.games) && Array.isArray(s.matches)) return s;
  } catch (e) { /* ignore */ }
  return defaults();
}
// Lokale Daten (Safari-Speicher) – im Konto-Modus bleiben sie unangetastet als Sicherung liegen
function save() {
  if (mode !== 'local') return;
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { toast('Speichern fehlgeschlagen'); }
}
window.localSnapshot = () => load();

/* ---------- Modus: lokal oder Konto (Sync) ---------- */
const CACHE_KEY = 'spieleabend.cloudcache';
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

let mode = 'local';
let cloudInfo = null;
let syncStatus = 'synced';
let state = load();
// War zuletzt jemand angemeldet, sofort den letzten Konto-Stand zeigen (bis die Synchronisierung bereit ist)
try {
  const c = JSON.parse(lsGet(CACHE_KEY));
  if (c && c.state && Array.isArray(c.state.games)) { state = c.state; mode = 'cloud'; }
} catch (e) { /* ignore */ }

const isCloud = () => mode === 'cloud';
const hasGroup = () => !!(cloudInfo && cloudInfo.group);
const partnerName = () => hasGroup() ? pName(cloudInfo.group.partnerSlot) : 'Partner';

let opQueue = [];
// Änderung speichern: lokal → Safari-Speicher, Konto → Firestore (funktioniert auch offline)
function persist(op, ...args) {
  if (!isCloud()) { save(); return; }
  if (!window.Cloud || !Cloud.user) { opQueue.push([op, args]); return; }
  runOp(op, args);
}
function runOp(op, args) {
  Promise.resolve()
    .then(() => Cloud[op](...args))
    .catch(err => { console.error(op, err); toast('Sync-Fehler: ' + errText(err)); });
}
let tab = 'games';
let histFilter = 'all';
let draft = {};
let gdraft = {};
let sheetMode = null;

/* ---------- Helfer ---------- */
const gameById = id => state.games.find(g => g.id === id);
const player = id => state.players.find(p => p.id === id);
const pName = id => (player(id) || {}).name || '?';
const pColor = id => (player(id) || {}).color || '#888';
const byDesc = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.created || 0) - (a.created || 0);
const sortDesc = ms => [...ms].sort(byDesc);
const sortAsc = ms => [...ms].sort((a, b) => byDesc(b, a));
const matchesOf = gid => sortDesc(state.matches.filter(m => m.gameId === gid));
const winsOf = (ms, pid) => ms.filter(m => m.winner === pid).length;
const pct = (x, n) => n ? Math.round(x / n * 100) : 0;
const fmtN = n => (n == null || isNaN(n)) ? '–' : (Math.round(n * 10) / 10).toLocaleString('de-DE');
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const fmtDate = s => new Date(s + 'T12:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
function relDate(s) {
  const diff = Math.round((new Date(today() + 'T12:00') - new Date(s + 'T12:00')) / 864e5);
  if (diff === 0) return 'heute';
  if (diff === 1) return 'gestern';
  if (diff < 7) return `vor ${diff} Tagen`;
  return 'am ' + fmtDate(s);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- Navigation ---------- */
const TITLES = { games: 'Spiele', history: 'Verlauf', stats: 'Statistik', more: 'Einstellungen' };

function setTab(t) { tab = t; render(); $('#view').scrollTop = 0; }

let lastTab = null;
function render() {
  renderPending = false;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#title').textContent = TITLES[tab];
  $('#topAction').style.visibility = tab === 'games' ? 'visible' : 'hidden';
  renderSync();
  const views = { games: viewGames, history: viewHistory, stats: viewStats, more: viewMore };
  // Einblend-Animation nur beim Tab-Wechsel, nicht bei jedem Sync-Update
  $('#view').innerHTML = `<div class="${tab !== lastTab ? 'fade' : ''}">${views[tab]()}</div>`;
  lastTab = tab;
}

// Updates aus der Cloud nicht anwenden, während jemand gerade in ein Feld tippt
let renderPending = false;
function renderSoon() {
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && $('#view').contains(a)) { renderPending = true; return; }
  render();
}
document.addEventListener('focusout', () => setTimeout(() => { if (renderPending) renderSoon(); }, 0));

function renderSync() {
  const b = $('#syncBtn');
  if (!b) return;
  b.classList.toggle('hidden', !isCloud());
  b.dataset.s = syncStatus;
}
const STATUS_TEXT = {
  synced: 'Alles synchronisiert',
  syncing: 'Änderungen werden übertragen …',
  offline: 'Offline – Änderungen werden gespeichert und später übertragen'
};
function showSync() { toast((STATUS_TEXT[syncStatus] || '') + (cloudInfo ? ' · ' + cloudInfo.email : '')); }

/* ---------- Bausteine ---------- */
function duelCard(ms, sub) {
  const [a, b] = state.players;
  const wa = winsOf(ms, a.id), wb = winsOf(ms, b.id);
  const tot = wa + wb;
  const pa = tot ? wa / tot * 100 : 50;
  const lead = wa === wb ? 'Gleichstand' : `${esc(wa > wb ? a.name : b.name)} führt`;
  return `
  <div class="card duel">
    <div class="duel-row">
      <div class="duel-p"><span class="dot" style="background:${a.color}"></span>${esc(a.name)}</div>
      <div class="duel-num"><span style="color:${a.color}">${wa}</span><i>:</i><span style="color:${b.color}">${wb}</span></div>
      <div class="duel-p right">${esc(b.name)}<span class="dot" style="background:${b.color}"></span></div>
    </div>
    <div class="bar ${tot ? '' : 'zero'}"><div style="width:${pa}%;background:${a.color}"></div><div style="width:${100 - pa}%;background:${b.color}"></div></div>
    <div class="duel-foot"><span>${lead}</span><span>${sub}</span></div>
  </div>`;
}

function empty(title, text) {
  return `<div class="empty"><div class="empty-ico">🎲</div><b>${title}</b><p>${text}</p></div>`;
}

function matchRow(m, showGame) {
  const g = gameById(m.gameId);
  const [a, b] = state.players;
  const sc = m.scores ? `${fmtN(m.scores[a.id])} : ${fmtN(m.scores[b.id])}` : '';
  const badge = m.winner === 'draw'
    ? `<span class="badge">Unentschieden</span>`
    : `<span class="badge" style="--c:${pColor(m.winner)}">🏆 ${esc(pName(m.winner))}</span>`;
  const title = showGame ? esc(g ? g.name : 'Gelöschtes Spiel') : fmtDate(m.date);
  const sub = showGame ? fmtDate(m.date) + (sc ? ' · ' + sc : '') : (sc || '&nbsp;');
  return `
  <div class="row">
    ${showGame ? `<span class="emoji">${esc(g ? g.emoji : '❔')}</span>` : ''}
    <div class="row-main"><div class="row-title">${title}</div><div class="muted small">${sub}</div></div>
    ${badge}
    <button class="icon-btn sm ghost" onclick="delMatch('${m.id}')" aria-label="Partie löschen">✕</button>
  </div>`;
}

/* ---------- Tab: Spiele ---------- */
function viewGames() {
  const [a, b] = state.players;
  let html = installHint() + duelCard(state.matches, `${state.matches.length} Partien`);
  html += '<div class="grid">';
  for (const g of state.games) {
    const ms = matchesOf(g.id);
    const last = ms[0];
    const vis = hasGroup() ? `<span class="vis" title="${g.space === 'grp' ? 'Geteilt' : 'Privat'}">${g.space === 'grp' ? '👥' : '🔒'}</span>` : '';
    html += `
    <button class="game-card" onclick="openGame('${g.id}')">
      <div class="gc-top"><span class="emoji">${esc(g.emoji || '🎲')}</span><span class="pill">${vis}${TYPES[g.type].short}</span></div>
      <div class="gc-name">${esc(g.name)}</div>
      <div class="gc-score"><span style="color:${a.color}">${winsOf(ms, a.id)}</span><i>:</i><span style="color:${b.color}">${winsOf(ms, b.id)}</span></div>
      <div class="gc-meta">${last ? 'Zuletzt ' + relDate(last.date) : 'Noch nicht gespielt'}</div>
    </button>`;
  }
  html += `<button class="game-card add" onclick="editGame()"><span class="plus">+</span><span>Neues Spiel</span></button></div>`;
  return html;
}

/* ---------- Partie eintragen ---------- */
function openGame(id) {
  draft = { gameId: id, winner: null };
  sheetMode = 'game';
  openSheet(gameSheet(gameById(id)));
}

function gameSheet(g) {
  let form = '';
  if (g.type === 'high' || g.type === 'low') {
    form = `<div class="score-inputs">${state.players.map(p => `
      <label class="score-in" style="--c:${p.color}">
        <span>${esc(p.name)}</span>
        <input type="number" inputmode="numeric" id="s_${p.id}" placeholder="0">
      </label>`).join('')}</div>`;
  } else {
    form = `<div class="seg" id="winSeg">${state.players.map(p =>
      `<button type="button" data-w="${p.id}" style="--c:${p.color}" onclick="pickWinner('${p.id}')">🏆 ${esc(p.name)}</button>`).join('')}
      ${g.type === 'winOnly' ? `<button type="button" data-w="draw" onclick="pickWinner('draw')">Unentschieden</button>` : ''}</div>`;
    if (g.type === 'loserMinus') {
      form += `
      <label class="field"><span>Minuspunkte des Verlierers</span>
        <input type="number" inputmode="numeric" id="minusPts" placeholder="z. B. 34" min="0"></label>
      <p class="hint">${g.winnerGetsPoints ? 'Der Gewinner bekommt dieselben Punkte als Plus gutgeschrieben.' : 'Der Gewinner bekommt 0 Punkte.'}</p>`;
    }
  }
  const ms = matchesOf(g.id).slice(0, 5);
  return `
    <div class="sheet-head">
      <span class="emoji big">${esc(g.emoji)}</span>
      <div class="grow"><h2>${esc(g.name)}</h2><div class="muted small">${TYPES[g.type].label}</div></div>
      <button class="icon-btn ghost" onclick="editGame('${g.id}')" aria-label="Spiel bearbeiten">✎</button>
    </div>
    <div class="label">${g.type === 'high' || g.type === 'low' ? 'Neue Partie' : 'Wer hat gewonnen?'}</div>
    ${form}
    <label class="field"><span>Datum</span><input type="date" id="mDate" value="${today()}"></label>
    <button class="btn primary" onclick="saveMatch()">Partie speichern</button>
    ${ms.length ? `<div class="label">Letzte Partien</div><div class="list">${ms.map(m => matchRow(m, false)).join('')}</div>` : ''}`;
}

function pickWinner(w) {
  draft.winner = w;
  document.querySelectorAll('#winSeg button').forEach(b => b.classList.toggle('on', b.dataset.w === w));
}

function saveMatch() {
  const g = gameById(draft.gameId);
  if (!g) { closeSheet(); toast('Dieses Spiel gibt es nicht mehr'); return; }
  const date = $('#mDate').value || today();
  let scores = null, winner = null;

  if (g.type === 'high' || g.type === 'low') {
    scores = {};
    for (const p of state.players) {
      const v = $('#s_' + p.id).value;
      if (v === '') { toast('Bitte beide Punktzahlen eintragen'); return; }
      scores[p.id] = Number(v);
    }
    const [a, b] = state.players;
    const sa = scores[a.id], sb = scores[b.id];
    winner = sa === sb ? 'draw' : ((sa > sb) === (g.type === 'high') ? a.id : b.id);
  } else {
    if (!draft.winner) { toast('Bitte den Gewinner auswählen'); return; }
    winner = draft.winner;
    if (g.type === 'loserMinus') {
      const v = $('#minusPts').value;
      if (v === '') { toast('Bitte die Minuspunkte eintragen'); return; }
      const pts = Math.abs(Number(v));
      scores = {};
      for (const p of state.players) scores[p.id] = p.id === winner ? (g.winnerGetsPoints ? pts : 0) : -pts;
    }
  }

  const m = { id: uid(), gameId: g.id, date, winner, scores, created: Date.now() };
  state.matches.push({ ...m, space: g.space });
  persist('addMatch', m, g.space);
  closeSheet();
  render();
  toast(winner === 'draw' ? '🤝 Unentschieden gespeichert' : `🏆 ${pName(winner)} gewinnt!`);
}

async function delMatch(id) {
  if (!await ask('Diese Partie löschen?')) return;
  const m = state.matches.find(x => x.id === id);
  if (!m) return;
  state.matches = state.matches.filter(x => x.id !== id);
  persist('deleteMatch', m);
  if (sheetMode === 'game' && draft.gameId) openSheet(gameSheet(gameById(draft.gameId)));
  render();
}

/* ---------- Spiel anlegen / bearbeiten ---------- */
function editGame(id) {
  const g = id ? gameById(id) : null;
  const locked = g && state.matches.some(m => m.gameId === g.id);
  // Neue Spiele sind standardmäßig privat – Teilen ist eine bewusste Entscheidung
  gdraft = { id: g ? g.id : null, type: g ? g.type : 'high', space: g ? g.space : (isCloud() ? 'me' : undefined) };
  sheetMode = 'edit';
  const visBlock = isCloud() && hasGroup() ? `
    <div class="label">Sichtbarkeit</div>
    <div class="seg" id="visSeg">
      <button type="button" data-v="me" class="${gdraft.space === 'me' ? 'on' : ''}" onclick="pickVis('me')">🔒 Nur ich</button>
      <button type="button" data-v="grp" class="${gdraft.space === 'grp' ? 'on' : ''}" onclick="pickVis('grp')">👥 Mit ${esc(partnerName())}</button>
    </div>
    <p class="hint">${g ? 'Beim Ändern wandern alle Partien dieses Spiels mit.' : 'Private Spiele sieht nur du. Geteilte Spiele sehen und bearbeiten beide.'}</p>` : '';
  openSheet(`
    <div class="sheet-head"><h2 class="grow">${g ? 'Spiel bearbeiten' : 'Neues Spiel'}</h2></div>
    <div class="name-row">
      <input id="gEmoji" class="emoji-input" maxlength="4" value="${g ? esc(g.emoji) : '🎲'}" aria-label="Emoji">
      <input id="gName" class="text" placeholder="Name des Spiels" value="${g ? esc(g.name) : ''}">
    </div>
    <div class="label">Wertung</div>
    <div class="type-list">${Object.entries(TYPES).map(([k, t]) => `
      <button type="button" class="type-opt ${k === gdraft.type ? 'on' : ''}" data-t="${k}" ${locked ? 'disabled' : ''} onclick="pickType('${k}')">
        <b>${t.label}</b><span>${t.desc}</span>
      </button>`).join('')}</div>
    ${locked ? '<p class="hint">Die Wertung ist fest, weil schon Partien eingetragen sind.</p>' : ''}
    <label class="toggle ${gdraft.type === 'loserMinus' ? '' : 'hidden'}" id="wgpRow">
      <input type="checkbox" id="gWgp" ${!g || g.winnerGetsPoints ? 'checked' : ''}>
      <span>Gewinner bekommt die Minuspunkte des Verlierers als Pluspunkte</span>
    </label>
    ${visBlock}
    <button class="btn primary" onclick="saveGame()">Speichern</button>
    ${g ? `<button class="btn danger" onclick="delGame('${g.id}')">Spiel löschen</button>` : ''}`);
  if (!g) setTimeout(() => $('#gName').focus(), 300);
}

function pickType(t) {
  gdraft.type = t;
  document.querySelectorAll('.type-opt').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  $('#wgpRow').classList.toggle('hidden', t !== 'loserMinus');
}

function pickVis(v) {
  gdraft.space = v;
  document.querySelectorAll('#visSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
}

function saveGame() {
  const name = $('#gName').value.trim();
  if (!name) { toast('Bitte einen Namen eingeben'); return; }
  const data = {
    name,
    emoji: $('#gEmoji').value.trim() || '🎲',
    type: gdraft.type,
    winnerGetsPoints: gdraft.type === 'loserMinus' ? $('#gWgp').checked : undefined
  };
  if (gdraft.id) {
    const g = gameById(gdraft.id);
    if (!g) { closeSheet(); return; }
    Object.assign(g, data);
    persist('saveGame', { ...g });
    // Sichtbarkeit geändert → Spiel samt Partien verschieben
    if (isCloud() && gdraft.space && gdraft.space !== g.space) {
      persist('moveGame', { ...g }, gdraft.space);
      toast(gdraft.space === 'grp' ? `👥 Mit ${partnerName()} geteilt` : '🔒 Jetzt privat');
    } else toast('Spiel aktualisiert');
  } else {
    const g = { id: uid(), ...data, created: Date.now(), space: gdraft.space };
    state.games.push(g);
    persist('saveGame', g);
    toast(`${data.emoji} ${name} angelegt`);
  }
  closeSheet();
  render();
}

async function delGame(id) {
  const g = gameById(id);
  if (!g) return;
  const n = state.matches.filter(m => m.gameId === id).length;
  const shared = isCloud() && g.space === 'grp' ? ` Es verschwindet auch bei ${partnerName()}.` : '';
  if (!await ask(`Spiel${n ? ` und ${n} Partie${n > 1 ? 'n' : ''}` : ''} wirklich löschen?${shared}`)) return;
  state.games = state.games.filter(x => x.id !== id);
  state.matches = state.matches.filter(m => m.gameId !== id);
  if (histFilter === id) histFilter = 'all';
  persist('deleteGame', g);
  closeSheet();
  render();
}

/* ---------- Tab: Verlauf ---------- */
function setHist(f) { histFilter = f; render(); }

function viewHistory() {
  const chips = `<div class="chips">
    <button class="chip ${histFilter === 'all' ? 'on' : ''}" onclick="setHist('all')">Alle</button>
    ${state.games.map(g => `<button class="chip ${histFilter === g.id ? 'on' : ''}" onclick="setHist('${g.id}')">${esc(g.emoji)} ${esc(g.name)}</button>`).join('')}
  </div>`;
  const ms = sortDesc(state.matches.filter(m => histFilter === 'all' || m.gameId === histFilter));
  if (!ms.length) return chips + empty('Noch keine Partien', 'Tippe unter „Spiele“ auf ein Spiel, um die erste Partie einzutragen.');

  let html = chips, month = '';
  for (const m of ms) {
    const mo = new Date(m.date + 'T12:00').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    if (mo !== month) { html += `${month ? '</div>' : ''}<div class="label">${mo}</div><div class="list card">`; month = mo; }
    html += matchRow(m, true);
  }
  return html + '</div>';
}

/* ---------- Tab: Statistik ---------- */
function streaks(ms) {
  const best = {};
  state.players.forEach(p => best[p.id] = 0);
  let cur = null, n = 0;
  for (const m of ms) {
    if (!m.winner || m.winner === 'draw') { cur = null; n = 0; continue; }
    if (m.winner === cur) n++; else { cur = m.winner; n = 1; }
    if (n > (best[cur] || 0)) best[cur] = n;
  }
  return { best, current: cur ? { id: cur, n } : null };
}

const tile = (label, value, color) =>
  `<div class="tile"><div class="tile-v" ${color ? `style="color:${color}"` : ''}>${value}</div><div class="tile-l">${label}</div></div>`;

function viewStats() {
  const all = state.matches;
  if (!all.length) return empty('Noch keine Statistik', 'Sobald ihr Partien eintragt, erscheinen hier eure Zahlen.');
  const [a, b] = state.players;
  const draws = all.filter(m => m.winner === 'draw').length;
  const st = streaks(sortAsc(all));
  const form = sortDesc(all).slice(0, 12).reverse();

  let html = duelCard(all, `${all.length} Partien${draws ? ` · ${draws} unentschieden` : ''}`);
  html += `<div class="tiles">
    ${tile('Siegquote ' + esc(a.name), pct(winsOf(all, a.id), all.length) + ' %', a.color)}
    ${tile('Siegquote ' + esc(b.name), pct(winsOf(all, b.id), all.length) + ' %', b.color)}
    ${tile('Aktuelle Serie', st.current ? `${st.current.n}× ${esc(pName(st.current.id))}` : '–', st.current ? pColor(st.current.id) : null)}
    ${tile('Längste Serie', `<span style="color:${a.color}">${st.best[a.id]}</span> / <span style="color:${b.color}">${st.best[b.id]}</span>`)}
  </div>`;

  html += `<div class="card"><div class="label tight">Letzte Partien</div><div class="form">${form.map(m =>
    `<span class="fdot" title="${esc((gameById(m.gameId) || {}).name || '')}" style="background:${m.winner === 'draw' ? 'var(--muted)' : pColor(m.winner)}"></span>`).join('')}</div></div>`;

  html += '<div class="label">Nach Spiel</div>' + state.games.map(gameStatCard).join('');
  return html;
}

function sparkline(ms, g) {
  const pts = sortAsc(ms).filter(m => m.scores).slice(-20);
  if (pts.length < 2) return '';
  const vals = pts.flatMap(m => state.players.map(p => m.scores[p.id]));
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const W = 300, H = 70, pad = 6;
  const line = p => pts.map((m, i) => {
    const x = pad + i * (W - 2 * pad) / (pts.length - 1);
    const y = H - pad - (m.scores[p.id] - min) / span * (H - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${state.players.map(p =>
    `<polyline points="${line(p)}" fill="none" stroke="${p.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`).join('')}</svg>
    <div class="muted small">Punkteverlauf der letzten ${pts.length} Partien</div>`;
}

function gameStatCard(g) {
  const ms = matchesOf(g.id);
  const [a, b] = state.players;
  if (!ms.length) return `<div class="card gstat dim"><div class="gstat-head"><span class="emoji">${esc(g.emoji)}</span><b>${esc(g.name)}</b><span class="muted small">noch keine Partien</span></div></div>`;

  const wa = winsOf(ms, a.id), wb = winsOf(ms, b.id), tot = wa + wb;
  const pa = tot ? wa / tot * 100 : 50;
  const scored = ms.filter(m => m.scores);
  const vals = id => scored.map(m => m.scores[id]);
  const avg = id => vals(id).length ? vals(id).reduce((s, v) => s + v, 0) / vals(id).length : null;
  const sum = id => vals(id).reduce((s, v) => s + v, 0);

  const rows = [['Siege', wa, wb], ['Siegquote', pct(wa, ms.length) + ' %', pct(wb, ms.length) + ' %']];
  if (g.type === 'high' || g.type === 'low') {
    const best = id => vals(id).length ? (g.type === 'high' ? Math.max(...vals(id)) : Math.min(...vals(id))) : null;
    rows.push(['Ø Punkte', fmtN(avg(a.id)), fmtN(avg(b.id))]);
    rows.push(['Bestwert', fmtN(best(a.id)), fmtN(best(b.id))]);
  } else if (g.type === 'loserMinus') {
    const worst = id => vals(id).length ? Math.min(...vals(id)) : null;
    rows.push(['Bilanz', fmtN(sum(a.id)), fmtN(sum(b.id))]);
    rows.push(['Ø pro Partie', fmtN(avg(a.id)), fmtN(avg(b.id))]);
    rows.push(['Schlimmste Runde', fmtN(worst(a.id)), fmtN(worst(b.id))]);
  }

  return `
  <div class="card gstat">
    <div class="gstat-head"><span class="emoji">${esc(g.emoji)}</span><b>${esc(g.name)}</b><span class="muted small">${ms.length} Partien</span></div>
    <div class="bar slim"><div style="width:${pa}%;background:${a.color}"></div><div style="width:${100 - pa}%;background:${b.color}"></div></div>
    <div class="stable">
      <span></span><span class="th" style="color:${a.color}">${esc(a.name)}</span><span class="th" style="color:${b.color}">${esc(b.name)}</span>
      ${rows.map(r => `<span class="muted">${r[0]}</span><span>${r[1]}</span><span>${r[2]}</span>`).join('')}
    </div>
    ${g.type === 'high' || g.type === 'low' ? sparkline(ms, g) : ''}
  </div>`;
}

/* ---------- Tab: Mehr ---------- */
function viewMore() {
  return `
  ${accountCard()}
  ${groupCard()}
  <div class="card">
    <div class="label tight">Spieler${hasGroup() ? ' <span class="muted">· für beide</span>' : ''}</div>
    ${state.players.map(p => `
      <div class="player-edit">
        <label class="color-pick" style="background:${p.color}"><input type="color" value="${p.color}" onchange="setPlayer('${p.id}','color',this.value)" aria-label="Farbe"></label>
        <input class="text" value="${esc(p.name)}" oninput="typeName('${p.id}',this.value)" onblur="setPlayer('${p.id}','name',this.value)" enterkeyhint="done" onkeydown="if(event.key==='Enter')this.blur()" aria-label="Name">
      </div>`).join('')}
  </div>
  <div class="card">
    <div class="label tight">Daten</div>
    <button class="btn" onclick="exportData()">⬇︎ Backup exportieren</button>
    <label class="btn">⬆︎ Backup importieren<input type="file" accept="application/json,.json" hidden onchange="importData(this)"></label>
    ${isCloud() && localPending() ? `<button class="btn" onclick="offerMigration(true)">📥 Lokale Daten übernehmen</button>` : ''}
    ${isCloud() ? '' : `<button class="btn danger" onclick="resetAll()">Alle Daten löschen</button>`}
  </div>
  <p class="muted small center">${isCloud()
    ? 'Deine Daten liegen in deinem Konto und sind auch offline verfügbar.'
    : 'Alle Daten liegen lokal auf diesem Gerät.<br>Mach ab und zu ein Backup.'}</p>
  <div class="version">Version ${APP_VERSION}</div>`;
}

/* ---------- Konto & Gruppe ---------- */
const AUTH_ERRORS = {
  'auth/invalid-credential': 'E-Mail oder Passwort falsch',
  'auth/wrong-password': 'E-Mail oder Passwort falsch',
  'auth/user-not-found': 'E-Mail oder Passwort falsch',
  'auth/invalid-email': 'Ungültige E-Mail-Adresse',
  'auth/missing-password': 'Bitte ein Passwort eingeben',
  'auth/email-already-in-use': 'Für diese E-Mail gibt es schon ein Konto – bitte anmelden',
  'auth/weak-password': 'Passwort zu kurz (mind. 6 Zeichen)',
  'auth/network-request-failed': 'Keine Internetverbindung',
  'auth/too-many-requests': 'Zu viele Versuche – bitte kurz warten',
  'invite/not-found': 'Code nicht gefunden oder schon benutzt',
  'invite/expired': 'Code abgelaufen – bitte einen neuen erstellen lassen',
  'invite/own': 'Das ist dein eigener Code – teile ihn mit deiner Partnerin',
  'permission-denied': 'Keine Berechtigung (Code abgelaufen oder Gruppe voll?)',
  'unavailable': 'Keine Internetverbindung',
  'loading-timeout': 'Synchronisierung lädt nicht – Internetverbindung prüfen und App neu öffnen',
  'auth/operation-not-allowed': 'E-Mail-Anmeldung ist in Firebase noch nicht aktiviert',
  'auth/configuration-not-found': 'E-Mail-Anmeldung ist in Firebase noch nicht aktiviert'
};
const errText = e => AUTH_ERRORS[e && e.code] || (e && e.message) || 'Unbekannter Fehler';

function accountCard() {
  if (!window.FIREBASE_CONFIG) {
    return `<div class="card">
      <div class="label tight">Synchronisierung</div>
      <p class="muted small">Noch nicht eingerichtet. Sobald die Firebase-Konfiguration in <code>config.js</code> eingetragen ist, kannst du dich hier anmelden.</p>
    </div>`;
  }
  if (!isCloud()) {
    return `<div class="card">
      <div class="label tight">Konto & Synchronisierung</div>
      <p class="muted small" style="margin:0 0 12px">Melde dich an, um die App auf mehreren Geräten zu nutzen. Ohne Anmeldung bleibt alles nur auf diesem Gerät.</p>
      <input class="text" id="aMail" type="email" autocomplete="username" inputmode="email" placeholder="E-Mail-Adresse">
      <input class="text" id="aPw" type="password" autocomplete="current-password" placeholder="Passwort (mind. 6 Zeichen)" style="margin-top:10px"
        onkeydown="if(event.key==='Enter')doAuth('in')">
      <button class="btn primary" onclick="doAuth('in')">Anmelden</button>
      <button class="btn" onclick="doAuth('up')">Neues Konto erstellen</button>
      <button class="btn link" onclick="doReset()">Passwort vergessen?</button>
    </div>`;
  }
  const i = cloudInfo || {};
  return `<div class="card">
    <div class="label tight">Konto</div>
    <div class="acct">
      <div class="grow"><b>${esc(i.email || '…')}</b><div class="muted small sync-line" data-s="${syncStatus}"><span class="sdot"></span>${STATUS_TEXT[syncStatus]}</div></div>
      <button class="btn slim" onclick="doSignOut()">Abmelden</button>
    </div>
  </div>`;
}

function groupCard() {
  if (!isCloud() || !cloudInfo) return '';
  const g = cloudInfo.group;
  const priv = state.games.filter(x => x.space === 'me').length;
  const shared = state.games.filter(x => x.space === 'grp').length;
  if (!g) {
    return `<div class="card">
      <div class="label tight">Gemeinsam spielen</div>
      <p class="muted small" style="margin:0 0 12px">Erstelle eine Gruppe und lade deine Partnerin per Code ein. Deine bisherigen Spiele bleiben privat, bis du sie gezielt teilst.</p>
      <button class="btn primary" onclick="startCreateGroup()">Gruppe erstellen</button>
      <div class="join-row">
        <input class="text" id="joinCode" maxlength="6" autocapitalize="characters" autocomplete="off" placeholder="Einladungscode">
        <button class="btn slim" onclick="doJoin()">Beitreten</button>
      </div>
    </div>`;
  }
  const waiting = g.members < 2;
  return `<div class="card">
    <div class="label tight">Gemeinsam spielen</div>
    <div class="members">
      <span class="dot" style="background:${pColor(g.mySlot)}"></span><b>${esc(pName(g.mySlot))}</b> <span class="muted small">(du)</span>
      <span class="muted">&amp;</span>
      <span class="dot" style="background:${pColor(g.partnerSlot)}"></span><b>${esc(pName(g.partnerSlot))}</b>
      ${waiting ? '<span class="muted small">(noch nicht beigetreten)</span>' : ''}
    </div>
    ${waiting ? `
      <div class="invite">
        <div class="muted small">Einladungscode für ${esc(pName(g.partnerSlot))}</div>
        <div class="code">${esc(g.inviteCode || '––––––')}</div>
        <button class="btn slim" onclick="shareCode('${esc(g.inviteCode || '')}')">Code teilen</button>
        <button class="btn link" onclick="newCode()">Neuen Code erstellen</button>
      </div>` : ''}
    <p class="muted small">👥 ${shared} geteilt · 🔒 ${priv} privat. Private Spiele kannst du im Spiel über ✎ → Sichtbarkeit teilen.</p>
    ${priv ? `<button class="btn" onclick="shareAll()">Alle privaten Spiele teilen</button>` : ''}
    <button class="btn danger" onclick="doLeave()">Gruppe verlassen</button>
  </div>`;
}

// Warten, bis das Sync-Modul (Firebase) geladen ist – beim ersten Öffnen kann das ein paar Sekunden dauern
async function cloudReady() {
  if (!window.Cloud || !Cloud.ready) throw Object.assign(new Error('Synchronisierung wird noch geladen – bitte kurz warten'), { code: 'loading' });
  let t;
  try {
    await Promise.race([Cloud.ready, new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error(''), { code: 'loading-timeout' })), 20000); })]);
  } catch (e) {
    if (e.code === 'loading-timeout') throw e;
    throw Object.assign(new Error('Synchronisierung konnte nicht starten: ' + (e && e.message || e)), { code: 'start-failed' });
  } finally { clearTimeout(t); }
}
const looksLikeMail = m => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.trim());

async function doAuth(kind) {
  const mail = $('#aMail').value, pw = $('#aPw').value;
  if (!mail.trim() || !pw) { toast('Bitte E-Mail und Passwort eingeben'); return; }
  if (!looksLikeMail(mail)) { toast('Ins erste Feld gehört deine E-Mail-Adresse'); $('#aMail').focus(); return; }
  try {
    toast(kind === 'up' ? 'Konto wird erstellt …' : 'Anmelden …');
    await cloudReady();
    await (kind === 'up' ? Cloud.signUp(mail, pw) : Cloud.signIn(mail, pw));
  } catch (e) { toast(errText(e)); }
}
async function doReset() {
  const mail = $('#aMail').value;
  if (!looksLikeMail(mail)) { toast('Erst deine E-Mail-Adresse eintragen'); return; }
  try { await cloudReady(); await Cloud.resetPassword(mail); toast('E-Mail zum Zurücksetzen verschickt'); }
  catch (e) { toast(errText(e)); }
}
async function doSignOut() {
  if (!await ask('Abmelden? Deine Konto-Daten bleiben gespeichert. Auf diesem Gerät siehst du danach wieder nur die lokalen Daten.', 'Abmelden', false)) return;
  await Cloud.signOut();
}

function startCreateGroup() {
  sheetMode = 'group';
  openSheet(`
    <div class="sheet-head"><h2 class="grow">Wer bist du?</h2></div>
    <p class="muted small">Damit Siege und Punkte bei beiden richtig zugeordnet sind.</p>
    <div class="seg">${state.players.map(p =>
      `<button type="button" style="--c:${p.color}" onclick="doCreateGroup('${p.id}')">${esc(p.name)}</button>`).join('')}</div>`);
}
async function doCreateGroup(slot) {
  closeSheet();
  try {
    toast('Gruppe wird erstellt …');
    const code = await Cloud.createGroup(slot);
    toast('Gruppe erstellt – Code: ' + code);
  } catch (e) { toast(errText(e)); }
}
async function doJoin() {
  const code = ($('#joinCode').value || '').trim().toUpperCase();
  if (code.length < 6) { toast('Bitte den 6-stelligen Code eingeben'); return; }
  try {
    const inv = await Cloud.previewInvite(code);
    const me = inv.names ? inv.names[inv.freeSlot] : '';
    const them = inv.names ? inv.names[inv.freeSlot === 'p1' ? 'p2' : 'p1'] : '';
    if (!await ask(`Der Gruppe von ${them} beitreten? Du bist darin „${me}“. Deine privaten Spiele bleiben privat.`, 'Beitreten', false)) return;
    await Cloud.joinGroup(code);
    toast(`👥 Mit ${them} verbunden`);
    setTimeout(() => Cloud.tidyDuplicates().catch(() => {}), 1500);
  } catch (e) { toast(errText(e)); }
}
async function shareCode(code) {
  const text = `Tritt meiner Spieleabend-Gruppe bei: Code ${code}\n${location.origin + location.pathname}`;
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { /* abgebrochen */ } }
  try { await navigator.clipboard.writeText(code); toast('Code kopiert'); } catch (e) { toast('Code: ' + code); }
}
async function newCode() {
  try { const c = await Cloud.newInvite(); toast('Neuer Code: ' + c); } catch (e) { toast(errText(e)); }
}
async function shareAll() {
  const n = state.games.filter(x => x.space === 'me').length;
  if (!await ask(`Alle ${n} privaten Spiele samt Partien mit ${partnerName()} teilen? Gleichnamige Spiele werden zusammengeführt.`, 'Teilen', false)) return;
  persist('shareAllPrivate');
  toast('Wird geteilt …');
}
async function doLeave() {
  if (!await ask(`Gruppe verlassen? Geteilte Spiele bleiben bei ${partnerName()}, du siehst sie dann nicht mehr. Private Spiele behältst du.`, 'Verlassen')) return;
  try { await Cloud.leaveGroup(); toast('Gruppe verlassen'); } catch (e) { toast(errText(e)); }
}

/* ---------- Lokale Daten ins Konto übernehmen ---------- */
const migKey = () => 'spieleabend.migrated.' + (Cloud.user ? Cloud.user.uid : '');
function localHasContent(l) {
  const def = ['kniffel', 'qwixx', 'ganz schön clever', 'rummikub'];
  return l.matches.length > 0 || l.games.some(g => !def.includes(g.name.trim().toLowerCase()));
}
const localPending = () => window.Cloud && Cloud.user && !lsGet(migKey()) && localHasContent(load());

async function offerMigration(manual, isNew) {
  const local = load();
  if (!manual && !localHasContent(local)) return;
  const nG = local.games.length, nM = local.matches.length;
  const ok = await ask(`Die Daten von diesem Gerät (${nG} Spiele, ${nM} Partien) in dein Konto übernehmen? Sie landen als private Spiele bei dir. Die lokale Kopie bleibt als Sicherung erhalten.`, 'Übernehmen', false);
  lsSet(migKey(), ok ? 'done' : 'skipped');
  if (!ok) {
    // Neues Konto ohne Übernahme: wenigstens die Startspiele anlegen
    if (isNew) Cloud.migrateLocal({ players: local.players, games: defaults().games, matches: [] }).catch(() => {});
    render();
    return;
  }
  try {
    await Cloud.migrateLocal(local);
    toast(`📥 ${nM} Partien übernommen`);
  } catch (e) { lsSet(migKey(), null); toast('Übernahme fehlgeschlagen: ' + errText(e)); }
}

/* ---------- Brücke zur Sync-Schicht (sync.js) ---------- */
window.onCloudAuth = async user => {
  if (!user) {
    // Abgemeldet oder Sync nicht eingerichtet → lokaler Modus mit den Safari-Daten
    const wasCloud = isCloud();
    mode = 'local';
    cloudInfo = null;
    opQueue = [];
    lsSet(CACHE_KEY, null);
    if (wasCloud) { state = load(); render(); }
    else if (tab === 'more') render();
    return;
  }
  mode = 'cloud';
  cloudInfo = Cloud.info();
  const q = opQueue; opQueue = [];
  q.forEach(([op, args]) => runOp(op, args));
  if (!lsGet(migKey())) {
    const local = load();
    if (localHasContent(local)) setTimeout(() => offerMigration(false, user.isNew), 600);
    else {
      lsSet(migKey(), 'done');
      // Neues Konto ohne eigene Daten: Startspiele (Kniffel & Co.) privat anlegen
      if (user.isNew) Cloud.migrateLocal(local).catch(() => {});
    }
  }
  render();
};

window.onCloudState = s => {
  state = s;
  cloudInfo = Cloud.info();
  lsSet(CACHE_KEY, JSON.stringify({ state: s }));
  if (sheetMode !== 'game' || !gameById(draft.gameId)) { if (sheetMode === 'game') closeSheet(); }
  renderSoon();
};

window.onCloudStatus = s => {
  syncStatus = s;
  renderSync();
  const line = document.querySelector('.sync-line');
  if (line) { line.dataset.s = s; line.lastChild.textContent = STATUS_TEXT[s]; }
};

// Name beim Tippen speichern (iOS feuert beim Schließen der App kein change-Event)
let nameTimer = null;
function typeName(id, val) {
  if (!val.trim()) return;
  player(id).name = val.trim();
  if (!isCloud()) { save(); return; }
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => persist('setPlayer', id, 'name', val.trim()), 500);
}

function setPlayer(id, key, val) {
  const p = player(id);
  if (key === 'name' && !val.trim()) { render(); return; }
  p[key] = key === 'name' ? val.trim() : val;
  clearTimeout(nameTimer);
  persist('setPlayer', id, key, p[key]);
  render();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `spieleabend-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importData(input) {
  const f = input.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = async () => {
    let s;
    try {
      s = JSON.parse(r.result);
      if (!Array.isArray(s.players) || !Array.isArray(s.games) || !Array.isArray(s.matches)) throw new Error();
    } catch (e) { toast('Datei ist kein gültiges Backup'); return; }
    if (isCloud()) {
      if (!await ask(`Backup mit ${s.matches.length} Partien als private Spiele in dein Konto importieren? Vorhandenes bleibt erhalten.`, 'Importieren', false)) return;
      persist('migrateLocal', s);
      toast('Backup wird importiert');
      return;
    }
    if (!await ask(`Backup mit ${s.matches.length} Partien laden? Die aktuellen Daten werden ersetzt.`, 'Laden', false)) return;
    state = s; save(); render(); toast('Backup geladen');
  };
  r.readAsText(f);
  input.value = '';
}

async function resetAll() {
  if (isCloud()) return;
  if (!await ask('Wirklich ALLE Spiele und Partien löschen?', 'Alles löschen')) return;
  state = defaults(); save(); render(); toast('Zurückgesetzt');
}

/* ---------- Bottom Sheet ---------- */
function openSheet(html) {
  const body = $('#sheetBody');
  body.innerHTML = '<div class="grabber"></div>' + html;
  body.style.transform = '';
  const s = $('#sheet');
  s.classList.remove('hidden');
  $('#view').classList.add('lock');
  requestAnimationFrame(() => s.classList.add('open'));
}
function closeSheet() {
  const s = $('#sheet');
  s.classList.remove('open');
  $('#sheetBody').style.transform = '';
  $('#view').classList.remove('lock');
  sheetMode = null;
  setTimeout(() => s.classList.add('hidden'), 250);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

// Sheet nach unten wischen zum Schließen
(() => {
  const el = $('#sheetBody');
  let startY = null, dy = 0;
  el.addEventListener('touchstart', e => {
    if (el.scrollTop > 0 || e.target.closest('input')) { startY = null; return; }
    startY = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (startY == null) return;
    dy = e.touches[0].clientY - startY;
    if (dy > 0) {
      e.preventDefault();
      el.classList.add('dragging');
      el.style.transform = `translateY(${dy}px)`;
    }
  }, { passive: false });
  el.addEventListener('touchend', () => {
    if (startY == null) return;
    el.classList.remove('dragging');
    if (dy > 110) closeSheet(); else el.style.transform = '';
    startY = null;
  });
})();

/* ---------- Eigener Bestätigungsdialog ---------- */
function ask(text, okLabel = 'Löschen', danger = true) {
  return new Promise(resolve => {
    const d = $('#dialog'), ok = $('#dlgOk'), cancel = $('#dlgCancel');
    $('#dlgText').textContent = text;
    ok.textContent = okLabel;
    ok.className = 'btn ' + (danger ? 'danger-fill' : 'primary');
    d.classList.remove('hidden');
    requestAnimationFrame(() => d.classList.add('open'));
    const done = v => {
      d.classList.remove('open');
      setTimeout(() => d.classList.add('hidden'), 200);
      ok.onclick = cancel.onclick = d.onclick = null;
      resolve(v);
    };
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
    d.onclick = e => { if (e.target === d) done(false); };
  });
}

/* ---------- App-Gefühl ---------- */
// Pinch-Zoom und Doppeltipp-Zoom auf iOS unterbinden
['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', e => { if (e.scale && e.scale !== 1) e.preventDefault(); }, { passive: false });
// Kontextmenü (lange drücken) aus
document.addEventListener('contextmenu', e => { if (!e.target.closest('input')) e.preventDefault(); });

// Hinweis, falls die App noch im Browser statt vom Homescreen läuft
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function installHint() {
  let dismissed = false;
  try { dismissed = localStorage.getItem('spieleabend.hint') === '1'; } catch (e) { /* ignore */ }
  if (isStandalone || dismissed) return '';
  return `<div class="card install">
    <span class="emoji">📲</span>
    <p><b>Als App installieren:</b> In Safari auf Teilen tippen → „Zum Home-Bildschirm“. Dann läuft sie im Vollbild ohne Browserleiste.</p>
    <button class="icon-btn sm ghost" onclick="hideHint()" aria-label="Ausblenden">✕</button>
  </div>`;
}
function hideHint() {
  try { localStorage.setItem('spieleabend.hint', '1'); } catch (e) { /* ignore */ }
  render();
}

/* ---------- Start ---------- */
// Alter Platzhalter-Name einmalig ersetzen
if (!isCloud() && state.players[1] && state.players[1].name === 'Freundin') { state.players[1].name = 'Emma'; save(); }
// Beim Verlassen der App sicherheitshalber speichern
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
window.addEventListener('pagehide', save);
// Browser bitten, die Daten dauerhaft zu behalten
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
render();
// Auto-Update: bei jedem Öffnen nach neuer Version schauen und dann einmal neu laden
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    save();
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    reg.update();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update(); });
  }).catch(() => {});
}
