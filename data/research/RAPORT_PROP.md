# Raport — Departamentul PROP (indici, grafic zilnic, 4 strategii candidate)

Generat: 2026-11-01T10:16:14.700Z · 8 indici · walk-forward anual (antrenare 3 ani → test 1 an) · execuție prudentă: a doua zi la deschidere

## 1. Strategiile (out-of-sample)

| Strategie | Tranzacții | Câștigătoare | R / tranzacție (IC95%) | Ani pe plus | Nivel |
|---|---|---|---|---|---|
| Pullback RSI(2) | 1566 | 65.1% | 0.054 (0.022 … 0.085) | 15/24 | **LIVE** |
| 3 zile de scădere | 1231 | 66.5% | 0.065 (0.033 … 0.098) | 15/24 | **LIVE** |
| Banda Bollinger | 1355 | 61% | 0.092 (0.048 … 0.139) | 16/24 | **LIVE** |
| Minimul de N zile | 1352 | 59.5% | 0.060 (0.017 … 0.106) | 12/24 | **LIVE** |
| **Portofoliu** | 5504 | 63% | 0.067 | – | **LIVE** |

Portofoliu la risc 1%/tranzacție (fără reguli prop): 3.49% pe an, scădere maximă 26.92%.

Respinse după testare: Forex (fără avantaj real pe date Dukascopy), IBS (≈0 pe indici), strategiile de trend (momentum, breakout, medii: negative pe indici), sfârșit de lună (≈0 după costuri).

## 2. Șansele la examen (511 date de start, orizont 3 ani, apoi 12 luni pe contul finanțat)

| Firmă | Risc | Trece | Pică + blocat lângă limită (taxa pierdută) | Zile mediane | Trece în ≤6 luni | Trece în ≤1 an | Taxă ~10k | Valoare așteptată |
|---|---|---|---|---|---|---|---|---|
| FundingPips 2-Step | 4% (siguranță 0.8, max 5 poz.) | **39.4%** | 60.4% (8.5% + 51.9%) | 230 | 14.3% | 29.7% | 66$ | 273$ |
| The5ers High Stakes 2-Step | 4% (siguranță 0.8, max 5 poz.) | **39.4%** | 60.4% (8.5% + 51.9%) | 230 | 14.3% | 29.7% | 78$ | 261$ |
| FundedNext Stellar 2-Step | 4% (siguranță 0.8, max 5 poz.) | **39.6%** | 60.1% (8.8% + 51.4%) | 234 | 13.3% | 29.9% | 99$ | 264$ |
| FTMO 2-Step (Swing) | 4% (siguranță 0.8, max 5 poz.) | **37.1%** | 62.3% (9.8% + 52.5%) | 278 | 8.9% | 25.5% | 170$ | 148$ |
| FTMO 1-Step | 4% (siguranță 0.8, max 5 poz.) | **40.2%** | 27.9% (10.4% + 17.6%) | 283 | 8.8% | 26.5% | 150$ | 133$ |

**Recomandare:** The5ers High Stakes 2-Step, risc 4% pe tranzacție, Gardianul Prop activ.

## 3. Echipa (strategie × indice)

