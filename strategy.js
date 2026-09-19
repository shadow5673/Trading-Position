export const VERSION = 'C-PARTIAL-CD5-v1';
export const LOT = 100;
export function assert(condition, message) { if (!condition) throw new Error(message); }
export function jstNow(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).formatToParts(now);
  const v = Object.fromEntries(p.map(x=>[x.type,x.value]));
  return { date:`${v.year}-${v.month}-${v.day}`, minutes:Number(v.hour)*60+Number(v.minute) };
}
export function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s+'T00:00:00Z')) && new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s; }
export function addDays(s,n) { const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10); }
export function isSession(d,cal) { assert(validDate(d)&&d>=cal.start&&d<=cal.end,'日期超出交易日历范围，请更新日历。');const day=new Date(d+'T00:00:00Z').getUTCDay();return day!==0&&day!==6&&!cal.holidays.includes(d); }
export function nextSession(d,cal,n=1) { let x=d;for(let i=0;i<n;i++){do{x=addDays(x,1);}while(!isSession(x,cal));}return x; }
export function prevSession(d,cal) { let x=d;do{x=addDays(x,-1);}while(!isSession(x,cal));return x; }
export function sessionsBetween(a,b,cal) { if(a>b)return [];const result=[];for(let d=a;d<=b;d=addDays(d,1)){if(isSession(d,cal))result.push(d);}return result; }
export function expectedCloseDate(cal,now=new Date()) { const j=jstNow(now);return isSession(j.date,cal)&&j.minutes>=930?j.date:prevSession(j.date,cal); }
export function validateBars(input,cal) {
  assert(Array.isArray(input)&&input.length>0,'行情为空。');assert(input.length<15000,'行情行数过多。');
  const bars=input.map(x=>({date:String(x.date),...Object.fromEntries(['open','high','low','close','volume'].map(k=>[k,Number(x[k])]))})).sort((a,b)=>a.date.localeCompare(b.date));
  for(let i=0;i<bars.length;i++){
    const b=bars[i];assert(validDate(b.date),'行情日期格式应为 YYYY-MM-DD。');assert(isSession(b.date,cal),`${b.date} 不是日历中的交易日。`);
    assert(i===0||b.date!==bars[i-1].date,`重复行情日期：${b.date}`);
    assert(['open','high','low','close','volume'].every(k=>Number.isFinite(b[k]))&&b.low>0&&b.volume>0,`${b.date} 含无效价格或成交量。`);
    assert(b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close),`${b.date} 最高/最低价不正确。`);
    if(i>0)assert(nextSession(bars[i-1].date,cal)===b.date,`缺少 ${nextSession(bars[i-1].date,cal)} 的日线，请补齐后再计算。`);
  }
  return bars;
}
export function enrich(bars) {
 const a=[];for(let i=0;i<bars.length;i++){
  const b={...bars[i]};for(const n of [10,20])b['ma'+n]=i>=n-1?bars.slice(i-n+1,i+1).reduce((x,y)=>x+y.close,0)/n:null;
  b.tr=i?Math.max(b.high-b.low,Math.abs(b.high-bars[i-1].close),Math.abs(b.low-bars[i-1].close)):b.high-b.low;
  b.atr=i===13?([...a.map(x=>x.tr),b.tr].reduce((x,y)=>x+y,0)/14):i>13?(a[i-1].atr*13+b.tr)/14:null;
  b.checks=i>=24?[b.close>b.ma20,b.ma20>a[i-5].ma20,a.slice(i-3,i).some(x=>x.low<=x.ma10),b.close>a[i-1].high]:null;
  b.signal=!!b.checks&&b.checks.every(Boolean);a.push(b);
 }return a;
}
export function splitQuantity(q) { return Math.min(q,Math.ceil(q/200)*100); }
export function quantityForCash(cash,price,buffer=.001) { return Math.floor(cash/(price*(1+buffer)*100))*100; }
export function holdingDeadline(entryDate,cal) { let d=nextSession(entryDate,cal,9);while((Date.parse(d)-Date.parse(entryDate))/86400000>28)d=prevSession(d,cal);return d; }
export function openingPlan(bars,date,opening,cash,cal) {
 const prev=prevSession(date,cal),b=bars.find(x=>x.date===prev);
 assert(b?.atr&&b.checks,'缺少前一交易日的完整指标，不能生成买入计划。');
 const gap=opening/b.close-1;const allowed=b.signal&&Math.abs(gap)<=.0300000001;
 const quantity=quantityForCash(cash,opening);const entry=opening*1.001,R=1.5*b.atr;
 return {allowed:allowed&&quantity>=100&&R<entry,gap,quantity,signal:b,entry,stop:entry-R,target:entry+2.5*R,R};
}
export function ledger(account,bars,cal) {
 assert(account&&Number.isFinite(account.initialCash)&&account.initialCash>0&&account.initialCash<=1e12,'本金必须是有效正数。');
 assert(validDate(account.startDate),'账户起始日期无效。');assert(Array.isArray(account.events)&&account.events.length<20000,'成交记录无效。');
 let cash=account.initialCash,position=null,cooldownEnd=null,realized=0,lastDate=account.startDate,closed=[];const rows=[];
 for(const e of account.events){
  assert(validDate(e.date)&&e.date>=lastDate&&e.date>=account.startDate,'成交记录必须按日期顺序，且不早于账户起始日。');assert(isSession(e.date,cal),'成交日期必须为交易日。');lastDate=e.date;
  assert(['buy','sell'].includes(e.type),'未知成交类型。');assert(Number.isFinite(e.price)&&e.price>0&&Number.isInteger(e.qty)&&e.qty>0&&e.qty%100===0,'成交价必须为正数，股数必须是100的正整数倍。');
  if(e.type==='buy'){
   assert(!position,'有余仓时不能再买入。');assert(e.price*e.qty<=cash+.001,'买入金额超过可用现金，请核对本金与成交记录。');
   const sig=bars.find(x=>x.date===prevSession(e.date,cal));assert(sig?.atr,'买入日前的行情不足，无法计算初始ATR止损。');
   const atr=e.signalATR??sig.atr;assert(Number.isFinite(atr)&&atr>0&&1.5*atr<e.price,'初始止损距离异常，请核对行情。');
   const deviation=!sig.signal||(cooldownEnd&&e.date<=cooldownEnd)||!Number.isFinite(e.opening)||Math.abs(e.opening/sig.close-1)>.0300000001;
   assert(!deviation||e.override===true,'买入不符合信号、开盘跳空或暂停规则；实际已成交请勾选偏离规则记录。');
   cash-=e.qty*e.price;position={entryDate:e.date,entry:e.price,initialQty:e.qty,qty:e.qty,R:1.5*atr,initialStop:e.price-1.5*atr,target:e.price+3.75*atr,signalDate:sig.date,partialDone:false,realized:0,deadline:holdingDeadline(e.date,cal)};
   rows.push({...e,pnl:null,cash,deviation:!!deviation});
  }else{
   assert(position&&e.qty<=position.qty,'卖出股数超过持仓。');
   const pnl=e.qty*(e.price-position.entry);cash+=e.qty*e.price;realized+=pnl;position.realized+=pnl;position.qty-=e.qty;position.partialDone=true;
   rows.push({...e,pnl,cash});
   if(position.qty===0){closed.push({...position,exitDate:e.date,pnl:position.realized});if(pnl<0)cooldownEnd=nextSession(e.date,cal,5);position=null;}
  }
 }
 return {cash,position,cooldownEnd,realized,closed,rows};
}
export function levels(position,bars,beforeDate) {
 let stop=position.initialStop,maxClose=position.entry,active=false;
 for(const b of bars){if(b.date<position.entryDate||b.date>=beforeDate)continue;maxClose=Math.max(maxClose,b.close);if(maxClose>=position.entry+position.R){active=true;stop=Math.max(stop,position.entry,maxClose-2*b.atr);}}
 return {stop,maxClose,active,target:position.target,activation:position.entry+position.R};
}
export function makeView(account,rawBars,cal,now=new Date()) {
 const time=jstNow(now),expected=expectedCloseDate(cal,now);
 if(account){assert(account.startDate<=time.date,'账户起始日不能在未来。');assert(Array.isArray(account.events)&&account.events.every(e=>e.date<=time.date),'不能记录未来成交。');}
 const bars=enrich(rawBars.filter(b=>b.date<=expected));const latest=bars.at(-1);assert(latest,'尚无已收盘行情。');
 const fresh=latest.date===expected,planDate=nextSession(latest.date,cal),book=account?ledger(account,bars,cal):null;
 const p=book?.position;
 const intendedDate=isSession(time.date,cal)&&time.minutes<930?time.date:nextSession(time.date,cal);
 const lv=p?levels(p,bars,intendedDate):null;
 const stalePosition=!!p&&latest.date<prevSession(intendedDate,cal);
 const value=book?book.cash+(p?p.qty*(latest.date>=p.entryDate?latest.close:p.entry):0):null;
 let status='setup',title='先设置你的策略账户',description='输入用于这套策略的本金，开始记录每一次决定。';
 if(book){
  if(!fresh){status='stale';title='先更新行情，再生成计划';description=`最近完整日线为 ${latest.date}，应更新至 ${expected}。暂不生成新的买入建议。`;}
  else if(p){
   if(intendedDate>=p.deadline){status='exit';title=intendedDate>p.deadline?'持仓已超过期限':'本交易日到期退出';description=`原定最迟 ${p.deadline} 收盘前清仓。请核对实际成交，不自动假设卖出。`;}
   else {status='holding';title=p.partialDone?'保留余仓，跟随移动止损':'持有，等待价格触发';description=`止损与分批止盈在盘中执行；最迟 ${p.deadline} 退出。`;}
  }else if(book.cooldownEnd&&planDate<=book.cooldownEnd){status='cooldown';title='暂停入场，给交易一点间隔';description=`暂停至 ${book.cooldownEnd}（含当日），最早 ${nextSession(book.cooldownEnd,cal)} 恢复。`;}
  else if(latest.signal){status='ready';title='信号成立，等待下一次开盘';description=`${planDate} 开盘落在允许区间内，才满足下一步买入条件。`;}
  else {status='watch';title='保持空仓，等待完整信号';description='四项入场条件尚未全部满足。今天不需要为了交易而交易。';}
 }
 return {time,expected,bars,latest,fresh,planDate,intendedDate,book,levels:lv,value,status,title,description,stalePosition};
}
export function parseCSV(text) {
 const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/).filter(x=>x.trim());assert(lines.length>=2,'CSV至少需要表头和一行数据。');
 const split=s=>s.split(',').map(x=>x.trim().replace(/^"|"$/g,''));const head=split(lines[0]).map(x=>x.toLowerCase());
 const required=['date','open','high','low','close','volume'];assert(required.every(x=>head.includes(x)),'CSV表头需要 date,open,high,low,close,volume。');
 return lines.slice(1).map(l=>{const a=split(l);return Object.fromEntries(required.map(k=>[k,k==='date'?a[head.indexOf(k)]:Number(a[head.indexOf(k)])]));});
}
export function mergeBars(existing, incoming, cal) { const map=new Map(existing.map(b=>[b.date,b]));for(const b of incoming)map.set(b.date,b);return validateBars([...map.values()],cal); }
