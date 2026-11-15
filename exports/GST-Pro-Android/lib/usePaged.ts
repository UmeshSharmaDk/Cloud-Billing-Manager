import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "./api";

const PAGE = 20;

/** Pages through a `{ <key>: T[], total }` list endpoint for a FlatList. */
export function usePaged<T>(path: string, key: string, params: Record<string, string>) {
  const q = useInfiniteQuery({
    queryKey: [path, params],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ ...params, page: String(pageParam), limit: String(PAGE) });
      return api<Record<string, unknown> & { total: number }>(`${path}?${qs}`);
    },
    getNextPageParam: (last, all) => (all.length * PAGE < last.total ? all.length + 1 : undefined),
  });
  const items = (q.data?.pages ?? []).flatMap((p) => p[key] as T[]);
  return { ...q, items };
}
