import type { GeoCoordinates, PhysicalStore, StoreChain } from '../../types/contracts';

/**
 * Gjenkjenner dagligvarekjede basert på butikknavn.
 * Håndterer norske kjedevarianter som "Extra", "Coop Extra", "Coop Mega", "Rema 1000", "Kiwi", etc.
 */
export function detectStoreChain(name: string): StoreChain | null {
  const n = name.trim().toLowerCase();

  if (n.includes('rema')) return 'REMA_1000';
  if (n.includes('kiwi')) return 'KIWI';
  if (n.includes('meny')) return 'MENY';
  if (n.includes('extra') || n.includes('coop extra') || n.includes('coop prix') || n.includes('coop mega') || n.includes('coop')) {
    return 'COOP_EXTRA';
  }
  if (n.includes('eurospar') || n.includes('spar')) return 'SPAR';
  if (n.includes('joker')) return 'JOKER';
  if (n.includes('oda')) return 'ODA';

  return null;
}

/**
 * Kjente fysiske butikker i Oslo (Grünerløkka, Sentrum, St. Hanshaugen, Tøyen, Torshov, Majorstuen)
 * som fungerer som en deterministisk, naturtro seed-database når Google Cloud API-nøkkel
 * ikke er konfigurert eller når man utvikler lokalt.
 */
export const SEED_OSLO_STORES: Array<{
  placeId: string;
  name: string;
  chain: StoreChain;
  address: string;
  location: GeoCoordinates;
  isOpenNow: boolean;
}> = [
  {
    placeId: 'seed-kiwi-grunerlokka',
    name: 'KIWI Grünerløkka',
    chain: 'KIWI',
    address: 'Thorvald Meyers gate 38, 0555 Oslo',
    location: { lat: 59.9232, lng: 10.7583 },
    isOpenNow: true
  },
  {
    placeId: 'seed-rema-vulkan',
    name: 'REMA 1000 Vulkan',
    chain: 'REMA_1000',
    address: 'Maridalsveien 17, 0178 Oslo',
    location: { lat: 59.9237, lng: 10.7516 },
    isOpenNow: true
  },
  {
    placeId: 'seed-extra-grunerlokka',
    name: 'EXTRA Markveien',
    chain: 'COOP_EXTRA',
    address: 'Markveien 35, 0554 Oslo',
    location: { lat: 59.9215, lng: 10.7578 },
    isOpenNow: true
  },
  {
    placeId: 'seed-meny-ringnes-park',
    name: 'MENY Ringnes Park',
    chain: 'MENY',
    address: 'Sannergata 6C, 0557 Oslo',
    location: { lat: 59.9295, lng: 10.7595 },
    isOpenNow: true
  },
  {
    placeId: 'seed-kiwi-markveien',
    name: 'KIWI Markveien',
    chain: 'KIWI',
    address: 'Markveien 25, 0554 Oslo',
    location: { lat: 59.9202, lng: 10.7582 },
    isOpenNow: true
  },
  {
    placeId: 'seed-rema-torggata',
    name: 'REMA 1000 Torggata',
    chain: 'REMA_1000',
    address: 'Torggata 2-4, 0181 Oslo',
    location: { lat: 59.9148, lng: 10.7495 },
    isOpenNow: true
  },
  {
    placeId: 'seed-joker-helgesensgate',
    name: 'JOKER Helgesens gate',
    chain: 'JOKER',
    address: 'Helgesens gate 14, 0553 Oslo',
    location: { lat: 59.9221, lng: 10.7621 },
    isOpenNow: true
  },
  {
    placeId: 'seed-spar-torshov',
    name: 'SPAR Torshov',
    chain: 'SPAR',
    address: 'Sandakerveien 10B, 0473 Oslo',
    location: { lat: 59.9348, lng: 10.7677 },
    isOpenNow: true
  },
  {
    placeId: 'seed-extra-toyen',
    name: 'EXTRA Tøyen Torg',
    chain: 'COOP_EXTRA',
    address: 'Hagegata 22, 0653 Oslo',
    location: { lat: 59.9136, lng: 10.7711 },
    isOpenNow: true
  },
  {
    placeId: 'seed-meny-oslo-city',
    name: 'MENY Oslo City',
    chain: 'MENY',
    address: 'Stenersgata 1, 0050 Oslo',
    location: { lat: 59.9128, lng: 10.7514 },
    isOpenNow: true
  },
  {
    placeId: 'seed-rema-st-hanshaugen',
    name: 'REMA 1000 St. Hanshaugen',
    chain: 'REMA_1000',
    address: 'Ullevålsveien 39, 0171 Oslo',
    location: { lat: 59.9258, lng: 10.7392 },
    isOpenNow: true
  },
  {
    placeId: 'seed-kiwi-st-hanshaugen',
    name: 'KIWI Waldemar Thranes gate',
    chain: 'KIWI',
    address: 'Waldemar Thranes gate 45, 0173 Oslo',
    location: { lat: 59.9262, lng: 10.7428 },
    isOpenNow: true
  }
];

/**
 * Haversine-avstand i meter mellom to koordinater (fugleflukt).
 */
