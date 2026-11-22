import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  FlyerPageAsset,
  FlyerPageScanResult,
  GeoCoordinates,
  MealPlanDay,
  PipelineExecutionManifest,
  RouteOptimizationResponse,
  StoreChain,
  UserMacroTargets,
  WeeklyMealPlanResponse,
  WeeklyOffersDataset
} from '../../types/contracts';
import { optimizeRoute } from '../maps/routeOptimizer';
import {
  buildWeeklyMealPlanResponse,
  callGeminiMealPlanGenerator,
  CURATED_5_DAY_MEAL_PLAN,
  getInventory
} from '../mealplan';
import {
  downloadMattilbudFlyerPages,
  scanFlyerPagesWithAiVision
} from '../offers/pdfPageVisionScanner';

/**
 * Standard makromål i henhold til ernæringskravene
 */
export const DEFAULT_USER_MACRO_TARGETS: UserMacroTargets = {
  minProteinGrams: 40,
  maxProteinGrams: 50,
  maxKcal: 780,
  targetCarbDryWeightGrams: 80,
  servings: 2,
  minPlantCount: 6,
  dietaryNote: 'Vegansk, peanøttfritt, tarmhelse- og mikrobiomoptimalisert'
};

/**
 * Standard brukerlokasjon (Grünerløkka, Oslo) for rute- og tilbudsoptimalisering
 */
export const DEFAULT_USER_LOCATION: GeoCoordinates = {
  lat: 59.924,
  lng: 10.758
};

/**
 * Hjelpefunksjon for å skrive JSON atomisk til BÅDE `data/` OG `public/data/`
 * slik at både Next.js API-ruter lokalt og statisk GitHub Pages eksport har tilgang til dataene.
 */
export async function writeDualJson(subpath: string, data: unknown): Promise<{ rootPath: string; publicPath: string }> {
  const rootPath = path.join(process.cwd(), 'data', subpath);
  const publicPath = path.join(process.cwd(), 'public', 'data', subpath);

  await fs.mkdir(path.dirname(rootPath), { recursive: true });
  await fs.mkdir(path.dirname(publicPath), { recursive: true });

  const jsonStr = JSON.stringify(data, null, 2) + '\n';
  await fs.writeFile(rootPath, jsonStr, 'utf-8');
  await fs.writeFile(publicPath, jsonStr, 'utf-8');

  return { rootPath, publicPath };
}

// ============================================================================
// STEG 1: Cron / Scheduler-motor (PDF / Kundeavis Side-for-Side Vision-skanner)
// ============================================================================

export interface Stage1Options {
  chains?: StoreChain[];
  referenceDate?: Date;
  forceDeterministic?: boolean;
}

export interface Stage1Result {
  dataset: WeeklyOffersDataset;
  pageResults: FlyerPageScanResult[];
  chainsScanned: StoreChain[];
  totalOffersExtracted: number;
  rejectedUnsafeItems: number;
  outputPath: string;
}

/**
 * Kjører Steg 1:
 * - Henter kundeavis-manifest / PDF-sider for kjedene fra mattilbud.no
 * - Viser hver side sekvensielt til Gemini Vision (eller deterministisk simulator)
 * - Renser, validerer allergensikkerhet (100% vegansk & 100% peanøttfritt)
 * - Skriver `weekly-offers.json` til `data/` og `public/data/`
 */
export async function runStage1_FlyerPdfVisionScanner(options?: Stage1Options): Promise<Stage1Result> {
  const chains: StoreChain[] = options?.chains ?? [
    'KIWI',
    'REMA_1000',
    'MENY',
    'COOP_EXTRA',
    'SPAR',
    'JOKER',
    'ODA'
  ];

  const refDate = options?.referenceDate ?? new Date();

  // 1. Last ned eller generer side-manifest fra mattilbud.no
  const flyerPages: FlyerPageAsset[] = await downloadMattilbudFlyerPages(chains, refDate);

  // 2. Skann hver enkelt side med AI Vision
  const scanOutput = await scanFlyerPagesWithAiVision(flyerPages, {
    forceDeterministic: options?.forceDeterministic
  });

  // 3. Lagre til disk i både data/ og public/data/
  const { publicPath } = await writeDualJson('weekly-offers.json', scanOutput.dataset);

  return {
    dataset: scanOutput.dataset,
    pageResults: scanOutput.pageResults,
    chainsScanned: chains,
    totalOffersExtracted: scanOutput.dataset.totalOffers,
    rejectedUnsafeItems: scanOutput.totalRejected,
    outputPath: publicPath
  };
}

// ============================================================================
// STEG 2: Matplan-Task (Dynamisk makrotilpasset ukeplan og handleliste)
// ============================================================================

