import type { OfferCategory } from '../../types/contracts';

/**
 * Streng liste over ikke-veganske eller peanøttholdige termer som skal blokkeres.
 * NB: Sjekker også latinske og engelske navn for peanøtt (arachis, peanut, satay, jordnøtt).
 */
const NON_VEGAN_KEYWORDS = [
  'kjøtt',
  'kjøttdeig',
  'karbonadedeig',
  'kylling',
  'kalkun',
  'storfe',
  'biff',
  'entrecote',
  'svin',
  'svinekjøtt',
  'kotelett',
  'bacon',
  'skinke',
  'pølse',
  'wienerpølse',
  'grillpølse',
  'kjøttpølse',
  'lam',
  'fårikål',
  'fisk',
  'laks',
  'ørret',
  'torsk',
  'sei',
  'makrell',
  'reker',
  'scampi',
  'tunfisk',
  'fiskekaker',
  'fiskepinner',
  'egg',
  'eggehvite',
  'eggeplomme',
  'kumelk',
  'lettmelk',
  'helmelk',
  'skummet melk',
  'fløte',
  'kremfløte',
  'matfløte',
  'rømme',
  'creme fraiche',
  'crème fraîche',
  'gulost',
  'norvegia',
  'jarlsberg',
  'brunost',
  'fetaost',
  'mozzarella',
  'parmesan',
  'cheddar',
  'brie',
  'cottage cheese',
  'kesam',
  'skyr',
  'meieri',
  'meierismør',
  'honning',
  'gelatin',
  'myse',
  'whey',
  'kasein'
];

const PEANUT_ALLERGEN_KEYWORDS = [
  'peanøtt',
  'peanøtter',
  'peanøttsmør',
  'peanøttolje',
  'peanøttsaus',
  'peanut',
  'peanuts',
  'peanutbutter',
  'arachis',
  'jordnøtt',
  'jordnøtter',
  'satay',
  'sataysaus',
  'chilinøtter'
];

/**
 * Unntak for sammensatte ord som inneholder et blokkert delord, men som faktisk er veganske
 * (f.eks. "kokosmelk", "havremelk", "soyafløte", "havrefløte", "eggplant" / "aubergine", "kikerter").
 */
const VEGAN_SAFE_COMPOUND_OVERRIDES = [
  'kokosmelk',
  'havremelk',
  'soyamelk',
  'mandelmelk',
  'rismelk',
  'plantemelk',
  'havrefløte',
  'soyafløte',
  'kokosfløte',
  'plantefløte',
  'vegansk ost',
  'veganost',
  'plantebasert',
  'vegansk',
  'vegan',
  'tofu',
  'tempeh',
  'seitan',
  'oumph',
  'naturli',
  'gryr',
  'oatly',
  'alpro',
  'go-tan'
];

/**
 * Sjekker om et produktnavn, ingrediensliste eller allergener er trygt (100% vegansk + 100% peanøttfritt).
 */
