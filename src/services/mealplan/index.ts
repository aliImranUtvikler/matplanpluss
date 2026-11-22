export {
  CHEF_CATALOG_RECIPES,
  cleanSlug,
  DEFAULT_USER_MACRO_TARGETS,
  detectCuisineStyle,
  getIngredientNutritionPer100g,
  scaleMealPlanToMacroTargets,
  selectAndAdjustDaysForChefModes
} from './dynamicMacroScaler';

export {
  batchUpdateInventoryInStock,
  deleteInventoryItem,
  exportInventoryToCsv,
  fetchInventoryFromGoogleSheets,
  formatInventoryCsv,
  getInventory,
  getInventorySummary,
  importInventoryFromCsv,
  parseInventoryCsv,
  persistInventory,
  slugify,
  updateInventoryItemInStock,
  upsertInventoryItem
} from './inventoryService';

export {
  buildShoppingListAndPantry,
  buildWeeklyMealPlanResponse,
  callGeminiMealPlanGenerator,
  CURATED_5_DAY_MEAL_PLAN,
  GEMINI_MEALPLAN_RESPONSE_SCHEMA,
  getOrGenerateWeeklyMealPlan,
  MEAL_PLAN_NUTRITION_RULES,
  synchronizeMealPlanWithInventory,
  validateMealPlanNutrition
} from './geminiMealPlanner';
