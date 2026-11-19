import {
  threadScope,
  type ThreadEventFileChange,
  type ThreadEventRow,
} from "@bb/domain";
import { expect, it } from "vitest";
import { EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT } from "../src/accepted-client-request-context.js";
import {
  buildThreadTimelineFromEvents,
  type ThreadEventWithMeta,
} from "../src/index.js";
import {
  createTimelineEventFactory,
  fromRows,
  type TimelineEventFactory,
} from "./timeline-test-harness.js";

type AnyFunction = (this: unknown, ...args: unknown[]) => unknown;

const CALLBACK_METHODS = [
  "every",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
  "sort",
] as const;
const LENGTH_SCAN_METHODS = [
  "flat",
  "includes",
  "indexOf",
  "join",
  "lastIndexOf",
  "slice",
] as const;
const ITERATOR_METHODS = [
  Symbol.iterator,
  "entries",
  "keys",
  "values",
] as const;

const iteratorPrototype: object = Object.getPrototypeOf(
  Object.getPrototypeOf([][Symbol.iterator]()),
);

function lengthOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function countWork(run: () => void): number {
  let work = 0;
  const restores: (() => void)[] = [];
  const wrap = (
    target: object,
    key: PropertyKey,
    replace: (original: AnyFunction) => AnyFunction,
  ) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (typeof descriptor?.value !== "function") return;
    Object.defineProperty(target, key, {
      ...descriptor,
      value: replace(descriptor.value),
    });
    restores.push(() => Object.defineProperty(target, key, descriptor));
  };
  const countedIterator = (inner: Iterator<unknown>) => {
    const iterator: Iterator<unknown> = Object.create(iteratorPrototype);
    iterator.next = () => {
      work += 1;
      return inner.next();
    };
    iterator.return = (value?: unknown) =>
      inner.return?.(value) ?? { done: true, value };
    return iterator;
  };
  try {
    for (const key of CALLBACK_METHODS) {
      wrap(
        Array.prototype,
        key,
        (original) =>
          function (this: unknown, callback: unknown, ...rest: unknown[]) {
            if (typeof callback !== "function") {
              work += lengthOf(this);
              return original.call(this, callback, ...rest);
            }
            return original.call(
              this,
              function (this: unknown, ...args: unknown[]) {
                work += 1;
                return Reflect.apply(callback, this, args);
              },
              ...rest,
            );
          },
      );
    }
    for (const key of LENGTH_SCAN_METHODS) {
      wrap(
        Array.prototype,
        key,
        (original) =>
          function (this: unknown, ...args: unknown[]) {
            work += lengthOf(this);
            return Reflect.apply(original, this, args);
          },
      );
    }
    wrap(
      Array.prototype,
      "concat",
      (original) =>
        function (this: unknown, ...args: unknown[]) {
          work +=
            lengthOf(this) +
            args.reduce<number>(
              (total, arg) => total + (Array.isArray(arg) ? arg.length : 1),
              0,
            );
          return Reflect.apply(original, this, args);
        },
    );
    for (const target of [Array.prototype, Map.prototype, Set.prototype]) {
      for (const key of ITERATOR_METHODS) {
        wrap(
          target,
          key,
          (original) =>
            function (this: unknown, ...args: unknown[]) {
              const inner = Reflect.apply(original, this, args);
              return countedIterator(inner as Iterator<unknown>);
            },
        );
      }
    }
    for (const target of [Map.prototype, Set.prototype]) {
      wrap(
        target,
        "forEach",
        (original) =>
          function (this: unknown, callback: unknown, ...rest: unknown[]) {
            if (typeof callback !== "function") {
              return original.call(this, callback, ...rest);
            }
            return original.call(
              this,
              function (this: unknown, ...args: unknown[]) {
                work += 1;
                return Reflect.apply(callback, this, args);
              },
              ...rest,
            );
          },
      );
    }
    for (const key of ["entries", "keys", "values"] as const) {
      wrap(
        Object,
        key,
        (original) =>
          function (this: unknown, ...args: unknown[]) {
            const result = Reflect.apply(original, this, args);
            work += lengthOf(result);
            return result;
          },
      );
    }
    run();
  } finally {
    for (const restore of restores.reverse()) restore();
  }
  return work;
}

