import { escapeHtmlText } from "@bb/domain";
import type { BbDesktopThemeResolved } from "@bb/desktop-contract";
import {
  DESKTOP_RAIL_DRAG_HEIGHT_PX,
  DESKTOP_RAIL_WIDTH_PX,
} from "./desktop-rail-layout.js";
import { DEFAULT_RAIL_THEME_DARK } from "./desktop-rail-theme.js";
import type { DesktopRailViewModel } from "./desktop-rail-view-model.js";

export interface CreateDesktopRailViewUrlArgs {
  theme: BbDesktopThemeResolved;
  viewModel: DesktopRailViewModel;
}

function renderServerTiles(viewModel: DesktopRailViewModel): string {
  return viewModel.servers
    .map((server) => {
      const activeClass = server.active ? " tile-active" : "";
      return `<button type="button" class="tile${activeClass}" data-server-id="${escapeHtmlText(server.id)}" data-server-source="${escapeHtmlText(server.source)}" title="${escapeHtmlText(server.name)}" aria-label="${escapeHtmlText(server.name)}" aria-pressed="${server.active ? "true" : "false"}">
  <span class="tile-glyph">${escapeHtmlText(server.initial)}</span>
  <span class="status status-${escapeHtmlText(server.status)}" aria-hidden="true"></span>
</button>`;
    })
    .join("\n");
}

/**
 * Packaged local HTML for the native server rail. Vanilla JS only; the preload
 * exposes window.bbDesktopRail. Theme colors are applied via --canvas/--ink and
 * live-updated over IPC.
 */
