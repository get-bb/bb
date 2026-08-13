import {
  type PluginNavPanelProps,
  useBbNavigate,
} from "@bb/plugin-sdk/app";

export function ProductSecurityHeader({
  subPath,
}: PluginNavPanelProps): React.JSX.Element {
  const navigate = useBbNavigate();
  const segments = subPath.split("/").filter(Boolean);
  const showTraceability =
    segments[0] === "requirements" && segments[1] !== "trace";
  const openProductSecuritySync = () =>
    navigate.toPluginPanel("sync", { subPath: "product-security" });

  return (
    <div className="flex items-center gap-2">
      <button
        aria-label="Review local product-security changes in Sync"
        className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={openProductSecuritySync}
        type="button"
      >
        Local changes
      </button>
      <button
        className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={openProductSecuritySync}
        type="button"
      >
        Open Sync
      </button>
      {showTraceability ? (
        <button
          className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() =>
            navigate.toPluginPanel("product-security", {
              subPath: "requirements/trace",
            })
          }
          type="button"
        >
          Traceability
        </button>
      ) : null}
    </div>
  );
}
