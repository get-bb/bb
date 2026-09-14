import { useState } from "react";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { Input } from "@bb/shared-ui/input";
import { Label } from "@bb/shared-ui/label";
import { Textarea } from "@bb/shared-ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import type { AppProfileInput, ProfileWithStatus } from "../contract.js";

export interface AppProfilesProps {
  profiles: readonly ProfileWithStatus[];
  loading: boolean;
  error: string | null;
  saving: boolean;
  pendingAction: string | null;
  onSave: (input: AppProfileInput) => Promise<void>;
  onDelete: (profile: ProfileWithStatus) => Promise<void>;
  onStart: (profile: ProfileWithStatus) => Promise<void>;
  onStop: (profile: ProfileWithStatus) => Promise<void>;
  onRestart: (profile: ProfileWithStatus) => Promise<void>;
  onRetry: () => void;
}

interface EditorState {
  mode: "create" | "edit";
  id?: string;
  name: string;
  exePath: string;
  args: string;
  cwd: string;
  processName: string;
}

const EMPTY_EDITOR: EditorState = {
  mode: "create",
  name: "",
  exePath: "",
  args: "",
  cwd: "",
  processName: "",
};

type Confirmation =
  | { kind: "stop"; profile: ProfileWithStatus }
  | { kind: "restart"; profile: ProfileWithStatus }
  | { kind: "delete"; profile: ProfileWithStatus };

function parseArgsText(text: string): { args: string[]; error: string | null } {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { args: [], error: null };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === "string")
    ) {
      return { args: parsed, error: null };
    }
  } catch {}
  return {
    args: [],
    error:
      'Arguments must be a JSON array of strings, e.g. ["--verbose", "--port", "8080"]',
  };
}

