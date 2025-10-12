const tg = window.Telegram?.WebApp; if (tg) { tg.expand(); tg.ready(); }

const qs = new URLSearchParams(location.search);
const planId = qs.get('plan_id'); const token = qs.get('token');
const API = 'https://script.google.com/macros/s/AKfycbxq70NDjxdceKIDFVbmhdgPx5LWPrjrZFUhTtXpKL2sLbIDpZ1mO6YP1ph9-IMkWzRuPQ/exec';

let currentPlan = null;
const $ = sel => document.querySelector(sel);

async function callAPI(params){
  const url = `${API}?${new URLSearchParams(params).toString()}`;
  const r = await fetch(url, {headers:{'Accept':'application/json'}});
  return r.json();
}
async function loadPlan(){
  const data = await callAPI({ act:'get', plan_id:planId, token });
  if (data.error) throw new Error(data.error);
  currentPlan = data.plan;
  renderPlan(currentPlan);
}
function renderPlan(plan){
  $('#title').textContent = plan.meta?.title || 'План харчування';
  $('#macros').textContent = `Ккал: ${plan.meta.kcal} | Б:${plan.meta.protein_g} Ж:${plan.meta.fat_g} В:${plan.meta.carbs_g}`;

  const tabs = $('#tabs'); tabs.innerHTML = '';
  plan.days.forEach((d, i) => {
    const b = document.createElement('button');
    b.textContent = `День ${d.day || i+1}`;
    b.onclick = () => renderDay(d, i+1);
    tabs.appendChild(b);
  });
  renderDay(plan.days[0], 1);
}

function renderDay(dayObj, dayNumber){
  const wrap = $('#content'); wrap.innerHTML = '';
  const dayHeader = document.createElement('div');
  dayHeader.className = 'day-head';
  dayHeader.innerHTML = `
    <h2>День ${dayObj.day || dayNumber}</h2>
    <div class="day-macros">Ккал: ${dayObj.kcal} | Б:${dayObj.protein_g} Ж:${dayObj.fat_g} В:${dayObj.carbs_g}</div>
    <div class="day-actions">
      <button id="swapDay">🔁 Замінити день</button>
    </div>
  `;
  wrap.appendChild(dayHeader);

  dayObj.meals.forEach(m=>{
    const card = document.createElement('section');
    card.className = 'meal';
    card.innerHTML = `
      <div class="meal-head">
        <h3>${m.meal_type}: ${m.title || ''}</h3>
        <div class="meal-macros">Ккал: ${m.kcal} | Б:${m.protein_g} Ж:${m.fat_g} В:${m.carbs_g}</div>
      </div>
      <p>${m.description || ''}</p>
      <details ${m.swap_suggestions?.length? '':'hidden'}>
        <summary>Можливі заміни</summary>
        <ul>${(m.swap_suggestions||[]).map(s=>`<li>${s}</li>`).join('')}</ul>
      </details>
      <div class="meal-actions">
        <button class="swapMeal">🔄 Замінити страву</button>
      </div>
    `;
    // кнопка своп-страви
    card.querySelector('.swapMeal').onclick = async ()=>{
      await doSwapMeal(dayNumber, m.meal_type);
    };
    wrap.appendChild(card);
  });

  // кнопка своп-дня
  $('#swapDay').onclick = async ()=> { await doSwapDay(dayNumber); };
}

async function doSwapMeal(day, mealType){
  tg?.MainButton?.showProgress?.();
  const res = await callAPI({ act:'swapMeal', plan_id:planId, token, day, meal_type:mealType });
  tg?.MainButton?.hide?.();
  if (res.ok) { currentPlan = res.plan_updated; renderPlan(currentPlan); }
}

async function doSwapDay(day){
  tg?.MainButton?.showProgress?.();
  const res = await callAPI({ act:'swapDay', plan_id:planId, token, day });
  tg?.MainButton?.hide?.();
  if (res.ok) { currentPlan = res.plan_updated; renderPlan(currentPlan); }
}

$('#regenPlan').onclick = async ()=>{
  tg?.MainButton?.showProgress?.();
  const res = await callAPI({ act:'swapPlan', plan_id:planId, token });
  tg?.MainButton?.hide?.();
  if (res.ok) { currentPlan = res.plan_updated; renderPlan(currentPlan); }
};

loadPlan().catch(err=>{
  $('#title').textContent = 'Помилка';
  $('#macros').textContent = err.message || 'Щось пішло не так';
});