export interface Stage2Options {
  offersDataset: WeeklyOffersDataset;
  macroTargets?: Partial<UserMacroTargets>;
  forceGemini?: boolean;
}

export interface Stage2Result {
  mealPlanResponse: WeeklyMealPlanResponse;
  effectiveMacroTargets: UserMacroTargets;
  daysGenerated: number;
  avgProteinGrams: number;
  avgKcal: number;
  shoppingListCount: number;
  pantryItemsUsedCount: number;
  outputPath: string;
}

/**
 * Tilpasser en dag i måltidsplanen deterministisk til dynamiske makromål
 */
function adaptMealPlanDayToMacros(baseDay: MealPlanDay, targets: UserMacroTargets): MealPlanDay {
  const targetCarb = targets.targetCarbDryWeightGrams;
  const targetProtein = Math.round((targets.minProteinGrams + targets.maxProteinGrams) / 2);

  // Skaleringsfaktor for protein basert på baseDay
  const baseProtein = baseDay.macros.proteinGramsPerPerson || 45;
  const proteinRatio = Math.max(0.8, Math.min(1.4, targetProtein / baseProtein));

  // Juster ingredienser
  const adjustedIngredients = baseDay.ingredients.map((ing) => {
    // Hvis karbohydratbase (f.eks. ris, quinoa, potet):
    const isCarb =
      ing.name.toLowerCase().includes('ris') ||
      ing.name.toLowerCase().includes('quinoa') ||
      ing.name.toLowerCase().includes('pasta') ||
      ing.name.toLowerCase().includes('potet');

    if (isCarb) {
      const scaledAmount = Math.round(targetCarb * targets.servings);
      return {
        ...ing,
        amountGrams: scaledAmount,
        displayAmount: `${scaledAmount}g (${targetCarb}g tørrvekt/pers)`
      };
    }

    // Hvis proteinkilde (tofu, linser, edamame, bønner):
    const isProteinSource =
      ing.name.toLowerCase().includes('tofu') ||
      ing.name.toLowerCase().includes('linser') ||
      ing.name.toLowerCase().includes('edamame') ||
      ing.name.toLowerCase().includes('bønner') ||
      ing.name.toLowerCase().includes('kikerter');

    if (isProteinSource) {
      const scaledAmount = Math.round(ing.amountGrams * proteinRatio);
      return {
        ...ing,
        amountGrams: scaledAmount,
        displayAmount: `${scaledAmount}g`
      };
    }

    return ing;
  });

  const adjustedProtein = Math.round(baseProtein * proteinRatio * 10) / 10;
  // Kcal justeres proporsjonalt med karb- og proteinendringer
  const carbDeltaGrams = targetCarb - baseDay.carbBase.dryWeightGramsPerPerson;
  const proteinDeltaGrams = adjustedProtein - baseProtein;
  const kcalAdjustment = Math.round(carbDeltaGrams * 3.6 + proteinDeltaGrams * 4.0);
  const adjustedKcal = Math.min(targets.maxKcal, Math.max(550, baseDay.macros.kcalPerPerson + kcalAdjustment));

  return {
    ...baseDay,
    carbBase: {
      name: baseDay.carbBase.name,
      dryWeightGramsPerPerson: targetCarb
    },
    macros: {
      ...baseDay.macros,
      proteinGramsPerPerson: adjustedProtein,
      kcalPerPerson: adjustedKcal,
      plantCount: Math.max(targets.minPlantCount, baseDay.macros.plantCount)
    },
    ingredients: adjustedIngredients
  };
}

/**
 * Kjører Steg 2:
 * - Venter på tilbudene fra Steg 1
 * - Tar imot dynamiske makroønsker fra brukeren (`UserMacroTargets`)
 * - Laster inventar (og lagrer snapshot til `inventory.json`)
 * - Genererer 5-dagers ukeplan tilpasset makroene
 * - Bygger handlelisten for varer som ikke er på lager og kobler på de ferske tilbudene
 * - Skriver `default-mealplan.json` og `inventory.json` til `data/` og `public/data/`
 */
