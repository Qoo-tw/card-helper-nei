// 刷卡小幫手（女友版）
// 特色：離線可用、資料只存本機、支援「一鍵記帳」與「本月上限/已用」估算

const DATA = {
  rules: [],
  merchantmap: [],
  categorymap: []
};

const el = (id) => document.getElementById(id);

function norm(s){
  return (s ?? "").toString().trim();
}
function normKey(s){
  return norm(s).toLowerCase();
}
function money(n){
  const x = Number(n || 0);
  return x.toLocaleString("zh-TW", {maximumFractionDigits: 2});
}
function todayISO(){
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0,10);
}

function getMonthKey(dateStr){
  // YYYY-MM
  const s = norm(dateStr);
  if(!s) return "";
  return s.slice(0,7);
}

function loadTx(){
  try{
    const raw = localStorage.getItem("tx_gf_v1");
    return raw ? JSON.parse(raw) : [];
  }catch(_){
    return [];
  }
}
function saveTx(list){
  localStorage.setItem("tx_gf_v1", JSON.stringify(list));
}

function txInMonth(list, monthKey){
  return list.filter(t => getMonthKey(t.date) === monthKey);
}

function sumUsageByRule(list){
  // {rule_id: {used_spend, used_reward}}
  const m = {};
  for(const t of list){
    const rid = t.rule_id;
    if(!rid) continue;
    if(!m[rid]) m[rid] = {used_spend:0, used_reward:0};
    m[rid].used_spend += Number(t.amount||0);
    m[rid].used_reward += Number(t.est_reward||0);
  }
  return m;
}

function bestMatchFromMap(mapArr, merchant){
  // 回傳 {item, matchLen}：以「關鍵字長度」當同類型 tie-breaker（較精準）
  const m = normKey(merchant);
  let best = null;
  for(const it of mapArr){
    const kw = normKey(it.keyword);
    if(!kw) continue;
    if(m.includes(kw)){
      const len = kw.length;
      if(!best || len > best.matchLen){
        best = {item: it, matchLen: len};
      }
    }
  }
  return best;
}

function guessRegion(merchant){
  const hit = bestMatchFromMap(DATA.merchantmap, merchant);
  if(hit && hit.item && hit.item.default_region){
    return hit.item.default_region;
  }
  return "國內";
}

function guessCategory(merchant){
  const hit = bestMatchFromMap(DATA.categorymap, merchant);
  if(hit && hit.item && hit.item.category){
    return hit.item.category;
  }
  return "其他";
}

function ruleEligible(rule, ctx){
  // ctx: {merchant, region, category, linepay}
  if(rule.region_allow && !rule.region_allow.includes(ctx.region)) return false;

  if(rule.require_linepay && !ctx.linepay) return false;

  if(rule.category_allow && !rule.category_allow.includes(ctx.category)) return false;

  if(rule.keyword_allow && rule.keyword_allow.length){
    const m = normKey(ctx.merchant);
    let ok = false;
    for(const kw of rule.keyword_allow){
      if(m.includes(normKey(kw))){
        ok = true; break;
      }
    }
    if(!ok) return false;
  }

  return true;
}

function clamp(n, lo, hi){
  return Math.max(lo, Math.min(hi, n));
}

