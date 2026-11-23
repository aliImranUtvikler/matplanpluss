'use client';

import React, { useState } from 'react';
import {
  User,
  LogOut,
  SlidersHorizontal,
  MapPin,
  FileSpreadsheet,
  Download,
  Upload,
  RefreshCw,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Footprints,
  Bike,
  Car,
  Dumbbell,
  Flame,
  Wheat,
  Users,
  Send,
  Link as LinkIcon,
  Tag,
  Store,
  Layers,
  ArrowRight,
  ChefHat,
  Globe,
  Zap,
  Package,
  CheckSquare,
  Square,
  Edit3,
  ChevronDown,
  ChevronUp,
  Home,
  Heart,
  Copy,
  Check,
  UserPlus,
  Users2,
  Unlink,
  Clock
} from 'lucide-react';
import type {
  GoogleUserProfile
} from '../../services/auth/googleSsoService';
import {
  DEMO_GOOGLE_ACCOUNTS,
  signOutGoogleSession,
  switchDemoAccount
} from '../../services/auth/googleSsoService';
import type {
  UserDashboardData,
  UserDashboardLocation,
  UserDashboardHouseholdInfo
} from '../../services/db/userDatabaseService';
import {
  saveUserDashboard,
  linkAccountsToHousehold,
  linkAlexAndLunaHousehold,
  unlinkAccountFromHousehold,
  getHouseholdStatusForUser
} from '../../services/db/userDatabaseService';
import type {
  ChefModePreferences,
  CuisineStyle,
  UserMacroTargets
} from '../../types/contracts';
import { DEFAULT_CHEF_MODE_PREFERENCES } from '../../types/contracts';

interface PreferencesAdminViewProps {
  currentUser: GoogleUserProfile;
  dashboard: UserDashboardData;
  onDashboardUpdated: (updated: UserDashboardData) => void;
  onUserSwitched: (newUser: GoogleUserProfile) => void;
  onLoggedOut: () => void;
  className?: string;
}

const QUICK_LOCATIONS: Array<{ label: string; lat: number; lng: number }> = [
  { label: 'Thorvald Meyers gate 38, Grünerløkka, Oslo', lat: 59.9232, lng: 10.7583 },
  { label: 'Kirkeveien 64, Majorstuen, Oslo', lat: 59.9298, lng: 10.7143 },
  { label: 'Tøyengata 25, Tøyen, Oslo', lat: 59.9147, lng: 10.7766 },
  { label: 'Karl Johans gate 1, Oslo Sentrum', lat: 59.9139, lng: 10.7522 },
  { label: 'Problemveien 11, Blindern, Oslo', lat: 59.9385, lng: 10.7230 },
  { label: 'Torgallmenningen 1, Bergen Sentrum', lat: 60.3913, lng: 5.3221 },
  { label: 'Munkegata 1, Trondheim Midtbyen', lat: 63.4305, lng: 10.3951 }
];

export const CUISINE_OPTIONS: Array<{
  id: CuisineStyle;
  label: string;
  subtext: string;
  flagEmoji: string;
}> = [
  { id: 'ASIATISK', label: 'Asiatisk', subtext: 'Koreansk, Japansk, Thai & Ramen', flagEmoji: '🥢' },
  { id: 'INDISK', label: 'Indisk & Sør-Asiatisk', subtext: 'Dal, Tikka Masala, Curry & Basmati', flagEmoji: '🍛' },
  { id: 'MIDDELHAVS', label: 'Middelhavs & Italiensk', subtext: 'Kikertpasta, Soltørket Tomat & Urter', flagEmoji: '🍝' },
  { id: 'MIDTOSTEN', label: 'Midtøsten & Levantinsk', subtext: 'Shawarma, Kikerter & Hvitløks-Tahini', flagEmoji: '🧆' },
  { id: 'LATIN_AMERIKANSK', label: 'Latin-Amerikansk & Meksikansk', subtext: 'Svarte Bønner, Chipotle Tofu & Lime', flagEmoji: '🌮' }
];

