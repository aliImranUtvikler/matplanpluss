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
import PreferencesAdminView from '../components/admin/PreferencesAdminView';
import type {
  InventoryItem,
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
import type { UserDashboardData } from '../services/db/userDatabaseService';
import {
  loadUserDashboard,
  saveUserDashboard,
  createDefaultUserDashboard,
  subscribeToHouseholdSync
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

  const googleButtonContainerRef = useRef<HTMLDivElement>(null);

  // 1. Initialiser autentisering ved oppstart
  useEffect(() => {
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

    return () => unsubscribe();
  }, []);

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
        const dashboard = await loadUserDashboard(currentUser.id);
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
  }, [currentUser?.id]);

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
  }, [currentUser]);

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
      name: customName.trim() || customEmail.split('@')[0]
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
                <div className="flex items-center gap-2">
                  <h1 className="text-base sm:text-lg font-black tracking-tight text-white leading-tight">
                    Matplan & Tilbuds-Radar
                  </h1>
                </div>
                <p className="text-[11px] text-slate-400 hidden sm:block">
                  100% Vegansk & Peanøttfri • Rute-radar for 7 kjeder
                </p>
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
                <span>1. Ukemeny</span>
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
                <span>2. Handle & Kart</span>
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
                <span>3. Kjøkkenskap</span>
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
                <span>4. Preferanser</span>
              </button>
            </nav>

            {/* Brukerprofil Chip & Hurtigknapp */}
            <div className="flex items-center gap-2">
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
          <span className="text-[10px]">Handle & Kart</span>
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
    </div>
  );
}
