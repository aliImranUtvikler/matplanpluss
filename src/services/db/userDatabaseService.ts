/**
 * USER DATABASE SERVICE (100% Browser-kompatibel TypeScript)
 * ==========================================================
 * Håndterer isolert per-bruker persistens og Felles Husstand («Del med partner / Shared Household»)
 * for Google SSO-brukere.
 * 
 * Arkitektur:
 * 1. Hybrid 3-lags modell:
 *    - Lag 1: Synkron Browser-cache (localStorage med per-bruker og felles husstands-navnerom)
 *             Gir 0 ms latency ved konto-bytte og full offline-støtte.
 *    - Lag 2: Sky-database (Supabase REST API med Row-Level Security for households og dashboards)
 *             Benyttes ved produksjon på GitHub Pages uten å eksponere hemmelige nøkler.
 *    - Lag 3: Lokal Next.js API-fallback (/api/user-dashboard -> data/users/<userId>.json & data/households/<id>.json)
 *             Benyttes ved lokal utvikling og Node-server.
 * 
 * 2. Felles Husstand / Del med partner:
 *    - To eller flere Google-kontoer kan kobles sammen via felles husstandskode eller e-post.
 *    - Begge parter deler samme "Single Source of Truth" for makromål, kjøkkenskap og handleliste.
 *    - Sanntids cross-tab og cross-window synkronisering via BroadcastChannel('matplan_household_sync')
 *      og storage events.
 * 
 * 3. 100% Browser-Safe:
 *    - Ingen Node.js fs-avhengigheter, kan kjøre direkte i klientkomponenter på GitHub Pages.
 */

import type {
  ChefModePreferences,
  InventoryItem,
  UserMacroTargets,
  WeeklyMealPlanResponse
} from '@/types/contracts';
import { DEFAULT_CHEF_MODE_PREFERENCES } from '@/types/contracts';

// ============================================================================
// 1. TYPER & KONTRAKTER FOR PER-BRUKER & FELLES HUSSTAND DASHBOARD
// ============================================================================

export interface UserDashboardLocation {
  label: string;
  lat: number;
  lng: number;
  travelMode: 'WALKING' | 'BICYCLING' | 'DRIVING';
}

export interface UserDashboardHouseholdInfo {
  /** Unik ID for felles husstand (f.eks. 'household_alex_luna' eller 'house_xyz123') */
  householdId: string;
  /** Navn på husstanden, f.eks. "Alex & Luna (Felles Husstand)" */
  name: string;
  /** Delbar invitasjonskode, f.eks. "HUS-ALILUNA" eller "MAT-8842" */
  inviteCode: string;
  /** E-postadresser til alle tilkoblede Google-kontoer */
  memberEmails: string[];
  /** Bruker-ID-er til alle tilkoblede kontoer */
  memberUserIds?: string[];
  /** Hvem som sist gjorde en endring i felles preferanser/kjøkkenskap */
  updatedByEmail?: string;
  /** Tidspunkt husstanden ble opprettet */
  createdAt?: string;
}

export interface UserDashboardData {
  /** Unik ID for brukeren (fra Google SSO sub/uid eller demo-ID) */
  userId: string;
  /** Brukerens e-postadresse */
  email: string;
  /** Visningsnavn */
  displayName: string;
  /** Tidspunkt for siste oppdatering (ISO 8601 UTC) */
  updatedAt: string;
  /** Brukerens personlige makromål */
  macroTargets: UserMacroTargets;
  /** Brukerens personlige lagerstatus (map fra vare-id til inStock boolean) */
  inventoryStockMap: Record<string, boolean>;
  /** Brukerens lagrede hjemmeadresse / foretrukket lokasjon på kartet */
  preferredLocation: UserDashboardLocation;
  /** Avkryssede varer på ukens handleliste */
  checkedShoppingItemIds: string[];
  /** Kokkens modus og oppskriftsstil-preferanser */
  chefModes?: ChefModePreferences;
  /** Brukerens personlige ukeplan hvis tilpasset */
  customMealPlan?: WeeklyMealPlanResponse;
  /** Informasjon om felles husstand dersom kontoen er koblet med partner/familie */
  household?: UserDashboardHouseholdInfo;
}

export interface DemoUserProfile {
  id: string;
  email: string;
  displayName: string;
  roleDescription: string;
  defaultData: UserDashboardData;
}

// ============================================================================
// 2. KONSTANTER & LAGRINGSNØKLER
// ============================================================================

