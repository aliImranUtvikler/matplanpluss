'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Radar,
  MapPin,
  Clock,
  CheckSquare,
  Square,
  Search,
  RefreshCw,
  Compass,
  Footprints,
  Bike,
  Car,
  ShoppingBag,
  Tag,
  ArrowRight,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  Store
} from 'lucide-react';
import StoreRouteMap from './StoreRouteMap';
import FloatingRouteMapButton from './FloatingRouteMapButton';
import FlyerPageModal from '../common/FlyerPageModal';
import { optimizeRoute } from '../../services/maps/routeOptimizer';
import type {
  ComboRouteRecommendation,
  GeoCoordinates,
  NormalizedOffer,
  PhysicalStore,
  RouteOptimizationResponse,
  ShoppingListItem,
  SingleStoreRecommendation,
  StoreChain
} from '../../types/contracts';
import type { GoogleUserProfile } from '../../services/auth/googleSsoService';
import type { UserDashboardData } from '../../services/db/userDatabaseService';
import { saveUserDashboard } from '../../services/db/userDatabaseService';

interface OffersRadarViewProps {
  currentUser?: GoogleUserProfile;
  dashboard?: UserDashboardData;
  onDashboardUpdated?: (updated: UserDashboardData) => void;
  initialShoppingList?: ShoppingListItem[];
  className?: string;
}

// Kjente hurtigsteder i Norge
const QUICK_LOCATIONS: Array<{ name: string; coords: GeoCoordinates; label: string }> = [
  { name: 'Grünerløkka', coords: { lat: 59.9232, lng: 10.7583 }, label: 'Thorvald Meyers gate 38, Grünerløkka, Oslo' },
  { name: 'Majorstuen', coords: { lat: 59.9298, lng: 10.7143 }, label: 'Kirkeveien 64, Majorstuen, Oslo' },
  { name: 'Tøyen', coords: { lat: 59.9147, lng: 10.7766 }, label: 'Tøyengata 25, Tøyen, Oslo' },
  { name: 'Sentrum', coords: { lat: 59.9139, lng: 10.7522 }, label: 'Karl Johans gate 1, Oslo Sentrum' },
  { name: 'Blindern', coords: { lat: 59.9385, lng: 10.7230 }, label: 'Problemveien 11, Blindern, Oslo' },
  { name: 'Bergen', coords: { lat: 60.3913, lng: 5.3221 }, label: 'Torgallmenningen 1, Bergen Sentrum' },
  { name: 'Trondheim', coords: { lat: 63.4305, lng: 10.3951 }, label: 'Munkegata 1, Trondheim Midtbyen' }
];

const CHAINS: Array<{ key: 'ALL' | StoreChain; label: string }> = [
  { key: 'ALL', label: 'Alle kjeder' },
  { key: 'REMA_1000', label: 'REMA 1000' },
  { key: 'KIWI', label: 'KIWI' },
  { key: 'MENY', label: 'MENY' },
  { key: 'COOP_EXTRA', label: 'Coop Extra' },
  { key: 'SPAR', label: 'SPAR' },
  { key: 'JOKER', label: 'Joker' },
  { key: 'ODA', label: 'Oda' }
];

