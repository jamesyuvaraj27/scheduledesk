import * as React from "react"
import { Plus, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ErrorState, LoadingState, EmptyState } from "@/components/ui/feedback"

/**
 * Shared shell for every master-data screen: a card with a titled header, an
 * "Add" button that opens a form dialog, a table of rows, and consistent
 * loading / empty / error handling.
 */
export function CrudSection<T extends { id: string }>({
  title,
  description,
  items,
  isLoading,
  error,
  columns,
  renderRow,
  formTitle,
  renderForm,
  onDelete,
  deleteError,
  addLabel = "Add",
  emptyHint,
  disabled,
  disabledHint,
  toolbar,
  headerAction,
}: {
  title: string
  description?: string
  items: T[] | undefined
  isLoading: boolean
  error: unknown
  columns: string[]
  renderRow: (item: T, actions: { edit: () => void; remove: () => void }) => React.ReactNode
  formTitle: (editing: T | null) => string
  renderForm: (editing: T | null, close: () => void) => React.ReactNode
  onDelete?: (id: string) => void
  deleteError?: unknown
  addLabel?: string
  emptyHint?: string
  disabled?: boolean
  disabledHint?: string
  /** Filter controls rendered above the table. */
  toolbar?: React.ReactNode
  /** Extra button(s) beside "Add", e.g. a bulk-create action. */
  headerAction?: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<T | null>(null)

  const close = () => {
    setOpen(false)
    setEditing(null)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <div className="flex items-center gap-2">
          {headerAction}
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)
              setOpen(true)
            }}
            disabled={disabled}
          >
            <Plus /> {addLabel}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {disabled && disabledHint && (
          <p className="text-sm text-muted-foreground">{disabledHint}</p>
        )}
        {toolbar ? (
          <div className="flex flex-wrap items-end gap-3">{toolbar}</div>
        ) : null}
        {deleteError ? <ErrorState error={deleteError} /> : null}

        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} />
        ) : !items?.length ? (
          <EmptyState title={`No ${title.toLowerCase()} yet`} hint={emptyHint} />
        ) : (
          <div className="relative w-full overflow-x-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="[&_tr]:border-b">
                <tr className="border-b">
                  {columns.map((c) => (
                    <th
                      key={c}
                      className="h-10 px-3 text-left align-middle font-medium text-muted-foreground"
                    >
                      {c}
                    </th>
                  ))}
                  <th className="h-10 px-3 w-20" />
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {items.map((item) => (
                  <tr key={item.id} className="border-b transition-colors hover:bg-muted/50">
                    {renderRow(item, {
                      edit: () => {
                        setEditing(item)
                        setOpen(true)
                      },
                      remove: () => onDelete?.(item.id),
                    })}
                    <td className="px-3 py-2 align-middle">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Edit"
                          onClick={() => {
                            setEditing(item)
                            setOpen(true)
                          }}
                        >
                          <Pencil />
                        </Button>
                        {onDelete && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Delete"
                            className="text-destructive hover:text-destructive"
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Delete this record? This cannot be undone."
                                )
                              ) {
                                onDelete(item.id)
                              }
                            }}
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onClose={close} title={formTitle(editing)}>
        {renderForm(editing, close)}
      </Dialog>
    </Card>
  )
}
