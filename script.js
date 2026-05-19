const STORE_KEY = 'positionManagerData';

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

function parseNum(v) {
  const s = String(v).replace(/[,\s]/g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function saveState() {
  const data = {
    margin: document.getElementById('margin').value,
    leverage: document.getElementById('leverage').value,
    cost: document.getElementById('cost').value,
    sellPrice: document.getElementById('sellPrice').value
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
      if (el) el.value = data[k];
    });
  } catch(e) { console.warn(e); }
}

const RULES = [
  { id: 'tp5',  pct:  0.05, apples: 1 },
  { id: 'tp8',  pct:  0.08, apples: 2 },
  { id: 'tp12', pct:  0.12, apples: 3 },
  { id: 'sl8',  pct: -0.08, apples: 3 },
  { id: 'sl12', pct: -0.12, apples: 6 },
];

function recalc() {
  const margin = parseNum(document.getElementById('margin').value);
  const leverage = parseFloat(document.getElementById('leverage').value) || 2.5;

  const fullPos = margin * leverage;
  const apple = fullPos / 6;

  document.getElementById('fullPosition').textContent = fmtJPY(fullPos);
  document.getElementById('apple-value').textContent = fmtJPY(apple);

  const cost = parseFloat(document.getElementById('cost').value);
  const hasCost = isFinite(cost) && cost > 0;

  RULES.forEach(r => {
    const priceEl = document.getElementById(r.id + '-price');
    const valueEl = document.getElementById(r.id + '-value');
    priceEl.textContent = hasCost ? `(¥${fmtPrice(cost * (1 + r.pct))})` : '(—)';
    valueEl.textContent = apple > 0 ? `(${fmtJPY(apple * r.apples)})` : '(—)';
  });

  document.getElementById('lad1-value').textContent = apple > 0 ? `(${fmtJPY(apple * 1)})` : '(—)';
  document.getElementById('lad2-value').textContent = apple > 0 ? `(${fmtJPY(apple * 2)})` : '(—)';
  document.getElementById('lad3-value').textContent = apple > 0 ? `(${fmtJPY(apple * 6)})` : '(—)';

  updateLadder();
  saveState();
}

function updateLadder() {
  const sellPrice = parseFloat(document.getElementById('sellPrice').value);
  const steps = document.querySelectorAll('.ladder-step');

  if (!isFinite(sellPrice) || sellPrice <= 0) {
    steps.forEach(s => {
      s.querySelector('.price').textContent = '—';
    });
    return;
  }

  const p1Low  = sellPrice * (1 - 0.005);
  const p1High = sellPrice * (1 - 0.02);
  const p2Low  = sellPrice * (1 - 0.02);
  const p2High = sellPrice * (1 - 0.04);
  const p3     = sellPrice * (1 - 0.04);

  steps[0].querySelector('.price').textContent = `${fmtPrice(p1High)} ~ ${fmtPrice(p1Low)}`;
  steps[1].querySelector('.price').textContent = `${fmtPrice(p2High)} ~ ${fmtPrice(p2Low)}`;
  steps[2].querySelector('.price').textContent = `≤ ${fmtPrice(p3)}`;
}

['margin','leverage','cost','sellPrice'].forEach(id => {
  document.getElementById(id).addEventListener('input', recalc);
});

loadState();
recalc();