export const STORAGE_PREFIX = 'matplan_dashboard_v1_';
export const HOUSEHOLD_LINKS_KEY = 'matplan_household_links_v1';
export const HOUSEHOLD_DATA_PREFIX = 'matplan_household_shared_v1_';
export const HOUSEHOLD_CODES_KEY = 'matplan_household_codes_v1';
export const HOUSEHOLD_SYNC_CHANNEL = 'matplan_household_sync';
export const HOUSEHOLD_LOCAL_EVENT = 'matplan_household_local_sync';

// ============================================================================
// 3. FORHÅNDSKONFIGURERTE DEMO-BRUKERE & MALER
// ============================================================================

export const DEMO_USERS: Record<string, DemoUserProfile> = {
  styrke_majorstuen: {
    id: 'demo_styrke_majorstuen',
    email: 'styrke@demo.no',
    displayName: 'Lars (Styrke & Sykkel)',
    roleDescription: 'Tung styrketrening, 55–65g protein, 920 kcal, sykkelpendler på Majorstuen',
    defaultData: {
      userId: 'demo_styrke_majorstuen',
      email: 'styrke@demo.no',
      displayName: 'Lars (Styrke & Sykkel)',
      updatedAt: '2026-11-15T20:00:00.000Z',
      macroTargets: {
        minProteinGrams: 55,
        maxProteinGrams: 65,
        maxKcal: 920,
        targetCarbDryWeightGrams: 100,
        servings: 2,
        minPlantCount: 7,
        dietaryNote: 'Høyprotein for tung styrketrening og sykkelpendling'
      },
      inventoryStockMap: {
        'fast-tofu': true,
        'hvite-bonner': true,
        'havregryn': true,
        'chiafro': true,
        'olivenolje': true,
        'soyasause': true,
        'hvitlok': true,
        'ingefaer': true,
        'quinoa': true,
        'rode-linser': false,
        'edamame': false,
        'peanottsmor': false
      },
      preferredLocation: {
        label: 'Kirkeveien 64, Majorstuen, Oslo',
        lat: 59.9298,
        lng: 10.7138,
        travelMode: 'BICYCLING'
      },
      checkedShoppingItemIds: ['tofu-extra-majorstuen', 'chiafro-rema'],
      chefModes: {
        focusOffers: true,
        prioritizePantry: true,
        quickMealsOnly: false,
        enableCuisineFilter: true,
        selectedCuisines: ['ASIATISK', 'INDISK', 'MIDDELHAVS'],
        enableCustomNotes: false,
        customNotes: ''
      }
    }
  },

  standard_grunerlokka: {
    id: 'demo_standard_grunerlokka',
    email: 'grunerlokka@demo.no',
    displayName: 'Nora (Balansert & Gange)',
    roleDescription: 'Optimal gut health, 40–50g protein, 750 kcal, handler til fots på Grünerløkka',
    defaultData: {
      userId: 'demo_standard_grunerlokka',
      email: 'grunerlokka@demo.no',
      displayName: 'Nora (Balansert & Gange)',
      updatedAt: '2026-11-15T20:00:00.000Z',
      macroTargets: {
        minProteinGrams: 42,
        maxProteinGrams: 50,
        maxKcal: 760,
        targetCarbDryWeightGrams: 80,
        servings: 2,
        minPlantCount: 6,
        dietaryNote: 'Balansert plantekost, fermentert mat & gut health'
      },
      inventoryStockMap: {
        'rode-linser': true,
        'brune-linser': true,
        'kikerter': true,
        'jasminris': true,
        'kokosmelk': true,
        'tomatpure': true,
        'gulrot': true,
        'lok': true,
        'fast-tofu': false,
        'tempeh': false
      },
      preferredLocation: {
        label: 'Thorvald Meyers gate 38, Grünerløkka, Oslo',
        lat: 59.9228,
        lng: 10.7583,
        travelMode: 'WALKING'
      },
      checkedShoppingItemIds: [],
      chefModes: {
        focusOffers: true,
        prioritizePantry: true,
        quickMealsOnly: false,
        enableCuisineFilter: false,
        selectedCuisines: ['ASIATISK', 'INDISK', 'MIDDELHAVS', 'MIDTOSTEN', 'LATIN_AMERIKANSK'],
        enableCustomNotes: false,
        customNotes: ''
      }
    }
  },

  student_blindern: {
    id: 'demo_student_blindern',
    email: 'student@demo.no',
    displayName: 'Jonas (Budsjett & Student)',
    roleDescription: 'Studentøkonomi, 38–46g protein, 720 kcal, handler på KIWI/Extra ved Blindern',
    defaultData: {
      userId: 'demo_student_blindern',
      email: 'student@demo.no',
      displayName: 'Jonas (Budsjett & Student)',
      updatedAt: '2026-11-15T20:00:00.000Z',
      macroTargets: {
        minProteinGrams: 38,
        maxProteinGrams: 46,
        maxKcal: 720,
        targetCarbDryWeightGrams: 75,
        servings: 2,
        minPlantCount: 5,
        dietaryNote: 'Maksimal besparelse og enkle batch-retter'
      },
      inventoryStockMap: {
        'havregryn': true,
        'kikerter': true,
        'hvite-bonner': true,
        'jasminris': true,
        'frosne-erter': true,
        'fast-tofu': false,
        'spinat': false
      },
      preferredLocation: {
        label: 'Problemveien 11, Blindern, Oslo',
        lat: 59.9385,
        lng: 10.7230,
        travelMode: 'WALKING'
      },
      checkedShoppingItemIds: ['kikerter-coop-prisbasker'],
      chefModes: {
        focusOffers: true,
        prioritizePantry: true,
        quickMealsOnly: true,
        enableCuisineFilter: false,
        selectedCuisines: ['ASIATISK', 'INDISK', 'MIDDELHAVS', 'MIDTOSTEN', 'LATIN_AMERIKANSK'],
        enableCustomNotes: true,
        customNotes: 'Maks studentøkonomi, batch-vennlig og raskt å lage!'
      }
    }
  }
};

