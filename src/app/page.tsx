'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Boxes,
  UtensilsCrossed,
  Radar,
  ShoppingBag,
  Dumbbell,
  Flame,
  ShieldCheck,
  ChevronRight,
  TrendingDown,
  Wheat,
  Activity,
  CheckCircle2,
  SlidersHorizontal,
  User,
  LogOut,
  Sparkles,
  ArrowRight,
  Store,
  RefreshCw,
  Users
} from 'lucide-react';
import InventoryView from '../components/inventory/InventoryView';
import MealPlanView from '../components/mealplan/MealPlanView';
import OffersRadarView from '../components/radar/OffersRadarView';
import FloatingRouteMapButton from '../components/radar/FloatingRouteMapButton';
import PreferencesAdminView from '../components/admin/PreferencesAdminView';
import type {
  InventoryItem,
  RouteOptimizationResponse,
  ShoppingListItem,
  WeeklyMealPlanResponse
} from '../types/contracts';
import type {
  GoogleUserProfile,
  AuthSession
} from '../services/auth/googleSsoService';
import {
  getCurrentAuthSession,
  DEMO_GOOGLE_ACCOUNTS,
  signInWithGoogleProfile,
  switchDemoAccount,
  signOutGoogleSession,
  subscribeToAuthChange,
  initGoogleIdentityServices,
  renderGoogleSignInButton,
  isGoogleGsiConfigured
} from '../services/auth/googleSsoService';
import type { UserDashboardData, CloudSyncStatus } from '../services/db/userDatabaseService';
import {
  loadUserDashboard,
  saveUserDashboard,
  createDefaultUserDashboard,
  subscribeToHouseholdSync,
  pullLatestFromSupabase,
  getCloudSyncStatus
} from '../services/db/userDatabaseService';

