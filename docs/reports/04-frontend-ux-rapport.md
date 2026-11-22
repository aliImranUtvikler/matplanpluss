# Teknisk Rapport 04: Frontend & UX-Agent

**Prosjekt:** Smart Ukentlig Vegansk Matplan & Tilbuds-Ruting i Norge  
**Ansvarlig:** Subagent 4 (`Frontend & UX-Agent`)  
**Felles datakontrakter:** `src/types/contracts.ts`  
**Dato:** 15. november 2026  

---

## 1. Sammendrag & Leveranseoversikt

Subagent 4 har fullført oppdraget med å designe, konfigurere og implementere den helhetlige frontend- og brukeropplevelsen for matplan- og tilbudsrutingssystemet. Applikasjonen er bygget på **Next.js 15 (App Router)** med **React 19**, **Tailwind CSS** og **Lucide React**, fullstendig typesikret i henhold til datakontraktene i `src/types/contracts.ts`.

Løsningen binder sammen alle de tre underliggende backend-tjenestene:
1. **Subagent 1 (Data & Tilbuds-Agent):** 41 bekreftede veganske og peanøttfrie tilbud fra REMA 1000, KIWI, MENY, Coop Extra, Spar, Joker og Oda.
2. **Subagent 2 (Google Maps & Rute-Agent):** Geokoding, avstandsberegning og optimalisering av Enkeltbutikk vs. 2-butikks Kombi-rute med interaktiv kartopptegning.
3. **Subagent 3 (Matplan & Inventar-Agent):** Toveis sanntidssynkronisering av kjøkkenskapet (`inventory.csv` / `inventory.json`) og Gemini 2.5 Flash-generert 5-dagers ukeplan med 40–50g protein per person og maks 750–800 kcal.

---

## 2. Arkitektur og Filstruktur

```
matplan/
├── next.config.mjs               # Next.js 15 konfigurasjon med bildedomener og strict mode
├── tailwind.config.ts            # Skreddersydd fargetema (emerald/slate/brand) og glød-effekter
├── postcss.config.mjs            # PostCSS med Tailwind CSS og Autoprefixer
├── tsconfig.json                 # Path aliases (@/* -> ./src/*) og strikte TypeScript-regler
├── src/
│   ├── app/
│   │   ├── globals.css           # Mørkt nordisk tema, custom scrollbars og basisstil
│   │   ├── layout.tsx            # RootLayout med SEO-metadata og responsiv viewport
│   │   ├── page.tsx              # Hovedapplikasjon: Desktop topp-nav + mobil bunn-nav + live status
│   │   └── api/                  # Eksisterende fullstack API-ruter (inventory, mealplan, offers, routes)
│   ├── components/
│   │   ├── inventory/
│   │   │   └── InventoryView.tsx # Visning 1: Sanntids av/på toggle, filtrering, ernæring, CSV/Sheets import
│   │   ├── mealplan/
│   │   │   └── MealPlanView.tsx  # Visning 2: 5-dagers ukemeny, makrotall, karbobase-tørrvekt, steg-for-steg
│   │   └── radar/
│   │       ├── OffersRadarView.tsx # Visning 3: Rute-radar, transportvelger, interaktiv handleliste, tilbudskatalog
│   │       └── StoreRouteMap.tsx   # Subagent 2s interaktive SVG-kart med zoom/pan og Google Maps-støtte
│   └── types/
│       └── contracts.ts          # Felles datakontrakter på tvers av alle agenter
└── docs/
    └── reports/
        └── 04-frontend-ux-rapport.md # Denne tekniske rapporten
```

---

## 3. Detaljert Beskrivelse av Komponentene

### 3.1 Hovedside og Global Navigasjon (`src/app/page.tsx`)
- **Navigasjonsmodell:**
  - **Desktop (md+):** Elegant, smaragdgrønn topplinje med glassmorphism (`backdrop-blur-md`), tabs for de tre hovedvisningene, og levende nøkkeltall i høyre hjørne.
  - **Mobil (<md):** Fikset native-app bunn-navigasjon med ikoner, merkelapper og visuelle indikatorer for antall varer som skal handles.
- **Live Status-indikatorer i Headeren:**
  - Antall varer på lager i huset: F.eks. `18/41 på lager` (oppdateres umiddelbart ved klikk i inventaret).
  - Snitt protein og kalorier per porsjon i ukeplanen: F.eks. `46g prot • 690 kcal`.
  - Handleliste-teller: Viser nøyaktig hvor mange varer som mangler.
  - Maks estimert besparelse: `Spar opptil 65 kr` beregnet fra tilbudsruten.
- **Global Tilstandssynkronisering:**
  - En felles `refreshGlobalStats()` callback kalles når brukeren endrer inventaret eller genererer en ny ukeplan. Dette sikrer at handlelisten og tallene i headeren alltid er 100 % synkronisert.

---

