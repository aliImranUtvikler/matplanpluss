import fs from 'node:fs';
import path from 'node:path';
import type {
  FlyerPageAsset,
  FlyerPageScanResult,
  NormalizedOffer,
  OfferCategory,
  OfferSource,
  StoreChain,
  WeeklyOffersDataset
} from '../../types/contracts';
import {
  categorizeOffer,
  checkVeganAndPeanutSafety,
  computeDiscountMetrics,
  extractNormalizedTags
} from './categorizer';
import { getCurrentWeekDateRange } from './mattilbudParser';

/**
 * System-instruks for Gemini Vision Multimodal analyse av kundeavis-sider
 */
export const GEMINI_FLYER_PAGE_SYSTEM_PROMPT = `
Du er en spesialisert norsk dagligvare-OCR og Vision-assistent for vegansk og peanøttfritt kosthold.
Du analyserer et bilde av én enkelt side fra en norsk kundeavis (Rema 1000, Kiwi, Meny, Coop Extra, Spar, Joker eller Oda).

Oppgave:
1. Les og identifiser ALLE matvarer og tilbud som er trykket på denne spesifikke kundeavis-siden.
2. For hvert produkt: les nøyaktig produktnavn, tilbudspris i NOK, ordinær førpris (hvis oppgitt), enhetsbeskrivelse (f.eks. "400g", "1 stk", "pr kg"), og oppgitte ingredienser/allergener.
3. Vær EKSTREMT oppmerksom på allergener og ingredienser:
   - Noter eksplisitt om varen inneholder peanøtt (eller derivater som satay, arachis, peanøttolje).
   - Noter eksplisitt om varen inneholder animalske ingredienser (kjøtt, kylling, svin, storfekjøtt, fisk, skalldyr, gelatin, melk, egg, ost, smør).
4. Returner utelukkende et gyldig JSON-objekt som følger det angitte skjemaet.
`.trim();

/**
 * JSON Schema for strukturert Gemini Vision uttrekk per kundeavis-side
 */
export const GEMINI_PAGE_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    pageNumber: { type: 'integer' },
    flyerId: { type: 'string' },
    offers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          productName: { type: 'string' },
          offerPrice: { type: 'number' },
          regularPrice: { type: 'number' },
          unitDescription: { type: 'string' },
          unitPrice: { type: 'number' },
          detectedTags: {
            type: 'array',
            items: { type: 'string' }
          },
          detectedIngredientsOrAllergens: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['productName', 'offerPrice']
      }
    }
  },
  required: ['offers']
};

/**
 * Rå kandidatvare som vises på en spesifikk side
 */
export interface RawPageItemCandidate {
  rawId: string;
  productName: string;
  offerPrice: number;
  regularPrice?: number;
  unitDescription?: string;
  unitPrice?: number;
  tags?: string[];
  allergens?: string[];
  imageUrl?: string;
}

/**
 * Simulerings-data og forhåndsanalyse for kundeavis-sider
 */
export interface FlyerPageSimTemplate {
  chain: StoreChain;
  flyerId: string;
  pageNumber: number;
  totalPages: number;
  imageFileName: string;
  itemsOnPage: RawPageItemCandidate[];
}

/**
 * Konverterer Mattilbud/Tjek-slugs til StoreChain enum
 */
export function mapSlugToStoreChain(slug: string): StoreChain {
  switch (slug.toLowerCase()) {
    case 'kiwi':
      return 'KIWI';
    case 'rema-1000':
    case 'rema':
      return 'REMA_1000';
    case 'extra':
    case 'coop-extra':
      return 'COOP_EXTRA';
    case 'meny':
      return 'MENY';
    case 'spar':
    case 'eurospar':
      return 'SPAR';
    case 'joker':
      return 'JOKER';
    case 'oda':
      return 'ODA';
    default:
      return 'KIWI';
  }
}

/**
 * Konverterer StoreChain enum til undermappenavn for kundeaviser
 */
export function mapStoreChainToFolder(chain: StoreChain): string {
  switch (chain) {
    case 'KIWI':
      return 'kiwi';
    case 'REMA_1000':
      return 'rema-1000';
    case 'COOP_EXTRA':
      return 'extra';
    case 'MENY':
      return 'meny';
    case 'SPAR':
      return 'spar';
    case 'JOKER':
      return 'joker';
    case 'ODA':
      return 'oda';
    default:
      return (chain as string).toLowerCase().replace(/_/g, '-');
  }
}

/**
 * Struktur for den menneskeredigerbare offers.json per butikkmappe
 */
export interface EditableStoreOffersFile {
  chain: StoreChain;
  weekKey: string;
  updatedAt?: string;
  description?: string;
  pages: Array<{
    pageNumber: number;
    imageFile?: string;
    items: RawPageItemCandidate[];
  }>;
}

// In-memory cache for parsed offers.json
const storeOffersCache = new Map<string, EditableStoreOffersFile>();

/**
 * Tømmer cachet offers.json fra minnet (f.eks. ved ny skanning eller re-kjøring)
 */
export function clearStoreOffersCache(): void {
  storeOffersCache.clear();
}

/**
 * Finner filbanen til offers.json for en gitt kjede eller lokal filbane
 */
export function resolveStoreOffersJsonPath(chain: StoreChain, localFilePath?: string): string | null {
  if (localFilePath) {
    const dir = path.dirname(localFilePath);
    const candidate = path.join(dir, 'offers.json');
    if (fs.existsSync(candidate)) return candidate;
  }

  const folder = mapStoreChainToFolder(chain);

  // 1. Sjekk latest-week.json peker
  const pointerPath = path.resolve(process.cwd(), 'data/flyers/latest-week.json');
  if (fs.existsSync(pointerPath)) {
    try {
      const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf-8'));
      const weekDir = pointer.weekDir || path.join('data/flyers', pointer.weekKey);
      const candidate = path.resolve(process.cwd(), weekDir, folder, 'offers.json');
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }

  // 2. Sjekk direkte i data/flyers/<folder>/offers.json
  const fallback = path.resolve(process.cwd(), 'data/flyers', folder, 'offers.json');
  if (fs.existsSync(fallback)) return fallback;

  return null;
}

/**
 * Leser tilbudskandidater direkte fra butikkens egne offers.json hvis den eksisterer.
 * Dette er den primære kilden som gjør det enkelt for brukeren å korrigere funn direkte i JSON!
 */
export function loadOffersFromStoreJson(page: FlyerPageAsset): RawPageItemCandidate[] | null {
  const filePath = resolveStoreOffersJsonPath(page.chain, page.localFilePath);
  if (!filePath || !fs.existsSync(filePath)) return null;

  try {
    let data = storeOffersCache.get(filePath);
    if (!data) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      data = JSON.parse(raw) as EditableStoreOffersFile;
      storeOffersCache.set(filePath, data);
    }

    if (data && Array.isArray(data.pages)) {
      const pageEntry = data.pages.find((p) => p.pageNumber === page.pageNumber);
      if (pageEntry && Array.isArray(pageEntry.items)) {
        return pageEntry.items;
      }
      // Hvis offers.json finnes og inneholder sider, betyr det at denne butikken er skannet.
      // Hvis denne spesifikke siden ikke har en egen entry, betyr det 0 veganske tilbud på denne siden (returner tom array istedenfor null).
      return [];
    }
  } catch (err) {
    console.warn(`[FlyerScanner] Kunne ikke lese ${filePath}:`, err);
  }

  return null;
}

/**
 * Lagrer eller oppdaterer tilbud i butikkens offers.json (både i data/ og public/data/)
 * når AI Vision skanner en ny side eller brukeren oppdaterer tilbudene.
 */
