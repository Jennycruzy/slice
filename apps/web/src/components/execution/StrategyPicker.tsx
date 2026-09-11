import type { StrategyName } from "@slice/core";

interface StrategyPickerProps {
  strategy: StrategyName;
  onStrategy: (strategy: StrategyName) => void;
  exitPlanned: boolean;
  onExitPlanned: (planned: boolean) => void;
}

const STRATEGIES: Array<{ name: StrategyName; title: string; copy: string }> = [
  { name: "iceberg", title: "Hide my size", copy: "Show only the slice the book can see." },
  { name: "scale-in", title: "Scale in", copy: "Spread tranches across the live window." },
];

export function StrategyPicker({ strategy, onStrategy, exitPlanned, onExitPlanned }: StrategyPickerProps) {
  return (
    <>
      <div className="strategy-grid" role="group" aria-label="Strategy">
        {STRATEGIES.map((item) => (
          <button
            key={item.name}
            className={strategy === item.name ? "strategy selected" : "strategy"}
            aria-pressed={strategy === item.name}
            onClick={() => onStrategy(item.name)}
          >
            <strong>{item.title}</strong>
            <span>{item.copy}</span>
          </button>
        ))}
        <button className={exitPlanned ? "strategy selected" : "strategy"} aria-pressed={exitPlanned} onClick={() => onExitPlanned(!exitPlanned)}>
          <strong>Set my exit</strong>
          <span>Arm an on-chain rule after the position fills.</span>
        </button>
      </div>
      {exitPlanned && (
        <p className="inline-note exit-intent">
          After the fill, choose take profit, stop loss, or exit if book thins. The rule executes on-chain even when the Slice server is offline.
        </p>
      )}
    </>
  );
}
