import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import type { UserDashboardData } from '@/services/db';
import { DEMO_USERS, createDefaultUserDashboard } from '@/services/db';

/**
 * Renser en ID for å forhindre path traversal angrep (f.eks. ../ eller /etc/)
 */
function sanitizeId(rawId: string): string {
  return rawId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Henter filstier for brukerdashboard og felles husstander
 */
function getUserFilePath(sanitizedId: string): { dirPath: string; filePath: string } {
  const dirPath = path.join(process.cwd(), 'data', 'users');
  const filePath = path.join(dirPath, `${sanitizedId}.json`);
  return { dirPath, filePath };
}

function getHouseholdFilePath(sanitizedHouseholdId: string): { dirPath: string; filePath: string } {
  const dirPath = path.join(process.cwd(), 'data', 'households');
  const filePath = path.join(dirPath, `${sanitizedHouseholdId}.json`);
  return { dirPath, filePath };
}

function getHouseholdLinksPath(): string {
  return path.join(process.cwd(), 'data', 'households', 'links.json');
}

async function readHouseholdLinks(): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(getHouseholdLinksPath(), 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function writeHouseholdLinks(links: Record<string, string>): Promise<void> {
  const dirPath = path.join(process.cwd(), 'data', 'households');
  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(getHouseholdLinksPath(), JSON.stringify(links, null, 2), 'utf-8');
}

/**
 * GET /api/user-dashboard?userId=<userId>&householdId=<householdId>
 * Henter brukerens eller felles husstands lagrede dashboard.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const householdIdParam = searchParams.get('householdId');

    // 1. Hvis householdId er eksplisitt oppgitt, les husstandens fellesfil
    if (householdIdParam && householdIdParam.trim()) {
      const sanitizedHhId = sanitizeId(householdIdParam);
      const { filePath } = getHouseholdFilePath(sanitizedHhId);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const dashboard = JSON.parse(content) as UserDashboardData;
        return NextResponse.json(
          { found: true, source: 'SHARED_HOUSEHOLD_FILE', dashboard },
          { status: 200 }
        );
      } catch {
        // Fortsett hvis ikke funnet
      }
    }

    if (!userId || !userId.trim()) {
      return NextResponse.json(
        { error: "Påkrevd parameter 'userId' eller 'householdId' mangler" },
        { status: 400 }
      );
    }

    const sanitizedUserId = sanitizeId(userId);

    // 2. Sjekk om brukeren er knyttet til en husstand på serveren
    const links = await readHouseholdLinks();
    const linkedHouseholdId = links[userId.toLowerCase()] || links[sanitizedUserId];
    if (linkedHouseholdId) {
      const { filePath } = getHouseholdFilePath(sanitizeId(linkedHouseholdId));
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const dashboard = JSON.parse(content) as UserDashboardData;
        return NextResponse.json(
          { found: true, source: 'SHARED_HOUSEHOLD_LINK', dashboard },
          { status: 200 }
        );
      } catch {
        // Fall igjennom til personlig fil hvis husstandsfilen mangler
      }
    }

    // 3. Forsøk å lese fra lokal personlig JSON-fil
    const { filePath } = getUserFilePath(sanitizedUserId);
    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const dashboard = JSON.parse(fileContent) as UserDashboardData;
      return NextResponse.json(
        {
          found: true,
          source: 'LOCAL_USER_FILE',
          dashboard
        },
        { status: 200 }
      );
    } catch {
      // Fil finnes ikke på disk
    }

    // 4. Sjekk om det matcher en kjent demo-bruker
    for (const demoProfile of Object.values(DEMO_USERS)) {
      if (demoProfile.id === userId || demoProfile.email.toLowerCase() === userId.toLowerCase()) {
        const demoData = demoProfile.defaultData;
        return NextResponse.json(
          {
            found: true,
            source: 'DEMO_SEED',
            dashboard: demoData
          },
          { status: 200 }
        );
      }
    }

    // 5. Fallback: Returner 404
    return NextResponse.json(
      {
        found: false,
        message: `Ingen lagret dashboard funnet for bruker '${userId}'`
      },
      { status: 404 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Feil ved henting av brukerdashboard',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/user-dashboard
 * Lagrer eller oppdaterer en brukers eller en felles husstands dashboard på disk.
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const dashboard: UserDashboardData = body?.dashboard || body;
    const explicitHouseholdId: string | undefined = body?.householdId;

    if (!dashboard || !dashboard.userId) {
      return NextResponse.json(
        { error: "Ugyldig forespørsel. Forventet 'dashboard' objekt med 'userId'" },
        { status: 400 }
      );
    }

    const payloadToSave: UserDashboardData = {
      ...dashboard,
      updatedAt: new Date().toISOString()
    };

    const targetHouseholdId = explicitHouseholdId || dashboard.household?.householdId;

    // 1. Hvis dette gjelder en felles husstand, lagre i data/households/<id>.json
    if (targetHouseholdId) {
      const sanitizedHhId = sanitizeId(targetHouseholdId);
      const { dirPath, filePath } = getHouseholdFilePath(sanitizedHhId);
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(payloadToSave, null, 2), 'utf-8');

      // Oppdater links.json for alle medlemmer
      const links = await readHouseholdLinks();
      links[dashboard.userId.toLowerCase()] = targetHouseholdId;
      if (dashboard.email) links[dashboard.email.toLowerCase()] = targetHouseholdId;
      if (dashboard.household?.memberEmails) {
        for (const email of dashboard.household.memberEmails) {
          links[email.toLowerCase()] = targetHouseholdId;
        }
      }
      await writeHouseholdLinks(links);
    }

    // 2. Lagre også i data/users/<sanitizedUserId>.json for lokal offline backup
    const sanitizedUserId = sanitizeId(dashboard.userId);
    const { dirPath: userDir, filePath: userFilePath } = getUserFilePath(sanitizedUserId);
    await fs.mkdir(userDir, { recursive: true });
    await fs.writeFile(userFilePath, JSON.stringify(payloadToSave, null, 2), 'utf-8');

    return NextResponse.json(
      {
        success: true,
        message: targetHouseholdId
          ? `Felles husstand '${targetHouseholdId}' oppdatert på disk`
          : `Dashboard for bruker '${sanitizedUserId}' ble lagret på disk`,
        updatedAt: payloadToSave.updatedAt,
        dashboard: payloadToSave
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Kunne ikke lagre brukerdashboard til disk',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/user-dashboard?userId=<userId>
 * Sletter brukerens lagrede JSON-fil på disk (nullstilling av profil).
 */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId || !userId.trim()) {
      return NextResponse.json(
        { error: "Påkrevd parameter 'userId' mangler" },
        { status: 400 }
      );
    }

    const sanitizedId = sanitizeId(userId);
    const { filePath } = getUserFilePath(sanitizedId);

    // Fjern også eventuell kobling i links.json
    try {
      const links = await readHouseholdLinks();
      delete links[userId.toLowerCase()];
      delete links[sanitizedId];
      await writeHouseholdLinks(links);
    } catch {
      // Ignorer
    }

    try {
      await fs.unlink(filePath);
      return NextResponse.json(
        {
          success: true,
          message: `Brukerdashboard for '${sanitizedId}' ble slettet`
        },
        { status: 200 }
      );
    } catch {
      return NextResponse.json(
        {
          success: false,
          message: `Filen for '${sanitizedId}' eksisterte ikke på disk`
        },
        { status: 404 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Feil ved sletting av brukerdashboard',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
