// Dev-only showcase for the native markdown renderer: one fixture per node
// type so the output can be eyeballed per palette × mode on the simulator.
// Not product UI.
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import type { PromptMentionResource, PromptTextMention } from "@bb/domain";
import {
  Markdown,
  MarkdownText,
  extractMarkdownHeadings,
  markdownToPlainText,
  type MarkdownDirective,
  type MarkdownImagePress,
  type MarkdownLinkTarget,
  type MarkdownLocalFileLink,
  type MarkdownThreadMentionPress,
} from "@/markdown";
import { useTheme } from "@/theme";
import { Button, Text, toast } from "@/ui";
import { Screen } from "../shell/Screen";

const RAW_ID = "thr_abcdefghjk";

const FIXTURE = `---
title: Markdown showcase
status: draft
---
# Heading one

## Heading two

### Heading three

#### Heading four

##### Heading five

###### Heading six

A paragraph with **bold**, *italic*, ***both***, ~~strike~~, \`inline code\`,
a [web link](https://example.com/docs), a local file \`/repo/src/app.ts:12\`
link [app.ts:12](/repo/src/app.ts:12), a \`/repo/docs/plan.md\` code path,
a [localhost link](http://localhost:5173/preview) and an autolink
https://getbb.app. Hard break follows:
this line was a single newline.

Mentions: see @thread:${RAW_ID} and the raw id ${RAW_ID} plus \`${RAW_ID}\` in code.
A time like 13:30 and a key:value stay literal.

- Unordered item one
- Item two with *emphasis*
  - Nested item
  - Another nested item
- Item three

1. First
2. Second
   1. Nested ordered
   2. Nested ordered two
3. Third

5. Starts at five
6. Six

- [x] Done task
- [ ] Open task

> A blockquote with **bold** text and a [link](https://example.com).
>
> Second paragraph in the quote.

---

| Column | Right | Center | Long column header |
| --- | ---: | :-: | --- |
| a | 1 | x | some longer cell content here |
| b | 22 | y | short |
| c | 333 | z | another one with a [link](https://example.com) |

\`\`\`ts
import { x } from "./y";

// Comment
export function add(a: number, b: number): number {
  return a + b; // sum
}
const s = \`template \${a}\`;
\`\`\`

\`\`\`python
def greet(name: str) -> str:
    """Docstring"""
    return f"hello {name}"
\`\`\`

\`\`\`bash
echo "hi" | grep h # comment
\`\`\`

\`\`\`
no language fence
with two lines and a very long line that should scroll horizontally instead of wrapping around the screen edge
\`\`\`

Inline math $$E = mc^2$$ and a block:

$$
\\int_0^1 x^2 dx = \\frac{1}{3}
$$

<div class="raw">raw html stays literal</div>

::task{key="ABC-12" title="Wire the native renderer"}

:::note{tone="info"}
Container directive body with **markdown** inside.
:::

::unknown-directive{x="1"}

![Remote image](https://picsum.photos/seed/bb-mobile/600/300)

Reference [link][ref] and an unresolved [missing][nope].

[ref]: https://example.com/reference

Footnote reference[^1].

[^1]: The footnote text.

Last paragraph.
`;

const PROMPT_TEXT =
  "Please look at @src/app.ts and @thread:abc123, then run /deploy on @backend project.";

const PROMPT_MENTIONS: PromptTextMention[] = [
  {
    start: 15,
    end: 26,
    resource: {
      kind: "path",
      source: "workspace",
      entryKind: "file",
      path: "src/app.ts",
      label: "app.ts",
    },
  },
  {
    start: 31,
    end: 45,
    resource: {
      kind: "thread",
      threadId: "abc123",
      label: "Fix the login bug",
    },
  },
  {
    start: 56,
    end: 63,
    resource: {
      kind: "command",
      trigger: "/",
      name: "deploy",
      source: "command",
      origin: "project",
      label: "deploy",
      argumentHint: null,
    },
  },
  {
    start: 67,
    end: 75,
    resource: { kind: "project", projectId: "p1", label: "backend" },
  },
];

function resolveThread(threadId: string): PromptMentionResource | null {
  if (threadId === RAW_ID) {
    return { kind: "thread", threadId, label: "Ship the mobile app" };
  }
  return null;
}

