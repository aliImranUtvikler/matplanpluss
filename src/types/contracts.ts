/**
 * FELLES DATAKONTRAKTER FOR MATPLAN & TILBUDS-RUTING
 * ==================================================
 * Dette dokumentet definerer grensesnittene (interfaces) mellom alle 4 subagenter:
 * 1. Data & Tilbuds-Agent (src/services/offers)
 * 2. Google Maps & Rute-Agent (src/services/maps)
 * 3. Matplan & Inventar-Agent (src/services/mealplan)
 * 4. Frontend & UX-Agent (src/app, src/components)
 */

// ============================================================================
// 1. TILBUD & DAGLIGVAREKJEDER (Subagent 1: Data & Tilbuds-Agent)
// ============================================================================

export type StoreChain =
  | 'REMA_1000'
  | 'KIWI'
  | 'MENY'
  | 'COOP_EXTRA'
  | 'SPAR'
  | 'JOKER'
  | 'ODA';

export type OfferCategory =
  | 'Frukt & Grønt'
  | 'Tørrvarer/Belgvekster'
  | 'Kjøl/Tofu'
  | 'Krydder/Sauser'
  | 'Annet';

export type OfferSource = 'KASSALAPP_API' | 'MATTILBUD_SCRAPER' | 'MATTILBUD_OCR' | 'SEED_FALLBACK';

export interface NormalizedOffer {
  /** Unik ID for tilbudet */
  id: string;
  /** Produktets originale navn i kundeavis/API */
  productName: string;
  /** Normalisert søkbart navn/nøkkelord (f.eks. "tofu", "røde linser", "brokkoli") */
  normalizedTags: string[];
  /** Butikkjede */
  chain: StoreChain;
  /** Kategori i henhold til matplanens struktur */
  category: OfferCategory;
  /** Tilbudspris i NOK */
  offerPrice: number;
  /** Ordinær pris i NOK (hvis kjent) */
  regularPrice?: number;
  /** Rabatt i kroner (regularPrice - offerPrice) eller estimert besparelse */
  discountAmountNok?: number;
  /** Rabatt i prosent (0-100) */
  discountPercent?: number;
  /** Mengde/enhet (f.eks. "400g", "1 stk", "2 pk", "pr kg") */
  unitDescription?: string;
  /** Pris per kg/liter hvis oppgitt */
  unitPrice?: number;
  /** Fra-dato (ISO 8601 YYYY-MM-DD) */
  validFrom: string;
  /** Til-dato (ISO 8601 YYYY-MM-DD) */
  validUntil: string;
  /** Kilde for datainnhenting */
  source: OfferSource;
  /** Evt. bilde-URL av produktet eller kundeavissiden */
  imageUrl?: string;
  /** Direkte URL til den faktiske nedlastede kundeavis-siden (WebP) i public/data/flyers/... */
  flyerImageUrl?: string;
  /** Sidetall i ukens kundeavis hvor tilbudet står trykket */
  pageNumber?: number;
  /** Er varen bekreftet vegansk & peanøttfri? */
  isVeganSafe: boolean;
}

export interface WeeklyOffersDataset {
  fetchedAt: string;
  weekNumber: number;
  year: number;
  totalOffers: number;
  offers: NormalizedOffer[];
}

// ============================================================================
// 2. INVENTAR & MATPLANLEGGING (Subagent 3: Matplan & Inventar-Agent)
// ============================================================================

/** Råformat fra CSV / Google Sheets: Matvare, Protein (g), Kcal, På lager */
export interface InventoryCsvRow {
  'Matvare': string;
  'Protein (g)': number;
  'Kcal': number;
  'På lager': boolean;
}

export interface InventoryItem {
  id: string;
  /** Navn på matvare (tilsvarer "Matvare" i CSV) */
  name: string;
  /** Protein per 100g (tilsvarer "Protein (g)" i CSV) */
  proteinPer100g: number;
  /** Kcal per 100g (tilsvarer "Kcal" i CSV) */
  kcalPer100g: number;
  /** På lager status (tilsvarer "På lager" TRUE/FALSE i CSV) */
  inStock: boolean;
  /** Kategori for gruppering i UI og tilbudsmatching */
  category: OfferCategory;
  /** Søkeord for å matche mot NormalizedOffer.normalizedTags */
  searchKeywords: string[];
  /** Om dette er en fast karbohydratbase (ris, quinoa, pasta, potet) */
  isCarbBase?: boolean;
  /** Om varen bidrar spesielt til gut health (fermentert / probiotisk / prebiotisk) */
  isGutHealthBooster?: boolean;
}

