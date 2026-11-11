// LifeLog dashboard. Static page (GitHub Pages) + the LifeLog Worker API.

const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const API = LOCAL
  ? new URLSearchParams(location.search).get('api') || 'http://localhost:8787'
  : 'https://lifelog.philforrence.workers.dev';
const CLIENT_ID = '205553819526-t0rlpa1omlc3qk4qdafprsum22ma3pi1.apps.googleusercontent.com';
const TZ = 'America/New_York';
const STD_TILES = ['Sleep', 'Rested', 'Food', 'Moved'];
const PAGE_DAYS = 7;
const REFRESH_MS = 20000;
const SESSION_KEY = 'lifelog.session';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = {
  token: null,
  kinds: [],
  entries: [],
  today: null,
  from: null,
  to: null,
  seen: new Set(),
  first: true,
  timer: null,
};

// ---------- dates ----------

function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
function dayDate(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}
const fmt = (day, opts) => dayDate(day).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
function nyNow() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}
const shortTime = (t) => String(t).replace(' AM', 'a').replace(' PM', 'p');

// ---------- formatting (mirrors the Worker) ----------

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));
function tileValue(list, t) {
  if (t.agg === 'count') return list.length || undefined;
  const vals = list.map((e) => num(e.data?.[t.field])).filter((v) => v !== undefined);
  if (!vals.length) return undefined;
  if (t.agg === 'sum') return vals.reduce((a, b) => a + b, 0);
  if (t.agg === 'avg') return vals.reduce((a, b) => a + b, 0) / vals.length;
  if (t.agg === 'max') return Math.max(...vals);
  return vals[vals.length - 1];
}
function fmtTile(v, t) {
  const r1 = Math.round(v * 10) / 10;
  switch (t.format) {
    case 'hours': { const h = Math.floor(v), m = Math.round((v - h) * 60); return m === 60 ? `${h + 1}h` : m ? `${h}h ${m}m` : `${h}h`; }
    case 'rating10': return `${r1}/10`;
    case 'approx': return `~${Math.round(v).toLocaleString('en-US')}`;
    case 'minutes': return `${Math.round(v)} min`;
    default: return `${r1.toLocaleString('en-US')}${t.unit ? ' ' + t.unit : ''}`;
  }
}
const kindOf = (name) => state.kinds.find((k) => k.name === name);

function entryValue(e) {
  const d = e.data || {};
  if (e.kind === 'food' && num(d.calories) !== undefined) return `~${Math.round(d.calories).toLocaleString('en-US')}`;
  if (e.kind === 'sleep' && num(d.hours) !== undefined) return fmtTile(num(d.hours), { format: 'hours' });
  if (e.kind === 'exercise' && num(d.minutes) !== undefined) return `${Math.round(d.minutes)} min`;
  const t = kindOf(e.kind)?.tiles?.find((x) => x.agg !== 'count' && num(d[x.field]) !== undefined);
  return t ? fmtTile(num(d[t.field]), t) : '';
}

// ---------- API ----------

async function api(path, opts = {}) {
  const headers = { ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(state.token ? { authorization: `Bearer ${state.token}` } : {}) };
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401 && path !== '/api/session') { signOut(); throw new Error('Please sign in again.'); }
  const isJson = (res.headers.get('content-type') || '').includes('json');
  if (!res.ok) {
    const body = isJson ? await res.json().catch(() => ({})) : {};
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return opts.raw ? res : isJson ? res.json() : res.text();
}

// ---------- session ----------

function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (s && s.token && s.exp * 1000 > Date.now() + 60_000) return s;
  } catch { /* ignore */ }
  return null;
}

function show(signedIn) {
  $('#signin').hidden = signedIn;
  $('#bar').hidden = !signedIn;
  $('#app').hidden = !signedIn;
  $('#add-btn').hidden = !signedIn;
}

function signOut() {
  localStorage.removeItem(SESSION_KEY);
  state.token = null;
  clearInterval(state.timer);
  try { window.google?.accounts.id.disableAutoSelect(); } catch { /* ignore */ }
  show(false);
  initGoogle();
}

let googleReady = false;
function initGoogle() {
  if (!window.google?.accounts?.id) { window.gisReady = initGoogle; return; }
  if (!googleReady) {
    google.accounts.id.initialize({ client_id: CLIENT_ID, callback: onCredential, auto_select: true, cancel_on_tap_outside: false });
    googleReady = true;
  }
  google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 260 });
  google.accounts.id.prompt();
}

