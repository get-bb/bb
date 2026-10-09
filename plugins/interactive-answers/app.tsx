import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  definePluginApp,
  useBbNavigate,
  useComposer,
  useRpc,
  type PluginMessageDirectiveProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server.js";
import {
  computedValues,
  defaultValues,
  evaluate,
  formatValue,
  idSchema,
  SHARE_PROVIDER,
  validValue,
  type Answer,
  type AnswerDocument,
  type Block,
  type Control,
  type HtmlAnswer,
  type Values,
} from "./model.js";
import { useLiveAnswer, type LiveSnapshot } from "./use-live.js";
import {
  fallbackTheme,
  FRAME_PATH,
  THEME_TOKENS,
  WIDGET_MESSAGE_SOURCE,
  type WidgetTheme,
} from "./widget.js";
import "./app.css";
import { Diagram } from "./diagram.js";

function readInputs(
  doc: AnswerDocument,
  saved: unknown,
  base = defaultValues(doc),
): Values {
  const values = { ...base };
  if (saved && typeof saved === "object")
    for (const c of doc.controls) {
      const value = (saved as Record<string, unknown>)[c.id];
      if (validValue(c, value)) values[c.id] = value;
    }
  return values;
}

function AgentHost({
  agent,
  maxWidth,
  children,
}: {
  agent: { label: string; key: number } | null;
  maxWidth?: number;
  children: ReactNode;
}) {
  return (
    <div
      className="ia-host"
      data-agent={agent ? "" : undefined}
      style={maxWidth ? { maxWidth } : undefined}
    >
      {children}
      {agent && (
        <span key={agent.key} className="ia-agent" role="status">
          <i aria-hidden="true" />
          Agent · {agent.label}
        </span>
      )}
    </div>
  );
}

