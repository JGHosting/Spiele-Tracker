'use strict';

/* ---------- Grundlagen ---------- */
const KEY = 'spieleabend.v1';
const APP_VERSION = 10;

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
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { toast('Speichern fehlgeschlagen'); }
}

let state = load();
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

function render() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#title').textContent = TITLES[tab];
  $('#topAction').style.visibility = tab === 'games' ? 'visible' : 'hidden';
  const views = { games: viewGames, history: viewHistory, stats: viewStats, more: viewMore };
  $('#view').innerHTML = `<div class="fade">${views[tab]()}</div>`;
}

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
    html += `
    <button class="game-card" onclick="openGame('${g.id}')">
      <div class="gc-top"><span class="emoji">${esc(g.emoji || '🎲')}</span><span class="pill">${TYPES[g.type].short}</span></div>
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

  state.matches.push({ id: uid(), gameId: g.id, date, winner, scores, created: Date.now() });
  save();
  closeSheet();
  render();
  toast(winner === 'draw' ? '🤝 Unentschieden gespeichert' : `🏆 ${pName(winner)} gewinnt!`);
}

async function delMatch(id) {
  if (!await ask('Diese Partie löschen?')) return;
  state.matches = state.matches.filter(m => m.id !== id);
  save();
  if (sheetMode === 'game' && draft.gameId) openSheet(gameSheet(gameById(draft.gameId)));
  render();
}

/* ---------- Spiel anlegen / bearbeiten ---------- */
function editGame(id) {
  const g = id ? gameById(id) : null;
  const locked = g && state.matches.some(m => m.gameId === g.id);
  gdraft = { id: g ? g.id : null, type: g ? g.type : 'high' };
  sheetMode = 'edit';
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
    <button class="btn primary" onclick="saveGame()">Speichern</button>
    ${g ? `<button class="btn danger" onclick="delGame('${g.id}')">Spiel löschen</button>` : ''}`);
  if (!g) setTimeout(() => $('#gName').focus(), 300);
}

function pickType(t) {
  gdraft.type = t;
  document.querySelectorAll('.type-opt').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  $('#wgpRow').classList.toggle('hidden', t !== 'loserMinus');
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
  if (gdraft.id) Object.assign(gameById(gdraft.id), data);
  else state.games.push({ id: uid(), ...data });
  save();
  closeSheet();
  render();
  toast(gdraft.id ? 'Spiel aktualisiert' : `${data.emoji} ${name} angelegt`);
}

async function delGame(id) {
  const n = state.matches.filter(m => m.gameId === id).length;
  if (!await ask(`Spiel${n ? ` und ${n} Partie${n > 1 ? 'n' : ''}` : ''} wirklich löschen?`)) return;
  state.games = state.games.filter(g => g.id !== id);
  state.matches = state.matches.filter(m => m.gameId !== id);
  if (histFilter === id) histFilter = 'all';
  save();
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
  <div class="card">
    <div class="label tight">Spieler</div>
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
    <button class="btn danger" onclick="resetAll()">Alle Daten löschen</button>
  </div>
  <p class="muted small center">Alle Daten liegen lokal auf diesem Gerät.<br>Mach ab und zu ein Backup.</p>
  <div class="version">Version ${APP_VERSION}</div>`;
}

// Name sofort bei jedem Tippen speichern (iOS feuert beim Schließen der App kein change-Event)
function typeName(id, val) {
  if (!val.trim()) return;
  player(id).name = val.trim();
  save();
}

function setPlayer(id, key, val) {
  const p = player(id);
  if (key === 'name' && !val.trim()) { render(); return; }
  p[key] = key === 'name' ? val.trim() : val;
  save();
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
    if (!await ask(`Backup mit ${s.matches.length} Partien laden? Die aktuellen Daten werden ersetzt.`, 'Laden', false)) return;
    state = s; save(); render(); toast('Backup geladen');
  };
  r.readAsText(f);
  input.value = '';
}

async function resetAll() {
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
// iOS-Fehler umgehen: Im Homescreen-Modus fehlt sonst unten ein Streifen in Höhe der Statusleiste.
function fitHeight() {
  const h = isStandalone ? Math.max(screen.height, window.innerHeight) : window.innerHeight;
  document.documentElement.style.setProperty('--app-h', h + 'px');
}
fitHeight();
window.addEventListener('resize', fitHeight);
window.addEventListener('orientationchange', () => setTimeout(fitHeight, 300));
// Alter Platzhalter-Name einmalig ersetzen
if (state.players[1] && state.players[1].name === 'Freundin') { state.players[1].name = 'Emma'; save(); }
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
