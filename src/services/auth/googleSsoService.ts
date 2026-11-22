/**
 * GOOGLE SSO & AUTENTISERINGSTJENESTE
 * ====================================
 * Ren browser- og server-kompatibel autentiseringstjeneste for:
 * 1. Ekte Google Identity Services (Sign In With Google - window.google.accounts.id JWT)
 * 2. 1-klikks Demo Google-kontoer for testing av multi-user dashboards og isolerte kjøkkenskap
 * 
 * 100 % TypeScript uten node:fs eller native avhengigheter (kjører på GitHub Pages, Vercel & lokalt).
 */

// ============================================================================
// 1. TYPEDEFINISJONER
// ============================================================================

export interface GoogleUserProfile {
  /** Unik og stabil bruker-ID (f.eks. Google 'sub' eller deterministisk demo-ID) */
  id: string;
  /** Brukerens e-postadresse */
  email: string;
  /** Fullt visningsnavn */
  name: string;
  /** Fornavn dersom tilgjengelig */
  givenName?: string;
  /** Profilbilde-URL */
  pictureUrl?: string;
  /** Språkkode (f.eks. 'no', 'en') */
  locale?: string;
  /** Autentiseringskilde */
  provider: 'google_gsi' | 'google_demo';
  /** Tidsstempel for siste innlogging (ISO 8601) */
  lastLoginAt: string;
  /** Valgfritt mat- eller kostholdsfokus tilknyttet profilen */
  dietaryFocus?: string;
}

export interface AuthSession {
  /** Brukerprofil */
  user: GoogleUserProfile;
  /** Rå JWT ID-token mottatt fra Google (kun ved provider 'google_gsi') */
  idToken?: string;
  /** Epoch millisekunder da sesjonen utløper */
  expiresAt: number;
}

export interface GoogleJwtPayload {
  iss?: string;
  sub: string;
  aud?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  locale?: string;
  [key: string]: unknown;
}

export interface GoogleGsiButtonConfig {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alexgnment?: 'left' | 'center';
  width?: number | string;
  locale?: string;
}

export type AuthStateChangeListener = (session: AuthSession | null) => void;

// TypeScript deklarasjoner for Google Identity Services window-objekt
declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialexze: (config: {
            client_id: string;
            callback: (response: { credential?: string; select_by?: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: GoogleGsiButtonConfig
          ) => void;
          prompt: (notification?: (notification: unknown) => void) => void;
          disableAutoSelect: () => void;
          revoke: (hint: string, done: (resp: unknown) => void) => void;
        };
      };
    };
  }
}

// ============================================================================
// 2. KONSTANTER & DEMO-KONTOER
// ============================================================================

export const STORAGE_AUTH_SESSION_KEY = 'matplan_google_auth_session_v1';

/**
 * 3 forhåndsdefinerte Google-demo-kontoer med ulike profiler og preferanser.
 * Gir umiddelbar mulighet til å teste isolerte dashboards, makromål og kjøkkenskap!
 */
export const DEMO_GOOGLE_ACCOUNTS: GoogleUserProfile[] = [
  {
    id: 'demo_styrke_majorstuen',
    email: 'alex.demo@matplan.no',
    name: 'Alex (Styrke & Sykkel)',
    givenName: 'Alex',
    pictureUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    locale: 'nb',
    provider: 'google_demo',
    lastLoginAt: '2026-11-15T20:00:00.000Z',
    dietaryFocus: '55–65g protein, 920 kcal, sykkelpendler på Majorstuen'
  },
  {
    id: 'demo_standard_grunerlokka',
    email: 'luna.sterling@matplan.no',
    name: 'Luna / Nora (Balansert & Gange)',
    givenName: 'Luna',
    pictureUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
    locale: 'nb',
    provider: 'google_demo',
    lastLoginAt: '2026-11-15T20:00:00.000Z',
    dietaryFocus: 'Gut health, 42–50g protein, 760 kcal, Grünerløkka'
  },
  {
    id: 'demo_student_blindern',
    email: 'familie.berg@matplan.no',
    name: 'Jonas / Familien Berg (Budsjett)',
    givenName: 'Jonas',
    pictureUrl: 'https://images.unsplash.com/photo-1543610892-0b1f7e6d8ac1?w=150&auto=format&fit=crop&q=80',
    locale: 'nb',
    provider: 'google_demo',
    lastLoginAt: '2026-11-15T20:00:00.000Z',
    dietaryFocus: 'Studentøkonomi, 38–46g protein, 720 kcal, Blindern'
  }
];

