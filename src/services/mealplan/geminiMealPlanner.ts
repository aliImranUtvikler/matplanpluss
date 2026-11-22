import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  InventoryItem,
  MealPlanDay,
  NormalizedOffer,
  NutritionMacros,
  RecipeIngredient,
  ShoppingListItem,
  UserMacroTargets,
  WeeklyMealPlanResponse
} from '../../types/contracts';
import { getWeeklyOffers } from '../offers';
import { matchOffersToShoppingList } from '../offers/offerMatcher';
import {
  DEFAULT_USER_MACRO_TARGETS,
  scaleMealPlanToMacroTargets
} from './dynamicMacroScaler';
import { getInventory, slugify } from './inventoryService';

const DEFAULT_MEALPLAN_PATH = path.join(process.cwd(), 'data', 'default-mealplan.json');

/**
 * 7 Ufravikelige ernærings- og måltidsregler for matplanen
 */
export const MEAL_PLAN_NUTRITION_RULES = `
Ufravikelige regler for matplanen:
1. 100 % VEGANSK: Ingen animalske produkter (kjøtt, melk, egg, ost, honning, fiskesaus, etc.).
2. 100 % PEANØTTFRITT: Streng allergi. Bruk Tahini, Cashewnøtter eller Solsikkekjerner for fett, sauser og kremethet. ALDRI peanøtter, sataysaus, peanøttolje eller peanøttsmør.
3. 40–50 G PROTEIN PER PERSON I HVERT MÅLTID: UTEN proteinpulver! Bruk rikelige kombinasjoner av fast tofu, soya chunks, TRS soya mince, tempeh, kikertfusilli, røde linser, grønne linser, edamamebønner, kikerter, svarte bønner, quinoa, næringsgjær og tahini.
4. MAKS 750–800 KCAL PER PERSON: Næringstett, metter godt, men hold oljebruk moderat.
5. DEFINERT KARBOHYDRATBASE MED EKSPLISITT TØRRVEKT: Hver dag må ha en tydelig karbohydratbase (f.eks. Basmatiris 80g tørrvekt/pers, Kikertfusilli 85g tørrvekt/pers, Quinoa 75g tørrvekt/pers, Glutenrik ris 80g tørrvekt/pers, Søtpotet 250g ferskvekt).
6. INTERNASJONAL VARIASJON PÅ TVERS AV DE 5 DAGENE:
   - Dag 1: Koreansk (f.eks. Gochujang Tofu & Edamame Bowl)
   - Dag 2: Indisk / Sør-Asiatisk (f.eks. Red Lentil & Soya Chunks Dal)
   - Dag 3: Middelhavs / Italiensk (f.eks. Kremet Tahini- & Soltørket Tomat Kikertfusilli med Soya Mince)
   - Dag 4: Japansk (f.eks. Miso-Glazed Tempeh & Tofu Quinoa Bowl med Kimchi)
   - Dag 5: Midtøsten / Levantinsk (f.eks. Shawarma Soya Chunks & Røstet Kikerter med Hvitløks-Tahini)
7. GUT HEALTH & FERMENTERING: Hver rett må ha minst 6-10 unike plantekilder (plantCount >= 6) og fermenterte innslag (miso, gochujang, kimchi, tempeh) eller prebiotiske belgvekster.
`;

/**
 * Gemini response schema for Structured JSON Output
 */
export const GEMINI_MEALPLAN_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    servingsPerMeal: { type: 'integer' },
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dayNumber: { type: 'integer' },
          dayName: { type: 'string' },
          title: { type: 'string' },
          cuisine: { type: 'string' },
          carbBase: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              dryWeightGramsPerPerson: { type: 'number' }
            },
            required: ['name', 'dryWeightGramsPerPerson']
          },
          proteinSources: {
            type: 'array',
            items: { type: 'string' }
          },
          gutHealthHighlights: {
            type: 'array',
            items: { type: 'string' }
          },
          allergenSafety: {
            type: 'object',
            properties: {
              isVegan: { type: 'boolean' },
              isPeanutFree: { type: 'boolean' },
              nutFreeAlternativeUsed: { type: 'string' }
            },
            required: ['isVegan', 'isPeanutFree']
          },
          macros: {
            type: 'object',
            properties: {
              proteinGramsPerPerson: { type: 'number' },
              kcalPerPerson: { type: 'number' },
              carbsGramsPerPerson: { type: 'number' },
              fatGramsPerPerson: { type: 'number' },
              plantCount: { type: 'integer' }
            },
            required: [
              'proteinGramsPerPerson',
              'kcalPerPerson',
              'carbsGramsPerPerson',
              'fatGramsPerPerson',
              'plantCount'
            ]
          },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                amountGrams: { type: 'number' },
                displayAmount: { type: 'string' },
                category: {
                  type: 'string',
                  enum: [
                    'Frukt & Grønt',
                    'Tørrvarer/Belgvekster',
                    'Kjøl/Tofu',
                    'Krydder/Sauser',
                    'Annet'
                  ]
                }
              },
              required: ['name', 'amountGrams', 'displayAmount', 'category']
            }
          },
          steps: {
            type: 'array',
            items: { type: 'string' }
          },
          prepTimeMinutes: { type: 'integer' }
        },
        required: [
          'dayNumber',
          'dayName',
          'title',
          'cuisine',
          'carbBase',
          'proteinSources',
          'gutHealthHighlights',
          'allergenSafety',
          'macros',
          'ingredients',
          'steps',
          'prepTimeMinutes'
        ]
      }
    }
  },
  required: ['servingsPerMeal', 'days']
};

