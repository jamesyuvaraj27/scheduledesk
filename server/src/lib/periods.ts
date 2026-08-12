/**
 * Period-grid computation.
 *
 * The whole app is driven by a small TimeConfig (start time, period count,
 * period duration, where break/lunch fall). Everything else — the clock times
 * shown in the header, which 3-period windows a lab may occupy — is DERIVED
 * from that config rather than hardcoded. Change the config and the grid,
 * the printed timetable and the lab rules all follow automatically.
 */

export type SlotKind = "PERIOD" | "BREAK" | "LUNCH";

export interface GridSlot {
  kind: SlotKind;
  /** 1-based period number; null for break/lunch slots. */
  period: number | null;
  /** "08:00" */
  startTime: string;
  /** "08:50" */
  endTime: string;
}

export interface TimeConfigInput {
  startTime: string;
  numPeriods: number;
  periodDurationMin: number;
  breakAfterPeriod: number;
  breakDurationMin: number;
  lunchAfterPeriod: number;
  lunchDurationMin: number;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) {
    throw new Error(`Invalid time "${hhmm}", expected HH:MM`);
  }
  return h * 60 + m;
}

function toHHMM(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Walk the config forward to produce the ordered list of slots for one day,
 * with real clock times. Break and lunch are inserted as their own slots
 * after the period they're configured to follow.
 */
export function buildDayGrid(cfg: TimeConfigInput): GridSlot[] {
  const slots: GridSlot[] = [];
  let cursor = toMinutes(cfg.startTime);

  for (let period = 1; period <= cfg.numPeriods; period++) {
    const end = cursor + cfg.periodDurationMin;
    slots.push({
      kind: "PERIOD",
      period,
      startTime: toHHMM(cursor),
      endTime: toHHMM(end),
    });
    cursor = end;

    if (period === cfg.breakAfterPeriod && cfg.breakDurationMin > 0) {
      const breakEnd = cursor + cfg.breakDurationMin;
      slots.push({
        kind: "BREAK",
        period: null,
        startTime: toHHMM(cursor),
        endTime: toHHMM(breakEnd),
      });
      cursor = breakEnd;
    }

    if (period === cfg.lunchAfterPeriod && cfg.lunchDurationMin > 0) {
      const lunchEnd = cursor + cfg.lunchDurationMin;
      slots.push({
        kind: "LUNCH",
        period: null,
        startTime: toHHMM(cursor),
        endTime: toHHMM(lunchEnd),
      });
      cursor = lunchEnd;
    }
  }

  return slots;
}

/** Clock time the day ends, derived from the config. */
export function dayEndTime(cfg: TimeConfigInput): string {
  const grid = buildDayGrid(cfg);
  return grid.length ? grid[grid.length - 1].endTime : cfg.startTime;
}

export const LAB_SPAN = 3;

/**
 * Which period numbers may a 3-hour lab START at?
 *
 * Rule (confirmed with the user): a lab must occupy three CONSECUTIVE periods.
 * Lunch does NOT break that continuity — a lab may run "1 period before lunch
 * + 2 periods after lunch", because lunch isn't a teaching period. The short
 * mid-morning break DOES break continuity, so no lab may straddle it.
 */
export function validLabStartPeriods(cfg: TimeConfigInput): number[] {
  const starts: number[] = [];

  for (let start = 1; start + LAB_SPAN - 1 <= cfg.numPeriods; start++) {
    const last = start + LAB_SPAN - 1;
    // The break sits after period `breakAfterPeriod`. If that boundary falls
    // strictly inside the window, the lab would straddle the break.
    const straddlesBreak =
      cfg.breakDurationMin > 0 &&
      cfg.breakAfterPeriod >= start &&
      cfg.breakAfterPeriod < last;

    if (!straddlesBreak) starts.push(start);
  }

  return starts;
}

/** The concrete period numbers a lab starting at `startPeriod` occupies. */
export function labPeriods(startPeriod: number): number[] {
  return Array.from({ length: LAB_SPAN }, (_, i) => startPeriod + i);
}

/** Period numbers occupied by an entry, for clash checking. */
export function occupiedPeriods(startPeriod: number, span: number): number[] {
  return Array.from({ length: span }, (_, i) => startPeriod + i);
}
