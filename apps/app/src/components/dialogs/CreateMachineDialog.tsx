import { useSystemConfig } from "@/hooks/queries/system-queries";
import { isLocalOnlyUrl } from "@/lib/loopback-hostname";
import { MachineEnrollmentCommand } from "./MachineEnrollmentCommand";
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
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const config = useSystemConfig();
  const [otherOptions, setOtherOptions] = useState(false);
  const autoStarted = useRef(false);
  const access = config.data?.serverAccess;
  const accessProvider = access?.providers.find(
    (provider) => provider.id === access.defaultProviderId,
  );
  const localUrl =
    access?.defaultProviderId === "direct" &&
    access.effectiveUrl !== null &&
    isLocalOnlyUrl(access.effectiveUrl);
  const serverUrl =
    access?.defaultProviderId === "direct"
      ? access.effectiveUrl
      : config.data?.serverUrl;
  const unreachableUrl =
    serverUrl && isLocalOnlyUrl(serverUrl) ? serverUrl : null;
  const accessReady =
    accessProvider?.availability.status === "available" && !localUrl;
  const createController = useRef<AbortController | null>(null);
  const createKey = useRef<string | null>(null);
  const [progress, setProgress] = useState("");
  const [launchId, setLaunchId] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      createController.current?.abort();
      createKey.current = null;
    }
  }, [open]);
  useEffect(() => () => createController.current?.abort(), []);
  const hostsQuery = useHosts();
  const projects = useQuery({
    queryKey: ["machine-create-projects"],
    queryFn: () => sdk.projects.list(),
    enabled: open,
  });
  const [projectId, setProjectId] = useState<string | null>(null);
  const { providers: machineProviders } = useSystemMachineProviders();
  const machineProviderInputsSlots = usePluginSlots().machineProviderInputs;
  const [selectedMachineProvider, setSelectedMachineProvider] =
    useState<SystemMachineProvider | null>(null);
  const [machineInputs, setMachineInputs] = useState<JsonValue | null>(null);
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

  useEffect(() => {
    if (!otherOptions && selectedMachineProvider === null) {
      const manual = machineProviders?.find(
        (provider) => provider.id === "manual",
      );
      if (manual) selectMachineProvider(manual);
    }
  }, [machineProviders, otherOptions, selectedMachineProvider]);
  useEffect(() => {
    if (
      !otherOptions &&
      accessReady &&
      selectedMachineProvider?.id === "manual" &&
      selectedMachineProvider.availability?.status !== "unavailable" &&
      !autoStarted.current
    ) {
      autoStarted.current = true;
      createMachine.mutate();
    }
  }, [otherOptions, accessReady, selectedMachineProvider, createMachine]);

  const showOtherOptions = async () => {
    if (launchId && createMachine.isPending)
      await sdk.hosts.cancel({ id: launchId });
    createController.current?.abort();
    setOtherOptions(true);
    setSelectedMachineProvider(null);
    setLaunchId(null);
    createKey.current = null;
    createMachine.reset();
  };
  const otherOptionsLink = (
    <button
      type="button"
      onClick={() => void showOtherOptions()}
      className="text-xs text-subtle-foreground underline underline-offset-2 hover:text-foreground"
    >
      Other options
    </button>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a machine</DialogTitle>
        <DialogDescription>
          {otherOptions
            ? "Choose how to add your machine."
            : !accessReady
              ? "Pair a machine to run projects and threads on it."
              : "Run this command on the machine you want to add. It installs bb and keeps the machine connected to this server."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        {!otherOptions && !accessReady && (
          <div
            role="status"
            className="space-y-3 rounded-md border border-border bg-muted/30 p-3"
          >
            <p className="text-sm font-medium">
              {unreachableUrl
                ? "Another machine cannot use this address."
                : "Remote access isn't ready yet."}
            </p>
            <p className="text-xs text-subtle-foreground">
              {unreachableUrl ? (
                <>
                  The pairing command would target{" "}
                  <span className="font-mono">{unreachableUrl}</span>, which
                  points to the machine that runs it, not to this bb. Set up
                  remote access first, then come back here to get a pairing
                  command that works from anywhere.
                </>
              ) : access?.defaultProviderId === "connect" ? (
                "Other machines need a reachable address for this server. Set up remote access first, then come back here to copy the pairing command."
              ) : accessProvider?.availability.status !== "available" ? (
                (accessProvider?.availability.message ??
                "Choose a reachable server address in Advanced settings.")
              ) : (
                "Checking remote access…"
              )}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="sm" variant="outline">
                <Link
                  onClick={() => onOpenChange(false)}
                  to={
                    access?.defaultProviderId === "connect"
                      ? getPluginConfigurationRoutePath({ pluginId: "connect" })
                      : "/settings/machines#advanced-machine-settings"
                  }
                >
                  {access?.defaultProviderId === "connect"
                    ? "Set up remote access"
                    : "Configure machine access"}
                </Link>
              </Button>
              {otherOptionsLink}
            </div>
          </div>
        )}
        {!otherOptions && createMachine.isError && (
          <div className="space-y-2">
            <p role="alert" className="text-xs text-destructive-text">
              {getMutationErrorMessage({
                error: createMachine.error,
                fallbackMessage: "Couldn't prepare an enrollment command.",
              })}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => createMachine.mutate()}
            >
              Try again
            </Button>
          </div>
        )}
        {!otherOptions &&
          accessReady &&
          !createMachine.isError &&
          !launchId && (
            <p role="status" className="text-sm text-subtle-foreground">
              Preparing enrollment command…
            </p>
          )}
        {otherOptions && (machineProviders?.length ?? 0) > 0 ? (
          <div className="space-y-2">
            <div className="space-y-1 rounded-md border border-border p-1">
              {machineProviders?.map((provider) => {
                const unavailable =
                  provider.availability?.status === "unavailable";
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
                      <span className="block truncate">
                        {provider.displayName}
                      </span>
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
                  <p className="text-xs text-destructive">
                    {machineInputsBlocked}
                  </p>
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
        ) : null}

        {otherOptions && createMachine.isPending && progress ? (
          <div className="space-y-2">
            <pre
              role="status"
              className="whitespace-pre-wrap break-all rounded-md border border-border p-3 font-mono text-xs"
            >
              {progress}
            </pre>
          </div>
        ) : null}
      </div>
      {open && createMachine.isPending && launchId ? (
        <MachineEnrollmentCommand id={launchId} scope="launch" />
      ) : null}
      {!otherOptions && accessReady && (
        <div className="flex items-center justify-between gap-3">
          <p role="status" className="text-xs text-subtle-foreground">
            {createMachine.isPending && launchId
              ? "Waiting for the machine to connect…"
              : ""}
          </p>
          {otherOptionsLink}
        </div>
      )}
      <DialogFooter>
        {createMachine.isPending && launchId ? (
          <Button
            variant="outline"
            onClick={() =>
              void sdk.hosts
                .cancel({ id: launchId })
                .then(() => createController.current?.abort())
            }
          >
            Cancel enrollment
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </DialogFooter>
    </>
  );
}
