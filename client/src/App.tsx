import { lazy, Suspense } from "react"
import { Routes, Route } from "react-router-dom"
import { AppLayout } from "@/components/AppLayout"
import { DashboardPage } from "@/pages/DashboardPage"
import { MasterDataPage } from "@/pages/MasterDataPage"
import { TermSetupPage } from "@/pages/TermSetupPage"
import { CurriculumOverviewPage } from "@/pages/CurriculumOverviewPage"
import { CurriculumPage } from "@/pages/CurriculumPage"
import { SectionBuilderPage } from "@/pages/SectionBuilderPage"
import { SectionTimetablePage } from "@/pages/SectionTimetablePage"
import { FacultyTimetablePage } from "@/pages/FacultyTimetablePage"
import { ResetYearPage } from "@/pages/ResetYearPage"
import { PrintAllPage } from "@/pages/PrintAllPage"
import { LoadingState } from "@/components/ui/feedback"

// The import screen pulls in a spreadsheet parser that most sessions never
// touch, so it is loaded on demand rather than shipped in the main bundle.
const ImportPage = lazy(() =>
  import("@/pages/ImportPage").then((m) => ({ default: m.ImportPage }))
)

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
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
        <Route path="faculty" element={<FacultyTimetablePage />} />
        <Route path="faculty/:facultyId" element={<FacultyTimetablePage />} />
        <Route path="print" element={<PrintAllPage />} />
        <Route path="reset" element={<ResetYearPage />} />
      </Route>
    </Routes>
  )
}

export default App
