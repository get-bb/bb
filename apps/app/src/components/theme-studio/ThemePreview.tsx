import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import type { ThemeStudioTokens } from "./studio-tokens";

interface ThemePreviewProps {
  tokens: ThemeStudioTokens;
}

export function ThemePreview({ tokens }: ThemePreviewProps) {
  void tokens;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border bg-background text-foreground">
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-40 shrink-0 flex-col gap-1 border-r bg-sidebar p-2 text-sidebar-foreground">
          <div className="flex items-center gap-2 rounded px-1 py-1">
            <span className="size-4 rounded-sm bg-primary" />
            <span className="truncate text-2xs font-medium">bb</span>
          </div>
          <div className="mt-1 rounded-sm bg-sidebar-accent px-1.5 py-1 text-2xs">
            Active thread
          </div>
          <div className="px-1.5 py-1 text-2xs text-muted-foreground">
            Another thread
          </div>
          <div className="px-1.5 py-1 text-2xs text-muted-foreground">
            Third thread
          </div>
          <div className="mt-auto rounded-sm border bg-card px-1.5 py-1 text-2xs text-muted-foreground">
            Archived
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b bg-surface-scrim px-3 py-2">
            <span className="truncate text-xs font-medium">
              Speed up conversation outlines
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-success" />
              <span className="text-2xs text-muted-foreground">running</span>
            </span>
          </header>

          <div className="flex-1 space-y-2 overflow-hidden p-3">
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-md bg-primary px-2 py-1 text-2xs text-primary-foreground">
                Summarize the diff
              </div>
            </div>

            <div className="max-w-[90%] space-y-1">
              <p className="text-2xs leading-relaxed">
                The projection now updates incrementally, so opening a long
                thread no longer walks the whole transcript.
              </p>
              <p className="text-2xs leading-relaxed text-muted-foreground">
                Secondary copy sits in the muted tier to show contrast.
              </p>
              <p className="text-2xs leading-relaxed text-subtle-foreground">
                Caption copy sits in the subtle tier.
              </p>
              <p className="text-2xs leading-relaxed text-readback-foreground">
                Readback copy for settled turns.
              </p>
            </div>

            <div className="rounded-md border bg-card">
              <div className="flex items-center gap-1.5 border-b px-2 py-1">
                <Icon name="File" className="size-3 text-file-accent" />
                <span className="truncate font-mono text-2xs text-file-accent">
                  src/lib/themes/index.ts
                </span>
                <span className="ml-auto text-2xs text-success">+12</span>
                <span className="text-2xs text-destructive">-4</span>
              </div>
              <div className="space-y-0.5 p-2 font-mono text-2xs">
                <div className="rounded-sm bg-surface-recessed px-1.5 py-0.5 text-muted-foreground">
                  <span className="text-subtle-foreground">42</span> const css =
                  resolve(c
                </div>
                <div className="rounded-sm bg-diff-added/15 px-1.5 py-0.5">
                  <span className="text-diff-added">43</span>{" "}
                  <span className="text-foreground">previewAppThemeCss</span>
                </div>
                <div className="rounded-sm bg-diff-removed/15 px-1.5 py-0.5">
                  <span className="text-diff-removed">44</span>{" "}
                  <span className="text-muted-foreground">applyThemeCss</span>
                </div>
                <div className="rounded-sm bg-surface-recessed px-1.5 py-0.5 text-muted-foreground">
                  <span className="text-subtle-foreground">45</span>{" "}
                  <span className="text-foreground">return</span>{" "}
                  <span className="text-attention">epoch</span>
                </div>
              </div>
            </div>

            <div className="rounded-md border bg-surface-recessed p-2 font-mono text-2xs">
              <div className="flex items-center gap-1.5 border-b pb-1 text-muted-foreground">
                <Icon name="Terminal" className="size-3" />
                <span>terminal</span>
                <span className="ml-auto size-2 rounded-full bg-attention" />
              </div>
              <p className="pt-1">
                <span className="text-success">$</span>{" "}
                <span className="text-foreground">pnpm test</span>
              </p>
              <p className="text-muted-foreground">
                <span className="text-success">✓</span> 227 passed
              </p>
              <p className="text-destructive">
                <span className="text-destructive">✗</span> 1 failed
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-surface-destructive px-2 py-0.5 text-2xs text-destructive-text">
                <span className="size-1.5 rounded-full bg-destructive" />
                failing
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs text-warning-text">
                <span className="size-1.5 rounded-full bg-attention" />
                attention
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs text-success">
                <span className="size-1.5 rounded-full bg-success" />
                passing
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs text-pr-merged">
                <Icon name="GitPullRequest" className="size-2.5" />
                merged
              </span>
            </div>

            <div className="flex items-center gap-2 rounded-md border bg-input/40 px-2 py-1.5">
              <span className="text-2xs text-subtle-foreground">
                Ask bb to do something…
              </span>
              <span className="ml-auto rounded-sm bg-primary px-1.5 py-0.5 text-2xs text-primary-foreground">
                Send
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ThemeSwatch({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("size-4 shrink-0 rounded-sm border", className)}
      style={{ background: value }}
    />
  );
}
