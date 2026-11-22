import type {
  ComboRouteRecommendation,
  GeoCoordinates,
  NormalizedOffer,
  PhysicalStore,
  RouteOptimizationRequest,
  RouteOptimizationResponse,
  ShoppingListItem,
  SingleStoreRecommendation,
  StoreChain,
  StoreOfferMatchItem
} from '../../types/contracts';
import { scoreOfferMatchForIngredient } from '../offers/offerMatcher';
import { getNearbyGroceryStores } from './placesClient';
import { computeRouteDetails } from './routesClient';

/**
 * Finner det beste tilbudet for en bestemt handlelistevare innenfor en bestemt butikkjede.
 */
function findBestOfferForStoreChain(
  item: ShoppingListItem,
  chain: StoreChain,
  chainOffers: NormalizedOffer[]
): { offer: NormalizedOffer; score: number; savingsNok: number } | null {
  // Sjekk først om handlelisten allerede har matchende tilbud
  const preMatched = (item.matchedOffers ?? []).filter((o) => o.chain === chain && o.isVeganSafe);

  const candidateOffers = preMatched.length > 0 ? preMatched : chainOffers.filter((o) => o.chain === chain);

  let bestMatch: { offer: NormalizedOffer; score: number; savingsNok: number } | null = null;

  for (const offer of candidateOffers) {
    const score = scoreOfferMatchForIngredient(item.ingredientName, offer);
    if (score < 60) continue;

    const savings =
      offer.discountAmountNok ??
      (offer.regularPrice && offer.regularPrice > offer.offerPrice
        ? Math.round((offer.regularPrice - offer.offerPrice) * 10) / 10
        : Math.round(offer.offerPrice * 0.25 * 10) / 10);

    if (
      !bestMatch ||
      score > bestMatch.score ||
      (score === bestMatch.score && savings > bestMatch.savingsNok) ||
      (score === bestMatch.score && savings === bestMatch.savingsNok && offer.offerPrice < bestMatch.offer.offerPrice)
    ) {
      bestMatch = { offer, score, savingsNok: savings };
    }
  }

  return bestMatch;
}

/**
 * Beregner enkeltbutikk-anbefaling for en gitt fysisk butikk.
 */
function evaluateSingleStore(
  store: PhysicalStore,
  shoppingList: ShoppingListItem[],
  chainOffers: NormalizedOffer[]
): SingleStoreRecommendation {
  const matchedItems: StoreOfferMatchItem[] = [];
  let totalOfferPriceNok = 0;
  let estimatedTotalSavingsNok = 0;

  for (const item of shoppingList) {
    const match = findBestOfferForStoreChain(item, store.chain, chainOffers);
    if (match) {
      matchedItems.push({
        shoppingListItem: item,
        offer: match.offer,
        estimatedSavingsNok: match.savingsNok
      });
      totalOfferPriceNok += match.offer.offerPrice;
      estimatedTotalSavingsNok += match.savingsNok;
    }
  }

  // Avrund tall til én desimal
  totalOfferPriceNok = Math.round(totalOfferPriceNok * 10) / 10;
  estimatedTotalSavingsNok = Math.round(estimatedTotalSavingsNok * 10) / 10;

  // Samlet rankScore:
  // Høy besparelse og høy dekning premierer butikken, mens reisetid trekker ned
  const rankScore = Number(
    (
      estimatedTotalSavingsNok * 1.6 +
      matchedItems.length * 12 -
      store.travelTimeMinutes * 1.3
    ).toFixed(1)
  );

  return {
    store,
    matchedItemsCount: matchedItems.length,
    totalShoppingListItems: shoppingList.length,
    totalOfferPriceNok,
    estimatedTotalSavingsNok,
    matchedItems,
    rankScore
  };
}

/**
 * Hovedfunksjon for ruteoptimalisering.
 * Tar inn brukerposisjon, handleliste og ukens tilbud, og returnerer
 * rangering av enkeltbutikker samt optimal 2-stopps kombi-rute.
 */
