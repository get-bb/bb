import { MachineAccessControls } from "@/components/settings/MachineAccessSettings";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { isLocalOnlyUrl } from "@/lib/loopback-hostname";
import { MachineSetupProgress } from "./MachineSetupProgress";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { JsonValue } from "@bb/domain";
import type { PluginMachineProviderInputsChange } from "@get-bb/plugin-sdk";
import type { SystemMachineProvider } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { MachineProviderIcon } from "@/components/plugin/MachineProviderIcon";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { machineProviderInputsControlRequired } from "@/components/pickers/machine-provider-inputs";
import { useHosts } from "@/hooks/queries/host-queries";
import { useSystemMachineProviders } from "@/hooks/queries/machine-provider-queries";
import { getPluginConfigurationRoutePath } from "@/lib/route-paths";
import { sdk } from "@/lib/sdk";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { usePluginSlots } from "@/lib/plugin-slots";

export function CreateMachineDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        {open && (
          <CreateMachineContent open={open} onOpenChange={onOpenChange} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateMachineContent({
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { providers: loadedProviders } = useSystemMachineProviders();
  const providers = loadedProviders ?? [];
  const config = useSystemConfig();
  const { machineSetup } = usePluginSlots();
  const hosts = useHosts();
  const [selection, setSelection] = useState<string | null | undefined>();
  const setups = machineSetup.filter((slot) =>
    providers.some(
      (provider) =>
        provider.id === slot.machineProviderId &&
        provider.pluginId === slot.pluginId,
    ),
  );
  const selectedId =
    selection ?? (providers.length === 1 ? providers[0]?.id : null);
  const selected = setups.find((slot) => slot.machineProviderId === selectedId);
  const access = config.data?.serverAccess;
  const accessProvider = access?.providers.find(
    (provider) => provider.id === access.defaultProviderId,
  );
  const accessReady =
    accessProvider?.availability.status === "available" &&
    (access?.defaultProviderId !== "direct" ||
      (!!access.effectiveUrl && !isLocalOnlyUrl(access.effectiveUrl)));
  if (!accessReady || loadedProviders === undefined) {
    const loading =
      config.isPending || (accessReady && loadedProviders === undefined);
    if (loading) {
      return (
        <>
          <DialogTitle className="sr-only">Add a machine</DialogTitle>
          <p role="status" className="text-sm text-subtle-foreground">
            Checking machine access…
          </p>
        </>
      );
    }
    return (
      <>
        <DialogHeader>
          <DialogTitle>Set up machine access</DialogTitle>
          <DialogDescription>
            A new machine has to reach this server over the network. Choose the
            address it should use.
          </DialogDescription>
        </DialogHeader>
        {config.isError ? (
          <p role="alert">
            Could not check machine access.{" "}
            <Button variant="outline" onClick={() => void config.refetch()}>
              Try again
            </Button>
          </p>
        ) : (
          <MachineAccessControls onNavigate={() => onOpenChange(false)} />
        )}
      </>
    );
  }
  if (selected) {
    const Component = selected.component;
    return (
      <>
        <DialogTitle className="sr-only">Add a machine</DialogTitle>
        <PluginSlotMount
          pluginId={selected.pluginId}
          slotKind="machineSetup"
          slotId={selected.machineProviderId}
        >
          <Component
            client={sdk}
            onClose={() => {
              void hosts.refetch();
              onOpenChange(false);
            }}
          />
        </PluginSlotMount>
      </>
    );
  }
  return (
    <ProviderMachineSetup
      onOpenChange={onOpenChange}
      providers={providers}
      onSelectSetup={(id) => setSelection(id)}
      setupIds={setups.map((slot) => slot.machineProviderId)}
    />
  );
}

function ProviderMachineSetup({
  onOpenChange,
  providers,
  onSelectSetup,
  setupIds,
}: {
  onOpenChange: (open: boolean) => void;
  providers: readonly SystemMachineProvider[];
  onSelectSetup: (id: string) => void;
  setupIds: readonly string[];
}) {
  const createController = useRef<AbortController | null>(null);
  const createKey = useRef<string | null>(null);
  const [progress, setProgress] = useState("");
  const [launchId, setLaunchId] = useState<string | null>(null);
  useEffect(() => () => createController.current?.abort(), []);
  const hostsQuery = useHosts();
  const projects = useQuery({
    queryKey: ["machine-create-projects"],
    queryFn: () => sdk.projects.list(),
  });
  const [projectId, setProjectId] = useState<string | null>(null);
  const machineProviderInputsSlots = usePluginSlots().machineProviderInputs;
  const [selectedMachineProvider, setSelectedMachineProvider] =
    useState<SystemMachineProvider | null>(() =>
      providers.length === 1 ? providers[0]! : null,
    );
  const [machineInputs, setMachineInputs] = useState<JsonValue | null>(() =>
    providers.length === 1 &&
    providers[0]?.inputs !== null &&
    providers[0]?.acceptsEmptyInputs
      ? {}
      : null,
  );
  const [machineInputsBlocked, setMachineInputsBlocked] = useState<
    string | null
  >(null);
  const machineInputsRegistration =
    selectedMachineProvider === null
      ? undefined
      : machineProviderInputsSlots.find(
          (slot) =>
            slot.machineProviderId === selectedMachineProvider.id &&
            slot.pluginId === selectedMachineProvider.pluginId,
        );
  const MachineInputsComponent = machineInputsRegistration?.component;
  const selectMachineProvider = (provider: SystemMachineProvider): void => {
    if (setupIds.includes(provider.id)) {
      onSelectSetup(provider.id);
      return;
    }
    createKey.current = null;
    setSelectedMachineProvider(provider);
    setMachineInputs(
      provider.inputs === null ? null : provider.acceptsEmptyInputs ? {} : null,
    );
    setMachineInputsBlocked(null);
  };
  const handleMachineInputsChange = (
    next: PluginMachineProviderInputsChange,
  ): void => {
    createKey.current = null;
    if (next.status === "blocked") {
      setMachineInputsBlocked(next.reason);
      return;
    }
    setMachineInputsBlocked(null);
    setMachineInputs(next.value);
  };
  const createMachine = useMutation({
    meta: { showErrorToast: false },
    mutationFn: async () => {
      if (selectedMachineProvider === null) {
        throw new Error("Select a machine provider.");
      }
      setProgress("");
      setLaunchId(null);
      const controller = new AbortController();
      createController.current = controller;
      createKey.current ??= crypto.randomUUID();
      try {
        const launch = await sdk.hosts.submit({
          key: createKey.current,
          machineProviderId: selectedMachineProvider.id,
          projectId,
          inputs: machineInputs,
          signal: controller.signal,
        });
        setLaunchId(launch.id);
        return await sdk.hosts.follow({
          id: launch.id,
          signal: controller.signal,
          onProgress: (status) => {
            setProgress(status.step);
            if (status.terminal) createKey.current = null;
          },
        });
      } finally {
        if (createController.current === controller)
          createController.current = null;
      }
    },
    onSuccess: async () => {
      await hostsQuery.refetch();
      onOpenChange(false);
    },
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a machine</DialogTitle>
        <DialogDescription>Choose how to add your machine.</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <div className="space-y-1 rounded-md border border-border p-1">
          {providers.map((provider) => {
            const unavailable = provider.availability?.status === "unavailable";
            return (
              <button
                key={provider.id}
                type="button"
                disabled={unavailable || createMachine.isPending}
                onClick={() => selectMachineProvider(provider)}
                className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm hover:bg-state-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {provider.icon === null ? null : (
                  <MachineProviderIcon
                    provider={provider}
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{provider.displayName}</span>
                  {provider.availability?.status === "available" ||
                  provider.availability === null ? null : (
                    <span className="block text-xs text-muted-foreground">
                      {provider.availability.message}
                    </span>
                  )}
                </span>
                <Icon
                  name="Check"
                  className={cn(
                    "size-4 shrink-0",
                    selectedMachineProvider?.id === provider.id
                      ? "opacity-100"
                      : "opacity-0",
                  )}
                />
              </button>
            );
          })}
        </div>
        {selectedMachineProvider === null ? null : (
          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
            <label className="flex flex-col gap-1 text-sm">
              Project
              <select
                aria-label="Machine project"
                className="rounded-md border border-input bg-background px-3 py-2"
                value={projectId ?? ""}
                onChange={(event) => {
                  createKey.current = null;
                  setProjectId(event.target.value || null);
                  setMachineInputs(null);
                  setMachineInputsBlocked(
                    machineInputsRegistration
                      ? "Checking project inputs"
                      : null,
                  );
                }}
              >
                <option value="">No project</option>
                {(projects.data ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            {projects.error && (
              <p role="alert">
                Could not load projects: {projects.error.message}
              </p>
            )}

            {machineInputsRegistration === undefined ||
            MachineInputsComponent === undefined ? null : (
              <PluginSlotMount
                pluginId={machineInputsRegistration.pluginId}
                slotKind="machineProviderInputs"
                slotId={machineInputsRegistration.machineProviderId}
              >
                <MachineInputsComponent
                  key={`${selectedMachineProvider.id}:${projectId}`}
                  projectId={projectId}
                  value={machineInputs}
                  onChange={handleMachineInputsChange}
                />
              </PluginSlotMount>
            )}
            {selectedMachineProvider.availability?.status ===
            "setup-required" ? (
              <Button asChild size="sm" variant="outline">
                <Link
                  to={getPluginConfigurationRoutePath({
                    pluginId: selectedMachineProvider.pluginId,
                  })}
                >
                  Configure {selectedMachineProvider.displayName}
                </Link>
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={
                  createMachine.isPending ||
                  machineInputsBlocked !== null ||
                  (machineProviderInputsControlRequired(
                    selectedMachineProvider,
                  ) &&
                    machineInputsRegistration === undefined) ||
                  (selectedMachineProvider.inputs !== null &&
                    machineInputs === null)
                }
                onClick={() => createMachine.mutate()}
              >
                {createMachine.isPending
                  ? "Creating machine…"
                  : `Create ${selectedMachineProvider.displayName}${/machine$/iu.test(selectedMachineProvider.displayName) ? "" : " machine"}`}
              </Button>
            )}
            {machineInputsBlocked === null ? null : (
              <p className="text-xs text-destructive">{machineInputsBlocked}</p>
            )}
            {createMachine.isError ? (
              <p className="text-xs text-destructive">
                {getMutationErrorMessage({
                  error: createMachine.error,
                  fallbackMessage: "Couldn't create the machine.",
                })}
              </p>
            ) : null}
          </div>
        )}
      </div>
      {createMachine.isPending && progress && (
        <p role="status" className="text-sm text-subtle-foreground">
          {progress}
        </p>
      )}
      {launchId && selectedMachineProvider && (
        <MachineSetupProgress
          id={launchId}
          scope="launch"
          providerId={selectedMachineProvider.id}
        />
      )}

      <DialogFooter>
        {createMachine.isPending && launchId ? (
          <Button
            variant="outline"
            onClick={() =>
              void sdk.hosts.cancel({ id: launchId }).then(() => {
                createController.current?.abort();
                onOpenChange(false);
              })
            }
          >
            Cancel setup
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </DialogFooter>
    </>
  );
}
