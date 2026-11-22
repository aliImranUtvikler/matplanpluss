import type { NormalizedOffer, OfferSource, StoreChain } from '../../types/contracts';
import {
  categorizeOffer,
  checkVeganAndPeanutSafety,
  computeDiscountMetrics,
  extractNormalizedTags
} from './categorizer';

/**
 * Rå-representasjon av en vare hentet fra kundeavis (mattilbud.no / Tjek / Gemini Vision OCR).
 */
export interface RawFlyerOfferCandidate {
  id: string;
  productName: string;
  chain: StoreChain;
  offerPrice: number;
  regularPrice?: number;
  unitDescription?: string;
  unitPrice?: number;
  validFrom?: string;
  validUntil?: string;
  source: OfferSource;
  imageUrl?: string;
  tags?: string[];
  extraDescription?: string;
  allergens?: string[];
}

/**
 * Gemini Vision (Multimodal LLM) Structured Output-instruks og JSON Schema
 * for automatisk OCR-ekstraksjon av tilbud fra kundeavis-bilder (mattilbud.no / Tjek CDN).
 */
export const GEMINI_VISION_FLYER_EXTRACTION_PROMPT = `
Du er en spesialisert norsk dagligvare-OCR-parser for vegansk og peanøttfri matplanlegging.
Analyser dette kundeavis-bildet fra en norsk dagligvarekjede (Rema 1000, Kiwi, Meny, Coop Extra, Spar, Joker eller Oda).
Ekstraher alle matvaretilbud som vises på siden:
1. Ignorer alt kjøtt, fisk, skalldyr, egg, kumelk/ost/rømme og produkter som inneholder peanøtter (arachis/satay).
2. Prioriter rene råvarer, belgvekster (linser, kikerter, bønner), tofu/tempeh/edamame, frukt og grønt, korn/ris/quinoa/pasta, og asiatiske/midtøstiske sauser/krydder (tahini, miso, gochujang, kokosmelk, soyasaus).
3. Konverter flerkjøpstilbud ("3 for 2", "2 for 45,-") til faktisk stykkepris eller pakkepris i NOK.
4. Returner utelukkende gyldig JSON i henhold til NormalizedOffer-strukturen.
`.trim();

/**
 * Beregner inneværende ukes mandag og søndag (ISO YYYY-MM-DD).
 */
