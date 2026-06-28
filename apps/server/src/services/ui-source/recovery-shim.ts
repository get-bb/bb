/**
 * Kernel-owned recovery runway, injected by the server into every served
 * index.html (shipped AND UI source). It lives OUTSIDE the editable UI bundle,
 * so a broken UI-source edit can never disable its own escape hatch.
 *
 * Responsibilities:
 *  - Own the live reload: subscribe to the `system` realtime channel and reload
 *    the page when the server broadcasts `ui-reloaded` after a build promote.
 *  - Provide manual recovery, when serving the active UI source: if the app
 *    root never mounts (slow load, missing bundle, or runtime crash), show a
 *    "Revert to stable" bar without interrupting an eventually successful load.
 */
const RECOVERY_SHIM_JS = String.raw`
(function () {
  var MOUNT_TIMEOUT_MS = 10000;
  var FAILURE_HINT_TIMEOUT_MS = 3000;
  var RECOVERY_ENABLED = __BB_UI_SOURCE_RECOVERY_ENABLED__;
  var recoveryObserver = null;

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
        window.location.reload();
      }
    };
    ws.onclose = function () {
      setTimeout(connectReload, 2000);
    };
  }

  // --- Manual recovery -------------------------------------------------------
  function hideRecoveryBar() {
    var bar = document.getElementById("bb-ui-recovery-bar");
    if (bar && typeof bar.remove === "function") {
      bar.remove();
    }
    if (recoveryObserver) {
      recoveryObserver.disconnect();
      recoveryObserver = null;
    }
  }

  function watchForMount() {
    if (recoveryObserver || typeof MutationObserver === "undefined") return;
    var root = document.getElementById("root");
    var target = root || document.body;
    if (!target) return;
    recoveryObserver = new MutationObserver(function () {
      if (appMounted()) {
        hideRecoveryBar();
      }
    });
    recoveryObserver.observe(target, { childList: true, subtree: !root });
  }

  function showRecoveryBar() {
    if (appMounted()) {
      hideRecoveryBar();
      return;
    }
    if (document.getElementById("bb-ui-recovery-bar")) return;
    if (!document.body) return;
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
    label.textContent =
      "This UI is taking a while to load. Your edits are safe in the UI source.";
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
    watchForMount();
  }

  function appMounted() {
    var root = document.getElementById("root");
    return !!(root && root.childElementCount > 0);
  }

  function startWatchdog() {
    if (!RECOVERY_ENABLED) return;
    setTimeout(function () {
      showRecoveryBar();
    }, MOUNT_TIMEOUT_MS);
  }

  function watchLoadFailures() {
    if (!RECOVERY_ENABLED) return;
    function scheduleFailureHint() {
      setTimeout(function () {
        showRecoveryBar();
      }, FAILURE_HINT_TIMEOUT_MS);
    }
    window.addEventListener("error", function (event) {
      if (appMounted()) return;
      var target = event && event.target;
      var tagName = target && target.tagName;
      if (target && target !== window && String(tagName).toUpperCase() !== "SCRIPT") {
        return;
      }
      scheduleFailureHint();
    }, true);
    window.addEventListener("unhandledrejection", function () {
      if (!appMounted()) {
        scheduleFailureHint();
      }
    });
  }

  connectReload();
  watchLoadFailures();
  if (document.readyState === "complete" || document.readyState === "interactive") {
    startWatchdog();
  } else {
    window.addEventListener("DOMContentLoaded", startWatchdog);
  }
})();
`;

interface InjectRecoveryShimOptions {
  recoverEnabled?: boolean;
}

function recoveryShimTag(options: InjectRecoveryShimOptions): string {
  const recoverEnabled = options.recoverEnabled ?? false;
  const js = RECOVERY_SHIM_JS.replace(
    "__BB_UI_SOURCE_RECOVERY_ENABLED__",
    recoverEnabled ? "true" : "false",
  );
  return `<script data-bb-recovery-shim data-bb-ui-source-recovery="${
    recoverEnabled ? "enabled" : "disabled"
  }">${js}</script>`;
}

/**
 * Insert the recovery shim into an index.html document. Idempotent: if the shim
 * is already present (re-served) it is not duplicated.
 */
export function injectRecoveryShim(
  html: string,
  options: InjectRecoveryShimOptions = {},
): string {
  if (html.includes("data-bb-recovery-shim")) {
    return html;
  }
  const tag = recoveryShimTag(options);
  if (html.includes("</head>")) {
    return html.replace("</head>", `${tag}</head>`);
  }
  return `${tag}${html}`;
}
