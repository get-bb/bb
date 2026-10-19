import { PluginAttentionBanner } from "./PluginAttentionBanner";
import { makePluginListItem } from "@/test/fixtures/plugins";

export default { title: "Plugins/Attention banner" };

export function MultipleFailures() {
  return (
    <div className="mx-auto max-w-3xl p-4">
      <PluginAttentionBanner
        plugins={[
          makePluginListItem({
            id: "notifications",
            name: "Notifications",
            status: "incompatible",
            statusDetail: "Requires a newer version of bb.",
            provenance: "builtin",
          }),
          makePluginListItem({
            id: "local-tools",
            name: "Local tools",
            source: "path:/plugins/local-tools",
            status: "missing",
            statusDetail:
              "Plugin directory was not found: /Users/example/projects/a-very-long-plugin-directory-that-needs-to-wrap-on-small-mobile-screens/local-tools",
          }),
        ]}
        onOpenPlugin={() => {}}
      />
    </div>
  );
}

export function SingleFailure() {
  return (
    <div className="mx-auto max-w-3xl p-4">
      <PluginAttentionBanner
        plugins={[
          makePluginListItem({
            id: "notifications",
            name: "Notifications",
            status: "incompatible",
            statusDetail: "Requires a newer version of bb.",
            provenance: "builtin",
          }),
        ]}
        onOpenPlugin={() => {}}
      />
    </div>
  );
}

export function MissingFiles() {
  return (
    <div className="mx-auto max-w-3xl p-4">
      <PluginAttentionBanner
        plugins={[
          makePluginListItem({
            id: "local-tools",
            name: "Local tools",
            status: "missing",
            statusDetail:
              "Plugin directory was not found: /Users/example/plugins/local-tools",
          }),
        ]}
        onOpenPlugin={() => {}}
      />
    </div>
  );
}

export function StartupFailed() {
  return (
    <div className="mx-auto max-w-3xl p-4">
      <PluginAttentionBanner
        plugins={[
          makePluginListItem({
            id: "notifications",
            name: "Notifications",
            status: "error",
            statusDetail: "Worker exited unexpectedly.",
          }),
        ]}
        onOpenPlugin={() => {}}
      />
    </div>
  );
}
