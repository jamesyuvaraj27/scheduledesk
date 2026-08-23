/**
 * The one shared rule for "in what order do sections/branches print, list,
 * and appear in dropdowns" — everywhere in the app that shows more than one
 * section is supposed to import this rather than inventing its own sort, so
 * the office never sees CSM and CSD interleaved on one screen and grouped on
 * another.
 *
 * Requested order: CSM, then CSD, then CAI, then AIML, then (if the college
 * ever adds one) anything else alphabetically by code. Within a branch:
 * section name A, B, C, ... Year groups first wherever a list spans more
 * than one year, matching every existing `orderBy: [{ year }, { name }]`
 * query in this codebase — this just inserts branch priority between them.
 *
 * NOTE: the request that asked for this literally said "AML" as the fourth
 * priority branch, but this college's real data (confirmed against the live
 * API) uses the code AIML — ASCE's four branches are CSM / CAI / CSD / AIML,
 * per PLAN.md and the live /api/public/day-wise-report response. "AML"
 * matches no branch that exists, so it's mapped to AIML here. If a real
 * "AML" branch is ever added distinct from AIML, this list needs a second
 * entry — it will otherwise fall into the "anything else, alphabetically"
 * bucket below rather than being silently missorted.
 */
export const BRANCH_PRIORITY = ["CSM", "CSD", "CAI", "AIML"]

/** Position in the priority list, or one past the end for anything else. */
export function branchRank(code: string | null | undefined): number {
  if (!code) return BRANCH_PRIORITY.length
  const i = BRANCH_PRIORITY.indexOf(code.toUpperCase())
  return i === -1 ? BRANCH_PRIORITY.length : i
}

/**
 * Builds a comparator for anything shaped like a section (or a branch, by
 * omitting `yearOf`/passing a constant `nameOf`). Extractor functions rather
 * than a fixed shape because every endpoint that lists sections nests the
 * branch code differently (`section.branch.code`, `branchCode`, `department`
 * wrappers, and so on) — this way each call site adapts its own shape
 * in one line instead of this function assuming one.
 */
export function compareSections<T>(opts: {
  /** Omit for a flat, single-year list (or when sorting branches, not sections). */
  yearOf?: (item: T) => number | null | undefined
  branchCodeOf: (item: T) => string | null | undefined
  nameOf: (item: T) => string
}): (a: T, b: T) => number {
  return (a, b) => {
    if (opts.yearOf) {
      const ya = opts.yearOf(a) ?? 0
      const yb = opts.yearOf(b) ?? 0
      if (ya !== yb) return ya - yb
    }

    const ra = branchRank(opts.branchCodeOf(a))
    const rb = branchRank(opts.branchCodeOf(b))
    if (ra !== rb) return ra - rb

    // Both fell into the "anything else" bucket — order those alphabetically
    // by code so they're at least stable and grouped, rather than left in
    // whatever order the database happened to return them.
    if (ra === BRANCH_PRIORITY.length) {
      const ca = opts.branchCodeOf(a) ?? ""
      const cb = opts.branchCodeOf(b) ?? ""
      if (ca !== cb) return ca.localeCompare(cb)
    }

    return opts.nameOf(a).localeCompare(opts.nameOf(b))
  }
}
