import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { BRANCH_PRIORITY, branchRank, compareSections } from "./sectionOrder.js"

describe("branchRank", () => {
  test("CSM, CSD, CAI, AIML rank in that priority order", () => {
    assert.deepEqual(BRANCH_PRIORITY, ["CSM", "CSD", "CAI", "AIML"])
    assert.ok(branchRank("CSM") < branchRank("CSD"))
    assert.ok(branchRank("CSD") < branchRank("CAI"))
    assert.ok(branchRank("CAI") < branchRank("AIML"))
  })

  test("is case-insensitive", () => {
    assert.equal(branchRank("csm"), branchRank("CSM"))
  })

  test("an unknown branch ranks after every priority branch", () => {
    assert.ok(branchRank("CSE") > branchRank("AIML"))
    assert.ok(branchRank(null) > branchRank("AIML"))
    assert.ok(branchRank(undefined) > branchRank("AIML"))
  })
})

describe("compareSections", () => {
  type Sec = { year: number; branch: { code: string }; name: string }
  const sec = (year: number, code: string, name: string): Sec => ({
    year,
    branch: { code },
    name,
  })
  const cmp = compareSections<Sec>({
    yearOf: (s) => s.year,
    branchCodeOf: (s) => s.branch.code,
    nameOf: (s) => s.name,
  })

  test("orders CSM, CSD, CAI, AIML within a year, matching the request's own example", () => {
    const input = [
      sec(2, "AIML", "A"),
      sec(2, "CAI", "A"),
      sec(2, "CSD", "A"),
      sec(2, "CSM", "A"),
    ]
    const sorted = [...input].sort(cmp)
    assert.deepEqual(
      sorted.map((s) => s.branch.code),
      ["CSM", "CSD", "CAI", "AIML"]
    )
  })

  test("sections within one branch order A, B, C by name", () => {
    const input = [sec(2, "CSM", "C"), sec(2, "CSM", "A"), sec(2, "CSM", "B")]
    const sorted = [...input].sort(cmp)
    assert.deepEqual(
      sorted.map((s) => s.name),
      ["A", "B", "C"]
    )
  })

  test("matches the exact worked example from the spec", () => {
    const input = [
      sec(3, "AIML", "A"),
      sec(3, "CAI", "A"),
      sec(3, "CSD", "B"),
      sec(3, "CSM", "B"),
      sec(3, "CSD", "A"),
      sec(3, "CSM", "A"),
      sec(3, "CSM", "C"),
    ]
    const sorted = [...input].sort(cmp)
    assert.deepEqual(
      sorted.map((s) => `${s.branch.code}-${s.name}`),
      ["CSM-A", "CSM-B", "CSM-C", "CSD-A", "CSD-B", "CAI-A", "AIML-A"]
    )
  })

  test("year groups first when a list spans multiple years", () => {
    const input = [sec(4, "CSM", "A"), sec(2, "AIML", "A"), sec(2, "CSM", "A")]
    const sorted = [...input].sort(cmp)
    assert.deepEqual(
      sorted.map((s) => `${s.year}-${s.branch.code}-${s.name}`),
      ["2-CSM-A", "2-AIML-A", "4-CSM-A"]
    )
  })

  test("a branch outside the priority list sorts after it, alphabetically among itself", () => {
    const withOther = compareSections<Sec>({
      branchCodeOf: (s) => s.branch.code,
      nameOf: (s) => s.name,
    })
    const input = [sec(1, "ECE", "A"), sec(1, "CSM", "A"), sec(1, "CSE", "A")]
    const sorted = [...input].sort(withOther)
    assert.deepEqual(
      sorted.map((s) => s.branch.code),
      ["CSM", "CSE", "ECE"]
    )
  })

  test("omitting yearOf sorts a flat, single-year-shaped list by branch then name only", () => {
    const flat = compareSections<{ branch: { code: string }; name: string }>({
      branchCodeOf: (s) => s.branch.code,
      nameOf: (s) => s.name,
    })
    const input = [{ branch: { code: "CAI" }, name: "A" }, { branch: { code: "CSM" }, name: "A" }]
    const sorted = [...input].sort(flat)
    assert.deepEqual(
      sorted.map((s) => s.branch.code),
      ["CSM", "CAI"]
    )
  })
})
