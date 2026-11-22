import fs from 'node:fs/promises';
import path from 'node:path';
import type { UserMacroTargets } from '../src/types/contracts';
import {
  DEFAULT_USER_MACRO_TARGETS,
  executeFullWeeklyPipeline
} from '../src/services/pipeline/orchestratorPipeline';

/**
 * Enkel parser for CLI-argumenter (f.eks. --minProtein=45 --maxProtein=55 --maxKcal=800 --carbGrams=85 --servings=2 --trigger=CRON_SCHEDULE)
 */
function parseCliArgs(): {
  macroTargets: Partial<UserMacroTargets>;
  trigger: 'CRON_SCHEDULE' | 'MANUAL_DISPATCH' | 'DYNAMIC_MACRO_REFRESH';
  forceDeterministic: boolean;
  forceGemini: boolean;
} {
  const args = process.argv.slice(2);
  const macroTargets: Partial<UserMacroTargets> = {};
  let trigger: 'CRON_SCHEDULE' | 'MANUAL_DISPATCH' | 'DYNAMIC_MACRO_REFRESH' = 'MANUAL_DISPATCH';
  let forceDeterministic = false;
  let forceGemini = false;

  for (const arg of args) {
    if (arg.startsWith('--minProtein=')) {
      const val = parseFloat(arg.split('=')[1]);
      if (!isNaN(val)) macroTargets.minProteinGrams = val;
    } else if (arg.startsWith('--maxProtein=')) {
      const val = parseFloat(arg.split('=')[1]);
      if (!isNaN(val)) macroTargets.maxProteinGrams = val;
    } else if (arg.startsWith('--maxKcal=')) {
      const val = parseFloat(arg.split('=')[1]);
      if (!isNaN(val)) macroTargets.maxKcal = val;
    } else if (arg.startsWith('--carbGrams=')) {
      const val = parseFloat(arg.split('=')[1]);
      if (!isNaN(val)) macroTargets.targetCarbDryWeightGrams = val;
    } else if (arg.startsWith('--servings=')) {
      const val = parseInt(arg.split('=')[1], 10);
      if (!isNaN(val)) macroTargets.servings = val;
    } else if (arg.startsWith('--trigger=')) {
      const t = arg.split('=')[1].toUpperCase();
      if (t === 'CRON_SCHEDULE' || t === 'MANUAL_DISPATCH' || t === 'DYNAMIC_MACRO_REFRESH') {
        trigger = t;
      }
    } else if (arg === '--force-deterministic') {
      forceDeterministic = true;
    } else if (arg === '--force-gemini') {
      forceGemini = true;
    }
  }

  return { macroTargets, trigger, forceDeterministic, forceGemini };
}

async function verifyFileExists(filePath: string, label: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    console.log(`   ✅ ${label.padEnd(26)}: ${filePath} (${stat.size} bytes)`);
    return stat.size;
  } catch (err) {
    console.error(`   ❌ MANGLER FIL: ${filePath}`);
    throw new Error(`Kritisk fil mangler: ${filePath}`);
  }
}

