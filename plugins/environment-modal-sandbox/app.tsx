import { useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import type { modalRpcContract } from "./account.js";

function Connection() {
  const rpc = useRpc<typeof modalRpcContract>();
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function check() {
    setChecking(true);
    try {
      setMessage((await rpc.call("account.inspect", {})).message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Connect your Modal account, then select a project and create a machine.
      </p>
      <Button disabled={checking} onClick={() => void check()}>
        {checking ? "Checking…" : "Test connection"}
      </Button>
      {message && (
        <p className="text-sm" role="status">
          {message}
        </p>
      )}
      <a className="text-sm underline" href="/settings/machines">
        Open Machines
      </a>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "connection",
    title: "Connection",
    component: Connection,
  });
});
