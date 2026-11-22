import type {
  InventoryItem,
  NormalizedOffer,
  ShoppingListItem,
  StoreChain
} from '../../types/contracts';
import { extractNormalizedTags } from './categorizer';

/**
 * Beregner en match-score (0..100) mellom en ingrediens (med ev. ekstra `searchKeywords`)
 * og et `NormalizedOffer`.
 */
export function scoreOfferMatchForIngredient(
  ingredientName: string,
  offer: NormalizedOffer,
  customSearchKeywords: string[] = []
): number {
  const ingredientLower = ingredientName.trim().toLowerCase();
  const offerNameLower = offer.productName.toLowerCase();
  const offerTagsLower = offer.normalizedTags.map((t) => t.toLowerCase());

  const candidateKeywords = Array.from(
    new Set([
      ingredientLower,
      ...customSearchKeywords.map((k) => k.toLowerCase()),
      ...extractNormalizedTags(ingredientName)
    ])
  ).filter((kw) => kw.length >= 3);

  let bestScore = 0;

  // 1. Eksakt treff på hele ingrediensnavnet i normalizedTags
  if (offerTagsLower.includes(ingredientLower)) {
    bestScore = Math.max(bestScore, 100);
  }

  // 2. Sjekk hvert søkeord fra ingrediensen mot tilbudets normalizedTags og produktnavn
  for (const kw of candidateKeywords) {
    for (const tag of offerTagsLower) {
      if (tag === kw) {
        bestScore = Math.max(bestScore, 90);
      } else if (tag.includes(kw) || kw.includes(tag)) {
        // Unngå for generiske deltreff som bare "bønner" mellom "svarte bønner" og "edamamebønner"
        if (kw === 'bønner' || kw === 'linser' || kw === 'tomater' || kw === 'pasta') {
          bestScore = Math.max(bestScore, 45);
        } else {
          bestScore = Math.max(bestScore, 75);
        }
      }
    }

    if (offerNameLower.includes(kw)) {
      bestScore = Math.max(bestScore, 80);
    }
  }

  return bestScore;
}

/**
 * Tar imot en `ShoppingListItem[]` og matcher hver vare mot `NormalizedOffer[]`
 * basert på `normalizedTags` og valgfri `InventoryItem[]` (`searchKeywords`).
 */
export function matchOffersToShoppingList(
  shoppingList: ShoppingListItem[],
  offers: NormalizedOffer[],
  inventoryItems: InventoryItem[] = [],
  minScoreThreshold: number = 65
): ShoppingListItem[] {
  const safeOffers = offers.filter((o) => o.isVeganSafe);

  return shoppingList.map((item) => {
    const matchingInventory = inventoryItems.find(
      (inv) =>
        inv.name.toLowerCase() === item.ingredientName.toLowerCase() ||
        inv.searchKeywords.some((k) => k.toLowerCase() === item.ingredientName.toLowerCase())
    );

    const searchKeywords = matchingInventory?.searchKeywords ?? [];

    const scoredMatches = safeOffers
      .map((offer) => ({
        offer,
        score: scoreOfferMatchForIngredient(item.ingredientName, offer, searchKeywords)
      }))
      .filter((entry) => entry.score >= minScoreThreshold)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const savingA = a.offer.discountAmountNok ?? 0;
        const savingB = b.offer.discountAmountNok ?? 0;
        if (savingB !== savingA) return savingB - savingA;
        return a.offer.offerPrice - b.offer.offerPrice;
      });

    return {
      ...item,
      matchedOffers: scoredMatches.map((m) => m.offer)
    };
  });
}

/**
 * Grupperer tilbud per kjede (`StoreChain`) for rask oppslag i rute-optimalisering.
 */
export function groupOffersByChain(
  offers: NormalizedOffer[]
): Record<StoreChain, NormalizedOffer[]> {
  const grouped: Record<StoreChain, NormalizedOffer[]> = {
    REMA_1000: [],
    KIWI: [],
    MENY: [],
    COOP_EXTRA: [],
    SPAR: [],
    JOKER: [],
    ODA: []
  };

  for (const offer of offers) {
    if (offer.isVeganSafe && grouped[offer.chain]) {
      grouped[offer.chain].push(offer);
    }
  }

  return grouped;
}

