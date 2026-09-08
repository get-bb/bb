import { useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginMachineProviderInputsProps,
} from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import {
  tailscaleContract,
  inputsSchema,
  accessStatusSchema,
} from "./contract.js";
import type { Device } from "./schemas.js";

export function TailscaleInputs({
  value,
  onChange,
}: PluginMachineProviderInputsProps) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const rpc = useRpc<typeof tailscaleContract>();
  const initial = inputsSchema.safeParse(value);
  const [deviceId, setDeviceId] = useState(
    initial.success ? initial.data.deviceId : "",
  );
  const [username, setUsername] = useState(
    initial.success ? initial.data.username : "",
  );
  const [nodeDirectory, setNodeDirectory] = useState(
    initial.success ? (initial.data.nodeDirectory ?? "") : "",
  );
  const [useDefault, setUseDefault] = useState(
    initial.success && initial.data.accessProviderId === "default",
  );
  const [devices, setDevices] = useState<Device[]>([]);
  const [access, setAccess] = useState<z.infer<
    typeof accessStatusSchema
  > | null>(null);
  const [port, setPort] = useState("8443");
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.all([
      rpc.call("devices", null),
      rpc.call("accessStatus", null),
    ])
      .then(([list, status]) => {
        if (!active) return;
        setDevices(list);
        setAccess(status);
        setError(null);
        if (status.port !== null) setPort(String(status.port));
      })
      .catch(() => {
        if (active)
          setError(
            "Could not inspect Tailscale on the bb server. Check installation and sign-in.",
          );
      });
    return () => {
      active = false;
    };
  }, [rpc, refresh]);
  useEffect(() => {
    const parsed = inputsSchema.safeParse({
      deviceId,
      username,
      nodeDirectory: nodeDirectory.trim() || null,
      accessProviderId: useDefault ? "default" : "tailscale",
    });
    if (
      !parsed.success ||
      !devices.some((d) => d.id === deviceId && d.online)
    ) {
      onChangeRef.current({
        status: "blocked",
        reason: "Select an online device and enter its OS username.",
      });
    } else if (!useDefault && !access?.available) {
      onChangeRef.current({
        status: "blocked",
        reason: "Verify private server access first.",
      });
    } else onChangeRef.current({ status: "ready", value: parsed.data });
  }, [deviceId, username, nodeDirectory, useDefault, devices, access]);
  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm">
      <label>
        Tailnet device
        <select
          aria-label="Tailnet device"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          className="w-full rounded-md border border-input bg-background p-2"
        >
          <option value="">Select a device</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id} disabled={!d.online}>
              {d.label} ({d.dnsName}){d.online ? "" : " — offline"}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => setRefresh((n) => n + 1)}>
        Refresh devices and access
      </button>
      <label>
        OS username
        <input
          aria-label="OS username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full rounded-md border border-input bg-background p-2"
        />
      </label>
      <p className="text-muted-foreground">
        Uses ordinary SSH with the server’s existing keys and trusted host keys.
        Node 22.19+ and npm must be installed on the device.
      </p>
      <label>
        Node bin directory (optional)
        <input
          aria-label="Node bin directory"
          value={nodeDirectory}
          onChange={(e) => setNodeDirectory(e.target.value)}
          placeholder="Absolute path when Node is outside SSH’s PATH"
          className="w-full rounded-md border border-input bg-background p-2"
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={useDefault}
          onChange={(e) => setUseDefault(e.target.checked)}
        />{" "}
        Use the instance’s default machine access
      </label>
      {!useDefault && (
        <div className="flex flex-col gap-2">
          <p>{access?.message ?? "Checking private server access…"}</p>
          {access?.serverUrl && <p className="break-all">{access.serverUrl}</p>}
          {!access?.available && (
            <>
              <p>
                Create one dedicated HTTPS Serve mapping on the bb server, then
                verify its port. This plugin never changes Serve configuration.
              </p>
              {access && (
                <code className="break-all">
                  tailscale serve --bg --https={port} {access.loopbackUrl}
                </code>
              )}
              <label>
                Serve HTTPS port
                <input
                  aria-label="Serve HTTPS port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  className="w-full rounded-md border border-input bg-background p-2"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  void rpc
                    .call("configure", { port: Number(port) })
                    .then((status) => {
                      setAccess(status);
                      setError(null);
                    })
                    .catch(() =>
                      setError(
                        "The port must have a private HTTPS Serve mapping to this bb server only.",
                      ),
                    );
                }}
              >
                Verify Serve endpoint
              </button>
            </>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <p className="text-muted-foreground">
        This machine stays enrolled until removed. Removal uninstalls this bb
        machine; it keeps the computer and Tailscale membership.
      </p>
    </div>
  );
}
export default definePluginApp((app) => {
  app.slots.experimental_machineProviderInputs({
    machineProviderId: "tailscale",
    component: TailscaleInputs,
  });
});
