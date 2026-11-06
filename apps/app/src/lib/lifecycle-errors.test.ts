import { describe, expect, it } from "vitest";
import type { LifecycleApiError } from "@bb/server-contract";
import { HttpError } from "./api";
import {
  describeLifecycleError,
  formatLifecycleErrorDescription,
  type LifecycleErrorDescription,
} from "./lifecycle-errors";

type Details<Code extends LifecycleApiError["code"]> = Extract<
  LifecycleApiError,
  { code: Code }
>["details"];

type Expected = [
  severity: LifecycleErrorDescription["severity"],
  title: string,
  body: string,
];

function httpError(body: LifecycleApiError): HttpError {
  return new HttpError({
    body,
    code: body.code,
    message: body.message,
    status: 409,
  });
}

function environmentNotReady(
  environmentStatus: Details<"environment_not_ready">["environmentStatus"],
): LifecycleApiError {
  return {
    code: "environment_not_ready",
    message: "Environment unavailable",
    details: { environmentStatus, hasPath: false },
  };
}

function threadEnvironmentUnavailable(
  reason: Details<"thread_environment_unavailable">["reason"],
  environmentStatus: Details<"thread_environment_unavailable">["environmentStatus"],
): LifecycleApiError {
  return {
    code: "thread_environment_unavailable",
    message: "Thread environment is unavailable",
    details: { environmentStatus, reason },
  };
}

function threadNotWritable(
  reason: Details<"thread_not_writable">["reason"],
  threadStatus: Details<"thread_not_writable">["threadStatus"],
  archivedAt: number | null = null,
): LifecycleApiError {
  return {
    code: "thread_not_writable",
    message: "Thread is not writable",
    details: { archivedAt, reason, threadStatus },
  };
}

function hostUnavailable(
  details: Details<"host_unavailable">,
): LifecycleApiError {
  return { code: "host_unavailable", message: "Host unavailable", details };
}

function projectUnavailable(
  reason: Details<"project_unavailable">["reason"],
  deletedAt: number | null,
): LifecycleApiError {
  return {
    code: "project_unavailable",
    message: "Project unavailable",
    details: { deletedAt, reason },
  };
}

function parentThreadInvalid(
  reason: Details<"parent_thread_invalid">["reason"],
  subject: Details<"parent_thread_invalid">["subject"] = "parent",
): LifecycleApiError {
  return {
    code: "parent_thread_invalid",
    message: "Parent thread is invalid",
    details: { reason, subject },
  };
}