// ============================================================================
// 4. HJELPEFUNKSJONER FOR NAVNEROM & KONTOER
// ============================================================================

export function getUserDashboardStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

export function getHouseholdStorageKey(householdId: string): string {
  return `${HOUSEHOLD_DATA_PREFIX}${householdId}`;
}

export function getAllKnownDemoUsers(): DemoUserProfile[] {
  return Object.values(DEMO_USERS);
}

/**
 * Renser en streng for bruk som lookup-nøkkel
 */
function cleanIdentifier(idOrEmail: string): string {
  return idOrEmail.trim().toLowerCase();
}

/**
 * Henter koblingskartet for alle registrerte husstander
 */
function getHouseholdLinksMap(): Record<string, string> {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(HOUSEHOLD_LINKS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Lagrer koblingskartet for alle registrerte husstander
 */
function saveHouseholdLinksMap(links: Record<string, string>): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(HOUSEHOLD_LINKS_KEY, JSON.stringify(links));
  } catch {
    // Ignorer lagringsfeil
  }
}

/**
 * Finner eventuell husstands-ID tilknyttet en bruker (via userId eller email)
 */
export function getLinkedHouseholdId(userId: string, email?: string): string | null {
  const links = getHouseholdLinksMap();
  if (userId && links[cleanIdentifier(userId)]) {
    return links[cleanIdentifier(userId)];
  }
  if (email && links[cleanIdentifier(email)]) {
    return links[cleanIdentifier(email)];
  }
  return null;
}

/**
 * Returnerer et standard dashboard for nye Google SSO-brukere som ikke er demo-brukere.
 */
export function createDefaultUserDashboard(
  userId: string,
  email: string = '',
  displayName: string = 'Innlogget Bruker',
  defaultInventory: InventoryItem[] = []
): UserDashboardData {
  // Sjekk om det matcher en kjent demo-profil
  for (const profile of Object.values(DEMO_USERS)) {
    const pEmail = profile.email.toLowerCase();
    const reqEmail = email.toLowerCase();
    const isAlex = profile.id === 'demo_styrke_majorstuen' && (reqEmail.includes('alex') || reqEmail.includes('styrke'));
    const isLuna = profile.id === 'demo_standard_grunerlokka' && (reqEmail.includes('luna') || reqEmail.includes('grunerlokka'));
    const isBerg = profile.id === 'demo_student_blindern' && (reqEmail.includes('berg') || reqEmail.includes('student'));

    if (profile.id === userId || pEmail === reqEmail || isAlex || isLuna || isBerg) {
      return {
        ...profile.defaultData,
        userId,
        email: email || profile.email,
        displayName: displayName || profile.displayName,
        updatedAt: new Date().toISOString()
      };
    }
  }

  // Bygg innledende lagerstatus basert på standard inventarliste hvis oppgitt
  const initialStockMap: Record<string, boolean> = {};
  if (defaultInventory && defaultInventory.length > 0) {
    for (const item of defaultInventory) {
      initialStockMap[item.id] = item.inStock;
    }
  }

  return {
    userId,
    email: email || `${userId}@google-user.local`,
    displayName: displayName || 'Min Matplan-Konto',
    updatedAt: new Date().toISOString(),
    macroTargets: {
      minProteinGrams: 42,
      maxProteinGrams: 52,
      maxKcal: 780,
      targetCarbDryWeightGrams: 80,
      servings: 2,
      minPlantCount: 6,
      dietaryNote: 'Min personlige matplan'
    },
    inventoryStockMap: initialStockMap,
    preferredLocation: {
      label: 'Oslo Sentrum',
      lat: 59.9139,
      lng: 10.7522,
      travelMode: 'WALKING'
    },
    checkedShoppingItemIds: [],
    chefModes: { ...DEFAULT_CHEF_MODE_PREFERENCES }
  };
}

