// ============================================
// claude.js — Anthropic Claude API function
// Uses prompt caching for cost reduction
// ============================================

// maxTokens defaults to 250 (tight, for 3-line verdicts). Journeys that
// genuinely need a longer answer — e.g. restaurant lists — pass a higher
// value explicitly. This keeps brevity the default everywhere else.
export async function callClaude(messages, system, env, maxTokens = 250) {
  try {
    const res = await fetch(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',
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

    return data.content[0].text;

  } catch (err) {
    console.log('callClaude error:', err.message);
    return 'Sorry I could not process that right now. Please try again.';
  }
}
