import { NextResponse } from 'next/server';
import type { OfferCategory, ShoppingListItem, StoreChain } from '@/types/contracts';
import { getWeeklyOffers, matchOffersToShoppingList } from '@/services/offers';

/**
 * GET /api/offers
 * Støtter valgfrie query-parametere:
 * - chain: REMA_1000 | KIWI | MENY | COOP_EXTRA | SPAR | JOKER | ODA
 * - category: Frukt & Grønt | Tørrvarer/Belgvekster | Kjøl/Tofu | Krydder/Sauser | Annet
 * - q: fritekstsøk mot produktnavn og normalizedTags
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const chainParam = searchParams.get('chain') as StoreChain | null;
    const categoryParam = searchParams.get('category') as OfferCategory | null;
    const searchParam = searchParams.get('q');

    const dataset = await getWeeklyOffers({
      chain: chainParam ?? undefined,
      category: categoryParam ?? undefined,
      search: searchParam ?? undefined
    });

    return NextResponse.json(dataset, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Kunne ikke hente ukens dagligvaretilbud',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/offers
 * Matcher en innsendt `shoppingList: ShoppingListItem[]` mot ukens tilbud
 * og returnerer både `dataset` og `shoppingList` beriket med `matchedOffers`.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      shoppingList?: ShoppingListItem[];
    };

    const dataset = await getWeeklyOffers();
    const shoppingList = Array.isArray(body?.shoppingList) ? body.shoppingList : [];
    const matchedShoppingList = matchOffersToShoppingList(shoppingList, dataset.offers);

    return NextResponse.json(
      {
        dataset,
        shoppingList: matchedShoppingList
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Kunne ikke matche handleliste mot ukens tilbud',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