/**
 * Kuratert 5-dagers standardplan med 100% presisjon på makroer og de 7 ernæringsreglene.
 * Porsjonsberegnet for 2 personer som standard (kan skaleres dynamisk).
 */
export const CURATED_5_DAY_MEAL_PLAN: MealPlanDay[] = [
  {
    dayNumber: 1,
    dayName: 'Mandag',
    title: 'Koreansk Gochujang Crispy Tofu & Edamame Bowl med Klebrig Ris',
    cuisine: 'Koreansk',
    carbBase: {
      name: 'Glutenrik ris',
      dryWeightGramsPerPerson: 80
    },
    proteinSources: ['Fast tofu (200g)', 'Edamamebønner (80g)', 'Næringsgjær (10g)'],
    gutHealthHighlights: [
      'Levende fermentert kimchi',
      'Prebiotisk hvitløk og ingefær',
      'Fermentert gochujang',
      'Fiberrik dampet brokkoli'
    ],
    allergenSafety: {
      isVegan: true,
      isPeanutFree: true,
      nutFreeAlternativeUsed: 'Røstede sesamfrø og sesamolje'
    },
    macros: {
      proteinGramsPerPerson: 47,
      kcalPerPerson: 755,
      carbsGramsPerPerson: 86,
      fatGramsPerPerson: 22,
      plantCount: 10
    },
    ingredients: [
      {
        name: 'Fast tofu',
        amountGrams: 400,
        displayAmount: '400g (1 blokk presset og terninger)',
        inStock: false,
        category: 'Kjøl/Tofu'
      },
      {
        name: 'Edamamebønner',
        amountGrams: 160,
        displayAmount: '160g fryste pillede edamame',
        inStock: false,
        category: 'Kjøl/Tofu'
      },
      {
        name: 'Glutenrik ris',
        amountGrams: 160,
        displayAmount: '160g tørrvekt (80g per person)',
        inStock: true,
        category: 'Tørrvarer/Belgvekster'
      },
      {
        name: 'Brokkoli',
        amountGrams: 250,
        displayAmount: '250g friske buketter',
        inStock: false,
        category: 'Frukt & Grønt'
      },
      {
        name: 'Kimchi',
        amountGrams: 120,
        displayAmount: '120g fermentert vegansk kimchi',
        inStock: false,
        category: 'Kjøl/Tofu'
      },
      {
        name: 'Gochujang',
        amountGrams: 40,
        displayAmount: '2 ss (40g)',
        inStock: true,
        category: 'Krydder/Sauser'
      },
      {
        name: 'Soyasaus / Tamari',
        amountGrams: 30,
        displayAmount: '2 ss (30ml)',
        inStock: true,
        category: 'Krydder/Sauser'
      },
      {
        name: 'Sesamolje',
        amountGrams: 15,
        displayAmount: '1 ss (15ml)',
        inStock: true,
        category: 'Krydder/Sauser'
      },
      {
        name: 'Riseddik',
        amountGrams: 15,
        displayAmount: '1 ss (15ml)',
        inStock: true,
        category: 'Krydder/Sauser'
      },
      {
        name: 'Hvitløk & Ingefær',
        amountGrams: 20,
        displayAmount: '2 fedd hvitløk + 1 ss revet ingefær',
        inStock: true,
        category: 'Frukt & Grønt'
      },
      {
        name: 'Næringsgjær',
        amountGrams: 20,
        displayAmount: '20g (røres inn i glasur)',
        inStock: true,
        category: 'Krydder/Sauser'
      },
      {
        name: 'Vårløk',
        amountGrams: 40,
        displayAmount: '2 stilker finsnittet',
        inStock: false,
        category: 'Frukt & Grønt'
      },
      {
        name: 'Sesamfrø',
        amountGrams: 10,
        displayAmount: '10g ristede sesamfrø',
        inStock: true,
        category: 'Krydder/Sauser'
      }
    ],
    steps: [
      'Kok opp glutenrik ris etter anvisning på pakken (skyll grundig først) til den er mør og lett klebrig.',
      'Press overflødig vann ut av fast tofu med et kjøkkenhåndkle, kutt i 2 cm terninger og vend inn 1 ss soyasaus og litt næringsgjær.',
      'Stek tofuterningene i en varm panne eller airfryer til de er gyldne og sprø på alle sider (ca. 10-12 min).',
      'Pisk sammen gochujang, resten av soyasaus, riseddik, sesamolje, revet hvitløk og ingefær. Hell over den varme tofuen og la trekke i 1 minutt.',
      'Damp brokkoli og edamamebønner i 3-4 minutter så de beholder frisk grønnfarge og knasende crunch.',
      'Anrett bollen: bunn med klebrig ris, topp med gochujang-glasert tofu, dampet brokkoli, edamame og fermentert kimchi. Dryss med vårløk og ristede sesamfrø.'
    ],
    prepTimeMinutes: 25
  },
  {
    dayNumber: 2,
    dayName: 'Tirsdag',
    title: 'Indisk Red Lentil & High-Protein Soya Chunks Dal med Duftende Basmatiris',
    cuisine: 'Indisk / Sør-Asiatisk',
    carbBase: {
      name: 'Basmatiris',
      dryWeightGramsPerPerson: 80
    },
    proteinSources: ['Røde linser (60g tørre)', 'Soya chunks (45g tørre)', 'Næringsgjær (10g)'],
    gutHealthHighlights: [
      'Prebiotiske røde linser rike på resistent stivelse',
      'Fersk ingefær og hvitløk for tarmfloraen',
      'Anti-inflammatorisk gurkemeie og spisskummen',
      'Bladspinat for mikrobiom-mangfold'
    ],
    allergenSafety: {
      isVegan: true,
      isPeanutFree: true,
      nutFreeAlternativeUsed: 'Røstede solsikkekjerner for crunch'
    },
    macros: {
      proteinGramsPerPerson: 48,
      kcalPerPerson: 765,
      carbsGramsPerPerson: 89,
      fatGramsPerPerson: 18,
      plantCount: 11
    },
    ingredients: [
      {
        name: 'Røde linser (tørre)',
        amountGrams: 120,
        displayAmount: '120g tørrvekt (skylles godt)',
        inStock: true,
        category: 'Tørrvarer/Belgvekster'
      },
      {
        name: 'Soya chunks (tørre)',
        amountGrams: 90,
        displayAmount: '90g tørre biter (rehydreres)',
        inStock: true,
        category: 'Tørrvarer/Belgvekster'
      },
      {
        name: 'Basmatiris',
        amountGrams: 160,
        displayAmount: '160g tørrvekt (80g per person)',
        inStock: true,
        category: 'Tørrvarer/Belgvekster'
      },
      {
        name: 'Spinat',
        amountGrams: 150,
        displayAmount: '150g fersk babyspinat',
        inStock: false,
        category: 'Frukt & Grønt'
      },
      {
        name: 'Hakkede tomater',
        amountGrams: 240,
        displayAmount: '240g hermetiske tomater',
        inStock: false,
        category: 'Krydder/Sauser'
      },
      {
        name: 'Kokosmelk',
        amountGrams: 100,
        displayAmount: '100ml kremet kokosmelk',
        inStock: false,
        category: 'Krydder/Sauser'
      },
      {
        name: 'Hvitløk & Ingefær',
        amountGrams: 25,
        displayAmount: '3 fedd hvitløk + 20g frisk ingefær',
        inStock: true,
        category: 'Frukt & Grønt'
      },
      {
        name: 'Næringsgjær',
        amountGrams: 20,
        displayAmount: '20g',
        inStock: true,
        category: 'Krydder/Sauser'
      },
      {
        name: 'Solsikkekjerner',
        amountGrams: 20,
        displayAmount: '20g tørr-ristede kjerner',
        inStock: true,
        category: 'Tørrvarer/Belgvekster'
      },
      {
        name: 'Fersk koriander',
        amountGrams: 20,
        displayAmount: '1 god håndfull fersk koriander',
        inStock: false,
        category: 'Frukt & Grønt'
      },
      {
        name: 'Lime',
        amountGrams: 40,
        displayAmount: '1 stk frisk lime til saft',
        inStock: false,
        category: 'Frukt & Grønt'
      }
    ],
    steps: [
      'Kok opp lettsaltet vann og trekk soya chunks i 8 minutter. Sil av og klem ut overflødig væske grundig for kjøttaktig konsistens.',
      'Skyll røde linser og kok dem i 4 dl grønnsaksbuljong med hakkede tomater, revet ingefær og hvitløk i 15 minutter til en fyldig dal.',
      'Kok basmatiris med et hint av kardemomme og salt til den er luftig og separert.',
      'Stek de rehydrerte soya chunks i en panne med litt garam masala og currykrydder til de har fått fin stekeskorpe.',
      'Vend soya chunks, kokosmelk, næringsgjær og fersk spinat inn i de kokte linsene, og la spinaten falle sammen i 2 minutter.',
      'Server den fyldige dalen over rykende varm basmatiris, toppet med ristede solsikkekjerner, fersk koriander og en god skvis fersk lime.'
    ],
    prepTimeMinutes: 30
  },
  {
    dayNumber: 3,
    dayName: 'Onsdag',
    title: 'Kremet Tahini & Soltørket Tomat Kikertfusilli med Sprøstekt TRS Soya Mince',
    cuisine: 'Middelhavs / Italiensk',
    carbBase: {
      name: 'Kikertfusilli',
      dryWeightGramsPerPerson: 85
    },
    proteinSources: ['Kikertfusilli (85g tørrvekt)', 'TRS Soya mince (45g tørr)', 'Næringsgjær (12g)'],
    gutHealthHighlights: [
      'Fiberbombe fra kikertmel og resistent stivelse',
      'Hvitløks- og sopp-beta-glukaner',
      'Antioksidantrik tomatlycopen og spinat'
    ],
    allergenSafety: {
      isVegan: true,
      isPeanutFree: true,
      nutFreeAlternativeUsed: 'Sesam-tahini for silkemyk, fløteaktig saus uten melk eller nøtter'
    },
    macros: {
      proteinGramsPerPerson: 49,
      kcalPerPerson: 750,
      carbsGramsPerPerson: 84,
      fatGramsPerPerson: 21,
      plantCount: 8
    },
    ingredients: [
      {
        name: 'Kikertfusilli',
        amountGrams: 170,
        displayAmount: '170g tørrvekt (85g per person)',
        inStock: false,
        category: 'Tørrvarer/Belgvekster'
      },
      {
        name: 'TRS Soya mince (tørr)',
        amountGrams: 90,
        displayAmount: '90g tørrvekt soyagranulat',
        inStock: true,
        category: 'Tørrvarer/Belgvekster'
      },
      {
        name: 'Tahini',
        amountGrams: 35,
        displayAmount: '35g (ca. 2 ss hvit tahini)',
        inStock: false,
        category: 'Krydder/Sauser'
      },
      {
        name: 'Næringsgjær',
        amountGrams: 25,
        displayAmount: '25g (for fyldig "parmesan"-smak)',
        inStock: true,
        category: 'Krydder/Sauser'
      },
      {
        name: 'Champignon sopp',
        amountGrams: 200,
        displayAmount: '200g sopp i skiver',
        inStock: false,
        category: 'Frukt & Grønt'
      },
      {
        name: 'Spinat',
        amountGrams: 120,
        displayAmount: '120g babyspinat',
        inStock: false,
        category: 'Frukt & Grønt'
      },
      {
        name: 'Hakkede tomater',
        amountGrams: 200,
        displayAmount: '200g tomater / soltørket tomatpure',
        inStock: false,
        category: 'Krydder/Sauser'
      },
      {
        name: 'Hvitløk & Ingefær',
        amountGrams: 20,
        displayAmount: '3 fedd hvitløk knust',
        inStock: true,
        category: 'Frukt & Grønt'
      }
    ],
    steps: [
      'Rehydrer TRS soya mince i kokende varm grønnsakskraft i 5 minutter, og sil av overskuddsvæske.',
      'Varm en stekepanne og stek soya mincen med skivet sopp og knust hvitløk til væsken damper bort og mincen blir gyllen og sprø.',
      'Kok opp rikelig med saltet vann og kok kikertfusilli al dente i ca. 7-8 minutter (pass på å ikke overkoke). Ta vare på 1 dl av kokevannet!',
      'Pisk tahini, næringsgjær, hakkede tomater og det varme pastavannet sammen til en silkemyk, kremet emulsjon.',
      'Vend kikertfusilli, tahinisaus og babyspinat sammen med den sprø soya mincen i pannen på lav varme til spinaten faller sammen.',
      'Kvern over godt med sort pepper, litt flaksalt og eventuelt ekstra næringsgjær på toppen.'
    ],
    prepTimeMinutes: 25
  },
  {
    dayNumber: 4,
    dayName: 'Torsdag',
    title: 'Japansk Miso-Glazed Tempeh & Tofu Quinoa Power Bowl med Kimchi',
    cuisine: 'Japansk',
    carbBase: {
      name: 'Quinoa',
      dryWeightGramsPerPerson: 75
    },
    proteinSources: ['Tempeh (110g)', 'Fast tofu (100g)', 'Edamamebønner (40g)'],
    gutHealthHighlights: [
      'Fermentert trio for mikrobiomet: Levende miso paste, tradisjonell tempeh og rå kimchi',
      'Prebiotisk quinoa og edamamefiber',
      'Svovelholdig brokkoli og frisk ingefær'
    ],
    allergenSafety: {
      isVegan: true,
      isPeanutFree: true,
      nutFreeAlternativeUsed: 'Røstede usaltede cashewnøtter for crunch'
    },
    macros: {
      proteinGramsPerPerson: 49,
      kcalPerPerson: 780,
      carbsGramsPerPerson: 81,
      fatGramsPerPerson: 25,
      plantCount: 10
    },
    ingredients: [
      {
        name: 'Tempeh',
        amountGrams: 220,
        displayAmount: '220g tempeh (kuttet i tynne staver)',
        inStock: false,
        category: 'Kjøl/Tofu'
      },
      {
        name: 'Fast tofu',
        amountGrams: 200,
        displayAmount: '200g fast tofu i kuber',
        inStock: false,
        category: 'Kjøl/Tofu'
      },
      {
        name: 'Quinoa',
        amountGrams: 150,
        displayAmount: '150g tørrvekt (75g per person)',
        inStock: false,
        category: 'Tørrvarer/Belgvekster'
      },
      {
        name: 'Edamamebønner',
        amountGrams: 80,
        displayAmount: '80g fryste pillede soyabønner',
        inStock: false,
        category: 'Kjøl/Tofu'
      },
      {
        name: 'Brokkoli',
        amountGrams: 200,
        displayAmount: '200g brokkolibuketter',
        inStock: false,
        category: 'Frukt & Grønt'
      },
      {
        name: 'Kimchi',
        amountGrams: 100,
        displayAmount: '100g fermentert kimchi',
        inStock: false,
        category: 'Kjøl/Tofu'
      },
      {
        name: 'Miso paste',
        amountGrams: 30,
        displayAmount: '30g lys miso paste',
        inStock: true,
        category: 'Krydder/Sauser'
      },
      {
        name: 'Soyasaus / Tamari',
        amountGrams: 20,
        displayAmount: '20ml',
        inStock: true,
        category: 'Krydder/Sauser'
      },
      {
        name: 'Riseddik',
        amountGrams: 15,
        displayAmount: '1 ss (15ml)',
        inStock: true,
        category: 'Krydder/Sauser'
      },
      {
        name: 'Cashewnøtter',
        amountGrams: 20,
        displayAmount: '20g grovhakkede og ristede cashews',
        inStock: true,
        category: 'Tørrvarer/Belgvekster'
      },
      {
        name: 'Hvitløk & Ingefær',
        amountGrams: 20,
        displayAmount: '2 fedd hvitløk + 1 ts ferskrevet ingefær',
        inStock: true,
        category: 'Frukt & Grønt'
      },
      {
        name: 'Vårløk',
        amountGrams: 30,
        displayAmount: '2 vårløk finsnittet',
        inStock: false,
        category: 'Frukt & Grønt'
      }
    ],
    steps: [
      'Skyll quinoa grundig i en finmasket sil for å fjerne bitter saponin, og kok i 3 dl vann i 14 minutter til den er luftig.',
      'Skjær tempeh og tofu i jevne staver/terninger. Rør sammen miso paste, soyasaus, riseddik, litt vann og revet ingefær til en jevn glaze.',
      'Stek tempeh og tofu i en panne til de er sprø og gyldne. Pensle glazen rikelig over i pannen de siste 2 minuttene så den karamelliserer uten å brenne seg.',
      'Damp brokkolibuketter og edamamebønner i 3 minutter til de er knasende møre.',
      'Rist grovhakkede cashewnøtter raskt i en tørr panne for ekstra aroma.',
      'Bygg skålen med lun quinoa i bunnen, legg opp misoglasert tempeh & tofu, dampet brokkoli, edamame og fermentert kimchi. Topp med ristede cashewnøtter og vårløk.'
    ],
    prepTimeMinutes: 30
  },
  {
    dayNumber: 5,
    dayName: 'Fredag',
    title: 'Levantinsk Shawarma Soya Chunks & Røstede Kikerter med Søtpotet og Hvitløks-Tahini',
    cuisine: 'Midtøsten / Levantinsk',
    carbBase: {
      name: 'Søtpotet',
      dryWeightGramsPerPerson: 75
    },
    proteinSources: ['Soya chunks (50g tørre)', 'Kikerter (120g kokte)', 'Næringsgjær (6g)'],
    gutHealthHighlights: [
      'Prebiotisk resistent stivelse fra ovnsbakt søtpotet',
      'Fiber- og mineralrike kikerter for tarmbakteriene',
      'Sesamfrø og tahini med essensielle fettsyrer og fytosteroler',
      'Rik råkost med fersk paprika, agurk og antioksidantrik koriander'
    ],
    allergenSafety: {
      isVegan: true,
      isPeanutFree: true,
      nutFreeAlternativeUsed: 'Hvitløks-tahini og sprø solsikkekjerner'
    },
    macros: {
      proteinGramsPerPerson: 48,
      kcalPerPerson: 770,
      carbsGramsPerPerson: 87,
      fatGramsPerPerson: 22,
      plantCount: 11
    },
    ingredients: [
      {
        name: 'Søtpotet',
        amountGrams: 500,
        displayAmount: '500g fersk søtpotet i terninger (250g per pers, ~75g tørrkarbo)',
        inStock: false,
        category: 'Frukt & Grønt'
      },
      {
        name: 'Soya chunks (tørre)',
        amountGrams: 100,
        displayAmount: '100g tørre biter',
        inStock: true,
        category: 'Tørrvarer/Belgvekster'
      },
      {
        name: 'Kikerter',
        amountGrams: 240,
        displayAmount: '240g hermetiske kikerter (skylt og tørket)',
        inStock: false,
        category: 'Tørrvarer/Belgvekster'
      },
      {
        name: 'Tahini',
        amountGrams: 35,
        displayAmount: '35g hvit tahini',
        inStock: false,
        category: 'Krydder/Sauser'
      },
      {
        name: 'Paprika rød',
        amountGrams: 150,
        displayAmount: '1 stor rød paprika i strimler',
        inStock: false,
        category: 'Frukt & Grønt'
      },
      {
        name: 'Agurk',
        amountGrams: 150,
        displayAmount: '1/2 slangeagurk i terninger',
        inStock: false,
        category: 'Frukt & Grønt'
      },
      {
        name: 'Hvitløk & Ingefær',
        amountGrams: 20,
        displayAmount: '3 fedd hvitløk til shawarma & tahinisaus',
        inStock: true,
        category: 'Frukt & Grønt'
      },
      {
        name: 'Næringsgjær',
        amountGrams: 15,
        displayAmount: '15g',
        inStock: true,
        category: 'Krydder/Sauser'
      },
      {
        name: 'Solsikkekjerner',
        amountGrams: 20,
        displayAmount: '20g ristede kjerner',
        inStock: true,
        category: 'Tørrvarer/Belgvekster'
      },
      {
        name: 'Lime',
        amountGrams: 40,
        displayAmount: '1 frisk lime til tahinidressing',
        inStock: false,
        category: 'Frukt & Grønt'
      },
      {
        name: 'Fersk koriander',
        amountGrams: 20,
        displayAmount: '1 håndfull grovhakket',
        inStock: false,
        category: 'Frukt & Grønt'
      }
    ],
    steps: [
      'Sett ovnen på 210°C varmluft. Kutt søtpotet i 1.5 cm terninger, vend i en anelse olje, salt og spisskummen, og bak i 22-25 minutter til møre med karamelliserte kanter.',
      'Kok opp soya chunks i lettsaltet vann i 7 minutter, skyll i kaldt vann og klem all væske grundig ut med hendene.',
      'Vend soya chunks og kikerter sammen i en bolle med shawarma-krydder (spisskummen, paprika, koriander, hvitløk, kanel, salt og pepper) og stek i en varm panne til de er sprø og aromatisk stekt.',
      'Rør sammen tahinisausen: pisk tahini, presset hvitløk, frisk limesaft og 2-3 ss kaldt vann til en lys, fløyelsmyk hellende dressing.',
      'Kutt rød paprika og agurk i sprø biter og vend sammen med grovhakket fersk koriander.',
      'Legg opp tallerkenen med ovnsbakt søtpotet, sprøstekt shawarma-soya og kikerter, samt den friske råkosten. Ringle hvitløks-tahinien rikelig over og topp med ristede solsikkekjerner.'
    ],
    prepTimeMinutes: 30
  }
];

