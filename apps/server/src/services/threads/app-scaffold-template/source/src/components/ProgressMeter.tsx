import type { ProgressMeterProps } from "../types";

function donePercent(props: ProgressMeterProps): number {
  if (props.stats.total === 0) {
    return 0;
  }
  return Math.round((props.stats.done / props.stats.total) * 100);
}

export function ProgressMeter(props: ProgressMeterProps) {
  const percent = donePercent(props);
  const complete = props.stats.total > 0 && props.stats.done === props.stats.total;

  return (
    <div className="progress" data-complete={complete}>
      <div className="progress-label">
        <span>{complete ? "All done" : "Progress"}</span>
        <span className="progress-count">
          {props.stats.done}/{props.stats.total}
        </span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Completed todos"
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
