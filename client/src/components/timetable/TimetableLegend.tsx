import { cn } from "@/lib/utils"
import { SESSION_LABEL, SESSION_ORDER, type SessionKind } from "./entryStyles"

/**
 * A plain-text key of session types, with no colour swatch.
 *
 * The colour-coded version of this (a small square per session type, keyed
 * to the cell fills) was reverted, and along with it every call site that
 * rendered this component — a key with nothing to key doesn't earn its
 * place under a grid. Left here, unused, in case a future revision wants a
 * plain reference list again.
 */
export function TimetableLegend({
  only,
  className,
}: {
  only?: SessionKind[]
  className?: string
}) {
  const kinds = only?.length
    ? SESSION_ORDER.filter((k) => only.includes(k))
    : SESSION_ORDER

  if (kinds.length === 0) return null

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]",
        className
      )}
    >
      <span className="font-semibold text-muted-foreground uppercase tracking-wide">
        Key
      </span>
      {kinds.map((kind) => (
        <span key={kind}>{SESSION_LABEL[kind]}</span>
      ))}
    </div>
  )
}
