// ============================================
// search.js — Brave Search for product ingredients
// ============================================

const BRAVE_API = 'https://api.search.brave.com/res/v1/web/search';

/**
 * Search Brave for ingredient information for a named product.
 * Returns a short text block with search snippets, or null if nothing useful found.
 */
export async function searchProductIngredients(productName, env) {
  try {
    console.log('[search] searchProductIngredients: searching for', productName);
    console.log('[search] BRAVE_API_KEY present:', !!env.BRAVE_API_KEY);

    const query = encodeURIComponent(`${productName} ingredients`);
    const res = await fetch(`${BRAVE_API}?q=${query}&count=3`, {
      headers: {
        'X-Subscription-Token': env.BRAVE_API_KEY,
        'Accept': 'application/json'
      }
    });

    console.log('[search] Brave status:', res.status);
    if (!res.ok) {
      const errText = await res.text();
      console.log('[search] Brave error body:', errText);
      return null;
    }

    const data = await res.json();
    const results = data?.web?.results || [];
    console.log('[search] Brave result count:', results.length);
    if (!results.length) return null;

    const snippets = results
      .filter(r => r.description)
      .slice(0, 3)
      .map(r => `${r.title}: ${r.description}`)
      .join('\n');

    console.log('[search] snippets length:', snippets.length);
    return snippets || null;

  } catch (err) {
    console.log('[search] searchProductIngredients error:', err.message);
    return null;
  }
}
