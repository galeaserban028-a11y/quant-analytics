#!/usr/bin/env python3
"""
Completează istoricul Forex (data/fx/dk/d1/*.csv.gz) cu zilele recente din lumânările ORARE Yahoo, grupate pe
zile UTC — exact cum le construiește sistemul live (src/fxLive.js). Rapid (o cerere pe pereche), folosit pentru
anul curent, pe care Dukascopy îl publică abia la final de an.

  python3 scripts/yahoo_recent.py --pairs EURUSD,GBPUSD --since 2026-01-01
  python3 scripts/yahoo_recent.py --all --since 2026-01-01
"""
import argparse
import datetime as dt
import gzip
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dukascopy as dk  # noqa: E402

URL = 'https://query1.finance.yahoo.com/v8/finance/chart/{}=X?interval=1h&range=730d'


def fetch_hours(pair, tries=4):
    for a in range(tries):
        try:
            req = urllib.request.Request(URL.format(pair), headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=60) as r:
                d = json.loads(r.read().decode('utf-8'))
            res = d['chart']['result'][0]
            q = res['indicators']['quote'][0]
            out = []
            for i, t in enumerate(res['timestamp']):
                o, h, l, c = q['open'][i], q['high'][i], q['low'][i], q['close'][i]
                if None in (o, h, l, c) or l <= 0 or h < max(o, c) or l > min(o, c):
                    continue
                out.append((t, o, h, l, c))
            return out
        except Exception as e:
            last = e
            time.sleep(3 * (a + 1))
    raise RuntimeError(f'{pair}: {last}')


def hours_to_days(hours, now_s):
    """Zile UTC: sâmbăta dispare, duminica seara se lipește de luni, ziua în curs nu intră, minim 12 ore."""
    by = {}
    for (t, o, h, l, c) in sorted(hours):
        by.setdefault(t - t % 86400, []).append((t, o, h, l, c))
    today = now_s - now_s % 86400
    days, sunday = [], None
    for d in sorted(by):
        if d >= today:
            continue
        hs = by[d]
        bar = [d, hs[0][1], max(x[2] for x in hs), min(x[3] for x in hs), hs[-1][4], len(hs)]
        wd = dt.datetime.fromtimestamp(d, dt.timezone.utc).weekday()
        if wd == 5:
            continue
        if wd == 6:
            sunday = bar
            continue
        if sunday and d - sunday[0] <= 86400:
            bar = [d, sunday[1], max(sunday[2], bar[2]), min(sunday[3], bar[3]), bar[4], bar[5] + sunday[5]]
        sunday = None
        if bar[5] >= 12:
            days.append((d * 1000, bar[1], bar[2], bar[3], bar[4], 0.0))
    return days


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--pairs', default='')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--since', default='2026-01-01')
    ap.add_argument('--out', default='data/fx/dk')
    a = ap.parse_args(argv)
    pairs = dk.PAIRS if a.all else [p.strip().upper() for p in a.pairs.split(',') if p.strip()]
    since_ms = int(dt.datetime.fromisoformat(a.since).replace(tzinfo=dt.timezone.utc).timestamp()) * 1000
    now_s = int(time.time())
    ok = 0
    for p in pairs:
        path = os.path.join(a.out, 'd1', f'{p}.csv.gz')
        if not os.path.exists(path):
            print(f'::warning::{p}: lipsește istoricul Dukascopy, sar peste')
            continue
        try:
            old = dk.read_csv_gz(path)
            last_dk = max([r[0] for r in old if r[5] > 0] or [0])  # ultima zi Dukascopy reală (cu spread)
            start = max(since_ms, last_dk + 86400000)
            new = [r for r in hours_to_days(fetch_hours(p), now_s) if r[0] >= start]
            merged = [r for r in old if r[0] < start] + new
            dk.write_csv_gz(path, merged, (3 if p.endswith('JPY') else 5) + 1)
            print(f'::notice::{p}: +{len(new)} zile din Yahoo (de la {dt.datetime.utcfromtimestamp(start / 1000).date()})')
            ok += 1
        except Exception as e:
            print(f'::error::{p}: {e}')
    print(f'::notice::Gata: {ok}/{len(pairs)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
