import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { api, setUnauthorizedHandler } from "@/lib/api"

interface Me {
  admin: boolean
  passwordConfigured: boolean
}

interface AdminAuthValue {
  admin: boolean
  loading: boolean
  passwordConfigured: boolean
  login: (password: string) => Promise<void>
  logout: () => Promise<void>
}

const AdminAuthContext = React.createContext<AdminAuthValue | null>(null)

/**
 * Whether this browser holds an admin session.
 *
 * This only decides what to *show*. Every admin API is gated on the server
 * regardless of what happens here, so a doctored client can't get further
 * than a signed-out one.
 */
export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient()
  const [admin, setAdmin] = React.useState(false)
  const [passwordConfigured, setPasswordConfigured] = React.useState(true)
  const [loading, setLoading] = React.useState(true)

  const refresh = React.useCallback(async () => {
    try {
      const me = await api.get<Me>("/auth/me")
      setAdmin(me.admin)
      setPasswordConfigured(me.passwordConfigured)
    } catch {
      setAdmin(false)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  // If any request comes back 401 the session has expired mid-session; drop
  // straight back to the sign-in screen rather than showing empty pages.
  React.useEffect(() => {
    setUnauthorizedHandler(() => setAdmin(false))
    return () => setUnauthorizedHandler(null)
  }, [])

  const value = React.useMemo<AdminAuthValue>(
    () => ({
      admin,
      loading,
      passwordConfigured,
      login: async (password: string) => {
        await api.post("/auth/login", { password })
        setAdmin(true)
        qc.clear()
      },
      logout: async () => {
        await api.post("/auth/logout")
        setAdmin(false)
        qc.clear()
      },
    }),
    [admin, loading, passwordConfigured, qc]
  )

  return (
    <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
  )
}

export function useAdminAuth(): AdminAuthValue {
  const ctx = React.useContext(AdminAuthContext)
  if (!ctx) throw new Error("useAdminAuth must be used inside AdminAuthProvider")
  return ctx
}
