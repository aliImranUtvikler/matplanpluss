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
  scaleMealPlanToMacroTargets,
  getAlternativeRecipeForDay
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
import type { UserDashboardData } from '../../services/db/userDatabaseService';
import { saveUserDashboard, syncInventoryWithUserStock } from '../../services/db/userDatabaseService';

export function getShortDishName(title: string): string {
  const lower = title.toLowerCase();

  // 1. Nøytrale & Tilbudsbaserte retter (ingen tvungne land!)
  if (lower.includes('jasminris') && lower.includes('tofu')) return 'Jasminris & Tofu';
  if (lower.includes('jasminris') && lower.includes('brokkoli')) return 'Jasminris & Brokkoli';
  if (lower.includes('høstgryte') || (lower.includes('potet') && lower.includes('rotmiks'))) return 'Potet & Rotmiks';
  if (lower.includes('kålrot') || (lower.includes('gulrot') && lower.includes('linse'))) return 'Kålrot & Linsegryte';
  if (lower.includes('mandelpotet') || (lower.includes('potet') && lower.includes('kikert'))) return 'Bakt Mandelpotet';
  if (lower.includes('hurtigpotet') || (lower.includes('potet') && lower.includes('bønner'))) return 'Potet & Bønner';
  if (lower.includes('jasminris') && lower.includes('gulrot')) return 'Jasminris & Gulrot';

  // 2. Etniske stiler (KUN hvis eksplisitt nevnt i oppskriften)
  if (lower.includes('gochujang') || lower.includes('koreansk')) return 'Koreansk Tofu';
  if (lower.includes('dal') || (lower.includes('indisk') && lower.includes('linse'))) return 'Indisk Linse-Dal';
  if (lower.includes('fusilli') || lower.includes('pasta')) return 'Kremet Kikertpasta';
  if (lower.includes('tempeh') || lower.includes('miso')) return 'Miso Tempeh';
  if (lower.includes('tikka')) return 'Kikerter Tikka';
  if (lower.includes('ramen')) return 'Kremet Ramen';
  if (lower.includes('burrito') || lower.includes('fajita')) return 'Burrito Bowl';
  if (lower.includes('shawarma')) return 'Shawarma Bowl';
  if (lower.includes('curry')) return 'Thai Curry';

  // 3. Generell rensing for vilkårlige retter:
  let cleaned = title
    .replace(/med\s+.*$/i, '')
    .replace(/^kundeavis-(favoritt|kupp):\s*/i, '')
    .replace(/^ukens tilbudskupp:\s*/i, '')
    .replace(/^høstgryte på tilbud:\s*/i, '')
    .replace(/^(15|18|20)-min\s+(rask\s+(nøytral\s+)?)?/i, '')
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
  userDashboard?: UserDashboardData;
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
  userDashboard,
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
  const [swappingDay, setSwappingDay] = useState<boolean>(false);

  // Henter effektivt inventar ved å flette base-inventar med userDashboard (ALDRI rå u-synket localStorage!)
  const getEffectiveInventory = async (): Promise<InventoryItem[]> => {
    let baseItems: InventoryItem[] = [];
    if (userDashboard?.customInventoryItems && Array.isArray(userDashboard.customInventoryItems) && userDashboard.customInventoryItems.length > 0) {
      baseItems = [...userDashboard.customInventoryItems];
    } else {
      try {
        const res = await fetch('./data/inventory.json')
          .catch(() => fetch('/matplanpluss/data/inventory.json'))
          .catch(() => fetch('/data/inventory.json'));
        if (res.ok) {
          baseItems = (await res.json()) as InventoryItem[];
        }
      } catch {}
    }

    if (userDashboard?.inventoryStockMap && baseItems.length > 0) {
      return syncInventoryWithUserStock(baseItems, userDashboard.inventoryStockMap);
    }
    return baseItems;
  };

  // Oppdaterer inStock-flagg på alle ingredienser i en ukeplan basert på brukerens inventoryStockMap
  const applyStockMapToPlan = (plan: WeeklyMealPlanResponse, stockMap?: Record<string, boolean>): WeeklyMealPlanResponse => {
    if (!stockMap || Object.keys(stockMap).length === 0) return plan;
    const updatedDays = plan.days.map((day) => ({
      ...day,
      ingredients: day.ingredients.map((ing) => {
        const ingId = ing.name.toLowerCase().trim().replace(/[^a-z0-9æøå]/gi, '-');
        const inStock = stockMap[ingId] !== undefined ? stockMap[ingId] : ing.inStock;
        return { ...ing, inStock };
      })
    }));
    return {
      ...plan,
      days: updatedDays
    };
  };

  // Bytt ut dagens rett med en alternativ nøytral/tilbudsbasert oppskrift uten å måtte velge land
  const handleSwapCurrentDayRecipe = async () => {
    if (!mealPlanData?.days || !currentDay) return;
    setSwappingDay(true);

    const inventory = await getEffectiveInventory();

    const usedTitles = mealPlanData.days
      .filter((d) => d.dayNumber !== currentDay.dayNumber)
      .map((d) => d.title);

    const alternative = getAlternativeRecipeForDay(
      currentDay.title,
      currentDay.dayNumber,
      chefModes,
      inventory,
      weeklyOffersState,
      usedTitles
    );

    if (!alternative) {
      setSwappingDay(false);
      return;
    }

    const updatedDays = mealPlanData.days.map((d) =>
      d.dayNumber === currentDay.dayNumber ? alternative : d
    );

    const rescaleResponse = scaleMealPlanToMacroTargets(
      updatedDays,
      macroTargets,
      inventory,
      weeklyOffersState,
      chefModes
    );

    setMealPlanData(rescaleResponse);
    if (typeof window !== 'undefined') {
      localStorage.setItem('user_mealplan', JSON.stringify(rescaleResponse));
      const now = new Date();
      const timeStr = now.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
      window.dispatchEvent(
        new CustomEvent('matplan_plan_status', {
          detail: {
            state: 'done',
            message: `✓ Oppskrift byttet til ${getShortDishName(alternative.title)} · kl. ${timeStr}`,
            timestamp: timeStr
          }
        })
      );
    }
    // Synk byttet oppskrift til sky/Supabase for innlogget bruker så Mac og iPhone er 100% like!
    if (currentUser?.id) {
      saveUserDashboard(currentUser.id, {
        email: currentUser.email,
        customMealPlan: rescaleResponse
      }).catch((err) => console.warn('Kunne ikke synke byttet oppskrift til skyen:', err));
    }
    onPlanUpdated?.(rescaleResponse);
    setTimeout(() => setSwappingDay(false), 350);
  };

  // Hent og skaler ukeplan basert på brukerens makromål og kokkens modus
  const fetchMealPlan = async () => {
    setLoading(true);
    setError(null);

    // 0. Sjekk om sky-dashboardet har en customMealPlan – da skal den alltid prioriteres og synkroniseres med inventoryStockMap!
    if (userDashboard?.customMealPlan?.days && userDashboard.customMealPlan.days.length > 0) {
      const synchedPlan = applyStockMapToPlan(userDashboard.customMealPlan, userDashboard.inventoryStockMap);
      setMealPlanData(synchedPlan);
      setLoading(false);
      onPlanUpdated?.(synchedPlan);
      return;
    }

    // 1. Prøv /api/mealplan
    try {
      const res = await fetch(`/api/mealplan?servings=${macroTargets.servings}`);
      if (res.ok) {
        const data = await res.json();
        if (data.mealPlan) {
          const inventory = await getEffectiveInventory();

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
          // Lagre den genererte ukeplanen i Supabase sky for innlogget bruker så både Mac og iPhone ser samme plan umiddelbart!
          if (currentUser?.id) {
            saveUserDashboard(currentUser.id, {
              email: currentUser.email,
              customMealPlan: scaled
            }).catch(() => {});
          }
          onPlanUpdated?.(scaled);
          return;
        }
      }
      throw new Error('API ikke tilgjengelig, prøver statisk default');
    } catch {
      // 2. Fallback til statisk public/data/default-mealplan.json
      try {
        const staticRes = await fetch('./data/default-mealplan.json')
          .catch(() => fetch('/matplanpluss/data/default-mealplan.json'))
          .catch(() => fetch('/data/default-mealplan.json'));
        if (staticRes.ok) {
          const staticData = (await staticRes.json()) as WeeklyMealPlanResponse;
          const inventory = await getEffectiveInventory();

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
          if (currentUser?.id) {
            saveUserDashboard(currentUser.id, {
              email: currentUser.email,
              customMealPlan: scaled
            }).catch(() => {});
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
    weeklyOffersState.length,
    userDashboard?.updatedAt,
    userDashboard?.customMealPlan
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

      {/* 3. HERO-KORT FOR DAGENS MIDDAG (Soft & Borderless, flat på mobil) */}
      {loading ? (
        <div className="bg-white/[0.02] ring-1 ring-white/[0.05] rounded-3xl p-12 text-center text-slate-400 flex flex-col items-center justify-center min-h-[260px]">
          <RefreshCw className="w-7 h-7 animate-spin text-emerald-500 mb-2" />
          <p className="text-xs">Laster meny...</p>
        </div>
      ) : currentDay ? (
        <div className="bg-transparent sm:bg-slate-900/50 backdrop-blur-none sm:backdrop-blur-sm ring-0 sm:ring-1 sm:ring-white/[0.06] shadow-none sm:shadow-xl sm:shadow-black/25 rounded-none sm:rounded-3xl p-0 sm:p-7 space-y-4">
          {/* Slank metadata-linje med prikker og Bytt oppskrift-knapp */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.06]">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="font-semibold text-slate-200">
                {currentDay.cuisine?.toLowerCase().includes('nøytral')
                  ? '🌍 Nøytral (Stats & Tilbud)'
                  : currentDay.cuisine}
              </span>
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

            <button
              type="button"
              onClick={handleSwapCurrentDayRecipe}
              disabled={swappingDay}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] active:bg-white/[0.12] text-xs font-semibold text-slate-300 hover:text-white ring-1 ring-white/[0.08] transition-all shrink-0 min-h-[36px]"
              title="Bytt ut denne oppskriften med en annen nøytral tilbudsrett"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${swappingDay ? 'animate-spin' : ''}`} />
              <span>Bytt oppskrift</span>
            </button>
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

          {/* Progressive disclosure: Myke trekkspill (flat og luftig på mobil) */}
          <div className="space-y-2 pt-2 border-t border-white/[0.06]">
            {/* Trekkspill 1: Ingredienser */}
            <div className="rounded-none sm:rounded-2xl overflow-hidden bg-transparent sm:bg-white/[0.02] ring-0 sm:ring-1 sm:ring-white/[0.04]">
              <button
                type="button"
                onClick={() => setIsIngredientsOpen(!isIngredientsOpen)}
                className="w-full py-3 sm:p-3.5 flex items-center justify-between text-left text-xs font-bold text-white hover:bg-white/[0.02] transition-colors border-b border-white/[0.06]"
              >
                <div className="flex items-center gap-2">
                  <ChefHat className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Ingredienser ({currentDay.ingredients.length})</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400 font-normal shrink-0">
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

              {/* Flat, luftig ingrediensliste (INGEN boks-i-boks klemning) */}
              {isIngredientsOpen && (
                <div className="py-1 sm:p-3.5 divide-y divide-white/[0.06]">
                  {currentDay.ingredients.map((ing, idx) => {
                    const matchingOffers = findMatchingOffersForIngredientName(ing.name, weeklyOffersState, 1);
                    const bestOffer = matchingOffers[0];

                    return (
                      <div
                        key={idx}
                        className="py-2.5 px-0 flex items-center justify-between gap-2 text-xs"
                      >
                        {/* Venstre: Ikon + Navn + Mengde (INGEN avkapping) */}
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {ing.inStock ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <ShoppingCart className="w-4 h-4 text-amber-400 shrink-0" />
                          )}
                          <div className="flex items-baseline gap-1.5 min-w-0">
                            <span className="font-bold text-white truncate sm:overflow-visible">
                              {ing.name}
                            </span>
                            <span className="text-[11px] text-slate-400 shrink-0">
                              · {ing.amountGrams}g
                            </span>
                          </div>
                        </div>

                        {/* Høyre: Tilbuds-badge + Status (kompakt) */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {bestOffer && (
                            <button
                              type="button"
                              onClick={() => setSelectedFlyerOffer(bestOffer)}
                              className="px-2 py-0.5 rounded-lg text-[10px] font-black border flex items-center gap-1 bg-amber-950/60 text-amber-300 border-amber-700/60 hover:bg-amber-900/60 transition-all cursor-pointer"
                              title="Vis i kundeavis"
                            >
                              <span>🏷️ {bestOffer.chain.replace('_', ' ')} {bestOffer.offerPrice},-</span>
                            </button>
                          )}

                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              ing.inStock
                                ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                                : 'bg-amber-950/80 text-amber-400 border border-amber-800/60'
                            }`}
                          >
                            {ing.inStock ? 'På lager' : 'Kjøp'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Trekkspill 2: Steg-for-steg kokkesteg (flat på mobil) */}
            <div className="rounded-none sm:rounded-2xl overflow-hidden bg-transparent sm:bg-white/[0.02] ring-0 sm:ring-1 sm:ring-white/[0.04]">
              <button
                type="button"
                onClick={() => setIsStepsOpen(!isStepsOpen)}
                className="w-full py-3 sm:p-3.5 flex items-center justify-between text-left text-xs font-bold text-white hover:bg-white/[0.02] transition-colors border-b border-white/[0.06]"
              >
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Steg-for-steg tilberedning ({currentDay.steps.length} steg)</span>
                </div>
                {isStepsOpen ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>

              {isStepsOpen && (
                <div className="py-2 sm:p-3.5 space-y-2 divide-y divide-white/[0.04]">
                  {currentDay.steps.map((step, idx) => (
                    <div
                      key={idx}
                      className="pt-2 first:pt-0 flex items-start gap-2.5 text-xs leading-relaxed text-slate-200"
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
