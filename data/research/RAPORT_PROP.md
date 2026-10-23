# Raport — Departamentul PROP (indici, grafic zilnic, 4 strategii candidate)

Generat: 2026-10-23T09:16:28.093Z · 8 indici · walk-forward anual (antrenare 3 ani → test 1 an) · execuție prudentă: a doua zi la deschidere

## 1. Strategiile (out-of-sample)

| Strategie | Tranzacții | Câștigătoare | R / tranzacție (IC95%) | Ani pe plus | Nivel |
|---|---|---|---|---|---|
| Pullback RSI(2) | 1618 | 64.7% | 0.047 (0.016 … 0.077) | 15/24 | **LIVE** |
| 3 zile de scădere | 1231 | 66.5% | 0.065 (0.033 … 0.098) | 15/24 | **LIVE** |
| Banda Bollinger | 1350 | 60.9% | 0.091 (0.046 … 0.134) | 16/24 | **LIVE** |
| Minimul de N zile | 1349 | 59.5% | 0.060 (0.017 … 0.105) | 12/24 | **LIVE** |
| **Portofoliu** | 5548 | 62.9% | 0.065 | – | **LIVE** |

Portofoliu la risc 1%/tranzacție (fără reguli prop): 3.48% pe an, scădere maximă 26.92%.

Respinse după testare: Forex (fără avantaj real pe date Dukascopy), IBS (≈0 pe indici), strategiile de trend (momentum, breakout, medii: negative pe indici), sfârșit de lună (≈0 după costuri).

## 2. Șansele la examen (511 date de start, orizont 3 ani, apoi 12 luni pe contul finanțat)

| Firmă | Risc | Trece | Pică + blocat lângă limită (taxa pierdută) | Zile mediane | Trece în ≤6 luni | Trece în ≤1 an | Taxă ~10k | Valoare așteptată |
|---|---|---|---|---|---|---|---|---|
| FundingPips 2-Step | 4% (siguranță 0.8, max 5 poz.) | **41.1%** | 58.7% (9.8% + 48.9%) | 229 | 15.2% | 31.4% | 66$ | 331$ |
| The5ers High Stakes 2-Step | 4% (siguranță 0.8, max 5 poz.) | **41.1%** | 58.7% (9.8% + 48.9%) | 229 | 15.2% | 31.4% | 78$ | 319$ |
| FundedNext Stellar 2-Step | 4% (siguranță 0.8, max 5 poz.) | **41.2%** | 58.5% (10.2% + 48.3%) | 233 | 14.1% | 31.5% | 99$ | 313$ |
| FTMO 2-Step (Swing) | 4% (siguranță 0.8, max 5 poz.) | **38.9%** | 60.6% (11.3% + 49.3%) | 272 | 9.7% | 27.8% | 170$ | 210$ |
| FTMO 1-Step | 4% (siguranță 0.8, max 5 poz.) | **41.4%** | 29.8% (13.4% + 16.4%) | 276 | 10.2% | 28.1% | 150$ | 177$ |

**Recomandare:** The5ers High Stakes 2-Step, risc 4% pe tranzacție, Gardianul Prop activ.

## 3. Echipa (strategie × indice)

