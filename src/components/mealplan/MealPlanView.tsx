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

  // 1. Spesifikke mønstre for kjente retter
  if (lower.includes('gochujang') || (lower.includes('tofu') && lower.includes('bowl'))) {
    return 'Koreansk Tofu Bowl';
  }
  if (lower.includes('dal') || lower.includes('lentil') || lower.includes('linse')) {
    return 'Indisk Linse-Dal';
  }
  if (lower.includes('fusilli') || lower.includes('pasta')) {
    return 'Kremet Kikertpasta';
  }
  if (lower.includes('tempeh') || lower.includes('miso')) {
    return 'Miso Tempeh Bowl';
  }
  if (lower.includes('tikka') || (lower.includes('kikerter') && lower.includes('spinat'))) {
    return 'Kikerter Tikka';
  }
  if (lower.includes('ramen')) return 'Kremet Ramen';
  if (lower.includes('burrito') || lower.includes('fajita')) return 'Burrito Bowl';
  if (lower.includes('shawarma')) return 'Shawarma Bowl';
  if (lower.includes('curry')) return 'Thai Curry';

  // 2. Generell rensing for vilkårlige retter:
  const cleaned = title
    .replace(/med\s+.*$/i, '')
    .replace(/High-Protein\s+/gi, '')
    .replace(/Duftende\s+/gi, '')
    .replace(/Sprøstekt\s+TRS\s+/gi, '')
    .replace(/Sprøstekt\s+/gi, '')
    .replace(/Crispy\s+/gi, '')
    .replace(/Power\s+Bowl/gi, 'Bowl')
    .replace(/&amp;/g, '&')
    .trim();

  const words = cleaned.split(' ').filter(Boolean);
  if (words.length > 3) {
    return words.slice(0, 3).join(' ');
  }
  return cleaned || title;
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
      {/* 1. ROLIG VELKOMSTHILSEN & AKTIV MAKROMÅL-PIL (UU: Lav kognitiv støy) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            Hei {firstName} 👋
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Her er dagens middag og ukens 5 plantebaserte retter.
          </p>
        </div>

        {/* Diskret pille for aktive makromål med lenke til Preferanser */}
        <button
          type="button"
          onClick={onNavigateToPreferences}
          className="self-start sm:self-auto flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs text-slate-300 hover:text-white transition-colors min-h-[44px]"
          title="Klikk for å endre makromål i Preferanser"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
          <span className="font-semibold">
            {macroTargets.minProteinGrams}–{macroTargets.maxProteinGrams}g prot • Maks {macroTargets.maxKcal} kcal • {macroTargets.servings} pers
          </span>
          <span className="text-[11px] text-emerald-400 flex items-center font-bold">
            Endre <ChevronRight className="w-3 h-3 ml-0.5" />
          </span>
        </button>
      </div>

      {/* 2. HORISONTAL 5-DAGERS UKEVELGER MED RETTENS NAVN (iPhone 48pt touch, full ukeoversikt) */}
      {mealPlanData && (
        <div className="flex items-stretch gap-2 overflow-x-auto pb-1.5 scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
          {mealPlanData.days.map((day) => {
            const isSelected = selectedDayNumber === day.dayNumber;
            return (
              <button
                key={day.dayNumber}
                type="button"
                onClick={() => {
                  setSelectedDayNumber(day.dayNumber);
                  setIsIngredientsOpen(false);
                  setIsStepsOpen(false);
                }}
                className={`flex-1 min-w-[96px] sm:min-w-[120px] p-2.5 sm:p-3 rounded-2xl border text-center transition-all min-h-[64px] sm:min-h-[72px] flex flex-col justify-between items-center ${
                  isSelected
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-600/30 scale-[1.02] ring-2 ring-emerald-400'
                    : 'bg-slate-900/90 text-slate-300 border-slate-800 hover:border-slate-700 hover:bg-slate-800/60'
                }`}
                title={day.title}
              >
                <span
                  className={`text-[10px] font-black uppercase tracking-wider block ${
                    isSelected ? 'text-emerald-100' : 'text-slate-400'
                  }`}
                >
                  {day.dayName.substring(0, 3)}
                </span>
                <span
                  className={`text-xs font-bold block leading-tight truncate mt-0.5 ${
                    isSelected ? 'text-white' : 'text-slate-200'
                  }`}
                  title={day.title}
                >
                  {getShortDishName(day.title)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* 2b. DISKRET STATUSPILLE FOR KOKKENS MODUS (iOS HIG & WCAG 2.1 AA) */}
      <div className="flex items-center justify-between px-3.5 py-2.5 rounded-2xl bg-slate-900/90 border border-slate-800 text-xs shadow-sm">
        <div className="flex items-center gap-2 overflow-hidden text-slate-300">
          <ChefHat className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="truncate font-medium">
            Modus: <span className="text-white font-semibold">{chefModeSummaryText}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={onNavigateToPreferences}
          className="text-emerald-400 hover:text-emerald-300 font-bold shrink-0 text-xs ml-2 flex items-center gap-0.5 min-h-[44px] px-2.5 py-1 rounded-xl hover:bg-slate-800 transition-colors"
          title="Endre kokkens modus og oppskriftsstil i Preferanser"
        >
          Endre ⚙️
        </button>
      </div>

      {/* 3. HERO-KORT FOR DAGENS MIDDAG (Rent blikkfang, ingen duplisert tittel) */}
      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center text-slate-400 flex flex-col items-center justify-center min-h-[280px]">
          <RefreshCw className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
          <p className="text-sm">Laster oppskrift...</p>
        </div>
      ) : currentDay ? (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-4">
          {/* Slank metadata-linje: Dagsnavn, kjøkken, tid, karbobase og trygghetsbadge */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-950 text-emerald-400 border border-emerald-800/80">
                {currentDay.dayName}
              </span>
              <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300">
                {currentDay.cuisine}
              </span>
              <span className="flex items-center gap-1 text-xs text-slate-400">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                {currentDay.prepTimeMinutes} min
              </span>
              {currentDayOfferCount > 0 && (
                <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-amber-950/70 text-amber-300 border border-amber-800/60 flex items-center gap-1">
                  <span>🏷️</span>
                  <span>{currentDayOfferCount} på tilbud</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400 hidden sm:inline">Karbobase:</span>
              <span className="font-semibold text-slate-200 flex items-center gap-1">
                <Wheat className="w-3.5 h-3.5 text-amber-400" />
                {currentDay.carbBase.name} ({currentDay.carbBase.dryWeightGramsPerPerson}g)
              </span>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800/60">
                100% Peanøttfri
              </span>
            </div>
          </div>

          {/* Rettens fulle tittel (rent og diskret) */}
          <div>
            <h3 className="text-base sm:text-lg font-black text-white tracking-tight leading-snug">
              {currentDay.title}
            </h3>
          </div>

          {/* 3 Fremhevede Nøkkeltall (UU: Maks 3 for å unngå overbelastning) */}
          <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
            <div className="bg-slate-950/80 p-3 sm:p-4 rounded-2xl border border-emerald-900/50 text-center">
              <span className="text-[10px] sm:text-xs font-bold text-emerald-400 uppercase tracking-wider block">
                Protein
              </span>
              <span className="text-xl sm:text-2xl font-black text-white block mt-0.5">
                {currentDay.macros.proteinGramsPerPerson}g
              </span>
              <span className="text-[10px] text-emerald-500 font-bold block">per person</span>
            </div>

            <div className="bg-slate-950/80 p-3 sm:p-4 rounded-2xl border border-slate-800 text-center">
              <span className="text-[10px] sm:text-xs font-bold text-amber-400 uppercase tracking-wider block">
                Kalorier
              </span>
              <span className="text-xl sm:text-2xl font-black text-white block mt-0.5">
                {currentDay.macros.kcalPerPerson}
              </span>
              <span className="text-[10px] text-slate-400 block">kcal / pers</span>
            </div>

            <div className="bg-slate-950/80 p-3 sm:p-4 rounded-2xl border border-slate-800 text-center">
              <span className="text-[10px] sm:text-xs font-bold text-teal-400 uppercase tracking-wider block">
                Planter
              </span>
              <span className="text-xl sm:text-2xl font-black text-white block mt-0.5">
                {currentDay.macros.plantCount}
              </span>
              <span className="text-[10px] text-teal-500 font-bold block">Gut points</span>
            </div>
          </div>

          {/* PRIMÆRKNAPP: Gå direkte til Handleliste hvis varer mangler */}
          {missingCount > 0 ? (
            <button
              type="button"
              onClick={onNavigateToShopping}
              className="w-full flex items-center justify-between p-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm transition-all shadow-lg shadow-amber-500/20 min-h-[52px]"
            >
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-slate-950" />
                <span>{missingCount} varer mangler til denne retten</span>
              </div>
              <span className="flex items-center text-xs font-black uppercase tracking-wider">
                Se rute på kartet <ArrowRight className="w-4 h-4 ml-1" />
              </span>
            </button>
          ) : (
            <div className="p-3.5 rounded-2xl bg-emerald-950/60 border border-emerald-800/80 flex items-center justify-between text-xs text-emerald-200">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="font-bold">Alt du trenger er allerede på lager i kjøkkenskapet!</span>
              </div>
            </div>
          )}

          {/* 4. PROGRESSIVE DISCLOSURE: Trekkspill for Ingredienser og Kokkesteg */}
          <div className="space-y-2 pt-1 border-t border-slate-800/80">
            {/* Trekkspill 1: Ingredienser */}
            <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/40">
              <button
                type="button"
                onClick={() => setIsIngredientsOpen(!isIngredientsOpen)}
                className="w-full p-4 flex items-center justify-between text-left text-xs sm:text-sm font-bold text-white hover:bg-slate-800/40 transition-colors min-h-[48px]"
              >
                <div className="flex items-center gap-2">
                  <ChefHat className="w-4 h-4 text-emerald-400" />
                  <span>
                    Ingredienser ({currentDay.ingredients.length} råvarer)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-normal">
                    {currentDay.ingredients.filter((i) => i.inStock).length} i skapet • {missingCount} kjøpes
                  </span>
                  {isIngredientsOpen ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </div>
              </button>

              {isIngredientsOpen && (
                <div className="p-4 pt-1 space-y-2 border-t border-slate-800/60">
                  {currentDay.ingredients.map((ing, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-slate-900 border border-slate-800/80 flex items-center justify-between text-xs min-h-[44px]"
                    >
                      <div className="flex items-center gap-2.5">
                        {ing.inStock ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <ShoppingCart className="w-4 h-4 text-amber-400 shrink-0" />
                        )}
                        <div>
                          <span className="font-bold text-white">{ing.name}</span>
                          <span className="text-slate-400 ml-2">({ing.displayAmount})</span>
                        </div>
                      </div>

                      {(() => {
                        const matchingOffers = findMatchingOffersForIngredientName(ing.name, weeklyOffersState, 1);
                        const topOffer = matchingOffers[0];
                        const badgeStyle = topOffer ? getStoreChainBadgeStyle(topOffer.chain) : null;

                        return (
                          <div className="flex items-center gap-1.5 shrink-0">
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
                                className="text-[10px] font-medium px-2 py-0.5 rounded-md border border-slate-800 bg-slate-950 text-slate-400 flex items-center gap-1 shadow-sm"
                              >
                                <span className="text-[10px] opacity-60">🛒</span>
                                <span>
                                  <span className="hidden sm:inline">Ingen tilbud • </span>Ordinær pris
                                </span>
                              </span>
                            )}

                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                ing.inStock
                                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                                  : 'bg-amber-950 text-amber-300 border border-amber-800/60'
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
            <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/40">
              <button
                type="button"
                onClick={() => setIsStepsOpen(!isStepsOpen)}
                className="w-full p-4 flex items-center justify-between text-left text-xs sm:text-sm font-bold text-white hover:bg-slate-800/40 transition-colors min-h-[48px]"
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
                <div className="p-4 pt-1 space-y-3 border-t border-slate-800/60">
                  {currentDay.steps.map((step, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl bg-slate-900 border border-slate-800/80 flex items-start gap-3 text-xs leading-relaxed text-slate-200"
                    >
                      <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center shrink-0 text-xs mt-0.5">
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