/**
 * Kjente synonymer og søketermer for vanlige oppskriftsingredienser i matplanen.
 */
const INGREDIENT_SYNONYMS: Record<string, string[]> = {
  tofu: ['tofu', 'fast tofu', 'naturli', 'änglamark', 'yipin', 'eldorado'],
  'fast tofu': ['tofu', 'fast tofu'],
  edamame: ['edamame', 'edamamebønner'],
  edamamebønner: ['edamame', 'edamamebønner'],
  brokkoli: ['brokkoli'],
  kimchi: ['kimchi', 'fermentert'],
  gochujang: ['gochujang', 'chilipaste'],
  soya: ['soyasaus', 'tamari'],
  soyasaus: ['soyasaus', 'tamari'],
  'soyasaus / tamari': ['soyasaus', 'tamari'],
  sesamolje: ['sesamolje'],
  riseddik: ['riseddik'],
  hvitløk: ['hvitløk'],
  ingefær: ['ingefær'],
  'hvitløk & ingefær': ['hvitløk', 'ingefær'],
  linser: ['røde linser', 'linser', 'belgvekster'],
  'røde linser': ['røde linser', 'linser', 'belgvekster'],
  'røde linser (tørre)': ['røde linser', 'linser', 'belgvekster'],
  'soya chunks': ['soya chunks', 'soyagranulat', 'soya mince'],
  'soya chunks (tørre)': ['soya chunks', 'soyagranulat', 'soya mince'],
  'trs soya mince (tørr)': ['soya chunks', 'soya mince', 'soyagranulat'],
  ris: ['jasminris', 'basmatiris', 'ris', 'fullkornsris'],
  'glutenrik ris': ['jasminris', 'basmatiris', 'klebrig ris', 'ris'],
  basmatiris: ['basmatiris', 'brun basmatiris', 'ris'],
  jasminris: ['jasminris', 'ris'],
  spinat: ['babyspinat', 'spinat'],
  tomater: ['hakkede tomater', 'hverdagstomater', 'tomater', 'tomatmiks'],
  'hakkede tomater': ['hakkede tomater', 'tomatsaus', 'pizzasaus'],
  kokosmelk: ['kokosmelk'],
  solsikkekjerner: ['solsikkekjerner', 'solsikkefrø'],
  kikertfusilli: ['kikertfusilli', 'fusilli', 'pasta'],
  pasta: ['fullkornspasta', 'fiberpasta', 'pasta', 'penne', 'fusilli'],
  tahini: ['tahini', 'sesampasta'],
  kikerter: ['kikerter', 'belgvekster'],
  tempeh: ['tempeh'],
  bønner: ['svarte bønner', 'kidneybønner', 'bønner'],
  'svarte bønner': ['svarte bønner', 'bønner'],
  søtpotet: ['søtpotet', 'søtpoteter'],
  potet: ['poteter', 'potet', 'mandelpotet'],
  poteter: ['poteter', 'potet', 'mandelpotet'],
  gulrot: ['gulrot', 'gulrøtter'],
  gulrøtter: ['gulrot', 'gulrøtter'],
  miso: ['miso', 'hvit miso'],
  'miso paste': ['miso', 'hvit miso'],
  cashew: ['cashewnøtter', 'cashew'],
  cashewnøtter: ['cashewnøtter', 'cashew'],
  quinoa: ['quinoa'],
  avokado: ['avokado'],
  mango: ['mango'],
  epler: ['epler', 'eple'],
  klementiner: ['klementiner'],
  pærer: ['pærer'],
  vårløk: ['vårløk'],
  næringsgjær: ['næringsgjær', 'nooch'],
  sesamfrø: ['sesamfrø']
};

/**
 * Finner de beste matchende tilbudene for et oppgitt ingrediensnavn (f.eks. "Fast tofu", "Edamamebønner", "Brokkoli", "Kimchi").
 * 
 * - Tar hensyn til parenteser og mengdebeskrivelser (f.eks. "(198g (99g per pers))")
 * - Bruker synonymer og normaliserte søketermer
 * - Returnerer unike tilbud sortert etter treffscore og lavest pris / høyest rabatt
 * - 100% browser-sikker (ingen Node-avhengigheter, perfekt for direkte bruk i React-komponenter)
 */