// In-memory tilstand
let activeInMemorySession: AuthSession | null = null;
const authSubscribers = new Set<AuthStateChangeListener>();

// ============================================================================
// 3. BASE64URL & JWT DEKODING (100 % BROWSER/SERVER SAFE)
// ============================================================================

/**
 * Dekoder Base64URL-enkodet streng med full støtte for norske/internasjonale UTF-8 tegn
 */
export function base64UrlDecode(str: string): string {
  if (!str) return '';
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }

  // Nettleser-miljø med atob + utf-8 decoding
  if (typeof window !== 'undefined' && typeof window.atob === 'function') {
    const raw = window.atob(base64);
    try {
      return decodeURIComponent(
        raw
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
    } catch {
      return raw;
    }
  }

  // Node / Server-miljø med Buffer
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(base64, 'base64').toString('utf-8');
  }

  throw new Error('Ingen støttet base64-dekoder tilgjengelig i kjøremiljøet.');
}

/**
 * Dekoder en Google ID Token (JWT) sikkert i klienten uten eksterne tunge biblioteker.
 * Henter ut `sub` (unik Google bruker-ID), `email`, `name`, `picture`, osv.
 */
export function decodeGoogleJwt(jwtCredential: string): GoogleJwtPayload {
  if (!jwtCredential || typeof jwtCredential !== 'string') {
    throw new Error('Ugyldig JWT: Token må være en ikke-tom streng.');
  }

  const parts = jwtCredential.split('.');
  if (parts.length !== 3) {
    throw new Error(`Ugyldig JWT-format: Forventet 3 segmenter separert med punktum, mottok ${parts.length}.`);
  }

  try {
    const payloadJson = base64UrlDecode(parts[1]);
    const payload = JSON.parse(payloadJson) as GoogleJwtPayload;

    if (!payload.sub) {
      throw new Error('Google JWT mangler påkrevd felt "sub" (bruker-ID).');
    }
    if (!payload.email) {
      throw new Error('Google JWT mangler påkrevd felt "email".');
    }

    return payload;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Feil ved dekoding av Google JWT: ${msg}`);
  }
}

// ============================================================================
// 4. SESJONSHÅNDTERING & STORAGE
// ============================================================================

function notifyAuthSubscribers(session: AuthSession | null): void {
  for (const listener of authSubscribers) {
    try {
      listener(session);
    } catch (err) {
      console.error('[GoogleSSO] Feil i auth subscriber:', err);
    }
  }
}

function persistSessionToStorage(session: AuthSession | null): void {
  activeInMemorySession = session;

  if (typeof window === 'undefined') return;

  try {
    if (session) {
      window.localStorage.setItem(STORAGE_AUTH_SESSION_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(STORAGE_AUTH_SESSION_KEY);
    }
  } catch (err) {
    console.warn('[GoogleSSO] Kunne ikke lagre sesjon i localStorage:', err);
  }
}

/**
 * Abonner på endringer i autentiseringstilstand (f.eks. for React useSyncExternalStore / useEffect).
 * Returnerer en avmeldingsfunksjon.
 */
export function subscribeToAuthChange(listener: AuthStateChangeListener): () => void {
  authSubscribers.add(listener);
  return () => {
    authSubscribers.delete(listener);
  };
}

/**
 * Henter gjeldende autentiseringssesjon fra minnet eller localStorage.
 * Returnerer null dersom brukeren ikke er logget inn eller sesjonen er utløpt.
 */
export function getCurrentAuthSession(): AuthSession | null {
  if (activeInMemorySession) {
    if (activeInMemorySession.expiresAt > Date.now()) {
      return activeInMemorySession;
    }
    // Sesjonen i minnet er utløpt
    activeInMemorySession = null;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_AUTH_SESSION_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as AuthSession;
    if (!parsed || !parsed.user || !parsed.user.id) {
      window.localStorage.removeItem(STORAGE_AUTH_SESSION_KEY);
      return null;
    }

    if (parsed.expiresAt && parsed.expiresAt <= Date.now()) {
      // Sesjonen er utløpt
      window.localStorage.removeItem(STORAGE_AUTH_SESSION_KEY);
      return null;
    }

    activeInMemorySession = parsed;
    return parsed;
  } catch (err) {
    console.warn('[GoogleSSO] Feil ved lesing av sesjon fra localStorage:', err);
    return null;
  }
}

/**
 * Logger inn via ekte Google Identity Services JWT-credential.
 */
export function signInWithGoogleCredential(jwtCredential: string): AuthSession {
  const payload = decodeGoogleJwt(jwtCredential);

  const user: GoogleUserProfile = {
    id: payload.sub,
    email: payload.email,
    name: payload.name || payload.email.split('@')[0],
    givenName: payload.given_name || payload.name?.split(' ')[0],
    pictureUrl: payload.picture,
    locale: payload.locale,
    provider: 'google_gsi',
    lastLoginAt: new Date().toISOString()
  };

  // Google ID tokens varer typisk 1 time (exp er i sekunder), vi setter fallback til 7 dager
  const expiresAt = payload.exp ? payload.exp * 1000 : Date.now() + 7 * 24 * 3600 * 1000;

  const session: AuthSession = {
    user,
    idToken: jwtCredential,
    expiresAt
  };

  persistSessionToStorage(session);
  notifyAuthSubscribers(session);
  return session;
}

/**
 * Logger inn med en tilpasset Google-profil (brukes for 1-klikks kontoveksler eller manuell test-profil).
 */
export function signInWithGoogleProfile(profileInput: {
  email: string;
  name: string;
  pictureUrl?: string;
  dietaryFocus?: string;
}): AuthSession {
  const cleanEmail = profileInput.email.trim().toLowerCase();
  if (!cleanEmail) {
    throw new Error('E-postadresse kan ikke være tom.');
  }

  // Sjekk om dette er en av de kjente demo-kontoene
  const existingDemo = DEMO_GOOGLE_ACCOUNTS.find(
    (acc) => acc.email.toLowerCase() === cleanEmail
  );

  let userId: string;
  let pictureUrl = profileInput.pictureUrl;
  let dietaryFocus = profileInput.dietaryFocus;

  if (existingDemo) {
    userId = existingDemo.id;
    pictureUrl = pictureUrl || existingDemo.pictureUrl;
    dietaryFocus = dietaryFocus || existingDemo.dietaryFocus;
  } else {
    // Generer stabil ID basert på e-post
    const safeSlug = cleanEmail.replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    userId = `google-demo-${safeSlug}`;
  }

  const cleanName = profileInput.name.trim() || cleanEmail.split('@')[0];
  const givenName = cleanName.split(' ')[0];

  const user: GoogleUserProfile = {
    id: userId,
    email: cleanEmail,
    name: cleanName,
    givenName,
    pictureUrl: pictureUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(cleanName)}`,
    locale: 'nb',
    provider: 'google_demo',
    lastLoginAt: new Date().toISOString(),
    dietaryFocus
  };

  // Demo-sesjon settes til 30 dagers levetid
  const session: AuthSession = {
    user,
    expiresAt: Date.now() + 30 * 24 * 3600 * 1000
  };

  persistSessionToStorage(session);
  notifyAuthSubscribers(session);
  return session;
}