export function saveOffersToStoreJson(
  chain: StoreChain,
  pageNumber: number,
  items: RawPageItemCandidate[],
  options?: { localFilePath?: string; imageFileName?: string; weekKey?: string }
): void {
  try {
    let filePath = resolveStoreOffersJsonPath(chain, options?.localFilePath);
    const folder = mapStoreChainToFolder(chain);

    if (!filePath) {
      const pointerPath = path.resolve(process.cwd(), 'data/flyers/latest-week.json');
      const weekRange = getCurrentWeekDateRange();
      let weekDir = 'data/flyers';
      let weekKey = options?.weekKey || `${weekRange.year}-W${String(weekRange.weekNumber).padStart(2, '0')}`;

      if (fs.existsSync(pointerPath)) {
        try {
          const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf-8'));
          weekDir = pointer.weekDir || path.join('data/flyers', pointer.weekKey);
          weekKey = pointer.weekKey || weekKey;
        } catch {
          // ignore
        }
      }

      const targetDir = path.resolve(process.cwd(), weekDir, folder);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      filePath = path.join(targetDir, 'offers.json');
    }

    let fileData: EditableStoreOffersFile;
    if (fs.existsSync(filePath)) {
      try {
        fileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        fileData = {
          chain,
          weekKey: options?.weekKey || 'current',
          description: 'Redigerbare tilbudsfunn fra ukens kundeavis. Legg til, fjern eller endre varer her.',
          pages: []
        };
      }
    } else {
      fileData = {
        chain,
        weekKey: options?.weekKey || 'current',
        description: 'Redigerbare tilbudsfunn fra ukens kundeavis. Legg til, fjern eller endre varer her.',
        pages: []
      };
    }

    fileData.updatedAt = new Date().toISOString();

    const existingPageIndex = fileData.pages.findIndex((p) => p.pageNumber === pageNumber);
    const pageObj = {
      pageNumber,
      imageFile: options?.imageFileName || path.basename(options?.localFilePath || `page-${pageNumber}.webp`),
      items
    };

    if (existingPageIndex >= 0) {
      fileData.pages[existingPageIndex] = pageObj;
    } else {
      fileData.pages.push(pageObj);
      fileData.pages.sort((a, b) => a.pageNumber - b.pageNumber);
    }

    fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2) + '\n', 'utf-8');
    storeOffersCache.set(filePath, fileData);

    // Speil også til public/data/ hvis data/flyers finnes i stien
    if (filePath.includes('/data/flyers/')) {
      const publicPath = filePath.replace('/data/flyers/', '/public/data/flyers/');
      const publicDir = path.dirname(publicPath);
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }
      fs.writeFileSync(publicPath, JSON.stringify(fileData, null, 2) + '\n', 'utf-8');
    }
  } catch (err) {
    console.warn(`[FlyerScanner] Feil under lagring av offers.json for ${chain}:`, err);
  }
}

/**
 * Leser fysisk nedlastede kundeavis-sider (WebP) fra data/flyers/<ÅR>-W<UKE>/<kjede>/
 * (eller data/flyers/<kjede>/) og konverterer dem til `FlyerPageAsset[]` med Base64 Data URI
 * for multimodal AI Vision-prosessering.
 */