const descriptionCases: Array<[string, LifecycleApiError, Expected]> = [
  [
    "environment_not_ready provisioning",
    environmentNotReady("provisioning"),
    ["info", "Workspace starting", "Workspace is still starting."],
  ],
  [
    "environment_not_ready ready",
    environmentNotReady("ready"),
    ["warning", "Workspace unavailable", "Workspace is unavailable."],
  ],
  [
    "environment_not_ready error",
    environmentNotReady("error"),
    ["error", "Workspace setup failed", "Workspace setup failed."],
  ],
  [
    "environment_not_ready destroyed archived thread",
    environmentNotReady("destroyed"),
    ["warning", "Workspace unavailable", "Workspace no longer exists."],
  ],
  [
    "thread_environment_unavailable never attached",
    threadEnvironmentUnavailable("never_attached", null),
    ["info", "Workspace unavailable", "Workspace is not available yet."],
  ],
  [
    "thread_environment_unavailable destroyed",
    threadEnvironmentUnavailable("destroyed", "destroyed"),
    ["warning", "Workspace unavailable", "Workspace no longer exists."],
  ],
  [
    "thread_environment_unavailable provisioning",
    threadEnvironmentUnavailable("provisioning", "provisioning"),
    ["info", "Workspace starting", "Workspace is still starting."],
  ],
  [
    "thread_environment_unavailable errored",
    threadEnvironmentUnavailable("errored", "error"),
    ["error", "Workspace setup failed", "Workspace setup failed."],
  ],
  [
    "thread_not_writable archived",
    threadNotWritable("archived", "idle", 10),
    ["info", "Thread archived", "Unarchive the thread first."],
  ],
  [
    "thread_not_writable stopping",
    threadNotWritable("stopping", "stopping"),
    ["warning", "Thread stopping", "The thread is stopping."],
  ],
  [
    "thread_not_writable deleted",
    threadNotWritable("deleted", "idle"),
    ["error", "Thread deleted", "This thread was deleted."],
  ],
  [
    "thread_not_writable not started while starting",
    threadNotWritable("not_started", "starting"),
    ["info", "Thread starting", "The thread is still starting."],
  ],
  [
    "thread_not_writable not active",
    threadNotWritable("not_active", "idle"),
    ["warning", "Thread not running", "The thread is not running."],
  ],
  [
    "thread_not_writable errored",
    threadNotWritable("errored", "error"),
    ["error", "Thread failed", "This thread failed and cannot continue."],
  ],
  [
    "thread_not_writable already active",
    threadNotWritable("already_active", "active"),
    ["warning", "Thread already running", "The thread is already running."],
  ],
  [
    "thread_not_writable still starting",
    threadNotWritable("still_starting", "starting"),
    ["info", "Thread starting", "The thread is still starting."],
  ],
  [
    "host_unavailable suspended",
    hostUnavailable({
      destroyedAt: null,
      hostStatus: "disconnected",
      reason: "suspended",
      suspendedAt: 10,
    }),
    ["warning", "Host paused", "Host is paused."],
  ],
  [
    "host_unavailable disconnected",
    hostUnavailable({
      destroyedAt: null,
      hostStatus: "disconnected",
      reason: "disconnected",
      suspendedAt: null,
    }),
    ["warning", "Host offline", "Host is offline."],
  ],
  [
    "host_unavailable destroyed",
    hostUnavailable({
      destroyedAt: 10,
      hostStatus: null,
      reason: "destroyed",
      suspendedAt: null,
    }),
    ["error", "Host removed", "Host was removed."],
  ],
  [
    "project_unavailable pending deletion",
    projectUnavailable("pending_deletion", null),
    ["info", "Project deletion in progress", "This project is being deleted."],
  ],
  [
    "project_unavailable deleted",
    projectUnavailable("deleted", 10),
    ["error", "Project deleted", "This project was deleted."],
  ],
  [
    "parent_thread_invalid not found",
    parentThreadInvalid("not_found"),
    [
      "error",
      "Parent thread unavailable",
      "That parent thread no longer exists.",
    ],
  ],
  [
    "parent_thread_invalid archived",
    parentThreadInvalid("archived"),
    [
      "warning",
      "Parent thread unavailable",
      "Unarchive the parent thread first or choose another parent.",
    ],
  ],
  [
    "parent_thread_invalid deleted",
    parentThreadInvalid("deleted"),
    ["error", "Parent thread unavailable", "That parent thread was deleted."],
  ],
  [
    "parent_thread_invalid self",
    parentThreadInvalid("self"),
    [
      "error",
      "Parent thread unavailable",
      "A thread cannot be its own parent.",
    ],
  ],
  [
    "parent_thread_invalid cycle",
    parentThreadInvalid("cycle"),
    [
      "error",
      "Parent thread unavailable",
      "Choose a thread that is not a child of this thread.",
    ],
  ],
  [
    "parent_thread_invalid too deep",
    parentThreadInvalid("too_deep"),
    [
      "error",
      "Parent thread unavailable",
      "Thread nesting is limited to 4 levels.",
    ],
  ],
  [
    "parent_thread_invalid sender",
    parentThreadInvalid("not_found", "sender"),
    [
      "error",
      "Sender thread unavailable",
      "The sender thread no longer exists.",
    ],
  ],
  [
    "dispatch_rejected shows the plugin's message verbatim",
    {
      code: "dispatch_rejected",
      message: "Sandbox quota is exhausted. Free a slot first.",
      details: { pluginId: "policy-guard" },
    },
    [
      "warning",
      "Blocked by a plugin",
      'Blocked by the "policy-guard" plugin: Sandbox quota is exhausted. Free a slot first.',
    ],
  ],
  [
    "dispatch_hook_failed adds the recovery hint",
    {
      code: "dispatch_hook_failed",
      message:
        'The "policy-guard" plugin\'s message.dispatch hook failed: did not decide within 5000ms',
      details: { pluginId: "policy-guard" },
    },
    [
      "error",
      "Plugin dispatch hook failed",
      'The "policy-guard" plugin\'s message.dispatch hook failed: did not decide within 5000ms. Disable that plugin to continue.',
    ],
  ],
];

describe("describeLifecycleError", () => {
  it.each(descriptionCases)("%s", (_name, body, [severity, title, text]) => {
    expect(describeLifecycleError({ error: httpError(body) })).toEqual({
      title,
      body: text,
      severity,
    });
  });

  it("uses operation titles while keeping lifecycle reason text", () => {
    expect(
      describeLifecycleError({
        error: httpError(environmentNotReady("destroyed")),
        operation: "load_diff",
      }),
    ).toEqual({
      title: "Failed to load diff",
      body: "Workspace no longer exists.",
      severity: "warning",
    });
  });

  it("formats lifecycle descriptions as a single action-oriented message", () => {
    expect(
      formatLifecycleErrorDescription({
        title: "Failed to send message",
        body: "The thread is still starting.",
        severity: "info",
      }),
    ).toBe("Failed to send message. The thread is still starting.");
  });

  it("returns null for non-lifecycle errors", () => {
    const genericError = new HttpError({
      body: {
        code: "invalid_request",
        message: "Request failed",
      },
      code: "invalid_request",
      message: "Request failed",
      status: 400,
    });

    expect(describeLifecycleError({ error: new Error("Failed") })).toBeNull();
    expect(describeLifecycleError({ error: genericError })).toBeNull();
  });

  it("keeps a gate rejection readable under an operation title", () => {
    const pluginMessage = "This project is frozen until the release ships.";
    const body: LifecycleApiError = {
      code: "dispatch_rejected",
      message: pluginMessage,
      details: { pluginId: "release-freeze" },
    };

    const description = describeLifecycleError({
      error: httpError(body),
      operation: "send_message",
    });

    if (!description) {
      throw new Error("expected a lifecycle description");
    }
    expect(description.body).toContain(pluginMessage);
    expect(description.body).toContain('"release-freeze"');
    expect(formatLifecycleErrorDescription(description)).toBe(
      'Failed to send message. Blocked by the "release-freeze" plugin: This project is frozen until the release ships.',
    );
  });
});
