// ============================================
// claude.js — Anthropic Claude API function
// Uses prompt caching for cost reduction
// ============================================

// maxTokens defaults to 250 (tight, for 3-line verdicts). Journeys that
// genuinely need a longer answer — e.g. restaurant lists — pass a higher
// value explicitly. This keeps brevity the default everywhere else.
export async function callClaude(messages, system, env, maxTokens = 250, ctx = null) {
  try {
    const res = await fetch(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: maxTokens,
          system,
          messages
        })
      }
    );

    const data = await res.json();

    if (res.status !== 200) {
      console.log('Claude API error:', res.status, JSON.stringify(data.error));
      return 'Sorry I could not process that right now. Please try again.';
    }

    if (!data.content || !data.content[0]) {
      console.log('Claude returned no content');
      return 'Sorry I could not process that right now. Please try again.';
    }

    // Accumulate approx daily cost off the critical path — deferred via ctx.waitUntil
    // when available, otherwise fire-and-forget (Worker stays alive for the main response).
    const spendUpdate = (async () => {
      try {
        const u = data.usage;
        if (u && env.KV) {
          // cache_creation multiplier assumes the 5-min cache TTL (1.25x write
          // premium) set in utils.js buildSystemPrompt. If that TTL is raised to
          // '1h', the real write cost is 2x — update this 1.25 to 2 to match.
          const cost = (u.input_tokens || 0) / 1e6 * 1
                     + (u.cache_creation_input_tokens || 0) / 1e6 * 1.25
                     + (u.cache_read_input_tokens || 0) / 1e6 * 0.10
                     + (u.output_tokens || 0) / 1e6 * 5;
          console.log(`[cost] in=${u.input_tokens} cache_w=${u.cache_creation_input_tokens||0} cache_r=${u.cache_read_input_tokens||0} out=${u.output_tokens}`);
          const key = `spend:${new Date().toISOString().slice(0, 10)}`;
          const cur = parseFloat(await env.KV.get(key) || '0');
          await env.KV.put(key, String(cur + cost), { expirationTtl: 172800 });
        }
      } catch {}
    })();
    if (ctx) ctx.waitUntil(spendUpdate);

    return data.content[0].text;

  } catch (err) {
    console.log('callClaude error:', err.message);
    return 'Sorry I could not process that right now. Please try again.';
  }
}
