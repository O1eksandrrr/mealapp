// NutriArt Meal Plan WebApp (no Apps Script / no custom backend)
//
// What you asked:
// - You generate a plan and save it into Google Sheets
// - In n8n button "Open plan" you open: https://o1eksandrrr.github.io/mealapp/
// - We must add Telegram ID to this link (tg_id) and the webapp must require tg_id on вході
//
// This implementation:
// 1) Requires tg_id (from Telegram WebApp context OR URL OR manual input form)
// 2) Loads plan for tg_id from Google Sheet (published-to-web) and renders it
// 3) Falls back to localStorage cache if sheet is unavailable
//
// IMPORTANT:
// - To fetch without backend, the sheet must be PUBLIC (Publish to web).
// - Sheet columns assumed:
//    A = tg_id
//    B = plan_json (stringified JSON)

// --- Telegram WebApp bootstrap ---
const tg = window.Telegram?.WebApp;
if (tg) { try { tg.expand(); tg.ready(); } catch {} }

const $ = (sel) => document.querySelector(sel);

const UA_DAYS = ['Понеділок','Вівторок','Середа','Четвер','Пʼятниця','Субота','Неділя'];

// ====================== CONFIG ======================
const SHEET_ID = 'PASTE_YOUR_SHEET_ID_HERE'; // e.g. 1AbC... from https://docs.google.com/spreadsheets/d/<ID>/edit
const SHEET_TAB = 'Plans';                   // your tab name
const COL_TG_ID = 1;                         // Column A
const COL_PLAN  = 2;                         // Column B
// ====================================================

let currentPlan = null;
let currentTgId = null;

// -------------------- UI helpers --------------------
function setHint(msg, kind){
  const el = $('#hint');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'hint' + (kind ? ` ${kind}` : '');
}
function setGateHint(msg, kind){
  const el = $('#gateHint');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'hint' + (kind ? ` ${kind}` : '');
}
function escapeHTML(s){
  return String(s ?? '').replace(/[&<>"']/g, ch => (
    ch === '&' ? '&amp;' :
    ch === '<' ? '&lt;'  :
    ch === '>' ? '&gt;'  :
    ch === '"' ? '&quot;':
    '&#39;'
  ));
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
    kcal:      num(meta.kcal)      || avg.kcal,
    protein_g: num(meta.protein_g) || avg.protein_g,
    fat_g:     num(meta.fat_g)     || avg.fat_g,
    carbs_g:   num(meta.carbs_g)   || avg.carbs_g,
  };
}

function normalizeDayLabel(v, idx){
  if (!v) return UA_DAYS[(idx-1+7)%7] || `День ${idx}`;
  const t = String(v).trim();
  const found = UA_DAYS.find(d => t.toLowerCase().includes(d.toLowerCase()));
  return found || t;
}

// -------------------- Normalization --------------------
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
  const getDayMacros  = (d)=> d?.daily_total || {
    kcal:      (d?.meals||[]).reduce((s,m)=> s + (Number(getMealMacros(m).kcal)      ||0),0),
    protein_g: (d?.meals||[]).reduce((s,m)=> s + (Number(getMealMacros(m).protein_g) ||0),0),
    fat_g:     (d?.meals||[]).reduce((s,m)=> s + (Number(getMealMacros(m).fat_g)     ||0),0),
    carbs_g:   (d?.meals||[]).reduce((s,m)=> s + (Number(getMealMacros(m).carbs_g)   ||0),0),
  };

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
          const qRaw = it?.quantity ?? it?.qty ?? it?.quantity_raw_g ?? it?.raw_grams ?? it?.raw_g;
          const qCook = it?.quantity_cooked_g ?? it?.cooked_grams ?? it?.cooked_g;
          const unit = it?.unit || ((qRaw || qCook) ? 'г' : '');
          const qty = (qRaw ?? qCook ?? '');
          const qtyStr = (qty !== '' ? `${qty}${unit?` ${unit}`:''}` : (it?.quantity_details || ''));
          return { name, qty: qtyStr };
        }) : [];

        return {
          meal_type: m?.meal_type || '',
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
    return { meta, days, shopping_list: raw?.shopping_list ?? [], notes: raw?.prep_tips ?? [] };
  }

  return { meta:{ title:'План харчування' }, days:[] };
}

// -------------------- Storage cache --------------------
function storageKey(tgId){ return tgId ? `nutriart_plan_${tgId}` : null; }

