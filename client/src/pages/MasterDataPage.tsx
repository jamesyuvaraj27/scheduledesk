import * as React from "react"
import { Layers } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CrudSection } from "@/components/CrudSection"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Dialog } from "@/components/ui/dialog"
import { ErrorState, LoadingState } from "@/components/ui/feedback"
import { api } from "@/lib/api"
import { useList, useCreate, useUpdate, useRemove } from "@/hooks/useResource"
import type { Branch, Department, Faculty, Room, Section, Subject } from "@/lib/types"
import { BLOCKS, FLOORS, FLOOR_LABELS, type Block, type Floor } from "@/lib/types"

const TABS = [
  { id: "departments", label: "Departments" },
  { id: "branches", label: "Branches" },
  { id: "sections", label: "Sections" },
  { id: "rooms", label: "Rooms" },
  { id: "subjects", label: "Subjects" },
  { id: "faculty", label: "Faculty" },
] as const

type TabId = (typeof TABS)[number]["id"]

export function MasterDataPage() {
  const [tab, setTab] = React.useState<TabId>("departments")

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Master Data</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Set this up once. Timetables are built on top of it, and it survives an
          academic-year reset.
        </p>
      </div>

      <div className="flex gap-1 border-b overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              "px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors " +
              (tab === t.id
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "departments" && <DepartmentsTab />}
      {tab === "branches" && <BranchesTab />}
      {tab === "sections" && <SectionsTab />}
      {tab === "rooms" && <RoomsTab />}
      {tab === "subjects" && <SubjectsTab />}
      {tab === "faculty" && <FacultyTab />}
    </div>
  )
}

/* ------------------------------ Departments ----------------------------- */

function DepartmentsTab() {
  const list = useList<Department>("/departments", ["departments"])
  const create = useCreate<Department>("/departments", ["departments"])
  const update = useUpdate<Department>("/departments", ["departments"])
  const remove = useRemove("/departments", ["departments"])

  return (
    <CrudSection<Department>
      title="Departments"
      description="The top level of the academic structure, e.g. ASCE, CSE, ECE."
      items={list.data}
      isLoading={list.isLoading}
      error={list.error}
      columns={["Code", "Name", "Branches"]}
      emptyHint="Start here — branches, sections and faculty all hang off a department."
      onDelete={(id) => remove.mutate(id)}
      deleteError={remove.error}
      formTitle={(e) => (e ? "Edit department" : "New department")}
      renderRow={(d) => (
        <>
          <td className="px-3 py-2 font-medium">{d.code}</td>
          <td className="px-3 py-2">{d.name}</td>
          <td className="px-3 py-2 text-muted-foreground">{d._count?.branches ?? 0}</td>
        </>
      )}
      renderForm={(editing, close) => (
        <EntityForm
          fields={[
            { name: "code", label: "Code", placeholder: "ASCE", required: true },
            {
              name: "name",
              label: "Full name",
              placeholder: "Allied Computer Science Engineering",
              required: true,
            },
          ]}
          initial={editing ?? undefined}
          error={editing ? update.error : create.error}
          pending={create.isPending || update.isPending}
          onSubmit={(values) => {
            const body = { code: String(values.code), name: String(values.name) }
            if (editing) {
              update.mutate({ id: editing.id, body }, { onSuccess: close })
            } else {
              create.mutate(body, { onSuccess: close })
            }
          }}
          onCancel={close}
        />
      )}
    />
  )
}

/* --------------------------------- Filters -------------------------------- */

/**
 * One labelled dropdown used for the "show me only this department / branch"
 * filters. Every master-data list is long once a whole college is entered,
 * so each screen narrows by the thing above it in the hierarchy.
 */
