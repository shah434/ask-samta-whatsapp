// IN PLAIN ENGLISH: everything about reminders that TOUCHES data or the user —
// the message wording, and reading/writing the user's reminder queue. The pure
// time-math lives in reminder-schedule.js; this file is the I/O side.
// ============================================
// reminders.js — reminder text + storage operations
// ============================================
// A reminder object (produced by computeSunReminderOffer) has the shape:
//   { type, day, fire, send_at, sun_time, display, city }
// Stored entries add `sent: false`. All wording is programmatic — Claude never
// generates reminder text, so times can't drift or hallucinate.
// ============================================

import { updateUser, fetchUsersWithDueReminders, fetchScheduledReminders } from './database.js';
import { sendMessage } from './whatsapp.js';

// ── Wording ──────────────────────────────────────────────────────────────────
// The offer line appended to the sun answer. Ends by inviting a "yes".
export function offerText(r) {
  switch (r.fire) {
    case 'before_sunset':
      return `Want me to remind you 1 hour before sunset today? Reply *yes* 🙏🏾`;
    case 'morning':
      return `Want a reminder for tomorrow? Tomorrow's sunset in ${r.city} is at ${r.display} — I'll send you a heads-up in the morning. Reply *yes* 🙏🏾`;
    case 'evening':
      return `Want a reminder for the next sunrise (${r.display})? I'll nudge you tonight at 8:30 PM. Reply *yes* 🙏🏾`;
    case 'before_sunrise':
      return `Want a reminder for the next sunrise (${r.display})? I'll nudge you about 1 hour before. Reply *yes* 🙏🏾`;
    default:
      return `Want me to set a reminder? Reply *yes* 🙏🏾`;
  }
}

// The confirmation sent right after the user says "yes".
export function confirmText(r) {
  switch (r.fire) {
    case 'before_sunset':
      return `Done 🙏🏾 I'll remind you 1 hour before sunset today.`;
    case 'morning':
      return `Done 🙏🏾 I'll send you a heads-up tomorrow morning — sunset in ${r.city} is at ${r.display}.`;
    case 'evening':
      return `Done 🙏🏾 I'll remind you tonight at 8:30 PM. Next sunrise in ${r.city} is at ${r.display}.`;
    case 'before_sunrise':
      return `Done 🙏🏾 I'll remind you about 1 hour before the next sunrise (${r.display}).`;
    default:
      return `Done 🙏🏾 Reminder set.`;
  }
}

// The actual reminder message the cron sends. Always opens with "Your reminder:".
// `footer` is appended (built by the cron from the remaining queue).
export function reminderText(r, footer = '') {
  let body;
  switch (r.fire) {
    case 'before_sunset':
      body = `🌇 Sunset in ${r.city} is in about 1 hour — at ${r.display}.`; break;
    case 'morning':
      body = `🌇 Today's sunset in ${r.city} is at ${r.display}.`; break;
    case 'evening':
      body = `🌅 Tomorrow's sunrise in ${r.city} is at ${r.display}.`; break;
    case 'before_sunrise':
      body = `🌅 Sunrise in ${r.city} is in about 1 hour — at ${r.display}.`; break;
    default:
      body = `🔔 ${r.display} in ${r.city}.`;
  }
  return `Your reminder: ${body}${footer ? `\n\n${footer}` : ''}`;
}

// The footer the cron appends. If other reminders remain, name the next one and
// offer cancel; otherwise tell the user how to set another.
export function footerText(remaining) {
  if (remaining && remaining.length > 0) {
    return `You also have a reminder set for ${remaining[0].display}. Reply *cancel* to stop your reminders.`;
  }
  return `No more reminders set. I can set up another reminder the next time you ask for sunset or sunrise 🙏🏾`;
}

