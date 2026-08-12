import * as XLSX from "xlsx"

/**
 * Read a spreadsheet into a plain grid of strings.
 *
 * The important detail is merged cells. Timetable sheets merge a lab across
 * three period columns, and by default a merge yields the value in the first
 * cell and blanks in the rest — which reads as "one class then two free
 * periods". Expanding merges first means the parser sees the lab occupying
 * all three, which is what it actually does.
 */
export async function readSheetAsGrid(file: File): Promise<{
  rows: string[][]
  sheetNames: string[]
  usedSheet: string
}> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false })

  const usedSheet = workbook.SheetNames[0]
  if (!usedSheet) throw new Error("That file has no sheets in it.")

  const sheet = workbook.Sheets[usedSheet]
  const rows = sheetToGrid(sheet)

  return { rows, sheetNames: workbook.SheetNames, usedSheet }
}

export function sheetToGrid(sheet: XLSX.WorkSheet): string[][] {
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: true,
  })

  const grid: string[][] = rows.map((row) =>
    Array.isArray(row) ? row.map((c) => String(c ?? "").trim()) : []
  )

  // Fill every cell of a merged range with the range's value.
  for (const merge of sheet["!merges"] ?? []) {
    const value = grid[merge.s.r]?.[merge.s.c] ?? ""
    if (!value) continue
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      if (!grid[r]) grid[r] = []
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        grid[r][c] = value
      }
    }
  }

  // Pad rows to equal width so column indexes line up everywhere.
  const width = Math.max(0, ...grid.map((r) => r.length))
  return grid.map((row) => {
    const copy = [...row]
    while (copy.length < width) copy.push("")
    return copy
  })
}

/** Parse pasted text (tab- or comma-separated) into the same grid shape. */
export function textToGrid(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const delimiter = lines[0]?.includes("\t") ? "\t" : ","
  const grid = lines.map((line) => line.split(delimiter).map((c) => c.trim()))
  const width = Math.max(0, ...grid.map((r) => r.length))
  return grid.map((row) => {
    const copy = [...row]
    while (copy.length < width) copy.push("")
    return copy
  })
}