export default function OffersRadarView({
  currentUser,
  dashboard,
  onDashboardUpdated,
  initialShoppingList,
  className = ''
}: OffersRadarViewProps) {
  // Lokasjon og reisemodus initialiseres fra dashboard hvis tilgjengelig
  const defaultLoc = useMemo(() => {
    if (dashboard?.preferredLocation) {
      return {
        lat: dashboard.preferredLocation.lat,
        lng: dashboard.preferredLocation.lng
      };
    }
    return QUICK_LOCATIONS[0].coords;
  }, [dashboard?.preferredLocation]);

  const [userLocation, setUserLocation] = useState<GeoCoordinates>(defaultLoc);
  const [selectedLocationName, setSelectedLocationName] = useState<string>(
    dashboard?.preferredLocation?.label.split(',')[0] || QUICK_LOCATIONS[0].name
  );
  const [travelMode, setTravelMode] = useState<'WALKING' | 'BICYCLING' | 'DRIVING'>(
    dashboard?.preferredLocation?.travelMode || 'WALKING'
  );

  // Handleliste og rutedata
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>(initialShoppingList || []);
  const [allOffers, setAllOffers] = useState<NormalizedOffer[]>([]);
  const [routeData, setRouteData] = useState<RouteOptimizationResponse | null>(null);
  const [loadingRoute, setLoadingRoute] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Avkryssede varer i handlelisten (interaktiv handledag i butikken)
  const [checkedItemIds, setCheckedItemIds] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    if (dashboard?.checkedShoppingItemIds) {
      for (const id of dashboard.checkedShoppingItemIds) {
        initial[id] = true;
      }
    }
    return initial;
  });

  // Progressive Disclosure: Skjul/vis alle ukens 70 tilbudskort
  const [isOffersAccordionOpen, setIsOffersAccordionOpen] = useState<boolean>(false);
  const [offerSearch, setOfferSearch] = useState<string>('');
  const [selectedChainFilter, setSelectedChainFilter] = useState<'ALL' | StoreChain>('ALL');
  const [selectedFlyerOffer, setSelectedFlyerOffer] = useState<NormalizedOffer | null>(null);
  const [isMapModalOpen, setIsMapModalOpen] = useState<boolean>(false);

  // Hent handleliste og ukens tilbud
  const loadInitialData = async () => {
    try {
      // 1. Sjekk handleliste fra props eller localStorage
      let items: ShoppingListItem[] = initialShoppingList || [];
      if (items.length === 0 && typeof window !== 'undefined') {
        const savedPlan = localStorage.getItem('user_mealplan');
        if (savedPlan) {
          try {
            const parsed = JSON.parse(savedPlan);
            if (Array.isArray(parsed.shoppingList) && parsed.shoppingList.length > 0) {
              items = parsed.shoppingList;
            }
          } catch {}
        }
      }

      if (items.length === 0) {
        try {
          const mealPlanRes = await fetch('/api/mealplan');
          if (mealPlanRes.ok) {
            const mpData = await mealPlanRes.json();
            items = mpData.mealPlan?.shoppingList || [];
          } else {
            throw new Error('Fallback');
          }
        } catch {
          const staticMealRes = await fetch('./data/default-mealplan.json').catch(() =>
            fetch('/data/default-mealplan.json')
          );
          if (staticMealRes.ok) {
            const staticMp = await staticMealRes.json();
            items = staticMp.shoppingList || [];
          }
        }
      }
      setShoppingList(items);

      // 2. Hent ukens tilbud (API -> fallback public/data/weekly-offers.json)
      let offers: NormalizedOffer[] = [];
      try {
        const offersRes = await fetch('/api/offers');
        if (offersRes.ok) {
          const offData = await offersRes.json();
          offers = offData.offers || [];
        } else {
          throw new Error('Fallback');
        }
      } catch {
        const staticOffRes = await fetch('./data/weekly-offers.json').catch(() =>
          fetch('/data/weekly-offers.json')
        );
        if (staticOffRes.ok) {
          const staticOff = await staticOffRes.json();
          offers = staticOff.offers || [];
        }
      }
      setAllOffers(offers);

      // 3. Beregn rute
      await calculateRoute(userLocation, travelMode, items, offers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Feil ved lasting av data');
      setLoadingRoute(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  // Reager umiddelbart når forelder sender inn ny handleliste
  useEffect(() => {
    if (initialShoppingList && initialShoppingList.length > 0) {
      setShoppingList(initialShoppingList);
      calculateRoute(userLocation, travelMode, initialShoppingList, allOffers);
    }
  }, [initialShoppingList]);

  // Beregn rute (med direkte klient-side optimizeRoute for GitHub Pages)
  const calculateRoute = async (
    location: GeoCoordinates,
    mode: 'WALKING' | 'BICYCLING' | 'DRIVING',
    list = shoppingList,
    offers = allOffers
  ) => {
    setLoadingRoute(true);
    setError(null);

    // 1. Prøv /api/routes først
    try {
      const res = await fetch('/api/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userLocation: location,
          travelMode: mode,
          shoppingList: list,
          offers: offers.length > 0 ? offers : undefined
        })
      });

      if (res.ok) {
        const data: RouteOptimizationResponse = await res.json();
        setRouteData(data);
        return;
      }
      throw new Error('Fallback til lokal ruteoptimalisering');
    } catch {
      // 2. Klient-side optimizeRoute fallback (fungerer 100% på GitHub Pages)
      try {
        const localOptimized = await optimizeRoute({
          userLocation: location,
          travelMode: mode,
          maxRadiusMeters: 3500,
          shoppingList: list,
          offers: offers.length > 0 ? offers : allOffers
        });
        setRouteData(localOptimized);
        return;
      } catch (err) {
        // 3. Ekstra fallback: routes-cache.json
        try {
          const cacheRes = await fetch('./data/routes-cache.json').catch(() =>
            fetch('/data/routes-cache.json')
          );
          if (cacheRes.ok) {
            const cacheData = await cacheRes.json();
            const firstKey = Object.keys(cacheData)[0];
            if (firstKey && cacheData[firstKey]) {
              setRouteData(cacheData[firstKey]);
              return;
            }
          }
        } catch {}
        setError(err instanceof Error ? err.message : 'Feil ved beregning av rute');
      }
    } finally {
      setLoadingRoute(false);
    }
  };

  // Toggle avkrysning på handleliste med per-bruker lagring
  const toggleCheckItem = async (id: string) => {
    const newChecked = { ...checkedItemIds, [id]: !checkedItemIds[id] };
    setCheckedItemIds(newChecked);

    if (dashboard && onDashboardUpdated) {
      const checkedArray = Object.keys(newChecked).filter((k) => newChecked[k]);
      try {
        const updated = await saveUserDashboard(dashboard.userId, {
          checkedShoppingItemIds: checkedArray
        });
        onDashboardUpdated(updated);
      } catch {
        // Ignorer feil
      }
    }
  };

  // Hurtigvalg lokasjon
  const handleLocationChange = (loc: (typeof QUICK_LOCATIONS)[0]) => {
    setSelectedLocationName(loc.name);
    setUserLocation(loc.coords);
    calculateRoute(loc.coords, travelMode);
  };

  // GPS-posisjon
  const handleUseGps = () => {
    if (!navigator.geolocation) {
      alert('Geolokasjon støttes ikke i nettleseren din.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const gpsCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(gpsCoords);
        setSelectedLocationName('GPS');
        calculateRoute(gpsCoords, travelMode);
      },
      (err) => {
        alert('Kunne ikke hente GPS-posisjon: ' + err.message);
      }
    );
  };

  // Reisemodus endring
  const handleModeChange = (mode: 'WALKING' | 'BICYCLING' | 'DRIVING') => {
    setTravelMode(mode);
    calculateRoute(userLocation, mode);
  };

  // Filtrert tilbudskatalog
  const filteredOffers = useMemo(() => {
    return allOffers.filter((offer) => {
      if (selectedChainFilter !== 'ALL' && offer.chain !== selectedChainFilter) {
        return false;
      }
      if (offerSearch.trim()) {
        const q = offerSearch.toLowerCase().trim();
        const matchName = offer.productName.toLowerCase().includes(q);
        const matchTag = offer.normalizedTags.some((t) => t.toLowerCase().includes(q));
        if (!matchName && !matchTag) return false;
      }
      return true;
    });
  }, [allOffers, selectedChainFilter, offerSearch]);

  const checkedCount = Object.values(checkedItemIds).filter(Boolean).length;

  return (
    <div className={`space-y-6 max-w-4xl mx-auto ${className}`}>
      {/* 1. LOKASJONS- OG REISELINJE (Diskret og ren) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-lg">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none -mx-2 px-2 sm:mx-0 sm:px-0">
          <span className="text-xs font-semibold text-slate-400 flex items-center gap-1 shrink-0">
            <MapPin className="w-3.5 h-3.5 text-emerald-400" />
            Fra:
          </span>
          {QUICK_LOCATIONS.slice(0, 4).map((loc) => {
            const isSelected = selectedLocationName === loc.name;
            return (
              <button
                key={loc.name}
                type="button"
                onClick={() => handleLocationChange(loc)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all min-h-[44px] border ${
                  isSelected
                    ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {loc.name}
              </button>
            );
          })}
          <button
            type="button"
            onClick={handleUseGps}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-950 border border-slate-700 text-slate-300 hover:text-white transition-colors whitespace-nowrap min-h-[44px]"
          >
            <Compass className="w-3.5 h-3.5 text-sky-400" />
            <span>GPS</span>
          </button>
        </div>

        {/* Transportmodus */}
        <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-xl self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={() => handleModeChange('WALKING')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all min-h-[44px] ${
              travelMode === 'WALKING'
                ? 'bg-emerald-500 text-slate-950'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Footprints className="w-3.5 h-3.5" />
            <span>Gange</span>
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('BICYCLING')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all min-h-[44px] ${
              travelMode === 'BICYCLING'
                ? 'bg-emerald-500 text-slate-950'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Bike className="w-3.5 h-3.5" />
            <span>Sykkel</span>
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('DRIVING')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all min-h-[44px] ${
              travelMode === 'DRIVING'
                ? 'bg-emerald-500 text-slate-950'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Car className="w-3.5 h-3.5" />
            <span>Bil</span>
          </button>
        </div>
      </div>

      {/* 2. INTERAKTIV HANDLELISTE (Ultra-ren & minimalistisk) */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h3 className="font-extrabold text-base sm:text-lg text-white flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-emerald-400" />
              <span>Handleliste for Butikken</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Kryss av varer med et trykk mens du går gjennom hyllene.
            </p>
          </div>

          <div className="flex items-center gap-2.5 self-start sm:self-auto">
            <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-slate-950 border border-slate-800 text-emerald-400">
              {checkedCount} av {shoppingList.length} i kurven
            </span>

            {/* Hurtigknapp for å åpne kartet */}
            <button
              type="button"
              onClick={() => setIsMapModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-xl shadow-md transition-all active:scale-95 min-h-[40px]"
            >
              <span>🗺️</span>
              <span>Vis kart</span>
              {routeData?.bestComboRoute?.combinedSavingsNok ? (
                <span className="px-1.5 py-0.2 rounded bg-amber-500 text-slate-950 text-[10px] font-black">
                  Spar {Math.round(routeData.bestComboRoute.combinedSavingsNok)} kr
                </span>
              ) : null}
            </button>
          </div>
        </div>

            {shoppingList.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                <p className="text-sm font-bold text-white">Ingen varer trengs å handles inn!</p>
                <p className="text-xs text-slate-500 mt-1">Alt er allerede på lager i kjøkkenskapet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {shoppingList.map((item) => {
                  const isChecked = Boolean(checkedItemIds[item.id]);
                  const hasOffers = Boolean(item.matchedOffers && item.matchedOffers.length > 0);

                  return (
                    <div
                      key={item.id}
                      onClick={() => toggleCheckItem(item.id)}
                      className={`p-3.5 sm:p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 select-none min-h-[52px] ${
                        isChecked
                          ? 'bg-slate-950/40 border-slate-800/60 opacity-50 line-through'
                          : 'bg-slate-950/80 border-slate-800 hover:border-slate-700 active:scale-[0.99]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="text-emerald-400 shrink-0">
                          {isChecked ? (
                            <CheckSquare className="w-5 h-5 text-emerald-400" />
                          ) : (
                            <Square className="w-5 h-5 text-slate-500" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`font-bold text-sm truncate ${isChecked ? 'text-slate-400' : 'text-white'}`}>
                              {item.ingredientName}
                            </span>
                            <span className="text-xs text-slate-400 shrink-0">
                              ({item.displayAmount})
                            </span>
                          </div>

                          {/* Beste tilbud treff */}
                          {hasOffers && item.matchedOffers && !isChecked && (
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {item.matchedOffers.slice(0, 1).map((off) => (
                                <button
                                  key={off.id}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedFlyerOffer(off);
                                  }}
                                  title={`Trykk for å se side ${off.pageNumber || 1} i kundeavisen for ${off.chain.replace('_', ' ')}`}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800/60 hover:bg-emerald-900 transition-all cursor-pointer active:scale-95"
                                >
                                  <Tag className="w-2.5 h-2.5" />
                                  <span>{off.chain.replace('_', ' ')}: {off.offerPrice} kr</span>
                                  {off.discountAmountNok && off.discountAmountNok > 0 && (
                                    <span className="text-emerald-400">(-{off.discountAmountNok} kr)</span>
                                  )}
                                  <span className="text-[9px] text-emerald-400 underline ml-0.5">Side {off.pageNumber || 1}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <span className="text-[10px] font-semibold text-slate-500 shrink-0 uppercase tracking-wider hidden sm:inline-block">
                        {item.category}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

      {/* 3. PROGRESSIVE DISCLOSURE: TREKKSPILL FOR DE 70 TILBUDENE (Kun synlig ved åpning) */}
      <div className="border border-slate-800 rounded-3xl overflow-hidden bg-slate-900 p-5 sm:p-6 shadow-xl space-y-4">
        <button
          type="button"
          onClick={() => setIsOffersAccordionOpen(!isOffersAccordionOpen)}
          className="w-full flex items-center justify-between text-left min-h-[48px]"
        >
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-950 border border-emerald-800 text-emerald-400">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-white">
                Utforsk alle ukens {allOffers.length} tilbud fra kundeavisene
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                KIWI, REMA 1000, Extra, MENY, SPAR, Joker og Oda (100% Vegansk & Peanøttfritt)
              </p>
            </div>
          </div>
          {isOffersAccordionOpen ? (
            <ChevronUp className="w-5 h-5 text-slate-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-slate-400" />
          )}
        </button>

        {isOffersAccordionOpen && (
          <div className="pt-3 border-t border-slate-800 space-y-4 animate-in fade-in duration-150">
            {/* Søk og Kjede-filtere */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={offerSearch}
                  onChange={(e) => setOfferSearch(e.target.value)}
                  placeholder="Søk i alle 70 tilbud..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-base text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 min-h-[48px]"
                />
              </div>

              {/* Kjede-piller */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                {CHAINS.map((ch) => {
                  const isSelected = selectedChainFilter === ch.key;
                  return (
                    <button
                      key={ch.key}
                      type="button"
                      onClick={() => setSelectedChainFilter(ch.key)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all min-h-[44px] border ${
                        isSelected
                          ? 'bg-emerald-950 border-emerald-500 text-emerald-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {ch.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tilbuds-grid (70 kort med direkte validering mot kundeavis-sider) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2">
              {filteredOffers.map((off) => (
                <div
                  key={off.id}
                  onClick={() => setSelectedFlyerOffer(off)}
                  className="bg-slate-950/80 border border-slate-800/80 hover:border-emerald-600/70 p-4 rounded-2xl flex flex-col justify-between transition-all cursor-pointer group shadow-sm hover:shadow-emerald-950/20 active:scale-[0.99]"
                >
                  <div>
                    <div className="flex items-center justify-between text-[10px] font-bold mb-1">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                        {off.chain.replace('_', ' ')}
                      </span>
                      <div className="flex items-center gap-1.5 text-slate-500">
                        {off.pageNumber && (
                          <span className="text-emerald-400 font-bold">Side {off.pageNumber}</span>
                        )}
                        <span>•</span>
                        <span>{off.category}</span>
                      </div>
                    </div>

                    <h4 className="font-bold text-xs sm:text-sm text-white line-clamp-2 mt-1 group-hover:text-emerald-300 transition-colors">
                      {off.productName}
                    </h4>
                    {off.unitDescription && (
                      <span className="text-[11px] text-slate-400 block mt-0.5">
                        {off.unitDescription}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-slate-800/70 flex items-baseline justify-between">
                    <div>
                      <span className="text-base font-black text-emerald-400">
                        {off.offerPrice} kr
                      </span>
                      {off.regularPrice && off.regularPrice > off.offerPrice && (
                        <span className="text-[11px] text-slate-500 line-through ml-1.5">
                          {off.regularPrice} kr
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {off.discountAmountNok && off.discountAmountNok > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/50">
                          Spar {off.discountAmountNok} kr
                        </span>
                      )}
                      <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 group-hover:bg-emerald-600 group-hover:text-white transition-all flex items-center gap-1">
                        <span>👁️</span>
                        <span className="hidden sm:inline">Se side</span>
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 4. Flytende Chat-boble Kart-knapp nederst til høyre (🗺️) */}
      <FloatingRouteMapButton
        routeData={routeData}
        isOpen={isMapModalOpen}
        onOpenChange={setIsMapModalOpen}
        onSelectOffer={(off) => setSelectedFlyerOffer(off)}
        onTravelModeChange={handleModeChange}
      />

      {/* 5. Kundeavis-side Modal (Lightbox for å validere at tilbudet faktisk finnes) */}
      <FlyerPageModal
        offer={selectedFlyerOffer}
        onClose={() => setSelectedFlyerOffer(null)}
      />
    </div>
  );
}
