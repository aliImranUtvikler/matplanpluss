/**
 * Mattilbud Flyer Downloader med Ukebasert Caching & Automatisk Opprydding
 * 
 * Laster ned ALLE sidene (1 til N) i ukens ekte kundeaviser fra mattilbud.no / Tjek API for:
 * - KIWI
 * - REMA 1000
 * - Extra (Coop)
 * - MENY
 * - SPAR
 * - Joker
 * 
 * Ukebasert struktur:
 * - data/flyers/<ÅR>-W<UKE>/<kjede>/<kjede>_<ÅR>-W<UKE>_page-<N>.webp
 * - data/flyers/<ÅR>-W<UKE>/download_summary.json
 * - data/flyers/latest-week.json (peker til aktiv uke)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const DATA_FLYERS_DIR = path.join(ROOT_DIR, 'data', 'flyers');
const PUBLIC_FLYERS_DIR = path.join(ROOT_DIR, 'public', 'data', 'flyers');

const TJEK_API_KEY = 'QPq_vh';
const TJEK_API_URL = 'https://squid-api.tjek.com';
const DOWNLOAD_CONCURRENCY = 6; // Parallell nedlasting per batch

const TARGET_CHAINS = [
  { name: 'KIWI', slug: 'kiwi', expectedId: '257bxm' },
  { name: 'REMA 1000', slug: 'rema-1000', expectedId: 'faa0Ym' },
  { name: 'Extra', slug: 'extra', expectedId: '80742m' },
  { name: 'MENY', slug: 'meny', expectedId: '4333pm' },
  { name: 'SPAR', slug: 'spar', expectedId: 'c062vm' },
  { name: 'Joker', slug: 'joker', expectedId: 'b3e8Fm' }
];

export function getCurrentIsoWeek(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7; // Mandag = 1 .. Søndag = 7

  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - dayNum + 1);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  const year = date.getUTCFullYear();
  const weekKey = `${year}-W${String(weekNumber).padStart(2, '0')}`;

  return {
    weekKey,
    year,
    weekNumber,
    validFrom: monday.toISOString().slice(0, 10),
    validUntil: sunday.toISOString().slice(0, 10)
  };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'");
}

async function fetchWithRetry(url, options = {}, retries = 3) {
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,nn;q=0.7,en-US;q=0.6,en;q=0.5'
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          ...defaultHeaders,
          ...(options.headers || {})
        }
      });
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`[Retry ${attempt}/${retries}] Fetch failed for ${url}: ${err.message}`);
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

/**
 * Automatisk opprydding av gamle ukemapper (f.eks. 2026-W44, 2026-W45 hvis vi er i 2026-W46)
 */
function cleanupOldWeeks(baseDir, currentWeekKey) {
  if (!fs.existsSync(baseDir)) return;
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && /^\d{4}-W\d{2}$/.test(entry.name)) {
      if (entry.name !== currentWeekKey) {
        const oldDirPath = path.join(baseDir, entry.name);
        console.log(`🧹 [Opprydding] Sletter utgått ukemappe: ${oldDirPath}`);
        fs.rmSync(oldDirPath, { recursive: true, force: true });
      }
    }
  }
}

/**
 * Sjekker om en kjede allerede har samtlige sider i ukemappen
 */
