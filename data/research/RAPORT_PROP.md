# Raport — Departamentul PROP (Forex, aur, indici; grafic zilnic)

Generat: 2026-10-18T10:35:01.030Z · 17 instrumente · walk-forward anual (antrenare 3 ani → test 1 an)

## 1. Are strategia avantaj real? (out-of-sample)

- **2209 tranzacții**, **65.4% câștigătoare**, **0.034R** pe tranzacție (IC95% 0.010 … 0.057), profit factor 1.17
- Nivel de validare: **LIVE**
- Ani de test pozitivi: 18 din 24
- Portofoliu la risc 1%/tranzacție: 2.14% pe an, scădere maximă 30.68%

## 2. Șansele la examen (simulare pe istoria reală, 510 date de start diferite, orizont 3 ani, apoi 12 luni pe contul finanțat)

| Firmă | Risc ales | Trece (interval) | Pică | Neterminat în 3 ani | Zile mediane | Taxă ~10k | Valoare așteptată/încercare |
|---|---|---|---|---|---|---|---|
| The5ers High Stakes 2-Step | 3% (siguranță 0.7) | **46.9%** (39–51%) | 0.2% | 52.9% | 369 | 95$ | 198$ |
| FundedNext Stellar 2-Step | 3% (siguranță 0.8) | **45.2%** (39.6–47.6%) | 2.5% | 52.3% | 348 | 99$ | 192$ |
| FTMO 1-Step | 2.5% (siguranță 0.7) | **49.9%** (44.9–55.7%) | 0.2% | 49.9% | 388 | 150$ | 103$ |
| FTMO 2-Step (Swing) | 3% (siguranță 0.7) | **42.9%** (34.1–47.3%) | 0.2% | 56.9% | 424 | 170$ | 68$ |

**Recomandare:** The5ers High Stakes 2-Step, risc 3% pe tranzacție, cu Gardianul Prop activ.

## 3. Ce înseamnă pe înțeles

- Strategia are un avantaj mic, dar real și stabil. Cele mai bune rezultate le dă pe indici (US30, SPX500, NAS100).
- Gardianul aproape elimină picarea examenului din cauza limitelor. Prețul e viteza: trecerea durează de obicei luni, nu săptămâni.
- Nicio firmă nu are limită de timp pe fazele de examen (FTMO, FundedNext), așa că încetineala nu te costă bani în plus.
- **Taxa examenului e singurul risc**: nu poți pierde mai mult decât ea. Începe pe contul GRATUIT de probă și plătește doar după ce vezi că semnalele merg.

## Configurația propusă

```json
{
  "enabled": true,
  "firm": "THE5ERS_HIGH_STAKES",
  "riskPct": 3,
  "safety": 0.7,
  "maxOpen": 5,
  "params": {
    "trendLen": 200,
    "entryRsi": 5,
    "exitLen": 3,
    "stopAtr": 2,
    "maxDays": 10,
    "allowShort": true
  },
  "symbols": [
    "EURUSD",
    "GBPUSD",
    "AUDUSD",
    "NZDUSD",
    "USDJPY",
    "USDCAD",
    "USDCHF",
    "EURJPY",
    "GBPJPY",
    "AUDJPY",
    "EURGBP",
    "EURCHF",
    "XAUUSD",
    "US30",
    "NAS100",
    "SPX500",
    "GER40"
  ]
}
```

Limitări: date zilnice gratuite (Yahoo); aurul din contracte futures; intrare la închiderea zilei; capitalul flotant intraday nu e modelat (Gardianul rezervă riscul complet al pozițiilor deschise); regulile firmelor se schimbă, deci verifică-le înainte de cumpărare.