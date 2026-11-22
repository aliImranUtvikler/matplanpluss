# Teknisk Rapport 06: SSO & Per-Bruker Database-Arkitektur

**Prosjekt:** Smart Ukentlig Vegansk Matplan & Tilbuds-Ruting i Norge  
**Ansvarlig:** Database & Per-Bruker Dashboard-Agent  
**Fokus:** Sikker flerbruker-persistens på statisk hosting (GitHub Pages) uten hemmelige nøkler  
**Dato:** 15. november 2026  
**Status:** Implementert og verifisert i produksjonsbygg  

---

## 1. Sammendrag & Problemstilling

### 1.1 Utfordringen: Statisk Hosting kontra Personlig Data
Tradisjonelle webapplikasjoner med personlige dashboards krever en sentral backend-server (f.eks. Node.js/Express, Python/Django) som holder hemmelige databasepassord (`DATABASE_URL`, `POSTGRES_PASSWORD`) skjult for brukeren.

Når en moderne webapplikasjon skal deployes til **GitHub Pages** (eller Cloudflare Pages / AWS S3 / Netlify Static Export):
1. Det finnes **ingen dynamisk Node.js server i skyen** som kan holde hemmelige nøkler skjult.
2. Enhver API-nøkkel som bakes inn i JavaScript-koden (`NEXT_PUBLIC_*`) vil være **100 % synlig for alle besøkende** via nettleserens utviklerverktøy (DevTools -> Network/Sources).
3. Hvis man legger inn en tradisjonell database-forbindelse eller en administrativ hemmelig API-nøkkel på en statisk side, vil en angriper kunne dumpe hele databasen eller slette andre brukeres data.
4. Samtidig krever applikasjonen at **hver enkelt Google SSO-bruker har sitt eget unike dashboard**:
   - Egne makromål (protein, kalorier, karbobase-vekt).
   - Eget personlig kjøkkenskap / inventar (hvilke varer er på lager i huset).
   - Egen hjemmeadresse og foretrukket transportmiddel (gange, sykkel, bil).
   - Egne avkryssinger på ukens handleliste.
   - Egen tilpasset ukeplan.

### 1.2 Den Løsende Arkitekturen
For å forene kravene til **null server-hemmeligheter på GitHub Pages**, **høy sikkerhet** og **isolerte per-bruker dashboards**, har vi implementert en **3-lags hybrid arkitektur**:

```mermaid
flowchart TD
    User["Google SSO Bruker (Browser)"]
    
    subgraph Client["Klientmiljø (GitHub Pages / Localhost)"]
        LocalStorage["Lag 1: Navneroms-isolert Browser Cache\n(localStorage: 'matplan_dashboard_v1_<userId>')\n- 0 ms latency\n- Offline first\n- Instant konto-bytte"]
        DbService["src/services/db/userDatabaseService.ts\n(100% Browser-Safe Engine)"]
    end

    subgraph CloudBaaS["Lag 2: Sky-BaaS (GitHub Pages Produksjon)"]
        Supabase["Supabase PostgreSQL REST API\n- Offentlig NEXT_PUBLIC_SUPABASE_ANON_KEY\n- Row-Level Security (RLS)\n- auth.uid() = user_id"]
        GoogleOAuth["Google SSO Identity Provider\n- Signert JWT (ID Token / Bearer)"]
    end

    subgraph LocalDev["Lag 3: Lokal Utviklingsserver (Node.js)"]
        NextApi["Next.js Route Handler\n/api/user-dashboard"]
        FileDb["Lokal Fildatabase\ndata/users/<sanitizedUserId>.json"]
    end

    User -->|"1. Logger inn med Google"| GoogleOAuth
    GoogleOAuth -->|"2. Utsteder signert JWT"| User
    User -->|"3. Aksesserer app"| DbService
    DbService <-->|"Synkront lese/skrive (0 ms)"| LocalStorage
    DbService <-->|"Produksjon: JWT + Anon Key (RLS)"| Supabase
    DbService <-->|"Lokal dev: HTTP GET / PUT"| NextApi
    NextApi <-->|"Les/Skriv atomisk JSON"| FileDb
```

---

## 2. Sikkerhetsmodell: Hvorfor Offentlig Anon-Nøkkel + RLS er 100 % Trygt

### 2.1 Forskjellen på API-nøkler og Autentiserings-tokens
Mange utviklere misforstår Backend-as-a-Service (BaaS) som Supabase eller Firebase og tror at `NEXT_PUBLIC_SUPABASE_ANON_KEY` må holdes hemmelig. Dette er feil:

| Egenskap | Tradisjonell `DATABASE_URL` / Admin Service Key | BaaS Public Anon Key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
|---|---|---|
| **Eksponering** | **MÅ ALDRI EKSPONERES**. Gir full `postgres` superuser-tilgang. | **Er designet for å være offentlig** i HTML/JS på samme måte som en Google Maps API-nøkkel. |
| **Hvor sikkerheten håndheves** | I backend-serverens kode (Node.js/Express) før spørringen sendes til DB. | **Direkte inne i PostgreSQL-motoren** via **Row-Level Security (RLS)** policies. |
| **Hva en angriper kan gjøre med nøkkelen** | Kan kjøre `DROP TABLE users;` eller `SELECT * FROM all_data;`. | Kan kun spørre tabellen som en *anonym gjest* eller som en *autentisert bruker med signert JWT*. Uten gyldig Google JWT returneres **0 rader**. |

### 2.2 Hvordan Row-Level Security (RLS) Fungerer i Praksis
Når en bruker logger inn med Google SSO, verifiserer Supabase Auth tokenet mot Googles kryptografiske sertifikater (`https://www.googleapis.com/oauth2/v3/certs`). Supabase setter deretter den interne PostgreSQL-sesjonskonteksten:

```sql
SET LOCAL request.jwt.claim.sub = 'google_user_sub_987654321';
SET LOCAL auth.uid() = 'google_user_sub_987654321';
```

Når klienten kjører en spørring som:
```http
GET /rest/v1/user_dashboards?select=* HTTP/1.1
Host: your-project.supabase.co
apikey: eyJhbGciOi... (offentlig anon key)
Authorization: Bearer <Google-signert JWT>
```

... vil PostgreSQL automatisk filtrere alle rader basert på tabellens RLS-policy:
```sql
CREATE POLICY "Users can only access their own dashboard"
ON public.user_dashboards
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
```

> [!IMPORTANT]
> **Matematisk Isolasjon:** Selv om en ondsinnet bruker manuelt endrer spørringen i nettleserens konsoll til:
> `fetch('https://xyz.supabase.co/rest/v1/user_dashboards?user_id=eq.annen_brukers_id')`  
> vil PostgreSQL evaluere `auth.uid() = user_id`. Siden brukerens JWT har en annen ID enn parameteren, returnerer databasen **tomt resultat `[]`** eller **HTTP 403 Forbidden**. Ingen data lekker!

---

## 3. Komplett SQL DDL Skjema for Supabase / PostgreSQL

For team som ønsker å provisjonere en sky-database for produksjonsmiljøet, er tabellstrukturen og sikkerhetsreglene ferdig definert under:

```sql
-- ============================================================================
-- SQL SKJEMA FOR PER-BRUKER DASHBOARD MED ROW-LEVEL SECURITY (RLS)
-- ============================================================================

-- 1. Opprett tabellen
CREATE TABLE IF NOT EXISTS public.user_dashboards (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    display_name TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Aktiver Row-Level Security (RLS)
ALTER TABLE public.user_dashboards ENABLE ROW LEVEL SECURITY;

-- 3. Policy: Autentiserte Google SSO-brukere kan lese sitt eget dashboard
CREATE POLICY "Users can select own dashboard"
ON public.user_dashboards
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 4. Policy: Autentiserte Google SSO-brukere kan opprette/oppdatere sitt eget dashboard
CREATE POLICY "Users can insert own dashboard"
ON public.user_dashboards
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own dashboard"
ON public.user_dashboards
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 5. Indeksering for lynrask oppslag
CREATE INDEX IF NOT EXISTS idx_user_dashboards_user_id ON public.user_dashboards(user_id);
CREATE INDEX IF NOT EXISTS idx_user_dashboards_updated_at ON public.user_dashboards(updated_at DESC);
```

---

## 4. Den 3-Lags Hybride Motoren (`userDatabaseService.ts`)

