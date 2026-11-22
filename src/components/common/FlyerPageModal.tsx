'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ExternalLink,
  CheckCircle2,
  Tag,
  ShieldCheck,
  Calendar,
  AlertCircle,
  Maximize2
} from 'lucide-react';
import type { NormalizedOffer, StoreChain } from '../../types/contracts';

interface FlyerPageModalProps {
  offer: NormalizedOffer | null;
  onClose: () => void;
}

const CHAIN_STYLES: Record<StoreChain, { label: string; badgeClass: string; hex: string }> = {
  REMA_1000: {
    label: 'REMA 1000',
    badgeClass: 'bg-blue-950 text-blue-300 border-blue-700/60',
    hex: '#2563EB'
  },
  KIWI: {
    label: 'KIWI',
    badgeClass: 'bg-emerald-950 text-emerald-300 border-emerald-700/60',
    hex: '#059669'
  },
  MENY: {
    label: 'MENY',
    badgeClass: 'bg-rose-950 text-rose-300 border-rose-700/60',
    hex: '#E11D48'
  },
  COOP_EXTRA: {
    label: 'Coop Extra',
    badgeClass: 'bg-orange-950 text-orange-300 border-orange-700/60',
    hex: '#EA580C'
  },
  SPAR: {
    label: 'SPAR',
    badgeClass: 'bg-red-950 text-red-300 border-red-700/60',
    hex: '#B91C1C'
  },
  JOKER: {
    label: 'Joker',
    badgeClass: 'bg-cyan-950 text-cyan-300 border-cyan-700/60',
    hex: '#0891B2'
  },
  ODA: {
    label: 'Oda',
    badgeClass: 'bg-amber-950 text-amber-300 border-amber-700/60',
    hex: '#D97706'
  }
};

