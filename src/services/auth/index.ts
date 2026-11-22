/**
 * GOOGLE SSO & AUTENTISERING - ENTRYPOINT
 * =======================================
 * Samlet eksport for autentiseringstjenesten i matplan-appen.
 * Støtter både ekte Google Identity Services (GSI JWT) og 1-klikks testprofiler.
 */

export {
  // Typer
  type GoogleUserProfile,
  type AuthSession,
  type GoogleJwtPayload,
  type GoogleGsiButtonConfig,
  type AuthStateChangeListener,
  type InitGoogleIdentityOptions,

  // Konstanter
  DEMO_GOOGLE_ACCOUNTS,
  STORAGE_AUTH_SESSION_KEY,

  // Kjernefunksjoner for sesjon og innlogging
  getCurrentAuthSession,
  signInWithGoogleCredential,
  signInWithGoogleProfile,
  switchDemoAccount,
  signOutGoogleSession,
  subscribeToAuthChange,

  // Hjelpefunksjoner for JWT og GSI
  decodeGoogleJwt,
  base64UrlDecode,
  getGoogleClientId,
  isGoogleGsiConfigured,
  loadGoogleGsiScript,
  initGoogleIdentityServices,
  renderGoogleSignInButton
} from './googleSsoService';