/**
 * Oppdaterer en inventarliste med brukerens egne avkrysninger/lagerstatus
 */
export function syncInventoryWithUserStock(
  items: InventoryItem[],
  stockMap: Record<string, boolean>
): InventoryItem[] {
  if (!stockMap || Object.keys(stockMap).length === 0) {
    return items;
  }

  return items.map((item) => {
    if (item.id in stockMap) {
      return { ...item, inStock: stockMap[item.id] };
    }
    return item;
  });
}

// ============================================================================
// 5. SANNTIDS CROSS-TAB & CROSS-WINDOW SYNC (BroadcastChannel)
// ============================================================================

let broadcastChannel: BroadcastChannel | null = null;

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null;
  if (!broadcastChannel && 'BroadcastChannel' in window) {
    try {
      broadcastChannel = new BroadcastChannel(HOUSEHOLD_SYNC_CHANNEL);
    } catch {
      // BroadcastChannel ikke støttet i eldre nettlesere
    }
  }
  return broadcastChannel;
}

/**
 * Lytter på sanntidsendringer fra andre vinduer/faner eller andre husstandsmedlemmer.
 * Returnerer en cleanup-funksjon for unsubscribe.
 */
export function subscribeToHouseholdSync(
  callback: (updatedDashboard: UserDashboardData) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  // 1. Lytt på BroadcastChannel
  const channel = getBroadcastChannel();
  const onBroadcast = (event: MessageEvent) => {
    if (event.data?.type === 'HOUSEHOLD_SYNC' && event.data?.dashboard) {
      callback(event.data.dashboard as UserDashboardData);
    }
  };
  channel?.addEventListener('message', onBroadcast);

  // 2. Lytt på lokalt egendefinert event (for same-window reaktivitet)
  const onLocalEvent = (event: Event) => {
    const custom = event as CustomEvent<UserDashboardData>;
    if (custom.detail) {
      callback(custom.detail);
    }
  };
  window.addEventListener(HOUSEHOLD_LOCAL_EVENT, onLocalEvent);

  // 3. Lytt på standard storage events
  const onStorage = (event: StorageEvent) => {
    if (event.key && (event.key.startsWith(HOUSEHOLD_DATA_PREFIX) || event.key.startsWith(STORAGE_PREFIX))) {
      if (event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue) as UserDashboardData;
          callback(parsed);
        } catch {
          // Ignorer
        }
      }
    }
  };
  window.addEventListener('storage', onStorage);

  return () => {
    channel?.removeEventListener('message', onBroadcast);
    window.removeEventListener(HOUSEHOLD_LOCAL_EVENT, onLocalEvent);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Sender et sanntidsvarsel om at et dashboard har endret seg
 */
function notifyHouseholdSync(updated: UserDashboardData): void {
  if (typeof window === 'undefined') return;

  // BroadcastChannel
  const channel = getBroadcastChannel();
  channel?.postMessage({
    type: 'HOUSEHOLD_SYNC',
    householdId: updated.household?.householdId,
    dashboard: updated
  });

  // Local CustomEvent
  window.dispatchEvent(
    new CustomEvent(HOUSEHOLD_LOCAL_EVENT, {
      detail: updated
    })
  );
}

// ============================================================================
// 6. FELLES HUSSTAND (SHARED HOUSEHOLD) KOBLING & FRAKOBLING
// ============================================================================

/**
 * Genererer en lesbar invitasjonskode, f.eks. "HUS-GRØNN-42"
 */
export function generateHouseholdInviteCode(householdName?: string): string {
  const codeSuffix = Math.floor(1000 + Math.random() * 9000);
  if (householdName && (householdName.toLowerCase().includes('luna') || householdName.toLowerCase().includes('alex'))) {
    return 'HUS-ALEXLUNA';
  }
  return `HUS-${codeSuffix}`;
}

/**
 * Henter status for om en bruker deler dashboard med noen i en felles husstand.
 */
export function getHouseholdStatusForUser(
  userId: string,
  email?: string
): { isLinked: boolean; household?: UserDashboardHouseholdInfo; partnerEmails: string[] } {
  const householdId = getLinkedHouseholdId(userId, email);
  if (!householdId) {
    return { isLinked: false, partnerEmails: [] };
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(getHouseholdStorageKey(householdId));
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as UserDashboardData;
        if (parsed.household) {
          const currentEmail = cleanIdentifier(email || '');
          const partnerEmails = parsed.household.memberEmails.filter(
            (e) => cleanIdentifier(e) !== currentEmail
          );
          return {
            isLinked: true,
            household: parsed.household,
            partnerEmails
          };
        }
      } catch {
        // Ignorer
      }
    }
  }

  return { isLinked: true, partnerEmails: [] };
}