function savePlanToStorage(tgId, planObj){
  const key = storageKey(tgId);
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(planObj));
}
function loadPlanFromStorage(tgId){
  const key = storageKey(tgId);
  if (!key) return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// -------------------- Google Sheet fetch (no backend) --------------------
function gvizUrl(){
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(SHEET_ID)}/gviz/tq?sheet=${encodeURIComponent(SHEET_TAB)}&tqx=out:json`;
}

function parseGviz(text){
  const m = text.match(/setResponse\((.*)\);?\s*$/s);
  if (!m) throw new Error('GViz: unexpected response');
  return JSON.parse(m[1]);
}

async function loadPlanFromSheet(tgId){
  if (!SHEET_ID || SHEET_ID.includes('PASTE_YOUR_SHEET_ID_HERE')) {
    throw new Error('Не налаштовано SHEET_ID у assets/app.js');
  }

  const r = await fetch(gvizUrl(), { cache:'no-store' });
  if (!r.ok) throw new Error(`Не вдалося завантажити таблицю (HTTP ${r.status}). Перевір: Publish to web.`);
  const txt = await r.text();
  const data = parseGviz(txt);

  const rows = data?.table?.rows || [];
  const tgCol = COL_TG_ID - 1;
  const planCol = COL_PLAN - 1;

  for (const row of rows){
    const tgCell = row?.c?.[tgCol]?.v;
    const planCell = row?.c?.[planCol]?.v;
    if (String(tgCell) === String(tgId) && planCell){
      return normalizePlan(planCell);
    }
  }
  return null;
}

// -------------------- Render --------------------
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

// -------------------- Shopping list modal --------------------
function renderShoppingList(){
  const modal = $('#shoppingModal'); if (!modal) return;
  const body = modal.querySelector('.modal-body'); if (!body) return;
  body.innerHTML = '';

  const list = currentPlan?.shopping_list;

  if (!list || (Array.isArray(list) && !list.length) || (typeof list === 'object' && !Array.isArray(list) && !Object.keys(list).length)) {
    body.innerHTML = '<p>Список покупок відсутній.</p>';
    return;
  }

  if (!Array.isArray(list)) {
    Object.entries(list).forEach(([category, items])=>{
      const card = document.createElement('section');
      card.className = 'card';
      let itemsHtml = '';
      if (Array.isArray(items)) {
        itemsHtml = items.map(i=>{
          const name = i?.name ?? i?.item ?? String(i);
          const qty  = i?.qty ?? i?.quantity ?? '';
          const unit = i?.unit ? ` ${i.unit}` : '';
          const tail = qty ? `: ${qty}${unit}` : '';
          return `<li>${escapeHTML(name)}${escapeHTML(tail)}</li>`;
        }).join('');
      } else {
        itemsHtml = Object.entries(items).map(([name, v])=>{
          const val = (typeof v === 'object')
            ? `${v?.quantity ?? v?.qty ?? ''}${v?.unit ? ` ${v.unit}` : ''}`
            : String(v ?? '');
          return `<li>${escapeHTML(name)}: ${escapeHTML(val)}</li>`;
        }).join('');
      }
      card.innerHTML = `<h4>${escapeHTML(category)}</h4><ul>${itemsHtml}</ul>`;
      body.appendChild(card);
    });
  } else {
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

// -------------------- Gate logic --------------------
function getTgIdFromUrl(){
  const qs = new URLSearchParams(location.search);
  return qs.get('tg_id') || qs.get('telegram_id') || qs.get('plan_id');
}

function getTgIdFromTelegram(){
  return tg?.initDataUnsafe?.plan?.id || tg?.initDataUnsafe?.chat?.id || null;
}

function isValidTgId(v){
  const s = String(v || '').trim();
  return /^\d{5,15}$/.test(s);
}

function openGate(prefill){
  const gate = $('#gate'); if (!gate) return;
  gate.classList.add('open');
  gate.setAttribute('aria-hidden','false');
  const inp = $('#tgIdInput');
  if (inp && prefill && !inp.value) inp.value = String(prefill);
}

function closeGate(){
  const gate = $('#gate'); if (!gate) return;
  gate.classList.remove('open');
  gate.setAttribute('aria-hidden','true');
}

async function loadForTgId(tgId){
  currentTgId = String(tgId);

  setHint('Завантажую план…', '');
  // 1) Try sheet
  try{
    const plan = await loadPlanFromSheet(currentTgId);
    if (plan && Array.isArray(plan.days) && plan.days.length){
      currentPlan = plan;
      savePlanToStorage(currentTgId, currentPlan);
      setHint('План завантажено ✅', 'ok');
      renderPlan(currentPlan);
      return;
    }
  } catch(e){
    console.warn('Sheet load error:', e);
    setHint(`Не вдалося завантажити з таблиці: ${e.message}. Спробую кеш…`, 'error');
  }

  // 2) Cache fallback
  const cached = loadPlanFromStorage(currentTgId);
  if (cached){
    currentPlan = normalizePlan(cached);
    if (Array.isArray(currentPlan.days) && currentPlan.days.length){
      setHint('План завантажено з кешу ✅', 'ok');
      renderPlan(currentPlan);
      return;
    }
  }

  setHint('План не знайдено. Перевір Telegram ID або чи збережено план у таблиці.', 'error');
  $('#title') && ($('#title').textContent = 'Помилка');
  $('#macros') && ($('#macros').textContent = 'План не знайдено');
}

// Form submit
$('#tgForm')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const v = $('#tgIdInput')?.value;
  if (!isValidTgId(v)){
    setGateHint('Введи коректний Telegram ID (лише цифри).', 'error');
    return;
  }
  setGateHint('', '');
  closeGate();

  // keep tg_id in URL for shareability
  const url = new URL(location.href);
  url.searchParams.set('tg_id', String(v).trim());
  history.replaceState({}, '', url.toString());

  await loadForTgId(String(v).trim());
});

// -------------------- Start --------------------
(function start(){
  const fromTg = getTgIdFromTelegram();
  const fromUrl = getTgIdFromUrl();

  const prefill = (isValidTgId(fromTg) ? fromTg : (isValidTgId(fromUrl) ? fromUrl : null));

  openGate(prefill);

  // Auto-load if we have tg_id
  if (prefill){
    const inp = $('#tgIdInput');
    if (inp) inp.value = String(prefill);
    closeGate();
    loadForTgId(String(prefill));
  } else {
    setGateHint('Введи Telegram ID, або відкрий через Telegram кнопку WebApp.', '');
  }
})();
