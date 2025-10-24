/* ====== НАСТРОЙКА ====== 
 * 1) В Google Sheets: Файл → Опубликовать в Интернете → опубликовать всю таблицу
 * 2) Вставь ID таблицы (середина URL: /spreadsheets/d/ID/edit)
 * 3) По умолчанию читаем лист WB_Stats_NM_Daily с русскими заголовками,
 *    которые мы делали: 
 *    ID кампании | Источник трафика | Артикул WB | Название товара | Дата | 
 *    Показы | Клики | CTR % | Затраты, ₽ | Добавления в корзину | Заказано товаров, шт | Заказано на сумму, ₽
 */
const DEFAULT_SHEET_ID = '1H6WxKWm4Ea3IShhSKGu63OpZuyNMZ-VSKmqUjwzoFLQ';            // можешь сразу вписать ID, иначе бери из поля UI
const DEFAULT_SHEET_NAME = 'WB_Stats_NM_Daily';

// соответствие названий столбцов
const COL = {
  campaign: 'ID кампании',
  appType: 'Источник трафика',
  nmId: 'Артикул WB',
  nmName: 'Название товара',
  date: 'Дата',
  shows: 'Показы',
  clicks: 'Клики',
  ctr: 'CTR %',
  spend: 'Затраты, ₽',
  atc: 'Добавления в корзину',
  qty: 'Заказано товаров, шт',
  revenue: 'Заказано на сумму, ₽'
};

// state
let RAW = [];       // все строки из шита
let FILTERED = [];  // строки после фильтров
let charts = {};

// UI
const $ = id => document.getElementById(id);
$('sheetId').value = DEFAULT_SHEET_ID;
$('sheetName').value = DEFAULT_SHEET_NAME;