/**
 * Kobler sammen to eller flere Google-kontoer til en Felles Husstand.
 * - Kan ta partnerens e-post (f.eks. "luna.sterling@matplan.no") eller en invitasjonskode ("HUS-ALILUNA").
 * - Begge kontoer vil heretter dele samme Single Source of Truth for makromål, kjøkkenskap og handleliste.
 */
export async function linkAccountsToHousehold(
  currentUserId: string,
  currentUserEmail: string,
  partnerEmailOrInviteCode: string,
  householdName?: string
): Promise<UserDashboardData> {
  const currentCleanEmail = cleanIdentifier(currentUserEmail);
  const partnerInput = partnerEmailOrInviteCode.trim();
  const partnerClean = cleanIdentifier(partnerInput);

  // 1. Last nåværende dashboard
  const currentDashboard = await loadUserDashboard(currentUserId);

  // 2. Bestem eller gjenbruk husstands-ID
  let householdId = getLinkedHouseholdId(currentUserId, currentUserEmail);
  let inviteCode = generateHouseholdInviteCode(householdName);
  let resolvedName = householdName || 'Vår Felles Husstand';

  // Hvis partnerInput er en kjent demo-spesifikk hurtigbinding (Alex & Luna)
  const isAlexLunaPair =
    (currentCleanEmail.includes('alex') || currentCleanEmail.includes('styrke')) &&
    (partnerClean.includes('luna') || partnerClean.includes('grunerlokka') || partnerClean === 'luna' || partnerClean === 'hus-alexluna' || partnerClean === 'hus-aliluna');

  if (isAlexLunaPair || partnerClean === 'hus-alexluna' || partnerClean === 'hus-aliluna') {
    householdId = 'household_alex_luna';
    inviteCode = 'HUS-ALEXLUNA';
    resolvedName = 'Alex & Luna (Felles Husstand)';
  } else if (!householdId) {
    householdId = `household_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36)}`;
  }

  // 3. Bygg medlemsliste
  const existingMembers = currentDashboard.household?.memberEmails || [];
  const memberEmailsSet = new Set<string>(existingMembers.map((e) => cleanIdentifier(e)));
  if (currentUserEmail) memberEmailsSet.add(cleanIdentifier(currentUserEmail));

  // Partnerens identifikator
  let partnerEmailCandidate = partnerInput;
  if (partnerClean === 'luna' || partnerClean.includes('luna')) {
    partnerEmailCandidate = 'luna.sterling@matplan.no';
  } else if (partnerClean === 'alex' || partnerClean.includes('alex')) {
    partnerEmailCandidate = 'alex.demo@matplan.no';
  }
  if (!partnerInput.toUpperCase().startsWith('HUS-')) {
    memberEmailsSet.add(cleanIdentifier(partnerEmailCandidate));
  }

  const memberEmails = Array.from(memberEmailsSet);

  const householdInfo: UserDashboardHouseholdInfo = {
    householdId,
    name: resolvedName,
    inviteCode: currentDashboard.household?.inviteCode || inviteCode,
    memberEmails,
    updatedByEmail: currentUserEmail,
    createdAt: currentDashboard.household?.createdAt || new Date().toISOString()
  };

  // 4. Bygg det felles dashboardet
  const sharedDashboard: UserDashboardData = {
    ...currentDashboard,
    updatedAt: new Date().toISOString(),
    household: householdInfo
  };

  // 5. Oppdater koblingstabellen i localStorage
  const links = getHouseholdLinksMap();
  links[cleanIdentifier(currentUserId)] = householdId;
  if (currentUserEmail) links[cleanIdentifier(currentUserEmail)] = householdId;

  // Koble partneren
  links[cleanIdentifier(partnerEmailCandidate)] = householdId;
  if (isAlexLunaPair) {
    links['demo_styrke_majorstuen'] = householdId;
    links['demo_standard_grunerlokka'] = householdId;
    links['alex.demo@matplan.no'] = householdId;
    links['luna.sterling@matplan.no'] = householdId;
    links['styrke@demo.no'] = householdId;
    links['grunerlokka@demo.no'] = householdId;
  }
  saveHouseholdLinksMap(links);

  // 6. Skriv det felles dashboardet til husstandens lagringsnøkkel
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(getHouseholdStorageKey(householdId), JSON.stringify(sharedDashboard));
    // Oppdater også brukerens egen lokale nøkkel for konsistens
    window.localStorage.setItem(getUserDashboardStorageKey(currentUserId), JSON.stringify(sharedDashboard));
  }

  // 7. Send til server API i bakgrunnen
  if (typeof window !== 'undefined') {
    fetch('/api/user-dashboard', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dashboard: sharedDashboard, householdId })
    }).catch(() => {});
  }

  // 8. Varsle alle åpne faner og vinduer om den nye felles husstanden
  notifyHouseholdSync(sharedDashboard);

  return sharedDashboard;
}

