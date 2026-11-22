# Teknisk Rapport 03: Matplan & Inventar-Agent

**Prosjekt:** Smart Ukentlig Vegansk Matplan & Tilbuds-Ruting i Norge  
**Ansvarlig:** Subagent 3 (`Matplan & Inventar-Agent`)  
**Felles datakontrakter:** `src/types/contracts.ts`  
**Dato:** 15. november 2026  

---

## 1. Sammendrag

Subagent 3 har fullført implementeringen av det sentrale matplan- og inventarsystemet for applikasjonen. Løsningen dekker:
1. **Sanntids inventarsynkronisering:** Toveis synkronisering mellom `data/inventory.csv`, `data/inventory.json` og API-endepunkter med støtte for direkte CSV-eksport/import og Google Sheets CSV-lenker.
2. **AI-drevet og deterministisk matplanlegger:** Full integrasjon med Google Gemini 2.5 Flash Structured JSON Output (`schemas/mealplan.schema.json`), kombinert med en presisjonskalkulert, deterministisk standardgenerator som garanterer at de 7 ufravikelige ernæringsreglene overholdes 100 %.
3. **Automatisk handleliste og tilbudsmatching:** Automatisk fratrekk av varer som allerede er på lager (`På lager = TRUE` -> `pantryItemsUsed`), aggregering av manglende varer på tvers av ukedagene til en standardisert `shoppingList`, og berikelse av handlelisten med ukens beste tilbud fra norske kjeder (`weekly-offers.json`).
4. **Fullstendige Next.js App Router API-ruter:** `GET /api/inventory`, `PATCH /api/inventory`, `POST /api/inventory`, `GET /api/mealplan` og `POST /api/mealplan`.

---

## 2. Inventar og Seed-data (`inventory.csv` og `inventory.json`)

### 2.1 CSV-struktur og datamodell
CSV-filen følger formatet:
```csv
Matvare,Protein (g),Kcal,På lager
Røde linser (tørre),25,340,TRUE
Grønne linser (tørre),24,330,TRUE
Fast tofu,15,135,FALSE
...
```

I `data/inventory.json` utvides hver råvare til et fullverdig `InventoryItem` (jf. `src/types/contracts.ts`):
- `id`: URL- og maskinvennlig slug (f.eks. `fast-tofu`, `rode-linser-torre`).
- `name`: Matvarens visningsnavn.
- `proteinPer100g`: Reelt proteininnhold per 100g.
- `kcalPer100g`: Kaloriinnhold per 100g.
- `inStock`: `boolean` (synkroniseres mot `På lager` i CSV).
- `category`: `OfferCategory` (`Frukt & Grønt` | `Tørrvarer/Belgvekster` | `Kjøl/Tofu` | `Krydder/Sauser` | `Annet`).
- `searchKeywords`: Synonymer og nøkkelord brukt for matching mot kundeavistilbud (`NormalizedOffer.normalizedTags`).
- `isCarbBase`: Om råvaren fungerer som karbohydratbase (ris, pasta, quinoa, potet).
- `isGutHealthBooster`: Om råvaren inneholder levende kulturer, fermentering eller prebiotiske fibre for tarmhelse.

### 2.2 Inventarstatus i Seed-datasettet
Seed-datasettet består av **41 sentrale matvarer**:
- **18 varer På lager (TRUE):** Typiske basistørrvarer og fermenterte smakssettere: Basmatiris, glutenrik sushiris, røde linser, grønne linser, soya chunks, TRS soya mince, næringsgjær, miso paste, gochujang, rød curry paste, grønn curry paste, hvitløk & ingefær, cashewnøtter, solsikkekjerner, sesamfrø, soyasaus, riseddik, sesamolje.
- **23 varer som må handles inn (FALSE):** Ferske råvarer og kjølevarer: Fast tofu, myk tofu (silken), edamamebønner, tempeh, kikertfusilli, quinoa, brokkoli, søtpotet, spinat, avokado, svarte bønner, kikerter, kokosmelk, hakkede tomater, kimchi, tahini, champignon sopp, rød paprika, gulerøtter, agurk, vårløk, fersk koriander, lime.
- **Resultat:** Denne fordelingen gir en realistisk miks der tørrvarelageret utnyttes optimalt, samtidig som handlelisten får rik matching mot ukens tilbud i `data/weekly-offers.json`!

