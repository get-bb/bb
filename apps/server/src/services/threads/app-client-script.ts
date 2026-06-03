import type { ApplicationId } from "@bb/domain";
import type { AppCapability } from "@bb/server-contract";

export interface AppClientBootstrap {
  appId: ApplicationId;
  applicationId: ApplicationId;
  appSessionToken: string | null;
  capabilities: AppCapability[];
  dataUrl: string;
  messageUrl: string;
  targetThreadId: string | null;
  wsUrl: string;
}

interface CreateAppClientScriptArgs {
  bootstrap: AppClientBootstrap;
}

const APP_CLIENT_SCRIPT_MARKER = "data-bb-app-client";

function escapedJsonForInlineScript(value: AppClientBootstrap): string {
  return JSON.stringify(value).replace(/</gu, "\\u003c");
}

export function createAppClientScript(args: CreateAppClientScriptArgs): string {
  const bootstrapJson = escapedJsonForInlineScript(args.bootstrap);
  return `<script ${APP_CLIENT_SCRIPT_MARKER}>${buildAppClientJavascript(
    bootstrapJson,
  )}</script>`;
}

export function injectAppClientScript(
  html: string,
  bootstrap: AppClientBootstrap,
): string {
  if (html.includes(APP_CLIENT_SCRIPT_MARKER)) {
    return html;
  }

  const script = createAppClientScript({ bootstrap });
  const firstScriptIndex = html.search(/<script\b/iu);
  const headCloseIndex = html.search(/<\/head>/iu);
  if (firstScriptIndex !== -1) {
    return `${html.slice(0, firstScriptIndex)}${script}${html.slice(
      firstScriptIndex,
    )}`;
  }
  if (headCloseIndex !== -1) {
    return `${html.slice(0, headCloseIndex)}${script}${html.slice(
      headCloseIndex,
    )}`;
  }

  const htmlOpenMatch = /<html\b[^>]*>/iu.exec(html);
  if (htmlOpenMatch?.index !== undefined) {
    const insertIndex = htmlOpenMatch.index + htmlOpenMatch[0].length;
    return `${html.slice(0, insertIndex)}${script}${html.slice(insertIndex)}`;
  }

  return `${script}${html}`;
}

