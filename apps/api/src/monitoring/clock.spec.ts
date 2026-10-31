import { dueSlots, isValidTimeZone, zoned } from './clock';

const SLOTS = [{ slot: 'Morning', time: '09:30' }, { slot: 'Evening', time: '18:00' }];

describe('clock', () => {
  it('converts to the project time zone (IST = UTC+5:30, no DST)', () => {
    expect(zoned(new Date('2026-10-31T04:00:00Z'), 'Asia/Kolkata')).toEqual({ date: '2026-10-31', time: '09:30', minutes: 570 });
    expect(zoned(new Date('2026-10-31T20:00:00Z'), 'Asia/Kolkata').date).toBe('2026-11-01');
  });
  it('handles daylight saving zones', () => {
    expect(zoned(new Date('2026-07-01T13:30:00Z'), 'America/New_York').time).toBe('09:30');
    expect(zoned(new Date('2026-12-01T14:30:00Z'), 'America/New_York').time).toBe('09:30');
  });
  it('slots are due from their time for the grace window, flagged late after 2 minutes', () => {
    expect(dueSlots(new Date('2026-10-31T03:59:00Z'), 'Asia/Kolkata', SLOTS)).toEqual([]);
    expect(dueSlots(new Date('2026-10-31T04:00:30Z'), 'Asia/Kolkata', SLOTS)).toEqual([{ slot: 'Morning', scheduledFor: '2026-10-31 Morning', late: false }]);
    expect(dueSlots(new Date('2026-10-31T06:00:00Z'), 'Asia/Kolkata', SLOTS)).toEqual([{ slot: 'Morning', scheduledFor: '2026-10-31 Morning', late: true }]);
    expect(dueSlots(new Date('2026-10-31T07:00:00Z'), 'Asia/Kolkata', SLOTS)).toEqual([]); // 12:30 IST: past the 3-hour grace
    expect(dueSlots(new Date('2026-10-31T12:30:00Z'), 'Asia/Kolkata', SLOTS)).toEqual([{ slot: 'Evening', scheduledFor: '2026-10-31 Evening', late: false }]);
  });
  it('validates time zones', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});
