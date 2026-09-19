import * as S from './strategy.js';
const STORE='swingDesk.285A.v1';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const price=n=>n==null?'—':Number(n).toLocaleString('ja-JP',{maximumFractionDigits:2});
const yen=n=>n==null?'—':'¥ '+price(n);
const money=n=>n==null?'—':Math.abs(n)>=10000?(n/10000).toLocaleString('zh-CN',{maximumFractionDigits:2})+'<small>万日元</small>':price(n)+'<small>日元</small>';
const pct=n=>(n>=0?'+':'')+(n*100).toFixed(2)+'%';
const num=x=>Number(String(x).replace(/[,，\s]/g,''));
let state={version:S.VERSION,account:null,customBars:[]},market,calendar,bars,view,dialogMode,toastTimer,activeTab='today';
function toast(text){$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4800);}
function save(candidate){const nextBars=S.mergeBars(market.bars,candidate.customBars,calendar);S.makeView(candidate.account,nextBars,calendar);try{localStorage.setItem(STORE,JSON.stringify(candidate));}catch{throw new Error('浏览器无法保存记录。请检查存储空间或无痕模式，本次未保存。');}state=candidate;bars=nextBars;render();}
function tab(name){if(!['today','position','history','data','rules'].includes(name))return;activeTab=name;document.querySelectorAll('.page').forEach(x=>x.hidden=x.id!=='page-'+name);document.querySelectorAll('.tabs button').forEach(x=>{x.classList.toggle('active',x.dataset.tab===name);if(x.dataset.tab===name)x.setAttribute('aria-current','page');else x.removeAttribute('aria-current');});window.scrollTo({top:0,behavior:'instant'});}
function metric(label,value,foot){return `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></div>`;}
function empty(title,text,action='record-buy',button='记录一笔买入'){return `<div class="card empty-state"><div class="empty-mark">↗</div><h2>${title}</h2><p>${text}</p><button class="button primary" data-action="${action}">${button}</button></div>`;}
function render(){
 view=S.makeView(state.account,bars,calendar);const {latest:b,book,levels:lv}=view;const pos=book?.position;
 $('loading').hidden=true;$('dashboard').hidden=false;
 const labels={setup:'START HERE',watch:'WAIT FOR THE SIGNAL',ready:'SIGNAL CONFIRMED',holding:'STAY WITH THE PLAN',exit:'TIME TO CLOSE',stale:'UPDATE REQUIRED',cooldown:'TAKE A PAUSE'};
 $('status-label').textContent=labels[view.status];$('plan-date').textContent=`下一交易日 · ${view.planDate}`;
 $('hero-title').textContent=view.title;$('hero-description').textContent=view.description;
 $('hero-action').innerHTML=({setup:'设置策略本金',watch:'查看入场条件',ready:'核算开盘计划',holding:'查看持仓计划',exit:'记录卖出成交',stale:'更新日线数据',cooldown:'查看暂停期限'}[view.status])+' <span>↗</span>';
 $('hero-note').textContent=pos?'已买入不代表已卖出，请记录实际成交':'有信号才行动 · 不加杠杆';
 $('last-price').innerHTML='<small>¥</small>'+price(b.close);
 const prev=view.bars.at(-2);$('price-change').textContent=prev?`${pct(b.close/prev.close-1)}  较前收盘`:'最近收盘';$('quote-date').textContent=b.date;
 const recent=view.bars.slice(-30),max=Math.max(...recent.map(x=>x.close)),min=Math.min(...recent.map(x=>x.close)),range=max-min||1;
 const points=recent.map((x,i)=>`${i/(recent.length-1||1)*300},${65-(x.close-min)/range*55}`).join(' ');
 $('price-chart').innerHTML=`<svg viewBox="0 0 300 75" preserveAspectRatio="none" role="img" aria-label="最近30个交易日收盘价格趋势"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="var(--chart-fill)" stop-opacity=".19"/><stop offset="1" stop-color="var(--chart-fill)" stop-opacity="0"/></linearGradient></defs><path d="M0,75 L${points.replaceAll(' ',' L')} L300,75 Z" fill="url(#fill)"/><polyline points="${points}" fill="none" stroke="var(--chart-line)" stroke-width="1.7" vector-effect="non-scaling-stroke"/></svg>`;
 $('freshness').className=view.fresh?'fresh':'stale';$('freshness').textContent=(view.fresh?'● 日线已齐备':'● 行情需要更新')+` · ${b.date} 收盘 · 非实时行情`;
 const markNote=pos?(b.date>=pos.entryDate?`${b.date} 收盘估值`:'新持仓暂按买入价估值'):'以实际成交金额计算';
 $('account-metrics').innerHTML=metric('账户总权益',money(view.value),book?markNote:'设置后开始跟踪')+metric('可用现金',money(book?.cash),'余仓清空前不重新投入')+metric('已实现盈亏',money(book?.realized),'未扣税 · 成交价按实际记录')+metric('当前持仓',book?`${pos?.qty||0}<small>股</small>`:'—',pos?`买入于 ${pos.entryDate}`:'等待完整入场信号');
 $('signal-score').textContent=b.checks?`${b.checks.filter(Boolean).length} / 4 成立`:'指标预热中';$('signal-date').textContent=`根据 ${b.date} 已收盘日线判断`;
 const lag=view.bars.at(-6),touch=view.bars.slice(-4,-1).filter(x=>x.low<=x.ma10).map(x=>x.date.slice(5)).join('、');
 const checks=[['收盘站上日线 SMA20',`收盘 ${price(b.close)} / 20 日简单均线 ${price(b.ma20)}`],['日线 SMA20 正在向上',`当前 ${price(b.ma20)} / 5 日前 ${price(lag?.ma20)}`],['此前 3 日回踩日线 SMA10',touch?`触及日期：${touch}`:'此前三日低点均未触及当日 SMA10'],['收盘突破昨日最高价',`收盘 ${price(b.close)} / 昨高 ${price(prev?.high)}`]];
 $('signal-list').innerHTML=checks.map(([title,detail],i)=>`<div class="signal-row ${b.checks?.[i]?'pass':''}"><span class="signal-icon">${b.checks?.[i]?'✓':'−'}</span><div class="signal-text">${title}<small>${detail}</small></div><span class="signal-state">${b.checks?.[i]?'成立':'等待'}</span></div>`).join('');
 $('entry-plan').innerHTML=`<strong>开盘允许区间 · ${price(b.close*.97)} — ${price(b.close*1.03)} 日元</strong><p>${b.signal&&view.fresh?'信号成立后，仍需核对次日实际开盘。':'这只是价格范围；信号、数据和暂停条件也必须全部满足。'} ATR14：${price(b.atr)}，初始风险距离 R：${price(b.atr*1.5)}。</p>`;
 $('next-details').innerHTML=pos?`<div class="next-large">${view.stalePosition?'行情待更新':yen(lv.stop)}</div><div class="next-caption">${view.stalePosition?'旧止损仍需核对，暂停计算新的止损上调。':`${view.intendedDate} 生效的止损触发参考价`}<br>余仓 ${pos.qty} 股 · 最迟 ${pos.deadline} 退出</div>`:book?.cooldownEnd&&view.planDate<=book.cooldownEnd?`<div class="next-large">${book.cooldownEnd.slice(5).replace('-',' / ')}</div><div class="next-caption">暂停至这一天收盘。之后仍需重新满足入场信号。</div>`:`<div class="next-large">${view.planDate.slice(5).replace('-',' / ')}</div><div class="next-caption">下一交易日。${b.signal?'先确认开盘，再决定是否买入。':'保持现金，等待下一次收盘确认。'}<br>实际买入后，才开始计算持仓期限。</div>`;
 renderPosition();renderHistory();
 $('data-summary').textContent=`${bars.length} 根日线 · ${bars[0].date} 至 ${bars.at(-1).date}。${state.customBars.length?`含 ${state.customBars.length} 条本地导入/补录。`:''}`;
 $('account-summary').textContent=state.account?`起始本金 ${yen(state.account.initialCash)}，记录起始日 ${state.account.startDate}。`:'尚未设置策略本金。这里的金额不会发往 GitHub。';
 $('setup-account').disabled=!!state.account?.events.length;$('setup-account').textContent=state.account?'调整初始本金':'设置策略本金';$('undo-event').disabled=!state.account?.events.length;
}
function renderPosition(){const {book,levels:lv,latest:b}=view;const p=book?.position;
 if(!book){$('position-content').innerHTML=empty('先给策略一个起点','设置用于本策略的本金。已有持仓可以先设置买入前的资金，再按实际日期补录。','setup','设置策略本金');return;}
 if(!p){$('position-content').innerHTML=empty('现在空仓，也是一种选择',book.cooldownEnd&&view.planDate<=book.cooldownEnd?`暂停至 ${book.cooldownEnd}。恢复后仍需等待新的入场信号。`:'出现信号后，在券商完成交易，再在这里记录实际成交。');return;}
 const sessions=S.sessionsBetween(p.entryDate,view.time.date,calendar).length;
 const unreal=b.date>=p.entryDate?p.qty*(b.close-p.entry):0;
 $('position-content').innerHTML=`<div class="card"><div class="card-heading"><div><div class="eyebrow dark">285A · KIOXIA</div><h2>${p.qty} 股 <span class="muted small">／最初 ${p.initialQty} 股</span></h2></div><span class="pill">${p.partialDone?'已减仓':'尚未分批止盈'}</span></div>${view.stalePosition?'<div class="notice">行情不足，下面显示截至旧数据的止损参考值。请补齐日线后再核对；已设置的保护性订单需在券商确认。</div>':''}<div class="level-grid"><div class="level stop-level"><span>止损触发参考价</span><strong>${price(lv.stop)}</strong><small>${view.intendedDate} 适用 · ${lv.active?'移动保护已启动':'初始止损阶段'}</small></div><div class="level"><span>2.5R 分批止盈</span><strong>${p.partialDone?'已完成':price(p.target)}</strong><small>${p.partialDone?'余仓不设固定止盈':`触及后卖 ${S.splitQuantity(p.initialQty)} 股，余仓继续持有`}</small></div><div class="level"><span>最迟退出日期</span><strong>${p.deadline.slice(5).replace('-',' / ')}</strong><small>目前第 ${sessions} 个交易日 · 最长 10 日</small></div></div><div class="data-list"><div><span>实际买入价</span><strong>${yen(p.entry)}</strong></div><div><span>买入日期</span><strong>${p.entryDate}</strong></div><div><span>锁定风险距离 R</span><strong>${price(p.R)}</strong></div><div><span>移动保护启动收盘价</span><strong>${price(lv.activation)}</strong></div><div><span>本轮已兑现盈亏</span><strong>${yen(p.realized)}</strong></div><div><span>余仓浮动盈亏（收盘估算）</span><strong>${yen(unreal)}</strong></div></div><div class="inset"><strong>参考价不是成交保证</strong><p>跳空穿过止损时可能以更差价格成交；涨跌停可能无法成交。券商挂单需按实际报价单位调整，并核对余仓数量。${p.partialDone?'已记录减仓，系统不再重复提示2.5R卖出。':'到2.5R只卖出一次，实际卖出后请记录。'}</p></div><div class="button-row"><button class="button primary" data-action="record-sell">记录实际卖出</button><button class="button outline" data-tab="history">查看成交记录</button></div></div>`;
}
function renderHistory(){const rows=view.book?.rows||[];
 if(!rows.length){$('history-content').innerHTML=empty('你的第一笔记录，从这里开始','信号只是一份计划。确认券商的成交价和股数后，再写入交易记录。',state.account?'record-buy':'setup',state.account?'记录买入':'设置策略本金');return;}
 $('history-content').innerHTML=`<div class="card"><div class="scroll"><table><thead><tr><th>日期</th><th>操作</th><th>股数</th><th>实际成交价</th><th>已实现盈亏</th><th>可用现金</th></tr></thead><tbody>${[...rows].reverse().map(x=>`<tr><td>${x.date}${x.deviation?'<small class="danger" style="display:block">偏离策略</small>':''}</td><td><span class="badge-${x.type}">${x.type==='buy'?'买入':'卖出'}</span></td><td>${x.qty}</td><td>${price(x.price)}</td><td class="${x.pnl>=0?'positive':'negative'}">${x.pnl==null?'—':yen(x.pnl)}</td><td>${yen(x.cash)}</td></tr>`).join('')}</tbody></table></div><p class="small muted">记录包含实际成交价格；盈亏按成交价计算，未自动扣税。日期均为日本交易日。记录错误时，可撤销最近一筆再重新填写。</p></div>`;
}
$('rules-content').innerHTML=`
<aside class="card rule-definitions" aria-labelledby="indicator-title">
  <h2 id="indicator-title">先看指标：全部使用日线</h2>
  <dl class="indicator-list">
    <div><dt>MA20 ＝ SMA20</dt><dd>最近 20 个交易日的收盘价相加 ÷ 20，是<strong>简单移动平均线，不是 EMA20</strong>。本页统一写作 SMA20。</dd></div>
    <div><dt>MA10 ＝ SMA10</dt><dd>最近 10 个交易日收盘价的简单平均，也不是 EMA10。均线都包含所计算那一天的收盘价。</dd></div>
    <div><dt>ATR14 与 R</dt><dd>ATR14 是用 Wilder 平滑法计算的 14 日平均真实波幅，单位是日元。<strong>R ＝ 1.5 × 信号日 ATR14</strong>，入场时锁定。</dd></div>
  </dl>
</aside>
<nav class="rule-nav" aria-label="策略规则分区"><a href="#rules-entry">入场</a><a href="#rules-profit">止盈</a><a href="#rules-stop">止损</a><a href="#rules-time">持仓与暂停</a></nav>
<section id="rules-entry" class="card rule-section" aria-labelledby="entry-title">
  <div class="rule-section-heading"><span class="rule-section-mark" aria-hidden="true">01</span><div><h2 id="entry-title">入场规则</h2><p>先确认收盘信号，再核对下一交易日开盘。</p></div></div>
  <h3>收盘后，以下四项必须同时满足</h3>
  <ol class="rule-checklist">
    <li>今日收盘价 <strong>高于日线 SMA20</strong>。</li>
    <li>今日 SMA20 <strong>高于 5 个交易日前的 SMA20</strong>。</li>
    <li>今日之前的 3 个交易日中，至少有一天的最低价<strong>触及或低于那一天的 SMA10</strong>，不包含今天。</li>
    <li>今日收盘价 <strong>高于上一交易日最高价</strong>。</li>
  </ol>
  <h3>下一交易日，满足条件才买</h3>
  <ul class="rule-checklist"><li>开盘价相对信号日收盘价的偏离<strong>不超过 ±3%</strong>；超过则跳过这次机会。</li><li>当前必须空仓，且已结束暂停期；按可用现金尽量买满，以 <strong>100 股为一手</strong>，不使用杠杆，有余仓不加仓。</li><li>股数预估预留 0.1% 价格空间；成交后录入券商的实际买入价和股数。</li></ul>
</section>
<section id="rules-profit" class="card rule-section" aria-labelledby="profit-title">
  <div class="rule-section-heading"><span class="rule-section-mark" aria-hidden="true">02</span><div><h2 id="profit-title">止盈规则</h2><p>达到目标先卖一部分，剩余仓位继续按规则管理。</p></div></div>
  <div class="rule-formula"><span>首次分批止盈价</span><strong>实际买入价 ＋ 2.5 × R</strong></div>
  <ul class="rule-checklist"><li>首次达到目标时，卖出初始股数的<strong>约一半</strong>，不足整手时向上取整：500 股先卖 300 股；只有 100 股则全部卖出。</li><li>这次分批止盈<strong>只执行一次</strong>，剩余仓位不设固定止盈目标。</li><li>余仓仍受<strong>移动止损和最多 10 个交易日</strong>限制；分批止盈不重新计算持仓天数。</li></ul>
</section>
<section id="rules-stop" class="card rule-section" aria-labelledby="stop-title">
  <div class="rule-section-heading"><span class="rule-section-mark" aria-hidden="true">03</span><div><h2 id="stop-title">止损规则</h2><p>先锁定初始止损；保护启动后，止损价只能上调。</p></div></div>
  <h3>买入时：锁定初始止损</h3>
  <div class="rule-formula"><span>初始止损价</span><strong>实际买入价 − R</strong></div>
  <p>R 使用信号日的 ATR14，之后不因波动变大而放宽初始风险距离。盘中触及有效止损价，就按规则退出剩余仓位。</p>
  <h3>盈利后：启动移动止损</h3>
  <p>持仓期间的最高收盘价达到<strong>实际买入价 ＋ R</strong>后，从<strong>下一交易日</strong>开始启用移动保护。仅盘中冲高不算触发。</p>
  <div class="rule-formula"><span>下一交易日止损价，取以下三者最高值</span><ul><li>原有效止损价</li><li>实际买入价</li><li>持仓最高收盘价 − 2 × 当日 ATR14</li></ul></div>
  <p>后续每个收盘后更新，下一交易日生效，<strong>只上调、不下调</strong>。跳空跌破止损时，实际成交可能低于止损价；页面不代替券商下单。</p>
</section>
<section id="rules-time" class="card rule-section" aria-labelledby="time-title">
  <div class="rule-section-heading"><span class="rule-section-mark" aria-hidden="true">04</span><div><h2 id="time-title">持仓期限与暂停</h2><p>交易日不包含周末和日本股市休市日。</p></div></div>
  <h3>最多持有 10 个交易日</h3>
  <p><strong>买入当天算第 1 天</strong>。第 10 个交易日仍有仓位，无论盈亏都按计划在收盘前清仓；不采用亏损延期规则。另保留 28 个自然日上限，允许跨财报持仓。</p>
  <h3>亏损清仓后，暂停 5 个交易日</h3>
  <p>最后一次清空余仓的卖出成交价低于买入价，就跳过<strong>随后 5 个交易日</strong>；即使此前部分止盈让整笔交易净赚，也暂停。第 6 个交易日起可重新入场，仍须满足全部入场条件。</p>
  <h3>本金跟随实际盈亏变化</h3>
  <p>按实际成交价格和数量记账，盈利和亏损都会影响下一笔可用资金。余仓清空前不将卖出现金投入新仓。历史回测手续费为 0、每边滑点 0.1%、未扣税；历史最大回撤不是未来损失上限。</p>
</section>`;
function field(id,label,type='text',value='',extra=''){return `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}" value="${esc(value)}" ${extra} required></div>`;}
function openDialog(mode){
 if(!view)return;dialogMode=mode;$('form-error').textContent='';$('submit-dialog').textContent='保存';
 const now=view.time.date,tradeDate=S.isSession(now,calendar)?now:S.prevSession(now,calendar);
 if(mode==='setup'){
  $('dialog-title').textContent='设置策略本金';$('dialog-fields').innerHTML=field('initial-cash','初始本金（日元）','text',state.account?.initialCash||'','inputmode="decimal" placeholder="例如 30000000"')+field('start-date','账户记录起始日','date',state.account?.startDate||now,`min="2025-01-28" max="${now}"`)+`<p class="small muted">只填写用于这套策略的资金。要补录过去交易，请把起始日设在第一笔买入之前；已有记录时不能直接修改本金。</p>`;
 }else if(mode==='buy'){
  if(!state.account){openDialog('setup');return;}if(view.book.position){toast('已有持仓，不能重复买入。');return;}
  $('dialog-title').textContent='核算并记录买入';$('submit-dialog').textContent='确认实际买入';
  const buyDate=view.status==='ready'?view.planDate:tradeDate;
  const b=view.bars.find(x=>x.date===buyDate);
  $('dialog-fields').innerHTML=field('trade-date','核算 / 实际买入日期','date',buyDate,`min="${state.account.startDate}" max="${view.planDate>now?view.planDate:now}"`)+`<div class="form-grid">${field('opening-price','当日实际开盘价','number',b?.open||'','min="0.01" step="any" inputmode="decimal"')}${field('fill-price','实际成交均价','number','','min="0.01" step="any" inputmode="decimal"')}</div>`+field('fill-qty','实际成交股数','number','','min="100" step="100" inputmode="numeric"')+'<div class="form-preview" id="buy-preview">先输入当日开盘价，核对信号和计划股数。</div><label class="check-field"><input type="checkbox" id="override"><span>这笔已实际成交，即使偏离入场信号、暂停期限或开盘范围，也按真实成交记录。</span></label><p class="small muted">可预先核算下一交易日；未来日期不能保存成交。只有在券商已成交后，才点击确认。实际买入价格决定止损与目标。</p>';
 }else if(mode==='sell'){
  const p=view.book?.position;if(!p){toast('当前没有可卖出的持仓。');return;}
  $('dialog-title').textContent='记录实际卖出';$('submit-dialog').textContent='确认实际卖出';
  $('dialog-fields').innerHTML=field('trade-date','实际卖出日期','date',tradeDate,`min="${p.entryDate}" max="${now}"`)+`<div class="form-grid">${field('fill-price','实际成交均价','number','','min="0.01" step="any" inputmode="decimal"')}${field('fill-qty','实际卖出股数','number',p.partialDone?p.qty:S.splitQuantity(p.initialQty),`min="100" max="${p.qty}" step="100" inputmode="numeric"`)}</div><div class="form-preview" id="sell-preview">剩余 ${p.qty} 股。部分卖出后不会重新计算持仓期限。</div><p class="small muted">最后清空仓位的卖出若亏损，将自动计入5个交易日暂停。</p>`;
 }else if(mode==='bar'){
  $('dialog-title').textContent='补录收盘日线';$('dialog-fields').innerHTML=field('bar-date','交易日期','date',view.expected,`min="${bars[0].date}" max="${view.expected}"`)+`<div class="form-grid">${['open','high','low','close'].map((k,i)=>field('bar-'+k,['开盘价','最高价','最低价','收盘价'][i],'number','','min="0.01" step="any" inputmode="decimal"')).join('')}</div>`+field('bar-volume','成交量（股）','number','','min="1" step="1" inputmode="numeric"')+'<p class="small muted">请在收盘后填入完整日线。必须使用同一复权口径，成交量单位为股。已有日期会在确认后被修正。</p>';
 }
 $('form-dialog').showModal();if(mode==='buy')previewBuy();
}
function previewBuy(){if(dialogMode!=='buy'||!$('opening-price'))return;try{
 const date=$('trade-date').value,opening=num($('opening-price').value);if(!date||opening<=0)return;
 const r=S.openingPlan(view.bars,date,opening,view.book.cash,calendar);const paused=view.book.cooldownEnd&&date<=view.book.cooldownEnd;
 $('buy-preview').innerHTML=`<strong>${r.allowed&&!paused?'价格与信号符合条件':'当前不符合完整入场条件'}</strong><br>开盘偏离 ${pct(r.gap)} · ${paused?'仍在暂停期 · ':''}最多预估 ${r.quantity} 股<br>以开盘加0.1%预估：初始止损 ${price(r.stop)} / 2.5R目标 ${price(r.target)}<br><span class="small">预估不是成交；下方以你填入的实际价格锁定初始ATR。</span>`;
 }catch(e){$('buy-preview').textContent=e.message;}}
