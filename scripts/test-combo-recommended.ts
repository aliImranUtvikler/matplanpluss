import { getWeeklyOffers } from '../src/services/offers/index.ts';
import { optimizeRoute } from '../src/services/maps/routeOptimizer.ts';
import type { ShoppingListItem } from '../src/types/contracts.ts';

async function main() {
  const weeklyData = await getWeeklyOffers();

  const shoppingList: ShoppingListItem[] = [
    { id: '1', ingredientName: 'Tahini', totalAmountGrams: 300, displayAmount: '1 glass', category: 'Krydder/Sauser', usedOnDays: [1, 2] },
    { id: '2', ingredientName: 'Quinoa', totalAmountGrams: 500, displayAmount: '1 pose', category: 'Tørrvarer/Belgvekster', usedOnDays: [3] },
    { id: '3', ingredientName: 'Olivenolje', totalAmountGrams: 500, displayAmount: '1 flaske', category: 'Krydder/Sauser', usedOnDays: [1, 4] },
    { id: '4', ingredientName: 'Edamamebønner', totalAmountGrams: 400, displayAmount: '1 pk', category: 'Kjøl/Tofu', usedOnDays: [2] },
    { id: '5', ingredientName: 'Brokkoli', totalAmountGrams: 700, displayAmount: '2 stk', category: 'Frukt & Grønt', usedOnDays: [3, 5] },
    { id: '6', ingredientName: 'Fast tofu', totalAmountGrams: 400, displayAmount: '1 pk', category: 'Kjøl/Tofu', usedOnDays: [1] }
  ];

  const result = await optimizeRoute({
    userLocation: { lat: 59.9232, lng: 10.7583 },
    travelMode: 'WALKING',
    maxRadiusMeters: 2500,
    shoppingList,
    offers: weeklyData.offers
  });

  console.log(`Beste enkeltbutikk: ${result.singleStoreRanking[0]?.store.name} (Spart: ${result.singleStoreRanking[0]?.estimatedTotalSavingsNok} kr)`);
  if (result.bestComboRoute) {
    const c = result.bestComboRoute;
    console.log(`Kombi-rute: ${c.stops[0].store.name} -> ${c.stops[1].store.name}`);
    console.log(`Spart kombi: ${c.combinedSavingsNok} kr | Ekstra spart: +${c.additionalSavingsVsSingleStoreNok} kr`);
    console.log(`Ekstra reisetid: +${c.extraTravelTimeMinutes} min`);
    console.log(`Anbefalt: ${c.isRecommended}`);
    console.log(`Begrunnelse: ${c.recommendationReason}`);
  }
}

main().catch(console.error);
