import {
  type PluginNavPanelProps,
  useBbNavigate,
} from "@bb/plugin-sdk/app";

export function ProductSecurityHeader({
  subPath,
}: PluginNavPanelProps): React.JSX.Element | null {
  const navigate = useBbNavigate();
  const segments = subPath.split("/").filter(Boolean);

  // FS-35/WP-21 restores Sync review affordances once that panel ships.
  if (segments[0] !== "requirements" || segments[1] === "trace") {
    return null;
  }

  return (
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
  );
}