function buildTimeline(events: ThreadEventWithMeta[]): void {
  buildThreadTimelineFromEvents({
    acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
    contextWindowEvents: [],
    events,
    options: {
      completedTurnDisplay: "collapse",
      includeNestedRows: true,
      omitSettledDelegationChildRows: false,
      includeDiagnosticOperations: false,
      summarizeShellCommands: true,
      isLatestPage: true,
      threadStatus: "idle",
      threadName: "",
      workspaceRoot: null,
    },
  });
}

function range<T>(count: number, item: (index: number) => T): T[] {
  return Array.from({ length: count }, (_, index) => item(index));
}

function oneTurn(
  build: (event: TimelineEventFactory) => ThreadEventRow[],
): ThreadEventWithMeta[] {
  const event = createTimelineEventFactory({ threadId: "thread-1" });
  return fromRows([
    event.clientTurnRequested({ text: "Do the work" }),
    event.turnStarted({ turnId: "turn-1" }),
    ...build(event),
    event.turnCompleted({ turnId: "turn-1" }),
  ]);
}

function fileChanges(count: number): ThreadEventFileChange[] {
  return range(count, (index) => ({
    path: `src/dir-${index % 37}/file-${index}.ts`,
    kind: "update",
  }));
}

function manyTurns(
  count: number,
  extra: (event: TimelineEventFactory, index: number) => ThreadEventRow[],
): ThreadEventWithMeta[] {
  const event = createTimelineEventFactory({ threadId: "thread-1" });
  return fromRows(
    range(count, (index) => {
      const turnId = `turn-${index}`;
      const command = `pnpm test ${index}`;
      return [
        event.clientTurnRequested({ text: `Request ${index}` }),
        event.turnStarted({ turnId }),
        event.commandStarted({ turnId, itemId: `command-${index}`, command }),
        ...extra(event, index),
        event.commandCompleted({
          turnId,
          itemId: `command-${index}`,
          command,
          exitCode: 0,
        }),
        event.assistantCompleted({
          turnId,
          itemId: `assistant-${index}`,
          text: `Answer ${index}`,
        }),
        event.turnCompleted({ turnId }),
      ];
    }).flat(),
  );
}

