import { useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { modalRpcContract } from "./account.js";

function StandardImage() {
  const rpc = useRpc<typeof modalRpcContract>();
  const [dockerfile, setDockerfile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void rpc.call("image.definition", {}).then(
      (result) => {
        if (active) setDockerfile(result.dockerfile);
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
  return (
    <div className="min-w-0 space-y-3">
      <p className="text-sm text-muted-foreground">
        The bundled Dockerfile used for new Modal machines. BB installs its
        daemon during bootstrap.
      </p>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : dockerfile === null ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading Dockerfile…
        </p>
      ) : (
        <pre
          aria-label="Standard image Dockerfile"
          className="max-w-full overflow-x-auto rounded-md border bg-muted p-4 font-mono text-xs"
        >
          <code>{dockerfile}</code>
        </pre>
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
