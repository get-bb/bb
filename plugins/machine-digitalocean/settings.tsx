import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { Input } from "@bb/shared-ui/input";
import { Button } from "@bb/shared-ui/button";
import type { devboxRpc } from "./rpc.js";
import { configSchema, type DevboxConfig } from "./devbox.js";

export function DevboxSettings() {
  const rpc = useRpc<typeof devboxRpc>();
  const [machines, setMachines] = useState<{ id: string; name: string }[]>([]);
  const [hostId, setHostId] = useState("");
  const [config, setConfig] = useState<DevboxConfig | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void rpc
      .call("machines")
      .then((value) => {
        if (active) setMachines(value);
      })
      .catch(() => {
        if (active) setMessage("Could not load machines");
      });
    return () => {
      active = false;
    };
  }, [rpc]);
  useEffect(() => {
    let active = true;
    if (hostId)
      void rpc
        .call("configuration", { hostId })
        .then((value) => {
          if (active) setConfig(value);
        })
        .catch(() => {
          if (active) setMessage("Could not load configuration");
        });
    return () => {
      active = false;
    };
  }, [rpc, hostId]);
  async function act(action: "configure" | "sleep" | "wake" | "status") {
    if (!config) return;
    setBusy(true);
    try {
      if (action === "configure") {
        await rpc.call("configure", {
          hostId,
          config: configSchema.parse(config),
        });
        setMessage("Saved");
      } else if (action === "status") {
        const result = await rpc.call("status", { hostId });
        setMessage(result.summary);
      } else {
        await rpc.call(action, { hostId });
        const result = await rpc.call("status", { hostId });
        setMessage(result.summary);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        Powered-off droplets still bill; snapshot storage bills per GB.{" "}
        <a
          href="https://docs.digitalocean.com/products/droplets/details/pricing/"
          target="_blank"
          rel="noreferrer"
        >
          Droplet pricing
        </a>{" "}
        ·{" "}
        <a
          href="https://docs.digitalocean.com/products/snapshots/details/pricing/"
          target="_blank"
          rel="noreferrer"
        >
          Snapshot pricing
        </a>
      </p>
      <label>
        Dev box{" "}
        <select
          aria-label="Dev box"
          disabled={busy}
          value={hostId}
          onChange={(event) => {
            setHostId(event.target.value);
            setConfig(null);
          }}
        >
          <option value="">Select machine</option>
          {machines.map((machine) => (
            <option key={machine.id} value={machine.id}>
              {machine.name}
            </option>
          ))}
        </select>
      </label>
      {config ? (
        <>
          <label>
            Idle stop after minutes (empty disables)
            <Input
              aria-label="Idle stop minutes"
              type="number"
              min={1}
              disabled={busy}
              value={config.idleMinutes ?? ""}
              onChange={(event) =>
                setConfig({
                  ...config,
                  idleMinutes: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
            />
          </label>
          <label>
            Retained snapshots
            <Input
              aria-label="Retained snapshots"
              type="number"
              min={1}
              max={100}
              disabled={busy}
              value={config.retention}
              onChange={(event) =>
                setConfig({ ...config, retention: Number(event.target.value) })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={config.schedule !== null}
              disabled={busy}
              onChange={(event) =>
                setConfig({
                  ...config,
                  schedule: event.target.checked
                    ? {
                        weekdays: [1, 2, 3, 4, 5],
                        sleep: "19:00",
                        wake: "08:00",
                        timezone:
                          Intl.DateTimeFormat().resolvedOptions().timeZone,
                      }
                    : null,
                })
              }
            />{" "}
            Scheduled sleep and wake
          </label>
          {config.schedule ? (
            <>
              <div className="flex flex-wrap gap-2">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                  (day, index) => (
                    <label key={day}>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={config.schedule?.weekdays.includes(index)}
                        onChange={(event) => {
                          const schedule = config.schedule;
                          if (schedule)
                            setConfig({
                              ...config,
                              schedule: {
                                ...schedule,
                                weekdays: event.target.checked
                                  ? [...schedule.weekdays, index]
                                  : schedule.weekdays.filter(
                                      (item) => item !== index,
                                    ),
                              },
                            });
                        }}
                      />
                      {day}
                    </label>
                  ),
                )}
              </div>
              {(["sleep", "wake", "timezone"] as const).map((key) => (
                <label key={key}>
                  {key}
                  <Input
                    aria-label={key}
                    type={key === "timezone" ? "text" : "time"}
                    disabled={busy}
                    value={config.schedule?.[key]}
                    onChange={(event) => {
                      if (config.schedule)
                        setConfig({
                          ...config,
                          schedule: {
                            ...config.schedule,
                            [key]: event.target.value,
                          },
                        });
                    }}
                  />
                </label>
              ))}
              <p>
                The always-on BB server catches up the latest missed action
                within eight days. Busy sleep retries each minute until
                superseded. Skipped DST times do not run; repeated times may run
                twice.
              </p>
            </>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void act("configure")}>
              Save
            </Button>
            <Button disabled={busy} onClick={() => void act("sleep")}>
              Snapshot now and sleep
            </Button>
            <Button disabled={busy} onClick={() => void act("wake")}>
              Wake now
            </Button>
            <Button disabled={busy} onClick={() => void act("status")}>
              Show estimated cost
            </Button>
          </div>
        </>
      ) : null}
      <pre role="status" className="whitespace-pre-wrap text-xs">
        {message}
      </pre>
    </div>
  );
}
