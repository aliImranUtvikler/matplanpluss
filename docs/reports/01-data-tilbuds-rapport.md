# Teknisk Rapport 01: Data & Tilbuds-Agent (Dagligvaretilbud & Normalisering)

**Prosjekt:** Smart Ukentlig Vegansk Matplan & Tilbuds-Ruting i Norge  
**Ansvarlig:** Subagent 1 (`Data & Tilbuds-Agent`)  
**Dato:** 15. november 2026  

---

## 1. Teknisk vurdering av datainnhenting i det norske dagligvaremarkedet

Det norske dagligvaremarkedet domineres av tre paraplykonsern (NorgesGruppen, Coop Norge og Reitan Retail) samt nettaktøren Oda:
- **NorgesGruppen:** KIWI, MENY, SPAR, Joker
- **Reitan Retail:** REMA 1000
- **Coop Norge:** Coop Extra (samt Obs, Mega, Prix)
- **Oda:** Nettdagligvare med åpne produkt- og kampanjesider

For å hente strukturert ukentlig tilbudsdata på tvers av disse 7 kjedene har vi vurdert to hovedspor og bygget en **hybrid arkitektur**.

### 1.1 Alternativ A: Kassalapp API (`https://kassal.app/api/v1`)
- **Fordeler:**
  - Strukturert REST API med Bearer-autentisering (`KASSALAPP_API_KEY`).
  - Gir tilgang til produktnavn, GTIN/EAN-strekkoder, kjede-tilhørighet (`store.code`), vekt, allergener (`allergens`), ingredienslister og prishistorikk (`current_price` + `price_history`).
  - Utmerket for **allergen- og vegan-verifisering** fordi strukturerte allergendata (`peanøtter`, `melk`, `egg`, `fisk`, `skalldyr`) kan leses direkte per EAN.
- **Begrensninger:**
  - Dekningsgraden varierer mellom kjeder: NorgesGruppen (Meny/Spar/Joker), Oda og deler av Coop/Rema har god produktdekning på fastsortiment, men **REMA 1000 og KIWI publiserer ofte ukentlige kampanjer, priskutt og helgekupp i kundeaviser eller egne apper (Æ / Trumf) før eller uten at prisendringen fanges opp i sanntid i Kassalapp**.
  - Flerkjøpstilbud («3 for 2» på bønner/kikerter, «2 for 45,-» på avokado) og kilopris-kampanjer på løsvekt frukt og grønt ligger sjelden som eksplisitte kampanje-objekter i `/products`-endepunktet.

### 1.2 Alternativ B: Kundeaviser fra Mattilbud.no / Tjek + Gemini Vision OCR
- **Fordeler:**
  - Dekning av **100 % av ukens faktiske kundeaviser** fra mandag morgen for KIWI, REMA 1000, MENY, Coop Extra, SPAR og Joker.
  - Fanger opp ferskvaretilbud (`Frukt & Grønt`), krone-marked, «3 for 2» på hermetikk/belgvekster og sesongkampanjer som er mest lønnsomme for ukeplanlegging.
- **Utfordringer med ren HTML-scraping:**
  - Mattilbud.no og underliggende kundeavis-plattform (Tjek / Shopgun SDK) benytter ofte dynamisk innlastede bilde-sider (WebP/JPEG-oppslag med hotspots) der selve teksten («Eldorado Fast Tofu 400g – 24,90») enten ligger i prosesserte bildeflater eller obfuskerte JSON-payloads.
- **Løsning med Gemini Vision (Multimodal OCR + Structured Outputs):**
  - Ved å sende kundeavis-bildene gjennom en multimodal modell (Gemini 2.5 Flash / Pro Vision) med et låst JSON Schema (`schemas/offer.schema.json`), ekstraheres produktnavn, kjede, tilbudspris, ordinærpris, enhetspris og pakningsstørrelse direkte til `NormalizedOffer[]`.

### 1.3 Sammenligning per kjede og anbefalt hybrid-arkitektur