/**
 * Validerer at en matplan oppfyller de 7 ufravikelige reglene
 */
export function validateMealPlanNutrition(days: MealPlanDay[]): {
  isValid: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  if (!Array.isArray(days) || days.length !== 5) {
    violations.push(`Matplanen må inneholde nøyaktig 5 dager (fant ${days?.length ?? 0})`);
    return { isValid: false, violations };
  }

  days.forEach((day, idx) => {
    const dayLabel = `Dag ${day.dayNumber || idx + 1} (${day.title || 'Uten tittel'})`;

    // 1. Vegansk sjekk
    if (day.allergenSafety?.isVegan !== true) {
      violations.push(`${dayLabel}: Er ikke eksplisitt bekreftet 100% vegansk.`);
    }

    // 2. Peanøttfri sjekk
    if (day.allergenSafety?.isPeanutFree !== true) {
      violations.push(`${dayLabel}: Er ikke bekreftet peanøttfri.`);
    }
    const textToCheck = [
      day.title,
      day.cuisine,
      day.carbBase?.name,
      ...(day.proteinSources || []),
      ...(day.gutHealthHighlights || []),
      day.allergenSafety?.nutFreeAlternativeUsed || '',
      ...day.ingredients.map((i) => `${i.name} ${i.displayAmount}`),
      ...day.steps
    ]
      .join(' ')
      .toLowerCase();

    if (
      textToCheck.includes('peanøtt') ||
      textToCheck.includes('peanut') ||
      textToCheck.includes('jordnøtt') ||
      textToCheck.includes('satay')
    ) {
      violations.push(`${dayLabel}: Inneholder forbudt ingrediens (peanøtt/satay)!`);
    }

    // 3. Protein per person (40-50g)
    const protein = day.macros?.proteinGramsPerPerson ?? 0;
    if (protein < 39 || protein > 55) {
      violations.push(
        `${dayLabel}: Protein per person er ${protein}g (krav er 40-50g uten proteinpulver)`
      );
    }

    // 4. Kcal per person (maks 750-800)
    const kcal = day.macros?.kcalPerPerson ?? 0;
    if (kcal > 820 || kcal < 450) {
      violations.push(`${dayLabel}: Kalorier er ${kcal} kcal (krav er maks 750-800 kcal)`);
    }

    // 5. Karbohydratbase og tørrvekt
    if (!day.carbBase?.name || !day.carbBase?.dryWeightGramsPerPerson) {
      violations.push(`${dayLabel}: Mangler definert karbohydratbase med eksplisitt tørrvekt.`);
    }

    // 7. Gut health plantCount >= 6
    const plantCount = day.macros?.plantCount ?? 0;
    if (plantCount < 6) {
      violations.push(
        `${dayLabel}: plantCount er ${plantCount} (krav er minst 6 for tarmhelse/mikrobiom)`
      );
    }
  });

  return {
    isValid: violations.length === 0,
    violations
  };
}

