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
    # indicii CFD Dukascopy (ex. USA500IDXUSD, DEUIDXEUR) au prețuri cu 3 zecimale
    if 'IDX' in pair:
        return 1000.0
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


PACE_S = float(os.environ.get('DK_PACE', '2.5'))  # Dukascopy limitează cererile rapide (503): mergem încet și reîncercăm cu pauze tot mai lungi


def fetch(url, tries=10):
    last = None
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept': '*/*'})
            with urllib.request.urlopen(req, timeout=90) as r:
                data = r.read()
            time.sleep(PACE_S)
            return data
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return b''
            last = f'HTTP {e.code}'
        except Exception as e:
            last = f'{type(e).__name__}: {e}'
        time.sleep(min(300, 10 * 2 ** a))
    raise RuntimeError(f'nu am putut descărca {url} ({last})')


def year_days(pair, year, side):
    start = int(dt.datetime(year, 1, 1, tzinfo=dt.timezone.utc).timestamp())
    url = f'{BASE}/{pair}/{year}/{side}_candles_day_1.bi5'
    return parse_bi5(fetch(url), start, pair)


def day_minutes(pair, y, m0, d, side):
    start = int(dt.datetime(y, m0 + 1, d, tzinfo=dt.timezone.utc).timestamp())
    url = f'{BASE}/{pair}/{y}/{m0:02d}/{d:02d}/{side}_candles_min_1.bi5'
    return parse_bi5(fetch(url), start, pair)


def to_utc_days(rows):
    """Lumânări mai mici (ore/minute) → lumânări zilnice UTC, în același format ca fișierele anuale."""
    days = {}
    for (t, o, h, l, c, v) in sorted(rows):
        k = t - t % 86400
        if k not in days:
            days[k] = [k, o, h, l, c, v]
        else:
            x = days[k]
            x[2] = max(x[2], h); x[3] = min(x[3], l); x[4] = c; x[5] += v
    return {k: tuple(v) for k, v in days.items()}


def current_year_days(pair, side, now):
    """Anul curent nu are încă fișier anual: lunile trecute din fișierele lunare cu ore, luna curentă zi cu zi."""
    rows = []
    for m0 in range(now.month - 1):
        rows += month_hours(pair, now.year, m0, side)
    for d in range(1, now.day):
        rows += day_minutes(pair, now.year, now.month - 1, d, side)
    return to_utc_days(rows)


def download_recent(pair, since_y, since_m0, now=None):
    """Doar lunile recente (pentru actualizarea lunară): lunile încheiate din fișierele cu ore, luna curentă din minute."""
    now = now or dt.datetime.now(dt.timezone.utc)
    out = {}
    for side in ('BID', 'ASK'):
        rows = []
        y, m0 = since_y, since_m0
        while (y, m0) < (now.year, now.month - 1):
            rows += month_hours(pair, y, m0, side)
            m0 += 1
            if m0 == 12:
                y, m0 = y + 1, 0
        for d in range(1, now.day):
            rows += day_minutes(pair, now.year, now.month - 1, d, side)
        out[side] = to_utc_days(rows)
    days = []
    for t in sorted(set(out['BID']) & set(out['ASK'])):
        b, a = out['BID'][t], out['ASK'][t]
        days.append([t, (b[1] + a[1]) / 2, (b[2] + a[2]) / 2, (b[3] + a[3]) / 2, (b[4] + a[4]) / 2, max(0.0, a[4] - b[4])])
    return merge_sundays(days)


def download_daily(pair, y0, y1):
    """Lumânări zilnice Dukascopy (zi UTC), mid = media bid/ask, spread = ask − bid la închidere.
    Fragmentul de duminică seara se lipește de luni (piața Forex se deschide duminică seara)."""
    now = dt.datetime.now(dt.timezone.utc)
    bid, ask = {}, {}
    jobs = [(y, side) for y in range(y0, min(y1, now.year) + 1) for side in ('BID', 'ASK')]
    with cf.ThreadPoolExecutor(max_workers=int(os.environ.get('DK_THREADS', '1'))) as ex:
        futs = {ex.submit(year_days, pair, y, side): side for (y, side) in jobs}
        for f in cf.as_completed(futs):
            store = bid if futs[f] == 'BID' else ask
            for r in f.result():
                store[r[0]] = r
    if y1 >= now.year and os.environ.get('DK_NO_CURRENT') != '1':  # anul curent se poate completa mai rapid din Yahoo
        for side, store in (('BID', bid), ('ASK', ask)):
            for k, r in current_year_days(pair, side, now).items():
                store.setdefault(k, r)
    days = []
    for t in sorted(set(bid) & set(ask)):
        b, a = bid[t], ask[t]
        days.append([t, (b[1] + a[1]) / 2, (b[2] + a[2]) / 2, (b[3] + a[3]) / 2, (b[4] + a[4]) / 2, max(0.0, a[4] - b[4])])
    return merge_sundays(days)


def merge_sundays(days):
    out = []
    pending = None
    for d in days:
        wd = dt.datetime.fromtimestamp(d[0], dt.timezone.utc).weekday()
        if wd == 5:
            continue  # sâmbătă: nu există tranzacționare
        if wd == 6:
            pending = d
            continue
        if pending and d[0] - pending[0] <= 86400:
            d = [d[0], pending[1], max(pending[2], d[2]), min(pending[3], d[3]), d[4], d[5]]
        pending = None
        out.append(d)
    return [(d[0] * 1000, d[1], d[2], d[3], d[4], d[5]) for d in out]


def diagnose(pair='EURUSD'):
    """O singură cerere de probă, raportată ca adnotare GitHub (vizibilă fără log)."""
    url = f'{BASE}/{pair}/2024/BID_candles_day_1.bi5'
    try:
        raw = fetch(url, tries=5)
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


def download_pair(pair, y0, y1, workers=2):
    """Lumânări orare mid (media bid/ask) + spread, pentru toată perioada."""
    now = dt.datetime.now(dt.timezone.utc)
    jobs = []
    for y in range(y0, y1 + 1):
        for m in range(12):
            if dt.datetime(y, m + 1, 1, tzinfo=dt.timezone.utc) > now or (y, m) == (now.year, now.month - 1):
                break  # luna în curs nu are încă fișier orar complet
            jobs.append((y, m))
    bid, ask = {}, {}
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {}
        for (y, m) in jobs:
            futs[ex.submit(month_hours, pair, y, m, 'BID')] = ('BID', y, m)
            futs[ex.submit(month_hours, pair, y, m, 'ASK')] = ('ASK', y, m)
        for f in cf.as_completed(futs):
            side, y, m = futs[f]
            try:
                rows = f.result()
            except Exception as e:  # o lună lipsă nu trebuie să piardă toată bucata
                print(f'::warning::{pair} {y}-{m + 1:02d} {side}: {e}')
                continue
            for r in rows:
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


def read_csv_gz(path):
    rows = []
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        next(f, None)
        for line in f:
            p = line.strip().split(',')
            if len(p) >= 6:
                rows.append((int(p[0]), float(p[1]), float(p[2]), float(p[3]), float(p[4]), float(p[5])))
    return rows


def merge_rows(old, new):
    """Păstrează istoricul vechi până la prima zi nou descărcată, apoi datele noi."""
    if not new:
        return old
    first = new[0][0]
    return [r for r in old if r[0] < first] + list(new)


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
    ap.add_argument('--since', default='', help='YYYY-MM: descarcă doar de la luna aceasta încoace (implică --merge)')
    ap.add_argument('--merge', action='store_true', help='lipește anii descărcați peste fișierul existent (pentru actualizarea lunară)')
    ap.add_argument('--part', action='store_true', help='h1: scrie bucata de ani în h1/PERECHE_ANUL.csv.gz')
    ap.add_argument('--tf', default='d1', choices=['d1', 'h1'], help='d1: un fișier pe an (rapid, recomandat); h1: un fișier pe lună (foarte lent, Dukascopy limitează)')
    a = ap.parse_args(argv)
    pairs = PAIRS if a.all else [p.strip().upper() for p in a.pairs.split(',') if p.strip()]
    ok = 0
    for p in pairs:
        t0 = time.time()
        try:
            if a.tf == 'd1':
                if a.since:
                    sy, sm = (int(x) for x in a.since.split('-'))
                    d1 = download_recent(p, sy, sm - 1)
                    a.merge = True
                    if not d1:
                        print(f'::warning::{p}: nimic nou de la {a.since}')
                        continue
                else:
                    d1 = download_daily(p, a.y0, a.y1)
                if len(d1) < 250 and not a.since:
                    print(f'::error::{p}: prea puține zile ({len(d1)})')
                    continue
                dec = 3 if p.endswith('JPY') else 5
                path = os.path.join(a.out, 'd1', f'{p}.csv.gz')
                if a.merge and os.path.exists(path):
                    d1 = merge_rows(read_csv_gz(path), d1)
                write_csv_gz(path, d1, dec + 1)
                first = dt.datetime.fromtimestamp(d1[0][0] / 1000, dt.timezone.utc).date()
                last = dt.datetime.fromtimestamp(d1[-1][0] / 1000, dt.timezone.utc).date()
                print(f'::notice::{p}: {len(d1)} zile ({first} → {last}) în {time.time() - t0:.0f}s')
                ok += 1
                continue
            hours = download_pair(p, a.y0, a.y1)
            if len(hours) < 1000:
                print(f'{p}: prea puține date ({len(hours)} ore)')
                continue
            dec = 3 if (p.endswith('JPY') or 'IDX' in p) else 5
            # doar lumânările ORARE (pentru cercetarea pe sesiuni); istoricul zilnic rămâne cel din fișierele anuale
            h1 = [[t * 1000, o, h, l, c, max(0.0, sp)] for (t, o, h, l, c, sp) in hours]
            name = f'{p}_{a.y0}.csv.gz' if a.part else f'{p}.csv.gz'  # pe bucăți de ani: fiecare bucată în fișierul ei
            write_csv_gz(os.path.join(a.out, 'h1', name), h1, dec + 1)
            first = dt.datetime.fromtimestamp(hours[0][0], dt.timezone.utc).date()
            last = dt.datetime.fromtimestamp(hours[-1][0], dt.timezone.utc).date()
            print(f'::notice::{p}: {len(hours)} ore ({first} → {last}) în {time.time() - t0:.0f}s')
            ok += 1
        except Exception as e:
            print(f'::error::{p}: {e}')
    print(f'::notice::Gata: {ok}/{len(pairs)} perechi descărcate')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
