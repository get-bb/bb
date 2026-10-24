import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  type PluginPendingInteractionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatHomePathForDisplay } from "@/lib/utils";
import { useQuestionFormHost } from "@/components/ui/question-form-host";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import Loading03Icon from "@hugeicons/core-free-icons/Loading03Icon";
import ViewIcon from "@hugeicons/core-free-icons/ViewIcon";
import ViewOffSlashIcon from "@hugeicons/core-free-icons/ViewOffSlashIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  SECRET_REQUEST_RENDERER_ID,
  secretRequestPayloadSchema,
  secretRequestResponseSchema,
} from "./src/secret-request.js";
import { reconcileDotenv } from "./src/dotenv.js";
import {
  displayPath,
  fitStem,
  graphemeCount,
  graphemes,
  rightmostSpan,
  splitDestination,
} from "./src/destination-label.js";

function SecretDestination({
  path,
  className,
}: {
  path: string;
  className: string | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const [fittedStem, setFittedStem] = useState<string | null>(null);
  const [folderMinimum, setFolderMinimum] = useState<number | null>(null);
  const rowRef = useRef<HTMLButtonElement>(null);
  const stemRef = useRef<HTMLSpanElement>(null);
  const folderRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const destination = splitDestination(path);
  const folder =
    destination.folder === null
      ? null
      : formatHomePathForDisplay(destination.folder);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const stem = stemRef.current;
    const measure = measureRef.current;
    if (expanded || !row || !stem || !measure) return;
    const fit = () => {
      const rowWidth = row.getBoundingClientRect().width;
      if (rowWidth === 0) {
        setFittedStem(null);
        return;
      }
      const textWidth = (text: string, weight: string) => {
        measure.style.fontWeight = weight;
        measure.textContent = text;
        return measure.getBoundingClientRect().width;
      };
      const rowStyle = getComputedStyle(row);
      let used =
        parseFloat(rowStyle.paddingLeft) +
        parseFloat(rowStyle.paddingRight) +
        parseFloat(rowStyle.borderLeftWidth) +
        parseFloat(rowStyle.borderRightWidth);
      let tailWidth: number | null = null;
      for (const child of Array.from(row.children)) {
        if (child === stem || child === measure) continue;
        const style = getComputedStyle(child);
        const margins =
          parseFloat(style.marginLeft) + parseFloat(style.marginRight);
        if (child === folderRef.current && folder !== null) {
          const text = child.firstElementChild?.firstChild;
          if (graphemeCount(folder) > 3 && text instanceof Text) {
            const range = document.createRange();
            let offset = 0;
            const boxes = graphemes(text.data).map((grapheme) => {
              range.setStart(text, offset);
              offset += grapheme.length;
              range.setEnd(text, offset);
              return range.getBoundingClientRect();
            });
            const tail = rightmostSpan(boxes, 2);
            if (tail !== null) {
              tailWidth = Math.ceil(textWidth("…", style.fontWeight) + tail);
            }
          }
          used += margins + (tailWidth ?? child.getBoundingClientRect().width);
        } else {
          used += margins + child.getBoundingClientRect().width;
        }
      }
      const available = rowWidth - used;
      if (!Number.isFinite(available)) {
        setFittedStem(null);
        return;
      }
      setFolderMinimum(tailWidth);
      const stemWeight = getComputedStyle(stem).fontWeight;
      setFittedStem(
        fitStem(destination.stem, available, (text) =>
          textWidth(text, stemWeight),
        ),
      );
    };
    fit();
    void document.fonts?.ready.then(fit);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    return () => observer.disconnect();
  }, [destination.stem, expanded, folder]);

  return (
    <button
      ref={rowRef}
      type="button"
      aria-expanded={expanded}
      aria-label={`Saves to ${path}`}
      title={path}
      onClick={() => setExpanded((value) => !value)}
      className={cn(
        "relative flex w-full min-w-0 items-center rounded text-left text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
    >
      <HugeiconsIcon
        icon={File01Icon}
        className="mr-1.5 size-3.5 shrink-0"
        aria-hidden="true"
      />
      <span className="mr-1.5 shrink-0">Saves to</span>
      {expanded ? (
        <span className="max-h-12 min-w-0 overflow-y-auto break-all text-foreground">
          {displayPath(path)}
        </span>
      ) : (
        <>
          <span
            ref={stemRef}
            className="shrink-0 whitespace-pre font-medium text-foreground"
          >
            {fittedStem ?? destination.stem}
          </span>
          {destination.extension ? (
            <span className="shrink-0 whitespace-pre font-medium text-foreground">
              {destination.extension}
            </span>
          ) : null}
          {folder === null ? null : (
            <>
              <span className="mx-1.5 shrink-0">in</span>
              <span
                ref={folderRef}
                style={
                  folderMinimum === null
                    ? undefined
                    : { minWidth: folderMinimum }
                }
                className={cn(
                  "flex max-w-max grow basis-0 overflow-hidden",
                  graphemeCount(folder) > 3 ? "min-w-[3ch]" : "min-w-max",
                )}
              >
                <span dir="rtl" className="block w-min max-w-full truncate">
                  {displayPath(folder)}
                </span>
              </span>
            </>
          )}
          <span
            ref={measureRef}
            aria-hidden="true"
            className="pointer-events-none invisible absolute left-0 top-0 whitespace-pre"
          />
        </>
      )}
    </button>
  );
}

function SecretRequestInteraction({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const parsed = useMemo(
    () => secretRequestPayloadSchema.safeParse(interaction.payload),
    [interaction.payload],
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [pendingAction, setPendingAction] = useState<
    "submit" | "cancel" | null
  >(null);
  const busy = pendingAction !== null;
  const [formError, setFormError] = useState<string | null>(null);
  const { density, closeInline } = useQuestionFormHost();
  const compact = density === "compact";

  if (!parsed.success) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          This secret request is invalid.
        </p>
        <Button
          variant="outline"
          onClick={() => void cancel().catch(() => undefined)}
        >
          Cancel
        </Button>
      </div>
    );
  }
  const payload = parsed.data;
  const submitValues = async () => {
    const validated = secretRequestResponseSchema.safeParse({ values });
    if (!validated.success) {
      setFormError(
        "Every secret must be a non-empty single-line value no larger than 16 KiB.",
      );
      return;
    }
    try {
      reconcileDotenv("", validated.data.values);
    } catch {
      setFormError(
        "One value cannot be represented safely in a dotenv assignment.",
      );
      return;
    }
    setFormError(null);
    setPendingAction("submit");
    try {
      await submit({ values });
    } catch {
      setPendingAction(null);
    }
  };
  const cancelRequest = async () => {
    if (closeInline) {
      closeInline();
      return;
    }
    setPendingAction("cancel");
    try {
      await cancel();
    } catch {
      setPendingAction(null);
    }
  };

  const textInset = compact ? "px-2.5" : undefined;

  return (
    <form
      className="flex min-w-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void submitValues();
      }}
    >
      {payload.purpose ? (
        <p
          title={compact ? payload.purpose : undefined}
          className={cn(
            "text-pretty text-xs text-foreground",
            compact && "line-clamp-2",
            textInset,
          )}
        >
          {payload.purpose}
        </p>
      ) : null}
      <SecretDestination
        path={payload.destination.path}
        className={cn(
          textInset,
          payload.purpose && (compact ? "mt-2" : "mt-3"),
        )}
      />

      <div
        className={cn(
          compact
            ? "space-y-3 max-md:pointer-coarse:space-y-2.5"
            : "space-y-3.5",
          compact ? "mt-4 max-md:pointer-coarse:mt-3" : "mt-5",
        )}
      >
        {payload.fields.map((field) => {
          const inputId = `secret-${interaction.id}-${field.name}`;
          const isRevealed = revealed[field.name] ?? false;
          return (
            <div key={field.name} className="min-w-0 space-y-1.5">
              <div
                className={
                  compact
                    ? "flex min-w-0 flex-wrap items-baseline gap-x-2 px-2.5"
                    : "space-y-0.5"
                }
              >
                <Label
                  htmlFor={inputId}
                  className="min-w-0 break-all text-xs font-medium text-foreground"
                  translate="no"
                >
                  {field.name}
                </Label>
                {field.description ? (
                  <p
                    title={compact ? field.description : undefined}
                    className={cn(
                      "text-xs text-muted-foreground",
                      compact && "min-w-0 grow basis-24 truncate",
                    )}
                  >
                    {field.description}
                  </p>
                ) : null}
              </div>
              <div className="relative">
                <Input
                  id={inputId}
                  name={field.name}
                  type={isRevealed ? "text" : "password"}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  value={values[field.name] ?? ""}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field.name]: event.target.value,
                    }))
                  }
                  disabled={busy}
                  className={cn(
                    "bg-card pr-10 text-xs",
                    compact && "max-md:pointer-coarse:h-9",
                  )}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="absolute right-1 top-1/2 size-7 -translate-y-1/2 text-muted-foreground"
                  aria-label={`${isRevealed ? "Hide" : "Show"} ${field.name}`}
                  aria-pressed={isRevealed}
                  onClick={() =>
                    setRevealed((current) => ({
                      ...current,
                      [field.name]: !current[field.name],
                    }))
                  }
                  disabled={busy}
                >
                  <HugeiconsIcon
                    icon={isRevealed ? ViewOffSlashIcon : ViewIcon}
                    className="size-4"
                    aria-hidden="true"
                  />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {formError ? (
        <p
          className="mt-3 rounded-md border border-surface-destructive-border bg-surface-destructive px-2 py-1 text-xs text-destructive-text"
          aria-live="polite"
        >
          {formError}
        </p>
      ) : null}

      <div
        className={cn(
          "flex items-center justify-between gap-2",
          compact
            ? "sticky -bottom-1 z-10 -mb-1 mt-3 bg-popover pb-1 max-md:pointer-coarse:mt-2.5"
            : "sticky -bottom-3 z-10 -mb-3 mt-4 border-t border-border/70 bg-surface-recessed-solid pb-3 pt-3",
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void cancelRequest()}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {pendingAction === "submit" ? (
            <HugeiconsIcon
              icon={Loading03Icon}
              className="size-3 animate-spin"
              aria-hidden="true"
            />
          ) : null}
          Add secrets
        </Button>
      </div>
    </form>
  );
}

export default definePluginApp((app) => {
  app.slots.pendingInteraction({
    id: SECRET_REQUEST_RENDERER_ID,
    component: SecretRequestInteraction,
  });
});
