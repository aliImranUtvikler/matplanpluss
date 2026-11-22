import { getWeeklyOffers } from '../src/services/offers/index.ts';
import { optimizeRoute } from '../src/services/maps/routeOptimizer.ts';
import type { ShoppingListItem } from '../src/types/contracts.ts';

async function main() {
  const weeklyData = await getWeeklyOffers();

  // Test en rikere handleliste med varer fordelt på ulike kjeder:
  // - Kiwi: Eldorado Tofu, Eldorado Edamame, Brokkoli
  // - Rema 1000: Rapsolje, Kolonihagen Havregryn, Røde linser
  // - Meny: Basmatiris, Tahini
  const shoppingList: ShoppingListItem[] = [
    {
      id: 'i1',
      ingredientName: 'Fast tofu',
      totalAmountGrams: 800,
      displayAmount: '2 pk',
      category: 'Kjøl/Tofu',
      usedOnDays: [1, 3]
    },
    {
      id: 'i2',
      ingredientName: 'Edamamebønner',
      totalAmountGrams: 400,
      displayAmount: '1 pk',
      category: 'Kjøl/Tofu',
      usedOnDays: [1]
    },
    {
      id: 'i3',
      ingredientName: 'Rapsolje',
      totalAmountGrams: 1000,
      displayAmount: '1 flaske',
      category: 'Krydder/Sauser',
      usedOnDays: [1, 2, 3, 4, 5]
    },
    {
      id: 'i4',
      ingredientName: 'Havregryn',
      totalAmountGrams: 1000,
      displayAmount: '1 pose (1kg)',
      category: 'Tørrvarer/Belgvekster',
      usedOnDays: [2, 4]
    },
    {
      id: 'i5',
      ingredientName: 'Brokkoli',
      totalAmountGrams: 700,
      displayAmount: '2 stk',
      category: 'Frukt & Grønt',
      usedOnDays: [2, 5]
    },
    {
      id: 'i6',
      ingredientName: 'Svarte bønner',
      totalAmountGrams: 400,
      displayAmount: '1 boks',
      category: 'Tørrvarer/Belgvekster',
      usedOnDays: [4]
    }
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
