import { useEffect, useMemo, useState } from "react";
import type { BuiltInThemeId } from "@bb/domain";
import { builtInThemes } from "@bb/domain";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { resolveAppThemeCss } from "@/lib/themes";
import {
  GitDiffCard,
  GIT_DIFF_VIEW_BASE_OPTIONS,
} from "@/components/git-diff/GitDiffCard";
import { parseGitDiffFiles } from "@/components/git-diff/git-diff-parsing";

/**
 * Manual preview for the diff panel's theme bridge (Layer 1). The diff renderer
 * (`@pierre/diffs`) draws its surface, gutter, line numbers, and +/- row tints
 * from `--diffs-*` CSS variables; `theme.css` now feeds those from the app
 * tokens (`--background`, `--foreground`, `--diff-added`, `--diff-removed`).
 *
 * Pick a palette below and the diff retints to match — in both light and dark
 * at once — because each palette overrides those app tokens and the bridge
 * re-resolves through them. (Syntax-highlighting token colors are still the
 * library's fixed light/dark Shiki palette — that's Layer 2, untouched here.)
 */
export default {
  title: "Git Diff / Themed Panel",
};

// A small, realistic patch: one mixed modify (adds + a deletion) and one added
// file (all-green), enough to show the surface, gutter, line numbers, and both
// row tints following the palette.
const SAMPLE_DIFF = `diff --git a/src/auth/session.ts b/src/auth/session.ts
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
diff --git a/src/auth/refresh.ts b/src/auth/refresh.ts
new file mode 100644
index 0000000..a1b2c3d
--- /dev/null
+++ b/src/auth/refresh.ts
@@ -0,0 +1,8 @@
+import { signToken } from "./token";
+
+const SESSION_TTL_MS = 60 * 60 * 1000;
+
+export function signRefreshToken(userId: string): string {
+  // Long-lived token used to mint new sessions.
+  return signToken(\`refresh:\${userId}\`);
+}
`;

const STORY_THEME_STYLE_ID = "story-git-diff-theme";

/** Inject the selected palette's CSS globally (the same string the app applies
 *  at runtime) so the `.light` / `.dark` panes below pick up its tokens. */
function usePaletteCss(themeId: BuiltInThemeId) {
  useEffect(() => {
    let el = document.getElementById(
      STORY_THEME_STYLE_ID,
    ) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = STORY_THEME_STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = resolveAppThemeCss({
      themeId,
      customCss: null,
      faviconColor: "default",
    });
  }, [themeId]);
  useEffect(
    () => () => document.getElementById(STORY_THEME_STYLE_ID)?.remove(),
    [],
  );
}

function DiffStack({ themeType }: { themeType: "light" | "dark" }) {
  const files = useMemo(() => parseGitDiffFiles(SAMPLE_DIFF), []);
  const diffViewOptions = useMemo<Record<string, string | boolean | number>>(
    () => ({ ...GIT_DIFF_VIEW_BASE_OPTIONS, themeType }),
    [themeType],
  );
  return (
    <div className="flex flex-col gap-3">
      {files.map((file, index) => (
        <GitDiffCard
          key={`${file.name}-${index}`}
          fileDiff={file}
          diffViewOptions={diffViewOptions}
        />
      ))}
    </div>
  );
}

/** One mode pane: forces `.light` / `.dark` locally so both modes show at once,
 *  regardless of the page theme. */
function ModePane({ mode }: { mode: "light" | "dark" }) {
  return (
    <div
      className={cn(
        mode,
        "flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-background p-3",
      )}
    >
      <span className="text-[11px] font-medium text-muted-foreground">
        {mode}
      </span>
      <DiffStack themeType={mode} />
    </div>
  );
}

export function ThemedDiffPanel() {
  const [themeId, setThemeId] = useState<BuiltInThemeId>("catppuccin");
  usePaletteCss(themeId);

  return (
    <div className="m-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Palette
        </span>
        {builtInThemes.map((theme) => (
          <Button
            key={theme.id}
            size="sm"
            variant={theme.id === themeId ? "default" : "outline"}
            onClick={() => setThemeId(theme.id)}
          >
            {theme.name}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ModePane mode="light" />
        <ModePane mode="dark" />
      </div>
    </div>
  );
}
