import type { NativeShellHandshake } from "./handshake.js";
import { NATIVE_BRIDGE_GLOBAL } from "./version.js";

export interface NativeShellApi extends NativeShellHandshake {
  post(message: unknown): void;
  request(kind: string, payload: unknown): Promise<unknown>;
  copyTextAndImage?(text: string, imageUrl: string): Promise<unknown>;
  copyRichText?(text: string, html: string): Promise<unknown>;
  subscribe(listener: (event: unknown) => void): () => void;
}

function encodeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</gu, "\\u003c")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
}

export function buildBridgeInjectionScript(
  handshake: NativeShellHandshake,
): string {
  return `
(function () {
  try {
    var root = window.${NATIVE_BRIDGE_GLOBAL} = window.${NATIVE_BRIDGE_GLOBAL} || {};
    if (root.native && root.native.__installed) {
      root.native.__apply(${encodeForScript(handshake)});
      return;
    }
    var handshake = ${encodeForScript(handshake)};
    var listeners = [];
    var pending = {};
    var nextId = 0;
    var imagePastes = {};

    var discardImagePaste = function (id) {
      var entry = imagePastes[id];
      if (!entry) return;
      delete imagePastes[id];
      clearTimeout(entry.timer);
      entry.controller.abort();
    };

    var deliverImagePaste = function (id) {
      var entry = imagePastes[id];
      if (!entry || !entry.blob || !entry.image) return;
      var blob = entry.blob;
      var image = entry.image;
      discardImagePaste(id);
      if (!entry.target.isConnected || entry.href !== window.location.href
          || blob.size === 0 || blob.size > 35 * 1024 * 1024) return;
      var clipboard = new DataTransfer();
      clipboard.items.add(new File([blob], image.name, { type: image.type }));
      entry.target.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true, cancelable: true, clipboardData: clipboard
      }));
    };

    var post = function (message) {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify(message));
      } catch (error) {
        // A navigation can tear the bridge down mid-call. Losing a haptic is
        // never worth an exception in the page.
      }
    };

    var native = {
      __installed: true,
      __beginImagePaste: function (id, url) {
        var target = document.activeElement;
        if (!target || !target.isContentEditable || !target.closest("[data-promptbox]")) return false;
        var controller = new AbortController();
        var timer = setTimeout(function () { discardImagePaste(id); }, 30000);
        imagePastes[id] = { target: target, timer: timer, href: window.location.href, controller: controller };
        fetch(url, { signal: controller.signal, credentials: "omit", cache: "no-store" })
          .then(function (response) {
            if (!response.ok) throw new Error("Keyboard image unavailable");
            return response.blob();
          })
          .then(function (blob) {
            var entry = imagePastes[id];
            if (!entry) return;
            entry.blob = blob;
            deliverImagePaste(id);
          })
          .catch(function () { discardImagePaste(id); });
        return true;
      },
      __finishImagePaste: function (id, image) {
        var entry = imagePastes[id];
        if (!entry) return;
        if (!image) { discardImagePaste(id); return; }
        entry.image = image;
        deliverImagePaste(id);
      },
      __apply: function (next) {
        for (var key in next) {
          if (Object.prototype.hasOwnProperty.call(next, key)) {
            native[key] = next[key];
          }
        }
      },
      __receive: function (event) {
        if (event && event.type === "response") {
          var entry = pending[event.id];
          if (entry) {
            delete pending[event.id];
            clearTimeout(entry.timer);
            if (event.response && event.response.ok) {
              entry.resolve(event.response.result);
            } else {
              entry.reject(new Error((event.response && event.response.error) || "native request failed"));
            }
          }
          return;
        }
        if (event && event.type === "safe-area" && event.safeArea) {
          native.safeArea = event.safeArea;
        }
        for (var i = 0; i < listeners.length; i += 1) {
          try {
            listeners[i](event);
          } catch (error) {
            // One bad listener must not stop the others.
          }
        }
      },
      post: post,
      copyTextAndImage: handshake.platform === "android" ? function (text, imageUrl) {
        return native.request("clipboard", { text: text, imageUrl: imageUrl });
      } : undefined,
      copyRichText: handshake.platform === "android" ? function (text, html) {
        return native.request("clipboard-html", { text: text, html: html });
      } : undefined,
      request: function (kind, payload) {
        return new Promise(function (resolve, reject) {
          var id = "r" + String(nextId++) + "-" + String(Date.now());
          var timer = setTimeout(function () {
            delete pending[id];
            reject(new Error("native request timed out"));
          }, kind === "clipboard" ? 30000 : 10000);
          pending[id] = { resolve: resolve, reject: reject, timer: timer };
          post({ type: "request", id: id, request: { kind: kind, payload: payload } });
        });
      },
      subscribe: function (listener) {
        listeners.push(listener);
        return function () {
          var index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        };
      },
    };
    native.__apply(handshake);
    root.native = native;
  } catch (error) {
    // No bridge is a supported state. Leave the page alone.
  }
})();
true;
`;
}

export function buildBridgeEventScript(event: unknown): string {
  return `
(function () {
  try {
    var native = window.${NATIVE_BRIDGE_GLOBAL} && window.${NATIVE_BRIDGE_GLOBAL}.native;
    if (native && native.__receive) native.__receive(${encodeForScript(event)});
  } catch (error) {}
})();
true;
`;
}
