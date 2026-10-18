# APEX QUANT v2: companie de trading algoritmic evaluată onest

Fiecare departament și fiecare agent își câștigă locul **doar prin rezultate out-of-sample**, adică pe date pe care nu le-a văzut la optimizare. Nimic nu e scris de mână, nimic nu e aleatoriu, nimic nu e „85% win rate” inventat.

## Starea companiei (la 17 octombrie 2026)

| Departament | Ce face | Validare out-of-sample | Status |
|---|---|---|---|
| **Trend H4** | Ansamblu Donchian pe H4, 10 monede crypto, trailing stop pe ATR | **LIVE**: +0,237R/tranzacție, IC95% [+0,14 … +0,34], 1.753 tranzacții, 2020–2026 | ✅ **ACTIV** |
| **SMC M15** | Liquidity sweep, order block, FVG, displacement + 11 filtre de risc | **NIMIC**: −0,09R/tranzacție, IC95% [−0,26 … +0,08] | ⏸️ În observație |

Rapoartele complete se află în `data/research/RAPORT_TREND.md` și `data/research/RAPORT_SMC.md`.

### Departamentul Trend în bani (simulare de portofoliu, nu promisiune)

Simulare pe tranzacțiile out-of-sample 2020–2026, cu risc 0,5% pe tranzacție și maximum 5% risc deschis total:

- **~27% pe an**, scădere maximă de capital **18,6%**, Sharpe ~1,0
- Pe ani: 2020 +54% · 2021 +67% · **2022 −11%** · 2023 +40% · 2024 +52% · **2025 −0,3%** · 2026 +4,5% (până în octombrie)
- **Doar ~43% din luni sunt pe plus.** Luna mediană e ușor pe minus. Profitul vine din câteva luni de trend puternic.
- **Cea mai lungă serie de pierderi la rând a fost de 27 de tranzacții.** Dacă oprești sistemul în timpul unei astfel de serii, ratezi exact trendul care o compensează.
- Monte Carlo pe următoarele 12 luni: mediana +24%, 5% șanse de mai rău de −11%, ~16% șanse de an pe minus.

## Funcționare non-stop (GitHub Actions, gratuit)

Sistemul rulează automat pe serverele GitHub, fără să-ți ții calculatorul pornit:

| Automatizare | Când | Ce face |
|---|---|---|
| **APEX live (Trend H4)** | în fiecare oră | verifică cele 10 monede; mesaj pe Telegram la intrare, mutare de stop, ieșire; verificare zilnică la ora 9 |
| **APEX cercetare lunară** | pe 1 ale lunii | re-descarcă istoricul, refă walk-forward-ul; dezactivează departamentul dacă avantajul a dispărut |
| **Teste** | la fiecare modificare de cod | rulează toate testele; GitHub îți trimite email dacă pică ceva |

Ce trebuie configurat o singură dată, în GitHub → repo → **Settings → Secrets and variables → Actions**:
- secretul `TELEGRAM_TOKEN` (de la @BotFather);
- secretul `TELEGRAM_CHAT_ID` (ID-ul tău de Telegram);
- opțional, variabila `ACCOUNT_EQUITY` (capitalul contului, pentru mărimea poziției).

Starea (pozițiile urmărite) se salvează automat în `state/live_state.json`. Pornire manuală: **Actions → APEX live → Run workflow**. Codul vechi e păstrat pe ramura `v1-vechi`.

**Important:** sistemul trimite SEMNALE. Tranzacțiile le deschizi și le închizi tu, pe exchange, după mesaje.

## Pornire rapidă (pe calculator)

Cerințe: **Node.js 18+**. Nu are dependențe externe, deci nu e nevoie de `npm install`.

```bash
npm test                 # toată suita de teste (≈ 1 minut)
npm run demo             # demo offline al pipeline-ului SMC
cp .env.example .env     # (Windows: copy .env.example .env) completează TELEGRAM_TOKEN și TELEGRAM_CHAT_ID
npm run live             # pornește compania (implicit DRY-RUN: mesajele apar doar în consolă)
```