function AppProfileEditor({
  editor,
  saving,
  onCancel,
  onSubmit,
}: {
  editor: EditorState;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (input: AppProfileInput) => void;
}) {
  const [name, setName] = useState(editor.name);
  const [exePath, setExePath] = useState(editor.exePath);
  const [argsText, setArgsText] = useState(editor.args);
  const [cwd, setCwd] = useState(editor.cwd);
  const [processName, setProcessName] = useState(editor.processName);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = () => {
    const { args, error } = parseArgsText(argsText);
    if (error !== null) {
      setFormError(error);
      return;
    }
    setFormError(null);
    onSubmit({
      ...(editor.mode === "edit" && editor.id !== undefined
        ? { id: editor.id }
        : {}),
      name,
      exePath,
      args,
      ...(cwd.trim().length > 0 ? { cwd: cwd.trim() } : {}),
      ...(processName.trim().length > 0
        ? { processName: processName.trim() }
        : {}),
    });
  };

  return (
    <div
      className="space-y-3 rounded-md border border-border bg-background/60 p-3"
      data-testid="pc-profile-editor"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pc-profile-name" className="text-xs">
            Name
          </Label>
          <Input
            id="pc-profile-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Render server"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pc-profile-process-name" className="text-xs">
            Process name (optional)
          </Label>
          <Input
            id="pc-profile-process-name"
            value={processName}
            onChange={(event) => setProcessName(event.target.value)}
            placeholder="defaults to the exe file name"
            className="h-8 text-xs"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pc-profile-exe" className="text-xs">
          Executable (absolute path)
        </Label>
        <Input
          id="pc-profile-exe"
          value={exePath}
          onChange={(event) => setExePath(event.target.value)}
          placeholder="C:\\Program Files\\App\\app.exe"
          className="h-8 font-mono text-xs"
          spellCheck={false}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pc-profile-args" className="text-xs">
            Arguments (JSON array)
          </Label>
          <Textarea
            id="pc-profile-args"
            value={argsText}
            onChange={(event) => setArgsText(event.target.value)}
            placeholder='["--port", "8080"]'
            className="min-h-16 font-mono text-xs"
            spellCheck={false}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pc-profile-cwd" className="text-xs">
            Working directory (optional)
          </Label>
          <Textarea
            id="pc-profile-cwd"
            value={cwd}
            onChange={(event) => setCwd(event.target.value)}
            placeholder="defaults to the exe folder"
            className="min-h-16 font-mono text-xs"
            spellCheck={false}
          />
        </div>
      </div>
      {formError !== null ? (
        <p
          className="text-xs text-destructive"
          data-testid="pc-profile-form-error"
        >
          {formError}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 text-xs"
          disabled={saving}
          onClick={handleSubmit}
          data-testid="pc-profile-save"
        >
          {saving
            ? "Saving…"
            : editor.mode === "edit"
              ? "Save changes"
              : "Add profile"}
        </Button>
      </div>
    </div>
  );
}

export function AppProfiles({
  profiles,
  loading,
  error,
  saving,
  pendingAction,
  onSave,
  onDelete,
  onStart,
  onStop,
  onRestart,
  onRetry,
}: AppProfilesProps) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const busyFor = (profile: ProfileWithStatus): boolean =>
    pendingAction === `${profile.id}:start` ||
    pendingAction === `${profile.id}:stop` ||
    pendingAction === `${profile.id}:restart` ||
    pendingAction === `${profile.id}:delete`;

  const runConfirmation = async () => {
    if (confirmation === null) return;
    const current = confirmation;
    setConfirmation(null);
    if (current.kind === "stop") await onStop(current.profile);
    else if (current.kind === "restart") await onRestart(current.profile);
    else await onDelete(current.profile);
  };

  const confirmationCopy: Record<
    Confirmation["kind"],
    { title: string; body: string; action: string }
  > = {
    stop: {
      title: "Stop program?",
      body: "Its processes on this PC will be terminated. Unsaved work in the program may be lost.",
      action: "Stop",
    },
    restart: {
      title: "Restart program?",
      body: "Its processes will be stopped, then the program starts again. Unsaved work may be lost.",
      action: "Restart",
    },
    delete: {
      title: "Delete profile?",
      body: "The saved profile is removed. Running processes are left as they are.",
      action: "Delete",
    },
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Programs</h3>
        {editor === null ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-xs"
            onClick={() => setEditor(EMPTY_EDITOR)}
            data-testid="pc-profile-add"
          >
            Add program
          </Button>
        ) : null}
      </div>
      {editor !== null ? (
        <AppProfileEditor
          key={editor.mode === "edit" ? editor.id : "create"}
          editor={editor}
          saving={saving}
          onCancel={() => setEditor(null)}
          onSubmit={(input) => {
            void onSave(input).then(() => setEditor(null));
          }}
        />
      ) : null}
      {error !== null ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5">
          <p
            className="min-w-0 truncate text-xs text-destructive"
            title={error}
          >
            {error}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs"
            onClick={onRetry}
          >
            Retry
          </Button>
        </div>
      ) : null}
      <div
        className="min-h-0 flex-1 space-y-2 overflow-y-auto"
        data-testid="pc-profiles-list"
      >
        {loading && profiles.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            Loading profiles…
          </p>
        ) : profiles.length === 0 && error === null ? (
          <EmptyState message="No program profiles yet. Add a program you want to start, stop, and restart from bb." />
        ) : (
          profiles.map((profile) => (
            <div
              key={profile.id}
              className="space-y-2 rounded-md border border-border p-2.5"
              data-testid={`pc-profile-${profile.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {profile.name}
                    </span>
                    {profile.status.running ? (
                      <Badge
                        variant="outline"
                        className="shrink-0 font-normal text-emerald-500"
                        data-testid={`pc-profile-status-${profile.id}`}
                      >
                        running · {profile.status.pids.join(", ")}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="shrink-0 font-normal text-muted-foreground"
                        data-testid={`pc-profile-status-${profile.id}`}
                      >
                        stopped
                      </Badge>
                    )}
                  </div>
                  <p
                    className="truncate font-mono text-[11px] text-muted-foreground"
                    title={`${profile.exePath}${
                      profile.args.length > 0
                        ? ` ${profile.args.join(" ")}`
                        : ""
                    }`}
                  >
                    {profile.exePath}
                    {profile.args.length > 0
                      ? ` ${profile.args.join(" ")}`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={busyFor(profile) || profile.status.running}
                  onClick={() => void onStart(profile)}
                  data-testid={`pc-profile-start-${profile.id}`}
                >
                  Start
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={busyFor(profile) || !profile.status.running}
                  onClick={() => setConfirmation({ kind: "stop", profile })}
                  data-testid={`pc-profile-stop-${profile.id}`}
                >
                  Stop
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={busyFor(profile)}
                  onClick={() => setConfirmation({ kind: "restart", profile })}
                  data-testid={`pc-profile-restart-${profile.id}`}
                >
                  Restart
                </Button>
                <span className="flex-1" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={busyFor(profile)}
                  onClick={() =>
                    setEditor({
                      mode: "edit",
                      id: profile.id,
                      name: profile.name,
                      exePath: profile.exePath,
                      args:
                        profile.args.length > 0
                          ? JSON.stringify(profile.args)
                          : "",
                      cwd: profile.cwd,
                      processName: profile.processName ?? "",
                    })
                  }
                  data-testid={`pc-profile-edit-${profile.id}`}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                  disabled={busyFor(profile)}
                  onClick={() => setConfirmation({ kind: "delete", profile })}
                  data-testid={`pc-profile-delete-${profile.id}`}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      <Dialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <DialogContent data-testid="pc-confirm-dialog" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirmation !== null
                ? `${confirmationCopy[confirmation.kind].title.replace("program", confirmation.profile.name)}`
                : ""}
            </DialogTitle>
            <DialogDescription>
              {confirmation !== null
                ? confirmationCopy[confirmation.kind].body
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              data-testid="pc-confirm-cancel"
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void runConfirmation()}
              data-testid="pc-confirm-accept"
            >
              {confirmation !== null
                ? confirmationCopy[confirmation.kind].action
                : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
