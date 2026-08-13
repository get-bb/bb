import { Icon } from "@bb/shared-ui/icon";
import type { BomRoute } from "../sbom/routes.js";

export interface HbomRoutesProps {
  route: Extract<BomRoute, { tab: "hardware" }>;
}

export function HbomRoutes(_props: HbomRoutesProps): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center bg-background p-6 text-foreground">
      <div className="max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        <Icon
          aria-hidden="true"
          className="mb-4 size-6 text-muted-foreground"
          name="PackageReceive"
        />
        <h2 className="text-lg font-semibold">Hardware inventory is reserved</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          HBOM review and ingest arrive in WP-45. Software inventory remains
          available from this panel.
        </p>
      </div>
    </div>
  );
}
