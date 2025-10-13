const tg = window.Telegram?.WebApp;
if (tg) { tg.expand(); tg.ready(); }

const qs = new URLSearchParams(location.search);
const planId = qs.get('plan_id');
const token  = qs.get('token');

// Можеш підмінити на n8n-проксі:
// const API = 'https://<твій>.app.n8n.cloud/webhook/plan/get';
const API = 'https://script.google.com/macros/s/AKfycbxq70NDjxdceKIDFVbmhdgPx5LWPrjrZFUhTtXpKL2sLbIDpZ1mO6YP1ph9-IMkWzRuPQ/exec';

let currentPlan = null;
const $ = sel => document.querySelector(sel);

// ---------- Хелпери ----------
const UA_DAYS = ['Понеділок','Вівторок','Середа','Четвер','Пʼятниця','Субота','Неділя'];
function normalizeDayLabel(v, idx){
  if (!v) return UA_DAYS[(idx-1+7)%7] || `День ${idx}`;
  const t = String(v).trim();
  // якщо вже слово з нашого списку — лишаємо
  const found = UA_DAYS.find(d => t.toLowerCase().includes(d.toLowerCase()));
  if (found) return found;
  return t; // наприклад "Day 1" або "Понеділок" іншим кейсом
}

function num(x){ const n = Number(x); return Number.isFinite(n) ? n : 0; }
function sumMeals(meals = [], key) {
  return (meals || []).reduce((s, m) => s + num(m?.[key]), 0);
}
function computeDayMacros(day = {}) {
  const meals = Array.isArray(day?.meals) ? day.meals : [];
  return {
    kcal:      num(day?.kcal)      || sumMeals(meals, 'kcal'),
    protein_g: num(day?.protein_g) || sumMeals(meals, 'protein_g'),
    fat_g:     num(day?.fat_g)     || sumMeals(meals, 'fat_g'),
    carbs_g:   num(day?.carbs_g)   || sumMeals(meals, 'carbs_g'),
  };
}
function computePlanMeta(plan = {}) {
  const days = Array.isArray(plan?.days) ? plan.days : [];
  const meta = plan?.meta || {};
  const totals = days.map(d => computeDayMacros(d));
  const avg = totals.length
    ? {
        kcal:      Math.round(totals.reduce((s,d)=>s+d.kcal,0)      / totals.length),
        protein_g: Math.round(totals.reduce((s,d)=>s+d.protein_g,0) / totals.length),
        fat_g:     Math.round(totals.reduce((s,d)=>s+d.fat_g,0)     / totals.length),
        carbs_g:   Math.round(totals.reduce((s,d)=>s+d.carbs_g,0)   / totals.length),
      }
    : {kcal:0, protein_g:0, fat_g:0, carbs_g:0};

  return {
    title: meta.title || 'План харчування',
    kcal:      num(meta.kcal)      || avg.kcal,
    protein_g: num(meta.protein_g) || avg.protein_g,
    fat_g:     num(meta.fat_g)     || avg.fat_g,
    carbs_g:   num(meta.carbs_g)   || avg.carbs_g,
  };
}

// ---- Нормалізація формату meal_plan → days (як у твоєму джерелі) ----
function normalizePlan(raw) {
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch {} }
  if (raw && raw.text && typeof raw.text === 'string') { try { raw = JSON.parse(raw.text); } catch {} }

  if (raw?.days && Array.isArray(raw.days)) return raw;

  if (Array.isArray(raw?.meal_plan)) {
    const days = raw.meal_plan.map((d, i) => {
      const sum = d?.daily_macros_summary || {};
      const meals = Array.isArray(d?.meals) ? d.meals.map(m => ({
        meal_type: m?.meal_type || '',
        title: m?.title || '', // якщо AI не дав title — нижче в рендері візьмемо meal_type
        description: m?.description || '',
        kcal: num(m?.kcal), protein_g: num(m?.protein_g), fat_g: num(m?.fat_g), carbs_g: num(m?.carbs_g),
        swap_suggestions: Array.isArray(m?.swap_suggestions) ? m.swap_suggestions : []
      })) : [];
      return {
        day: normalizeDayLabel(d?.day, i+1),
        meals,
        kcal:      num(sum?.kcal),
        protein_g: num(sum?.protein_g),
        fat_g:     num(sum?.fat_g),
        carbs_g:   num(sum?.carbs_g),
      };
    });

    const meta = computePlanMeta({ days });
    const plan = {
      meta, days,
      shopping_list: raw?.shopping_list || [],
      notes: raw?.prep_tips || [],
    };
    return plan;
  }

  return { meta: { title: 'План харчування'}, days: [] };
}

