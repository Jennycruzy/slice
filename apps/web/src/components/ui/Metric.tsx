interface MetricProps {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: "default" | "gold" | "bid" | "ask";
  className?: string;
}

/** A labelled number. The label sits above the value so columns of metrics scan cleanly. */
export function Metric({ label, value, note, tone = "default", className = "" }: MetricProps) {
  return (
    <div className={`metric metric-${tone} ${className}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
