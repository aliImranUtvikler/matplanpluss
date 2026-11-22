import type { NormalizedOffer, StoreChain } from '../../types/contracts';
import {
  categorizeOffer,
  checkVeganAndPeanutSafety,
  computeDiscountMetrics,
  extractNormalizedTags
} from './categorizer';

export interface KassalappStoreObj {
  name: string;
  code: string;
  url?: string;
  logo?: string;
}

export interface KassalappPriceHistoryItem {
  price: number;
  date: string;
}

export interface KassalappProduct {
  id: number;
  name: string;
  brand?: string | null;
  vendor?: string | null;
  ean?: string | null;
  url?: string;
  image?: string | null;
  description?: string | null;
  ingredients?: string | null;
  current_price: number | null;
  weight?: number | null;
  weight_unit?: string | null;
  store?: KassalappStoreObj | null;
  price_history?: KassalappPriceHistoryItem[];
  allergens?: Array<{
    code: string;
    display_name: string;
    contains: 'YES' | 'NO' | 'CAN_CONTAIN_TRACES';
  }>;
}

export interface KassalappApiResponse {
  data: KassalappProduct[];
}

const KASSALAPP_BASE_URL = 'https://kassal.app/api/v1';

/**
 * Mapper Kassalapp sin `store.code` eller `store.name` til vår `StoreChain`.
 */
export function mapKassalappStoreToChain(store?: KassalappStoreObj | null): StoreChain | null {
  if (!store) return null;
  const raw = `${store.code} ${store.name}`.toUpperCase();

  if (raw.includes('REMA')) return 'REMA_1000';
  if (raw.includes('KIWI')) return 'KIWI';
  if (raw.includes('MENY')) return 'MENY';
  if (raw.includes('COOP_EXTRA') || raw.includes('EXTRA')) return 'COOP_EXTRA';
  if (raw.includes('SPAR') || raw.includes('EUROSPAR')) return 'SPAR';
  if (raw.includes('JOKER')) return 'JOKER';
  if (raw.includes('ODA') || raw.includes('KOLONIAL')) return 'ODA';

  return null;
}

/**
 * Standard søkeord for høyprotein vegansk matplan ved oppslag mot Kassalapp API.
 */
export const DEFAULT_KASSALAPP_SEARCH_TERMS = [
  'tofu',
  'røde linser',
  'kikerter',
  'svarte bønner',
  'edamame',
  'brokkoli',
  'søtpotet',
  'spinat',
  'tahini',
  'miso',
  'kokosmelk',
  'hakkede tomater',
  'quinoa',
  'basmatiris'
];

/**
 * Henter og normaliserer produktpriser/tilbud fra Kassalapp API (`https://kassal.app/api/v1/products`).
 * Krever `KASSALAPP_API_KEY` i miljøvariabler. Returnerer tom liste hvis API-nøkkel ikke er satt.
 */
export async function fetchOffersFromKassalapp(options?: {
  apiKey?: string;
  searchTerms?: string[];
  validFrom?: string;
  validUntil?: string;
}): Promise<NormalizedOffer[]> {
  const apiKey = options?.apiKey ?? process.env.KASSALAPP_API_KEY;
  if (!apiKey) {
    return [];
  }

  const terms = options?.searchTerms ?? DEFAULT_KASSALAPP_SEARCH_TERMS;
  const now = new Date();
  const validFrom = options?.validFrom ?? now.toISOString().slice(0, 10);
  const nextWeek = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
  const validUntil = options?.validUntil ?? nextWeek.toISOString().slice(0, 10);

  const normalizedOffers: NormalizedOffer[] = [];
  const seenIds = new Set<string>();

  for (const term of terms) {
    try {
      const url = new URL(`${KASSALAPP_BASE_URL}/products`);
      url.searchParams.set('search', term);
      url.searchParams.set('size', '25');
      url.searchParams.set('unique', '1');

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as KassalappApiResponse;
      if (!Array.isArray(payload.data)) continue;

      for (const item of payload.data) {
        const chain = mapKassalappStoreToChain(item.store);
        if (!chain || !item.current_price || item.current_price <= 0) {
          continue;
        }

        const allergenNames = (item.allergens ?? [])
          .filter((a) => a.contains === 'YES')
          .map((a) => `${a.code} ${a.display_name}`);

        const safety = checkVeganAndPeanutSafety(
          item.name,
          `${item.description ?? ''} ${item.ingredients ?? ''}`,
          allergenNames
        );
        if (!safety.isVeganSafe) {
          continue;
        }

        // Finn historisk makspris for å avdekke om varen har priskutt / tilbud i Kassalapp
        const historicalPrices = (item.price_history ?? [])
          .map((h) => h.price)
          .filter((p) => typeof p === 'number' && p > item.current_price!);

        const regularPrice =
          historicalPrices.length > 0 ? Math.max(...historicalPrices) : undefined;

        const { discountAmountNok, discountPercent } = computeDiscountMetrics(
          item.current_price,
          regularPrice
        );

        const id = `kassalapp-${chain.toLowerCase()}-${item.id}`;
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const unitDescription =
          item.weight && item.weight_unit ? `${item.weight}${item.weight_unit}` : undefined;

        const tags = extractNormalizedTags(item.name, [term]);
        const category = categorizeOffer(item.name, tags);

        normalizedOffers.push({
          id,
          productName: item.name,
          normalizedTags: tags,
          chain,
          category,
          offerPrice: item.current_price,
          regularPrice,
          discountAmountNok,
          discountPercent,
          unitDescription,
          validFrom,
          validUntil,
          source: 'KASSALAPP_API',
          imageUrl: item.image ?? undefined,
          isVeganSafe: true
        });
      }
    } catch {
      // Ignorer enkeltfeil ved nettverkskall og gå videre til neste søkeord
    }
  }

  return normalizedOffers;
}