/**
 * 1-klikks hurtigkobling for partnerdemo: Kobler sammen Alex og Luna til felles husstand.
 */
export async function linkAlexAndLunaHousehold(
  currentUserId: string = 'demo_styrke_majorstuen',
  currentUserEmail: string = 'alex.demo@matplan.no'
): Promise<UserDashboardData> {
  return linkAccountsToHousehold(
    currentUserId,
    currentUserEmail,
    'luna.sterling@matplan.no',
    'Alex & Luna (Felles Husstand)'
  );
}

/**
 * Kobler en brukerkonto fra felles husstand og gjenoppretter en individuell profil.
 */
export async function unlinkAccountFromHousehold(
  userId: string,
  email?: string
): Promise<UserDashboardData> {
  const householdId = getLinkedHouseholdId(userId, email);

  // Fjern fra koblingstabell
  const links = getHouseholdLinksMap();
  if (userId) delete links[cleanIdentifier(userId)];
  if (email) delete links[cleanIdentifier(email)];
  saveHouseholdLinksMap(links);

  // Opprett eller hent individuelt dashboard
  const defaultDashboard = createDefaultUserDashboard(userId, email);
  delete defaultDashboard.household;
  defaultDashboard.updatedAt = new Date().toISOString();

  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(getUserDashboardStorageKey(userId), JSON.stringify(defaultDashboard));
  }

  // Hvis husstanden fortsatt har andre medlemmer, oppdater husstandens medlemsliste
  if (householdId && typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(getHouseholdStorageKey(householdId));
    if (raw) {
      try {
        const hhData = JSON.parse(raw) as UserDashboardData;
        if (hhData.household) {
          const uEmail = cleanIdentifier(email || '');
          hhData.household.memberEmails = hhData.household.memberEmails.filter(
            (e) => cleanIdentifier(e) !== uEmail
          );
          window.localStorage.setItem(getHouseholdStorageKey(householdId), JSON.stringify(hhData));
          notifyHouseholdSync(hhData);
        }
      } catch {
        // Ignorer
      }
    }
  }

  notifyHouseholdSync(defaultDashboard);

  return defaultDashboard;
}

// ============================================================================
// 7. BROWSER-SAFE SKY- OG LOKAL-SYNKRONISERING MED HUSSTANDS-STØTTE
// ============================================================================

/**
 * Henter Supabase miljøvariabler (hvis konfigurert)
 */
function getSupabaseConfig(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url && anonKey) {
    return { url: url.replace(/\/$/, ''), anonKey };
  }
  return null;
}

/**
 * Laster brukerens dashboard i henhold til prioritert 3-lags hybrid-modell:
 * Hvis brukeren er knyttet til en Felles Husstand, lastes det delte husstands-dashboardet.
 * 1. Les umiddelbart fra synkron browser localStorage (0 ms ventetid)
 * 2. Prøv å hente nyere versjon fra Supabase REST API (hvis konfigurert med RLS)
 * 3. Prøv å hente fra lokal Next.js dev API (/api/user-dashboard?userId=... / &householdId=...)
 * 4. Fallback: Opprett initialt dashboard
 */