function Input({
  control: c,
  value,
  onChange,
}: {
  control: Control;
  value: string | number;
  onChange: (value: string | number) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(String(value));
    setInvalid(false);
  }, [value]);
  const editNumber = (text: string) => {
    setDraft(text);
    const number = text.trim() === "" ? NaN : Number(text);
    const valid = validValue(c, number);
    setInvalid(!valid);
    if (valid) onChange(number);
  };
  return (
    <div className="ia-control">
      <label htmlFor={id}>
        {c.label}
        {c.type === "range" && (
          <output htmlFor={id}>
            {formatValue(Number(value))} {c.unit}
          </output>
        )}
      </label>
      {c.type === "select" ? (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {c.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : c.type === "range" ? (
        <input
          id={id}
          type="range"
          min={c.min}
          max={c.max}
          step={c.step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      ) : (
        <div className="ia-number">
          <input
            id={id}
            type="number"
            min={c.min}
            max={c.max}
            step={c.step}
            value={draft}
            aria-invalid={invalid}
            aria-describedby={invalid ? `${id}-error` : undefined}
            onChange={(e) => editNumber(e.target.value)}
          />
          {c.unit && <span>{c.unit}</span>}
        </div>
      )}
      {invalid && c.type !== "select" && (
        <small id={`${id}-error`} role="alert">
          Use {c.min}–{c.max} in steps of {c.step}. Results use the last valid
          value.
        </small>
      )}
    </div>
  );
}

function Chart({
  block: b,
  values,
}: {
  block: Extract<Block, { type: "chart" }>;
  values: Values;
}) {
  const titleId = useId();
  const data = b.series.map((s) => ({
    label: s.label,
    values: s.values.map((v) => evaluate(v, values)),
  }));
  const numbers = data
    .flatMap((s) => s.values)
    .filter((n): n is number => n !== null);
  const magnitude = Math.max(1, ...numbers.map(Math.abs));
  const low = Math.min(0, ...numbers.map((v) => v / magnitude));
  const high = Math.max(0, ...numbers.map((v) => v / magnitude));
  const span = high - low || 1;
  const y = (v: number) => 174 - ((v / magnitude - low) / span) * 144;
  const x = (i: number) => 78 + (i * 380) / (b.labels.length - 1);
  const labelIndexes = [
    ...new Set([0, Math.floor((b.labels.length - 1) / 2), b.labels.length - 1]),
  ];
  return (
    <section className="ia-chart" aria-labelledby={titleId}>
      <h4 id={titleId}>{b.title}</h4>
      <svg
        viewBox="0 0 500 216"
        role="img"
        aria-label={`${b.title}. Exact values in the data table below.`}
      >
        {[low, (low + high) / 2, high].map((n, i) => (
          <g key={i}>
            <line
              x1="78"
              x2="458"
              y1={y(n * magnitude)}
              y2={y(n * magnitude)}
              className="ia-gridline"
            />
            <text x="70" y={y(n * magnitude) + 4} textAnchor="end">
              {formatValue(n * magnitude, b.format)}
            </text>
          </g>
        ))}
        {data.map((series, si) => (
          <g key={si} className={`ia-series ia-series-${si}`}>
            {b.style === "line" &&
              series.values.map((v, i, arr) =>
                v !== null && i > 0 && arr[i - 1] !== null ? (
                  <line
                    key={i}
                    x1={x(i - 1)}
                    y1={y(arr[i - 1]!)}
                    x2={x(i)}
                    y2={y(v)}
                    strokeWidth="2.5"
                    strokeDasharray={si ? `${8 - si} ${si + 2}` : undefined}
                  />
                ) : null,
              )}
            {series.values.map((v, i) =>
              v === null ? null : b.style === "line" ? (
                <circle key={i} cx={x(i)} cy={y(v)} r="3">
                  <title>
                    {series.label}: {b.labels[i]} — {formatValue(v, b.format)}
                  </title>
                </circle>
              ) : (
                <rect
                  key={i}
                  x={
                    78 +
                    (i * 380) / b.labels.length +
                    si * (300 / b.labels.length / data.length)
                  }
                  y={Math.min(y(v), y(0))}
                  width={280 / b.labels.length / data.length}
                  height={Math.max(0, Math.abs(y(v) - y(0)))}
                  rx="2"
                >
                  <title>
                    {series.label}: {b.labels[i]} — {formatValue(v, b.format)}
                  </title>
                </rect>
              ),
            )}
          </g>
        ))}
        {labelIndexes.map((i) => (
          <text
            key={i}
            x={
              b.style === "line"
                ? x(i)
                : 78 + ((i + 0.4) * 380) / b.labels.length
            }
            y="200"
            textAnchor="middle"
          >
            {b.labels[i].length > 16
              ? `${b.labels[i].slice(0, 15)}…`
              : b.labels[i]}
          </text>
        ))}
      </svg>
      <div className="ia-legend">
        {data.map((s, i) => (
          <span key={i}>
            <svg
              width="24"
              height="12"
              aria-hidden="true"
              className={`ia-series ia-series-${i}`}
            >
              <line
                x1="1"
                x2="23"
                y1="6"
                y2="6"
                strokeWidth="3"
                strokeDasharray={i ? `${8 - i} ${i + 2}` : undefined}
              />
            </svg>
            {s.label}
          </span>
        ))}
      </div>
      {numbers.length !== data.length * b.labels.length && (
        <p role="status">Some values cannot be calculated with these inputs.</p>
      )}
      <details>
        <summary>View chart data</summary>
        <div className="ia-table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Point</th>
                {data.map((s, i) => (
                  <th key={i} scope="col">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.labels.map((label, i) => (
                <tr key={i}>
                  <th scope="row">{label}</th>
                  {data.map((s, j) => (
                    <td key={j}>{formatValue(s.values[i], b.format)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

const PLUGIN_ID = "bb--interactive-answers";
const GESTURE_INTERVAL_MS = 1000;
const MESSAGE_BURST = 40;
const MESSAGES_PER_SECOND = 10;

const UI_FONT_FAMILY = "Inter Variable";
const LATIN_CODE_POINT = 0x41;
let uiFont: Promise<ArrayBuffer | null> | null = null;

function fontFaceRules(sheet: CSSStyleSheet): CSSFontFaceRule[] {
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    return [];
  }
  return Array.from(rules).flatMap((rule) => {
    if (rule.type === CSSRule.IMPORT_RULE) {
      const imported = (rule as CSSImportRule).styleSheet;
      return imported ? fontFaceRules(imported) : [];
    }
    return rule.type === CSSRule.FONT_FACE_RULE
      ? [rule as CSSFontFaceRule]
      : [];
  });
}

function coversCodePoint(range: string, codePoint: number): boolean {
  if (range.trim() === "") return true;
  return range.split(",").some((part) => {
    const [start, end = start] = part.trim().replace(/^U\+/i, "").split("-");
    const low = Number.parseInt((start ?? "").replaceAll("?", "0"), 16);
    const high = Number.parseInt(end.replaceAll("?", "F"), 16);
    return low <= codePoint && codePoint <= high;
  });
}

function loadUiFont(): Promise<ArrayBuffer | null> {
  uiFont ??= (async () => {
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of fontFaceRules(sheet)) {
        const family = rule.style
          .getPropertyValue("font-family")
          .replace(/["']/g, "")
          .trim();
        const range = rule.style
          .getPropertyValue("unicode-range")
          .toUpperCase();
        if (
          family !== UI_FONT_FAMILY ||
          !coversCodePoint(range, LATIN_CODE_POINT)
        )
          continue;
        const url = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(
          rule.style.getPropertyValue("src"),
        )?.[1];
        if (!url) continue;
        const resolved = new URL(url, sheet.href ?? document.baseURI);
        if (resolved.origin !== location.origin) return null;
        const response = await fetch(resolved);
        return response.ok ? await response.arrayBuffer() : null;
      }
    }
    return null;
  })().catch(() => null);
  return uiFont;
}

function readTheme(): WidgetTheme {
  if (typeof document === "undefined") return fallbackTheme;
  const root = getComputedStyle(document.documentElement);
  const tokens: WidgetTheme["tokens"] = { ...fallbackTheme.tokens };
  for (const name of THEME_TOKENS) {
    const value = root.getPropertyValue(`--${name}`).trim();
    if (value) tokens[name] = value;
  }
  const dark =
    document.documentElement.classList.contains("dark") ||
    root.colorScheme === "dark";
  return {
    scheme: dark ? "dark" : "light",
    font: getComputedStyle(document.body).fontFamily || fallbackTheme.font,
    tokens,
  };
}

function HtmlAnswerView({
  id,
  threadId,
  widget,
  initial,
}: {
  id: string;
  threadId: string;
  widget: HtmlAnswer;
  initial: LiveSnapshot;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(240);
  const [actions, setActions] = useState<string[]>([]);
  const results = useRef(
    new Map<
      string,
      (outcome: { ok: boolean; value?: unknown; error?: string }) => void
    >(),
  );
  const post = (message: Record<string, unknown>) =>
    frame.current?.contentWindow?.postMessage(
      { source: WIDGET_MESSAGE_SOURCE, ...message },
      "*",
    );
  const latestState = useRef<{ state: unknown } | null>(null);
  const live = useLiveAnswer({
    id,
    threadId,
    initial,
    actions,
    onRemoteState: (state) => {
      latestState.current = { state };
      post({ type: "state", state });
    },
    onCommand: (action, args) =>
      new Promise((resolve, reject) => {
        const cmdId = crypto.randomUUID();
        const timer = setTimeout(() => {
          results.current.delete(cmdId);
          reject(new Error("The answer did not respond."));
        }, 9000);
        results.current.set(cmdId, (outcome) => {
          clearTimeout(timer);
          results.current.delete(cmdId);
          if (outcome.ok) resolve(outcome.value);
          else reject(new Error(outcome.error ?? "The action failed."));
        });
        post({ type: "command", cmdId, action, args });
      }),
  });
  const { save, emit, active } = live;
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const navigate = useBbNavigate();
  const lastGesture = useRef(0);
  const takeGesture = () => {
    const now = Date.now();
    if (
      !navigator.userActivation?.isActive ||
      document.activeElement !== frame.current ||
      now - lastGesture.current < GESTURE_INTERVAL_MS
    )
      return false;
    lastGesture.current = now;
    return true;
  };
  const send = (label: string, data: unknown) => {
    if (!takeGesture()) return;
    rpc
      .call("share", {
        id,
        threadId,
        clientId: live.clientId,
        label,
        data: data ?? null,
      })
      .then(
        ({ itemId }) => {
          composer.insert(
            { provider: SHARE_PROVIDER, id: itemId, label },
            { at: "end" },
          );
          composer.focus();
        },
        () => {},
      );
  };
  const open = (url: string) => {
    if (/^https?:\/\//.test(url) && takeGesture()) navigate.openUrl(url);
  };
  const gestures = useRef({ send, open });
  gestures.current = { send, open };
  const src = useMemo(
    () =>
      `/api/v1/plugins/${PLUGIN_ID}/http${FRAME_PATH}?thread=${encodeURIComponent(threadId)}&id=${encodeURIComponent(id)}#${encodeURIComponent(JSON.stringify({ state: initial.state, theme: readTheme() }))}`,
    [id, threadId, initial.state],
  );
  useEffect(() => {
    const budgets = {
      event: { tokens: MESSAGE_BURST, at: Date.now() },
      actions: { tokens: MESSAGE_BURST, at: Date.now() },
    };
    const spend = (kind: keyof typeof budgets) => {
      const budget = budgets[kind];
      const now = Date.now();
      budget.tokens = Math.min(
        MESSAGE_BURST,
        budget.tokens + ((now - budget.at) / 1000) * MESSAGES_PER_SECOND,
      );
      budget.at = now;
      if (budget.tokens < 1) return false;
      budget.tokens -= 1;
      return true;
    };
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (
        event.source !== frame.current?.contentWindow ||
        !data ||
        typeof data !== "object"
      )
        return;
      const message = data as {
        source?: unknown;
        id?: unknown;
        type?: unknown;
        height?: unknown;
        state?: unknown;
        url?: unknown;
        actions?: unknown;
        name?: unknown;
        label?: unknown;
        data?: unknown;
        cmdId?: unknown;
        ok?: unknown;
        value?: unknown;
        error?: unknown;
      };
      if (message.source !== WIDGET_MESSAGE_SOURCE || message.id !== id) return;
      if (
        message.type === "height" &&
        typeof message.height === "number" &&
        Number.isFinite(message.height)
      )
        setHeight(Math.min(4000, Math.max(40, Math.ceil(message.height))));
      if (message.type === "state") {
        latestState.current = { state: message.state };
        save(message.state);
      }
      if (
        message.type === "event" &&
        typeof message.name === "string" &&
        spend("event")
      )
        emit(message.name, message.data);
      if (message.type === "active") active();
      if (
        message.type === "send" &&
        typeof message.label === "string" &&
        message.label.trim()
      )
        gestures.current.send(message.label.trim().slice(0, 80), message.data);
      if (
        message.type === "actions" &&
        Array.isArray(message.actions) &&
        spend("actions")
      )
        setActions(
          message.actions
            .filter((a): a is string => typeof a === "string")
            .slice(0, 50),
        );
      if (message.type === "result" && typeof message.cmdId === "string")
        results.current.get(message.cmdId)?.({
          ok: message.ok === true,
          value: message.value,
          error: typeof message.error === "string" ? message.error : undefined,
        });
      if (message.type === "open" && typeof message.url === "string")
        gestures.current.open(message.url);
    };
    window.addEventListener("message", onMessage);
    let lastTheme = JSON.stringify(readTheme());
    const sendTheme = () => {
      const theme = readTheme(),
        json = JSON.stringify(theme);
      if (json === lastTheme) return;
      lastTheme = json;
      frame.current?.contentWindow?.postMessage(
        { source: WIDGET_MESSAGE_SOURCE, type: "theme", theme },
        "*",
      );
    };
    const observer = new MutationObserver(sendTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    scheme?.addEventListener("change", sendTheme);
    return () => {
      window.removeEventListener("message", onMessage);
      observer.disconnect();
      scheme?.removeEventListener("change", sendTheme);
    };
  }, [id, save, emit, active]);
  return (
    <AgentHost agent={live.agent} maxWidth={widget.width}>
      <div className="ia-widget">
        <iframe
          ref={frame}
          title={widget.title}
          src={src}
          sandbox="allow-scripts"
          loading="lazy"
          style={{ height }}
          onLoad={() => {
            if (latestState.current)
              post({ type: "state", state: latestState.current.state });
            post({ type: "theme", theme: readTheme() });
            void loadUiFont().then((data) => {
              if (data) post({ type: "font", family: UI_FONT_FAMILY, data });
            });
          }}
        />
      </div>
    </AgentHost>
  );
}

function AnswerView({
  answer,
  initial,
}: {
  answer: Answer;
  initial: LiveSnapshot;
}) {
  if (answer.kind === "html")
    return (
      <HtmlAnswerView
        id={answer.id}
        threadId={answer.threadId}
        widget={answer.widget}
        initial={initial}
      />
    );
  return <DocumentAnswerView answer={answer} initial={initial} />;
}

const DOCUMENT_ACTIONS = ["set", "reset"];

function DocumentAnswerView({
  answer,
  initial,
}: {
  answer: Extract<Answer, { kind: "document" }>;
  initial: LiveSnapshot;
}) {
  const doc = answer.document;
  const [inputs, setInputs] = useState<Values | null>(null);
  const [resetCount, setResetCount] = useState(0);
  const current = useRef<Values>(defaultValues(doc));
  const apply = (next: Values) => {
    current.current = next;
    setInputs(next);
  };
  const summary = (next: Values) => {
    const computed = computedValues(doc, next);
    const metrics = Object.fromEntries(
      doc.blocks.flatMap((b) =>
        b.type === "metrics"
          ? b.items.map((m) => [
              m.label,
              formatValue(evaluate(m.value, computed), m.format),
            ])
          : [],
      ),
    );
    return { inputs: next, metrics };
  };
  const live = useLiveAnswer({
    id: answer.id,
    threadId: answer.threadId,
    initial,
    actions: DOCUMENT_ACTIONS,
    onRemoteState: (state) => apply(readInputs(doc, state)),
    onCommand: async (action, args) => {
      if (action === "reset") {
        save(defaultValues(doc));
        setResetCount((n) => n + 1);
        return summary(current.current);
      }
      const changes = args[0];
      if (!changes || typeof changes !== "object" || Array.isArray(changes))
        throw new Error(
          `Pass an object of control values, e.g. {"${doc.controls[0]?.id ?? "control"}": …}.`,
        );
      for (const [name, value] of Object.entries(changes)) {
        const control = doc.controls.find((c) => c.id === name);
        if (!control)
          throw new Error(
            `Unknown control "${name}". Controls: ${doc.controls.map((c) => c.id).join(", ")}.`,
          );
        if (!validValue(control, value))
          throw new Error(`Invalid value for "${name}".`);
      }
      save({ ...current.current, ...(changes as Values) });
      return summary(current.current);
    },
  });
  const shown = inputs ?? readInputs(doc, initial.state);
  current.current = shown;
  const values = computedValues(doc, shown);
  function save(next: Values) {
    apply(next);
    live.save(next);
  }
  return (
    <AgentHost agent={live.agent}>
      <article
        className="ia-answer"
        aria-label={doc.title}
        onPointerDownCapture={live.active}
        onKeyDownCapture={live.active}
      >
        <header>
          <div>
            <span className="ia-eyebrow">Explore</span>
            <h3>{doc.title}</h3>
          </div>
          {doc.controls.length > 0 && (
            <button
              type="button"
              className="ia-reset"
              title="Reset inputs"
              aria-label="Reset inputs"
              onClick={() => {
                save(defaultValues(doc));
                setResetCount((n) => n + 1);
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" />
              </svg>
            </button>
          )}
        </header>
        {doc.description && <p className="ia-description">{doc.description}</p>}
        {doc.controls.length > 0 && (
          <div className="ia-controls" key={resetCount}>
            {doc.controls.map((c) => (
              <Input
                key={c.id}
                control={c}
                value={shown[c.id]}
                onChange={(value) => save({ ...shown, [c.id]: value })}
              />
            ))}
          </div>
        )}
        <div className="ia-blocks">
          {doc.blocks.map((b, i) => {
            if (b.when && shown[b.when.control] !== b.when.equals) return null;
            switch (b.type) {
              case "diagram":
                return (
                  <Diagram
                    key={i}
                    block={b}
                    values={values}
                    onChoose={(control, value) =>
                      save({ ...shown, [control]: value })
                    }
                  />
                );
              case "text":
                return (
                  <section key={i}>
                    {b.title && <h4>{b.title}</h4>}
                    <p>{b.text}</p>
                  </section>
                );
              case "metrics":
                return (
                  <dl className="ia-metrics" key={i} aria-live="polite">
                    {b.items.map((m, j) => (
                      <div key={j}>
                        <dt>{m.label}</dt>
                        <dd>
                          {formatValue(evaluate(m.value, values), m.format)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                );
              case "chart":
                return <Chart key={i} block={b} values={values} />;
              case "details":
                return (
                  <details key={i}>
                    <summary>{b.title}</summary>
                    <p>{b.text}</p>
                  </details>
                );
              case "table":
                return (
                  <section key={i}>
                    <div className="ia-table-scroll">
                      <table>
                        <caption>{b.title}</caption>
                        <thead>
                          <tr>
                            {b.columns.map((c, j) => (
                              <th key={j} scope="col">
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {b.rows.map((row, j) => (
                            <tr key={j}>
                              {row.map((v, k) => (
                                <td key={k}>
                                  {typeof v === "string"
                                    ? v
                                    : formatValue(
                                        evaluate(v, values),
                                        b.format,
                                      )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                );
            }
          })}
        </div>
      </article>
    </AgentHost>
  );
}

function AnswerDirective({ attributes, message }: PluginMessageDirectiveProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [answer, setAnswer] = useState<{
    answer: Answer;
    initial: LiveSnapshot;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const id = attributes.id;
  const threadId = message.threadId;
  useEffect(() => {
    let active = true;
    setAnswer(null);
    setError(null);
    if (!idSchema.safeParse(id).success) {
      setError("This interactive answer has an invalid ID.");
      return;
    }
    void Promise.all([
      rpc.call("get", { id, threadId }),
      rpc.call("getState", { id, threadId }),
    ])
      .then(([value, initial]) => {
        if (active) setAnswer({ answer: value, initial });
      })
      .catch((err: unknown) => {
        if (active)
          setError(
            err instanceof Error ? err.message : "Could not load this answer.",
          );
      });
    return () => {
      active = false;
    };
  }, [rpc, id, threadId, attempt]);
  if (error)
    return (
      <div className="ia-answer ia-error" role="alert">
        <p>{error}</p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </div>
    );
  return answer ? (
    <AnswerView
      key={`${answer.answer.threadId}:${answer.answer.id}`}
      answer={answer.answer}
      initial={answer.initial}
    />
  ) : (
    <div className="ia-answer" role="status">
      Loading interactive answer…
    </div>
  );
}
export default definePluginApp((app) => {
  app.slots.messageDirective({
    id: "interactive-answer",
    component: AnswerDirective,
  });
});
