import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api, setActiveVersion } from "@/lib/api"
import type { VersionState } from "@/lib/types"

interface VersionContextValue {
  /** Which timetable the admin screens are currently pointed at. */
  editing: "LIVE" | "WORKING"
  setEditing: (v: "LIVE" | "WORKING") => void
  state: VersionState | null
  loading: boolean
  refetch: () => void
}

const VersionContext = React.createContext<VersionContextValue | null>(null)

/**
 * Live vs Working, for the admin side.
 *
 * The choice is kept here and pushed into the API layer, which sends it as a
 * header on every admin request. It is *not* the safety mechanism — the server
 * locks the live timetable the moment a working copy exists — it just decides
 * which set of rows the screens show.
 */
export function TimetableVersionProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const qc = useQueryClient()
  const [editing, setEditingState] = React.useState<"LIVE" | "WORKING">("LIVE")

  const query = useQuery({
    queryKey: ["timetable-versions"],
    queryFn: () => api.get<VersionState>("/timetable-versions"),
    retry: false,
  })

  const setEditing = React.useCallback(
    (v: "LIVE" | "WORKING") => {
      setActiveVersion(v)
      setEditingState(v)
      // Every cached timetable belongs to the version it was fetched under.
      qc.invalidateQueries()
    },
    [qc]
  )

  // As soon as a working copy exists, move the admin onto it — the live one is
  // read-only from that moment, so leaving them pointed at it would only
  // produce refusals. Dropping the working copy sends them back.
  const hasWorking = Boolean(query.data?.working)
  React.useEffect(() => {
    if (hasWorking && editing !== "WORKING") setEditing("WORKING")
    if (!hasWorking && editing !== "LIVE") setEditing("LIVE")
  }, [hasWorking, editing, setEditing])

  const value = React.useMemo<VersionContextValue>(
    () => ({
      editing,
      setEditing,
      state: query.data ?? null,
      loading: query.isLoading,
      refetch: () => {
        void query.refetch()
      },
    }),
    [editing, setEditing, query]
  )

  return <VersionContext.Provider value={value}>{children}</VersionContext.Provider>
}

export function useTimetableVersion(): VersionContextValue {
  const ctx = React.useContext(VersionContext)
  if (!ctx) {
    throw new Error("useTimetableVersion must be used inside TimetableVersionProvider")
  }
  return ctx
}
