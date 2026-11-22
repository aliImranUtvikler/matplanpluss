import { GET, POST } from '../src/app/api/routes/route.ts';

async function testApi() {
  console.log('--- TESTER GET /api/routes?lat=59.922&lng=10.758&mode=WALKING ---');
  const getReq = new Request('http://localhost:3000/api/routes?lat=59.922&lng=10.758&mode=WALKING');
  const getRes = await GET(getReq as any);
  const getData = await getRes.json();

  console.log('Status GET:', getRes.status);
  console.log('Lokasjon:', getData.userLocation);
  console.log('Enkeltbutikker rangert:', getData.singleStoreRanking?.length);
  console.log('Topp enkeltbutikk:', getData.singleStoreRanking?.[0]?.store.name, 'Spart:', getData.singleStoreRanking?.[0]?.estimatedTotalSavingsNok, 'kr');
  if (getData.bestComboRoute) {
    console.log('Kombi stopp:', getData.bestComboRoute.stops.map((s: any) => s.store.name).join(' -> '));
    console.log('Kombi samlet spart:', getData.bestComboRoute.combinedSavingsNok, 'kr');
    console.log('Kombi ekstra spart:', getData.bestComboRoute.additionalSavingsVsSingleStoreNok, 'kr');
    console.log('Kombi ekstra tid:', getData.bestComboRoute.extraTravelTimeMinutes, 'min');
    console.log('Kombi anbefalt:', getData.bestComboRoute.isRecommended);
    console.log('Kombi begrunnelse:', getData.bestComboRoute.recommendationReason);
  }

  console.log('\n--- TESTER POST /api/routes med egendefinert liste ---');
  const postReq = new Request('http://localhost:3000/api/routes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userLocation: { lat: 59.9232, lng: 10.7583 },
      travelMode: 'BICYCLING',
      shoppingList: [
        { id: '1', ingredientName: 'Fast tofu', totalAmountGrams: 400, displayAmount: '1 pk', category: 'Kjøl/Tofu', usedOnDays: [1] },
        { id: '2', ingredientName: 'Edamamebønner', totalAmountGrams: 400, displayAmount: '1 pk', category: 'Kjøl/Tofu', usedOnDays: [2] },
        { id: '3', ingredientName: 'Tahini', totalAmountGrams: 300, displayAmount: '1 glass', category: 'Krydder/Sauser', usedOnDays: [3] }
      ]
    })
  });

  const postRes = await POST(postReq as any);
  const postData = await postRes.json();
  console.log('Status POST:', postRes.status);
  console.log('Reisemodus POST:', postData.travelMode);
  console.log('Topp enkeltbutikk:', postData.singleStoreRanking?.[0]?.store.name, 'Spart:', postData.singleStoreRanking?.[0]?.estimatedTotalSavingsNok, 'kr');
}

testApi().catch(console.error);
