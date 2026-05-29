import { escapeHtmlText } from "@bb/domain";

interface BuildBlankAppIndexHtmlArgs {
  name: string;
}

const BLANK_APP_NAME_PLACEHOLDER = "__BB_APP_NAME__";

// First <style> block: the bb default styling head copied verbatim from
// `bb guide styling` (packages/templates/src/templates/bb-guide-app.md). Keep
// this in sync with that guide so the scaffold and the documented tokens never
// drift.
const BB_DEFAULT_STYLING_HEAD = `<script src="https://cdn.tailwindcss.com"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
    <style>
    :root {
      color-scheme: light;
      --background: oklch(0.9551 0 0);
      --foreground: oklch(0.3211 0 0);
      --card: oklch(0.9702 0 0);
      --muted: oklch(0.8853 0 0);
      --muted-foreground: oklch(0.5103 0 0);
      --border: oklch(0.8576 0 0);
      --accent: oklch(0.9 0 0);
      --success: oklch(0.7 0.15 155);
      --warning: oklch(0.7 0.16 50);
      --destructive: oklch(0.5594 0.19 25.8625);
      --radius: 0.5rem;
      --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
      --font-mono: "Fira Code", ui-monospace, SFMono-Regular, monospace;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --background: oklch(0.2178 0 0);
        --foreground: oklch(0.8853 0 0);
        --card: oklch(0.2435 0 0);
        --muted: oklch(0.31 0 0);
        --muted-foreground: oklch(0.7058 0 0);
        --border: oklch(0.34 0 0);
        --accent: oklch(0.32 0 0);
      }
    }
    body {
      margin: 0;
      background: var(--background);
      color: var(--foreground);
      font-family: var(--font-sans);
      font-size: 13px;
    }
    .panel {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--card);
    }
    </style>`;

// Second <style> block: scaffold-only classes layered on top of the guide
// tokens. Keep this strictly additive; do not redefine variables or guide
// classes here.
const BLANK_APP_SCAFFOLD_EXTRA_STYLES = `<style>
      * { box-sizing: border-box; }
      body {
        padding: 16px 16px 20px;
        line-height: 1.45;
        -webkit-font-smoothing: antialiased;
      }
      .panel { padding: 14px 16px; }
      .header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--border);
        margin-bottom: 16px;
      }
      .brand {
        width: 20px;
        height: 20px;
        border: 1px solid var(--border);
        background: var(--card);
        border-radius: calc(var(--radius) - 4px);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-family: var(--font-mono);
        font-weight: 500;
        font-size: 10px;
      }
      .title {
        font-size: 13px;
        font-weight: 600;
        flex: 1;
        min-width: 0;
        letter-spacing: -0.005em;
      }
      .ts {
        font-family: var(--font-mono);
        font-size: 10px;
        color: var(--muted-foreground);
      }
      .placeholder {
        margin: 0 0 14px;
        color: var(--muted-foreground);
        font-size: 13px;
      }
      .section { margin-top: 14px; }
      .sect-ttl {
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted-foreground);
        margin-bottom: 8px;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 12px;
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
      }
      .row + .row { margin-top: 6px; }
      .label {
        font-family: var(--font-mono);
        font-size: 10.5px;
        color: var(--muted-foreground);
        white-space: nowrap;
      }
      .name {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        font-family: var(--font-mono);
        font-size: 9.5px;
        font-weight: 500;
        line-height: 1;
        padding: 3px 7px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--background);
        color: var(--muted-foreground);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        white-space: nowrap;
        flex-shrink: 0;
      }
    </style>`;

// Blank-template scaffold rendered into apps/<id>/assets/index.html. Composes
// the documented bb default styling head with a scaffold-only style block and
// the task-list visual vocabulary borrowed from the bundled status app, so new
// apps start out looking bb-native rather than like bare HTML. The same
// scaffold powers both `bb app new` (any name) and the bundled default status
// app seeded into every manager thread (name="Status").
const BLANK_APP_INDEX_HTML_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${BLANK_APP_NAME_PLACEHOLDER}</title>
    ${BB_DEFAULT_STYLING_HEAD}
    ${BLANK_APP_SCAFFOLD_EXTRA_STYLES}
  </head>
  <body>
    <header class="header">
      <span class="brand">bb</span>
      <span class="title">${BLANK_APP_NAME_PLACEHOLDER}</span>
      <span class="ts" id="bb-app-id">&mdash;</span>
    </header>

    <main class="panel">
      <p class="placeholder">
        Customize this static app in assets/index.html. No web server or build step needed.
      </p>

      <section class="section">
        <div class="sect-ttl">Example tasks</div>
        <div class="row">
          <span class="label">implementing</span>
          <span class="name">Sample task title</span>
          <span class="pill">in progress</span>
        </div>
        <div class="row">
          <span class="label">blocked</span>
          <span class="name">Another sample row</span>
          <span class="pill">blocked</span>
        </div>
      </section>
    </main>

    <script>
      if (window.bb && window.bb.appId) {
        document.getElementById("bb-app-id").textContent = window.bb.appId;
      }
    </script>
  </body>
</html>
`;

export function buildBlankAppIndexHtml(
  args: BuildBlankAppIndexHtmlArgs,
): string {
  return BLANK_APP_INDEX_HTML_TEMPLATE.replaceAll(
    BLANK_APP_NAME_PLACEHOLDER,
    escapeHtmlText(args.name),
  );
}