$('action-form').addEventListener('input',()=>{previewBuy();if(dialogMode==='sell'&&view.book?.position){const p=view.book.position,n=num($('fill-qty').value),v=num($('fill-price').value);if(v>0&&n>0)$('sell-preview').textContent=`本次预计已实现盈亏 ${yen(n*(v-p.entry))}。${n===p.qty&&v<p.entry?'清仓亏损，将暂停随后5个交易日。':n<p.qty?'余仓继续按原计划管理。':'按实际成交保存后更新可用现金。'}`;}});
$('action-form').addEventListener('submit',e=>{e.preventDefault();try{
 const candidate=structuredClone(state);
 if(dialogMode==='setup'){
  S.assert(!state.account?.events.length,'已有交易记录，不能修改初始本金。');candidate.account={initialCash:num($('initial-cash').value),startDate:$('start-date').value,events:[]};
 }else if(dialogMode==='buy'||dialogMode==='sell'){
  const date=$('trade-date').value;S.assert(date<=S.jstNow().date,'不能记录未来成交。');
  const event={id:crypto.randomUUID(),type:dialogMode==='buy'?'buy':'sell',date,price:num($('fill-price').value),qty:num($('fill-qty').value)};
  if(dialogMode==='buy'){event.opening=num($('opening-price').value);event.override=$('override').checked;event.signalATR=view.bars.find(x=>x.date===S.prevSession(date,calendar))?.atr;}
  candidate.account.events.push(event);
 }else if(dialogMode==='bar'){
  const date=$('bar-date').value;S.assert(date<=view.expected,'只能补录已收盘的日线。');
  const bar={date,...Object.fromEntries(['open','high','low','close','volume'].map(k=>[k,num($('bar-'+k).value)]))};
  if(bars.some(x=>x.date===date)&&!confirm(`${date} 已有日线，是否用新数值替换？`))return;
  candidate.customBars=[...candidate.customBars.filter(x=>x.date!==date),bar];
 }
 save(candidate);$('form-dialog').close();toast('已保存在当前浏览器。');if(dialogMode==='buy'||dialogMode==='sell')tab('position');
 }catch(err){$('form-error').textContent=err.message;}});
