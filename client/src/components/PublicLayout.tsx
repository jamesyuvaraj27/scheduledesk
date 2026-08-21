import { NavLink, Outlet, Link } from "react-router-dom"
import { CalendarDays, ClipboardList, LogIn, UserCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAdminAuth } from "@/context/AdminAuth"

const navItems = [
  { to: "/", label: "Timetable", icon: CalendarDays, end: true },
  { to: "/reports/day-wise", label: "Day-wise Report", icon: ClipboardList },
  { to: "/adjustment", label: "Class Adjustment", icon: UserCheck },
]

/**
 * The shell everyone sees without signing in. It deliberately contains no
 * link to anything that changes data — the only way through to the admin side
 * is the sign-in link.
 */
export function PublicLayout() {
  const { admin } = useAdminAuth()

  return (
    <div className="min-h-svh flex flex-col">
      <header className="border-b bg-background">
        <div className="mx-auto max-w-6xl flex items-center gap-4 px-4 h-14">
          <Link to="/" className="font-semibold shrink-0">
            ScheduleDesk
          </Link>
          <nav className="flex gap-1 text-sm overflow-x-auto">
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
              {admin ? "Admin" : "Staff sign in"}
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">
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
