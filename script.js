const STORE_KEY = 'positionManagerData';
const VERSION = 'v16';

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
    cost: document.getElementById('cost').value
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
  { id: 'tp8',  pct:  0.08, apples: 1 },
  { id: 'tp15', pct:  0.15, apples: 1 },
  { id: 'tp25', pct:  0.25, apples: 1 },
  { id: 'sl5',  pct: -0.05, apples: 1 },
  { id: 'sl9',  pct: -0.09, apples: 2 },
  { id: 'sl13', pct: -0.13, apples: 6 },
];

function recalc() {
  const margin = parseNum(document.getElementById('margin').value);
  const leverage = parseFloat(document.getElementById('leverage').value) || 2.5;

  const fullPos = margin * leverage;
  const apple = fullPos / 6;

  document.getElementById('fullPosition').textContent = fmtJPY(fullPos);
  document.getElementById('apple-value').textContent = fmtJPY(apple);
  document.getElementById('mobile-value').textContent = fmtJPY(apple * 3);
  document.getElementById('fixed-value').textContent = fmtJPY(apple * 3);

  const cost = parseFloat(document.getElementById('cost').value);
  const hasCost = isFinite(cost) && cost > 0;

  RULES.forEach(r => {
    const priceEl = document.getElementById(r.id + '-price');
    const valueEl = document.getElementById(r.id + '-value');
    priceEl.textContent = hasCost ? `(¥${fmtPrice(cost * (1 + r.pct))})` : '(—)';
    valueEl.textContent = apple > 0 ? `(${fmtJPY(apple * r.apples)})` : '(—)';
  });

  saveState();
}

['margin','leverage','cost'].forEach(id => {
  document.getElementById(id).addEventListener('input', recalc);
});

loadState();
recalc();