export function loadDownloadedFlyerPages(baseDir = path.resolve(process.cwd(), 'data/flyers')): FlyerPageAsset[] {
  const assets: FlyerPageAsset[] = [];
  if (!fs.existsSync(baseDir)) return assets;

  // Sjekk om latest-week.json peker til en spesifikk ukeskatalog
  let targetDir = baseDir;
  const pointerPath = path.join(baseDir, 'latest-week.json');
  if (fs.existsSync(pointerPath)) {
    try {
      const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf-8'));
      const candidateDir = path.resolve(process.cwd(), pointer.weekDir || path.join('data/flyers', pointer.weekKey));
      if (fs.existsSync(candidateDir)) {
        targetDir = candidateDir;
      }
    } catch (err) {
      console.warn('[FlyerScanner] Kunne ikke lese latest-week.json:', err);
    }
  }

  const chainFolders = fs
    .readdirSync(targetDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const folder of chainFolders) {
    const chainDir = path.join(targetDir, folder);
    const manifestPath = path.join(chainDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    let manifest: {
      slug?: string;
      publicationId?: string;
      totalPagesInFlyer?: number;
      validFrom?: string;
      validUntil?: string;
      downloadedFiles?: Array<{
        type: string;
        pageNumber: number;
        fileName: string;
        localPath?: string;
      }>;
    };

    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch {
      continue;
    }

    const chainEnum = mapSlugToStoreChain(manifest.slug || folder);
    const validFrom = manifest.validFrom || getCurrentWeekDateRange().validFrom;
    const validUntil = manifest.validUntil || getCurrentWeekDateRange().validUntil;
    const totalPages = manifest.totalPagesInFlyer || manifest.downloadedFiles?.length || 4;

    for (const file of manifest.downloadedFiles || []) {
      if (file.type !== 'PAGE_IMAGE') continue;
      const filePath = file.localPath && fs.existsSync(file.localPath)
        ? file.localPath
        : path.join(chainDir, file.fileName);

      if (!fs.existsSync(filePath)) continue;

      try {
        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString('base64');
        const dataUri = `data:image/webp;base64,${base64}`;

        assets.push({
          chain: chainEnum,
          flyerId: manifest.publicationId || `${folder}-flyer`,
          pageNumber: file.pageNumber,
          totalPages,
          imageUrlOrBase64: dataUri,
          localFilePath: filePath,
          mimeType: 'image/webp',
          validFrom,
          validUntil
        });
      } catch (err) {
        console.warn(`Kunne ikke lese bilde fra ${filePath}:`, err);
      }
    }
  }

  return assets;
}

/**
 * Ekte tilbudsdata registrert direkte fra de faktiske nedlastede kundeavis-sidene (Uke 47 / 2026-W47)
 * for KIWI, EXTRA, MENY, SPAR, JOKER og REMA 1000.
 * Inneholder KUN varer som faktisk er avbildet og prissatt i ukens kundeaviser.
 */
export const FLYER_PAGES_SIM_TEMPLATES: FlyerPageSimTemplate[] = [
  // ======================== KIWI (Ekte Uke 47 sider) ========================
  {
    chain: 'KIWI',
    flyerId: 'kiwi-kundeavis-2026',
    pageNumber: 1,
    totalPages: 32,
    imageFileName: 'page-1.webp',
    itemsOnPage: [
      {
        rawId: 'kiwi-p1-poteter',
        productName: 'Små Gule Poteter kokefaste 900g Gartner',
        offerPrice: 19.9,
        regularPrice: 29.9,
        unitDescription: '900g',
        unitPrice: 22.11,
        tags: ['potet', 'poteter', 'gartner', 'karbohydrat']
      },
      {
        rawId: 'kiwi-p1-kalrot',
        productName: 'Norsk Kålrot Gartner',
        offerPrice: 8.9,
        regularPrice: 19.9,
        unitDescription: 'pr kg',
        unitPrice: 8.9,
        tags: ['kålrot', 'gartner', 'norsk kålrot', 'grønnsaker']
      },
      {
        rawId: 'kiwi-p1-lutefisk-ctrl',
        productName: 'Lutefisk Helside Ca. 1,2kg Fiskemannen',
        offerPrice: 179.0,
        regularPrice: 219.0,
        unitDescription: 'pr kg',
        allergens: ['fisk', 'lutefisk'],
        tags: ['lutefisk', 'fisk']
      },
      {
        rawId: 'kiwi-p1-pinnekjott-ctrl',
        productName: 'Pinnekjøtt Røkt/Urøkt kappet Gilde',
        offerPrice: 359.0,
        regularPrice: 419.0,
        unitDescription: 'pr kg',
        allergens: ['lam', 'kjøtt'],
        tags: ['pinnekjøtt', 'kjøtt']
      }
    ]
  },
  {
    chain: 'KIWI',
    flyerId: 'kiwi-kundeavis-2026',
    pageNumber: 2,
    totalPages: 32,
    imageFileName: 'page-2.webp',
    itemsOnPage: [
      {
        rawId: 'kiwi-p2-pinner',
        productName: 'Pinnekjøttpinner 20 stk Unik',
        offerPrice: 19.9,
        unitDescription: '20 stk',
        unitPrice: 0.99,
        tags: ['pinnekjøttpinner', 'kjøkken']
      },
      {
        rawId: 'kiwi-p2-pinnekjott-folkets-ctrl',
        productName: 'Pinnekjøtt fra Oppdal urøkt Folkets',
        offerPrice: 299.0,
        regularPrice: 359.0,
        unitDescription: 'pr kg',
        allergens: ['lam', 'kjøtt'],
        tags: ['pinnekjøtt', 'kjøtt']
      }
    ]
  },
  {
    chain: 'KIWI',
    flyerId: 'kiwi-kundeavis-2026',
    pageNumber: 5,
    totalPages: 32,
    imageFileName: 'page-5.webp',
    itemsOnPage: [
      {
        rawId: 'kiwi-p5-grot-snarkokt',
        productName: 'Risgrøt Snarkokt 148g Toro',
        offerPrice: 24.9,
        regularPrice: 31.5,
        unitDescription: '148g',
        unitPrice: 168.24,
        tags: ['risgrøt', 'grøt', 'karbohydrat', 'toro']
      },
      {
        rawId: 'kiwi-p5-grot-original',
        productName: 'Risgrøt Original 258g Toro',
        offerPrice: 27.9,
        regularPrice: 32.9,
        unitDescription: '258g',
        unitPrice: 108.14,
        tags: ['risgrøt', 'grøt', 'karbohydrat', 'toro']
      },
      {
        rawId: 'kiwi-p5-kalkun-ctrl',
        productName: 'Kalkunfilet Salt og Pepper 1kg Prior',
        offerPrice: 259.0,
        regularPrice: 299.0,
        unitDescription: '1 kg',
        allergens: ['kalkun', 'kjøtt'],
        tags: ['kalkun', 'kjøtt']
      }
    ]
  },
  {
    chain: 'KIWI',
    flyerId: 'kiwi-kundeavis-2026',
    pageNumber: 6,
    totalPages: 32,
    imageFileName: 'page-6.webp',
    itemsOnPage: [
      {
        rawId: 'kiwi-p6-surkal',
        productName: 'Hjemmelaget Surkål 450g Nora',
        offerPrice: 17.9,
        regularPrice: 22.9,
        unitDescription: '450g',
        unitPrice: 39.78,
        tags: ['surkål', 'kål', 'grønnsaker', 'nora']
      },
      {
        rawId: 'kiwi-p6-rodkal',
        productName: 'Hjemmelaget Rødkål 450g Nora',
        offerPrice: 17.9,
        regularPrice: 23.4,
        unitDescription: '450g',
        unitPrice: 39.78,
        tags: ['rødkål', 'kål', 'grønnsaker', 'nora']
      },
      {
        rawId: 'kiwi-p6-pariseragurker',
        productName: 'Pariseragurker Skivede 580g Nora',
        offerPrice: 29.9,
        regularPrice: 36.6,
        unitDescription: '580g',
        unitPrice: 51.55,
        tags: ['pariseragurk', 'agurk', 'sylteagurk', 'grønnsaker', 'nora']
      },
      {
        rawId: 'kiwi-p6-grovsennep',
        productName: 'Grov Sennep 275g Idun',
        offerPrice: 19.9,
        regularPrice: 27.5,
        unitDescription: '275g',
        unitPrice: 72.36,
        tags: ['sennep', 'grov sennep', 'krydder', 'idun']
      },
      {
        rawId: 'kiwi-p6-julepolse-ctrl',
        productName: 'Julepølse kokt 400g Gilde',
        offerPrice: 47.9,
        regularPrice: 54.9,
        unitDescription: '400g',
        allergens: ['svinekjøtt', 'kjøtt'],
        tags: ['julepølse', 'kjøtt']
      }
    ]
  },
  {
    chain: 'KIWI',
    flyerId: 'kiwi-kundeavis-2026',
    pageNumber: 8,
    totalPages: 32,
    imageFileName: 'page-8.webp',
    itemsOnPage: [
      {
        rawId: 'kiwi-p8-julebrus-unil',
        productName: 'Julebrus Uten Sukker 1,5L Unil',
        offerPrice: 17.9,
        regularPrice: 24.9,
        unitDescription: '1,5L',
        unitPrice: 11.93,
        tags: ['julebrus', 'brus', 'drikke', 'sukkerfri']
      },
      {
        rawId: 'kiwi-p8-julebrus-sylte',
        productName: 'Rudolf & Nissens Julebrus Uten Sukker 1,5L Oskar Sylte',
        offerPrice: 21.9,
        regularPrice: 28.9,
        unitDescription: '1,5L',
        unitPrice: 14.6,
        tags: ['julebrus', 'oskar sylte', 'brus', 'drikke']
      },
      {
        rawId: 'kiwi-p8-julebrus-hamar',
        productName: 'Hamar Julebrus Uten Sukker 1,5L',
        offerPrice: 38.9,
        regularPrice: 44.9,
        unitDescription: '1,5L',
        unitPrice: 25.93,
        tags: ['julebrus', 'hamar julebrus', 'brus', 'drikke']
      }
    ]
  },
  {
    chain: 'KIWI',
    flyerId: 'kiwi-kundeavis-2026',
    pageNumber: 10,
    totalPages: 32,
    imageFileName: 'page-10.webp',
    itemsOnPage: [
      {
        rawId: 'kiwi-p10-spisskal',
        productName: 'Rød og Grønn Spisskål Gartner',
        offerPrice: 16.9,
        regularPrice: 19.9,
        unitDescription: 'pr stk',
        tags: ['spisskål', 'kål', 'gartner', 'grønnsaker']
      },
      {
        rawId: 'kiwi-p10-kalrot',
        productName: 'Norsk Kålrot Gartner',
        offerPrice: 8.9,
        regularPrice: 19.9,
        unitDescription: 'pr kg',
        unitPrice: 8.9,
        tags: ['kålrot', 'gartner', 'norsk kålrot', 'grønnsaker']
      },
      {
        rawId: 'kiwi-p10-kinakal',
        productName: 'Norsk Kinakål Gartner',
        offerPrice: 19.9,
        regularPrice: 34.9,
        unitDescription: 'pr stk',
        tags: ['kinakål', 'kål', 'gartner', 'grønnsaker']
      },
      {
        rawId: 'kiwi-p10-purre',
        productName: 'Fersk Purre Gartner',
        offerPrice: 27.9,
        regularPrice: 29.9,
        unitDescription: 'pr kg',
        unitPrice: 27.9,
        tags: ['purre', 'løk', 'gartner', 'grønnsaker']
      },
      {
        rawId: 'kiwi-p10-gulrot',
        productName: 'Norske Gulrøtter 750g Gartner',
        offerPrice: 19.9,
        regularPrice: 34.9,
        unitDescription: '750g',
        unitPrice: 26.53,
        tags: ['gulrot', 'norske gulrøtter', 'gartner', 'grønnsaker']
      }
    ]
  },
  {
    chain: 'KIWI',
    flyerId: 'kiwi-kundeavis-2026',
    pageNumber: 11,
    totalPages: 32,
    imageFileName: 'page-11.webp',
    itemsOnPage: [
      {
        rawId: 'kiwi-p11-mandelpoteter',
        productName: 'Mandelpoteter 2kg Gartner',
        offerPrice: 39.9,
        regularPrice: 59.9,
        unitDescription: '2 kg',
        unitPrice: 19.95,
        tags: ['mandelpotet', 'potet', 'gartner', 'karbohydrat']
      },
      {
        rawId: 'kiwi-p11-poteter',
        productName: 'Små Gule Poteter 900g Gartner',
        offerPrice: 19.9,
        regularPrice: 29.9,
        unitDescription: '900g',
        unitPrice: 22.11,
        tags: ['potet', 'poteter', 'gartner', 'karbohydrat']
      },
      {
        rawId: 'kiwi-p11-rodbeter',
        productName: 'Norske Rødbeter 500g Gartner',
        offerPrice: 27.9,
        regularPrice: 29.9,
        unitDescription: '500g',
        unitPrice: 55.8,
        tags: ['rødbeter', 'gartner', 'rotgrønnsaker']
      },
      {
        rawId: 'kiwi-p11-betemiks',
        productName: 'Betemiks pose 550g Gartner',
        offerPrice: 27.9,
        regularPrice: 39.9,
        unitDescription: '550g',
        unitPrice: 50.73,
        tags: ['betemiks', 'beter', 'grønnsaker']
      },
      {
        rawId: 'kiwi-p11-rotmiks',
        productName: 'Rotmiks 1kg Gartner (Beter, sellerirot, pastinakk)',
        offerPrice: 27.9,
        regularPrice: 29.9,
        unitDescription: '1 kg',
        unitPrice: 27.9,
        tags: ['rotmiks', 'rotgrønnsaker', 'beter', 'sellerirot']
      }
    ]
  },
  {
    chain: 'KIWI',
    flyerId: 'kiwi-kundeavis-2026',
    pageNumber: 12,
    totalPages: 32,
    imageFileName: 'page-12.webp',
    itemsOnPage: [
      {
        rawId: 'kiwi-p12-salatmix',
        productName: 'Ruccula, Babyleaf, Feldsalat & Baby Spinat 65g Grønn & Frisk',
        offerPrice: 16.9,
        regularPrice: 24.9,
        unitDescription: '65g',
        unitPrice: 260.0,
        tags: ['babyspinat', 'spinat', 'ruccula', 'feldsalat', 'salat']
      },
      {
        rawId: 'kiwi-p12-sprosalat',
        productName: 'Sprø Salat og Blanding 80g Bjærtnes & Hoel',
        offerPrice: 29.9,
        regularPrice: 39.9,
        unitDescription: '80g',
        unitPrice: 373.75,
        tags: ['salat', 'sprø salat', 'grønnsaker']
      },
      {
        rawId: 'kiwi-p12-ruccola',
        productName: 'Ruccola Salat 30g Bjærtnes & Hoel',
        offerPrice: 19.9,
        regularPrice: 26.9,
        unitDescription: '30g',
        tags: ['ruccula', 'salat', 'grønnsaker']
      },
      {
        rawId: 'kiwi-p12-urter',
        productName: 'Ferske Urter i minipotte Gartner (Persille, dill, gressløk)',
        offerPrice: 19.9,
        regularPrice: 26.9,
        unitDescription: 'pr stk',
        tags: ['urter', 'persille', 'dill', 'gressløk', 'krydder']
      }
    ]
  },

  // ======================== REMA 1000 (Ekte Uke 47 sider) ========================
  {
    chain: 'REMA_1000',
    flyerId: 'rema-kundeavis-2026',
    pageNumber: 2,
    totalPages: 4,
    imageFileName: 'page-2.webp',
    itemsOnPage: [
      {
        rawId: 'rema-p2-pepsi',
        productName: 'Pepsi Max 10pk bokser 10x330ml med Æ (-50%)',
        offerPrice: 51.5,
        regularPrice: 103.0,
        unitDescription: '10 pk',
        unitPrice: 15.6,
        tags: ['pepsi max', 'brus', 'drikke', 'sukkerfri']
      },
      {
        rawId: 'rema-p2-solo',
        productName: 'Solo Super 10pk bokser 10x330ml med Æ (-50%)',
        offerPrice: 44.95,
        regularPrice: 89.9,
        unitDescription: '10 pk',
        unitPrice: 13.62,
        tags: ['solo super', 'brus', 'drikke', 'sukkerfri']
      }
    ]
  },
  {
    chain: 'REMA_1000',
    flyerId: 'rema-kundeavis-2026',
    pageNumber: 3,
    totalPages: 4,
    imageFileName: 'page-3.webp',
    itemsOnPage: [
      {
        rawId: 'rema-p3-solorod',
        productName: 'Solo Super Rød Appelsin 10pk bokser med Æ (-50%)',
        offerPrice: 44.95,
        regularPrice: 89.9,
        unitDescription: '10 pk',
        unitPrice: 13.62,
        tags: ['solo super', 'brus', 'drikke', 'sukkerfri']
      },
      {
        rawId: 'rema-p3-pepsilime',
        productName: 'Pepsi Max Lime BX 10pk bokser med Æ (-50%)',
        offerPrice: 44.95,
        regularPrice: 89.9,
        unitDescription: '10 pk',
        unitPrice: 13.62,
        tags: ['pepsi max lime', 'brus', 'drikke', 'sukkerfri']
      }
    ]
  },

  // ======================== COOP EXTRA (Ekte Uke 47 sider) ========================
  {
    chain: 'COOP_EXTRA',
    flyerId: 'extra-kundeavis-2026',
    pageNumber: 1,
    totalPages: 30,
    imageFileName: 'page-1.webp',
    itemsOnPage: [
      {
        rawId: 'extra-p1-klementiner',
        productName: 'Klementiner løsvekt',
        offerPrice: 19.9,
        regularPrice: 39.9,
        unitDescription: 'pr kg',
        unitPrice: 19.9,
        tags: ['klementiner', 'sitrus', 'frukt']
      },
      {
        rawId: 'extra-p1-cocacola',
        productName: 'Coca-Cola Zero Sugar / Fanta / Sprite 15x0,33L bokser Coop Medlemskupp',
        offerPrice: 79.0,
        regularPrice: 119.0,
        unitDescription: '15 pk',
        unitPrice: 15.96,
        tags: ['coca-cola zero', 'fanta', 'sprite', 'brus', 'drikke']
      },
      {
        rawId: 'extra-p1-sjokolade-ctrl',
        productName: 'Sjokoladeplater Freia og Nidar 150-200g',
        offerPrice: 29.9,
        regularPrice: 49.9,
        unitDescription: 'pr stk',
        allergens: ['melk'],
        tags: ['sjokolade', 'godteri']
      }
    ]
  },
  {
    chain: 'COOP_EXTRA',
    flyerId: 'extra-kundeavis-2026',
    pageNumber: 2,
    totalPages: 30,
    imageFileName: 'page-2.webp',
    itemsOnPage: [
      {
        rawId: 'extra-p2-alkoholfritt',
        productName: 'Munkholm og Clausthaler Radler Lemon Alkoholfritt Øl 4/6x0,33L (-20%)',
        offerPrice: 44.9,
        regularPrice: 56.0,
        unitDescription: 'pk',
        tags: ['munkholm', 'clausthaler', 'alkoholfritt øl', 'drikke']
      }
    ]
  },
  {
    chain: 'COOP_EXTRA',
    flyerId: 'extra-kundeavis-2026',
    pageNumber: 3,
    totalPages: 30,
    imageFileName: 'page-3.webp',
    itemsOnPage: [
      {
        rawId: 'extra-p3-oliven',
        productName: 'Gaea Olive Snack og Ybarra Oliven (-30% Tapas)',
        offerPrice: 24.9,
        regularPrice: 35.9,
        unitDescription: 'pose/glass',
        tags: ['oliven', 'gaea', 'tapas', 'snacks']
      },
      {
        rawId: 'extra-p3-serrano-ctrl',
        productName: 'Serranoskinke Coop 100g (-30%)',
        offerPrice: 39.9,
        regularPrice: 57.0,
        unitDescription: '100g',
        allergens: ['svinekjøtt', 'kjøtt'],
        tags: ['serranoskinke', 'kjøtt']
      }
    ]
  },
  {
    chain: 'COOP_EXTRA',
    flyerId: 'extra-kundeavis-2026',
    pageNumber: 4,
    totalPages: 30,
    imageFileName: 'page-4.webp',
    itemsOnPage: [
      {
        rawId: 'extra-p4-blabaer',
        productName: 'Coop Blåbær 400g Stor Pakke Medlemskupp',
        offerPrice: 59.9,
        regularPrice: 79.9,
        unitDescription: '400g',
        unitPrice: 149.75,
        tags: ['blåbær', 'bær', 'frukt']
      },
      {
        rawId: 'extra-p4-hvetemel',
        productName: 'Regal Siktet Hvetemel 2kg',
        offerPrice: 19.9,
        regularPrice: 29.9,
        unitDescription: '2 kg',
        unitPrice: 9.95,
        tags: ['hvetemel', 'mel', 'baking', 'korn', 'tørrvarer']
      },
      {
        rawId: 'extra-p4-palegg-ctrl',
        productName: 'Coop Julesylte og Ribberull 100g 3 for 2',
        offerPrice: 39.9,
        regularPrice: 59.9,
        unitDescription: '3 pk',
        allergens: ['svinekjøtt', 'kjøtt'],
        tags: ['kjøttpålegg', 'kjøtt']
      }
    ]
  },
  {
    chain: 'COOP_EXTRA',
    flyerId: 'extra-kundeavis-2026',
    pageNumber: 5,
    totalPages: 30,
    imageFileName: 'page-5.webp',
    itemsOnPage: [
      {
        rawId: 'extra-p5-druer',
        productName: 'Coop Autumn Crisp Druer Stenfrie 500g',
        offerPrice: 34.9,
        regularPrice: 49.9,
        unitDescription: '500g',
        unitPrice: 69.8,
        tags: ['druer', 'autumn crisp', 'frukt']
      },
      {
        rawId: 'extra-p5-tomater',
        productName: 'Coop Hverdagstomater 400g',
        offerPrice: 39.9,
        regularPrice: 49.9,
        unitDescription: '400g',
        unitPrice: 99.75,
        tags: ['tomater', 'hverdagstomater', 'grønnsaker']
      },
      {
        rawId: 'extra-p5-kaki',
        productName: 'Kaki / Persimon import',
        offerPrice: 34.9,
        regularPrice: 49.9,
        unitDescription: 'pr kg',
        unitPrice: 34.9,
        tags: ['kaki', 'persimon', 'frukt']
      },
      {
        rawId: 'extra-p5-kiwi',
        productName: 'Spisemoden Kiwi 3-pk',
        offerPrice: 29.9,
        regularPrice: 39.9,
        unitDescription: '3 pk',
        tags: ['kiwi frukt', 'frukt']
      }
    ]
  },
  {
    chain: 'COOP_EXTRA',
    flyerId: 'extra-kundeavis-2026',
    pageNumber: 6,
    totalPages: 30,
    imageFileName: 'page-6.webp',
    itemsOnPage: [
      {
        rawId: 'extra-p6-mango',
        productName: 'Coop Spisemoden Mango',
        offerPrice: 24.9,
        regularPrice: 34.9,
        unitDescription: 'pr stk',
        tags: ['mango', 'frukt']
      },
      {
        rawId: 'extra-p6-lok',
        productName: 'Coop Løk Rød og Gul strømpe 600-700g',
        offerPrice: 19.9,
        regularPrice: 28.9,
        unitDescription: '700g',
        unitPrice: 28.43,
        tags: ['løk', 'rødløk', 'gul løk', 'grønnsaker']
      },
      {
        rawId: 'extra-p6-wokmiks',
        productName: 'Coop Salat Wokmiks Red Curry 300-350g',
        offerPrice: 29.9,
        regularPrice: 39.9,
        unitDescription: '350g',
        unitPrice: 85.43,
        tags: ['wokmiks', 'salat', 'grønnsaker']
      },
      {
        rawId: 'extra-p6-gulrot',
        productName: 'Coop Norske Gulrøtter 400g',
        offerPrice: 12.9,
        regularPrice: 19.9,
        unitDescription: '400g',
        unitPrice: 32.25,
        tags: ['gulrot', 'norske gulrøtter', 'grønnsaker']
      }
    ]
  },
  {
    chain: 'COOP_EXTRA',
    flyerId: 'extra-kundeavis-2026',
    pageNumber: 15,
    totalPages: 30,
    imageFileName: 'page-15.webp',
    itemsOnPage: [
      {
        rawId: 'extra-p15-surkal',
        productName: 'Xtra Surkål og Rødkål 450g',
        offerPrice: 13.9,
        regularPrice: 18.9,
        unitDescription: '450g',
        unitPrice: 30.89,
        tags: ['surkål', 'rødkål', 'kål', 'grønnsaker']
      },
      {
        rawId: 'extra-p15-syltetoy',
        productName: 'Xtra Tyttebærsyltetøy 940g',
        offerPrice: 39.1,
        regularPrice: 49.9,
        unitDescription: '940g',
        unitPrice: 41.6,
        tags: ['tyttebærsyltetøy', 'syltetøy', 'bær']
      },
      {
        rawId: 'extra-p15-rodbeter',
        productName: 'Xtra Rødbeter i skiver 490g',
        offerPrice: 17.9,
        regularPrice: 24.9,
        unitDescription: '490g',
        unitPrice: 36.53,
        tags: ['rødbeter', 'syltede rødbeter', 'grønnsaker']
      },
      {
        rawId: 'extra-p15-agurker',
        productName: 'Xtra Agurker i skiver 490g',
        offerPrice: 17.9,
        regularPrice: 24.9,
        unitDescription: '490g',
        unitPrice: 36.53,
        tags: ['agurk', 'sylteagurk', 'grønnsaker']
      },
      {
        rawId: 'extra-p15-laks-ctrl',
        productName: 'Xtra Røkt Laks Helside',
        offerPrice: 229.0,
        regularPrice: 269.0,
        unitDescription: 'pr kg',
        allergens: ['fisk', 'laks'],
        tags: ['laks', 'fisk']
      }
    ]
  },

  // ======================== MENY (Ekte Uke 47 sider) ========================
  {
    chain: 'MENY',
    flyerId: 'meny-kundeavis-2026',
    pageNumber: 1,
    totalPages: 13,
    imageFileName: 'page-1.webp',
    itemsOnPage: [
      {
        rawId: 'meny-p1-klementiner',
        productName: 'Klementiner import løsvekt',
        offerPrice: 19.9,
        regularPrice: 34.9,
        unitDescription: 'pr kg',
        unitPrice: 19.9,
        tags: ['klementiner', 'sitrus', 'frukt']
      },
      {
        rawId: 'meny-p1-cocacola',
        productName: 'Coca-Cola Zero Sugar 8x1,5L',
        offerPrice: 119.0,
        regularPrice: 155.0,
        unitDescription: '8 pk',
        unitPrice: 9.92,
        tags: ['coca-cola zero', 'brus', 'drikke']
      },
      {
        rawId: 'meny-p1-kylling-ctrl',
        productName: 'Fersk Kyllingfilet 700g Prior',
        offerPrice: 109.0,
        regularPrice: 139.0,
        unitDescription: '700g',
        allergens: ['kylling', 'kjøtt'],
        tags: ['kylling', 'kjøtt']
      },
      {
        rawId: 'meny-p1-julepolse-ctrl',
        productName: 'Gilde Julepølse 400g',
        offerPrice: 34.9,
        regularPrice: 54.9,
        unitDescription: '400g',
        allergens: ['svinekjøtt', 'kjøtt'],
        tags: ['julepølse', 'kjøtt']
      }
    ]
  },
  {
    chain: 'MENY',
    flyerId: 'meny-kundeavis-2026',
    pageNumber: 3,
    totalPages: 13,
    imageFileName: 'page-3.webp',
    itemsOnPage: [
      {
        rawId: 'meny-p3-ribbe-ctrl',
        productName: 'Nystekt Ribbe fra Menys Kjøkken',
        offerPrice: 29.9,
        regularPrice: 33.9,
        unitDescription: 'pr hg',
        allergens: ['svinekjøtt', 'kjøtt'],
        tags: ['ribbe', 'kjøtt']
      },
      {
        rawId: 'meny-p3-flotepoteter-ctrl',
        productName: 'Fløtepoteter Meny',
        offerPrice: 14.9,
        regularPrice: 20.9,
        unitDescription: 'pr hg',
        allergens: ['fløte', 'melk'],
        tags: ['fløtepoteter', 'meieri']
      }
    ]
  },
  {
    chain: 'MENY',
    flyerId: 'meny-kundeavis-2026',
    pageNumber: 4,
    totalPages: 13,
    imageFileName: 'page-4.webp',
    itemsOnPage: [
      {
        rawId: 'meny-p4-olivenolje',
        productName: 'Jacobs Kalamata PDO Extra Virgin Olivenolje 500ml 3 for 2',
        offerPrice: 99.83,
        regularPrice: 149.0,
        unitDescription: '500ml',
        unitPrice: 199.66,
        tags: ['olivenolje', 'extra virgin', 'jacobs utvalgte', 'olje']
      },
      {
        rawId: 'meny-p4-antipasti',
        productName: 'Jacobs Utvalgte Antipasti Grillede Artisjokker 3 for 2',
        offerPrice: 39.46,
        regularPrice: 58.9,
        unitDescription: '280g',
        tags: ['antipasti', 'artisjokk', 'jacobs utvalgte', 'grønnsaker']
      },
      {
        rawId: 'meny-p4-varruller',
        productName: 'Jacobs Utvalgte Vårruller med steinsopp og shiitake 3 for 2',
        offerPrice: 34.9,
        regularPrice: 52.9,
        unitDescription: '200g',
        unitPrice: 174.5,
        tags: ['vårruller', 'sopp', 'shiitake', 'jacobs utvalgte']
      },
      {
        rawId: 'meny-p4-limonade',
        productName: 'Jacobs Utvalgte Eple- og Bringebærlimonade 0,75L 3 for 2',
        offerPrice: 34.9,
        regularPrice: 52.9,
        unitDescription: '0,75L',
        tags: ['limonade', 'drikke', 'jacobs utvalgte']
      },
      {
        rawId: 'meny-p4-gyoza-ctrl',
        productName: 'Jacobs Utvalgte Gyoza Kylling 250g',
        offerPrice: 49.9,
        regularPrice: 69.9,
        unitDescription: '250g',
        allergens: ['kylling', 'kjøtt'],
        tags: ['gyoza', 'kjøtt']
      }
    ]
  },

  // ======================== SPAR (Ekte Uke 47 sider) ========================
  {
    chain: 'SPAR',
    flyerId: 'spar-kundeavis-2026',
    pageNumber: 1,
    totalPages: 21,
    imageFileName: 'page-1.webp',
    itemsOnPage: [
      {
        rawId: 'spar-p1-druer',
        productName: 'Cevita Druer stenfrie røde og Autumn Crisp 500g 2 FOR 50,-',
        offerPrice: 25.0,
        regularPrice: 39.9,
        unitDescription: '500g',
        unitPrice: 50.0,
        tags: ['druer', 'autumn crisp', 'cevita', 'frukt']
      },
      {
        rawId: 'spar-p1-brus',
        productName: 'Coca-Cola / Fanta / Sprite 20-pk (20x0,33L)',
        offerPrice: 119.0,
        regularPrice: 198.0,
        unitDescription: '20 pk',
        unitPrice: 18.03,
        tags: ['coca-cola', 'fanta', 'sprite', 'brus', 'drikke']
      },
      {
        rawId: 'spar-p1-norvegia-ctrl',
        productName: 'Norvegia 2-pk TINE ca 1kg',
        offerPrice: 109.0,
        regularPrice: 159.0,
        unitDescription: 'pr kg',
        allergens: ['melk'],
        tags: ['ost', 'norvegia']
      }
    ]
  },
  {
    chain: 'SPAR',
    flyerId: 'spar-kundeavis-2026',
    pageNumber: 2,
    totalPages: 21,
    imageFileName: 'page-2.webp',
    itemsOnPage: [
      {
        rawId: 'spar-p2-brokkoli',
        productName: 'Norsk Fersk Brokkoli Gartner / Blomkål / Pak Choy 2 FOR 30,-',
        offerPrice: 15.0,
        regularPrice: 24.9,
        unitDescription: '1 stk',
        unitPrice: 30.0,
        tags: ['brokkoli', 'norsk brokkoli', 'blomkål', 'pak choy', 'gartner', 'grønnsaker']
      },
      {
        rawId: 'spar-p2-delikat-gulrot',
        productName: 'Delikat Gulrot i pose Gartner 2 FOR 30,-',
        offerPrice: 15.0,
        regularPrice: 24.9,
        unitDescription: '1 pose',
        tags: ['gulrot', 'gartner', 'grønnsaker']
      },
      {
        rawId: 'spar-p2-avokado-mango',
        productName: 'Mango / Modnet Avokado / Tomatmiks 250g 2 FOR 50,-',
        offerPrice: 25.0,
        regularPrice: 34.9,
        unitDescription: '2 pk/stk',
        tags: ['avokado', 'mango', 'tomater', 'tomatmiks', 'grønnsaker', 'frukt']
      },
      {
        rawId: 'spar-p2-persimon-kiwi',
        productName: 'Persimon / Zespri Kiwi grønn og gul 3 FOR 30,-',
        offerPrice: 10.0,
        regularPrice: 18.9,
        unitDescription: '1 stk',
        tags: ['persimon', 'kiwi frukt', 'zespri', 'frukt']
      },
      {
        rawId: 'spar-p2-lok',
        productName: 'Norsk Løk 2-pk Gartner (rød/gul) 2 FOR 30,-',
        offerPrice: 15.0,
        regularPrice: 24.9,
        unitDescription: '2 pk',
        tags: ['løk', 'rødløk', 'gul løk', 'gartner', 'grønnsaker']
      },
      {
        rawId: 'spar-p2-salater',
        productName: 'Grønn & Frisk Salater 65g (Babyspinat, Ruccula, Feldsalat) 2 FOR 30,-',
        offerPrice: 15.0,
        regularPrice: 24.9,
        unitDescription: '65g',
        unitPrice: 230.77,
        tags: ['babyspinat', 'spinat', 'ruccula', 'feldsalat', 'salat']
      }
    ]
  },
  {
    chain: 'SPAR',
    flyerId: 'spar-kundeavis-2026',
    pageNumber: 3,
    totalPages: 21,
    imageFileName: 'page-3.webp',
    itemsOnPage: [
      {
        rawId: 'spar-p3-surkal',
        productName: 'Nora Surkål 450g 2 FOR 30,-',
        offerPrice: 15.0,
        regularPrice: 22.9,
        unitDescription: '450g',
        unitPrice: 33.33,
        tags: ['surkål', 'kål', 'nora', 'grønnsaker']
      },
      {
        rawId: 'spar-p3-lovbiff-ctrl',
        productName: 'Grilstad Løvbiff 6-pk 600g',
        offerPrice: 119.0,
        regularPrice: 149.0,
        unitDescription: '600g',
        allergens: ['storfekjøtt', 'kjøtt'],
        tags: ['løvbiff', 'kjøtt']
      }
    ]
  },

  // ======================== JOKER (Ekte Uke 47 sider) ========================
  {
    chain: 'JOKER',
    flyerId: 'joker-kundeavis-2026',
    pageNumber: 1,
    totalPages: 27,
    imageFileName: 'page-1.webp',
    itemsOnPage: [
      {
        rawId: 'joker-p1-jasminris',
        productName: 'Toro Jasminris Boil-in-bag / Hurtigris (-50%)',
        offerPrice: 19.95,
        regularPrice: 39.9,
        unitDescription: 'pk',
        tags: ['jasminris', 'ris', 'toro', 'karbohydrat', 'tørrvarer']
      },
      {
        rawId: 'joker-p1-supper',
        productName: 'Toro Tomatsuppe / Blomkålsuppe / Ertesuppe (-50%)',
        offerPrice: 12.45,
        regularPrice: 24.9,
        unitDescription: 'pose',
        tags: ['tomatsuppe', 'ertesuppe', 'toro', 'suppe', 'tørrvarer']
      },
      {
        rawId: 'joker-p1-ost-ctrl',
        productName: 'Fløtemysost / Gudbrandsdalsost TINE 1kg',
        offerPrice: 79.9,
        regularPrice: 129.9,
        unitDescription: '1 kg',
        allergens: ['melk'],
        tags: ['brunost', 'meieri']
      },
      {
        rawId: 'joker-p1-polser-ctrl',
        productName: 'Grillpølser / Ostegrill Gilde 600g',
        offerPrice: 49.9,
        regularPrice: 74.9,
        unitDescription: '600g',
        allergens: ['svinekjøtt', 'kjøtt'],
        tags: ['grillpølser', 'kjøtt']
      }
    ]
  },
  {
    chain: 'JOKER',
    flyerId: 'joker-kundeavis-2026',
    pageNumber: 2,
    totalPages: 27,
    imageFileName: 'page-2.webp',
    itemsOnPage: [
      {
        rawId: 'joker-p2-battery-gatorade',
        productName: 'Battery / Gatorade 0,5L 2 FOR 30,- + pant',
        offerPrice: 15.0,
        regularPrice: 24.9,
        unitDescription: '0,5L',
        unitPrice: 30.0,
        tags: ['battery', 'gatorade', 'energidrikk', 'drikke']
      },
      {
        rawId: 'joker-p2-smash-ctrl',
        productName: 'Smash! Nidar 200g',
        offerPrice: 39.9,
        regularPrice: 59.9,
        unitDescription: '200g',
        allergens: ['melk'],
        tags: ['smash', 'sjokolade']
      },
      {
        rawId: 'joker-p2-japp-peanut-ctrl',
        productName: 'Japp Peanøtt Freia 60g',
        offerPrice: 10.0,
        regularPrice: 22.9,
        unitDescription: '60g',
        allergens: ['peanøtt', 'peanut', 'melk'],
        tags: ['japp', 'sjokolade']
      }
    ]
  },
  {
    chain: 'JOKER',
    flyerId: 'joker-kundeavis-2026',
    pageNumber: 3,
    totalPages: 27,
    imageFileName: 'page-3.webp',
    itemsOnPage: [
      {
        rawId: 'joker-p3-poteter',
        productName: 'Norske Poteter løsvekt Ukens Beste',
        offerPrice: 14.9,
        regularPrice: 24.9,
        unitDescription: 'pr kg',
        unitPrice: 14.9,
        tags: ['potet', 'poteter', 'norske poteter', 'karbohydrat', 'tørrvarer']
      },
      {
        rawId: 'joker-p3-tomater',
        productName: 'Små Tomater Season 500g',
        offerPrice: 39.9,
        regularPrice: 49.9,
        unitDescription: '500g',
        unitPrice: 79.8,
        tags: ['tomater', 'små tomater', 'grønnsaker']
      },
      {
        rawId: 'joker-p3-isbergsalat',
        productName: 'Isbergsalat Season',
        offerPrice: 19.9,
        regularPrice: 29.9,
        unitDescription: 'pr stk',
        tags: ['isbergsalat', 'salat', 'grønnsaker']
      },
      {
        rawId: 'joker-p3-mango-avokado',
        productName: 'Moden Mango og Avokado 2-pk',
        offerPrice: 29.9,
        regularPrice: 42.9,
        unitDescription: '2 pk',
        tags: ['mango', 'avokado', 'frukt']
      },
      {
        rawId: 'joker-p3-ambrosia',
        productName: 'Ambrosia Friske & Søte Epler Cevita 6-pk',
        offerPrice: 39.9,
        regularPrice: 54.9,
        unitDescription: '6 pk',
        tags: ['ambrosia epler', 'epler', 'frukt']
      }
    ]
  }
];

/**
 * Genererer fallback `FlyerPageAsset[]` for angitte kjeder.
 */
export function buildFlyerPageAssets(
  chains: StoreChain[] = ['KIWI', 'REMA_1000', 'MENY', 'COOP_EXTRA', 'SPAR', 'JOKER'],
  referenceDate: Date = new Date()
): FlyerPageAsset[] {
  const { validFrom, validUntil } = getCurrentWeekDateRange(referenceDate);

  const selectedTemplates = FLYER_PAGES_SIM_TEMPLATES.filter((tpl) => chains.includes(tpl.chain));

  return selectedTemplates.map((tpl) => ({
    chain: tpl.chain,
    flyerId: tpl.flyerId,
    pageNumber: tpl.pageNumber,
    totalPages: tpl.totalPages,
    imageUrlOrBase64: `https://static.mattilbud.no/flyers/${tpl.chain.toLowerCase()}/${validFrom}/${tpl.imageFileName}`,
    mimeType: 'image/webp',
    validFrom,
    validUntil
  }));
}

/**
 * Laster ned eller forbereder kundeavis-sider fra mattilbud.no for de gitte kjedene.
 * Sjekker først om det finnes fysisk nedlastede sider i `data/flyers/<kjede>/`.
 * Hvis filene finnes, returneres disse som fullverdige FlyerPageAsset med Base64 WebP!
 */
export async function downloadMattilbudFlyerPages(
  chains: StoreChain[] = ['KIWI', 'REMA_1000', 'MENY', 'COOP_EXTRA', 'SPAR', 'JOKER'],
  referenceDate: Date = new Date()
): Promise<FlyerPageAsset[]> {
  // 1. Sjekk om det finnes fysisk nedlastede WebP-sider i data/flyers
  const downloadedAssets = loadDownloadedFlyerPages();
  const matchedAssets = downloadedAssets.filter((a) => chains.includes(a.chain));

  if (matchedAssets.length > 0) {
    const foundChains = new Set(matchedAssets.map((a) => a.chain));
    const missingChains = chains.filter((c) => !foundChains.has(c) && c !== 'ODA');

    if (missingChains.length > 0) {
      const fallbackAssets = buildFlyerPageAssets(missingChains, referenceDate);
      return [...matchedAssets, ...fallbackAssets];
    }

    return matchedAssets;
  }

  // Fallback til virtuelle templates hvis ingen filer er lastet ned ennå
  return buildFlyerPageAssets(chains, referenceDate);
}

/**
 * Hjelper for å rense og normalisere en rå vare kandidat til `NormalizedOffer`
 */
function normalizeCandidate(
  cand: RawPageItemCandidate,
  chain: StoreChain,
  source: OfferSource,
  validFrom: string,
  validUntil: string,
  pageContext?: { pageNumber?: number; flyerImageUrl?: string }
): { offer?: NormalizedOffer; isSafe: boolean; reason?: string } {
  const safety = checkVeganAndPeanutSafety(cand.productName, '', cand.allergens ?? []);
  if (!safety.isVeganSafe) {
    return { isSafe: false, reason: safety.rejectionReason };
  }

  const category = categorizeOffer(cand.productName, cand.tags);
  const normalizedTags = extractNormalizedTags(cand.productName, cand.tags);
  const { discountAmountNok, discountPercent } = computeDiscountMetrics(cand.offerPrice, cand.regularPrice);

  const flyerImageUrl = pageContext?.flyerImageUrl;
  const imageUrl = cand.imageUrl || flyerImageUrl;

  const offer: NormalizedOffer = {
    id: `${chain.toLowerCase()}-${cand.rawId}`,
    productName: cand.productName,
    normalizedTags,
    chain,
    category,
    offerPrice: cand.offerPrice,
    regularPrice: cand.regularPrice,
    discountAmountNok,
    discountPercent,
    unitDescription: cand.unitDescription,
    unitPrice: cand.unitPrice,
    validFrom,
    validUntil,
    source,
    imageUrl,
    flyerImageUrl,
    pageNumber: pageContext?.pageNumber,
    isVeganSafe: true
  };

  return { isSafe: true, offer };
}

/**
 * Skanner én enkelt kundeavis-side med Gemini Vision (eller deterministisk simulator hvis GEMINI_API_KEY mangler).
 * Sjekker alltid <kjede>/offers.json først slik at manuelle brukerendringer umiddelbart overstyrer/brukes!
 * Ved ny Gemini Vision-skanning: 1 side av gangen med 4,5s pause og 22s auto-retry ved 429.
 */
export async function scanSingleFlyerPageWithVision(
  page: FlyerPageAsset,
  options?: {
    apiKey?: string;
    forceDeterministic?: boolean;
    forceGeminiScan?: boolean;
    forceRescan?: boolean;
  }
): Promise<FlyerPageScanResult> {
  const apiKey = options?.apiKey || process.env.GEMINI_API_KEY;
  const isDeterministic = options?.forceDeterministic || !apiKey;
  const shouldForceRescan = !!(options?.forceRescan || options?.forceGeminiScan);

  // 1. Sjekk ALLTID om det finnes ferdig analyserte/redigerte tilbud i offers.json for denne butikken
  const diskCandidates = loadOffersFromStoreJson(page);
  const alreadyInOffersJson = diskCandidates !== null;

  const template = FLYER_PAGES_SIM_TEMPLATES.find(
    (tpl) => tpl.chain === page.chain && tpl.pageNumber === page.pageNumber
  );

  let rawCandidates: RawPageItemCandidate[] = diskCandidates ?? template?.itemsOnPage ?? [];

  // Hvis siden IKKE finnes i offers.json fra før (eller forceRescan er satt), og vi har API-nøkkel + bilde:
  // Skann 1 side av gangen med tålmodig pacing (4,5 sek pause) og auto-retry (22 sek) ved 429.
  if (!isDeterministic && apiKey && page.imageUrlOrBase64 && (!alreadyInOffersJson || shouldForceRescan)) {
    const maxRetries = 2;
    let attempt = 0;
    let geminiSuccess = false;

    while (attempt <= maxRetries && !geminiSuccess) {
      if (attempt > 0) {
        console.warn(
          `[Gemini Vision] ⚠️ 429 Too Many Requests for ${page.chain} side ${page.pageNumber}. Venter 22 sekunder før forsøk ${attempt + 1}/${maxRetries + 1}...`
        );
        await new Promise((r) => setTimeout(r, 22000));
      } else {
        // Tålmodig pacing: 4,5 sekunder pause mellom hvert kall for å holde oss trygt under 15 RPM
        await new Promise((r) => setTimeout(r, 4500));
      }

      attempt++;

      try {
        const isBase64 = page.imageUrlOrBase64.startsWith('data:') || !page.imageUrlOrBase64.startsWith('http');
        const imagePart = isBase64
          ? {
              inline_data: {
                mime_type: page.mimeType,
                data: page.imageUrlOrBase64.replace(/^data:image\/\w+;base64,/, '')
              }
            }
          : {
              text: `Kundeavis-bilde URL: ${page.imageUrlOrBase64}`
            };

        const requestBody = {
          contents: [
            {
              role: 'user',
              parts: [
                imagePart,
                {
                  text: `Analyser denne kundeavis-siden for ${page.chain} (Side ${page.pageNumber} av ${page.totalPages}). Ekstraher alle tilbud.`
                }
              ]
            }
          ],
          systemInstruction: {
            parts: [{ text: GEMINI_FLYER_PAGE_SYSTEM_PROMPT }]
          },
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: GEMINI_PAGE_RESPONSE_SCHEMA,
            temperature: 0.1
          }
        };

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          }
        );

        if (res.status === 429) {
          if (attempt <= maxRetries) {
            continue; // Prøv på nytt etter 22 sek pause
          } else {
            console.warn(
              `[Gemini Vision] 429 Too Many Requests vedvarer for ${page.chain} side ${page.pageNumber} etter ${maxRetries} gjentakelser. Bruker verifisert mal.`
            );
            break;
          }
        }

        if (res.ok) {
          const json = await res.json();
          const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const parsed = JSON.parse(rawText) as {
              offers: Array<{
                productName: string;
                offerPrice: number;
                regularPrice?: number;
                unitDescription?: string;
                unitPrice?: number;
                detectedTags?: string[];
                detectedIngredientsOrAllergens?: string[];
              }>;
            };
            if (Array.isArray(parsed.offers) && parsed.offers.length > 0) {
              rawCandidates = parsed.offers.map((item, idx) => ({
                rawId: `gemini-p${page.pageNumber}-${idx + 1}`,
                productName: item.productName,
                offerPrice: item.offerPrice,
                regularPrice: item.regularPrice,
                unitDescription: item.unitDescription,
                unitPrice: item.unitPrice,
                tags: item.detectedTags,
                allergens: item.detectedIngredientsOrAllergens
              }));

              // Lagre automatisk de nyoppdagede Gemini Vision-funnene til butikkens offers.json
              saveOffersToStoreJson(page.chain, page.pageNumber, rawCandidates, {
                localFilePath: page.localFilePath
              });

              geminiSuccess = true;
              break;
            }
          }
        } else {
          console.warn(
            `[Gemini Vision] Returnerte status ${res.status} for ${page.chain} side ${page.pageNumber}, faller tilbake.`
          );
          break;
        }
      } catch (err) {
        console.warn(
          `[Gemini Vision] Nettverkskall feilet for ${page.chain} side ${page.pageNumber}:`,
          err
        );
        break;
      }
    }
  }

  // Filtrer og normaliser kandidatene for denne siden
  const acceptedOffers: NormalizedOffer[] = [];
  let rejectedCount = 0;

  // Beregn public nettleser-URL til den faktiske nedlastede kundeavis-siden
  const folder = mapStoreChainToFolder(page.chain);
  const imageFileName = page.localFilePath
    ? path.basename(page.localFilePath)
    : `${folder}_2026-W47_page-${page.pageNumber}.webp`;
  const flyerImageUrl = `/data/flyers/2026-W47/${folder}/${imageFileName}`;

  for (const cand of rawCandidates) {
    const result = normalizeCandidate(
      cand,
      page.chain,
      apiKey ? 'MATTILBUD_OCR' : 'MATTILBUD_SCRAPER',
      page.validFrom,
      page.validUntil,
      {
        pageNumber: page.pageNumber,
        flyerImageUrl
      }
    );

    if (result.isSafe && result.offer) {
      acceptedOffers.push(result.offer);
    } else {
      rejectedCount++;
    }
  }

  return {
    chain: page.chain,
    flyerId: page.flyerId,
    pageNumber: page.pageNumber,
    rawDetectedCount: rawCandidates.length,
    rejectedAllergenOrNonVeganCount: rejectedCount,
    acceptedOffers,
    scannedAt: new Date().toISOString()
  };
}

