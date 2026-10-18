# Raport — Departamentul Trend (H4)

Generat: 2026-10-17T17:38:25.478Z · Simboluri: BTCUSD, ETHUSD, BNBUSD, XRPUSD, SOLUSD, ADAUSD, LTCUSD, LINKUSD, DOGEUSD, TRXUSD

## Out-of-sample (walk-forward anual: antrenare 2 ani → test anul următor)

- **Parametri aleși anual de laborator:** 1753 tranzacții | win rate 34.9% | expectancy 0.237R (IC95% 0.138 … 0.343) | profit factor 1.64
- **Parametri fixi din literatură (fără optimizare):** 4286 tranzacții | win rate 35% | expectancy 0.083R (IC95% 0.037 … 0.131) | profit factor 1.21
- **Nivel de validare:** **LIVE**

| An de test | Decizie | Parametri aleși | OOS ales | OOS fix |
|---|---|---|---|---|
| 2020-01-01 → 2020-12-31 | TRANZACȚIONEAZĂ | lookback 10/20/40, stop 3×ATR, long+short | 0.169R (599) | 0.217R (545) |
| 2020-12-31 → 2022-01-01 | TRANZACȚIONEAZĂ | lookback 10/20/40, stop 5×ATR, doar long | 0.705R (193) | 0.199R (634) |
| 2022-01-01 → 2023-01-01 | TRANZACȚIONEAZĂ | lookback 10/20/40, stop 5×ATR, doar long | -0.121R (172) | 0.030R (630) |
| 2023-01-01 → 2024-01-01 | TRANZACȚIONEAZĂ | lookback 40/80/160, stop 5×ATR, doar long | 0.433R (191) | 0.134R (605) |
| 2024-01-01 → 2024-12-31 | TRANZACȚIONEAZĂ | lookback 40/80/160, stop 4×ATR, doar long | 0.416R (250) | 0.048R (669) |
| 2024-12-31 → 2026-01-01 | TRANZACȚIONEAZĂ | lookback 20/40/80, stop 5×ATR, doar long | 0.025R (160) | -0.069R (686) |
| 2026-01-01 → 2026-10-17 | TRANZACȚIONEAZĂ | lookback 40/80/160, stop 4×ATR, doar long | 0.047R (188) | 0.051R (517) |

## Simulare de portofoliu (risc 0.5% / tranzacție, maxim 5% risc deschis, maxim 10 poziții)

- Capital: 10.000 → **51018** (410.18% total, **26.93% pe an**)
- Scădere maximă (drawdown): **18.63%** · Sharpe (lunar, anualizat): 1.04
- Luni pe plus: 42.7% · medie lunară 2.26% · mediană -0.41% · cea mai proastă lună -9.57% · cea mai bună 31.93%
- Pe ani: 2020: 54% · 2021: 67.4% · 2022: -10.6% · 2023: 40.1% · 2024: 51.7% · 2025: -0.3% · 2026: 4.5%

### Monte Carlo — următoarele 12 luni (reeșantionare din lunile out-of-sample)

- Randament: pesimist (5%) **-11.4%** · median **24.2%** · optimist (95%) **94.4%**
- Scădere maximă: mediană 8.4% · rău (95%) **18.9%** · foarte rău (99%) 24%
- Probabilitatea unui an pe minus: **16.1%**

## Configurația propusă (antrenată pe cei mai recenți 2 ani)

```json
{
  "enabled": true,
  "symbols": [
    "BTCUSD",
    "ETHUSD",
    "BNBUSD",
    "XRPUSD",
    "SOLUSD",
    "ADAUSD",
    "LTCUSD",
    "LINKUSD",
    "DOGEUSD",
    "TRXUSD"
  ],
  "params": {
    "lookbacks": [
      40,
      80,
      160
    ],
    "atrMult": 4,
    "entry": 0.6,
    "allowShort": false
  },
  "riskPerTradePct": 0.5,
  "maxOpenRiskPct": 5,
  "maxOpen": 10,
  "liveBars": 700,
  "note": "Se activează doar dacă trece validarea out-of-sample (npm run research:trend -- --apply)."
}
```

## Limitări (citește-le)

- Universul de monede e ales azi (survivorship bias): monedele care au murit între timp nu sunt în test.
- Profit lunar NEUNIFORM: aproximativ jumătate din luni sunt pe minus; profitul vine din câteva luni de trend puternic.
- Fill-uri la închiderea H4 + spread/comision modelate; slippage-ul extrem (crash-uri) poate fi mai mare.
- Performanța trecută nu garantează rezultate viitoare. Începe pe cont demo sau cu risc foarte mic.