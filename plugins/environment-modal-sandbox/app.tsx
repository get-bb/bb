import { z } from "zod";
import { useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginMachineProviderInputsProps,
} from "@get-bb/plugin-sdk/app";
import { Input } from "@bb/shared-ui/input";
import type { modalRpcContract } from "./catalogue/contract.js";
import type { Build, Project } from "./catalogue/model.js";
import { ModalSettings } from "./settings.js";
import {
  errorText,
  runningHourlyEstimate,
  stalenessLabel,
  type Staleness,
} from "./ui-state.js";

function ModalInputs({
  projectId,
  value,
  onChange,
  experimental_agentProviderId,
}: PluginMachineProviderInputsProps) {
  const rpc = useRpc<typeof modalRpcContract>();
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  }, [onChange]);
  const [project, setProject] = useState<
    (Project & { staleness: Staleness }) | null
  >(null);
  const [build, setBuild] = useState<Build | null>(null);
  const [message, setMessage] = useState("Checking project image…");
  const initial = z
    .object({
      buildId: z.string().optional(),
      resources: z
        .object({ cpuCores: z.number(), memoryMiB: z.number() })
        .optional(),
    })
    .safeParse(value);
  const [cpu, setCpu] = useState<number | null>(() =>
    initial.success ? (initial.data.resources?.cpuCores ?? null) : null,
  );
  const [memory, setMemory] = useState<number | null>(() =>
    initial.success ? (initial.data.resources?.memoryMiB ?? null) : null,
  );
  const [imageOverride, setImageOverride] = useState(() =>
    initial.success ? (initial.data.buildId ?? "") : "",
  );
  const [images, setImages] = useState<Build[]>([]);
  const provider = experimental_agentProviderId ?? "codex";
  useEffect(() => {
    let live = true;
    setBuild(null);
    setProject(null);
    callback.current({
      status: "blocked",
      reason: "Checking the selected project image",
    });
    if (!projectId) {
      setMessage("Select a project to use its Modal image");
      return;
    }
    void (async () => {
      const sources = await rpc.call("project.sources", { projectId });
      const source = sources.find((source) => source.primaryHost);
      if (source)
        await rpc
          .call("project.inspect", { projectId, environmentId: source.id })
          .catch(() => undefined);
      const [configured, preflight, available] = await Promise.all([
        rpc.call("project.show", { projectId }),
        rpc.call("project.preflight", {
          projectId,
          agentProviderId: provider,
          buildId: imageOverride || null,
        }),
        rpc.call("image.list", { projectId, cursor: null, limit: 100 }),
      ]);
      if (!live) return;
      setProject(configured);
      setImages(available.images);
      setMessage(preflight.message);
      setBuild(preflight.ready ? preflight.build : null);
    })().catch((error) => {
      if (live) {
        setMessage(errorText(error));
        callback.current({
          status: "blocked",
          reason: "Modal image preflight failed; review settings",
        });
      }
    });
    return () => {
      live = false;
    };
  }, [rpc, projectId, provider, imageOverride]);
  useEffect(() => {
    if (!build || !project) {
      callback.current({ status: "blocked", reason: message });
      return;
    }
    const cpuCores = cpu ?? project.resources.cpuCores;
    const memoryMiB = memory ?? project.resources.memoryMiB;
    if (
      !Number.isFinite(cpuCores) ||
      cpuCores < 0.125 ||
      cpuCores > 64 ||
      !Number.isInteger(memoryMiB) ||
      memoryMiB < 128 ||
      memoryMiB > 262144
    ) {
      callback.current({
        status: "blocked",
        reason: "Enter 0.125–64 physical cores and 128–262144 MiB memory",
      });
      return;
    }
    callback.current({
      status: "ready",
      value: {
        buildId: build.buildId,
        accountRef: "default",
        appName: build.appName,
        resources: { cpuCores, memoryMiB },
        policy: project.policy,
      },
    });
  }, [build, project, cpu, memory, message]);
  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm">
      <h3 className="font-medium">New Modal sandbox</h3>
      <p role="status" className="text-xs">
        {message}
      </p>
      {project && (
        <>
          <p className="text-xs">{stalenessLabel(project.staleness)}</p>
          <label className="flex flex-col gap-1 text-xs">
            Image
            <select
              aria-label="Modal image"
              className="rounded-md border border-border bg-background p-2"
              value={imageOverride}
              onChange={(event) => setImageOverride(event.target.value)}
            >
              <option value="">Project’s selected image</option>
              {images
                .filter((image) => image.state === "ready")
                .map((image) => (
                  <option key={image.buildId} value={image.buildId}>
                    Recipe r{image.revision} · {image.buildId}
                  </option>
                ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs">
              Physical cores
              <Input
                aria-label="Modal physical cores"
                type="number"
                min={0.125}
                step={0.125}
                value={cpu ?? project.resources.cpuCores}
                onChange={(event) => setCpu(Number(event.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Memory (MiB)
              <Input
                aria-label="Modal memory MiB"
                type="number"
                min={128}
                step={128}
                value={memory ?? project.resources.memoryMiB}
                onChange={(event) => setMemory(Number(event.target.value))}
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Pauses after {project.policy.idleMinutes || "no"} idle minutes.
            Lifetime {project.policy.lifetimeMinutes} minutes; planned
            preservation interrupts active work. Retained{" "}
            {project.policy.retentionDays} days after the last thread unless
            kept.
          </p>
          <p className="text-xs">
            Estimated running compute $
            {runningHourlyEstimate(
              cpu ?? project.resources.cpuCores,
              memory ?? project.resources.memoryMiB,
            ).toFixed(4)}
            /hour; additional charges and unknown snapshot storage apply.{" "}
            <a
              className="underline"
              href="https://modal.com/pricing"
              target="_blank"
              rel="noreferrer"
            >
              Rates: September 8, 2026
            </a>
            .
          </p>
        </>
      )}
      <a
        className="text-xs underline"
        href="/settings/plugins/environment-modal-sandbox"
      >
        Configure Modal
      </a>
      <p className="text-xs text-muted-foreground">
        Creates a new machine for this thread. Choose an existing machine’s
        section in the picker to reuse or wake it. Builds are always explicit.
      </p>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "catalogue",
    title: "Project sandboxes",
    component: ModalSettings,
  });
  app.slots.experimental_machineProviderInputs({
    machineProviderId: "modal-sandbox",
    component: (props) => <ModalInputs key={props.projectId} {...props} />,
  });
});
