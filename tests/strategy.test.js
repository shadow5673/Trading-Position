import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../strategy.js';
const data=JSON.parse(fs.readFileSync(new URL('../data/market.json',import.meta.url)));
const cal=JSON.parse(fs.readFileSync(new URL('../data/calendar.json',import.meta.url)));
const ref=JSON.parse(fs.readFileSync(new URL('./reference.json',import.meta.url)));
const bars=S.enrich(S.validateBars(data.bars,cal));
const near=(a,b)=>assert.ok(Math.abs(a-b)<.00001,`${a} != ${b}`);

test('Indicators and all historical signals match Python backtest without lookahead',()=>{
 for(let i=0;i<ref.indicators.length;i++){
  const b=bars[i],r=ref.indicators[i];assert.equal(b.date,r.date);
  for(const [k,z] of [['ma10','ma10'],['ma20','ma20'],['atr','atr14']]){if(r[z]===null)assert.equal(b[k],null);else near(b[k],r[z]);}
  assert.equal(b.signal,r.signal);
 }
 assert.deepEqual(S.enrich(data.bars.slice(0,100)),bars.slice(0,100));
});
test('Actual-fill ledger matches all full-period backtest trade cash and final balance',()=>{
 const account={initialCash:ref.initial,startDate:'2025-01-01',events:[]};
 for(const t of ref.trades){
  const opening=bars.find(b=>b.date===t.entry_date).open;
  account.events.push({type:'buy',date:t.entry_date,qty:t.initial_shares,price:t.entry,opening});
  let book=S.ledger(account,bars,cal);assert.equal(book.position.qty,t.initial_shares);
  near(book.position.R,t.risk);near(book.position.initialStop,t.initial_stop);
  for(const leg of t.legs){account.events.push({type:'sell',date:leg.date,qty:leg.shares,price:leg.price});book=S.ledger(account,bars,cal);}
  near(book.cash,t.capital_after);assert.equal(book.position,null);
 }
 near(S.ledger(account,bars,cal).cash,ref.final);
});
test('Cooldown follows losing final leg even when whole trade profits',()=>{
 const t=ref.trades.find(t=>t.entry_date==='2025-11-07');
 const account={initialCash:40000000,startDate:'2025-01-01',events:[{type:'buy',date:t.entry_date,qty:t.initial_shares,price:t.entry,opening:bars.find(b=>b.date===t.entry_date).open},...t.legs.map(l=>({type:'sell',date:l.date,qty:l.shares,price:l.price}))]};
 const b=S.ledger(account,bars,cal);assert.ok(b.realized>0);assert.equal(b.cooldownEnd,'2025-11-25');assert.equal(S.nextSession(b.cooldownEnd,cal),'2025-11-26');
 account.events.push({type:'buy',date:'2025-11-18',qty:100,price:10950,opening:10950});assert.throws(()=>S.ledger(account,bars,cal),/暂停/);
});
test('Holiday counts: September three consecutive holidays and 10-session deadline',()=>{
 assert.equal(S.nextSession('2026-09-18',cal),'2026-09-24');
 assert.equal(S.holdingDeadline('2026-08-28',cal),'2026-09-10');
 assert.equal(S.nextSession('2026-09-18',cal,5),'2026-09-30');
 assert.equal(S.expectedCloseDate(cal,new Date('2026-09-24T06:00:00Z')),'2026-09-18');
 assert.equal(S.expectedCloseDate(cal,new Date('2026-09-24T07:00:00Z')),'2026-09-24');
});
test('Partial quantities round up odd lots; 1 lot sells fully',()=>{
 assert.equal(S.splitQuantity(500),300);assert.equal(S.splitQuantity(100),100);assert.equal(S.splitQuantity(600),300);
 assert.equal(S.quantityForCash(30000000,51780),500);
});
test('Trailing stop only changes from next session; initial ATR is frozen',()=>{
 const t=ref.trades.find(t=>t.entry_date==='2025-11-07');
 const a={initialCash:40000000,startDate:'2025-01-01',events:[{type:'buy',date:t.entry_date,qty:100,price:t.entry,opening:bars.find(b=>b.date===t.entry_date).open,signalATR:t.risk/1.5}]};
 const p=S.ledger(a,bars,cal).position;
 near(S.levels(p,bars,'2025-11-10').stop,t.initial_stop);
 near(S.levels(p,bars,'2025-11-11').stop,t.stop_updates[0].stop);
 const revised=bars.map(b=>b.date===p.signalDate?{...b,atr:b.atr*2}:b);near(S.ledger(a,revised,cal).position.R,p.R);
});
test('Stale data gates new plans, future unfinished daily bar never enters indicators',()=>{
 const account={initialCash:30000000,startDate:'2026-07-01',events:[]};
 const v=S.makeView(account,data.bars,cal,new Date('2026-09-24T07:30:00Z'));assert.equal(v.status,'stale');assert.equal(v.expected,'2026-09-24');
 const midday=S.makeView(account,data.bars,cal,new Date('2026-09-18T02:00:00Z'));assert.equal(midday.latest.date,'2026-09-17');
});
test('Invalid/missing data and impossible trades are rejected',()=>{
 assert.throws(()=>S.validateBars(data.bars.filter((_,i)=>i!==100),cal),/缺少/);
 assert.throws(()=>S.validateBars([...data.bars,data.bars[0]],cal),/重复/);
 assert.throws(()=>S.ledger({initialCash:100,startDate:'2026-07-01',events:[{type:'buy',date:'2026-08-28',qty:100,price:51780,opening:51780}]},bars,cal),/超过/);
 assert.throws(()=>S.ledger({initialCash:30000000,startDate:'2026-07-01',events:[{type:'sell',date:'2026-08-28',qty:100,price:51780}]},bars,cal),/超过/);
});