export async function loadUserDashboard(
  userId: string,
  defaultInventory: InventoryItem[] = [],
  authToken?: string,
  userEmail?: string
): Promise<UserDashboardData> {
  if (!userId) {
    throw new Error('loadUserDashboard krever en gyldig userId');
  }

  // Sjekk om brukeren er del av en felles husstand
  const householdId = getLinkedHouseholdId(userId, userEmail);
  const primaryStorageKey = householdId
    ? getHouseholdStorageKey(householdId)
    : getUserDashboardStorageKey(userId);

  let localData: UserDashboardData | null = null;

  // 1. Sjekk localStorage i browser
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(primaryStorageKey);
      if (stored) {
        localData = JSON.parse(stored) as UserDashboardData;
      }
    } catch {
      // Ignorer parse-feil i localStorage
    }
  }

  // 2. Forsøk å synkronisere fra Supabase REST (sky)
  const supabase = getSupabaseConfig();
  if (supabase) {
    try {
      const queryParam = householdId
        ? `household_id=eq.${encodeURIComponent(householdId)}`
        : `user_id=eq.${encodeURIComponent(userId)}`;
      const endpoint = `${supabase.url}/rest/v1/user_dashboards?${queryParam}&select=*`;
      const headers: Record<string, string> = {
        apikey: supabase.anonKey,
        Accept: 'application/json'
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      } else {
        headers['Authorization'] = `Bearer ${supabase.anonKey}`;
      }

      const res = await fetch(endpoint, { method: 'GET', headers });
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0 && rows[0].payload) {
          const cloudData = rows[0].payload as UserDashboardData;
          if (!localData || new Date(cloudData.updatedAt) >= new Date(localData.updatedAt)) {
            // Skydata er nyest eller lik
            if (typeof window !== 'undefined' && window.localStorage) {
              window.localStorage.setItem(primaryStorageKey, JSON.stringify(cloudData));
            }
            return cloudData;
          }
        }
      }
    } catch {
      // Nettverksfeil mot Supabase – fortsett til neste lag
    }
  }

  // 3. Forsøk å hente fra lokal Next.js dev server (/api/user-dashboard)
  if (typeof window !== 'undefined') {
    try {
      const queryParam = householdId
        ? `householdId=${encodeURIComponent(householdId)}`
        : `userId=${encodeURIComponent(userId)}`;
      const res = await fetch(`/api/user-dashboard?${queryParam}`, {
        method: 'GET',
        headers: { Accept: 'application/json' }
      });
      if (res.ok) {
        const payload = await res.json();
        if (payload?.dashboard) {
          const serverData = payload.dashboard as UserDashboardData;
          if (!localData || new Date(serverData.updatedAt) >= new Date(localData.updatedAt)) {
            window.localStorage.setItem(primaryStorageKey, JSON.stringify(serverData));
            return serverData;
          }
        }
      }
    } catch {
      // Server API ikke tilgjengelig (f.eks. på ren statisk GitHub Pages) – fortsett
    }
  }

  // Hvis vi hadde data i localStorage, returner det
  if (localData) {
    return localData;
  }

  // 4. Ingen data funnet: Initialiser et nytt dashboard
  const freshData = createDefaultUserDashboard(userId, userEmail || '', '', defaultInventory);

  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(primaryStorageKey, JSON.stringify(freshData));
  }

  // Forsøk å lagre det innledende dashboardet asynkront i bakgrunnen
  saveUserDashboard(userId, freshData, authToken).catch(() => {});

  return freshData;
}

/**
 * Lagrer endringer i brukerens personlige eller felles husstands-dashboard.
 * - Skriver alltid umiddelbart synkront til `localStorage` (0 ms lokal respons).
 * - Sender varsel over BroadcastChannel slik at andre vinduer og husstandsmedlemmer oppdateres direkte.
 * - Sender asynkront til Supabase REST eller `/api/user-dashboard`.
 */
