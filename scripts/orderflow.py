#!/usr/bin/env python3
"""
ORDER FLOW GRATUIT, din două surse, agregat pe lumânări de 1 minut:

1. Dukascopy (tick-uri bid/ask, fără cont): pentru indici/aur/forex. NU există partea agresorului (sunt cotații CFD),
   așa că folosim regula tick-ului: fiecare urcare a prețului mediu = presiune de cumpărare, fiecare coborâre = de vânzare.
   Rezultă un DELTA APROXIMATIV (up − down) și numărul de tick-uri (activitate). Doar orele sesiunii New York (13–21 UTC).
   Format .bi5 tick: 20 de octeți big-endian: ms de la începutul orei (u32), ask (u32), bid (u32), vol ask (f32), vol bid (f32).

2. Binance futures (aggTrades publice, fără cont): ORDER FLOW REAL, cu partea agresorului (is_buyer_maker),
   pentru BTCUSDT. Delta = volum cumpărat agresiv − volum vândut agresiv. Folosit ca test al metodei pe date adevărate.

Ieșire: data/orderflow/{SURSĂ}_{SIMBOL}_{AAAA}_{LL}.csv.gz cu t,o,h,l,c,ticks,buy,sell
"""
import argparse
import calendar
import csv
import datetime as dt
import gzip
import io
import lzma
import os
import struct
import sys
import urllib.request
import zipfile

sys.path.insert(0, os.path.dirname(__file__))
from dukascopy import BASE, fetch, scale  # noqa: E402

TICK = struct.Struct('>IIIff')


def dk_month(pair, y, m):
    k = scale(pair)
    bars = {}
    ndays = calendar.monthrange(y, m)[1]
    for d in range(1, ndays + 1):
        if dt.date(y, m, d).weekday() >= 5:
            continue
        for hh in range(13, 21):
            raw = fetch(f'{BASE}/{pair}/{y}/{m - 1:02d}/{d:02d}/{hh:02d}h_ticks.bi5')
            if not raw:
                continue
            data = lzma.decompress(raw, format=lzma.FORMAT_ALONE)
            h0 = int(dt.datetime(y, m, d, hh, tzinfo=dt.timezone.utc).timestamp() * 1000)
            prev = None
            for i in range(0, len(data) - TICK.size + 1, TICK.size):
                ms, ask, bid, _, _ = TICK.unpack_from(data, i)
                if ask <= 0 or bid <= 0:
                    continue
                mid = (ask + bid) / 2 / k
                t = h0 + ms
                key = t - t % 60000
                b = bars.get(key)
                if b is None:
                    b = bars[key] = [mid, mid, mid, mid, 0, 0.0, 0.0]
                b[1] = max(b[1], mid); b[2] = min(b[2], mid); b[3] = mid; b[4] += 1
                if prev is not None:
                    if mid > prev:
                        b[5] += 1
                    elif mid < prev:
                        b[6] += 1
                prev = mid
        print(f'{pair} {y}-{m:02d}-{d:02d}: {len(bars)} minute', flush=True)
    return bars


def binance_month(sym, y, m):
    url = f'https://data.binance.vision/data/futures/um/monthly/aggTrades/{sym}/{sym}-aggTrades-{y}-{m:02d}.zip'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=600) as r:
        z = zipfile.ZipFile(io.BytesIO(r.read()))
    bars = {}
    with z.open(z.namelist()[0]) as f:
        for row in csv.reader(io.TextIOWrapper(f)):
            if not row or not row[0][0].isdigit():
                continue  # antet
            px, qty, t, maker = float(row[1]), float(row[2]), int(row[5]), row[6].strip().lower() == 'true'
            key = t - t % 60000
            b = bars.get(key)
            if b is None:
                b = bars[key] = [px, px, px, px, 0, 0.0, 0.0]
            b[1] = max(b[1], px); b[2] = min(b[2], px); b[3] = px; b[4] += 1
            if maker:
                b[6] += qty  # cumpărătorul a fost maker ⇒ vânzătorul a lovit (vânzare agresivă)
            else:
                b[5] += qty
    return bars


def write(path, bars):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, 'wt') as f:
        f.write('t,o,h,l,c,ticks,buy,sell\n')
        for t in sorted(bars):
            o, h, lo, c, n, bu, se = bars[t]
            f.write(f'{t},{o:.5f},{h:.5f},{lo:.5f},{c:.5f},{n},{bu:.4f},{se:.4f}\n')
    print('scris', path, len(bars))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', choices=['dk', 'binance'], required=True)
    ap.add_argument('--sym', required=True)
    ap.add_argument('--month', required=True, help='AAAA-LL')
    ap.add_argument('--out', default='data/orderflow')
    a = ap.parse_args()
    y, m = map(int, a.month.split('-'))
    bars = dk_month(a.sym, y, m) if a.src == 'dk' else binance_month(a.sym, y, m)
    write(f'{a.out}/{a.src}_{a.sym}_{y}_{m:02d}.csv.gz', bars)