// ---------- API ----------
async function callAPI(params){
  const url = `${API}?${new URLSearchParams(params).toString()}`;
  const r = await fetch(url, { headers: { 'Accept':'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function loadPlan(){
  const data = await callAPI({ act:'get', plan_id:planId, token });
  if (data?.error) throw new Error(data.error);
  const normalized = normalizePlan(data?.plan ?? data);
  if (!Array.isArray(normalized?.days) || !normalized.days.length) {
    throw new Error('Невірний формат плану (відсутні days[])');
  }
  currentPlan = normalized;
  renderPlan(currentPlan);
}

// ---------- Рендер ----------
function renderPlan(plan){
  const days = Array.isArray(plan?.days) ? plan.days : [];
  const m = computePlanMeta(plan);

  $('#title').textContent = m.title;
  $('#macros').textContent = `Ккал: ${m.kcal} | Б:${m.protein_g} Ж:${m.fat_g} В:${m.carbs_g}`;

  // кнопки днів — ТІЛЬКИ назви днів, без «День»
  const tabs = $('#tabs'); tabs.innerHTML = '';
  days.forEach((d, i) => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.textContent = d?.day ? String(d.day) : normalizeDayLabel('', i+1);
    b.onclick = () => renderDay(d, i+1);
    tabs.appendChild(b);
  });
  renderDay(days[0], 1);
}

function renderDay(dayObj, dayNumber){
  const wrap = $('#content'); wrap.innerHTML = '';
  const dm = computeDayMacros(dayObj);

  // Заголовок дня — лише назва дня
  const dayHeader = document.createElement('div');
  dayHeader.className = 'day-head';
  dayHeader.innerHTML = `
    <div>
      <h2 class="day-title">${dayObj?.day || normalizeDayLabel('', dayNumber)}</h2>
      <div class="day-macros">Ккал: ${dm.kcal} • Б:${dm.protein_g} • Ж:${dm.fat_g} • В:${dm.carbs_g}</div>
    </div>
    <div class="day-actions">
      <button id="swapDay" class="btn ghost">🔁 Замінити день</button>
    </div>
  `;
  wrap.appendChild(dayHeader);

  // Карточки прийомів їжі
  (dayObj?.meals || []).forEach(m=>{
    const kcal = num(m?.kcal), p = num(m?.protein_g), f = num(m?.fat_g), c = num(m?.carbs_g);
    const hasMacros = kcal || p || f || c;
    const title = m?.title || m?.meal_type || '';

    const card = document.createElement('section');
    card.className = 'meal card';
    card.innerHTML = `
      <div class="meal-head">
        <h3 class="meal-title">${title}</h3>
        ${hasMacros ? `<div class="meal-macros">Ккал: ${kcal} • Б:${p} • Ж:${f} • В:${c}</div>` : ''}
      </div>
      <p class="meal-desc">${m?.description || ''}</p>
      ${Array.isArray(m?.swap_suggestions) && m.swap_suggestions.length
        ? `<details class="swap-list">
             <summary>Можливі заміни</summary>
             <ul>${m.swap_suggestions.map(s=>`<li>${s}</li>`).join('')}</ul>
           </details>`
        : ''
      }
      <div class="meal-actions">
        <button class="btn" data-meal="${m?.meal_type || ''}">🔄 Замінити страву</button>
      </div>
    `;
    card.querySelector('.btn[data-meal]')?.addEventListener('click', async ()=>{
      await doSwapMeal(dayNumber, m?.meal_type || '');
    });
    wrap.appendChild(card);
  });

  // події
  $('#swapDay').onclick = async ()=> { await doSwapDay(dayNumber); };
}

// ---------- Дії (swap’и) ----------
async function doSwapMeal(day, mealType){
  try{
    tg?.MainButton?.showProgress?.();
    const res = await callAPI({ act:'swapMeal', plan_id:planId, token, day, meal_type:mealType });
    if (res?.ok && res?.plan_updated) {
      currentPlan = normalizePlan(res.plan_updated);
      renderPlan(currentPlan);
    } else throw new Error(res?.error || 'swapMeal failed');
  } finally {
    tg?.MainButton?.hide?.();
  }
}

async function doSwapDay(day){
  try{
    tg?.MainButton?.showProgress?.();
    const res = await callAPI({ act:'swapDay', plan_id:planId, token, day });
    if (res?.ok && res?.plan_updated) {
      currentPlan = normalizePlan(res.plan_updated);
      renderPlan(currentPlan);
    } else throw new Error(res?.error || 'swapDay failed');
  } finally {
    tg?.MainButton?.hide?.();
  }
}

$('#regenPlan').onclick = async ()=>{
  try{
    tg?.MainButton?.showProgress?.();
    const res = await callAPI({ act:'swapPlan', plan_id:planId, token });
    if (res?.ok && res?.plan_updated) {
      currentPlan = normalizePlan(res.plan_updated);
      renderPlan(currentPlan);
    } else throw new Error(res?.error || 'swapPlan failed');
  } finally {
    tg?.MainButton?.hide?.();
  }
};

// ---------- Shopping List Modal ----------
function renderShoppingList(){
  const m = $('#shoppingModal');
  if (!m) return;
  const body = m.querySelector('.modal-body');
  body.innerHTML = '';

  const list = currentPlan?.shopping_list;
  if (!list || (Array.isArray(list) && !list.length)) {
    body.innerHTML = '<p>Список покупок відсутній.</p>';
    return;
  }

  // підтримка і формату-об’єкта, і масиву
  if (!Array.isArray(list)) {
    Object.entries(list).forEach(([category, items])=>{
      const card = document.createElement('section');
      card.className = 'card';
      let itemsHtml = '';
      if (Array.isArray(items)) {
        itemsHtml = items.map(i => `<li>${i.name ? `${i.name}: ${i.qty||''}` : i}</li>`).join('');
      } else {
        itemsHtml = Object.entries(items).map(([name, qty]) => `<li>${name}: ${qty}</li>`).join('');
      }
      card.innerHTML = `<h4>${category}</h4><ul>${itemsHtml}</ul>`;
      body.appendChild(card);
    });
  } else {
    const ul = document.createElement('ul');
    ul.innerHTML = list.map(i => `<li>${i.name}: ${i.qty||''}</li>`).join('');
    body.appendChild(ul);
  }
}

$('#openShopping').onclick = ()=>{
  renderShoppingList();
  $('#shoppingModal').classList.add('open');
};
$('#closeShopping').onclick = ()=> $('#shoppingModal').classList.remove('open');

// ---------- Старт ----------
loadPlan().catch(err=>{
  $('#title').textContent = 'Помилка';
  $('#macros').textContent = err?.message || 'Щось пішло не так';
  console.error('Plan load error:', err);
});