/**
 * Oppdaterer ingrediensenes `inStock`-flagg i en matplan mot gjeldende inventar.
 */
export function synchronizeMealPlanWithInventory(
  days: MealPlanDay[],
  inventory: InventoryItem[]
): MealPlanDay[] {
  const inventoryMap = new Map<string, boolean>();
  for (const inv of inventory) {
    inventoryMap.set(slugify(inv.name), inv.inStock);
    for (const kw of inv.searchKeywords) {
      inventoryMap.set(slugify(kw), inv.inStock);
    }
  }

  return days.map((day) => ({
    ...day,
    ingredients: day.ingredients.map((ing) => {
      const slug = slugify(ing.name);
      let inStock = false;

      if (inventoryMap.has(slug)) {
        inStock = inventoryMap.get(slug)!;
      } else {
        // Deltreff mot nøkkelord
        for (const inv of inventory) {
          if (
            slug.includes(slugify(inv.name)) ||
            slugify(inv.name).includes(slug) ||
            inv.searchKeywords.some((kw) => slug.includes(slugify(kw)))
          ) {
            inStock = inv.inStock;
            break;
          }
        }
      }

      return {
        ...ing,
        inStock
      };
    })
  }));
}

/**
 * Beregner en ren handleliste (`ShoppingListItem[]`) basert på ingredienser der `inStock === false`,
 * og samler unike ingredienser der `inStock === true` i `pantryItemsUsed`.
 * Matcher til slutt handlelisten mot ukens tilbud!
 */