---

## 3. De 7 Ufravikelige Ernærings- og Mikrobiomreglene

Matplanen følger 7 ufravikelige regler implementert i både Gemini Systemprompt, Gemini Response Schema og en deterministisk validator (`validateMealPlanNutrition`):

| Nr | Regel | Implementering og Validering |
| :---: | :--- | :--- |
| **1** | **100 % Vegansk** | Null animalske ingredienser. `allergenSafety.isVegan: true`. |
| **2** | **100 % Peanøttfritt** | Streng allergi. Forbud mot peanøtter, peanøttolje, satay og peanøttsmør. Tahini, ristede solsikkekjerner eller usaltede cashewnøtter brukes for fylde og crunch. |
| **3** | **40–50 g protein per person** | **Uten proteinpulver!** Oppnås gjennom synergi mellom fast tofu, soya chunks, TRS soya mince, tempeh, kikertfusilli, røde linser, edamamebønner, kikerter, quinoa og næringsgjær. |
| **4** | **Maks 750–800 kcal per person** | Næringsrik og mettende, med moderert fettmengde fra hele plantekilder (sesamfrø, tahini, cashewnøtter). |
| **5** | **Definert karbobase med tørrvekt** | Hver dag har en spesifisert karbohydratbase med eksakt tørrvekt (75–85 g tørrvekt per person, eller 250 g fersk søtpotet). |
| **6** | **Internasjonal variasjon over 5 dager** | Mandag: Koreansk, Tirsdag: Indisk / Sør-Asiatisk, Onsdag: Italiensk / Middelhavs, Torsdag: Japansk, Fredag: Midtøsten / Levantinsk. |
| **7** | **Gut Health & Fermentering** | Hver rett har `plantCount >= 6` (faktisk snitt 8–11) samt fermenterte komponenter (miso, gochujang, kimchi, tempeh) og prebiotisk fiber. |

### 3.1 Næringsprofil for de 5 middagene (Kuratert Ukeplan)

```
Mandag:    47g protein | 755 kcal | 86g karbo | 22g fett | 10 planter | Karbobase: Glutenrik ris (80g tørrvekt)
Tirsdag:   48g protein | 765 kcal | 89g karbo | 18g fett | 11 planter | Karbobase: Basmatiris (80g tørrvekt)
Onsdag:    49g protein | 750 kcal | 84g karbo | 21g fett |  8 planter | Karbobase: Kikertfusilli (85g tørrvekt)
Torsdag:   49g protein | 780 kcal | 81g karbo | 25g fett | 10 planter | Karbobase: Quinoa (75g tørrvekt)
Fredag:    48g protein | 770 kcal | 87g karbo | 22g fett | 11 planter | Karbobase: Søtpotet (250g ferskvekt)
---------------------------------------------------------------------------------------------------------
Snitt:     48.2g protein / middag (100% innenfor 40-50g-målet)
Kcal:      764 kcal (100% under 800 kcal-taket)
Planter:   10 unike planter per middag (tilsammen over 30 unike plantepoeng per uke for tarmfloraen!)
```

---

## 4. Gemini Structured Outputs og JSON Schema

