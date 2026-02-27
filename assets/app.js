const tg = window.Telegram?.WebApp;
if (tg) { try { tg.expand(); tg.ready(); } catch {} }

const $ = (sel) => document.querySelector(sel);
const UA_DAYS = ['Понеділок','Вівторок','Середа','Четвер','Пʼятниця','Субота','Неділя'];

let currentPlan = null;

// ===================== CONFIG =====================
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1dWR-VpkGtmorDU1qAAIwbwk7SZxrozY15uN-KcyKwug/gviz/tq?tqx=out:csv&sheet=plans';
const SHEET_ID = '1dWR-VpkGtmorDU1qAAIwbwk7SZxrozY15uN-KcyKwug';
const SHEET_NAME = 'plans';

const COL_TG_ID_NAME = 'client_telegram_id';
const COL_PLAN_NAME  = 'plan_json';
// ==================================================

// Client-friendly defaults
const SHOW_SUCCESS_HINT = false;

// Debug only when ?debug=1 or localStorage.debug_mealapp=1
const SHOW_DEBUG = (() => {
  const qs = new URLSearchParams(location.search);
  if (qs.get('debug') === '1') return true;
  try { return localStorage.getItem('debug_mealapp') === '1'; } catch { return false; }
})();

function buildCsvUrl(){
  const url = (SHEET_CSV_URL || '').trim();
  if (url && url !== 'PASTE_GVIZ_CSV_URL_HERE') return url;

  const id = (SHEET_ID || '').trim();
  if (!id) return '';
  const sheet = encodeURIComponent((SHEET_NAME || 'plans').trim() || 'plans');
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${sheet}`;
}

function setHint(msg, kind){
  const el = $('#hint');
  if (!el) return;

  if (kind === 'ok' && !SHOW_SUCCESS_HINT){
    el.textContent = '';
    el.className = 'hint';
    return;
  }
  el.textContent = msg || '';
  el.className = 'hint' + (kind ? ` ${kind}` : '');
}

function setDebug(msg){
  if (!SHOW_DEBUG) return;
  const el = $('#debug');
  if (el) {
    el.style.display = 'block';
    el.textContent = msg || '';
  }
  if (msg) console.log(msg);
}

function escapeHTML(s){
  return String(s ?? '').replace(/[&<>"']/g, ch => (
    ch === '&' ? '&amp;' :
    ch === '<' ? '&lt;'  :
    ch === '>' ? '&gt;'  :
    ch === '"' ? '&quot;': '&#39;'
  ));
}

function normalizeDayLabel(v, idx){
  if (!v) return UA_DAYS[(idx-1+7)%7] || `День ${idx}`;
  const t = String(v).trim();
  const found = UA_DAYS.find(d => t.toLowerCase().includes(d.toLowerCase()));
  return found || t;
}

const num = (x)=>{ const n = Number(x); return Number.isFinite(n) ? n : 0; };
const sumMeals = (meals=[], key)=> (meals||[]).reduce((s,m)=> s + num(m?.[key]), 0);

function computeDayMacros(day={}){
  const meals = Array.isArray(day?.meals) ? day.meals : [];
  return {
    kcal:      num(day?.kcal)      || sumMeals(meals,'kcal'),
    protein_g: num(day?.protein_g) || sumMeals(meals,'protein_g'),
    fat_g:     num(day?.fat_g)     || sumMeals(meals,'fat_g'),
    carbs_g:   num(day?.carbs_g)   || sumMeals(meals,'carbs_g'),
  };
}

function computePlanMeta(plan={}){
  const days = Array.isArray(plan?.days) ? plan.days : [];
  const meta = plan?.meta || {};
  const totals = days.map(d => computeDayMacros(d));
  const avg = totals.length ? {
    kcal:      Math.round(totals.reduce((s,d)=>s+d.kcal,0)/totals.length),
    protein_g: Math.round(totals.reduce((s,d)=>s+d.protein_g,0)/totals.length),
    fat_g:     Math.round(totals.reduce((s,d)=>s+d.fat_g,0)/totals.length),
    carbs_g:   Math.round(totals.reduce((s,d)=>s+d.carbs_g,0)/totals.length),
  } : {kcal:0,protein_g:0,fat_g:0,carbs_g:0};
  return {
    title: meta.title || 'План харчування',
    kcal:      Number(meta.kcal)      || avg.kcal,
    protein_g: Number(meta.protein_g) || avg.protein_g,
    fat_g:     Number(meta.fat_g)     || avg.fat_g,
    carbs_g:   Number(meta.carbs_g)   || avg.carbs_g,
  };
}

function normalizePlan(raw){
  if (typeof raw === 'string'){
    try { raw = JSON.parse(raw); } catch { return { meta:{ title:'План харчування' }, days:[] }; }
  }
  if (raw && typeof raw.text === 'string'){ try { raw = JSON.parse(raw.text); } catch {} }
  return raw || { meta:{ title:'План харчування' }, days:[] };
}

// -------- CSV parsing (robust delimiter + header row detection) --------
function parseCSV(text, delimiter=','){
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i=0; i<text.length; i++){
    const ch = text[i];
    const next = text[i+1];

    if (inQuotes){
      if (ch === '"' && next === '"'){ cell += '"'; i++; continue; }
      if (ch === '"'){ inQuotes = false; continue; }
      cell += ch;
      continue;
    }
    if (ch === '"'){ inQuotes = true; continue; }
    if (ch === delimiter){ row.push(cell); cell=''; continue; }
    if (ch === '\n'){ row.push(cell); cell=''; rows.push(row); row=[]; continue; }
    if (ch === '\r'){ continue; }
    cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function detectDelimiter(text){
  const firstLine = (text || '').split('\n')[0] || '';
  let commas=0, semis=0, inQ=false;
  for (let i=0; i<firstLine.length; i++){
    const ch = firstLine[i];
    if (ch === '"') inQ = !inQ;
    if (inQ) continue;
    if (ch === ',') commas++;
    if (ch === ';') semis++;
  }
  if (semis > commas) return ';';
  return ',';
}

function normalizeId(x){
  const s = String(x ?? '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return s;
  if (/^\d+\.0+$/.test(s)) return s.split('.')[0];
  if (/^[0-9.+-]+e\+?\d+$/i.test(s)){
    const n = Number(s);
    if (Number.isFinite(n)) return String(Math.trunc(n));
  }
  return s.replace(/\s+/g,'');
}
function stripBom(s){ return String(s||'').replace(/^\uFEFF/, ''); }

function normHeaderCell(s){
  return stripBom(String(s||'')).trim().toLowerCase();
}

function findHeaderRow(rows){
  const idCandidates = [
    COL_TG_ID_NAME, 'tg_id', 'user_id', 'telegram_id', 'telegramid', 'client_telegram_id', 'clienttelegramid'
  ].map(x => x.toLowerCase());

  const planCandidates = [
    COL_PLAN_NAME, 'plan', 'meal_plan', 'mealplan', 'plan_data', 'planjson', 'plan text', 'plan_text'
  ].map(x => x.toLowerCase());

  const maxScan = Math.min(rows.length, 6);
  for (let r=0; r<maxScan; r++){
    const raw = rows[r] || [];
    const header = raw.map(normHeaderCell);
    const idxId = header.findIndex(h => idCandidates.includes(h));
    const idxPlan = header.findIndex(h => planCandidates.includes(h));
    if (idxId >= 0 && idxPlan >= 0){
      return { headerRowIndex: r, idxId, idxPlan, headerSample: raw.slice(0, 12) };
    }
  }
  return null;
}

async function fetchPlanFromSheet(tgId){
  const csvUrl = buildCsvUrl();
  if (!csvUrl) throw new Error('План тимчасово недоступний.');

  const r = await fetch(csvUrl, { cache:'no-store' });
  if (!r.ok) throw new Error('Не вдалося завантажити план. Спробуй ще раз.');

  const csv = await r.text();

  if (/<!doctype html|<html/i.test(csv.slice(0, 300))){
    setDebug('Got HTML instead of CSV. Check share/publish permissions.');
    throw new Error('План тимчасово недоступний.');
  }

  const delim = detectDelimiter(csv);
  let rows = parseCSV(csv, delim);
  if (rows.length && rows[0].length <= 1){
    rows = parseCSV(csv, delim === ',' ? ';' : ',');
  }
  if (!rows.length) throw new Error('План порожній або недоступний.');

  const hdr = findHeaderRow(rows);
  if (!hdr){
    setDebug('Header row not found. First row sample: ' + (rows[0] || []).slice(0, 12).join(' | '));
    throw new Error('План тимчасово недоступний.');
  }

  const { headerRowIndex, idxId, idxPlan, headerSample } = hdr;
  setDebug(`Header row: ${headerRowIndex}, idxId=${idxId}, idxPlan=${idxPlan}\nHeader sample: ${headerSample.join(' | ')}`);

  const dataRows = rows.slice(headerRowIndex + 1);
  const target = normalizeId(tgId);

  for (let i=0; i<dataRows.length; i++){
    const rr = dataRows[i];
    if (!rr || !rr.length) continue;
    const rid = normalizeId(rr[idxId]);
    if (rid === target){
      const planCell = rr[idxPlan];
      if (!planCell) throw new Error('План ще не збережено.');
      let val = planCell;
      try { val = JSON.parse(planCell); } catch {}
      if (val && typeof val.text === 'string'){ try { val = JSON.parse(val.text); } catch {} }
      return normalizePlan(val);
    }
  }

  throw new Error('План не знайдено.');
}

// -------- Render --------
function renderPlan(plan){
  const normalized = normalizePlan(plan);
  const days = Array.isArray(normalized?.days) ? normalized.days : [];
  const meta = computePlanMeta(normalized);

  $('#title') && ($('#title').textContent = meta.title);
  $('#macros') && ($('#macros').textContent = `Ккал: ${meta.kcal} | Б:${meta.protein_g} Ж:${meta.fat_g} В:${meta.carbs_g}`);

  const tabs = $('#tabs');
  if (tabs){
    tabs.innerHTML = '';
    days.forEach((d,i)=>{
      const b = document.createElement('button');
      b.className = 'tab' + (i === 0 ? ' active' : '');
      b.textContent = d?.day ? String(d.day) : normalizeDayLabel('', i+1);
      b.onclick = ()=>{
        [...tabs.querySelectorAll('.tab')].forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        renderDay(d, i+1);
      };
      tabs.appendChild(b);
    });
  }

  if (days[0]) renderDay(days[0], 1);
  else $('#content').innerHTML = `<div class="card">План порожній.</div>`;

  currentPlan = normalized;
}

function renderDay(dayObj, dayNumber){
  const wrap = $('#content'); if (!wrap) return;
  wrap.innerHTML = '';

  const dm = computeDayMacros(dayObj);
  const head = document.createElement('div');
  head.className = 'day-head card';
  head.innerHTML = `
    <div>
      <h2 class="day-title">${escapeHTML(dayObj?.day || normalizeDayLabel('', dayNumber))}</h2>
      <div class="day-macros">Ккал: ${dm.kcal} • Б:${dm.protein_g} • Ж:${dm.fat_g} • В:${dm.carbs_g}</div>
    </div>`;
  wrap.appendChild(head);

  (dayObj?.meals || []).forEach(m=>{
    const kcal = num(m?.kcal), p=num(m?.protein_g), f=num(m?.fat_g), c=num(m?.carbs_g);
    const hasMacros = kcal||p||f||c;

    const card = document.createElement('section');
    card.className = 'meal card';
    card.innerHTML = `
      <div class="meal-head">
        <h3 class="meal-title">${escapeHTML(m?.title || '')}</h3>
        ${hasMacros ? `<div class="meal-macros">Ккал: ${kcal} • Б:${p} • Ж:${f} • В:${c}</div>` : ''}
      </div>

      ${Array.isArray(m?.ingredients) && m.ingredients.length ? `
        <details class="ing">
          <summary>Інгредієнти</summary>
          <ul class="ing-list">
            ${m.ingredients.map(i=>`<li><span>${escapeHTML(i.name)}</span><span>${escapeHTML(i.qty||'')}</span></li>`).join('')}
          </ul>
        </details>` : ''}

      ${m?.instructions ? `
        <details class="instr">
          <summary>Спосіб приготування</summary>
          <div class="instr-text">${escapeHTML(m.instructions)}</div>
        </details>` : ''}`;
    wrap.appendChild(card);
  });

  if (!dayObj?.meals?.length){
    const empty = document.createElement('div');
    empty.className = 'card';
    empty.innerHTML = 'На цей день немає страв у плані.';
    wrap.appendChild(empty);
  }
}

// Shopping (flat list)
function flattenShoppingList(list){
  const out = [];
  const pushItem = (it)=>{
    if (!it) return;
    if (typeof it === 'string'){ out.push({ name: it, qty: '' }); return; }
    const name = it.name ?? it.item ?? it.product ?? it.title ?? it.food ?? '';
    const qty  = it.quantity ?? it.qty ?? it.amount ?? '';
    const unit = it.unit ? ` ${it.unit}` : '';
    const q = (qty !== '' && qty !== null && qty !== undefined) ? `${qty}${unit}`.trim() : '';
    if (name) out.push({ name, qty: q });
  };

  if (Array.isArray(list)){ list.forEach(pushItem); return out; }

  if (list && typeof list === 'object'){
    for (const [k, v] of Object.entries(list)){
      if (Array.isArray(v)) v.forEach(pushItem);
      else if (v && typeof v === 'object'){
        const qty  = v.quantity ?? v.qty ?? v.amount ?? '';
        const unit = v.unit ? ` ${v.unit}` : '';
        const q = (qty !== '' && qty !== null && qty !== undefined) ? `${qty}${unit}`.trim() : '';
        out.push({ name: k, qty: q || '' });
      } else out.push({ name: k, qty: String(v ?? '').trim() });
    }
  }
  return out;
}

function renderShoppingList(){
  const modal = $('#shoppingModal'); if (!modal) return;
  const body = modal.querySelector('.modal-body'); if (!body) return;
  body.innerHTML = '';

  const flat = flattenShoppingList(currentPlan?.shopping_list);
  if (!flat.length){ body.innerHTML = '<p>Список покупок відсутній.</p>'; return; }

  const ul = document.createElement('ul');
  ul.className = 'shop-list';
  ul.innerHTML = flat.map(i=>`<li><span>${escapeHTML(i.name)}</span><span>${escapeHTML(i.qty || '')}</span></li>`).join('');
  body.appendChild(ul);
}

$('#openShopping')?.addEventListener('click', ()=>{
  renderShoppingList();
  $('#shoppingModal')?.classList.add('open');
});
$('#closeShopping')?.addEventListener('click', ()=> $('#shoppingModal')?.classList.remove('open'));
document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') $('#shoppingModal')?.classList.remove('open'); });
$('#shoppingModal')?.addEventListener('click', (e)=>{ if (e.target?.classList?.contains('modal')) $('#shoppingModal')?.classList.remove('open'); });

// UID
function getUidFromURL(){
  const qs = new URLSearchParams(location.search);
  const uid = qs.get('uid') || qs.get('user_id');
  return uid ? String(uid).trim() : null;
}
function getUidFromTelegram(){
  const id = tg?.initDataUnsafe?.user?.id || tg?.initDataUnsafe?.chat?.id || null;
  return id ? String(id) : null;
}
function openGate(){
  const gate = $('#uidGate'); if (!gate) return;
  gate.classList.add('open');
  gate.setAttribute('aria-hidden','false');
}
function closeGate(){
  const gate = $('#uidGate'); if (!gate) return;
  gate.classList.remove('open');
  gate.setAttribute('aria-hidden','true');
}
function isValidUid(x){ return /^\d{4,20}$/.test(String(x||'').trim()); }

async function loadAndRender(uid){
  const id = normalizeId(uid);
  setHint('', '');
  setDebug(`tg_id: ${id}\nCSV: ${buildCsvUrl() || '(not set)'}\nDebug: ON`);
  const plan = await fetchPlanFromSheet(id);
  renderPlan(plan);
  setHint('План відкрито ✅', 'ok');
}

(async function start(){
  const uid = getUidFromTelegram() || getUidFromURL();
  if (!uid || !isValidUid(uid)){
    openGate();
    setHint('Відкрий через Telegram-бот.', 'error');
    return;
  }
  closeGate();
  try { await loadAndRender(uid); }
  catch(e){ setHint(e?.message || 'Не вдалося завантажити план', 'error'); }
})();

$('#uidContinue')?.addEventListener('click', async ()=>{
  const uid = String($('#uidInput')?.value || '').trim();
  if (!isValidUid(uid)){ setHint('Введи коректний Telegram ID.', 'error'); return; }
  closeGate();
  try { await loadAndRender(uid); }
  catch(e){ setHint(e?.message || 'Не вдалося завантажити план', 'error'); }
});