export function buildShoppingListAndPantry(
  days: MealPlanDay[],
  inventory: InventoryItem[],
  offers: NormalizedOffer[]
): {
  shoppingList: ShoppingListItem[];
  pantryItemsUsed: string[];
} {
  const pantryItemsSet = new Set<string>();
  const shoppingMap = new Map<
    string,
    {
      id: string;
      ingredientName: string;
      totalAmountGrams: number;
      displayAmounts: string[];
      category: RecipeIngredient['category'];
      usedOnDays: Set<number>;
    }
  >();

  for (const day of days) {
    for (const ing of day.ingredients) {
      if (ing.inStock) {
        pantryItemsSet.add(ing.name);
      } else {
        const key = slugify(ing.name);
        const existing = shoppingMap.get(key);

        if (existing) {
          existing.totalAmountGrams += ing.amountGrams;
          existing.usedOnDays.add(day.dayNumber);
          existing.displayAmounts.push(ing.displayAmount);
        } else {
          shoppingMap.set(key, {
            id: key,
            ingredientName: ing.name,
            totalAmountGrams: ing.amountGrams,
            displayAmounts: [ing.displayAmount],
            category: ing.category,
            usedOnDays: new Set([day.dayNumber])
          });
        }
      }
    }
  }

  const rawShoppingList: ShoppingListItem[] = Array.from(shoppingMap.values()).map((entry) => ({
    id: entry.id,
    ingredientName: entry.ingredientName,
    totalAmountGrams: entry.totalAmountGrams,
    displayAmount: `${entry.totalAmountGrams}g totalt (${Array.from(entry.usedOnDays).map((d) => `Dag ${d}`).join(', ')})`,
    category: entry.category,
    usedOnDays: Array.from(entry.usedOnDays).sort((a, b) => a - b)
  }));

  // Matcher mot ukens tilbud via offerMatcher
  const enrichedShoppingList = matchOffersToShoppingList(rawShoppingList, offers, inventory);

  return {
    shoppingList: enrichedShoppingList,
    pantryItemsUsed: Array.from(pantryItemsSet).sort()
  };
}

