import { useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import type { modalRpcContract } from "./account.js";

function StandardImage() {
  const rpc = useRpc<typeof modalRpcContract>();
  const [saved, setSaved] = useState<{
    dockerfile: string;
    customized: boolean;
  } | null>(null);
  const [dockerfile, setDockerfile] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void rpc.call("image.definition", {}).then(
      (result) => {
        if (active) {
          setSaved(result);
          setDockerfile(result.dockerfile);
        }
      },
      (failure) => {
        if (active)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      },
    );
    return () => {
      active = false;
    };
  }, [rpc]);
  async function save(reset: boolean) {
    setSaving(true);
    setError(null);
    try {
      const result = reset
        ? await rpc.call("image.reset", {})
        : await rpc.call("image.set", { dockerfile });
      setSaved(result);
      setDockerfile(result.dockerfile);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="min-w-0 space-y-3">
      <p className="text-sm text-muted-foreground">
        Used for new Modal machines across projects. Supports one FROM followed
        by RUN, ENV, WORKDIR, and USER. BB installs its daemon during bootstrap.
      </p>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {saved === null ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading Dockerfile…
        </p>
      ) : (
        <>
          <textarea
            aria-label="Dockerfile"
            value={dockerfile}
            onChange={(event) => setDockerfile(event.target.value)}
            disabled={saving}
            spellCheck={false}
            rows={24}
            className="w-full resize-y rounded-md border bg-muted p-4 font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={saving || dockerfile === saved.dockerfile}
              onClick={() => void save(false)}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="ghost"
              disabled={saving || !saved.customized}
              onClick={() => void save(true)}
            >
              Reset to default
            </Button>
            <span className="text-sm text-muted-foreground">
              {saved.customized ? "Custom Dockerfile" : "Bundled default"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "standard-image",
    title: "Dockerfile",
    component: StandardImage,
  });
});
