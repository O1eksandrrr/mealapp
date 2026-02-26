// NutriArt Meal Plan WebApp (GitHub Pages)
// Fix: user was putting only SHEET_ID, which caused HTTP 404. This version accepts SHEET_ID+SHEET_NAME and builds a real CSV URL.
// Also auto-loads by Telegram WebApp uid / ?uid=... and only shows manual input if uid is unavailable.

const tg = window.Telegram?.WebApp;
if (tg) { try { tg.expand(); tg.ready(); } catch {} }

const $ = (sel) => document.querySelector(sel);
const UA_DAYS = ['Понеділок','Вівторок','Середа','Четвер','Пʼятниця','Субота','Неділя'];

let currentPlan = null;

// ===================== CONFIG =====================
// Option A: Published CSV URL (GVIZ):
//   https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?tqx=out:csv&sheet=plans
const SHEET_CSV_URL = ''; // <-- if you set this, leave SHEET_ID/SHEET_NAME empty

// Option B: Just paste your sheet id + exact tab name (we build URL automatically)
const SHEET_ID = '1dWR-VpkGtmorDU1qAAIwbwk7SZxrozY15uN-KcyKwug'; // e.g. 1dWR-VpkQtmorDU1qAAIwbwk7SZxrozY15uN-KcyKwug
const SHEET_NAME = 'plans';             // exact tab name

// Header names in CSV:
const COL_TG_ID_NAME = 'tg_id';       // or 'user_id'
const COL_PLAN_NAME  = 'plan_json';   // JSON string
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
  const el = $('#hint');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'hint' + (kind ? ` ${kind}` : '');
}
function setDebug(msg){
  const el = $('#debug');
  if (!el) return;
  el.textContent = msg || '';
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
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch {} }
  if (raw && typeof raw.text === 'string') { try { raw = JSON.parse(raw.text); } catch {} }
  if (raw?.days && Array.isArray(raw.days)) return raw;
  return raw || { meta:{ title:'План харчування' }, days:[] };
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

async function fetchPlanFromSheet(tgId){
  const csvUrl = buildCsvUrl();
  if (!csvUrl) throw new Error('Не налаштовано таблицю: вкажи SHEET_CSV_URL або SHEET_ID + SHEET_NAME в assets/app.js');

  const r = await fetch(csvUrl, { cache:'no-store' });
  if (!r.ok) throw new Error(`Не вдалося завантажити таблицю (HTTP ${r.status})`);

  const csv = await r.text();
  const rows = parseCSV(csv);
  if (!rows.length) throw new Error('Порожній CSV');

  const header = rows[0].map(h => String(h||'').trim().toLowerCase());
  const idxId = header.findIndex(h => h === COL_TG_ID_NAME.toLowerCase() || h === 'user_id');
  const idxPlan = header.findIndex(h => h === COL_PLAN_NAME.toLowerCase());

  if (idxId < 0 || idxPlan < 0){
    throw new Error(`У CSV має бути заголовок: ${COL_TG_ID_NAME} (або user_id), ${COL_PLAN_NAME}`);
  }

  const target = normalizeId(tgId);
  for (let i=1; i<rows.length; i++){
    const rr = rows[i];
    if (!rr || !rr.length) continue;
    const rid = normalizeId(rr[idxId]);
    if (rid === target){
      const planCell = rr[idxPlan];
      if (!planCell) throw new Error('Знайдено tg_id, але plan_json порожній');
      return normalizePlan(planCell);
    }
  }
  throw new Error('План для цього Telegram ID не знайдено в таблиці');
}

