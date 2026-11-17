import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted-foreground/15", className)}
      {...props}
    />
  )
}

/** List lines (title and subtitle left, amount and status right) shown while a list loads. */
function RowsSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn("divide-y divide-border", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-3">
          <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-40 max-w-full" /><Skeleton className="h-3 w-56 max-w-full" /></div>
          <div className="flex flex-col items-end gap-2"><Skeleton className="h-3.5 w-20" /><Skeleton className="h-4 w-14 rounded-full" /></div>
        </div>
      ))}
    </div>
  )
}

/** Stat tiles, then two chart-sized panels: the shape of the dashboards. */
function DashboardSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: tiles }, (_, i) => (
          <div key={i} className="rounded-xl border bg-card p-5 space-y-3">
            <Skeleton className="h-3 w-24" /><Skeleton className="h-7 w-32 max-w-full" /><Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-xl border bg-card p-5 space-y-4">
            <Skeleton className="h-4 w-40" /><Skeleton className="h-56 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** The signed-in app frame (sidebar, header, content) shown while the session is checked. */
function ShellSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="min-h-screen bg-background flex flex-col md:flex-row">
      <div className="md:hidden flex items-center justify-between p-4 border-b bg-card"><Skeleton className="h-6 w-32" /><Skeleton className="h-6 w-20" /></div>
      <div className="hidden md:flex flex-col w-64 bg-sidebar border-r border-sidebar-border shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border"><Skeleton className="h-6 w-36" /></div>
        <div className="p-4 space-y-3">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
      </div>
      <main className="flex-1 min-w-0">
        <header className="hidden md:flex h-16 border-b bg-card items-center px-8"><Skeleton className="h-5 w-32" /></header>
        <div className="p-4 md:p-8"><DashboardSkeleton /></div>
      </main>
    </div>
  )
}

export { Skeleton, RowsSkeleton, DashboardSkeleton, ShellSkeleton }
