# Raport — Departamentul PROP (indici, grafic zilnic, 2 strategii)

Generat: 2026-10-18T11:26:10.423Z · 10 indici · walk-forward anual (antrenare 3 ani → test 1 an) · execuție prudentă: a doua zi la deschidere

## 1. Strategiile (out-of-sample)

| Strategie | Tranzacții | Câștigătoare | R / tranzacție (IC95%) | Ani pe plus | Nivel |
|---|---|---|---|---|---|
| Pullback RSI(2) | 2228 | 64.5% | 0.037 (0.009 … 0.062) | 14/24 | **LIVE** |
| 3 zile de scădere | 1514 | 66.3% | 0.055 (0.025 … 0.085) | 16/24 | **LIVE** |
| **Portofoliu** | 3742 | 65.2% | 0.044 | – | **LIVE** |

Portofoliu la risc 1%/tranzacție (fără reguli prop): 1.21% pe an, scădere maximă 33.85%.

Respinse după testare: Forex (date zilnice nealiniate; pierde cu execuție realistă), IBS (≈0 pe indici), Double Seven (prea slab), sfârșit de lună (≈0 după costuri).

## 2. Șansele la examen (511 date de start, orizont 3 ani, apoi 12 luni pe contul finanțat)

| Firmă | Risc | Trece | Pică | Zile mediane | Trece în ≤6 luni | Trece în ≤1 an | Taxă ~10k | Valoare așteptată |
|---|---|---|---|---|---|---|---|---|
| The5ers High Stakes 2-Step | 4% (siguranță 0.7, max 3 poz.) | **52.4%** | 3.8% | 306 | 12.2% | 31.3% | 95$ | 308$ |
| FundedNext Stellar 2-Step | 4% (siguranță 0.7, max 3 poz.) | **46.7%** | 3.8% | 314 | 9.3% | 27.3% | 99$ | 258$ |
| FTMO 2-Step (Swing) | 4% (siguranță 0.7, max 3 poz.) | **45.2%** | 4.3% | 355 | 6.5% | 24.1% | 170$ | 165$ |
| FTMO 1-Step | 4% (siguranță 0.7, max 3 poz.) | **54.1%** | 4.4% | 374 | 7.6% | 26.3% | 150$ | 146$ |

**Recomandare:** The5ers High Stakes 2-Step, risc 4% pe tranzacție, Gardianul Prop activ.

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
  ]
}
```

Limitări: date zilnice gratuite (Yahoo, de bursă pentru indici); capitalul flotant intraday nu e modelat (Gardianul rezervă riscul complet al pozițiilor deschise); regulile firmelor se schimbă, deci verifică-le înainte de cumpărare. Dacă intri imediat după mesaj (la ~10 minute după închidere), rezultatele sunt de obicei mai bune decât estimarea prudentă de aici.