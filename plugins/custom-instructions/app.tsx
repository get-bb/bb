import { useEffect, useRef, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { customInstructionsRpcContract } from "./server.js";
import { Textarea } from "@bb/shared-ui/textarea";

export const AUTOSAVE_DELAY_MS = 500;

interface InstructionsResponse {
  instructions: string;
  maxLength: number;
}

function parseInstructionsResponse(value: unknown): InstructionsResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Custom instructions returned an invalid response.");
  }
  const response = value as Record<string, unknown>;
  if (
    typeof response.instructions !== "string" ||
    typeof response.maxLength !== "number"
  ) {
    throw new Error("Custom instructions returned an invalid response.");
  }
  return {
    instructions: response.instructions,
    maxLength: response.maxLength,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function CustomInstructionsSettings() {
  const rpc = useRpc<typeof customInstructionsRpcContract>();
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState("");
  const [maxLength, setMaxLength] = useState(4096);
  const [isLoading, setIsLoading] = useState(true);
  const [saveState, setSaveState] = useState<
    "idle" | "pending" | "saving" | "saved" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void rpc
      .call("getInstructions")
      .then(parseInstructionsResponse)
      .then((response) => {
        if (!active) return;
        setDraft(response.instructions);
        setSaved(response.instructions);
        setMaxLength(response.maxLength);
        setSaveState("saved");
      })
      .catch((loadError: unknown) => {
        if (active) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [rpc]);

  useEffect(() => {
    if (isLoading || draft === saved) return;
    let active = true;
    const instructions = draft;
    const timeout = window.setTimeout(() => {
      setSaveState("saving");
      const save = saveQueue.current
        .catch(() => undefined)
        .then(async () => {
          const response = parseInstructionsResponse(
            await rpc.call("saveInstructions", { instructions }),
          );
          if (!active) return;
          setSaved(response.instructions);
          setMaxLength(response.maxLength);
          setSaveState("saved");
        })
        .catch((saveError: unknown) => {
          if (!active) return;
          setError(errorMessage(saveError));
          setSaveState("error");
        });
      saveQueue.current = save;
    }, AUTOSAVE_DELAY_MS);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [draft, isLoading, rpc, saved]);

  return (
    <div className="space-y-3">
      <Textarea
        aria-label="Custom instructions"
        value={draft}
        maxLength={maxLength}
        disabled={isLoading}
        placeholder="Add your custom instructions…"
        className="min-h-40 resize-y bg-background text-sm"
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
          setSaveState("pending");
        }}
      />
      <div className="flex min-h-8 items-center justify-between gap-4">
        <span className="text-xs text-muted-foreground">
          {draft.length.toLocaleString()} / {maxLength.toLocaleString()}
        </span>
        {error !== null ? (
          <span className="text-xs text-destructive" role="alert">
            {error}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground" role="status">
            {isLoading
              ? "Loading…"
              : saveState === "pending" || saveState === "saving"
                ? "Saving…"
                : "Saved"}
          </span>
        )}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "custom-instructions",
    description:
      "Give agents extra instructions and context for tasks on this bb host.",
    component: CustomInstructionsSettings,
  });
});
