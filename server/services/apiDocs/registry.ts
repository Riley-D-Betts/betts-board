import type { ZodType } from 'zod'
import { z } from 'zod'
import { apiKeyCreateSchema } from '#shared/schemas/apiKeys'
import { setupSchema, switchProfileSchema, unlockSchema } from '#shared/schemas/auth'
import {
  choreBoardQuerySchema, choreCompleteSchema, choreCreateSchema, chorePatchSchema,
  leaderboardQuerySchema,
} from '#shared/schemas/chores'
import {
  calendarQuerySchema, eventCreateSchema, eventDeleteSchema, eventPatchSchema,
  feedCreateSchema, feedPatchSchema,
} from '#shared/schemas/events'
import { feedbackCreateSchema, feedbackSettingsSchema } from '#shared/schemas/feedback'
import { householdPatchSchema } from '#shared/schemas/household'
import { mealEntryCreateSchema, mealEntryPatchSchema, mealPlanQuerySchema } from '#shared/schemas/meals'
import { barcodeManualSchema, pantryItemCreateSchema, pantryItemPatchSchema, pantryQuerySchema } from '#shared/schemas/pantry'
import { photoListQuerySchema, photoPatchSchema } from '#shared/schemas/photos'
import { profileCreateSchema, profilePatchSchema } from '#shared/schemas/profiles'
import { pushSubscribeSchema, pushUnsubscribeSchema } from '#shared/schemas/push'
import {
  recipeCreateSchema, recipeImportSchema, recipeListQuerySchema, recipeNoteCreateSchema,
  recipePatchSchema, recipeRatingSchema,
} from '#shared/schemas/recipes'
import { redeemSchema, rewardCreateSchema, rewardPatchSchema } from '#shared/schemas/rewards'
import {
  addFromRecipeSchema, clearCheckedSchema, generateFromMealPlanSchema,
  shoppingItemCreateSchema, shoppingItemPatchSchema, shoppingListCreateSchema,
  shoppingListPatchSchema,
} from '#shared/schemas/shopping'

// The single source of truth for the OpenAPI document served at
// /api/openapi.json. EVERY server route (server/api/** and server/routes/**)
// must have an entry here — tests/unit/openapi.spec.ts diffs this table
// against the real route files and fails on any drift, in either direction.

export type AuthLevel = 'public' | 'unlocked' | 'profile' | 'admin'
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

export const TAGS = {
  Auth: 'Unlocking, locking, and switching the acting profile.',
  Household: 'The single household: name, timezone, location, settings.',
  Profiles: 'Family member profiles (admin/adult/kid roles).',
  Calendar: 'Expanded occurrences across events, feeds, chores, and cooking blocks.',
  Events: 'Local calendar events, including recurrence and per-occurrence edits.',
  Feeds: 'Subscribed ICS calendar feeds (school calendars, sports schedules).',
  Chores: 'Chore definitions, the per-day board, completions, and the leaderboard.',
  Rewards: 'Star-store rewards, balances, and redemptions.',
  Recipes: 'The recipe box: recipes, ratings, notes, and URL import.',
  MealPlan: 'Week meal plan entries and their scaled ingredient lists.',
  Shopping: 'Shopping lists and items, including generation from the meal plan.',
  Pantry: 'Pantry inventory and barcode lookups.',
  Photos: 'Photo library, uploads, and the slideshow manifest.',
  Weather: 'Cached forecast for the household location.',
  Push: 'Web-push subscriptions and test notifications.',
  ApiKeys: 'Bearer API keys for external clients (Home Assistant, scripts).',
  Feedback: 'In-app bug reports and feature requests, filed as GitHub issues.',
  System: 'Health, bootstrap, first-boot setup, and this documentation.',
} as const

export type TagName = keyof typeof TAGS

