import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query"
import { api } from "@/lib/api"

/**
 * Generic CRUD hooks. Every master-data screen has the same shape
 * (list / create / update / delete), so it's defined once here rather than
 * repeated per resource.
 */
export function useList<T>(path: string, key: QueryKey, enabled = true) {
  return useQuery({
    queryKey: key,
    queryFn: () => api.get<T[]>(path),
    enabled,
  })
}

/** Invalidate anything that could be affected by a write. */
function useInvalidate(extraKeys: QueryKey[] = []) {
  const qc = useQueryClient()
  return (key: QueryKey) => {
    qc.invalidateQueries({ queryKey: key })
    qc.invalidateQueries({ queryKey: ["summary"] })
    for (const k of extraKeys) qc.invalidateQueries({ queryKey: k })
  }
}

export function useCreate<T, Body = unknown>(
  path: string,
  key: QueryKey,
  extraKeys: QueryKey[] = []
) {
  const invalidate = useInvalidate(extraKeys)
  return useMutation({
    mutationFn: (body: Body) => api.post<T>(path, body),
    onSuccess: () => invalidate(key),
  })
}

export function useUpdate<T, Body = unknown>(
  path: string,
  key: QueryKey,
  extraKeys: QueryKey[] = []
) {
  const invalidate = useInvalidate(extraKeys)
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Body }) =>
      api.patch<T>(`${path}/${id}`, body),
    onSuccess: () => invalidate(key),
  })
}

export function useRemove(
  path: string,
  key: QueryKey,
  extraKeys: QueryKey[] = []
) {
  const invalidate = useInvalidate(extraKeys)
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`${path}/${id}`),
    onSuccess: () => invalidate(key),
  })
}
