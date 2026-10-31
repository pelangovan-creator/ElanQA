/** Wall-clock parts of an instant in an IANA time zone (no external dependency). */
export interface ZonedParts { date: string; time: string; minutes: number }

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

export function zoned(now: Date, timeZone: string): ZonedParts {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const time = `${parts.hour}:${parts.minute}`;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const isHHMM = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/**
 * Which slots are due now. A slot is due from its time until `graceMinutes` later (catch-up after a restart);
 * the caller makes it idempotent per slot and day.
 */
export function dueSlots(now: Date, timeZone: string, slots: { slot: string; time: string }[], graceMinutes = 180) {
  const z = zoned(now, timeZone);
  return slots
    .filter((s) => z.minutes >= toMinutes(s.time) && z.minutes < toMinutes(s.time) + graceMinutes)
    .map((s) => ({ slot: s.slot, scheduledFor: `${z.date} ${s.slot}`, late: z.minutes - toMinutes(s.time) > 2 }));
}
