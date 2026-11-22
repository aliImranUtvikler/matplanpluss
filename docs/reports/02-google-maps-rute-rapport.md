# Teknisk Rapport 02: Google Maps & Rute-Agent (Stedsanalyse & Rute-optimalisering)

**Prosjekt:** Smart Ukentlig Vegansk Matplan & Tilbuds-Ruting i Norge  
**Ansvarlig:** Subagent 2 (`Google Maps & Rute-Agent`)  
**Dato:** 15. november 2026  

---

## 1. Google Cloud Platform & Kart-arkitektur

For å gi brukeren en sømløs og nøyaktig navigasjonsopplevelse i det norske dagligvarelandskapet kreves en robust kartarkitektur. Løsningen er bygget med Google Cloud API-er i sentrum, men er samtidig designet med **100 % lokal autonomi (fallback-resiliens)** slik at applikasjonen er lynrask, interaktiv og fullt testbar uten aktive API-nøkler eller under nettverksbortfall.

### 1.1 Nødvendige Google Maps API-er og endepunkter

| Google Cloud API | Endepunkt / Ressurs | Bruk i Matplan-appen | Field Mask / Parametere |
| :--- | :--- | :--- | :--- |
| **Places API (New)** | `POST https://places.googleapis.com/v1/places:searchNearby` | Finn nærliggende fysiske dagligvarebutikker rundt brukerens posisjon | `places.id,places.displayName,places.formattedAddress,places.location,places.currentOpeningHours` |
| **Routes API v2** | `POST https://routes.googleapis.com/directions/v2:computeRoutes` | Beregn faktisk kjøre-, gå- og sykkeltid, distanse og polyline mellom Bruker $\rightarrow$ Stopp 1 $\rightarrow$ Stopp 2 | `routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline` |
| **Geocoding API** | `GET https://maps.googleapis.com/maps/api/geocode/json` | Konverter adresser og nabolagsnavn (f.eks. «Grünerløkka», «Majorstuen») til koordinater (`lat`, `lng`) | `address, region=no, key` |
| **Maps JavaScript API** | `https://maps.googleapis.com/maps/api/js` (Client-side) | Interaktivt kart i nettleseren med tilpassede pins og polyline-opptegning | `libraries=places,geometry` |

### 1.2 Nødvendige miljøvariabler (`.env.local`)

```bash
# Server-side API-nøkkel (brukes i src/services/maps/ for Places, Routes og Geocoding)
# Restriksjoner i Google Cloud Console: IP-begrensning eller API-begrensning (Places, Routes, Geocoding)
GOOGLE_MAPS_API_KEY=AIzaSy...

# Client-side API-nøkkel (brukes i src/components/radar/ for Maps JavaScript API)
# Restriksjoner i Google Cloud Console: HTTP Referrers (f.eks. localhost:3000/*, minmatplan.no/*)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIzaSy...
```

### 1.3 Kostnadsoptimalisering og Field Masks

Google Maps API-er faktureres per forespørsel:
- Ved å benytte **Places API (New)** med streng `X-Goog-FieldMask` (kun `places.id`, `places.displayName`, `places.formattedAddress`, `places.location`), havner forespørslene i Googles laveste prisklasse (*Places Essentials / Basic*), og unngår dyre *Atmosphere / Contact* oppslag.
- **Routes API v2** benytter `polylineQuality: OVERVIEW` og `routingPreference: TRAFFIC_AWARE` kun for bilkjøring, mens gå- og sykkelruter rutes med standard gang-/sykkelnettverk.
- Backend cacher geokoding og butikkoppslag med `Cache-Control: public, s-maxage=60, stale-while-revalidate=120`.

---

## 2. Kjedegjenkjenning og Norsk Butikk-register

### 2.1 Normalisering av Kjedetilhørighet (`detectStoreChain`)

Norske butikker har ofte sammensatte navn i Google Places (f.eks. *«Coop Extra Markveien»*, *«Extra Tøyen Torg»*, *«Rema 1000 Torggata»*, *«Eurospar Torshov»*). Funksjonen `detectStoreChain` i `placesClient.ts` mapper automatisk alle vanlige varianter til våre 7 kjedetyper:

