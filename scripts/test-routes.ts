import { getWeeklyOffers } from '../src/services/offers/index.ts';
import { optimizeRoute } from '../src/services/maps/routeOptimizer.ts';
import type { ShoppingListItem } from '../src/types/contracts.ts';

async function main() {
  console.log('Starter rute-test...');
  const weeklyData = await getWeeklyOffers();
  console.log(`Hentet ${weeklyData.totalOffers} tilbud for uke ${weeklyData.weekNumber}`);

  const testShoppingList: ShoppingListItem[] = [
    {
      id: 'item-1',
      ingredientName: 'Fast tofu',
      totalAmountGrams: 800,
      displayAmount: '2 pk (800g)',
      category: 'Kjøl/Tofu',
      usedOnDays: [1, 4]
    },
    {
      id: 'item-2',
      ingredientName: 'Edamamebønner',
      totalAmountGrams: 400,
      displayAmount: '1 pk (400g fryst)',
      category: 'Kjøl/Tofu',
      usedOnDays: [1, 3]
    },
    {
      id: 'item-3',
      ingredientName: 'Brokkoli',
      totalAmountGrams: 700,
      displayAmount: '2 stk',
      category: 'Frukt & Grønt',
      usedOnDays: [2, 4]
    },
    {
      id: 'item-4',
      ingredientName: 'Røde linser',
      totalAmountGrams: 500,
      displayAmount: '1 pose (500g)',
      category: 'Tørrvarer/Belgvekster',
      usedOnDays: [2, 5]
    }
  ];

  const result = await optimizeRoute({
    userLocation: { lat: 59.9232, lng: 10.7583 }, // Grünerløkka
    travelMode: 'WALKING',
    maxRadiusMeters: 2500,
    shoppingList: testShoppingList,
    offers: weeklyData.offers
  });

  console.log(`\n=== ENKELTBUTIKK RANGERING (${result.singleStoreRanking.length} butikker) ===`);
  for (const rec of result.singleStoreRanking.slice(0, 4)) {
    console.log(
      `• [${rec.store.chain}] ${rec.store.name} - RankScore: ${rec.rankScore} | Spart: ${rec.estimatedTotalSavingsNok} kr | Matchet: ${rec.matchedItemsCount}/${rec.totalShoppingListItems} varer | Reisetid: ${rec.store.travelTimeMinutes} min`
    );
    for (const match of rec.matchedItems) {
      console.log(`   - ${match.shoppingListItem.ingredientName} -> ${match.offer.productName} (${match.offer.offerPrice} kr, spar ${match.estimatedSavingsNok} kr)`);
    }
  }

  if (result.bestComboRoute) {
    const c = result.bestComboRoute;
    console.log(`\n=== BESTE KOMBI-RUTE (Anbefalt: ${c.isRecommended}) ===`);
    console.log(`Stopp 1: ${c.stops[0].store.name} (spar ${c.stops[0].subtotalSavingsNok} kr)`);
    for (const item of c.stops[0].itemsToPick) {
      console.log(`   - ${item.offer.productName} (${item.offer.offerPrice} kr)`);
    }
    console.log(`Stopp 2: ${c.stops[1].store.name} (spar ${c.stops[1].subtotalSavingsNok} kr)`);
    for (const item of c.stops[1].itemsToPick) {
      console.log(`   - ${item.offer.productName} (${item.offer.offerPrice} kr)`);
    }
    console.log(`Total reisetid: ${c.totalTravelTimeMinutes} min (Ekstra: +${c.extraTravelTimeMinutes} min)`);
    console.log(`Samlet besparelse: ${c.combinedSavingsNok} kr (Ekstra vs enkeltbutikk: +${c.additionalSavingsVsSingleStoreNok} kr)`);
    console.log(`Begrunnelse: ${c.recommendationReason}`);
    console.log(`Polyline punkter: ${c.routePolyline?.length ?? 0} punkter`);
  } else {
    console.log('\nIngen kombi-rute anbefalt.');
  }
}

main().catch(console.error);
