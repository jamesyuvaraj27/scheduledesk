import * as React from "react"

/**
 * Shrinks its children to fit on one printed page, only when they'd
 * otherwise overflow it.
 *
 * `@media print` alone can't do this: it can pick landscape and set margins,
 * but a wide table (many periods) or a tall one (a section grid plus its
 * room timetable stacked underneath) still gets clipped by `overflow-x-auto`
 * or pushed onto a second page, because CSS has no "make this fit" primitive
 * for content whose size isn't known until it's rendered.
 *
 * This measures the *unscaled* content right before printing and applies a
 * `transform: scale()` — but a transform alone doesn't change layout, so the
 * browser would still think the box is full size and could still break the
 * page. Setting the outer wrapper's width/height to the *scaled* pixel size
 * makes the page-flow box match what's visually there, so it reads as one
 * page-sized block.
 *
 * These page dimensions must stay in sync with the `@page` rule in index.css
 * (landscape, 12mm margins).
 */
const PAGE_WIDTH_MM = 297
const PAGE_HEIGHT_MM = 210
const PAGE_MARGIN_MM = 12
const MM_TO_PX = 96 / 25.4

const PAGE_CONTENT_WIDTH_PX = (PAGE_WIDTH_MM - PAGE_MARGIN_MM * 2) * MM_TO_PX
const PAGE_CONTENT_HEIGHT_PX = (PAGE_HEIGHT_MM - PAGE_MARGIN_MM * 2) * MM_TO_PX

export function PrintFitPage({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const outerRef = React.useRef<HTMLDivElement>(null)
  const innerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const reset = () => {
      const outer = outerRef.current
      const inner = innerRef.current
      if (inner) inner.style.transform = ""
      if (outer) {
        outer.style.width = ""
        outer.style.height = ""
      }
    }

    const fit = () => {
      const outer = outerRef.current
      const inner = innerRef.current
      if (!outer || !inner) return

      // Measure unscaled — undo any previous fit first.
      reset()
      const naturalWidth = inner.scrollWidth
      const naturalHeight = inner.scrollHeight
      if (!naturalWidth || !naturalHeight) return

      const scale = Math.min(
        1,
        PAGE_CONTENT_WIDTH_PX / naturalWidth,
        PAGE_CONTENT_HEIGHT_PX / naturalHeight
      )
      if (scale >= 1) return // already fits — leave it full size and crisp

      inner.style.transformOrigin = "top left"
      inner.style.transform = `scale(${scale})`
      outer.style.width = `${naturalWidth * scale}px`
      outer.style.height = `${naturalHeight * scale}px`
    }

    // beforeprint/afterprint cover Chrome, Edge and Firefox; matchMedia
    // covers Safari, which historically fires beforeprint unreliably.
    const mql = window.matchMedia("print")
    const onMqlChange = (e: MediaQueryListEvent) => (e.matches ? fit() : reset())

    window.addEventListener("beforeprint", fit)
    window.addEventListener("afterprint", reset)
    mql.addEventListener("change", onMqlChange)
    return () => {
      window.removeEventListener("beforeprint", fit)
      window.removeEventListener("afterprint", reset)
      mql.removeEventListener("change", onMqlChange)
    }
  }, [])

  return (
    <div ref={outerRef} className={className}>
      <div ref={innerRef} className="print:break-inside-avoid">
        {children}
      </div>
    </div>
  )
}