export function findMatchingOffersForIngredientName(
  ingredientName: string,
  offers: NormalizedOffer[] = [],
  limit: number = 3
): NormalizedOffer[] {
  if (!ingredientName || !offers || offers.length === 0) return [];

  // 1. Rens navnet for parenteser, vektangivelser og ekstra støy
  const cleanName = ingredientName
    .split('(')[0]
    .replace(/[^\p{L}\p{N}\s\/\-&]/gu, ' ')
    .trim()
    .toLowerCase();

  if (cleanName.length < 2) return [];

  // 2. Finn synonymer og relevante søkeord med nøyaktig ordmatching
  const matchedSynonyms: string[] = [];
  const wordsInCleanName = cleanName.split(/\s+/);
  for (const [key, synonyms] of Object.entries(INGREDIENT_SYNONYMS)) {
    // Unngå at "søtpotet" feilaktig matcher vanlige poteter
    if (cleanName.includes('søtpotet') && key.includes('potet') && !key.includes('søtpotet')) {
      continue;
    }
    const keyWords = key.split(/\s+/);
    const isWordMatch = keyWords.every((kw) => wordsInCleanName.includes(kw));
    if (cleanName === key || isWordMatch || (key.length >= 5 && cleanName.includes(key))) {
      matchedSynonyms.push(...synonyms);
    }
  }

  // 3. Splitt sammensatte ingredienser (f.eks. "Soyasaus / Tamari", "Hvitløk & Ingefær")
  const splitKeywords = cleanName
    .split(/[\/&,]| og /)
    .map((k) => k.trim())
    .filter((k) => k.length >= 3);

  const allSearchKeywords = Array.from(
    new Set([cleanName, ...splitKeywords, ...matchedSynonyms])
  )
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length >= 2);

  // 4. Score alle trygge tilbud mot ingrediensen
  const safeOffers = offers.filter((o) => o.isVeganSafe);
  const scoredOffers: Array<{ offer: NormalizedOffer; score: number }> = [];

  for (const offer of safeOffers) {
    const offerName = offer.productName.toLowerCase();
    const offerTags = offer.normalizedTags.map((t) => t.toLowerCase());

    let matchScore = 0;

    // Prioriter eksakt treff på hele ingrediensnavnet
    if (offerTags.includes(cleanName)) {
      matchScore = Math.max(matchScore, 100);
    }

    for (const kw of allSearchKeywords) {
      // Eksakt treff i tags
      if (offerTags.includes(kw)) {
        matchScore = Math.max(matchScore, 95);
      }

      // Eksakt ordtreff i produktnavn (regex-escaped)
      const escapedKw = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wordRegex = new RegExp(`(^|[^a-zæøå])${escapedKw}($|[^a-zæøå])`, 'i');
      if (wordRegex.test(offerName)) {
        matchScore = Math.max(matchScore, 90);
      } else if (offerName.includes(kw)) {
        // Unngå for brede deltreff som bare "soya" i "soyasaus" hvis vi ser etter "soya chunks"
        if (kw === 'soya' && offerName.includes('soyasaus')) {
          matchScore = Math.max(matchScore, 40);
        } else {
          matchScore = Math.max(matchScore, 75);
        }
      }

      // Deltreff i tags (unngå generiske kategoritagger som 'saus', 'olje', 'krydder', 'kjøl')
      const GENERIC_CATEGORY_TAGS = ['saus', 'olje', 'krydder', 'kjøl', 'frukt', 'grønt', 'grønnsaker', 'tørrvarer', 'karbohydrat', 'belgvekster', 'drikke', 'brus'];
      for (const tag of offerTags) {
        if (GENERIC_CATEGORY_TAGS.includes(tag)) continue;
        if (tag.includes(kw) && kw.length >= 3) {
          matchScore = Math.max(matchScore, 75);
        } else if (kw.includes(tag) && tag.length >= 4) {
          matchScore = Math.max(matchScore, 70);
        }
      }
    }

    if (matchScore >= 75) {
      scoredOffers.push({ offer, score: matchScore });
    }
  }

  // 5. Sorter etter: 1. Score synkende, 2. Rabattkroner synkende, 3. Tilbudspris stigende
  scoredOffers.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const savingA = a.offer.discountAmountNok ?? 0;
    const savingB = b.offer.discountAmountNok ?? 0;
    if (savingB !== savingA) return savingB - savingA;
    return a.offer.offerPrice - b.offer.offerPrice;
  });

  // 6. Dedupliser: Maks 1 tilbud per butikkjede for å gi brukeren mangfold (f.eks. KIWI vs EXTRA)
  const seenChains = new Set<string>();
  const result: NormalizedOffer[] = [];

  for (const entry of scoredOffers) {
    if (!seenChains.has(entry.offer.chain)) {
      seenChains.add(entry.offer.chain);
      result.push(entry.offer);
      if (result.length >= limit) break;
    }
  }

  return result;
}