| Trader | Strategie | Indice | Status | Tranzacții OOS | Câștigătoare | R / tranzacție | Ani pe plus | Ultimii 5 ani |
|---|---|---|---|---|---|---|---|---|
| Andrei | Pullback RSI(2) | US30 | LUCREAZĂ | 211 | 64.9% | 0.056 | 16/24 | 0.109 (81) |
| Maria | Pullback RSI(2) | NAS100 | LUCREAZĂ | 210 | 63.3% | 0.054 | 14/23 | 0.122 (85) |
| Mihai | Pullback RSI(2) | SPX500 | LUCREAZĂ | 217 | 68.2% | 0.114 | 17/23 | 0.135 (83) |
| Radu | Pullback RSI(2) | GER40 | LUCREAZĂ | 207 | 62.3% | 0.023 | 13/24 | 0.112 (86) |
| Ioana | Pullback RSI(2) | UK100 | BANCĂ | 208 | 70.2% | 0.088 | 14/24 | -0.133 (66) |
| Vlad | Pullback RSI(2) | FRA40 | BANCĂ | 204 | 58.3% | -0.018 | 12/24 | -0.121 (63) |
| Ana | Pullback RSI(2) | EU50 | LUCREAZĂ | 151 | 64.9% | 0.029 | 9/20 | 0.100 (80) |
| Elena | Pullback RSI(2) | US2000 | LUCREAZĂ | 201 | 68.2% | 0.076 | 16/23 | 0.065 (71) |
| Bogdan | 3 zile de scădere | US30 | LUCREAZĂ | 167 | 69.5% | 0.083 | 17/24 | 0.062 (49) |
| Irina | 3 zile de scădere | NAS100 | LUCREAZĂ | 174 | 60.3% | 0.013 | 14/24 | 0.139 (41) |
| Alex | 3 zile de scădere | SPX500 | LUCREAZĂ | 173 | 76.3% | 0.184 | 19/23 | 0.217 (45) |
| Tudor | 3 zile de scădere | GER40 | LUCREAZĂ | 167 | 67.1% | 0.081 | 18/24 | 0.194 (48) |
| Bianca | 3 zile de scădere | UK100 | BANCĂ | 169 | 67.5% | 0.011 | 12/24 | -0.071 (51) |
| Matei | 3 zile de scădere | FRA40 | BANCĂ | 179 | 59.8% | -0.002 | 14/24 | -0.159 (45) |
| Sara | 3 zile de scădere | EU50 | LUCREAZĂ | 126 | 63.5% | 0.045 | 11/19 | 0.024 (46) |
| Raluca | 3 zile de scădere | US2000 | LUCREAZĂ | 158 | 66.5% | 0.059 | 13/24 | 0.072 (36) |
| George | Banda Bollinger | US30 | LUCREAZĂ | 166 | 65.1% | 0.197 | 16/23 | 0.041 (77) |
| Andreea | Banda Bollinger | NAS100 | LUCREAZĂ | 174 | 58% | 0.075 | 13/23 | 0.081 (73) |
| Florin | Banda Bollinger | SPX500 | LUCREAZĂ | 178 | 62.9% | 0.121 | 12/23 | 0.012 (68) |
| Dragoș | Banda Bollinger | GER40 | LUCREAZĂ | 194 | 62.4% | 0.098 | 15/24 | 0.057 (73) |
| Simona | Banda Bollinger | UK100 | LUCREAZĂ | 192 | 62.5% | 0.136 | 19/24 | 0.041 (73) |
| Marius | Banda Bollinger | FRA40 | BANCĂ | 209 | 57.4% | 0.001 | 14/24 | -0.121 (80) |
| Roxana | Banda Bollinger | EU50 | LUCREAZĂ | 149 | 58.4% | 0.072 | 10/18 | 0.124 (80) |
| Alina | Banda Bollinger | US2000 | LUCREAZĂ | 183 | 62.8% | 0.111 | 14/23 | -0.026 (78) |
| Adrian | Minimul de N zile | US30 | LUCREAZĂ | 180 | 59.4% | 0.069 | 13/21 | 0.146 (59) |
| Gabriela | Minimul de N zile | NAS100 | LUCREAZĂ | 199 | 62.8% | 0.111 | 12/20 | 0.097 (58) |
| Lucian | Minimul de N zile | SPX500 | LUCREAZĂ | 194 | 64.4% | 0.144 | 15/20 | 0.167 (55) |
| Cosmin | Minimul de N zile | GER40 | LUCREAZĂ | 204 | 57.8% | 0.019 | 10/21 | 0.076 (56) |
| Monica | Minimul de N zile | UK100 | BANCĂ | 187 | 58.8% | 0.075 | 13/21 | -0.095 (51) |
| Ionuț | Minimul de N zile | FRA40 | LUCREAZĂ | 193 | 51.3% | -0.050 | 8/21 | -0.042 (45) |
| Cristina | Minimul de N zile | EU50 | LUCREAZĂ | 151 | 55.6% | -0.030 | 8/17 | 0.082 (54) |
| Laura | Minimul de N zile | US2000 | LUCREAZĂ | 184 | 60.3% | 0.101 | 13/21 | 0.108 (47) |