### 3.2 Visning 1: Inventar & Kjøkkenskap (`src/components/inventory/InventoryView.tsx`)
- **0 ms Latency Optimistisk Toggle:**
  - Når brukeren klikker på et matvarekort, oppdateres UI-tilstanden umiddelbart, mens `PATCH /api/inventory` kalles asynkront i bakgrunnen.
  - Ved eventuelle nettverksfeil rulles tilstanden tilbake automatisk.
- **Multikriterie-filtrering og Søk:**
  - Kategori-faner: `Alle varer`, `Tørrvarer & Belgvekster`, `Kjøl & Tofu`, `Frukt & Grønt`, `Krydder & Sauser`, `Annet`.
  - Lagerstatus-filter: `Alle (41)`, `På lager (18)`, `Mangler (23)`.
  - Sanntids søkefelt med matching mot både råvarenavn og synonymer (`searchKeywords`).
- **Næringsverdier og Badges:**
  - Tydelig visning av `Protein (g)` og `Kcal` per 100g.
  - Fremhevede piller for `Karbobase` (ris, quinoa, potet, pasta) og `Gut Health` (fermenterte råvarer, prebiotika).
- **CSV & Google Sheets Import / Eksport:**
  - **Eksport:** Direkte nedlasting via `GET /api/inventory?format=csv`.
  - **Import-modal:** Støtter både offentlig Google Sheets CSV-lenke og direkte innliming av CSV-tekst mot `POST /api/inventory`.

---

### 3.3 Visning 2: Ukemeny & Oppskrifter (`src/components/mealplan/MealPlanView.tsx`)
- **5-dagers Ukeoversikt (Mandag–Fredag):**
  - Horisontal 5-kort oversikt som viser hele ukens plan med dagsnavn, kjøkken (f.eks. Koreansk, Indisk, Italiensk), tittel, protein og kalorier.
  - Klikk på en dag åpner den fullstendige oppskriften og detaljene.
- **De 7 Ernæringsreglene Synliggjort:**
  - **Proteinmål:** 40–50g protein per person fremhevet med grønn "MÅL NÅDD"-indikator.
  - **Kalorigrense:** Maks 750–800 kcal per person.
  - **Karbohydratbase:** Eksplisitt visning av `carbBase.name` og `dryWeightGramsPerPerson`g tørrvekt (f.eks. Basmatiris 85g tørrvekt/pers).
  - **Allergisikkerhet:** 100 % Vegansk og 100 % Peanøttfritt sikkerhetsstempel, med spesifikasjon av nøttefritt/peanøttfritt alternativ (Tahini, solsikkekjerner, cashewnøtter).
  - **Gut Health:** Antall unike plantepunkter (plant count) og fermenterte boosters (miso, kimchi, eddik).
- **Ingrediensliste med Lagerstatus:**
  - Hver ingrediens har en grønn badge for **"På lager"** eller en oransje badge for **"På handlelisten"**.
  - Mengder skaleres automatisk basert på den integrerte **Porsjonsvelgeren (1, 2, 3, 4 porsjoner)**.
- **AI Ukeplan-generator:**
  - Integrert modal for å generere ny ukeplan via `POST /api/mealplan` med valgfritt egendefinert prompt (f.eks. "Ekstra asiatisk", "Raske 20-minutters retter").

---

### 3.4 Visning 3: Tilbuds-radar & Kart (`src/components/radar/OffersRadarView.tsx`)
- **Kartintegrasjon:**
  - Sømløs integrasjon med `StoreRouteMap.tsx` fra Subagent 2.
  - Viser interaktivt SVG-kart med zoom, panorering, butikkpiller, besparelser og rutelinje.
- **Lokasjon og Reisemodus:**
  - Hurtigknapper for 6 soner: *Grünerløkka*, *Majorstuen*, *Tøyen*, *Sentrum*, *Bergen*, *Trondheim*.
  - Knapp for *Bruk min GPS-posisjon* via `navigator.geolocation`.
  - Modusvelger for *Gange*, *Sykkel* og *Bil*.
- **Enkeltbutikk vs. 2-butikks Kombi-rute:**
  - Presenterer automatisk om kombi-ruten anbefales basert på Subagent 2s algoritme (krever > 35 kr ekstra besparelse og < 12 min ekstra reisetid).
- **Interaktiv Handleliste for Butikkbesøk:**
  - Sjekkbokser som lar brukeren krysse av varer i butikken etter hvert som de legges i handlekurven.
  - Viser tilknyttede tilbud og besparelser per vare.
- **Utforsking av Tilbudskatalogen:**
  - Dedikert fane som lister alle ukens 41 bekreftede tilbud med kjedefiltrering (REMA 1000, KIWI, MENY, Coop Extra, Spar, Joker, Oda) og fritekstsøk.

---

## 4. Verifisering og Typesikkerhet

Hele prosjektet er verifisert med TypeScript-kompilatoren (`tsc --noEmit`):

```bash
$ ./node_modules/typescript/bin/tsc --noEmit
# Resultat: 0 feil, full typesikkerhet over hele prosjektet!
```

