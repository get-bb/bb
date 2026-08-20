// Dev-only showcase for the native diff renderer and ANSI terminal output
// (src/diff, src/ansi). Fixtures cover the shapes the timeline feeds them:
// git patches, client-core synthetic created/deleted patches, renames,
// binaries, plain-text fallbacks, and colored command output. Not product UI.
import type { TimelineFileChange } from "@bb/server-contract";
import { Redirect } from "expo-router";
import { useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { e2eModeEnabled } from "@/app-shell";
import { AnsiText, TerminalOutputBlock } from "@/ansi";
import { DiffFileCard, FileChangeDiffBlock, parseUnifiedDiff } from "@/diff";
import { useTheme } from "@/theme/ThemeProvider";
import type { ThemeModePreference } from "@/theme/theme-preference";
import { Button, Text, toast } from "@/ui";

const ESC = "\u001b";

const MULTI_FILE_PATCH = `diff --git a/apps/mobile/src/diff/parse.ts b/apps/mobile/src/diff/parse.ts
index 1111111..2222222 100644
--- a/apps/mobile/src/diff/parse.ts
+++ b/apps/mobile/src/diff/parse.ts
@@ -1,9 +1,11 @@ import type { GitDiffFileChangeKind } from "@bb/server-contract";
 export type DiffLineType = "context" | "add" | "del" | "meta";

 export interface DiffLine {
   type: DiffLineType;
-  oldNo?: number;
-  newNo?: number;
+  /** Line number in the old file (context and deleted lines). */
+  oldNo?: number;
+  /** Line number in the new file (context and added lines). */
+  newNo?: number;
   text: string;
 }

@@ -120,7 +122,8 @@ function parseFileSegment(lines: readonly string[]): DiffFile | null {
   const headers = readSegmentHeaders(lines);
   const normalized = normalizeSegment(lines, headers);
-  const parsed = parseGitDiff(normalized.join("\\n"));
+  let parsed;
+  try {
+    parsed = parseGitDiff(normalized.join("\\n"));
+  } catch {
+    return null;
+  }
   const file = parsed.files[0];
 	if (!file) {
 		return null; // a tab-indented line that is really, really long so the horizontal scroll has something to do
diff --git a/old/name.ts b/new/name.ts
similarity index 100%
rename from old/name.ts
rename to new/name.ts
diff --git a/assets/logo.png b/assets/logo.png
new file mode 100644
index 0000000..1234567
Binary files /dev/null and b/assets/logo.png differ
diff --git a/README.md b/README.md
deleted file mode 100644
index e69de29..0000000
--- a/README.md
+++ /dev/null
@@ -1,3 +0,0 @@
-# Old readme
-
-Goodbye.
\\ No newline at end of file
`;

const LONG_PATCH = (() => {
  const lines: string[] = [];
  for (let index = 1; index <= 400; index += 1) {
    lines.push(
      index % 7 === 0
        ? `-const v${index} = ${index};`
        : index % 7 === 1
          ? `+const v${index} = ${index * 2};`
          : ` const v${index} = ${index};`,
    );
  }
  return `diff --git a/big.ts b/big.ts\n--- a/big.ts\n+++ b/big.ts\n@@ -1,400 +1,400 @@\n${lines.join("\n")}\n`;
})();

function fileChange(
  overrides: Partial<TimelineFileChange> & Pick<TimelineFileChange, "diff">,
): TimelineFileChange {
  return {
    path: "/Users/dev/repo/src/index.ts",
    kind: "modify",
    movePath: null,
    diffStats: { added: 0, removed: 0 },
    ...overrides,
  };
}

const FILE_CHANGES: { title: string; change: TimelineFileChange }[] = [
  {
    title: "Bare hunks (provider sent @@ only)",
    change: fileChange({
      diff: "@@ -10,3 +10,4 @@\n context\n-removed line\n+added line\n+another added\n context\n",
    }),
  },
  {
    title: "Created file from content lines (no line numbers)",
    change: fileChange({
      path: "/Users/dev/repo/notes.md",
      kind: "create",
      diff: "# Notes\n\nfirst paragraph\nsecond paragraph\n",
    }),
  },
  {
    title: "Deleted file",
    change: fileChange({
      path: "/Users/dev/repo/scratch.txt",
      kind: "delete",
      diff: "-temporary\n-content\n",
    }),
  },
  {
    title: "Plain-text fallback",
    change: fileChange({
      diff: "Applied edit to src/index.ts (3 lines changed)",
    }),
  },
  {
    title: "No diff",
    change: fileChange({ diff: null }),
  },
];

const ANSI_SAMPLES: { title: string; output: string; command?: string }[] = [
  {
    title: "pnpm test (16 colors, bold, dim)",
    command: "$ pnpm exec vitest run src/diff",
    output: [
      `${ESC}[1m${ESC}[46m RUN ${ESC}[0m ${ESC}[36mv4.1.1${ESC}[0m ${ESC}[90m/Users/dev/repo/apps/mobile${ESC}[0m`,
      "",
      ` ${ESC}[32m✓${ESC}[0m src/diff/parse-unified-diff.test.ts ${ESC}[2m(12 tests)${ESC}[0m ${ESC}[33m 8ms${ESC}[0m`,
      ` ${ESC}[31m✗${ESC}[0m src/diff/file-change-diff.test.ts ${ESC}[2m(1 test | ${ESC}[31m1 failed${ESC}[0m${ESC}[2m)${ESC}[0m`,
      `   ${ESC}[31m→${ESC}[0m expected ${ESC}[32m'added'${ESC}[0m to be ${ESC}[31m'modified'${ESC}[0m`,
      "",
      ` ${ESC}[2mTest Files${ESC}[0m  ${ESC}[1;31m1 failed${ESC}[0m | ${ESC}[1;32m1 passed${ESC}[0m ${ESC}[90m(2)${ESC}[0m`,
      ` ${ESC}[2m     Tests${ESC}[0m  ${ESC}[1;31m1 failed${ESC}[0m | ${ESC}[1;32m18 passed${ESC}[0m ${ESC}[90m(19)${ESC}[0m`,
    ].join("\n"),
  },
  {
    title: "256-color + truecolor + underline + inverse + progress \\r",
    command: "$ ./build.sh --verbose",
    output: [
      `${ESC}[38;5;208mwarning${ESC}[0m: ${ESC}[4mdeprecated API${ESC}[24m used in ${ESC}[38;2;100;149;237mmain.ts${ESC}[0m`,
      `${ESC}[7m INFO ${ESC}[27m building…`,
      `progress 10%\rprogress 50%\rprogress 100% ${ESC}[92mdone${ESC}[0m`,
      `${ESC}[48;5;196m${ESC}[97m FATAL ${ESC}[0m ${ESC}[3mitalic detail${ESC}[0m ${ESC}[9mstruck${ESC}[0m`,
      `${ESC}[2J${ESC}[H${ESC}[?25lcursor codes stripped${ESC}[?25h`,
      `${ESC}]8;;https://example.com${ESC}\\hyperlink text${ESC}]8;;${ESC}\\ survives`,
    ].join("\n"),
  },
  {
    title: "Long output collapses to its tail",
    command:
      '$ for i in $(seq 1 60); do echo "line $i of a fairly long command output that also scrolls horizontally"; done',
    output: Array.from(
      { length: 60 },
      (_, index) =>
        `${ESC}[90m${String(index + 1).padStart(2, " ")}${ESC}[0m line ${index + 1} of a fairly long command output that also scrolls horizontally past the edge`,
    ).join("\n"),
  },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-3">
      <Text variant="sectionLabel">{title}</Text>
      {children}
    </View>
  );
}