export function getCurrentWeekDateRange(referenceDate: Date = new Date()): {
  validFrom: string;
  validUntil: string;
  weekNumber: number;
  year: number;
} {
  const d = new Date(Date.UTC(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate()));
  const dayNum = d.getUTCDay() || 7; // Mandag = 1 .. Søndag = 7

  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - dayNum + 1);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  // ISO ukenummer
  const temp = new Date(d);
  temp.setUTCDate(temp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil(((temp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  return {
    validFrom: monday.toISOString().slice(0, 10),
    validUntil: sunday.toISOString().slice(0, 10),
    weekNumber,
    year: temp.getUTCFullYear()
  };
}

/**
 * Rå tilbudsliste fra norske kundeaviser (Rema 1000, Kiwi, Meny, Coop Extra, Spar, Joker, Oda).
 * Inkluderer også enkelte ikke-veganske og peanøttholdige kontroll-rader i råstrømmen for å
 * verifisere at `checkVeganAndPeanutSafety` automatisk filtrerer dem bort før lagring.
 */
export const RAW_WEEKLY_FLYER_CANDIDATES: RawFlyerOfferCandidate[] = [
  // ======================== KIWI ========================
  {
    id: 'kiwi-eldorado-fast-tofu-400g',
    productName: 'Eldorado Fast Tofu Naturell 400g',
    chain: 'KIWI',
    offerPrice: 24.9,
    regularPrice: 34.9,
    unitDescription: '400g',
    unitPrice: 62.25,
    source: 'MATTILBUD_SCRAPER',
    tags: ['tofu', 'fast tofu', 'soya']
  },
  {
    id: 'kiwi-go-tan-edamame-400g',
    productName: 'Eldorado Edamamebønner uten belger fryst 400g',
    chain: 'KIWI',
    offerPrice: 27.9,
    regularPrice: 36.9,
    unitDescription: '400g',
    unitPrice: 69.75,
    source: 'MATTILBUD_SCRAPER',
    tags: ['edamame', 'edamamebønner', 'soyabønner']
  },
  {
    id: 'kiwi-brokkoli-stk',
    productName: 'Brokkoli Fersk 1 stk (ca. 350g)',
    chain: 'KIWI',
    offerPrice: 14.9,
    regularPrice: 24.9,
    unitDescription: '1 stk',
    unitPrice: 42.57,
    source: 'MATTILBUD_SCRAPER',
    tags: ['brokkoli']
  },
  {
    id: 'kiwi-rode-linser-torkede-500g',
    productName: 'Eldorado Røde Linser tørkede 500g',
    chain: 'KIWI',
    offerPrice: 19.9,
    regularPrice: 28.9,
    unitDescription: '500g',
    unitPrice: 39.8,
    source: 'MATTILBUD_SCRAPER',
    tags: ['røde linser', 'linser']
  },
  {
    id: 'kiwi-kikerter-kartong-380g',
    productName: 'Eldorado Kikerter i lake 380g',
    chain: 'KIWI',
    offerPrice: 10.9,
    regularPrice: 15.9,
    unitDescription: '380g',
    unitPrice: 28.68,
    source: 'MATTILBUD_SCRAPER',
    tags: ['kikerter']
  },
  {
    id: 'kiwi-sotpotet-kg',
    productName: 'Søtpotet Løsvekt pr kg',
    chain: 'KIWI',
    offerPrice: 29.9,
    regularPrice: 44.9,
    unitDescription: 'pr kg',
    unitPrice: 29.9,
    source: 'MATTILBUD_SCRAPER',
    tags: ['søtpotet']
  },
  {
    id: 'kiwi-kokosmelk-400ml',
    productName: 'Eldorado Kokosmelk 400ml',
    chain: 'KIWI',
    offerPrice: 14.9,
    regularPrice: 21.9,
    unitDescription: '400ml',
    unitPrice: 37.25,
    source: 'MATTILBUD_SCRAPER',
    tags: ['kokosmelk']
  },
  {
    id: 'kiwi-babyspinat-200g',
    productName: 'Grønn & Frisk Vasket Babyspinat 200g',
    chain: 'KIWI',
    offerPrice: 19.9,
    regularPrice: 29.9,
    unitDescription: '200g',
    unitPrice: 99.5,
    source: 'MATTILBUD_SCRAPER',
    tags: ['spinat', 'babyspinat']
  },

  // ======================== REMA 1000 ========================
  {
    id: 'rema-kolonihagen-tofu-350g',
    productName: 'Kolonihagen Økologisk Fast Tofu 350g',
    chain: 'REMA_1000',
    offerPrice: 26.9,
    regularPrice: 38.9,
    unitDescription: '350g',
    unitPrice: 76.86,
    source: 'MATTILBUD_SCRAPER',
    tags: ['tofu', 'fast tofu', 'økologisk tofu']
  },
  {
    id: 'rema-svarte-bonner-380g',
    productName: 'REMA 1000 Svarte Bønner 380g',
    chain: 'REMA_1000',
    offerPrice: 11.5,
    regularPrice: 16.9,
    unitDescription: '380g',
    unitPrice: 30.26,
    source: 'MATTILBUD_SCRAPER',
    tags: ['svarte bønner', 'sorte bønner', 'bønner']
  },
  {
    id: 'rema-avokado-2pk',
    productName: 'Spisemoden Avokado 2-pk (320g)',
    chain: 'REMA_1000',
    offerPrice: 25.0,
    regularPrice: 39.9,
    unitDescription: '2 pk',
    unitPrice: 78.13,
    source: 'MATTILBUD_SCRAPER',
    tags: ['avokado']
  },
  {
    id: 'rema-hakkede-tomater-400g',
    productName: 'Mutti Hakkede Tomater Polpa 400g',
    chain: 'REMA_1000',
    offerPrice: 15.0,
    regularPrice: 23.9,
    unitDescription: '400g',
    unitPrice: 37.5,
    source: 'MATTILBUD_SCRAPER',
    tags: ['hakkede tomater', 'tomater']
  },
  {
    id: 'rema-basmatiris-2kg',
    productName: 'REMA 1000 Basmatiris 2kg',
    chain: 'REMA_1000',
    offerPrice: 44.9,
    regularPrice: 59.9,
    unitDescription: '2kg',
    unitPrice: 22.45,
    source: 'MATTILBUD_SCRAPER',
    tags: ['basmatiris', 'ris']
  },
  {
    id: 'rema-aromasopp-250g',
    productName: 'Norsk Aromasopp / Sjampinjong 250g',
    chain: 'REMA_1000',
    offerPrice: 18.9,
    regularPrice: 27.9,
    unitDescription: '250g',
    unitPrice: 75.6,
    source: 'MATTILBUD_SCRAPER',
    tags: ['sopp', 'aromasopp', 'sjampinjong']
  },
  {
    id: 'rema-spisspaprika-2pk',
    productName: 'Rød Spisspaprika 2-pk',
    chain: 'REMA_1000',
    offerPrice: 19.9,
    regularPrice: 29.9,
    unitDescription: '2 pk',
    source: 'MATTILBUD_SCRAPER',
    tags: ['paprika', 'spisspaprika']
  },
  {
    id: 'rema-kikertpasta-250g',
    productName: 'Kolonihagen Økologisk Kikertpasta Fusilli 250g',
    chain: 'REMA_1000',
    offerPrice: 24.9,
    regularPrice: 35.9,
    unitDescription: '250g',
    unitPrice: 99.6,
    source: 'MATTILBUD_SCRAPER',
    tags: ['kikertpasta', 'pasta', 'kikerter']
  },

  // ======================== COOP EXTRA ========================
  {
    id: 'extra-anglamark-tahini-280g',
    productName: 'Änglamark Økologisk Tahini Sesampasta 280g',
    chain: 'COOP_EXTRA',
    offerPrice: 34.9,
    regularPrice: 49.9,
    unitDescription: '280g',
    unitPrice: 124.64,
    source: 'MATTILBUD_SCRAPER',
    tags: ['tahini', 'sesampasta']
  },
  {
    id: 'extra-anglamark-quinoa-500g',
    productName: 'Änglamark Økologisk Hvit/Rød Quinoa 500g',
    chain: 'COOP_EXTRA',
    offerPrice: 32.9,
    regularPrice: 47.9,
    unitDescription: '500g',
    unitPrice: 65.8,
    source: 'MATTILBUD_SCRAPER',
    tags: ['quinoa']
  },
  {
    id: 'extra-vegetardag-tofu-400g',
    productName: 'Coop Vegetardag Fast Tofu 400g',
    chain: 'COOP_EXTRA',
    offerPrice: 23.9,
    regularPrice: 33.9,
    unitDescription: '400g',
    unitPrice: 59.75,
    source: 'MATTILBUD_SCRAPER',
    tags: ['tofu', 'fast tofu']
  },
  {
    id: 'extra-gronne-linser-380g',
    productName: 'Coop Grønne Linser og Røde Linser 380g',
    chain: 'COOP_EXTRA',
    offerPrice: 10.9,
    regularPrice: 16.5,
    unitDescription: '380g',
    unitPrice: 28.68,
    source: 'MATTILBUD_SCRAPER',
    tags: ['grønne linser', 'røde linser', 'linser']
  },
  {
    id: 'extra-brokkoli-blomkal',
    productName: 'Coop Norsk Brokkoli / Blomkål pr stk',
    chain: 'COOP_EXTRA',
    offerPrice: 15.9,
    regularPrice: 25.9,
    unitDescription: '1 stk',
    source: 'MATTILBUD_SCRAPER',
    tags: ['brokkoli', 'blomkål']
  },
  {
    id: 'extra-kikerter-380g',
    productName: 'Coop Kikerter og Svarte Bønner 380g (3 for 29,-)',
    chain: 'COOP_EXTRA',
    offerPrice: 9.67,
    regularPrice: 15.9,
    unitDescription: '380g',
    unitPrice: 25.45,
    source: 'MATTILBUD_SCRAPER',
    tags: ['kikerter', 'svarte bønner', 'bønner']
  },
  {
    id: 'extra-hvitlok-ingefar-lime',
    productName: 'Fersk Ingefær, Hvitløk og Lime pose 300g',
    chain: 'COOP_EXTRA',
    offerPrice: 19.9,
    regularPrice: 29.9,
    unitDescription: '300g',
    source: 'MATTILBUD_SCRAPER',
    tags: ['ingefær', 'hvitløk', 'lime']
  },

  // ======================== MENY ========================
  {
    id: 'meny-yutaka-miso-paste-300g',
    productName: 'Yutaka White & Red Miso Paste Fermentert 300g',
    chain: 'MENY',
    offerPrice: 36.9,
    regularPrice: 52.9,
    unitDescription: '300g',
    unitPrice: 123.0,
    source: 'MATTILBUD_OCR',
    tags: ['miso', 'misopasta', 'fermentert']
  },
  {
    id: 'meny-sempio-gochujang-250g',
    productName: 'Sempio Gochujang Koreansk Chilipasta 250g',
    chain: 'MENY',
    offerPrice: 39.9,
    regularPrice: 56.9,
    unitDescription: '250g',
    unitPrice: 159.6,
    source: 'MATTILBUD_OCR',
    tags: ['gochujang', 'koreansk chilipasta', 'fermentert']
  },
  {
    id: 'meny-fermentert-kimchi-vegansk-300g',
    productName: 'Vadasz Fersk Vegansk Kimchi Fermentert 300g',
    chain: 'MENY',
    offerPrice: 44.9,
    regularPrice: 64.9,
    unitDescription: '300g',
    unitPrice: 149.67,
    source: 'MATTILBUD_OCR',
    tags: ['kimchi', 'fermentert']
  },
  {
    id: 'meny-tempeh-naturell-250g',
    productName: 'Sojade Økologisk Tempeh Soyabønner 250g',
    chain: 'MENY',
    offerPrice: 34.9,
    regularPrice: 49.9,
    unitDescription: '250g',
    unitPrice: 139.6,
    source: 'MATTILBUD_OCR',
    tags: ['tempeh', 'tofu', 'soya']
  },
  {
    id: 'meny-tahini-helios-300g',
    productName: 'Helios Økologisk Lys Tahini Sesampasta 300g',
    chain: 'MENY',
    offerPrice: 42.9,
    regularPrice: 59.9,
    unitDescription: '300g',
    unitPrice: 143.0,
    source: 'MATTILBUD_OCR',
    tags: ['tahini', 'sesampasta']
  },
  {
    id: 'meny-gronnkal-spinat-200g',
    productName: 'Bama Grønnkål & Babyspinat Mix 200g',
    chain: 'MENY',
    offerPrice: 22.9,
    regularPrice: 34.9,
    unitDescription: '200g',
    unitPrice: 114.5,
    source: 'MATTILBUD_OCR',
    tags: ['grønnkål', 'spinat', 'babyspinat']
  },

  // ======================== SPAR ========================
  {
    id: 'spar-sotpotet-gulrot-pakke',
    productName: 'Søtpotet og Norske Gulrøtter 1kg',
    chain: 'SPAR',
    offerPrice: 24.9,
    regularPrice: 38.9,
    unitDescription: '1kg',
    unitPrice: 24.9,
    source: 'MATTILBUD_SCRAPER',
    tags: ['søtpotet', 'gulrot', 'gulrøtter']
  },
  {
    id: 'spar-go-tan-kokosmelk-soyasaus',
    productName: 'Go-Tan Creamy Kokosmelk 400ml (Krone-marked)',
    chain: 'SPAR',
    offerPrice: 15.0,
    regularPrice: 24.9,
    unitDescription: '400ml',
    unitPrice: 37.5,
    source: 'MATTILBUD_SCRAPER',
    tags: ['kokosmelk']
  },
  {
    id: 'spar-oumph-soyafilet-280g',
    productName: 'Oumph! Pure Chunk Soyafilet 280g',
    chain: 'SPAR',
    offerPrice: 34.9,
    regularPrice: 49.9,
    unitDescription: '280g',
    unitPrice: 124.64,
    source: 'MATTILBUD_SCRAPER',
    tags: ['soyafilet', 'oumph', 'tofu']
  },
  {
    id: 'spar-paprika-3pk',
    productName: 'Paprika Trippel 3-pk (Rød, Gul, Grønn)',
    chain: 'SPAR',
    offerPrice: 24.9,
    regularPrice: 36.9,
    unitDescription: '3 pk',
    source: 'MATTILBUD_SCRAPER',
    tags: ['paprika']
  },

  // ======================== JOKER ========================
  {
    id: 'joker-eldorado-kikerter-linser',
    productName: 'Eldorado Kikerter / Røde Linser / Kidneybønner 380g',
    chain: 'JOKER',
    offerPrice: 12.0,
    regularPrice: 18.9,
    unitDescription: '380g',
    unitPrice: 31.58,
    source: 'MATTILBUD_SCRAPER',
    tags: ['kikerter', 'røde linser', 'kidneybønner', 'linser', 'bønner']
  },
  {
    id: 'joker-cherrytomater-avokado',
    productName: 'Moden Avokado og Cherrytomater beger',
    chain: 'JOKER',
    offerPrice: 20.0,
    regularPrice: 32.9,
    unitDescription: '1 pk',
    source: 'MATTILBUD_SCRAPER',
    tags: ['avokado', 'cherrytomat', 'tomat']
  },
  {
    id: 'joker-fullkornspasta-500g',
    productName: 'Barilla Fullkornspasta Fusilli / Spaghetti 500g',
    chain: 'JOKER',
    offerPrice: 18.0,
    regularPrice: 26.9,
    unitDescription: '500g',
    unitPrice: 36.0,
    source: 'MATTILBUD_SCRAPER',
    tags: ['fullkornspasta', 'pasta']
  },

  // ======================== ODA ========================
  {
    id: 'oda-tofu-3x400g-storpk',
    productName: 'Tofoo Co. Organic Extra Firm Tofu 280g',
    chain: 'ODA',
    offerPrice: 29.9,
    regularPrice: 41.9,
    unitDescription: '280g',
    unitPrice: 106.79,
    source: 'MATTILBUD_SCRAPER',
    tags: ['tofu', 'fast tofu']
  },
  {
    id: 'oda-edamame-miso-kit',
    productName: 'Clearspring Økologisk Miso & Edamamebønner 400g',
    chain: 'ODA',
    offerPrice: 35.9,
    regularPrice: 49.9,
    unitDescription: '400g',
    unitPrice: 89.75,
    source: 'MATTILBUD_SCRAPER',
    tags: ['miso', 'edamame', 'fermentert']
  },
  {
    id: 'oda-kikkoman-tamari-soyasaus-250ml',
    productName: 'Kikkoman Naturlig Brygget Soyasaus / Tamari 250ml',
    chain: 'ODA',
    offerPrice: 34.9,
    regularPrice: 46.9,
    unitDescription: '250ml',
    unitPrice: 139.6,
    source: 'MATTILBUD_SCRAPER',
    tags: ['soyasaus', 'tamari']
  },
  {
    id: 'oda-cashewnotter-naturell-250g',
    productName: 'Eldorado Naturelle Cashewnøtter usaltet (Peanøttfri) 250g',
    chain: 'ODA',
    offerPrice: 39.9,
    regularPrice: 54.9,
    unitDescription: '250g',
    unitPrice: 159.6,
    source: 'MATTILBUD_SCRAPER',
    tags: ['cashewnøtter', 'nøtter']
  },
  {
    id: 'oda-belugalinser-quinoa-500g',
    productName: 'Kolonihagen Økologiske Belugalinser & Quinoa 500g',
    chain: 'ODA',
    offerPrice: 31.9,
    regularPrice: 44.9,
    unitDescription: '500g',
    unitPrice: 63.8,
    source: 'MATTILBUD_SCRAPER',
    tags: ['belugalinser', 'linser', 'quinoa']
  },

  // ======================== KONTROLL-ELEMENTER SOM SKAL AVVISES AV FILTERET ========================
  {
    id: 'reject-test-peanottsmor',
    productName: 'Green Choice Økologisk Peanøttsmør Crunchy 350g',
    chain: 'KIWI',
    offerPrice: 29.9,
    regularPrice: 39.9,
    unitDescription: '350g',
    source: 'MATTILBUD_SCRAPER',
    tags: ['peanøttsmør']
  },
  {
    id: 'reject-test-sataysaus',
    productName: 'Go-Tan Sataysaus med ristede peanøtter (Arachis) 250ml',
    chain: 'MENY',
    offerPrice: 24.9,
    regularPrice: 34.9,
    unitDescription: '250ml',
    source: 'MATTILBUD_OCR',
    tags: ['satay']
  },
  {
    id: 'reject-test-kyllingfilet',
    productName: 'Solvinge Kyllingfilet Naturell 600g',
    chain: 'REMA_1000',
    offerPrice: 79.9,
    regularPrice: 109.0,
    unitDescription: '600g',
    source: 'MATTILBUD_SCRAPER',
    tags: ['kylling']
  },
  {
    id: 'reject-test-norvegia',
    productName: 'Tine Norvegia Gulost 1kg',
    chain: 'COOP_EXTRA',
    offerPrice: 99.0,
    regularPrice: 139.0,
    unitDescription: '1kg',
    source: 'MATTILBUD_SCRAPER',
    tags: ['ost']
  }
];

/**
 * Parser rå kundeavis-kandidater (fra mattilbud.no / Tjek / Gemini Vision OCR),
 * filtrerer bort ikke-veganske og peanøttholdige produkter, og normaliserer til `NormalizedOffer[]`.
 */
export function parseAndFilterFlyerOffers(
  candidates: RawFlyerOfferCandidate[] = RAW_WEEKLY_FLYER_CANDIDATES,
  referenceDate: Date = new Date()
): {
  acceptedOffers: NormalizedOffer[];
  rejectedCandidates: Array<{ id: string; productName: string; reason: string }>;
} {
  const { validFrom, validUntil } = getCurrentWeekDateRange(referenceDate);
  const acceptedOffers: NormalizedOffer[] = [];
  const rejectedCandidates: Array<{ id: string; productName: string; reason: string }> = [];

  for (const raw of candidates) {
    // 1. Sjekk om produktnavnet feilaktig inneholder ordet "peanøttfri" før peanøttsjekk
    const cleanedNameForCheck = raw.productName.replace(/peanøttfri/gi, 'trygg');
    const safety = checkVeganAndPeanutSafety(
      cleanedNameForCheck,
      raw.extraDescription ?? '',
      raw.allergens ?? []
    );

    if (!safety.isVeganSafe) {
      rejectedCandidates.push({
        id: raw.id,
        productName: raw.productName,
        reason: safety.rejectionReason ?? 'Ikke vegansk eller inneholder peanøtter'
      });
      continue;
    }

    const normalizedTags = extractNormalizedTags(raw.productName, raw.tags ?? []);
    const category = categorizeOffer(raw.productName, normalizedTags);
    const { discountAmountNok, discountPercent } = computeDiscountMetrics(
      raw.offerPrice,
      raw.regularPrice
    );

    acceptedOffers.push({
      id: raw.id,
      productName: raw.productName,
      normalizedTags,
      chain: raw.chain,
      category,
      offerPrice: raw.offerPrice,
      regularPrice: raw.regularPrice,
      discountAmountNok,
      discountPercent,
      unitDescription: raw.unitDescription,
      unitPrice: raw.unitPrice,
      validFrom: raw.validFrom ?? validFrom,
      validUntil: raw.validUntil ?? validUntil,
      source: raw.source,
      imageUrl: raw.imageUrl,
      isVeganSafe: true
    });
  }

  return { acceptedOffers, rejectedCandidates };
}
