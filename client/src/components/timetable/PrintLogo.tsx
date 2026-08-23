/**
 * The college's logo, above the timetable, on the two print surfaces the
 * office asked for it on: the single section sheet (SectionTimetablePage)
 * and each page of the full print run (PrintAllPage).
 *
 * `client/public/logo.jpeg` is the only logo asset in the project — there is
 * no admin-configurable branding setting to read a path from (no schema
 * field for one), so this is the one place that names the file. If a
 * configurable logo is ever added, this is the only line that needs to
 * change.
 */
const LOGO_SRC = "/logo.jpeg"

export function PrintLogo() {
  return (
    <img
      src={LOGO_SRC}
      alt=""
      // Small and centred — a header ornament above the branch/section
      // title, not competing with it. object-contain keeps the college's
      // actual logo aspect ratio regardless of the source file's shape.
      className="mx-auto mb-2 h-12 w-auto object-contain print:h-14"
      // A missing/broken file collapses to nothing rather than showing the
      // browser's broken-image icon on every printed sheet.
      onError={(e) => {
        e.currentTarget.style.display = "none"
      }}
    />
  )
}