function renderPlan(plan){
  const days = Array.isArray(plan?.days) ? plan.days : [];
  const m = computePlanMeta(plan);

  $('#title') && ($('#title').textContent = m.title);
  $('#macros') && ($('#macros').textContent = `Ккал: ${m.kcal} | Б:${m.protein_g} Ж:${m.fat_g} В:${m.carbs_g}`);

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
    </div>
  `;
  wrap.appendChild(head);

  (dayObj?.meals || []).forEach(m=>{
    const kcal = num(m?.kcal), p=num(m?.protein_g), f=num(m?.fat_g), c=num(m?.carbs_g);
    const hasMacros = kcal||p||f||c;
    const title = m?.title || m?.meal_type || '';

    const card = document.createElement('section');
    card.className = 'meal card';
    card.innerHTML = `
      <div class="meal-head">
        <h3 class="meal-title">${escapeHTML(title)}</h3>
        ${hasMacros ? `<div class="meal-macros">Ккал: ${kcal} • Б:${p} • Ж:${f} • В:${c}</div>` : ''}
      </div>
      ${m?.description ? `<p class="meal-desc">${escapeHTML(m.description)}</p>` : ''}
    `;
    wrap.appendChild(card);
  });
}

function renderShoppingList(){
  const modal = $('#shoppingModal'); if (!modal) return;
  const body = modal.querySelector('.modal-body'); if (!body) return;
  body.innerHTML = '';

  const list = currentPlan?.shopping_list;

  if (!list || (Array.isArray(list) && !list.length)) {
    body.innerHTML = '<p>Список покупок відсутній.</p>';
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'shop-list';
  ul.innerHTML = list.map(i=>{
    if (typeof i === 'string') return `<li>${escapeHTML(i)}</li>`;
    const name = i?.name ?? i?.item ?? '—';
    const qty  = i?.quantity ?? i?.qty ?? '';
    const unit = i?.unit ? ` ${i.unit}` : '';
    const tail = qty ? `: ${qty}${unit}` : '';
    return `<li><span>${escapeHTML(name)}</span><span>${escapeHTML(tail)}</span></li>`;
  }).join('');
  body.appendChild(ul);
}

$('#openShopping')?.addEventListener('click', ()=>{
  renderShoppingList();
  $('#shoppingModal')?.classList.add('open');
});
$('#closeShopping')?.addEventListener('click', ()=>{
  $('#shoppingModal')?.classList.remove('open');
});
document.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape') $('#shoppingModal')?.classList.remove('open');
});
$('#shoppingModal')?.addEventListener('click', (e)=>{
  if (e.target?.classList?.contains('modal')) $('#shoppingModal')?.classList.remove('open');
});

function getUidFromURL(){
  const qs = new URLSearchParams(location.search);
  const uid = qs.get('uid') || qs.get('user_id');
  return uid ? String(uid).trim() : null;
}
function getUidFromTelegram(){
  const id = tg?.initDataUnsafe?.user?.id || tg?.initDataUnsafe?.chat?.id || null;
  return id ? String(id) : null;
}
function openGate(prefill){
  const gate = $('#uidGate'); if (!gate) return;
  gate.classList.add('open');
  gate.setAttribute('aria-hidden','false');
  const input = $('#uidInput');
  if (input && prefill) input.value = String(prefill);
}
function closeGate(){
  const gate = $('#uidGate'); if (!gate) return;
  gate.classList.remove('open');
  gate.setAttribute('aria-hidden','true');
}
function isValidUid(x){ return /^\d{4,20}$/.test(String(x||'').trim()); }

async function loadAndRender(uid){
  const id = normalizeId(uid);
  const csvUrl = buildCsvUrl();
  setHint('Завантажую план…', '');
  setDebug(`tg_id: ${id}\nsource: ${getUidFromTelegram() ? 'Telegram WebApp' : (getUidFromURL() ? 'URL' : 'manual')}\nCSV: ${csvUrl || '(not set)'}`);
  const plan = await fetchPlanFromSheet(id);
  currentPlan = plan;
  renderPlan(plan);
  setHint('План відкрито ✅', 'ok');
}

(async function start(){
  const uid = getUidFromTelegram() || getUidFromURL();
  if (uid && isValidUid(uid)){
    try{
      closeGate();
      await loadAndRender(uid);
      return;
    } catch(e){
      setHint(e?.message || 'Не вдалося завантажити план', 'error');
      openGate(uid);
      return;
    }
  }
  openGate('');
  setHint('Введи Telegram ID, щоб завантажити план.', '');
})();

$('#uidContinue')?.addEventListener('click', async ()=>{
  const input = $('#uidInput');
  const uid = String(input?.value || '').trim();
  if (!isValidUid(uid)){
    setHint('Введи коректний Telegram ID (лише цифри).', 'error');
    return;
  }
  try{
    closeGate();
    await loadAndRender(uid);
  } catch(e){
    openGate(uid);
    setHint(e?.message || 'Не вдалося завантажити план', 'error');
  }
});