export function renderDesktopRailView(args: CreateDesktopRailViewUrlArgs): string {
  const theme = args.theme;
  const tiles = renderServerTiles(args.viewModel);
  const initialStateJson = JSON.stringify(args.viewModel).replace(
    /</gu,
    "\\u003c",
  );
  const initialThemeJson = JSON.stringify(theme).replace(/</gu, "\\u003c");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>bb servers</title>
  <style>
    :root {
      --canvas: ${escapeHtmlText(theme.canvasColor)};
      --ink: ${escapeHtmlText(theme.inkColor)};
      /* The SPA pushes its resolved --sidebar so rail + sidebar read as one
         continuous panel on any palette; older SPAs omit it and we fall back
         to the default theme's sidebar mix. */
      --rail-surface: ${escapeHtmlText(
        theme.sidebarColor ??
          `color-mix(in oklch, var(--ink) ${theme.mode === "dark" ? "4.3%" : "2.2%"}, var(--canvas))`,
      )};
      color-scheme: ${theme.mode === "dark" ? "dark" : "light"};
    }

    * {
      box-sizing: border-box;
    }

    html, body {
      height: 100%;
      margin: 0;
      overflow: hidden;
      user-select: none;
      width: ${DESKTOP_RAIL_WIDTH_PX}px;
      background: var(--rail-surface);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    body {
      display: flex;
      flex-direction: column;
      app-region: drag;
      -webkit-app-region: drag;
    }

    .drag-top {
      /* Window-controls strip: the macOS traffic lights render natively over
         this area. Height matches the SPA's 48px chrome row. */
      flex: 0 0 ${DESKTOP_RAIL_DRAG_HEIGHT_PX}px;
      height: ${DESKTOP_RAIL_DRAG_HEIGHT_PX}px;
    }

    .rail-body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      padding: 4px 0 10px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    .tile,
    .tile-add {
      app-region: no-drag;
      -webkit-app-region: no-drag;
      position: relative;
      width: 36px;
      height: 36px;
      border: 0;
      border-radius: 10px;
      padding: 0;
      margin: 0;
      cursor: default;
      appearance: none;
      background: transparent;
      color: color-mix(in oklch, var(--ink) 72%, var(--canvas));
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .tile:hover,
    .tile-add:hover {
      background: color-mix(in oklch, var(--ink) 7%, var(--canvas));
      color: var(--ink);
    }

    .tile:active,
    .tile-add:active {
      background: color-mix(in oklch, var(--ink) 11%, var(--canvas));
    }

    .tile-active {
      background: color-mix(in oklch, var(--ink) 11%, var(--canvas));
      color: var(--ink);
    }

    .tile-glyph {
      pointer-events: none;
    }

    /* Status is quiet by default: healthy and still-probing servers show no
       dot; only offline/incompatible speak up, in muted ink so custom
       palettes stay coherent. */
    .status {
      position: absolute;
      right: 1px;
      bottom: 1px;
      width: 7px;
      height: 7px;
      border-radius: 999px;
      border: 1.5px solid var(--rail-surface);
      background: color-mix(in oklch, var(--ink) 38%, var(--canvas));
    }

    .status-connected,
    .status-unknown {
      display: none;
    }

    .status-offline {
      background: color-mix(in oklch, var(--ink) 38%, var(--canvas));
    }

    .status-incompatible {
      background: oklch(0.78 0.14 85);
    }

    .tile-add {
      font-size: 18px;
      font-weight: 500;
      color: color-mix(in oklch, var(--ink) 55%, var(--canvas));
    }

    .tile-add:hover {
      color: var(--ink);
    }
  </style>
</head>
<body>
  <div class="drag-top" data-testid="bb-server-rail-drag" aria-hidden="true"></div>
  <div class="rail-body" id="rail-body" data-testid="bb-server-rail-body">
    ${tiles}
    <button type="button" class="tile-add" id="add-server" title="Add server" aria-label="Add server">+</button>
  </div>
  <script>
    (function () {
      const api = window.bbDesktopRail;
      let state = ${initialStateJson};
      let theme = ${initialThemeJson};

      function applyTheme(next) {
        theme = next;
        const root = document.documentElement;
        root.style.setProperty("--canvas", next.canvasColor);
        root.style.setProperty("--ink", next.inkColor);
        root.style.setProperty(
          "--rail-surface",
          next.sidebarColor ??
            "color-mix(in oklch, var(--ink) " +
              (next.mode === "dark" ? "4.3%" : "2.2%") +
              ", var(--canvas))",
        );
        root.style.colorScheme = next.mode === "dark" ? "dark" : "light";
      }

      function render() {
        const body = document.getElementById("rail-body");
        const addButton = document.getElementById("add-server");
        if (!body || !addButton) return;
        const existing = body.querySelectorAll(".tile");
        for (const node of existing) node.remove();
        for (const server of state.servers) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "tile" + (server.active ? " tile-active" : "");
          button.dataset.serverId = server.id;
          button.dataset.serverSource = server.source;
          button.title = server.name;
          button.setAttribute("aria-label", server.name);
          button.setAttribute("aria-pressed", server.active ? "true" : "false");
          const glyph = document.createElement("span");
          glyph.className = "tile-glyph";
          glyph.textContent = server.initial;
          const status = document.createElement("span");
          status.className = "status status-" + server.status;
          status.setAttribute("aria-hidden", "true");
          button.appendChild(glyph);
          button.appendChild(status);
          body.insertBefore(button, addButton);
        }
      }

      const body = document.getElementById("rail-body");
      if (body && api) {
        body.addEventListener("click", (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const add = target.closest("#add-server");
          if (add) {
            api.addServer();
            return;
          }
          const tile = target.closest(".tile");
          if (!(tile instanceof HTMLElement) || !tile.dataset.serverId) return;
          api.setActive(tile.dataset.serverId);
        });
        body.addEventListener("contextmenu", (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const tile = target.closest(".tile");
          if (!(tile instanceof HTMLElement) || !tile.dataset.serverId) return;
          event.preventDefault();
          api.showContextMenu({
            id: tile.dataset.serverId,
            source: tile.dataset.serverSource || "manual",
          });
        });
        api.onState((next) => {
          state = next;
          render();
        });
        api.onTheme((next) => {
          applyTheme(next);
        });
      }
      applyTheme(theme);
    })();
  </script>
</body>
</html>`;
}

export function createDesktopRailViewUrl(
  args: CreateDesktopRailViewUrlArgs,
): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(
    renderDesktopRailView(args),
  )}`;
}

/** Initial dark palette for first paint before SPA theme sync. */
export function createDefaultDesktopRailViewUrl(
  viewModel: DesktopRailViewModel,
): string {
  return createDesktopRailViewUrl({
    theme: DEFAULT_RAIL_THEME_DARK,
    viewModel,
  });
}