function isChainCached(chainFolder, weekKey, chainDataDir) {
  const manifestPath = path.join(chainDataDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return false;

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (!Array.isArray(manifest.downloadedFiles) || manifest.downloadedFiles.length === 0) {
      return false;
    }
    // Sjekk at vi har alle sidene (ikke bare 4)
    if (manifest.totalPagesInFlyer && manifest.downloadedFiles.length < manifest.totalPagesInFlyer) {
      return false; // Mangler sider, må laste ned på nytt
    }
    for (const file of manifest.downloadedFiles) {
      const filePath = path.join(chainDataDir, file.fileName);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 1. Hent butikklisten fra mattilbud.no forsiden
 */
async function fetchBusinesses() {
  console.log('📡 Henter butikkoversikt fra https://mattilbud.no ...');
  const res = await fetchWithRetry('https://mattilbud.no');
  const html = await res.text();

  const match = html.match(/<app-data data-key="WyJidXNpbmVzc2VzIix7fV0="[^>]*>([\s\S]*?)<\/app-data>/);
  if (!match) {
    throw new Error('Kunne ikke finne businesses i <app-data> på mattilbud.no');
  }

  const rawJson = decodeHtmlEntities(match[1]);
  const businesses = JSON.parse(rawJson);
  console.log(`✅ Fant ${businesses.length} kjedeprofiler på mattilbud.no.`);
  return businesses;
}

/**
 * 2. Hent publikasjoner for en kjede via mattilbud.no underside eller Tjek API
 */
async function fetchChainPublications(chainSlug, chainId) {
  const chainPageUrl = `https://mattilbud.no/kundeaviser/${chainSlug.toLowerCase()}-no`;
  console.log(`🔍 Inspiserer kjedeside: ${chainPageUrl}`);

  try {
    const res = await fetchWithRetry(chainPageUrl);
    if (res.status === 200) {
      const html = await res.text();
      const regex = /<app-data data-key="([^"]+)"[^>]*>([\s\S]*?)<\/app-data>/g;
      let m;
      while ((m = regex.exec(html)) !== null) {
        let keyDecoded = '';
        try {
          keyDecoded = Buffer.from(m[1], 'base64').toString('utf-8');
        } catch {
          keyDecoded = m[1];
        }

        if (keyDecoded.includes('business') || keyDecoded.includes('publications')) {
          const raw = decodeHtmlEntities(m[2]);
          const parsed = JSON.parse(raw);
          if (parsed?.publications && Array.isArray(parsed.publications) && parsed.publications.length > 0) {
            console.log(`  ✅ Fant ${parsed.publications.length} publikasjon(er) i <app-data> på kjedesiden!`);
            return parsed.publications;
          }
        }
      }
    }
  } catch (err) {
    console.warn(`  ⚠️ Kjedeside-oppslag feilet (${err.message}), prøver direkte API-kall...`);
  }

  // Fallback: Tjek Squid API
  console.log(`  📡 Kaller Tjek Squid API for dealer_id: ${chainId} ...`);
  const apiUrls = [
    `${TJEK_API_URL}/v2/catalogs?dealer_ids=${chainId}`,
    `${TJEK_API_URL}/v2/publications?dealer_ids=${chainId}`
  ];

  for (const apiUrl of apiUrls) {
    try {
      const apiRes = await fetchWithRetry(apiUrl, {
        headers: {
          'x-api-key': TJEK_API_KEY,
          'Accept': 'application/json'
        }
      });
      if (apiRes.status === 200) {
        const data = await apiRes.json();
        if (Array.isArray(data) && data.length > 0) {
          console.log(`  ✅ Fant ${data.length} publikasjon(er) via ${apiUrl}`);
          return data;
        }
      }
    } catch (apiErr) {
      console.warn(`  ⚠️ API-kall til ${apiUrl} feilet: ${apiErr.message}`);
    }
  }

  return [];
}

/**
 * 3. Hent detaljerte sider for en spesifikk publikasjon
 */
async function fetchPublicationPages(publication) {
  const pubId = publication.id || publication.public_id;
  const pageCount = publication.page_count || publication.pages?.length || 0;

  console.log(`  📖 Analyserer publikasjon [${pubId}] (tittel: "${publication.label || publication.description || 'Ukens kundeavis'}")`);

  const pdfUrl = publication.pdf_url || publication.pdf;

  let pages = [];
  if (Array.isArray(publication.pages) && publication.pages.length > 0) {
    pages = publication.pages;
  } else {
    try {
      const pagesUrl = `${TJEK_API_URL}/v2/catalogs/${pubId}/pages`;
      const res = await fetchWithRetry(pagesUrl, {
        headers: { 'x-api-key': TJEK_API_KEY, 'Accept': 'application/json' }
      });
      if (res.status === 200) {
        pages = await res.json();
        console.log(`  ✅ Tjek API returnerte ${pages.length} sider for [${pubId}].`);
      }
    } catch (e) {
      console.warn(`  Kunne ikke hente pages fra /v2/catalogs/${pubId}/pages: ${e.message}`);
    }
  }

  const pageImages = [];
  if (Array.isArray(pages) && pages.length > 0) {
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const pageNum = i + 1;
      const imageUrl = p.view || p.zoom || p.thumb || p.url;
      if (imageUrl) {
        pageImages.push({ pageNumber: pageNum, imageUrl });
      }
    }
  } else if (pageCount > 0) {
    // Generer URLer for samtlige sider (1 til pageCount)
    for (let p = 1; p <= pageCount; p++) {
      const fallbackUrl = `https://image-transformer-api.tjek.com/?_id=v2&w=1200&u=s3%3A%2F%2Fsgn-prd-assets%2Fcatalogs%2F${pubId}%2Fpage_${p}.jpg`;
      pageImages.push({ pageNumber: p, imageUrl: fallbackUrl });
    }
  } else if (publication.images?.view || publication.images?.zoom) {
    pageImages.push({ pageNumber: 1, imageUrl: publication.images.zoom || publication.images.view });
  }

  // Hent hotspots/tilbudsmeta hvis tilgjengelig
  let hotspotsCount = 0;
  try {
    const hotspotsUrl = `${TJEK_API_URL}/v2/catalogs/${pubId}/hotspots`;
    const res = await fetchWithRetry(hotspotsUrl, {
      headers: { 'x-api-key': TJEK_API_KEY, 'Accept': 'application/json' }
    });
    if (res.status === 200) {
      const hotspots = await res.json();
      if (Array.isArray(hotspots)) {
        hotspotsCount = hotspots.length;
        console.log(`  🏷️ Fant ${hotspotsCount} tilbuds-hotspots i kundeavisen [${pubId}].`);
      }
    }
  } catch {
    // Hotspots er valgfri metadata
  }

  return {
    pubId,
    label: publication.label || publication.description || 'Kundeavis',
    runFrom: publication.run_from || publication.valid_from,
    runTill: publication.run_till || publication.valid_until,
    pdfUrl,
    pageCount: Math.max(pageCount, pageImages.length),
    hotspotsCount,
    pageImages
  };
}

