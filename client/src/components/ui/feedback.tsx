import { AlertCircle, Inbox, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { ApiError } from "@/lib/api"

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} />
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
      <Spinner />
      {label}
    </div>
  )
}

export function ErrorState({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Something went wrong"

  const details = error instanceof ApiError ? error.details : undefined

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <div className="flex items-center gap-2 font-medium">
        <AlertCircle className="size-4" />
        {message}
      </div>
      {details?.length ? (
        <ul className="mt-2 ml-6 list-disc space-y-0.5">
          {details.map((d) => (
            <li key={d.path}>
              <span className="font-medium">{d.path}</span>: {d.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function EmptyState({
  title,
  hint,
}: {
  title: string
  hint?: string
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <Inbox className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-sm text-muted-foreground max-w-sm">{hint}</p>}
    </div>
  )
}