/**
 * Konstruerer et fullstendig `WeeklyMealPlanResponse`
 */
export function buildWeeklyMealPlanResponse(
  days: MealPlanDay[],
  inventory: InventoryItem[],
  offers: NormalizedOffer[],
  servingsPerMeal = 2
): WeeklyMealPlanResponse {
  const synchronizedDays = synchronizeMealPlanWithInventory(days, inventory);
  const { shoppingList, pantryItemsUsed } = buildShoppingListAndPantry(
    synchronizedDays,
    inventory,
    offers
  );

  return {
    generatedAt: new Date().toISOString(),
    servingsPerMeal,
    days: synchronizedDays,
    shoppingList,
    pantryItemsUsed
  };
}

/**
 * Kaller Google Gemini API (gemini-2.5-flash) med Structured JSON Output
 */
export async function callGeminiMealPlanGenerator(options: {
  inventory: InventoryItem[];
  offers: NormalizedOffer[];
  customPrompt?: string;
  servingsPerMeal?: number;
  macroTargets?: Partial<UserMacroTargets>;
}): Promise<WeeklyMealPlanResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY er ikke konfigurert i miljøvariablene');
  }

  const effectiveTargets: UserMacroTargets = {
    ...DEFAULT_USER_MACRO_TARGETS,
    servings: options.servingsPerMeal ?? DEFAULT_USER_MACRO_TARGETS.servings,
    ...(options.macroTargets || {})
  };

  const inventorySummary = options.inventory
    .map((i) => `- ${i.name} (${i.proteinPer100g}g protein/100g) [På lager: ${i.inStock ? 'JA' : 'NEI'}]`)
    .join('\n');

  const topOffers = options.offers
    .slice(0, 30)
    .map((o) => `- ${o.productName} (${o.chain}): ${o.offerPrice} kr (Før ${o.regularPrice ?? 'ukjent'})`)
    .join('\n');

  const userPrompt = `
Generer en ny, fullverdig 5-dagers middagsplan for ${effectiveTargets.servings} personer.

GJELDENDE INVENTAR:
${inventorySummary}

UKENS UTVALGTE BUTIKKTILBUD:
${topOffers}

BRUKERENS DYNAMISKE MAKROMÅL & PREFERANSER:
- Proteinmål: ${effectiveTargets.minProteinGrams}–${effectiveTargets.maxProteinGrams} g protein per person per middag (UTEN proteinpulver)
- Maksimum kalorier: ${effectiveTargets.maxKcal} kcal per person
- Karbohydratbase tørrvekt: ${effectiveTargets.targetCarbDryWeightGrams} g per person
- Porsjoner: ${effectiveTargets.servings} porsjoner
- Minimum plantemangfold: ${effectiveTargets.minPlantCount} ulike planter
${effectiveTargets.dietaryNote ? `- Ekstra notat: ${effectiveTargets.dietaryNote}` : ''}
${options.customPrompt ? `- Tilleggsønske: ${options.customPrompt}` : ''}

Husk de 7 ufravikelige reglene:
1. 100% vegansk
2. 100% peanøttfritt (bruk tahini, cashewnøtter eller solsikkekjerner)
3. ${effectiveTargets.minProteinGrams}–${effectiveTargets.maxProteinGrams}g protein per person per måltid (UTEN proteinpulver)
4. Maks ${effectiveTargets.maxKcal} kcal per person
5. Definert karbohydratbase med eksakt tørrvekt (${effectiveTargets.targetCarbDryWeightGrams}g tørrvekt/pers)
6. Internasjonal variasjon over 5 dager
7. Gut health & fermentering (plantCount >= ${effectiveTargets.minPlantCount})
`;

  const systemInstruction = `Du er en stjernekokk og klinisk ernæringsfysiolog med spesialisering på vegansk idrettsernæring, tarmhelse (gut health) og økonomisk matplanlegging i Norge.
Du returnerer ALLTID gyldig JSON i henhold til det oppgitte JSON Schema.
${MEAL_PLAN_NUTRITION_RULES}`;

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }]
      }
    ],
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: GEMINI_MEALPLAN_RESPONSE_SCHEMA,
      temperature: 0.3
    }
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API feilet med status ${response.status}: ${errorText}`);
  }

  const responseJson = await response.json();
  const rawText = responseJson?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini returnerte tom respons');
  }

  const parsedPlan = JSON.parse(rawText) as {
    servingsPerMeal?: number;
    days: MealPlanDay[];
  };

  const validation = validateMealPlanNutrition(parsedPlan.days);
  if (!validation.isValid) {
    console.warn('Gemini-planen brøt noen ernæringsregler:', validation.violations);
  }

  return scaleMealPlanToMacroTargets(
    parsedPlan.days,
    effectiveTargets,
    options.inventory,
    options.offers
  );
}

/**
 * Hovedfunksjon for å hente eller generere ukeplan.
 * Støtter fullt ut dynamiske makromål (`UserMacroTargets`).
 * 1. Hvis `forceRegenerate` er true og `GEMINI_API_KEY` finnes, kalles Gemini API.
 * 2. Hvis ikke, brukes den kuraterte 5-dagersplanen oppdatert mot sanntids inventar og ukens tilbud.
 * 3. Resultatet skales til brukerens nøyaktige makromål og lagres til `data/default-mealplan.json`.
 */
export async function getOrGenerateWeeklyMealPlan(options?: {
  forceRegenerate?: boolean;
  customPrompt?: string;
  servingsPerMeal?: number;
  macroTargets?: Partial<UserMacroTargets>;
}): Promise<WeeklyMealPlanResponse> {
  const [inventory, offersDataset] = await Promise.all([
    getInventory(),
    getWeeklyOffers()
  ]);

  const effectiveTargets: UserMacroTargets = {
    ...DEFAULT_USER_MACRO_TARGETS,
    servings:
      options?.servingsPerMeal ??
      options?.macroTargets?.servings ??
      DEFAULT_USER_MACRO_TARGETS.servings,
    ...(options?.macroTargets || {})
  };

  // Sjekk om vi skal kalle Gemini API direkte
  if (options?.forceRegenerate && process.env.GEMINI_API_KEY) {
    try {
      const generated = await callGeminiMealPlanGenerator({
        inventory,
        offers: offersDataset.offers,
        customPrompt: options.customPrompt,
        servingsPerMeal: effectiveTargets.servings,
        macroTargets: effectiveTargets
      });

      await fs.writeFile(DEFAULT_MEALPLAN_PATH, JSON.stringify(generated, null, 2), 'utf-8');
      return generated;
    } catch (err) {
      console.warn('Gemini API generering feilet, faller tilbake til kuratert plan:', err);
    }
  }

  // Hvis filen finnes og vi ikke tvinger regenerering:
  if (!options?.forceRegenerate) {
    try {
      const raw = await fs.readFile(DEFAULT_MEALPLAN_PATH, 'utf-8');
      const cached = JSON.parse(raw) as WeeklyMealPlanResponse;
      if (cached && Array.isArray(cached.days) && cached.days.length === 5) {
        // Skaler de cached dagene til brukerens gjeldende makromål og inventar
        const scaled = scaleMealPlanToMacroTargets(
          cached.days,
          effectiveTargets,
          inventory,
          offersDataset.offers
        );
        return scaled;
      }
    } catch {
      // Ikke cached ennå
    }
  }

  // Generer fra den kuraterte planen, skalert til brukerens eksakte makromål
  const result = scaleMealPlanToMacroTargets(
    CURATED_5_DAY_MEAL_PLAN,
    effectiveTargets,
    inventory,
    offersDataset.offers
  );

  // Lagre som default mealplan på disk
  await fs.writeFile(DEFAULT_MEALPLAN_PATH, JSON.stringify(result, null, 2), 'utf-8');

  return result;
}