export async function runStage2_DynamicMealPlanTask(options: Stage2Options): Promise<Stage2Result> {
  const effectiveMacroTargets: UserMacroTargets = {
    ...DEFAULT_USER_MACRO_TARGETS,
    ...(options.macroTargets ?? {})
  };

  const inventory = await getInventory();

  // Lagre inventar-snapshot til data/ og public/data/
  await writeDualJson('inventory.json', inventory);

  let mealPlanResponse: WeeklyMealPlanResponse;

  // Sjekk om Gemini API skal kalles direkte hvis forceGemini og GEMINI_API_KEY er tilgjengelig
  if (options.forceGemini && process.env.GEMINI_API_KEY) {
    try {
      mealPlanResponse = await callGeminiMealPlanGenerator({
        inventory,
        offers: options.offersDataset.offers,
        servingsPerMeal: effectiveMacroTargets.servings,
        customPrompt: `Optimaliser middagsplanen for disse makromålene: Minst ${effectiveMacroTargets.minProteinGrams}g protein, maks ${effectiveMacroTargets.maxKcal} kcal, ${effectiveMacroTargets.targetCarbDryWeightGrams}g tørrvekt karbohydrater per person.`
      });
    } catch (err) {
      console.warn('Gemini direkte-generering feilet, tilpasser kuratert ukeplan:', err);
      const adaptedDays = CURATED_5_DAY_MEAL_PLAN.map((day) =>
        adaptMealPlanDayToMacros(day, effectiveMacroTargets)
      );
      mealPlanResponse = buildWeeklyMealPlanResponse(
        adaptedDays,
        inventory,
        options.offersDataset.offers,
        effectiveMacroTargets.servings
      );
    }
  } else {
    // Deterministisk tilpasning av kuratert gull-plan
    const adaptedDays = CURATED_5_DAY_MEAL_PLAN.map((day) =>
      adaptMealPlanDayToMacros(day, effectiveMacroTargets)
    );
    mealPlanResponse = buildWeeklyMealPlanResponse(
      adaptedDays,
      inventory,
      options.offersDataset.offers,
      effectiveMacroTargets.servings
    );
  }

  // Lagre default-mealplan.json til data/ og public/data/
  const { publicPath } = await writeDualJson('default-mealplan.json', mealPlanResponse);

  const totalProtein = mealPlanResponse.days.reduce((acc, d) => acc + d.macros.proteinGramsPerPerson, 0);
  const totalKcal = mealPlanResponse.days.reduce((acc, d) => acc + d.macros.kcalPerPerson, 0);
  const avgProteinGrams = Math.round((totalProtein / mealPlanResponse.days.length) * 10) / 10;
  const avgKcal = Math.round(totalKcal / mealPlanResponse.days.length);

  return {
    mealPlanResponse,
    effectiveMacroTargets,
    daysGenerated: mealPlanResponse.days.length,
    avgProteinGrams,
    avgKcal,
    shoppingListCount: mealPlanResponse.shoppingList.length,
    pantryItemsUsedCount: mealPlanResponse.pantryItemsUsed.length,
    outputPath: publicPath
  };
}

// ============================================================================
// STEG 3: Kart & Adresse-Task (Rute-optimalisering og butikkmatching)
// ============================================================================

export interface Stage3Options {
  mealPlanResponse: WeeklyMealPlanResponse;
  offersDataset: WeeklyOffersDataset;
  userLocation?: GeoCoordinates;
  travelMode?: 'DRIVING' | 'WALKING' | 'BICYCLING';
}

export interface Stage3Result {
  routeResponse: RouteOptimizationResponse;
  storesEvaluatedCount: number;
  bestSingleStoreName: string;
  bestSingleStoreAddress: string;
  bestSingleStoreSavingsNok: number;
  bestComboStores?: [string, string];
  bestComboSavingsNok?: number;
  outputPath: string;
}

/**
 * Kjører Steg 3:
 * - Mottar handleliste og tilbud fra Steg 2
 * - Kaller rute-optimalisereren for å evaluere fysiske butikker i nærområdet
 * - Beregner beste enkeltbutikk og beste kombi-rute (2 butikker langs ruten)
 * - Skriver `routes-cache.json` til `data/` og `public/data/`
 */
export async function runStage3_MapAddressRouterTask(options: Stage3Options): Promise<Stage3Result> {
  const userLocation = options.userLocation ?? DEFAULT_USER_LOCATION;
  const travelMode = options.travelMode ?? 'DRIVING';

  const routeResponse: RouteOptimizationResponse = await optimizeRoute({
    userLocation,
    travelMode,
    shoppingList: options.mealPlanResponse.shoppingList,
    offers: options.offersDataset.offers
  });

  // Lagre routes-cache.json til data/ og public/data/
  const { publicPath } = await writeDualJson('routes-cache.json', routeResponse);

  const bestSingle = routeResponse.singleStoreRanking[0];
  const bestCombo = routeResponse.bestComboRoute;

  return {
    routeResponse,
    storesEvaluatedCount: routeResponse.singleStoreRanking.length,
    bestSingleStoreName: bestSingle?.store.name ?? 'Ingen butikk funnet',
    bestSingleStoreAddress: bestSingle?.store.address ?? 'Ingen adresse',
    bestSingleStoreSavingsNok: bestSingle?.estimatedTotalSavingsNok ?? 0,
    bestComboStores: bestCombo
      ? [bestCombo.stops[0].store.name, bestCombo.stops[1].store.name]
      : undefined,
    bestComboSavingsNok: bestCombo?.combinedSavingsNok,
    outputPath: publicPath
  };
}