Ca să trimită pe Telegram, pune `LIVE_TELEGRAM=1` în `.env`. Opțional, `ACCOUNT_EQUITY=10000` face ca fiecare semnal să includă și mărimea poziției.

**Recomandare:** rulează 4–8 săptămâni pe cont demo și compară ce primești cu raportul înainte să pui bani reali.

## Comenzi

| Comandă | Ce face |
|---|---|
| `npm run live` | Compania live: Trend H4 (activ) + SMC M15 (doar dacă e validat; `OBSERVE_SMC=1` îl afișează în consolă) |
| `npm run research:trend` | Walk-forward pentru Trend. Adaugă `--refresh` ca să re-descarce istoricul de pe Binance și `--apply` ca să activeze departamentul (doar dacă trece validarea) |
| `npm run research` | Laboratorul SMC: tranzacții-umbră, evaluarea fiecărui agent, promovări, walk-forward. `--apply` aplică promovările doar dacă trec validarea |
| `npm run backtest` | Backtest SMC (`--symbols BTCUSD,ETHUSD --days 365 --spread 2`) |
| `npm run backtest:synthetic` | Test de sănătate pe random walk, unde nu trebuie să apară profit |
| `npm test` | 70+ teste automate |

**Recomandat lunar:** `npm run research:trend -- --refresh --apply`. Re-antrenează departamentul pe cei mai recenți 2 ani și îl dezactivează automat dacă avantajul dispare.

## Cum funcționează „compania”

```
               ┌───────────── Consiliul (laboratorul de cercetare) ─────────────┐
               │  evaluează fiecare agent pe tranzacții-umbră → PROMOVAT /      │
               │  STABIL / RETROGRADAT → validare walk-forward → promotions.json│
               └────────────────────────────────┬───────────────────────────────┘
                                                │ doar ce trece validarea
        ┌───────────────────────────────────────┴──────────────────────────────┐
        ▼                                                                      ▼
 Departamentul TREND (H4)                                       Departamentul SMC (M15)
 Donchian 40/80/160, stop 4×ATR, doar long          Scor: MTF · Sweep · OB · FVG · P/D · Displacement · Macro
 limită: 5% risc deschis, 10 poziții                Filtre: 7A 7B 7C 1A 1B 1C 4A 4B 4C 4D 4E (veto)
        │                                                                      │
        └─────────────────────► Telegram (HTML, dry-run implicit) ◄────────────┘
```

**Tranzacții-umbră.** În backtest, fiecare moment cu setup valid se simulează indiferent de verdict, împreună cu votul fiecărui agent. Așa măsurăm ce câștigă sau pierde compania prin fiecare agent.

**Evaluarea în context.** Un agent e judecat doar pe tranzacțiile pe care compania le-ar fi putut face efectiv. Fără asta, 3B Order Block și 3E Premium/Discount ar fi fost retrogradați pe nedrept: păreau dăunători doar pentru că apăreau des alături de stopuri prea strânse.

**Promovări.**
- Agent de scor promovat: pondere ×1,5.
- Agent de scor retrogradat: pondere 0, trece în departamentul *Observație*, unde e evaluat în continuare.
- Filtru retrogradat: trece în *Consultativ*, unde veto-ul doar se raportează.
- Birou de instrument cu rezultat negativ semnificativ: *suspendat*.
- Filtrele de protecție (1A date/spread, 4A geometrie, 4C corelație, 4D drawdown) **nu pot fi retrogradate automat**.

**Walk-forward.**
1. Antrenare pe o perioadă.
2. Alegerea agenților și a parametrilor.
3. Test pe perioada următoare, nevăzută.
4. Se avansează fereastra și se reia.

Dacă pe antrenare nu există niciun avantaj, compania **stă pe loc** în perioada următoare.

**Niveluri de validare:**
- **LIVE**: intervalul de încredere 95% complet peste 0, cu ≥100 de tranzacții.
- **DEMO**: rezultat pozitiv și peste configurația de bază, cu ≥30 de tranzacții.
- **NIMIC**: nu se aplică nimic.

## Siguranță

