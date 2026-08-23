import * as React from "react"
import { NavLink, Outlet, Link, useLocation } from "react-router-dom"
import { CalendarDays, ClipboardList, LogIn, Menu, UserCheck, Users, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useAdminAuth } from "@/context/AdminAuth"

const navItems = [
  { to: "/", label: "Timetable", icon: CalendarDays, end: true },
  { to: "/faculty", label: "Faculty Timetable", icon: Users },
  { to: "/reports/day-wise", label: "Day-wise Report", icon: ClipboardList },
  { to: "/adjustment", label: "Class Adjustment", icon: UserCheck },
]

/**
 * The shell everyone sees without signing in. It deliberately contains no
 * link to anything that changes data — the only way through to the admin side
 * is the sign-in link.
 *
 * Four items with icons don't fit next to the logo and sign-in link below
 * `lg` without wrapping or scrolling sideways, so below that breakpoint they
 * collapse into a hamburger menu (same pattern as AppLayout's admin nav).
 */
export function PublicLayout() {
  const { admin } = useAdminAuth()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = React.useState(false)

  React.useEffect(() => setMenuOpen(false), [location.pathname])

  return (
    <div className="min-h-svh flex flex-col">
      <header className="border-b bg-background print:hidden">
        <div className="mx-auto max-w-6xl flex items-center gap-4 px-4 h-14">
          <Button
            size="icon"
            variant="ghost"
            className="lg:hidden -ml-2"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <X /> : <Menu />}
          </Button>

          <Link to="/" className="font-semibold shrink-0">
            ScheduleDesk
          </Link>

          <nav className="hidden lg:flex gap-1 text-sm">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 whitespace-nowrap transition-colors",
                    isActive
                      ? "bg-muted text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  )
                }
              >
                <item.icon className="size-3.5" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto shrink-0">
            <Link
              to={admin ? "/admin" : "/login"}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <LogIn className="size-3.5" />
              <span className="hidden sm:inline">{admin ? "Admin" : "Staff sign in"}</span>
            </Link>
          </div>
        </div>

        {/* Always mounted (not conditionally rendered) so the grid-rows
            transition can animate open/close instead of snapping. */}
        <div
          className={cn(
            "lg:hidden grid transition-[grid-template-rows] duration-200 ease-in-out",
            menuOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          )}
        >
          <nav className="overflow-hidden border-t bg-background">
            <div className="mx-auto max-w-6xl px-4 py-2 grid gap-0.5 text-sm">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-1.5 rounded-md px-2 py-2 transition-colors",
                      isActive
                        ? "bg-muted text-foreground font-medium"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )
                  }
                >
                  <item.icon className="size-3.5" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </nav>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full min-w-0 max-w-6xl px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t py-4">
        <p className="mx-auto max-w-6xl px-4 text-xs text-muted-foreground">
          Showing the published timetable. Changes being prepared for a future
          week are not visible here until they are published.
        </p>
      </footer>
    </div>
  )
}