| Trader | Strategie | Indice | Status | Tranzacții OOS | Câștigătoare | R / tranzacție | Ani pe plus | Ultimii 5 ani |
|---|---|---|---|---|---|---|---|---|
| Andrei | Pullback RSI(2) | US30 | LUCREAZĂ | 218 | 64.2% | 0.043 | 15/24 | 0.109 (81) |
| Maria | Pullback RSI(2) | NAS100 | LUCREAZĂ | 220 | 63.2% | 0.045 | 14/23 | 0.111 (84) |
| Mihai | Pullback RSI(2) | SPX500 | LUCREAZĂ | 222 | 67.1% | 0.105 | 16/23 | 0.122 (82) |
| Radu | Pullback RSI(2) | GER40 | LUCREAZĂ | 214 | 62.1% | 0.020 | 13/24 | 0.112 (86) |
| Ioana | Pullback RSI(2) | UK100 | BANCĂ | 217 | 69.6% | 0.073 | 13/24 | -0.154 (66) |
| Vlad | Pullback RSI(2) | FRA40 | BANCĂ | 209 | 58.9% | -0.012 | 12/24 | -0.121 (63) |
| Ana | Pullback RSI(2) | EU50 | LUCREAZĂ | 152 | 63.8% | 0.019 | 9/20 | 0.097 (79) |
| Elena | Pullback RSI(2) | US2000 | LUCREAZĂ | 208 | 67.8% | 0.069 | 15/23 | 0.064 (71) |
| Bogdan | 3 zile de scădere | US30 | LUCREAZĂ | 167 | 69.5% | 0.083 | 17/24 | 0.062 (49) |
| Irina | 3 zile de scădere | NAS100 | LUCREAZĂ | 174 | 60.9% | 0.019 | 14/24 | 0.136 (41) |
| Alex | 3 zile de scădere | SPX500 | LUCREAZĂ | 173 | 75.7% | 0.181 | 19/23 | 0.204 (45) |
| Tudor | 3 zile de scădere | GER40 | LUCREAZĂ | 167 | 67.1% | 0.081 | 18/24 | 0.194 (48) |
| Bianca | 3 zile de scădere | UK100 | BANCĂ | 169 | 67.5% | 0.011 | 12/24 | -0.071 (51) |
| Matei | 3 zile de scădere | FRA40 | BANCĂ | 179 | 59.8% | -0.002 | 14/24 | -0.159 (45) |
| Sara | 3 zile de scădere | EU50 | LUCREAZĂ | 126 | 63.5% | 0.045 | 11/19 | 0.024 (46) |
| Raluca | 3 zile de scădere | US2000 | LUCREAZĂ | 158 | 66.5% | 0.059 | 13/24 | 0.072 (36) |
| George | Banda Bollinger | US30 | LUCREAZĂ | 166 | 65.1% | 0.197 | 16/23 | 0.032 (80) |
| Andreea | Banda Bollinger | NAS100 | LUCREAZĂ | 174 | 58% | 0.074 | 13/23 | 0.090 (75) |
| Florin | Banda Bollinger | SPX500 | LUCREAZĂ | 176 | 63.1% | 0.119 | 12/23 | 0.010 (68) |
| Dragoș | Banda Bollinger | GER40 | LUCREAZĂ | 194 | 62.4% | 0.098 | 15/24 | 0.024 (76) |
| Simona | Banda Bollinger | UK100 | LUCREAZĂ | 192 | 62.5% | 0.136 | 19/24 | 0.057 (74) |
| Marius | Banda Bollinger | FRA40 | BANCĂ | 208 | 57.2% | -0.002 | 14/24 | -0.121 (81) |
| Roxana | Banda Bollinger | EU50 | LUCREAZĂ | 147 | 57.8% | 0.067 | 10/18 | 0.119 (80) |
| Alina | Banda Bollinger | US2000 | LUCREAZĂ | 183 | 62.8% | 0.110 | 14/23 | -0.044 (81) |
| Adrian | Minimul de N zile | US30 | LUCREAZĂ | 180 | 59.4% | 0.069 | 13/21 | 0.146 (59) |
| Gabriela | Minimul de N zile | NAS100 | LUCREAZĂ | 198 | 63.1% | 0.117 | 13/20 | 0.117 (57) |
| Lucian | Minimul de N zile | SPX500 | LUCREAZĂ | 194 | 64.4% | 0.145 | 15/20 | 0.171 (55) |
| Cosmin | Minimul de N zile | GER40 | LUCREAZĂ | 203 | 57.6% | 0.017 | 9/21 | 0.068 (55) |
| Monica | Minimul de N zile | UK100 | BANCĂ | 186 | 58.6% | 0.075 | 13/21 | -0.117 (51) |
| Ionuț | Minimul de N zile | FRA40 | LUCREAZĂ | 193 | 51.3% | -0.050 | 8/21 | -0.042 (45) |
| Cristina | Minimul de N zile | EU50 | LUCREAZĂ | 150 | 55.3% | -0.032 | 8/17 | 0.078 (53) |
| Laura | Minimul de N zile | US2000 | LUCREAZĂ | 184 | 60.3% | 0.098 | 13/21 | 0.097 (47) |

Regula băncii (testată walk-forward): un trader care a pierdut peste 0,05R pe tranzacție în ultimii 5 ani (minim 15 tranzacții) stă pe bancă până își revine.

## 4. Scenarii (cont 10.000 $)

- **O lună în examen:** mediană 0 $; 1 lună din 10 sub -526 $, 1 din 10 peste 557 $; 49.4% din luni pe plus; ~3 tranzacții pe lună.
- **O lună pe contul finanțat (înainte de split):** mediană 0 $; 1 din 10 sub -526 $, 1 din 10 peste 552 $; 49.1% din luni pe plus.

| Luna | Încă în faza 1 | În faza 2 | Finanțat | Picat | Încasat cumulat (medie) |
|---|---|---|---|---|---|
| 1 | 97.6% | 1.5% | 0.2% | 0.7% | 0 $ |
| 2 | 88.1% | 10.4% | 0.2% | 1.4% | 0 $ |
| 3 | 78.3% | 18.5% | 1.4% | 1.9% | 0 $ |
| 4 | 70.1% | 22.6% | 5.1% | 2.2% | 4 $ |
| 5 | 64.9% | 23.9% | 8.3% | 2.9% | 11 $ |
| 6 | 58.9% | 27.2% | 10.5% | 3.4% | 19 $ |
| 7 | 54.7% | 28.9% | 12.9% | 3.6% | 28 $ |
| 8 | 51.6% | 28.9% | 15.3% | 4.2% | 40 $ |
| 9 | 48.6% | 28.7% | 18.2% | 4.6% | 54 $ |
| 10 | 45.7% | 28% | 21.4% | 4.9% | 67 $ |
| 11 | 44% | 28.2% | 22.8% | 4.9% | 85 $ |
| 12 | 42.8% | 28.4% | 23.4% | 4.9% | 103 $ |

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
  "expectedR": 0.065
}
```

Limitări: date zilnice gratuite (Yahoo, de bursă pentru indici); capitalul flotant intraday nu e modelat (Gardianul rezervă riscul complet al pozițiilor deschise); regulile firmelor se schimbă, deci verifică-le înainte de cumpărare. Dacă intri imediat după mesaj (la ~10 minute după închidere), rezultatele sunt de obicei mai bune decât estimarea prudentă de aici.