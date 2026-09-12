import { useEffect, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type JsonValue,
  type PluginMachineProviderInputsProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MENU_CONTENT_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
} from "@bb/shared-ui/option-display";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import type { modalRpcContract } from "./account.js";
import { errorMessage } from "./error-message.js";
import type {
  ModalImage,
  ModalLaunchOptions,
  SandboxPreset,
} from "./launch-options.js";
import { PROVIDER_ID } from "./provider-id.js";

function selectedName(
  value: JsonValue | null,
  key: "preset" | "image",
): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const selected = value[key];
  return typeof selected === "string" ? selected : undefined;
}

function machineInputs(
  preset: string | undefined,
  image: string | undefined,
): JsonValue {
  return {
    ...(preset === undefined ? {} : { preset }),
    ...(image === undefined ? {} : { image }),
  };
}

function ModalOptionItem({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className="flex items-start justify-between gap-3 whitespace-normal"
    >
      <span className="min-w-0 flex-1 whitespace-normal break-words text-xs">
        {label}
      </span>
      <Icon
        name="Check"
        className={cn(
          COARSE_POINTER_ICON_SIZE_CLASS,
          "shrink-0",
          selected ? "opacity-100" : "opacity-0",
        )}
      />
    </DropdownMenuItem>
  );
}

