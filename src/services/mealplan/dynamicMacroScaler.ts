import type {
  ChefModePreferences,
  CuisineStyle,
  InventoryItem,
  MealPlanDay,
  NormalizedOffer,
  NutritionMacros,
  RecipeIngredient,
  ShoppingListItem,
  UserMacroTargets,
  WeeklyMealPlanResponse
} from '../../types/contracts';
import { matchOffersToShoppingList } from '../offers/offerMatcher';

/**
 * Standard makromål for en aktiv, helsebevisst voksen (2 porsjoner som standard)
 */
export const DEFAULT_USER_MACRO_TARGETS: UserMacroTargets = {
  minProteinGrams: 40,
  maxProteinGrams: 50,
  maxKcal: 780,
  targetCarbDryWeightGrams: 80,
  servings: 2,
  minPlantCount: 6,
  dietaryNote: 'Optimalisert for idrettsernæring, tarmhelse og rik tilbudsutnyttelse'
};

/**
 * Normaliseringsfunksjon for slug-nøkler (100% ren TypeScript uten node-avhengigheter)
 */
export function cleanSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Referansetabell for makroer per 100g råvare
 */
const INGREDIENT_MACROS: Record<
  string,
  { protein: number; kcal: number; carbs: number; fat: number; isProteinCore?: boolean }
> = {
  'fast tofu': { protein: 15, kcal: 135, carbs: 2, fat: 8, isProteinCore: true },
  'myk tofu (silken)': { protein: 7, kcal: 58, carbs: 2, fat: 3, isProteinCore: true },
  tempeh: { protein: 19, kcal: 195, carbs: 8, fat: 11, isProteinCore: true },
  'soya chunks (tørre)': { protein: 52, kcal: 345, carbs: 30, fat: 1.5, isProteinCore: true },
  'trs soya mince (tørr)': { protein: 52, kcal: 345, carbs: 30, fat: 1.5, isProteinCore: true },
  'røde linser (tørre)': { protein: 25, kcal: 340, carbs: 53, fat: 1.5, isProteinCore: true },
  'grønne linser (tørre)': { protein: 24, kcal: 330, carbs: 50, fat: 1.5, isProteinCore: true },
  edamamebønner: { protein: 12, kcal: 130, carbs: 8, fat: 5, isProteinCore: true },
  kikerter: { protein: 9, kcal: 140, carbs: 20, fat: 2.5, isProteinCore: true },
  'svarte bønner': { protein: 9, kcal: 120, carbs: 18, fat: 1, isProteinCore: true },
  kikertfusilli: { protein: 20, kcal: 350, carbs: 53, fat: 6, isProteinCore: true },
  quinoa: { protein: 14, kcal: 370, carbs: 64, fat: 6, isProteinCore: true },
  næringsgjær: { protein: 50, kcal: 380, carbs: 30, fat: 5, isProteinCore: true },
  basmatiris: { protein: 8, kcal: 350, carbs: 77, fat: 0.6 },
  'glutenrik ris': { protein: 7, kcal: 350, carbs: 78, fat: 0.5 },
  søtpotet: { protein: 2, kcal: 86, carbs: 20, fat: 0.1 },
  tahini: { protein: 18, kcal: 620, carbs: 12, fat: 54 },
  cashewnøtter: { protein: 18, kcal: 550, carbs: 30, fat: 44 },
  solsikkekjerner: { protein: 21, kcal: 580, carbs: 15, fat: 51 },
  sesamfrø: { protein: 18, kcal: 573, carbs: 12, fat: 50 },
  sesamolje: { protein: 0, kcal: 884, carbs: 0, fat: 100 },
  kokosmelk: { protein: 2, kcal: 190, carbs: 3, fat: 19 },
  'miso paste': { protein: 12, kcal: 190, carbs: 24, fat: 6 },
  gochujang: { protein: 5, kcal: 210, carbs: 45, fat: 1 },
  'soyasaus / tamari': { protein: 8, kcal: 60, carbs: 5, fat: 0 },
  riseddik: { protein: 0, kcal: 18, carbs: 4, fat: 0 },
  'hvitløk & ingefær': { protein: 3, kcal: 65, carbs: 13, fat: 0.5 },
  kimchi: { protein: 2, kcal: 25, carbs: 3, fat: 0.5 },
  brokkoli: { protein: 3, kcal: 35, carbs: 4, fat: 0.4 },
  spinat: { protein: 3, kcal: 23, carbs: 1.5, fat: 0.4 },
  'hakkede tomater': { protein: 1.2, kcal: 22, carbs: 3.5, fat: 0.2 },
  'champignon sopp': { protein: 3, kcal: 22, carbs: 2.3, fat: 0.3 },
  'paprika rød': { protein: 1, kcal: 30, carbs: 5, fat: 0.3 },
  agurk: { protein: 1, kcal: 15, carbs: 2.5, fat: 0.1 },
  vårløk: { protein: 2, kcal: 32, carbs: 5, fat: 0.2 },
  'fersk koriander': { protein: 2, kcal: 23, carbs: 2, fat: 0.5 },
  lime: { protein: 0.7, kcal: 30, carbs: 8, fat: 0.2 },
  avokado: { protein: 2, kcal: 160, carbs: 9, fat: 15 }
};

/**
 * Finner makroer per 100g for et gitt råvarenavn
 */
export function getIngredientNutritionPer100g(
  name: string,
  inventory: InventoryItem[] = []
): { protein: number; kcal: number; carbs: number; fat: number; isProteinCore: boolean } {
  const slug = cleanSlug(name);

  for (const [key, val] of Object.entries(INGREDIENT_MACROS)) {
    if (slug === cleanSlug(key) || slug.includes(cleanSlug(key)) || cleanSlug(key).includes(slug)) {
      return { ...val, isProteinCore: !!val.isProteinCore };
    }
  }

  const invMatch = inventory.find(
    (i) => cleanSlug(i.name) === slug || i.searchKeywords.some((k) => cleanSlug(k) === slug)
  );

  if (invMatch) {
    const isProteinCore = invMatch.proteinPer100g >= 12 || /tofu|tempeh|soya|linser|kikert/i.test(invMatch.name);
    return {
      protein: invMatch.proteinPer100g,
      kcal: invMatch.kcalPer100g,
      carbs: invMatch.isCarbBase ? 65 : 10,
      fat: invMatch.category === 'Krydder/Sauser' ? 15 : 2,
      isProteinCore
    };
  }

  const isProtein = /tofu|tempeh|soya|linser|bønner|kikerter|mince|chunks/i.test(slug);
  return {
    protein: isProtein ? 20 : 2,
    kcal: isProtein ? 180 : 40,
    carbs: 10,
    fat: 2,
    isProteinCore: isProtein
  };
}

