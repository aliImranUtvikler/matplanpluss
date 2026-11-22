export {
  calculateHaversineMeters,
  detectStoreChain,
  estimateDistanceAndDuration,
  generateSyntheticNearbyStores,
  geocodeLocation,
  getNearbyGroceryStores,
  SEED_OSLO_STORES
} from './placesClient';

export {
  computeRouteDetails,
  decodePolyline,
  generateSyntheticPolyline,
  type RouteComputationResult
} from './routesClient';

export { optimizeRoute } from './routeOptimizer';