export interface RecipeIngredient {
  /** Navn på ingrediens */
  name: string;
  /** Mengde per porsjon eller totalt for måltidet */
  amountGrams: number;
  /** Tørrvekt eller ferskvekt beskrivelse (f.eks. "85g tørrvekt") */
  displayAmount: string;
  /** Om ingrediensen allerede finnes på lager (På lager = TRUE) */
  inStock: boolean;
  /** Kategori */
  category: OfferCategory;
}

export interface NutritionMacros {
  /** Protein i gram per person (KRAV: 40-50 g) */
  proteinGramsPerPerson: number;
  /** Kalorier per person (KRAV: maks 750-800 kcal) */
  kcalPerPerson: number;
  /** Karbohydrater i gram per person */
  carbsGramsPerPerson: number;
  /** Fett i gram per person */
  fatGramsPerPerson: number;
  /** Antall ulike planter/grønnsaker i retten (for gut health / 30 plant points) */
  plantCount: number;
}

export interface MealPlanDay {
  /** Dag 1 til 5 (Mandag - Fredag) */
  dayNumber: 1 | 2 | 3 | 4 | 5;
  dayName: string;
  /** Navn på middagsretten */
  title: string;
  /** Kjøkken / internasjonal inspirasjon (f.eks. Koreansk, Indisk, Midtøsten, Italiensk, Meksikansk) */
  cuisine: string;
  /** Karbohydratbase med eksplisitt tørrvekt (f.eks. "Basmatiris (80g tørrvekt/pers)") */
  carbBase: {
    name: string;
    dryWeightGramsPerPerson: number;
  };
  /** Hovedproteinkilder (f.eks. ["Fast tofu", "Røde linser"]) */
  proteinSources: string[];
  /** Gut health-elementer i retten (f.eks. "Miso-glaze, hvitløk, ingefær, brokkoli, edamame") */
  gutHealthHighlights: string[];
  /** Bekreftelse på at retten er 100% vegansk og 100% peanøttfri */
  allergenSafety: {
    isVegan: true;
    isPeanutFree: true;
    nutFreeAlternativeUsed?: string; // f.eks. "Tahini", "Cashewnøtter", "Solsikkekjerner"
  };
  /** Næringsinnhold per porsjon */
  macros: NutritionMacros;
  /** Ingrediensliste */
  ingredients: RecipeIngredient[];
  /** Nummererte kokkesteg (1..N) */
  steps: string[];
  /** Estimert tilberedningstid i minutter */
  prepTimeMinutes: number;
}

export interface ShoppingListItem {
  id: string;
  ingredientName: string;
  totalAmountGrams: number;
  displayAmount: string;
  category: OfferCategory;
  /** Hvilke dager i ukeplanen ingrediensen brukes (f.eks. [1, 3]) */
  usedOnDays: number[];
  /** Koblede tilbud fra ulike kjeder hvis funnet */
  matchedOffers?: NormalizedOffer[];
}

export interface WeeklyMealPlanResponse {
  generatedAt: string;
  servingsPerMeal: number;
  days: MealPlanDay[];
  /** Kun varer som trengs i ukeplanen der På lager === false */
  shoppingList: ShoppingListItem[];
  /** Varer som brukes i ukeplanen og som allerede er på lager (På lager === true) */
  pantryItemsUsed: string[];
}

// ============================================================================
// 3. GOOGLE MAPS & RUTE-OPTIMALISERING (Subagent 2: Google Maps & Rute-Agent)
// ============================================================================

export interface GeoCoordinates {
  lat: number;
  lng: number;
}

export interface PhysicalStore {
  /** Google Place ID eller intern ID */
  placeId: string;
  /** Navn på butikken, f.eks. "KIWI Grünerløkka" */
  name: string;
  /** Tilhørende kjede */
  chain: StoreChain;
  /** Gateadresse */
  address: string;
  /** Koordinater */
  location: GeoCoordinates;
  /** Avstand fra bruker i meter */
  distanceMeters: number;
  /** Estimert reisetid i minutter (bil eller gange) */
  travelTimeMinutes: number;
  /** Åpningstider / åpen nå status hvis tilgjengelig */
  isOpenNow?: boolean;
}

