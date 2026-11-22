import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  FlyerPageAsset,
  FlyerPageScanResult,
  NormalizedOffer,
  OfferCategory,
  ShoppingListItem,
  StoreChain,
  WeeklyOffersDataset
} from '../../types/contracts';
import {
  categorizeOffer,
  checkVeganAndPeanutSafety,
  computeDiscountMetrics,
  extractNormalizedTags
} from './categorizer';
import { fetchOffersFromKassalapp } from './kassalappClient';
import {
  GEMINI_VISION_FLYER_EXTRACTION_PROMPT,
  getCurrentWeekDateRange,
  parseAndFilterFlyerOffers,
  RAW_WEEKLY_FLYER_CANDIDATES
} from './mattilbudParser';
import {
  findMatchingOffersForIngredientName,
  getStoreChainBadgeStyle,
  getStoreChainShortName,
  groupOffersByChain,
  matchOffersToShoppingList,
  scoreOfferMatchForIngredient
} from './offerMatcher';
import {
  buildFlyerPageAssets,
  clearStoreOffersCache,
  downloadMattilbudFlyerPages,
  type EditableStoreOffersFile,
  GEMINI_FLYER_PAGE_SYSTEM_PROMPT,
  GEMINI_PAGE_RESPONSE_SCHEMA,
  loadDownloadedFlyerPages,
  loadOffersFromStoreJson,
  mapSlugToStoreChain,
  mapStoreChainToFolder,
  resolveStoreOffersJsonPath,
  saveOffersToStoreJson,
  scanFlyerPagesWithAiVision,
  scanSingleFlyerPageWithVision
} from './pdfPageVisionScanner';

export {
  buildFlyerPageAssets,
  categorizeOffer,
  checkVeganAndPeanutSafety,
  clearStoreOffersCache,
  computeDiscountMetrics,
  downloadMattilbudFlyerPages,
  type EditableStoreOffersFile,
  extractNormalizedTags,
  fetchOffersFromKassalapp,
  findMatchingOffersForIngredientName,
  GEMINI_FLYER_PAGE_SYSTEM_PROMPT,
  GEMINI_PAGE_RESPONSE_SCHEMA,
  GEMINI_VISION_FLYER_EXTRACTION_PROMPT,
  getCurrentWeekDateRange,
  getStoreChainBadgeStyle,
  getStoreChainShortName,
  groupOffersByChain,
  loadDownloadedFlyerPages,
  loadOffersFromStoreJson,
  mapSlugToStoreChain,
  mapStoreChainToFolder,
  matchOffersToShoppingList,
  parseAndFilterFlyerOffers,
  RAW_WEEKLY_FLYER_CANDIDATES,
  resolveStoreOffersJsonPath,
  saveOffersToStoreJson,
  scanFlyerPagesWithAiVision,
  scanSingleFlyerPageWithVision,
  scoreOfferMatchForIngredient
};

const WEEKLY_OFFERS_DATA_PATH = path.join(process.cwd(), 'data', 'weekly-offers.json');

/**
 * Bygger et komplett `WeeklyOffersDataset` ved å kombinere:
 * 1. Side-for-side AI Vision skanning av kundeaviser fra Mattilbud (KIWI, REMA 1000, MENY, COOP EXTRA, SPAR, JOKER, ODA)
 * 2. Kassalapp API (når `KASSALAPP_API_KEY` er satt)
 * Alle tilbud renses og valideres strengt mot `checkVeganAndPeanutSafety`.
 */
export async function buildWeeklyOffersDataset(options?: {
  referenceDate?: Date;
  useLiveKassalapp?: boolean;
  chains?: StoreChain[];
  forceDeterministic?: boolean;
}): Promise<{
  dataset: WeeklyOffersDataset;
  rejectedCount: number;
  rejectedReasons: Array<{ id: string; productName: string; reason: string }>;
  pageResults?: FlyerPageScanResult[];
}> {
  const refDate = options?.referenceDate ?? new Date();
  const { validFrom, validUntil, weekNumber, year } = getCurrentWeekDateRange(refDate);

  // 1. Last ned og skann kundeavis-sider side-for-side
  const pages = await downloadMattilbudFlyerPages(options?.chains, refDate);
  const scanResult = await scanFlyerPagesWithAiVision(pages, {
    forceDeterministic: options?.forceDeterministic
  });

  const flyerOffers = scanResult.dataset.offers;

  // 2. Hent evt. supplerende tilbud fra Kassalapp API hvis nøkkel er tilgjengelig
  let kassalappOffers: NormalizedOffer[] = [];
  if (options?.useLiveKassalapp !== false && process.env.KASSALAPP_API_KEY) {
    try {
      kassalappOffers = await fetchOffersFromKassalapp({
        validFrom,
        validUntil
      });
    } catch (err) {
      console.warn('Kassalapp API feilet, fortsetter med kundeavis-tilbud:', err);
    }
  }

  // Dedupliser basert på id eller unik nøkkel
  const mergedMap = new Map<string, NormalizedOffer>();
  for (const offer of [...flyerOffers, ...kassalappOffers]) {
    if (offer.isVeganSafe) {
      mergedMap.set(offer.id, offer);
    }
  }

  const offers = Array.from(mergedMap.values());

  const dataset: WeeklyOffersDataset = {
    fetchedAt: new Date().toISOString(),
    weekNumber,
    year,
    totalOffers: offers.length,
    offers
  };

  return {
    dataset,
    rejectedCount: scanResult.totalRejected,
    rejectedReasons: [],
    pageResults: scanResult.pageResults
  };
}

/**
 * Leser forhåndsgenerert `data/weekly-offers.json` fra disk hvis den finnes,
 * eller bygger datasettet dynamisk i minnet dersom filen ikke er opprettet ennå.
 */
export async function getWeeklyOffers(options?: {
  chain?: StoreChain;
  category?: OfferCategory;
  search?: string;
}): Promise<WeeklyOffersDataset> {
  let dataset: WeeklyOffersDataset;

  try {
    const rawJson = await fs.readFile(WEEKLY_OFFERS_DATA_PATH, 'utf-8');
    dataset = JSON.parse(rawJson) as WeeklyOffersDataset;
  } catch {
    const built = await buildWeeklyOffersDataset();
    dataset = built.dataset;
  }

  let filteredOffers = dataset.offers.filter((o) => o.isVeganSafe);

  if (options?.chain) {
    filteredOffers = filteredOffers.filter((o) => o.chain === options.chain);
  }

  if (options?.category) {
    filteredOffers = filteredOffers.filter((o) => o.category === options.category);
  }

  if (options?.search && options.search.trim().length > 0) {
    const q = options.search.trim().toLowerCase();
    filteredOffers = filteredOffers.filter(
      (o) =>
        o.productName.toLowerCase().includes(q) ||
        o.normalizedTags.some((t) => t.toLowerCase().includes(q))
    );
  }

  return {
    ...dataset,
    totalOffers: filteredOffers.length,
    offers: filteredOffers
  };
}

/**
 * Hjelpefunksjon som både henter ukens tilbud og matcher dem direkte mot en handleliste.
 */
export async function getShoppingListWithOffers(
  items: ShoppingListItem[]
): Promise<{ shoppingList: ShoppingListItem[]; offersDataset: WeeklyOffersDataset }> {
  const offersDataset = await getWeeklyOffers();
  const matchedList = matchOffersToShoppingList(items, offersDataset.offers);
  return {
    shoppingList: matchedList,
    offersDataset
  };
}