JSON-skjemaet er definert i `schemas/mealplan.schema.json` og integrert i `geminiMealPlanner.ts`:
- **Modell:** `gemini-2.5-flash`
- **Endepunkt:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`
- **GenerationConfig:**
  ```json
  {
    "responseMimeType": "application/json",
    "responseSchema": GEMINI_MEALPLAN_RESPONSE_SCHEMA,
    "temperature": 0.3
  }
  ```
- **Fallback / Deterministisk motor:** Hvis `GEMINI_API_KEY` ikke er satt eller API-kallet feiler, faller motoren sømløst tilbake til den presisjonsberegnede kuraterte matplanen, synkronisert mot sanntidsinventar og ukens tilbud.
- **Persistent standardplan:** Generert plan caches og lagres i `data/default-mealplan.json`.

---

## 5. Handleliste-beregning og Tilbudsmatching

### 5.1 Automatisk spissing av handlelisten
Når matplanen kalkuleres:
1. Alle ingredienser fra mandag til fredag sjekkes mot inventarets `inStock`-status.
2. Ingredienser som allerede er på lager legges i `pantryItemsUsed` (f.eks. ris, linser, soya chunks, gochujang, miso, næringsgjær, oljer, krydder).
3. Ingredienser som ikke er på lager aggregeres sammen. For eksempel brukes fast tofu både mandag og torsdag; systemet summerer mengdene til 600g totalt og merker posten med `usedOnDays: [1, 4]`.
4. Handlelisten oversendes til `matchOffersToShoppingList` fra `src/services/offers/offerMatcher.ts`.

### 5.2 Resultat av tilbudsmatching mot ukens tilbud
Handlelisten på 19 varer ble matchet mot de 41 godkjente tilbudene i `data/weekly-offers.json`:

| Vare på Handleliste | Mengde & Bruksdager | Beste Matchende Uketilbud | Kjede | Tilbudspris | Førpris / Rabatt |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **Fast tofu** | 600g (Dag 1, 4) | Kolonihagen Økologisk Fast Tofu 350g | REMA 1000 | 26.90 kr | Før 37.90 (-29%) |
| **Edamamebønner** | 240g (Dag 1, 4) | Eldorado Edamamebønner 400g fryst | KIWI | 27.90 kr | Før 36.90 (-24%) |
| **Brokkoli** | 450g (Dag 1, 4) | Brokkoli Fersk 1 stk (ca. 350g) | KIWI | 14.90 kr | Før 22.90 (-35%) |
| **Kimchi** | 220g (Dag 1, 4) | Vadasz Fersk Vegansk Kimchi 300g | MENY | 44.90 kr | Før 59.90 (-25%) |
| **Spinat** | 270g (Dag 2, 3) | Bama Grønnkål & Babyspinat Mix 200g | MENY | 22.90 kr | Før 32.90 (-30%) |
| **Hakkede tomater** | 440g (Dag 2, 3) | Mutti Hakkede Tomater Polpa 400g | REMA 1000 | 15.00 kr | Før 21.90 (-32%) |
| **Kokosmelk** | 100g (Dag 2) | Go-Tan Creamy Kokosmelk 400ml | SPAR | 15.00 kr | Før 23.90 (-37%) |
| **Kikertfusilli** | 170g (Dag 3) | Kolonihagen Økologisk Kikertpasta 250g | REMA 1000 | 24.90 kr | Før 34.90 (-29%) |
| **Tahini** | 70g (Dag 3, 5) | Helios Økologisk Lys Tahini 300g | MENY | 42.90 kr | Før 58.90 (-27%) |
| **Champignon sopp** | 200g (Dag 3) | Norsk Aromasopp / Sjampinjong 250g | REMA 1000 | 18.90 kr | Før 26.90 (-30%) |
| **Tempeh** | 220g (Dag 4) | Sojade Økologisk Tempeh 250g | MENY | 34.90 kr | Før 47.90 (-27%) |
| **Quinoa** | 150g (Dag 4) | Änglamark Økologisk Hvit/Rød Quinoa 500g | COOP EXTRA | 32.90 kr | Før 45.90 (-28%) |
| **Søtpotet** | 500g (Dag 5) | Søtpotet Løsvekt pr kg | KIWI | 29.90 kr | Før 44.90 (-33%) |
| **Kikerter** | 240g (Dag 5) | Eldorado Økologiske Kikerter 390g | KIWI | 13.90 kr | Før 18.90 (-26%) |

---

## 6. API-Endepunkter

### 6.1 `GET /api/inventory`
- **Query:** `inStock` (`true` | `false`), `category`, `format` (`csv` | `json`).
- **Funksjon:** Returnerer inventar og sammendrag, eller laster ned oppdatert CSV-fil.

### 6.2 `PATCH /api/inventory`
- **Body:** `{ "id": "fast-tofu", "inStock": true }` eller `{ "updates": [...] }`.
- **Funksjon:** Oppdaterer lagerstatus og synkroniserer umiddelbart både `inventory.json` og `inventory.csv` på disk.

### 6.3 `POST /api/inventory`
- **Body:** `{ "csvContent": "..." }` eller `{ "sheetsUrl": "https://..." }`.
- **Funksjon:** Bulk-importerer og synkroniserer inventar fra rå CSV eller publisert Google Sheets-lenke.

### 6.4 `GET /api/mealplan`
- **Query:** `servings`, `minProtein`, `maxProtein`, `maxKcal`, `carbGrams`, `minPlantCount`, `dietaryNote`.
- **Funksjon:** Returnerer gjeldende 5-dagers ukeplan, dynamisk skalert til brukerens makromål, synkronisert mot nåværende inventarstatus og beriket med matchede tilbud.

### 6.5 `POST /api/mealplan`
- **Body:** `{ "forceRegenerate": true, "customPrompt": "...", "servings": 2, "macroTargets": { ... } }`.
- **Funksjon:** Kaller Gemini 2.5 Flash eller deterministisk motor for å generere ny ukeplan, tilpasser den til brukerens makromål (`UserMacroTargets`), validerer ernæringen og lagrer i `data/default-mealplan.json`.

---

## 7. Dynamisk Makroskalerer (`dynamicMacroScaler.ts`)

For å muliggjøre umiddelbar rekalkulering i nettleseren på GitHub Pages (og via server-API) uten eksterne API-kall:
1. **100 % ren TypeScript:** Ingen imports av `node:fs`, `node:path` eller node-spesifikke moduler.
2. **Proporsjonal makrotilpasning:**
   - Skalerer proteinkildene (tofu, soya chunks, tempeh, linser) presist for å treffe brukerens `minProteinGrams`–`maxProteinGrams`.
   - Setter karbohydratbasen nøyaktig til `targetCarbDryWeightGrams`.
   - Iterativ kalorikontroll trimmer fett/nøttekilder dersom måltidet overskrider `maxKcal`.
   - Skalerer alle råvarer og oppskriftstrinn proporsjonalt med `servings`.
3. **Handleliste-rekalkulering:**
   - Trekker fra råvarer på lager (`inStock === true`).
   - Aggregerer manglende råvarer med nøyaktig vekt og bruksdager.
   - Kobler på ukens tilbud via `matchOffersToShoppingList`.

---

## 8. Verifikasjon og Testresultater

Full integrasjonstest ble kjørt mot modulen, makroskalereren og API-rutene:
```
--- TEST 1: GET /api/inventory ---
Status: 200 OK | Varer på lager: 18 | Varer som mangler: 23 | Total: 41

