// ============================================
// database.js — Supabase + KV write-through cache
// ============================================
// KV is a speed layer only — Supabase is always the source of truth.
// Write order: Supabase first, KV second. KV failures are logged
// but non-fatal; the next getUser falls back to Supabase automatically.
// ============================================

const KV_USER_PREFIX = 'user:';
const KV_USER_TTL = 86400; // 24h safety net — not the freshness mechanism

// ── Private KV helpers ──────────────────────────────────────────────────────

async function getUserFromKV(phone, env) {
  try {
    const cached = await env.KV.get(`${KV_USER_PREFIX}${phone}`);
    if (cached) return JSON.parse(cached);
  } catch (err) {
    console.log(`[cache] kv_read_error phone=${phone} err=${err.message}`);
  }
  return null;
}

async function writeUserToKV(phone, user, env) {
  try {
    await env.KV.put(
      `${KV_USER_PREFIX}${phone}`,
      JSON.stringify(user),
      { expirationTtl: KV_USER_TTL }
    );
  } catch (err) {
    console.log(`[cache] kv_write_error phone=${phone} err=${err.message}`);
    // Non-fatal — next getUser will fall back to Supabase
  }
}

// ── Public functions ────────────────────────────────────────────────────────

export async function getUser(phone, env) {
  // KV first (~5ms on hit)
  const cached = await getUserFromKV(phone, env);
  if (cached) {
    console.log(`[cache] hit phone=${phone}`);
    return cached;
  }

  // Cache miss — fetch from Supabase, then cache the result
  console.log(`[cache] miss phone=${phone}`);
  const t = Date.now();
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/users?phone_number=eq.${phone}&limit=1`,
    {
      headers: {
        apikey: env.SUPABASE_KEY,
        Author