/**
 * Gjenkjenner CuisineStyle basert på oppskriftens kjøkken- og titteltekst.
 */
export function detectCuisineStyle(cuisineStr?: string, title?: string): CuisineStyle {
  const combined = `${cuisineStr || ''} ${title || ''}`.toLowerCase();
  if (/meksikansk|latin|burrito|fajita|taco|chili con/i.test(combined)) return 'LATIN_AMERIKANSK';
  if (/indisk|dal|masala|tikka|curry|sør-asiatisk/i.test(combined)) return 'INDISK';
  if (/middelhav|italiensk|pasta|fusilli|tomat|bolognese|pesto/i.test(combined)) return 'MIDDELHAVS';
  if (/midtøsten|levantinsk|shawarma|tahini|hummus|falafel/i.test(combined)) return 'MIDTOSTEN';
  return 'ASIATISK';
}

/**
 * Utvidet oppskriftskatalog for de 5 verdensdelene, inkludert raske oppskrifter (<= 20 min).
 */
export const CHEF_CATALOG_RECIPES: Record<CuisineStyle, MealPlanDay[]> = {
  ASIATISK: [
    {
      dayNumber: 1,
      dayName: 'Mandag',
      title: 'Koreansk Gochujang Crispy Tofu & Edamame Bowl med Klebrig Ris',
      cuisine: 'Koreansk',
      carbBase: { name: 'Glutenrik ris', dryWeightGramsPerPerson: 80 },
      proteinSources: ['Fast tofu (200g)', 'Edamamebønner (80g)', 'Næringsgjær (10g)'],
      gutHealthHighlights: ['Levende fermentert kimchi', 'Prebiotisk hvitløk og ingefær', 'Fermentert gochujang'],
      allergenSafety: { isVegan: true, isPeanutFree: true, nutFreeAlternativeUsed: 'Sesamfrø og sesamolje' },
      macros: { proteinGramsPerPerson: 47, kcalPerPerson: 755, carbsGramsPerPerson: 86, fatGramsPerPerson: 22, plantCount: 10 },
      ingredients: [
        { name: 'Fast tofu', amountGrams: 400, displayAmount: '400g tofu', inStock: false, category: 'Kjøl/Tofu' },
        { name: 'Edamamebønner', amountGrams: 160, displayAmount: '160g edamame', inStock: false, category: 'Kjøl/Tofu' },
        { name: 'Glutenrik ris', amountGrams: 160, displayAmount: '160g tørrvekt', inStock: true, category: 'Tørrvarer/Belgvekster' },
        { name: 'Brokkoli', amountGrams: 250, displayAmount: '250g buketter', inStock: false, category: 'Frukt & Grønt' },
        { name: 'Kimchi', amountGrams: 120, displayAmount: '120g kimchi', inStock: false, category: 'Kjøl/Tofu' },
        { name: 'Gochujang', amountGrams: 40, displayAmount: '2 ss gochujang', inStock: true, category: 'Krydder/Sauser' },
        { name: 'Soyasaus / Tamari', amountGrams: 30, displayAmount: '2 ss soyasaus', inStock: true, category: 'Krydder/Sauser' },
        { name: 'Sesamolje', amountGrams: 15, displayAmount: '1 ss sesamolje', inStock: true, category: 'Krydder/Sauser' },
        { name: 'Næringsgjær', amountGrams: 20, displayAmount: '20g', inStock: true, category: 'Krydder/Sauser' }
      ],
      steps: [
        'Kok glutenrik ris til den er mør og lett klebrig.',
        'Kutt tofu i biter, vend i litt soyasaus og stek sprø i panne.',
        'Pisk sammen gochujang, tamari, sesamolje og revet ingefær/hvitløk. Vend tofuen i sausen.',
        'Damp brokkoli og edamame i 3 minutter.',
        'Bygg bollen med ris, glasert tofu, dampede grønnsaker og fermentert kimchi.'
      ],
      prepTimeMinutes: 25
    },
    {
      dayNumber: 4,
      dayName: 'Torsdag',
      title: 'Japansk Miso-Glazed Tempeh & Tofu Quinoa Power Bowl med Kimchi',
      cuisine: 'Japansk',
      carbBase: { name: 'Quinoa', dryWeightGramsPerPerson: 75 },
      proteinSources: ['Tempeh (110g)', 'Fast tofu (100g)', 'Edamamebønner (40g)'],
      gutHealthHighlights: ['Lys fermentert miso paste', 'Tradisjonell tempeh', 'Rå kimchi'],
      allergenSafety: { isVegan: true, isPeanutFree: true, nutFreeAlternativeUsed: 'Røstede cashewnøtter' },
      macros: { proteinGramsPerPerson: 49, kcalPerPerson: 780, carbsGramsPerPerson: 81, fatGramsPerPerson: 25, plantCount: 10 },
      ingredients: [
        { name: 'Tempeh', amountGrams: 220, displayAmount: '220g tempeh', inStock: false, category: 'Kjøl/Tofu' },
        { name: 'Fast tofu', amountGrams: 200, displayAmount: '200g tofu', inStock: false, category: 'Kjøl/Tofu' },
        { name: 'Quinoa', amountGrams: 150, displayAmount: '150g tørrvekt', inStock: false, category: 'Tørrvarer/Belgvekster' },
        { name: 'Edamamebønner', amountGrams: 80, displayAmount: '80g edamame', inStock: false, category: 'Kjøl/Tofu' },
        { name: 'Brokkoli', amountGrams: 200, displayAmount: '200g buketter', inStock: false, category: 'Frukt & Grønt' },
        { name: 'Kimchi', amountGrams: 100, displayAmount: '100g kimchi', inStock: false, category: 'Kjøl/Tofu' },
        { name: 'Miso paste', amountGrams: 30, displayAmount: '30g miso', inStock: true, category: 'Krydder/Sauser' },
        { name: 'Cashewnøtter', amountGrams: 20, displayAmount: '20g cashews', inStock: true, category: 'Tørrvarer/Belgvekster' }
      ],
      steps: [
        'Kok quinoa i lettsaltet vann i 14 minutter til luftig.',
        'Skjær tempeh og tofu i staver, sprøstek i panne.',
        'Pensle med miso, soyasaus og riseddik mot slutten så det karamelliserer.',
        'Damp brokkoli og edamame i 3 minutter.',
        'Anrett i skål med quinoa, tempeh, grønnsaker, kimchi og ristede cashews.'
      ],
      prepTimeMinutes: 30
    },
    {
      dayNumber: 1,
      dayName: 'Mandag',
      title: 'Lynrask 15-min Chili-Garlic Tofu & Nudel Stir-Fry med Edamame',
      cuisine: 'Asiatisk Fusion',
      carbBase: { name: 'Kikertfusilli', dryWeightGramsPerPerson: 80 },
      proteinSources: ['Fast tofu (190g)', 'Edamamebønner (70g)', 'Næringsgjær (10g)'],
      gutHealthHighlights: ['Fersk hvitløk og ingefær', 'Raskt dampet brokkoli', 'Fermentert tamari'],
      allergenSafety: { isVegan: true, isPeanutFree: true, nutFreeAlternativeUsed: 'Sesamfrø og tahini' },
      macros: { proteinGramsPerPerson: 46, kcalPerPerson: 720, carbsGramsPerPerson: 82, fatGramsPerPerson: 21, plantCount: 8 },
      ingredients: [
        { name: 'Fast tofu', amountGrams: 380, displayAmount: '380g tofu i terninger', inStock: false, category: 'Kjøl/Tofu' },
        { name: 'Edamamebønner', amountGrams: 140, displayAmount: '140g edamame', inStock: false, category: 'Kjøl/Tofu' },
        { name: 'Kikertfusilli', amountGrams: 160, displayAmount: '160g tørrvekt', inStock: false, category: 'Tørrvarer/Belgvekster' },
        { name: 'Brokkoli', amountGrams: 200, displayAmount: '200g brokkolitopper', inStock: false, category: 'Frukt & Grønt' },
        { name: 'Soyasaus / Tamari', amountGrams: 30, displayAmount: '2 ss soyasaus', inStock: true, category: 'Krydder/Sauser' },
        { name: 'Sesamolje', amountGrams: 15, displayAmount: '1 ss sesamolje', inStock: true, category: 'Krydder/Sauser' },
        { name: 'Næringsgjær', amountGrams: 20, displayAmount: '20g', inStock: true, category: 'Krydder/Sauser' }
      ],
      steps: [
        'Kok kikertpasta i 7 minutter.',
        'Wok terninger av tofu med sesamolje, hvitløk og edamame på høy varme i 6 minutter.',
        'Vend inn tamari, næringsgjær og brokkolibuketter de siste 3 minuttene.',
        'Bland sammen og server rykende varmt på 15 minutter flat!'
      ],
      prepTimeMinutes: 15
    }
  ],

  INDISK: [
    {
      dayNumber: 2,
      dayName: 'Tirsdag',
      title: 'Indisk Red Lentil & High-Protein Soya Chunks Dal med Duftende Basmatiris',
      cuisine: 'Indisk / Sør-Asiatisk',
      carbBase: { name: 'Basmatiris', dryWeightGramsPerPerson: 80 },
      proteinSources: ['Røde linser (60g tørre)', 'Soya chunks (45g tørre)', 'Næringsgjær (10g)'],
      gutHealthHighlights: ['Prebiotiske røde linser', 'Fersk ingefær og gurkemeie', 'Spinat'],
      allergenSafety: { isVegan: true, isPeanutFree: true, nutFreeAlternativeUsed: 'Solsikkekjerner' },
      macros: { proteinGramsPerPerson: 48, kcalPerPerson: 765, carbsGramsPerPerson: 89, fatGramsPerPerson: 18, plantCount: 11 },
      ingredients: [
        { name: 'Røde linser (tørre)', amountGrams: 120, displayAmount: '120g tørre linser', inStock: true, category: 'Tørrvarer/Belgvekster' },
        { name: 'Soya chunks (tørre)', amountGrams: 90, displayAmount: '90g tørre chunks', inStock: true, category: 'Tørrvarer/Belgvekster' },
        { name: 'Basmatiris', amountGrams: 160, displayAmount: '160g tørrvekt', inStock: true, category: 'Tørrvarer/Belgvekster' },
        { name: 'Spinat', amountGrams: 150, displayAmount: '150g fersk spinat', inStock: false, category: 'Frukt & Grønt' },
        { name: 'Hakkede tomater', amountGrams: 240, displayAmount: '240g tomater', inStock: false, category: 'Krydder/Sauser' },
        { name: 'Kokosmelk', amountGrams: 100, displayAmount: '100ml kokosmelk', inStock: false, category: 'Krydder/Sauser' },
        { name: 'Solsikkekjerner', amountGrams: 20, displayAmount: '20g solsikkekjerner', inStock: true, category: 'Tørrvarer/Belgvekster' },
        { name: 'Næringsgjær', amountGrams: 20, displayAmount: '20g', inStock: true, category: 'Krydder/Sauser' }
      ],
      steps: [
        'Trekk soya chunks i kokende vann i 7 minutter og press ut overskuddsvæske.',
        'Kok røde linser i tomater, vann og krydder i 15 minutter.',
        'Kok basmatiris.',
        'Stek soya chunks i panne med garam masala.',
        'Vend soya chunks, kokosmelk og spinat inn i dalen og server over ris.'
      ],
      prepTimeMinutes: 30
    },
    {
      dayNumber: 2,
      dayName: 'Tirsdag',
      title: 'Kremet 18-min Kikerter & Spinat Tikka Masala med Basmatiris',
      cuisine: 'Indisk Hurtig',
      carbBase: { name: 'Basmatiris', dryWeightGramsPerPerson: 80 },
      proteinSources: ['Kikerter (140g)', 'Fast tofu (150g)', 'Næringsgjær (10g)'],
      gutHealthHighlights: ['Kikertfiber', 'Tomatlycopen', 'Ingefær og spisskummen'],
      allergenSafety: { isVegan: true, isPeanutFree: true, nutFreeAlternativeUsed: 'Solsikkekjerner og tahini' },
      macros: { proteinGramsPerPerson: 45, kcalPerPerson: 740, carbsGramsPerPerson: 86, fatGramsPerPerson: 19, plantCount: 9 },
      ingredients: [
        { name: 'Kikerter', amountGrams: 280, displayAmount: '280g kokte kikerter', inStock: true, category: 'Tørrvarer/Belgvekster' },
        { name: 'Fast tofu', amountGrams: 300, displayAmount: '300g tofu i terninger', inStock: false, category: 'Kjøl/Tofu' },
        { name: 'Basmatiris', amountGrams: 160, displayAmount: '160g tørrvekt', inStock: true, category: 'Tørrvarer/Belgvekster' },
        { name: 'Hakkede tomater', amountGrams: 240, displayAmount: '240g hermetiske tomater', inStock: false, category: 'Krydder/Sauser' },
        { name: 'Spinat', amountGrams: 120, displayAmount: '120g babyspinat', inStock: false, category: 'Frukt & Grønt' },
        { name: 'Kokosmelk', amountGrams: 80, displayAmount: '80ml kokosmelk', inStock: false, category: 'Krydder/Sauser' },
        { name: 'Næringsgjær', amountGrams: 20, displayAmount: '20g', inStock: true, category: 'Krydder/Sauser' }
      ],
      steps: [
        'Sett basmatiris til koking (hurtigmetode: 10-12 min).',
        'Brun tofu i en vid panne i 5 minutter sammen med tikka masala-krydder.',
        'Tilsett kikerter, hakkede tomater, kokosmelk og la boble i 7 minutter.',
        'Rør inn babyspinat og næringsgjær de siste 2 minuttene.',
        'Server over ris med ferskpresset lime.'
      ],
      prepTimeMinutes: 18
    }
  ],

  MIDDELHAVS: [
    {
      dayNumber: 3,
      dayName: 'Onsdag',
      title: 'Kremet Tahini & Soltørket Tomat Kikertfusilli med Sprøstekt TRS Soya Mince',
      cuisine: 'Middelhavs / Italiensk',
      carbBase: { name: 'Kikertfusilli', dryWeightGramsPerPerson: 85 },
      proteinSources: ['Kikertfusilli (85g tørrvekt)', 'TRS Soya mince (45g tørr)', 'Næringsgjær (12g)'],
      gutHealthHighlights: ['Fiber fra kikertmel', 'Hvitløk og sopp', 'Tomatlycopen'],
      allergenSafety: { isVegan: true, isPeanutFree: true, nutFreeAlternativeUsed: 'Sesam-tahini uten nøtter' },
      macros: { proteinGramsPerPerson: 49, kcalPerPerson: 750, carbsGramsPerPerson: 84, fatGramsPerPerson: 21, plantCount: 8 },
      ingredients: [
        { name: 'Kikertfusilli', amountGrams: 170, displayAmount: '170g tørrvekt', inStock: false, category: 'Tørrvarer/Belgvekster' },
        { name: 'TRS Soya mince (tørr)', amountGrams: 90, displayAmount: '90g tørr mince', inStock: true, category: 'Tørrvarer/Belgvekster' },
        { name: 'Tahini', amountGrams: 35, displayAmount: '35g tahini', inStock: false, category: 'Krydder/Sauser' },
        { name: 'Næringsgjær', amountGrams: 25, displayAmount: '25g næringsgjær', inStock: true, category: 'Krydder/Sauser' },
        { name: 'Champignon sopp', amountGrams: 200, displayAmount: '200g sopp', inStock: false, category: 'Frukt & Grønt' },
        { name: 'Spinat', amountGrams: 120, displayAmount: '120g spinat', inStock: false, category: 'Frukt & Grønt' },
        { name: 'Hakkede tomater', amountGrams: 200, displayAmount: '200g tomater', inStock: false, category: 'Krydder/Sauser' }
      ],
      steps: [
        'Rehydrer soya mince i varm buljong i 5 min og klem ut vann.',
        'Stek mincen sprø i panne sammen med sopp og hvitløk.',
        'Kok kikertfusilli i 7 minutter og spar på 1 dl pastavann.',
        'Emulger tahini, næringsgjær, tomater og varmt pastavann til en kremet saus.',
        'Vend pasta, saus, spinat og mince sammen og server med nykvernet pepper.'
      ],
      prepTimeMinutes: 25
    },
    {
      dayNumber: 3,
      dayName: 'Onsdag',
      title: '18-min Rask Kikertfusilli med Soltørket Tomat, Spinat & Hvite Bønner',
      cuisine: 'Middelhavs Hurtig',
      carbBase: { name: 'Kikertfusilli', dryWeightGramsPerPerson: 85 },
      proteinSources: ['Kikertfusilli (85g tørrvekt)', 'Hvite bønner (130g)', 'Næringsgjær (12g)'],
      gutHealthHighlights: ['Hvite bønner rike på resistent stivelse', 'Hvitløk og basilikum', 'Soltørkede tomater'],
      allergenSafety: { isVegan: true, isPeanutFree: true, nutFreeAlternativeUsed: 'Tahini og solsikkekjerner' },
      macros: { proteinGramsPerPerson: 46, kcalPerPerson: 730, carbsGramsPerPerson: 85, fatGramsPerPerson: 20, plantCount: 8 },
      ingredients: [
        { name: 'Kikertfusilli', amountGrams: 170, displayAmount: '170g tørrvekt', inStock: false, category: 'Tørrvarer/Belgvekster' },
        { name: 'Hvite bønner', amountGrams: 260, displayAmount: '260g skylte hvite bønner', inStock: true, category: 'Tørrvarer/Belgvekster' },
        { name: 'Tahini', amountGrams: 30, displayAmount: '30g tahini', inStock: true, category: 'Krydder/Sauser' },
        { name: 'Spinat', amountGrams: 130, displayAmount: '130g babyspinat', inStock: false, category: 'Frukt & Grønt' },
        { name: 'Hakkede tomater', amountGrams: 200, displayAmount: '200g tomater', inStock: false, category: 'Krydder/Sauser' },
        { name: 'Næringsgjær', amountGrams: 24, displayAmount: '24g', inStock: true, category: 'Krydder/Sauser' }
      ],
      steps: [
        'Kok kikertfusilli i 7 minutter.',
        'Fres hvitløk, hakkede tomater og hvite bønner i en panne i 5 minutter.',
        'Rør inn tahini, næringsgjær og en skvett pastavann.',
        'Vend inn den kokte pastaen og spinaten i 2 minutter og server!'
      ],
      prepTimeMinutes: 18
    }
  ],

  MIDTOSTEN: [
    {
      dayNumber: 5,
      dayName: 'Fredag',
      title: 'Levantinsk Shawarma Soya Chunks & Røstede Kikerter med Søtpotet og Hvitløks-Tahini',
      cuisine: 'Midtøsten / Levantinsk',
      carbBase: { name: 'Søtpotet', dryWeightGramsPerPerson: 75 },
      proteinSources: ['Soya chunks (50g tørre)', 'Kikerter (120g kokte)', 'Næringsgjær (6g)'],
      gutHealthHighlights: ['Bakt søtpotet', 'Kikerter og tahini', 'Koriander og hvitløk'],
      allergenSafety: { isVegan: true, isPeanutFree: true, nutFreeAlternativeUsed: 'Hvitløks-tahini og solsikkekjerner' },
      macros: { proteinGramsPerPerson: 48, kcalPerPerson: 770, carbsGramsPerPerson: 87, fatGramsPerPerson: 22, plantCount: 11 },
      ingredients: [
        { name: 'Søtpotet', amountGrams: 500, displayAmount: '500g fersk søtpotet', inStock: false, category: 'Frukt & Grønt' },
        { name: 'Soya chunks (tørre)', amountGrams: 100, displayAmount: '100g tørre chunks', inStock: true, category: 'Tørrvarer/Belgvekster' },
        { name: 'Kikerter', amountGrams: 240, displayAmount: '240g kikerter', inStock: true, category: 'Tørrvarer/Belgvekster' },
        { name: 'Tahini', amountGrams: 40, displayAmount: '40g hvit tahini', inStock: false, category: 'Krydder/Sauser' },
        { name: 'Spinat', amountGrams: 100, displayAmount: '100g spinat', inStock: false, category: 'Frukt & Grønt' },
        { name: 'Næringsgjær', amountGrams: 15, displayAmount: '15g', inStock: true, category: 'Krydder/Sauser' }
      ],
      steps: [
        'Kutt søtpotet i terninger og bak i airfryer eller ovn i 20 minutter til møre.',
        'Rehydrer og klem ut soya chunks, og krydre med shawarma-krydder.',
        'Stek soya chunks og kikerter i panne til sprø og duftende.',
        'Pisk tahini med sitron, hvitløk og kaldt vann til en lys dressing.',
        'Bygg bollen med søtpotet, sprø shawarma-chunks, kikerter og tahinidressing.'
      ],
      prepTimeMinutes: 35
    },
    {
      dayNumber: 5,
      dayName: 'Fredag',
      title: '18-min Falafel-krydret Kikert- & Tahini Power Bowl med Hurtig-Quinoa',
      cuisine: 'Midtøsten Hurtig',
      carbBase: { name: 'Quinoa', dryWeightGramsPerPerson: 75 },
      proteinSources: ['Kikerter (150g)', 'Fast tofu (150g)', 'Næringsgjær (8g)'],
      gutHealthHighlights: ['Fiberrike kikerter', 'Prebiotisk quinoa', 'Tahini og hvitløk'],
      allergenSafety: { isVegan: true, isPeanutFree: true, nutFreeAlternativeUsed: 'Hvitløks-tahini' },
      macros: { proteinGramsPerPerson: 46, kcalPerPerson: 740, carbsGramsPerPerson: 83, fatGramsPerPerson: 21, plantCount: 9 },
      ingredients: [
        { name: 'Quinoa', amountGrams: 150, displayAmount: '150g tørrvekt', inStock: false, category: 'Tørrvarer/Belgvekster' },
        { name: 'Kikerter', amountGrams: 300, displayAmount: '300g kikerter', inStock: true, category: 'Tørrvarer/Belgvekster' },
        { name: 'Fast tofu', amountGrams: 300, displayAmount: '300g tofu', inStock: false, category: 'Kjøl/Tofu' },
        { name: 'Tahini', amountGrams: 35, displayAmount: '35g tahini', inStock: true, category: 'Krydder/Sauser' },
        { name: 'Spinat', amountGrams: 100, displayAmount: '100g spinat', inStock: false, category: 'Frukt & Grønt' },
        { name: 'Næringsgjær', amountGrams: 16, displayAmount: '16g', inStock: true, category: 'Krydder/Sauser' }
      ],
      steps: [
        'Kok quinoa i lettsaltet vann i 12 minutter.',
        'Stek terninger av tofu og kikerter med spisskummen, koriander og hvitløkspulver i 7 minutter.',
        'Rør tahini med litt sitronsaft og vann til en silkemyk dressing.',
        'Legg lun quinoa i bunnen, topp med falafel-stekt tofu og kikerter, babyspinat og tahinidressing.'
      ],
      prepTimeMinutes: 18
    }
  ],

  LATIN_AMERIKANSK: [
    {
      dayNumber: 5,
      dayName: 'Fredag',
      title: 'Meksikansk Svarte Bønner & Sprø Tofu Burrito Bowl med Brun Ris og Frisk Salsa',
      cuisine: 'Latin-Amerikansk & Meksikansk',
      carbBase: { name: 'Basmatiris', dryWeightGramsPerPerson: 80 },
      proteinSources: ['Fast tofu (180g)', 'Svarte bønner (140g)', 'Næringsgjær (10g)'],
      gutHealthHighlights: ['Svarte bønner med prebiotisk fiber', 'Fersk koriander og lime', 'Søt paprika'],
      allergenSafety: { isVegan: true, isPeanutFree: true, nutFreeAlternativeUsed: 'Lime-tahini og solsikkekjerner' },
      macros: { proteinGramsPerPerson: 46, kcalPerPerson: 740, carbsGramsPerPerson: 85, fatGramsPerPerson: 20, plantCount: 9 },
      ingredients: [
        { name: 'Fast tofu', amountGrams: 360, displayAmount: '360g tofu i kuber', inStock: false, category: 'Kjøl/Tofu' },
        { name: 'Svarte bønner', amountGrams: 280, displayAmount: '280g hermetiske bønner', inStock: true, category: 'Tørrvarer/Belgvekster' },
        { name: 'Basmatiris', amountGrams: 160, displayAmount: '160g tørrvekt', inStock: true, category: 'Tørrvarer/Belgvekster' },
        { name: 'Paprika rød', amountGrams: 150, displayAmount: '1 stor rød paprika', inStock: false, category: 'Frukt & Grønt' },
        { name: 'Fersk koriander', amountGrams: 20, displayAmount: '1 håndfull koriander', inStock: false, category: 'Frukt & Grønt' },
        { name: 'Lime', amountGrams: 40, displayAmount: '1 fersk lime', inStock: false, category: 'Frukt & Grønt' },
        { name: 'Tahini', amountGrams: 30, displayAmount: '30g tahini', inStock: true, category: 'Krydder/Sauser' },
        { name: 'Næringsgjær', amountGrams: 20, displayAmount: '20g', inStock: true, category: 'Krydder/Sauser' }
      ],
      steps: [
        'Kok ris til den er mør.',
        'Stek tofu i terninger med spisskummen, paprikapulver og hvitløk til gyllen.',
        'Varm svarte bønner og strimlet rød paprika i 3 minutter.',
        'Rør tahini, limejuice og litt vann til en frisk lime-tahinidressing.',
        'Anrett ris i bunn, legg på chipotle-tofu, svarte bønner, paprika og fersk koriander.'
      ],
      prepTimeMinutes: 20
    },
    {
      dayNumber: 5,
      dayName: 'Fredag',
      title: 'Chipotle Soya Chunks & Røstet Kikerter Burrito Bowl med Lime og Koriander',
      cuisine: 'Meksikansk Fusion',
      carbBase: { name: 'Basmatiris', dryWeightGramsPerPerson: 80 },
      proteinSources: ['Soya chunks (45g tørre)', 'Kikerter (130g)', 'Næringsgjær (8g)'],
      gutHealthHighlights: ['Kikerter og soyafiber', 'Lime og antioksidantrik paprika', 'Hvitløk'],
      allergenSafety: { isVegan: true, isPeanutFree: true, nutFreeAlternativeUsed: 'Solsikkekjerner og tahini' },
      macros: { proteinGramsPerPerson: 47, kcalPerPerson: 745, carbsGramsPerPerson: 86, fatGramsPerPerson: 19, plantCount: 9 },
      ingredients: [
        { name: 'Soya chunks (tørre)', amountGrams: 90, displayAmount: '90g tørre chunks', inStock: true, category: 'Tørrvarer/Belgvekster' },
        { name: 'Kikerter', amountGrams: 260, displayAmount: '260g kikerter', inStock: true, category: 'Tørrvarer/Belgvekster' },
        { name: 'Basmatiris', amountGrams: 160, displayAmount: '160g tørrvekt', inStock: true, category: 'Tørrvarer/Belgvekster' },
        { name: 'Paprika rød', amountGrams: 150, displayAmount: '1 stor rød paprika', inStock: false, category: 'Frukt & Grønt' },
        { name: 'Lime', amountGrams: 40, displayAmount: '1 lime', inStock: false, category: 'Frukt & Grønt' },
        { name: 'Tahini', amountGrams: 30, displayAmount: '30g tahini', inStock: true, category: 'Krydder/Sauser' },
        { name: 'Næringsgjær', amountGrams: 16, displayAmount: '16g', inStock: true, category: 'Krydder/Sauser' }
      ],
      steps: [
        'Rehydrer soya chunks i varm kraft i 6 minutter og press godt.',
        'Stek chunks og kikerter med chipotle-krydder i en varm panne.',
        'Kok ris til mør.',
        'Pisk lime-tahini med hvitløk og salt.',
        'Bygg meksikansk bowl med ris, krydret soya chunks, kikerter og lime-dressing.'
      ],
      prepTimeMinutes: 22
    }
  ]
};