export interface RouteDoc {
  method: HttpMethod
  /** OpenAPI-style path, e.g. /api/events/{id}. */
  path: string
  summary: string
  tags: TagName[]
  /**
   * public — no auth; unlocked — any session or API key; profile — needs an
   * acting profile (profile-bound key); admin — acting profile must be admin.
   */
  auth: AuthLevel
  /** zod contract validating the JSON request body. */
  requestSchema?: ZodType
  /** The body is multipart/form-data (file upload) — no zod schema. */
  multipart?: boolean
  /** zod contract validating the query string. */
  querySchema?: ZodType
  pathParams?: string[]
  responseDescription: string
}

/**
 * Route files intentionally left out of the OpenAPI document (none today).
 * Add `{ method, path }` pairs here only for internal routes that make no
 * sense to document — the coverage test treats them as accounted for.
 */
export const EXCLUDED_ROUTES: { method: HttpMethod, path: string }[] = []

/** Mirrors the route-local schema in server/api/auth/reset-password.post.ts. */
const resetPasswordSchema = z.object({ password: z.string().min(6).max(200) })

export const routeRegistry: RouteDoc[] = [
  // ── System ────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/health',
    summary: 'Liveness check — verifies the database file is openable.',
    tags: ['System'],
    auth: 'public',
    responseDescription: '`{ ok: true }` when the process and database are healthy.',
  },
  {
    method: 'get',
    path: '/api/bootstrap',
    summary: 'App stage + profile roster — what the client needs before unlocking.',
    tags: ['System'],
    auth: 'public',
    responseDescription: 'Either `{ needsSetup: true }` or household name, unlock state, active profile, profile roster, settings, and timezone. Never leaks secrets.',
  },
  {
    method: 'post',
    path: '/api/setup',
    summary: 'First-boot setup: create the household, password, and initial profiles.',
    tags: ['System'],
    auth: 'public',
    requestSchema: setupSchema,
    responseDescription: '`{ ok: true }`; the session ends unlocked, acting as the first admin profile. `409` once the board is already set up.',
  },
  {
    method: 'get',
    path: '/api/openapi.json',
    summary: 'This OpenAPI 3.1 document, generated from the live zod contracts.',
    tags: ['System'],
    auth: 'unlocked',
    responseDescription: 'The OpenAPI 3.1 document describing every route on this board.',
  },
  {
    method: 'get',
    path: '/docs',
    summary: 'Interactive API reference (Scalar UI) for this board, served fully offline.',
    tags: ['System'],
    auth: 'unlocked',
    responseDescription: 'HTML shell that renders /api/openapi.json. Without a session it redirects (302) to /unlock instead of returning 401.',
  },

  // ── Auth ──────────────────────────────────────────────────────────────
  {
    method: 'post',
    path: '/api/auth/unlock',
    summary: 'Unlock the board with the shared household password.',
    tags: ['Auth'],
    auth: 'public',
    requestSchema: unlockSchema,
    responseDescription: '`{ ok: true }` and a session cookie. `401` wrong password; `429` after 5 attempts/minute per IP.',
  },
  {
    method: 'post',
    path: '/api/auth/lock',
    summary: 'Lock the board — clears the current session.',
    tags: ['Auth'],
    auth: 'unlocked',
    responseDescription: '`{ ok: true }`.',
  },
  {
    method: 'post',
    path: '/api/auth/profile',
    summary: 'Switch the acting profile for this session.',
    tags: ['Auth'],
    auth: 'unlocked',
    requestSchema: switchProfileSchema,
    responseDescription: '`{ ok: true }`; subsequent profile-level requests act as the chosen family member.',
  },
  {
    method: 'post',
    path: '/api/auth/reset-password',
    summary: 'Set a new household password (only while a BETTS_RESET_PASSWORD boot has cleared the hash).',
    tags: ['Auth'],
    auth: 'public',
    requestSchema: resetPasswordSchema,
    responseDescription: '`{ ok: true }` and an unlocked session. `403` unless the reset is armed.',
  },

  // ── Household ─────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/household',
    summary: 'Household details: name, timezone, location, and settings.',
    tags: ['Household'],
    auth: 'unlocked',
    responseDescription: 'The single household row (without the password hash).',
  },
  {
    method: 'patch',
    path: '/api/household',
    summary: 'Update household name, timezone, location, or settings.',
    tags: ['Household'],
    auth: 'admin',
    requestSchema: householdPatchSchema,
    responseDescription: 'The updated household.',
  },

  // ── Profiles ──────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/profiles',
    summary: 'List family member profiles.',
    tags: ['Profiles'],
    auth: 'unlocked',
    responseDescription: 'All profiles, including archived ones.',
  },
  {
    method: 'post',
    path: '/api/profiles',
    summary: 'Create a profile.',
    tags: ['Profiles'],
    auth: 'admin',
    requestSchema: profileCreateSchema,
    responseDescription: 'The created profile.',
  },
  {
    method: 'patch',
    path: '/api/profiles/{id}',
    summary: 'Update a profile (name, color, role, sort order, archived).',
    tags: ['Profiles'],
    auth: 'admin',
    requestSchema: profilePatchSchema,
    pathParams: ['id'],
    responseDescription: 'The updated profile.',
  },
  {
    method: 'delete',
    path: '/api/profiles/{id}',
    summary: 'Archive a profile.',
    tags: ['Profiles'],
    auth: 'admin',
    pathParams: ['id'],
    responseDescription: 'Confirmation; the profile is archived, not hard-deleted.',
  },

  // ── Calendar ──────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/calendar',
    summary: 'Expanded calendar occurrences (events, feed events, cooking blocks) in a window.',
    tags: ['Calendar'],
    auth: 'unlocked',
    querySchema: calendarQuerySchema,
    responseDescription: 'Occurrences sorted by start; window is `[start, end)` in epoch ms. `profileIds` is a comma-separated filter.',
  },
  {
    method: 'get',
    path: '/feeds/{token}.ics',
    summary: 'ICS export of the household calendar — subscribe from any calendar app.',
    tags: ['Calendar'],
    auth: 'public',
    pathParams: ['token'],
    responseDescription: 'text/calendar feed. The secret token in the path IS the authentication; a wrong token returns `404`, indistinguishable from a missing route.',
  },

  // ── Events ────────────────────────────────────────────────────────────
  {
    method: 'post',
    path: '/api/events',
    summary: 'Create an event — timed (startAt/endAt, epoch ms) or all-day (startDate/endDate).',
    tags: ['Events'],
    auth: 'profile',
    requestSchema: eventCreateSchema,
    responseDescription: 'The created event. All-day events need `startDate`/`endDate` (end exclusive); timed events need `startAt`/`endAt`.',
  },
  {
    method: 'get',
    path: '/api/events/{id}',
    summary: 'Event series detail: attendees, exception count, source feed.',
    tags: ['Events'],
    auth: 'profile',
    pathParams: ['id'],
    responseDescription: 'The event series with its attendees and recurrence info.',
  },
  {
    method: 'patch',
    path: '/api/events/{id}',
    summary: 'Edit an event — scoped to all, this, or future occurrences when it recurs.',
    tags: ['Events'],
    auth: 'profile',
    requestSchema: eventPatchSchema,
    pathParams: ['id'],
    responseDescription: 'The updated series. Feed-imported events are read-only (`403`).',
  },
  {
    method: 'delete',
    path: '/api/events/{id}',
    summary: 'Delete an event — same all/this/future scoping as PATCH.',
    tags: ['Events'],
    auth: 'profile',
    requestSchema: eventDeleteSchema,
    pathParams: ['id'],
    responseDescription: 'Confirmation. `occurrenceStart` (epoch ms) is required for scope `this`/`future`.',
  },

  // ── Feeds ─────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/feeds',
    summary: 'List subscribed ICS feeds.',
    tags: ['Feeds'],
    auth: 'unlocked',
    responseDescription: 'All feeds with their fetch status.',
  },
  {
    method: 'post',
    path: '/api/feeds',
    summary: 'Subscribe to an ICS feed — fetched immediately.',
    tags: ['Feeds'],
    auth: 'admin',
    requestSchema: feedCreateSchema,
    responseDescription: 'The created feed after its first fetch.',
  },
  {
    method: 'patch',
    path: '/api/feeds/{id}',
    summary: 'Update a feed (name, url, color, interval, enabled).',
    tags: ['Feeds'],
    auth: 'admin',
    requestSchema: feedPatchSchema,
    pathParams: ['id'],
    responseDescription: 'The updated feed.',
  },
  {
    method: 'delete',
    path: '/api/feeds/{id}',
    summary: 'Delete a feed and its imported events.',
    tags: ['Feeds'],
    auth: 'admin',
    pathParams: ['id'],
    responseDescription: 'Confirmation.',
  },
  {
    method: 'post',
    path: '/api/feeds/{id}/refresh',
    summary: 'Re-fetch a feed now.',
    tags: ['Feeds'],
    auth: 'admin',
    pathParams: ['id'],
    responseDescription: 'The feed after refreshing.',
  },

  // ── Chores ────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/chores',
    summary: 'List chore definitions.',
    tags: ['Chores'],
    auth: 'unlocked',
    responseDescription: 'All non-archived chores with their assignees.',
  },
  {
    method: 'post',
    path: '/api/chores',
    summary: 'Create a chore (adults only — kid profiles get 403).',
    tags: ['Chores'],
    auth: 'profile',
    requestSchema: choreCreateSchema,
    responseDescription: 'The created chore. `rrule` omitted = one-off on `startDate`.',
  },
  {
    method: 'patch',
    path: '/api/chores/{id}',
    summary: 'Update a chore (adults only).',
    tags: ['Chores'],
    auth: 'profile',
    requestSchema: chorePatchSchema,
    pathParams: ['id'],
    responseDescription: 'The updated chore.',
  },
  {
    method: 'delete',
    path: '/api/chores/{id}',
    summary: 'Archive a chore (adults only).',
    tags: ['Chores'],
    auth: 'profile',
    pathParams: ['id'],
    responseDescription: 'Confirmation; history is kept.',
  },
  {
    method: 'get',
    path: '/api/chores/board',
    summary: 'Expanded per-assignee chore instances for a date window.',
    tags: ['Chores'],
    auth: 'unlocked',
    querySchema: choreBoardQuerySchema,
    responseDescription: 'One instance per assignee per due date (YYYY-MM-DD window, end exclusive), including overdue rollovers.',
  },
  {
    method: 'post',
    path: '/api/chores/{id}/complete',
    summary: 'Mark a chore instance complete for an assignee.',
    tags: ['Chores'],
    auth: 'profile',
    requestSchema: choreCompleteSchema,
    pathParams: ['id'],
    responseDescription: 'The completion, plus `pointsAwarded` and the resulting `streak` for this chore and person. Kids may only complete their own chores.',
  },
  {
    method: 'delete',
    path: '/api/chores/{id}/complete',
    summary: 'Undo a chore completion.',
    tags: ['Chores'],
    auth: 'profile',
    requestSchema: choreCompleteSchema,
    pathParams: ['id'],
    responseDescription: 'Confirmation; the earned points are removed.',
  },
  {
    method: 'get',
    path: '/api/chores/leaderboard',
    summary: 'Points leaderboard with streaks.',
    tags: ['Chores'],
    auth: 'unlocked',
    querySchema: leaderboardQuerySchema,
    responseDescription: 'Per-profile points, completion counts, and current streaks for the period.',
  },

  // ── Rewards ───────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/rewards',
    summary: 'Reward catalog, star balances, and recent redemptions.',
    tags: ['Rewards'],
    auth: 'unlocked',
    responseDescription: '`{ rewards, balances, recent }`.',
  },
  {
    method: 'post',
    path: '/api/rewards',
    summary: 'Create a reward (adults only — kid profiles get 403).',
    tags: ['Rewards'],
    auth: 'profile',
    requestSchema: rewardCreateSchema,
    responseDescription: 'The created reward.',
  },
  {
    method: 'patch',
    path: '/api/rewards/{id}',
    summary: 'Update a reward (adults only).',
    tags: ['Rewards'],
    auth: 'profile',
    requestSchema: rewardPatchSchema,
    pathParams: ['id'],
    responseDescription: 'The updated reward.',
  },
  {
    method: 'delete',
    path: '/api/rewards/{id}',
    summary: 'Archive a reward (adults only).',
    tags: ['Rewards'],
    auth: 'profile',
    pathParams: ['id'],
    responseDescription: 'Confirmation; past redemptions are kept.',
  },
  {
    method: 'post',
    path: '/api/rewards/{id}/redeem',
    summary: 'Redeem a reward, spending stars.',
    tags: ['Rewards'],
    auth: 'profile',
    requestSchema: redeemSchema,
    pathParams: ['id'],
    responseDescription: 'The redemption. `profileId` defaults to the acting profile; kids may only redeem for themselves.',
  },

  // ── Recipes ───────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/recipes',
    summary: 'Search/list recipes.',
    tags: ['Recipes'],
    auth: 'unlocked',
    querySchema: recipeListQuerySchema,
    responseDescription: 'Recipes matching `q`/`tag`, sorted by `sort`.',
  },
  {
    method: 'post',
    path: '/api/recipes',
    summary: 'Create a recipe.',
    tags: ['Recipes'],
    auth: 'profile',
    requestSchema: recipeCreateSchema,
    responseDescription: 'The created recipe. Ingredient `raw` lines are parsed into quantity/unit/name server-side.',
  },
  {
    method: 'post',
    path: '/api/recipes/import',
    summary: 'Import a recipe by scraping a URL.',
    tags: ['Recipes'],
    auth: 'profile',
    requestSchema: recipeImportSchema,
    responseDescription: 'The imported recipe, parsed from the page\'s structured data.',
  },
  {
    method: 'get',
    path: '/api/recipes/{id}',
    summary: 'Full recipe with ingredients, ratings, and notes.',
    tags: ['Recipes'],
    auth: 'unlocked',
    pathParams: ['id'],
    responseDescription: 'The recipe detail.',
  },
  {
    method: 'patch',
    path: '/api/recipes/{id}',
    summary: 'Update a recipe.',
    tags: ['Recipes'],
    auth: 'profile',
    requestSchema: recipePatchSchema,
    pathParams: ['id'],
    responseDescription: 'The updated recipe.',
  },
  {
    method: 'delete',
    path: '/api/recipes/{id}',
    summary: 'Delete a recipe.',
    tags: ['Recipes'],
    auth: 'profile',
    pathParams: ['id'],
    responseDescription: 'Confirmation.',
  },
  {
    method: 'put',
    path: '/api/recipes/{id}/rating',
    summary: 'Set the acting profile\'s rating for a recipe.',
    tags: ['Recipes'],
    auth: 'profile',
    requestSchema: recipeRatingSchema,
    pathParams: ['id'],
    responseDescription: 'The recipe\'s updated rating summary.',
  },
  {
    method: 'post',
    path: '/api/recipes/{id}/notes',
    summary: 'Add a note to a recipe.',
    tags: ['Recipes'],
    auth: 'profile',
    requestSchema: recipeNoteCreateSchema,
    pathParams: ['id'],
    responseDescription: 'The created note, attributed to the acting profile.',
  },
  {
    method: 'delete',
    path: '/api/recipes/{id}/notes/{noteId}',
    summary: 'Delete a recipe note (own notes; admins any).',
    tags: ['Recipes'],
    auth: 'profile',
    pathParams: ['id', 'noteId'],
    responseDescription: 'Confirmation.',
  },

  // ── MealPlan ──────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/meal-plan',
    summary: 'Meal-plan entries for a date window.',
    tags: ['MealPlan'],
    auth: 'unlocked',
    querySchema: mealPlanQuerySchema,
    responseDescription: 'Entries between `start` and `end` (YYYY-MM-DD, end exclusive).',
  },
  {
    method: 'post',
    path: '/api/meal-plan/entries',
    summary: 'Add a meal-plan entry — a recipe or free text, one slot per day.',
    tags: ['MealPlan'],
    auth: 'profile',
    requestSchema: mealEntryCreateSchema,
    responseDescription: 'The created entry. Exactly one of `recipeId` / `freeText` is required.',
  },
  {
    method: 'patch',
    path: '/api/meal-plan/entries/{id}',
    summary: 'Update a meal-plan entry.',
    tags: ['MealPlan'],
    auth: 'profile',
    requestSchema: mealEntryPatchSchema,
    pathParams: ['id'],
    responseDescription: 'The updated entry.',
  },
  {
    method: 'delete',
    path: '/api/meal-plan/entries/{id}',
    summary: 'Remove a meal-plan entry.',
    tags: ['MealPlan'],
    auth: 'profile',
    pathParams: ['id'],
    responseDescription: 'Confirmation.',
  },
  {
    method: 'get',
    path: '/api/meal-plan/entries/{id}/ingredients',
    summary: 'Scaled ingredient list for a recipe-backed entry.',
    tags: ['MealPlan'],
    auth: 'unlocked',
    pathParams: ['id'],
    responseDescription: 'Ingredients scaled by `servingsOverride` / recipe servings.',
  },

  // ── Shopping ──────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/shopping-lists',
    summary: 'List shopping lists with unchecked counts.',
    tags: ['Shopping'],
    auth: 'unlocked',
    responseDescription: 'All lists.',
  },
  {
    method: 'post',
    path: '/api/shopping-lists',
    summary: 'Create a shopping list.',
    tags: ['Shopping'],
    auth: 'profile',
    requestSchema: shoppingListCreateSchema,
    responseDescription: 'The created list.',
  },
  {
    method: 'get',
    path: '/api/shopping-lists/{id}',
    summary: 'A shopping list with its items.',
    tags: ['Shopping'],
    auth: 'unlocked',
    pathParams: ['id'],
    responseDescription: 'The list and its items. `default` works as `{id}` for the default list.',
  },
  {
    method: 'patch',
    path: '/api/shopping-lists/{id}',
    summary: 'Rename a list or make it the default.',
    tags: ['Shopping'],
    auth: 'profile',
    requestSchema: shoppingListPatchSchema,
    pathParams: ['id'],
    responseDescription: 'The updated list.',
  },
  {
    method: 'delete',
    path: '/api/shopping-lists/{id}',
    summary: 'Delete a shopping list and its items.',
    tags: ['Shopping'],
    auth: 'profile',
    pathParams: ['id'],
    responseDescription: 'Confirmation.',
  },
  {
    method: 'post',
    path: '/api/shopping-lists/{id}/items',
    summary: 'Add an item — quick-add parses "2 lbs chicken" style names.',
    tags: ['Shopping'],
    auth: 'profile',
    requestSchema: shoppingItemCreateSchema,
    pathParams: ['id'],
    responseDescription: 'The created (or merged) item.',
  },
  {
    method: 'patch',
    path: '/api/shopping-lists/{id}/items/{itemId}',
    summary: 'Update an item (fields, checked, sort order).',
    tags: ['Shopping'],
    auth: 'profile',
    requestSchema: shoppingItemPatchSchema,
    pathParams: ['id', 'itemId'],
    responseDescription: 'The updated item.',
  },
  {
    method: 'delete',
    path: '/api/shopping-lists/{id}/items/{itemId}',
    summary: 'Remove an item.',
    tags: ['Shopping'],
    auth: 'profile',
    pathParams: ['id', 'itemId'],
    responseDescription: 'Confirmation.',
  },
  {
    method: 'post',
    path: '/api/shopping-lists/{id}/clear',
    summary: 'Remove every item from a list.',
    tags: ['Shopping'],
    auth: 'profile',
    pathParams: ['id'],
    responseDescription: 'Confirmation.',
  },
  {
    method: 'post',
    path: '/api/shopping-lists/{id}/clear-checked',
    summary: 'Clear checked items, optionally moving them into the pantry.',
    tags: ['Shopping'],
    auth: 'profile',
    requestSchema: clearCheckedSchema,
    pathParams: ['id'],
    responseDescription: 'Confirmation. `toPantry: true` = "put away groceries".',
  },
  {
    method: 'post',
    path: '/api/shopping-lists/{id}/items/from-recipe',
    summary: 'Add selected recipe ingredients to a list, scaled.',
    tags: ['Shopping'],
    auth: 'profile',
    requestSchema: addFromRecipeSchema,
    pathParams: ['id'],
    responseDescription: '`{ created, merged, listId }`. Use `default` as `{id}` for the default list.',
  },
  {
    method: 'post',
    path: '/api/shopping-lists/generate',
    summary: 'Build a shopping list from the meal plan for a date window.',
    tags: ['Shopping'],
    auth: 'profile',
    requestSchema: generateFromMealPlanSchema,
    responseDescription: '`{ created, merged, inPantry, skippedFreeText }` — pantry-covered items are flagged, free-text meals skipped.',
  },

  // ── Pantry ────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/pantry',
    summary: 'List pantry items.',
    tags: ['Pantry'],
    auth: 'unlocked',
    querySchema: pantryQuerySchema,
    responseDescription: 'Items matching the optional `q` name filter.',
  },
  {
    method: 'post',
    path: '/api/pantry',
    summary: 'Add a pantry item — upserts by normalized name.',
    tags: ['Pantry'],
    auth: 'profile',
    requestSchema: pantryItemCreateSchema,
    responseDescription: 'The created or merged item.',
  },
  {
    method: 'patch',
    path: '/api/pantry/{id}',
    summary: 'Update a pantry item.',
    tags: ['Pantry'],
    auth: 'profile',
    requestSchema: pantryItemPatchSchema,
    pathParams: ['id'],
    responseDescription: 'The updated item.',
  },
  {
    method: 'delete',
    path: '/api/pantry/{id}',
    summary: 'Remove a pantry item.',
    tags: ['Pantry'],
    auth: 'profile',
    pathParams: ['id'],
    responseDescription: 'Confirmation.',
  },
  {
    method: 'get',
    path: '/api/barcode/{code}',
    summary: 'Product lookup for a barcode (Open Food Facts + local cache).',
    tags: ['Pantry'],
    auth: 'unlocked',
    pathParams: ['code'],
    responseDescription: '`{ barcode, found, productName?, brand?, imageUrl?, source? }` for a 6–14 digit code.',
  },
  {
    method: 'post',
    path: '/api/barcode',
    summary: 'Remember a manual product name for an unknown barcode.',
    tags: ['Pantry'],
    auth: 'profile',
    requestSchema: barcodeManualSchema,
    responseDescription: 'The cached mapping, used by future lookups.',
  },

  // ── Photos ────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/photos',
    summary: 'Photo library, newest first, cursor-paginated.',
    tags: ['Photos'],
    auth: 'unlocked',
    querySchema: photoListQuerySchema,
    responseDescription: 'Photos with session-gated `/uploads/…` URLs — fetch those with the same Authorization header.',
  },
  {
    method: 'post',
    path: '/api/photos',
    summary: 'Upload photos — multipart/form-data, one or more image files, ≤25 MB each.',
    tags: ['Photos'],
    auth: 'profile',
    multipart: true,
    responseDescription: 'The saved photos. `413` for files over 25 MB, `415` for non-images.',
  },
  {
    method: 'patch',
    path: '/api/photos/{id}',
    summary: 'Toggle a photo in or out of the slideshow.',
    tags: ['Photos'],
    auth: 'profile',
    requestSchema: photoPatchSchema,
    pathParams: ['id'],
    responseDescription: 'The updated photo.',
  },
  {
    method: 'delete',
    path: '/api/photos/{id}',
    summary: 'Delete a photo and its files.',
    tags: ['Photos'],
    auth: 'profile',
    pathParams: ['id'],
    responseDescription: 'Confirmation.',
  },
  {
    method: 'get',
    path: '/api/slideshow',
    summary: 'Shuffled slideshow manifest plus display settings.',
    tags: ['Photos'],
    auth: 'unlocked',
    responseDescription: '`{ photos, settings }` for the wall-display slideshow.',
  },
  {
    method: 'get',
    path: '/uploads/{path}',
    summary: 'Serve an uploaded file (photos, thumbnails, recipe images).',
    tags: ['Photos'],
    auth: 'unlocked',
    pathParams: ['path'],
    responseDescription: 'The file bytes with a long-lived private cache header. Session-gated by the global middleware, like /api/**.',
  },

  // ── Weather ───────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/weather',
    summary: 'Cached forecast for the household location.',
    tags: ['Weather'],
    auth: 'unlocked',
    responseDescription: 'Current conditions and forecast. `404` until a location is configured in Settings.',
  },

  // ── Push ──────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/push/public-key',
    summary: 'The VAPID public key for push subscriptions.',
    tags: ['Push'],
    auth: 'unlocked',
    responseDescription: '`{ publicKey }`.',
  },
  {
    method: 'post',
    path: '/api/push/subscribe',
    summary: 'Register this device\'s push subscription for the acting profile.',
    tags: ['Push'],
    auth: 'profile',
    requestSchema: pushSubscribeSchema,
    responseDescription: 'Confirmation.',
  },
  {
    method: 'post',
    path: '/api/push/unsubscribe',
    summary: 'Remove a push subscription by endpoint.',
    tags: ['Push'],
    auth: 'unlocked',
    requestSchema: pushUnsubscribeSchema,
    responseDescription: 'Confirmation.',
  },
  {
    method: 'post',
    path: '/api/push/test',
    summary: 'Send a test notification to the acting admin\'s devices.',
    tags: ['Push'],
    auth: 'admin',
    responseDescription: 'Delivery summary.',
  },

  // ── ApiKeys ───────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/api-keys',
    summary: 'List API keys (no hashes, no tokens).',
    tags: ['ApiKeys'],
    auth: 'admin',
    responseDescription: 'Keys with name, bound profile, last-used, and revoked state.',
  },
  {
    method: 'post',
    path: '/api/api-keys',
    summary: 'Create an API key — the bearer token is returned exactly once.',
    tags: ['ApiKeys'],
    auth: 'admin',
    requestSchema: apiKeyCreateSchema,
    responseDescription: 'The key including its one-time `token` (`bb_…`). Only a hash is stored.',
  },
  {
    method: 'delete',
    path: '/api/api-keys/{id}',
    summary: 'Revoke an API key immediately.',
    tags: ['ApiKeys'],
    auth: 'admin',
    pathParams: ['id'],
    responseDescription: 'Confirmation; anything using the key gets `401` from then on.',
  },

  // ── Feedback ──────────────────────────────────────────────────────────
  {
    method: 'post',
    path: '/api/feedback',
    summary: 'File a bug report or feature request as a GitHub issue.',
    tags: ['Feedback'],
    auth: 'profile',
    requestSchema: feedbackCreateSchema,
    responseDescription: '`{ ok, issueNumber, issueUrl }` for the created issue, attributed to the acting profile in the body. `409` until GitHub is connected in Settings; `429` after 5 quick submissions per profile; `502` when GitHub rejects the request.',
  },
  {
    method: 'get',
    path: '/api/feedback/status',
    summary: 'Whether feedback is connected to GitHub, and to which repo.',
    tags: ['Feedback'],
    auth: 'unlocked',
    responseDescription: '`{ configured, repo }` — never the token.',
  },
  {
    method: 'put',
    path: '/api/feedback/settings',
    summary: 'Connect or disconnect the GitHub repo that receives feedback issues.',
    tags: ['Feedback'],
    auth: 'admin',
    requestSchema: feedbackSettingsSchema,
    responseDescription: 'The updated `{ configured, repo }` status. `repo: null` disconnects and clears the stored token; omitting `token` keeps the existing one.',
  },
  {
    method: 'post',
    path: '/api/feedback/test',
    summary: 'Verify the stored repo + token by fetching the repo from GitHub.',
    tags: ['Feedback'],
    auth: 'admin',
    responseDescription: '`{ ok, repoFullName }` when the token can see the repo; a mapped `502` explaining what\'s wrong otherwise.',
  },
]
