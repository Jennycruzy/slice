import type { LayerError } from "../../hooks/useSliceData.js";

interface LayerErrorsProps {
  errors: LayerError[];
  onRetry: () => void;
}

/** Errors name the failing layer so a reader knows what still works. */
export function LayerErrors({ errors, onRetry }: LayerErrorsProps) {
  if (errors.length === 0) return null;
  return (
    <div className="layer-errors" role="alert">
      {errors.map((error) => (
        <div key={error.layer}>
          <strong>{error.title}</strong>
          <span>{error.detail}</span>
        </div>
      ))}
      <button onClick={onRetry}>Retry</button>
    </div>
  );
}
