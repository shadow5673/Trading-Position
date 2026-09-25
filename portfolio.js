import * as S from './strategy.js?v=20260925-dual';
export const STOCKS = [
 {id:'285A',symbol:'285A.T',name:'凯侠',english:'KIOXIA',japanese:'キオクシアHD',path:'data/market.json'},
 {id:'4062',symbol:'4062.T',name:'揖斐电',english:'IBIDEN',japanese:'イビデン',path:'data/market-4062.json'}
];
export const storageKey=id=>`swingDesk.${id}.v1`;
export function newState(id,date=S.jstNow().date){return {version:S.VERSION,symbol:id,account:{initialCash:10000000,startDate:date,events:[]},customBars:[]};}
export function decodeState(raw,id){
 S.assert(raw&&raw.version===S.VERSION&&Array.isArray(raw.customBars),'记录版本不兼容，请保留原备份。');
 S.assert((raw.symbol||'285A')===id,'备份所属股票不一致，请先切换到对应股票。');
 return {version:S.VERSION,symbol:id,account:raw.account,customBars:raw.customBars};
}
export function loadState(storage,id){const raw=storage.getItem(storageKey(id));return raw?decodeState(JSON.parse(raw),id):newState(id);}
export function contextView(state,market,cal,now=new Date()){
 const raw=S.mergeBars(S.validateBars(market.bars,cal),state.customBars,cal);
 return {bars:raw,view:S.makeView(state.account,raw,cal,now,market.splits||[])};
}
export function totals(views){
 const ready=views.filter(v=>v?.book);
 return {count:ready.length,value:ready.reduce((a,v)=>a+v.value,0),cash:ready.reduce((a,v)=>a+v.book.cash,0),realized:ready.reduce((a,v)=>a+v.book.realized,0),positions:ready.filter(v=>v.book.position).length};
}