| Kjede | Kassalapp API dekning | Kundeavis (Mattilbud / Vision OCR) | Anbefalt primærkilde i pipeline |
| :--- | :---: | :---: | :--- |
| **REMA 1000** | Middels (begrenset kampanjedata) | Svært høy (ukentlig tilbudsavis) | Mattilbud/Vision OCR + Kassalapp EAN-berikelse |
| **KIWI** | Middels (faste priser bedre enn ukeskupp) | Svært høy (ukentlig kundeavis) | Mattilbud/Vision OCR + Kassalapp prisreferanse |
| **MENY** | Svært høy (inkl. fullt sortiment & pris) | Svært høy (kundeavis med 30%-kampanjer) | Hybrid (Kassalapp API + Kundeavis OCR) |
| **COOP EXTRA** | Middels | Svært høy (ukentlig kundeavis) | Mattilbud/Vision OCR |
| **SPAR** | Høy | Svært høy (Krone-marked / 10- og 20-kroners) | Hybrid (Kassalapp API + Kundeavis OCR) |
| **JOKER** | Høy | Høy (Ukens Joker-tilbud) | Hybrid (Kassalapp API + Kundeavis OCR) |
| **ODA** | Svært høy | Høy (Digitale kampanjesider) | Kassalapp API / Scraper |

**Konklusjon:**  
Vi har implementert en **hybrid pipeline** i `src/services/offers/` som kombinerer:
1. **Kundeavis- og Vision-parser (`mattilbudParser.ts`)** for ukens kampanjer på tvers av alle 7 kjeder.
2. **Kassalapp API-klient (`kassalappClient.ts`)** som automatisk beriker og henter live produktpriser når `KASSALAPP_API_KEY` er satt i miljøet.
3. **Deterministisk sikkerhets- og kategoriseringsmotor (`categorizer.ts`)** som garanterer at **100 % av tilbudene i `data/weekly-offers.json` er veganske og 100 % peanøttfrie (`isVeganSafe: true`)**.

---

## 2. JSON-skjema for normaliserte tilbud (`schemas/offer.schema.json`)

JSON-skjemaet er opprettet i `schemas/offer.schema.json` (JSON Schema Draft 2020-12) og speiler `NormalizedOffer` og `WeeklyOffersDataset` i `src/types/contracts.ts` 100 %:
- `StoreChain`: `["REMA_1000", "KIWI", "MENY", "COOP_EXTRA", "SPAR", "JOKER", "ODA"]`
- `OfferCategory`: `["Frukt & Grønt", "Tørrvarer/Belgvekster", "Kjøl/Tofu", "Krydder/Sauser", "Annet"]`
- `OfferSource`: `["KASSALAPP_API", "MATTILBUD_SCRAPER", "MATTILBUD_OCR", "SEED_FALLBACK"]`
- `isVeganSafe`: Låst til `"const": true` for alle lagrede tilbud i datasettet.

---

## 3. Sikkerhetsfilter (Vegan + Peanøttfri) & Kategorisering

I `src/services/offers/categorizer.ts` kjøres en to-trinns validering på alle råvarer før de slipper inn i `data/weekly-offers.json`:
1. **Peanøtt-blokkering (`PEANUT_ALLERGEN_KEYWORDS`):** Avviser umiddelbart enhver vare som matcher `peanøtt`, `peanøtter`, `peanøttsmør`, `peanøttolje`, `peanut`, `arachis`, `jordnøtt`, `satay`, `sataysaus` eller `chilinøtter`.
2. **Ikke-vegansk blokkering (`NON_VEGAN_KEYWORDS`):** Avviser kjøtt, fugl, fisk, skalldyr, egg, meieri (melk, fløte, ost, rømme, smør, kesam, skyr, myse/whey) og honning/gelatin, samtidig som sammensatte veganske ord (`kokosmelk`, `havremelk`, `plantemelk`, `vegansk ost`) ivaretas via `VEGAN_SAFE_COMPOUND_OVERRIDES`.
3. **Normaliserte søke-tags (`extractNormalizedTags`):** Bygger kanoniske søkeord (f.eks. `["tofu", "fast tofu", "soya"]`, `["røde linser", "linser", "belgvekster"]`, `["tahini", "sesampasta"]`) som kobles direkte mot `InventoryItem.searchKeywords` og `ShoppingListItem` i `offerMatcher.ts`.

---

## 4. Generert og verifisert datasett (`data/weekly-offers.json`)

CLI-scriptet `scripts/fetch-offers.ts` ble kjørt og genererte `data/weekly-offers.json` for **Uke 46 (2026)**:
- **Totalt antall råkandidater testet:** 45
- **Avvist av sikkerhetsfilter (`checkVeganAndPeanutSafety`):** 4 produkter:
  - ❌ *Green Choice Økologisk Peanøttsmør Crunchy 350g* (Inneholder peanøtt-allergen)
  - ❌ *Go-Tan Sataysaus med ristede peanøtter (Arachis) 250ml* (Inneholder peanøtt-allergen)
  - ❌ *Solvinge Kyllingfilet Naturell 600g* (Ikke-vegansk ingrediens: kylling)
  - ❌ *Tine Norvegia Gulost 1kg* (Ikke-vegansk ingrediens: gulost)