// ============================================================================
// HOVED-ORKESTRERING: Samlet 3-trinns pipeline med manifest-generering
// ============================================================================

export interface PipelineExecutionOptions {
  trigger?: 'CRON_SCHEDULE' | 'MANUAL_DISPATCH' | 'DYNAMIC_MACRO_REFRESH';
  macroTargets?: Partial<UserMacroTargets>;
  chains?: StoreChain[];
  userLocation?: GeoCoordinates;
  travelMode?: 'DRIVING' | 'WALKING' | 'BICYCLING';
  forceDeterministicOffers?: boolean;
  forceGeminiMealPlan?: boolean;
}

export interface PipelineExecutionResult {
  manifest: PipelineExecutionManifest;
  offersDataset: WeeklyOffersDataset;
  mealPlanResponse: WeeklyMealPlanResponse;
  routeResponse: RouteOptimizationResponse;
}

/**
 * Utfører hele den 3-trinns automatiserte pipelinen:
 * Steg 1: Cron / Scheduler-motor (Kundeavis Side-for-Side AI Vision-skanner)
 * Steg 2: Matplan-Task (Dynamisk makrotilpasset 5-dagersplan + handleliste)
 * Steg 3: Kart & Adresse-Task (Optimal ruting, fysiske butikkadresser & kombi-rute)
 *
 * Skriver ferdige JSON-filer til BÅDE `data/` OG `public/data/`:
 * - weekly-offers.json
 * - default-mealplan.json
 * - inventory.json
 * - routes-cache.json
 * - pipeline-manifest.json
 */
export async function executeFullWeeklyPipeline(
  options?: PipelineExecutionOptions
): Promise<PipelineExecutionResult> {
  const startedAt = new Date().toISOString();
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const trigger = options?.trigger ?? 'MANUAL_DISPATCH';

  // STEG 1
  const stage1 = await runStage1_FlyerPdfVisionScanner({
    chains: options?.chains,
    forceDeterministic: options?.forceDeterministicOffers
  });

  // STEG 2
  const stage2 = await runStage2_DynamicMealPlanTask({
    offersDataset: stage1.dataset,
    macroTargets: options?.macroTargets,
    forceGemini: options?.forceGeminiMealPlan
  });

  // STEG 3
  const stage3 = await runStage3_MapAddressRouterTask({
    mealPlanResponse: stage2.mealPlanResponse,
    offersDataset: stage1.dataset,
    userLocation: options?.userLocation,
    travelMode: options?.travelMode
  });

  const completedAt = new Date().toISOString();

  // SAMLE MANIFEST
  const manifest: PipelineExecutionManifest = {
    pipelineRunId: runId,
    startedAt,
    completedAt,
    trigger,
    macroTargetsUsed: stage2.effectiveMacroTargets,
    stage1_flyerScanner: {
      chainsScanned: stage1.chainsScanned,
      pagesScannedCount: stage1.pageResults.length,
      totalOffersExtracted: stage1.totalOffersExtracted,
      rejectedUnsafeItems: stage1.rejectedUnsafeItems,
      outputPath: stage1.outputPath
    },
    stage2_mealPlanTask: {
      daysGenerated: stage2.daysGenerated,
      avgProteinGrams: stage2.avgProteinGrams,
      avgKcal: stage2.avgKcal,
      shoppingListCount: stage2.shoppingListCount,
      pantryItemsUsedCount: stage2.pantryItemsUsedCount,
      outputPath: stage2.outputPath
    },
    stage3_mapRouterTask: {
      storesEvaluatedCount: stage3.storesEvaluatedCount,
      bestSingleStoreName: stage3.bestSingleStoreName,
      bestSingleStoreAddress: stage3.bestSingleStoreAddress,
      bestSingleStoreSavingsNok: stage3.bestSingleStoreSavingsNok,
      bestComboStores: stage3.bestComboStores,
      bestComboSavingsNok: stage3.bestComboSavingsNok,
      outputPath: stage3.outputPath
    }
  };

  // Lagre pipeline-manifest.json til data/ og public/data/
  await writeDualJson('pipeline-manifest.json', manifest);

  return {
    manifest,
    offersDataset: stage1.dataset,
    mealPlanResponse: stage2.mealPlanResponse,
    routeResponse: stage3.routeResponse
  };
}
