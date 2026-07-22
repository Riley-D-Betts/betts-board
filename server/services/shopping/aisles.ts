/** Keyword → store-aisle category for shopping items. Matching is on whole
 * words inside the normalized name key; the longest matching keyword wins
 * ("black pepper" → Pantry beats "pepper" → Produce). */

export const CATEGORIES = [
  'Produce',
  'Bakery',
  'Meat & Seafood',
  'Dairy',
  'Frozen',
  'Pantry',
  'Beverages',
  'Household',
  'Other',
] as const

export type Category = (typeof CATEGORIES)[number]

const KEYWORDS: Record<string, Category> = {
  // Produce
  apple: 'Produce', banana: 'Produce', orange: 'Produce', lemon: 'Produce',
  lime: 'Produce', grape: 'Produce', berry: 'Produce', strawberry: 'Produce',
  blueberry: 'Produce', raspberry: 'Produce', blackberry: 'Produce',
  melon: 'Produce', watermelon: 'Produce', cantaloupe: 'Produce',
  avocado: 'Produce', tomato: 'Produce', potato: 'Produce', 'sweet potato': 'Produce',
  onion: 'Produce', garlic: 'Produce', ginger: 'Produce', carrot: 'Produce',
  celery: 'Produce', lettuce: 'Produce', spinach: 'Produce', kale: 'Produce',
  arugula: 'Produce', broccoli: 'Produce', cauliflower: 'Produce', cabbage: 'Produce',
  zucchini: 'Produce', squash: 'Produce', cucumber: 'Produce', pepper: 'Produce',
  'bell pepper': 'Produce', jalapeno: 'Produce', mushroom: 'Produce', corn: 'Produce',
  'green bean': 'Produce', pea: 'Produce', 'snap pea': 'Produce', asparagus: 'Produce',
  cilantro: 'Produce', parsley: 'Produce', basil: 'Produce', mint: 'Produce',
  thyme: 'Produce', rosemary: 'Produce', dill: 'Produce', scallion: 'Produce',
  'green onion': 'Produce', leek: 'Produce', shallot: 'Produce', radish: 'Produce',
  beet: 'Produce', pear: 'Produce', peach: 'Produce', plum: 'Produce',
  mango: 'Produce', pineapple: 'Produce', kiwi: 'Produce', cherry: 'Produce',
  eggplant: 'Produce', salad: 'Produce', fruit: 'Produce',

  // Bakery
  bread: 'Bakery', bagel: 'Bakery', bun: 'Bakery', roll: 'Bakery',
  tortilla: 'Bakery', pita: 'Bakery', croissant: 'Bakery', muffin: 'Bakery',
  'english muffin': 'Bakery', baguette: 'Bakery', naan: 'Bakery',
  cake: 'Bakery', donut: 'Bakery', doughnut: 'Bakery',

  // Meat & Seafood
  'chicken': 'Meat & Seafood', 'beef': 'Meat & Seafood', 'ground beef': 'Meat & Seafood',
  'steak': 'Meat & Seafood', 'pork': 'Meat & Seafood', 'bacon': 'Meat & Seafood',
  'ham': 'Meat & Seafood', 'sausage': 'Meat & Seafood', 'turkey': 'Meat & Seafood',
  'lamb': 'Meat & Seafood', 'salmon': 'Meat & Seafood', 'tuna': 'Meat & Seafood',
  'shrimp': 'Meat & Seafood', 'fish': 'Meat & Seafood', 'cod': 'Meat & Seafood',
  'tilapia': 'Meat & Seafood', 'crab': 'Meat & Seafood', 'lobster': 'Meat & Seafood',
  'scallop': 'Meat & Seafood', 'hot dog': 'Meat & Seafood', 'meatball': 'Meat & Seafood',
  'pepperoni': 'Meat & Seafood', 'salami': 'Meat & Seafood', 'prosciutto': 'Meat & Seafood',
  'deli': 'Meat & Seafood', 'brisket': 'Meat & Seafood',

  // Dairy
  'milk': 'Dairy', 'almond milk': 'Dairy', 'oat milk': 'Dairy', 'soy milk': 'Dairy',
  'cream': 'Dairy', 'heavy cream': 'Dairy', 'half and half': 'Dairy',
  'yogurt': 'Dairy', 'butter': 'Dairy', 'cheese': 'Dairy', 'cheddar': 'Dairy',
  'mozzarella': 'Dairy', 'parmesan': 'Dairy', 'feta': 'Dairy', 'cream cheese': 'Dairy',
  'sour cream': 'Dairy', 'cottage cheese': 'Dairy', 'egg': 'Dairy',
  'buttermilk': 'Dairy', 'ricotta': 'Dairy', 'swiss': 'Dairy', 'provolone': 'Dairy',
  'gouda': 'Dairy', 'brie': 'Dairy', 'queso': 'Dairy',

  // Frozen
  'frozen': 'Frozen', 'ice cream': 'Frozen', 'popsicle': 'Frozen', 'waffle': 'Frozen',
  'fries': 'Frozen', 'tater tot': 'Frozen', 'ice': 'Frozen', 'sorbet': 'Frozen',
  'pizza': 'Frozen',

  // Pantry
  'flour': 'Pantry', 'sugar': 'Pantry', 'brown sugar': 'Pantry', 'powdered sugar': 'Pantry',
  'salt': 'Pantry', 'black pepper': 'Pantry', 'baking soda': 'Pantry',
  'baking powder': 'Pantry', 'yeast': 'Pantry', 'vanilla': 'Pantry',
  'oil': 'Pantry', 'olive oil': 'Pantry', 'vegetable oil': 'Pantry',
  'canola oil': 'Pantry', 'coconut oil': 'Pantry', 'sesame oil': 'Pantry',
  'vinegar': 'Pantry', 'soy sauce': 'Pantry', 'worcestershire': 'Pantry',
  'hot sauce': 'Pantry', 'ketchup': 'Pantry', 'mustard': 'Pantry',
  'mayonnaise': 'Pantry', 'mayo': 'Pantry', 'salsa': 'Pantry',
  'pasta': 'Pantry', 'spaghetti': 'Pantry', 'macaroni': 'Pantry', 'noodle': 'Pantry',
  'rice': 'Pantry', 'quinoa': 'Pantry', 'oats': 'Pantry', 'oatmeal': 'Pantry',
  'cereal': 'Pantry', 'granola': 'Pantry', 'peanut butter': 'Pantry',
  'jelly': 'Pantry', 'jam': 'Pantry', 'honey': 'Pantry', 'maple syrup': 'Pantry',
  'syrup': 'Pantry', 'broth': 'Pantry', 'stock': 'Pantry', 'bouillon': 'Pantry',
  'bean': 'Pantry', 'black bean': 'Pantry', 'chickpea': 'Pantry', 'lentil': 'Pantry',
  'tomato sauce': 'Pantry', 'tomato paste': 'Pantry', 'crushed tomato': 'Pantry',
  'diced tomato': 'Pantry', 'canned tomato': 'Pantry', 'coconut milk': 'Pantry',
  'cumin': 'Pantry', 'paprika': 'Pantry', 'oregano': 'Pantry', 'chili powder': 'Pantry',
  'cinnamon': 'Pantry', 'nutmeg': 'Pantry', 'spice': 'Pantry', 'seasoning': 'Pantry',
  'extract': 'Pantry', 'chocolate': 'Pantry', 'chocolate chip': 'Pantry',
  'cocoa': 'Pantry', 'cracker': 'Pantry', 'chip': 'Pantry', 'tortilla chip': 'Pantry',
  'pretzel': 'Pantry', 'popcorn': 'Pantry', 'almond': 'Pantry', 'walnut': 'Pantry',
  'pecan': 'Pantry', 'cashew': 'Pantry', 'peanut': 'Pantry', 'raisin': 'Pantry',
  'panko': 'Pantry', 'breadcrumb': 'Pantry', 'fish sauce': 'Pantry',
  'sriracha': 'Pantry', 'curry': 'Pantry', 'tahini': 'Pantry', 'olive': 'Pantry',
  'pickle': 'Pantry', 'caper': 'Pantry', 'cornstarch': 'Pantry', 'corn starch': 'Pantry',
  'sardine': 'Pantry', 'anchovy': 'Pantry', 'soup': 'Pantry',

  // Beverages
  'water': 'Beverages', 'sparkling water': 'Beverages', 'seltzer': 'Beverages',
  'juice': 'Beverages', 'orange juice': 'Beverages', 'apple juice': 'Beverages',
  'soda': 'Beverages', 'cola': 'Beverages', 'coffee': 'Beverages', 'tea': 'Beverages',
  'beer': 'Beverages', 'wine': 'Beverages', 'kombucha': 'Beverages',
  'lemonade': 'Beverages', 'sports drink': 'Beverages',

  // Household
  'paper towel': 'Household', 'toilet paper': 'Household', 'napkin': 'Household',
  'tissue': 'Household', 'detergent': 'Household', 'dish soap': 'Household',
  'soap': 'Household', 'shampoo': 'Household', 'conditioner': 'Household',
  'toothpaste': 'Household', 'toothbrush': 'Household', 'deodorant': 'Household',
  'cleaner': 'Household', 'bleach': 'Household', 'sponge': 'Household',
  'trash bag': 'Household', 'garbage bag': 'Household', 'foil': 'Household',
  'aluminum foil': 'Household', 'plastic wrap': 'Household', 'parchment': 'Household',
  'battery': 'Household', 'light bulb': 'Household', 'laundry': 'Household',
  'dryer sheet': 'Household', 'diaper': 'Household', 'wipe': 'Household',
  'ziploc': 'Household', 'coffee filter': 'Household',
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Word-boundary regex tolerating simple plurals (apple(s), cherry/cherries). */
function keywordRegex(keyword: string): RegExp {
  const parts = keyword.split(' ').map((w) => {
    const esc = escapeRe(w)
    if (w.endsWith('y')) return `${escapeRe(w.slice(0, -1))}(?:y|ies)`
    return `${esc}(?:s|es)?`
  })
  return new RegExp(`\\b${parts.join('\\s')}\\b`)
}

// Longest keyword first so the most specific match wins.
const MATCHERS = Object.entries(KEYWORDS)
  .map(([keyword, category]) => ({ keyword, category, re: keywordRegex(keyword) }))
  .sort((a, b) => b.keyword.length - a.keyword.length)

/** Best-guess aisle category for a normalized name key. */
export function categorize(nameKey: string): Category {
  for (const m of MATCHERS) {
    if (m.re.test(nameKey)) return m.category
  }
  return 'Other'
}