const MODES: ThemeModePreference[] = ["system", "light", "dark"];

function DiffShowcaseScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [showAddToChat, setShowAddToChat] = useState(true);
  const parsed = parseUnifiedDiff(MULTI_FILE_PATCH);
  const longFile = parseUnifiedDiff(LONG_PATCH).files[0];

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        padding: 16,
        paddingBottom: insets.bottom + 32,
        gap: 24,
      }}
      testID="dev-diff-screen"
    >
      <Section title={`Theme — ${theme.palette} / ${theme.mode}`}>
        <View className="flex-row flex-wrap gap-2">
          {MODES.map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant={theme.preference === mode ? "default" : "outline"}
              onPress={() => theme.setMode(mode)}
            >
              {mode}
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            pressed={showAddToChat}
            onPress={() => setShowAddToChat((value) => !value)}
          >
            Add-to-chat action
          </Button>
        </View>
      </Section>

      <Section
        title={`Multi-file patch — ${parsed.stats.files} files, +${parsed.stats.additions} -${parsed.stats.deletions}`}
      >
        {parsed.files.map((file) => (
          <DiffFileCard
            key={`${file.previousPath ?? ""}→${file.path}`}
            file={file}
            onAddToChat={
              showAddToChat
                ? (target) => toast.message(`Add to chat: ${target.path}`)
                : undefined
            }
            testID={`dev-diff-card-${file.path.replaceAll("/", "-")}`}
          />
        ))}
      </Section>

      <Section title="Timeline file-change rows (FileChangeDiffBlock)">
        {FILE_CHANGES.map(({ title, change }) => (
          <View key={title} className="gap-1.5">
            <Text variant="caption">{title}</Text>
            <FileChangeDiffBlock
              change={change}
              workspaceRootPath="/Users/dev/repo"
              onAddToChat={
                showAddToChat
                  ? (target) => toast.message(`Add to chat: ${target.path}`)
                  : undefined
              }
            />
          </View>
        ))}
      </Section>

      <Section title="Terminal output (ANSI)">
        {ANSI_SAMPLES.map(({ title, output, command }, index) => (
          <View key={title} className="gap-1.5">
            <Text variant="caption">{title}</Text>
            <TerminalOutputBlock
              commandLine={command}
              output={output}
              exitCode={index === 0 ? 1 : 0}
              metadataLines={index === 1 ? ["source: agent"] : undefined}
              testID={`dev-terminal-${index}`}
            />
          </View>
        ))}
        <View className="gap-1.5">
          <Text variant="caption">Inline AnsiText</Text>
          <AnsiText
            text={`${ESC}[1;35mbold magenta${ESC}[0m, ${ESC}[33myellow${ESC}[0m, ${ESC}[44;97m white on blue ${ESC}[0m, ${ESC}[2mdim${ESC}[0m`}
          />
        </View>
      </Section>
      <Section title="Large hunk — collapses behind Show more">
        {longFile ? (
          <DiffFileCard file={longFile} maxLines={40} testID="dev-diff-long" />
        ) : null}
      </Section>
    </ScrollView>
  );
}

// Dev-only route: inert in production bundles (see app/e2e/reset.tsx).
export default function DiffShowcaseRoute() {
  if (!e2eModeEnabled) return <Redirect href="/" />;
  return <DiffShowcaseScreen />;
}
