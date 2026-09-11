export type DataKind = "LIVE" | "SNAPSHOT" | "PROJECTED" | "VERIFIED" | "DEMO";

interface DataBadgeProps {
  kind: DataKind;
  detail?: string;
}

/** Tells the reader which kind of number they are looking at. Every figure on screen carries one. */
export function DataBadge({ kind, detail }: DataBadgeProps) {
  return (
    <span className={`data-badge data-badge-${kind.toLowerCase()}`}>
      {kind}
      {detail && <> · {detail}</>}
    </span>
  );
}