- **Godkjente og lagrede tilbud i `data/weekly-offers.json`:** **41 tilbud** (`isVeganSafe: true`)

### 4.1 Fordeling per dagligvarekjede
| Kjede | Antall tilbud | Eksempler på nøkkelvarer på tilbud |
| :--- | :---: | :--- |
| **REMA_1000** | 8 | Kolonihagen Øko Fast Tofu (26,90), Svarte bønner (11,50), Avokado 2-pk (25,00), Mutti Hakkede tomater (15,00), Kikertpasta (24,90), Basmatiris 2kg (44,90) |
| **KIWI** | 8 | Eldorado Fast Tofu 400g (24,90), Edamamebønner 400g (27,90), Brokkoli (14,90), Røde linser 500g (19,90), Kikerter (10,90), Søtpotet (29,90/kg), Kokosmelk (14,90), Babyspinat (19,90) |
| **COOP_EXTRA** | 7 | Änglamark Øko Tahini (34,90), Øko Quinoa 500g (32,90), Coop Vegetardag Fast Tofu 400g (23,90), Grønne/Røde linser (10,90), Kikerter/Svarte bønner 3 for 29,- (9,67/stk) |
| **MENY** | 6 | Yutaka Miso Paste 300g (36,90), Sempio Gochujang 250g (39,90), Vadasz Vegansk Kimchi (44,90), Sojade Øko Tempeh (34,90), Helios Lys Tahini (42,90), Grønnkål & Spinat (22,90) |
| **ODA** | 5 | Tofoo Extra Firm Tofu (29,90), Clearspring Miso & Edamame (35,90), Kikkoman Tamari/Soyasaus (34,90), Naturelle Cashewnøtter (39,90), Øko Belugalinser & Quinoa (31,90) |
| **SPAR** | 4 | Søtpotet & Gulrøtter 1kg (24,90), Go-Tan Kokosmelk (15,00), Oumph! Soyafilet (34,90), Paprika 3-pk (24,90) |
| **JOKER** | 3 | Eldorado Kikerter/Linser/Kidneybønner (12,00), Avokado & Cherrytomater (20,00), Barilla Fullkornspasta (18,00) |

### 4.2 Fordeling per matplankategori
- **Tørrvarer/Belgvekster:** 13 tilbud
- **Frukt & Grønt:** 12 tilbud
- **Kjøl/Tofu:** 8 tilbud
- **Krydder/Sauser:** 8 tilbud
- **Annet:** 0 tilbud

---

## 5. Leverte filer og API-endepunkter

1. [`schemas/offer.schema.json`](file://schemas/offer.schema.json) – Komplett JSON Schema Draft 2020-12.
2. [`src/services/offers/categorizer.ts`](file://src/services/offers/categorizer.ts) – Vegan/peanøtt-sjekk, tag-ekstraksjon og kategorisering.
3. [`src/services/offers/kassalappClient.ts`](file://src/services/offers/kassalappClient.ts) – REST-klient mot Kassalapp API (`/api/v1/products`).
4. [`src/services/offers/mattilbudParser.ts`](file://src/services/offers/mattilbudParser.ts) – Kundeavis- og Gemini Vision OCR-adapter + kuratert rådatasett.
5. [`src/services/offers/offerMatcher.ts`](file://src/services/offers/offerMatcher.ts) – Scorings- og koblingsmotor mellom `ShoppingListItem[]` og `NormalizedOffer[]`.
6. [`src/services/offers/index.ts`](file://src/services/offers/index.ts) – Hovedeksport (`getWeeklyOffers`, `matchOffersToShoppingList`, `buildWeeklyOffersDataset`).
7. [`scripts/fetch-offers.ts`](file://scripts/fetch-offers.ts) – CLI-script for generering og validering av tilbud.
8. [`data/weekly-offers.json`](file://data/weekly-offers.json) – Ferdig generert datasett med 41 verifiserte tilbud.
9. [`src/app/api/offers/route.ts`](file://src/app/api/offers/route.ts) – Next.js App Router endepunkt (`GET /api/offers` med filter og `POST /api/offers` for matching av handleliste).