### Nøkkeltall for implementasjonen:
- **Kompileringsfeil:** 0
- **TypeScript Strict Mode:** Aktivt
- **Responsivitet:** Testet for mobil (375px+), nettbrett og desktop (1440px+)
- **Norske butikkjeder støttet:** REMA 1000, KIWI, MENY, COOP EXTRA, SPAR, JOKER, ODA
- **Ernæringsoverholdelse:** 100 % i henhold til de 7 ufravikelige reglene

---

## 5. GitHub Pages Statisk Eksport & Dynamisk Makro-kontrollpanel

I samsvar med Orkestrators instruks er følgende forbedringer lagt til:
1. **GitHub Pages Statisk Eksport:**
   - I `next.config.mjs` er `output: process.env.GITHUB_PAGES === 'true' ? 'export' : undefined` og `images: { unoptimized: true }` konfigurert.
   - Alle komponenter har robust fallback: Hvis `/api/...` ikke svarer, leses ferske data automatisk fra `./data/inventory.json`, `./data/default-mealplan.json`, `./data/weekly-offers.json` og `./data/routes-cache.json`.
   - Brukertilstand (inventaravhukinger, oppdaterte ukeplaner, makromål) persisteres i nettleserens `localStorage`.
   - Ruteberegning (`optimizeRoute`) og makroskalering (`scaleMealPlanToMacroTargets`) kjører 100 % autonomt i nettleseren på ren TypeScript!

2. **Dynamisk Makro-kontrollpanel i `MealPlanView.tsx`:**
   - Brukervennlig panel med sliders for Proteinmål (30–70g), Maks Kalorier (550–1100 kcal), Karbobase tørrvekt (50–130g) og Porsjonsvelger (1–4 pers).
   - "Oppdater Makroer & Rekalkuler Rute"-knapp som umiddelbart rekalkulerer ukeplanen, oppdaterer ingrediensmengder og sender den nye handlelisten direkte til `OffersRadarView` og `StoreRouteMap`.

---

## 6. Google SSO, Per-Bruker Database, Tab 4 (Preferanser) & UU/iPhone HIG

I henhold til designspesifikasjonen i `docs/reports/07-uu-ux-iphone-design-spec.md` er applikasjonen gjennomgående modernisert for å eliminere støy og gi en naturtro, universelt utformet iPhone-opplevelse:

1. **Ny Tab 4: `Preferanser & Admin` (`src/components/admin/PreferencesAdminView.tsx`):**
   - Samler all administrativ konfigurasjon vekk fra hverdagsflatene:
     - **Google SSO & Kontoveksler:** Ekte Google Identity Services innlogging + 1-klikks veksler mellom 3 Google-profiler (*Alex Nordmann / Styrke*, *Luna Sterling / Balansert*, *Jonas / Familien Berg / Budsjett*). Hver konto har sitt eget isolerte dashboard i databasen.
     - **Personlige Makromål:** Skalering av protein, kalorier, karbobase og porsjoner lagret i `UserDashboardData`.
     - **Standard Hjemmeadresse & Rute:** Foretrukket lokasjon og reisemodus (Gange, Sykkel, Bil).
     - **Google Sheets & CSV Toveis Synk:** Import og eksport av kjøkkenskapet.
     - **AI Gemini 2.5 Flash:** Egendefinerte instruksjoner og ukeplangenerering.
     - **Kundeaviser:** Statusboks for ukens 70 verifiserte tilbud (2026-W46).

2. **Støyfrie Hovedvisninger i tråd med Apple iOS HIG:**
   - **Ukemeny (`MealPlanView.tsx`):**
     - Personlig hilsen *"Hei [Fornavn] 👋"* + diskret makropille med lenke til Preferanser.
     - Dagens middag i rent heltekort med maks 3 nøkkeltall i blikkfanget (Protein, Kalorier, Tilberedningstid).
     - *Progressive Disclosure:* Ingredienser og kokkesteg ligger i lukkbare trekkspill; primærknappen leder direkte til handlelisten hvis varer mangler.
   - **Handle & Kart (`OffersRadarView.tsx`):**
     - Ruteoppsummering og interaktivt kart (`StoreRouteMap.tsx`) øverst.
     - Handleliste med store, iPhone-vennlige `min-h-[48px]` avkryssingsrader, lagret i brukerens personlige profil.
     - De 70 tilbudene fra kundeavisene ligger pent lukket i et ekspanderbart trekkspill nederst.
   - **Kjøkkenskap (`InventoryView.tsx`):**
     - Lynrask av/på-oversikt med `min-h-[48px]` touch targets, synkronisert mot brukerens `inventoryStockMap`.
     - Safari-sikker `text-base` (16px) på søkefelt for å hindre auto-zoom.

3. **Verifisering:**
   - Full TypeScript typesjekk: `tsc --noEmit` -> **0 feil**.
   - Full produksjonsbygging: `npm run build` -> **0 feil (alle 9 ruter prerendret/kompilert suksessfullt)**.


