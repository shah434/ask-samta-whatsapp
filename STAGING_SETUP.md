# Staging Environment Setup

This guide walks you through setting up the staging environment for local development and testing.

## Prerequisites

- Node.js installed
- Repository cloned and dependencies installed (`npm install`)
- Added to the Cloudflare team (ask Parth)
- Access to the Meta Developer app
- API keys for Anthropic, Supabase, Google Places, and Brave (ask Parth)

---

## Step 1 — Authenticate with Cloudflare

```bash
npx wrangler login
```

This opens a browser window. Log in with the shared Cloudflare account.

---

## Step 2 — Set Staging Secrets

Run each command below and paste the value when prompted:

```bash
npx wrangler secret put WHATSAPP_TOKEN --env staging
npx wrangler secret put PHONE_NUMBER_ID --env staging
npx wrangler secret put VERIFY_TOKEN --env staging
npx wrangler secret put ANTHROPIC_KEY --env staging
npx wrangler secret put SUPABASE_URL --env staging
npx wrangler secret put SUPABASE_KEY --env staging
npx wrangler secret put GOOGLE_PLACES_KEY --env staging
npx wrangler secret put BRAVE_API_KEY --env staging
```

**Where to get each value:**

| Secret | Source |
|---|---|
| `WHATSAPP_TOKEN` | Meta Developer Console → your app → WhatsApp → API Setup |
| `PHONE_NUMBER_ID` | Meta Developer Console → your app → WhatsApp → API Setup |
| `VERIFY_TOKEN` | Pick any string, e.g. `staging-verify-2026` — you'll use it in Step 4 |
| `ANTHROPIC_KEY` | Ask Parth (or [console.anthropic.com](https://console.anthropic.com) → API Keys) |
| `SUPABASE_URL` | Ask Parth |
| `SUPABASE_KEY` | Ask Parth |
| `GOOGLE_PLACES_KEY` | Ask Parth |
| `BRAVE_API_KEY` | Ask Parth |

---

## Step 3 — Deploy to Staging

```bash
npx wrangler deploy --env staging
```

---

## Step 4 — Register the Webhook in Meta

First, verify the worker is responding correctly:

```bash
curl "https://greenbite-staging.greenbitenyc.workers.dev/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=test"
```

You should get back `test`. If you do, go to Meta Developer Console → your app → WhatsApp → Configuration and set:

- **Callback URL**: `https://greenbite-staging.greenbitenyc.workers.dev/webhook`
- **Verify token**: the value you chose for `VERIFY_TOKEN`

Click **Verify and Save**.

---

## Day-to-Day Workflow

```bash
# Start a feature branch
git checkout -b feature/my-feature

# Deploy to staging and test
npx wrangler deploy --env staging

# Watch live logs while messaging the test number
npx wrangler tail --env staging

# When satisfied, open a PR → merge to main → deploy to prod
npx wrangler deploy
```

---

## Notes

- Staging uses an **isolated KV namespace** — data is separate from production.
- Staging shares the **same Supabase database** — always use a test phone number, never a real user's number.
- The Meta test token expires every 24 hours. If you start getting 401 errors, refresh it from the Meta dashboard and re-run `npx wrangler secret put WHATSAPP_TOKEN --env staging` followed by `npx wrangler deploy --env staging`.
