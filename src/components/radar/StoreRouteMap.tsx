'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  MapPin,
  Navigation,
  Clock,
  Coins,
  Sparkles,
  Footprints,
  Bike,
  Car,
  RotateCcw,
  Plus,
  Minus,
  CheckCircle2,
  ArrowRight,
  Store,
  Layers,
  ChevronRight,
  Info
} from 'lucide-react';
import type {
  ComboRouteRecommendation,
  GeoCoordinates,
  NormalizedOffer,
  PhysicalStore,
  RouteOptimizationResponse,
  SingleStoreRecommendation,
  StoreChain
} from '../../types/contracts';

interface StoreRouteMapProps {
  routeData: RouteOptimizationResponse;
  onSelectStore?: (store: PhysicalStore) => void;
  onSelectOffer?: (offer: NormalizedOffer) => void;
  onTravelModeChange?: (mode: 'DRIVING' | 'WALKING' | 'BICYCLING') => void;
  className?: string;
}

// Fargeprofiler per butikkjede
const CHAIN_COLORS: Record<StoreChain, { bg: string; text: string; border: string; badge: string; hex: string }> = {
  REMA_1000: {
    bg: 'bg-blue-600',
    text: 'text-blue-600',
    border: 'border-blue-600',
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
    hex: '#2563EB'
  },
  KIWI: {
    bg: 'bg-emerald-600',
    text: 'text-emerald-600',
    border: 'border-emerald-600',
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    hex: '#059669'
  },
  MENY: {
    bg: 'bg-rose-600',
    text: 'text-rose-600',
    border: 'border-rose-600',
    badge: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
    hex: '#E11D48'
  },
  COOP_EXTRA: {
    bg: 'bg-orange-600',
    text: 'text-orange-600',
    border: 'border-orange-600',
    badge: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
    hex: '#EA580C'
  },
  SPAR: {
    bg: 'bg-red-700',
    text: 'text-red-700',
    border: 'border-red-700',
    badge: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
    hex: '#B91C1C'
  },
  JOKER: {
    bg: 'bg-cyan-600',
    text: 'text-cyan-600',
    border: 'border-cyan-600',
    badge: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300',
    hex: '#0891B2'
  },
  ODA: {
    bg: 'bg-amber-600',
    text: 'text-amber-600',
    border: 'border-amber-600',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    hex: '#D97706'
  }
};