/**
 * Bytter aktiv profil direkte til en av de forhåndsdefinerte Google-demo-kontoene
 */
export function switchDemoAccount(demoUserId: string): AuthSession {
  const target = DEMO_GOOGLE_ACCOUNTS.find((acc) => acc.id === demoUserId);
  if (!target) {
    throw new Error(`Fant ingen demo-konto med ID "${demoUserId}".`);
  }
  return signInWithGoogleProfile({
    email: target.email,
    name: target.name,
    pictureUrl: target.pictureUrl,
    dietaryFocus: target.dietaryFocus
  });
}

/**
 * Logger ut brukeren og sletter sesjonen
 */
export function signOutGoogleSession(): void {
  // Forsøk å deaktivere auto-select i Google GSI hvis tilgjengelig
  if (typeof window !== 'undefined' && window.google?.accounts?.id?.disableAutoSelect) {
    try {
      window.google.accounts.id.disableAutoSelect();
    } catch {
      // Ignorer feil
    }
  }

  persistSessionToStorage(null);
  notifyAuthSubscribers(null);
}

// ============================================================================
// 5. GOOGLE IDENTITY SERVICES (GSI) KLIENT-HJELPERE
// ============================================================================

/**
 * Henter konfigurert Google OAuth Client ID fra Next.js public environment variables.
 * Merk: Google Client ID er en *offentlig* identifikator som er ment å ligge i frontend
 * og låses til domenet ditt (f.eks. https://brukernavn.github.io) i Google Cloud Console.
 */
