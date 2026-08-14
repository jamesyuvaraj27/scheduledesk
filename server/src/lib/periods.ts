/**
 * Period-grid computation.
 *
 * The whole app is driven by a small TimeConfig (start time, period count,
 * morning/afternoon period durations, where break/lunch fall). Everything
 * else — the clock times shown in the header, how long a block of periods
 * runs — is DERIVED from that config rather than hardcoded. Change the
 * config and the grid and the printed timetable follow automatically.
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
  /** Minutes this slot lasts. Periods differ morning vs afternoon. */
  durationMin: number;
}

export interface TimeConfigInput {
  startTime: string;
  numPeriods: number;
  /** Length of periods up to and including `lunchAfterPeriod`. */
  morningPeriodDurationMin: number;
  /** Length of periods after `lunchAfterPeriod`. */
  afternoonPeriodDurationMin: number;
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
 * How long a given period lasts.
 *
 * The morning/afternoon split is lunch: periods up to and including
 * `lunchAfterPeriod` are morning periods, everything after is afternoon.
 * If lunch is disabled (duration 0) the whole day uses the morning length,
 * since there is no boundary to switch at.
 */
export function periodDuration(cfg: TimeConfigInput, period: number): number {
  if (cfg.lunchDurationMin <= 0) return cfg.morningPeriodDurationMin;
  return period <= cfg.lunchAfterPeriod
    ? cfg.morningPeriodDurationMin
    : cfg.afternoonPeriodDurationMin;
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
    const duration = periodDuration(cfg, period);
    const end = cursor + duration;
    slots.push({
      kind: "PERIOD",
      period,
      startTime: toHHMM(cursor),
      endTime: toHHMM(end),
      durationMin: duration,
    });
    cursor = end;

    if (period === cfg.breakAfterPeriod && cfg.breakDurationMin > 0) {
      const breakEnd = cursor + cfg.breakDurationMin;
      slots.push({
        kind: "BREAK",
        period: null,
        startTime: toHHMM(cursor),
        endTime: toHHMM(breakEnd),
        durationMin: cfg.breakDurationMin,
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
        durationMin: cfg.lunchDurationMin,
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

/**
 * Which period numbers may a block of `span` periods START at?
 *
 * There is deliberately no continuity rule any more — the admin decides
 * where labs go, including across the break. The only constraint is that
 * the whole span has to fit inside the day.
 */
export function validStartPeriods(
  cfg: TimeConfigInput,
  span: number
): number[] {
  const starts: number[] = [];
  for (let start = 1; start + span - 1 <= cfg.numPeriods; start++) {
    starts.push(start);
  }
  return starts;
}

/** Period numbers occupied by an entry, for clash checking. */
export function occupiedPeriods(startPeriod: number, span: number): number[] {
  return Array.from({ length: span }, (_, i) => startPeriod + i);
}
