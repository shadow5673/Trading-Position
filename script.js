const STORE_KEY = 'positionManagerData';

// ---------- 工具函数 ----------
function fmtJPY(n) {
  if (!isFinite(n) || n === null) return '—';
  if (Math.abs(n) >= 100000000) return '¥' + (n/100000000).toFixed(2) + '億';
  if (Math.abs(n) >= 10000) return '¥' + (n/10000).toFixed(0) + '万';
  return '¥' + Math.round(n).toLocaleString();
}

function fmtPrice(n) {
  if (!isFinite(n) || n === null) return '—';
  return n.toFixed(2);
}

function fmtPct(n) {
  if (!isFinite(n) || n === null) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function parseNum(v) {
  const s = String(v).replace(/[,\s]/g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

// ---------- 状态保存 ----------
function saveState() {
  const data = {
    margin: document.getElementById('margin').value,
    leverage: document.getElementById('leverage').value,
    currentApples: document.getElementById('currentApples').value,
    cost: document.getElementById('cost').value,
    current: document.getElementById('current').value,
    sellPrice: document.getElementById('sellPrice').value,
    refillCurrent: document.getElementById('refillCurrent').value,
    history: window._history || []
  };
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    Object.keys(data).forEach(k => {
      const el = document.getElementById(k);
      if (el && k !== 'history') el.value = data[k];
    });
    window._history = data.history || [];
    renderHistory();
  } catch(e) { console.warn(e); }
}

// ---------- 主计算 ----------
function recalc() {
  const margin = parseNum(document.getElementById('margin').value);
  const leverage = parseFloat(document.getElementById('leverage').value) || 2.5;
  const apples = parseInt(document.getElementById('currentApples').value) || 0;

  const fullPos = margin * leverage;
  const apple = fullPos / 6;
  const currentVal = apple * apples;

  document.getElementById('fullPosition').textContent = fmtJPY(fullPos);
  document.getElementById('apple-value').textContent = fmtJPY(apple);
  document.getElementById('currentValue').textContent = fmtJPY(currentVal);

  // 苹果可视化
  renderApples(apples);

  // 损益率
  const cost = parseFloat(document.getElementById('cost').value);
  const current = parseFloat(document.getElementById('current').value);
  if (isFinite(cost) && isFinite(current) && cost > 0) {
    const pnl = (current - cost) / cost * 100;
    const el = document.getElementById('pnlRate');
    el.textContent = fmtPct(pnl);
    el.style.color = pnl > 0 ? 'var(--green)' : pnl < 0 ? 'var(--red)' : 'var(--text)';
    updateDecision(pnl, apple, apples);
  } else {
    document.getElementById('pnlRate').textContent = '—';
    document.getElementById('pnlRate').style.color = 'var(--text)';
    resetDecision();
  }

  // 补仓阶梯
  updateLadder();

  saveState();
}

function renderApples(count) {
  const wrap = document.getElementById('appleDisplay');
  wrap.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const a = document.createElement('div');
    a.className = 'apple' + (i >= count ? ' empty' : '');
    wrap.appendChild(a);
  }
  const statusEl = document.getElementById('appleStatus');
  if (count === 6) statusEl.textContent = '満仓';
  else if (count === 0) statusEl.textContent = '空仓';
  else statusEl.textContent = `${count} / 6 仓`;
}

function updateDecision(pnl, appleVal, currentApples) {
  const box = document.getElementById('decisionBox');
  let action = '', detail = '', cls = '';

  // 止损优先
  if (pnl <= -12) {
    action = '⚠ 清空仓位';
    detail = `卖出全部 ${currentApples} 苹果 ≈ ${fmtJPY(appleVal * currentApples)} · 优先卖高位仓`;
    cls = 'danger';
  } else if (pnl <= -8) {
    const sell = Math.min(3, currentApples);
    action = `减 ${sell} 苹果`;
    detail = `止损 · 卖出 ${fmtJPY(appleVal * sell)} · 优先卖高位仓`;
    cls = 'danger';
  } else if (pnl >= 12) {
    const sell = Math.min(3, currentApples);
    action = `减 ${sell} 苹果`;
    detail = `止盈 · 卖出 ${fmtJPY(appleVal * sell)} · 卖中位仓`;
    cls = 'profit';
  } else if (pnl >= 8) {
    const sell = Math.min(2, currentApples);
    action = `减 ${sell} 苹果`;
    detail = `止盈 · 卖出 ${fmtJPY(appleVal * sell)} · 卖中位仓`;
    cls = 'profit';
  } else if (pnl >= 5) {
    const sell = Math.min(1, currentApples);
    action = `减 ${sell} 苹果`;
    detail = `止盈 · 卖出 ${fmtJPY(appleVal * sell)} · 卖中位仓`;
    cls = 'profit';
  } else {
    action = '继续持有';
    detail = `当前损益 ${fmtPct(pnl)} · 未到触发线`;
    cls = '';
  }

  box.className = 'decision-result ' + cls;
  box.innerHTML = `<div class="decision-action">${action}</div><div class="decision-detail">${detail}</div>`;
}

function resetDecision() {
  const box = document.getElementById('decisionBox');
  box.className = 'decision-result';
  box.innerHTML = '<div class="decision-action">输入成本和现价</div><div class="decision-detail">系统会根据规则给出建议</div>';
}

function updateLadder() {
  const sellPrice = parseFloat(document.getElementById('sellPrice').value);
  const refillCur = parseFloat(document.getElementById('refillCurrent').value);
  const steps = document.querySelectorAll('.ladder-step');

  if (!isFinite(sellPrice) || sellPrice <= 0) {
    steps.forEach(s => {
      s.classList.remove('active');
      s.querySelector('.price').textContent = '—';
    });
    return;
  }

  // 三档价位:0.5-2%, 2-4%, 4%+
  const p1Low  = sellPrice * (1 - 0.005);
  const p1High = sellPrice * (1 - 0.02);
  const p2Low  = sellPrice * (1 - 0.02);
  const p2High = sellPrice * (1 - 0.04);
  const p3     = sellPrice * (1 - 0.04);

  steps[0].querySelector('.price').textContent = `${fmtPrice(p1High)} ~ ${fmtPrice(p1Low)}`;
  steps[1].querySelector('.price').textContent = `${fmtPrice(p2High)} ~ ${fmtPrice(p2Low)}`;
  steps[2].querySelector('.price').textContent = `≤ ${fmtPrice(p3)}`;

  steps.forEach(s => s.classList.remove('active'));

  if (isFinite(refillCur) && refillCur > 0) {
    const drop = (sellPrice - refillCur) / sellPrice * 100;
    if (drop >= 4) steps[2].classList.add('active');
    else if (drop >= 2) steps[1].classList.add('active');
    else if (drop >= 0.5) steps[0].classList.add('active');
  }
}

// ---------- 历史记录 ----------
function logAction(label) {
  if (!window._history) window._history = [];
  const apples = parseInt(document.getElementById('currentApples').value) || 0;
  const cost = document.getElementById('cost').value;
  const cur = document.getElementById('current').value;
  let pnl = '';
  if (cost && cur && parseFloat(cost) > 0) {
    pnl = ((parseFloat(cur) - parseFloat(cost)) / parseFloat(cost) * 100).toFixed(2);
  }
  window._history.unshift({
    t: new Date().toLocaleString('ja-JP', {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'}),
    label: label,
    apples: apples,
    cost: cost,
    cur: cur,
    pnl: pnl
  });
  window._history = window._history.slice(0, 50);
  saveState();
  renderHistory();
}

function renderHistory() {
  const wrap = document.getElementById('historyList');
  const h = window._history || [];
  if (h.length === 0) {
    wrap.innerHTML = '<div class="empty-hint">暂无记录</div>';
    return;
  }
  wrap.innerHTML = h.map(it => {
    const pnlNum = parseFloat(it.pnl);
    const pnlCls = isFinite(pnlNum) ? (pnlNum >= 0 ? 'profit' : 'loss') : '';
    const pnlTxt = isFinite(pnlNum) ? fmtPct(pnlNum) : '';
    return `<div class="history-item">
      <span class="history-time">${it.t}</span>
      <span class="history-action">${it.label} · ${it.apples}/6 苹果</span>
      <span class="history-pnl ${pnlCls}">${pnlTxt}</span>
      <span class="history-time">${it.cur || ''}</span>
    </div>`;
  }).join('');
}

function clearHistory() {
  if (!confirm('清空所有历史?')) return;
  window._history = [];
  saveState();
  renderHistory();
}

// ---------- 绑定 ----------
['margin','leverage','currentApples','cost','current','sellPrice','refillCurrent'].forEach(id => {
  document.getElementById(id).addEventListener('input', recalc);
});

// 初始化
loadState();
recalc();
