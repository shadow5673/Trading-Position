"""Offline regression checks for quote freshness and preserving verified history."""
import copy
import datetime as dt
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo
from scripts import update_market as updater


def history_html(bars,symbol='285A.T'):
    header='<tr>'+''.join('<th>'+v+'</th>' for v in ['日付','始値','高値','安値','終値','出来高','調整後終値'])+'</tr>'
    rows=''
    for b in reversed(bars):
        cells=[b['date'].replace('-','/')]+[str(b[k]) for k in ['open','high','low','close','volume']]+['1.23']
        rows+='<tr>'+''.join('<td><span>'+v+'</span></td>' for v in cells)+'</tr>'
    return f'<title>企業【{symbol.removesuffix(".T")}】：株価時系列</title><table>{header}{rows}</table>'


class QuoteUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'data').mkdir()
        self.old_bar = dict(date='2026-09-18', open=100., high=110., low=99., close=105., volume=1000)
        self.new_bar = dict(date='2026-09-24', open=106., high=112., low=104., close=110., volume=2000)
        self.market = self.root/'data/market.json'
        self.market.write_text(json.dumps(dict(symbol='285A.T', bars=[self.old_bar])))
        calendar = dict(start='2026-01-01', end='2026-12-31', holidays=['2026-09-21','2026-09-22','2026-09-23'])
        (self.root/'data/calendar.json').write_text(json.dumps(calendar))
        self.original = self.market.read_bytes()
        self.now = dt.datetime(2026,9,24,18,20,tzinfo=ZoneInfo('Asia/Tokyo'))

    def run_feed(self, bars, now=None, dry_run=False):
        payload=history_html(bars).encode()
        with patch.object(updater,'ROOT',self.root), patch.object(updater.urllib.request,'urlopen',return_value=io.BytesIO(payload)):
            updater.update(now=now or self.now,dry_run=dry_run)

    def test_append_completed_bar_across_holidays_and_idempotent(self):
        self.run_feed([self.old_bar,self.new_bar])
        self.assertEqual(json.loads(self.market.read_text())['bars'],[self.old_bar,self.new_bar])
        saved=self.market.read_bytes()
        self.run_feed([self.old_bar,self.new_bar])
        self.assertEqual(self.market.read_bytes(),saved)

    def test_stale_provider_must_fail_and_preserve_file(self):
        with self.assertRaisesRegex(AssertionError,'stale; expected 2026-09-24'):
            self.run_feed([self.old_bar])
        self.assertEqual(self.market.read_bytes(),self.original)

    def test_current_data_skips_provider_even_on_delayed_weekend_run(self):
        friday={**self.new_bar,'date':'2026-09-25'}
        self.market.write_text(json.dumps(dict(symbol='285A.T',bars=[self.old_bar,self.new_bar,friday])))
        saved=self.market.read_bytes()
        with patch.object(updater,'ROOT',self.root), patch.object(updater.urllib.request,'urlopen',side_effect=OSError('Provider unavailable')) as fetch:
            updater.update(now=self.now.replace(day=25))
            updater.update(now=self.now.replace(day=26,hour=2,minute=35))
        fetch.assert_not_called()
        self.assertEqual(self.market.read_bytes(),saved)

    def test_invalid_stored_current_bar_must_not_report_success(self):
        for fields in [{'close':None},{'high':100.}]:
            with self.subTest(fields=fields):
                self.market.write_text(json.dumps(dict(symbol='285A.T',bars=[self.old_bar,{**self.new_bar,**fields}])))
                saved=self.market.read_bytes()
                with patch.object(updater,'ROOT',self.root), patch.object(updater.urllib.request,'urlopen') as fetch:
                    with self.assertRaisesRegex(AssertionError,'Invalid stored'):
                        updater.update(now=self.now)
                fetch.assert_not_called()
                self.assertEqual(self.market.read_bytes(),saved)

    def test_invalid_new_bar_still_fails_and_preserves_file(self):
        for fields in [{'close':None},{'volume':0}]:
            with self.subTest(fields=fields):
                with self.assertRaisesRegex((AssertionError,ValueError),'Invalid daily row 2026-09-24'):
                    self.run_feed([self.old_bar,{**self.new_bar,**fields}])
                self.assertEqual(self.market.read_bytes(),self.original)

    def test_future_stored_bar_fails_closed(self):
        self.market.write_text(json.dumps(dict(symbol='285A.T',bars=[self.old_bar,self.new_bar])))
        with patch.object(updater,'ROOT',self.root), patch.object(updater.urllib.request,'urlopen') as fetch:
            with self.assertRaisesRegex(AssertionError,'unfinished or future session'):
                updater.update(now=self.now.replace(hour=12))
        fetch.assert_not_called()

    def test_holiday_without_new_bar_is_success(self):
        self.run_feed([self.old_bar],now=self.now.replace(day=23))
        self.assertEqual(self.market.read_bytes(),self.original)

    def test_unfinished_today_bar_is_ignored(self):
        self.run_feed([self.old_bar,self.new_bar],now=self.now.replace(hour=12))
        self.assertEqual(self.market.read_bytes(),self.original)

    def test_changed_history_fails_closed(self):
        changed=copy.deepcopy(self.old_bar);changed['close']=106.
        with self.assertRaisesRegex(AssertionError,'Historical prices changed'):
            self.run_feed([changed,self.new_bar])
        self.assertEqual(self.market.read_bytes(),self.original)

    def test_unexplained_split_adjusted_new_row_rejected(self):
        adjusted={**self.new_bar,**{k:self.new_bar[k]/3 for k in ['open','high','low','close']}}
        with self.assertRaisesRegex(AssertionError,'Unexplained price discontinuity'):
            self.run_feed([self.old_bar,adjusted])
        self.assertEqual(self.market.read_bytes(),self.original)

    def test_gap_in_sessions_fails_closed(self):
        missing=copy.deepcopy(self.new_bar);missing['date']='2026-09-25'
        with self.assertRaisesRegex(AssertionError,'Missing daily bar 2026-09-24'):
            self.run_feed([self.old_bar,missing],now=self.now.replace(day=25))
        self.assertEqual(self.market.read_bytes(),self.original)

    def test_dry_run_validates_without_writing(self):
        self.run_feed([self.old_bar,self.new_bar],dry_run=True)
        self.assertEqual(self.market.read_bytes(),self.original)


