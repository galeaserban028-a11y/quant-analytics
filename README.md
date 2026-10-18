# APEX QUANT v2: semnale pe indici pentru examene de prop firm, evaluate onest

Fiecare strategie își câștigă locul **doar prin rezultate out-of-sample**, adică pe date pe care nu le-a văzut la optimizare, și cu **execuție prudentă** (intrare a doua zi la deschidere, ca un om care execută dimineața). Nimic nu e „85% win rate” inventat.

## Starea companiei (la 18 octombrie 2026)

| Departament / strategie | Ce face | Validare out-of-sample (execuție prudentă) | Status |
|---|---|---|---|
| **Prop · Pullback RSI(2)** | Cumpără o scădere bruscă (RSI pe 2 zile < 20) într-un indice aflat peste media de 200 de zile; iese peste media de 5 zile | **LIVE**: +0,037R/tranzacție, IC95% [+0,009 … +0,062], 2.228 tranzacții, 2003–2026 | ✅ **ACTIV** |
| **Prop · 3 zile de scădere** | Cumpără după 3 închideri la rând mai mici, peste media de 200 de zile; iese peste media de 5 zile | **LIVE**: +0,055R/tranzacție, IC95% [+0,025 … +0,085], 1.514 tranzacții | ✅ **ACTIV** |
| Forex (orice strategie zilnică) | — | Respins: datele zilnice gratuite au închiderea nealiniată (verificat pe date orare); cu execuție realistă pierde (−0,034R) | ❌ |
| IBS, Double Seven, sfârșit de lună | — | Respinse: ≈0 pe indici sau prea slabe pentru examen | ❌ |
| Trend H4 crypto | Donchian + trailing ATR | LIVE (+0,24R) | ⏹️ Oprit la cererea ta (`userDisabledDesks`) |

Instrumente: **US30, NAS100, SPX500, US2000, GER40, UK100, FRA40, EU50, JP225, AUS200**. Raportul complet: `data/research/RAPORT_PROP.md`.

### Șansele la examen (simulare pe tranzacțiile out-of-sample, cont 10.000 $, execuție prudentă)

| Firmă | Risc ales | Trece | Pică | Timp median | Trece în ≤6 luni | Taxă | Valoare așteptată / încercare* |
|---|---|---|---|---|---|---|---|
| **The5ers High Stakes** (recomandat) | 4%, max 3 poziții | **~52%** | ~3,8% | **~10 luni** | ~12% | ~95 $ | ~+308 $ |
| FundedNext Stellar 2-Step | 4%, max 3 poziții | ~47% | ~3,8% | ~10 luni | ~9% | ~99 $ | ~+258 $ |
| FTMO 2-Step | 4%, max 3 poziții | ~45% | ~4,3% | ~12 luni | ~7% | ~170 $ | ~+165 $ |
| FTMO 1-Step | 4%, max 3 poziții | ~54% | ~4,4% | ~12 luni | ~8% | ~150 $ | ~+146 $ |

\* plățile din primele 12 luni pe contul finanțat × șansa de a trece − taxa. Medie istorică, **nu** promisiune.

Față de versiunea anterioară (Forex + indici, o strategie), măsurat la fel de prudent: trecerea crește de la ~43% la ~52%, timpul median scade de la ~18 la ~10 luni, iar șansa de a trece în 6 luni crește de la ~2,5% la ~12%. Riscul mai mare pe tranzacție NU accelerează examenul (Gardianul împarte bugetul zilnic între poziții), de aceea viteza vine din strategii și instrumente, nu din risc.

**Maximul pe care îl poți pierde este taxa examenului.**

## Funcționare non-stop (GitHub Actions, gratuit)

| Automatizare | Când | Ce face |
|---|---|---|
| **APEX live (Prop indici)** | din 5 în 5 minute | la ~10–15 minute după închiderea fiecărei burse: semnal nou cu **lot exact** și **stop în puncte**, mesaj de închidere, fază trecută, alerte la limite; verificare zilnică la ora 9. Datele se descarcă doar după închideri (și o dată pe oră) |
| **APEX cercetare lunară** | pe 1 ale lunii | re-descarcă istoricul, refă walk-forward-ul fiecărei strategii, re-simulează examenele; oprește strategiile al căror avantaj dispare |
| **APEX date** | manual | descarcă istoricul zilnic pentru instrumente noi |
| **Teste** | la fiecare modificare de cod | rulează toate testele |