/**
 * Velger og tilpasser 5 dager ut fra brukerens Kokkens Modus-innstillinger.
 */
export function selectAndAdjustDaysForChefModes(
  baseDays: MealPlanDay[],
  chefModes?: ChefModePreferences,
  inventory: InventoryItem[] = []
): MealPlanDay[] {
  if (!chefModes) {
    return baseDays;
  }

  const DAY_NAMES = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag'] as const;
  const isCuisineFilterActive = chefModes.enableCuisineFilter && chefModes.selectedCuisines && chefModes.selectedCuisines.length > 0;
  const targetCuisines: CuisineStyle[] = isCuisineFilterActive
    ? chefModes.selectedCuisines
    : ['ASIATISK', 'INDISK', 'MIDDELHAVS', 'MIDTOSTEN', 'LATIN_AMERIKANSK'];

  // Samle kandidater fra katalogen og baseDays som matcher
  const candidatePool: MealPlanDay[] = [];

  for (const cuisine of targetCuisines) {
    const catalogOptions = CHEF_CATALOG_RECIPES[cuisine] || [];
    candidatePool.push(...catalogOptions);
  }

  // Legg også til baseDays hvis de matcher de valgte stilene
  for (const bDay of baseDays) {
    const style = detectCuisineStyle(bDay.cuisine, bDay.title);
    if (targetCuisines.includes(style)) {
      if (!candidatePool.some(c => cleanSlug(c.title) === cleanSlug(bDay.title))) {
        candidatePool.push(bDay);
      }
    }
  }

  // Hvis poolen er tom av en eller annen grunn, fall tilbake til baseDays
  if (candidatePool.length === 0) {
    return baseDays;
  }

  // Ranger og filtrer kandidater basert på chefModes
  const scoredCandidates = candidatePool.map((recipe) => {
    let score = 0;
    const prepTime = recipe.prepTimeMinutes || 25;

    // 1. Rask hverdag (Maks 20 min)
    if (chefModes.quickMealsOnly) {
      if (prepTime <= 20) score += 50;
      else score -= 30;
    }

    // 2. Tøm skapet først (prioriter råvarer som er på lager)
    if (chefModes.prioritizePantry && inventory.length > 0) {
      const inStockCount = recipe.ingredients.filter(ing => {
        const slug = cleanSlug(ing.name);
        return inventory.some(inv => inv.inStock && (cleanSlug(inv.name) === slug || inv.searchKeywords.some(k => cleanSlug(k) === slug)));
      }).length;
      score += inStockCount * 5;
    }

    return { recipe, score };
  });

  // Sorter kandidatene etter score
  scoredCandidates.sort((a, b) => b.score - a.score);

  // Velg 5 unike dager med variasjon på tvers av valgte stiler
  const selected: MealPlanDay[] = [];
  const usedTitles = new Set<string>();

  // Roter mellom målkategoriene for å sikre bredde
  for (let i = 0; i < 5; i++) {
    const desiredCuisine = targetCuisines[i % targetCuisines.length];
    
    // Finn beste match for denne stilen
    const match = scoredCandidates.find(
      c => detectCuisineStyle(c.recipe.cuisine, c.recipe.title) === desiredCuisine && !usedTitles.has(cleanSlug(c.recipe.title))
    );

    if (match) {
      selected.push({ ...match.recipe });
      usedTitles.add(cleanSlug(match.recipe.title));
    } else {
      // Finn en hvilken som helst ubrukt kandidat
      const fallback = scoredCandidates.find(c => !usedTitles.has(cleanSlug(c.recipe.title)));
      if (fallback) {
        selected.push({ ...fallback.recipe });
        usedTitles.add(cleanSlug(fallback.recipe.title));
      } else if (candidatePool[i % candidatePool.length]) {
        selected.push({ ...candidatePool[i % candidatePool.length] });
      }
    }
  }

  // Tildel dagnummer og dagsnavn 1..5
  return selected.map((day, idx) => {
    const dayNumber = (idx + 1) as 1 | 2 | 3 | 4 | 5;
    const dayName = DAY_NAMES[idx];
    let finalTitle = day.title;

    // Hvis brukeren har eget kokkeønske og dette er dag 1 eller 5, reflekter det diskret
    if (chefModes.enableCustomNotes && chefModes.customNotes.trim() && idx === 0) {
      const noteClean = chefModes.customNotes.trim();
      if (!finalTitle.toLowerCase().includes(noteClean.toLowerCase().substring(0, 5))) {
        finalTitle = `${finalTitle} (Kokkens ønske: ${noteClean})`;
      }
    }

    const prepTimeMinutes = chefModes.quickMealsOnly
      ? Math.min(20, day.prepTimeMinutes || 20)
      : day.prepTimeMinutes || 25;

    return {
      ...day,
      dayNumber,
      dayName,
      title: finalTitle,
      prepTimeMinutes
    };
  });
}

