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

    def run_feed(self, bars, now=None, splits=False, dry_run=False):
        root = dict(meta={'symbol':'285A.T'}, timestamp=[int(dt.datetime.fromisoformat(b['date']).replace(tzinfo=ZoneInfo('Asia/Tokyo'),hour=9).timestamp()) for b in bars], indicators={'quote':[{k:[b[k] for b in bars] for k in ['open','high','low','close','volume']}]})
        if splits:
            root['events']={'splits':{'x':{'numerator':2,'denominator':1}}}
        payload = json.dumps({'chart':{'result':[root]}}).encode()
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

    def test_holiday_without_new_bar_is_success(self):
        self.run_feed([self.old_bar],now=self.now.replace(day=23))
        self.assertEqual(self.market.read_bytes(),self.original)

    def test_unfinished_today_bar_is_ignored(self):
        self.run_feed([self.old_bar,self.new_bar],now=self.now.replace(hour=12))
        self.assertEqual(self.market.read_bytes(),self.original)

    def test_changed_history_and_splits_fail_closed(self):
        changed=copy.deepcopy(self.old_bar);changed['close']=106.
        with self.assertRaisesRegex(AssertionError,'Historical prices changed'):
            self.run_feed([changed,self.new_bar])
        with self.assertRaisesRegex(ValueError,'Split detected'):
            self.run_feed([self.old_bar,self.new_bar],splits=True)
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
