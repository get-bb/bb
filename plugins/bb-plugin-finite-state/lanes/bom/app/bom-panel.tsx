import { useEffect } from "react";
import {
  useBbNavigate,
  type PluginNavPanelProps,
} from "@bb/plugin-sdk/app";
import { HbomRoutes } from "./hbom/hbom-routes.js";
import { parseBomSubPath } from "./sbom/routes.js";

function BadBomRoute(): React.JSX.Element {
  const navigate = useBbNavigate();
  return (
    <div className="flex h-full items-center justify-center bg-background p-6 text-foreground">
      <div className="max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-wider text-destructive">
          BAD_ROUTE
        </p>
        <h2 className="mt-2 text-lg font-semibold">This BOM route is invalid</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Component identities must use the bounded, canonical route-key
          encoding. No request was sent for this value.
        </p>
        <button
          className="mt-4 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() =>
            navigate.toPluginPanel("bom", {
              subPath: "software",
              replace: true,
            })
          }
          type="button"
        >
          Return to software
        </button>
      </div>
    </div>
  );
}

export function BomPanel({ subPath }: PluginNavPanelProps): React.JSX.Element {
  const navigate = useBbNavigate();
  const route = parseBomSubPath(subPath);
  useEffect(() => {
    if (subPath.length > 0) return;
    navigate.toPluginPanel("bom", { subPath: "software", replace: true });
  }, [navigate, subPath]);

  if (!route) return <BadBomRoute />;
  if (route.tab === "hardware") return <HbomRoutes route={route} />;
  return (
    <div className="flex h-full items-center justify-center bg-background p-6 text-foreground">
      <p className="text-sm text-muted-foreground">Loading software inventory…</p>
    </div>
  );
}