```typescript
export function detectStoreChain(name: string): StoreChain | null {
  const n = name.trim().toLowerCase();
  if (n.includes('rema')) return 'REMA_1000';
  if (n.includes('kiwi')) return 'KIWI';
  if (n.includes('meny')) return 'MENY';
  if (n.includes('extra') || n.includes('coop extra') || n.includes('coop prix') || n.includes('coop mega') || n.includes('coop')) {
    return 'COOP_EXTRA';
  }
  if (n.includes('eurospar') || n.includes('spar')) return 'SPAR';
  if (n.includes('joker')) return 'JOKER';
  if (n.includes('oda')) return 'ODA';
  return null;
}
```

### 2.2 Deterministisk Seed-register og Dynamisk Geogenerator

For at utviklere og brukere kan teste appen uten Google Cloud-fakturering, inneholder `placesClient.ts`:
1. **Kuraterte Oslo-butikker:** 12 verifiserte butikker på Grünerløkka, Vulkan, St. Hanshaugen, Torggata, Tøyen og Torshov med nøyaktige GPS-koordinater.
2. **Dynamisk syntetisk butikkgenerator (`generateSyntheticNearbyStores`):** Dersom brukeren oppgir en posisjon utenfor Oslo (f.eks. Bergen, Trondheim, Stavanger eller Tromsø), genereres et realistisk stjernemønster av butikker 300m til 1400m rundt brukerens posisjon med riktige kjedekonfigurasjoner og gatenavn.

---

## 3. Rute- og Kombi-optimaliseringsalgoritme

Kjernen i `src/services/maps/routeOptimizer.ts` er todelt:

### 3.1 Enkeltbutikk-rangering (`SingleStoreRecommendation`)

For hver butikk $S$ i nærområdet evalueres handlelisten mot butikkens kjedetilbud:
1. Hver ingrediens matches mot butikkens tilbud via `scoreOfferMatchForIngredient`.
2. Høyeste match og rabatt velges.
3. Total besparelse ($S_{tot}$) og antall treff ($C_{hit}$) beregnes.
4. Butikken tildeles en `rankScore`:
   $$\text{rankScore} = (S_{tot} \times 1.6) + (C_{hit} \times 12) - (T_{travel} \times 1.3)$$
   Hvor $T_{travel}$ er reisetiden i minutter. Dette premierer butikker med høy besparelse og full dekningsgrad, samtidig som butikker som krever uforholdsmessig lang reisetid trekkes ned.

### 3.2 2-Stopps Kombi-rute (`ComboRouteRecommendation`)

Når én butikk ikke har alle varene på tilbud, kan en **kombi-rute** mellom to komplementære butikker gi markant høyere besparelse:

1. **Par-evaluering:** Algoritmen tester alle par $(A, B)$ blant topp-kandidatene fra ulike kjeder.
2. **Optimal varefordeling:**
   - Varer som kun er på tilbud i $A$ legges til $A$.
   - Varer som kun er på tilbud i $B$ legges til $B$.
   - Varer som er på tilbud i begge legges til butikken med høyest besparelse / lavest pris.
3. **Rute-rekkefølge:** Algoritmen tester begge reiseretninger:
   $$\text{Rute 1: Bruker} \rightarrow A \rightarrow B \quad \text{vs.} \quad \text{Rute 2: Bruker} \rightarrow B \rightarrow A$$
   Den mest tidseffektive rekkefølgen velges automatisk.
4. **Merverdi- og omvei-beregning:**
   $$\text{additionalSavingsVsSingleStoreNok} = S_{combined} - S_{bestSingle}$$
   $$\text{extraTravelTimeMinutes} = T_{combo} - T_{bestSingle}$$
5. **Adaptiv beslutningsregel for `isRecommended`:**
   $$\text{isRecommended} = (\text{ekstra spart} \ge 15\text{ kr} \land \text{omvei} \le 6\text{ min}) \lor (\text{ekstra spart} \ge 25\text{ kr} \land \text{omvei} \le 12\text{ min})$$
   Dette sikrer at:
   - Hvis to butikker ligger like ved hverandre (f.eks. KIWI Grünerløkka og EXTRA Markveien, 2-3 min omvei), er selv 15 kr ekstra spart verdt et raskt stopp.
   - Hvis omveien er lengre (7-12 min), kreves en betydelig merbesparelse ($\ge 25\text{ kr}$) for at ruten skal anbefales.
   - Dersom merbesparelsen er lav eller omveien for lang, forklares dette pedagogisk for brukeren i `recommendationReason`.

---

## 4. Testresultater med Ukens 41 Tilbud (Uke 46)

Verifisert via testskriptene `scripts/test-routes.ts`, `scripts/test-combo.ts` og `scripts/test-api.ts`:

### Test 1: Standard vegansk handleliste (Tofu, Edamame, Brokkoli, Røde linser)
- **Lokasjon:** Grünerløkka, Oslo (`59.9232, 10.7583`)
- **Modus:** Gange (`WALKING`)
- **Enkeltbutikk-vinner:** **KIWI Grünerløkka**
  - **4 av 4 varer matchet** (Eldorado Fast Tofu til 24.90, Edamame til 27.90, Norsk Brokkoli til 14.90, Eldorado Røde Linser til 19.90).
  - **Total besparelse:** 38,00 kr.
  - **Reisetid:** 1 minutt.
  - **RankScore:** 107.5.
- **Kombi-rute evaluering (KIWI Grünerløkka + REMA 1000 Vulkan):**
  - **Total besparelse i kombi:** 43,00 kr (+5,00 kr vs enkeltbutikk).
  - **Reisetid:** 7 minutter (+6 min omvei).
  - **Resultat:** `isRecommended: false`.
  - **Begrunnelse generert:** *«Kombi-rute gir 5 kr ekstra besparelse, men krever 6 minutter ekstra reisetid. Enkeltbutikk hos KIWI Grünerløkka er mer tidseffektiv.»*

### Test 2: Kombinert luksusliste (Tofu, Edamame, Brokkoli, Tahini, Quinoa, Olivenolje)
- **Enkeltbutikk-vinner:** **EXTRA Markveien** (60 kr spart).
- **Kombi-rute (EXTRA Markveien $\rightarrow$ MENY Ringnes Park):**
  - **Total besparelse i kombi:** 72,00 kr (+12,00 kr vs enkeltbutikk).
  - **Omvei:** +15 minutter.
  - **Resultat:** `isRecommended: false` (algoritmen avviser 15 min gange for kun 12 kr).

### Test 3: API Endepunkt Verifisering (`/api/routes`)
- `GET /api/routes?lat=59.922&lng=10.758&mode=WALKING`: Returnerer HTTP 200 med 12 rangerte butikker, samlet besparelse på 55 kr for demo-listen, og ferdig beregnet kombi-rute med 9 polyline-veipunkter.
- `POST /api/routes` med `travelMode: BICYCLING`: Returnerer HTTP 200 med MENY Ringnes Park som vinner (47 kr spart, 4 min sykkeltid).

---

## 5. Frontend Kartkomponent (`StoreRouteMap.tsx`)

Komponenten er bygget som en moderne React 19 Client Component (`'use client'`) med følgende egenskaper:

1. **Hybrid Rendering:**
   - Dersom `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` er konfigurert, kan Google Maps JS API lastes dynamisk.
   - Samtidig inneholder komponenten et **innebygd, fullt interaktivt SVG/Canvas-kart** i en mørk slate-palett med rutenett, Akerselva-kontur, pulserende posisjonsindikator og animert stiplet rutelinje (`#routeGradient`).
2. **Kjedespesifikk fargekoding:**
   - REMA 1000: Kongeblå (`#2563EB`)
   - KIWI: Frisk smaragdgrønn (`#059669`)
   - MENY: Dyp rød (`#E11D48`)
   - COOP EXTRA: Skarp oransje (`#EA580C`)
   - SPAR: Granrød (`#B91C1C`)
   - JOKER: Cyan/blå (`#0891B2`)
3. **Interaktivitet:**
   - Panorering (dra kartet med musen) og Zoom inn/ut (+, -, reset).
   - Klikkbare butikkmarkører med popup-kort som viser butikkens adresse, reisetid og en liste over alle tilbudsvarer som skal kjøpes der med pris og rabatt.
   - Veksling mellom «Kombi-rute (2 stopp)» og «Enkeltbutikk (Direkte)».
   - Transportmiddel-velger for Gange 🚶, Sykkel 🚲 og Bil 🚗.
4. **Stopp-for-stopp Handleliste:**
   - Viser nøyaktig hvilke varer som plukkes på Stopp 1 og Stopp 2 med avkryssingsbokser og delsummer.

---

## 6. Oppsummering og grensesnitt mot neste moduler

- Alle filer overholder de felles datakontraktene i `src/types/contracts.ts` (`RouteOptimizationRequest`, `RouteOptimizationResponse`, `SingleStoreRecommendation`, `ComboRouteRecommendation`).
- Koden har null eksterne tunge avhengigheter utover eksisterende Next.js, React og Lucide-ikoner.
- API-et er klart for integrasjon med `src/services/mealplan` (Subagent 3) og det overordnede brukergrensesnittet (Subagent 4).