// ---- загрузка из Google Sheets (GViz) ----
// Формат: https://docs.google.com/spreadsheets/d/<id>/gviz/tq?sheet=<name>
async function fetchSheet(sheetId, sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?sheet=${encodeURIComponent(sheetName)}&tqx=out:json`;
  const res = await fetch(url, { cache: 'no-cache' });
  const txt = await res.text();
  // ответ обёрнут в JS: google.visualization.Query.setResponse({...})
  const json = JSON.parse(txt.replace(/^[^({]+/, '').replace(/[^)}]+$/, ''));
  const cols = json.table.cols.map(c => c.label || c.id);
  const rows = json.table.rows.map(r => cols.map((_, i) => (r.c[i]?.v ?? '')));
  // кэшируем локально
  localStorage.setItem('wb_cache', JSON.stringify({ ts: Date.now(), rows, cols, sheetId, sheetName }));
  return { rows, cols };
}

function loadCacheIfAny() {
  try {
    const j = JSON.parse(localStorage.getItem('wb_cache') || '{}');
    if (!j.rows || !j.cols) return null;
    return j;
  } catch { return null; }
}

function rowsToObjects(rows, cols) {
  return rows.slice(1).map(r => {
    const o = {};
    cols.forEach((name, i) => o[name] = r[i]);
    return o;
  });
}

function unique(values) { return [...new Set(values.filter(Boolean))]; }

function toISODateOnly(v) {
  if (!v) return '';
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  try { return new Date(v).toISOString().slice(0,10); } catch { return ''; }
}

function number(v){ const x = +String(v).toString().replace(',','.'); return isFinite(x)?x:0; }
function sum(arr, sel){ return arr.reduce((a,x)=>a+number(sel(x)),0); }
function round2(x){ return Math.round(x*100)/100; }

// ---- фильтры ----
function applyFilters() {
  const nmId = $('nmId').value;
  const appType = $('appType').value;
  const df = $('dateFrom').value;
  const dt = $('dateTo').value;

  FILTERED = RAW.filter(r => {
    const byNm   = !nmId   || String(r[COL.nmId])   === nmId;
    const byApp  = !appType|| String(r[COL.appType])=== appType;
    const d = toISODateOnly(r[COL.date]);
    const byDate = (!df || d >= df) && (!dt || d <= dt);
    return byNm && byApp && byDate;
  });

  updateKPIs();
  renderCharts();
}

function updateSelectors() {
  const nmList = unique(RAW.map(r => String(r[COL.nmId])));
  const appList = unique(RAW.map(r => String(r[COL.appType])));

  $('nmId').innerHTML = `<option value="">Все</option>` + nmList.map(v=>`<option>${v}</option>`).join('');
  $('appType').innerHTML = `<option value="">Все</option>` + appList.map(v=>`<option>${v}</option>`).join('');

  // авто-период по данным
  const dates = unique(RAW.map(r => toISODateOnly(r[COL.date]))).sort();
  $('dateFrom').value = dates[0] || '';
  $('dateTo').value   = dates[dates.length-1] || '';
}

function updateKPIs() {
  const spend   = sum(FILTERED, r => r[COL.spend]);
  const revenue = sum(FILTERED, r => r[COL.revenue]);
  const shows   = sum(FILTERED, r => r[COL.shows]);
  const clicks  = sum(FILTERED, r => r[COL.clicks]);
  const ctr     = shows ? round2(clicks*100/shows) : 0;
  const roas    = spend ? round2(revenue/spend) : 0;

  $('kpiSpend').textContent   = spend.toLocaleString('ru-RU');
  $('kpiRevenue').textContent = revenue.toLocaleString('ru-RU');
  $('kpiCtr').textContent     = ctr.toFixed(2);
  $('kpiRoas').textContent    = roas.toFixed(2);
}

// ---- чартинг ----
function chart(id, type, data, options){
  charts[id]?.destroy();
  const ctx = document.getElementById(id);
  charts[id] = new Chart(ctx, { type, data, options });
}

function renderCharts() {
  // группировка по дню
  const byDay = {};
  FILTERED.forEach(r=>{
    const d = toISODateOnly(r[COL.date]);
    (byDay[d] ||= {spend:0,revenue:0,shows:0,clicks:0}).spend   += number(r[COL.spend]);
    byDay[d].revenue += number(r[COL.revenue]);
    byDay[d].shows   += number(r[COL.shows]);
    byDay[d].clicks  += number(r[COL.clicks]);
  });
  const labels = Object.keys(byDay).sort();
  const spend  = labels.map(d => round2(byDay[d].spend));
  const orders = labels.map(d => round2(byDay[d].revenue));
  const clicks = labels.map(d => byDay[d].clicks);
  const shows  = labels.map(d => byDay[d].shows);

  // line: spend vs orders
  chart('lineSpendOrders','line',{
    labels,
    datasets:[
      { label:'Затраты, ₽', data: spend },
      { label:'Заказы, ₽', data: orders }
    ]
  },{
    responsive:true, interaction:{mode:'index',intersect:false},
    plugins:{legend:{labels:{color:'#cbd5e1'}}, tooltip:{}},
    scales:{x:{ticks:{color:'#9aa7b8'}}, y:{ticks:{color:'#9aa7b8'}}}
  });

  // bar: clicks + shows (в две оси)
  chart('barClicksShows','bar',{
    labels,
    datasets:[
      { label:'Клики', data: clicks, yAxisID:'y' },
      { label:'Показы', data: shows, yAxisID:'y1' }
    ]
  },{
    responsive:true,
    plugins:{legend:{labels:{color:'#cbd5e1'}}},
    scales:{
      x:{ticks:{color:'#9aa7b8'}},
      y:{position:'left', ticks:{color:'#9aa7b8'}},
      y1:{position:'right', grid:{drawOnChartArea:false}, ticks:{color:'#9aa7b8'}}
    }
  });

  // scatter: корреляция spend vs revenue
  const points = labels.map((d,i)=>({x:spend[i], y:orders[i], label:d}));
  chart('scatterCorr','scatter',{
    datasets:[{ label:'Дни (точки)', data: points, parsing:false }]
  },{
    plugins:{legend:{labels:{color:'#cbd5e1'}}},
    scales:{x:{title:{display:true,text:'Затраты, ₽'}, ticks:{color:'#9aa7b8'}},
            y:{title:{display:true,text:'Заказано на сумму, ₽'}, ticks:{color:'#9aa7b8'}}},
    parsing:false
  });
}

// ---- загрузка + события ----
async function load() {
  const sheetId = $('sheetId').value.trim() || DEFAULT_SHEET_ID;
  const sheetName = $('sheetName').value.trim() || DEFAULT_SHEET_NAME;
  if (!sheetId) { alert('Укажи Sheet ID (из URL Google Sheets)'); return; }

  $('reload').disabled = true;

  try {
    let rows, cols;
    // сначала пробуем из сети
    try {
      const net = await fetchSheet(sheetId, sheetName);
      rows = net.rows; cols = net.cols;
    } catch (e) {
      // оффлайн → из кэша
      const cache = loadCacheIfAny();
      if (!cache) throw e;
      rows = cache.rows; cols = cache.cols;
    }
    RAW = rowsToObjects(rows, cols);
    updateSelectors();
    applyFilters();
  } finally {
    $('reload').disabled = false;
  }
}

$('reload').onclick = load;
$('reset').onclick = () => { $('nmId').value=''; $('appType').value=''; load(); };
$('nmId').onchange = applyFilters;
$('appType').onchange = applyFilters;
$('dateFrom').onchange = applyFilters;
$('dateTo').onchange = applyFilters;

window.addEventListener('load', load);
