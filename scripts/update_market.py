"""Fetch each stock independently. Persist actual trading-day prices; normalize known splits only."""
import argparse,datetime as dt,json,math,re,time,urllib.request,urllib.error
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parents[1]
STOCKS=[('285A.T','market.json'),('4062.T','market-4062.json')]

class HistoryTable(HTMLParser):
 def __init__(self):
  super().__init__();self.tables=[];self.rows=None;self.row=None;self.cell=None;self.title='';self.in_title=False
 def handle_starttag(self,tag,attrs):
  if tag=='title':self.in_title=True
  elif tag=='table':self.rows=[]
  elif tag=='tr' and self.rows is not None:self.row=[]
  elif tag in ('td','th') and self.row is not None:self.cell=''
 def handle_data(self,data):
  if self.in_title:self.title+=data
  if self.cell is not None:self.cell+=data
 def handle_endtag(self,tag):
  if tag=='title':self.in_title=False
  elif tag in ('td','th') and self.cell is not None:self.row.append(self.cell.strip());self.cell=None
  elif tag=='tr' and self.row is not None:self.rows.append(self.row);self.row=None
  elif tag=='table' and self.rows is not None:self.tables.append(self.rows);self.rows=None

def parse_history(html,symbol,end):
 parser=HistoryTable();parser.feed(html)
 assert f'【{symbol.removesuffix(".T")}】' in parser.title,'Unexpected ticker in history page.'
 tables=[t for t in parser.tables if t and t[0][:6]==['日付','始値','高値','安値','終値','出来高']]
 assert len(tables)==1,'Daily history table missing or schema changed.'
 bars=[];seen=set()
 for cells in tables[0][1:]:
  assert cells and re.fullmatch(r'\d{4}/\d{1,2}/\d{1,2}',cells[0]),'Unexpected history row.'
  date=dt.datetime.strptime(cells[0],'%Y/%m/%d').date()
  if date>end:continue
  assert len(cells)>=6,f'Incomplete daily row {date}'
  assert date not in seen,f'Duplicate daily row {date}'
  seen.add(date)
  try:bar=dict(date=date.isoformat(),**{k:float(v.replace(',','')) for k,v in zip(['open','high','low','close','volume'],cells[1:6])})
  except ValueError:raise ValueError(f'Invalid daily row {date}: OHLCV={cells[1:6]}')
  assert all(math.isfinite(bar[k]) and bar[k]>0 for k in ['open','high','low','close','volume']),f'Invalid daily row {date}: OHLCV={cells[1:6]}'
  assert bar['volume'].is_integer(),f'Invalid volume {date}'
  assert bar['low']<=min(bar['open'],bar['close'])<=max(bar['open'],bar['close'])<=bar['high'],f'Invalid OHLC order {date}'
  bars.append(bar)
 assert bars,'No completed daily rows in history page.'
 return sorted(bars,key=lambda b:b['date'])

def fetch_history(symbol,end):
 # The Japanese table explicitly separates actual OHLCV from adjusted close.
 # Never guess a split multiplier from the chart endpoint's mixed-basis rows.
 url=f'https://finance.yahoo.co.jp/quote/{symbol}/history'
 for attempt in range(3):
  try:
   req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Accept':'text/html'})
   with urllib.request.urlopen(req,timeout=30) as response:html=response.read().decode('utf-8')
   return parse_history(html,symbol,end)
  except (urllib.error.URLError,TimeoutError) as error:
   if attempt==2:raise
   print(f'{symbol}: Temporary history request failure ({error}); retry {attempt+1}/2.')
   time.sleep(2*(attempt+1))

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
 bars=fetch_history(symbol,end)
 existing={b['date']:b for b in old['bars']};incoming=[];overlap=0
 for bar in bars:
  if bar['date'] in existing:
   overlap+=1
   assert all(abs(bar[k]-existing[bar['date']][k])<=max(.01,abs(bar[k])*1e-6) for k in ['open','high','low','close']),f'Historical prices changed on {bar["date"]}; manual review required.'
  elif bar['date']>latest['date']:incoming.append(bar)
 assert overlap,'No verified history overlap; manual backfill required.'
 if not incoming:
  assert old['bars'][-1]['date']>=end.isoformat(),f'Latest data {old["bars"][-1]["date"]} is stale; expected {end}. Provider has not supplied the completed bar; retry later.'
  print(f'{symbol}: Already current through {end}; no new completed bars, existing file retained.');return
 incoming.sort(key=lambda b:b['date']);previous=dt.date.fromisoformat(old['bars'][-1]['date'])
 for b in incoming:
  expected=previous+dt.timedelta(days=1)
  while not session(expected):expected+=dt.timedelta(days=1)
  assert b['date']==expected.isoformat(),f'Missing daily bar {expected}'
  prior=existing[previous.isoformat()] if previous.isoformat() in existing else next(x for x in incoming if x['date']==previous.isoformat())
  split=math.prod(x['ratio'] for x in old.get('splits',[]) if previous.isoformat()<x['date']<=b['date'])
  assert .6 < b['close']/(prior['close']/split) < 1.8,f'Unexplained price discontinuity on {b["date"]}; verify split metadata and source.'
  previous=expected
 assert previous==end,f'Latest data {previous} is stale; expected {end}'
 new={**old,'bars':old['bars']+incoming,'updatedAt':now.isoformat(),'latestSource':f'https://finance.yahoo.co.jp/quote/{symbol}/history'}
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
