// --- Telegram WebApp bootstrap ---
const tg = window.Telegram?.WebApp;
if (tg) { try { tg.expand(); tg.ready(); } catch {} }

// --- Query params ---
const qs = new URLSearchParams(location.search);
const planId = qs.get('plan_id');
const token  = qs.get('token');

// const API = 'https://<your>.app.n8n.cloud/webhook/plan/get';
const API = 'https://script.google.com/macros/s/AKfycbxq70NDjxdceKIDFVbmhdgPx5LWPrjrZFUhTtXpKL2sLbIDpZ1mO6YP1ph9-IMkWzRuPQ/exec';

let currentPlan = null;
const $ = sel => document.querySelector(sel);

// ---------- Helpers ----------
const UA_DAYS = ['Понеділок','Вівторок','Середа','Четвер','Пʼятниця','Субота','Неділя'];

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
    kcal:      num(meta.kcal)      || avg.kcal,
    protein_g: num(meta.protein_g) || avg.protein_g,
    fat_g:     num(meta.fat_g)     || avg.fat_g,
    carbs_g:   num(meta.carbs_g)   || avg.carbs_g,
  };
}

// ---------- Normalization (supports meal_plan / week_plan / days) ----------
function normalizePlan(raw){
  // allow string / {text:"...json..."}
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch {} }
  if (raw && typeof raw.text === 'string') { try { raw = JSON.parse(raw.text); } catch {} }

  // already normalized?
  if (raw?.days && Array.isArray(raw.days)) return raw;

  const pick = (...keys)=> (obj={})=>{
    for (const k of keys){
      const v = obj?.[k];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  };
  const getDayLabel   = pick('day','day_of_week');
  const getMealTitle  = pick('title','name','dish_name','meal_type');
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

        // normalize ingredients (supports many shapes)
        const ingredients = Array.isArray(m?.ingredients) ? m.ingredients.map(it=>{
          const name = it?.item ?? it?.name ?? '—';
          const qRaw = it?.quantity ?? it?.qty ?? it?.quantity_raw_g ?? it?.raw_grams ?? it?.raw_g;
          const qCook = it?.quantity_cooked_g ?? it?.cooked_grams ?? it?.cooked_g;
          const unit = it?.unit || (
            (qRaw || qCook) ? 'г' : ''
          );
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
          swap_suggestions: Array.isArray(m?.swap_suggestions) ? m.swap_suggestions : []
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
    return {
      meta,
      days,
      shopping_list: raw?.shopping_list ?? [],
      notes: raw?.prep_tips ?? [],
      safety: raw?.safety || {}
    };
  }

  return { meta:{ title:'План харчування' }, days:[] };
}

// ---------- API (timeout + no-store) ----------
async function callAPI(params){
  const url = `${API}?${new URLSearchParams(params).toString()}`;
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), 12000);
  try{
    const r = await fetch(url, {
      headers: { 'Accept':'application/json' },
      mode: 'cors',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch(e){
    throw new Error(e.name === 'AbortError' ? 'Таймаут з’єднання' : (e.message || 'Failed to fetch'));
  } finally { clearTimeout(t); }
}

// ---------- Load ----------
async function loadPlan(){
  if (!planId || !token) throw new Error('Не передані plan_id або token у посиланні');
  const data = await callAPI({ act:'get', plan_id:planId, token });
  if (data?.error) throw new Error(data.error);

  const normalized = normalizePlan(data?.plan ?? data);
  if (!Array.isArray(normalized?.days) || !normalized.days.length) {
    throw new Error('Невірний формат плану (відсутні days[])');
  }
  currentPlan = normalized;
  renderPlan(currentPlan);
}

// ---------- Render ----------
function renderPlan(plan){
  const days = Array.isArray(plan?.days) ? plan.days : [];
  const m = computePlanMeta(plan);

  $('#title') && ($('#title').textContent = m.title);
  $('#macros') && ($('#macros').textContent = `Ккал: ${m.kcal} | Б:${m.protein_g} Ж:${m.fat_g} В:${m.carbs_g}`);

  const tabs = $('#tabs'); if (tabs){ tabs.innerHTML = '';
    days.forEach((d,i)=>{
      const b = document.createElement('button');
      b.className = 'tab';
      b.textContent = d?.day ? String(d.day) : normalizeDayLabel('', i+1);
      b.onclick = ()=>renderDay(d, i+1);
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
  head.className = 'day-head';
  head.innerHTML = `
    <div>
      <h2 class="day-title">${dayObj?.day || normalizeDayLabel('', dayNumber)}</h2>
      <div class="day-macros">Ккал: ${dm.kcal} • Б:${dm.protein_g} • Ж:${dm.fat_g} • В:${dm.carbs_g}</div>
    </div>
    <div class="day-actions"><button id="swapDay" class="btn ghost">🔁 Замінити день</button></div>
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
        <h3 class="meal-title">${title}</h3>
        ${hasMacros ? `<div class="meal-macros">Ккал: ${kcal} • Б:${p} • Ж:${f} • В:${c}</div>` : ''}
      </div>
      ${m?.description ? `<p class="meal-desc">${m.description}</p>` : ''}

      ${Array.isArray(m?.ingredients) && m.ingredients.length ? `
        <details class="ing">
          <summary>Інгредієнти</summary>
          <ul class="ing-list">
            ${m.ingredients.map(i=>`<li><span>${i.name}</span><span>${i.qty||''}</span></li>`).join('')}
          </ul>
        </details>
      ` : ''}

      ${m?.instructions ? `
        <details class="instr">
          <summary>Спосіб приготування</summary>
          <div class="instr-text">${m.instructions}</div>
        </details>
      ` : ''}

      ${Array.isArray(m?.swap_suggestions) && m.swap_suggestions.length
        ? `<details class="swap-list"><summary>Можливі заміни</summary>
             <ul>${m.swap_suggestions.map(s=>`<li>${s}</li>`).join('')}</ul>
           </details>` : ''
      }
      <div class="meal-actions"><button class="btn" data-meal="${m?.meal_type || ''}">🔄 Замінити страву</button></div>
    `;
    card.querySelector('.btn[data-meal]')?.addEventListener('click', async ()=>{
      await doSwapMeal(dayNumber, m?.meal_type || '');
    });
    wrap.appendChild(card);
  });

  $('#swapDay')?.addEventListener('click', async ()=>{ await doSwapDay(dayNumber); });
}

// ---------- Actions ----------
async function doSwapMeal(day, mealType){
  try{
    tg?.MainButton?.showProgress?.();
    const res = await callAPI({ act:'swapMeal', plan_id:planId, token, day, meal_type:mealType });
    if (res?.ok && res?.plan_updated) { currentPlan = normalizePlan(res.plan_updated); renderPlan(currentPlan); }
    else throw new Error(res?.error || 'swapMeal failed');
  } finally { tg?.MainButton?.hide?.(); }
}
async function doSwapDay(day){
  try{
    tg?.MainButton?.showProgress?.();
    const res = await callAPI({ act:'swapDay', plan_id:planId, token, day });
    if (res?.ok && res?.plan_updated) { currentPlan = normalizePlan(res.plan_updated); renderPlan(currentPlan); }
    else throw new Error(res?.error || 'swapDay failed');
  } finally { tg?.MainButton?.hide?.(); }
}
$('#regenPlan')?.addEventListener('click', async ()=>{
  try{
    tg?.MainButton?.showProgress?.();
    const res = await callAPI({ act:'swapPlan', plan_id:planId, token });
    if (res?.ok && res?.plan_updated) { currentPlan = normalizePlan(res.plan_updated); renderPlan(currentPlan); }
    else throw new Error(res?.error || 'swapPlan failed');
  } finally { tg?.MainButton?.hide?.(); }
});

// ---------- Shopping List Modal ----------
function renderShoppingList(){
  const modal = $('#shoppingModal'); if (!modal) return;
  const body = modal.querySelector('.modal-body'); if (!body) return;
  body.innerHTML = '';

  const list = currentPlan?.shopping_list;

  if (!list || (Array.isArray(list) && !list.length) || (typeof list === 'object' && !Array.isArray(list) && !Object.keys(list).length)) {
    body.innerHTML = '<p>Список покупок відсутній.</p>';
    return;
  }

  // If object with categories
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
          return `<li>${name}${tail}</li>`;
        }).join('');
      } else {
        itemsHtml = Object.entries(items).map(([name, v])=>{
          const val = (typeof v === 'object') ? (v?.quantity ?? v?.qty ?? '') + (v?.unit ? ` ${v.unit}` : '') : v;
          return `<li>${name}: ${val ?? ''}</li>`;
        }).join('');
      }
      card.innerHTML = `<h4>${category}</h4><ul>${itemsHtml}</ul>`;
      body.appendChild(card);
    });
  } else {
    // Array of strings or {item/name, quantity, unit}
    const ul = document.createElement('ul');
    ul.className = 'shop-list';
    ul.innerHTML = list.map(i=>{
      if (typeof i === 'string') return `<li>${i}</li>`;
      const name = i?.name ?? i?.item ?? '—';
      const qty  = i?.quantity ?? i?.qty ?? '';
      const unit = i?.unit ? ` ${i.unit}` : '';
      const tail = qty ? `: ${qty}${unit}` : '';
      return `<li><span>${name}</span><span>${tail}</span></li>`;
    }).join('');
    body.appendChild(ul);
  }
}

// open/close + UX
$('#openShopping')?.addEventListener('click', ()=>{
  renderShoppingList();
  const m = $('#shoppingModal'); m?.classList.add('open');
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

// ---------- Start ----------
loadPlan().catch(err=>{
  $('#title') && ($('#title').textContent = 'Помилка');
  $('#macros') && ($('#macros').textContent = err?.message || 'Щось пішло не так');
  console.error('Plan load error:', err);
});