$('close-dialog').onclick=$('cancel-dialog').onclick=()=>$('form-dialog').close();
$('form-dialog').addEventListener('click',e=>{if(e.target===$('form-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
document.addEventListener('click',e=>{const tabButton=e.target.closest('[data-tab]');if(tabButton)tab(tabButton.dataset.tab);const a=e.target.closest('[data-action]')?.dataset.action;if(a==='setup')openDialog('setup');if(a==='record-buy')openDialog('buy');if(a==='record-sell')openDialog('sell');});
$('hero-action').onclick=()=>{if(view.status==='setup')openDialog('setup');else if(view.status==='stale')tab('data');else if(view.status==='holding'||view.status==='exit')tab('position');else if(view.status==='ready')openDialog('buy');else if(view.status==='cooldown')tab('position');else $('signal-list').scrollIntoView({behavior:'smooth',block:'center'});};
$('setup-account').onclick=()=>openDialog('setup');$('add-bar').onclick=()=>openDialog('bar');
function download(name,text,mime='application/json'){const url=URL.createObjectURL(new Blob([text],{type:mime}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('csv-template').onclick=()=>download('285A_daily_template.csv','date,open,high,low,close,volume\n2026-09-18,53000,55000,52000,54570,1000000\n','text/csv');
$('export-backup').onclick=()=>download('285A_backup_'+S.jstNow().date+'.json',JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2));
$('import-csv').onclick=()=>$('csv-file').click();$('restore-backup').onclick=()=>$('backup-file').click();
$('csv-file').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;S.assert(file.size<5000000,'CSV文件过大。');const input=S.parseCSV(await file.text());S.assert(input.every(x=>x.date<=view.expected),'CSV包含尚未收盘或未来日期。');const candidate=structuredClone(state);const existing=new Map(candidate.customBars.map(x=>[x.date,x]));for(const x of input)existing.set(x.date,x);candidate.customBars=[...existing.values()];S.mergeBars(market.bars,candidate.customBars,calendar);if(!confirm(`导入 ${input.length} 行日线，重复日期将使用导入值。继续？`))return;save(candidate);toast('日线已导入，指标已重新计算。');}catch(err){toast(err.message);}finally{e.target.value='';}};
$('backup-file').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;S.assert(file.size<10000000,'备份文件过大。');const raw=JSON.parse(await file.text());S.assert(raw.version===S.VERSION&&Array.isArray(raw.customBars),'不是本策略版本的备份文件。');const candidate={version:S.VERSION,account:raw.account,customBars:raw.customBars};S.assert(!candidate.account||candidate.account.events.every(x=>x.date<=S.jstNow().date),'备份含未来成交。');S.assert(candidate.customBars.every(x=>x.date<=view.expected),'备份含未收盘日线。');S.makeView(candidate.account,S.mergeBars(market.bars,candidate.customBars,calendar),calendar);if(!confirm('恢复会替换本浏览器现有策略账户和补录行情。建议先导出备份。确定恢复？'))return;save(candidate);toast('备份已恢复。');}catch(err){toast('恢复失败：'+err.message);}finally{e.target.value='';}};
$('undo-event').onclick=()=>{if(!state.account?.events.length)return;if(!confirm('撤销最近一笔实际成交？资金、持仓与暂停期限会重新计算。'))return;try{const candidate=structuredClone(state);candidate.account.events.pop();save(candidate);toast('已撤销最近一笔。');}catch(e){toast(e.message);}};
$('reset-account').onclick=()=>{if(!state.account){toast('没有需要清空的账户。');return;}if(!confirm('清空本浏览器的本金与全部成交记录？行情保留。建议先导出备份。'))return;try{save({...state,account:null});toast('账户记录已清空。');}catch(e){toast(e.message);}};
async function loadJSON(path){const r=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('行情文件读取失败，请稍后重试。');return r.json();}
$('refresh-data').onclick=async()=>{const btn=$('refresh-data');btn.disabled=true;btn.textContent='正在检查…';try{const next=await loadJSON('data/market.json');S.assert(next.symbol==='285A.T','行情代码不一致。');const validated=S.validateBars(next.bars,calendar);S.assert(validated.at(-1).date>=market.bars.at(-1).date,'远端行情比本地旧，保留现有数据。');const nextBars=S.mergeBars(validated,state.customBars,calendar);S.makeView(state.account,nextBars,calendar);market=next;bars=nextBars;render();toast(view.fresh?'行情已齐备。':`远端文件仍到 ${view.latest.date}，请补录缺少的日线。`);}catch(err){toast(err.message);}finally{btn.disabled=false;btn.textContent='检查行情更新 ↻';}};
async function init(){try{[market,calendar]=await Promise.all([loadJSON('data/market.json'),loadJSON('data/calendar.json')]);S.assert(market.symbol==='285A.T','行情代码不一致。');const raw=localStorage.getItem(STORE);if(raw){state=JSON.parse(raw);S.assert(state.version===S.VERSION,'记录版本不兼容，请保留原备份。');}bars=S.mergeBars(S.validateBars(market.bars,calendar),state.customBars,calendar);render();}catch(err){$('loading').hidden=false;$('loading').textContent='无法加载策略：'+err.message+' 请刷新重试；现有浏览器记录未被修改。';}}
init();
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&view){try{render();}catch(err){toast(err.message);}}});