Regula băncii (testată walk-forward): un trader care a pierdut peste 0,05R pe tranzacție în ultimii 5 ani (minim 15 tranzacții) stă pe bancă până își revine.

## 4. Scenarii (cont 10.000 $)

- **O lună în examen:** mediană 0 $; 1 lună din 10 sub -525 $, 1 din 10 peste 551 $; 49.8% din luni pe plus; ~3 tranzacții pe lună.
- **O lună pe contul finanțat (înainte de split):** mediană 0 $; 1 din 10 sub -525 $, 1 din 10 peste 540 $; 49.5% din luni pe plus.

| Luna | Încă în faza 1 | În faza 2 | Finanțat | Picat | Încasat cumulat (medie) |
|---|---|---|---|---|---|
| 1 | 97.5% | 1.7% | 0.2% | 0.7% | 0 $ |
| 2 | 88.5% | 10% | 0.2% | 1.4% | 0 $ |
| 3 | 78.5% | 18.3% | 1.4% | 1.9% | 0 $ |
| 4 | 70.5% | 22.2% | 5.1% | 2.2% | 4 $ |
| 5 | 65.1% | 23.7% | 8.3% | 2.9% | 11 $ |
| 6 | 59.3% | 26.8% | 10.5% | 3.4% | 20 $ |
| 7 | 55.1% | 28.5% | 12.9% | 3.6% | 30 $ |
| 8 | 52% | 28.5% | 15.3% | 4.2% | 42 $ |
| 9 | 49% | 28.3% | 18.1% | 4.6% | 57 $ |
| 10 | 46.1% | 27.6% | 21.4% | 4.9% | 70 $ |
| 11 | 44.4% | 28% | 22.5% | 4.9% | 86 $ |
| 12 | 43.2% | 28% | 23.4% | 4.9% | 105 $ |

## Configurația propusă

```json
{
  "enabled": true,
  "firm": "THE5ERS_HIGH_STAKES",
  "riskPct": 4,
  "safety": 0.8,
  "maxOpen": 5,
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
        "allowShort": false,
        "tpR": 1.5
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
        "allowShort": false,
        "tpR": 1.5
      }
    },
    {
      "kind": "bb",
      "name": "Banda Bollinger",
      "params": {
        "kind": "bb",
        "len": 10,
        "k": 1.5,
        "trendLen": 0,
        "stopAtr": 2,
        "maxDays": 10,
        "allowShort": false,
        "tpR": 1.5
      }
    },
    {
      "kind": "d7",
      "name": "Minimul de N zile",
      "params": {
        "kind": "d7",
        "trendLen": 200,
        "lookback": 7,
        "stopAtr": 3,
        "maxDays": 15,
        "allowShort": false,
        "tpR": 1.5
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
    "US2000"
  ],
  "benched": [
    "UK100|rsi2",
    "FRA40|rsi2",
    "UK100|down",
    "FRA40|down",
    "FRA40|bb",
    "UK100|d7"
  ],
  "expectedR": 0.067
}
```

Limitări: date zilnice gratuite (Yahoo, de bursă pentru indici); capitalul flotant intraday nu e modelat (Gardianul rezervă riscul complet al pozițiilor deschise); regulile firmelor se schimbă, deci verifică-le înainte de cumpărare. Dacă intri imediat după mesaj (la ~10 minute după închidere), rezultatele sunt de obicei mai bune decât estimarea prudentă de aici.