/**
 * Skalerer en ukeplan dynamisk til brukerens nye makromål (`UserMacroTargets`).
 * Kjører både på serveren og direkte i nettleseren (klient-side på GitHub Pages).
 */
export function scaleMealPlanToMacroTargets(
  baseDays: MealPlanDay[],
  targets: UserMacroTargets,
  inventory: InventoryItem[] = [],
  offers: NormalizedOffer[] = [],
  chefModes?: ChefModePreferences
): WeeklyMealPlanResponse {
  const servings = Math.max(1, targets.servings);
  const targetProteinPerPerson = Math.max(
    targets.minProteinGrams,
    Math.min(targets.maxProteinGrams, (targets.minProteinGrams + targets.maxProteinGrams) / 2)
  );
  const targetCarbDryGrams = Math.max(40, targets.targetCarbDryWeightGrams);
  const maxKcal = Math.max(500, targets.maxKcal);

  // Velg og juster oppskrifter hvis kokkens modus er oppgitt
  const activeDays = selectAndAdjustDaysForChefModes(baseDays, chefModes, inventory);

  // Inventar-oppslag for inStock-status
  const inStockMap = new Map<string, boolean>();
  for (const item of inventory) {
    inStockMap.set(cleanSlug(item.name), item.inStock);
    for (const kw of item.searchKeywords) {
      inStockMap.set(cleanSlug(kw), item.inStock);
    }
  }

  const scaledDays: MealPlanDay[] = activeDays.map((baseDay) => {
    // 1. Identifiser karbohydratbase
    const isSweetPotatoCarb = cleanSlug(baseDay.carbBase.name).includes('sotpotet');
    const carbGramsPerPerson = isSweetPotatoCarb
      ? Math.round(targetCarbDryGrams * (250 / 75)) // 75g tørrkarbo tilsvarer ca 250g fersk søtpotet
      : targetCarbDryGrams;

    // 2. Første passering: regn ut baseline protein fra karbohydratbase og grønnsaker
    let fixedProteinFromCarbAndVeggies = 0;
    let baselineProteinCoreProtein = 0;

    const classifiedIngredients = baseDay.ingredients.map((ing) => {
      const isCarb =
        cleanSlug(ing.name).includes(cleanSlug(baseDay.carbBase.name)) ||
        (isSweetPotatoCarb && cleanSlug(ing.name).includes('sotpotet'));
      const nutrition = getIngredientNutritionPer100g(ing.name, inventory);
      const isProteinCore = !isCarb && (nutrition.isProteinCore || /tofu|tempeh|soya|linser|kikert/i.test(ing.name));

      return {
        ...ing,
        nutrition,
        isCarb,
        isProteinCore
      };
    });

    for (const item of classifiedIngredients) {
      if (item.isCarb) {
        const carbProtein = (carbGramsPerPerson * item.nutrition.protein) / 100;
        fixedProteinFromCarbAndVeggies += carbProtein;
      } else if (item.isProteinCore) {
        // Beregn baseline protein per person (baseDay var normalt beregnet for 2 personer)
        const baselinePerPersonGrams = item.amountGrams / 2;
        baselineProteinCoreProtein += (baselinePerPersonGrams * item.nutrition.protein) / 100;
      } else {
        const baselinePerPersonGrams = item.amountGrams / 2;
        fixedProteinFromCarbAndVeggies += (baselinePerPersonGrams * item.nutrition.protein) / 100;
      }
    }

    // 3. Beregn nødvendig skaleringsfaktor for proteinkildene
    const targetProteinNeededFromCore = Math.max(15, targetProteinPerPerson - fixedProteinFromCarbAndVeggies);
    const proteinScaleFactor =
      baselineProteinCoreProtein > 0
        ? Math.max(0.6, Math.min(2.5, targetProteinNeededFromCore / baselineProteinCoreProtein))
        : 1.0;

    // 4. Skaler alle ingredienser til nye mengder basert på `servings`
    let updatedIngredients: RecipeIngredient[] = classifiedIngredients.map((item) => {
      let finalPerPersonGrams: number;

      if (item.isCarb) {
        finalPerPersonGrams = carbGramsPerPerson;
      } else if (item.isProteinCore) {
        const baselinePerPersonGrams = item.amountGrams / 2;
        finalPerPersonGrams = Math.round(baselinePerPersonGrams * proteinScaleFactor);
      } else {
        // Grønnsaker og sauser skalerer rett med antall porsjoner
        finalPerPersonGrams = Math.round(item.amountGrams / 2);
      }

      const totalAmountGrams = Math.round(finalPerPersonGrams * servings);

      // Bestem inStock fra inventory
      const slug = cleanSlug(item.name);
      let inStock = item.inStock;
      if (inStockMap.has(slug)) {
        inStock = inStockMap.get(slug)!;
      }

      // Lag en ren, informativ displayAmount
      let displayAmount = `${totalAmountGrams}g`;
      if (item.isCarb) {
        displayAmount = isSweetPotatoCarb
          ? `${totalAmountGrams}g fersk søtpotet (${finalPerPersonGrams}g per pers)`
          : `${totalAmountGrams}g tørrvekt (${finalPerPersonGrams}g per pers)`;
      } else if (item.isProteinCore) {
        displayAmount = `${totalAmountGrams}g (${finalPerPersonGrams}g per pers)`;
      } else if (item.name.includes('Tamari') || item.name.includes('olje') || item.name.includes('eddik')) {
        displayAmount = `${totalAmountGrams}ml (${Math.round(totalAmountGrams / 15)} ss)`;
      } else {
        displayAmount = `${totalAmountGrams}g`;
      }

      return {
        name: item.name,
        amountGrams: totalAmountGrams,
        displayAmount,
        inStock,
        category: item.category
      };
    });

    // 5. Nøyaktig makroberegning
    let totalMealProtein = 0;
    let totalMealKcal = 0;
    let totalMealCarbs = 0;
    let totalMealFat = 0;

    for (const ing of updatedIngredients) {
      const nut = getIngredientNutritionPer100g(ing.name, inventory);
      const ratio = ing.amountGrams / 100;
      totalMealProtein += nut.protein * ratio;
      totalMealKcal += nut.kcal * ratio;
      totalMealCarbs += nut.carbs * ratio;
      totalMealFat += nut.fat * ratio;
    }

    let proteinPerPerson = Math.round(totalMealProtein / servings);
    let kcalPerPerson = Math.round(totalMealKcal / servings);
    let carbsPerPerson = Math.round(totalMealCarbs / servings);
    let fatPerPerson = Math.round(totalMealFat / servings);

    // 6. Kalorikontroll mot maxKcal: Hvis måltidet overskrider kalorimålet,
    // reduseres fett/olje/nøtter inntil måltidet holder seg innenfor maxKcal
    let trimIterations = 0;
    while (kcalPerPerson > maxKcal && trimIterations < 5) {
      trimIterations++;
      const excess = kcalPerPerson - maxKcal;
      const trimRatio = Math.max(0.65, 1 - (excess / totalMealKcal) * 1.5);

      updatedIngredients = updatedIngredients.map((ing) => {
        const slug = cleanSlug(ing.name);
        if (/olje|tahini|sesam|notter|kjerner|kokosmelk/i.test(slug)) {
          const currentPerPerson = ing.amountGrams / servings;
          const trimmedPerPerson = Math.max(3, Math.round(currentPerPerson * trimRatio));
          const newTotal = trimmedPerPerson * servings;
          return {
            ...ing,
            amountGrams: newTotal,
            displayAmount: `${newTotal}g (${trimmedPerPerson}g per pers)`
          };
        }
        return ing;
      });

      // Rekalkuler makroer etter trim
      totalMealProtein = 0;
      totalMealKcal = 0;
      totalMealCarbs = 0;
      totalMealFat = 0;

      for (const ing of updatedIngredients) {
        const nut = getIngredientNutritionPer100g(ing.name, inventory);
        const ratio = ing.amountGrams / 100;
        totalMealProtein += nut.protein * ratio;
        totalMealKcal += nut.kcal * ratio;
        totalMealCarbs += nut.carbs * ratio;
        totalMealFat += nut.fat * ratio;
      }

      proteinPerPerson = Math.round(totalMealProtein / servings);
      kcalPerPerson = Math.round(totalMealKcal / servings);
      carbsPerPerson = Math.round(totalMealCarbs / servings);
      fatPerPerson = Math.round(totalMealFat / servings);

      // Hvis fettkilder er trimmet ned og kalorier fortsatt er over målet,
      // juster proteinet mot minProteinGrams
      if (kcalPerPerson > maxKcal && proteinPerPerson > targets.minProteinGrams) {
        const excessKcal = kcalPerPerson - maxKcal;
        const proteinGramsToTrim = Math.min(
          proteinPerPerson - targets.minProteinGrams,
          Math.ceil(excessKcal / 4)
        );
        if (proteinGramsToTrim > 0) {
          const coreTrimRatio = (proteinPerPerson - proteinGramsToTrim) / proteinPerPerson;
          updatedIngredients = updatedIngredients.map((ing) => {
            const nut = getIngredientNutritionPer100g(ing.name, inventory);
            if (nut.isProteinCore) {
              const currentPerPerson = ing.amountGrams / servings;
              const trimmed = Math.max(20, Math.round(currentPerPerson * coreTrimRatio));
              const newTotal = trimmed * servings;
              return {
                ...ing,
                amountGrams: newTotal,
                displayAmount: `${newTotal}g (${trimmed}g per pers)`
              };
            }
            return ing;
          });

          // Rekalkuler
          totalMealProtein = 0;
          totalMealKcal = 0;
          totalMealCarbs = 0;
          totalMealFat = 0;

          for (const ing of updatedIngredients) {
            const nut = getIngredientNutritionPer100g(ing.name, inventory);
            const ratio = ing.amountGrams / 100;
            totalMealProtein += nut.protein * ratio;
            totalMealKcal += nut.kcal * ratio;
            totalMealCarbs += nut.carbs * ratio;
            totalMealFat += nut.fat * ratio;
          }

          proteinPerPerson = Math.round(totalMealProtein / servings);
          kcalPerPerson = Math.round(totalMealKcal / servings);
          carbsPerPerson = Math.round(totalMealCarbs / servings);
          fatPerPerson = Math.round(totalMealFat / servings);
        }
      }
    }

    // Oppdater oppskriftens proteinkilde-beskrivelser med nye gram
    const updatedProteinSources = baseDay.proteinSources.map((ps) => {
      for (const ing of updatedIngredients) {
        if (cleanSlug(ps).includes(cleanSlug(ing.name))) {
          const perPers = Math.round(ing.amountGrams / servings);
          return `${ing.name} (${perPers}g)`;
        }
      }
      return ps;
    });

    const macros: NutritionMacros = {
      proteinGramsPerPerson: proteinPerPerson,
      kcalPerPerson,
      carbsGramsPerPerson: carbsPerPerson,
      fatGramsPerPerson: fatPerPerson,
      plantCount: Math.max(targets.minPlantCount, baseDay.macros.plantCount)
    };

    return {
      ...baseDay,
      carbBase: {
        name: baseDay.carbBase.name,
        dryWeightGramsPerPerson: targetCarbDryGrams
      },
      proteinSources: updatedProteinSources,
      macros,
      ingredients: updatedIngredients
    };
  });

  // 7. Bygg ren handleliste og identifiser pantry-varer
  const pantrySet = new Set<string>();
  const shoppingMap = new Map<
    string,
    {
      id: string;
      ingredientName: string;
      totalAmountGrams: number;
      category: RecipeIngredient['category'];
      usedOnDays: Set<number>;
    }
  >();

  for (const day of scaledDays) {
    for (const ing of day.ingredients) {
      if (ing.inStock) {
        pantrySet.add(ing.name);
      } else {
        const slug = cleanSlug(ing.name);
        const existing = shoppingMap.get(slug);

        if (existing) {
          existing.totalAmountGrams += ing.amountGrams;
          existing.usedOnDays.add(day.dayNumber);
        } else {
          shoppingMap.set(slug, {
            id: slug,
            ingredientName: ing.name,
            totalAmountGrams: ing.amountGrams,
            category: ing.category,
            usedOnDays: new Set([day.dayNumber])
          });
        }
      }
    }
  }

  const rawShoppingList: ShoppingListItem[] = Array.from(shoppingMap.values()).map((item) => ({
    id: item.id,
    ingredientName: item.ingredientName,
    totalAmountGrams: item.totalAmountGrams,
    displayAmount: `${item.totalAmountGrams}g totalt (${Array.from(item.usedOnDays).map((d) => `Dag ${d}`).join(', ')})`,
    category: item.category,
    usedOnDays: Array.from(item.usedOnDays).sort((a, b) => a - b)
  }));

  // Koble på tilbud hvis tilbud er oversendt
  const enrichedShoppingList =
    offers.length > 0 ? matchOffersToShoppingList(rawShoppingList, offers, inventory) : rawShoppingList;

  return {
    generatedAt: new Date().toISOString(),
    servingsPerMeal: servings,
    days: scaledDays,
    shoppingList: enrichedShoppingList,
    pantryItemsUsed: Array.from(pantrySet).sort()
  };
}