function evaluateRules(ctx, usageByRule){
  const out = [];
  for(const r of DATA.rules){
    if(!ruleEligible(r, ctx)) continue;

    const used = usageByRule[r.rule_id] || {used_spend:0, used_reward:0};

    const capReward = Number(r.cap_reward ?? 999999999);
    const capSpend  = Number(r.cap_spend  ?? 999999999);

    const remainReward = Math.max(0, capReward - used.used_reward);
    const remainSpend  = Math.max(0, capSpend  - used.used_spend);

    const amt = Number(ctx.amount || 0);
    const eligibleAmt = Math.max(0, Math.min(amt, remainSpend));
    let est = eligibleAmt * Number(r.rate || 0);
    est = Math.min(est, remainReward);

    // Score: 先看%（rate）與 priority，再看剩餘回饋與剩餘可刷
    const score =
      (Number(r.rate||0) * 1_000_000) +
      (Number(r.priority||0) * 10_000) +
      (remainReward * 10) +
      (remainSpend);

    out.push({
      ...r,
      used_spend: used.used_spend,
      used_reward: used.used_reward,
      remain_reward: remainReward,
      remain_spend: remainSpend,
      est_reward: est,
      eligible_amount: eligibleAmt,
      score
    });
  }

  // 依 score 排序
  out.sort((a,b)=> b.score - a.score);

  return out;
}

function renderRecommend(list, ctx){
  const box = el("recommend");
  box.innerHTML = "";

  if(!ctx.merchant || !ctx.amount){
    box.innerHTML = `<div class="muted">請先輸入店家與金額</div>`;
    return;
  }
  if(!list.length){
    box.innerHTML = `<div class="muted">找不到可用規則（你可以先把地區/分類改成手動）</div>`;
    return;
  }

  const top = list[0];
  const warnParts = [];
  if(Number(ctx.amount) > top.remain_spend){
    warnParts.push(`此規則本月剩餘可刷 ${money(top.remain_spend)}，超出部分回饋可能降低。`);
  }
  if(top.remain_reward <= 0){
    warnParts.push(`此規則本月回饋上限已滿。`);
  }

  const warnHtml = warnParts.length ? `<div class="hint" style="margin-top:8px;color:#fbbf24">${warnParts.join(" ")}</div>` : "";

  box.innerHTML = `
    <div class="rec-box">
      <div class="rec-top">
        <div class="rec-card">${top.card}</div>
        <div class="rec-rate">${(top.rate*100).toFixed(2).replace(/\.00$/,"")}%</div>
      </div>
      <div class="rec-rule">命中規則：${top.rule_name}</div>

      <div class="rec-meta">
        <div class="pill">本筆回饋(估)：<b>${money(top.est_reward)}</b></div>
        <div class="pill">本月已用回饋：${money(top.used_reward)}</div>
        <div class="pill">本月剩餘回饋：${money(top.remain_reward)}</div>
        <div class="pill">本月剩餘可刷：${money(top.remain_spend)}</div>
        <div class="pill">地區：${ctx.region}</div>
        <div class="pill">分類：${ctx.category}</div>
      </div>
      ${warnHtml}
    </div>
  `;

  // 也顯示備選前 3
  const alt = list.slice(1,4);
  if(alt.length){
    const items = alt.map(x => `
      <div class="rec-box" style="opacity:.95">
        <div class="rec-top">
          <div class="rec-card">${x.card}</div>
          <div class="rec-rate">${(x.rate*100).toFixed(2).replace(/\.00$/,"")}%</div>
        </div>
        <div class="rec-rule">規則：${x.rule_name}</div>
        <div class="rec-meta">
          <div class="pill">本筆回饋(估)：<b>${money(x.est_reward)}</b></div>
          <div class="pill">剩餘回饋：${money(x.remain_reward)}</div>
          <div class="pill">剩餘可刷：${money(x.remain_spend)}</div>
        </div>
      </div>
    `).join("");
    box.insertAdjacentHTML("beforeend", `<div style="margin-top:10px" class="muted">備選：</div>${items}`);
  }
}

function renderTable(list){
  const tbody = el("txTable").querySelector("tbody");
  tbody.innerHTML = "";

  for(let i=0;i<list.length;i++){
    const t = list[i];
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.date||""}</td>
      <td>${t.merchant||""}</td>
      <td>${t.region||""}</td>
      <td>${t.category||""}</td>
      <td class="num">${money(t.amount)}</td>
      <td>${t.card||""}</td>
      <td>${t.rule_name||""}</td>
      <td class="num">${money(t.est_reward)}</td>
      <td><button class="small-btn danger" data-del="${i}">刪除</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("button[data-del]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const idx = Number(btn.getAttribute("data-del"));
      const tx = loadTx();
      tx.splice(idx,1);
      saveTx(tx);
      refresh();
    });
  });
}

