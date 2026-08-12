import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CrudSection } from "@/components/CrudSection"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Dialog } from "@/components/ui/dialog"
import { ErrorState } from "@/components/ui/feedback"
import { api } from "@/lib/api"
import { useList, useCreate, useUpdate, useRemove } from "@/hooks/useResource"
import type { Branch, Department, Faculty, Room, Section, Subject } from "@/lib/types"

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

/* -------------------------------- Branches ------------------------------- */

function BranchesTab() {
  const depts = useList<Department>("/departments", ["departments"])
  const list = useList<Branch>("/branches", ["branches"])
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
  const branches = useList<Branch>("/branches", ["branches"])
  const rooms = useList<Room>("/rooms", ["rooms"])
  const list = useList<Section>("/sections", ["sections"])
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

function RoomsTab() {
  const list = useList<Room>("/rooms", ["rooms"])
  const create = useCreate<Room>("/rooms", ["rooms"])
  const update = useUpdate<Room>("/rooms", ["rooms"])
  const remove = useRemove("/rooms", ["rooms"])

  return (
    <CrudSection<Room>
      title="Rooms"
      description="Classrooms, labs, the library and seminar halls. Room clashes are checked against these."
      items={list.data}
      isLoading={list.isLoading}
      error={list.error}
      columns={["Name", "Type", "Capacity"]}
      onDelete={(id) => remove.mutate(id)}
      deleteError={remove.error}
      formTitle={(e) => (e ? "Edit room" : "New room")}
      renderRow={(r) => (
        <>
          <td className="px-3 py-2 font-medium">{r.name}</td>
          <td className="px-3 py-2">
            <Badge variant={r.type === "LAB" ? "warning" : "secondary"}>
              {ROOM_TYPES.find((t) => t.value === r.type)?.label ?? r.type}
            </Badge>
          </td>
          <td className="px-3 py-2 text-muted-foreground">{r.capacity ?? "—"}</td>
        </>
      )}
      renderForm={(editing, close) => (
        <EntityForm
          fields={[
            { name: "name", label: "Name", placeholder: "Room 204", required: true },
            { name: "type", label: "Type", type: "select", required: true, options: ROOM_TYPES },
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

function SubjectsTab() {
  const branches = useList<Branch>("/branches", ["branches"])
  const list = useList<Subject>("/subjects", ["subjects"])
  const create = useCreate<Subject>("/subjects", ["subjects"])
  const update = useUpdate<Subject>("/subjects", ["subjects"])
  const remove = useRemove("/subjects", ["subjects"])

  return (
    <CrudSection<Subject>
      title="Subjects"
      description="The short code is what appears in timetable cells — keep it brief, like BDA or ESIA."
      items={list.data}
      isLoading={list.isLoading}
      error={list.error}
      columns={["Code", "Name", "Branch", "Type"]}
      disabled={!branches.data?.length}
      disabledHint="Add a branch first."
      onDelete={(id) => remove.mutate(id)}
      deleteError={remove.error}
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
                { value: "LAB", label: "Lab (3 continuous periods)" },
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
  )
}

/* --------------------------------- Faculty -------------------------------- */

function FacultyTab() {
  const depts = useList<Department>("/departments", ["departments"])
  const subjects = useList<Subject>("/subjects", ["subjects"])
  const list = useList<Faculty>("/faculty", ["faculty"])
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
  const qc = useQueryClient()

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
          <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
            {subjects.map((s) => (
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
