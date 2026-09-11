interface EmptyStateProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, children, className = "" }: EmptyStateProps) {
  return (
    <div className={`empty-state terminal-empty ${className}`.trim()}>
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  );
}