// ── Storage ──────────────────────────────────────────────────────────────────
// Append a reminder to the user's queue and clear pending, in ONE updateUser.
// Reads the queue FRESH from Supabase first so a stale KV copy can't drop an
// existing reminder. `extraFields` lets the caller fold in history in the same
// write. Mutates `user` in place too.
export async function commitReminder(phone, user, reminder, env, extraFields = {}) {
  const fresh = await fetchScheduledReminders(phone, env);
  const next = [...fresh, { ...reminder, sent: false }];
  await updateUser(phone, { scheduled_reminders: next, pending_action: null, ...extraFields }, env);
  user.scheduled_reminders = next;
  user.pending_action = null;
  return next;
}

// Active (unsent, still-future) reminders, read FRESH from Supabase — used by
// cancel so a stale KV read can't make us miss a just-set reminder.
export async function activeReminders(phone, env, now = new Date()) {
  const arr = await fetchScheduledReminders(phone, env);
  return arr.filter(r => !r.sent && Date.parse(r.send_at) > now.getTime());
}

// Clear all reminders for a user (cancel). One field-scoped write.
export async function clearReminders(phone, user, env) {
  await updateUser(phone, { scheduled_reminders: [] }, env);
  if (user) user.scheduled_reminders = [];
}

// Human label for what a cancel just removed.
export function cancelSummary(active) {
  if (!active || active.length === 0) return '';
  if (active.length === 1) {
    const r = active[0];
    return `${r.type} reminder (${r.display})`;
  }
  return `${active.length} reminders`;
}

// True if the user has any unsent, still-future reminder (used to decide the
// cron footer). Operates on the in-memory user.
export function hasPendingReminders(user, now = new Date()) {
  const arr = Array.isArray(user?.scheduled_reminders) ? user.scheduled_reminders : [];
  return arr.some(r => !r.sent && Date.parse(r.send_at) > now.getTime());
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Cron dispatch ────────────────────────────────────────────────────────────
// Send every due, unsent reminder whose user is still inside their 24h WhatsApp
// session. MARK-THEN-SEND: we persist sent=true BEFORE sending, so a send
// failure is a (rare) silent miss rather than a duplicate on the next run. The
// caller holds a KV lock so two cron runs never overlap here.
export async function dispatchDueReminders(env, now = new Date()) {
  const nowMs = now.getTime();
  const users = await fetchUsersWithDueReminders(env);
  let sent = 0, skipped = 0;

  for (const u of users) {
    const phone = u.phone_number;
    const arr = Array.isArray(u.scheduled_reminders) ? u.scheduled_reminders : [];
    const due = arr.filter(r => !r.sent && Date.parse(r.send_at) <= nowMs);
    if (due.length === 0) continue;

    const sessionOpen = u.last_message_at &&
      (nowMs - Date.parse(u.last_message_at)) <= DAY_MS;

    // 1) MARK first — flip due → sent, drop long-past sent entries to keep the
    //    array small, persist once.
    const marked = arr.map(r => (due.includes(r) ? { ...r, sent: true } : r));
    const pruned = marked.filter(r => !(r.sent && Date.parse(r.send_at) < nowMs - DAY_MS));
    await updateUser(phone, { scheduled_reminders: pruned }, env);

    // 2) Then SEND. A reminder past due can't be usefully retried, so even a
    //    closed session is just logged — it stays marked, no re-fire.
    if (!sessionOpen) {
      console.log(`[reminder] skip_closed_session to=${phone} due=${due.length}`);
      skipped += due.length;
      continue;
    }
    const remaining = marked.filter(r => !r.sent && Date.parse(r.send_at) > nowMs);
    for (const r of due.sort((a, b) => Date.parse(a.send_at) - Date.parse(b.send_at))) {
      try {
        await sendMessage(phone, reminderText(r, footerText(remaining)), env);
        console.log(`[reminder] sent type=${r.type} fire=${r.fire} to=${phone}`);
        sent++;
      } catch (e) {
        console.log(`[reminder] send_error to=${phone} err=${e.message}`);
      }
    }
  }
  console.log(`[reminder] dispatch_done users=${users.length} sent=${sent} skipped=${skipped}`);
}
