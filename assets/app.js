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

// ---------- хелпери ----------
const UA_DAYS = ['Понеділок','Вівторок','Середа','Четвер','Пʼятниця','Субота','Неділя'];
function normalizeDayLabel(v, idx){
  if (!v) return UA_DAYS[(idx-1+7)%7] || `День ${idx}`;
  const t = String(v).trim();
  const found = UA_DAYS.find(d => t.toLowerCase().includes(d.toLowerCase()));
  return found || t;
}
function num(x){ const n = Number(x); return Number.isFinite(n) ? n : 0; }
function sumMeals(meals = [], key){ return (meals||[]).reduce((s,m)=>s+num(m?.[key]),0); }
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

// ---- нормалізація meal_plan → days ----
function normalizePlan(raw){
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch {} }
  if (raw && raw.text && typeof raw.text === 'string') { try { raw = JSON.parse(raw.text); } catch {} }
  if (raw?.days && Array.isArray(raw.days)) return raw;

  if (Array.isArray(raw?.meal_plan)) {
    const days = raw.meal_plan.map((d,i)=>{
      const sum = d?.daily_macros_summary || {};
      const meals = Array.isArray(d?.meals) ? d.meals.map(m=>{
        const mac = m?.macros || {};
        return {
          meal_type: m?.meal_type || '',
          title: m?.dish_name || m?.title || m?.meal_type || '',      // << назва страви
          description: m?.description || '',

          // макроси з вкладеного поля "macros"
          kcal: num(mac?.kcal),
          protein_g: num(mac?.protein_g),
          fat_g: num(mac?.fat_g),
          carbs_g: num(mac?.carbs_g),

          swap_suggestions: Array.isArray(m?.swap_suggestions) ? m.swap_suggestions : [],

          // нові поля:
          ingredients: Array.isArray(m?.ingredients) ? m.ingredients : [],
          preparation_instructions: m?.preparation_instructions || ''
        };
      }) : [];
      return {
        day: normalizeDayLabel(d?.day, i+1),
        meals,
        kcal:      num(sum?.kcal),
        protein_g: num(sum?.protein_g),
        fat_g:     num(sum?.fat_g),
        carbs_g:   num(sum?.carbs_g),
      };
    });
    const meta = computePlanMeta({days});
    return {
      meta, days,
      shopping_list: raw?.shopping_list || [],
      notes: raw?.prep_tips || [],
    };
  }
  return { meta:{title:'План харчування'}, days:[] };
}

// ---------- API з таймаутом ----------
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

// ---------- завантаження ----------
async function loadPlan(){
  if (!planId || !token) {
    throw new Error('Не передані plan_id або token у посиланні');
  }
  const data = await callAPI({ act:'get', plan_id:planId, token });
  if (data?.error) throw new Error(data.error);
  const normalized = normalizePlan(data?.plan ?? data);
  if (!Array.isArray(normalized?.days) || !normalized.days.length) {
    throw new Error('Невірний формат плану (відсутні days[])');
  }
  currentPlan = normalized;
  renderPlan(currentPlan);
}

// ---------- рендер ----------
function renderPlan(plan){
  const days = Array.isArray(plan?.days) ? plan.days : [];
  const m = computePlanMeta(plan);
  $('#title').textContent = m.title;
  $('#macros').textContent = `Ккал: ${m.kcal} | Б:${m.protein_g} Ж:${m.fat_g} В:${m.carbs_g}`;

  const tabs = $('#tabs'); tabs.innerHTML = '';
  days.forEach((d,i)=>{
    const b = document.createElement('button');
    b.className = 'tab';
    b.textContent = d?.day ? String(d.day) : normalizeDayLabel('', i+1);
    b.onclick = ()=>renderDay(d, i+1);
    tabs.appendChild(b);
  });
  renderDay(days[0], 1);
}

function renderDay(dayObj, dayNumber){
  const wrap = $('#content'); wrap.innerHTML = '';
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

    // інгредієнти
    const ingHtml = Array.isArray(m?.ingredients) && m.ingredients.length
      ? `<details class="ing-list">
           <summary>Інгредієнти</summary>
           <ul>${
             m.ingredients.map(it=>{
               const qty =
                 (it.raw_grams ? `${it.raw_grams} г` : it.cooked_grams ? `${it.cooked_grams} г (пригот.)` : '')
                 + (it.quantity_details ? ` — ${it.quantity_details}` : '');
               return `<li>${it.item}${qty.trim() ? `: ${qty.trim()}` : ''}</li>`;
             }).join('')
           }</ul>
         </details>`
      : '';

    // інструкції
    const instrHtml = m?.preparation_instructions
      ? `<details class="prep"><summary>Як приготувати</summary><p>${m.preparation_instructions}</p></details>`
      : '';

    const card = document.createElement('section');
    card.className = 'meal card';
    card.innerHTML = `
      <div class="meal-head">
        <h3 class="meal-title">${title}</h3>
        ${hasMacros ? `<div class="meal-macros">Ккал: ${kcal} • Б:${p} • Ж:${f} • В:${c}</div>` : ''}
      </div>
      <p class="meal-desc">${m?.description || ''}</p>
      ${ingHtml}
      ${instrHtml}
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

// ---------- дії ----------
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

// ---------- shopping list ----------
function renderShoppingList(){
  const modal = $('#shoppingModal'); if (!modal) return;
  const body = modal.querySelector('.modal-body'); body.innerHTML = '';
  const list = currentPlan?.shopping_list;
  if (!list || (Array.isArray(list) && !list.length)) { body.innerHTML='<p>Список покупок відсутній.</p>'; return; }

  if (!Array.isArray(list)) {
    // формат категорій
    Object.entries(list).forEach(([cat, items])=>{
      const card = document.createElement('section'); card.className='card';
      let itemsHtml = '';
      if (Array.isArray(items)) {
        itemsHtml = items.map(i=>{
          const qty = (i.quantity ?? i.qty ?? '')
            + (i.unit ? ` ${i.unit}` : '');
        return `<li>${i.item || i.name}${String(qty).trim() ? `: ${qty}` : ''}</li>`;
        }).join('');
      } else {
        itemsHtml = Object.entries(items).map(([name,qty])=>`<li>${name}: ${qty}</li>`).join('');
      }
      card.innerHTML = `<h4>${cat}</h4><ul>${itemsHtml}</ul>`;
      body.appendChild(card);
    });
  } else {
    // твій поточний формат: [{item, quantity, unit}]
    const ul = document.createElement('ul');
    ul.innerHTML = list.map(i=>{
      const qty = (i.quantity != null ? i.quantity : '')
        + (i.unit ? ` ${i.unit}` : '');
      return `<li>${i.item}${String(qty).trim() ? `: ${qty}` : ''}</li>`;
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
// клік по бекдропу + ESC
$('#shoppingModal')?.addEventListener('click', (e)=>{
  if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
});
document.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape') $('#shoppingModal')?.classList.remove('open');
});

// ---------- старт ----------
loadPlan().catch(err=>{
  $('#title').textContent = 'Помилка';
  $('#macros').textContent = err?.message || 'Щось пішло не так';
  console.error('Plan load error:', err);
});