async function onCredential({ credential }) {
  $('#signin-error').textContent = '';
  try {
    const s = await api('/api/session', { method: 'POST', body: JSON.stringify({ credential }) });
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    start(s.token);
  } catch (e) {
    $('#signin-error').textContent = e.message;
  }
}

// ---------- loading ----------

async function fetchRange(from, to) {
  return api(`/api/log?from=${from}&to=${to}`);
}

async function refresh() {
  if (!state.token) return;
  const sync = $('#sync');
  sync.className = 'sync busy';
  try {
    const first = !state.today;
    const res = first ? await api('/api/log') : await fetchRange(state.from, state.to);
    if (first) { state.from = res.from; state.to = res.to; }
    state.today = res.today;
    state.kinds = res.kinds;
    state.entries = res.entries;
    if (res.today > state.to) { // a new day started while the page was open
      state.to = res.today;
      state.entries = (await fetchRange(state.from, state.to)).entries;
    }
    render();
    sync.className = 'sync';
  } catch (e) {
    sync.className = 'sync err';
    if (state.token) toast(e.message);
  }
}

async function loadEarlier() {
  const btn = $('#more-btn');
  btn.disabled = true;
  const newFrom = addDays(state.from, -PAGE_DAYS);
  try {
    const res = await fetchRange(newFrom, addDays(state.from, -1));
    state.from = newFrom;
    for (const e of res.entries) state.seen.add(e.id);
    state.entries = [...state.entries, ...res.entries];
    render();
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------- rendering ----------

function tilesHtml(list) {
  const tiles = [];
  for (const k of state.kinds) {
    const mine = list.filter((e) => e.kind === k.name);
    for (const t of k.tiles || []) {
      const v = tileValue(mine, t);
      const std = STD_TILES.includes(t.label) && ['sleep', 'food', 'exercise'].includes(k.name);
      if (std || v !== undefined) tiles.push({ label: t.label, value: v === undefined ? null : fmtTile(v, t) });
    }
  }
  return `<div class="tiles">${tiles
    .map((t) => `<div class="tile"><div class="k">${esc(t.label)}</div><div class="v${t.value ? '' : ' none'}">${t.value ? esc(t.value) : '—'}</div></div>`)
    .join('')}</div>`;
}

function entryHtml(e) {
  const k = kindOf(e.kind);
  const isNew = !state.first && !state.seen.has(e.id);
  let sub = '';
  if (e.kind === 'sleep') {
    const times = e.data?.bedtime && e.data?.wake && !/\d/.test(e.summary) ? `${clock(e.data.bedtime)} → ${clock(e.data.wake)}` : '';
    const rested = num(e.data?.rested) !== undefined ? `rested ${e.data.rested}/10` : '';
    sub = [times, rested].filter(Boolean).join(' · ');
  } else if (k && !['food', 'exercise', 'note'].includes(k.name)) sub = k.label;
  return `<li class="entry${isNew ? ' new' : ''}" data-id="${e.id}" tabindex="0">
    <span class="t">${esc(shortTime(e.time))}</span>
    <span class="e">${esc(e.emoji || k?.emoji || '•')}</span>
    <span class="s">${esc(e.summary)}${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</span>
    <span class="n">${esc(entryValue(e))}</span>
  </li>`;
}

function clock(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (!Number.isFinite(h)) return hhmm;
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')}${h < 12 ? 'a' : 'p'}`;
}

function dayTitle(day) {
  if (day === state.today) return 'Today';
  if (day === addDays(state.today, -1)) return 'Yesterday';
  return fmt(day, { weekday: 'long' });
}

function render() {
  const byDay = new Map();
  for (const e of state.entries) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day).push(e);
  }
  for (const list of byDay.values()) list.sort((a, b) => a.at.localeCompare(b.at));

  const out = [];
  let quiet = [];
  const flushQuiet = () => {
    if (!quiet.length) return;
    const a = quiet[quiet.length - 1], b = quiet[0];
    const label = quiet.length === 1 ? fmt(a, { weekday: 'short', month: 'short', day: 'numeric' })
      : `${fmt(a, { month: 'short', day: 'numeric' })} – ${fmt(b, { month: 'short', day: 'numeric' })}`;
    out.push(`<p class="quiet">Nothing logged · ${esc(label)}</p>`);
    quiet = [];
  };
  for (let d = state.to; d >= state.from; d = addDays(d, -1)) {
    const list = byDay.get(d) || [];
    const isToday = d === state.today;
    if (!list.length && !isToday) { quiet.push(d); continue; }
    flushQuiet();
    out.push(`<section class="day${isToday ? ' is-today' : ''}">
      <div class="day-head"><h2>${esc(dayTitle(d))}</h2><span class="date">${esc(fmt(d, { weekday: isToday || d === addDays(state.today, -1) ? 'short' : undefined, month: 'short', day: 'numeric' }))}</span></div>
      <div class="card">
        ${tilesHtml(list)}
        ${list.length ? `<ul class="entries">${list.map(entryHtml).join('')}</ul>`
          : `<div class="empty">Nothing yet today. Tell Claude what you're up to, or tap + to add something.</div>`}
      </div>
    </section>`);
  }
  flushQuiet();
  $('#days').innerHTML = out.join('');
  $('#more').hidden = false;
  for (const e of state.entries) state.seen.add(e.id);
  state.first = false;
}

// ---------- add / edit sheet ----------

let editing = null; // { entry|null, data, jsonDirty }

function openSheet(entry) {
  const now = nyNow();
  const base = entry
    ? structuredClone(entry)
    : { kind: 'food', emoji: '', summary: '', said: '', date: now.date, hhmm: now.time, data: {} };
  editing = { entry, data: structuredClone(base.data || {}), jsonDirty: false };
  const f = $('#sheet-form');
  f.innerHTML = `
    <h3>${entry ? 'Edit entry' : 'Add entry'}${entry ? `<small>#${entry.id} · ${entry.source === 'site' ? 'typed' : 'from Claude'}</small>` : ''}</h3>
    <div class="row">
      <label class="f">Kind<select name="kind">${state.kinds.map((k) => `<option value="${esc(k.name)}"${k.name === base.kind ? ' selected' : ''}>${esc(k.emoji)} ${esc(k.label)}</option>`).join('')}</select></label>
      <label class="f narrow">Emoji<input name="emoji" class="emoji-in" maxlength="8" value="${esc(base.emoji || '')}" placeholder="${esc(kindOf(base.kind)?.emoji || '')}"></label>
    </div>
    <div class="row">
      <label class="f">Date<input type="date" name="date" value="${esc(base.date)}" required></label>
      <label class="f">Time<input type="time" name="time" value="${esc(base.hhmm)}" required></label>
    </div>
    <label class="f">Summary<input name="summary" value="${esc(base.summary)}" placeholder="e.g. 2 eggs, toast, coffee" required autocomplete="off"></label>
    <div class="fields" id="fields"></div>
    <label class="f">Your words<textarea name="said" rows="2" placeholder="What you said (optional)">${esc(base.said || '')}</textarea></label>
    <details><summary>Advanced: raw data</summary><textarea name="json" spellcheck="false"></textarea></details>
    <p class="form-error" id="form-error"></p>
    <div class="actions">
      ${entry ? '<button type="button" class="btn danger" data-act="delete">Delete</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn plain" data-act="cancel">Cancel</button>
      <button type="submit" class="btn primary" data-act="save">Save</button>
    </div>`;
  renderFields(base.kind);
  f.kind.addEventListener('change', () => {
    collectFields();
    renderFields(f.kind.value);
    f.emoji.placeholder = kindOf(f.kind.value)?.emoji || '';
  });
  f.json.addEventListener('input', () => { editing.jsonDirty = true; });
  $('#sheet').showModal();
  if (!entry) setTimeout(() => f.summary.focus(), 50);
}

function renderFields(kindName) {
  const k = kindOf(kindName);
  const d = editing.data;
  const html = (k?.fields || []).map((fd) => {
    const v = d[fd.key];
    const unit = fd.unit ? ` <span class="unit">(${esc(fd.unit)})</span>` : '';
    switch (fd.type) {
      case 'items': return `<div class="wide">${itemsHtml(Array.isArray(v) ? v : [])}</div>`;
      case 'rating10':
        return `<label class="f wide">${esc(fd.label)}${fd.hint ? ` <span class="unit">${esc(fd.hint)}</span>` : ''}
          <div class="rating" data-field="${esc(fd.key)}" data-type="rating10" data-value="${num(v) ?? ''}">
            ${Array.from({ length: 10 }, (_, i) => `<button type="button" class="${num(v) === i + 1 ? 'on' : ''}" data-r="${i + 1}">${i + 1}</button>`).join('')}
          </div></label>`;
      case 'time': return `<label class="f">${esc(fd.label)}<input type="time" data-field="${esc(fd.key)}" data-type="time" value="${esc(v ?? '')}"></label>`;
      case 'number': return `<label class="f">${esc(fd.label)}${unit}<input type="number" step="any" inputmode="decimal" data-field="${esc(fd.key)}" data-type="number" value="${esc(v ?? '')}"></label>`;
      default: return `<label class="f">${esc(fd.label)}<input data-field="${esc(fd.key)}" data-type="text" value="${esc(v ?? '')}" placeholder="${esc(fd.hint || '')}"></label>`;
    }
  }).join('');
  const box = $('#fields');
  box.innerHTML = html;
  box.hidden = !html;
  $$('.rating', box).forEach((r) => r.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-r]');
    if (!b) return;
    const cur = r.dataset.value;
    r.dataset.value = cur === b.dataset.r ? '' : b.dataset.r;
    $$('button', r).forEach((x) => x.classList.toggle('on', x.dataset.r === r.dataset.value));
  }));
  wireItems(box);
  syncJson();
}

function itemsHtml(items) {
  return `<div class="items" id="items">
    <div class="ih"><span>Item</span><span>Qty</span><span>Cal</span><span>Protein</span><span></span></div>
    ${items.map((it, i) => itemRow(it, i)).join('')}
    <div class="foot"><button type="button" class="link" data-act="add-item">+ Add item</button><span id="items-total"></span></div>
  </div>`;
}
function itemRow(it, i) {
  return `<div class="ir" data-i="${i}">
    <span class="${it.food_id ? 'lib' : ''}" title="${it.food_id ? 'From your food library' : ''}"><input class="i-name" value="${esc(it.name ?? '')}" placeholder="egg"></span>
    <input class="i-serv" type="number" step="any" inputmode="decimal" value="${esc(it.servings ?? 1)}">
    <input class="i-cal" type="number" step="any" inputmode="decimal" value="${esc(it.calories ?? '')}">
    <input class="i-pro" type="number" step="any" inputmode="decimal" value="${esc(it.protein_g ?? '')}">
    <button type="button" class="x" aria-label="Remove item">×</button>
  </div>`;
}
function wireItems(box) {
  const wrap = $('#items', box);
  if (!wrap) return;
  const total = () => {
    let cal = 0, pro = 0, any = false;
    $$('.ir', wrap).forEach((r) => { const c = num($('.i-cal', r).value), p = num($('.i-pro', r).value); if (c !== undefined) { cal += c; any = true; } if (p !== undefined) pro += p; });
    $('#items-total', wrap).textContent = any ? `Total ~${Math.round(cal).toLocaleString('en-US')} cal · ${Math.round(pro * 10) / 10} g protein` : '';
  };
  wrap.addEventListener('input', total);
  wrap.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-act="add-item"]')) {
      const foot = $('.foot', wrap);
      foot.insertAdjacentHTML('beforebegin', itemRow({ servings: 1 }, -1));
      $$('.ir', wrap).at(-1).querySelector('.i-name').focus();
    } else if (ev.target.closest('.x')) {
      ev.target.closest('.ir').remove();
      total();
    }
  });
  total();
}

/** Read the visible field inputs into editing.data. */
function collectFields() {
  const d = editing.data;
  const box = $('#fields');
  $$('[data-field]', box).forEach((el) => {
    const key = el.dataset.field, type = el.dataset.type;
    const raw = type === 'rating10' ? el.dataset.value : el.value;
    if (raw === '' || raw === undefined) delete d[key];
    else d[key] = type === 'number' || type === 'rating10' ? Number(raw) : raw;
  });
  const wrap = $('#items', box);
  if (wrap) {
    const old = Array.isArray(d.items) ? d.items : [];
    const items = $$('.ir', wrap).map((r) => {
      const i = Number(r.dataset.i);
      const prev = i >= 0 && old[i] ? { ...old[i] } : {};
      const name = $('.i-name', r).value.trim();
      if (!name) return null;
      if (prev.name && prev.name !== name) delete prev.food_id;
      const it = { ...prev, name, servings: num($('.i-serv', r).value) ?? 1 };
      const c = num($('.i-cal', r).value), p = num($('.i-pro', r).value);
      if (c === undefined) delete it.calories; else it.calories = c;
      if (p === undefined) delete it.protein_g; else it.protein_g = p;
      return it;
    }).filter(Boolean);
    if (items.length) d.items = items; else delete d.items;
  }
}

function syncJson() {
  const f = $('#sheet-form');
  f.json.value = JSON.stringify(editing.data, null, 2);
  editing.jsonDirty = false;
}

async function saveSheet() {
  const f = $('#sheet-form');
  const err = $('#form-error');
  err.textContent = '';
  let data;
  if (editing.jsonDirty) {
    try { data = JSON.parse(f.json.value || '{}'); } catch { err.textContent = 'The raw data isn’t valid JSON.'; return; }
  } else {
    collectFields();
    data = editing.data;
  }
  if (!f.summary.value.trim()) { err.textContent = 'Add a short summary.'; f.summary.focus(); return; }
  const body = {
    kind: f.kind.value, emoji: f.emoji.value.trim() || null, summary: f.summary.value.trim(), said: f.said.value.trim() || null,
    date: f.date.value, time: f.time.value, data, replace_data: true,
  };
  const btn = $('[data-act="save"]', f);
  btn.disabled = true;
  try {
    if (editing.entry) await api(`/api/entries/${editing.entry.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    else await api('/api/entries', { method: 'POST', body: JSON.stringify(body) });
    $('#sheet').close();
    toast(editing.entry ? 'Saved' : 'Added');
    await refresh();
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

async function deleteFromSheet() {
  if (!editing?.entry) return;
  if (!confirm(`Delete “${editing.entry.summary}”?`)) return;
  try {
    await api(`/api/entries/${editing.entry.id}`, { method: 'DELETE' });
    $('#sheet').close();
    toast('Deleted');
    await refresh();
  } catch (e) {
    $('#form-error').textContent = e.message;
  }
}

// ---------- export ----------

async function exportData(format) {
  try {
    const res = await api(`/api/export?format=${format}`, { raw: true });
    const blob = await res.blob();
    const name = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || `lifelog-${state.today || 'export'}.${format}`;
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) {
    toast(e.message);
  }
}

// ---------- misc ----------

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function start(token) {
  state.token = token;
  state.today = null;
  state.first = true;
  show(true);
  refresh();
  clearInterval(state.timer);
  state.timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_MS);
}

function wire() {
  $('#days').addEventListener('click', (ev) => {
    const li = ev.target.closest('.entry');
    if (!li) return;
    const e = state.entries.find((x) => x.id === Number(li.dataset.id));
    if (e) openSheet(e);
  });
  $('#days').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.classList.contains('entry')) ev.target.click();
  });
  $('#add-btn').addEventListener('click', () => openSheet(null));
  $('#more-btn').addEventListener('click', loadEarlier);
  $('#sheet-form').addEventListener('submit', (ev) => { ev.preventDefault(); saveSheet(); });
  $('#sheet-form').addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') $('#sheet').close();
    if (act === 'delete') deleteFromSheet();
  });
  $('#sheet').addEventListener('click', (ev) => { if (ev.target === $('#sheet')) $('#sheet').close(); });
  const menu = $('#menu');
  $('#menu-btn').addEventListener('click', (ev) => { ev.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', () => { menu.hidden = true; });
  menu.addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act === 'export-json') exportData('json');
    if (act === 'export-csv') exportData('csv');
    if (act === 'signout') signOut();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.token) refresh(); });
  // Keep the details/JSON view in sync when it's opened.
  $('#sheet-form').addEventListener('toggle', (ev) => {
    if (ev.target.tagName === 'DETAILS' && ev.target.open && !editing.jsonDirty) { collectFields(); syncJson(); }
  }, true);
}

async function boot() {
  wire();
  let saved = loadSession();
  if (!saved && LOCAL && !new URLSearchParams(location.search).has('signin')) {
    // Local development: the dev server can provide a session for the local Worker.
    try { const r = await fetch('/__dev-session'); if (r.ok) saved = await r.json(); } catch { /* none */ }
  }
  if (saved) start(saved.token);
  else { show(false); initGoogle(); }
}
boot();
