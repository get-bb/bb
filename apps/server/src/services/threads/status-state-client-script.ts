export interface StatusStateBootstrap {
  listUrl: string;
  mutationUrl: string;
  sendMessageUrl: string;
  threadId: string;
  wsUrl: string;
}

interface CreateStatusStateClientScriptArgs {
  bootstrap: StatusStateBootstrap;
}

const STATUS_STATE_SCRIPT_MARKER = "data-bb-status-state-client";

function escapedJsonForInlineScript(value: StatusStateBootstrap): string {
  return JSON.stringify(value).replace(/</gu, "\\u003c");
}

export function createStatusStateClientScript(
  args: CreateStatusStateClientScriptArgs,
): string {
  const bootstrapJson = escapedJsonForInlineScript(args.bootstrap);
  return `<script ${STATUS_STATE_SCRIPT_MARKER}>${buildStatusStateClientJavascript(
    bootstrapJson,
  )}</script>`;
}

export function injectStatusStateClientScript(
  html: string,
  bootstrap: StatusStateBootstrap,
): string {
  if (html.includes(STATUS_STATE_SCRIPT_MARKER)) {
    return html;
  }

  const script = createStatusStateClientScript({ bootstrap });
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

function buildStatusStateClientJavascript(bootstrapJson: string): string {
  return `
(function () {
  var bootstrap = ${bootstrapJson};

  function createBbThreadTellError(message, status, code, retryable) {
    var error = new Error(message);
    error.status = status;
    if (code) error.code = code;
    if (typeof retryable === "boolean") error.retryable = retryable;
    return error;
  }

  function buildBbThreadTellClientError(response, text) {
    var message = response.statusText || ("HTTP " + response.status);
    var code = null;
    var retryable = null;
    if (text) {
      try {
        var body = JSON.parse(text);
        if (body && typeof body === "object") {
          if (typeof body.message === "string") message = body.message;
          if (typeof body.code === "string") code = body.code;
          if (typeof body.retryable === "boolean") retryable = body.retryable;
        } else {
          message = text;
        }
      } catch (error) {
        message = text;
      }
    }
    return createBbThreadTellError(message, response.status, code, retryable);
  }

  function buildBbThreadTellError(response) {
    if (response.status >= 500) {
      return Promise.resolve(
        createBbThreadTellError(
          "bbThreadTell failed: server error (" + response.status + ")",
          response.status,
          null,
          null
        )
      );
    }
    return response.text().then(function (text) {
      return buildBbThreadTellClientError(response, text);
    });
  }

  function createBbThreadTellRequestBody(text) {
    return {
      input: [{ type: "text", text: text }],
      mode: "auto"
    };
  }

  function bbThreadTell(text) {
    if (typeof text !== "string") {
      throw new TypeError("window.bbThreadTell(text) requires a string");
    }
    return fetch(bootstrap.sendMessageUrl, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify(createBbThreadTellRequestBody(text))
    }).then(function (response) {
      if (response.ok) return undefined;
      return buildBbThreadTellError(response).then(function (error) {
        throw error;
      });
    });
  }

  function installBbThreadTell() {
    try {
      Object.defineProperty(window, "bbThreadTell", {
        value: bbThreadTell,
        configurable: true,
        writable: false
      });
    } catch (error) {
      window.bbThreadTell = bbThreadTell;
    }
  }

  installBbThreadTell();
  if (window.bbStatusState) return;

  var keyPattern = /^[A-Za-z0-9_-]{1,80}$/;
  var clientId = "bbss_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  var cache = Object.create(null);
  var versions = Object.create(null);
  var hydrated = false;
  var hydrating = false;
  var hydratePromise = null;
  var listeners = [];
  var pendingOperations = Object.create(null);
  var bufferedBroadcasts = [];
  var socket = null;
  var reconnectTimer = null;
  var reconnectDelay = 1000;

  function makeErrorMessage(error) {
    if (error && typeof error.message === "string") return error.message;
    return String(error || "Unknown status state error");
  }

  function validateKey(key) {
    if (typeof key !== "string" || !keyPattern.test(key)) {
      throw new Error("Invalid status-data key: " + String(key));
    }
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

  function cloneValue(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function valuesEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function copyCache() {
    var out = Object.create(null);
    Object.keys(cache).forEach(function (key) {
      out[key] = cloneValue(cache[key]);
    });
    return out;
  }

  function callListener(listener, key, nextValue, previousValue, event) {
    try {
      listener.callback(cloneValue(nextValue), cloneValue(previousValue), key, event);
    } catch (error) {
      setTimeout(function () { throw error; }, 0);
    }
  }

  function emit(key, nextValue, previousValue, event) {
    listeners.slice().forEach(function (listener) {
      if (listener.selector !== "*" && listener.selector !== key) return;
      callListener(listener, key, nextValue, previousValue, event);
    });
  }

  function applyValue(key, nextValue, version, event) {
    var hadPrevious = Object.prototype.hasOwnProperty.call(cache, key);
    var previousValue = hadPrevious ? cache[key] : undefined;
    var changed = !hadPrevious || !valuesEqual(previousValue, nextValue);
    cache[key] = cloneValue(nextValue);
    versions[key] = version;
    if (changed) emit(key, nextValue, previousValue, event);
  }

  function applyDelete(key, event) {
    var hadPrevious = Object.prototype.hasOwnProperty.call(cache, key);
    var previousValue = hadPrevious ? cache[key] : undefined;
    delete cache[key];
    delete versions[key];
    if (hadPrevious) emit(key, undefined, previousValue, event);
  }

  function applySnapshot(snapshot, operation) {
    var incomingKeys = Object.keys(snapshot.values);
    incomingKeys.forEach(function (key) {
      applyValue(key, snapshot.values[key], snapshot.versions[key] || null, {
        source: "remote",
        operation: operation,
        optimistic: false,
        version: snapshot.versions[key] || null,
        error: null
      });
    });

    Object.keys(cache).forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(snapshot.values, key)) return;
      applyDelete(key, {
        source: "remote",
        operation: operation,
        optimistic: false,
        version: null,
        error: null
      });
    });
  }

  function replayBufferedBroadcasts() {
    var buffered = bufferedBroadcasts;
    bufferedBroadcasts = [];
    buffered.forEach(applyBroadcast);
  }

  function fetchJson(url, options) {
    return fetch(url, Object.assign({ credentials: "same-origin" }, options || {})).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (text) {
          throw new Error(text || response.statusText || ("HTTP " + response.status));
        });
      }
      return response.json();
    });
  }

  function hydrate(operation) {
    hydrating = true;
    hydratePromise = fetchJson(bootstrap.listUrl).then(function (snapshot) {
      applySnapshot(snapshot, operation);
      hydrating = false;
      replayBufferedBroadcasts();
      hydrated = true;
      return copyCache();
    }).catch(function (error) {
      hydrating = false;
      replayBufferedBroadcasts();
      console.error("bbStatusState hydration failed", error);
      throw error;
    });
    return hydratePromise;
  }

  function ensureHydrated() {
    return hydratePromise || hydrate("hydrate");
  }

  function makeOperationId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "op_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function keyUrl(key) {
    return bootstrap.mutationUrl.replace(/\\/$/, "") + "/" + encodeURIComponent(key);
  }

  function rememberPending(operationId, key, value, deleted) {
    pendingOperations[operationId] = {
      key: key,
      value: cloneValue(value),
      deleted: deleted
    };
  }

  function clearPending(operationId) {
    if (operationId) delete pendingOperations[operationId];
  }

  function applyBroadcast(message) {
    var key = message.key;
    var pending = message.operationId ? pendingOperations[message.operationId] : null;
    if (pending && pending.key === key) {
      clearPending(message.operationId);
      if (message.deleted) {
        if (!Object.prototype.hasOwnProperty.call(cache, key)) return;
      } else if (Object.prototype.hasOwnProperty.call(cache, key) && valuesEqual(cache[key], message.value)) {
        versions[key] = message.version;
        return;
      }
    }

    if (message.deleted) {
      applyDelete(key, {
        source: "remote",
        operation: "delete",
        optimistic: false,
        version: null,
        error: null
      });
      return;
    }

    applyValue(key, message.value, message.version, {
      source: "remote",
      operation: "set",
      optimistic: false,
      version: message.version,
      error: null
    });
  }

  function handleBroadcast(message) {
    if (!message || message.type !== "status-data.changed" || message.threadId !== bootstrap.threadId) {
      return;
    }
    if (hydrating) {
      bufferedBroadcasts.push(message);
      return;
    }
    applyBroadcast(message);
  }

  function connectSocket() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    socket = new WebSocket(bootstrap.wsUrl);
    socket.onopen = function () {
      reconnectDelay = 1000;
      socket.send(JSON.stringify({
        type: "subscribe",
        entity: "thread",
        id: bootstrap.threadId + ":status-data"
      }));
      if (hydrated) {
        hydrate("resync").catch(function () {});
      }
    };
    socket.onmessage = function (event) {
      if (typeof event.data !== "string") return;
      try {
        handleBroadcast(JSON.parse(event.data));
      } catch (error) {
        console.error("bbStatusState ignored invalid realtime message", error);
      }
    };
    socket.onclose = function () {
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
  }

  window.bbStatusState = {
    list: function () {
      return ensureHydrated().then(copyCache);
    },
    get: function (key) {
      validateKey(key);
      return ensureHydrated().then(function () {
        return cloneValue(cache[key]);
      });
    },
    set: function (key, value) {
      validateKey(key);
      if (value === undefined || !isJsonValue(value)) {
        return Promise.reject(new Error("bbStatusState.set requires a JSON value"));
      }
      return ensureHydrated().then(function () {
        var operationId = makeOperationId();
        var hadPrevious = Object.prototype.hasOwnProperty.call(cache, key);
        var previousValue = hadPrevious ? cloneValue(cache[key]) : undefined;
        var previousVersion = Object.prototype.hasOwnProperty.call(versions, key) ? versions[key] : null;
        rememberPending(operationId, key, value, false);
        applyValue(key, value, null, {
          source: "local",
          operation: "set",
          optimistic: true,
          version: null,
          error: null
        });
        return fetchJson(keyUrl(key), {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "x-bb-status-state-client": clientId,
            "x-bb-status-state-operation": operationId
          },
          body: JSON.stringify({ value: value })
        }).then(function (response) {
          clearPending(operationId);
          versions[key] = response.version;
        }).catch(function (error) {
          clearPending(operationId);
          if (hadPrevious) {
            cache[key] = previousValue;
            versions[key] = previousVersion;
          } else {
            delete cache[key];
            delete versions[key];
          }
          emit(key, hadPrevious ? previousValue : undefined, value, {
            source: "local",
            operation: "revert",
            optimistic: false,
            version: previousVersion,
            error: makeErrorMessage(error)
          });
          throw error;
        });
      });
    },
    delete: function (key) {
      validateKey(key);
      return ensureHydrated().then(function () {
        var operationId = makeOperationId();
        var hadPrevious = Object.prototype.hasOwnProperty.call(cache, key);
        var previousValue = hadPrevious ? cloneValue(cache[key]) : undefined;
        var previousVersion = Object.prototype.hasOwnProperty.call(versions, key) ? versions[key] : null;
        rememberPending(operationId, key, undefined, true);
        applyDelete(key, {
          source: "local",
          operation: "delete",
          optimistic: true,
          version: null,
          error: null
        });
        return fetchJson(keyUrl(key), {
          method: "DELETE",
          headers: {
            "x-bb-status-state-client": clientId,
            "x-bb-status-state-operation": operationId
          }
        }).then(function () {
          clearPending(operationId);
        }).catch(function (error) {
          clearPending(operationId);
          if (hadPrevious) {
            cache[key] = previousValue;
            versions[key] = previousVersion;
          }
          emit(key, previousValue, undefined, {
            source: "local",
            operation: "revert",
            optimistic: false,
            version: previousVersion,
            error: makeErrorMessage(error)
          });
          throw error;
        });
      });
    },
    on: function (selector, callback) {
      if (selector !== "*") validateKey(selector);
      if (typeof callback !== "function") {
        throw new Error("bbStatusState.on requires a callback");
      }
      var listener = { selector: selector, callback: callback };
      listeners.push(listener);
      if (hydrated) {
        Object.keys(cache).forEach(function (key) {
          if (selector !== "*" && selector !== key) return;
          callListener(listener, key, cache[key], undefined, {
            source: "remote",
            operation: "hydrate",
            optimistic: false,
            version: versions[key] || null,
            error: null
          });
        });
      }
      var unsubscribed = false;
      return function () {
        if (unsubscribed) return;
        unsubscribed = true;
        listeners = listeners.filter(function (entry) { return entry !== listener; });
      };
    }
  };

  connectSocket();
  hydrate("hydrate").catch(function () {});
})();`;
}