if __name__=='__main__':
    unittest.main()

class IndependentStockTests(unittest.TestCase):
    def test_failed_first_stock_still_updates_second(self):
        with patch.object(updater,'update',side_effect=[ValueError('feed failed'),None]) as mock:
            errors=updater.update_all()
        self.assertEqual(len(errors),1)
        self.assertEqual([c.kwargs['symbol'] for c in mock.call_args_list],['285A.T','4062.T'])

    def test_verified_split_accepts_actual_prices_without_false_crash(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'data').mkdir()
            (root/'data/calendar.json').write_text(json.dumps(dict(start='2026-01-01',end='2026-12-31',holidays=[])))
            path=root/'data/market-4062.json'
            old=dict(date='2026-09-28',open=1000,high=1020,low=980,close=1000,volume=100)
            path.write_text(json.dumps(dict(symbol='4062.T',splits=[dict(date='2026-09-29',ratio=2)],bars=[old])))
            fresh=dict(date='2026-09-29',open=500,high=520,low=495,close=510,volume=200)
            with patch.object(updater,'ROOT',root),patch.object(updater.urllib.request,'urlopen',return_value=io.BytesIO(history_html([old,fresh],'4062.T').encode())):
                updater.update(now=dt.datetime(2026,9,29,18,tzinfo=ZoneInfo('Asia/Tokyo')),symbol='4062.T',filename='market-4062.json')
            out=json.loads(path.read_text())
            self.assertEqual(out['bars'][0],old)
            self.assertEqual(out['bars'][1]['close'],510)


class HistoryParserTests(unittest.TestCase):
    def test_raw_columns_preserved_and_adjusted_close_ignored(self):
        bar=dict(date='2026-09-28',open=55990,high=56070,low=53340,close=53340,volume=18399200)
        self.assertEqual(updater.parse_history(history_html([bar]),'285A.T',dt.date(2026,9,28)),[bar])

    def test_wrong_ticker_schema_and_duplicate_rows_rejected(self):
        bar=dict(date='2026-09-28',open=100,high=110,low=90,close=100,volume=1000)
        for html in [history_html([bar],'4062.T'),history_html([bar]).replace('出来高','調整出来高'),history_html([bar,bar])]:
            with self.assertRaises(AssertionError):updater.parse_history(html,'285A.T',dt.date(2026,9,28))

    def test_network_retry_then_valid_response(self):
        bar=dict(date='2026-09-28',open=100,high=110,low=90,close=100,volume=1000)
        with patch.object(updater.urllib.request,'urlopen',side_effect=[updater.urllib.error.URLError('temporary'),io.BytesIO(history_html([bar]).encode())]) as fetch,patch.object(updater.time,'sleep'):
            self.assertEqual(updater.fetch_history('285A.T',dt.date(2026,9,28)),[bar])
        self.assertEqual(fetch.call_count,2)
