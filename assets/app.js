const tg = window.Telegram?.WebApp;
if (tg) { try { tg.expand(); tg.ready(); } catch {} }

const $ = (sel) => document.querySelector(sel);
const UA_DAYS = ['Понеділок','Вівторок','Середа','Четвер','Пʼятниця','Субота','Неділя'];

let currentPlan = null;

// ===================== CONFIG =====================
const SHEET_CSV_URL = '';
const SHEET_ID = '1dWR-VpkGtmorDU1qAAIwbwk7SZxrozY15uN-KcyKwug';
const SHEET_NAME = 'plans';

// put your real header names here:
const COL_TG_ID_NAME = 'client_telegram_id'; // also accepts tg_id/user_id automatically
const COL_PLAN_NAME  = 'plan_json';
// ==================================================

function buildCsvUrl(){
  const url = (SHEET_CSV_URL || '').trim();
  if (url) return url;
  const id = (SHEET_ID || '').trim();
  if (!id || id === 'PASTE_SHEET_ID_HERE') return '';
  const sheet = encodeURIComponent((SHEET_NAME || 'plans').trim() || 'plans');
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${sheet}`;
}

function setHint(msg, kind){
  const el = $('#hint'); if (!el) return;
  el.textContent = msg || '';
  el.className = 'hint' + (kind ? ` ${kind}` : '');
}
function setDebug(msg){
  const el = $('#debug'); if (!el) return;
  el.textContent = msg || '';
}

function parseCSV(text){
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
    if (ch === ','){ row.push(cell); cell=''; continue; }
    if (ch === '\n'){ row.push(cell); cell=''; rows.push(row); row=[]; continue; }
    if (ch === '\r'){ continue; }
    cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
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

async function fetchPlanFromSheet(tgId){
  const csvUrl = buildCsvUrl();
  if (!csvUrl) throw new Error('Не налаштовано таблицю: вкажи SHEET_CSV_URL або SHEET_ID + SHEET_NAME в assets/app.js');

  const r = await fetch(csvUrl, { cache:'no-store' });
  if (!r.ok) throw new Error(`Не вдалося завантажити таблицю (HTTP ${r.status})`);
  const csv = await r.text();

  const rows = parseCSV(csv);
  if (!rows.length) throw new Error('Порожній CSV');

  const rawHeader = rows[0].map(h => stripBom(String(h||'')).trim());
  const header = rawHeader.map(h => h.toLowerCase());

  const wantId = COL_TG_ID_NAME.toLowerCase();
  const wantPlan = COL_PLAN_NAME.toLowerCase();

  const idxId = header.findIndex(h => h === wantId || h === 'tg_id' || h === 'user_id');
  const idxPlan = header.findIndex(h => h === wantPlan);

  if (idxId < 0 || idxPlan < 0){
    throw new Error(`CSV заголовки не співпали. Очікую: "${COL_TG_ID_NAME}" (або tg_id/user_id) і "${COL_PLAN_NAME}". Є в CSV: ${rawHeader.join(', ')}`);
  }

  const target = normalizeId(tgId);
  for (let i=1; i<rows.length; i++){
    const rr = rows[i];
    if (!rr || !rr.length) continue;
    const rid = normalizeId(rr[idxId]);
    if (rid === target){
      const planCell = rr[idxPlan];
      if (!planCell) throw new Error('Знайдено tg_id, але plan_json порожній');
      try { return JSON.parse(planCell); } catch { return planCell; }
    }
  }
  throw new Error('План для цього Telegram ID не знайдено в таблиці');
}

function getUidFromURL(){
  const qs = new URLSearchParams(location.search);
  const uid = qs.get('uid') || qs.get('user_id');
  return uid ? String(uid).trim() : null;
}
function getUidFromTelegram(){
  const id = tg?.initDataUnsafe?.user?.id || tg?.initDataUnsafe?.chat?.id || null;
  return id ? String(id) : null;
}
function isValidUid(x){ return /^\d{4,20}$/.test(String(x||'').trim()); }

function openGate(prefill){
  const gate = $('#uidGate'); if (!gate) return;
  gate.classList.add('open');
  gate.setAttribute('aria-hidden','false');
  const input = $('#uidInput'); if (input && prefill) input.value = String(prefill);
}
function closeGate(){
  const gate = $('#uidGate'); if (!gate) return;
  gate.classList.remove('open');
  gate.setAttribute('aria-hidden','true');
}

async function loadAndRender(uid){
  const id = normalizeId(uid);
  const csvUrl = buildCsvUrl();
  setHint('Завантажую план…', '');
  setDebug(`tg_id: ${id}\nsource: ${getUidFromTelegram() ? 'Telegram WebApp' : (getUidFromURL() ? 'URL' : 'manual')}\nCSV: ${csvUrl || '(not set)'}`);
  const plan = await fetchPlanFromSheet(id);
  currentPlan = plan;
  // minimal render confirmation
  setHint('План завантажено ✅ (рендер можеш підключити з попередньої версії)', 'ok');
}

(async function start(){
  const uid = getUidFromTelegram() || getUidFromURL();

  if (!uid || !isValidUid(uid)){
    openGate('');
    setHint('Не бачу Telegram ID. Введи його вручну.', 'error');
    return;
  }

  closeGate();
  try{
    await loadAndRender(uid);
  } catch(e){
    setHint(e?.message || 'Не вдалося завантажити план', 'error');
  }
})();

$('#uidContinue')?.addEventListener('click', async ()=>{
  const input = $('#uidInput');
  const uid = String(input?.value || '').trim();
  if (!isValidUid(uid)){
    setHint('Введи коректний Telegram ID (лише цифри).', 'error');
    return;
  }
  closeGate();
  try{
    await loadAndRender(uid);
  } catch(e){
    setHint(e?.message || 'Не вдалося завантажити план', 'error');
  }
});
