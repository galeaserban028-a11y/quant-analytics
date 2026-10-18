# Raport laborator de cercetare — APEX QUANT

Generat: 2026-10-17T17:46:04.143Z · Simboluri: BTCUSD, ETHUSD, SOLUSD, XRPUSD, BNBUSD · Perioadă: 2025-10-07 → 2026-10-17

## Rezultatul care contează: out-of-sample (walk-forward)

- **Compania optimizată:** 189 tranzacții | win rate 39.7% | expectancy -0.091R (IC95% -0.257 … 0.083) | total -17.27R | profit factor 0.85 | max DD 24.53R
- **Configurația de bază (fără optimizare):** 1 tranzacții | win rate 0% | expectancy -1.138R (IC95% – … –) | total -1.14R | profit factor 0 | max DD 1.14R
- **Nivel de validare:** **NIMIC**

> Nicio configurație nu a produs un rezultat pozitiv out-of-sample. Promovările NU se aplică. Nu tranzacționa cu bani reali această strategie.

## Ferestrele walk-forward

| Test | Decizie | Geometrie aleasă | Prag scor | Cost max | Antrenare (E) | OOS | Baseline OOS |
|---|---|---|---|---|---|---|---|
| 2026-02-04 → 2026-04-05 | TRANZACȚIONEAZĂ | stop ≥ 1×ATR, TP2 3R | 40 | 0.12 | 0.102R (73) | -0.013R (50) | –R (0) |
| 2026-04-05 → 2026-06-04 | TRANZACȚIONEAZĂ | stop ≥ 2×ATR, TP2 3R | 25 | 0.12 | 0.083R (120) | -0.076R (35) | –R (0) |
| 2026-06-04 → 2026-08-03 | TRANZACȚIONEAZĂ | stop ≥ 2×ATR, TP2 3R | 40 | 0.12 | 0.093R (123) | -0.159R (40) | -1.138R (1) |
| 2026-08-03 → 2026-10-02 | TRANZACȚIONEAZĂ | stop ≥ 1×ATR, TP2 3R | 40 | 0.25 | 0.182R (84) | -0.154R (55) | –R (0) |
| 2026-10-02 → 2026-10-17 | TRANZACȚIONEAZĂ | stop ≥ 0×ATR, TP2 3R | 40 | 0.12 | 0.141R (85) | 0.098R (9) | –R (0) |

## Organigrama actuală (evaluarea pe cea mai recentă fereastră)

Tranzacții-umbră evaluate: 518 (dintre care 172 ar fi trecut de filtre). Expectancy toate: -0.233R · după filtre: -0.052R.

### Agenți de scor (lift = cât adaugă la R când votează DA)

| Agent | Grad | Lift | IC95% | Voturi DA | E dacă DA | E dacă NU |
|---|---|---|---|---|---|---|
| 3A Liquidity Sweep | DATE_PUTINE | 0.306 | -0.435 … 1.047 | 12 | 0.233 | -0.073 |
| 3B Order Block | DATE_PUTINE | -0.065 | -1.177 … 1.173 | 5 | -0.114 | -0.050 |
| 3C Fair Value Gap | DATE_PUTINE | -0.216 | -1.314 … 0.900 | 2 | -0.265 | -0.049 |
| 3E Premium/Discount | DATE_PUTINE | 0.611 | -1.207 … 2.405 | 2 | 0.552 | -0.059 |
| 3D Displacement | DATE_PUTINE | 0.071 | -0.481 … 0.585 | 144 | -0.040 | -0.111 |
| 1D Macro USD Compass | DATE_PUTINE | – | – … – | 0 | – | -0.052 |
| 5B Devil's Advocate | DATE_PUTINE | 0.022 | -0.586 … 0.597 | 20 | -0.071 | -0.049 |

### Filtre (lift pozitiv = blochează tranzacții mai proaste decât cele lăsate să treacă)

| Filtru | Grad | Lift | IC95% | Blocate | E blocate | E trecute | R economisit |
|---|---|---|---|---|---|---|---|
| 7A Dead-Market & Lockout | DATE_PUTINE | – | – … – | 0 | – | -0.052 | 0.0 |
| 7B Performance Breaker | DATE_PUTINE | – | – … – | 0 | – | -0.052 | 0.0 |
| 7C Regime Filter | STABIL | 0.338 | -0.047 … 0.688 | 55 | -0.390 | -0.052 | 21.4 |
| 1A Spot & Spread Guard 🔒 | DATE_PUTINE | – | – … – | 0 | – | -0.052 | 0.0 |
| 1B Session Killzone | STABIL | -0.181 | -0.621 … 0.207 | 48 | 0.129 | -0.052 | -6.2 |
| 1C News Blocker | DATE_PUTINE | – | – … – | 0 | – | -0.052 | 0.0 |
| 4A Risk Geometry 🔒 | DATE_PUTINE | – | – … – | 0 | – | -0.052 | 0.0 |
| 4B Anti-Chase | STABIL | 0.048 | -0.392 … 0.502 | 39 | -0.100 | -0.052 | 3.9 |
| 4C Correlation Guard 🔒 | DATE_PUTINE | – | – … – | 0 | – | -0.052 | 0.0 |
| 4D Daily Drawdown 🔒 | DATE_PUTINE | – | – … – | 0 | – | -0.052 | 0.0 |
| 4E Cost Guard | PROMOVAT | 0.618 | 0.223 … 1.025 | 64 | -0.670 | -0.052 | 42.9 |

🔒 = filtru protejat (date, geometrie, corelație, drawdown): nu poate fi retrogradat automat.

### Birouri pe instrumente

| Birou | Grad | Tranzacții | Expectancy | IC95% |
|---|---|---|---|---|
| ETHUSD | DATE_PUTINE | 29 | 0.018 | -0.450 … 0.493 |
| BNBUSD | STABIL | 53 | -0.300 | -0.612 … 0.040 |
| SOLUSD | STABIL | 31 | 0.265 | -0.202 … 0.758 |
| XRPUSD | STABIL | 38 | 0.093 | -0.305 … 0.477 |
| BTCUSD | DATE_PUTINE | 21 | -0.252 | -0.797 … 0.315 |

### Mutări propuse de consiliu

Nicio mutare: niciun agent nu a avut o contribuție semnificativ diferită de zero.

### Configurația propusă (antrenată pe cele mai recente date)

```json
{
  "executionPolicy": {
    "minRiskAtr": 0,
    "tp2RiskReward": 3,
    "confluenceThreshold": 40,
    "maxCostToRiskRatio": 0.12
  },
  "scoringWeights": {
    "mtfAlignment": 25,
    "liquiditySweep": 25,
    "orderBlock": 10,
    "fairValueGap": 5,
    "premiumDiscount": 5,
    "displacement": 15,
    "macroCompass": 15,
    "devilsAdvocatePenalty": -25
  },
  "advisoryFilters": [],
  "disabledSymbols": []
}
```

## Cum se citește

- **R** = multiplu al riscului. +1R = ai câștigat cât ai riscat. Costurile (spread + comision) sunt deja scăzute.
- **IC95%** = intervalul în care se află, cu 95% încredere, valoarea reală. Dacă include 0, rezultatul poate fi noroc.
- **Out-of-sample** = perioade pe care selecția parametrilor nu le-a văzut. Doar aceste cifre estimează performanța viitoare.
- Limitări: fără calendar de știri istoric; fill-uri la close; model intrabar pesimist; performanța trecută nu garantează viitorul.