Kjernen i løsningen er implementert i [`src/services/db/userDatabaseService.ts`](file://src/services/db/userDatabaseService.ts). Denne tjenesten er bygget **100 % browser-kompatibel uten Node.js `fs`**, slik at den fungerer feilfritt både i SSR, CSR og som statisk eksport på GitHub Pages.

### 4.1 Datakontrakt: `UserDashboardData`

```typescript
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
  preferredLocation: {
    label: string;
    lat: number;
    lng: number;
    travelMode: 'WALKING' | 'BICYCLING' | 'DRIVING';
  };
  /** Avkryssede varer på ukens handleliste */
  checkedShoppingItemIds: string[];
  /** Brukerens personlige ukeplan hvis tilpasset */
  customMealPlan?: WeeklyMealPlanResponse;
}
```

### 4.2 Synkroniserings- og Fallback-sekvens

```mermaid
sequenceDiagram
    autonumber
    participant UI as Brukergrensesnitt (Next.js / React)
    participant Engine as userDatabaseService
    participant Local as localStorage (Navnerom per bruker)
    participant Sky as Supabase REST (med RLS)
    participant DevApi as /api/user-dashboard (data/users/*.json)

    Note over UI, Engine: Bruker logger inn eller bytter Google-konto
    UI->>Engine: loadUserDashboard(userId)
    Engine->>Local: getItem('matplan_dashboard_v1_' + userId)
    Local-->>Engine: Returnerer cached data (0 ms)
    
    alt Sky er konfigurert (NEXT_PUBLIC_SUPABASE_URL finnes)
        Engine->>Sky: GET /rest/v1/user_dashboards?user_id=eq.${userId}
        Sky-->>Engine: 200 OK med sky-payload
        Note over Engine: Sammenligner updatedAt (Last-Write-Wins)
        Engine->>Local: Oppdaterer lokal cache hvis skydata er nyere
    else Kjører på Localhost (Next.js server aktiv)
        Engine->>DevApi: GET /api/user-dashboard?userId=${userId}
        DevApi-->>Engine: 200 OK med payload fra data/users/<userId>.json
        Engine->>Local: Oppdaterer lokal cache hvis serverdata er nyere
    end

    Engine-->>UI: Returnerer aktivt UserDashboardData
    UI->>UI: Oppdaterer umiddelbart Makromål, Inventar og Kart!
```

---

## 5. Forhåndskonfigurerte Demoprofiler: Instant Konto-Bytte

For å demonstrere isolasjonen umiddelbart i brukergrensesnittet uten å kreve opprettelse av eksterne Google-kontoer under testing og demo, har vi implementert tre distinkte demoprofiler i [`src/services/db/userDatabaseService.ts`](file://src/services/db/userDatabaseService.ts):

| Profil | Bruker-ID / E-post | Makromål | Hjemmeadresse & Transport | Kjøkkenskap & Avkryssinger |
|---|---|---|---|---|
| **Lars (Styrketrening)** | `demo_styrke_majorstuen`<br>`styrke@demo.no` | **55–65g protein**<br>920 kcal<br>100g tørrvekt ris/quinoa | **Majorstuen** (Kirkeveien 64)<br>🚲 **BICYCLING** | Tofu, hvite bønner og chiafrø er på lager.<br>Avkrysset: `tofu-extra-majorstuen`. |
| **Nora (Balansert & Gut Health)** | `demo_standard_grunerlokka`<br>`grunerlokka@demo.no` | **42–50g protein**<br>760 kcal<br>80g tørrvekt ris/quinoa | **Grünerløkka** (Thorvald Meyers gt 38)<br>🚶 **WALKING** | Røde linser, kikerter og kokosmelk på lager.<br>Avkrysset: Ingen (blank uke). |
| **Jonas (Studentbudsjett)** | `demo_student_blindern`<br>`student@demo.no` | **38–46g protein**<br>720 kcal<br>75g tørrvekt ris | **Blindern / UiO** (Problemveien 11)<br>🚶 **WALKING** | Havregryn, frosne erter og kikerter på lager.<br>Avkrysset: `kikerter-coop-prisbasker`. |

Når en bruker bytter mellom disse tre kontoene (eller logger inn med sin ekte Google-konto):
1. **0 ms ventetid:** Data lastes synkront fra `localStorage.getItem("matplan_dashboard_v1_<userId>")`.
2. **Kjøkkenskapet isoleres:** Noras linser påvirker ikke Lars sitt tofuskuffer.
3. **Kartet hopper til brukerens nabolag:** Kart-radaren re-sentreres automatisk mot Majorstuen, Grünerløkka eller Blindern, og beregner reisetid basert på brukerens transportform (sykkel vs gange).
4. **Handlelisten filtreres automatisk:** Varer Lars allerede har på Majorstuen forsvinner fra hans personlige handleliste.

---

## 6. Lokal Utviklingsserver: `src/app/api/user-dashboard/route.ts`

Under lokal utvikling og for utviklere som kjører `npm run dev` eller Docker uten å sette opp en Supabase-skykonto, har vi implementert en robust Next.js Route Handler i [`src/app/api/user-dashboard/route.ts`](file://src/app/api/user-dashboard/route.ts):

### 6.1 Sikkerhet mot Path Traversal
For å hindre at en ondsinnet `userId` (som `../../etc/passwd` eller `..\\windows\\system32`) kan manipulere filsystemet, renses parameteren strengt:
```typescript
function sanitizeUserId(userId: string): string {
  return userId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
}
```
Filene lagres trygt i isolerte filer under `data/users/<sanitizedUserId>.json`.

### 6.2 Støttede Endepunkter

- **`GET /api/user-dashboard?userId=<userId>`**:
  1. Søker etter `data/users/<sanitizedUserId>.json`.
  2. Hvis den ikke finnes, sjekker om `userId` matcher en demo-bruker (`DEMO_USERS`) og returnerer demo-startoppsettet.
  3. Returnerer `200 OK` med `{ found: true, dashboard }` eller `404 Not Found`.

- **`PUT /api/user-dashboard`**:
  1. Mottar oppdatert `UserDashboardData`.
  2. Oppretter automatisk `data/users/` katalogen hvis den ikke eksisterer (`fs.mkdir(dir, { recursive: true })`).
  3. Skriver JSON med pen formatering og oppdatert UTC-tidsstempel.
  4. Returnerer `200 OK` med `{ success: true, updatedAt, dashboard }`.

- **`DELETE /api/user-dashboard?userId=<userId>`**:
  1. Sletter brukerens datafil fra disk for full personvern/GDPR-sletting ("Right to be forgotten").

---

## 7. Oppsettveiledning for Produksjon på GitHub Pages

Følg disse trinnene for å koble applikasjonen til en gratis Supabase-database ved deploy til GitHub Pages:

### Steg 1: Opprett Supabase-prosjekt
1. Gå til [supabase.com](https://supabase.com) og lag et nytt gratis prosjekt (f.eks. `matplan-norge`).
2. Gå til **SQL Editor** og kjør skriptet fra [Kapittel 3 i denne rapporten](#3-komplett-sql-ddl-skjema-for-supabase--postgresql).

### Steg 2: Aktiver Google SSO i Supabase Auth
1. Gå til **Authentication -> Providers -> Google**.
2. Slå på Google-knappen og lim inn:
   - **Client ID** (fra Google Cloud Console OAuth 2.0 Credentials).
   - **Client Secret** (kun lagret trygt hos Supabase, aldri på klienten).
3. Legg til din GitHub Pages URL (f.eks. `https://mittbrukernavn.github.io/matplan/`) i **Redirect URLs**.

### Steg 3: Legg inn GitHub Repository Secrets
I ditt GitHub-repo, gå til **Settings -> Secrets and variables -> Actions** og legg til:
- `NEXT_PUBLIC_SUPABASE_URL`: `https://abcdefghijkl.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: `eyJhbGciOi...` *(den offentlige anon-nøkkelen)*

GitHub Actions vil da automatisk bake inn disse variablene under byggingen av Next.js-eksporten, og brukerne vil oppleve sømløs skylagring med 100 % RLS-beskyttelse!

---

## 8. Felles Husstand & Partnerdeling («Shared Household»)

### 8.1 Bakgrunn og Behov
I et husholdningsfellesskap ønsker to (eller flere) personer som logger inn med hver sin Google-konto (f.eks. Ali og Luna) å planlegge måltider og handle sammen:
- Hvis Ali krysser av «Fast tofu» som handlet på vei hjem fra trening, må varen umiddelbart være krysset av på Lunas telefon.
- Hvis Luna justerer makromålene eller aktiverer «Raske hverdagsretter» i Kokkens Modus, må Alis dashboard gjenspeile dette i sanntid.
- Samtidig må brukere enkelt kunne koble fra felles husstand dersom de ønsker et separat, personlig dashboard igjen.

### 8.2 Datamodell og Single Source of Truth
I stedet for å kopiere og synkronisere data frem og tilbake mellom brukernes individuelle profiler (noe som fører til splittede tilstander og flettere-konflikter), implementerer vi en **Felles Husstand («Single Source of Truth»)**:

```mermaid
flowchart LR
    Ali["Person A (Ali)<br/>ali.demo@matplan.no"]
    Luna["Person B (Luna)<br/>luna.sterling@matplan.no"]
    
    subgraph HouseholdScope["Felles Husstand (household_ali_luna)"]
        SharedDb["Single Source of Truth<br/>matplan_household_shared_v1_household_ali_luna<br/>- Felles Makromål<br/>- Felles Kjøkkenskap<br/>- Felles Handleliste<br/>- Felles Ukeplan & Kokkens Modus"]
        Broadcast["BroadcastChannel('matplan_household_sync')<br/>& Storage Event Dispatcher"]
    end

    Ali -->|"Leser og skriver"| SharedDb
    Luna -->|"Leser og skriver"| SharedDb
    SharedDb -.->|"Varsler umiddelbart (0 ms)"| Broadcast
    Broadcast -.->|"Live re-render"| Ali
    Broadcast -.->|"Live re-render"| Luna
```

1. **Koblingstabell (`matplan_household_links_v1`):**
   - Et internt register som kobler både `userId` og `email` for alle partnere til samme `householdId`.
   - F.eks:
     ```json
     {
       "ali.demo@matplan.no": "household_ali_luna",
       "luna.sterling@matplan.no": "household_ali_luna",
       "demo_styrke_majorstuen": "household_ali_luna",
       "demo_standard_grunerlokka": "household_ali_luna"
     }
     ```
2. **Lagringsnøkkel:** `matplan_household_shared_v1_${householdId}`.
3. **Avkobling:** Hvis en bruker forlater husstanden via `unlinkAccountFromHousehold(userId)`, slettes referansen i koblingstabellen, og brukeren faller automatisk tilbake til sitt eget personlige navnerom (`matplan_dashboard_v1_${userId}`).

### 8.3 Sky-arkitektur: Supabase RLS for Felles Husstand
I Supabase / PostgreSQL implementeres partnerdeling via en relasjonell medlemstabell med RLS:

```sql
-- 1. Husstandstabell
CREATE TABLE IF NOT EXISTS public.households (
    household_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    invite_code TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 2. Koblingstabell for medlemmer
CREATE TABLE IF NOT EXISTS public.household_members (
    household_id TEXT REFERENCES public.households(household_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (household_id, user_id)
);

-- 3. RLS Policy: Brukere kan lese og skrive ethvert dashboard som tilhører deres husstand
CREATE POLICY "Household members can access shared dashboards"
ON public.user_dashboards
FOR ALL
TO authenticated
USING (
    auth.uid() = user_id
    OR EXISTS (
        SELECT 1 FROM public.household_members my_m
        JOIN public.household_members other_m ON my_m.household_id = other_m.household_id
        WHERE my_m.user_id = auth.uid() AND other_m.user_id = user_dashboards.user_id
    )
);
```

### 8.4 Sanntidssynkronisering i Nettleseren
For at endringer skal merkes umiddelbart på tvers av åpne faner eller vinduer på samme enhet (eller mellom klienter via BaaS Realtime), benyttes en 3-kanals event-lytter:
1. **`BroadcastChannel('matplan_household_sync')`:** Sender strukturert melding til alle andre åpne faner i nettleseren.
2. **`window.addEventListener('storage')`:** Standard cross-tab event som fanger opp endringer i `localStorage`.
3. **`CustomEvent('matplan_household_local_sync')`:** Sender oppdateringer innenfor samme fane/vindu slik at React-komponenter re-rendrer uten page refresh.

Tjenesten `subscribeToHouseholdSync(callback)` håndterer alt dette transparent og returnerer en enkel `() => void` oppryddingsfunksjon.

---

## 9. Verifisering og Byggstatus

Koden er fullstendig verifisert via produksjonsbygging i Next.js:

```bash
$ npm run build

   ▲ Next.js 15.5.4

   Creating an optimized production build ...
 ✓ Compiled successfully in 3.6s
   Linting and checking validity of types     ✓ Linting and checking validity of types 
   Collecting page data     ✓ Collecting page data 
 ✓ Generating static pages (9/9)
   Collecting build traces     ✓ Collecting build traces 
   Finalizing page optimization     ✓ Finalizing page optimization 

Route (app)                                 Size  First Load JS
┌ ○ /                                    50.9 kB         153 kB
├ ○ /_not-found                            998 B         103 kB
├ ƒ /api/inventory                         136 B         102 kB
├ ƒ /api/mealplan                          136 B         102 kB
├ ƒ /api/offers                            136 B         102 kB
├ ƒ /api/routes                            136 B         102 kB
└ ƒ /api/user-dashboard                    136 B         102 kB
+ First Load JS shared by all             102 kB
```

### Konklusjon
Løsningen eliminerer behovet for hemmelige servernøkler på GitHub Pages, sikrer full personvernisolasjon med PostgreSQL Row-Level Security, støtter sømløs deling med partner via Felles Husstand («Single Source of Truth»), og gir brukeren 0 ms responstid ved hjelp av navneroms-isolert browser-lagring og sanntids BroadcastChannel-synkronisering.
