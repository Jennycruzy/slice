interface StatusDotProps {
  live: boolean;
  children: React.ReactNode;
  className?: string;
}

/** A status label whose state is carried by both the colour and the text. */
export function StatusDot({ live, children, className = "" }: StatusDotProps) {
  return (
    <span className={`${live ? "status-live" : "status-down"} ${className}`.trim()}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}