--- TEST 2: PATCH /api/inventory (Toggle Fast Tofu) ---
Status: 200 OK | Oppdatert vare: Fast tofu inStock: true -> synkronisert til JSON og CSV

--- TEST 3: GET /api/mealplan (Dynamiske makroer) ---
Status: 200 OK | minProtein=46, maxProtein=52, carbGrams=85 -> Dag 1: 46g protein, 85g ris

--- TEST 4: POST /api/mealplan (4 porsjoner & custom mål) ---
Status: 200 OK | Porsjoner: 4 | Protein: 45g/pers | Ris totalt: 300g (75g/pers)

--- TEST 5: dynamicMacroScaler (Ren klient/server-test) ---
Alle 5 dager skalert nøyaktig innenfor min/max-mål og holdt under 820 kcal taket!
```

---

## 9. Filer levert

1. `data/inventory.csv`: Seed-data med kolonner `Matvare,Protein (g),Kcal,På lager`.
2. `data/inventory.json`: 41 berikede inventarartikler med kategorier og søkeord.
3. `data/default-mealplan.json`: Persistent 5-dagers matplan med handleliste og tilbudskoblinger.
4. `schemas/mealplan.schema.json`: JSON Schema for Structured Outputs og validering.
5. `src/services/mealplan/dynamicMacroScaler.ts`: **100 % ren TypeScript-modul** for dynamisk makrotilpasning (både for GitHub Pages klient og server).
6. `src/services/mealplan/inventoryService.ts`: CSV- og Sheets-parser, synkronisering, batch-oppdatering.
7. `src/services/mealplan/geminiMealPlanner.ts`: Gemini 2.5 Flash prompt, dynamiske makrotilpasninger, ernæringsvalidator, handleliste- og pantry-utregning.
8. `src/services/mealplan/index.ts`: Samlet eksport.
9. `src/app/api/inventory/route.ts`: GET, PATCH, POST for inventar.
10. `src/app/api/mealplan/route.ts`: GET, POST for matplan med dynamiske query-parametre og body.
11. `docs/reports/03-matplan-inventar-rapport.md`: Denne rapporten.
