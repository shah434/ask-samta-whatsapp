#!/usr/bin/env node
// ============================================
// scripts/scan-logs.js — Image scan log viewer
// Usage:
//   node scripts/scan-logs.js              # show last 20 scans
//   node scripts/scan-logs.js --limit 50   # show last 50
//   node scripts/scan-logs.js --branch B   # Branch B only
//   node scripts/scan-logs.js --full       # show full response text
//   node scripts/scan-logs.js --misses     # Branch B nulls only (Brave missed)
// ============================================

import { execSync } from 'child_process';

const NAMESPACE_ID = '2852615bc61a4b0b9f6528c4fced5c81';
const PREFIX = 'log:image:';

// -- Parse args ---------------------------------------------------------------
const args = process.argv.slice(2);
const limitArg  = args.indexOf('--limit');
const branchArg = args.indexOf('--branch');
const LIMIT      = limitArg  !== -1 ? parseInt(args[limitArg + 1])  : 20;
const BRANCH     = branchArg !== -1 ? args[branchArg + 1].toUpperCase() : null;
const FULL       = args.includes('--full');
const MISSES     = args.includes('--misses');

// -- Helpers ------------------------------------------------------------------
function wrangler(cmd) {
  try {
    const out = execSync(`npx wrangler ${cmd} 2>/dev/null`, { encoding: 'utf8' });
    return out.trim();
  } catch (e) {
    return null;
  }
}

function truncate(str, len) {
  if (!str) return '—';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

function formatMs(ms) {
  if (ms == null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// -- Main ---------------------------------------------------------------------
console.log('\n📋 Fetching scan log keys...\n');

const listOut = wrangler(`kv key list --namespace-id ${NAMESPACE_ID} --prefix "${PREFIX}"`);
if (!listOut) {
  console.error('Failed to list keys. Make sure wrangler is authenticated (npx wrangler login).');
  process.exit(1);
}

let keys;
try {
  keys = JSON.parse(listOut).map(k => k.name);
} catch {
  console.error('Could not parse key list. Raw output:', listOut);
  process.exit(1);
}

if (keys.length === 0) {
  console.log('No image scan logs found yet. Send a photo to Samta and check again.');
  process.exit(0);
}

// Sort newest first, apply limit
keys.sort((a, b) => b.localeCompare(a));
keys = keys.slice(0, LIMIT);

console.log(`Found ${keys.length} log entries. Fetching...\n`);

// Fetch each entry (sequential to avoid wrangler rate limits)
const entries = [];
for (const key of keys) {
  const raw = wrangler(`kv key get "${key}" --namespace-id ${NAMESPACE_ID}`);
  if (!raw) continue;
  try {
    const entry = JSON.parse(raw);
    entries.push(entry);
  } catch {
    // skip malformed entries
  }
}

// -- Filter ------------------------------------------------------------------
let filtered = entries;
if (BRANCH)  filtered = filtered.filter(e => e.branch === BRANCH);
if (MISSES)  filtered = filtered.filter(e => e.branch === 'B' && !e.snippetsFound);

if (filtered.length === 0) {
  console.log('No entries match your filters.');
  process.exit(0);
}

// -- Summary stats -----------------------------------------------------------
const total   = filtered.length;
const branchA = filtered.filter(e => e.branch === 'A').length;
const branchB = filtered.filter(e => e.branch === 'B').length;
const bMisses = filtered.filter(e => e.branch === 'B' && !e.snippetsFound).length;
const avgLatency = Math.round(
  filtered.reduce((sum, e) => sum + (e.latencyMs || 0), 0) / total
);

console.log('─'.repeat(72));
console.log(`  Scans: ${total}   Branch A: ${branchA}   Branch B: ${branchB}   B-misses: ${bMisses}/${branchB}   Avg latency: ${formatMs(avgLatency)}`);
console.log('─'.repeat(72));

// -- Per-entry display -------------------------------------------------------
for (const e of filtered) {
  const tag     = e.branch === 'A' ? '🏷  A' : e.snippetsFound ? '🔍 B' : '❌ B';
  const product = truncate(e.productName, 40) || '(no name)';
  const when    = e.timestamp ? formatDate(e.timestamp) : '—';
  const latency = formatMs(e.latencyMs);

  console.log(`\n${tag}  ${when}  ${latency}`);
  console.log(`   Product : ${product}`);

  if (e.branch === 'B') {
    if (e.snippetsFound) {
      console.log(`   Snippets: ${truncate(e.snippets, FULL ? 400 : 120)}`);
    } else {
      console.log(`   Snippets: none — user asked to send back label`);
    }
  }

  console.log(`   Response: ${truncate(e.response, FULL ? 600 : 100)}`);
}

console.log('\n' + '─'.repeat(72));
console.log(`  Showing ${filtered.length} of ${entries.length} fetched entries`);
if (!FULL) console.log('  Tip: add --full to see complete response text');
console.log('');
