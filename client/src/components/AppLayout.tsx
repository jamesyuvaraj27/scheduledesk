import * as React from "react"
import { NavLink, Outlet, Link, useNavigate, useLocation } from "react-router-dom"
import { LogOut, Radio, CopyPlus, Eye, Menu, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAdminAuth } from "@/context/AdminAuth"
import { useTimetableVersion } from "@/context/TimetableVersion"

const navItems = [
  { to: "/admin", label: "Dashboard", end: true },
  { to: "/admin/master-data", label: "Master Data" },
  { to: "/admin/term-setup", label: "Term Setup" },
  { to: "/admin/curriculum", label: "Curriculum" },
  { to: "/admin/faculty", label: "Faculty" },
  { to: "/admin/rooms", label: "Rooms" },
  { to: "/admin/merge", label: "Merge Classes" },
  { to: "/admin/working-timetable", label: "Working Timetable" },
  { to: "/admin/print", label: "Print" },
  { to: "/admin/reset", label: "Reset Year" },
]

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap",
    isActive && "text-foreground font-medium"
  )

export function AppLayout() {
  const { logout } = useAdminAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = React.useState(false)

  // Nine links don't fit a phone. They used to sit in a horizontally
  // scrolling strip, which hid most of them behind a gesture nobody knows is
  // there; below `lg` they now collapse into a proper menu.
  React.useEffect(() => setMenuOpen(false), [location.pathname])

  return (
    <div className="min-h-svh flex flex-col">
      <header className="border-b print:hidden">
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

          <span className="font-semibold shrink-0">ScheduleDesk</span>

          <nav className="hidden lg:flex gap-4 text-sm">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3 shrink-0">
            <Link
              to="/"
              className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              title="What students and faculty see"
            >
              <Eye className="size-3.5" /> Public view
            </Link>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await logout()
                navigate("/")
              }}
            >
              <LogOut />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>

        {menuOpen && (
          <nav className="lg:hidden border-t bg-background">
            <div className="mx-auto max-w-6xl px-4 py-2 grid gap-0.5 text-sm">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "rounded-md px-2 py-2 hover:bg-muted/60 transition-colors",
                      isActive ? "bg-muted font-medium" : "text-muted-foreground"
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              <Link
                to="/"
                className="rounded-md px-2 py-2 text-muted-foreground hover:bg-muted/60 flex items-center gap-1.5 sm:hidden"
              >
                <Eye className="size-3.5" /> Public view
              </Link>
            </div>
          </nav>
        )}
      </header>

      <VersionBanner />

      {/* `min-w-0` stops a wide grid inside from stretching the flex column
          and giving the whole page a horizontal scrollbar — the grid has its
          own scroll container. */}
      <main className="flex-1 mx-auto w-full min-w-0 max-w-6xl px-3 sm:px-4 py-5 sm:py-6">
        <Outlet />
      </main>
    </div>
  )
}

/**
 * Which timetable is being edited, said out loud on every admin page.
 *
 * The server is what actually prevents live edits while a working copy
 * exists; this is so nobody is ever surprised by that.
 */
function VersionBanner() {
  const { state, editing } = useTimetableVersion()
  if (!state) return null

  const onWorking = editing === "WORKING" && state.working

  return (
    <div
      className={cn(
        "border-b text-sm print:hidden",
        onWorking ? "bg-warning/10 border-warning/30" : "bg-success/10 border-success/30"
      )}
    >
      <div className="mx-auto max-w-6xl px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {onWorking ? (
          <>
            <CopyPlus className="size-4 text-warning shrink-0" />
            <span className="font-medium">Editing the working copy</span>
            <Badge variant="warning">Not visible to students</Badge>
            <span className="text-muted-foreground">
              The live timetable is locked and unchanged.
            </span>
            <Link
              to="/admin/working-timetable"
              className="ml-auto underline underline-offset-2 whitespace-nowrap"
            >
              Publish or discard
            </Link>
          </>
        ) : (
          <>
            <Radio className="size-4 text-success shrink-0" />
            <span className="font-medium">Editing the live timetable</span>
            <span className="text-muted-foreground">
              Changes are visible to students and faculty immediately.
            </span>
            <Link
              to="/admin/working-timetable"
              className="ml-auto underline underline-offset-2 whitespace-nowrap"
            >
              Prepare next week instead
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
