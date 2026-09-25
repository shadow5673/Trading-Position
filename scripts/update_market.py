"""Fetch each stock independently. Persist actual trading-day prices; normalize known splits only."""
import argparse,datetime as dt,json,math,urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parents[1]
STOCKS=[('285A.T','market.json'),('4062.T','market-4062.json')]

def update(now=None,dry_run=False,symbol='285A.T',filename='market.json'):
 path=ROOT/'data'/filename;old=json.loads(path.read_text());cal=json.loads((ROOT/'data/calendar.json').read_text())
 assert old['symbol']==symbol,'Stored ticker mismatch.'
 now=now or dt.datetime.now(ZoneInfo('Asia/Tokyo'));today=now.date().isoformat()
 assert cal['start']<=today<=cal['end'],'Calendar must be updated before refreshing quotes.'
 def session(date):return date.weekday()<5 and date.isoformat() not in cal['holidays']
 end=now.date()
 if now.hour*60+now.minute<930 or not session(end):
  end-=dt.timedelta(days=1)
  while not session(end):end-=dt.timedelta(days=1)
 # A later scheduled retry must not re-fetch a session already saved successfully.
 # Still validate the stored closing bar before declaring the file current.
 latest=old['bars'][-1]
 assert latest['date']<=end.isoformat(),'Stored data contains an unfinished or future session.'
 if latest['date']==end.isoformat():
  assert all(isinstance(latest[k],(int,float)) and not isinstance(latest[k],bool) and math.isfinite(latest[k]) and latest[k]>0 for k in ['open','high','low','close','volume']),'Invalid stored daily row.'
  assert latest['low']<=min(latest['open'],latest['close'])<=max(latest['open'],latest['close'])<=latest['high'],'Invalid stored OHLC order.'
  print(f'{symbol}: Already current through {end}; provider request skipped, existing file retained.');return
 url=f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=3mo&interval=1d&events=splits'
 req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Accept':'application/json'})
 with urllib.request.urlopen(req,timeout=30) as response:raw=json.load(response)
 root=raw['chart']['result'][0];assert root['meta']['symbol']==symbol,'Unexpected ticker.'
 known={s['date']:s['ratio'] for s in old.get('splits',[])};feed_splits={}
 for e in root.get('events',{}).get('splits',{}).values():
  if 'date' not in e:raise ValueError('Split detected without a verified date.')
  date=dt.datetime.fromtimestamp(e['date'],ZoneInfo('Asia/Tokyo')).date().isoformat();ratio=e['numerator']/e['denominator']
  if known.get(date)!=ratio:raise ValueError(f'Split detected without matching verified metadata: {date} {ratio}.')
  feed_splits[date]=ratio
 q=root['indicators']['quote'][0];existing={b['date']:b for b in old['bars']};incoming=[]
 for i,timestamp in enumerate(root['timestamp']):
  date=dt.datetime.fromtimestamp(timestamp,ZoneInfo('Asia/Tokyo')).date()
  if date>end:continue
  bar=dict(date=date.isoformat(),**{k:q[k][i] for k in ['open','high','low','close','volume']})
  assert all(isinstance(bar[k],(int,float)) and math.isfinite(bar[k]) and bar[k]>0 for k in ['open','high','low','close','volume']),f'Invalid daily row {date}'
  # Yahoo quote OHLC is split-adjusted, whereas volume is the original tape volume.
  factor=math.prod(r for day,r in feed_splits.items() if bar['date']<day)
  for k in ['open','high','low','close']:bar[k]=round(bar[k]*factor,6)
  assert bar['low']<=min(bar['open'],bar['close'])<=max(bar['open'],bar['close'])<=bar['high']
  if bar['date'] in existing:
   assert all(abs(bar[k]-existing[bar['date']][k])<=max(.01,abs(bar[k])*1e-6) for k in ['open','high','low','close']),f'Historical prices changed on {date}; manual review required.'
  elif bar['date']>old['bars'][-1]['date']:incoming.append(bar)
 if not incoming:
  assert old['bars'][-1]['date']>=end.isoformat(),f'Latest data {old["bars"][-1]["date"]} is stale; expected {end}. Provider has not supplied the completed bar; retry later.'
  print(f'{symbol}: Already current through {end}; no new completed bars, existing file retained.');return
 incoming.sort(key=lambda b:b['date']);previous=dt.date.fromisoformat(old['bars'][-1]['date'])
 for b in incoming:
  expected=previous+dt.timedelta(days=1)
  while not session(expected):expected+=dt.timedelta(days=1)
  assert b['date']==expected.isoformat(),f'Missing daily bar {expected}'
  previous=expected
 assert previous==end,f'Latest data {previous} is stale; expected {end}'
 new={**old,'bars':old['bars']+incoming,'updatedAt':now.isoformat()}
 if dry_run:print(f'{symbol}: Validated {len(incoming)} new bars through {previous}; dry run, no write.')
 else:
  temp=path.with_suffix('.tmp');temp.write_text(json.dumps(new,ensure_ascii=False,separators=(',',':')));temp.replace(path)
  print(f'{symbol}: Added {len(incoming)} completed bars through {previous}.')
def update_all(now=None,dry_run=False):
 errors=[]
 for symbol,filename in STOCKS:
  try:update(now=now,dry_run=dry_run,symbol=symbol,filename=filename)
  except Exception as e:errors.append(f'{symbol}: {e}');print(f'ERROR {symbol}: {e}')
 return errors

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--dry-run',action='store_true');args=parser.parse_args()
 if update_all(dry_run=args.dry_run):raise SystemExit(1)
if __name__=='__main__':main()
