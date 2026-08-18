import { NavLink, Outlet } from "react-router-dom"
import { cn } from "@/lib/utils"

const navItems = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/master-data", label: "Master Data" },
  { to: "/term-setup", label: "Term Setup" },
  { to: "/curriculum", label: "Curriculum" },
  { to: "/faculty", label: "Faculty" },
  { to: "/rooms", label: "Rooms" },
  { to: "/print", label: "Print" },
  { to: "/reset", label: "Reset Year" },
]

export function AppLayout() {
  return (
    <div className="min-h-svh flex flex-col">
      <header className="border-b">
        <div className="mx-auto max-w-6xl flex items-center gap-6 px-4 h-14">
          <span className="font-semibold">ScheduleDesk</span>
          <nav className="flex gap-4 text-sm">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "text-muted-foreground hover:text-foreground transition-colors",
                    isActive && "text-foreground font-medium"
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