export function checkVeganAndPeanutSafety(
  productName: string,
  extraDescription: string = '',
  allergens: string[] = []
): { isVeganSafe: boolean; rejectionReason?: string } {
  const combined = `${productName} ${extraDescription} ${allergens.join(' ')}`.toLowerCase();

  // 1. Absolutt blokkering av peanøtter (aldri tillatt uansett vegansk status)
  for (const peanutTerm of PEANUT_ALLERGEN_KEYWORDS) {
    if (combined.includes(peanutTerm)) {
      return {
        isVeganSafe: false,
        rejectionReason: `Inneholder peanøtt-allergen (${peanutTerm})`
      };
    }
  }

  // 2. Fjern kjente veganske sammensatte ord før vi sjekker mot ikke-veganske nøkkelord
  let scrubbedText = combined;
  for (const safeCompound of VEGAN_SAFE_COMPOUND_OVERRIDES) {
    scrubbedText = scrubbedText.replaceAll(safeCompound, ' ');
  }

  // 3. Sjekk mot ikke-veganske ord (med ordgrenser for korte ord som "egg", "lam", "ost")
  for (const term of NON_VEGAN_KEYWORDS) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|[^a-zæøå])${escaped}($|[^a-zæøå])`, 'i');
    if (regex.test(scrubbedText) || scrubbedText.includes(term)) {
      // Dobbeltsjekk korte ord som "egg" så det ikke treffer "knekkebrød" eller "legg"
      if (term.length <= 4) {
        if (regex.test(scrubbedText)) {
          return {
            isVeganSafe: false,
            rejectionReason: `Ikke-vegansk ingrediens oppdaget (${term})`
          };
        }
      } else {
        return {
          isVeganSafe: false,
          rejectionReason: `Ikke-vegansk ingrediens oppdaget (${term})`
        };
      }
    }
  }

  return { isVeganSafe: true };
}

/**
 * Kategoriseringsregler basert på matplanens 5 kategorier.
 */
const CATEGORY_RULES: Array<{ category: OfferCategory; keywords: string[] }> = [
  {
    category: 'Kjøl/Tofu',
    keywords: [
      'tofu',
      'tempeh',
      'seitan',
      'edamame',
      'soyafilet',
      'soyabiter',
      'oumph',
      'falafel',
      'hummus',
      'kimchi',
      'surkål',
      'sauerkraut',
      'fermentert',
      'havremelk',
      'soyamelk',
      'planteyoghurt',
      'alpro',
      'oatly',
      'gryr',
      'naturli'
    ]
  },
  {
    category: 'Frukt & Grønt',
    keywords: [
      'brokkoli',
      'blomkål',
      'søtpotet',
      'potet',
      'spinat',
      'grønnkål',
      'avokado',
      'sopp',
      'sjampinjong',
      'aromasopp',
      'østerssopp',
      'shiitake',
      'paprika',
      'chili',
      'tomat',
      'cherrytomat',
      'agurk',
      'squash',
      'zucchini',
      'aubergine',
      'gulrot',
      'gulrøtter',
      'løk',
      'rødløk',
      ' vårløk',
      'vårløk',
      'purreløk',
      'hvitløk',
      'ingefær',
      'koriander',
      'persille',
      'basilikum',
      'mynte',
      'lime',
      'sitron',
      'eple',
      'banan',
      'bær',
      'blåbær',
      'bringebær',
      'mango',
      'granateple',
      'sukkererter',
      'asparges',
      'selleri',
      'rødbeter',
      'kål',
      'rødkål',
      'hjertesalat',
      'ruccola',
      'salat'
    ]
  },
  {
    category: 'Tørrvarer/Belgvekster',
    keywords: [
      'linser',
      'røde linser',
      'grønne linser',
      'belugalinser',
      'kikerter',
      'kikertpasta',
      'linsepasta',
      'bønner',
      'svarte bønner',
      'sorte bønner',
      'kidneybønner',
      'hvite bønner',
      'cannellinibønner',
      'pintobønner',
      'ris',
      'basmatiris',
      'jasminris',
      'fullkornsris',
      'quinoa',
      'bulgur',
      'couscous',
      'pasta',
      'fullkornspasta',
      'spaghetti',
      'fusilli',
      'penne',
      'nudler',
      'risnudler',
      'sobanudler',
      'udonnudler',
      'havregryn',
      'solsikkekjerner',
      'gresskarkjerner',
      'valnøtter',
      'cashewnøtter',
      'mandler',
      'chiafrø',
      'linfrø',
      'sesamfrø',
      'hampfrø',
      'næringsgjær',
      'tvp',
      'soyaprotein',
      'hakkede tomater',
      'passata',
      'mais',
      'tortilla',
      'fullkornstortilla'
    ]
  },
  {
    category: 'Krydder/Sauser',
    keywords: [
      'tahini',
      'sesampasta',
      'miso',
      'misopasta',
      'gochujang',
      'soyasaus',
      'tamari',
      'kokosmelk',
      'curry',
      'currypaste',
      'karri',
      'garam masala',
      'spisskummen',
      'cumin',
      'gurkemeie',
      'paprikapulver',
      'røkt paprika',
      'chiliflakes',
      'sriracha',
      'chilisaus',
      'hoisin',
      'teriyaki',
      'olivenolje',
      'sesamolje',
      'rapsolje',
      'eddik',
      'riseddik',
      'eplecidereddik',
      'balsamico',
      'tomatpure',
      'tomatpuré',
      'buljong',
      'grønnsaksbuljong',
      'pesto',
      'salsa',
      'krydder'
    ]
  }
];

/**
 * Kategoriserer et produkt automatisk i en av de 5 matplan-kategoriene.
 * Merk: "hakkede tomater" og "kokosmelk" matches før generelle frukt/grønt-termer som "tomat".
 */
export function categorizeOffer(productName: string, extraTags: string[] = []): OfferCategory {
  const text = `${productName} ${extraTags.join(' ')}`.toLowerCase();

  // 1. Spesialregler der sammensatte ord må trumfe enkeltord
  if (text.includes('hakkede tomater') || text.includes('flådde tomater') || text.includes('passata')) {
    return 'Tørrvarer/Belgvekster';
  }
  if (
    text.includes('tahini') ||
    text.includes('sesampasta') ||
    text.includes('miso') ||
    text.includes('gochujang') ||
    text.includes('soyasaus') ||
    text.includes('tamari') ||
    text.includes('tomatpuré') ||
    text.includes('tomatpure') ||
    text.includes('kokosmelk') ||
    text.includes('curry') ||
    text.includes('sriracha') ||
    text.includes('hoisin')
  ) {
    return 'Krydder/Sauser';
  }
  if (text.includes('edamame') || text.includes('kimchi') || text.includes('tofu') || text.includes('tempeh')) {
    return 'Kjøl/Tofu';
  }

  for (const rule of CATEGORY_RULES) {
    for (const kw of rule.keywords) {
      if (text.includes(kw)) {
        return rule.category;
      }
    }
  }

  return 'Annet';
}

/**
 * Kanonisk synonym-ordbok for å generere rike `normalizedTags` slik at
 * Matplan & Inventar-Agentens `searchKeywords` og `ShoppingListItem` matcher treffsikkert.
 */
const CANONICAL_TAG_MAP: Array<{ pattern: RegExp; tags: string[] }> = [
  { pattern: /\b(tofu|fast tofu|silketofu)\b/i, tags: ['tofu', 'fast tofu', 'soya'] },
  { pattern: /\b(tempeh)\b/i, tags: ['tempeh', 'fermentert soya', 'soya'] },
  { pattern: /\b(edamame|edamamebønner|soyabønner)\b/i, tags: ['edamame', 'edamamebønner', 'soyabønner'] },
  { pattern: /\b(røde linser|rode linser)\b/i, tags: ['røde linser', 'linser', 'belgvekster'] },
  { pattern: /\b(grønne linser|gronne linser)\b/i, tags: ['grønne linser', 'linser', 'belgvekster'] },
  { pattern: /\b(belugalinser|svarte linser)\b/i, tags: ['belugalinser', 'linser', 'belgvekster'] },
  { pattern: /\b(kikerter)\b/i, tags: ['kikerter', 'belgvekster'] },
  { pattern: /\b(kikertpasta|linsepasta|bønnepasta)\b/i, tags: ['kikertpasta', 'belgvekstpasta', 'pasta'] },
  { pattern: /\b(svarte bønner|sorte bønner)\b/i, tags: ['svarte bønner', 'sorte bønner', 'bønner', 'belgvekster'] },
  { pattern: /\b(kidneybønner)\b/i, tags: ['kidneybønner', 'bønner', 'belgvekster'] },
  { pattern: /\b(hvite bønner|cannellini)\b/i, tags: ['hvite bønner', 'bønner', 'belgvekster'] },
  { pattern: /\b(brokkoli)\b/i, tags: ['brokkoli', 'kålvekster'] },
  { pattern: /\b(blomkål)\b/i, tags: ['blomkål', 'kålvekster'] },
  { pattern: /\b(søtpotet|søtpoteter)\b/i, tags: ['søtpotet', 'rotgrønnsaker'] },
  { pattern: /\b(spinat|babyspinat)\b/i, tags: ['spinat', 'babyspinat', 'bladgrønt'] },
  { pattern: /\b(grønnkål|grønnkålmiks)\b/i, tags: ['grønnkål', 'bladgrønt'] },
  { pattern: /\b(avokado)\b/i, tags: ['avokado', 'sunt fett'] },
  { pattern: /\b(sopp|sjampinjong|aromasopp|østerssopp|shiitake)\b/i, tags: ['sopp', 'sjampinjong', 'aromasopp'] },
  { pattern: /\b(paprika|spisspaprika)\b/i, tags: ['paprika', 'spisspaprika'] },
  { pattern: /\b(tahini|sesampasta)\b/i, tags: ['tahini', 'sesampasta'] },
  { pattern: /\b(miso|misopasta)\b/i, tags: ['miso', 'misopasta', 'fermentert'] },
  { pattern: /\b(gochujang)\b/i, tags: ['gochujang', 'koreansk chilipasta', 'fermentert'] },
  { pattern: /\b(kimchi)\b/i, tags: ['kimchi', 'fermentert'] },
  { pattern: /\b(kokosmelk)\b/i, tags: ['kokosmelk'] },
  { pattern: /\b(hakkede tomater|flådde tomater|passata)\b/i, tags: ['hakkede tomater', 'hermetiske tomater', 'tomater'] },
  { pattern: /\b(basmatiris)\b/i, tags: ['basmatiris', 'ris'] },
  { pattern: /\b(jasminris|fullkornsris)\b/i, tags: ['ris', 'jasminris', 'fullkornsris'] },
  { pattern: /\b(quinoa)\b/i, tags: ['quinoa'] },
  { pattern: /\b(fullkornspasta|spaghetti|fusilli|penne)\b/i, tags: ['fullkornspasta', 'pasta'] },
  { pattern: /\b(nudler|risnudler|sobanudler|udonnudler)\b/i, tags: ['nudler', 'risnudler', 'sobanudler'] },
  { pattern: /\b(soyasaus|tamari)\b/i, tags: ['soyasaus', 'tamari'] },
  { pattern: /\b(hvitløk)\b/i, tags: ['hvitløk', 'løkvekster'] },
  { pattern: /\b(ingefær)\b/i, tags: ['ingefær'] },
  { pattern: /\b(rødløk|gul løk|vårløk)\b/i, tags: ['løk', 'rødløk', 'vårløk'] },
  { pattern: /\b(gulrot|gulrøtter)\b/i, tags: ['gulrot', 'gulrøtter', 'rotgrønnsaker'] },
  { pattern: /\b(lime|sitron)\b/i, tags: ['lime', 'sitron', 'sitrus'] },
  { pattern: /\b(koriander|persille|basilikum)\b/i, tags: ['friske urter', 'koriander', 'persille', 'basilikum'] },
  { pattern: /\b(cashewnøtter|cashew)\b/i, tags: ['cashewnøtter', 'nøtter'] },
  { pattern: /\b(solsikkekjerner|gresskarkjerner)\b/i, tags: ['solsikkekjerner', 'gresskarkjerner', 'frø og kjerner'] },
  { pattern: /\b(næringsgjær)\b/i, tags: ['næringsgjær'] },
  { pattern: /\b(hummus)\b/i, tags: ['hummus', 'kikerter'] },
  { pattern: /\b(oumph|soyafilet|soyabiter)\b/i, tags: ['soyafilet', 'oumph', 'plantekjøtt'] }
];

const BRAND_STOPWORDS = new Set([
  'eldorado',
  'first',
  'price',
  'rema',
  '1000',
  'kiwi',
  'meny',
  'coop',
  'extra',
  'änglamark',
  'anglamark',
  'kolonihagen',
  'jacobs',
  'utvalgte',
  'go-tan',
  'gotan',
  'santa',
  'maria',
  'blue',
  'dragon',
  'mutti',
  ' økologisk',
  'økologisk',
  'øko',
  'stk',
  'pk',
  'gram',
  'kg',
  'ml',
  'liter'
]);

/**
 * Ekstraherer og normaliserer søkbare tags fra et produktnavn + ev. eksisterende tags.
 */
export function extractNormalizedTags(productName: string, initialTags: string[] = []): string[] {
  const tagSet = new Set<string>();

  for (const t of initialTags) {
    const cleaned = t.trim().toLowerCase();
    if (cleaned) tagSet.add(cleaned);
  }

  for (const rule of CANONICAL_TAG_MAP) {
    if (rule.pattern.test(productName)) {
      for (const tag of rule.tags) {
        tagSet.add(tag.toLowerCase());
      }
    }
  }

  // Rens også selve produktnavnet for mengdeangivelser og merkevarer
  const cleanedTokens = productName
    .toLowerCase()
    .replace(/\b\d+\s*(g|kg|ml|l|cl|stk|pk)\b/gi, ' ')
    .replace(/[^a-zæøå0-9\s-]/gi, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !BRAND_STOPWORDS.has(w) && !/^\d+$/.test(w));

  for (const token of cleanedTokens) {
    tagSet.add(token);
  }

  return Array.from(tagSet);
}

/**
 * Beregner rabatt i NOK og prosent hvis `regularPrice` er oppgitt.
 */
export function computeDiscountMetrics(offerPrice: number, regularPrice?: number): {
  discountAmountNok?: number;
  discountPercent?: number;
} {
  if (!regularPrice || regularPrice <= offerPrice) {
    return {};
  }
  const discountAmountNok = Number((regularPrice - offerPrice).toFixed(2));
  const discountPercent = Math.round(((regularPrice - offerPrice) / regularPrice) * 100);
  return { discountAmountNok, discountPercent };
}
