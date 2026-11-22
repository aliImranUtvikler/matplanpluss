import { getWeeklyOffers } from '../../../services/offers/index';
import { geocodeLocation } from '../../../services/maps/placesClient';
import { optimizeRoute } from '../../../services/maps/routeOptimizer';
import type {
  GeoCoordinates,
  NormalizedOffer,
  RouteOptimizationRequest,
  RouteOptimizationResponse,
  ShoppingListItem
} from '../../../types/contracts';

/**
 * Standard test-handleliste basert på typiske ingredienser i en vegansk ukeplan.
 * Benyttes ved GET-kall eller når POST-forespørselen mangler eksplisitt handleliste.
 */
const DEFAULT_DEMO_SHOPPING_LIST: ShoppingListItem[] = [
  {
    id: 'demo-1',
    ingredientName: 'Fast tofu',
    totalAmountGrams: 800,
    displayAmount: '2 pk (800g)',
    category: 'Kjøl/Tofu',
    usedOnDays: [1, 4]
  },
  {
    id: 'demo-2',
    ingredientName: 'Edamamebønner',
    totalAmountGrams: 400,
    displayAmount: '1 pk (400g fryst)',
    category: 'Kjøl/Tofu',
    usedOnDays: [1, 3]
  },
  {
    id: 'demo-3',
    ingredientName: 'Brokkoli',
    totalAmountGrams: 700,
    displayAmount: '2 stk',
    category: 'Frukt & Grønt',
    usedOnDays: [2, 4]
  },
  {
    id: 'demo-4',
    ingredientName: 'Røde linser',
    totalAmountGrams: 500,
    displayAmount: '1 pose (500g)',
    category: 'Tørrvarer/Belgvekster',
    usedOnDays: [2, 5]
  },
  {
    id: 'demo-5',
    ingredientName: 'Basmatiris',
    totalAmountGrams: 1000,
    displayAmount: '1 kg',
    category: 'Tørrvarer/Belgvekster',
    usedOnDays: [1, 2, 3]
  },
  {
    id: 'demo-6',
    ingredientName: 'Kokosmelk',
    totalAmountGrams: 400,
    displayAmount: '1 boks (400ml)',
    category: 'Krydder/Sauser',
    usedOnDays: [2]
  }
];

/**
 * POST /api/routes
 * Beregner optimal enkeltbutikk og 2-stopps kombi-rute basert på brukerens posisjon,
 * handleliste og tilgjengelige tilbud.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as Partial<RouteOptimizationRequest> & {
      addressQuery?: string;
    };

    let userLocation: GeoCoordinates | null = body.userLocation ?? null;

    // Hvis brukeren sendte en tekst-adresse i stedet for koordinater, geokod den
    if (!userLocation && body.addressQuery) {
      userLocation = await geocodeLocation(body.addressQuery);
    }

    // Standard til Grünerløkka, Oslo hvis ingen posisjon er gitt
    if (!userLocation || typeof userLocation.lat !== 'number' || typeof userLocation.lng !== 'number') {
      userLocation = { lat: 59.9232, lng: 10.7583 };
    }

    const travelMode = body.travelMode || 'WALKING';
    const maxRadiusMeters = body.maxRadiusMeters || 3500;

    // Handleliste: bruk innsendt eller demo-liste
    const shoppingList: ShoppingListItem[] =
      Array.isArray(body.shoppingList) && body.shoppingList.length > 0
        ? body.shoppingList
        : DEFAULT_DEMO_SHOPPING_LIST;

    // Tilbud: bruk innsendte tilbud eller hent ukens ferske tilbudsdatasett
    let offers: NormalizedOffer[] = body.offers ?? [];
    if (!Array.isArray(offers) || offers.length === 0) {
      const weeklyData = await getWeeklyOffers();
      offers = weeklyData.offers;
    }

    const optimizationResponse: RouteOptimizationResponse = await optimizeRoute({
      userLocation,
      travelMode,
      maxRadiusMeters,
      shoppingList,
      offers
    });

    return Response.json(optimizationResponse, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ukjent feil under ruteberegning';
    return Response.json(
      { error: 'Kunne ikke beregne rute', details: message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/routes?lat=59.922&lng=10.758&mode=WALKING&radius=3000
 * Gir umiddelbar respons for rask testing og prototyping i nettleser/verktøy.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(req.url);

    const latParam = searchParams.get('lat');
    const lngParam = searchParams.get('lng');
    const modeParam = searchParams.get('mode') as 'DRIVING' | 'WALKING' | 'BICYCLING' | null;
    const radiusParam = searchParams.get('radius');
    const queryParam = searchParams.get('q');

    let userLocation: GeoCoordinates = { lat: 59.9232, lng: 10.7583 };

    if (queryParam) {
      const geocoded = await geocodeLocation(queryParam);
      if (geocoded) userLocation = geocoded;
    } else if (latParam && lngParam) {
      const parsedLat = parseFloat(latParam);
      const parsedLng = parseFloat(lngParam);
      if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
        userLocation = { lat: parsedLat, lng: parsedLng };
      }
    }

    const travelMode =
      modeParam === 'DRIVING' || modeParam === 'BICYCLING' || modeParam === 'WALKING'
        ? modeParam
        : 'WALKING';

    const maxRadiusMeters = radiusParam ? parseInt(radiusParam, 10) : 3500;

    // Hent ukens tilbud fra fil/kilde
    const weeklyData = await getWeeklyOffers();

    const optimizationResponse: RouteOptimizationResponse = await optimizeRoute({
      userLocation,
      travelMode,
      maxRadiusMeters,
      shoppingList: DEFAULT_DEMO_SHOPPING_LIST,
      offers: weeklyData.offers
    });

    return Response.json(optimizationResponse, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120'
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ukjent feil ved henting av rute';
    return Response.json(
      { error: 'Kunne ikke hente ruter', details: message },
      { status: 500 }
    );
  }
}