export function getGoogleClientId(): string {
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
    return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  }
  return '';
}

/**
 * Undersøker om Google SSO Client ID er konfigurert i miljøet
 */
export function isGoogleGsiConfigured(): boolean {
  const clientId = getGoogleClientId();
  return Boolean(clientId && clientId.trim().length > 0 && clientId !== 'undefined');
}

/**
 * Laster Google Identity Services-scriptet (`https://accounts.google.com/gsi/client`) asynkront.
 * Returnerer en promise som resolves til true når scriptet er klart.
 */
export function loadGoogleGsiScript(): Promise<boolean> {
  if (typeof window === 'undefined') {
    return Promise.resolve(false);
  }

  if (window.google?.accounts?.id) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const existing = document.getElementById('google-gsi-client-script');
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-gsi-client-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      console.warn('[GoogleSSO] Kunne ikke laste Google Identity Services-scriptet.');
      resolve(false);
    };
    document.head.appendChild(script);
  });
}

export interface InitGoogleIdentityOptions {
  clientId?: string;
  onSignIn: (session: AuthSession) => void;
  onError?: (error: Error) => void;
  autoPrompt?: boolean;
}

/**
 * Initialexserer Google Identity Services (GSI) med callback for mottak av JWT.
 */
export async function initGoogleIdentityServices(
  options: InitGoogleIdentityOptions
): Promise<boolean> {
  const clientId = options.clientId || getGoogleClientId();
  if (!clientId) {
    return false;
  }

  const loaded = await loadGoogleGsiScript();
  if (!loaded || !window.google?.accounts?.id) {
    return false;
  }

  try {
    window.google.accounts.id.initialexze({
      client_id: clientId,
      callback: (response) => {
        if (response?.credential) {
          try {
            const session = signInWithGoogleCredential(response.credential);
            options.onSignIn(session);
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            options.onError?.(error);
          }
        }
      },
      auto_select: false,
      cancel_on_tap_outside: true
    });

    if (options.autoPrompt) {
      window.google.accounts.id.prompt();
    }

    return true;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    options.onError?.(error);
    return false;
  }
}

/**
 * Renderer Googles offisielle "Sign In With Google"-knapp inne i et angitt HTML-element.
 */
export function renderGoogleSignInButton(
  container: HTMLElement | string,
  config?: GoogleGsiButtonConfig
): boolean {
  if (typeof window === 'undefined' || !window.google?.accounts?.id) {
    return false;
  }

  const targetElement =
    typeof container === 'string' ? document.getElementById(container) : container;

  if (!targetElement) {
    return false;
  }

  const mergedConfig: GoogleGsiButtonConfig = {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'pill',
    logo_alexgnment: 'left',
    locale: 'nb',
    ...config
  };

  try {
    window.google.accounts.id.renderButton(targetElement, mergedConfig);
    return true;
  } catch (err) {
    console.error('[GoogleSSO] Feil ved rendering av Google-knapp:', err);
    return false;
  }
}