export function MarkdownShowcaseScreen() {
  const theme = useTheme();
  const { tokens } = theme;
  const [textSize, setTextSize] = useState<"sm" | "base">("sm");
  const [lastEvent, setLastEvent] = useState<string>("—");

  const onLinkPress = useCallback((link: MarkdownLinkTarget) => {
    setLastEvent(`link ${link.kind}: ${link.href}`);
    // Claim external links in the showcase so taps do not leave the app.
    return link.kind === "external";
  }, []);
  const onFilePress = useCallback((file: MarkdownLocalFileLink) => {
    setLastEvent(
      `file ${file.path}${
        file.lineRange ? `:${file.lineRange.startLineNumber}` : ""
      }`,
    );
  }, []);
  const onImagePress = useCallback((image: MarkdownImagePress) => {
    setLastEvent(`image ${image.src}`);
    toast.message("Image tapped", { description: image.alt });
  }, []);
  const onThreadPress = useCallback((mention: MarkdownThreadMentionPress) => {
    setLastEvent(`thread ${mention.threadId} (${mention.resource.label})`);
  }, []);
  const renderDirective = useCallback(
    (directive: MarkdownDirective) => {
      if (directive.name === "unknown-directive") {
        return null;
      }
      return (
        <View
          style={{
            borderWidth: 1,
            borderColor: tokens.border,
            borderRadius: 8,
            backgroundColor: tokens.card,
            padding: 12,
            gap: 6,
          }}
        >
          <Text variant="label">
            {directive.kind === "leaf" ? "::" : ":::"}
            {directive.name}
          </Text>
          {Object.entries(directive.attributes).map(([key, value]) => (
            <Text key={key} variant="caption">
              {key} = {value}
            </Text>
          ))}
          {directive.children}
        </View>
      );
    },
    [tokens],
  );
  const threadMentions = useMemo(() => ({ resolveThread }), []);
  const headings = useMemo(() => extractMarkdownHeadings(FIXTURE), []);
  const plain = useMemo(() => markdownToPlainText(FIXTURE).slice(0, 120), []);

  return (
    <Screen testID="dev-markdown-screen">
      <View className="gap-2">
        <Text variant="sectionLabel">Controls</Text>
        <View className="flex-row gap-2">
          <Button
            size="sm"
            variant={textSize === "sm" ? "default" : "outline"}
            onPress={() => setTextSize("sm")}
          >
            sm
          </Button>
          <Button
            size="sm"
            variant={textSize === "base" ? "default" : "outline"}
            onPress={() => setTextSize("base")}
          >
            base
          </Button>
          <Button
            size="sm"
            variant="outline"
            onPress={() =>
              theme.setMode(theme.mode === "dark" ? "light" : "dark")
            }
            testID="dev-markdown-toggle-mode"
          >
            {theme.mode === "dark" ? "light" : "dark"}
          </Button>
        </View>
        <Text variant="caption" testID="dev-markdown-last-event">
          Last event: {lastEvent}
        </Text>
      </View>

      <View className="gap-2">
        <Text variant="sectionLabel">User prompt (prompt mentions)</Text>
        <View className="rounded-lg border border-border bg-card p-3">
          <Markdown
            content={PROMPT_TEXT}
            promptMentions={PROMPT_MENTIONS}
            threadMentions={threadMentions}
            textSize={textSize}
            onThreadPress={onThreadPress}
            onMentionPress={(mention) =>
              setLastEvent(`mention ${mention.serializedText}`)
            }
          />
        </View>
      </View>

      <View className="gap-2">
        <Text variant="sectionLabel">MarkdownText (single line)</Text>
        <MarkdownText
          content={
            "**Bold** title with `code`, a [link](https://example.com) and @thread:abc123 — second line\nthird line"
          }
          numberOfLines={2}
          threadMentions={threadMentions}
          onLinkPress={onLinkPress}
        />
        <Text variant="caption">Plain: {plain}…</Text>
        <Text variant="caption">
          Headings: {headings.map((h) => `h${h.depth}@${h.line}`).join(", ")}
        </Text>
      </View>

      <View className="gap-2">
        <Text variant="sectionLabel">Assistant body (every node type)</Text>
        <Markdown
          content={FIXTURE}
          textSize={textSize}
          threadMentions={threadMentions}
          onLinkPress={onLinkPress}
          onFilePress={onFilePress}
          onImagePress={onImagePress}
          onThreadPress={onThreadPress}
          renderDirective={renderDirective}
          serverHostname="bb.example.test"
          testID="dev-markdown-body"
        />
      </View>
    </Screen>
  );
}
