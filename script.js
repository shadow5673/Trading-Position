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
 const checks=[['收盘站上 20 日均线',`收盘 ${price(b.close)} / MA20 ${price(b.ma20)}`],['20 日均线正在向上',`当前 ${price(b.ma20)} / 5 日前 ${price(lag?.ma20)}`],['此前 3 日回踩 10 日均线',touch?`触及日期：${touch}`:'此前三日低点均未触及 MA10'],['收盘突破昨日最高价',`收盘 ${price(b.close)} / 昨高 ${price(prev?.high)}`]];
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
const rules=[['入场，四项同时满足','收盘高于MA20；MA20高于5个交易日前；此前3个交易日中至少一日低点触及或低于当日MA10；今日收盘高于昨日最高。只用收盘后确认的数据。'],['次日开盘，尽量满仓','次日开盘相对信号日收盘偏离不超过±3%，按可用资金买入100股整数手，不借钱。有余仓不加仓。股数预估预留0.1%价格空间，实际成交后按实际价格记账。'],['初始止损，锁定1.5ATR','R＝1.5×信号日Wilder ATR14。初始止损＝实际买入价－R。R在买入时锁定，之后不因波动上升而放宽初始风险距离。'],['达到2.5R，先兑现一部分','目标价＝实际买入价＋2.5R。首次达到时卖出约一半，奇数手向上取整：500股先卖300股；只有100股则全部卖出。余仓不设固定目标。'],['移动保护，只上调、不下调','持仓最高收盘价达到买入价＋R后，从下一交易日起，止损取旧止损、买入价、最高收盘价－2×当日ATR中的最高值。盘中冲高本身不启动此条件。'],['持有上限，最多10个交易日','包括买入日。第10个交易日仍未退出，按计划在收盘前清仓；部分止盈不重置计时。另保留28个自然日上限，允许跨财报。'],['最后一笔亏损，暂停5日','最后清空余仓的卖出成交相对买入价亏损，就跳过随后5个交易日。即使此前部分止盈让整轮净赚，也暂停。第6个交易日起才可恢复入场，仍需符合信号。'],['真实成交，真实本金','以实际买卖价格与数量记账，盈亏影响下一笔可用资金。记录不会代替券商下单。历史回测采用零手续费、每边0.1%滑点、未扣税；历史最大回撤不是未来损失上限。']];
$('rules-content').innerHTML=rules.map(([title,text],i)=>`<div class="rule-item"><span class="rule-number">0${i+1}</span><div><h3>${title}</h3><p>${text}</p></div></div>`).join('');
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
