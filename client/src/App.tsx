import { lazy, Suspense } from "react"
import { Routes, Route, Navigate, useLocation } from "react-router-dom"
import { AppLayout } from "@/components/AppLayout"
import { PublicLayout } from "@/components/PublicLayout"
import { AdminAuthProvider, useAdminAuth } from "@/context/AdminAuth"
import { TimetableVersionProvider } from "@/context/TimetableVersion"
import { StudentTimetablePage } from "@/pages/StudentTimetablePage"
import { ClassAdjustmentPage } from "@/pages/ClassAdjustmentPage"
import { LoginPage } from "@/pages/LoginPage"
import { DashboardPage } from "@/pages/DashboardPage"
import { MasterDataPage } from "@/pages/MasterDataPage"
import { TermSetupPage } from "@/pages/TermSetupPage"
import { CurriculumOverviewPage } from "@/pages/CurriculumOverviewPage"
import { CurriculumPage } from "@/pages/CurriculumPage"
import { SectionBuilderPage } from "@/pages/SectionBuilderPage"
import { SectionTimetablePage } from "@/pages/SectionTimetablePage"
import { FacultyTimetablePage } from "@/pages/FacultyTimetablePage"
import { RoomTimetablePage } from "@/pages/RoomTimetablePage"
import { ResetYearPage } from "@/pages/ResetYearPage"
import { WorkingTimetablePage } from "@/pages/WorkingTimetablePage"
import { PrintAllPage } from "@/pages/PrintAllPage"
import { DayWiseSectionReportPage } from "@/pages/DayWiseSectionReportPage"
import { LoadingState } from "@/components/ui/feedback"

// The import screen pulls in a spreadsheet parser that most sessions never
// touch, so it is loaded on demand rather than shipped in the main bundle.
const ImportPage = lazy(() =>
  import("@/pages/ImportPage").then((m) => ({ default: m.ImportPage }))
)

/**
 * Keeps signed-out visitors out of the admin shell.
 *
 * This is a convenience, not the security boundary — every admin API is gated
 * on the server, so a visitor who edits their way past this sees pages that
 * can't load anything and can't save anything.
 */
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { admin, loading } = useAdminAuth()
  const location = useLocation()

  if (loading) return <LoadingState label="Checking your session…" />
  if (!admin) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <TimetableVersionProvider>{children}</TimetableVersionProvider>
}

function App() {
  return (
    <AdminAuthProvider>
      <Routes>
        {/* ---------------- Public: no login, read-only ---------------- */}
        <Route element={<PublicLayout />}>
          <Route index element={<StudentTimetablePage />} />
          <Route path="adjustment" element={<ClassAdjustmentPage />} />
        </Route>
        <Route path="login" element={<LoginPage />} />

        {/* ---------------- Admin: everything that changes data -------- */}
        <Route
          path="admin"
          element={
            <RequireAdmin>
              <AppLayout />
            </RequireAdmin>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="master-data" element={<MasterDataPage />} />
          <Route path="term-setup" element={<TermSetupPage />} />
          <Route path="curriculum" element={<CurriculumOverviewPage />} />
          <Route path="curriculum/:sectionId" element={<CurriculumPage />} />
          <Route path="sections/:sectionId/builder" element={<SectionBuilderPage />} />
          <Route path="sections/:sectionId/timetable" element={<SectionTimetablePage />} />
          <Route
            path="sections/:sectionId/import"
            element={
              <Suspense fallback={<LoadingState label="Loading the importer…" />}>
                <ImportPage />
              </Suspense>
            }
          />
          <Route path="rooms" element={<RoomTimetablePage />} />
          <Route path="rooms/:roomId/timetable" element={<RoomTimetablePage />} />
          <Route path="faculty" element={<FacultyTimetablePage />} />
          <Route path="faculty/:facultyId" element={<FacultyTimetablePage />} />
          <Route path="working-timetable" element={<WorkingTimetablePage />} />
          <Route path="print" element={<PrintAllPage />} />
          <Route path="reports/day-wise" element={<DayWiseSectionReportPage />} />
          <Route path="reset" element={<ResetYearPage />} />
        </Route>

        {/* Old bookmarks pointed at the pre-split URLs. */}
        <Route path="master-data" element={<Navigate to="/admin/master-data" replace />} />
        <Route path="term-setup" element={<Navigate to="/admin/term-setup" replace />} />
        <Route path="curriculum/*" element={<Navigate to="/admin/curriculum" replace />} />
        <Route path="rooms/*" element={<Navigate to="/admin/rooms" replace />} />
        <Route path="faculty/*" element={<Navigate to="/admin/faculty" replace />} />
        <Route path="print" element={<Navigate to="/admin/print" replace />} />
        <Route path="reports/*" element={<Navigate to="/admin/reports/day-wise" replace />} />
        <Route path="reset" element={<Navigate to="/admin/reset" replace />} />
        <Route path="sections/*" element={<Navigate to="/admin" replace />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AdminAuthProvider>
  )
}

export default App
