import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Minimal modal built on the native <dialog> element — no extra dependency,
 * and we get focus trapping and Esc-to-close from the platform.
 *
 * Sizing is deliberately phone-first: the box is inset from the viewport
 * edges rather than flush against them, and it is capped at the visible
 * viewport height with its own scroll. Without the cap, a long form (faculty
 * eligibility, the room bulk-create) grew taller than the screen on a phone
 * and the submit button became unreachable — a native <dialog> doesn't scroll
 * its own overflow, and the page behind it is inert while it's open.
 *
 * `dvh` rather than `vh` so the mobile browser's collapsing address bar
 * doesn't leave the last row of the form under it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  const ref = React.useRef<HTMLDialogElement>(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className={cn(
        "backdrop:bg-black/50 bg-transparent p-0",
        "w-[calc(100%-1.5rem)] max-w-lg max-h-[calc(100dvh-2rem)]",
        "open:animate-in open:fade-in-0"
      )}
    >
      <div
        className={cn(
          "rounded-xl border bg-background text-foreground shadow-lg m-auto",
          // The header stays put while a long body scrolls under it.
          "max-h-[calc(100dvh-2rem)] flex flex-col",
          className
        )}
      >
        <div className="flex items-start justify-between gap-4 p-5 pb-3 shrink-0">
          <div className="min-w-0">
            <h2 className="font-semibold break-words">{title}</h2>
            {description && (
              <p className="text-sm text-muted-foreground mt-1 break-words">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground rounded-md p-1 shrink-0"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-5">{children}</div>
      </div>
    </dialog>
  )
}
