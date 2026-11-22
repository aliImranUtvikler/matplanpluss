import fs from 'node:fs/promises';
import path from 'node:path';
import type { OfferCategory, StoreChain } from '../src/types/contracts';
import { buildWeeklyOffersDataset } from '../src/services/offers/index';

const OUTPUT_FILE = path.join(process.cwd(), 'data', 'weekly-offers.json');

async function main() {
  console.log('================================================================');
  console.log('🌱 MATPLAN & TILBUDS-RUTING: Henter & normaliserer ukens tilbud');
  console.log('================================================================');

  const { dataset, rejectedCount, rejectedReasons } = await buildWeeklyOffersDataset();

  // Sikkerhetsvalidering før skriving til disk
  for (const offer of dataset.offers) {
    if (!offer.isVeganSafe) {
      throw new Error(`KRITISK FEIL: Ikke-vegansk/peanøtt-vare slapp gjennom: ${offer.productName}`);
    }
    if (!offer.normalizedTags || offer.normalizedTags.length === 0) {
      throw new Error(`KRITISK FEIL: Tilbud mangler normalizedTags: ${offer.productName}`);
    }
  }

  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(dataset, null, 2) + '\n', 'utf-8');

  // Statistikk per kjede
  const chainCounts: Record<StoreChain, number> = {
    REMA_1000: 0,
    KIWI: 0,
    MENY: 0,
    COOP_EXTRA: 0,
    SPAR: 0,
    JOKER: 0,
    ODA: 0
  };

  // Statistikk per kategori
  const categoryCounts: Record<OfferCategory, number> = {
    'Frukt & Grønt': 0,
    'Tørrvarer/Belgvekster': 0,
    'Kjøl/Tofu': 0,
    'Krydder/Sauser': 0,
    Annet: 0
  };

  for (const offer of dataset.offers) {
    chainCounts[offer.chain] = (chainCounts[offer.chain] ?? 0) + 1;
    categoryCounts[offer.category] = (categoryCounts[offer.category] ?? 0) + 1;
  }

  console.log(`\n✅ Uke ${dataset.weekNumber} (${dataset.year}) ferdig prosessert!`);
  console.log(`📦 Totalt godkjente tilbud (100% veganske & peanøttfrie): ${dataset.totalOffers}`);
  console.log(`🛡️  Avviste tilbud i sikkerhetsfilter: ${rejectedCount}`);
  for (const rej of rejectedReasons) {
    console.log(`   - ❌ ${rej.productName}: ${rej.reason}`);
  }

  console.log('\n🏪 Fordeling per dagligvarekjede:');
  for (const [chain, count] of Object.entries(chainCounts)) {
    console.log(`   - ${chain.padEnd(12)}: ${count} tilbud`);
  }

  console.log('\n🥦 Fordeling per matplankategori:');
  for (const [cat, count] of Object.entries(categoryCounts)) {
    console.log(`   - ${cat.padEnd(24)}: ${count} tilbud`);
  }

  console.log(`\n💾 Lagret til: ${OUTPUT_FILE}\n`);
}

main().catch((err) => {
  console.error('Feil under generering av tilbud:', err);
  process.exit(1);
});
