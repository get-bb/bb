import { Icon } from "@bb/shared-ui/icon";
import type { StrideSegment } from "./aggregate.js";

interface ThreatLegendProps {
  configured: boolean;
  labels: Record<StrideSegment, string>;
}

export function ThreatLegend({
  configured,
  labels,
}: ThreatLegendProps): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1 font-medium text-foreground">
        <Icon aria-hidden="true" className="size-3.5" name="Target" />
        STRIDE
      </span>
      <span aria-label={labels.spoofing} role="img" title={labels.spoofing}>
        S
      </span>
      <span aria-label={labels.tampering} role="img" title={labels.tampering}>
        T
      </span>
      <span aria-label={labels.repudiation} role="img" title={labels.repudiation}>
        R
      </span>
      <span
        aria-label={labels.information_disclosure}
        role="img"
        title={labels.information_disclosure}
      >
        I
      </span>
      <span
        aria-label={labels.denial_of_service}
        role="img"
        title={labels.denial_of_service}
      >
        D
      </span>
      <span
        aria-label={labels.elevation_of_privilege}
        role="img"
        title={labels.elevation_of_privilege}
      >
        E
      </span>
      <span>O = Other</span>
      {!configured ? (
        <span className="inline-flex items-center gap-1 text-foreground">
          <Icon aria-hidden="true" className="size-3.5" name="AlertTriangle" />
          Methodology vocabulary unavailable; categories stay under Other.
        </span>
      ) : null}
    </div>
  );
}