export function calculateHaversineMeters(coord1: GeoCoordinates, coord2: GeoCoordinates): number {
  const R = 6371e3; // Jordens radius i meter
  const dLat = ((coord2.lat - coord1.lat) * Math.PI) / 180;
  const dLng = ((coord2.lng - coord1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((coord1.lat * Math.PI) / 180) *
      Math.cos((coord2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Beregner estimert faktisk reisedistanse og reisetid i minutter
 * basert på transportmåte og realistisk veifaktor (omveisfaktor for veinett).
 */
export function estimateDistanceAndDuration(
  origin: GeoCoordinates,
  destination: GeoCoordinates,
  mode: 'DRIVING' | 'WALKING' | 'BICYCLING' = 'WALKING'
): { distanceMeters: number; travelTimeMinutes: number } {
  const haversine = calculateHaversineMeters(origin, destination);

  // Veifaktor: Veier er typisk 25-35 % lengre enn fugleflukt i norske byområder
  const detourFactor = 1.3;
  const roadDistanceMeters = Math.max(50, Math.round(haversine * detourFactor));

  let speedMetersPerMinute = 80; // WALKING: 4.8 km/t
  let fixedDelayMinutes = 0;

  if (mode === 'BICYCLING') {
    speedMetersPerMinute = 250; // 15 km/t
    fixedDelayMinutes = 1;
  } else if (mode === 'DRIVING') {
    speedMetersPerMinute = 450; // ~27 km/t i bytrafikk
    fixedDelayMinutes = 2; // parkering/start
  }

  const travelTimeMinutes = Math.max(
    1,
    Math.round(roadDistanceMeters / speedMetersPerMinute + fixedDelayMinutes)
  );

  return {
    distanceMeters: roadDistanceMeters,
    travelTimeMinutes
  };
}

/**
 * Genererer dynamiske, realistiske dagligvarebutikker rundt brukerens posisjon
 * dersom brukeren er utenfor Oslo eller det ikke finnes Google Places API-nøkkel.
 */
export function generateSyntheticNearbyStores(
  userLocation: GeoCoordinates,
  travelMode: 'DRIVING' | 'WALKING' | 'BICYCLING' = 'WALKING',
  maxRadiusMeters: number = 2500
): PhysicalStore[] {
  // Sjekk om brukeren er i Oslo-området (< 18 km fra Oslo Sentrum 59.913, 10.752)
  const distToOslo = calculateHaversineMeters(userLocation, { lat: 59.9139, lng: 10.7522 });

  if (distToOslo < 18000) {
    // Bruk det kuraterte Oslo-datasettet og berik med avstand og reisetid
    return SEED_OSLO_STORES.map((s) => {
      const travel = estimateDistanceAndDuration(userLocation, s.location, travelMode);
      return {
        ...s,
        distanceMeters: travel.distanceMeters,
        travelTimeMinutes: travel.travelTimeMinutes
      };
    })
      .filter((s) => s.distanceMeters <= maxRadiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  // Bruker er et annet sted i Norge (Bergen, Trondheim, Stavanger osv.)
  // Generer 6 realistiske dagligvarebutikker i stjerneformasjon 300m - 1400m fra bruker
  const chainTemplates: Array<{ chain: StoreChain; namePrefix: string; street: string; offsetLat: number; offsetLng: number }> = [
    { chain: 'KIWI', namePrefix: 'KIWI Nærsenter', street: 'Storgata 12', offsetLat: 0.0028, offsetLng: 0.0035 },
    { chain: 'REMA_1000', namePrefix: 'REMA 1000 Sentrum', street: 'Torggata 5', offsetLat: -0.0032, offsetLng: -0.0025 },
    { chain: 'COOP_EXTRA', namePrefix: 'EXTRA Torg', street: 'Kirkegata 18', offsetLat: 0.0041, offsetLng: -0.0042 },
    { chain: 'MENY', namePrefix: 'MENY Storsenter', street: 'Handelsveien 3', offsetLat: -0.0045, offsetLng: 0.0051 },
    { chain: 'SPAR', namePrefix: 'SPAR Nabolag', street: 'Skoleveien 7', offsetLat: 0.0058, offsetLng: 0.0012 },
    { chain: 'JOKER', namePrefix: 'JOKER Hjørnet', street: 'Fjordgata 22', offsetLat: -0.0021, offsetLng: 0.0068 }
  ];

  return chainTemplates.map((t, idx) => {
    const storeLoc: GeoCoordinates = {
      lat: Number((userLocation.lat + t.offsetLat).toFixed(6)),
      lng: Number((userLocation.lng + t.offsetLng).toFixed(6))
    };
    const travel = estimateDistanceAndDuration(userLocation, storeLoc, travelMode);

    return {
      placeId: `syn-${t.chain.toLowerCase()}-${idx + 1}`,
      name: t.namePrefix,
      chain: t.chain,
      address: t.street,
      location: storeLoc,
      distanceMeters: travel.distanceMeters,
      travelTimeMinutes: travel.travelTimeMinutes,
      isOpenNow: true
    };
  }).filter((s) => s.distanceMeters <= maxRadiusMeters);
}

/**
 * Henter nærliggende dagligvarebutikker via Google Places API (New)
 * eller faller tilbake på den realistiske seed-databasen/syntetisk generator.
 */
export async function getNearbyGroceryStores(
  userLocation: GeoCoordinates,
  options?: {
    maxRadiusMeters?: number;
    travelMode?: 'DRIVING' | 'WALKING' | 'BICYCLING';
    apiKey?: string;
  }
): Promise<PhysicalStore[]> {
  const maxRadiusMeters = options?.maxRadiusMeters ?? 3000;
  const travelMode = options?.travelMode ?? 'WALKING';
  const apiKey = options?.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;

  if (apiKey) {
    try {
      // Kall Google Places API (New) searchNearby
      const endpoint = 'https://places.googleapis.com/v1/places:searchNearby';
      const body = {
        includedTypes: ['supermarket', 'grocery_store'],
        maxResultCount: 20,
        locationRestriction: {
          circle: {
            center: {
              latitude: userLocation.lat,
              longitude: userLocation.lng
            },
            radius: maxRadiusMeters
          }
        }
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.formattedAddress,places.location,places.currentOpeningHours'
        },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        const data = (await res.json()) as {
          places?: Array<{
            id: string;
            displayName?: { text: string };
            formattedAddress?: string;
            location?: { latitude: number; longitude: number };
            currentOpeningHours?: { openNow?: boolean };
          }>;
        };

        if (Array.isArray(data.places) && data.places.length > 0) {
          const mappedStores: PhysicalStore[] = [];

          for (const p of data.places) {
            const rawName = p.displayName?.text ?? 'Dagligvarebutikk';
            const chain = detectStoreChain(rawName);
            if (!chain) continue; // Hopp over kiosker/spesialbutikker som ikke er blant våre kjeder

            const storeLoc: GeoCoordinates = {
              lat: p.location?.latitude ?? userLocation.lat,
              lng: p.location?.longitude ?? userLocation.lng
            };

            const travel = estimateDistanceAndDuration(userLocation, storeLoc, travelMode);

            mappedStores.push({
              placeId: p.id,
              name: rawName,
              chain,
              address: p.formattedAddress ?? '',
              location: storeLoc,
              distanceMeters: travel.distanceMeters,
              travelTimeMinutes: travel.travelTimeMinutes,
              isOpenNow: p.currentOpeningHours?.openNow ?? true
            });
          }

          if (mappedStores.length > 0) {
            return mappedStores.sort((a, b) => a.distanceMeters - b.distanceMeters);
          }
        }
      }
    } catch {
      // Fallback aktiveres ved nettverksfeil eller manglende tilgang
    }
  }

  // Sikker og realistisk fallback
  return generateSyntheticNearbyStores(userLocation, travelMode, maxRadiusMeters);
}

/**
 * Geokoder en tekststreng (f.eks. "Grünerløkka, Oslo" eller "Torggata 5")
 * til koordinater via Google Geocoding API eller innebygd stedsregister.
 */
export async function geocodeLocation(
  query: string,
  apiKey?: string
): Promise<GeoCoordinates | null> {
  const clean = query.trim().toLowerCase();
  const key = apiKey ?? process.env.GOOGLE_MAPS_API_KEY;

  if (key) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        query
      )}&region=no&key=${key}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as {
          results?: Array<{
            geometry?: {
              location?: { lat: number; lng: number };
            };
          }>;
        };
        const loc = data.results?.[0]?.geometry?.location;
        if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
          return { lat: loc.lat, lng: loc.lng };
        }
      }
    } catch {
      // Fallback til stedsregister
    }
  }

  // Innebygde kjente norske lokasjoner
  const knownPlaces: Record<string, GeoCoordinates> = {
    'grünerløkka': { lat: 59.9232, lng: 10.7583 },
    'grunerlokka': { lat: 59.9232, lng: 10.7583 },
    'majorstuen': { lat: 59.9288, lng: 10.7183 },
    'sentrum': { lat: 59.9139, lng: 10.7522 },
    'oslo': { lat: 59.9139, lng: 10.7522 },
    'tøyen': { lat: 59.9136, lng: 10.7711 },
    'toyen': { lat: 59.9136, lng: 10.7711 },
    'sagene': { lat: 59.9368, lng: 10.7528 },
    'st. hanshaugen': { lat: 59.9258, lng: 10.7392 },
    'torshov': { lat: 59.9348, lng: 10.7677 },
    'bergen': { lat: 60.3913, lng: 5.3221 },
    'trondheim': { lat: 63.4305, lng: 10.3951 },
    'stavanger': { lat: 58.9699, lng: 5.7331 },
    'tromsø': { lat: 69.6492, lng: 18.9553 },
    'tromso': { lat: 69.6492, lng: 18.9553 }
  };

  for (const [name, coords] of Object.entries(knownPlaces)) {
    if (clean.includes(name)) {
      return coords;
    }
  }

  // Standard lokasjon: Grünerløkka, Oslo
  return { lat: 59.9232, lng: 10.7583 };
}