function buildAppClientJavascript(bootstrapJson: string): string {
  return `
(function () {
  var bootstrap = ${bootstrapJson};
  var capabilities = Object.create(null);
  bootstrap.capabilities.forEach(function (capability) {
    capabilities[capability] = true;
  });

  function hasCapability(name) {
    return capabilities[name] === true;
  }

  function cloneValue(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function isJsonValue(value) {
    if (value === null) return true;
    var type = typeof value;
    if (type === "string" || type === "boolean") return true;
    if (type === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(isJsonValue);
    if (type !== "object") return false;
    var proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.keys(value).every(function (key) {
      return isJsonValue(value[key]);
    });
  }

  function validatePath(path, allowEmpty) {
    // Keep these app-data path limits in sync with packages/domain/src/apps.ts.
    if (allowEmpty && path === "") return;
    if (typeof path !== "string") {
      throw new Error("App data path must be a string");
    }
    if (
      path.length === 0 ||
      path.length > 512 ||
      path.indexOf("\\\\") !== -1 ||
      path.indexOf(String.fromCharCode(0)) !== -1 ||
      path.charAt(0) === "/" ||
      path.charAt(path.length - 1) === "/"
    ) {
      throw new Error("Invalid app data path: " + String(path));
    }
    var segments = path.split("/");
    if (segments.length > 8) {
      throw new Error("App data path is too deep: " + path);
    }
    for (var index = 0; index < segments.length; index += 1) {
      var segment = segments[index];
      if (
        segment === "." ||
        segment === ".." ||
        segment.charAt(0) === "." ||
        !/^[A-Za-z0-9._-]{1,80}$/.test(segment)
      ) {
        throw new Error("Invalid app data path segment: " + String(segment));
      }
    }
  }

  function dataPathUrl(path) {
    validatePath(path, false);
    return bootstrap.dataUrl + "/" + path.split("/").map(encodeURIComponent).join("/");
  }

  function buildError(response, text) {
    var message = response.statusText || ("HTTP " + response.status);
    var code = null;
    if (text) {
      try {
        var body = JSON.parse(text);
        if (body && typeof body === "object" && typeof body.message === "string") {
          message = body.message;
          if (typeof body.code === "string") code = body.code;
        } else {
          message = text;
        }
      } catch (error) {
        message = text;
      }
    }
    var appError = new Error(message);
    appError.status = response.status;
    if (code) appError.code = code;
    return appError;
  }

  function rejectResponse(response) {
    return response.text().then(function (text) {
      throw buildError(response, text);
    });
  }

  function read(path) {
    return fetch(dataPathUrl(path), {
      method: "GET",
      credentials: "same-origin",
      headers: { "Accept": "application/json" }
    }).then(function (response) {
      if (response.status === 404) return undefined;
      if (!response.ok) return rejectResponse(response);
      return response.json().then(function (entry) {
        return cloneValue(entry.value);
      });
    });
  }

  function write(path, value) {
    validatePath(path, false);
    if (value === undefined || !isJsonValue(value)) {
      return Promise.reject(new Error("bb.data.write requires a JSON value"));
    }
    return fetch(dataPathUrl(path), {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ value: value })
    }).then(function (response) {
      if (response.ok) return undefined;
      return rejectResponse(response);
    });
  }

  function deletePath(path) {
    return fetch(dataPathUrl(path), {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Accept": "application/json" }
    }).then(function (response) {
      if (response.ok) return undefined;
      return rejectResponse(response);
    });
  }

  function listEntries(prefix) {
    var effectivePrefix = prefix === undefined ? "" : prefix;
    validatePath(effectivePrefix, true);
    var url = bootstrap.dataUrl;
    if (effectivePrefix !== "") {
      url += "?prefix=" + encodeURIComponent(effectivePrefix);
    }
    return fetch(url, {
      method: "GET",
      credentials: "same-origin",
      headers: { "Accept": "application/json" }
    }).then(function (response) {
      if (!response.ok) return rejectResponse(response);
      return response.json().then(function (body) {
        return body.entries.map(function (entry) {
          return {
            path: entry.path,
            value: cloneValue(entry.value),
            version: entry.version
          };
        });
      });
    });
  }

  function list(prefix) {
    return listEntries(prefix).then(function (entries) {
      return entries.map(function (entry) {
        return { path: entry.path, value: cloneValue(entry.value) };
      });
    });
  }

  var socket = null;
  var reconnectTimer = null;
  var reconnectDelay = 1000;
  var listeners = [];
  var socketHasOpened = false;
  var socketSubscribed = false;
  var subscriptionReady = null;
  var resolveSubscriptionReady = null;
  var subscriptionEntityId = bootstrap.applicationId + ":data";

  function pathMatchesPrefix(path, prefix) {
    return prefix === "" || path === prefix || path.indexOf(prefix + "/") === 0;
  }

  function callListener(listener, event) {
    if (!listener.active) return;
    if (!pathMatchesPrefix(event.path, listener.prefix)) return;
    try {
      listener.callback({
        path: event.path,
        value: event.deleted ? undefined : cloneValue(event.value),
        deleted: event.deleted
      });
    } catch (error) {
      console.error("window.bb.data.onChange callback failed", error);
    }
  }

  function deliverOrBufferListener(listener, event) {
    if (!listener.active) return;
    if (!pathMatchesPrefix(event.path, listener.prefix)) return;
    if (listener.replaying) {
      listener.bufferedEvents.push(event);
      return;
    }
    callListener(listener, event);
  }

  function handleBroadcast(message) {
    if (
      !message ||
      message.applicationId !== bootstrap.applicationId
    ) {
      return;
    }
    if (message.type === "app-data.resync") {
      listeners.slice().forEach(function (listener) {
        replayExisting(listener);
      });
      return;
    }
    if (message.type !== "app-data.changed") {
      return;
    }
    var event = {
      path: message.path,
      value: message.deleted ? undefined : cloneValue(message.value),
      deleted: message.deleted,
      version: message.version
    };
    listeners.slice().forEach(function (listener) {
      deliverOrBufferListener(listener, event);
    });
  }

  function sendSubscriptionMessage(type) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: type,
      entity: "thread",
      id: subscriptionEntityId
    }));
  }

  function resetSubscriptionReady() {
    subscriptionReady = new Promise(function (resolve) {
      resolveSubscriptionReady = resolve;
    });
  }

  function closeSocketIfIdle() {
    if (listeners.length > 0) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (!socket) return;
    if (resolveSubscriptionReady) {
      resolveSubscriptionReady();
      resolveSubscriptionReady = null;
    }
    if (socket.readyState === WebSocket.OPEN && socketSubscribed) {
      sendSubscriptionMessage("unsubscribe");
      socketSubscribed = false;
    }
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socketHasOpened = false;
      socket.close();
    }
  }

  function connectSocket() {
    if (!subscriptionReady) resetSubscriptionReady();
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return subscriptionReady;
    socket = new WebSocket(bootstrap.wsUrl);
    socket.onopen = function () {
      var reconnected = socketHasOpened;
      socketHasOpened = true;
      reconnectDelay = 1000;
      if (listeners.length > 0) {
        sendSubscriptionMessage("subscribe");
        socketSubscribed = true;
      }
      if (resolveSubscriptionReady) {
        resolveSubscriptionReady();
        resolveSubscriptionReady = null;
      }
      closeSocketIfIdle();
      if (reconnected) {
        listeners.slice().forEach(function (listener) {
          replayExisting(listener);
        });
      }
    };
    socket.onmessage = function (event) {
      if (typeof event.data !== "string") return;
      try {
        handleBroadcast(JSON.parse(event.data));
      } catch (error) {
        console.error("window.bb ignored invalid realtime message", error);
      }
    };
    socket.onclose = function () {
      socketSubscribed = false;
      resetSubscriptionReady();
      if (listeners.length === 0) return;
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(function () {
        reconnectTimer = null;
        reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
        connectSocket();
      }, reconnectDelay);
    };
    socket.onerror = function () {
      if (socket) socket.close();
    };
    return subscriptionReady;
  }

  function replayExisting(listener) {
    if (!listener.active) return Promise.resolve();
    listener.replayPromise = (listener.replayPromise || Promise.resolve()).then(function () {
      if (!listener.active) return;
      listener.replaying = true;
      listener.bufferedEvents = [];
      return connectSocket().then(function () {
        if (!listener.active) return null;
        return listEntries(listener.prefix);
      }).then(function (entries) {
        if (!listener.active || !entries) return;
        var replayedVersions = Object.create(null);
        entries.forEach(function (entry) {
          replayedVersions[entry.path] = entry.version;
          callListener(listener, {
            path: entry.path,
            value: entry.value,
            deleted: false
          });
        });
        listener.bufferedEvents.forEach(function (event) {
          if (!event.deleted && replayedVersions[event.path] === event.version) return;
          callListener(listener, event);
        });
      }).finally(function () {
        listener.replaying = false;
        listener.bufferedEvents = [];
      });
    }).catch(function (error) {
      if (!listener.active) return;
      console.error("window.bb.data.onChange replay failed", error);
    });
    return listener.replayPromise;
  }

  function onChange(prefix, callback) {
    var effectivePrefix = prefix === undefined ? "" : prefix;
    validatePath(effectivePrefix, true);
    if (typeof callback !== "function") {
      throw new Error("bb.data.onChange requires a callback");
    }
    var listener = {
      prefix: effectivePrefix,
      callback: callback,
      active: true,
      replaying: false,
      bufferedEvents: [],
      replayPromise: null
    };
    listeners.push(listener);
    replayExisting(listener);
    return function () {
      if (!listener.active) return;
      listener.active = false;
      listener.bufferedEvents = [];
      listeners = listeners.filter(function (candidate) {
        return candidate !== listener;
      });
      closeSocketIfIdle();
    };
  }

  function message(text) {
    if (text === undefined || !isJsonValue(text)) {
      throw new TypeError("window.bb.message(payload) requires a JSON value");
    }
    return fetch(bootstrap.messageUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        payload: text,
        appSessionToken: bootstrap.appSessionToken || undefined
      })
    }).then(function (response) {
      if (response.ok) return undefined;
      return rejectResponse(response);
    });
  }

  var bb = { appId: bootstrap.appId, applicationId: bootstrap.applicationId };
  if (hasCapability("data")) {
    bb.data = {
      read: read,
      write: write,
      delete: deletePath,
      list: list,
      onChange: onChange
    };
  }
  if (hasCapability("message")) {
    bb.message = message;
  }

  try {
    Object.defineProperty(window, "bb", {
      value: bb,
      configurable: true,
      writable: false
    });
  } catch (error) {
    window.bb = bb;
  }
})();
`;
}
