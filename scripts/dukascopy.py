#!/usr/bin/env python3
"""
Descarcă istoricul Forex de la Dukascopy (gratuit, prețuri bid/ask reale) și îl transformă în lumânări
zilnice (închidere la 17:00 New York, convenția pieței Forex) și H4, cu spread-ul mediu pe fiecare lumânare.

Fără biblioteci externe: Dukascopy livrează fișiere .bi5 comprimate LZMA, pe care Python le decomprimă nativ.
Rulat pe GitHub Actions (workflow „APEX date Forex”), pentru că mediul de cercetare nu are acces la internet.

  python3 scripts/dukascopy.py --pairs EURUSD,GBPUSD --from 2003 --out data/fx/dk
  python3 scripts/dukascopy.py --all --from 2003 --out data/fx/dk

Format .bi5 pentru lumânări (24 de octeți pe înregistrare, big-endian):
  int32 secunde de la începutul perioadei, int32 open, int32 close, int32 low, int32 high, float32 volum
Prețurile sunt întregi: se împart la 1000 pentru perechile cu JPY și la 100000 pentru restul.
Fișierele cu lumânări orare sunt lunare: /datafeed/EURUSD/2020/00/BID_candles_hour_1.bi5 (luna numerotată de la 0).
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import gzip
import lzma
import os
import struct
import sys
import time
import urllib.request
from zoneinfo import ZoneInfo

BASE = 'https://datafeed.dukascopy.com/datafeed'
NY = ZoneInfo('America/New_York')
PAIRS = ['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD', 'USDJPY', 'USDCAD', 'USDCHF', 'EURJPY', 'GBPJPY', 'AUDJPY', 'EURGBP', 'EURCHF',
         'EURAUD', 'EURCAD', 'EURNZD', 'GBPAUD', 'GBPCAD', 'GBPCHF', 'GBPNZD', 'AUDCAD', 'AUDNZD', 'AUDCHF', 'NZDJPY', 'CADJPY', 'CHFJPY', 'NZDCAD']
REC = struct.Struct('>iiiiif')


def scale(pair):
    return 1000.0 if pair.endswith('JPY') else 100000.0


def parse_bi5(raw, period_start_s, pair):
    """Decomprimă și citește lumânările; întoarce [(ts_secunde_utc, o, h, l, c)]."""
    if not raw:
        return []
    data = lzma.decompress(raw, format=lzma.FORMAT_ALONE)
    k = scale(pair)
    out = []
    for i in range(0, len(data) - REC.size + 1, REC.size):
        t, o, c, lo, hi, v = REC.unpack_from(data, i)
        if o <= 0 or c <= 0 or lo <= 0 or hi <= 0:
            continue
        out.append((period_start_s + t, o / k, hi / k, lo / k, c / k, v))
    return out


def fetch(url, tries=4):
    last = None
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept': '*/*'})
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return b''
            last = f'HTTP {e.code}'
        except Exception as e:
            last = f'{type(e).__name__}: {e}'
        time.sleep(1.0 * (a + 1))
    raise RuntimeError(f'nu am putut descărca {url} ({last})')


def diagnose(pair='EURUSD'):
    """O singură cerere de probă, raportată ca adnotare GitHub (vizibilă fără log)."""
    url = f'{BASE}/{pair}/2024/00/BID_candles_hour_1.bi5'
    try:
        raw = fetch(url, tries=2)
        rows = parse_bi5(raw, int(dt.datetime(2024, 1, 1, tzinfo=dt.timezone.utc).timestamp()), pair)
        print(f'::notice::Dukascopy test {url}: {len(raw)} octeți, {len(rows)} lumânări, prima {rows[0] if rows else None}')
        return True
    except Exception as e:
        print(f'::error::Dukascopy test {url}: {e}')
        return False


def month_hours(pair, year, month0, side):
    start = int(dt.datetime(year, month0 + 1, 1, tzinfo=dt.timezone.utc).timestamp())
    url = f'{BASE}/{pair}/{year}/{month0:02d}/{side}_candles_hour_1.bi5'
    return parse_bi5(fetch(url), start, pair)


def download_pair(pair, y0, y1, workers=8):
    """Lumânări orare mid (media bid/ask) + spread, pentru toată perioada."""
    now = dt.datetime.now(dt.timezone.utc)
    jobs = []
    for y in range(y0, y1 + 1):
        for m in range(12):
            if dt.datetime(y, m + 1, 1, tzinfo=dt.timezone.utc) > now:
                break
            jobs.append((y, m))
    bid, ask = {}, {}
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {}
        for (y, m) in jobs:
            futs[ex.submit(month_hours, pair, y, m, 'BID')] = ('BID', y, m)
            futs[ex.submit(month_hours, pair, y, m, 'ASK')] = ('ASK', y, m)
        for f in cf.as_completed(futs):
            side, y, m = futs[f]
            for r in f.result():
                (bid if side == 'BID' else ask)[r[0]] = r
    hours = []
    for t in sorted(set(bid) & set(ask)):
        b, a = bid[t], ask[t]
        hours.append((t, (b[1] + a[1]) / 2, (b[2] + a[2]) / 2, (b[3] + a[3]) / 2, (b[4] + a[4]) / 2, a[4] - b[4]))
    return hours


def fx_day_key(t):
    """Ziua de tranzacționare Forex: se închide la 17:00 New York. Ora t aparține zilei care se închide la următorul 17:00 NY."""
    local = dt.datetime.fromtimestamp(t, NY)
    d = local.date()
    if local.hour >= 17:
        d = d + dt.timedelta(days=1)
    return d


def session_close_utc(d):
    """Momentul UTC la care se închide ziua Forex d (17:00 New York)."""
    return int(dt.datetime(d.year, d.month, d.day, 17, 0, tzinfo=NY).timestamp())


def aggregate(hours, bucket):
    """Grupează orele după cheia `bucket(t)`; timestamp-ul lumânării = începutul ei (prima oră)."""
    bars, cur, key = [], None, None
    for (t, o, h, l, c, sp) in hours:
        k = bucket(t)
        if k != key:
            if cur:
                bars.append(cur)
            key = k
            cur = [t, o, h, l, c, sp, 1]
        else:
            cur[2] = max(cur[2], h)
            cur[3] = min(cur[3], l)
            cur[4] = c
            cur[5] += sp
            cur[6] += 1
    if cur:
        bars.append(cur)
    return bars


def to_daily(hours):
    bars = aggregate(hours, fx_day_key)
    out = []
    for b in bars:
        d = fx_day_key(b[0])
        if d.weekday() >= 5 or b[6] < 12:  # sâmbăta/duminica (fragmentul de duminică seara intră în luni) sau zile incomplete
            continue
        out.append((session_close_utc(d) * 1000 - 24 * 3600 * 1000, b[1], b[2], b[3], b[4], b[5] / b[6]))
    return out


def to_h4(hours):
    # blocuri de 4 ore aliniate la închiderea de la 17:00 New York (17, 21, 01, 05, 09, 13)
    def bucket(t):
        local = dt.datetime.fromtimestamp(t, NY)
        return (fx_day_key(t), ((local.hour - 17) % 24) // 4)
    bars = aggregate(hours, bucket)
    return [(b[0] * 1000, b[1], b[2], b[3], b[4], b[5] / b[6]) for b in bars if b[6] >= 2]


def write_csv_gz(path, rows, decimals):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fmt = f'{{:.{decimals}f}}'
    with gzip.open(path, 'wt', encoding='utf-8') as f:
        f.write('timestamp,open,high,low,close,spread\n')
        for r in rows:
            f.write(f'{r[0]},{fmt.format(r[1])},{fmt.format(r[2])},{fmt.format(r[3])},{fmt.format(r[4])},{fmt.format(r[5])}\n')


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--pairs', default='')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--from', dest='y0', type=int, default=2003)
    ap.add_argument('--to', dest='y1', type=int, default=dt.datetime.now(dt.timezone.utc).year)
    ap.add_argument('--out', default='data/fx/dk')
    a = ap.parse_args(argv)
    pairs = PAIRS if a.all else [p.strip().upper() for p in a.pairs.split(',') if p.strip()]
    if not diagnose(pairs[0] if pairs else 'EURUSD'):
        return 1
    ok = 0
    for p in pairs:
        t0 = time.time()
        try:
            hours = download_pair(p, a.y0, a.y1)
            if len(hours) < 1000:
                print(f'{p}: prea puține date ({len(hours)} ore)')
                continue
            dec = 3 if p.endswith('JPY') else 5
            d1, h4 = to_daily(hours), to_h4(hours)
            write_csv_gz(os.path.join(a.out, 'd1', f'{p}.csv.gz'), d1, dec + 1)
            write_csv_gz(os.path.join(a.out, 'h4', f'{p}.csv.gz'), h4, dec + 1)
            first = dt.datetime.fromtimestamp(hours[0][0], dt.timezone.utc).date()
            last = dt.datetime.fromtimestamp(hours[-1][0], dt.timezone.utc).date()
            print(f'::notice::{p}: {len(hours)} ore → {len(d1)} zile, {len(h4)} lumânări H4 ({first} → {last}) în {time.time() - t0:.0f}s')
            ok += 1
        except Exception as e:
            print(f'::error::{p}: {e}')
    print(f'::notice::Gata: {ok}/{len(pairs)} perechi descărcate')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