Configurare o singură dată, în GitHub → repo → **Settings → Secrets and variables → Actions**:
- secretele `TELEGRAM_TOKEN` (de la @BotFather) și `TELEGRAM_CHAT_ID`;
- opțional, la **Variables**: `PROP_ACCOUNT_SIZE` (implicit 10000), `PROP_FIRM` (`THE5ERS_HIGH_STAKES`, `FUNDEDNEXT_STELLAR_2STEP`, `FTMO_2STEP`, `FTMO_1STEP`), `PROP_BALANCE` (soldul real, dacă diferă de cel estimat), `PROP_PHASE` (1, 2 sau 3 = finanțat). Se aplică doar când le schimbi valoarea.

Starea contului urmărit se salvează în `state/live_state.json`. Pornire manuală: **Actions → APEX live → Run workflow**.

**Important:** sistemul trimite SEMNALE. Tranzacțiile le deschizi și le închizi tu, în platforma firmei (MT5 / cTrader), după mesaje. Intră cât mai repede după mesaj: estimările de mai sus presupun că intri abia a doua zi; dacă intri imediat, de obicei iese mai bine.

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
| `npm run research:prop` | Cercetarea prop (indici, 2 strategii): walk-forward cu execuție prudentă, simularea examenelor la 4 firme, alegerea riscului. `--refresh` re-descarcă istoricul, `--apply` activează departamentul doar dacă trece validarea |
| `npm run research:trend` | Walk-forward pentru Trend. Adaugă `--refresh` ca să re-descarce istoricul de pe Binance și `--apply` ca să activeze departamentul (doar dacă trece validarea) |
| `npm run research` | Laboratorul SMC: tranzacții-umbră, evaluarea fiecărui agent, promovări, walk-forward. `--apply` aplică promovările doar dacă trec validarea |
| `npm run backtest` | Backtest SMC (`--symbols BTCUSD,ETHUSD --days 365 --spread 2`) |
| `npm run backtest:synthetic` | Test de sănătate pe random walk, unde nu trebuie să apară profit |
| `npm test` | ~100 de teste automate |

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

`npm test` rulează 111 teste:
- fiecare agent și filtru;
- formula de scor;
- managementul pozițiilor (pesimist intrabar, gap-uri, parțial la TP1, trailing);
- lipsa look-ahead-ului în backtest și în Trend (verificată modificând „viitorul”);
- **testul de sănătate pe random walk**: pe zgomot pur nu trebuie să apară profit;
- determinismul;
- portofoliul și Monte Carlo;
- guvernanța promovărilor;
- ciclul live Trend: intrare, trailing, ieșire, limită de risc;
- date corupte, persistența stării;
- **departamentul Prop** (35 de teste): laboratorul de strategii (fără look-ahead pentru toate cele 5 strategii, la închidere și a doua zi; rsi2 identic cu Pullback-ul original; execuția întârziată), ora oficială de închidere a fiecărei burse cu ora de vară, descărcarea doar după închidere, două strategii pe același indice, conversia EUR→USD pentru GER40; RSI/SMA, lipsa look-ahead-ului, stop obligatoriu, ieșirea după 10 zile, avantaj ~0 pe random walk; Gardianul verificat pe 20.000 de conturi aleatoare (nu permite niciodată un risc care ar putea sparge limita zilnică sau totală); simulatorul de examen (determinist, independent de ordine, contul finanțat poartă pierderile); loturile pentru EURUSD, USDJPY, GER40, aur; sursele Yahoo/Stooq; ciclul live complet: pornire tăcută, semnal cu lot, ieșire, fază trecută, semnale vechi ignorate, schimbarea sursei de date, persistența.

Am verificat și că testele chiar prind greșelile (*mutation testing*). Am introdus intenționat 4 bug-uri critice: trailing stop care coboară, look-ahead, ordine optimistă intrabar și puncte macro gratis. Toate au fost prinse. Pentru departamentul Prop am sabotat intenționat 12 linii critice (Gardian, loturi, semnale vechi, ieșirea pe timp, stopul, regula lumânării închise etc.): toate cele 12 au fost prinse de teste. Pentru versiunea pe indici am mai sabotat 12 linii: 11 prinse, iar a 12-a e echivalentă (nu schimbă rezultatul).

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
