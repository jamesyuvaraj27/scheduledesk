import * as React from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { KeyRound, ShieldCheck } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ErrorState } from "@/components/ui/feedback"
import { useAdminAuth } from "@/context/AdminAuth"

export function LoginPage() {
  const { admin, login, passwordConfigured } = useAdminAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<unknown>(null)
  const [busy, setBusy] = React.useState(false)

  const from = (location.state as { from?: string } | null)?.from ?? "/admin"

  React.useEffect(() => {
    if (admin) navigate(from, { replace: true })
  }, [admin, from, navigate])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="size-4" /> Administrator sign in
          </CardTitle>
          <CardDescription>
            Only the timetable office needs to sign in. Students and faculty can
            use the{" "}
            <Link to="/" className="underline underline-offset-2">
              timetable
            </Link>{" "}
            and{" "}
            <Link to="/adjustment" className="underline underline-offset-2">
              class adjustment
            </Link>{" "}
            pages without an account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!passwordConfigured && (
            <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              No administrator password is set on the server yet. Add{" "}
              <code className="font-mono text-xs">ADMIN_PASSWORD</code> to the
              server environment and restart it.
            </div>
          )}

          <form onSubmit={submit} className="space-y-3">
            {error ? <ErrorState error={error} /> : null}

            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <Button type="submit" className="w-full" disabled={busy || !password}>
              <KeyRound />
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
