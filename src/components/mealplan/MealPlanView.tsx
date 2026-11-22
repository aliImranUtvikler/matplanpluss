'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar,
  ChefHat,
  Dumbbell,
  Flame,
  Wheat,
  Activity,
  ShieldCheck,
  CheckCircle2,
  ShoppingCart,
  Clock,
  Users,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ArrowRight,
  SlidersHorizontal,
  Sparkles
} from 'lucide-react';
import {
  DEFAULT_USER_MACRO_TARGETS,
  scaleMealPlanToMacroTargets
} from '../../services/mealplan/dynamicMacroScaler';
import {
  findMatchingOffersForIngredientName,
  getStoreChainBadgeStyle
} from '../../services/offers/offerMatcher';
import FlyerPageModal from '../common/FlyerPageModal';
import type {
  ChefModePreferences,
  InventoryItem,
  MealPlanDay,
  NormalizedOffer,
  UserMacroTargets,
  WeeklyMealPlanResponse
} from '../../types/contracts';
import type { GoogleUserProfile } from '../../services/auth/googleSsoService';

export function getShortDishName(title: string): string {
  const lower = title.toLowerCase();

  // 1. Spesifikke mønstre
  if (lower.includes('rotgrønnsak') || lower.includes('potetgryte')) return 'Rotgrønnsaksgryte';
  if (lower.includes('gochujang') || (lower.includes('tofu') && lower.includes('bowl'))) return 'Koreansk Tofu Bowl';
  if (lower.includes('dal') || lower.includes('lentil') || lower.includes('linse')) return 'Indisk Linse-Dal';
  if (lower.includes('fusilli') || lower.includes('pasta')) return 'Kremet Kikertpasta';
  if (lower.includes('tempeh') || lower.includes('miso')) return 'Miso Tempeh Bowl';
  if (lower.includes('tikka') || (lower.includes('kikerter') && lower.includes('spinat'))) return 'Kikerter Tikka';
  if (lower.includes('ramen')) return 'Kremet Ramen';
  if (lower.includes('burrito') || lower.includes('fajita')) return 'Burrito Bowl';
  if (lower.includes('shawarma')) return 'Shawarma Bowl';
  if (lower.includes('curry')) return 'Thai Curry';

  // 2. Generell rensing for vilkårlige retter:
  let cleaned = title
    .replace(/med\s+.*$/i, '')
    .replace(/High-Protein\s+/gi, '')
    .replace(/Duftende\s+/gi, '')
    .replace(/Sprøstekt\s+TRS\s+/gi, '')
    .replace(/Sprøstekt\s+/gi, '')
    .replace(/Crispy\s+/gi, '')
    .replace(/Power\s+Bowl/gi, 'Bowl')
    .replace(/Rustikk\s+/gi, '')
    .replace(/&amp;/g, '&')
    .replace(/[&–—\-]\s*$/g, '')
    .trim();

  const words = cleaned.split(/\s+/).filter(Boolean);
  while (words.length > 0 && /^[&–—\-og]+$/i.test(words[words.length - 1])) {
    words.pop();
  }

  if (words.length > 3) {
    cleaned = words.slice(0, 3).join(' ');
  } else {
    cleaned = words.join(' ');
  }

  return cleaned.replace(/[-&–—]\s*$/, '').trim() || title;
}

interface MealPlanViewProps {
  currentUser?: GoogleUserProfile;
  macroTargets?: UserMacroTargets;
  chefModes?: ChefModePreferences;
  weeklyOffers?: NormalizedOffer[];
  onPlanUpdated?: (newPlan: WeeklyMealPlanResponse) => void;
  onNavigateToPreferences?: () => void;
  onNavigateToShopping?: () => void;
  className?: string;
}