export default function FlyerPageModal({ offer, onClose }: FlyerPageModalProps) {
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [imgLoading, setImgLoading] = useState<boolean>(true);
  const [imgError, setImgError] = useState<boolean>(false);

  // Nullstill zoom ved endring av tilbud
  useEffect(() => {
    if (offer) {
      setZoomLevel(1);
      setImgLoading(true);
      setImgError(false);
    }
  }, [offer?.id]);

  // Lukk med Escape-tasten
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (offer) {
      window.addEventListener('keydown', handleKeyDown);
      // Forhindre bakgrunns-scrolling på body
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [offer, handleKeyDown]);

  if (!offer) return null;

  const chainInfo = CHAIN_STYLES[offer.chain] || {
    label: offer.chain.replace('_', ' '),
    badgeClass: 'bg-slate-800 text-slate-300 border-slate-700',
    hex: '#10B981'
  };

  // Bestem bilde-URL (fallback til flyerImageUrl eller imageUrl)
  const rawImageUrl = offer.flyerImageUrl || offer.imageUrl;
  const imageSrc = rawImageUrl
    ? rawImageUrl.startsWith('/')
      ? rawImageUrl
      : `/${rawImageUrl}`
    : null;

  const zoomIn = () => setZoomLevel((prev) => Math.min(prev + 0.35, 2.5));
  const zoomOut = () => setZoomLevel((prev) => Math.max(prev - 0.35, 0.75));
  const resetZoom = () => setZoomLevel(1);
  const toggleClickZoom = () => setZoomLevel((prev) => (prev > 1.2 ? 1 : 1.7));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="flyer-modal-title"
      className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-800 rounded-3xl max-w-4xl w-full max-h-[96vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. Header: Vareinfo, butikkjede og sidetall */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/95">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`text-xs font-black px-2.5 py-1 rounded-lg border shadow-sm ${chainInfo.badgeClass}`}
              >
                {chainInfo.label}
              </span>

              {offer.pageNumber && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700">
                  Kundeavis Side {offer.pageNumber}
                </span>
              )}

              <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-emerald-950 text-emerald-400 border border-emerald-800/60 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Verifisert original</span>
              </span>
            </div>

            <h2 id="flyer-modal-title" className="text-base sm:text-lg font-black text-white truncate">
              {offer.productName}
            </h2>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-emerald-400 font-black text-sm">{offer.offerPrice} kr</span>
              {offer.regularPrice && offer.regularPrice > offer.offerPrice && (
                <span className="text-slate-500 line-through">{offer.regularPrice} kr</span>
              )}
              {offer.discountAmountNok && offer.discountAmountNok > 0 && (
                <span className="text-amber-400 font-bold">
                  (Spar {offer.discountAmountNok} kr)
                </span>
              )}
              {offer.unitDescription && (
                <span className="text-slate-400">• {offer.unitDescription}</span>
              )}
            </div>
          </div>

          {/* Kontrollknapper (Zoom, Ekstern lenke, Lukk) */}
          <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl p-0.5">
              <button
                type="button"
                onClick={zoomOut}
                disabled={zoomLevel <= 0.75}
                title="Zoom ut"
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={resetZoom}
                title="Tilbakestill visning"
                className="px-2 py-1 text-[11px] font-bold text-slate-400 hover:text-white transition-colors"
              >
                {Math.round(zoomLevel * 100)}%
              </button>
              <button
                type="button"
                onClick={zoomIn}
                disabled={zoomLevel >= 2.5}
                title="Zoom inn"
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>

            {imageSrc && (
              <a
                href={imageSrc}
                target="_blank"
                rel="noreferrer"
                title="Åpne høyoppløst bilde i ny fane"
                className="p-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex items-center justify-center min-h-[40px] min-w-[40px]"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}

            <button
              type="button"
              onClick={onClose}
              title="Lukk visning (Esc)"
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors flex items-center justify-center min-h-[40px] min-w-[40px]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 2. Bildevisning (Lightbox med Zoom & Pan) */}
        <div className="relative flex-1 overflow-auto bg-slate-950 flex items-center justify-center min-h-[350px] p-2 sm:p-4 select-none">
          {imageSrc && !imgError ? (
            <div
              className="relative transition-transform duration-150 ease-out cursor-zoom-in"
              style={{
                transform: `scale(${zoomLevel})`,
                transformOrigin: 'top center'
              }}
              onClick={toggleClickZoom}
            >
              {/* Laster-indikator */}
              {imgLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 z-10">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" />
                </div>
              )}

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageSrc}
                alt={`${offer.productName} i kundeavisen for ${chainInfo.label}`}
                onLoad={() => setImgLoading(false)}
                onError={() => {
                  setImgLoading(false);
                  setImgError(true);
                }}
                className="max-h-[72vh] w-auto rounded-xl shadow-2xl border border-slate-800 object-contain mx-auto"
              />
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 space-y-2">
              <AlertCircle className="w-10 h-10 text-amber-500 mx-auto" />
              <p className="text-sm font-bold text-white">Kunne ikke laste kundeavis-bilde</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                {rawImageUrl
                  ? `Filbanen '${rawImageUrl}' var ikke tilgjengelig.`
                  : 'Dette tilbudet har ingen lagret kundeavis-side.'}
              </p>
            </div>
          )}
        </div>

        {/* 3. Footer: Valideringsdetaljer og veiledning */}
        <div className="p-3.5 sm:p-4 border-t border-slate-800 bg-slate-900/90 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Verifisert fra trykket kundeavis</span>
            </span>
            <span className="hidden sm:inline">•</span>
            <span className="flex items-center gap-1 text-slate-400">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span>
                Gyldig til {new Date(offer.validUntil).toLocaleDateString('no-NO')}
              </span>
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span>Trykk på bildet for å zoome</span>
            <span>•</span>
            <span className="text-slate-400">Trykk Esc eller utenfor for å lukke</span>
          </div>
        </div>
      </div>
    </div>
  );
}
