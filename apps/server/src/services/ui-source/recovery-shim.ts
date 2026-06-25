/**
 * Kernel-owned recovery runway, injected by the server into every served
 * index.html (shipped AND UI source). It lives OUTSIDE the editable UI bundle,
 * so a broken UI-source edit can never disable its own escape hatch.
 *
 * Responsibilities:
 *  - Own the live reload: subscribe to the `system` realtime channel and reload
 *    the page when the server broadcasts `ui-reloaded` after a build promote.
 *  - Self-heal: if the app root never mounts (a build that compiled but crashes
 *    at runtime), auto-revert to the shipped UI once, then fall back to a manual
 *    "Revert to stable" bar. A session-scoped guard prevents reload loops.
 */
const RECOVERY_SHIM_JS = String.raw`
(function () {
  var MOUNT_TIMEOUT_MS = 10000;
  var AUTO_RECOVER_KEY = "bb.ui.autoRecovered";

  function wsUrl() {
    var proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + window.location.host + "/ws";
  }

  // --- Live reload via the system realtime channel ---------------------------
  function connectReload() {
    var ws;
    try {
      ws = new WebSocket(wsUrl());
    } catch (e) {
      return;
    }
    ws.onopen = function () {
      try {
        ws.send(JSON.stringify({ type: "subscribe", target: { kind: "system" } }));
      } catch (e) {}
    };
    ws.onmessage = function (event) {
      if (typeof event.data !== "string") return;
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      if (
        msg &&
        msg.type === "changed" &&
        msg.entity === "system" &&
        Array.isArray(msg.changes) &&
        msg.changes.indexOf("ui-reloaded") !== -1
      ) {
        // The build that triggered this reload is known-good (build-gated), so
        // clear the auto-recover guard for the fresh load.
        try { sessionStorage.removeItem(AUTO_RECOVER_KEY); } catch (e) {}
        window.location.reload();
      }
    };
    ws.onclose = function () {
      setTimeout(connectReload, 2000);
    };
  }

  // --- Self-heal watchdog ----------------------------------------------------
  function showRecoveryBar() {
    if (document.getElementById("bb-ui-recovery-bar")) return;
    var bar = document.createElement("div");
    bar.id = "bb-ui-recovery-bar";
    bar.setAttribute(
      "style",
      "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;" +
        "display:flex;gap:12px;align-items:center;justify-content:center;" +
        "padding:10px 16px;font:14px/1.4 system-ui,sans-serif;" +
        "background:#1a1a1a;color:#fff;border-top:1px solid #333;"
    );
    var label = document.createElement("span");
    label.textContent = "This UI did not load. Your edits are safe in the UI source.";
    var button = document.createElement("button");
    button.textContent = "Revert to stable";
    button.setAttribute(
      "style",
      "padding:6px 14px;border-radius:6px;border:0;cursor:pointer;" +
        "background:#fff;color:#000;font-weight:600;"
    );
    button.onclick = function () {
      button.disabled = true;
      button.textContent = "Reverting…";
      fetch("/api/v1/ui/prod", { method: "POST" })
        .then(function () { window.location.reload(); })
        .catch(function () { window.location.reload(); });
    };
    bar.appendChild(label);
    bar.appendChild(button);
    document.body.appendChild(bar);
  }

  function appMounted() {
    var root = document.getElementById("root");
    return !!(root && root.childElementCount > 0);
  }

  function startWatchdog() {
    setTimeout(function () {
      if (appMounted()) return;
      var alreadyRecovered;
      try { alreadyRecovered = sessionStorage.getItem(AUTO_RECOVER_KEY); } catch (e) {}
      if (alreadyRecovered) {
        // Auto-revert already tried this session — show the manual escape hatch.
        showRecoveryBar();
        return;
      }
      try { sessionStorage.setItem(AUTO_RECOVER_KEY, "1"); } catch (e) {}
      fetch("/api/v1/ui/prod", { method: "POST" })
        .then(function () { window.location.reload(); })
        .catch(function () { showRecoveryBar(); });
    }, MOUNT_TIMEOUT_MS);
  }

  connectReload();
  if (document.readyState === "complete" || document.readyState === "interactive") {
    startWatchdog();
  } else {
    window.addEventListener("DOMContentLoaded", startWatchdog);
  }
})();
`;

const RECOVERY_SHIM_TAG = `<script data-bb-recovery-shim>${RECOVERY_SHIM_JS}</script>`;

/**
 * Insert the recovery shim into an index.html document. Idempotent: if the shim
 * is already present (re-served) it is not duplicated.
 */
export function injectRecoveryShim(html: string): string {
  if (html.includes("data-bb-recovery-shim")) {
    return html;
  }
  if (html.includes("</head>")) {
    return html.replace("</head>", `${RECOVERY_SHIM_TAG}</head>`);
  }
  return `${RECOVERY_SHIM_TAG}${html}`;
}