export async function saveUserDashboard(
  userId: string,
  patch: Partial<UserDashboardData>,
  authToken?: string
): Promise<UserDashboardData> {
  if (!userId) {
    throw new Error('saveUserDashboard krever en gyldig userId');
  }

  // Sjekk om det er en tilknyttet husstand
  const targetHouseholdId = patch.household?.householdId || getLinkedHouseholdId(userId, patch.email);
  const primaryStorageKey = targetHouseholdId
    ? getHouseholdStorageKey(targetHouseholdId)
    : getUserDashboardStorageKey(userId);

  let current: UserDashboardData;

  // Hent eksisterende data fra primærnøkkelen
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(primaryStorageKey);
    if (raw) {
      try {
        current = JSON.parse(raw);
      } catch {
        current = createDefaultUserDashboard(userId, patch.email);
      }
    } else {
      current = createDefaultUserDashboard(userId, patch.email);
    }
  } else {
    current = createDefaultUserDashboard(userId, patch.email);
  }

  // Oppdater husstandsinfo dersom det er en felles husstand
  let updatedHousehold = patch.household || current.household;
  if (targetHouseholdId && !updatedHousehold) {
    const status = getHouseholdStatusForUser(userId, patch.email);
    if (status.household) {
      updatedHousehold = status.household;
    }
  }
  if (updatedHousehold) {
    updatedHousehold = {
      ...updatedHousehold,
      updatedByEmail: patch.email || current.email || updatedHousehold.updatedByEmail
    };
  }

  // Merge patch
  const updated: UserDashboardData = {
    ...current,
    ...patch,
    userId: current.userId, // Bevarer opprinnelig brukerreferanse
    updatedAt: new Date().toISOString(),
    household: updatedHousehold,
    macroTargets: {
      ...current.macroTargets,
      ...(patch.macroTargets || {})
    },
    inventoryStockMap: {
      ...current.inventoryStockMap,
      ...(patch.inventoryStockMap || {})
    },
    preferredLocation: {
      ...current.preferredLocation,
      ...(patch.preferredLocation || {})
    },
    checkedShoppingItemIds:
      patch.checkedShoppingItemIds !== undefined
        ? patch.checkedShoppingItemIds
        : current.checkedShoppingItemIds,
    chefModes: {
      ...(current.chefModes || DEFAULT_CHEF_MODE_PREFERENCES),
      ...(patch.chefModes || {})
    }
  };

  // 1. Skriv til synkron browser-cache
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(primaryStorageKey, JSON.stringify(updated));
      // Hvis vi har en husstand, oppdater også personlig nøkkel for rask offline fallback
      if (targetHouseholdId) {
        window.localStorage.setItem(getUserDashboardStorageKey(userId), JSON.stringify(updated));
      }
    } catch {
      // Ignorer kvotebegrensninger
    }
  }

  // 2. Send sanntids-oppdatering til andre vinduer og husstandsmedlemmer
  notifyHouseholdSync(updated);

  // 3. Synkroniser til Supabase REST hvis konfigurert
  const supabase = getSupabaseConfig();
  if (supabase) {
    try {
      const endpoint = `${supabase.url}/rest/v1/user_dashboards`;
      const headers: Record<string, string> = {
        apikey: supabase.anonKey,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation'
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      } else {
        headers['Authorization'] = `Bearer ${supabase.anonKey}`;
      }

      await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_id: userId,
          household_id: targetHouseholdId || null,
          email: updated.email,
          updated_at: updated.updatedAt,
          payload: updated
        })
      });
    } catch {
      // Feil i sky-synk – den lokale versjonen er uansett trygg
    }
  }

  // 4. Synkroniser til lokal dev-server (/api/user-dashboard) hvis browser
  if (typeof window !== 'undefined') {
    try {
      await fetch('/api/user-dashboard', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dashboard: updated,
          householdId: targetHouseholdId || undefined
        })
      });
    } catch {
      // Dev-server ikke aktiv (f.eks. på statisk GitHub Pages)
    }
  }

  return updated;
}

/**
 * Nullstiller en brukers lagrede dashboard lokalt
 */
export function clearUserDashboard(userId: string): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(getUserDashboardStorageKey(userId));
  }
}

/**
 * Eksporterer brukerens dashboard til ren JSON-streng for backup/nedlasting
 */
export function exportUserDashboardJson(dashboard: UserDashboardData): string {
  return JSON.stringify(dashboard, null, 2);
}

/**
 * Importerer et dashboard fra en JSON-streng
 */
export function importUserDashboardJson(jsonString: string): UserDashboardData {
  const parsed = JSON.parse(jsonString) as UserDashboardData;
  if (!parsed.userId || !parsed.macroTargets || !parsed.inventoryStockMap) {
    throw new Error('Ugyldig format på eksportert dashboard-JSON');
  }
  return parsed;
}