export default function PreferencesAdminView({
  currentUser,
  dashboard,
  onDashboardUpdated,
  onUserSwitched,
  onLoggedOut,
  className = ''
}: PreferencesAdminViewProps) {
  // Lokale kopier av preferanser som kan redigeres
  const [macroTargets, setMacroTargets] = useState<UserMacroTargets>(dashboard.macroTargets);
  const [preferredLocation, setPreferredLocation] = useState<UserDashboardLocation>(dashboard.preferredLocation);
  const [chefModes, setChefModes] = useState<ChefModePreferences>(
    dashboard.chefModes || DEFAULT_CHEF_MODE_PREFERENCES
  );
  const [isCuisineAccordionOpen, setIsCuisineAccordionOpen] = useState<boolean>(
    dashboard.chefModes?.enableCuisineFilter ?? false
  );
  const [isCustomNotesAccordionOpen, setIsCustomNotesAccordionOpen] = useState<boolean>(
    dashboard.chefModes?.enableCustomNotes ?? false
  );
  // Hurtigpanel-tilstand for sekundære innstillinger (skjult som standard)
  const [activeQuickPanel, setActiveQuickPanel] = useState<'NONE' | 'ACCOUNT' | 'PARTNER' | 'LOCATION' | 'DATA'>('NONE');
  const [chefSaving, setChefSaving] = useState<boolean>(false);
  const [chefMessage, setChefMessage] = useState<string | null>(null);
  const [lastChefModesSavedAt, setLastChefModesSavedAt] = useState<string | null>(null);
  const [lastMacroSavedAt, setLastMacroSavedAt] = useState<string | null>(null);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedChef = localStorage.getItem('matplan_chef_modes_saved_at');
      if (savedChef) setLastChefModesSavedAt(savedChef);
      const savedMacro = localStorage.getItem('matplan_macro_saved_at');
      if (savedMacro) setLastMacroSavedAt(savedMacro);
    } else if (dashboard?.updatedAt) {
      try {
        const d = new Date(dashboard.updatedAt);
        const t = d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLastChefModesSavedAt(`I dag kl. ${t}`);
      } catch {}
    }
  }, [dashboard?.updatedAt]);

  // Felles husstand state
  const [partnerInput, setPartnerInput] = useState<string>('');
  const [householdLoading, setHouseholdLoading] = useState<boolean>(false);
  const [householdMessage, setHouseholdMessage] = useState<{ text: string; isError?: boolean } | null>(null);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  const [saving, setSaving] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // CSV & Google Sheets state
  const [sheetsUrl, setSheetsUrl] = useState<string>('');
  const [csvContent, setCsvContent] = useState<string>('');
  const [syncLoading, setSyncLoading] = useState<boolean>(false);
  const [syncMessage, setSyncMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  // AI Prompt generator
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [aiGenerating, setAiGenerating] = useState<boolean>(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);

  // Toggle for å skjule/vise test- og demoprofiler
  const [showDemoProfiles, setShowDemoProfiles] = useState<boolean>(false);

  // Lagre oppdaterte makromål og adresse til brukerens dashboard
  const handleSavePreferences = async (
    newMacros = macroTargets,
    newLoc = preferredLocation,
    newChefModes = chefModes
  ) => {
    setSaving(true);
    setSaveMessage(null);
    const startTime = Date.now();

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('matplan_plan_status', {
        detail: { state: 'working', message: 'Jobber med nye makromål & porsjoner...' }
      }));
    }

    try {
      const updatedData: UserDashboardData = {
        ...dashboard,
        macroTargets: newMacros,
        preferredLocation: newLoc,
        chefModes: newChefModes,
        updatedAt: new Date().toISOString()
      };

      const result = await saveUserDashboard(dashboard.userId, updatedData);

      // Minst 1100ms slik at brukeren rekker å se den oransje/gule spinner-boblen
      const elapsed = Date.now() - startTime;
      if (elapsed < 1100) {
        await new Promise((resolve) => setTimeout(resolve, 1100 - elapsed));
      }

      const now = new Date();
      const formattedTime = now.toLocaleTimeString('nb-NO', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      const stamp = `I dag kl. ${formattedTime}`;
      setLastMacroSavedAt(stamp);
      if (typeof window !== 'undefined') {
        localStorage.setItem('matplan_macro_saved_at', stamp);
      }

      onDashboardUpdated(result);
      setSaveMessage(`Preferanser og makromål er lagret! (kl. ${formattedTime})`);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('matplan_plan_status', {
          detail: {
            state: 'done',
            message: `Makromål oppdatert · kl. ${formattedTime}`,
            timestamp: formattedTime
          }
        }));
      }

      setTimeout(() => setSaveMessage(null), 3500);
    } catch (err) {
      setSaveMessage('Feil ved lagring: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  // Lagre kun kokkens moduser og oppdater ukeplan umiddelbart
  const handleSaveChefModes = async (newModes = chefModes) => {
    setChefSaving(true);
    setChefMessage(null);
    const startTime = Date.now();

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('matplan_plan_status', {
        detail: { state: 'working', message: 'Jobber med ny ukeplan & stil...' }
      }));
    }

    try {
      const updatedData: UserDashboardData = {
        ...dashboard,
        macroTargets,
        preferredLocation,
        chefModes: newModes,
        updatedAt: new Date().toISOString()
      };

      const result = await saveUserDashboard(dashboard.userId, updatedData);
      // Tøm gammel ukeplan-cache slik at MealPlanView rekalkulerer umiddelbart med de nye preferansene
      if (typeof window !== 'undefined') {
        localStorage.removeItem('user_mealplan');
      }

      // Minst 1100ms slik at brukeren rekker å se den oransje/gule spinner-boblen
      const elapsed = Date.now() - startTime;
      if (elapsed < 1100) {
        await new Promise((resolve) => setTimeout(resolve, 1100 - elapsed));
      }

      const now = new Date();
      const formattedTime = now.toLocaleTimeString('nb-NO', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      const stamp = `I dag kl. ${formattedTime}`;
      setLastChefModesSavedAt(stamp);
      if (typeof window !== 'undefined') {
        localStorage.setItem('matplan_chef_modes_saved_at', stamp);
      }

      onDashboardUpdated(result);
      setChefMessage(`Kokkens modus og oppskriftsstil er oppdatert! (kl. ${formattedTime})`);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('matplan_plan_status', {
          detail: {
            state: 'done',
            message: `Stil & ukeplan oppdatert · kl. ${formattedTime}`,
            timestamp: formattedTime
          }
        }));
      }

      setTimeout(() => setChefMessage(null), 4000);
    } catch (err) {
      setChefMessage('Feil ved lagring: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setChefSaving(false);
    }
  };

  // 1-klikks kontoveksler
  const handleSwitchAccount = (demoId: string) => {
    try {
      const session = switchDemoAccount(demoId);
      onUserSwitched(session.user);
    } catch (err) {
      alert('Kunne ikke bytte konto: ' + String(err));
    }
  };

  // 1-klikks partner-demo binding: Alex & Luna
  const handleLinkAlexLunaDemo = async () => {
    setHouseholdLoading(true);
    setHouseholdMessage(null);
    try {
      const updated = await linkAlexAndLunaHousehold(currentUser.id, currentUser.email);
      onDashboardUpdated(updated);
      setHouseholdMessage({
        text: '💑 Felles Husstand aktivert! Alex & Luna deler nå Single Source of Truth for kjøkkenskap, ukeplan og handleliste i sanntid.'
      });
      setTimeout(() => setHouseholdMessage(null), 5000);
    } catch (err) {
      setHouseholdMessage({
        text: 'Feil ved kobling: ' + (err instanceof Error ? err.message : String(err)),
        isError: true
      });
    } finally {
      setHouseholdLoading(false);
    }
  };

  // Koble til partner via e-post eller invitasjonskode
  const handleLinkPartner = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!partnerInput.trim()) {
      setHouseholdMessage({ text: 'Vennligst oppgi partnerens Google-epost eller invitasjonskode', isError: true });
      return;
    }
    setHouseholdLoading(true);
    setHouseholdMessage(null);
    try {
      const updated = await linkAccountsToHousehold(currentUser.id, currentUser.email, partnerInput.trim());
      onDashboardUpdated(updated);
      setPartnerInput('');
      setHouseholdMessage({ text: `🎉 Husstand tilkoblet! Du deler nå profil med ${partnerInput.trim()} i sanntid.` });
      setTimeout(() => setHouseholdMessage(null), 5000);
    } catch (err) {
      setHouseholdMessage({
        text: 'Feil ved tilkobling: ' + (err instanceof Error ? err.message : String(err)),
        isError: true
      });
    } finally {
      setHouseholdLoading(false);
    }
  };

  // Koble fra felles husstand
  const handleUnlinkHousehold = async () => {
    if (!confirm('Er du sikker på at du vil koble fra felles husstand? Du vil få din egen separate profil.')) return;
    setHouseholdLoading(true);
    setHouseholdMessage(null);
    try {
      const updated = await unlinkAccountFromHousehold(currentUser.id, currentUser.email);
      onDashboardUpdated(updated);
      setHouseholdMessage({ text: 'Kontoen er nå koblet fra husstanden og har sin egen profil.' });
      setTimeout(() => setHouseholdMessage(null), 4000);
    } catch (err) {
      setHouseholdMessage({
        text: 'Feil ved frakobling: ' + (err instanceof Error ? err.message : String(err)),
        isError: true
      });
    } finally {
      setHouseholdLoading(false);
    }
  };

  // Kopier invitasjonskode
  const handleCopyInviteCode = (code: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2500);
    }
  };

  // Google Sheets synkronisering
  const handleSyncSheets = async () => {
    if (!sheetsUrl.trim()) {
      setSyncMessage({ text: 'Oppgi en gyldig publisert Google Sheets CSV-lenke', isError: true });
      return;
    }
    setSyncLoading(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetsUrl: sheetsUrl.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Feil ved synkronisering');

      if (Array.isArray(data.items)) {
        const newStockMap: Record<string, boolean> = { ...dashboard.inventoryStockMap };
        for (const item of data.items) {
          newStockMap[item.id] = item.inStock;
        }
        await handleSavePreferences(macroTargets, preferredLocation);
      }
      setSyncMessage({ text: 'Inventar vellykket synkronisert fra Google Sheets!' });
    } catch (err) {
      setSyncMessage({
        text: err instanceof Error ? err.message : 'Uventet feil under synkronisering',
        isError: true
      });
    } finally {
      setSyncLoading(false);
    }
  };

  // Generer ny AI Ukeplan fra preferansesiden
  const handleGenerateAiPlan = async () => {
    setAiGenerating(true);
    setAiMessage(null);
    try {
      const res = await fetch('/api/mealplan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          forceRegenerate: true,
          servings: macroTargets.servings,
          customPrompt: customPrompt.trim() || undefined
        })
      });
      if (!res.ok) throw new Error('Kunne ikke generere ny ukeplan');
      const data = await res.json();
      if (data.mealPlan) {
        const updatedDashboard: UserDashboardData = {
          ...dashboard,
          customMealPlan: data.mealPlan
        };
        const saved = await saveUserDashboard(dashboard.userId, updatedDashboard);
        onDashboardUpdated(saved);
        setAiMessage('Ny AI-ukeplan er kalkulert og lagret i din profil!');
        setCustomPrompt('');
        setTimeout(() => setAiMessage(null), 3500);
      }
    } catch (err) {
      setAiMessage('Feil ved generering: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAiGenerating(false);
    }
  };

  return (
    <div className={`max-w-4xl mx-auto space-y-6 pb-12 ${className}`}>
      {/* 1. Topplinje med tittel */}
      <div className="pb-1">
        <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
          Preferanser & Administrasjon
        </h2>
        <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
          Kokkens modus, matstil og dine personlige makromål.
        </p>

        {/* 2. Rask tilgang: 4 venstre-kompakte ikon-knapper for konto, partner, lokasjon og CSV */}
        <div className="flex flex-wrap items-center gap-2 pt-3">
          <button
            type="button"
            onClick={() => setActiveQuickPanel(activeQuickPanel === 'ACCOUNT' ? 'NONE' : 'ACCOUNT')}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all min-h-[40px] border ${
              activeQuickPanel === 'ACCOUNT'
                ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300 shadow-sm'
                : 'bg-white/[0.03] border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <User className="w-3.5 h-3.5 text-emerald-400" />
            <span>Konto: {currentUser.givenName || currentUser.name.split(' ')[0]}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveQuickPanel(activeQuickPanel === 'PARTNER' ? 'NONE' : 'PARTNER')}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all min-h-[40px] border ${
              activeQuickPanel === 'PARTNER'
                ? 'bg-purple-950/80 border-purple-500 text-purple-300 shadow-sm'
                : 'bg-white/[0.03] border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <Users2 className="w-3.5 h-3.5 text-purple-400" />
            <span>{dashboard.household ? 'Husstand' : 'Partnerdeling'}</span>
            {dashboard.household && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveQuickPanel(activeQuickPanel === 'LOCATION' ? 'NONE' : 'LOCATION')}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all min-h-[40px] border ${
              activeQuickPanel === 'LOCATION'
                ? 'bg-sky-950/80 border-sky-500 text-sky-300 shadow-sm'
                : 'bg-white/[0.03] border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <MapPin className="w-3.5 h-3.5 text-sky-400" />
            <span>Lokasjon ({preferredLocation.label.split(',')[0].trim()})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveQuickPanel(activeQuickPanel === 'DATA' ? 'NONE' : 'DATA')}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all min-h-[40px] border ${
              activeQuickPanel === 'DATA'
                ? 'bg-amber-950/80 border-amber-500 text-amber-300 shadow-sm'
                : 'bg-white/[0.03] border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-amber-400" />
            <span>Data & CSV-synk</span>
          </button>
        </div>
      </div>

      {/* QUICK PANEL 1: KONTO */}
      {activeQuickPanel === 'ACCOUNT' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-3 animate-in fade-in duration-150">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2.5 min-w-0">
              {currentUser.pictureUrl ? (
                <img
                  src={currentUser.pictureUrl}
                  alt={currentUser.name}
                  className="w-10 h-10 rounded-full border border-emerald-500 object-cover shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-emerald-950 border border-emerald-500 flex items-center justify-center font-bold text-emerald-400 text-sm shrink-0">
                  {currentUser.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h3 className="font-extrabold text-sm sm:text-base text-white truncate">{currentUser.name}</h3>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" title="Aktiv innlogget profil" />
                </div>
                <p className="text-xs text-slate-400 truncate">{currentUser.email}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onLoggedOut}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-300 hover:text-white bg-rose-950/40 hover:bg-rose-900 border border-rose-800/40 transition-colors shrink-0 min-h-[36px]"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Logg ut</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveQuickPanel('NONE')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                title="Lukk panel"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowDemoProfiles(!showDemoProfiles)}
              className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors py-1 cursor-pointer"
            >
              <span>{showDemoProfiles ? 'Skjul testprofiler ▴' : 'Bytt til en test-/demoprofil ▾'}</span>
            </button>

            {showDemoProfiles && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                {DEMO_GOOGLE_ACCOUNTS.map((acc) => {
                  const isCurrent = currentUser.id === acc.id || currentUser.email === acc.email;
                  return (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => {
                        handleSwitchAccount(acc.id);
                        setActiveQuickPanel('NONE');
                      }}
                      className={`p-2.5 rounded-xl border text-left transition-all flex items-center gap-2 ${
                        isCurrent
                          ? 'bg-emerald-950/60 border-emerald-500'
                          : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.05]'
                      }`}
                    >
                      <img
                        src={acc.pictureUrl}
                        alt={acc.name}
                        className="w-7 h-7 rounded-full border border-slate-700 object-cover shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <span className="font-bold text-xs text-white block truncate">{acc.name}</span>
                        <span className="text-[10px] text-slate-400 block truncate">{acc.dietaryFocus}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* QUICK PANEL 2: PARTNERDELING */}
      {activeQuickPanel === 'PARTNER' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4 animate-in fade-in duration-150">
          <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <Users2 className="w-4 h-4 text-purple-400" />
              <h3 className="font-extrabold text-sm sm:text-base text-white">Felles Husstand & Partnerdeling</h3>
            </div>
            <button
              type="button"
              onClick={() => setActiveQuickPanel('NONE')}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
              title="Lukk panel"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>

          {dashboard.household ? (
            <div className="space-y-3">
              <div className="p-3.5 rounded-xl bg-slate-950 border border-purple-900/40 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-purple-400 block">
                      Aktiv Husstand
                    </span>
                    <h4 className="text-sm font-bold text-white">{dashboard.household.name}</h4>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono font-bold text-purple-300">
                      {dashboard.household.inviteCode}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyInviteCode(dashboard.household?.inviteCode || '')}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors text-xs flex items-center gap-1"
                      title="Kopier invitasjonskode"
                    >
                      {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {dashboard.household.memberEmails.map((email) => {
                    const isSelf = email.toLowerCase() === currentUser.email.toLowerCase();
                    return (
                      <span
                        key={email}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                          isSelf
                            ? 'bg-purple-950/70 border-purple-500/80 text-purple-200'
                            : 'bg-slate-900 border-slate-700 text-slate-300'
                        }`}
                      >
                        <User className="w-3 h-3 text-purple-400" />
                        <span>{email}</span>
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleUnlinkHousehold}
                  disabled={householdLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-800/60 bg-rose-950/40 hover:bg-rose-900 text-rose-300 hover:text-white text-xs font-semibold transition-all min-h-[38px] disabled:opacity-50"
                >
                  {householdLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
                  <span>Koble fra husstand</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <form onSubmit={handleLinkPartner} className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 block">
                  Koble sammen via Google-epost eller invitasjonskode:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={partnerInput}
                    onChange={(e) => setPartnerInput(e.target.value)}
                    placeholder="partner@epost.no eller kode"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 min-h-[40px]"
                  />
                  <button
                    type="submit"
                    disabled={householdLoading || !partnerInput.trim()}
                    className="flex items-center justify-center gap-1 px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all min-h-[40px] disabled:opacity-50"
                  >
                    {householdLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                    <span>Koble til</span>
                  </button>
                </div>
              </form>

              <div className="pt-2 flex items-center justify-between border-t border-white/[0.06]">
                <span className="text-[11px] text-slate-400">Test partner-synk med ett klikk:</span>
                <button
                  type="button"
                  onClick={handleLinkAlexLunaDemo}
                  disabled={householdLoading}
                  className="px-2.5 py-1 rounded-lg bg-purple-950/60 hover:bg-purple-900/80 border border-purple-800/60 text-purple-300 text-[11px] font-semibold transition-all min-h-[32px] flex items-center gap-1"
                >
                  <Users2 className="w-3 h-3 text-purple-400" />
                  <span>Koble Alex & Luna</span>
                </button>
              </div>
            </div>
          )}

          {householdMessage && (
            <div
              className={`p-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                householdMessage.isError
                  ? 'bg-rose-950/80 border border-rose-800 text-rose-300'
                  : 'bg-emerald-950/80 border border-emerald-800 text-emerald-300'
              }`}
            >
              <span>{householdMessage.text}</span>
            </div>
          )}
        </div>
      )}

      {/* QUICK PANEL 3: LOKASJON & REISE */}
      {activeQuickPanel === 'LOCATION' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-3 animate-in fade-in duration-150">
          <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-sky-400" />
              <h3 className="font-extrabold text-sm sm:text-base text-white">Standard Hjemmeadresse & Rute</h3>
            </div>
            <button
              type="button"
              onClick={() => setActiveQuickPanel('NONE')}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
              title="Lukk panel"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Aktiv adresse / nabolag:</label>
              <input
                type="text"
                value={preferredLocation.label}
                onChange={(e) => setPreferredLocation((prev) => ({ ...prev, label: e.target.value }))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 min-h-[44px]"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {QUICK_LOCATIONS.map((loc) => {
                const isSelected = preferredLocation.label === loc.label;
                return (
                  <button
                    key={loc.label}
                    type="button"
                    onClick={() => {
                      const updatedLoc: UserDashboardLocation = {
                        ...preferredLocation,
                        label: loc.label,
                        lat: loc.lat,
                        lng: loc.lng
                      };
                      setPreferredLocation(updatedLoc);
                      handleSavePreferences(macroTargets, updatedLoc);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all min-h-[36px] border ${
                      isSelected
                        ? 'bg-sky-950/80 border-sky-500 text-sky-300'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {loc.label.split(',')[0]}
                  </button>
                );
              })}
            </div>

            <div className="pt-1">
              <label className="text-xs font-semibold text-slate-300 block mb-1">Foretrukket reisemodus:</label>
              <div className="flex items-center gap-2">
                {(['WALKING', 'BICYCLING', 'DRIVING'] as const).map((mode) => {
                  const isCurrent = preferredLocation.travelMode === mode;
                  const label = mode === 'WALKING' ? 'Gange' : mode === 'BICYCLING' ? 'Sykkel' : 'Bil';
                  const Icon = mode === 'WALKING' ? Footprints : mode === 'BICYCLING' ? Bike : Car;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        const updatedLoc = { ...preferredLocation, travelMode: mode };
                        setPreferredLocation(updatedLoc);
                        handleSavePreferences(macroTargets, updatedLoc);
                      }}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all min-h-[40px] border ${
                        isCurrent
                          ? 'bg-emerald-600 text-white border-emerald-500 shadow-md'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QUICK PANEL 4: DATA, CSV & AI */}
      {activeQuickPanel === 'DATA' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4 animate-in fade-in duration-150">
          <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-amber-400" />
              <h3 className="font-extrabold text-sm sm:text-base text-white">Datakilder, CSV & AI Ukeplan</h3>
            </div>
            <button
              type="button"
              onClick={() => setActiveQuickPanel('NONE')}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
              title="Lukk panel"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <span className="text-xs font-semibold text-slate-300 block mb-1">
                Toveis synk med Google Sheets (CSV):
              </span>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="url"
                  value={sheetsUrl}
                  onChange={(e) => setSheetsUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?output=csv"
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 min-h-[40px]"
                />
                <button
                  type="button"
                  onClick={handleSyncSheets}
                  disabled={syncLoading || !sheetsUrl}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition-all min-h-[40px] disabled:opacity-50"
                >
                  {syncLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  <span>Importer CSV</span>
                </button>
              </div>
              {syncMessage && (
                <p className={`text-xs font-semibold mt-1.5 ${syncMessage.isError ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {syncMessage.text}
                </p>
              )}
            </div>

            <div className="pt-2 border-t border-white/[0.06]">
              <span className="text-xs font-semibold text-slate-300 block mb-1">
                Generer ukeplan med Gemini 2.5 Flash:
              </span>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Valgfri instruks til AI-kokken..."
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 min-h-[40px]"
                />
                <button
                  type="button"
                  onClick={handleGenerateAiPlan}
                  disabled={aiGenerating}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all min-h-[40px] disabled:opacity-50"
                >
                  {aiGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  <span>Kalkuler Plan</span>
                </button>
              </div>
              {aiMessage && <p className="text-xs font-bold text-emerald-400 mt-1">{aiMessage}</p>}
            </div>

            <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <Tag className="w-3.5 h-3.5 text-amber-400" />
                <span>87 tilbud skannet (Uke 47)</span>
              </span>
              <span className="text-emerald-400 font-bold">Radar Aktiv</span>
            </div>
          </div>
        </div>
      )}

      {/* SEKSJON 3: KOKKENS MODUS & OPPSKRIFTSSTIL (UU & iPhone HIG Spesifikasjon) */}
      <div className="bg-transparent sm:bg-slate-900 border-0 sm:border border-slate-800 rounded-none sm:rounded-2xl p-0 sm:p-5 shadow-none sm:shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-950 border border-emerald-800/80 text-emerald-400">
              <ChefHat className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-white">Kokkens Modus & Oppskriftsstil</h3>
              <p className="text-xs text-slate-400">
                Styrer hvordan oppskriftene komponeres og prioriteres i din ukeplan.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-950 border border-slate-800 text-[11px] font-bold text-emerald-400">
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI & Deterministisk</span>
          </div>
        </div>

        {/* Flervalg: Modus-sjekkbokser (48pt touch targets for iPhone) */}
        <div className="space-y-2.5">
          {/* 1. Tilbuds-fokus (Maksimal kundeavis-sparing) */}
          <button
            type="button"
            onClick={() => {
              const updated = { ...chefModes, focusOffers: !chefModes.focusOffers };
              setChefModes(updated);
            }}
            className={`w-full p-3.5 rounded-xl border text-left transition-all min-h-[48px] flex items-center justify-between gap-3 ${
              chefModes.focusOffers
                ? 'bg-emerald-950/40 border-emerald-500/70 text-white'
                : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="text-xl">🏷️</div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs sm:text-sm font-bold block">100% Tilbuds-fokus (Kundeavis-kupp)</span>
                  {chefModes.focusOffers && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-700 text-[10px] font-bold text-emerald-300">
                      Maksimal sparing
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-slate-400 block">
                  Bygger oppskriftene utelukkende (eller så godt det lar seg gjøre) av råvarer som er på tilbud denne uken (f.eks. Jasminris -50%, Norske poteter, brokkoli, rotmiks, spinat)!
                </span>
              </div>
            </div>
            <div className="shrink-0 text-emerald-400">
              {chefModes.focusOffers ? (
                <CheckSquare className="w-5 h-5" />
              ) : (
                <Square className="w-5 h-5 text-slate-600" />
              )}
            </div>
          </button>

          {/* 2. Tøm skapet først */}
          <button
            type="button"
            onClick={() => {
              const updated = { ...chefModes, prioritizePantry: !chefModes.prioritizePantry };
              setChefModes(updated);
            }}
            className={`w-full p-3.5 rounded-xl border text-left transition-all min-h-[48px] flex items-center justify-between gap-3 ${
              chefModes.prioritizePantry
                ? 'bg-emerald-950/40 border-emerald-500/70 text-white'
                : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="text-xl">🥫</div>
              <div>
                <span className="text-xs sm:text-sm font-bold block">Tøm skapet først</span>
                <span className="text-[11px] text-slate-400 block">
                  Prioriter varer vi allerede har markert &apos;På lager&apos; i kjøkkenskapet
                </span>
              </div>
            </div>
            <div className="shrink-0 text-emerald-400">
              {chefModes.prioritizePantry ? (
                <CheckSquare className="w-5 h-5" />
              ) : (
                <Square className="w-5 h-5 text-slate-600" />
              )}
            </div>
          </button>

          {/* 3. Rask hverdag (Maks 20 min) */}
          <button
            type="button"
            onClick={() => {
              const updated = { ...chefModes, quickMealsOnly: !chefModes.quickMealsOnly };
              setChefModes(updated);
            }}
            className={`w-full p-3.5 rounded-xl border text-left transition-all min-h-[48px] flex items-center justify-between gap-3 ${
              chefModes.quickMealsOnly
                ? 'bg-amber-950/40 border-amber-500/70 text-white'
                : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="text-xl">⚡</div>
              <div>
                <span className="text-xs sm:text-sm font-bold block">Rask hverdag (Maks 20 min)</span>
                <span className="text-[11px] text-slate-400 block">
                  Enkle, lynraske oppskrifter etter lange dager eller kveldstreningsøkter
                </span>
              </div>
            </div>
            <div className="shrink-0 text-amber-400">
              {chefModes.quickMealsOnly ? (
                <CheckSquare className="w-5 h-5" />
              ) : (
                <Square className="w-5 h-5 text-slate-600" />
              )}
            </div>
          </button>

          {/* 4. Oppskriftsstil & Landfokus: Valg mellom 100% Nøytral (Stats & Tilbud) og Spesifikke Verdensdeler */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-3">
            <div>
              <h4 className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                <span>🌍</span>
                <span>Matstil: 100% Nøytral (Stats & Tilbud) vs Etniske Land</span>
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Standard er 100% Nøytral meny. Du trenger ALDRI å velge et land – oppskriftene komponeres rent ut fra dine makrostats og ukens tilbudsvarer.
              </p>
            </div>

            {/* To primærvalg: Nøytral vs Spesifiserte land */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Valg 1: NØYTRAL (Ingen landfokus) */}
              <button
                type="button"
                onClick={() => {
                  setChefModes(prev => ({
                    ...prev,
                    enableCuisineFilter: false
                  }));
                }}
                className={`p-3 rounded-xl border text-left transition-all min-h-[56px] flex flex-col justify-between gap-1.5 ${
                  !chefModes.enableCuisineFilter
                    ? 'bg-emerald-950/70 border-emerald-500 text-white shadow-md shadow-emerald-950/40'
                    : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🌍</span>
                    <span className="text-xs sm:text-sm font-bold text-white">
                      100% Nøytral (Stats & Tilbud)
                    </span>
                  </div>
                  <div className="shrink-0 text-emerald-400">
                    {!chefModes.enableCuisineFilter ? (
                      <CheckSquare className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <Square className="w-5 h-5 text-slate-600" />
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-slate-300 leading-relaxed">
                  Ingen land eller etniske temaer. Menyen velges 100 % nøytralt basert på makrostats, næring, skapstatus og ukens tilbud (Jasminris, poteter, brokkoli, rotmiks, bønner).
                </p>
              </button>

              {/* Valg 2: SPESIFISERTE VERDENSDELER */}
              <button
                type="button"
                onClick={() => {
                  setChefModes(prev => ({
                    ...prev,
                    enableCuisineFilter: true,
                    selectedCuisines: prev.selectedCuisines.length > 0 ? prev.selectedCuisines : ['ASIATISK', 'INDISK']
                  }));
                }}
                className={`p-3 rounded-xl border text-left transition-all min-h-[56px] flex flex-col justify-between gap-1.5 ${
                  chefModes.enableCuisineFilter
                    ? 'bg-emerald-950/70 border-emerald-500 text-white shadow-md shadow-emerald-950/40'
                    : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🌏</span>
                    <span className="text-xs sm:text-sm font-bold text-white">
                      Spesifiser Verdensdel (Valgfritt)
                    </span>
                  </div>
                  <div className="shrink-0 text-emerald-400">
                    {chefModes.enableCuisineFilter ? (
                      <CheckSquare className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <Square className="w-5 h-5 text-slate-600" />
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-slate-300 leading-relaxed">
                  Valgfritt for spesielt interesserte. Begrens menyen til utvalgte internasjonale kjøkken (f.eks. kun Asiatisk eller Indisk).
                </p>
              </button>
            </div>

            {/* Hvis Spesifiser Verdensdel er valgt: Vis flervalgsboksene */}
            {chefModes.enableCuisineFilter && (
              <div className="pt-2.5 border-t border-slate-800/80 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">
                    Kryss av for de verdensdelene du vil inkludere i menyen:
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-emerald-300">
                    {chefModes.selectedCuisines.length} av 5 valgt
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {CUISINE_OPTIONS.map((style) => {
                    const isSelected = chefModes.selectedCuisines.includes(style.id);
                    return (
                      <button
                        key={style.id}
                        type="button"
                        onClick={() => {
                          let updatedList: CuisineStyle[];
                          if (isSelected) {
                            // Hvis brukeren fjerner den siste, gå automatisk over til Nøytral uten feil
                            updatedList = chefModes.selectedCuisines.filter(c => c !== style.id);
                            if (updatedList.length === 0) {
                              setChefModes(prev => ({
                                ...prev,
                                enableCuisineFilter: false,
                                selectedCuisines: []
                              }));
                              return;
                            }
                          } else {
                            updatedList = [...chefModes.selectedCuisines, style.id];
                          }
                          setChefModes(prev => ({
                            ...prev,
                            selectedCuisines: updatedList,
                            enableCuisineFilter: true
                          }));
                        }}
                        className={`p-2.5 rounded-xl border text-left transition-all min-h-[44px] flex items-center justify-between gap-2 ${
                          isSelected
                            ? 'bg-emerald-950/60 border-emerald-500/80 text-white shadow-sm'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-base shrink-0">{style.flagEmoji}</span>
                          <div className="min-w-0">
                            <span className="font-bold text-xs block truncate">{style.label}</span>
                            <span className="text-[10px] text-slate-400 block truncate">{style.subtext}</span>
                          </div>
                        </div>
                        <div className="shrink-0 text-emerald-400">
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-600" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 5. Annet (Eget ønske) (Trekkspill med 16px Safari-Safe Input) */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 overflow-hidden">
            <button
              type="button"
              onClick={() => {
                const nextOpen = !isCustomNotesAccordionOpen;
                setIsCustomNotesAccordionOpen(nextOpen);
                setChefModes(prev => ({ ...prev, enableCustomNotes: nextOpen }));
              }}
              className="w-full p-3.5 text-left transition-all min-h-[48px] flex items-center justify-between gap-3 hover:bg-slate-800/30"
            >
              <div className="flex items-center gap-3">
                <div className="text-xl">✍️</div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs sm:text-sm font-bold text-white">Annet (Eget ønske til kokken)</span>
                    {chefModes.customNotes && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-800 text-[10px] font-bold text-emerald-400">
                        Aktivt ønske
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400 block">
                    Spesielle ønsker, favorittingredienser eller retter du har lyst på
                  </span>
                </div>
              </div>
              <div className="shrink-0 text-slate-400 p-1">
                {isCustomNotesAccordionOpen ? (
                  <ChevronUp className="w-5 h-5 text-emerald-400" />
                ) : (
                  <ChevronDown className="w-5 h-5" />
                )}
              </div>
            </button>

            {isCustomNotesAccordionOpen && (
              <div className="p-3.5 pt-0 border-t border-slate-800/80 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    Skriv inn instruksjoner til oppskriftene (f.eks. &quot;Lag gjerne en kremet ramen en av dagene, unngå sopp&quot;):
                  </label>
                  <textarea
                    rows={2}
                    value={chefModes.customNotes}
                    onChange={(e) => {
                      const val = e.target.value;
                      setChefModes(prev => ({
                        ...prev,
                        customNotes: val,
                        enableCustomNotes: true
                      }));
                    }}
                    placeholder="F.eks. lag en fyldig ramen-suppe, ekstra chili & lime, eller batch-vennlig for lunsj..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-base text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 min-h-[52px]"
                  />
                </div>

                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {[
                    'Kremet ramen-suppe',
                    'Mye fersk chili & lime',
                    'Ekstra sprø tofu & tempeh',
                    'Batch-vennlig for matpakke',
                    'Uten sopp'
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        const newNotes = chefModes.customNotes
                          ? `${chefModes.customNotes}, ${chip}`
                          : chip;
                        setChefModes(prev => ({
                          ...prev,
                          customNotes: newNotes,
                          enableCustomNotes: true
                        }));
                      }}
                      className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 hover:text-white transition-colors min-h-[36px]"
                    >
                      + {chip}
                    </button>
                  ))}
                  {chefModes.customNotes && (
                    <button
                      type="button"
                      onClick={() => {
                        setChefModes(prev => ({ ...prev, customNotes: '', enableCustomNotes: false }));
                      }}
                      className="px-2.5 py-1 rounded-lg bg-rose-950/50 hover:bg-rose-900/60 border border-rose-800/60 text-[11px] text-rose-300 transition-colors min-h-[36px]"
                    >
                      Tøm felt
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Handlingsknapp for Kokkens Modus */}
        <div className="pt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-800/80">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs text-slate-400">
            {lastChefModesSavedAt && (
              <span className="flex items-center gap-1.5 text-slate-300">
                <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span>Sist endret: <strong className="text-white font-semibold">{lastChefModesSavedAt}</strong></span>
              </span>
            )}
            {chefMessage && (
              <span className="text-emerald-400 font-bold flex items-center gap-1.5 sm:ml-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {chefMessage}
              </span>
            )}
            {!lastChefModesSavedAt && !chefMessage && (
              <span>Ukeplanen tilpasser seg umiddelbart når du lagrer.</span>
            )}
          </div>

          <button
            type="button"
            onClick={() => handleSaveChefModes()}
            disabled={chefSaving}
            className={`flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-xs font-bold transition-all min-h-[48px] disabled:opacity-80 ${
              chefSaving
                ? 'bg-amber-600/90 text-white shadow-lg shadow-amber-600/30 ring-1 ring-amber-400'
                : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-600/30'
            }`}
          >
            {chefSaving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-white" />
                <span>⏳ Oppdaterer oppskrifter & rute...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Lagre Stil & Oppdater Ukeplan</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* SEKSJON 4: PERSONLIGE MAKROMÅL */}
      <div className="bg-transparent sm:bg-slate-900 border-0 sm:border border-slate-800 rounded-none sm:rounded-2xl p-0 sm:p-5 shadow-none sm:shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-950 border border-emerald-800/80 text-emerald-400">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-white">Personlige Ernærings- & Makromål</h3>
              <p className="text-xs text-slate-400">
                Styrer den matematiske porsjonsskaleringen av alle ukens middagsretter.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-800 text-[11px] font-bold text-emerald-300">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>100% Peanøttfri Garanti</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
          {/* Protein */}
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-emerald-400 flex items-center gap-1">
                <Dumbbell className="w-3.5 h-3.5" />
                Protein per person
              </span>
              <span className="font-extrabold text-white text-sm">
                {macroTargets.minProteinGrams}–{macroTargets.maxProteinGrams}g
              </span>
            </div>
            <input
              type="range"
              min="30"
              max="70"
              step="5"
              value={macroTargets.minProteinGrams}
              onChange={(e) => {
                const min = parseInt(e.target.value, 10);
                setMacroTargets((prev) => ({
                  ...prev,
                  minProteinGrams: min,
                  maxProteinGrams: min + 10
                }));
              }}
              className="w-full accent-emerald-500 cursor-pointer h-2 bg-slate-800 rounded-lg min-h-[44px]"
            />
          </div>

          {/* Kalorier */}
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-amber-400 flex items-center gap-1">
                <Flame className="w-3.5 h-3.5" />
                Maks Kalorier
              </span>
              <span className="font-extrabold text-white text-sm">
                {macroTargets.maxKcal} kcal
              </span>
            </div>
            <input
              type="range"
              min="550"
              max="1100"
              step="25"
              value={macroTargets.maxKcal}
              onChange={(e) =>
                setMacroTargets((prev) => ({
                  ...prev,
                  maxKcal: parseInt(e.target.value, 10)
                }))
              }
              className="w-full accent-amber-500 cursor-pointer h-2 bg-slate-800 rounded-lg min-h-[44px]"
            />
          </div>

          {/* Karbobase */}
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-sky-400 flex items-center gap-1">
                <Wheat className="w-3.5 h-3.5" />
                Karbobase Tørrvekt
              </span>
              <span className="font-extrabold text-white text-sm">
                {macroTargets.targetCarbDryWeightGrams}g
              </span>
            </div>
            <input
              type="range"
              min="50"
              max="130"
              step="5"
              value={macroTargets.targetCarbDryWeightGrams}
              onChange={(e) =>
                setMacroTargets((prev) => ({
                  ...prev,
                  targetCarbDryWeightGrams: parseInt(e.target.value, 10)
                }))
              }
              className="w-full accent-sky-500 cursor-pointer h-2 bg-slate-800 rounded-lg min-h-[44px]"
            />
          </div>

          {/* Porsjoner */}
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-purple-400 flex items-center gap-1">
                <Users className="w-3.5 h-3.5" />
                Porsjoner
              </span>
              <span className="font-extrabold text-white text-sm">
                {macroTargets.servings} pers
              </span>
            </div>
            <div className="flex items-center gap-1 pt-1">
              {[1, 2, 3, 4].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() =>
                    setMacroTargets((prev) => ({ ...prev, servings: num }))
                  }
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all min-h-[44px] ${
                    macroTargets.servings === num
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs text-slate-400">
            {lastMacroSavedAt && (
              <span className="flex items-center gap-1.5 text-slate-300">
                <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span>Sist endret: <strong className="text-white font-semibold">{lastMacroSavedAt}</strong></span>
              </span>
            )}
            {saveMessage && (
              <span className="text-emerald-400 font-bold flex items-center gap-1.5 sm:ml-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {saveMessage}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => handleSavePreferences()}
            disabled={saving}
            className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all min-h-[48px] disabled:opacity-80 ${
              saving
                ? 'bg-amber-600/90 text-white shadow-lg shadow-amber-600/30 ring-1 ring-amber-400'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30'
            }`}
          >
            {saving ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
                <span>⏳ Oppdaterer makromål & rute...</span>
              </>
            ) : (
              <span>Lagre Makromål & Oppdater</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