export default function StoreRouteMap({
  routeData,
  onSelectStore,
  onSelectOffer,
  onTravelModeChange,
  className = ''
}: StoreRouteMapProps) {
  const { userLocation, singleStoreRanking, bestComboRoute, travelMode } = routeData;

  const [activeTab, setActiveTab] = useState<'COMBO' | 'SINGLE'>(
    bestComboRoute && bestComboRoute.isRecommended ? 'COMBO' : 'SINGLE'
  );
  const [selectedSingleIndex, setSelectedSingleIndex] = useState<number>(0);
  const [activePopupStore, setActivePopupStore] = useState<PhysicalStore | null>(null);

  // Kart-tilstand for zoom og panorering (SVG view)
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // Ekte Google Maps referanse hvis NEXT_PUBLIC_GOOGLE_MAPS_API_KEY finnes
  const googleMapRef = useRef<HTMLDivElement>(null);
  const [googleMapsReady, setGoogleMapsReady] = useState<boolean>(false);
  const hasGoogleMapsApiKey = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);

  // Initialiser Google Maps JS hvis nøkkel er tilgjengelig
  useEffect(() => {
    if (!hasGoogleMapsApiKey) return;

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    const scriptId = 'google-maps-script';

    if (window && (window as unknown as { google?: { maps?: unknown } }).google?.maps) {
      setGoogleMapsReady(true);
      return;
    }

    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry`;
      script.async = true;
      script.defer = true;
      script.onload = () => setGoogleMapsReady(true);
      document.head.appendChild(script);
    }
  }, [hasGoogleMapsApiKey]);

  // Beregn bounds og projeksjon for det innebygde interaktive kartet
  const { projectedUser, projectedStores, projectedPolyline, viewBox } = useMemo(() => {
    const coords: GeoCoordinates[] = [userLocation];

    for (const rec of singleStoreRanking) {
      coords.push(rec.store.location);
    }

    if (bestComboRoute?.routePolyline) {
      coords.push(...bestComboRoute.routePolyline);
    }

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;

    for (const c of coords) {
      if (c.lat < minLat) minLat = c.lat;
      if (c.lat > maxLat) maxLat = c.lat;
      if (c.lng < minLng) minLng = c.lng;
      if (c.lng > maxLng) maxLng = c.lng;
    }

    // Legg til god margin (padding) så markører ikke havner på kanten
    const latSpan = Math.max(maxLat - minLat, 0.012);
    const lngSpan = Math.max(maxLng - minLng, 0.016);

    const padLat = latSpan * 0.22;
    const padLng = lngSpan * 0.22;

    const bMinLat = minLat - padLat;
    const bMaxLat = maxLat + padLat;
    const bMinLng = minLng - padLng;
    const bMaxLng = maxLng + padLng;

    const width = 800;
    const height = 540;

    const project = (coord: GeoCoordinates) => {
      const x = ((coord.lng - bMinLng) / (bMaxLng - bMinLng)) * width;
      // Inverter Y siden SVG Y øker nedover, mens latitude øker nordover
      const y = height - ((coord.lat - bMinLat) / (bMaxLat - bMinLat)) * height;
      return { x: Math.round(x), y: Math.round(y) };
    };

    const userPt = project(userLocation);

    const storePts = singleStoreRanking.map((rec) => {
      const pt = project(rec.store.location);
      return {
        ...rec,
        svgX: pt.x,
        svgY: pt.y
      };
    });

    let polylinePts: Array<{ x: number; y: number }> = [];
    if (activeTab === 'COMBO' && bestComboRoute?.routePolyline) {
      polylinePts = bestComboRoute.routePolyline.map(project);
    } else if (activeTab === 'SINGLE' && singleStoreRanking[selectedSingleIndex]) {
      const targetStore = singleStoreRanking[selectedSingleIndex].store;
      polylinePts = [project(userLocation), project(targetStore.location)];
    }

    return {
      projectedUser: userPt,
      projectedStores: storePts,
      projectedPolyline: polylinePts,
      viewBox: `0 0 ${width} ${height}`
    };
  }, [userLocation, singleStoreRanking, bestComboRoute, activeTab, selectedSingleIndex]);

  // Håndter drag og zoom i kartet
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPanOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleZoom = (delta: number) => {
    setZoomLevel((prev) => Math.min(Math.max(prev + delta, 0.7), 2.5));
  };

  const handleResetMap = () => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
    setActivePopupStore(null);
  };

  const handleStoreClick = (store: PhysicalStore) => {
    setActivePopupStore(store);
    onSelectStore?.(store);
  };

  const activeSingle = singleStoreRanking[selectedSingleIndex] || singleStoreRanking[0];

  return (
    <div className={`flex flex-col bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl text-slate-100 ${className}`}>
      {/* 1. Topplinje: Rute-tabs & Modusvalg */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-slate-950/80 border-b border-slate-800/80 backdrop-blur-md">
        {/* Rutevalg-tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-900 border border-slate-800 rounded-xl">
          <button
            type="button"
            onClick={() => {
              setActiveTab('COMBO');
              setActivePopupStore(null);
            }}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'COMBO'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Kombi-rute (2 stopp)</span>
            {bestComboRoute?.isRecommended && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-emerald-400 text-emerald-950 rounded-full">
                BEST
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('SINGLE');
              setActivePopupStore(null);
            }}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'SINGLE'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Store className="w-3.5 h-3.5" />
            <span>Enkeltbutikk (Direkte)</span>
          </button>
        </div>

        {/* Transportmiddel-velger */}
        <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl">
          <button
            type="button"
            onClick={() => onTravelModeChange?.('WALKING')}
            title="Gange"
            className={`p-1.5 rounded-lg transition-all ${
              travelMode === 'WALKING'
                ? 'bg-emerald-500 text-slate-950 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Footprints className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onTravelModeChange?.('BICYCLING')}
            title="Sykkel"
            className={`p-1.5 rounded-lg transition-all ${
              travelMode === 'BICYCLING'
                ? 'bg-emerald-500 text-slate-950 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bike className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onTravelModeChange?.('DRIVING')}
            title="Bil"
            className={`p-1.5 rounded-lg transition-all ${
              travelMode === 'DRIVING'
                ? 'bg-emerald-500 text-slate-950 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Car className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Kartflaten (Innebygd Custom SVG-kart med zoom/pan) */}
      <div
        ref={mapContainerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="relative w-full h-[400px] sm:h-[480px] bg-slate-950 overflow-hidden cursor-grab active:cursor-grabbing select-none"
      >
        {/* Bakgrunnsmønster / Grid for kartfølelse */}
        <div className="absolute inset-0 opacity-20 pointer-events-none bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:24px_24px]" />

        {/* SVG Kart-canvas */}
        <svg
          viewBox={viewBox}
          className="w-full h-full transition-transform duration-75 ease-out"
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
            transformOrigin: 'center center'
          }}
        >
          <defs>
            {/* Linje-gradient for kombi-rute */}
            <linearGradient id="routeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#38BDF8" />
              <stop offset="50%" stopColor="#34D399" />
              <stop offset="100%" stopColor="#A78BFA" />
            </linearGradient>

            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#10B981" floodOpacity="0.4" />
            </filter>
          </defs>

          {/* Stilisert elv/gatekontur for Oslo Grünerløkka omgivelse */}
          <path
            d="M 280 0 Q 310 160 330 260 T 370 540"
            fill="none"
            stroke="#1E293B"
            strokeWidth="28"
            strokeLinecap="round"
          />
          <path
            d="M 280 0 Q 310 160 330 260 T 370 540"
            fill="none"
            stroke="#0284C7"
            strokeWidth="6"
            strokeOpacity="0.3"
          />

          {/* Rutelinje mellom stoppene */}
          {projectedPolyline.length > 1 && (
            <>
              {/* Bakgrunnsglød */}
              <polyline
                points={projectedPolyline.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={activeTab === 'COMBO' ? '#10B981' : '#3B82F6'}
                strokeWidth="10"
                strokeOpacity="0.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Hovedlinje med animert stiplet effekt */}
              <polyline
                points={projectedPolyline.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={activeTab === 'COMBO' ? 'url(#routeGradient)' : '#3B82F6'}
                strokeWidth="4"
                strokeDasharray="8 6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          )}

          {/* Brukerposisjon Pin */}
          <g transform={`translate(${projectedUser.x}, ${projectedUser.y})`}>
            {/* Pulserende ringer */}
            <circle r="18" fill="#38BDF8" fillOpacity="0.2" className="animate-ping" />
            <circle r="12" fill="#0284C7" fillOpacity="0.4" />
            <circle r="7" fill="#38BDF8" stroke="#FFFFFF" strokeWidth="2" />
            {/* Tekstbadge */}
            <rect x="-30" y="-34" width="60" height="18" rx="9" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.5" />
            <text x="0" y="-22" textAnchor="middle" fill="#38BDF8" fontSize="9" fontWeight="bold">
              DU ER HER
            </text>
          </g>

          {/* Butikk-pins */}
          {projectedStores.map((rec) => {
            const { store, svgX, svgY } = rec;
            const chainCfg = CHAIN_COLORS[store.chain] || CHAIN_COLORS.KIWI;

            // Sjekk om butikken er stopp 1 eller 2 i aktiv rute
            const isStop1 = bestComboRoute?.stops[0].store.placeId === store.placeId && activeTab === 'COMBO';
            const isStop2 = bestComboRoute?.stops[1].store.placeId === store.placeId && activeTab === 'COMBO';
            const isTargetSingle =
              activeTab === 'SINGLE' &&
              singleStoreRanking[selectedSingleIndex]?.store.placeId === store.placeId;

            const isHighlighted = isStop1 || isStop2 || isTargetSingle;

            return (
              <g
                key={store.placeId}
                transform={`translate(${svgX}, ${svgY})`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleStoreClick(store);
                }}
                className="cursor-pointer group"
              >
                {/* Ytre glød for fremhevede butikker */}
                {isHighlighted && (
                  <circle
                    r="24"
                    fill={isStop1 ? '#10B981' : isStop2 ? '#8B5CF6' : chainCfg.hex}
                    fillOpacity="0.25"
                    className="animate-pulse"
                  />
                )}

                {/* Pin Bakgrunn */}
                <circle
                  r={isHighlighted ? 18 : 14}
                  fill={isStop1 ? '#10B981' : isStop2 ? '#8B5CF6' : chainCfg.hex}
                  stroke="#FFFFFF"
                  strokeWidth={isHighlighted ? 2.5 : 1.5}
                  className="transition-all duration-200 group-hover:scale-110"
                />

                {/* Tekst / Nummer i pin */}
                <text
                  x="0"
                  y="4"
                  textAnchor="middle"
                  fill="#FFFFFF"
                  fontSize={isHighlighted ? '12' : '10'}
                  fontWeight="bold"
                >
                  {isStop1 ? '1' : isStop2 ? '2' : store.name.substring(0, 1)}
                </text>

                {/* Stopp-navn tag over pin */}
                <g transform="translate(0, -26)">
                  <rect
                    x="-45"
                    y="-10"
                    width="90"
                    height="18"
                    rx="4"
                    fill="#0F172A"
                    fillOpacity="0.92"
                    stroke={isHighlighted ? (isStop1 ? '#10B981' : '#8B5CF6') : '#475569'}
                    strokeWidth="1"
                  />
                  <text
                    x="0"
                    y="3"
                    textAnchor="middle"
                    fill="#F8FAFC"
                    fontSize="9"
                    fontWeight="600"
                    className="truncate"
                  >
                    {store.name.length > 14 ? store.name.substring(0, 13) + '…' : store.name}
                  </text>
                </g>

                {/* Pris/sparing pille under pin hvis butikken har treff */}
                {rec.estimatedTotalSavingsNok > 0 && (
                  <g transform="translate(0, 24)">
                    <rect
                      x="-32"
                      y="-8"
                      width="64"
                      height="15"
                      rx="7"
                      fill="#064E3B"
                      stroke="#10B981"
                      strokeWidth="1"
                    />
                    <text x="0" y="3" textAnchor="middle" fill="#A7F3D0" fontSize="8.5" fontWeight="bold">
                      -{rec.estimatedTotalSavingsNok} kr
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Kartkontroller (Zoom inn/ut, Tilbakestill) */}
        <div className="absolute top-4 right-4 flex flex-col gap-1.5 bg-slate-900/90 border border-slate-700/80 p-1 rounded-xl backdrop-blur-md shadow-xl z-10">
          <button
            type="button"
            onClick={() => handleZoom(0.25)}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            title="Zoom inn"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => handleZoom(-0.25)}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            title="Zoom ut"
          >
            <Minus className="w-4 h-4" />
          </button>
          <div className="w-full h-px bg-slate-800 my-0.5" />
          <button
            type="button"
            onClick={handleResetMap}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            title="Tilbakestill kartvisning"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        {/* Kartforklaring / Teip nederst i venstre hjørne */}
        <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-2 px-3 py-1.5 bg-slate-950/85 border border-slate-800 rounded-xl backdrop-blur-md text-[11px] text-slate-400 z-10">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-400 inline-block" />
            <span>Du</span>
          </div>
          <span className="text-slate-600">•</span>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            <span>Stopp 1</span>
          </div>
          <span className="text-slate-600">•</span>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-500 inline-block" />
            <span>Stopp 2</span>
          </div>
        </div>

        {/* Klikket butikk popup-kort på kartet */}
        {activePopupStore && (
          <div className="absolute bottom-4 right-4 max-w-xs w-72 bg-slate-900/95 border border-slate-700 p-4 rounded-xl shadow-2xl backdrop-blur-md z-20 animate-in fade-in slide-in-from-bottom-2 duration-150">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${CHAIN_COLORS[activePopupStore.chain]?.badge}`}>
                  {activePopupStore.chain.replace('_', ' ')}
                </span>
                <h4 className="font-bold text-sm text-white mt-1">{activePopupStore.name}</h4>
                <p className="text-xs text-slate-400">{activePopupStore.address}</p>
              </div>
              <button
                type="button"
                onClick={() => setActivePopupStore(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center gap-3 py-2 border-y border-slate-800 text-xs text-slate-300">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                {activePopupStore.travelTimeMinutes} min reise
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-sky-400" />
                {activePopupStore.distanceMeters} m
              </span>
            </div>

            {/* Finn tilbud for denne butikken */}
            {(() => {
              const rec = singleStoreRanking.find((s) => s.store.placeId === activePopupStore.placeId);
              if (!rec || rec.matchedItems.length === 0) {
                return (
                  <p className="text-[11px] text-slate-400 mt-2">
                    Ingen matchende tilbud på handlelisten i denne butikken.
                  </p>
                );
              }
              return (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-emerald-400 mb-1">
                    <span>{rec.matchedItemsCount} tilbudstreff</span>
                    <span>Spar {rec.estimatedTotalSavingsNok} kr</span>
                  </div>
                  <ul className="space-y-1 max-h-28 overflow-y-auto pr-1 text-[11px]">
                    {rec.matchedItems.map((item, idx) => (
                      <li
                        key={idx}
                        onClick={() => onSelectOffer?.(item.offer)}
                        className={`flex justify-between text-slate-300 ${
                          onSelectOffer ? 'cursor-pointer hover:text-emerald-300 transition-colors' : ''
                        }`}
                        title={onSelectOffer ? 'Trykk for å se side i kundeavis' : undefined}
                      >
                        <span className="truncate max-w-[140px]">{item.offer.productName}</span>
                        <span className="font-bold text-white">{item.offer.offerPrice} kr</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* 3. Underdel: Rutedetaljer, Nøkkeltall og Handleliste per stopp */}
      <div className="p-5 bg-slate-900 border-t border-slate-800 space-y-4">
        {/* Banner med begrunnelse */}
        {activeTab === 'COMBO' && bestComboRoute ? (
          <div className={`p-4 rounded-xl border ${
            bestComboRoute.isRecommended
              ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-200'
              : 'bg-slate-800/60 border-slate-700 text-slate-300'
          }`}>
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm">
                    {bestComboRoute.isRecommended ? 'Optimalisert Kombi-Rute' : 'Alternativ Kombi-Rute'}
                  </span>
                  {bestComboRoute.isRecommended && (
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-500 text-emerald-950 rounded-full">
                      ANBEFALES
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  {bestComboRoute.recommendationReason}
                </p>
              </div>
            </div>

            {/* Nøkkeltall for ruten */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-3 border-t border-emerald-800/40">
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                <span className="text-[11px] text-slate-400 block">Total besparelse</span>
                <span className="text-base font-extrabold text-emerald-400">
                  {bestComboRoute.combinedSavingsNok} kr
                </span>
              </div>
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                <span className="text-[11px] text-slate-400 block">Ekstra spart vs enkelt</span>
                <span className="text-base font-extrabold text-teal-400">
                  +{bestComboRoute.additionalSavingsVsSingleStoreNok} kr
                </span>
              </div>
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                <span className="text-[11px] text-slate-400 block">Total reisetid</span>
                <span className="text-base font-extrabold text-slate-100">
                  {bestComboRoute.totalTravelTimeMinutes} min
                </span>
              </div>
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                <span className="text-[11px] text-slate-400 block">Ekstra reisetid</span>
                <span className="text-base font-extrabold text-amber-400">
                  +{bestComboRoute.extraTravelTimeMinutes} min
                </span>
              </div>
            </div>
          </div>
        ) : (
          /* Enkeltbutikk oppsummering */
          <div className="p-4 rounded-xl border bg-blue-950/30 border-blue-800/50 text-blue-200">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-xs font-semibold text-blue-400 uppercase tracking-wide">
                  Beste Enkeltbutikk
                </span>
                <h3 className="text-base font-bold text-white mt-0.5">{activeSingle.store.name}</h3>
                <p className="text-xs text-slate-300 mt-1">
                  Gir {activeSingle.matchedItemsCount} av {activeSingle.totalShoppingListItems} varer på tilbud og sparer deg totalt {activeSingle.estimatedTotalSavingsNok} kr.
                </p>
              </div>
              <div className="text-right">
                <span className="text-xl font-black text-emerald-400">{activeSingle.estimatedTotalSavingsNok} kr</span>
                <span className="block text-[10px] text-slate-400">{activeSingle.store.travelTimeMinutes} min reise</span>
              </div>
            </div>
          </div>
        )}

        {/* 4. Stopp-for-stopp handleliste */}
        {activeTab === 'COMBO' && bestComboRoute ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Stopp 1 */}
            {bestComboRoute.stops.map((stop, stopIdx) => {
              const chainCfg = CHAIN_COLORS[stop.store.chain] || CHAIN_COLORS.KIWI;
              const isFirst = stopIdx === 0;

              return (
                <div
                  key={stop.store.placeId}
                  className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                            isFirst ? 'bg-emerald-600' : 'bg-purple-600'
                          }`}
                        >
                          {stopIdx + 1}
                        </span>
                        <div>
                          <h4 className="font-bold text-sm text-white">{stop.store.name}</h4>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${chainCfg.badge}`}>
                            {stop.store.chain.replace('_', ' ')}
                          </span>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-emerald-400">
                        Spar {stop.subtotalSavingsNok} kr
                      </span>
                    </div>

                    <div className="mt-3 space-y-2">
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                        Varer som plukkes her:
                      </span>
                      <ul className="space-y-1.5">
                        {stop.itemsToPick.map((item, idx) => (
                          <li
                            key={idx}
                            onClick={() => onSelectOffer?.(item.offer)}
                            className={`flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800/80 text-xs transition-all ${
                              onSelectOffer ? 'cursor-pointer hover:border-emerald-600/60 active:scale-[0.99]' : ''
                            }`}
                            title={onSelectOffer ? 'Trykk for å se side i kundeavis' : undefined}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <span className="text-slate-200 font-medium truncate">{item.offer.productName}</span>
                              {onSelectOffer && (
                                <span className="text-[10px] text-emerald-400 opacity-80 shrink-0 underline ml-1">
                                  👁️ Kundeavis
                                </span>
                              )}
                            </div>
                            <div className="text-right shrink-0 ml-2">
                              <span className="font-bold text-white">{item.offer.offerPrice} kr</span>
                              <span className="block text-[10px] text-emerald-400 font-semibold">
                                -{item.estimatedSavingsNok} kr
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
                    <span>{stop.store.address}</span>
                    <span>{stop.store.travelTimeMinutes} min fra start</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Liste over andre butikker ved enkeltvalg */
          <div className="space-y-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
              Velg butikk for direkte rute:
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {singleStoreRanking.map((rec, idx) => {
                const chainCfg = CHAIN_COLORS[rec.store.chain] || CHAIN_COLORS.KIWI;
                const isSelected = selectedSingleIndex === idx;

                return (
                  <button
                    key={rec.store.placeId}
                    type="button"
                    onClick={() => {
                      setSelectedSingleIndex(idx);
                      setActivePopupStore(rec.store);
                    }}
                    className={`flex items-start justify-between p-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'bg-blue-950/60 border-blue-500 shadow-md shadow-blue-500/20'
                        : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${chainCfg.badge}`}>
                        {rec.store.chain.replace('_', ' ')}
                      </span>
                      <h5 className="font-bold text-xs text-white mt-1">{rec.store.name}</h5>
                      <span className="text-[11px] text-slate-400 block mt-0.5">
                        {rec.matchedItemsCount} tilbudstreff • {rec.store.travelTimeMinutes} min
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="font-black text-xs text-emerald-400">-{rec.estimatedTotalSavingsNok} kr</span>
                      <span className="text-[10px] text-slate-500 block">score {rec.rankScore}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