const SCENARIOS: [string, (size: number) => ThreadEventWithMeta[]][] = [
  [
    "files in one file change",
    (size) =>
      oneTurn((event) => [
        event.fileChangeStarted({ itemId: "edit", changes: fileChanges(size) }),
        event.fileChangeCompleted({
          itemId: "edit",
          changes: fileChanges(size),
        }),
      ]),
  ],
  [
    "files in one file change completed in reverse order",
    (size) =>
      oneTurn((event) => [
        event.fileChangeStarted({ itemId: "edit", changes: fileChanges(size) }),
        event.fileChangeCompleted({
          itemId: "edit",
          changes: fileChanges(size).reverse(),
        }),
      ]),
  ],
  [
    "file changes in one turn",
    (size) =>
      oneTurn((event) =>
        range(size, (index) => {
          const changes: ThreadEventFileChange[] = [
            { path: `src/file-${index}.ts`, kind: "update" },
          ];
          return [
            event.fileChangeStarted({ itemId: `edit-${index}`, changes }),
            event.fileChangeCompleted({ itemId: `edit-${index}`, changes }),
          ];
        }).flat(),
      ),
  ],
  [
    "commands in one turn",
    (size) =>
      oneTurn((event) =>
        range(size, (index) => {
          const itemId = `command-${index}`;
          const command = `pnpm test --filter pkg-${index}`;
          return [
            event.commandStarted({ itemId, command }),
            event.commandOutputDelta({ itemId, delta: `ok ${index}\n` }),
            event.commandCompleted({
              itemId,
              command,
              aggregatedOutput: `ok ${index}\n`,
              exitCode: 0,
            }),
          ];
        }).flat(),
      ),
  ],
  [
    "output deltas on one command",
    (size) =>
      oneTurn((event) => [
        event.commandStarted({ itemId: "command", command: "pnpm build" }),
        ...range(size, (index) =>
          event.commandOutputDelta({
            itemId: "command",
            delta: `line ${index}\n`,
          }),
        ),
        event.commandCompleted({
          itemId: "command",
          command: "pnpm build",
          exitCode: 0,
        }),
      ]),
  ],
  [
    "assistant messages in one turn",
    (size) =>
      oneTurn((event) =>
        range(size, (index) => [
          event.assistantDelta({
            itemId: `assistant-${index}`,
            delta: `Step ${index}`,
          }),
          event.assistantCompleted({
            itemId: `assistant-${index}`,
            text: `Step ${index}`,
          }),
        ]).flat(),
      ),
  ],
  [
    "deltas on one assistant message",
    (size) =>
      oneTurn((event) => [
        ...range(size, (index) =>
          event.assistantDelta({ itemId: "assistant", delta: `word${index} ` }),
        ),
        event.assistantCompleted({ itemId: "assistant", text: "done" }),
      ]),
  ],
  [
    "deltas on one reasoning item",
    (size) =>
      oneTurn((event) => [
        event.reasoningStarted({ itemId: "reasoning" }),
        ...range(size, (index) =>
          event.reasoningDelta({ itemId: "reasoning", delta: `idea${index} ` }),
        ),
        event.reasoningCompleted({ itemId: "reasoning", text: "done" }),
      ]),
  ],
  [
    "tool calls in one turn",
    (size) =>
      oneTurn((event) =>
        range(size, (index) => [
          event.toolCallStarted({ itemId: `tool-${index}`, tool: "lookup" }),
          event.toolCallCompleted({
            itemId: `tool-${index}`,
            tool: "lookup",
            result: index,
          }),
        ]).flat(),
      ),
  ],
  [
    "file reads and searches in one turn",
    (size) =>
      oneTurn((event) =>
        range(size, (index) => [
          event.fileReadStarted({
            itemId: `read-${index}`,
            path: `src/file-${index}.ts`,
          }),
          event.fileReadCompleted({
            itemId: `read-${index}`,
            path: `src/file-${index}.ts`,
          }),
          event.searchStarted({
            itemId: `search-${index}`,
            mode: "content",
            query: `needle${index}`,
          }),
          event.searchCompleted({
            itemId: `search-${index}`,
            mode: "content",
            query: `needle${index}`,
          }),
        ]).flat(),
      ),
  ],
  [
    "web searches in one turn",
    (size) =>
      oneTurn((event) =>
        range(size, (index) => [
          event.webSearchStarted({
            itemId: `web-${index}`,
            queries: [`query ${index}`],
          }),
          event.webSearchCompleted({
            itemId: `web-${index}`,
            queries: [`query ${index}`],
          }),
        ]).flat(),
      ),
  ],
  [
    "plan updates in one turn",
    (size) =>
      oneTurn((event) =>
        range(size, (index) =>
          event.turnPlanUpdated({
            plan: [
              { step: `step ${index}`, status: "completed" },
              { step: `step ${index + 1}`, status: "active" },
            ],
          }),
        ),
      ),
  ],
  [
    "delegations in one turn",
    (size) =>
      oneTurn((event) =>
        range(size, (index) => [
          event.delegationStarted({
            itemId: `delegate-${index}`,
            childRef: `thr_child${index}`,
            label: `Worker ${index}`,
          }),
          event.delegationCompleted({
            itemId: `delegate-${index}`,
            childRef: `thr_child${index}`,
            label: `Worker ${index}`,
            summary: `Finished ${index}`,
          }),
        ]).flat(),
      ),
  ],
  [
    "user messages sent while one turn runs",
    (size) =>
      oneTurn((event) =>
        range(size, (index) => [
          event.clientTurnRequested({ text: `Also check ${index}` }),
          event.assistantCompleted({
            itemId: `assistant-${index}`,
            text: `Checked ${index}`,
          }),
        ]).flat(),
      ),
  ],
  ["turns in one thread", (size) => manyTurns(size, () => [])],
  [
    "turns that each raise a thread-scoped permission prompt",
    (size) =>
      manyTurns(size, (event, index) => [
        {
          ...event.permissionGrantLifecycle({
            interactionId: `pi_${index}`,
            itemId: `item_${index}`,
            providerRequestId: `request-${index}`,
          }),
          scope: threadScope(),
        },
      ]),
  ],
];

const SMALL = 100;
const GROWTH = 4;

it.each(SCENARIOS)(
  "keeps timeline build work proportional to the number of %s",
  (_, scenario) => {
    const small = scenario(SMALL);
    const large = scenario(SMALL * GROWTH);
    buildTimeline(small);
    buildTimeline(large);
    const smallWork = countWork(() => buildTimeline(small));
    const largeWork = countWork(() => buildTimeline(large));
    expect(smallWork).toBeGreaterThan(SMALL);
    expect(largeWork / smallWork).toBeLessThan(GROWTH * 1.5);
  },
);
