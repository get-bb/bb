import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  customThemeNameSchema,
  generatePalette,
  getConstraintProfile,
  MAX_CONSTRAINT_LEVEL,
  MIN_CONSTRAINT_LEVEL,
  type ConstraintLevel,
  type GeneratedPalette,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Input } from "@bb/shared-ui/input";
import { Icon } from "@bb/shared-ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { cn } from "@bb/shared-ui/lib/utils";
import { clearAppThemePreview, previewAppThemeCss } from "@/lib/themes";
import { ColorPicker } from "./ColorPicker";
import { ThemePreview } from "./ThemePreview";
import { applyTokens, extractTokens } from "./studio-css";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import {
  ADVANCED_TOKEN_NAMES,
  GUIDED_TOKEN_NAMES,
  STUDIO_TOKEN_LABELS,
  buildStudioThemeCss,
  type PreviewMode,
  type StudioTokenName,
  type ThemeStudioTokens,
} from "./studio-tokens";

const UNDO_LIMIT = 20;

const DEFAULT_TOKENS: Record<PreviewMode, ThemeStudioTokens> = {
  light: {
    canvas: "#f7f8fa",
    ink: "#1c2024",
    primary: "#3b6fd4",
    destructive: "#c0392b",
    warning: "#b5730d",
    success: "#2f7d44",
    prMerged: "#8250df",
    fileAccent: "#3b6fd4",
    diffAdded: "#2f7d44",
    diffRemoved: "#c0392b",
  },
  dark: {
    canvas: "#16181d",
    ink: "#e6e8ec",
    primary: "#7aa2f7",
    destructive: "#e06c5f",
    warning: "#e0af68",
    success: "#8fbf7f",
    prMerged: "#bb9af7",
    fileAccent: "#7aa2f7",
    diffAdded: "#8fbf7f",
    diffRemoved: "#e06c5f",
  },
};

function tokensFromPalette(palette: GeneratedPalette): {
  light: ThemeStudioTokens;
  dark: ThemeStudioTokens;
} {
  return {
    light: {
      canvas: palette.light.canvas,
      ink: palette.light.ink,
      primary: palette.light.primary,
      destructive: palette.light.destructive,
      warning: palette.light.warning,
      success: palette.light.success,
      prMerged: palette.light.prMerged,
      fileAccent: palette.light.fileAccent,
      diffAdded: palette.light.diffAdded,
      diffRemoved: palette.light.diffRemoved,
    },
    dark: {
      canvas: palette.dark.canvas,
      ink: palette.dark.ink,
      primary: palette.dark.primary,
      destructive: palette.dark.destructive,
      warning: palette.dark.warning,
      success: palette.dark.success,
      prMerged: palette.dark.prMerged,
      fileAccent: palette.dark.fileAccent,
      diffAdded: palette.dark.diffAdded,
      diffRemoved: palette.dark.diffRemoved,
    },
  };
}

export type StudioSourceKind = "custom" | "builtin" | "plugin";

export interface StudioSource {
  id: string;
  name: string;
  kind: StudioSourceKind;
}

type Loaded =
  | { kind: "new" }
  | { kind: "custom"; id: string; name: string; css: string }
  | { kind: "base"; id: string; name: string; css: string };

export interface ThemeStudioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: { name: string; css: string }) => Promise<void>;
  onDelete?: (name: string) => Promise<void>;
  onRename?: (from: string, to: string) => Promise<void>;
  loadThemeCss?: (source: StudioSource) => Promise<string | null>;
  sources?: readonly StudioSource[];
  activeThemeId?: string;
  initialName?: string;
  pending?: boolean;
  saveError?: string | null;
  deleteError?: string | null;
  renameError?: string | null;
}

function ConfirmDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open ? children : null}</DialogContent>
    </Dialog>
  );
}

export function ThemeStudioDialog(props: ThemeStudioDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <ThemeStudioDialogBody {...props} /> : null}
    </Dialog>
  );
}

