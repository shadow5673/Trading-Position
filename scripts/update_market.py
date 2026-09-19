"""Fetch completed Yahoo daily bars; preserve verified history and fail closed on changes."""
import argparse,datetime as dt,json,math,urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parents[1]

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--dry-run',action='store_true');args=parser.parse_args()
 path=ROOT/'data/market.json';old=json.loads(path.read_text());cal=json.loads((ROOT/'data/calendar.json').read_text())
 now=dt.datetime.now(ZoneInfo('Asia/Tokyo'));today=now.date().isoformat()
 assert cal['start']<=today<=cal['end'],'Calendar must be updated before refreshing quotes.'
 def session(date):return date.weekday()<5 and date.isoformat() not in cal['holidays']
 end=now.date()
 if now.hour*60+now.minute<930 or not session(end):
  end-=dt.timedelta(days=1)
  while not session(end):end-=dt.timedelta(days=1)
 url='https://query1.finance.yahoo.com/v8/finance/chart/285A.T?range=3mo&interval=1d&events=splits'
 req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Accept':'application/json'})
 with urllib.request.urlopen(req,timeout=30) as response:raw=json.load(response)
 root=raw['chart']['result'][0];assert root['meta']['symbol']=='285A.T','Unexpected ticker.'
 if root.get('events',{}).get('splits'):raise ValueError('Split detected. Verify data basis and holdings before updating.')
 q=root['indicators']['quote'][0];existing={b['date']:b for b in old['bars']};incoming=[]
 for i,timestamp in enumerate(root['timestamp']):
  date=dt.datetime.fromtimestamp(timestamp,ZoneInfo('Asia/Tokyo')).date()
  if date>end:continue
  bar=dict(date=date.isoformat(),**{k:q[k][i] for k in ['open','high','low','close','volume']})
  assert all(isinstance(bar[k],(int,float)) and math.isfinite(bar[k]) and bar[k]>0 for k in ['open','high','low','close','volume']),f'Invalid daily row {date}'
  assert bar['low']<=min(bar['open'],bar['close'])<=max(bar['open'],bar['close'])<=bar['high']
  if bar['date'] in existing:
   assert all(abs(bar[k]-existing[bar['date']][k])<=max(.01,abs(bar[k])*1e-6) for k in ['open','high','low','close']),f'Historical prices changed on {date}; manual review required.'
  elif bar['date']>old['bars'][-1]['date']:incoming.append(bar)
 if not incoming:print('No new completed bars; existing file retained.');return
 incoming.sort(key=lambda b:b['date']);previous=dt.date.fromisoformat(old['bars'][-1]['date'])
 for b in incoming:
  expected=previous+dt.timedelta(days=1)
  while not session(expected):expected+=dt.timedelta(days=1)
  assert b['date']==expected.isoformat(),f'Missing daily bar {expected}'
  previous=expected
 assert previous==end,f'Latest data {previous} is stale; expected {end}'
 new={**old,'bars':old['bars']+incoming,'updatedAt':now.isoformat()}
 if args.dry_run:print(f'Validated {len(incoming)} new bars through {previous}; dry run, no write.')
 else:
  temp=path.with_suffix('.tmp');temp.write_text(json.dumps(new,ensure_ascii=False,separators=(',',':')));temp.replace(path)
  print(f'Added {len(incoming)} completed bars through {previous}.')
if __name__=='__main__':main()