export interface StoreOfferMatchItem {
  shoppingListItem: ShoppingListItem;
  offer: NormalizedOffer;
  estimatedSavingsNok: number;
}

export interface SingleStoreRecommendation {
  store: PhysicalStore;
  /** Antall varer på handlelisten som er på tilbud i denne butikken */
  matchedItemsCount: number;
  /** Total antall varer på handlelisten */
  totalShoppingListItems: number;
  /** Total tilbudspris for de matchede varene */
  totalOfferPriceNok: number;
  /** Estimert total besparelse i NOK i denne butikken */
  estimatedTotalSavingsNok: number;
  /** Konkrete varer som bør plukkes her */
  matchedItems: StoreOfferMatchItem[];
  /** Samlet score (kombinerer besparelse og reisetid/avstand) */
  rankScore: number;
}

export interface ComboRouteRecommendation {
  /** De to butikkene i rekkefølge langs ruten */
  stops: [
    {
      store: PhysicalStore;
      itemsToPick: StoreOfferMatchItem[];
      subtotalSavingsNok: number;
    },
    {
      store: PhysicalStore;
      itemsToPick: StoreOfferMatchItem[];
      subtotalSavingsNok: number;
    }
  ];
  /** Total reisetid for hele ruten (Bruker -> Butikk A -> Butikk B) i minutter */
  totalTravelTimeMinutes: number;
  /** Total distanse i meter */
  totalDistanceMeters: number;
  /** Ekstra reisetid sammenlignet med beste enkeltbutikk */
  extraTravelTimeMinutes: number;
  /** Samlet estimert besparelse ved å besøke begge butikkene */
  combinedSavingsNok: number;
  /** Ekstra kroner spart sammenlignet med kun beste enkeltbutikk */
  additionalSavingsVsSingleStoreNok: number;
  /** Om kombi-ruten faktisk anbefales (f.eks. > 35 kr ekstra spart og < 12 min omvei) */
  isRecommended: boolean;
  /** Forklaring til brukeren */
  recommendationReason: string;
  /** Encoded polyline eller koordinatliste for opptegning i Google Maps */
  routePolyline?: GeoCoordinates[];
}

export interface RouteOptimizationRequest {
  userLocation: GeoCoordinates;
  travelMode: 'DRIVING' | 'WALKING' | 'BICYCLING';
  maxRadiusMeters?: number;
  shoppingList: ShoppingListItem[];
  offers: NormalizedOffer[];
}

export interface RouteOptimizationResponse {
  userLocation: GeoCoordinates;
  travelMode: 'DRIVING' | 'WALKING' | 'BICYCLING';
  /** Beste enkeltbutikk-valg rangert fra best til dårligst */
  singleStoreRanking: SingleStoreRecommendation[];
  /** Beste kombi-rute (2 butikker langs samme rute) */
  bestComboRoute: ComboRouteRecommendation | null;
}

// ============================================================================
// 4. DYNAMISKE MAKROMÅL, PDF/SIDE-SKANNER & CRON-TASK PIPELINE
// ============================================================================

/**
 * Dynamiske makromål som brukeren kan endre når som helst i UI-et eller
 * sende inn til Task-pipelinen for å rekalkulere hele ukeplanen og handlelisten.
 */
export interface UserMacroTargets {
  /** Minimum protein per person per middag (standard: 40g) */
  minProteinGrams: number;
  /** Maksimum/mål protein per person per middag (standard: 50g) */
  maxProteinGrams: number;
  /** Maks kalorier per person per middag (standard: 780 kcal) */
  maxKcal: number;
  /** Mål for tørrvekt på karbohydratbase per person (standard: 80g) */
  targetCarbDryWeightGrams: number;
  /** Antall porsjoner per middag (standard: 2) */
  servings: number;
  /** Minimum antall ulike planter per middag for gut health (standard: 6) */
  minPlantCount: number;
  /** Valgfri preferanse (f.eks. "Ekstra protein", "Lavere kalori", "Asiatisk fokus") */
  dietaryNote?: string;
}

