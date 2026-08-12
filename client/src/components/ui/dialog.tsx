import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Minimal modal built on the native <dialog> element — no extra dependency,
 * and we get focus trapping and Esc-to-close from the platform.
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
        "backdrop:bg-black/50 bg-transparent p-0 max-w-lg w-full",
        "open:animate-in open:fade-in-0"
      )}
    >
      <div
        className={cn(
          "rounded-xl border bg-background text-foreground shadow-lg p-5 m-auto",
          className
        )}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="font-semibold">{title}</h2>
            {description && (
              <p className="text-sm text-muted-foreground mt-1">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground rounded-md p-1"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
