'use client';

import React, { useState, useEffect } from 'react';
import { X, RefreshCw } from 'lucide-react';
import StoreRouteMap from './StoreRouteMap';
import type { NormalizedOffer, RouteOptimizationResponse } from '../../types/contracts';

interface FloatingRouteMapButtonProps {
  routeData: RouteOptimizationResponse | null;
  estimatedSavingsNok?: number;
  onSelectOffer?: (offer: NormalizedOffer) => void;
  onTravelModeChange?: (mode: 'DRIVING' | 'WALKING' | 'BICYCLING') => void;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export default function FloatingRouteMapButton({
  routeData,
  estimatedSavingsNok = 0,
  onSelectOffer,
  onTravelModeChange,
  isOpen: controlledIsOpen,
  onOpenChange,
  className = ''
}: FloatingRouteMapButtonProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);

  const isControlled = typeof controlledIsOpen === 'boolean';
  const isOpen = isControlled ? controlledIsOpen : internalIsOpen;

  const setIsOpen = (next: boolean) => {
    if (!isControlled) {
      setInternalIsOpen(next);
    }
    onOpenChange?.(next);
  };

  // Lukk med Escape-tasten
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Beregn estimert besparelse hvis ikke eksplisitt sendt
  const displaySavings =
    estimatedSavingsNok > 0
      ? estimatedSavingsNok
      : routeData?.bestComboRoute?.combinedSavingsNok ||
        routeData?.singleStoreRanking?.[0]?.estimatedTotalSavingsNok ||
        0;

  return (
    <>
      {/* 1. Flytende Chat-boble knapp (fixed bottom-20 på mobil for å unngå bunn-nav, bottom-6 på desktop) */}
      <div className={`fixed bottom-20 md:bottom-6 right-5 z-40 ${className}`}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-label={isOpen ? 'Lukk kart og butikkrute' : 'Åpne butikk-rute og kart'}
          className="relative group w-14 h-14 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 shadow-2xl flex items-center justify-center text-white ring-4 ring-slate-950 hover:scale-105 active:scale-95 transition-all cursor-pointer"
        >
          {isOpen ? (
            <X className="w-6 h-6 text-white" />
          ) : (
            <div className="flex flex-col items-center justify-center">
              <span className="text-2xl leading-none">🗺️</span>
            </div>
          )}

          {/* Liten rabatt-badge over boblen */}
          {!isOpen && displaySavings > 0 && (
            <span className="absolute -top-2 -left-2 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-slate-950 shadow-md whitespace-nowrap animate-pulse">
              Spar {Math.round(displaySavings)} kr
            </span>
          )}
        </button>
      </div>

      {/* 2. Flytende Kart-vindu / Drawer */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end md:items-center justify-center md:justify-end md:p-6 animate-in fade-in duration-200"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="w-full md:max-w-2xl bg-slate-900 border border-slate-800 rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/95 shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">🗺️</span>
                <div>
                  <h3 className="font-extrabold text-sm sm:text-base text-white">
                    Butikk-rute & Lavpriskart
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Optimalisert rute for dine tilbud • {displaySavings > 0 ? `Spar ${Math.round(displaySavings)} kr` : 'Laveste pris'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                title="Lukk kart (Esc)"
                className="p-2 rounded-xl text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 min-h-[40px] min-w-[40px] flex items-center justify-center transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Innhold: Det interaktive kartet og rutevelgeren */}
            <div className="flex-1 overflow-y-auto p-2 sm:p-4 space-y-4">
              {routeData ? (
                <StoreRouteMap
                  routeData={routeData}
                  onSelectOffer={onSelectOffer}
                  onTravelModeChange={onTravelModeChange}
                />
              ) : (
                <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center space-y-3">
                  <RefreshCw className="w-8 h-8 animate-spin text-emerald-500" />
                  <p className="text-sm font-bold text-white">Laster og optimaliserer butikkrute...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
