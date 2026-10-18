# Raport — Departamentul PROP (indici, grafic zilnic, 2 strategii)

Generat: 2026-10-18T18:40:52.944Z · 10 indici · walk-forward anual (antrenare 3 ani → test 1 an) · execuție prudentă: a doua zi la deschidere

## 1. Strategiile (out-of-sample)

| Strategie | Tranzacții | Câștigătoare | R / tranzacție (IC95%) | Ani pe plus | Nivel |
|---|---|---|---|---|---|
| Pullback RSI(2) | 2097 | 64.9% | 0.043 (0.016 … 0.070) | 14/24 | **LIVE** |
| 3 zile de scădere | 1375 | 65.9% | 0.055 (0.021 … 0.087) | 15/24 | **LIVE** |
| **Portofoliu** | 3472 | 65.3% | 0.048 | – | **LIVE** |

Portofoliu la risc 1%/tranzacție (fără reguli prop): 1.15% pe an, scădere maximă 33.6%.

Respinse după testare: Forex (date zilnice nealiniate; pierde cu execuție realistă), IBS (≈0 pe indici), Double Seven (prea slab), sfârșit de lună (≈0 după costuri).

## 2. Șansele la examen (511 date de start, orizont 3 ani, apoi 12 luni pe contul finanțat)

| Firmă | Risc | Trece | Pică | Zile mediane | Trece în ≤6 luni | Trece în ≤1 an | Taxă ~10k | Valoare așteptată |
|---|---|---|---|---|---|---|---|---|
| The5ers High Stakes 2-Step | 4% (siguranță 0.7, max 3 poz.) | **54.7%** | 3.2% | 313 | 12.5% | 31.5% | 95$ | 377$ |
| FundedNext Stellar 2-Step | 4% (siguranță 0.7, max 3 poz.) | **54.7%** | 3.2% | 314 | 12% | 31.4% | 99$ | 381$ |
| FTMO 2-Step (Swing) | 4% (siguranță 0.7, max 3 poz.) | **51.8%** | 3.3% | 356 | 7.8% | 26.3% | 170$ | 266$ |
| FTMO 1-Step | 4% (siguranță 0.7, max 3 poz.) | **58.2%** | 4.3% | 406 | 7.2% | 25.4% | 150$ | 248$ |

**Recomandare:** The5ers High Stakes 2-Step, risc 4% pe tranzacție, Gardianul Prop activ.

## 3. Echipa (strategie × indice)

| Trader | Strategie | Indice | Status | Tranzacții OOS | Câștigătoare | R / tranzacție | Ani pe plus | Ultimii 3 ani |
|---|---|---|---|---|---|---|---|---|
| Andrei | Pullback RSI(2) | US30 | LUCREAZĂ | 233 | 65.7% | 0.038 | 15/24 | 0.126 (44) |
| Maria | Pullback RSI(2) | NAS100 | LUCREAZĂ | 233 | 62.7% | 0.036 | 12/23 | 0.056 (48) |
| Mihai | Pullback RSI(2) | SPX500 | LUCREAZĂ | 239 | 67.8% | 0.112 | 16/23 | 0.143 (45) |
| Radu | Pullback RSI(2) | GER40 | LUCREAZĂ | 231 | 61.5% | 0.001 | 13/24 | 0.109 (48) |
| Ioana | Pullback RSI(2) | UK100 | LUCREAZĂ | 232 | 69% | 0.065 | 15/24 | -0.050 (39) |
| Vlad | Pullback RSI(2) | FRA40 | BANCĂ | 228 | 59.6% | -0.018 | 12/24 | -0.141 (32) |
| Ana | Pullback RSI(2) | EU50 | LUCREAZĂ | 174 | 64.4% | 0.021 | 11/20 | 0.072 (45) |
| Cristi | Pullback RSI(2) | JP225 | LUCREAZĂ | 204 | 63.7% | 0.037 | 14/24 | 0.157 (38) |
| Diana | Pullback RSI(2) | AUS200 | BANCĂ | 234 | 60.3% | -0.022 | 13/24 | -0.069 (41) |
| Elena | Pullback RSI(2) | US2000 | LUCREAZĂ | 223 | 69.1% | 0.082 | 18/23 | 0.115 (46) |
| Bogdan | 3 zile de scădere | US30 | LUCREAZĂ | 158 | 69% | 0.074 | 17/24 | -0.019 (26) |
| Irina | 3 zile de scădere | NAS100 | LUCREAZĂ | 161 | 62.1% | 0.034 | 12/24 | 0.030 (21) |
| Alex | 3 zile de scădere | SPX500 | LUCREAZĂ | 157 | 76.4% | 0.190 | 18/24 | 0.274 (27) |
| Tudor | 3 zile de scădere | GER40 | LUCREAZĂ | 150 | 66.7% | 0.084 | 18/24 | 0.177 (31) |
| Bianca | 3 zile de scădere | UK100 | BANCĂ | 155 | 68.4% | 0.020 | 14/24 | -0.130 (29) |
| Matei | 3 zile de scădere | FRA40 | BANCĂ | 165 | 56.4% | -0.021 | 14/24 | -0.198 (24) |
| Sara | 3 zile de scădere | EU50 | LUCREAZĂ | 118 | 62.7% | 0.047 | 12/19 | 0.033 (26) |
| Ștefan | 3 zile de scădere | JP225 | LUCREAZĂ | 138 | 67.4% | 0.036 | 13/23 | 0.193 (22) |
| Larisa | 3 zile de scădere | AUS200 | LUCREAZĂ | 165 | 68.5% | 0.017 | 16/24 | -0.042 (28) |
| Raluca | 3 zile de scădere | US2000 | LUCREAZĂ | 147 | 65.3% | 0.069 | 13/24 | 0.150 (23) |

