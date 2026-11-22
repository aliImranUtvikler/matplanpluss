import type { GeoCoordinates } from '../../types/contracts';
import { calculateHaversineMeters, estimateDistanceAndDuration } from './placesClient';

export interface RouteComputationResult {
  distanceMeters: number;
  travelTimeMinutes: number;
  polyline: GeoCoordinates[];
  durationSeconds?: number;
}

/**
 * Dekoder en standard Google Encoded Polyline streng til en liste over GeoCoordinates.
 * Følger Googles offisielle Polyline Algorithm Format uten eksterne pakker.
 */
export function decodePolyline(encoded: string): GeoCoordinates[] {
  const points: GeoCoordinates[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({
      lat: Number((lat / 1e5).toFixed(6)),
      lng: Number((lng / 1e5).toFixed(6))
    });
  }

  return points;
}

/**
 * Interpolerer en naturtro koordinat-rute mellom start, eventuelle mellomstopp og destinasjon
 * for kartopptegning når Google API ikke er aktivt. Legger til et par interpolerte
 * nabolagspunkter som simulerer svinger i gatenettet.
 */
export function generateSyntheticPolyline(
  waypoints: GeoCoordinates[],
  intermediateSteps: number = 4
): GeoCoordinates[] {
  if (waypoints.length === 0) return [];
  if (waypoints.length === 1) return waypoints;

  const fullPath: GeoCoordinates[] = [];

  for (let i = 0; i < waypoints.length - 1; i++) {
    const start = waypoints[i];
    const end = waypoints[i + 1];

    fullPath.push(start);

    const latDelta = end.lat - start.lat;
    const lngDelta = end.lng - start.lng;

    // Generer interpolerte punkter med en liten ortogonal gate-simulering (Manhattan-lignende knekk)
    for (let step = 1; step <= intermediateSteps; step++) {
      const frac = step / (intermediateSteps + 1);
      // Legg til en liten mikroskopisk bøy i gateløpet for realistisk visning
      const perpendicularOffset = Math.sin(frac * Math.PI) * 0.00035 * ((i % 2 === 0) ? 1 : -1);

      fullPath.push({
        lat: Number((start.lat + latDelta * frac + perpendicularOffset).toFixed(6)),
        lng: Number((start.lng + lngDelta * frac + perpendicularOffset * 0.5).toFixed(6))
      });
    }
  }

  fullPath.push(waypoints[waypoints.length - 1]);
  return fullPath;
}

/**
 * Beregner reiserute mellom start og slutt (med eventuelle mellomstopp)
 * via Google Routes API v2, eller faller tilbake på nøyaktig Haversine-veifaktor-modell.
 */
export async function computeRouteDetails(
  origin: GeoCoordinates,
  destination: GeoCoordinates,
  travelMode: 'DRIVING' | 'WALKING' | 'BICYCLING' = 'WALKING',
  options?: {
    intermediates?: GeoCoordinates[];
    apiKey?: string;
  }
): Promise<RouteComputationResult> {
  const apiKey = options?.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
  const intermediates = options?.intermediates ?? [];

  if (apiKey) {
    try {
      const endpoint = 'https://routes.googleapis.com/directions/v2:computeRoutes';

      const modeMapping: Record<string, string> = {
        DRIVING: 'DRIVE',
        WALKING: 'WALK',
        BICYCLING: 'BICYCLE'
      };

      const requestBody = {
        origin: {
          location: {
            latLng: {
              latitude: origin.lat,
              longitude: origin.lng
            }
          }
        },
        destination: {
          location: {
            latLng: {
              latitude: destination.lat,
              longitude: destination.lng
            }
          }
        },
        intermediates: intermediates.map((pt) => ({
          location: {
            latLng: {
              latitude: pt.lat,
              longitude: pt.lng
            }
          }
        })),
        travelMode: modeMapping[travelMode] || 'WALK',
        routingPreference: travelMode === 'DRIVING' ? 'TRAFFIC_AWARE' : undefined,
        polylineQuality: 'OVERVIEW'
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline'
        },
        body: JSON.stringify(requestBody)
      });

      if (res.ok) {
        const data = (await res.json()) as {
          routes?: Array<{
            duration?: string; // F.eks. "420s"
            distanceMeters?: number;
            polyline?: {
              encodedPolyline?: string;
            };
          }>;
        };

        const primaryRoute = data.routes?.[0];
        if (primaryRoute) {
          const rawSeconds = primaryRoute.duration ? parseInt(primaryRoute.duration.replace('s', ''), 10) : 0;
          const travelMinutes = Math.max(1, Math.round(rawSeconds / 60));
          const distMeters = primaryRoute.distanceMeters ?? 0;

          let decodedPoints: GeoCoordinates[] = [];
          if (primaryRoute.polyline?.encodedPolyline) {
            decodedPoints = decodePolyline(primaryRoute.polyline.encodedPolyline);
          } else {
            decodedPoints = [origin, ...intermediates, destination];
          }

          return {
            distanceMeters: distMeters,
            travelTimeMinutes: travelMinutes,
            polyline: decodedPoints,
            durationSeconds: rawSeconds
          };
        }
      }
    } catch {
      // Fallback til Haversine-kalkulator
    }
  }

  // Fallback-beregning for alle etapper (Origin -> Intermediates[0] -> ... -> Destination)
  const allWaypoints = [origin, ...intermediates, destination];
  let totalDistanceMeters = 0;
  let totalTravelTimeMinutes = 0;

  for (let i = 0; i < allWaypoints.length - 1; i++) {
    const leg = estimateDistanceAndDuration(allWaypoints[i], allWaypoints[i + 1], travelMode);
    totalDistanceMeters += leg.distanceMeters;
    totalTravelTimeMinutes += leg.travelTimeMinutes;
  }

  const polyline = generateSyntheticPolyline(allWaypoints, 3);

  return {
    distanceMeters: totalDistanceMeters,
    travelTimeMinutes: totalTravelTimeMinutes,
    polyline,
    durationSeconds: totalTravelTimeMinutes * 60
  };
}