function ModalMachineInputsControl({
  value,
  onChange,
}: PluginMachineProviderInputsProps) {
  const rpc = useRpc<typeof modalRpcContract>();
  const selectedPresetName = selectedName(value, "preset");
  const selectedImageName = selectedName(value, "image");
  const [options, setOptions] = useState<ModalLaunchOptions | null>(null);
  useEffect(() => {
    onChange({
      status: "ready",
      value: machineInputs(selectedPresetName, selectedImageName),
    });
  }, [onChange, selectedImageName, selectedPresetName]);
  useEffect(() => {
    let active = true;
    void rpc.call("launch.options", {}).then(
      (result) => {
        if (active) setOptions(result);
      },
      () => {
        if (active) setOptions(null);
      },
    );
    return () => {
      active = false;
    };
  }, [rpc]);
  if (
    options === null ||
    (options.presets.length <= 1 && options.images.length <= 1)
  ) {
    return null;
  }
  const presetName =
    options.presets.find((entry) => entry.name === selectedPresetName)?.name ??
    options.presets[0]?.name;
  const imageName =
    options.images.find((entry) => entry.name === selectedImageName)?.name ??
    options.images[0]?.name;
  const labels = [
    ...(options.presets.length > 1 && presetName !== undefined
      ? [presetName]
      : []),
    ...(options.images.length > 1 && imageName !== undefined
      ? [imageName]
      : []),
  ];
  const choose = (preset: string | undefined, image: string | undefined) => {
    onChange({ status: "ready", value: machineInputs(preset, image) });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Modal sandbox options"
          data-promptbox-shrinkable-control=""
          className={cn(
            OPTION_BASE_CLASS_NAME,
            OPTION_INTERACTIVE_CLASS_NAME,
            OPTION_MUTED_CLASS_NAME,
          )}
        >
          <span className="min-w-0 truncate">{labels.join(" · ")}</span>
          <Icon
            name="ChevronDown"
            className={cn(
              "shrink-0 text-muted-foreground",
              COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
            )}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={cn(OPTION_MENU_CONTENT_CLASS_NAME, "max-w-72")}
      >
        {options.presets.length > 1 ? (
          <>
            <DropdownMenuLabel>Size preset</DropdownMenuLabel>
            {options.presets.map((preset) => (
              <ModalOptionItem
                key={preset.name}
                label={`${preset.name} · ${preset.cpu} CPU · ${preset.memoryMiB} MiB`}
                selected={preset.name === presetName}
                onSelect={() => choose(preset.name, imageName)}
              />
            ))}
          </>
        ) : null}
        {options.presets.length > 1 && options.images.length > 1 ? (
          <DropdownMenuSeparator />
        ) : null}
        {options.images.length > 1 ? (
          <>
            <DropdownMenuLabel>Image</DropdownMenuLabel>
            {options.images.map((image) => (
              <ModalOptionItem
                key={image.name}
                label={image.name}
                selected={image.name === imageName}
                onSelect={() => choose(presetName, image.name)}
              />
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function nextName(
  prefix: string,
  existing: readonly { name: string }[],
): string {
  const taken = new Set(
    existing.map((entry) => entry.name.trim().toLocaleLowerCase()),
  );
  for (let candidate = existing.length + 1; ; candidate += 1) {
    const name = `${prefix} ${candidate}`;
    if (!taken.has(name.toLocaleLowerCase())) return name;
  }
}

function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  return items.map((item, candidate) => (candidate === index ? value : item));
}

function LaunchOptionsSettings() {
  const rpc = useRpc<typeof modalRpcContract>();
  const [saved, setSaved] = useState<ModalLaunchOptions | null>(null);
  const [draft, setDraft] = useState<ModalLaunchOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedImage, setSelectedImage] = useState(0);
  useEffect(() => {
    let active = true;
    void rpc.call("launch.options", {}).then(
      (result) => {
        if (!active) return;
        setSaved(result);
        setDraft(result);
      },
      (failure) => {
        if (active) {
          setError(errorMessage(failure));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [rpc]);
  const save = async () => {
    if (draft === null) return;
    setSaving(true);
    setError(null);
    try {
      const result = await rpc.call("launch.options.set", draft);
      setSaved(result);
      setDraft(result);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  };
  if (draft === null) {
    return error === null ? (
      <p className="text-sm text-muted-foreground" role="status">
        Loading launch options…
      </p>
    ) : (
      <p className="text-sm text-destructive-text" role="alert">
        {error}
      </p>
    );
  }
  const updatePreset = (index: number, preset: SandboxPreset) => {
    setDraft({ ...draft, presets: replaceAt(draft.presets, index, preset) });
  };
  const updateImage = (index: number, image: ModalImage) => {
    setDraft({ ...draft, images: replaceAt(draft.images, index, image) });
  };
  return (
    <div className="w-full min-w-0 space-y-5">
      <section>
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground">
              Sandbox sizes
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              One preset becomes the default; several add a picker to the
              composer. With none, Modal uses 0.125 CPU and 128 MiB.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() =>
              setDraft({
                ...draft,
                presets: [
                  ...draft.presets,
                  {
                    name: nextName("Preset", draft.presets),
                    cpu: 1,
                    memoryMiB: 1024,
                  },
                ],
              })
            }
          >
            Add preset
          </Button>
        </div>
        {draft.presets.length > 0 ? (
          <div className="mt-3 space-y-1.5">
            <div className="grid grid-cols-[minmax(0,1fr)_5rem_7rem_2rem] items-center gap-2 text-xs text-muted-foreground">
              <span>Name</span>
              <span>CPU</span>
              <span>Memory (MiB)</span>
              <span />
            </div>
            {draft.presets.map((preset, index) => (
              <div
                key={index}
                className="grid grid-cols-[minmax(0,1fr)_5rem_7rem_2rem] items-center gap-2"
              >
                <Input
                  aria-label={`Preset ${index + 1} name`}
                  value={preset.name}
                  onChange={(event) =>
                    updatePreset(index, { ...preset, name: event.target.value })
                  }
                  placeholder="Large"
                />
                <Input
                  aria-label={`${preset.name || `Preset ${index + 1}`} CPU`}
                  type="number"
                  min="0.001"
                  step="0.125"
                  value={preset.cpu}
                  onChange={(event) =>
                    updatePreset(index, {
                      ...preset,
                      cpu: Number(event.target.value),
                    })
                  }
                />
                <Input
                  aria-label={`${preset.name || `Preset ${index + 1}`} memory MiB`}
                  type="number"
                  min="1"
                  step="1"
                  value={preset.memoryMiB}
                  onChange={(event) =>
                    updatePreset(index, {
                      ...preset,
                      memoryMiB: Number(event.target.value),
                    })
                  }
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${preset.name || `preset ${index + 1}`}`}
                  className="size-8 text-muted-foreground"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      presets: draft.presets.filter(
                        (_entry, candidate) => candidate !== index,
                      ),
                    })
                  }
                >
                  <Icon name="X" className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section>
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground">Images</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Default is bundled and always first; several add a picker to the
              composer.
            </p>
          </div>
        </div>
        {(() => {
          const index = Math.min(selectedImage, draft.images.length - 1);
          const image = draft.images[index];
          if (image === undefined) return null;
          const label = image.name || `Image ${index + 1}`;
          const bundled = index === 0;
          return (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label="Image"
                      className={cn(OPTION_BASE_CLASS_NAME, "gap-1.5 px-2")}
                    >
                      <span className="min-w-0 truncate">{label}</span>
                      <Icon
                        name="ChevronDown"
                        className={cn(
                          "shrink-0 text-muted-foreground",
                          COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
                        )}
                      />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className={OPTION_MENU_CONTENT_CLASS_NAME}
                  >
                    {draft.images.map((entry, entryIndex) => (
                      <ModalOptionItem
                        key={entryIndex}
                        label={entry.name || `Image ${entryIndex + 1}`}
                        selected={entryIndex === index}
                        onSelect={() => setSelectedImage(entryIndex)}
                      />
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-xs"
                      onSelect={() => {
                        setDraft({
                          ...draft,
                          images: [
                            ...draft.images,
                            {
                              name: nextName("Image", draft.images),
                              source: "dockerfile",
                              dockerfile: "FROM debian:bookworm-slim\n",
                            },
                          ],
                        });
                        setSelectedImage(draft.images.length);
                      }}
                    >
                      <Icon name="Plus" className="size-3.5" />
                      Add image
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {bundled ? (
                  <span className="ml-auto px-1 text-xs text-muted-foreground">
                    Dockerfile
                  </span>
                ) : (
                  <>
                    <div className="ml-auto flex items-center gap-1">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`${label} source`}
                            className={cn(
                              OPTION_BASE_CLASS_NAME,
                              OPTION_INTERACTIVE_CLASS_NAME,
                            )}
                          >
                            <span className="min-w-0 truncate">
                              {image.source === "dockerfile"
                                ? "Dockerfile"
                                : "Modal image ID"}
                            </span>
                            <Icon
                              name="ChevronDown"
                              className={cn(
                                "shrink-0 text-muted-foreground",
                                COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
                              )}
                            />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="start"
                          className={OPTION_MENU_CONTENT_CLASS_NAME}
                        >
                          <ModalOptionItem
                            label="Dockerfile"
                            selected={image.source === "dockerfile"}
                            onSelect={() =>
                              updateImage(index, {
                                name: image.name,
                                source: "dockerfile",
                                dockerfile: "FROM debian:bookworm-slim\n",
                              })
                            }
                          />
                          <ModalOptionItem
                            label="Modal image ID"
                            selected={image.source === "image-id"}
                            onSelect={() =>
                              updateImage(index, {
                                name: image.name,
                                source: "image-id",
                                imageId: "",
                              })
                            }
                          />
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive-text hover:text-destructive-text"
                        onClick={() => {
                          setDraft({
                            ...draft,
                            images: draft.images.filter(
                              (_entry, candidate) => candidate !== index,
                            ),
                          });
                          setSelectedImage(0);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </>
                )}
              </div>
              {bundled ? null : (
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Name</span>
                  <Input
                    aria-label={`Image ${index + 1} name`}
                    value={image.name}
                    placeholder={`Image ${index + 1}`}
                    onChange={(event) =>
                      updateImage(index, { ...image, name: event.target.value })
                    }
                  />
                </label>
              )}
              {image.source === "dockerfile" ? (
                <textarea
                  aria-label={`${label} Dockerfile`}
                  value={image.dockerfile}
                  onChange={(event) =>
                    updateImage(index, {
                      ...image,
                      dockerfile: event.target.value,
                    })
                  }
                  disabled={saving}
                  spellCheck={false}
                  rows={14}
                  className="w-full resize-y rounded-md border p-3 font-mono text-xs"
                />
              ) : (
                <Input
                  aria-label={`${label} Modal image ID`}
                  value={image.imageId}
                  onChange={(event) =>
                    updateImage(index, {
                      ...image,
                      imageId: event.target.value,
                    })
                  }
                  placeholder="im-…"
                />
              )}
            </div>
          );
        })()}
      </section>

      {JSON.stringify(draft) === JSON.stringify(saved) &&
      error === null ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
          {error === null ? (
            <span className="text-xs text-muted-foreground">
              Unsaved changes
            </span>
          ) : (
            <span role="alert" className="text-xs text-destructive-text">
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_machineProviderInputs({
    machineProviderId: PROVIDER_ID,
    component: ModalMachineInputsControl,
  });
  app.slots.settingsSection({
    id: "launch-options",
    component: LaunchOptionsSettings,
  });
});