function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  allLabel: string
}) {
  return (
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block h-9 rounded-md border bg-background px-2 text-sm min-w-44"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Turn a filter state object into a query string, skipping empty values. */
function qs(params: Record<string, string>): string {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v)
  const str = search.toString()
  return str ? `?${str}` : ""
}

/* -------------------------------- Branches ------------------------------- */

function BranchesTab() {
  const [deptFilter, setDeptFilter] = React.useState("")
  const depts = useList<Department>("/departments", ["departments"])
  const list = useList<Branch>(
    `/branches${qs({ departmentId: deptFilter })}`,
    ["branches", deptFilter]
  )
  const create = useCreate<Branch>("/branches", ["branches"])
  const update = useUpdate<Branch>("/branches", ["branches"])
  const remove = useRemove("/branches", ["branches"])

  const noDepts = !depts.data?.length

  return (
    <CrudSection<Branch>
      title="Branches"
      description="Programmes inside a department — e.g. ASCE contains AIML, CAI, CSM, CSD."
      items={list.data}
      isLoading={list.isLoading}
      error={list.error}
      columns={["Code", "Name", "Department", "Sections"]}
      toolbar={
        <FilterSelect
          label="Department"
          value={deptFilter}
          onChange={setDeptFilter}
          allLabel="All departments"
          options={(depts.data ?? []).map((d) => ({
            value: d.id,
            label: `${d.code} — ${d.name}`,
          }))}
        />
      }
      disabled={noDepts}
      disabledHint="Add a department first."
      onDelete={(id) => remove.mutate(id)}
      deleteError={remove.error}
      formTitle={(e) => (e ? "Edit branch" : "New branch")}
      renderRow={(b) => (
        <>
          <td className="px-3 py-2 font-medium">{b.code}</td>
          <td className="px-3 py-2">{b.name}</td>
          <td className="px-3 py-2 text-muted-foreground">{b.department?.code}</td>
          <td className="px-3 py-2 text-muted-foreground">{b._count?.sections ?? 0}</td>
        </>
      )}
      renderForm={(editing, close) => (
        <EntityForm
          fields={[
            {
              name: "departmentId",
              label: "Department",
              type: "select",
              required: true,
              options: (depts.data ?? []).map((d) => ({
                value: d.id,
                label: `${d.code} — ${d.name}`,
              })),
            },
            { name: "code", label: "Code", placeholder: "AIML", required: true },
            {
              name: "name",
              label: "Full name",
              placeholder: "Artificial Intelligence & Machine Learning",
              required: true,
            },
          ]}
          initial={editing ?? undefined}
          error={editing ? update.error : create.error}
          pending={create.isPending || update.isPending}
          onSubmit={(values) => {
            const body = {
              departmentId: String(values.departmentId),
              code: String(values.code),
              name: String(values.name),
            }
            if (editing) update.mutate({ id: editing.id, body }, { onSuccess: close })
            else create.mutate(body, { onSuccess: close })
          }}
          onCancel={close}
        />
      )}
    />
  )
}

/* -------------------------------- Sections ------------------------------- */

function SectionsTab() {
  const [deptFilter, setDeptFilter] = React.useState("")
  const [branchFilter, setBranchFilter] = React.useState("")
  const depts = useList<Department>("/departments", ["departments"])
  const branches = useList<Branch>("/branches", ["branches"])
  const rooms = useList<Room>("/rooms", ["rooms"])
  const list = useList<Section>(
    `/sections${qs({ departmentId: deptFilter, branchId: branchFilter })}`,
    ["sections", deptFilter, branchFilter]
  )

  // Branch options follow the chosen department, and a branch picked under a
  // department that's since been switched away is cleared rather than left
  // silently filtering everything out.
  const branchOptions = (branches.data ?? []).filter(
    (b) => !deptFilter || b.departmentId === deptFilter
  )
  React.useEffect(() => {
    if (branchFilter && !branchOptions.some((b) => b.id === branchFilter)) {
      setBranchFilter("")
    }
  }, [branchFilter, branchOptions])
  const create = useCreate<Section>("/sections", ["sections"])
  const update = useUpdate<Section>("/sections", ["sections"])
  const remove = useRemove("/sections", ["sections"])

  const classrooms = (rooms.data ?? []).filter((r) => r.type === "CLASSROOM")

  return (
    <CrudSection<Section>
      title="Sections"
      description="A branch with no divisions still gets one section — just name it after the branch."
      items={list.data}
      isLoading={list.isLoading}
      error={list.error}
      columns={["Section", "Year", "Branch", "Home room"]}
      toolbar={
        <>
          <FilterSelect
            label="Department"
            value={deptFilter}
            onChange={setDeptFilter}
            allLabel="All departments"
            options={(depts.data ?? []).map((d) => ({
              value: d.id,
              label: `${d.code} — ${d.name}`,
            }))}
          />
          <FilterSelect
            label="Branch"
            value={branchFilter}
            onChange={setBranchFilter}
            allLabel="All branches"
            options={branchOptions.map((b) => ({
              value: b.id,
              label: `${b.department?.code} / ${b.code}`,
            }))}
          />
        </>
      }
      disabled={!branches.data?.length}
      disabledHint="Add a branch first."
      onDelete={(id) => remove.mutate(id)}
      deleteError={remove.error}
      formTitle={(e) => (e ? "Edit section" : "New section")}
      renderRow={(s) => (
        <>
          <td className="px-3 py-2 font-medium">
            {s.branch?.code}-{s.name}
          </td>
          <td className="px-3 py-2">Year {s.year}</td>
          <td className="px-3 py-2 text-muted-foreground">
            {s.branch?.department?.code} / {s.branch?.code}
          </td>
          <td className="px-3 py-2 text-muted-foreground">
            {s.homeRoom?.name ?? <span className="italic">not set</span>}
          </td>
        </>
      )}
      renderForm={(editing, close) => (
        <EntityForm
          fields={[
            {
              name: "branchId",
              label: "Branch",
              type: "select",
              required: true,
              options: (branches.data ?? []).map((b) => ({
                value: b.id,
                label: `${b.department?.code} / ${b.code}`,
              })),
            },
            {
              name: "year",
              label: "Year",
              type: "select",
              required: true,
              options: [1, 2, 3, 4].map((y) => ({ value: String(y), label: `Year ${y}` })),
            },
            { name: "name", label: "Section name", placeholder: "A", required: true },
            {
              name: "homeRoomId",
              label: "Home classroom",
              type: "select",
              options: [
                { value: "", label: "— none —" },
                ...classrooms.map((r) => ({ value: r.id, label: r.name })),
              ],
              hint: "Theory, library, seminar and counseling all happen here. Only labs move rooms.",
            },
          ]}
          initial={editing ?? undefined}
          error={editing ? update.error : create.error}
          pending={create.isPending || update.isPending}
          onSubmit={(values) => {
            const body = {
              branchId: String(values.branchId),
              year: Number(values.year),
              name: String(values.name),
              homeRoomId: values.homeRoomId ? String(values.homeRoomId) : null,
            }
            if (editing) update.mutate({ id: editing.id, body }, { onSuccess: close })
            else create.mutate(body, { onSuccess: close })
          }}
          onCancel={close}
        />
      )}
    />
  )
}

/* --------------------------------- Rooms --------------------------------- */

const ROOM_TYPES = [
  { value: "CLASSROOM", label: "Classroom" },
  { value: "LAB", label: "Laboratory" },
  { value: "LIBRARY", label: "Library" },
  { value: "SEMINAR_HALL", label: "Seminar hall" },
]

const YEAR_OPTIONS = [1, 2, 3, 4].map((y) => ({
  value: String(y),
  label: `Year ${y}`,
}))

const BLOCK_OPTIONS = BLOCKS.map((b) => ({ value: b, label: `Block ${b}` }))
const FLOOR_OPTIONS = FLOORS.map((f) => ({
  value: f,
  label: `${f} — ${FLOOR_LABELS[f]}`,
}))

/**
 * Bulk room creation.
 *
 * Rooms are named by position — block A, first floor, room 3 is "AFF-3" — and
 * a single floor can hold a dozen of them, so entering a whole building one
 * room at a time is a chore. Existing names are skipped server-side, so this
 * is safe to re-run after adding a few rooms by hand.
 */
function BulkRoomDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [block, setBlock] = React.useState<Block>("A")
  const [floor, setFloor] = React.useState<Floor>("GF")
  const [type, setType] = React.useState("CLASSROOM")
  const [count, setCount] = React.useState(6)
  const [startNumber, setStartNumber] = React.useState(1)
  const [year, setYear] = React.useState("")

  const create = useMutation({
    mutationFn: () =>
      api.post<{ created: number; skipped: string[] }>("/rooms/bulk", {
        block,
        floor,
        type,
        count,
        startNumber,
        year: year ? Number(year) : null,
      }),
    onSuccess: (r) => {
      setResult(r)
      onDone()
    },
  })
  const [result, setResult] = React.useState<{
    created: number
    skipped: string[]
  } | null>(null)

  const preview = Array.from(
    { length: Math.min(count, 3) },
    (_, i) => `${block}${floor}-${startNumber + i}`
  ).join(", ")

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setResult(null)
          setOpen(true)
        }}
      >
        <Layers /> Bulk add
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add a floor of rooms"
        description="Creates numbered rooms for one block and floor at a time."
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Block</Label>
              <select
                value={block}
                onChange={(e) => setBlock(e.target.value as Block)}
                className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {BLOCK_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Floor</Label>
              <select
                value={floor}
                onChange={(e) => setFloor(e.target.value as Floor)}
                className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {FLOOR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Room type</Label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {ROOM_TYPES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="bulk-count">How many</Label>
              <Input
                id="bulk-count"
                type="number"
                min={1}
                max={60}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="bulk-start">Numbering starts at</Label>
              <Input
                id="bulk-start"
                type="number"
                min={1}
                value={startNumber}
                onChange={(e) => setStartNumber(Number(e.target.value))}
              />
            </div>
            <div>
              <Label>Reserved for year</Label>
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="">Any year</option>
                {YEAR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Will create <span className="font-medium text-foreground">{preview}</span>
            {count > 3 ? ` … (${count} rooms)` : ""}
          </p>

          {create.error ? <ErrorState error={create.error} /> : null}
          {result ? (
            <p className="text-sm">
              Created <span className="font-medium">{result.created}</span> room
              {result.created === 1 ? "" : "s"}
              {result.skipped.length
                ? `, skipped ${result.skipped.length} that already existed.`
                : "."}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              size="sm"
              disabled={create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Creating…" : "Create rooms"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}

function RoomsTab() {
  const qc = useQueryClient()
  const [typeFilter, setTypeFilter] = React.useState("")
  const [blockFilter, setBlockFilter] = React.useState("")
  const [floorFilter, setFloorFilter] = React.useState("")
  const [yearFilter, setYearFilter] = React.useState("")

  const listPath = `/rooms${qs({
    type: typeFilter,
    block: blockFilter,
    floor: floorFilter,
    year: yearFilter,
  })}`
  const list = useList<Room>(listPath, [
    "rooms",
    typeFilter,
    blockFilter,
    floorFilter,
    yearFilter,
  ])
  const create = useCreate<Room>("/rooms", ["rooms"])
  const update = useUpdate<Room>("/rooms", ["rooms"])
  const remove = useRemove("/rooms", ["rooms"])

  return (
    <CrudSection<Room>
      title="Rooms"
      description="Classrooms, labs, the library and seminar halls, organised by block and floor. Room clashes are checked against these."
      items={list.data}
      isLoading={list.isLoading}
      error={list.error}
      columns={["Name", "Type", "Block", "Floor", "Year", "Capacity"]}
      onDelete={(id) => remove.mutate(id)}
      deleteError={remove.error}
      headerAction={
        <BulkRoomDialog
          onDone={() => qc.invalidateQueries({ queryKey: ["rooms"] })}
        />
      }
      toolbar={
        <>
          <FilterSelect
            label="Type"
            value={typeFilter}
            onChange={setTypeFilter}
            allLabel="All types"
            options={ROOM_TYPES}
          />
          <FilterSelect
            label="Block"
            value={blockFilter}
            onChange={setBlockFilter}
            allLabel="All blocks"
            options={BLOCK_OPTIONS}
          />
          <FilterSelect
            label="Floor"
            value={floorFilter}
            onChange={setFloorFilter}
            allLabel="All floors"
            options={FLOOR_OPTIONS}
          />
          <FilterSelect
            label="Year"
            value={yearFilter}
            onChange={setYearFilter}
            allLabel="All years"
            options={YEAR_OPTIONS}
          />
        </>
      }
      formTitle={(e) => (e ? "Edit room" : "New room")}
      renderRow={(r) => (
        <>
          <td className="px-3 py-2 font-medium">{r.name}</td>
          <td className="px-3 py-2">
            <Badge variant={r.type === "LAB" ? "warning" : "secondary"}>
              {ROOM_TYPES.find((t) => t.value === r.type)?.label ?? r.type}
            </Badge>
          </td>
          <td className="px-3 py-2 text-muted-foreground">
            {r.block ? `Block ${r.block}` : "—"}
          </td>
          <td className="px-3 py-2 text-muted-foreground">
            {r.floor ? FLOOR_LABELS[r.floor] : "—"}
          </td>
          <td className="px-3 py-2 text-muted-foreground">
            {r.year ? `Year ${r.year}` : "Any"}
          </td>
          <td className="px-3 py-2 text-muted-foreground">{r.capacity ?? "—"}</td>
        </>
      )}
      renderForm={(editing, close) => (
        <EntityForm
          fields={[
            { name: "name", label: "Name", placeholder: "AFF-3", required: true },
            { name: "type", label: "Type", type: "select", required: true, options: ROOM_TYPES },
            {
              name: "block",
              label: "Block",
              type: "select",
              options: [{ value: "", label: "— none —" }, ...BLOCK_OPTIONS],
            },
            {
              name: "floor",
              label: "Floor",
              type: "select",
              options: [{ value: "", label: "— none —" }, ...FLOOR_OPTIONS],
            },
            {
              name: "year",
              label: "Reserved for year",
              type: "select",
              options: [{ value: "", label: "Any year" }, ...YEAR_OPTIONS],
              hint: "Leave as 'Any year' unless this room belongs to one year group.",
            },
            { name: "capacity", label: "Capacity", type: "number", placeholder: "70" },
          ]}
          initial={editing ?? undefined}
          error={editing ? update.error : create.error}
          pending={create.isPending || update.isPending}
          onSubmit={(values) => {
            const body = {
              name: String(values.name),
              type: String(values.type),
              capacity: values.capacity ? Number(values.capacity) : null,
              block: values.block ? String(values.block) : null,
              floor: values.floor ? String(values.floor) : null,
              year: values.year ? Number(values.year) : null,
            }
            if (editing) update.mutate({ id: editing.id, body }, { onSuccess: close })
            else create.mutate(body, { onSuccess: close })
          }}
          onCancel={close}
        />
      )}
    />
  )
}

/* -------------------------------- Subjects ------------------------------- */

interface SubjectDeleteImpact {
  subject: { id: string; code: string; name: string }
  eligibleFaculty: number
  curriculumRows: number
  assignments: number
  placedClasses: number
  sections: { id: string; label: string }[]
}

/**
 * Deleting a subject takes its faculty eligibility, every section's curriculum
 * row, the locked-in assignments and any classes already on a timetable with
 * it. That's too much to lose on a stray click, so the counts are fetched and
 * shown before the delete is allowed through.
 */
function DeleteSubjectDialog({
  subject,
  onClose,
  onDeleted,
}: {
  subject: Subject | null
  onClose: () => void
  onDeleted: () => void
}) {
  const impact = useQuery({
    queryKey: ["subject-delete-impact", subject?.id],
    enabled: Boolean(subject),
    queryFn: () =>
      api.get<SubjectDeleteImpact>(`/subjects/${subject!.id}/delete-impact`),
  })

  const del = useMutation({
    mutationFn: () => api.del(`/subjects/${subject!.id}`),
    onSuccess: () => {
      onDeleted()
      onClose()
    },
  })

  const d = impact.data
  const nothingToLose =
    d &&
    d.eligibleFaculty === 0 &&
    d.curriculumRows === 0 &&
    d.placedClasses === 0

  return (
    <Dialog
      open={Boolean(subject)}
      onClose={onClose}
      title={subject ? `Delete ${subject.code}?` : "Delete subject"}
      description={subject?.name}
    >
      <div className="space-y-3">
        {impact.isLoading ? (
          <LoadingState label="Checking what this would remove…" />
        ) : impact.error ? (
          <ErrorState error={impact.error} />
        ) : d ? (
          nothingToLose ? (
            <p className="text-sm text-muted-foreground">
              This subject isn't used anywhere yet — deleting it is safe.
            </p>
          ) : (
            <>
              <p className="text-sm">This will also permanently remove:</p>
              <ul className="text-sm space-y-1 list-disc pl-5">
                {d.placedClasses > 0 && (
                  <li>
                    <span className="font-medium text-destructive">
                      {d.placedClasses}
                    </span>{" "}
                    class{d.placedClasses === 1 ? "" : "es"} already placed on
                    timetables
                  </li>
                )}
                {d.curriculumRows > 0 && (
                  <li>
                    <span className="font-medium">{d.curriculumRows}</span>{" "}
                    curriculum row{d.curriculumRows === 1 ? "" : "s"}
                  </li>
                )}
                {d.assignments > 0 && (
                  <li>
                    <span className="font-medium">{d.assignments}</span> faculty
                    assignment{d.assignments === 1 ? "" : "s"}
                  </li>
                )}
                {d.eligibleFaculty > 0 && (
                  <li>
                    <span className="font-medium">{d.eligibleFaculty}</span>{" "}
                    faculty eligibility record
                    {d.eligibleFaculty === 1 ? "" : "s"}
                  </li>
                )}
              </ul>
              {d.sections.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Affects: {d.sections.map((x) => x.label).join(", ")}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                This can't be undone.
              </p>
            </>
          )
        ) : null}

        {del.error ? <ErrorState error={del.error} /> : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={del.isPending || impact.isLoading}
            onClick={() => del.mutate()}
          >
            {del.isPending ? "Deleting…" : "Delete everywhere"}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function SubjectsTab() {
  const qc = useQueryClient()
  const [deptFilter, setDeptFilter] = React.useState("")
  const [branchFilter, setBranchFilter] = React.useState("")
  const [deleting, setDeleting] = React.useState<Subject | null>(null)

  const depts = useList<Department>("/departments", ["departments"])
  const branches = useList<Branch>("/branches", ["branches"])
  const list = useList<Subject>(
    `/subjects${qs({ branchId: branchFilter })}`,
    ["subjects", branchFilter]
  )
  const create = useCreate<Subject>("/subjects", ["subjects"])
  const update = useUpdate<Subject>("/subjects", ["subjects"])

  const branchOptions = (branches.data ?? []).filter(
    (b) => !deptFilter || b.departmentId === deptFilter
  )
  React.useEffect(() => {
    if (branchFilter && !branchOptions.some((b) => b.id === branchFilter)) {
      setBranchFilter("")
    }
  }, [branchFilter, branchOptions])

  return (
    <>
    <DeleteSubjectDialog
      subject={deleting}
      onClose={() => setDeleting(null)}
      onDeleted={() => {
        qc.invalidateQueries({ queryKey: ["subjects"] })
        qc.invalidateQueries({ queryKey: ["summary"] })
        qc.invalidateQueries({ queryKey: ["curriculum-status"] })
        qc.invalidateQueries({ queryKey: ["build-status"] })
      }}
    />
    <CrudSection<Subject>
      title="Subjects"
      description="The short code is what appears in timetable cells — keep it brief, like BDA or ESIA."
      items={list.data}
      isLoading={list.isLoading}
      error={list.error}
      columns={["Code", "Name", "Branch", "Type"]}
      disabled={!branches.data?.length}
      disabledHint="Add a branch first."
      toolbar={
        <>
          <FilterSelect
            label="Department"
            value={deptFilter}
            onChange={setDeptFilter}
            allLabel="All departments"
            options={(depts.data ?? []).map((d) => ({
              value: d.id,
              label: `${d.code} — ${d.name}`,
            }))}
          />
          <FilterSelect
            label="Branch"
            value={branchFilter}
            onChange={setBranchFilter}
            allLabel="All branches"
            options={branchOptions.map((b) => ({
              value: b.id,
              label: `${b.department?.code} / ${b.code}`,
            }))}
          />
        </>
      }
      onDelete={(id) => {
        const subject = list.data?.find((x: Subject) => x.id === id) ?? null
        setDeleting(subject)
      }}
      formTitle={(e) => (e ? "Edit subject" : "New subject")}
      renderRow={(s) => (
        <>
          <td className="px-3 py-2 font-medium">{s.code}</td>
          <td className="px-3 py-2">{s.name}</td>
          <td className="px-3 py-2 text-muted-foreground">{s.branch?.code}</td>
          <td className="px-3 py-2">
            <Badge variant={s.type === "LAB" ? "warning" : "secondary"}>
              {s.type === "LAB" ? "Lab" : "Theory"}
            </Badge>
          </td>
        </>
      )}
      renderForm={(editing, close) => (
        <EntityForm
          fields={[
            {
              name: "branchId",
              label: "Branch",
              type: "select",
              required: true,
              options: (branches.data ?? []).map((b) => ({
                value: b.id,
                label: `${b.department?.code} / ${b.code}`,
              })),
            },
            { name: "code", label: "Code", placeholder: "BDA", required: true },
            { name: "name", label: "Full name", placeholder: "Big Data Analytics", required: true },
            {
              name: "type",
              label: "Type",
              type: "select",
              required: true,
              options: [
                { value: "THEORY", label: "Theory" },
                { value: "LAB", label: "Lab (any number of periods)" },
              ],
            },
          ]}
          initial={editing ?? undefined}
          error={editing ? update.error : create.error}
          pending={create.isPending || update.isPending}
          onSubmit={(values) => {
            const body = {
              branchId: String(values.branchId),
              code: String(values.code),
              name: String(values.name),
              type: String(values.type),
            }
            if (editing) update.mutate({ id: editing.id, body }, { onSuccess: close })
            else create.mutate(body, { onSuccess: close })
          }}
          onCancel={close}
        />
      )}
    />
    </>
  )
}

/* --------------------------------- Faculty -------------------------------- */

function FacultyTab() {
  const [deptFilter, setDeptFilter] = React.useState("")
  const depts = useList<Department>("/departments", ["departments"])
  const subjects = useList<Subject>("/subjects", ["subjects"])
  const list = useList<Faculty>(
    `/faculty${qs({ departmentId: deptFilter })}`,
    ["faculty", deptFilter]
  )
  const create = useCreate<Faculty>("/faculty", ["faculty"])
  const update = useUpdate<Faculty>("/faculty", ["faculty"])
  const remove = useRemove("/faculty", ["faculty"])
  const [eligibilityFor, setEligibilityFor] = React.useState<Faculty | null>(null)

  return (
    <>
      <CrudSection<Faculty>
        title="Faculty"
        description="Who can teach what. A subject can have several eligible faculty — you pick the actual one per section during term setup."
        items={list.data}
        isLoading={list.isLoading}
        error={list.error}
        columns={["Name", "Department", "Can teach"]}
        toolbar={
          <FilterSelect
            label="Department"
            value={deptFilter}
            onChange={setDeptFilter}
            allLabel="All departments"
            options={(depts.data ?? []).map((d) => ({
              value: d.id,
              label: `${d.code} — ${d.name}`,
            }))}
          />
        }
        disabled={!depts.data?.length}
        disabledHint="Add a department first."
        onDelete={(id) => remove.mutate(id)}
        deleteError={remove.error}
        formTitle={(e) => (e ? "Edit faculty" : "New faculty")}
        renderRow={(f) => (
          <>
            <td className="px-3 py-2 font-medium">{f.name}</td>
            <td className="px-3 py-2 text-muted-foreground">{f.department?.code}</td>
            <td className="px-3 py-2">
              <div className="flex flex-wrap items-center gap-1">
                {f.eligibleSubjects?.length ? (
                  f.eligibleSubjects.map((e) => (
                    <Badge key={e.subject.id} variant="outline">
                      {e.subject.code}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground italic text-xs">none set</span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() => setEligibilityFor(f)}
                >
                  Edit
                </Button>
              </div>
            </td>
          </>
        )}
        renderForm={(editing, close) => (
          <EntityForm
            fields={[
              { name: "name", label: "Name", placeholder: "Dr. R Arichandran", required: true },
              {
                name: "departmentId",
                label: "Department",
                type: "select",
                required: true,
                options: (depts.data ?? []).map((d) => ({
                  value: d.id,
                  label: `${d.code} — ${d.name}`,
                })),
              },
            ]}
            initial={editing ?? undefined}
            error={editing ? update.error : create.error}
            pending={create.isPending || update.isPending}
            onSubmit={(values) => {
              const body = {
                name: String(values.name),
                departmentId: String(values.departmentId),
              }
              if (editing) update.mutate({ id: editing.id, body }, { onSuccess: close })
              else create.mutate(body, { onSuccess: close })
            }}
            onCancel={close}
          />
        )}
      />

      {eligibilityFor && (
        <EligibilityDialog
          faculty={eligibilityFor}
          subjects={subjects.data ?? []}
          onClose={() => setEligibilityFor(null)}
        />
      )}
    </>
  )
}

function EligibilityDialog({
  faculty,
  subjects,
  onClose,
}: {
  faculty: Faculty
  subjects: Subject[]
  onClose: () => void
}) {
  const [selected, setSelected] = React.useState<string[]>(
    faculty.eligibleSubjects?.map((e) => e.subject.id) ?? []
  )
  // A whole college's subject list is long, so narrow it by branch. Anything
  // already ticked stays visible regardless of the filter, otherwise
  // switching branches would look like the selection had been lost.
  const [branchFilter, setBranchFilter] = React.useState("")
  const qc = useQueryClient()

  const branchesInList = React.useMemo(() => {
    const seen = new Map<string, string>()
    for (const s of subjects) {
      if (s.branch) seen.set(s.branch.id, s.branch.code)
    }
    return [...seen].map(([id, code]) => ({ value: id, label: code }))
  }, [subjects])

  const visible = subjects.filter(
    (s) => !branchFilter || s.branchId === branchFilter || selected.includes(s.id)
  )

  const save = useMutation({
    mutationFn: (subjectIds: string[]) =>
      api.put(`/faculty/${faculty.id}/subjects`, { subjectIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["faculty"] })
      qc.invalidateQueries({ queryKey: ["subjects"] })
      onClose()
    },
  })

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    )

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Subjects ${faculty.name} can teach`}
      description="Eligibility only — the actual per-section assignment happens in Term Setup."
    >
      <div className="space-y-3">
        {save.error ? <ErrorState error={save.error} /> : null}

        {subjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add some subjects first.</p>
        ) : (
          <>
          {branchesInList.length > 1 && (
            <FilterSelect
              label="Branch"
              value={branchFilter}
              onChange={setBranchFilter}
              allLabel="All branches"
              options={branchesInList}
            />
          )}
          <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
            {visible.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-2 text-sm rounded-md px-2 py-1.5 hover:bg-muted cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(s.id)}
                  onChange={() => toggle(s.id)}
                  className="size-4"
                />
                <span className="font-medium">{s.code}</span>
                <span className="text-muted-foreground">{s.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {s.branch?.code}
                </span>
              </label>
            ))}
          </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate(selected)}
            disabled={save.isPending}
            type="button"
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/* ------------------------------ Shared form ------------------------------ */

interface Field {
  name: string
  label: string
  type?: "text" | "number" | "select"
  placeholder?: string
  required?: boolean
  options?: { value: string; label: string }[]
  hint?: string
}

function EntityForm({
  fields,
  initial,
  onSubmit,
  onCancel,
  error,
  pending,
}: {
  fields: Field[]
  initial?: object
  onSubmit: (values: Record<string, string>) => void
  onCancel: () => void
  error?: unknown
  pending?: boolean
}) {
  const [values, setValues] = React.useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    const source = (initial ?? {}) as Record<string, unknown>
    for (const f of fields) {
      const v = source[f.name]
      init[f.name] = v === null || v === undefined ? "" : String(v)
    }
    return init
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(values)
      }}
      className="space-y-3"
    >
      {error ? <ErrorState error={error} /> : null}

      {fields.map((f) => (
        <div key={f.name}>
          <Label htmlFor={f.name}>
            {f.label}
            {f.required && <span className="text-destructive"> *</span>}
          </Label>
          {f.type === "select" ? (
            <Select
              id={f.name}
              value={values[f.name]}
              required={f.required}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            >
              <option value="">— select —</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              id={f.name}
              type={f.type ?? "text"}
              value={values[f.name]}
              placeholder={f.placeholder}
              required={f.required}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            />
          )}
          {f.hint && <p className="text-xs text-muted-foreground mt-1">{f.hint}</p>}
        </div>
      ))}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  )
}
