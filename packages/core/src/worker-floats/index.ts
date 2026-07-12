// Float acknowledgment timing — PURE (zero Supabase, zero clock; `now` injected).
//
// TypeScript port of the mobile shared ack rules (apps/mobile/.../ack/Ack.kt). A worker
// may accept or decline an inbound float only STRICTLY before the ack deadline, which is
// T-10m before the float starts (matches the phase-12 notification cadence). At/after the
// deadline the float is being reassigned and the buttons are replaced by a note.

import { ACK_DEADLINE_LEAD_MINUTES } from '../notifications/ack-cadence.js';

export const ACK_URGENT_REMAINING_MINUTES = 30;

const MIN_MS = 60 * 1000;

/** T-10m before the float start. */
export function ackDeadline(floatStart: Date): Date {
  return new Date(floatStart.getTime() - ACK_DEADLINE_LEAD_MINUTES * MIN_MS);
}

/** Inclusive of the deadline instant: at exactly the deadline, responding is disabled. */
export function isPastAckDeadline(floatStart: Date, now: Date): boolean {
  return now.getTime() >= ackDeadline(floatStart).getTime();
}

/** Strictly before the deadline: only a response completed before T-10m succeeds. */
export function canRespondToFloat(floatStart: Date, now: Date): boolean {
  return now.getTime() < ackDeadline(floatStart).getTime();
}

/** Within the last 30 minutes before the deadline — the UI emphasises the countdown. */
export function isAckUrgent(floatStart: Date, now: Date): boolean {
  if (isPastAckDeadline(floatStart, now)) return false;
  return ackDeadline(floatStart).getTime() - now.getTime() <= ACK_URGENT_REMAINING_MINUTES * MIN_MS;
}

/** How many minutes remain to respond (>= 0), for a live "N left" countdown. */
export function minutesToRespond(floatStart: Date, now: Date): number {
  return Math.max(0, Math.floor((ackDeadline(floatStart).getTime() - now.getTime()) / MIN_MS));
}