- **Telegram e DRY-RUN implicit.** Trimite doar cu `LIVE_TELEGRAM=1`.
- **Fail-closed.** O ramură care dă eroare, date lipsă sau vechi, ori un feed de știri căzut pe FX blochează tranzacția. Niciodată nu o aprobă.
- **Alertă de date.** Dacă Binance e indisponibil ~15 minute, primești un singur mesaj de avertizare și unul la revenire.
- **Starea se salvează atomic** în `data/state_snapshot.json`. Pozițiile mai vechi de 72h sunt eliminate la pornire.
- **Live = backtest.** Starea live a departamentului Trend e reconstruită cu același simulator ca backtest-ul, verificat în teste.

## Testare

`npm test` rulează peste 70 de teste:
- fiecare agent și filtru;
- formula de scor;
- managementul pozițiilor (pesimist intrabar, gap-uri, parțial la TP1, trailing);
- lipsa look-ahead-ului în backtest și în Trend (verificată modificând „viitorul”);
- **testul de sănătate pe random walk**: pe zgomot pur nu trebuie să apară profit;
- determinismul;
- portofoliul și Monte Carlo;
- guvernanța promovărilor;
- ciclul live Trend: intrare, trailing, ieșire, limită de risc;
- date corupte, persistența stării.

Am verificat și că testele chiar prind greșelile (*mutation testing*). Am introdus intenționat 4 bug-uri critice: trailing stop care coboară, look-ahead, ordine optimistă intrabar și puncte macro gratis. Toate au fost prinse.

## Structura proiectului

```
config/agents_config.json     instrumente, costuri, ponderi, filtre, departamente
config/promotions.json        deciziile validate ale consiliului (generat de research --apply)
src/live.js                   compania live
src/trendLive.js              departamentul Trend live
src/strategies/trendDesk.js   simulatorul Trend (folosit și live, și în backtest)
src/orchestrator.js           departamentul SMC: rulează agenții, deschide/gestionează poziții
src/core/                     scoring (formula unică), MarketStateBus, tradeManager, lumânări
src/divisions/                agenții SMC (1A–1D, MTF, 3A–3E, 4A–4E, 5A–5B, 7A–7C)
src/research/                 evaluare agenți, walk-forward, portofoliu, Monte Carlo, rapoarte
src/backtest/                 motorul de backtest, metrici, date sintetice, încărcare CSV
src/data/                     Binance, Swissquote, Yahoo, ForexFactory, indice USD sintetic
data/csv, data/csv_h4         date reale: 1 an M15 (5 monede), 8 ani H4 (10 monede), de pe Binance
data/research/                rapoartele laboratorului
test/                         testele automate
```

## Ce s-a scos din proiectul vechi și de ce

- **`bot.js` trimitea semnale „BUY BTC” aleatorii** (`Math.random() > 0.99`). A fost scos complet.
- **Botul Google Apps Script anunța win rate-uri scrise de mână** („85.5%, 47W/8L”). Backtest-ul lui avea TP mai mic decât SL și alegea cel mai bun din 81 de modele pe 3–10 tranzacții. A fost scos.
- **„300 de agenți”** erau copii identice ale acelorași 26 de funcții. Acum fiecare agent există o singură dată și e evaluat individual.
- **Scripturile de „self-learning”** optimizau și testau pe aceleași date. Au fost înlocuite cu walk-forward.
- **Diviziile 7B/7C din vechiul proiect** nu influențau nimic. Acum 7B e un circuit-breaker pe performanța reală, iar 7C e un filtru de regim. Amândoi sunt evaluați ca orice alt agent.

## Limitări

- Universul crypto e ales azi (*survivorship bias*).
- Nu există calendar de știri istoric în backtest.
- Fill-urile sunt la închiderea lumânării, cu spread și comision modelate. Slippage-ul din crash-uri poate fi mai mare.
- Pentru FX/aur există doar date gratuite pe 60 de zile (Yahoo). Pentru studii lungi, pune CSV-uri în `data/csv/`.
- **Performanța trecută nu garantează rezultate viitoare. Acesta nu este sfat financiar.**
