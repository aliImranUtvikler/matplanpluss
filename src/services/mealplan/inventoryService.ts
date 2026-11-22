import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  InventoryCsvRow,
  InventoryItem,
  OfferCategory
} from '../../types/contracts';

const DATA_DIR = path.join(process.cwd(), 'data');
const INVENTORY_JSON_PATH = path.join(DATA_DIR, 'inventory.json');
const INVENTORY_CSV_PATH = path.join(DATA_DIR, 'inventory.csv');

const PUBLIC_DATA_DIR = path.join(process.cwd(), 'public', 'data');
const PUBLIC_INVENTORY_JSON_PATH = path.join(PUBLIC_DATA_DIR, 'inventory.json');

/**
 * Standard kategorisering og søkeord for kjente matvarer
 */
const DEFAULT_METADATA_MAP: Record<
  string,
  {
    category: OfferCategory;
    searchKeywords: string[];
    isCarbBase?: boolean;
    isGutHealthBooster?: boolean;
  }
> = {
  'røde linser': {
    category: 'Tørrvarer/Belgvekster',
    searchKeywords: ['røde linser', 'linser', 'belgfrukter', 'red lentils'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  'grønne linser': {
    category: 'Tørrvarer/Belgvekster',
    searchKeywords: ['grønne linser', 'linser', 'belgfrukter', 'green lentils', 'puylinser'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  'fast tofu': {
    category: 'Kjøl/Tofu',
    searchKeywords: ['tofu', 'fast tofu', 'eldorado tofu', 'naturell tofu', 'soya'],
    isCarbBase: false,
    isGutHealthBooster: false
  },
  'myk tofu': {
    category: 'Kjøl/Tofu',
    searchKeywords: ['silken tofu', 'myk tofu', 'bløt tofu', 'tofu'],
    isCarbBase: false,
    isGutHealthBooster: false
  },
  'soya chunks': {
    category: 'Tørrvarer/Belgvekster',
    searchKeywords: ['soya chunks', 'soyabiter', 'tvp', 'textured vegetable protein', 'soya'],
    isCarbBase: false,
    isGutHealthBooster: false
  },
  'trs soya mince': {
    category: 'Tørrvarer/Belgvekster',
    searchKeywords: ['trs soya mince', 'soya mince', 'soyagranulat', 'soyafarse', 'soya'],
    isCarbBase: false,
    isGutHealthBooster: false
  },
  'kikertfusilli': {
    category: 'Tørrvarer/Belgvekster',
    searchKeywords: ['kikertfusilli', 'kikertpasta', 'fusilli', 'pasta', 'glutenfri pasta'],
    isCarbBase: true,
    isGutHealthBooster: false
  },
  basmatiris: {
    category: 'Tørrvarer/Belgvekster',
    searchKeywords: ['basmatiris', 'ris', 'basmati', 'langkornet ris'],
    isCarbBase: true,
    isGutHealthBooster: false
  },
  'glutenrik ris': {
    category: 'Tørrvarer/Belgvekster',
    searchKeywords: ['glutenrik ris', 'sushiris', 'sticky rice', 'rundkornet ris'],
    isCarbBase: true,
    isGutHealthBooster: false
  },
  quinoa: {
    category: 'Tørrvarer/Belgvekster',
    searchKeywords: ['quinoa', 'hvit quinoa', 'rød quinoa', 'quinoafrø'],
    isCarbBase: true,
    isGutHealthBooster: true
  },
  næringsgjær: {
    category: 'Krydder/Sauser',
    searchKeywords: ['næringsgjær', 'nooch', 'nutritional yeast', 'gjærflak'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  'miso paste': {
    category: 'Krydder/Sauser',
    searchKeywords: ['miso paste', 'miso', 'hvit miso', 'fermentert soyapaste'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  gochujang: {
    category: 'Krydder/Sauser',
    searchKeywords: ['gochujang', 'koreansk chilipaste', 'chilipaste'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  tahini: {
    category: 'Krydder/Sauser',
    searchKeywords: ['tahini', 'sesampaste', 'sesamsmør', 'sesam'],
    isCarbBase: false,
    isGutHealthBooster: false
  },
  'rød curry paste': {
    category: 'Krydder/Sauser',
    searchKeywords: ['rød curry paste', 'red curry', 'curry paste'],
    isCarbBase: false,
    isGutHealthBooster: false
  },
  'grønn curry paste': {
    category: 'Krydder/Sauser',
    searchKeywords: ['grønn curry paste', 'green curry', 'curry paste'],
    isCarbBase: false,
    isGutHealthBooster: false
  },
  brokkoli: {
    category: 'Frukt & Grønt',
    searchKeywords: ['brokkoli', 'kålvekster', 'fersk brokkoli'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  edamamebønner: {
    category: 'Kjøl/Tofu',
    searchKeywords: ['edamame', 'edamamebønner', 'soyabønner', 'fryst edamame'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  søtpotet: {
    category: 'Frukt & Grønt',
    searchKeywords: ['søtpotet', 'sweet potato', 'rotgrønnsak'],
    isCarbBase: true,
    isGutHealthBooster: true
  },
  spinat: {
    category: 'Frukt & Grønt',
    searchKeywords: ['spinat', 'babyspinat', 'fersk spinat', 'bladgrønnsak'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  avokado: {
    category: 'Frukt & Grønt',
    searchKeywords: ['avokado', 'hass avokado', 'avocado'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  'svarte bønner': {
    category: 'Tørrvarer/Belgvekster',
    searchKeywords: ['svarte bønner', 'black beans', 'bønner hermetisk'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  kikerter: {
    category: 'Tørrvarer/Belgvekster',
    searchKeywords: ['kikerter', 'chickpeas', 'hermetiske kikerter', 'garbanzo'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  kokosmelk: {
    category: 'Krydder/Sauser',
    searchKeywords: ['kokosmelk', 'coconut milk', 'creamy coconut milk', 'kokos'],
    isCarbBase: false,
    isGutHealthBooster: false
  },
  'hakkede tomater': {
    category: 'Krydder/Sauser',
    searchKeywords: ['hakkede tomater', 'tomater hermetisk', 'knuste tomater', 'mutti tomater'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  'hvitløk & ingefær': {
    category: 'Frukt & Grønt',
    searchKeywords: ['hvitløk', 'ingefær', 'garlic', 'ginger'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  kimchi: {
    category: 'Kjøl/Tofu',
    searchKeywords: ['kimchi', 'fermentert kål', 'koreansk kimchi'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  tempeh: {
    category: 'Kjøl/Tofu',
    searchKeywords: ['tempeh', 'fermentert soya', 'økologisk tempeh'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  cashewnøtter: {
    category: 'Tørrvarer/Belgvekster',
    searchKeywords: ['cashewnøtter', 'cashews', 'usaltede cashewnøtter', 'nøtter'],
    isCarbBase: false,
    isGutHealthBooster: false
  },
  solsikkekjerner: {
    category: 'Tørrvarer/Belgvekster',
    searchKeywords: ['solsikkekjerner', 'solsikkefrø', 'sunflower seeds'],
    isCarbBase: false,
    isGutHealthBooster: false
  },
  'champignon sopp': {
    category: 'Frukt & Grønt',
    searchKeywords: ['sopp', 'champignon', 'aromasopp', 'fersk sopp'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  'paprika rød': {
    category: 'Frukt & Grønt',
    searchKeywords: ['paprika', 'rød paprika', 'snackpaprika'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  gulerøtter: {
    category: 'Frukt & Grønt',
    searchKeywords: ['gulerøtter', 'gulrot', 'norske gulerøtter'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  agurk: {
    category: 'Frukt & Grønt',
    searchKeywords: ['agurk', 'norsk agurk', 'slangeagurk'],
    isCarbBase: false,
    isGutHealthBooster: false
  },
  vårløk: {
    category: 'Frukt & Grønt',
    searchKeywords: ['vårløk', 'scallions', 'green onion'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  'fersk koriander': {
    category: 'Frukt & Grønt',
    searchKeywords: ['koriander', 'fersk koriander', 'cilantro'],
    isCarbBase: false,
    isGutHealthBooster: true
  },
  lime: {
    category: 'Frukt & Grønt',
    searchKeywords: ['lime', 'fersk lime', 'limesaft'],
    isCarbBase: false,
    isGutHealthBooster: false
  },
  sesamfrø: {
    category: 'Krydder/Sauser',
    searchKeywords: ['sesamfrø', 'hvite sesamfrø', 'ristede sesamfrø'],
    isCarbBase: false,
    isGutHealthBooster: false
  },
  'soyasaus / tamari': {
    category: 'Krydder/Sauser',
    searchKeywords: ['soyasaus', 'tamari', 'kikkoman', 'soya saus'],
    isCarbBase: false,
    isGutHealthBooster: false
  },
  riseddik: {
    category: 'Krydder/Sauser',
    searchKeywords: ['riseddik', 'rice vinegar', 'sushieddik'],
    isCarbBase: false,
    isGutHealthBooster: false
  },
  sesamolje: {
    category: 'Krydder/Sauser',
    searchKeywords: ['sesamolje', 'toasted sesame oil'],
    isCarbBase: false,
    isGutHealthBooster: false
  }
};

/**
 * Normaliserer navn til en stabil URL- og ID-vennlig slug
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Finner metadata for et matvarenavn
 */
function resolveItemMetadata(name: string): {
  category: OfferCategory;
  searchKeywords: string[];
  isCarbBase?: boolean;
  isGutHealthBooster?: boolean;
} {
  const lower = name.toLowerCase().trim();

  // Direkte eller delvis oppslag i DEFAULT_METADATA_MAP
  for (const [key, meta] of Object.entries(DEFAULT_METADATA_MAP)) {
    if (lower === key || lower.includes(key) || key.includes(lower)) {
      return meta;
    }
  }

  // Fallback heuristikk
  const isCarbBase = /ris|quinoa|pasta|fusilli|potet|nudler|havre|brød/i.test(lower);
  const isGutHealthBooster = /miso|kimchi|tempeh|gjær|ingefær|hvitløk|linser|bønner|kål/i.test(
    lower
  );

  let category: OfferCategory = 'Annet';
  if (/tofu|tempeh|edamame/i.test(lower)) {
    category = 'Kjøl/Tofu';
  } else if (/linser|bønner|ris|quinoa|pasta|kjerner|nøtter|soya/i.test(lower)) {
    category = 'Tørrvarer/Belgvekster';
  } else if (/brokkoli|spinat|avokado|paprika|sopp|agurk|løk|rot|frukt|lime|bær/i.test(lower)) {
    category = 'Frukt & Grønt';
  } else if (/paste|olje|eddik|saus|krydder|melk|tahini|gjær/i.test(lower)) {
    category = 'Krydder/Sauser';
  }

  const searchKeywords = Array.from(
    new Set([
      lower,
      ...lower
        .split(/[\s,()\/]+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 3)
    ])
  );

  return {
    category,
    searchKeywords,
    isCarbBase,
    isGutHealthBooster
  };
}

/**
 * Parser rå CSV-tekst med kolonnene: Matvare,Protein (g),Kcal,På lager
 * Støtter både komma og semikolon, quotes, og ulike boolean-representasjoner.
 */
export function parseInventoryCsv(csvContent: string): InventoryItem[] {
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  // Bestem separator basert på første linje (, eller ;)
  const headerLine = lines[0];
  const separator = headerLine.includes(';') ? ';' : ',';

  // Parse header
  const headers = headerLine.split(separator).map((h) => h.replace(/^["']|["']$/g, '').trim());

  const colIdxMatvare = headers.findIndex((h) => /matvare|navn|vare|item/i.test(h));
  const colIdxProtein = headers.findIndex((h) => /protein/i.test(h));
  const colIdxKcal = headers.findIndex((h) => /kcal|kalorier/i.test(h));
  const colIdxPaLager = headers.findIndex((h) => /på lager|pa lager|lager|in stock|instock/i.test(h));

  const items: InventoryItem[] = [];

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine || rawLine.startsWith('#')) continue;

    // Enkel CSV line parsing som tåler quotes
    const cells = parseCsvLine(rawLine, separator);
    if (cells.length < 3) continue;

    const rawName = cells[colIdxMatvare >= 0 ? colIdxMatvare : 0]?.trim();
    if (!rawName) continue;

    const rawProtein = cells[colIdxProtein >= 0 ? colIdxProtein : 1]?.trim().replace(',', '.');
    const rawKcal = cells[colIdxKcal >= 0 ? colIdxKcal : 2]?.trim().replace(',', '.');
    const rawInStock = (cells[colIdxPaLager >= 0 ? colIdxPaLager : 3] || '').trim().toLowerCase();

    const proteinPer100g = Math.max(0, parseFloat(rawProtein) || 0);
    const kcalPer100g = Math.max(0, parseFloat(rawKcal) || 0);
    const inStock = ['true', '1', 'ja', 'yes', 'y', 'på lager'].includes(rawInStock);

    const meta = resolveItemMetadata(rawName);
    const id = slugify(rawName);

    items.push({
      id,
      name: rawName,
      proteinPer100g,
      kcalPer100g,
      inStock,
      category: meta.category,
      searchKeywords: meta.searchKeywords,
      isCarbBase: meta.isCarbBase,
      isGutHealthBooster: meta.isGutHealthBooster
    });
  }

  return items;
}

/**
 * Hjelper for parsing av en enkelt CSV-linje med quotes
 */
function parseCsvLine(line: string, separator: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' || char === "'") {
      inQuotes = !inQuotes;
    } else if (char === separator && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Konverterer en liste over InventoryItem til standard CSV-tekst
 */
export function formatInventoryCsv(items: InventoryItem[]): string {
  const header = 'Matvare,Protein (g),Kcal,På lager';
  const rows = items.map((item) => {
    // Escape komma i matvarenavn hvis det finnes
    const nameCell = item.name.includes(',') ? `"${item.name}"` : item.name;
    const inStockCell = item.inStock ? 'TRUE' : 'FALSE';
    return `${nameCell},${item.proteinPer100g},${item.kcalPer100g},${inStockCell}`;
  });

  return [header, ...rows].join('\n') + '\n';
}

/**
 * Henter hele inventaret. Leser først JSON hvis tilgjengelig, ellers CSV.
 */
export async function getInventory(): Promise<InventoryItem[]> {
  try {
    const rawJson = await fs.readFile(INVENTORY_JSON_PATH, 'utf-8');
    const items = JSON.parse(rawJson) as InventoryItem[];
    if (Array.isArray(items) && items.length > 0) {
      return items;
    }
  } catch {
    // JSON fantes ikke eller var tom; fall tilbake til CSV
  }

  try {
    const rawCsv = await fs.readFile(INVENTORY_CSV_PATH, 'utf-8');
    const parsed = parseInventoryCsv(rawCsv);
    if (parsed.length > 0) {
      // Skriv JSON for fremtidige raske lesinger
      await fs.writeFile(INVENTORY_JSON_PATH, JSON.stringify(parsed, null, 2), 'utf-8');
      return parsed;
    }
  } catch {
    // CSV mangler
  }

  return [];
}

/**
 * Oppsummerer inventarstatus
 */
export async function getInventorySummary(): Promise<{
  total: number;
  inStockCount: number;
  outOfStockCount: number;
  carbBaseCount: number;
  gutHealthBoosterCount: number;
}> {
  const items = await getInventory();
  const inStockCount = items.filter((i) => i.inStock).length;
  const outOfStockCount = items.length - inStockCount;
  const carbBaseCount = items.filter((i) => i.isCarbBase).length;
  const gutHealthBoosterCount = items.filter((i) => i.isGutHealthBooster).length;

  return {
    total: items.length,
    inStockCount,
    outOfStockCount,
    carbBaseCount,
    gutHealthBoosterCount
  };
}

/**
 * Skriver inventaret konsistent til BÅDE data/inventory.json, public/data/inventory.json
 * og data/inventory.csv
 */
export async function persistInventory(items: InventoryItem[]): Promise<void> {
  const jsonContent = JSON.stringify(items, null, 2);
  const csvContent = formatInventoryCsv(items);

  // 1. data/inventory.json
  await fs.writeFile(INVENTORY_JSON_PATH, jsonContent, 'utf-8');

  // 2. data/inventory.csv
  await fs.writeFile(INVENTORY_CSV_PATH, csvContent, 'utf-8');

  // 3. public/data/inventory.json
  try {
    await fs.mkdir(PUBLIC_DATA_DIR, { recursive: true });
    await fs.writeFile(PUBLIC_INVENTORY_JSON_PATH, jsonContent, 'utf-8');
  } catch (err) {
    console.warn('Kunne ikke skrive til public/data/inventory.json:', err);
  }
}

/**
 * Oppdaterer På lager (inStock) for en enkelt vare og synkroniserer både JSON og CSV på disk
 */
export async function updateInventoryItemInStock(
  id: string,
  inStock: boolean
): Promise<InventoryItem | null> {
  const items = await getInventory();
  const targetIndex = items.findIndex(
    (item) => item.id === id || slugify(item.name) === slugify(id)
  );

  if (targetIndex === -1) {
    return null;
  }

  items[targetIndex].inStock = inStock;

  await persistInventory(items);

  return items[targetIndex];
}

/**
 * Oppdaterer På lager for flere varer samtidig
 */
export async function batchUpdateInventoryInStock(
  updates: Array<{ id: string; inStock: boolean }>
): Promise<InventoryItem[]> {
  const items = await getInventory();
  const updateMap = new Map<string, boolean>();

  for (const u of updates) {
    updateMap.set(u.id, u.inStock);
    updateMap.set(slugify(u.id), u.inStock);
  }

  for (const item of items) {
    if (updateMap.has(item.id)) {
      item.inStock = updateMap.get(item.id)!;
    } else if (updateMap.has(slugify(item.name))) {
      item.inStock = updateMap.get(slugify(item.name))!;
    }
  }

  await persistInventory(items);

  return items;
}

/**
 * Legger til en ny matvare ELLER redigerer en eksisterende matvare i inventaret.
 * Oppdaterer navn, protein per 100g, kcal per 100g, kategori, inStock, karbobase og gut health.
 * Persisterer umiddelbart til data/inventory.json, public/data/inventory.json og data/inventory.csv!
 */
export async function upsertInventoryItem(
  itemInput: Partial<InventoryItem> & {
    name: string;
    proteinPer100g: number;
    kcalPer100g: number;
    category: OfferCategory;
    inStock?: boolean;
    id?: string;
  }
): Promise<InventoryItem> {
  const items = await getInventory();
  const trimmedName = itemInput.name.trim();
  const targetId = itemInput.id ? slugify(itemInput.id) : slugify(trimmedName);

  // Finn eksisterende vare basert på ID eller normalisert navn
  const targetIndex = items.findIndex(
    (item) => item.id === targetId || slugify(item.name) === slugify(trimmedName)
  );

  const meta = resolveItemMetadata(trimmedName);

  // Bygg og slå sammen søkeord
  const providedKeywords = Array.isArray(itemInput.searchKeywords)
    ? itemInput.searchKeywords.map((k) => k.trim().toLowerCase())
    : [];

  const existingKeywords = targetIndex >= 0 ? items[targetIndex].searchKeywords : [];

  const mergedKeywords = Array.from(
    new Set([
      trimmedName.toLowerCase(),
      ...meta.searchKeywords,
      ...existingKeywords,
      ...providedKeywords
    ])
  ).filter((kw) => kw.length >= 2);

  const updatedItem: InventoryItem = {
    id: targetIndex >= 0 ? items[targetIndex].id : targetId,
    name: trimmedName,
    proteinPer100g: Number(itemInput.proteinPer100g) >= 0 ? Number(itemInput.proteinPer100g) : 0,
    kcalPer100g: Number(itemInput.kcalPer100g) >= 0 ? Number(itemInput.kcalPer100g) : 0,
    inStock:
      typeof itemInput.inStock === 'boolean'
        ? itemInput.inStock
        : targetIndex >= 0
        ? items[targetIndex].inStock
        : false,
    category: itemInput.category || (targetIndex >= 0 ? items[targetIndex].category : meta.category) || 'Annet',
    searchKeywords: mergedKeywords,
    isCarbBase:
      typeof itemInput.isCarbBase === 'boolean'
        ? itemInput.isCarbBase
        : targetIndex >= 0
        ? (items[targetIndex].isCarbBase ?? meta.isCarbBase ?? false)
        : (meta.isCarbBase ?? false),
    isGutHealthBooster:
      typeof itemInput.isGutHealthBooster === 'boolean'
        ? itemInput.isGutHealthBooster
        : targetIndex >= 0
        ? (items[targetIndex].isGutHealthBooster ?? meta.isGutHealthBooster ?? false)
        : (meta.isGutHealthBooster ?? false)
  };

  if (targetIndex >= 0) {
    items[targetIndex] = updatedItem;
  } else {
    items.push(updatedItem);
  }

  await persistInventory(items);
  return updatedItem;
}

/**
 * Fjerner en matvare fra inventaret og synkroniserer filene på disk.
 */
export async function deleteInventoryItem(id: string): Promise<boolean> {
  const items = await getInventory();
  const targetId = slugify(id);
  const targetIndex = items.findIndex(
    (item) => item.id === targetId || slugify(item.name) === targetId
  );

  if (targetIndex === -1) {
    return false;
  }

  items.splice(targetIndex, 1);
  await persistInventory(items);
  return true;
}

/**
 * Importerer CSV (fra tekst) og overskriver gjeldende inventar.
 * Bevarer egendefinerte søkeord hvis varene allerede fantes.
 */
export async function importInventoryFromCsv(csvContent: string): Promise<InventoryItem[]> {
  const existing = await getInventory();
  const existingMap = new Map(existing.map((e) => [slugify(e.name), e]));

  const newItems = parseInventoryCsv(csvContent);

  const mergedItems = newItems.map((item) => {
    const prev = existingMap.get(slugify(item.name));
    if (prev) {
      return {
        ...item,
        category: prev.category || item.category,
        searchKeywords: Array.from(new Set([...prev.searchKeywords, ...item.searchKeywords])),
        isCarbBase: prev.isCarbBase ?? item.isCarbBase,
        isGutHealthBooster: prev.isGutHealthBooster ?? item.isGutHealthBooster
      };
    }
    return item;
  });

  await persistInventory(mergedItems);

  return mergedItems;
}

/**
 * Henter CSV direkte fra en Google Sheets publisert/eksport-URL og synkroniserer inventar
 */
export async function fetchInventoryFromGoogleSheets(sheetsCsvUrl: string): Promise<InventoryItem[]> {
  let finalUrl = sheetsCsvUrl.trim();

  // Hvis URL er en vanlig Sheets visningslenke, konverter til csv eksport
  if (finalUrl.includes('docs.google.com/spreadsheets') && !finalUrl.includes('export?format=csv')) {
    finalUrl = finalUrl.replace(/\/edit.*$/, '/export?format=csv');
  }

  const response = await fetch(finalUrl, {
    headers: {
      Accept: 'text/csv, text/plain, */*'
    }
  });

  if (!response.ok) {
    throw new Error(
      `Google Sheets CSV-nedlasting feilet med status ${response.status}: ${response.statusText}`
    );
  }

  const csvContent = await response.text();
  return importInventoryFromCsv(csvContent);
}

/**
 * Eksporterer nåværende inventar som CSV-streng
 */
export async function exportInventoryToCsv(): Promise<string> {
  const items = await getInventory();
  return formatInventoryCsv(items);
}