/**
 * Hjelper som returnerer kort visningsnavn for en butikkjede (f.eks. "KIWI", "EXTRA", "REMA").
 */
export function getStoreChainShortName(chain: StoreChain): string {
  switch (chain) {
    case 'KIWI':
      return 'KIWI';
    case 'COOP_EXTRA':
      return 'EXTRA';
    case 'REMA_1000':
      return 'REMA';
    case 'MENY':
      return 'MENY';
    case 'SPAR':
      return 'SPAR';
    case 'JOKER':
      return 'JOKER';
    case 'ODA':
      return 'ODA';
    default:
      return chain;
  }
}

/**
 * Hjelper som returnerer farger og styling for butikkjede-badger i Tailwind CSS.
 */
export function getStoreChainBadgeStyle(chain: StoreChain): {
  bg: string;
  text: string;
  border: string;
  badgeClass: string;
  label: string;
} {
  const shortName = getStoreChainShortName(chain);

  switch (chain) {
    case 'KIWI':
      return {
        bg: 'bg-emerald-500/15',
        text: 'text-emerald-400',
        border: 'border-emerald-500/40',
        badgeClass: 'bg-emerald-950/80 text-emerald-300 border-emerald-600/60 hover:bg-emerald-900/80',
        label: shortName
      };
    case 'COOP_EXTRA':
      return {
        bg: 'bg-orange-500/15',
        text: 'text-orange-400',
        border: 'border-orange-500/40',
        badgeClass: 'bg-orange-950/80 text-orange-300 border-orange-600/60 hover:bg-orange-900/80',
        label: shortName
      };
    case 'REMA_1000':
      return {
        bg: 'bg-blue-500/15',
        text: 'text-blue-400',
        border: 'border-blue-500/40',
        badgeClass: 'bg-blue-950/80 text-blue-300 border-blue-600/60 hover:bg-blue-900/80',
        label: shortName
      };
    case 'MENY':
      return {
        bg: 'bg-rose-500/15',
        text: 'text-rose-400',
        border: 'border-rose-500/40',
        badgeClass: 'bg-rose-950/80 text-rose-300 border-rose-600/60 hover:bg-rose-900/80',
        label: shortName
      };
    case 'SPAR':
      return {
        bg: 'bg-red-500/15',
        text: 'text-red-400',
        border: 'border-red-500/40',
        badgeClass: 'bg-red-950/80 text-red-300 border-red-600/60 hover:bg-red-900/80',
        label: shortName
      };
    case 'JOKER':
      return {
        bg: 'bg-amber-500/15',
        text: 'text-amber-400',
        border: 'border-amber-500/40',
        badgeClass: 'bg-amber-950/80 text-amber-300 border-amber-600/60 hover:bg-amber-900/80',
        label: shortName
      };
    case 'ODA':
      return {
        bg: 'bg-yellow-500/15',
        text: 'text-yellow-400',
        border: 'border-yellow-500/40',
        badgeClass: 'bg-yellow-950/80 text-yellow-300 border-yellow-600/60 hover:bg-yellow-900/80',
        label: shortName
      };
    default:
      return {
        bg: 'bg-slate-800',
        text: 'text-slate-300',
        border: 'border-slate-700',
        badgeClass: 'bg-slate-800 text-slate-300 border-slate-700',
        label: shortName
      };
  }
}

