interface SkeletonProps {
  className?: string
  height?: number | string
  width?: number | string
  rounded?: string
}

export function Skeleton({ className = '', height, width, rounded = 'rounded-xl' }: SkeletonProps) {
  return (
    <div
      className={`skeleton ${rounded} ${className}`}
      style={{ height, width }}
    />
  )
}

export function KPICardSkeleton() {
  return (
    <div className="rounded-2xl p-5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-2 mb-4">
        <Skeleton height={16} width={16} rounded="rounded-md" />
        <Skeleton height={10} width={80} />
      </div>
      <Skeleton height={48} width={64} rounded="rounded-lg" className="mb-2" />
      <Skeleton height={10} width={120} />
    </div>
  )
}

export function ClientCardSkeleton() {
  return (
    <div className="rounded-2xl p-5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-3 mb-4">
        <Skeleton height={40} width={40} rounded="rounded-full" />
        <div className="flex-1">
          <Skeleton height={14} width={100} className="mb-2" />
          <Skeleton height={10} width={160} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-4">
        <Skeleton height={54} />
        <Skeleton height={54} />
      </div>
      <Skeleton height={6} rounded="rounded-full" className="mb-4" />
      <div className="flex gap-2">
        <Skeleton height={36} className="flex-1" />
        <Skeleton height={36} className="flex-1" />
      </div>
    </div>
  )
}

export function TableRowSkeleton({ cols = 5 }: { cols?: number }) {
  const widths = [200, 80, 120, 140, 80]
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton height={14} width={widths[i] ?? 100} />
        </td>
      ))}
    </tr>
  )
}

export function LogRowSkeleton() {
  return (
    <div className="flex gap-3 py-2 px-4">
      <Skeleton height={12} width={72} rounded="rounded-md" />
      <Skeleton height={12} width={36} rounded="rounded-full" />
      <Skeleton height={12} className="flex-1" />
    </div>
  )
}

export function UploadCardSkeleton() {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-3 mb-3">
        <Skeleton height={32} width={32} rounded="rounded-lg" />
        <div className="flex-1">
          <Skeleton height={14} width="70%" className="mb-1.5" />
          <Skeleton height={10} width="40%" />
        </div>
        <Skeleton height={22} width={50} rounded="rounded-full" />
      </div>
      <Skeleton height={10} width="50%" />
    </div>
  )
}

export function QueueCardSkeleton() {
  return (
    <div className="rounded-2xl p-5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-3 mb-4">
        <Skeleton height={32} width={32} rounded="rounded-lg" />
        <Skeleton height={14} width={200} className="flex-1" />
        <Skeleton height={22} width={60} rounded="rounded-full" />
      </div>
      <Skeleton height={10} width={80} className="mb-2" />
      <Skeleton height={40} className="mb-4" />
      <Skeleton height={10} width={80} className="mb-2" />
      <Skeleton height={80} className="mb-4" />
      <div className="flex gap-2">
        <Skeleton height={36} className="flex-1" />
        <Skeleton height={36} width={80} />
        <Skeleton height={36} width={80} />
      </div>
    </div>
  )
}