/**
 * Representerer én enkelt side fra en kundeavis/PDF hentet fra mattilbud.no
 */
export interface FlyerPageAsset {
  chain: StoreChain;
  flyerId: string;
  pageNumber: number;
  totalPages: number;
  imageUrlOrBase64: string;
  localFilePath?: string;
  mimeType: 'image/webp' | 'image/jpeg' | 'image/png' | 'application/pdf';
  validFrom: string;
  validUntil: string;
}

/**
 * Resultat etter at AI Vision har analysert én enkelt side i kundeavisen
 */
export interface FlyerPageScanResult {
  chain: StoreChain;
  flyerId: string;
  pageNumber: number;
  rawDetectedCount: number;
  rejectedAllergenOrNonVeganCount: number;
  acceptedOffers: NormalizedOffer[];
  scannedAt: string;
}

/**
 * Samlet manifest fra den automatiske 3-trinns Task-pipelinen:
 * Steg 1 (Cron/Scheduler: PDF/Side-skanner) -> Steg 2 (Matplan-Task med dynamiske makroer) -> Steg 3 (Kart & Adresse-ruter)
 */
export interface PipelineExecutionManifest {
  pipelineRunId: string;
  startedAt: string;
  completedAt: string;
  trigger: 'CRON_SCHEDULE' | 'MANUAL_DISPATCH' | 'DYNAMIC_MACRO_REFRESH';
  macroTargetsUsed: UserMacroTargets;
  stage1_flyerScanner: {
    chainsScanned: StoreChain[];
    pagesScannedCount: number;
    totalOffersExtracted: number;
    rejectedUnsafeItems: number;
    outputPath: string;
  };
  stage2_mealPlanTask: {
    daysGenerated: number;
    avgProteinGrams: number;
    avgKcal: number;
    shoppingListCount: number;
    pantryItemsUsedCount: number;
    outputPath: string;
  };
  stage3_mapRouterTask: {
    storesEvaluatedCount: number;
    bestSingleStoreName: string;
    bestSingleStoreAddress: string;
    bestSingleStoreSavingsNok: number;
    bestComboStores?: [string, string];
    bestComboSavingsNok?: number;
    outputPath: string;
  };
}

// ============================================================================
// 5. KOKKENS MODUS & OPPSKRIFTSSTIL PREFERANSER
// ============================================================================

export type CuisineStyle =
  | 'ASIATISK'          // Koreansk, Japansk, Thai
  | 'INDISK'            // Curry, Dal, Masala
  | 'MIDDELHAVS'        // Pasta, Tomat, Urter, Italiensk
  | 'MIDTOSTEN'         // Shawarma, Tahini, Kikerter, Levantinsk
  | 'LATIN_AMERIKANSK'; // Bønner, Chili, Lime, Meksikansk

export interface ChefModePreferences {
  /** 🏷️ Tilbuds-fokus: Bygg menyen rundt ukens beste tilbud i kundeavisene */
  focusOffers: boolean;
  /** 🥫 Tøm skapet først: Prioriter varer vi allerede har 'På lager' */
  prioritizePantry: boolean;
  /** ⚡ Rask hverdag: Maks 20 minutters tilberedningstid */
  quickMealsOnly: boolean;
  /** 🌏 Stil / Verdensdel aktiv? Hvis true, ekspanderes listen under */
  enableCuisineFilter: boolean;
  /** Valgte verdensdeler/stiler (flervalg) */
  selectedCuisines: CuisineStyle[];
  /** ✍️ Annet (Eget ønske) aktiv? Hvis true, vises tekst-inputfeltet under */
  enableCustomNotes: boolean;
  /** Eget fritekstønske til kokken (f.eks. "Lag gjerne en kremet ramen, unngå sopp") */
  customNotes: string;
}

export const DEFAULT_CHEF_MODE_PREFERENCES: ChefModePreferences = {
  focusOffers: true,
  prioritizePantry: true,
  quickMealsOnly: false,
  enableCuisineFilter: false,
  selectedCuisines: ['ASIATISK', 'INDISK', 'MIDDELHAVS', 'MIDTOSTEN', 'LATIN_AMERIKANSK'],
  enableCustomNotes: false,
  customNotes: ''
};


