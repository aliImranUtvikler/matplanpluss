import { NextResponse } from 'next/server';
import type { UserMacroTargets } from '@/types/contracts';
import {
  getOrGenerateWeeklyMealPlan,
  validateMealPlanNutrition
} from '@/services/mealplan';

/**
 * GET /api/mealplan
 * Returnerer gjeldende 5-dagers ukeplan, automatisk synkronisert med nåværende
 * inventarstatus (På lager) og beriket med ukens beste butikktilbud.
 * Støtter fullt ut dynamiske makromål (`UserMacroTargets`):
 * Query-parametere:
 * - servings: antall porsjoner per måltid (default 2)
 * - minProtein: minimum protein per person (f.eks. 45)
 * - maxProtein: maksimum protein per person (f.eks. 55)
 * - maxKcal: maks kalorier per person (f.eks. 800)
 * - carbGrams: karbohydratbase tørrvekt i gram (f.eks. 85)
 * - minPlantCount: min antall planter for gut health (default 6)
 * - dietaryNote: valgfritt notat
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const servingsParam = searchParams.get('servings');
    const minProteinParam = searchParams.get('minProtein');
    const maxProteinParam = searchParams.get('maxProtein');
    const maxKcalParam = searchParams.get('maxKcal');
    const carbGramsParam = searchParams.get('carbGrams');
    const minPlantCountParam = searchParams.get('minPlantCount');
    const dietaryNote = searchParams.get('dietaryNote') ?? undefined;

    const macroTargets: Partial<UserMacroTargets> = {};

    if (servingsParam) macroTargets.servings = Math.max(1, parseInt(servingsParam, 10));
    if (minProteinParam) macroTargets.minProteinGrams = Math.max(20, parseFloat(minProteinParam));
    if (maxProteinParam) macroTargets.maxProteinGrams = Math.max(30, parseFloat(maxProteinParam));
    if (maxKcalParam) macroTargets.maxKcal = Math.max(400, parseFloat(maxKcalParam));
    if (carbGramsParam) macroTargets.targetCarbDryWeightGrams = Math.max(40, parseFloat(carbGramsParam));
    if (minPlantCountParam) macroTargets.minPlantCount = Math.max(4, parseInt(minPlantCountParam, 10));
    if (dietaryNote) macroTargets.dietaryNote = dietaryNote;

    const mealPlan = await getOrGenerateWeeklyMealPlan({
      forceRegenerate: false,
      servingsPerMeal: macroTargets.servings ?? 2,
      macroTargets
    });

    const validation = validateMealPlanNutrition(mealPlan.days);

    return NextResponse.json(
      {
        mealPlan,
        validation,
        macroTargetsApplied: macroTargets
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Kunne ikke hente matplan',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mealplan
 * Genererer eller rekalkulerer en 5-dagers ukeplan basert på nåværende inventar,
 * ukens tilbud og brukerens dynamiske makromål (`UserMacroTargets`).
 * Hvis GEMINI_API_KEY er satt, kalles Gemini 2.5 Flash med Structured JSON Output.
 * Hvis ikke, brukes den deterministiske motoren tilpasset gjeldende inventar.
 * Body parametere:
 * - forceRegenerate: boolean (default true ved POST)
 * - customPrompt: string (valgfri instruks, f.eks. "Mer asiatisk", "Ekstra raske retter")
 * - servings: number (default 2)
 * - macroTargets: Partial<UserMacroTargets>
 */
export async function POST(request: Request) {
  try {
    let body: {
      forceRegenerate?: boolean;
      customPrompt?: string;
      servings?: number;
      macroTargets?: Partial<UserMacroTargets>;
    } = {};

    try {
      body = await request.json();
    } catch {
      // Tom body er tillatt
    }

    const macroTargets: Partial<UserMacroTargets> = { ...(body?.macroTargets || {}) };
    if (typeof body?.servings === 'number' && body.servings > 0) {
      macroTargets.servings = body.servings;
    }

    const servings = macroTargets.servings ?? 2;
    const forceRegenerate = body?.forceRegenerate !== false; // Default true ved POST
    const customPrompt = typeof body?.customPrompt === 'string' ? body.customPrompt : undefined;

    const mealPlan = await getOrGenerateWeeklyMealPlan({
      forceRegenerate,
      customPrompt,
      servingsPerMeal: servings,
      macroTargets
    });

    const validation = validateMealPlanNutrition(mealPlan.days);

    return NextResponse.json(
      {
        message: 'Ny ukeplan kalkulert og lagret med dynamiske makromål',
        mealPlan,
        validation,
        macroTargetsApplied: macroTargets
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Kunne ikke generere ny ukeplan',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
