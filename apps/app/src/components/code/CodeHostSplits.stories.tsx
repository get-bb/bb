import { useMemo, useState, type ReactNode } from "react";
import { SplitPreviewProvider } from "@/lib/define-split";
import { GitDiffCard } from "@/components/git-diff/GitDiffCard";
import { parseGitDiffFiles } from "@/components/git-diff/git-diff-parsing";
import { FilePreview } from "@/components/secondary-panel/FilePreview";
import { PluginDiff } from "@/components/plugin/PluginDiff";
import { PluginSourceCode } from "@/components/plugin/PluginSourceCode";

export default { title: "performance/Code host splits" };

type ReviewState = "loading" | "error" | "live";

function Review({
  splitIds,
  children,
}: {
  splitIds: readonly string[];
  children: ReactNode;
}) {
  const [state, setState] = useState<ReviewState>("loading");
  const content =
    state === "live"
      ? children
      : splitIds.reduce<ReactNode>(
          (inner, id) => (
            <SplitPreviewProvider
              id={id}
              state={state}
              onRetry={() => setState("live")}
            >
              {inner}
            </SplitPreviewProvider>
          ),
          children,
        );
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap gap-3" aria-label="Split review controls">
        <button type="button" onClick={() => setState("loading")}>
          Hold loading
        </button>
        <button type="button" onClick={() => setState("error")}>
          Show failure
        </button>
        <button type="button" onClick={() => setState("live")}>
          Release to real UI
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        {splitIds.join(", ")}: {state}
      </p>
      {content}
    </div>
  );
}

const PATCH = `diff --git a/src/auth/session.ts b/src/auth/session.ts
index 1a2b3c4..5d6e7f8 100644
--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -7,9 +7,11 @@ export function createSession(user: User): Session {
 export function createSession(user: User): Session {
   const token = signToken(user.id);
-  const expiresAt = Date.now() + ONE_HOUR;
+  const expiresAt = Date.now() + SESSION_TTL_MS;
+  const refreshToken = signRefreshToken(user.id);
   return {
     token,
+    refreshToken,
     userId: user.id,
     expiresAt,
   };
 }
`;

const SOURCE = `import { signToken } from "./token";

const SESSION_TTL_MS = 60 * 60 * 1000;

export function createSession(user: User): Session {
  const token = signToken(user.id);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const refreshToken = signRefreshToken(user.id);
  return { token, refreshToken, userId: user.id, expiresAt };
}
`;

export function DiffCard() {
  const file = useMemo(() => parseGitDiffFiles(PATCH)[0], []);
  if (file === undefined) return null;
  return (
    <Review splitIds={["bb-diff"]}>
      <div className="w-full max-w-3xl">
        <GitDiffCard
          fileDiff={file}
          patchText={PATCH}
          presentation={{
            view: "unified",
            overflow: "scroll",
            showLineNumbers: true,
          }}
        />
      </div>
    </Review>
  );
}

export function SourceFilePreview() {
  return (
    <Review splitIds={["bb-source-code"]}>
      <div className="flex h-80 w-full max-w-3xl flex-col overflow-hidden border border-border bg-background px-4 pb-3 pt-1">
        <div
          className="min-h-0 flex-1 overflow-auto"
          data-file-preview-scroll-container
        >
          <FilePreview
            path="src/auth/session.ts"
            copyPath="src/auth/session.ts"
            state={{
              kind: "ready",
              lineRange: null,
              textPreviewKind: null,
              file: { name: "session.ts", contents: SOURCE },
            }}
          />
        </div>
      </div>
    </Review>
  );
}

export function PluginSdkSurfaces() {
  return (
    <Review splitIds={["bb-diff", "bb-source-code"]}>
      <div className="flex w-full max-w-3xl flex-col gap-3">
        <section className="min-w-0 overflow-hidden rounded-lg border border-border">
          <h3 className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
            experimental_Diff
          </h3>
          <PluginDiff patch={PATCH} path="src/auth/session.ts" />
        </section>
        <section className="min-w-0 overflow-hidden rounded-lg border border-border">
          <h3 className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
            experimental_SourceCode
          </h3>
          <PluginSourceCode content={SOURCE} path="src/auth/session.ts" />
        </section>
      </div>
    </Review>
  );
}