function ThemeStudioDialogBody({
  onOpenChange,
  onSave,
  onDelete,
  onRename,
  loadThemeCss,
  sources = [],
  activeThemeId,
  initialName = "",
  pending = false,
  saveError = null,
  deleteError = null,
  renameError = null,
}: ThemeStudioDialogProps) {
  const [mode, setMode] = useState<PreviewMode>("dark");
  const [name, setName] = useState(initialName);
  const [tokens, setTokens] =
    useState<Record<PreviewMode, ThemeStudioTokens>>(DEFAULT_TOKENS);
  const [advanced, setAdvanced] = useState(false);
  const [seed, setSeed] = useState(1);
  const [constraintLevel, setConstraintLevel] = useState<ConstraintLevel>(3);
  const [loaded, setLoaded] = useState<Loaded>({ kind: "new" });
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState<
    "overwrite" | "delete" | "rename" | null
  >(null);
  const [saveAsNew, setSaveAsNew] = useState(false);
  const [renameTarget, setRenameTarget] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const constraintProfile = getConstraintProfile(constraintLevel);
  const undoRef = useRef<Record<PreviewMode, ThemeStudioTokens>[]>([]);

  const css = useMemo(
    () =>
      loaded.kind === "new"
        ? buildStudioThemeCss(tokens.light, tokens.dark)
        : applyTokens(loaded.css, tokens.light, tokens.dark),
    [loaded, tokens],
  );

  useEffect(() => {
    previewAppThemeCss(css);
  }, [css]);

  useEffect(
    () => () => {
      clearAppThemePreview();
    },
    [],
  );

  const pushUndo = useCallback(() => {
    const history = undoRef.current;
    history.push(tokens);
    if (history.length > UNDO_LIMIT) history.shift();
  }, [tokens]);

  const mutateTokens = useCallback(
    (target: PreviewMode, token: StudioTokenName, value: string) => {
      pushUndo();
      setTokens((previous) => ({
        ...previous,
        [target]: { ...previous[target], [token]: value },
      }));
    },
    [pushUndo],
  );

  const undo = useCallback(() => {
    setTokens((previous) => {
      const history = undoRef.current;
      const last = history.pop();
      return last ?? previous;
    });
  }, []);

  const randomize = useCallback(() => {
    pushUndo();
    const nextSeed = seed + 1;
    setSeed(nextSeed);
    setTokens(
      tokensFromPalette(
        generatePalette({
          accentHue: (nextSeed * 47) % 360,
          accentChroma: 0.1 + (nextSeed % 5) * 0.015,
          darkCanvasLightness: 0.18 + (nextSeed % 4) * 0.03,
          lightCanvasLightness: 0.97,
          seed: nextSeed,
          constraintLevel,
        }),
      ),
    );
  }, [constraintLevel, pushUndo, seed]);

  const reset = useCallback(() => {
    pushUndo();
    if (loaded.kind === "new") {
      setTokens(DEFAULT_TOKENS);
      return;
    }
    const light = extractTokens(loaded.css, "light");
    const dark = extractTokens(loaded.css, "dark");
    setTokens({
      light: { ...DEFAULT_TOKENS.light, ...light.tokens },
      dark: { ...DEFAULT_TOKENS.dark, ...dark.tokens },
    });
  }, [loaded, pushUndo]);

  const loadSource = useCallback(
    async (source: StudioSource) => {
      if (!loadThemeCss) return;
      setLoading(true);
      try {
        const sourceCss = await loadThemeCss(source);
        if (sourceCss === null) return;
        pushUndo();
        const light = extractTokens(sourceCss, "light");
        const dark = extractTokens(sourceCss, "dark");
        setTokens({
          light: { ...DEFAULT_TOKENS.light, ...light.tokens },
          dark: { ...DEFAULT_TOKENS.dark, ...dark.tokens },
        });
        setLoaded(
          source.kind === "custom"
            ? {
                kind: "custom",
                id: source.id,
                name: source.name,
                css: sourceCss,
              }
            : {
                kind: "base",
                id: source.id,
                name: source.name,
                css: sourceCss,
              },
        );
        setSaveAsNew(source.kind !== "custom");
        if (source.kind === "custom") setName(source.id);
      } finally {
        setLoading(false);
      }
    },
    [loadThemeCss, pushUndo],
  );

  const startNew = useCallback(() => {
    pushUndo();
    setLoaded({ kind: "new" });
    setTokens(DEFAULT_TOKENS);
    setSaveAsNew(false);
    setName("");
  }, [pushUndo]);

  const targetName =
    loaded.kind === "custom" && !saveAsNew ? loaded.id : name.trim();
  const isBase = loaded.kind === "base";

  const commitSave = useCallback(
    async (saveName: string) => {
      await onSave({ name: saveName, css });
      setConfirm(null);
    },
    [css, onSave],
  );

  const nameCheck =
    targetName.length === 0
      ? null
      : customThemeNameSchema.safeParse(targetName);

  const renameCheck =
    renameTarget.trim().length === 0
      ? null
      : customThemeNameSchema.safeParse(renameTarget.trim());

  const handleSave = useCallback(async () => {
    if (nameCheck && !nameCheck.success) return;
    if (loaded.kind === "custom" && !saveAsNew) {
      setConfirm("overwrite");
      return;
    }
    await commitSave(targetName);
  }, [commitSave, loaded, nameCheck, saveAsNew, targetName]);

  const visibleTokens = advanced
    ? [...GUIDED_TOKEN_NAMES, ...ADVANCED_TOKEN_NAMES]
    : GUIDED_TOKEN_NAMES;

  return (
    <DialogContent className="flex max-h-[100dvh] max-w-4xl flex-col gap-3 overflow-hidden p-4">
      <div className="flex shrink-0 flex-col gap-3">
        <DialogHeader>
          <DialogTitle>
            {loaded.kind === "new"
              ? "New theme"
              : loaded.kind === "custom"
                ? `Editing ${loaded.name}`
                : `Based on ${loaded.name}`}
          </DialogTitle>
          <DialogDescription>
            {loaded.kind === "new"
              ? "Build a palette that follows bb's token model. The preview updates as you go."
              : isBase
                ? "Built-in and plugin themes are read-only. Changes are saved as a new custom theme."
                : "Editing patches only the tokens you change and leaves the rest of the file intact."}
          </DialogDescription>
        </DialogHeader>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu open={pickerOpen} onOpenChange={setPickerOpen}>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  {loaded.kind === "new"
                    ? "New theme"
                    : loaded.kind === "custom"
                      ? loaded.name
                      : `${loaded.name} (base)`}
                  <Icon
                    name="ChevronDown"
                    className="size-3.5 text-muted-foreground"
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => startNew()}>
                  New theme
                </DropdownMenuItem>
                {sources.length > 0 ? <DropdownMenuSeparator /> : null}
                {sources.map((source) => (
                  <DropdownMenuItem
                    key={`${source.kind}:${source.id}`}
                    onSelect={() => void loadSource(source)}
                  >
                    {source.name}
                    {source.kind === "custom" ? null : (
                      <span className="text-muted-foreground">
                        {source.kind === "builtin" ? "built-in" : "plugin"}
                      </span>
                    )}
                    {activeThemeId === source.id ? (
                      <Icon name="Check" className="ml-auto size-3.5" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {loading ? (
              <span className="text-2xs text-muted-foreground">Loading…</span>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={undo}
            >
              Undo
            </Button>
            <Button size="sm" variant="ghost" onClick={reset}>
              Reset
            </Button>
            {loaded.kind === "custom" && onDelete ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive-text"
                onClick={() => setConfirm("delete")}
              >
                Delete
              </Button>
            ) : null}
            {loaded.kind === "custom" && onRename ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRenameTarget(`${loaded.id}-copy`);
                  setConfirm("rename");
                }}
              >
                Rename
              </Button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={randomize}>
              Randomize
            </Button>
            <div className="flex rounded-md border p-0.5">
              {(["light", "dark"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={cn(
                    "rounded-sm px-2 py-1 text-2xs capitalize",
                    mode === value ? "bg-accent" : "text-muted-foreground",
                  )}
                  onClick={() => setMode(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            <div
              className="flex min-w-0 flex-1 items-center gap-2"
              title={constraintProfile.description}
            >
              <label
                htmlFor="theme-studio-constraint"
                className="shrink-0 text-2xs text-muted-foreground"
              >
                Rule strictness
              </label>
              <input
                id="theme-studio-constraint"
                type="range"
                min={MIN_CONSTRAINT_LEVEL}
                max={MAX_CONSTRAINT_LEVEL}
                step={1}
                value={constraintLevel}
                className="min-w-0 flex-1"
                onChange={(event) =>
                  setConstraintLevel(
                    Number(event.target.value) as ConstraintLevel,
                  )
                }
              />
              <span className="shrink-0 text-2xs">
                {constraintProfile.label}
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-background">
            <div className={mode === "dark" ? "dark h-full" : "light h-full"}>
              <ThemePreview tokens={tokens[mode]} />
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          <div className="space-y-1">
            <label
              htmlFor="theme-studio-name"
              className={cn(
                "inline-block rounded-sm px-1.5 py-0.5 text-2xs font-medium",
                loaded.kind === "custom" && !saveAsNew
                  ? "bg-muted text-muted-foreground"
                  : "bg-primary text-primary-foreground",
              )}
            >
              {loaded.kind === "custom" && !saveAsNew
                ? "Theme name (read-only)"
                : "Save as"}
            </label>
            <Input
              id="theme-studio-name"
              value={loaded.kind === "custom" && !saveAsNew ? loaded.id : name}
              placeholder="my-theme"
              readOnly={loaded.kind === "custom" && !saveAsNew}
              onChange={(event) => setName(event.target.value)}
            />
            {saveError || deleteError ? (
              <p className="text-2xs text-destructive-text">
                {saveError ?? deleteError}
              </p>
            ) : loaded.kind === "custom" && !saveAsNew ? (
              <p className="text-2xs text-muted-foreground">
                Saving replaces this theme in place.
              </p>
            ) : nameCheck && !nameCheck.success ? (
              <p className="text-2xs text-destructive-text">
                {nameCheck.error.issues[0]?.message ?? "Invalid theme name."}
              </p>
            ) : (
              <p className="text-2xs text-muted-foreground">
                Use letters, digits,{" "}
                <code className="font-mono">.&nbsp;_&nbsp;-</code>.
              </p>
            )}
            {loaded.kind === "custom" ? (
              <label className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={saveAsNew}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setSaveAsNew(next);
                    if (next) setName(`${loaded.id}-copy`);
                  }}
                />
                Save as a new theme instead of overwriting
              </label>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {visibleTokens.map((token) => (
              <ColorPicker
                key={token}
                label={STUDIO_TOKEN_LABELS[token]}
                value={tokens[mode][token]}
                onChange={(value) => mutateTokens(mode, token, value)}
              />
            ))}

            <Button
              size="sm"
              variant="ghost"
              className="justify-start"
              onClick={() => setAdvanced((previous) => !previous)}
            >
              {advanced ? "Hide" : "Show"} advanced tokens
            </Button>
          </div>

          <DialogFooter className="shrink-0 py-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={
                pending ||
                targetName.length === 0 ||
                (nameCheck !== null && !nameCheck.success)
              }
              onClick={() => void handleSave()}
            >
              {pending
                ? "Saving…"
                : loaded.kind === "custom" && !saveAsNew
                  ? "Overwrite and apply"
                  : isBase
                    ? "Save as new"
                    : "Save and apply"}
            </Button>
          </DialogFooter>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "overwrite"}
        onOpenChange={(next) => setConfirm(next ? "overwrite" : null)}
      >
        <DialogHeader>
          <DialogTitle>
            Replace{" "}
            <code className="font-mono">
              {loaded.kind === "custom" ? loaded.id : targetName}
            </code>{" "}
            on disk?
          </DialogTitle>
          <DialogDescription>
            Its existing <code className="font-mono">theme.css</code> is
            rewritten in place and the change applies immediately. Only the
            tokens you changed are touched. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button onClick={() => void commitSave(targetName)}>Overwrite</Button>
        </DialogFooter>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === "rename"}
        onOpenChange={(next) => setConfirm(next ? "rename" : null)}
      >
        <DialogHeader>
          <DialogTitle>
            Rename{" "}
            <code className="font-mono">
              {loaded.kind === "custom" ? loaded.id : ""}
            </code>
          </DialogTitle>
          <DialogDescription>
            The theme folder is moved, so files beside theme.css travel with it
            and nothing is rewritten. The folder name is the theme id.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label
            htmlFor="theme-studio-rename"
            className="text-2xs text-muted-foreground"
          >
            New name
          </label>
          <Input
            id="theme-studio-rename"
            value={renameTarget}
            placeholder="my-theme"
            onChange={(event) => setRenameTarget(event.target.value)}
          />
          {renameError ? (
            <p className="text-2xs text-destructive-text">{renameError}</p>
          ) : renameCheck && !renameCheck.success ? (
            <p className="text-2xs text-destructive-text">
              {renameCheck.error.issues[0]?.message ?? "Invalid theme name."}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            disabled={
              renameTarget.trim().length === 0 ||
              (renameCheck !== null && !renameCheck.success)
            }
            onClick={() => {
              if (!onRename || loaded.kind !== "custom") return;
              void onRename(loaded.id, renameTarget.trim()).then(() => {
                setConfirm(null);
                startNew();
                onOpenChange(false);
              });
            }}
          >
            Rename
          </Button>
        </DialogFooter>
      </ConfirmDialog>

      <ConfirmDeleteDialog
        open={confirm === "delete"}
        onOpenChange={(next) => setConfirm(next ? "delete" : null)}
      >
        <ConfirmDeleteDialogContent
          title={`Delete ${loaded.kind === "custom" ? loaded.id : "theme"}?`}
          confirmLabel="Delete theme"
          pending={false}
          description={
            <span className="space-y-1">
              <span className="block">
                Its folder and <code className="font-mono">theme.css</code> are
                removed. This cannot be undone.
              </span>
              {deleteError ? (
                <span className="block text-destructive-text">
                  {deleteError}
                </span>
              ) : null}
            </span>
          }
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            if (!onDelete || loaded.kind !== "custom") return;
            void onDelete(loaded.id).then(() => {
              setConfirm(null);
              startNew();
              onOpenChange(false);
            });
          }}
        />
      </ConfirmDeleteDialog>
    </DialogContent>
  );
}
