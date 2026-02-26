const tg = window.Telegram?.WebApp;
if (tg) { try { tg.expand(); tg.ready(); } catch {} }

const $ = (sel) => document.querySelector(sel);
const UA_DAYS = ['Понеділок','Вівторок','Середа','Четвер','Пʼятниця','Субота','Неділя'];

let currentPlan = null;

// ===================== CONFIG =====================
// Put your published-to-web CSV URL (tab with plans).
// Example (GVIZ CSV):
// https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?tqx=out:csv&sheet=plans
const SHEET_CSV_URL = '1dWR-VpkGtmorDU1qAAIwbwk7SZxrozY15uN-KcyKwug'; // <-- SET THIS

// Header names in that CSV:
const COL_TG_ID_NAME = 'client_telegram_id';       // or 'user_id'
const COL_PLAN_NAME  = 'plan_json';   // JSON string
// ==================================================

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

  const pick = (...keys)=> (obj={})=>{
    for (const k of keys){
      const v = obj?.[k];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  };

  const getDayLabel   = pick('day','day_of_week');
  const getMealTitle  = pick('title','name','meal_name','dish_name','meal_type');
  const getMealDesc   = pick('description');
  const getMealInstr  = pick('instructions','preparation_instructions');
  const getMealMacros = (m)=> m?.macros || m?.nutritional_info || {};
  const getDayMacros  = (d)=> d?.daily_total || {kcal:0,protein_g:0,fat_g:0,carbs_g:0};

  const srcDays = Array.isArray(raw?.meal_plan) ? raw.meal_plan
               : Array.isArray(raw?.week_plan) ? raw.week_plan
               : null;

  if (Array.isArray(srcDays)) {
    const days = srcDays.map((d,i)=>{
      const sum = getDayMacros(d);
      const meals = Array.isArray(d?.meals) ? d.meals.map(m=>{
        const mm = getMealMacros(m);
        const ingredients = Array.isArray(m?.ingredients) ? m.ingredients.map(it=>{
          const name = it?.item ?? it?.name ?? '—';
          const qty  = it?.quantity ?? it?.qty ?? '';
          const unit = it?.unit ? ` ${it.unit}` : '';
          return { name, qty: `${qty}${unit}`.trim() };
        }) : [];
        return {
          title: getMealTitle(m) || '',
          description: getMealDesc(m) || '',
          instructions: getMealInstr(m) || '',
          ingredients,
          kcal:      Number(mm?.kcal)      || 0,
          protein_g: Number(mm?.protein_g) || 0,
          fat_g:     Number(mm?.fat_g)     || 0,
          carbs_g:   Number(mm?.carbs_g)   || 0,
        };
      }) : [];

      return {
        day: normalizeDayLabel(getDayLabel(d), i+1),
        meals,
        kcal:      Number(sum?.kcal)      || 0,
        protein_g: Number(sum?.protein_g) || 0,
        fat_g:     Number(sum?.fat_g)     || 0,
        carbs_g:   Number(sum?.carbs_g)   || 0,
      };
    });

    const meta = computePlanMeta({ days });
    return { meta, days, shopping_list: raw?.shopping_list ?? [] };
  }

  return { meta:{ title:'План харчування' }, days:[] };
}

// --- CSV parser ---
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
  if (!SHEET_CSV_URL) throw new Error('SHEET_CSV_URL не налаштований у assets/app.js');
  const r = await fetch(SHEET_CSV_URL, { cache:'no-store' });
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

// --- Render ---
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
    const title = m?.title || '';

    const card = document.createElement('section');
    card.className = 'meal card';
    card.innerHTML = `
      <div class="meal-head">
        <h3 class="meal-title">${escapeHTML(title)}</h3>
        ${hasMacros ? `<div class="meal-macros">Ккал: ${kcal} • Б:${p} • Ж:${f} • В:${c}</div>` : ''}
      </div>
      ${m?.description ? `<p class="meal-desc">${escapeHTML(m.description)}</p>` : ''}

      ${Array.isArray(m?.ingredients) && m.ingredients.length ? `
        <details class="ing">
          <summary>Інгредієнти</summary>
          <ul class="ing-list">
            ${m.ingredients.map(i=>`<li><span>${escapeHTML(i.name)}</span><span>${escapeHTML(i.qty||'')}</span></li>`).join('')}
          </ul>
        </details>
      ` : ''}

      ${m?.instructions ? `
        <details class="instr">
          <summary>Спосіб приготування</summary>
          <div class="instr-text">${escapeHTML(m.instructions)}</div>
        </details>
      ` : ''}
    `;
    wrap.appendChild(card);
  });
}

// Shopping
function renderShoppingList(){
  const modal = $('#shoppingModal'); if (!modal) return;
  const body = modal.querySelector('.modal-body'); if (!body) return;
  body.innerHTML = '';

  const list = currentPlan?.shopping_list;

  if (!list || (Array.isArray(list) && !list.length) || (typeof list === 'object' && !Array.isArray(list) && !Object.keys(list).length)) {
    body.innerHTML = '<p>Список покупок відсутній.</p>';
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'shop-list';

  if (Array.isArray(list)){
    ul.innerHTML = list.map(i=>{
      if (typeof i === 'string') return `<li>${escapeHTML(i)}</li>`;
      const name = i?.name ?? i?.item ?? '—';
      const qty  = i?.quantity ?? i?.qty ?? '';
      const unit = i?.unit ? ` ${i.unit}` : '';
      const tail = qty ? `: ${qty}${unit}` : '';
      return `<li><span>${escapeHTML(name)}</span><span>${escapeHTML(tail)}</span></li>`;
    }).join('');
  } else {
    ul.innerHTML = Object.entries(list).map(([name, v])=>{
      const val = (typeof v === 'object')
        ? `${v?.quantity ?? v?.qty ?? ''}${v?.unit ? ` ${v.unit}` : ''}`
        : String(v ?? '');
      return `<li><span>${escapeHTML(name)}</span><span>${escapeHTML(val)}</span></li>`;
    }).join('');
  }

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
  setHint('Завантажую план…', '');
  setDebug(`tg_id: ${id}\nsource: ${getUidFromTelegram() ? 'Telegram WebApp' : (getUidFromURL() ? 'URL' : 'manual')}\nCSV: ${SHEET_CSV_URL || '(not set)'}`);
  const plan = await fetchPlanFromSheet(id);
  if (!Array.isArray(plan?.days) || !plan.days.length){
    throw new Error('План знайдено, але він порожній або має невірний формат');
  }
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