Regula băncii (testată walk-forward): un trader care a pierdut peste 0,05R pe tranzacție în ultimii 3 ani (minim 10 tranzacții) stă pe bancă până își revine. Efect mic, dar constant: trecere puțin mai mare, picare puțin mai mică.

## 4. Scenarii (cont 10.000 $)

- **O lună în examen:** mediană 0 $; 1 lună din 10 sub -425 $, 1 din 10 peste 477 $; 47.4% din luni pe plus; ~3 tranzacții pe lună.
- **O lună pe contul finanțat (înainte de split):** mediană 0 $; 1 din 10 sub -425 $, 1 din 10 peste 466 $; 47.3% din luni pe plus.

| Luna | Încă în faza 1 | În faza 2 | Finanțat | Picat | Încasat cumulat (medie) |
|---|---|---|---|---|---|
| 1 | 97.8% | 1.5% | 0% | 0.7% | 0 $ |
| 2 | 91.2% | 7.3% | 0.5% | 1% | 0 $ |
| 3 | 84.2% | 12.4% | 1.9% | 1.5% | 0 $ |
| 4 | 75.7% | 18.5% | 4.1% | 1.7% | 3 $ |
| 5 | 67.9% | 23.9% | 6.1% | 2% | 9 $ |
| 6 | 61.5% | 26.7% | 9.7% | 2.2% | 17 $ |
| 7 | 57.4% | 26.5% | 13.8% | 2.4% | 27 $ |
| 8 | 54% | 25.3% | 18% | 2.7% | 44 $ |
| 9 | 50.4% | 26.5% | 20.2% | 2.9% | 63 $ |
| 10 | 47.2% | 28% | 21.9% | 2.9% | 85 $ |
| 11 | 43.6% | 29.2% | 24.1% | 2.9% | 102 $ |
| 12 | 40.6% | 29.4% | 26.8% | 2.9% | 120 $ |

## Configurația propusă

```json
{
  "enabled": true,
  "firm": "THE5ERS_HIGH_STAKES",
  "riskPct": 4,
  "safety": 0.7,
  "maxOpen": 3,
  "strategies": [
    {
      "kind": "rsi2",
      "name": "Pullback RSI(2)",
      "params": {
        "kind": "rsi2",
        "trendLen": 200,
        "entryRsi": 20,
        "exitLen": 5,
        "stopAtr": 2,
        "maxDays": 10,
        "allowShort": false
      }
    },
    {
      "kind": "down",
      "name": "3 zile de scădere",
      "params": {
        "kind": "down",
        "trendLen": 200,
        "nDays": 3,
        "exitLen": 5,
        "stopAtr": 2,
        "maxDays": 10,
        "allowShort": false
      }
    }
  ],
  "symbols": [
    "US30",
    "NAS100",
    "SPX500",
    "GER40",
    "UK100",
    "FRA40",
    "EU50",
    "JP225",
    "AUS200",
    "US2000"
  ],
  "benched": [
    "FRA40|rsi2",
    "AUS200|rsi2",
    "UK100|down",
    "FRA40|down"
  ]
}
```

Limitări: date zilnice gratuite (Yahoo, de bursă pentru indici); capitalul flotant intraday nu e modelat (Gardianul rezervă riscul complet al pozițiilor deschise); regulile firmelor se schimbă, deci verifică-le înainte de cumpărare. Dacă intri imediat după mesaj (la ~10 minute după închidere), rezultatele sunt de obicei mai bune decât estimarea prudentă de aici.