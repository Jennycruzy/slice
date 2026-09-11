interface SkeletonProps {
  width?: string;
  height?: string;
  className?: string;
}

/** A neutral placeholder shown while real data loads. Never a confident zero. */
export function Skeleton({ width = "100%", height = "14px", className = "" }: SkeletonProps) {
  return <span className={`skeleton ${className}`.trim()} style={{ width, height }} aria-hidden="true" />;
}

export function SkeletonRows({ rows, height = "14px" }: { rows: number; height?: string }) {
  return (
    <div className="skeleton-rows" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => <Skeleton key={index} height={height} width={`${100 - (index % 3) * 12}%`} />)}
    </div>
  );
}
