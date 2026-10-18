#!/usr/bin/env python3
"""
Descarcă dobânzile de politică monetară (lunar, %) pentru cele 8 monede Forex, de la BIS (Banca Reglementelor
Internaționale, gratuit; FRED nu răspunde de pe serverele GitHub). Rezervă: FRED.
Monede:
USD, EUR, GBP, JPY, AUD, NZD, CAD, CHF. Pentru fiecare monedă încearcă mai multe serii și le lipește (prima are
prioritate; celelalte completează lunile lipsă), apoi scrie data/fx/rates.csv: month,USD,EUR,...

Folosite pentru: (1) costul/câștigul real de swap al pozițiilor ținute peste noapte; (2) familia de strategii „carry”.
"""
import csv
import io
import os
import sys
import time
import urllib.request

SERIES = {
    'USD': ['IR3TIB01USM156N', 'FEDFUNDS', 'TB3MS'],
    'EUR': ['IR3TIB01EZM156N', 'IRSTCI01EZM156N', 'ECBDFR'],
    'GBP': ['IR3TIB01GBM156N', 'IRSTCI01GBM156N', 'IUDSOIA'],
    'JPY': ['IR3TIB01JPM156N', 'IRSTCI01JPM156N'],
    'AUD': ['IR3TIB01AUM156N', 'IRSTCI01AUM156N'],
    'NZD': ['IR3TIB01NZM156N', 'IRSTCI01NZM156N'],
    'CAD': ['IR3TIB01CAM156N', 'IRSTCI01CAM156N'],
    'CHF': ['IR3TIB01CHM156N', 'IRSTCI01CHM156N'],
}
URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id={}'


def fetch(series, tries=4):
    for a in range(tries):
        try:
            req = urllib.request.Request(URL.format(series), headers={'User-Agent': 'Mozilla/5.0 (apex-quant research)'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode('utf-8')
        except Exception as e:
            last = e
            time.sleep(3 * (a + 1))
    print(f'::warning::{series}: {last}')
    return ''


def monthly(text):
    """CSV FRED (DATE,VALUE; zilnic sau lunar) → {YYYY-MM: medie}."""
    sums = {}
    rd = csv.reader(io.StringIO(text))
    next(rd, None)
    for row in rd:
        if len(row) < 2:
            continue
        try:
            v = float(row[1])
        except ValueError:
            continue  # '.' = lipsă
        m = row[0][:7]
        s = sums.setdefault(m, [0.0, 0])
        s[0] += v
        s[1] += 1
    return {m: s[0] / s[1] for m, s in sums.items()}


def splice(series_maps):
    out = {}
    for mp in reversed(series_maps):  # ultimele au prioritate mică: le punem primele și le suprascriem
        out.update(mp)
    return out


BIS_AREA = {'USD': 'US', 'EUR': 'XM', 'GBP': 'GB', 'JPY': 'JP', 'AUD': 'AU', 'NZD': 'NZ', 'CAD': 'CA', 'CHF': 'CH'}
BIS_URL = 'https://stats.bis.org/api/v1/data/WS_CBPOL/M.{}/all?format=csv'


def bis_monthly(text):
    """CSV BIS (coloane TIME_PERIOD, OBS_VALUE) → {YYYY-MM: valoare}."""
    out = {}
    rd = csv.DictReader(io.StringIO(text))
    for row in rd:
        try:
            out[row['TIME_PERIOD'][:7]] = float(row['OBS_VALUE'])
        except (KeyError, ValueError, TypeError):
            continue
    return out


def fetch_url(url, tries=4):
    last = None
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (apex-quant research)'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode('utf-8')
        except Exception as e:
            last = e
            time.sleep(3 * (a + 1))
    print(f'::warning::{url}: {last}')
    return ''


def main(out='data/fx/rates.csv', since='2000-01', use_fred='0'):
    table = {}
    for cur, ids in SERIES.items():
        maps = [bis_monthly(fetch_url(BIS_URL.format(BIS_AREA[cur])))]
        if use_fred == '1':
            maps += [monthly(fetch(s)) for s in ids]
        table[cur] = {m: v for m, v in splice(maps).items() if m >= since}
        months = sorted(table[cur])
        print(f'::notice::{cur}: {len(months)} luni ({months[0] if months else "-"} → {months[-1] if months else "-"})')
    all_months = sorted(set(m for t in table.values() for m in t))
    last = {}
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['month'] + list(SERIES))
        for m in all_months:
            row = [m]
            for cur in SERIES:
                if m in table[cur]:
                    last[cur] = table[cur][m]
                row.append('' if cur not in last else f'{last[cur]:.4f}')  # lunile lipsă: ultima valoare cunoscută
            w.writerow(row)
    print(f'::notice::Scris {out}: {len(all_months)} luni')
    return 0


if __name__ == '__main__':
    sys.exit(main(*(sys.argv[1:])))
