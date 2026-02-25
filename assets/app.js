// NutriArt AI — Plan viewer (1 user = 1 plan)
//
// New logic:
// - We DO NOT require plan_id/token in URL.
// - We identify the user via Telegram WebApp initDataUnsafe (and recommend validating initData on backend).
// - We load / swap using user_id.
// - Optional: allow ?user_id=123 in URL for testing in browser (not for production).

// --- Telegram WebApp bootstrap ---
const tg = window.Telegram?.WebApp;
if (tg) { try { tg.expand(); tg.ready(); } catch {} }

// --- Config ---
const API = 'https://script.google.com/macros/s/AKfycbxq70NDjxdceKIDFVbmhdgPx5LWPrjrZFUhTtXpKL2sLbIDpZ1mO6YP1ph9-IMkWzRuPQ/exec';

// Backend actions (rename here if your backend uses different names)
const ACT = {
  getByUser: 'getByUser',
  swapMealByUser: 'swapMealByUser',
  swapDayByUser: 'swapDayByUser',
  swapPlanByUser: 'swapPlanByUser',
};

let currentPlan = null;
const $ = (sel) => document.querySelector(sel);

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

// ---------- UI hint ----------
function showHint(text, kind='info'){
  const el = $('#hint');
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('error', kind === 'error');
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
  const getMealTitle  = pick('title','name','dish_name','meal_name','meal_type');
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

// ---------- Identify user (Telegram user id) ----------
function getTelegramUserId(){
  // Primary path (Telegram WebApp)
  const id = tg?.initDataUnsafe?.user?.id || tg?.initDataUnsafe?.chat?.id;
  if (id) return String(id);

  // Optional dev/test path: ?user_id=123 (do not rely on this in production)
  const qs = new URLSearchParams(location.search);
  const qid = qs.get('user_id') || qs.get('uid');
  if (qid) return String(qid);

  return null;
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
  const userId = getTelegramUserId();
  if (!userId){
    showHint('Відкрий цей екран через кнопку в Telegram (WebApp), щоб визначити user id.', 'error');
    throw new Error('Не вдалося визначити Telegram user id');
  }

  // Strongly recommended: backend must validate initData signature
  const initData = tg?.initData || '';

  showHint('Завантажую план…');
  const data = await callAPI({ act: ACT.getByUser, user_id: userId, initData });

  if (data?.error) throw new Error(data.error);

  const normalized = normalizePlan(data?.plan ?? data);
  if (!Array.isArray(normalized?.days) || !normalized.days.length) {
    throw new Error('План ще не згенерований або повернувся в неправильному форматі (немає days[])');
  }

  currentPlan = normalized;
  renderPlan(currentPlan);
  showHint('');
}

// ---------- Render ----------
function renderPlan(plan){
  const days = Array.isArray(plan?.days) ? plan.days : [];
  const m = computePlanMeta(plan);

  $('#title') && ($('#title').textContent = m.title);
  $('#macros') && ($('#macros').textContent = `Ккал: ${m.kcal} | Б:${m.protein_g} Ж:${m.fat_g} В:${m.carbs_g}`);

  const tabs = $('#tabs'); if (tabs){
    tabs.innerHTML = '';
    days.forEach((d,i)=>{
      const b = document.createElement('button');
      b.className = 'tab';
      b.type = 'button';
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
    <div class="day-actions"><button id="swapDay" class="btn ghost" type="button">🔁 Замінити день</button></div>
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
        <h3 class="meal-title">${escapeHtml(title)}</h3>
        ${hasMacros ? `<div class="meal-macros">Ккал: ${kcal} • Б:${p} • Ж:${f} • В:${c}</div>` : ''}
      </div>
      ${m?.description ? `<p class="meal-desc">${escapeHtml(m.description)}</p>` : ''}

      ${Array.isArray(m?.ingredients) && m.ingredients.length ? `
        <details class="ing">
          <summary>Інгредієнти</summary>
          <ul class="ing-list">
            ${m.ingredients.map(i=>`<li><span>${escapeHtml(i.name)}</span><span>${escapeHtml(i.qty||'')}</span></li>`).join('')}
          </ul>
        </details>
      ` : ''}

      ${m?.instructions ? `
        <details class="instr">
          <summary>Спосіб приготування</summary>
          <div class="instr-text">${escapeHtml(m.instructions)}</div>
        </details>
      ` : ''}

      ${Array.isArray(m?.swap_suggestions) && m.swap_suggestions.length
        ? `<details class="swap-list"><summary>Можливі заміни</summary>
             <ul>${m.swap_suggestions.map(s=>`<li>${escapeHtml(s)}</li>`).join('')}</ul>
           </details>` : ''
      }

      <div class="meal-actions">
        <button class="btn" type="button" data-meal="${escapeAttr(m?.meal_type || '')}">
          🔄 Замінити страву
        </button>
      </div>
    `;

    card.querySelector('button[data-meal]')?.addEventListener('click', async ()=>{
      await doSwapMeal(dayNumber, m?.meal_type || '');
    });

    wrap.appendChild(card);
  });

  $('#swapDay')?.addEventListener('click', async ()=>{ await doSwapDay(dayNumber); });
}

// ---------- Actions (by user_id) ----------
async function doSwapMeal(day, mealType){
  const userId = getTelegramUserId();
  try{
    tg?.MainButton?.showProgress?.();
    showHint('Заміна страви…');
    const initData = tg?.initData || '';
    const res = await callAPI({
      act: ACT.swapMealByUser,
      user_id: userId,
      initData,
      day,
      meal_type: mealType
    });
    if (res?.ok && res?.plan_updated) {
      currentPlan = normalizePlan(res.plan_updated);
      renderPlan(currentPlan);
      showHint('');
    } else throw new Error(res?.error || 'swapMeal failed');
  } catch(e){
    showHint(e?.message || 'Помилка заміни страви', 'error');
  } finally {
    tg?.MainButton?.hide?.();
  }
}

async function doSwapDay(day){
  const userId = getTelegramUserId();
  try{
    tg?.MainButton?.showProgress?.();
    showHint('Заміна дня…');
    const initData = tg?.initData || '';
    const res = await callAPI({ act: ACT.swapDayByUser, user_id: userId, initData, day });
    if (res?.ok && res?.plan_updated) {
      currentPlan = normalizePlan(res.plan_updated);
      renderPlan(currentPlan);
      showHint('');
    } else throw new Error(res?.error || 'swapDay failed');
  } catch(e){
    showHint(e?.message || 'Помилка заміни дня', 'error');
  } finally {
    tg?.MainButton?.hide?.();
  }
}

$('#regenPlan')?.addEventListener('click', async ()=>{
  const userId = getTelegramUserId();
  try{
    tg?.MainButton?.showProgress?.();
    showHint('Перегенерація плану…');
    const initData = tg?.initData || '';
    const res = await callAPI({ act: ACT.swapPlanByUser, user_id: userId, initData });
    if (res?.ok && res?.plan_updated) {
      currentPlan = normalizePlan(res.plan_updated);
      renderPlan(currentPlan);
      showHint('');
    } else throw new Error(res?.error || 'swapPlan failed');
  } catch(e){
    showHint(e?.message || 'Помилка перегенерації плану', 'error');
  } finally {
    tg?.MainButton?.hide?.();
  }
});

// ---------- Shopping List Modal ----------
function renderShoppingList(){
  const modal = $('#shoppingModal'); if (!modal) return;
  const body = modal.querySelector('.modal-body'); if (!body) return;
  body.innerHTML = '';

  const list = currentPlan?.shopping_list;

  if (!list || (Array.isArray(list) && !list.length) || (typeof list === 'object' && !Array.isArray(list) && !Object.keys(list).length)) {
    body.innerHTML = '<p class="muted">Список покупок відсутній.</p>';
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
          return `<li>${escapeHtml(name)}${escapeHtml(tail)}</li>`;
        }).join('');
      } else {
        itemsHtml = Object.entries(items).map(([name, v])=>{
          const val = (typeof v === 'object')
            ? ((v?.quantity ?? v?.qty ?? '') + (v?.unit ? ` ${v.unit}` : ''))
            : v;
          return `<li>${escapeHtml(name)}: ${escapeHtml(val ?? '')}</li>`;
        }).join('');
      }
      card.innerHTML = `<h4>${escapeHtml(category)}</h4><ul>${itemsHtml}</ul>`;
      body.appendChild(card);
    });
  } else {
    // Array of strings or {item/name, quantity, unit}
    const ul = document.createElement('ul');
    ul.className = 'shop-list';
    ul.innerHTML = list.map(i=>{
      if (typeof i === 'string') return `<li>${escapeHtml(i)}</li>`;
      const name = i?.name ?? i?.item ?? '—';
      const qty  = i?.quantity ?? i?.qty ?? '';
      const unit = i?.unit ? ` ${i.unit}` : '';
      const tail = qty ? `: ${qty}${unit}` : '';
      return `<li><span>${escapeHtml(name)}</span><span>${escapeHtml(tail)}</span></li>`;
    }).join('');
    body.appendChild(ul);
  }
}

function openModal(){
  renderShoppingList();
  const m = $('#shoppingModal');
  m?.classList.add('open');
  m?.setAttribute('aria-hidden','false');
}
function closeModal(){
  const m = $('#shoppingModal');
  m?.classList.remove('open');
  m?.setAttribute('aria-hidden','true');
}

$('#openShopping')?.addEventListener('click', openModal);
$('#closeShopping')?.addEventListener('click', closeModal);
document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') closeModal(); });
$('#shoppingModal')?.addEventListener('click', (e)=>{
  if (e.target?.classList?.contains('modal')) closeModal();
});

// ---------- Escaping helpers (avoid HTML injection) ----------
function escapeHtml(s){
  return String(s ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#39;");
}
function escapeAttr(s){
  // minimal for attribute usage
  return escapeHtml(s).replaceAll('`','&#96;');
}

// ---------- Start ----------
loadPlan().catch(err=>{
  $('#title') && ($('#title').textContent = 'Помилка');
  $('#macros') && ($('#macros').textContent = err?.message || 'Щось пішло не так');
  showHint(err?.message || 'Щось пішло не так', 'error');
  console.error('Plan load error:', err);
});