async function main() {
  console.log('========================================================================');
  console.log('🚀 AUTOMATISK 3-TRINNS AI VISION PIPELINE FOR MATPLAN & TILBUD');
  console.log('========================================================================');

  const { macroTargets, trigger, forceDeterministic, forceGemini } = parseCliArgs();

  console.log(`\n📋 Kjøremodus: ${trigger}`);
  if (Object.keys(macroTargets).length > 0) {
    console.log('🎯 Innsendte dynamiske makromål:');
    for (const [k, v] of Object.entries(macroTargets)) {
      console.log(`   - ${k}: ${v}`);
    }
  } else {
    console.log('🎯 Bruker standard makromål (40-50g protein, maks 780 kcal, 80g tørrvekt karb).');
  }

  console.log('\n⏳ Starter utførelse av de 3 stegene...\n');

  const result = await executeFullWeeklyPipeline({
    trigger,
    macroTargets,
    forceDeterministicOffers: forceDeterministic,
    forceGeminiMealPlan: forceGemini
  });

  const { manifest, offersDataset, mealPlanResponse, routeResponse } = result;

  console.log('------------------------------------------------------------------------');
  console.log('📄 STEG 1 RESULTAT: Side-for-Side AI Vision-skanner');
  console.log('------------------------------------------------------------------------');
  console.log(`   - Kjede-dekning: ${manifest.stage1_flyerScanner.chainsScanned.join(', ')}`);
  console.log(`   - Sider analysert: ${manifest.stage1_flyerScanner.pagesScannedCount} kundeavis-sider`);
  console.log(`   - Totalt godkjente tilbud: ${manifest.stage1_flyerScanner.totalOffersExtracted} (100% veganske & peanøttfrie)`);
  console.log(`   - Avviste usikre/ikke-veganske varer: ${manifest.stage1_flyerScanner.rejectedUnsafeItems}`);

  console.log('\n------------------------------------------------------------------------');
  console.log('🥗 STEG 2 RESULTAT: Matplan-Task med Dynamiske Makroer');
  console.log('------------------------------------------------------------------------');
  console.log(`   - Dager generert: ${manifest.stage2_mealPlanTask.daysGenerated} middager`);
  console.log(`   - Gjennomsnittlig protein: ${manifest.stage2_mealPlanTask.avgProteinGrams} g/pers per middag`);
  console.log(`   - Gjennomsnittlig energi: ${manifest.stage2_mealPlanTask.avgKcal} kcal/pers per middag`);
  console.log(`   - Varer på handlelisten: ${manifest.stage2_mealPlanTask.shoppingListCount}`);
  console.log(`   - Varer benyttet fra eget lager: ${manifest.stage2_mealPlanTask.pantryItemsUsedCount}`);

  console.log('\n------------------------------------------------------------------------');
  console.log('📍 STEG 3 RESULTAT: Kart & Butikkrute-Task');
  console.log('------------------------------------------------------------------------');
  console.log(`   - Fysiske butikker evaluert: ${manifest.stage3_mapRouterTask.storesEvaluatedCount}`);
  console.log(`   - Beste enkeltbutikk: ${manifest.stage3_mapRouterTask.bestSingleStoreName}`);
  console.log(`     Adresse: ${manifest.stage3_mapRouterTask.bestSingleStoreAddress}`);
  console.log(`     Estimert besparelse: ${manifest.stage3_mapRouterTask.bestSingleStoreSavingsNok} kr`);

  if (manifest.stage3_mapRouterTask.bestComboStores) {
    console.log(`   - Anbefalt Kombi-rute (2 butikker):`);
    console.log(`     1. ${manifest.stage3_mapRouterTask.bestComboStores[0]}`);
    console.log(`     2. ${manifest.stage3_mapRouterTask.bestComboStores[1]}`);
    console.log(`     Samlet besparelse: ${manifest.stage3_mapRouterTask.bestComboSavingsNok} kr`);
    if (routeResponse.bestComboRoute) {
      console.log(`     Mindrepris vs enkeltbutikk: +${routeResponse.bestComboRoute.additionalSavingsVsSingleStoreNok} kr ekstra spart!`);
      console.log(`     Reisetid: ${routeResponse.bestComboRoute.totalTravelTimeMinutes} min (+${routeResponse.bestComboRoute.extraTravelTimeMinutes} min omvei)`);
    }
  }

  console.log('\n------------------------------------------------------------------------');
  console.log('💾 DISK & EXPORT VERIFISERING (Både data/ og public/data/)');
  console.log('------------------------------------------------------------------------');
  const filesToVerify = [
    { p: path.join(process.cwd(), 'data', 'weekly-offers.json'), label: 'data/weekly-offers.json' },
    { p: path.join(process.cwd(), 'public', 'data', 'weekly-offers.json'), label: 'public/data/weekly-offers' },
    { p: path.join(process.cwd(), 'data', 'default-mealplan.json'), label: 'data/default-mealplan.json' },
    { p: path.join(process.cwd(), 'public', 'data', 'default-mealplan.json'), label: 'public/data/mealplan' },
    { p: path.join(process.cwd(), 'data', 'inventory.json'), label: 'data/inventory.json' },
    { p: path.join(process.cwd(), 'public', 'data', 'inventory.json'), label: 'public/data/inventory' },
    { p: path.join(process.cwd(), 'data', 'routes-cache.json'), label: 'data/routes-cache.json' },
    { p: path.join(process.cwd(), 'public', 'data', 'routes-cache.json'), label: 'public/data/routes-cache' },
    { p: path.join(process.cwd(), 'data', 'pipeline-manifest.json'), label: 'data/manifest.json' },
    { p: path.join(process.cwd(), 'public', 'data', 'pipeline-manifest.json'), label: 'public/data/manifest' }
  ];

  for (const item of filesToVerify) {
    await verifyFileExists(item.p, item.label);
  }

  console.log('\n🎉 HELE PIPELINEN FULLFØRT MED SUKSESS!');
  console.log(`   Pipeline Run ID: ${manifest.pipelineRunId}`);
  console.log(`   Fullført på: ${(new Date(manifest.completedAt).getTime() - new Date(manifest.startedAt).getTime())} ms\n`);
}

main().catch((err) => {
  console.error('\n❌ PIPELINE-FEIL:', err);
  process.exit(1);
});