/**
 * Går gjennom hver eneste kundeavis-side sekvensielt eller i batcher,
 * viser hver side til AI Vision (eller simuleringen), og returnerer detaljerte `FlyerPageScanResult[]`
 * samt et samlet, verifisert `WeeklyOffersDataset`.
 */
export async function scanFlyerPagesWithAiVision(
  pages: FlyerPageAsset[],
  options?: {
    apiKey?: string;
    forceDeterministic?: boolean;
    forceGeminiScan?: boolean;
    forceRescan?: boolean;
    bypassCache?: boolean;
    onPageProgress?: (result: FlyerPageScanResult, index: number, total: number) => void;
  }
): Promise<{
  pageResults: FlyerPageScanResult[];
  dataset: WeeklyOffersDataset;
  totalRawDetected: number;
  totalRejected: number;
}> {
  if (options?.bypassCache) {
    clearStoreOffersCache();
  }

  const pageResults: FlyerPageScanResult[] = [];
  const mergedOffersMap = new Map<string, NormalizedOffer>();
  let totalRawDetected = 0;
  let totalRejected = 0;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const scanResult = await scanSingleFlyerPageWithVision(page, options);
    pageResults.push(scanResult);

    totalRawDetected += scanResult.rawDetectedCount;
    totalRejected += scanResult.rejectedAllergenOrNonVeganCount;

    for (const offer of scanResult.acceptedOffers) {
      // Dedupliser per kjede og produktnavn
      const dedupeKey = `${offer.chain}:${offer.productName.toLowerCase().trim()}`;
      if (!mergedOffersMap.has(dedupeKey)) {
        mergedOffersMap.set(dedupeKey, offer);
      }
    }

    if (options?.onPageProgress) {
      options.onPageProgress(scanResult, i + 1, pages.length);
    }
  }

  const { weekNumber, year } = getCurrentWeekDateRange();
  const allOffers = Array.from(mergedOffersMap.values());

  const dataset: WeeklyOffersDataset = {
    fetchedAt: new Date().toISOString(),
    weekNumber,
    year,
    totalOffers: allOffers.length,
    offers: allOffers
  };

  return {
    pageResults,
    dataset,
    totalRawDetected,
    totalRejected
  };
}