/**
 * 4. Last ned en fil og lagre til disk
 */
async function downloadFile(url, destPath) {
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    throw new Error(`Feil ved nedlasting fra ${url} (HTTP ${res.status})`);
  }
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
}

/**
 * Hovedfunksjon
 */
async function main() {
  const args = process.argv.slice(2);
  const forceDownload = args.includes('--force');

  const { weekKey, year, weekNumber, validFrom, validUntil } = getCurrentIsoWeek();
  console.log(`🚀 Mattilbud Flyer Downloader starter for uke: ${weekKey} (Uke ${weekNumber}, ${validFrom} til ${validUntil})`);
  if (forceDownload) {
    console.log(`⚡ Flagget --force er aktivt: overstyrer lokal cache og laster ned ALLE sider på nytt.`);
  }

  const weekDataDir = path.join(DATA_FLYERS_DIR, weekKey);
  const weekPublicDir = path.join(PUBLIC_FLYERS_DIR, weekKey);
  ensureDir(weekDataDir);
  ensureDir(weekPublicDir);

  cleanupOldWeeks(DATA_FLYERS_DIR, weekKey);
  cleanupOldWeeks(PUBLIC_FLYERS_DIR, weekKey);

  let businesses = null;
  const summary = [];

  for (const target of TARGET_CHAINS) {
    const chainFolder = target.slug.toLowerCase();
    const chainDataDir = path.join(weekDataDir, chainFolder);
    const chainPublicDir = path.join(weekPublicDir, chainFolder);
    ensureDir(chainDataDir);
    ensureDir(chainPublicDir);

    console.log(`\n======================================================`);
    console.log(`🛒 Kjede: ${target.name} (${target.slug}) - Uke ${weekKey}`);
    console.log(`======================================================`);

    if (!forceDownload && isChainCached(chainFolder, weekKey, chainDataDir)) {
      console.log(`⚡ [Cache Hit] Samtlige kundeavis-sider for ${target.name} i ${weekKey} finnes allerede på disk!`);
      const cachedManifest = JSON.parse(fs.readFileSync(path.join(chainDataDir, 'manifest.json'), 'utf-8'));
      summary.push({
        chain: target.name,
        slug: target.slug,
        status: 'CACHED',
        publicationId: cachedManifest.publicationId,
        totalPages: cachedManifest.totalPagesInFlyer,
        filesCount: cachedManifest.downloadedFiles?.length || 0,
        downloadedFiles: cachedManifest.downloadedFiles || []
      });
      continue;
    }

    if (!businesses) {
      businesses = await fetchBusinesses();
    }

    const biz = businesses.find(b => 
      b.slug?.toLowerCase() === target.slug.toLowerCase() ||
      b.name?.toLowerCase() === target.name.toLowerCase() ||
      b.public_id === target.expectedId
    );

    const chainId = biz?.public_id || biz?.id || target.expectedId;
    const publications = await fetchChainPublications(target.slug, chainId);

    if (publications.length === 0) {
      console.warn(`⚠️ Ingen aktive publikasjoner funnet for ${target.name}.`);
      summary.push({
        chain: target.name,
        slug: target.slug,
        status: 'INGEN_PUBLIKASJONER',
        downloadedFiles: []
      });
      continue;
    }

    const primaryPub = publications[0];
    const pubDetails = await fetchPublicationPages(primaryPub);
    const downloadedFiles = [];

    // Hvis PDF finnes
    if (pubDetails.pdfUrl) {
      const pdfFileName = `${chainFolder}_${weekKey}_kundeavis.pdf`;
      const pdfDestData = path.join(chainDataDir, pdfFileName);
      const pdfDestPublic = path.join(chainPublicDir, pdfFileName);

      console.log(`  📥 Laster ned PDF fra: ${pubDetails.pdfUrl} ...`);
      try {
        await downloadFile(pubDetails.pdfUrl, pdfDestData);
        fs.copyFileSync(pdfDestData, pdfDestPublic);
        console.log(`  ✅ Lagret PDF til: ${pdfDestData}`);
        downloadedFiles.push({
          type: 'PDF',
          fileName: pdfFileName,
          localPath: pdfDestData,
          sizeBytes: fs.statSync(pdfDestData).size
        });
      } catch (err) {
        console.warn(`  ⚠️ Kunne ikke laste ned PDF (${err.message})`);
      }
    }

    // Last ned ALLE sider (1 til N) med moderat parallellitet
    const totalPagesToDownload = pubDetails.pageImages.length;
    console.log(`  📥 Laster ned samtlige ${totalPagesToDownload} sider for ${target.name} i batcher på ${DOWNLOAD_CONCURRENCY}...`);

    for (let i = 0; i < totalPagesToDownload; i += DOWNLOAD_CONCURRENCY) {
      const batch = pubDetails.pageImages.slice(i, i + DOWNLOAD_CONCURRENCY);
      await Promise.all(batch.map(async (pageItem) => {
        const ext = pageItem.imageUrl.includes('.webp') ? 'webp' : 'jpg';
        const pageFileName = `${chainFolder}_${weekKey}_page-${pageItem.pageNumber}.${ext}`;
        const pageDestData = path.join(chainDataDir, pageFileName);
        const pageDestPublic = path.join(chainPublicDir, pageFileName);

        try {
          await downloadFile(pageItem.imageUrl, pageDestData);
          fs.copyFileSync(pageDestData, pageDestPublic);
          downloadedFiles.push({
            type: 'PAGE_IMAGE',
            pageNumber: pageItem.pageNumber,
            fileName: pageFileName,
            localPath: pageDestData,
            sizeBytes: fs.statSync(pageDestData).size
          });
        } catch (err) {
          console.warn(`    ⚠️ Kunne ikke laste ned side ${pageItem.pageNumber}: ${err.message}`);
        }
      }));

      const progress = Math.min(i + DOWNLOAD_CONCURRENCY, totalPagesToDownload);
      console.log(`    Progress ${target.name}: ${progress}/${totalPagesToDownload} sider lastet ned.`);
    }

    // Sorter filene numerisk etter sidetall
    downloadedFiles.sort((a, b) => (a.pageNumber || 0) - (b.pageNumber || 0));

    // Lagre manifest
    const manifest = {
      chain: target.name,
      slug: target.slug,
      weekKey,
      chainId,
      publicationId: pubDetails.pubId,
      title: pubDetails.label,
      validFrom: pubDetails.runFrom || validFrom,
      validUntil: pubDetails.runTill || validUntil,
      totalPagesInFlyer: pubDetails.pageCount,
      hotspotsCount: pubDetails.hotspotsCount,
      downloadedAt: new Date().toISOString(),
      downloadedFiles
    };

    const manifestDataPath = path.join(chainDataDir, 'manifest.json');
    const manifestPublicPath = path.join(chainPublicDir, 'manifest.json');
    fs.writeFileSync(manifestDataPath, JSON.stringify(manifest, null, 2), 'utf-8');
    fs.copyFileSync(manifestDataPath, manifestPublicPath);

    console.log(`  ✅ Fullført ${target.name}: ${downloadedFiles.length} sider lagret.`);

    summary.push({
      chain: target.name,
      slug: target.slug,
      status: 'OK',
      publicationId: pubDetails.pubId,
      totalPages: pubDetails.pageCount,
      hotspotsCount: pubDetails.hotspotsCount,
      filesCount: downloadedFiles.length,
      downloadedFiles
    });
  }

  // 4. Skriv ukemanifest
  const totalManifest = {
    weekKey,
    year,
    weekNumber,
    validFrom,
    validUntil,
    executedAt: new Date().toISOString(),
    chains: summary
  };
  fs.writeFileSync(path.join(weekDataDir, 'download_summary.json'), JSON.stringify(totalManifest, null, 2), 'utf-8');
  fs.copyFileSync(path.join(weekDataDir, 'download_summary.json'), path.join(weekPublicDir, 'download_summary.json'));

  // 5. Oppdater rot-peker
  const latestWeekPointer = {
    weekKey,
    year,
    weekNumber,
    validFrom,
    validUntil,
    updatedAt: new Date().toISOString(),
    summaryPath: `data/flyers/${weekKey}/download_summary.json`,
    weekDir: `data/flyers/${weekKey}`
  };
  fs.writeFileSync(path.join(DATA_FLYERS_DIR, 'latest-week.json'), JSON.stringify(latestWeekPointer, null, 2), 'utf-8');
  fs.copyFileSync(path.join(DATA_FLYERS_DIR, 'latest-week.json'), path.join(PUBLIC_FLYERS_DIR, 'latest-week.json'));

  const totalPagesAllChains = summary.reduce((sum, c) => sum + (c.filesCount || 0), 0);
  console.log('\n======================================================');
  console.log(`🎉 Fullført! Totalt ${totalPagesAllChains} sider lastet ned for alle kjeder i uke ${weekKey}.`);
  console.log(`📁 Aktiv uke-mappe: ${weekDataDir}`);
  console.log(`📍 Siste-uke peker: ${path.join(DATA_FLYERS_DIR, 'latest-week.json')}`);
  console.log('======================================================');
}

main().catch(err => {
  console.error('Fatal feil i download-flyers:', err);
  process.exit(1);
});
