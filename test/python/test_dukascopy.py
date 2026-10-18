"""Teste pentru descărcătorul Dukascopy (fără internet): formatul .bi5, ziua Forex de la 17:00 New York, agregarea."""
import sys, lzma, struct, datetime as dt
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts'))
import dukascopy as d
# 1) parser: două lumânări EURUSD
start = int(dt.datetime(2024, 3, 1, tzinfo=dt.timezone.utc).timestamp())
raw = b''.join(struct.pack('>iiiiif', t, o, c, l, h, 1.0) for (t, o, c, l, h) in [(0, 108000, 108050, 107950, 108100), (3600, 108050, 108020, 108000, 108080)])
rows = d.parse_bi5(lzma.compress(raw, format=lzma.FORMAT_ALONE), start, 'EURUSD')
assert rows[0] == (start, 1.08, 1.081, 1.0795, 1.0805, 1.0), rows[0]
assert rows[1][0] == start + 3600
assert d.parse_bi5(b'', start, 'EURUSD') == []
assert abs(d.parse_bi5(lzma.compress(struct.pack('>iiiiif', 0, 150123, 150200, 150000, 150300, 0), format=lzma.FORMAT_ALONE), start, 'USDJPY')[0][1] - 150.123) < 1e-9
# 2) ziua Forex: închidere 17:00 NY (vara 21:00 UTC, iarna 22:00 UTC)
ts = lambda y, m, dd, h: int(dt.datetime(y, m, dd, h, tzinfo=dt.timezone.utc).timestamp())
assert d.fx_day_key(ts(2024, 7, 15, 20)) == dt.date(2024, 7, 15)   # 16:00 NY → luni
assert d.fx_day_key(ts(2024, 7, 15, 21)) == dt.date(2024, 7, 16)   # 17:00 NY → marți
assert d.fx_day_key(ts(2024, 1, 15, 21)) == dt.date(2024, 1, 15)   # iarna 16:00 NY
assert d.fx_day_key(ts(2024, 7, 14, 22)) == dt.date(2024, 7, 15)   # duminică seara → luni
assert d.session_close_utc(dt.date(2024, 7, 15)) == ts(2024, 7, 15, 21)
assert d.session_close_utc(dt.date(2024, 1, 15)) == ts(2024, 1, 15, 22)
# 3) agregare: o săptămână de ore sintetice
hours = []
t = ts(2024, 7, 14, 21)  # duminică 17:00 NY
while t < ts(2024, 7, 19, 21):
    hours.append((t, 1.0, 1.01, 0.99, 1.0 + (t % 7) / 1000, 0.0001))
    t += 3600
dd = d.to_daily(hours)
assert len(dd) == 5, len(dd)   # luni..vineri
assert dd[0][0] == (ts(2024, 7, 15, 21) - 86400) * 1000   # timestamp + 24h = închiderea de luni
assert all(r[2] >= max(r[1], r[4]) and r[3] <= min(r[1], r[4]) for r in dd)
h4 = d.to_h4(hours)
assert len(h4) == 30, len(h4)
# 4) zilele Dukascopy (UTC): duminica se lipește de luni, sâmbăta dispare
day = lambda y, m, dd_: int(dt.datetime(y, m, dd_, tzinfo=dt.timezone.utc).timestamp())
raw_days = [[day(2024, 7, 13), 1, 1, 1, 1, 0], [day(2024, 7, 14), 1.0, 1.02, 0.995, 1.01, 0.0001], [day(2024, 7, 15), 1.01, 1.015, 0.99, 1.012, 0.0001], [day(2024, 7, 16), 1.012, 1.02, 1.0, 1.018, 0.0001]]
m = d.merge_sundays(raw_days)
assert len(m) == 2, m
assert m[0][0] == day(2024, 7, 15) * 1000 and m[0][1] == 1.0 and m[0][2] == 1.02 and m[0][3] == 0.99 and m[0][4] == 1.012
# 5) actualizarea lunară: istoricul vechi + anii noi
old = [(1, 1, 1, 1, 1, 0), (2, 1, 1, 1, 1, 0), (3, 1, 1, 1, 1, 0)]
new = [(3, 2, 2, 2, 2, 0), (4, 2, 2, 2, 2, 0)]
assert d.merge_rows(old, new) == [(1, 1, 1, 1, 1, 0), (2, 1, 1, 1, 1, 0), (3, 2, 2, 2, 2, 0), (4, 2, 2, 2, 2, 0)]
assert d.merge_rows(old, []) == old
# 6) ore/minute → zile UTC
base = day(2026, 10, 14)
rows = [(base + 3600 * h, 1.0 + h / 100, 1.01 + h / 100, 0.99 + h / 100, 1.005 + h / 100, 1.0) for h in range(24)] + [(base + 86400, 2, 2, 2, 2, 1.0)]
u = d.to_utc_days(rows)
assert sorted(u) == [base, base + 86400]
assert u[base][1] == 1.0 and u[base][4] == 1.005 + 23 / 100 and u[base][2] == 1.01 + 23 / 100 and u[base][3] == 0.99
print('OK parser, zile Forex, agregare, duminici, actualizare, an curent', len(dd), len(h4))

# 7) dobânzile FRED: medie lunară din serii zilnice, lipirea seriilor
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts'))
import rates as rt
m = rt.monthly('DATE,VAL\n2024-01-02,5.0\n2024-01-03,5.5\n2024-02-01,.\n2024-02-02,4.0\n')
assert m == {'2024-01': 5.25, '2024-02': 4.0}, m
assert rt.splice([{'2024-01': 1.0}, {'2024-01': 9.0, '2024-02': 2.0}]) == {'2024-01': 1.0, '2024-02': 2.0}
print('OK dobânzi')