export default function MealPlanView({
  currentUser,
  macroTargets = DEFAULT_USER_MACRO_TARGETS,
  chefModes,
  weeklyOffers: weeklyOffersProp,
  onPlanUpdated,
  onNavigateToPreferences,
  onNavigateToShopping,
  className = ''
}: MealPlanViewProps) {
  const [mealPlanData, setMealPlanData] = useState<WeeklyMealPlanResponse | null>(null);
  const [selectedDayNumber, setSelectedDayNumber] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [weeklyOffersState, setWeeklyOffersState] = useState<NormalizedOffer[]>(weeklyOffersProp || []);
  const [selectedFlyerOffer, setSelectedFlyerOffer] = useState<NormalizedOffer | null>(null);

  // Last ukens tilbud hvis ikke sendt som prop
  useEffect(() => {
    if (weeklyOffersProp && weeklyOffersProp.length > 0) {
      setWeeklyOffersState(weeklyOffersProp);
      return;
    }
    fetch('./data/weekly-offers.json')
      .catch(() => fetch('/data/weekly-offers.json'))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.offers && Array.isArray(data.offers)) {
          setWeeklyOffersState(data.offers);
        }
      })
      .catch(() => {});
  }, [weeklyOffersProp]);

  // Progressive Disclosure: Skjul/vis ingredienser og steg
  const [isIngredientsOpen, setIsIngredientsOpen] = useState<boolean>(false);
  const [isStepsOpen, setIsStepsOpen] = useState<boolean>(false);

  // Hent og skaler ukeplan basert på brukerens makromål og kokkens modus
  const fetchMealPlan = async () => {
    setLoading(true);
    setError(null);

    // 1. Sjekk localStorage først hvis verken chefModes eller custom makroer er overstyrt
    if (typeof window !== 'undefined' && !chefModes) {
      const savedPlan = localStorage.getItem('user_mealplan');
      if (savedPlan) {
        try {
          const parsed = JSON.parse(savedPlan) as WeeklyMealPlanResponse;
          if (parsed.days && parsed.days.length > 0) {
            setMealPlanData(parsed);
            setLoading(false);
            onPlanUpdated?.(parsed);
            return;
          }
        } catch {}
      }
    }

    // 2. Prøv /api/mealplan
    try {
      const res = await fetch(`/api/mealplan?servings=${macroTargets.servings}`);
      if (res.ok) {
        const data = await res.json();
        if (data.mealPlan) {
          // Send gjennom dynamic scaler for å hensynta chefModes hvis til stede
          let inventory: InventoryItem[] = [];
          try {
            const invSaved = localStorage.getItem('user_inventory');
            if (invSaved) inventory = JSON.parse(invSaved);
          } catch {}

          const scaled = scaleMealPlanToMacroTargets(
            data.mealPlan.days,
            macroTargets,
            inventory,
            weeklyOffersState,
            chefModes
          );

          setMealPlanData(scaled);
          if (typeof window !== 'undefined') {
            localStorage.setItem('user_mealplan', JSON.stringify(scaled));
          }
          onPlanUpdated?.(scaled);
          return;
        }
      }
      throw new Error('API ikke tilgjengelig, prøver statisk default');
    } catch {
      // 3. Fallback til statisk public/data/default-mealplan.json
      try {
        const staticRes = await fetch('./data/default-mealplan.json').catch(() =>
          fetch('/data/default-mealplan.json')
        );
        if (staticRes.ok) {
          const staticData = (await staticRes.json()) as WeeklyMealPlanResponse;
          let inventory: InventoryItem[] = [];
          try {
            const invSaved = localStorage.getItem('user_inventory');
            if (invSaved) inventory = JSON.parse(invSaved);
          } catch {}

          const scaled = scaleMealPlanToMacroTargets(
            staticData.days,
            macroTargets,
            inventory,
            weeklyOffersState,
            chefModes
          );
          setMealPlanData(scaled);
          if (typeof window !== 'undefined') {
            localStorage.setItem('user_mealplan', JSON.stringify(scaled));
          }
          onPlanUpdated?.(scaled);
          return;
        }
        throw new Error('Kunne ikke hente ukeplan');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Feil ved innhenting av ukeplan');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMealPlan();
  }, [
    macroTargets.minProteinGrams,
    macroTargets.maxKcal,
    macroTargets.servings,
    macroTargets.targetCarbDryWeightGrams,
    chefModes,
    weeklyOffersState.length
  ]);

  const currentDay = useMemo(() => {
    if (!mealPlanData?.days) return null;
    return (
      mealPlanData.days.find((d) => d.dayNumber === selectedDayNumber) ||
      mealPlanData.days[0]
    );
  }, [mealPlanData, selectedDayNumber]);

  // Antall varer som mangler i dagens rett
  const missingCount = useMemo(() => {
    if (!currentDay) return 0;
    return currentDay.ingredients.filter((i) => !i.inStock).length;
  }, [currentDay]);

  // Antall varer som matcher ukens kundeaviser i dagens rett
  const currentDayOfferCount = useMemo(() => {
    if (!currentDay || weeklyOffersState.length === 0) return 0;
    return currentDay.ingredients.filter(
      (ing) => findMatchingOffersForIngredientName(ing.name, weeklyOffersState, 1).length > 0
    ).length;
  }, [currentDay, weeklyOffersState]);

  // Tekstlig oppsummering for den diskrete statuspillen for Kokkens Modus
  const chefModeSummaryText = useMemo(() => {
    if (!chefModes) return 'Standard kokk';
    const parts: string[] = [];
    if (chefModes.focusOffers) parts.push('🏷️ 100% Tilbud');
    if (chefModes.prioritizePantry) parts.push('🥫 Tøm skap');
    if (chefModes.quickMealsOnly) parts.push('⚡ Rask (20m)');
    if (chefModes.enableCuisineFilter && chefModes.selectedCuisines?.length > 0) {
      if (chefModes.selectedCuisines.length === 5) {
        parts.push('🌏 Alle stiler');
      } else {
        const styleNames = chefModes.selectedCuisines.map((s) => {
          if (s === 'ASIATISK') return 'Asiatisk';
          if (s === 'INDISK') return 'Indisk';
          if (s === 'MIDDELHAVS') return 'Middelhavs';
          if (s === 'MIDTOSTEN') return 'Midtøsten';
          if (s === 'LATIN_AMERIKANSK') return 'Latin';
          return s;
        });
        parts.push(`🌏 ${styleNames.join(', ')}`);
      }
    } else {
      parts.push('🌍 Nøytral meny');
    }
    if (chefModes.enableCustomNotes && chefModes.customNotes) {
      parts.push('✍️ Eget ønske');
    }
    return parts.length > 0 ? parts.join(' • ') : 'Standard kokk';
  }, [chefModes]);

  const firstName = currentUser?.givenName || currentUser?.name?.split(' ')[0] || 'der';

  return (
    <div className={`space-y-4 max-w-4xl mx-auto ${className}`}>
      {/* 1. ROLIG VELKOMSTHILSEN MED KOMPAKT MAKRO & MODUS-STATUS PÅ VENSTRE SIDE */}
      <div className="pb-1">
        <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
          Hei {firstName} 👋
        </h2>

        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400 mt-1">
          <span className="font-semibold text-slate-300">
            {macroTargets.minProteinGrams}–{macroTargets.maxProteinGrams}g prot
          </span>
          <span className="text-slate-600">·</span>
          <span>Maks {macroTargets.maxKcal} kcal</span>
          <span className="text-slate-600">·</span>
          <span>{macroTargets.servings} pers</span>
          <span className="text-slate-600">·</span>
          <span className="text-emerald-400 font-medium">{chefModeSummaryText}</span>
          <button
            type="button"
            onClick={onNavigateToPreferences}
            className="p-1 text-slate-400 hover:text-white transition-colors ml-0.5 inline-flex items-center"
            title="Endre makromål og kokkens modus i Preferanser"
          >
            <span className="text-xs">⚙️</span>
          </button>
        </div>
      </div>

      {/* 2. HORISONTAL UKEVELGER: TITTEL I BOKS, UKEDAG DISKRET UNDER */}
      {mealPlanData && (
        <div className="flex items-start gap-2.5 overflow-x-auto pb-2 scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0 pt-2">
          {mealPlanData.days.map((day) => {
            const isSelected = selectedDayNumber === day.dayNumber;
            return (
              <div key={day.dayNumber} className="flex-1 min-w-[100px] sm:min-w-[125px] flex flex-col items-center">
                {/* Myk boks: Kun rettens tittel */}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDayNumber(day.dayNumber);
                    setIsIngredientsOpen(false);
                    setIsStepsOpen(false);
                  }}
                  className={`w-full p-3 rounded-2xl text-center transition-all min-h-[58px] flex items-center justify-center ${
                    isSelected
                      ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/40 ring-1 ring-emerald-400/50'
                      : 'bg-white/[0.03] hover:bg-white/[0.06] text-slate-300 ring-1 ring-white/[0.05]'
                  }`}
                  title={day.title}
                >
                  <span className="text-xs font-bold leading-snug line-clamp-2">
                    {getShortDishName(day.title)}
                  </span>
                </button>

                {/* Diskret ukedag UNDER boksen på utsiden */}
                <div className="mt-1.5 flex flex-col items-center">
                  <span
                    className={`text-[11px] tracking-wide transition-colors ${
                      isSelected ? 'text-emerald-400 font-bold' : 'text-slate-500 font-medium'
                    }`}
                  >
                    {day.dayName}
                  </span>
                  {isSelected && (
                    <span className="w-1 h-1 rounded-full bg-emerald-400 mt-0.5" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 3. HERO-KORT FOR DAGENS MIDDAG (Soft & Borderless) */}
      {loading ? (
        <div className="bg-white/[0.02] ring-1 ring-white/[0.05] rounded-3xl p-12 text-center text-slate-400 flex flex-col items-center justify-center min-h-[260px]">
          <RefreshCw className="w-7 h-7 animate-spin text-emerald-500 mb-2" />
          <p className="text-xs">Laster meny...</p>
        </div>
      ) : currentDay ? (
        <div className="bg-slate-900/50 backdrop-blur-sm ring-1 ring-white/[0.06] shadow-xl shadow-black/25 rounded-3xl p-5 sm:p-7 space-y-4">
          {/* Slank metadata-linje med prikker (ingen harde piller) */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 pb-3 border-b border-white/[0.06]">
            <span className="font-semibold text-slate-200">{currentDay.cuisine}</span>
            <span className="text-slate-600">·</span>
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              {currentDay.prepTimeMinutes} min
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-300">
              Karbobase:{' '}
              <span className="text-amber-300 font-medium">
                {currentDay.carbBase.name} ({currentDay.carbBase.dryWeightGramsPerPerson}g)
              </span>
            </span>
            {currentDayOfferCount > 0 && (
              <>
                <span className="text-slate-600">·</span>
                <span className="text-amber-400 font-medium">🏷️ {currentDayOfferCount} på tilbud</span>
              </>
            )}
            <span className="text-slate-600">·</span>
            <span className="text-emerald-400 font-medium">Peanøttfri</span>
          </div>

          {/* Rettens fulle tittel */}
          <h3 className="text-lg sm:text-xl font-black text-white tracking-tight leading-snug">
            {currentDay.title}
          </h3>

          {/* ÅPEN TYPOGRAFISK MAKRORAD (Slutt på 3 inngjerdede bokser!) */}
          <div className="flex items-center gap-4 sm:gap-6 py-1">
            <div className="text-left">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Protein</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  {currentDay.macros.proteinGramsPerPerson}g
                </span>
                <span className="text-[11px] text-emerald-400 font-medium">per pers</span>
              </div>
            </div>

            <div className="h-8 w-px bg-white/[0.08]" />

            <div className="text-left">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Kalorier</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  {currentDay.macros.kcalPerPerson}
                </span>
                <span className="text-[11px] text-slate-400">kcal</span>
              </div>
            </div>

            <div className="h-8 w-px bg-white/[0.08]" />

            <div className="text-left">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Planter</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  {currentDay.macros.plantCount}
                </span>
                <span className="text-[11px] text-teal-400 font-medium">gut points</span>
              </div>
            </div>
          </div>

          {/* KOMPAKT VENSTRESTILT HANDLELISTE-KNAPP (Slutt på den skrikende hel-oransje banneren!) */}
          {missingCount > 0 ? (
            <div className="pt-1">
              <button
                type="button"
                onClick={onNavigateToShopping}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25 transition-all text-xs font-bold active:scale-[0.98]"
              >
                <ShoppingCart className="w-4 h-4 text-amber-400" />
                <span>{missingCount} varer mangler</span>
                <span className="text-amber-500">·</span>
                <span className="flex items-center text-amber-200">
                  Se rute <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium pt-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Alt du trenger er på lager i kjøkkenskapet</span>
            </div>
          )}

          {/* Progressive disclosure: Myke trekkspill med ring-1 ring-white/[0.04] */}
          <div className="space-y-2 pt-2 border-t border-white/[0.06]">
            {/* Trekkspill 1: Ingredienser */}
            <div className="rounded-2xl overflow-hidden bg-white/[0.02] ring-1 ring-white/[0.04]">
              <button
                type="button"
                onClick={() => setIsIngredientsOpen(!isIngredientsOpen)}
                className="w-full p-3.5 flex items-center justify-between text-left text-xs font-bold text-white hover:bg-white/[0.02] transition-colors min-h-[44px]"
              >
                <div className="flex items-center gap-2">
                  <ChefHat className="w-4 h-4 text-emerald-400" />
                  <span>Ingredienser ({currentDay.ingredients.length} råvarer)</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400 font-normal">
                  <span>
                    {currentDay.ingredients.filter((i) => i.inStock).length} i skapet · {missingCount} kjøpes
                  </span>
                  {isIngredientsOpen ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </div>
              </button>

              {isIngredientsOpen && (
                <div className="p-3.5 pt-1 space-y-1.5 border-t border-white/[0.04]">
                  {currentDay.ingredients.map((ing, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] flex items-center justify-between text-xs min-h-[40px] transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {ing.inStock ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <ShoppingCart className="w-4 h-4 text-amber-400 shrink-0" />
                        )}
                        <div className="min-w-0 truncate">
                          <span className="font-bold text-white">{ing.name}</span>
                          <span className="text-slate-400 ml-2">({ing.displayAmount})</span>
                        </div>
                      </div>

                      {(() => {
                        const matchingOffers = findMatchingOffersForIngredientName(ing.name, weeklyOffersState, 1);
                        const topOffer = matchingOffers[0];
                        const badgeStyle = topOffer ? getStoreChainBadgeStyle(topOffer.chain) : null;

                        return (
                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            {topOffer && badgeStyle ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedFlyerOffer(topOffer);
                                }}
                                title={`Trykk for å se side ${topOffer.pageNumber || 1} i kundeavisen for ${badgeStyle.label}`}
                                className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md border flex items-center gap-1 shadow-sm transition-all cursor-pointer hover:scale-105 active:scale-95 ${badgeStyle.badgeClass}`}
                              >
                                <span className="text-[11px]">🏷️</span>
                                <span>{badgeStyle.label}</span>
                                <span className="opacity-95">{topOffer.offerPrice.toFixed(0)},-</span>
                                <span className="text-[9px] opacity-80 underline ml-0.5 hidden sm:inline">Side {topOffer.pageNumber || 1}</span>
                              </button>
                            ) : (
                              <span
                                title="Ingen registrerte tilbud i ukens kundeaviser (ordinær hyllepris)"
                                className="text-[10px] font-medium px-2 py-0.5 rounded-md border border-white/[0.04] bg-white/[0.01] text-slate-400 flex items-center gap-1 shadow-sm"
                              >
                                <span className="text-[10px] opacity-60">🛒</span>
                                <span>
                                  <span className="hidden sm:inline">Ingen tilbud · </span>Ordinær pris
                                </span>
                              </span>
                            )}

                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                ing.inStock
                                  ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/40'
                                  : 'bg-amber-950/70 text-amber-300 border border-amber-800/40'
                              }`}
                            >
                              {ing.inStock ? 'På lager' : 'Mangler'}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Trekkspill 2: Steg-for-steg kokkesteg */}
            <div className="rounded-2xl overflow-hidden bg-white/[0.02] ring-1 ring-white/[0.04]">
              <button
                type="button"
                onClick={() => setIsStepsOpen(!isStepsOpen)}
                className="w-full p-3.5 flex items-center justify-between text-left text-xs font-bold text-white hover:bg-white/[0.02] transition-colors min-h-[44px]"
              >
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-emerald-400" />
                  <span>Steg-for-steg tilberedning ({currentDay.steps.length} steg)</span>
                </div>
                {isStepsOpen ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>

              {isStepsOpen && (
                <div className="p-3.5 pt-1 space-y-2 border-t border-white/[0.04]">
                  {currentDay.steps.map((step, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-white/[0.02] flex items-start gap-3 text-xs leading-relaxed text-slate-200"
                    >
                      <span className="w-5 h-5 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center shrink-0 text-[10px] mt-0.5">
                        {idx + 1}
                      </span>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* 5. Kundeavis-side Modal (Lightbox for å validere at tilbudet faktisk finnes) */}
      <FlyerPageModal
        offer={selectedFlyerOffer}
        onClose={() => setSelectedFlyerOffer(null)}
      />
    </div>
  );
}
