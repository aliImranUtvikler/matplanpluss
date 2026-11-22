import { NextResponse } from 'next/server';
import type { InventoryItem, OfferCategory } from '@/types/contracts';
import {
  batchUpdateInventoryInStock,
  deleteInventoryItem,
  exportInventoryToCsv,
  fetchInventoryFromGoogleSheets,
  getInventory,
  getInventorySummary,
  importInventoryFromCsv,
  updateInventoryItemInStock,
  upsertInventoryItem
} from '@/services/mealplan';

/**
 * GET /api/inventory
 * Henter inventar og oppsummering.
 * Query-parametere:
 * - inStock: 'true' | 'false' (valgfri filtrering)
 * - category: OfferCategory (valgfri filtrering)
 * - format: 'csv' | 'json' (default 'json', 'csv' laster ned inventory.csv)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const inStockParam = searchParams.get('inStock');
    const categoryParam = searchParams.get('category') as OfferCategory | null;
    const formatParam = searchParams.get('format');

    if (formatParam === 'csv') {
      const csvData = await exportInventoryToCsv();
      return new NextResponse(csvData, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="inventory.csv"'
        }
      });
    }

    let items = await getInventory();

    if (inStockParam !== null) {
      const targetStock = inStockParam.toLowerCase() === 'true';
      items = items.filter((item) => item.inStock === targetStock);
    }

    if (categoryParam) {
      items = items.filter((item) => item.category === categoryParam);
    }

    const summary = await getInventorySummary();

    return NextResponse.json(
      {
        summary,
        totalItems: items.length,
        items
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Kunne ikke hente inventar',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/inventory
 * Oppdaterer På lager (inStock) for en enkelt vare eller batch.
 * Eksempel body:
 * { "id": "fast-tofu", "inStock": true }
 * ELLER
 * { "updates": [{ "id": "fast-tofu", "inStock": true }, { "id": "spinat", "inStock": false }] }
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();

    if (Array.isArray(body?.updates)) {
      const updatedItems = await batchUpdateInventoryInStock(body.updates);
      const summary = await getInventorySummary();
      return NextResponse.json(
        {
          message: `${body.updates.length} varer oppdatert`,
          summary,
          items: updatedItems
        },
        { status: 200 }
      );
    }

    if (body?.id && typeof body?.inStock === 'boolean') {
      const updatedItem = await updateInventoryItemInStock(body.id, body.inStock);
      if (!updatedItem) {
        return NextResponse.json(
          { error: `Matvare med ID eller navn '${body.id}' ble ikke funnet` },
          { status: 404 }
        );
      }

      const summary = await getInventorySummary();
      return NextResponse.json(
        {
          message: `Oppdaterte lagerstatus for ${updatedItem.name}`,
          updatedItem,
          summary
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { error: "Ugyldig forespørsel. Forventet '{ id: string, inStock: boolean }' eller '{ updates: [...] }'" },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Kunne ikke oppdatere inventar',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/inventory
 * Legger til en ny matvare ELLER oppdaterer en eksisterende matvare (navn, protein, kcal, kategori, etc.)
 * og persisterer endringene direkte til data/inventory.json, public/data/inventory.json og data/inventory.csv.
 * Body: { item: { id?, name, proteinPer100g, kcalPer100g, category, inStock, isCarbBase, isGutHealthBooster } }
 * ELLER direkte: { id?, name, proteinPer100g, kcalPer100g, category, inStock, isCarbBase, isGutHealthBooster }
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const itemPayload = (body?.item || body) as Partial<InventoryItem> & {
      name?: string;
      proteinPer100g?: number;
      kcalPer100g?: number;
      category?: OfferCategory;
    };

    if (!itemPayload?.name || typeof itemPayload.name !== 'string' || itemPayload.name.trim().length === 0) {
      return NextResponse.json(
        { error: "Feltet 'name' er påkrevd for å legge til eller oppdatere en matvare" },
        { status: 400 }
      );
    }

    const savedItem = await upsertInventoryItem({
      ...itemPayload,
      name: itemPayload.name.trim(),
      proteinPer100g: Number(itemPayload.proteinPer100g) || 0,
      kcalPer100g: Number(itemPayload.kcalPer100g) || 0,
      category: itemPayload.category || 'Annet'
    });

    const items = await getInventory();
    const summary = await getInventorySummary();

    return NextResponse.json(
      {
        message: `Matvare '${savedItem.name}' er lagret og persistert til CSV og JSON`,
        item: savedItem,
        items,
        summary
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Kunne ikke oppdatere eller opprette matvare',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/inventory
 * Støtter:
 * 1. Upsert: { action: 'upsert', item: { id?, name, proteinPer100g, kcalPer100g, category, ... } }
 * 2. Slett: { action: 'delete', id: 'vare-id' }
 * 3. Import CSV: { csvContent: 'Matvare,Protein (g),Kcal,På lager\n...' }
 * 4. Google Sheets Sync: { sheetsUrl: 'https://docs.google.com/...' }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // 1. Upsert matvare
    if (body?.action === 'upsert' || body?.item) {
      const itemPayload = (body.item || body) as Partial<InventoryItem> & {
        name?: string;
        proteinPer100g?: number;
        kcalPer100g?: number;
        category?: OfferCategory;
      };

      if (!itemPayload?.name || typeof itemPayload.name !== 'string' || itemPayload.name.trim().length === 0) {
        return NextResponse.json(
          { error: "Feltet 'name' er påkrevd for å legge til eller oppdatere en matvare" },
          { status: 400 }
        );
      }

      const savedItem = await upsertInventoryItem({
        ...itemPayload,
        name: itemPayload.name.trim(),
        proteinPer100g: Number(itemPayload.proteinPer100g) || 0,
        kcalPer100g: Number(itemPayload.kcalPer100g) || 0,
        category: itemPayload.category || 'Annet'
      });

      const items = await getInventory();
      const summary = await getInventorySummary();

      return NextResponse.json(
        {
          message: `Matvare '${savedItem.name}' lagret og persistert`,
          item: savedItem,
          items,
          summary
        },
        { status: 200 }
      );
    }

    // 2. Slett matvare
    if (body?.action === 'delete' && body?.id) {
      const deleted = await deleteInventoryItem(String(body.id));
      if (!deleted) {
        return NextResponse.json(
          { error: `Matvare med ID eller navn '${body.id}' ble ikke funnet` },
          { status: 404 }
        );
      }

      const items = await getInventory();
      const summary = await getInventorySummary();

      return NextResponse.json(
        {
          message: `Matvare '${body.id}' er slettet fra CSV og JSON`,
          id: body.id,
          items,
          summary
        },
        { status: 200 }
      );
    }

    // 3. Google Sheets Sync
    if (body?.sheetsUrl && typeof body.sheetsUrl === 'string') {
      const items = await fetchInventoryFromGoogleSheets(body.sheetsUrl);
      const summary = await getInventorySummary();
      return NextResponse.json(
        {
          message: 'Inventar synkronisert fra Google Sheets',
          summary,
          items
        },
        { status: 200 }
      );
    }

    // 4. CSV Import
    if (body?.csvContent && typeof body.csvContent === 'string') {
      const items = await importInventoryFromCsv(body.csvContent);
      const summary = await getInventorySummary();
      return NextResponse.json(
        {
          message: 'Inventar importert fra CSV og persistert til JSON',
          summary,
          items
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        error:
          "Ugyldig forespørsel. Oppgi enten '{ action: 'upsert', item: {...} }', '{ action: 'delete', id: '...' }', 'csvContent' eller 'sheetsUrl'"
      },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Kunne ikke behandle inventar-forespørsel',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/inventory?id=<id>
 * Sletter en matvare fra data/inventory.json, public/data/inventory.json og data/inventory.csv.
 */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    let targetId = searchParams.get('id');

    if (!targetId) {
      try {
        const body = await request.json();
        targetId = body?.id;
      } catch {
        // Ignorer feil ved tom body
      }
    }

    if (!targetId || typeof targetId !== 'string') {
      return NextResponse.json(
        { error: "Påkrevd parameter 'id' mangler i query string eller body" },
        { status: 400 }
      );
    }

    const deleted = await deleteInventoryItem(targetId);
    if (!deleted) {
      return NextResponse.json(
        { error: `Matvare med ID eller navn '${targetId}' ble ikke funnet` },
        { status: 404 }
      );
    }

    const items = await getInventory();
    const summary = await getInventorySummary();

    return NextResponse.json(
      {
        message: `Matvare '${targetId}' er slettet fra CSV og JSON`,
        id: targetId,
        items,
        summary
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Kunne ikke slette matvare',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