function currentContext(){
  const merchant = norm(el("inpMerchant").value);
  const amount = Number(el("inpAmount").value || 0);
  const linepay = el("inpLinePay").checked;

  // Region auto/override
  let region = el("inpRegion").value;
  if(region === "AUTO"){
    region = guessRegion(merchant);
  }

  // Category auto/override
  let category = el("inpCategory").value;
  if(category === "AUTO"){
    category = guessCategory(merchant);
  }

  return {
    date: norm(el("inpDate").value),
    merchant, amount, region, category, linepay
  };
}

function recommendNow(){
  const ctx = currentContext();
  const tx = loadTx();
  const monthKey = getMonthKey(ctx.date || todayISO());
  const mtx = txInMonth(tx, monthKey);
  const usage = sumUsageByRule(mtx);

  const evaluated = evaluateRules(ctx, usage);
  renderRecommend(evaluated, ctx);
  return evaluated;
}

function setStatus(msg){
  el("status").textContent = msg || "";
}

function refresh(){
  const tx = loadTx();
  renderTable(tx);
  recommendNow();
}

async function loadData(){
  const [rules, merchantmap, categorymap] = await Promise.all([
    fetch("./data/rules.json").then(r=>r.json()),
    fetch("./data/merchantmap.json").then(r=>r.json()),
    fetch("./data/categorymap.json").then(r=>r.json()),
  ]);
  DATA.rules = rules;
  DATA.merchantmap = merchantmap;
  DATA.categorymap = categorymap;
}

function wireEvents(){
  ["inpMerchant","inpAmount","inpRegion","inpCategory","inpLinePay","inpDate"].forEach(id=>{
    el(id).addEventListener("input", ()=>{
      recommendNow();
      setStatus("");
    });
    el(id).addEventListener("change", ()=>{
      recommendNow();
      setStatus("");
    });
  });

  el("btnAdd").addEventListener("click", ()=>{
    const ctx = currentContext();
    if(!ctx.merchant){
      setStatus("請先輸入店家/描述。");
      return;
    }
    if(!(ctx.amount > 0)){
      setStatus("請輸入正確金額。");
      return;
    }
    const evaluated = recommendNow();
    if(!evaluated.length){
      setStatus("找不到可用規則（請手動調整地區/分類）。");
      return;
    }
    const top = evaluated[0];

    const tx = loadTx();
    tx.unshift({
      date: ctx.date || todayISO(),
      merchant: ctx.merchant,
      region: ctx.region,
      category: ctx.category,
      amount: ctx.amount,
      linepay: ctx.linepay,
      rule_id: top.rule_id,
      card: top.card,
      rule_name: top.rule_name,
      est_reward: Number(top.est_reward || 0)
    });
    saveTx(tx);

    setStatus(`OK：已加入紀錄（${top.card} / ${top.rule_name}，回饋估 ${money(top.est_reward)}）。`);
    refresh();
  });

  el("btnResetMonth").addEventListener("click", ()=>{
    const ctx = currentContext();
    const monthKey = getMonthKey(ctx.date || todayISO());
    const tx = loadTx();
    const kept = tx.filter(t => getMonthKey(t.date) !== monthKey);
    saveTx(kept);
    setStatus(`OK：已清空 ${monthKey} 的紀錄。`);
    refresh();
  });
}

async function main(){
  el("inpDate").value = todayISO();

  await loadData();
  wireEvents();
  refresh();

  if("serviceWorker" in navigator){
    try{
      await navigator.serviceWorker.register("./sw.js");
    }catch(_){}
  }
}

main();