type ActiveTab = 'MEALPLAN' | 'RADAR' | 'INVENTORY' | 'PREFERENCES';

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('MEALPLAN');

  // Bruker og autentiseringstilstand
  const [currentUser, setCurrentUser] = useState<GoogleUserProfile | null>(null);
  const [userDashboard, setUserDashboard] = useState<UserDashboardData | null>(null);
  const [authInitialized, setAuthInitialized] = useState<boolean>(false);

  // Egendefinert e-post login input
  const [customEmail, setCustomEmail] = useState<string>('');
  const [customName, setCustomName] = useState<string>('');

  // Globale nøkkeltall for header-indikatorene
  const [inStockCount, setInStockCount] = useState<number>(18);
  const [totalItemsCount, setTotalItemsCount] = useState<number>(41);
  const [avgProteinGrams, setAvgProteinGrams] = useState<number>(46);
  const [avgKcal, setAvgKcal] = useState<number>(690);
  const [shoppingListCount, setShoppingListCount] = useState<number>(23);
  const [estimatedSavingsNok, setEstimatedSavingsNok] = useState<number>(65);

  // Aktiv handleliste på tvers av Ukeplan og Radar
  const [activeShoppingList, setActiveShoppingList] = useState<ShoppingListItem[]>([]);

  // Global rutedata og kart-modal (tilgjengelig på tvers av ALLE faner)
  const [globalRouteData, setGlobalRouteData] = useState<RouteOptimizationResponse | null>(null);
  const [isGlobalMapModalOpen, setIsGlobalMapModalOpen] = useState<boolean>(false);

  // Global flytende status-boble som følger brukeren på tvers av alle faner
  const [planStatus, setPlanStatus] = useState<{
    state: 'idle' | 'working' | 'done';
    message: string;
    timestamp?: string;
  }>({
    state: 'idle',
    message: ''
  });

  // Sky-synk diagnostikk og status mot Supabase
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>({
    state: 'LOCAL_ONLY',
    message: 'Initialiserer...'
  });

  const googleButtonContainerRef = useRef<HTMLDivElement>(null);

  // Lytter på endringer i sky-synk status
  useEffect(() => {
    setCloudSyncStatus(getCloudSyncStatus());
    const handleSyncStatusEvent = (e: Event) => {
      const custom = e as CustomEvent<CloudSyncStatus>;
      if (custom.detail) {
        setCloudSyncStatus(custom.detail);
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('matplan-sync-status', handleSyncStatusEvent);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('matplan-sync-status', handleSyncStatusEvent);
      }
    };
  }, []);

  // Tving øyeblikkelig synk mot Supabase sky ved klikk
  const handleForceSync = async () => {
    if (!currentUser) return;
    setPlanStatus({ state: 'working', message: 'Tvinger øyeblikkelig synk med Supabase...' });
    try {
      const fresh = await pullLatestFromSupabase(currentUser.id, currentUser.email);
      if (fresh) {
        setUserDashboard(fresh);
        if (fresh.macroTargets) {
          const minP = fresh.macroTargets.minProteinGrams;
          const maxP = fresh.macroTargets.maxProteinGrams;
          setAvgProteinGrams(Math.round((minP + maxP) / 2));
          setAvgKcal(fresh.macroTargets.maxKcal);
        }
        setPlanStatus({ state: 'done', message: '✓ Synket med Supabase' });
      } else {
        const loaded = await loadUserDashboard(currentUser.id, [], undefined, currentUser.email);
        setUserDashboard(loaded);
        setPlanStatus({ state: 'done', message: '✓ Dashboard oppdatert' });
      }
    } catch {
      setPlanStatus({ state: 'done', message: 'Synk fullført lokalt' });
    }
  };

  // 1. Initialiser autentisering og global status ved oppstart (starter alltid 'idle' uten svevende boble)
  useEffect(() => {
    let fadeoutTimer: NodeJS.Timeout | null = null;

    const handleStatusEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ state: 'working' | 'done'; message?: string; timestamp?: string }>;
      if (!customEvent.detail) return;
      const { state, message, timestamp } = customEvent.detail;

      if (fadeoutTimer) {
        clearTimeout(fadeoutTimer);
        fadeoutTimer = null;
      }

      if (state === 'working') {
        setPlanStatus({
          state: 'working',
          message: message || 'Jobber med ny ukeplan & stil...'
        });
      } else if (state === 'done') {
        const nowFormatted = timestamp || new Date().toLocaleTimeString('nb-NO', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        setPlanStatus({
          state: 'done',
          message: message || `Stil & ukeplan oppdatert · kl. ${nowFormatted}`,
          timestamp: nowFormatted
        });

        // Automatisk tilbakestill til 'idle' etter 2.5 sekunder så ingenting svever permanent!
        fadeoutTimer = setTimeout(() => {
          setPlanStatus({ state: 'idle', message: '' });
        }, 2500);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('matplan_plan_status', handleStatusEvent);
    }

    const session = getCurrentAuthSession();
    if (session?.user) {
      setCurrentUser(session.user);
    } else {
      // Standard: La brukeren starte med Alex Nordmann (Styrke & Sykkel) som standard demo-profil
      // så appen er umiddelbart interaktiv og utforskbar uten tvungen sperre!
      const defaultDemo = DEMO_GOOGLE_ACCOUNTS[0];
      setCurrentUser(defaultDemo);
    }
    setAuthInitialized(true);

    const unsubscribe = subscribeToAuthChange((newSession) => {
      setCurrentUser(newSession?.user || null);
    });

    return () => {
      unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('matplan_plan_status', handleStatusEvent);
      }
    };
  }, []);

  // 1a. Automatisk fadeout for status-boblen når oppgaven er fullført (3.5 sekunder)
  useEffect(() => {
    if (planStatus.state === 'done') {
      const timer = setTimeout(() => {
        setPlanStatus({ state: 'idle', message: '' });
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [planStatus.state, planStatus.message]);

  // 1b. Sanntids Live Sync for felles husstand over BroadcastChannel og sky
  useEffect(() => {
    const unsubscribe = subscribeToHouseholdSync((updatedDashboard) => {
      setUserDashboard(updatedDashboard);
      if (updatedDashboard.macroTargets) {
        const minP = updatedDashboard.macroTargets.minProteinGrams;
        const maxP = updatedDashboard.macroTargets.maxProteinGrams;
        setAvgProteinGrams(Math.round((minP + maxP) / 2));
        setAvgKcal(updatedDashboard.macroTargets.maxKcal);
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. Last brukerens personlige dashboard når aktiv bruker endres
  useEffect(() => {
    if (!currentUser) {
      setUserDashboard(null);
      return;
    }

    const fetchDashboard = async () => {
      try {
        const dashboard = await loadUserDashboard(currentUser.id, [], undefined, currentUser.email);
        setUserDashboard(dashboard);

        // Oppdater lokale nøkkeltall fra dashboard
        if (dashboard.macroTargets) {
          const minP = dashboard.macroTargets.minProteinGrams;
          const maxP = dashboard.macroTargets.maxProteinGrams;
          setAvgProteinGrams(Math.round((minP + maxP) / 2));
          setAvgKcal(dashboard.macroTargets.maxKcal);
        }
      } catch (err) {
        console.warn('Kunne ikke laste dashboard:', err);
      }
    };

    fetchDashboard();
  }, [currentUser?.id, currentUser?.email]);

  // 2b. Sanntids sky-synk mellom enheter (f.eks. Mac og iPhone) via Supabase polling og focus
  useEffect(() => {
    if (!currentUser) return;

    const syncCloud = async () => {
      try {
        const cloudData = await pullLatestFromSupabase(currentUser.id, currentUser.email);
        if (cloudData && cloudData.updatedAt !== userDashboard?.updatedAt) {
          setUserDashboard(cloudData);
          if (cloudData.macroTargets) {
            const minP = cloudData.macroTargets.minProteinGrams;
            const maxP = cloudData.macroTargets.maxProteinGrams;
            setAvgProteinGrams(Math.round((minP + maxP) / 2));
            setAvgKcal(cloudData.macroTargets.maxKcal);
          }
        }
      } catch {
        // Ignorer bakgrunnsfeil
      }
    };

    const intervalId = setInterval(syncCloud, 5000);
    const onFocus = () => { syncCloud(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, [currentUser?.id, currentUser?.email, userDashboard?.updatedAt]);

  // 3. Render ekte Google Identity Services knapp hvis konfigurert
  useEffect(() => {
    if (!currentUser && googleButtonContainerRef.current) {
      initGoogleIdentityServices({
        onSignIn: (session) => {
          setCurrentUser(session.user);
        }
      }).then((ready) => {
        if (ready && googleButtonContainerRef.current) {
          renderGoogleSignInButton(googleButtonContainerRef.current, {
            theme: 'filled_black',
            shape: 'pill',
            size: 'large'
          });
        }
      });
    }
  }, [currentUser, authInitialized]);

  // Håndter oppdatering av dashboard fra preferanser eller andre visninger
  const handleDashboardUpdated = (updated: UserDashboardData) => {
    setUserDashboard(updated);
    if (updated.macroTargets) {
      const minP = updated.macroTargets.minProteinGrams;
      const maxP = updated.macroTargets.maxProteinGrams;
      setAvgProteinGrams(Math.round((minP + maxP) / 2));
      setAvgKcal(updated.macroTargets.maxKcal);
    }
  };

  // Håndter oppdatering av ukeplan fra MealPlanView (f.eks. ved makrojustering)
  const handleMealPlanUpdated = (newPlan: WeeklyMealPlanResponse) => {
    if (newPlan.shoppingList) {
      setActiveShoppingList(newPlan.shoppingList);
      setShoppingListCount(newPlan.shoppingList.length);
    }
    if (newPlan.days && newPlan.days.length > 0) {
      const pSum = newPlan.days.reduce((acc, d) => acc + d.macros.proteinGramsPerPerson, 0);
      const kSum = newPlan.days.reduce((acc, d) => acc + d.macros.kcalPerPerson, 0);
      setAvgProteinGrams(Math.round(pSum / newPlan.days.length));
      setAvgKcal(Math.round(kSum / newPlan.days.length));
    }
  };

  // Logg inn med egendefinert navn/e-post
  const handleCustomLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customEmail.trim()) return;
    const session = signInWithGoogleProfile({
      email: customEmail.trim(),
      name: customName.trim() || undefined
    });
    setCurrentUser(session.user);
    setCustomEmail('');
    setCustomName('');
  };

  // Logg ut
  const handleLogOut = () => {
    signOutGoogleSession();
    setCurrentUser(null);
    setUserDashboard(null);
  };

  if (!authInitialized) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        <RefreshCw className="w-8 h-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  // 4. INNLOGGINGSSKJERM DERSOM INGEN BRUKER ER VALGT
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4 selection:bg-emerald-500 selection:text-slate-950">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 text-center">
          {/* Logo & Tittel */}
          <div className="flex flex-col items-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/25 text-slate-950 font-black mb-3">
              <UtensilsCrossed className="w-8 h-8 text-slate-950" />
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">
              Matplan & Tilbuds-Radar
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              100% Vegansk • 100% Peanøttfri • Dynamiske Makroer • Rute-radar for 7 kjeder
            </p>
          </div>

          {/* Ekte Google Identity Services container hvis tilgjengelig */}
          <div ref={googleButtonContainerRef} className="flex justify-center min-h-[44px]" />

          {/* 1-klikks valg av Google Demo-kontoer */}
          <div className="space-y-3 pt-2 border-t border-slate-800">
            <span className="text-xs font-semibold text-slate-400 block">
              Eller velg en ferdig Google-demoprofil:
            </span>
            <div className="space-y-2">
              {DEMO_GOOGLE_ACCOUNTS.map((acc) => (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => {
                    const session = switchDemoAccount(acc.id);
                    setCurrentUser(session.user);
                  }}
                  className="w-full p-3.5 rounded-2xl bg-slate-950/80 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 transition-all flex items-center gap-3 text-left min-h-[48px]"
                >
                  <img
                    src={acc.pictureUrl}
                    alt={acc.name}
                    className="w-9 h-9 rounded-full border border-slate-700 object-cover shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="font-bold text-xs text-white block truncate">{acc.name}</span>
                    <span className="text-[10px] text-slate-400 block truncate">{acc.dietaryFocus}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                </button>
              ))}
            </div>
          </div>

          {/* Manuell innlogging med egen e-post */}
          <form onSubmit={handleCustomLogin} className="pt-2 border-t border-slate-800 space-y-2">
            <span className="text-xs font-semibold text-slate-400 block text-left">
              Eller logg inn med din egen e-post:
            </span>
            <input
              type="email"
              value={customEmail}
              onChange={(e) => setCustomEmail(e.target.value)}
              placeholder="din.epost@example.com"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-base text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 min-h-[48px]"
              required
            />
            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors min-h-[48px]"
            >
              Fortsett med e-post
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 5. HOVEDAPPLIKASJON MED 4 FANER (NÅR INNLOGGET)
  const activeMacroTargets = userDashboard?.macroTargets;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950">
      {/* 1. TOPP-HEADER (Rolig og stilren) */}
      <header className="sticky top-0 z-40 bg-slate-950/90 border-b border-slate-800/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-20 gap-3">
            {/* Logo */}
            <div
              onClick={() => setActiveTab('MEALPLAN')}
              className="flex items-center gap-3 cursor-pointer select-none"
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-slate-950 font-black shrink-0">
                <UtensilsCrossed className="w-5 h-5 text-slate-950" />
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-black tracking-tight text-white leading-tight">
                  Matplan
                </h1>
              </div>
            </div>

            {/* Desktop Topp-navigasjon (De 4 fanene) */}
            <nav className="hidden md:flex items-center gap-1.5 p-1 bg-slate-900 border border-slate-800 rounded-2xl">
              <button
                type="button"
                onClick={() => setActiveTab('MEALPLAN')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all min-h-[44px] ${
                  activeTab === 'MEALPLAN'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <UtensilsCrossed className="w-4 h-4" />
                <span>Ukemeny</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('RADAR')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all min-h-[44px] ${
                  activeTab === 'RADAR'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ShoppingBag className="w-4 h-4" />
                <span>Handleliste</span>
                {shoppingListCount > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.2 rounded-md bg-amber-950 text-[10px] font-extrabold text-amber-300 border border-amber-800/50">
                    {shoppingListCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('INVENTORY')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all min-h-[44px] ${
                  activeTab === 'INVENTORY'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Boxes className="w-4 h-4" />
                <span>Kjøkkenskap</span>
                <span className="ml-0.5 px-1.5 py-0.2 rounded-md bg-slate-950/60 text-[10px] font-extrabold text-emerald-300">
                  {inStockCount}/{totalItemsCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('PREFERENCES')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all min-h-[44px] ${
                  activeTab === 'PREFERENCES'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <SlidersHorizontal className="w-4 h-4" />
                <span>Preferanser</span>
              </button>
            </nav>

            {/* Header-handlinger: Kart-knapp & Brukerprofil */}
            <div className="flex items-center gap-2">
              {/* Rute & Kart-knapp (rent, diskret ikon i headeren i stedet for svevende boble på mobil) */}
              <button
                type="button"
                onClick={() => setIsGlobalMapModalOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3 sm:py-1.5 rounded-full bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-xs font-bold text-white transition-all min-h-[44px]"
                title="Åpne butikk-rute og tilbudskart"
              >
                <span className="text-base leading-none">🗺️</span>
                <span className="hidden sm:inline text-xs font-semibold text-slate-300">Kart</span>
                {estimatedSavingsNok > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-slate-950">
                    Spar {Math.round(estimatedSavingsNok)} kr
                  </span>
                )}
              </button>

              {/* Sky-synk-indikator med sanntidsstatus (klikkbar for å tvinge øyeblikkelig henting) */}
              <button
                type="button"
                onClick={handleForceSync}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-xs font-medium text-slate-300 transition-all min-h-[44px]"
                title={`Sky-status: ${cloudSyncStatus.message} · Klikk for å tvinge oppdatering`}
              >
                {cloudSyncStatus.state === 'SYNCED' && (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="hidden sm:inline text-emerald-400 text-[11px] font-semibold">☁️ Synket</span>
                  </>
                )}
                {cloudSyncStatus.state === 'SYNCING' && (
                  <>
                    <RefreshCw className="w-3 h-3 text-cyan-400 animate-spin" />
                    <span className="hidden sm:inline text-cyan-300 text-[11px] font-semibold">Synker...</span>
                  </>
                )}
                {cloudSyncStatus.state === 'LOCAL_ONLY' && (
                  <>
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span className="hidden sm:inline text-amber-400 text-[11px] font-semibold">Lokal</span>
                  </>
                )}
                {cloudSyncStatus.state === 'ERROR' && (
                  <>
                    <span className="w-2 h-2 rounded-full bg-rose-400" />
                    <span className="hidden sm:inline text-rose-400 text-[11px] font-semibold">Synk-feil</span>
                  </>
                )}
              </button>

              {userDashboard?.household && (
                <button
                  type="button"
                  onClick={() => setActiveTab('PREFERENCES')}
                  className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-950/70 border border-purple-800/80 text-xs font-bold text-purple-200 hover:border-purple-600 transition-colors min-h-[44px]"
                  title={`Felles husstand: ${userDashboard.household.name}`}
                >
                  <Users className="w-3.5 h-3.5 text-purple-400" />
                  <span className="max-w-[140px] truncate">{userDashboard.household.name.split('(')[0].trim()}</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-0.5" title="Sanntidssynk aktiv" />
                </button>
              )}

              <button
                type="button"
                onClick={() => setActiveTab('PREFERENCES')}
                className="flex items-center gap-2 p-1.5 sm:px-3 sm:py-1.5 rounded-full bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors min-h-[44px]"
                title="Gå til Preferanser & Google SSO"
              >
                {currentUser.pictureUrl ? (
                  <img
                    src={currentUser.pictureUrl}
                    alt={currentUser.name}
                    className="w-7 h-7 rounded-full border border-emerald-500 object-cover"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-emerald-950 border border-emerald-500 flex items-center justify-center text-xs font-bold text-emerald-400">
                    {currentUser.name.charAt(0)}
                  </div>
                )}
                <span className="text-xs font-bold text-white hidden sm:inline-block max-w-[110px] truncate">
                  {currentUser.givenName || currentUser.name.split(' ')[0]}
                </span>
              </button>

              <button
                type="button"
                onClick={handleLogOut}
                className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-slate-900 transition-colors min-h-[44px] hidden sm:flex items-center justify-center"
                title="Logg ut"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 2. HOVEDINNHOLD */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 pb-24 md:pb-8">
        {activeTab === 'MEALPLAN' && (
          <MealPlanView
            currentUser={currentUser}
            userDashboard={userDashboard || undefined}
            macroTargets={activeMacroTargets}
            chefModes={userDashboard?.chefModes}
            onPlanUpdated={handleMealPlanUpdated}
            onNavigateToPreferences={() => setActiveTab('PREFERENCES')}
            onNavigateToShopping={() => setActiveTab('RADAR')}
          />
        )}

        {activeTab === 'RADAR' && (
          <OffersRadarView
            currentUser={currentUser}
            dashboard={userDashboard || undefined}
            onDashboardUpdated={handleDashboardUpdated}
            initialShoppingList={activeShoppingList}
            onRouteCalculated={(route) => setGlobalRouteData(route)}
            onOpenMapModal={() => setIsGlobalMapModalOpen(true)}
          />
        )}

        {activeTab === 'INVENTORY' && (
          <InventoryView
            currentUser={currentUser}
            dashboard={userDashboard || undefined}
            onDashboardUpdated={handleDashboardUpdated}
          />
        )}

        {activeTab === 'PREFERENCES' && userDashboard && (
          <PreferencesAdminView
            currentUser={currentUser}
            dashboard={userDashboard}
            onDashboardUpdated={handleDashboardUpdated}
            onUserSwitched={(newUser) => setCurrentUser(newUser)}
            onLoggedOut={handleLogOut}
          />
        )}
      </main>

      {/* 3. MOBIL BUNN-NAVIGASJON (iPhone iOS HIG Bottom Tab Bar, min-h-[56px], safe-area) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 border-t border-slate-800 backdrop-blur-xl px-2 py-1.5 flex items-center justify-around shadow-2xl pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => setActiveTab('MEALPLAN')}
          className={`flex flex-col items-center justify-center gap-1 py-1 px-3 rounded-2xl transition-all min-h-[48px] flex-1 ${
            activeTab === 'MEALPLAN' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <UtensilsCrossed className="w-5 h-5" />
          <span className="text-[10px]">Ukemeny</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('RADAR')}
          className={`flex flex-col items-center justify-center gap-1 py-1 px-3 rounded-2xl transition-all min-h-[48px] flex-1 relative ${
            activeTab === 'RADAR' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ShoppingBag className="w-5 h-5" />
          <span className="text-[10px]">Handleliste</span>
          {shoppingListCount > 0 && (
            <span className="absolute top-0.5 right-3 px-1.5 py-0.2 rounded-full text-[9px] font-black bg-amber-500 text-slate-950">
              {shoppingListCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('INVENTORY')}
          className={`flex flex-col items-center justify-center gap-1 py-1 px-3 rounded-2xl transition-all min-h-[48px] flex-1 ${
            activeTab === 'INVENTORY' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Boxes className="w-5 h-5" />
          <span className="text-[10px]">Kjøkkenskap</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('PREFERENCES')}
          className={`flex flex-col items-center justify-center gap-1 py-1 px-3 rounded-2xl transition-all min-h-[48px] flex-1 ${
            activeTab === 'PREFERENCES' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <SlidersHorizontal className="w-5 h-5" />
          <span className="text-[10px]">Preferanser</span>
        </button>
      </nav>

      {/* 4. GLOBALT FLYTENDE KART-BOBLE (Synlig på ALLE faner: Ukemeny, Handleliste, Kjøkkenskap, Preferanser!) */}
      <FloatingRouteMapButton
        routeData={globalRouteData}
        estimatedSavingsNok={estimatedSavingsNok}
        isOpen={isGlobalMapModalOpen}
        onOpenChange={setIsGlobalMapModalOpen}
      />

      {/* 5. GLOBALT STATUS-VARSEL (vises kun under aktiv oppdatering, forsvinner automatisk etter 2.5s) */}
      {planStatus.state !== 'idle' && (
        <div className="fixed bottom-20 md:bottom-6 left-4 z-40 max-w-[calc(100vw-2rem)] md:max-w-md pointer-events-auto">
          {planStatus.state === 'working' ? (
            <div className="flex items-center gap-2.5 px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-full bg-slate-900/95 backdrop-blur-xl ring-1 ring-amber-400/50 text-amber-300 shadow-xl shadow-amber-950/40 text-xs font-bold animate-in fade-in slide-in-from-bottom-2 duration-300">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" />
              <span className="truncate">⏳ {planStatus.message}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-full bg-slate-900/95 backdrop-blur-xl ring-1 ring-emerald-400/50 text-emerald-300 shadow-xl shadow-emerald-950/40 text-xs font-bold animate-in fade-in slide-in-from-bottom-2 duration-300">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
              </span>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="truncate">{planStatus.message}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