export async function optimizeRoute(
  request: RouteOptimizationRequest
): Promise<RouteOptimizationResponse> {
  const { userLocation, travelMode = 'WALKING', maxRadiusMeters = 3500, shoppingList, offers } = request;

  // 1. Filtrer trygge veganske tilbud
  const safeOffers = offers.filter((o) => o.isVeganSafe);

  // 2. Finn nærliggende fysiske butikker
  const nearbyStores = await getNearbyGroceryStores(userLocation, {
    maxRadiusMeters,
    travelMode
  });

  // 3. Evaluer hver butikk individuelt
  const singleRecommendations: SingleStoreRecommendation[] = nearbyStores.map((store) =>
    evaluateSingleStore(store, shoppingList, safeOffers)
  );

  // Sorter enkeltbutikker synkende etter rankScore
  singleRecommendations.sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    if (b.estimatedTotalSavingsNok !== a.estimatedTotalSavingsNok) {
      return b.estimatedTotalSavingsNok - a.estimatedTotalSavingsNok;
    }
    return a.store.travelTimeMinutes - b.store.travelTimeMinutes;
  });

  const bestSingleStore = singleRecommendations[0] ?? null;

  // 4. Evaluer kombi-ruter (par av butikker)
  let bestComboRoute: ComboRouteRecommendation | null = null;
  let bestComboNetScore = -Infinity;

  if (singleRecommendations.length >= 2 && bestSingleStore) {
    // Vurder toppbutikker (inntil 6 butikker for å unngå unødig kompleksitet)
    const candidateStores = singleRecommendations.slice(0, 6);

    for (let i = 0; i < candidateStores.length; i++) {
      for (let j = i + 1; j < candidateStores.length; j++) {
        const storeA = candidateStores[i].store;
        const storeB = candidateStores[j].store;

        // Hopp over par fra samme kjede dersom det ikke tilfører nye tilbud
        if (storeA.chain === storeB.chain) continue;

        // Fordel handlelisten optimalt mellom de to butikkene
        const picksForA: StoreOfferMatchItem[] = [];
        const picksForB: StoreOfferMatchItem[] = [];
        let savingsA = 0;
        let savingsB = 0;

        for (const item of shoppingList) {
          const matchA = findBestOfferForStoreChain(item, storeA.chain, safeOffers);
          const matchB = findBestOfferForStoreChain(item, storeB.chain, safeOffers);

          if (matchA && !matchB) {
            picksForA.push({
              shoppingListItem: item,
              offer: matchA.offer,
              estimatedSavingsNok: matchA.savingsNok
            });
            savingsA += matchA.savingsNok;
          } else if (!matchA && matchB) {
            picksForB.push({
              shoppingListItem: item,
              offer: matchB.offer,
              estimatedSavingsNok: matchB.savingsNok
            });
            savingsB += matchB.savingsNok;
          } else if (matchA && matchB) {
            // Begge har varen på tilbud: Plukk der besparelsen er størst eller prisen lavest
            if (matchA.savingsNok > matchB.savingsNok) {
              picksForA.push({
                shoppingListItem: item,
                offer: matchA.offer,
                estimatedSavingsNok: matchA.savingsNok
              });
              savingsA += matchA.savingsNok;
            } else if (matchB.savingsNok > matchA.savingsNok) {
              picksForB.push({
                shoppingListItem: item,
                offer: matchB.offer,
                estimatedSavingsNok: matchB.savingsNok
              });
              savingsB += matchB.savingsNok;
            } else {
              // Lik besparelse: Fordel jevnt for balanse
              if (picksForA.length <= picksForB.length) {
                picksForA.push({
                  shoppingListItem: item,
                  offer: matchA.offer,
                  estimatedSavingsNok: matchA.savingsNok
                });
                savingsA += matchA.savingsNok;
              } else {
                picksForB.push({
                  shoppingListItem: item,
                  offer: matchB.offer,
                  estimatedSavingsNok: matchB.savingsNok
                });
                savingsB += matchB.savingsNok;
              }
            }
          }
        }

        // En kombi-rute er kun reell hvis det faktisk skal plukkes tilbudsvarer på begge stopp
        if (picksForA.length === 0 || picksForB.length === 0) continue;

        const combinedSavingsNok = Math.round((savingsA + savingsB) * 10) / 10;
        const additionalSavingsVsSingleStoreNok = Math.round(
          Math.max(0, combinedSavingsNok - bestSingleStore.estimatedTotalSavingsNok) * 10
        ) / 10;

        // Vurder hvilken rekkefølge som er mest effektiv: (Bruker -> A -> B) vs (Bruker -> B -> A)
        // Vi beregner distanse for begge rekkefølger
        const routeAtoB = await computeRouteDetails(userLocation, storeB.location, travelMode, {
          intermediates: [storeA.location]
        });
        const routeBtoA = await computeRouteDetails(userLocation, storeA.location, travelMode, {
          intermediates: [storeB.location]
        });

        const isOrderAtoB = routeAtoB.travelTimeMinutes <= routeBtoA.travelTimeMinutes;
        const chosenRoute = isOrderAtoB ? routeAtoB : routeBtoA;
        const firstStore = isOrderAtoB ? storeA : storeB;
        const secondStore = isOrderAtoB ? storeB : storeA;
        const firstPicks = isOrderAtoB ? picksForA : picksForB;
        const secondPicks = isOrderAtoB ? picksForB : picksForA;
        const firstSavings = isOrderAtoB ? savingsA : savingsB;
        const secondSavings = isOrderAtoB ? savingsB : savingsA;

        const totalTravelTimeMinutes = chosenRoute.travelTimeMinutes;
        const extraTravelTimeMinutes = Math.max(
          0,
          totalTravelTimeMinutes - bestSingleStore.store.travelTimeMinutes
        );

        // Kriterier for anbefaling:
        // Adaptiv terskel:
        // - Hvis omveien er minimal (<= 6 min): kreves >= 15 kr ekstra spart
        // - Hvis omveien er moderat (<= 12 min): kreves >= 25 kr ekstra spart
        const isRecommended =
          (additionalSavingsVsSingleStoreNok >= 15 && extraTravelTimeMinutes <= 6) ||
          (additionalSavingsVsSingleStoreNok >= 25 && extraTravelTimeMinutes <= 12);

        // Netto score for rangering av kombi-par:
        // Høy merbesparelse er et stort pluss, ekstra reisetid trekker ned
        const comboNetScore =
          additionalSavingsVsSingleStoreNok * 2.5 - extraTravelTimeMinutes * 1.5;

        if (comboNetScore > bestComboNetScore) {
          bestComboNetScore = comboNetScore;

          let reason = '';
          if (isRecommended) {
            const firstItemsSummary = firstPicks
              .slice(0, 3)
              .map((p) => p.shoppingListItem.ingredientName.toLowerCase())
              .join(', ');
            const secondItemsSummary = secondPicks
              .slice(0, 3)
              .map((p) => p.shoppingListItem.ingredientName.toLowerCase())
              .join(', ');

            reason = `Anbefalt kombi-rute! Spar ${additionalSavingsVsSingleStoreNok} kr ekstra (totalt ${combinedSavingsNok} kr) for kun ${extraTravelTimeMinutes} minutter ekstra reise. Plukk bl.a. ${firstItemsSummary} hos ${firstStore.name}, og ta med ${secondItemsSummary} hos ${secondStore.name}.`;
          } else if (additionalSavingsVsSingleStoreNok > 0) {
            reason = `Kombi-rute gir ${additionalSavingsVsSingleStoreNok} kr ekstra besparelse, men krever ${extraTravelTimeMinutes} minutter ekstra reisetid. Enkeltbutikk hos ${bestSingleStore.store.name} er mer tidseffektiv.`;
          } else {
            reason = `Enkeltbutikk hos ${bestSingleStore.store.name} dekker allerede de beste tilbudene like godt eller bedre enn en omvei.`;
          }

          bestComboRoute = {
            stops: [
              {
                store: firstStore,
                itemsToPick: firstPicks,
                subtotalSavingsNok: Math.round(firstSavings * 10) / 10
              },
              {
                store: secondStore,
                itemsToPick: secondPicks,
                subtotalSavingsNok: Math.round(secondSavings * 10) / 10
              }
            ],
            totalTravelTimeMinutes,
            totalDistanceMeters: chosenRoute.distanceMeters,
            extraTravelTimeMinutes,
            combinedSavingsNok,
            additionalSavingsVsSingleStoreNok,
            isRecommended,
            recommendationReason: reason,
            routePolyline: chosenRoute.polyline
          };
        }
      }
    }
  }

  return {
    userLocation,
    travelMode,
    singleStoreRanking: singleRecommendations,
    bestComboRoute
  };
}
