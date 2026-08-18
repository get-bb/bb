// Portable type declarations for `@get-bb/plugin-sdk`. Unpublished BB
// workspace contracts are flattened; public subpaths may reuse the
// package root without requiring any other @bb/* package.
//
// Confused by the API, or need a symbol that isn't here? Clone the BB repo
// and read the real source: https://github.com/get-bb/bb

import { z } from 'zod';

declare const acpReasoningCliSchema: z.ZodObject<{
    defaultLevel: z.ZodOptional<z.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        none: "none";
        ultra: "ultra";
        ultracode: "ultracode";
        xhigh: "xhigh";
    }>>;
    flag: z.ZodString;
    levelValues: z.ZodOptional<z.ZodRecord<z.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        none: "none";
        ultra: "ultra";
        ultracode: "ultracode";
        xhigh: "xhigh";
    }> & z.core.$partial, z.ZodString>>;
    supportedLevels: z.ZodArray<z.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        none: "none";
        ultra: "ultra";
        ultracode: "ultracode";
        xhigh: "xhigh";
    }>>;
}, z.core.$strict>;
declare const acpNativeReasoningSchema: z.ZodObject<{
    configId: z.ZodString;
    defaultLevel: z.ZodOptional<z.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        none: "none";
        ultra: "ultra";
        ultracode: "ultracode";
        xhigh: "xhigh";
    }>>;
    levelValues: z.ZodOptional<z.ZodRecord<z.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        none: "none";
        ultra: "ultra";
        ultracode: "ultracode";
        xhigh: "xhigh";
    }> & z.core.$partial, z.ZodString>>;
    supportedLevels: z.ZodArray<z.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        none: "none";
        ultra: "ultra";
        ultracode: "ultracode";
        xhigh: "xhigh";
    }>>;
}, z.core.$strict>;
declare const acpPermissionCliSchema: z.ZodObject<{
    full: z.ZodOptional<z.ZodArray<z.ZodString>>;
    insertAfterArgs: z.ZodOptional<z.ZodNumber>;
    readonly: z.ZodOptional<z.ZodArray<z.ZodString>>;
    workspaceWrite: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;

interface JsonObject {
    [key: string]: JsonValue;
}
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
declare const jsonValueSchema: z.ZodType<JsonValue>;

/**
 * Raw SDK task-type discriminants for the background tasks bb materializes as
 * timeline rows: dynamic workflows (the Workflow tool), backgrounded shell
 * commands (Bash with run_in_background), and backgrounded subagents. They
 * share the provider task event family (task_started / task_progress /
 * task_updated / task_notification). Other task types such as monitors share
 * the family too but are not materialized.
 */
declare const LOCAL_WORKFLOW_TASK_TYPE = "local_workflow";
declare const LOCAL_BASH_TASK_TYPE = "local_bash";
declare function isBackgroundAgentTaskType(taskType: string): boolean;
declare const backgroundTaskStatusSchema: z.ZodEnum<{
    completed: "completed";
    failed: "failed";
    killed: "killed";
    paused: "paused";
    pending: "pending";
    running: "running";
    stopped: "stopped";
}>;
type BackgroundTaskStatus = z.infer<typeof backgroundTaskStatusSchema>;
declare const workflowAgentStateSchema: z.ZodEnum<{
    done: "done";
    failed: "failed";
    queued: "queued";
    running: "running";
    skipped: "skipped";
}>;
type WorkflowAgentState = z.infer<typeof workflowAgentStateSchema>;
declare const workflowAgentSnapshotSchema: z.ZodObject<{
    agentType: z.ZodOptional<z.ZodString>;
    attempt: z.ZodNumber;
    cached: z.ZodBoolean;
    durationMs: z.ZodOptional<z.ZodNumber>;
    error: z.ZodOptional<z.ZodString>;
    index: z.ZodNumber;
    isolation: z.ZodOptional<z.ZodString>;
    label: z.ZodString;
    lastProgressAt: z.ZodNumber;
    lastToolName: z.ZodOptional<z.ZodString>;
    lastToolSummary: z.ZodOptional<z.ZodString>;
    model: z.ZodString;
    phaseIndex: z.ZodOptional<z.ZodNumber>;
    phaseTitle: z.ZodOptional<z.ZodString>;
    promptPreview: z.ZodOptional<z.ZodString>;
    queuedAt: z.ZodOptional<z.ZodNumber>;
    resultPreview: z.ZodOptional<z.ZodString>;
    startedAt: z.ZodOptional<z.ZodNumber>;
    state: z.ZodEnum<{
        done: "done";
        failed: "failed";
        queued: "queued";
        running: "running";
        skipped: "skipped";
    }>;
    tokens: z.ZodOptional<z.ZodNumber>;
    toolCalls: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
type WorkflowAgentSnapshot = z.infer<typeof workflowAgentSnapshotSchema>;
declare const workflowPhaseSnapshotSchema: z.ZodObject<{
    index: z.ZodNumber;
    kind: z.ZodOptional<z.ZodString>;
    title: z.ZodString;
}, z.core.$strip>;
type WorkflowPhaseSnapshot = z.infer<typeof workflowPhaseSnapshotSchema>;
/**
 * Full merged workflow state at a point in time. Providers emit progress as
 * delta batches; the adapter folds them by (record type, index) so every
 * persisted snapshot supersedes the previous one.
 */
declare const workflowProgressSnapshotSchema: z.ZodObject<{
    agents: z.ZodArray<z.ZodObject<{
        agentType: z.ZodOptional<z.ZodString>;
        attempt: z.ZodNumber;
        cached: z.ZodBoolean;
        durationMs: z.ZodOptional<z.ZodNumber>;
        error: z.ZodOptional<z.ZodString>;
        index: z.ZodNumber;
        isolation: z.ZodOptional<z.ZodString>;
        label: z.ZodString;
        lastProgressAt: z.ZodNumber;
        lastToolName: z.ZodOptional<z.ZodString>;
        lastToolSummary: z.ZodOptional<z.ZodString>;
        model: z.ZodString;
        phaseIndex: z.ZodOptional<z.ZodNumber>;
        phaseTitle: z.ZodOptional<z.ZodString>;
        promptPreview: z.ZodOptional<z.ZodString>;
        queuedAt: z.ZodOptional<z.ZodNumber>;
        resultPreview: z.ZodOptional<z.ZodString>;
        startedAt: z.ZodOptional<z.ZodNumber>;
        state: z.ZodEnum<{
            done: "done";
            failed: "failed";
            queued: "queued";
            running: "running";
            skipped: "skipped";
        }>;
        tokens: z.ZodOptional<z.ZodNumber>;
        toolCalls: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    phases: z.ZodArray<z.ZodObject<{
        index: z.ZodNumber;
        kind: z.ZodOptional<z.ZodString>;
        title: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
type WorkflowProgressSnapshot = z.infer<typeof workflowProgressSnapshotSchema>;
declare const backgroundTaskUsageSchema: z.ZodObject<{
    durationMs: z.ZodNumber;
    toolUses: z.ZodNumber;
    totalTokens: z.ZodNumber;
}, z.core.$strip>;
type BackgroundTaskUsage = z.infer<typeof backgroundTaskUsageSchema>;
/**
 * Canonical derivation from the provider-reported task status to the shared
 * item-status machinery: paused stays pending because a paused workflow is
 * resumable; stopped maps to interrupted (user/system stop, not a failure).
 */
declare function backgroundTaskItemStatus(taskStatus: BackgroundTaskStatus): "completed" | "failed" | "interrupted" | "pending";
/**
 * Whether the provider-reported status already describes a finished task.
 * Settle backstops (thread restart, daemon crash, lease expiry) must preserve
 * these statuses instead of rewriting them to "stopped": a workflow whose
 * completion patch arrived before its terminal notification is completed, not
 * interrupted.
 */
declare function isSettledBackgroundTaskStatus(taskStatus: BackgroundTaskStatus): boolean;

declare const claudeTaskToolNameSchema: z.ZodEnum<{
    TaskCreate: "TaskCreate";
    TaskGet: "TaskGet";
    TaskList: "TaskList";
    TaskUpdate: "TaskUpdate";
}>;
declare const claudeTaskToolOutputSchema: z.ZodUnion<readonly [z.ZodObject<{
    task: z.ZodObject<{
        id: z.ZodString;
        subject: z.ZodString;
    }, z.core.$loose>;
}, z.core.$loose>, z.ZodObject<{
    task: z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        status: z.ZodEnum<{
            completed: "completed";
            in_progress: "in_progress";
            pending: "pending";
        }>;
        subject: z.ZodString;
    }, z.core.$loose>>;
}, z.core.$loose>, z.ZodObject<{
    tasks: z.ZodArray<z.ZodUnknown>;
}, z.core.$loose>, z.ZodObject<{
    success: z.ZodBoolean;
    taskId: z.ZodString;
}, z.core.$loose>]>;
type ClaudeTaskToolOutput = z.infer<typeof claudeTaskToolOutputSchema>;

declare function toPositiveNumber(value: unknown): number | undefined;

declare const pendingInteractionCommandActionSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    command: z.ZodString;
    name: z.ZodString;
    path: z.ZodString;
    type: z.ZodLiteral<"read">;
}, z.core.$strip>, z.ZodObject<{
    command: z.ZodString;
    path: z.ZodNullable<z.ZodString>;
    type: z.ZodLiteral<"listFiles">;
}, z.core.$strip>, z.ZodObject<{
    command: z.ZodString;
    path: z.ZodNullable<z.ZodString>;
    query: z.ZodNullable<z.ZodString>;
    type: z.ZodLiteral<"search">;
}, z.core.$strip>, z.ZodObject<{
    command: z.ZodString;
    type: z.ZodLiteral<"unknown">;
}, z.core.$strip>], "type">;
type PendingInteractionCommandAction = z.infer<typeof pendingInteractionCommandActionSchema>;
declare const pendingInteractionNetworkPermissionsSchema: z.ZodObject<{
    enabled: z.ZodNullable<z.ZodBoolean>;
}, z.core.$strip>;
declare const pendingInteractionFileSystemPermissionsSchema: z.ZodObject<{
    read: z.ZodArray<z.ZodString>;
    write: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
declare const pendingInteractionMacOsPermissionsSchema: z.ZodObject<{
    accessibility: z.ZodBoolean;
    automations: z.ZodUnion<readonly [z.ZodLiteral<"none">, z.ZodLiteral<"all">, z.ZodObject<{
        bundleIds: z.ZodArray<z.ZodString>;
        kind: z.ZodLiteral<"bundle_ids">;
    }, z.core.$strip>]>;
    calendar: z.ZodBoolean;
    contacts: z.ZodEnum<{
        none: "none";
        read_only: "read_only";
        read_write: "read_write";
    }>;
    launchServices: z.ZodBoolean;
    preferences: z.ZodEnum<{
        none: "none";
        read_only: "read_only";
        read_write: "read_write";
    }>;
    reminders: z.ZodBoolean;
}, z.core.$strip>;
declare const pendingInteractionRequestedPermissionProfileSchema: z.ZodObject<{
    fileSystem: z.ZodNullable<z.ZodObject<{
        read: z.ZodArray<z.ZodString>;
        write: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    macos: z.ZodNullable<z.ZodObject<{
        accessibility: z.ZodBoolean;
        automations: z.ZodUnion<readonly [z.ZodLiteral<"none">, z.ZodLiteral<"all">, z.ZodObject<{
            bundleIds: z.ZodArray<z.ZodString>;
            kind: z.ZodLiteral<"bundle_ids">;
        }, z.core.$strip>]>;
        calendar: z.ZodBoolean;
        contacts: z.ZodEnum<{
            none: "none";
            read_only: "read_only";
            read_write: "read_write";
        }>;
        launchServices: z.ZodBoolean;
        preferences: z.ZodEnum<{
            none: "none";
            read_only: "read_only";
            read_write: "read_write";
        }>;
        reminders: z.ZodBoolean;
    }, z.core.$strip>>;
    network: z.ZodNullable<z.ZodObject<{
        enabled: z.ZodNullable<z.ZodBoolean>;
    }, z.core.$strip>>;
}, z.core.$strip>;
type PendingInteractionRequestedPermissionProfile = z.infer<typeof pendingInteractionRequestedPermissionProfileSchema>;
declare const pendingInteractionGrantablePermissionProfileSchema: z.ZodObject<{
    fileSystem: z.ZodNullable<z.ZodObject<{
        read: z.ZodArray<z.ZodString>;
        write: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    network: z.ZodNullable<z.ZodObject<{
        enabled: z.ZodNullable<z.ZodBoolean>;
    }, z.core.$strip>>;
}, z.core.$strict>;
type PendingInteractionGrantablePermissionProfile = z.infer<typeof pendingInteractionGrantablePermissionProfileSchema>;
declare const pendingInteractionGrantedPermissionProfileSchema: z.ZodObject<{
    fileSystem: z.ZodNullable<z.ZodObject<{
        read: z.ZodArray<z.ZodString>;
        write: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    network: z.ZodNullable<z.ZodObject<{
        enabled: z.ZodNullable<z.ZodBoolean>;
    }, z.core.$strip>>;
}, z.core.$strict>;
type PendingInteractionGrantedPermissionProfile = z.infer<typeof pendingInteractionGrantedPermissionProfileSchema>;
declare const pendingInteractionApprovalDecisionSchema: z.ZodEnum<{
    allow_for_session: "allow_for_session";
    allow_once: "allow_once";
    deny: "deny";
}>;
type PendingInteractionApprovalDecision = z.infer<typeof pendingInteractionApprovalDecisionSchema>;
declare const pendingInteractionApprovalSubjectSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    actions: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        command: z.ZodString;
        name: z.ZodString;
        path: z.ZodString;
        type: z.ZodLiteral<"read">;
    }, z.core.$strip>, z.ZodObject<{
        command: z.ZodString;
        path: z.ZodNullable<z.ZodString>;
        type: z.ZodLiteral<"listFiles">;
    }, z.core.$strip>, z.ZodObject<{
        command: z.ZodString;
        path: z.ZodNullable<z.ZodString>;
        query: z.ZodNullable<z.ZodString>;
        type: z.ZodLiteral<"search">;
    }, z.core.$strip>, z.ZodObject<{
        command: z.ZodString;
        type: z.ZodLiteral<"unknown">;
    }, z.core.$strip>], "type">>;
    command: z.ZodString;
    cwd: z.ZodNullable<z.ZodString>;
    itemId: z.ZodString;
    kind: z.ZodLiteral<"command">;
    sessionGrant: z.ZodNullable<z.ZodObject<{
        fileSystem: z.ZodNullable<z.ZodObject<{
            read: z.ZodArray<z.ZodString>;
            write: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
        network: z.ZodNullable<z.ZodObject<{
            enabled: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strict>>;
}, z.core.$strip>, z.ZodObject<{
    itemId: z.ZodString;
    kind: z.ZodLiteral<"file_change">;
    sessionGrant: z.ZodNullable<z.ZodObject<{
        fileSystem: z.ZodNullable<z.ZodObject<{
            read: z.ZodArray<z.ZodString>;
            write: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
        network: z.ZodNullable<z.ZodObject<{
            enabled: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strict>>;
    writeScope: z.ZodNullable<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    itemId: z.ZodString;
    kind: z.ZodLiteral<"permission_grant">;
    permissions: z.ZodObject<{
        fileSystem: z.ZodNullable<z.ZodObject<{
            read: z.ZodArray<z.ZodString>;
            write: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
        network: z.ZodNullable<z.ZodObject<{
            enabled: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strict>;
    toolName: z.ZodNullable<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    itemId: z.ZodString;
    kind: z.ZodLiteral<"plan">;
    plan: z.ZodString;
    planFilePath: z.ZodNullable<z.ZodString>;
}, z.core.$strip>], "kind">;
type PendingInteractionApprovalSubject = z.infer<typeof pendingInteractionApprovalSubjectSchema>;
declare const approvalPendingInteractionPayloadSchema: z.ZodObject<{
    availableDecisions: z.ZodArray<z.ZodEnum<{
        allow_for_session: "allow_for_session";
        allow_once: "allow_once";
        deny: "deny";
    }>>;
    kind: z.ZodLiteral<"approval">;
    reason: z.ZodNullable<z.ZodString>;
    subject: z.ZodDiscriminatedUnion<[z.ZodObject<{
        actions: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            command: z.ZodString;
            name: z.ZodString;
            path: z.ZodString;
            type: z.ZodLiteral<"read">;
        }, z.core.$strip>, z.ZodObject<{
            command: z.ZodString;
            path: z.ZodNullable<z.ZodString>;
            type: z.ZodLiteral<"listFiles">;
        }, z.core.$strip>, z.ZodObject<{
            command: z.ZodString;
            path: z.ZodNullable<z.ZodString>;
            query: z.ZodNullable<z.ZodString>;
            type: z.ZodLiteral<"search">;
        }, z.core.$strip>, z.ZodObject<{
            command: z.ZodString;
            type: z.ZodLiteral<"unknown">;
        }, z.core.$strip>], "type">>;
        command: z.ZodString;
        cwd: z.ZodNullable<z.ZodString>;
        itemId: z.ZodString;
        kind: z.ZodLiteral<"command">;
        sessionGrant: z.ZodNullable<z.ZodObject<{
            fileSystem: z.ZodNullable<z.ZodObject<{
                read: z.ZodArray<z.ZodString>;
                write: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
            network: z.ZodNullable<z.ZodObject<{
                enabled: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>>;
        }, z.core.$strict>>;
    }, z.core.$strip>, z.ZodObject<{
        itemId: z.ZodString;
        kind: z.ZodLiteral<"file_change">;
        sessionGrant: z.ZodNullable<z.ZodObject<{
            fileSystem: z.ZodNullable<z.ZodObject<{
                read: z.ZodArray<z.ZodString>;
                write: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
            network: z.ZodNullable<z.ZodObject<{
                enabled: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>>;
        }, z.core.$strict>>;
        writeScope: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        itemId: z.ZodString;
        kind: z.ZodLiteral<"permission_grant">;
        permissions: z.ZodObject<{
            fileSystem: z.ZodNullable<z.ZodObject<{
                read: z.ZodArray<z.ZodString>;
                write: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
            network: z.ZodNullable<z.ZodObject<{
                enabled: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>>;
        }, z.core.$strict>;
        toolName: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        itemId: z.ZodString;
        kind: z.ZodLiteral<"plan">;
        plan: z.ZodString;
        planFilePath: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>], "kind">;
}, z.core.$strip>;
type ApprovalPendingInteractionPayload = z.infer<typeof approvalPendingInteractionPayloadSchema>;
declare const USER_QUESTION_MAX_QUESTIONS = 4;
declare const USER_QUESTION_MAX_OPTIONS = 4;
declare const pendingInteractionUserQuestionQuestionSchema: z.ZodObject<{
    allowFreeText: z.ZodBoolean;
    id: z.ZodString;
    multiSelect: z.ZodBoolean;
    options: z.ZodOptional<z.ZodArray<z.ZodObject<{
        description: z.ZodOptional<z.ZodString>;
        label: z.ZodString;
        value: z.ZodString;
    }, z.core.$strip>>>;
    prompt: z.ZodString;
    shortLabel: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type PendingInteractionUserQuestionQuestion = z.infer<typeof pendingInteractionUserQuestionQuestionSchema>;
declare const userQuestionPendingInteractionPayloadSchema: z.ZodObject<{
    kind: z.ZodLiteral<"user_question">;
    questions: z.ZodArray<z.ZodObject<{
        allowFreeText: z.ZodBoolean;
        id: z.ZodString;
        multiSelect: z.ZodBoolean;
        options: z.ZodOptional<z.ZodArray<z.ZodObject<{
            description: z.ZodOptional<z.ZodString>;
            label: z.ZodString;
            value: z.ZodString;
        }, z.core.$strip>>>;
        prompt: z.ZodString;
        shortLabel: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
type UserQuestionPendingInteractionPayload = z.infer<typeof userQuestionPendingInteractionPayloadSchema>;
declare const pluginPendingInteractionPayloadSchema: z.ZodObject<{
    data: z.ZodType<JsonValue, unknown, z.core.$ZodTypeInternals<JsonValue, unknown>>;
    kind: z.ZodLiteral<"plugin">;
    title: z.ZodString;
}, z.core.$strip>;
type PluginPendingInteractionPayload = z.infer<typeof pluginPendingInteractionPayloadSchema>;
declare const pendingInteractionPayloadSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    availableDecisions: z.ZodArray<z.ZodEnum<{
        allow_for_session: "allow_for_session";
        allow_once: "allow_once";
        deny: "deny";
    }>>;
    kind: z.ZodLiteral<"approval">;
    reason: z.ZodNullable<z.ZodString>;
    subject: z.ZodDiscriminatedUnion<[z.ZodObject<{
        actions: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            command: z.ZodString;
            name: z.ZodString;
            path: z.ZodString;
            type: z.ZodLiteral<"read">;
        }, z.core.$strip>, z.ZodObject<{
            command: z.ZodString;
            path: z.ZodNullable<z.ZodString>;
            type: z.ZodLiteral<"listFiles">;
        }, z.core.$strip>, z.ZodObject<{
            command: z.ZodString;
            path: z.ZodNullable<z.ZodString>;
            query: z.ZodNullable<z.ZodString>;
            type: z.ZodLiteral<"search">;
        }, z.core.$strip>, z.ZodObject<{
            command: z.ZodString;
            type: z.ZodLiteral<"unknown">;
        }, z.core.$strip>], "type">>;
        command: z.ZodString;
        cwd: z.ZodNullable<z.ZodString>;
        itemId: z.ZodString;
        kind: z.ZodLiteral<"command">;
        sessionGrant: z.ZodNullable<z.ZodObject<{
            fileSystem: z.ZodNullable<z.ZodObject<{
                read: z.ZodArray<z.ZodString>;
                write: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
            network: z.ZodNullable<z.ZodObject<{
                enabled: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>>;
        }, z.core.$strict>>;
    }, z.core.$strip>, z.ZodObject<{
        itemId: z.ZodString;
        kind: z.ZodLiteral<"file_change">;
        sessionGrant: z.ZodNullable<z.ZodObject<{
            fileSystem: z.ZodNullable<z.ZodObject<{
                read: z.ZodArray<z.ZodString>;
                write: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
            network: z.ZodNullable<z.ZodObject<{
                enabled: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>>;
        }, z.core.$strict>>;
        writeScope: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        itemId: z.ZodString;
        kind: z.ZodLiteral<"permission_grant">;
        permissions: z.ZodObject<{
            fileSystem: z.ZodNullable<z.ZodObject<{
                read: z.ZodArray<z.ZodString>;
                write: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
            network: z.ZodNullable<z.ZodObject<{
                enabled: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>>;
        }, z.core.$strict>;
        toolName: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        itemId: z.ZodString;
        kind: z.ZodLiteral<"plan">;
        plan: z.ZodString;
        planFilePath: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>], "kind">;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"user_question">;
    questions: z.ZodArray<z.ZodObject<{
        allowFreeText: z.ZodBoolean;
        id: z.ZodString;
        multiSelect: z.ZodBoolean;
        options: z.ZodOptional<z.ZodArray<z.ZodObject<{
            description: z.ZodOptional<z.ZodString>;
            label: z.ZodString;
            value: z.ZodString;
        }, z.core.$strip>>>;
        prompt: z.ZodString;
        shortLabel: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>], "kind">;
type PendingInteractionPayload = z.infer<typeof pendingInteractionPayloadSchema>;
type AnyPendingInteractionPayload = PendingInteractionPayload | PluginPendingInteractionPayload;
declare function isApprovalPendingInteractionPayload(payload: AnyPendingInteractionPayload): payload is ApprovalPendingInteractionPayload;
declare function isUserQuestionPendingInteractionPayload(payload: AnyPendingInteractionPayload): payload is UserQuestionPendingInteractionPayload;
declare const approvalPendingInteractionResolutionSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    decision: z.ZodLiteral<"allow_once">;
    grantedPermissions: z.ZodNullable<z.ZodObject<{
        fileSystem: z.ZodNullable<z.ZodObject<{
            read: z.ZodArray<z.ZodString>;
            write: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
        network: z.ZodNullable<z.ZodObject<{
            enabled: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strict>>;
}, z.core.$strip>, z.ZodObject<{
    decision: z.ZodLiteral<"allow_for_session">;
    grantedPermissions: z.ZodNullable<z.ZodObject<{
        fileSystem: z.ZodNullable<z.ZodObject<{
            read: z.ZodArray<z.ZodString>;
            write: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
        network: z.ZodNullable<z.ZodObject<{
            enabled: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strict>>;
}, z.core.$strip>, z.ZodObject<{
    decision: z.ZodLiteral<"deny">;
}, z.core.$strip>], "decision">;
type ApprovalPendingInteractionResolution = z.infer<typeof approvalPendingInteractionResolutionSchema>;
declare const userQuestionPendingInteractionResolutionSchema: z.ZodObject<{
    answers: z.ZodRecord<z.ZodString, z.ZodObject<{
        freeText: z.ZodOptional<z.ZodString>;
        selected: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    kind: z.ZodLiteral<"user_answer">;
}, z.core.$strip>;
type UserQuestionPendingInteractionResolution = z.infer<typeof userQuestionPendingInteractionResolutionSchema>;
declare const pendingInteractionResolutionSchema: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
    decision: z.ZodLiteral<"allow_once">;
    grantedPermissions: z.ZodNullable<z.ZodObject<{
        fileSystem: z.ZodNullable<z.ZodObject<{
            read: z.ZodArray<z.ZodString>;
            write: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
        network: z.ZodNullable<z.ZodObject<{
            enabled: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strict>>;
}, z.core.$strip>, z.ZodObject<{
    decision: z.ZodLiteral<"allow_for_session">;
    grantedPermissions: z.ZodNullable<z.ZodObject<{
        fileSystem: z.ZodNullable<z.ZodObject<{
            read: z.ZodArray<z.ZodString>;
            write: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
        network: z.ZodNullable<z.ZodObject<{
            enabled: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strict>>;
}, z.core.$strip>, z.ZodObject<{
    decision: z.ZodLiteral<"deny">;
}, z.core.$strip>], "decision">, z.ZodObject<{
    answers: z.ZodRecord<z.ZodString, z.ZodObject<{
        freeText: z.ZodOptional<z.ZodString>;
        selected: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    kind: z.ZodLiteral<"user_answer">;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"plugin_submitted">;
}, z.core.$strip>]>;
type PendingInteractionResolution = z.infer<typeof pendingInteractionResolutionSchema>;
declare function isApprovalPendingInteractionResolution(resolution: PendingInteractionResolution): resolution is ApprovalPendingInteractionResolution;
declare function isUserQuestionPendingInteractionResolution(resolution: PendingInteractionResolution): resolution is UserQuestionPendingInteractionResolution;

/**
 * Order is load-bearing: `reasoningRank` (index) drives model-switch
 * reconciliation. "none" (no extended thinking) sits at the bottom — only
 * providers that expose a thinking-off variant list it (currently Cursor and
 * Pi models whose `thinkingLevelMap` advertises `off`).
 * "ultracode" sits between "xhigh" and "max" because its underlying effort IS
 * xhigh (plus standing workflow orchestration) — a model without ultracode
 * support should reconcile down to xhigh, not up to max.
 * "ultra" is a Codex-native top tier (max effort plus automatic task
 * delegation) exposed only by some models; it ranks above "max".
 */
declare const reasoningLevelValues: readonly ["none", "low", "medium", "high", "xhigh", "ultracode", "max", "ultra"];
declare const reasoningLevelSchema: z.ZodEnum<{
    high: "high";
    low: "low";
    max: "max";
    medium: "medium";
    none: "none";
    ultra: "ultra";
    ultracode: "ultracode";
    xhigh: "xhigh";
}>;
type ReasoningLevel = z.infer<typeof reasoningLevelSchema>;
declare const serviceTierSchema: z.ZodEnum<{
    default: "default";
    fast: "fast";
}>;
type ServiceTier = z.infer<typeof serviceTierSchema>;
/**
 * Controls how a provider should incorporate server-owned instructions into its
 * system prompt.
 *
 * - `append`: keep the provider's preset system prompt and append instructions.
 * - `replace`: use the provided instructions as the full system prompt.
 */
declare const instructionModeValues: readonly ["append", "replace"];
declare const instructionModeSchema: z.ZodEnum<{
    append: "append";
    replace: "replace";
}>;
type InstructionMode = z.infer<typeof instructionModeSchema>;
declare const permissionModeSchema: z.ZodEnum<{
    "accept-edits": "accept-edits";
    auto: "auto";
    full: "full";
}>;
type PermissionMode = z.infer<typeof permissionModeSchema>;
declare const permissionEscalationValues: readonly ["ask", "deny"];
declare const permissionEscalationSchema: z.ZodEnum<{
    ask: "ask";
    deny: "deny";
}>;
type PermissionEscalation = z.infer<typeof permissionEscalationSchema>;
declare const DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT = "https://api.anthropic.com";
declare function isClaudeCodeMockCliTrafficEndpoint(value: string): boolean;
declare const claudeCodeMockCliTrafficConfigSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    endpoint: z.ZodString;
}, z.core.$strict>;
type ClaudeCodeMockCliTrafficConfig = z.infer<typeof claudeCodeMockCliTrafficConfigSchema>;
declare const DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG: ClaudeCodeMockCliTrafficConfig;
declare const promptMentionCommandTriggerSchema: z.ZodEnum<{
    "/": "/";
}>;
type PromptMentionCommandTrigger = z.infer<typeof promptMentionCommandTriggerSchema>;
declare const promptInputSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    mentions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        end: z.ZodNumber;
        resource: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"thread">;
            label: z.ZodString;
            projectId: z.ZodOptional<z.ZodString>;
            threadId: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"project">;
            label: z.ZodString;
            projectId: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"section">;
            label: z.ZodString;
            sectionId: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            entryKind: z.ZodEnum<{
                directory: "directory";
                file: "file";
            }>;
            kind: z.ZodLiteral<"path">;
            label: z.ZodString;
            path: z.ZodString;
            source: z.ZodEnum<{
                "thread-storage": "thread-storage";
                workspace: "workspace";
            }>;
        }, z.core.$strip>, z.ZodObject<{
            argumentHint: z.ZodNullable<z.ZodString>;
            kind: z.ZodLiteral<"command">;
            label: z.ZodString;
            name: z.ZodString;
            origin: z.ZodEnum<{
                builtin: "builtin";
                project: "project";
                user: "user";
            }>;
            source: z.ZodEnum<{
                command: "command";
                skill: "skill";
            }>;
            trigger: z.ZodEnum<{
                "/": "/";
            }>;
        }, z.core.$strip>, z.ZodObject<{
            icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            itemId: z.ZodString;
            kind: z.ZodLiteral<"plugin">;
            label: z.ZodString;
            pluginId: z.ZodString;
        }, z.core.$strip>], "kind">>;
        start: z.ZodNumber;
    }, z.core.$strip>>>;
    text: z.ZodString;
    type: z.ZodLiteral<"text">;
    visibility: z.ZodOptional<z.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"image">;
    url: z.ZodString;
    visibility: z.ZodOptional<z.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
}, z.core.$strip>, z.ZodObject<{
    path: z.ZodString;
    type: z.ZodLiteral<"localImage">;
    visibility: z.ZodOptional<z.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
}, z.core.$strip>, z.ZodObject<{
    mimeType: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    path: z.ZodString;
    sizeBytes: z.ZodOptional<z.ZodNumber>;
    type: z.ZodLiteral<"localFile">;
    visibility: z.ZodOptional<z.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
}, z.core.$strip>], "type">;
type PromptInput = z.infer<typeof promptInputSchema>;
interface PromptCommandSelector {
    trigger: PromptMentionCommandTrigger;
    name: string;
}
/**
 * Whether input consists solely of one selected built-in `/compact` mention.
 * Raw matching text and project/user commands intentionally do not qualify.
 */
declare function isStandaloneBuiltinCompactCommand(input: readonly PromptInput[]): boolean;
/** Structured prompt input for the selected built-in `/compact` command. */
declare function createStandaloneBuiltinCompactCommandInput(): PromptInput[];
declare function removeCommandMentionsFromPromptInput(input: readonly PromptInput[], selector: PromptCommandSelector): PromptInput[];
declare const runtimePermissionScopeValues: readonly ["workspace", "full"];
declare const runtimePermissionScopeSchema: z.ZodEnum<{
    full: "full";
    workspace: "workspace";
}>;
type RuntimePermissionScope = z.infer<typeof runtimePermissionScopeSchema>;
declare const runtimePermissionPolicySchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    approvalReviewer: z.ZodLiteral<"user">;
    permissionEscalation: z.ZodEnum<{
        ask: "ask";
        deny: "deny";
    }>;
    permissionMode: z.ZodLiteral<"accept-edits">;
    permissionScope: z.ZodLiteral<"workspace">;
}, z.core.$strip>, z.ZodObject<{
    approvalReviewer: z.ZodLiteral<"automatic">;
    permissionEscalation: z.ZodEnum<{
        ask: "ask";
        deny: "deny";
    }>;
    permissionMode: z.ZodLiteral<"auto">;
    permissionScope: z.ZodLiteral<"workspace">;
}, z.core.$strip>, z.ZodObject<{
    approvalReviewer: z.ZodNull;
    permissionEscalation: z.ZodNull;
    permissionMode: z.ZodLiteral<"full">;
    permissionScope: z.ZodLiteral<"full">;
}, z.core.$strip>], "permissionMode">;
type RuntimePermissionPolicy = z.infer<typeof runtimePermissionPolicySchema>;

declare const clientTurnRequestIdSchema: z.ZodString;
type ClientTurnRequestId = z.infer<typeof clientTurnRequestIdSchema>;

declare const threadEventItemStatusSchema: z.ZodEnum<{
    completed: "completed";
    failed: "failed";
    interrupted: "interrupted";
    pending: "pending";
}>;
type ThreadEventItemStatus = z.infer<typeof threadEventItemStatusSchema>;
declare const threadEventItemApprovalStatusSchema: z.ZodNullable<z.ZodEnum<{
    denied: "denied";
    waiting_for_approval: "waiting_for_approval";
}>>;
type ThreadEventItemApprovalStatus = z.infer<typeof threadEventItemApprovalStatusSchema>;
declare const threadEventTurnStatusSchema: z.ZodEnum<{
    completed: "completed";
    failed: "failed";
    interrupted: "interrupted";
}>;
type ThreadEventTurnStatus = z.infer<typeof threadEventTurnStatusSchema>;
declare const providerErrorCategorySchema: z.ZodEnum<{
    "active-turn-not-steerable": "active-turn-not-steerable";
    "bad-request": "bad-request";
    "budget-exceeded": "budget-exceeded";
    "connection-failed": "connection-failed";
    "context-window-exceeded": "context-window-exceeded";
    "max-output-tokens": "max-output-tokens";
    "max-turns": "max-turns";
    "rate-limit": "rate-limit";
    "stream-disconnected": "stream-disconnected";
    "structured-output-retries": "structured-output-retries";
    "thread-rollback-failed": "thread-rollback-failed";
    "too-many-failed-attempts": "too-many-failed-attempts";
    billing: "billing";
    internal: "internal";
    overloaded: "overloaded";
    policy: "policy";
    sandbox: "sandbox";
    unauthorized: "unauthorized";
    unknown: "unknown";
}>;
type ProviderErrorCategory = z.infer<typeof providerErrorCategorySchema>;
declare const providerErrorInfoSchema: z.ZodObject<{
    category: z.ZodEnum<{
        "active-turn-not-steerable": "active-turn-not-steerable";
        "bad-request": "bad-request";
        "budget-exceeded": "budget-exceeded";
        "connection-failed": "connection-failed";
        "context-window-exceeded": "context-window-exceeded";
        "max-output-tokens": "max-output-tokens";
        "max-turns": "max-turns";
        "rate-limit": "rate-limit";
        "stream-disconnected": "stream-disconnected";
        "structured-output-retries": "structured-output-retries";
        "thread-rollback-failed": "thread-rollback-failed";
        "too-many-failed-attempts": "too-many-failed-attempts";
        billing: "billing";
        internal: "internal";
        overloaded: "overloaded";
        policy: "policy";
        sandbox: "sandbox";
        unauthorized: "unauthorized";
        unknown: "unknown";
    }>;
    httpStatusCode: z.ZodNullable<z.ZodNumber>;
    providerCode: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
type ProviderErrorInfo = z.infer<typeof providerErrorInfoSchema>;
declare const providerRateLimitStatusSchema: z.ZodEnum<{
    allowed: "allowed";
    blocked: "blocked";
    unknown: "unknown";
    warning: "warning";
}>;
type ProviderRateLimitStatus = z.infer<typeof providerRateLimitStatusSchema>;
declare const providerRateLimitWindowSchema: z.ZodObject<{
    label: z.ZodNullable<z.ZodString>;
    providerKey: z.ZodNullable<z.ZodString>;
    resetsAtMs: z.ZodNullable<z.ZodNumber>;
    status: z.ZodEnum<{
        allowed: "allowed";
        blocked: "blocked";
        unknown: "unknown";
        warning: "warning";
    }>;
}, z.core.$strip>;
type ProviderRateLimitWindow = z.infer<typeof providerRateLimitWindowSchema>;
declare const providerRateLimitStateSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        "spend-control": "spend-control";
        "subscription-window": "subscription-window";
        credits: "credits";
        unknown: "unknown";
    }>;
    overageReason: z.ZodNullable<z.ZodString>;
    overageStatus: z.ZodNullable<z.ZodEnum<{
        allowed: "allowed";
        rejected: "rejected";
        unavailable: "unavailable";
        warning: "warning";
    }>>;
    providerId: z.ZodString;
    reachedReason: z.ZodNullable<z.ZodString>;
    status: z.ZodEnum<{
        allowed: "allowed";
        blocked: "blocked";
        unknown: "unknown";
        warning: "warning";
    }>;
    windows: z.ZodArray<z.ZodObject<{
        label: z.ZodNullable<z.ZodString>;
        providerKey: z.ZodNullable<z.ZodString>;
        resetsAtMs: z.ZodNullable<z.ZodNumber>;
        status: z.ZodEnum<{
            allowed: "allowed";
            blocked: "blocked";
            unknown: "unknown";
            warning: "warning";
        }>;
    }, z.core.$strip>>;
}, z.core.$strip>;
type ProviderRateLimitState = z.infer<typeof providerRateLimitStateSchema>;
declare const threadEventPlanStepSchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        completed: "completed";
        failed: "failed";
        pending: "pending";
    }>>;
    step: z.ZodString;
}, z.core.$strip>;
type ThreadEventPlanStep = z.infer<typeof threadEventPlanStepSchema>;
declare const threadEventWebSearchItemSchema: z.ZodObject<{
    id: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    queries: z.ZodArray<z.ZodString>;
    resultText: z.ZodNullable<z.ZodString>;
    type: z.ZodLiteral<"webSearch">;
}, z.core.$strip>;
type ThreadEventWebSearchItem = z.infer<typeof threadEventWebSearchItemSchema>;
declare const threadEventWebFetchItemSchema: z.ZodObject<{
    id: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    pattern: z.ZodNullable<z.ZodString>;
    prompt: z.ZodNullable<z.ZodString>;
    resultText: z.ZodNullable<z.ZodString>;
    type: z.ZodLiteral<"webFetch">;
    url: z.ZodString;
}, z.core.$strip>;
type ThreadEventWebFetchItem = z.infer<typeof threadEventWebFetchItemSchema>;
declare const threadEventUserContentSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    text: z.ZodString;
    type: z.ZodLiteral<"text">;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"image">;
    url: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    path: z.ZodString;
    type: z.ZodLiteral<"localImage">;
}, z.core.$strip>, z.ZodObject<{
    path: z.ZodString;
    type: z.ZodLiteral<"localFile">;
}, z.core.$strip>], "type">;
type ThreadEventUserContent = z.infer<typeof threadEventUserContentSchema>;
declare const threadEventTokenUsageBreakdownSchema: z.ZodObject<{
    cachedInputTokens: z.ZodNumber;
    inputTokens: z.ZodNumber;
    outputTokens: z.ZodNumber;
    reasoningOutputTokens: z.ZodNumber;
    totalTokens: z.ZodNumber;
}, z.core.$strip>;
type ThreadEventTokenUsageBreakdown = z.infer<typeof threadEventTokenUsageBreakdownSchema>;
declare const threadEventContextWindowUsageSchema: z.ZodObject<{
    estimated: z.ZodBoolean;
    modelContextWindow: z.ZodNullable<z.ZodNumber>;
    usedTokens: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
type ThreadEventContextWindowUsage = z.infer<typeof threadEventContextWindowUsageSchema>;
declare const threadEventTokenUsageSchema: z.ZodObject<{
    last: z.ZodObject<{
        cachedInputTokens: z.ZodNumber;
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        reasoningOutputTokens: z.ZodNumber;
        totalTokens: z.ZodNumber;
    }, z.core.$strip>;
    modelContextWindow: z.ZodNullable<z.ZodNumber>;
    total: z.ZodObject<{
        cachedInputTokens: z.ZodNumber;
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        reasoningOutputTokens: z.ZodNumber;
        totalTokens: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
type ThreadEventTokenUsage = z.infer<typeof threadEventTokenUsageSchema>;
/**
 * A materialized provider background task. Dynamic workflows (taskType
 * "local_workflow"), backgrounded shell commands (taskType "local_bash"), and
 * backgrounded subagents (taskType "local_agent" / "local_subagent") become
 * items. The item id is derived from the provider task id and stays stable
 * across the started → progress* → completed lifecycle.
 */
declare const threadEventBackgroundTaskItemSchema: z.ZodObject<{
    description: z.ZodString;
    error: z.ZodOptional<z.ZodString>;
    id: z.ZodString;
    outputFile: z.ZodOptional<z.ZodString>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    skipTranscript: z.ZodBoolean;
    status: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    summary: z.ZodOptional<z.ZodString>;
    taskStatus: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        killed: "killed";
        paused: "paused";
        pending: "pending";
        running: "running";
        stopped: "stopped";
    }>;
    taskType: z.ZodString;
    type: z.ZodLiteral<"backgroundTask">;
    usage: z.ZodOptional<z.ZodObject<{
        durationMs: z.ZodNumber;
        toolUses: z.ZodNumber;
        totalTokens: z.ZodNumber;
    }, z.core.$strip>>;
    workflow: z.ZodOptional<z.ZodObject<{
        agents: z.ZodArray<z.ZodObject<{
            agentType: z.ZodOptional<z.ZodString>;
            attempt: z.ZodNumber;
            cached: z.ZodBoolean;
            durationMs: z.ZodOptional<z.ZodNumber>;
            error: z.ZodOptional<z.ZodString>;
            index: z.ZodNumber;
            isolation: z.ZodOptional<z.ZodString>;
            label: z.ZodString;
            lastProgressAt: z.ZodNumber;
            lastToolName: z.ZodOptional<z.ZodString>;
            lastToolSummary: z.ZodOptional<z.ZodString>;
            model: z.ZodString;
            phaseIndex: z.ZodOptional<z.ZodNumber>;
            phaseTitle: z.ZodOptional<z.ZodString>;
            promptPreview: z.ZodOptional<z.ZodString>;
            queuedAt: z.ZodOptional<z.ZodNumber>;
            resultPreview: z.ZodOptional<z.ZodString>;
            startedAt: z.ZodOptional<z.ZodNumber>;
            state: z.ZodEnum<{
                done: "done";
                failed: "failed";
                queued: "queued";
                running: "running";
                skipped: "skipped";
            }>;
            tokens: z.ZodOptional<z.ZodNumber>;
            toolCalls: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        phases: z.ZodArray<z.ZodObject<{
            index: z.ZodNumber;
            kind: z.ZodOptional<z.ZodString>;
            title: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    workflowName: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type ThreadEventBackgroundTaskItem = z.infer<typeof threadEventBackgroundTaskItemSchema>;
declare const threadEventItemSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    clientRequestId: z.ZodOptional<z.ZodString>;
    content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        text: z.ZodString;
        type: z.ZodLiteral<"text">;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        url: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        path: z.ZodString;
        type: z.ZodLiteral<"localImage">;
    }, z.core.$strip>, z.ZodObject<{
        path: z.ZodString;
        type: z.ZodLiteral<"localFile">;
    }, z.core.$strip>], "type">>;
    id: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"userMessage">;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    text: z.ZodString;
    type: z.ZodLiteral<"agentMessage">;
}, z.core.$strip>, z.ZodObject<{
    aggregatedOutput: z.ZodOptional<z.ZodString>;
    approvalStatus: z.ZodNullable<z.ZodEnum<{
        denied: "denied";
        waiting_for_approval: "waiting_for_approval";
    }>>;
    command: z.ZodString;
    cwd: z.ZodString;
    durationMs: z.ZodOptional<z.ZodNumber>;
    exitCode: z.ZodOptional<z.ZodNumber>;
    id: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    truncation: z.ZodOptional<z.ZodObject<{
        aggregatedOutput: z.ZodOptional<z.ZodObject<{
            originalLength: z.ZodNumber;
            retainedHeadLength: z.ZodNumber;
            retainedTailLength: z.ZodNumber;
            truncatedAt: z.ZodNumber;
        }, z.core.$strip>>;
        result: z.ZodOptional<z.ZodObject<{
            originalLength: z.ZodNumber;
            retainedHeadLength: z.ZodNumber;
            retainedTailLength: z.ZodNumber;
            truncatedAt: z.ZodNumber;
        }, z.core.$strip>>;
        resultText: z.ZodOptional<z.ZodObject<{
            originalLength: z.ZodNumber;
            retainedHeadLength: z.ZodNumber;
            retainedTailLength: z.ZodNumber;
            truncatedAt: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    type: z.ZodLiteral<"commandExecution">;
}, z.core.$strip>, z.ZodObject<{
    approvalStatus: z.ZodNullable<z.ZodEnum<{
        denied: "denied";
        waiting_for_approval: "waiting_for_approval";
    }>>;
    changes: z.ZodArray<z.ZodObject<{
        diff: z.ZodOptional<z.ZodString>;
        kind: z.ZodEnum<{
            add: "add";
            delete: "delete";
            update: "update";
        }>;
        movePath: z.ZodOptional<z.ZodString>;
        path: z.ZodString;
    }, z.core.$strip>>;
    id: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    type: z.ZodLiteral<"fileChange">;
}, z.core.$strip>, z.ZodObject<{
    id: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    queries: z.ZodArray<z.ZodString>;
    resultText: z.ZodNullable<z.ZodString>;
    type: z.ZodLiteral<"webSearch">;
}, z.core.$strip>, z.ZodObject<{
    id: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    pattern: z.ZodNullable<z.ZodString>;
    prompt: z.ZodNullable<z.ZodString>;
    resultText: z.ZodNullable<z.ZodString>;
    type: z.ZodLiteral<"webFetch">;
    url: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    id: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    path: z.ZodString;
    type: z.ZodLiteral<"imageView">;
}, z.core.$strip>, z.ZodObject<{
    arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    durationMs: z.ZodOptional<z.ZodNumber>;
    error: z.ZodOptional<z.ZodString>;
    id: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    result: z.ZodOptional<z.ZodUnknown>;
    server: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    statusLabels: z.ZodOptional<z.ZodObject<{
        completed: z.ZodString;
        pending: z.ZodString;
    }, z.core.$strip>>;
    tool: z.ZodString;
    truncation: z.ZodOptional<z.ZodObject<{
        aggregatedOutput: z.ZodOptional<z.ZodObject<{
            originalLength: z.ZodNumber;
            retainedHeadLength: z.ZodNumber;
            retainedTailLength: z.ZodNumber;
            truncatedAt: z.ZodNumber;
        }, z.core.$strip>>;
        result: z.ZodOptional<z.ZodObject<{
            originalLength: z.ZodNumber;
            retainedHeadLength: z.ZodNumber;
            retainedTailLength: z.ZodNumber;
            truncatedAt: z.ZodNumber;
        }, z.core.$strip>>;
        resultText: z.ZodOptional<z.ZodObject<{
            originalLength: z.ZodNumber;
            retainedHeadLength: z.ZodNumber;
            retainedTailLength: z.ZodNumber;
            truncatedAt: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    type: z.ZodLiteral<"toolCall">;
}, z.core.$strip>, z.ZodObject<{
    content: z.ZodArray<z.ZodString>;
    id: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    summary: z.ZodArray<z.ZodString>;
    type: z.ZodLiteral<"reasoning">;
}, z.core.$strip>, z.ZodObject<{
    id: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    text: z.ZodString;
    type: z.ZodLiteral<"plan">;
}, z.core.$strip>, z.ZodObject<{
    id: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"contextCompaction">;
}, z.core.$strip>, z.ZodObject<{
    description: z.ZodString;
    error: z.ZodOptional<z.ZodString>;
    id: z.ZodString;
    outputFile: z.ZodOptional<z.ZodString>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    skipTranscript: z.ZodBoolean;
    status: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    summary: z.ZodOptional<z.ZodString>;
    taskStatus: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        killed: "killed";
        paused: "paused";
        pending: "pending";
        running: "running";
        stopped: "stopped";
    }>;
    taskType: z.ZodString;
    type: z.ZodLiteral<"backgroundTask">;
    usage: z.ZodOptional<z.ZodObject<{
        durationMs: z.ZodNumber;
        toolUses: z.ZodNumber;
        totalTokens: z.ZodNumber;
    }, z.core.$strip>>;
    workflow: z.ZodOptional<z.ZodObject<{
        agents: z.ZodArray<z.ZodObject<{
            agentType: z.ZodOptional<z.ZodString>;
            attempt: z.ZodNumber;
            cached: z.ZodBoolean;
            durationMs: z.ZodOptional<z.ZodNumber>;
            error: z.ZodOptional<z.ZodString>;
            index: z.ZodNumber;
            isolation: z.ZodOptional<z.ZodString>;
            label: z.ZodString;
            lastProgressAt: z.ZodNumber;
            lastToolName: z.ZodOptional<z.ZodString>;
            lastToolSummary: z.ZodOptional<z.ZodString>;
            model: z.ZodString;
            phaseIndex: z.ZodOptional<z.ZodNumber>;
            phaseTitle: z.ZodOptional<z.ZodString>;
            promptPreview: z.ZodOptional<z.ZodString>;
            queuedAt: z.ZodOptional<z.ZodNumber>;
            resultPreview: z.ZodOptional<z.ZodString>;
            startedAt: z.ZodOptional<z.ZodNumber>;
            state: z.ZodEnum<{
                done: "done";
                failed: "failed";
                queued: "queued";
                running: "running";
                skipped: "skipped";
            }>;
            tokens: z.ZodOptional<z.ZodNumber>;
            toolCalls: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        phases: z.ZodArray<z.ZodObject<{
            index: z.ZodNumber;
            kind: z.ZodOptional<z.ZodString>;
            title: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    workflowName: z.ZodOptional<z.ZodString>;
}, z.core.$strip>], "type">;
type ThreadEventItem = z.infer<typeof threadEventItemSchema>;
declare const providerEventSchema: z.ZodIntersection<z.ZodDiscriminatedUnion<[z.ZodObject<{
    threadId: z.ZodString;
    type: z.ZodLiteral<"thread/started">;
}, z.core.$strip>, z.ZodObject<{
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"thread/identity">;
}, z.core.$strip>, z.ZodObject<{
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"turn/started">;
}, z.core.$strip>, z.ZodObject<{
    error: z.ZodOptional<z.ZodObject<{
        message: z.ZodString;
    }, z.core.$strip>>;
    providerCheckpointId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodNullable<z.ZodString>;
    status: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
    }>;
    threadId: z.ZodString;
    type: z.ZodLiteral<"turn/completed">;
}, z.core.$strip>, z.ZodObject<{
    clientRequestId: z.ZodString;
    providerThreadId: z.ZodString;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"thread">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"turn">;
        turnId: z.ZodString;
    }, z.core.$strip>], "kind">;
    threadId: z.ZodString;
    type: z.ZodLiteral<"turn/input/accepted">;
}, z.core.$strict>, z.ZodObject<{
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    threadName: z.ZodString;
    type: z.ZodLiteral<"thread/name/updated">;
}, z.core.$strip>, z.ZodObject<{
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"thread/compacted">;
}, z.core.$strip>, z.ZodObject<{
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"thread/context/cleared">;
}, z.core.$strip>, z.ZodObject<{
    objective: z.ZodString;
    providerThreadId: z.ZodString;
    status: z.ZodEnum<{
        active: "active";
        budgetLimited: "budgetLimited";
        complete: "complete";
        paused: "paused";
    }>;
    threadId: z.ZodString;
    timeUsedSeconds: z.ZodNumber;
    tokenBudget: z.ZodNullable<z.ZodNumber>;
    tokensUsed: z.ZodNumber;
    type: z.ZodLiteral<"thread/goal/updated">;
}, z.core.$strip>, z.ZodObject<{
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"thread/goal/cleared">;
}, z.core.$strip>, z.ZodObject<{
    item: z.ZodDiscriminatedUnion<[z.ZodObject<{
        clientRequestId: z.ZodOptional<z.ZodString>;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            text: z.ZodString;
            type: z.ZodLiteral<"text">;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            url: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            path: z.ZodString;
            type: z.ZodLiteral<"localImage">;
        }, z.core.$strip>, z.ZodObject<{
            path: z.ZodString;
            type: z.ZodLiteral<"localFile">;
        }, z.core.$strip>], "type">>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        type: z.ZodLiteral<"userMessage">;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        text: z.ZodString;
        type: z.ZodLiteral<"agentMessage">;
    }, z.core.$strip>, z.ZodObject<{
        aggregatedOutput: z.ZodOptional<z.ZodString>;
        approvalStatus: z.ZodNullable<z.ZodEnum<{
            denied: "denied";
            waiting_for_approval: "waiting_for_approval";
        }>>;
        command: z.ZodString;
        cwd: z.ZodString;
        durationMs: z.ZodOptional<z.ZodNumber>;
        exitCode: z.ZodOptional<z.ZodNumber>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        truncation: z.ZodOptional<z.ZodObject<{
            aggregatedOutput: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
            result: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
            resultText: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        type: z.ZodLiteral<"commandExecution">;
    }, z.core.$strip>, z.ZodObject<{
        approvalStatus: z.ZodNullable<z.ZodEnum<{
            denied: "denied";
            waiting_for_approval: "waiting_for_approval";
        }>>;
        changes: z.ZodArray<z.ZodObject<{
            diff: z.ZodOptional<z.ZodString>;
            kind: z.ZodEnum<{
                add: "add";
                delete: "delete";
                update: "update";
            }>;
            movePath: z.ZodOptional<z.ZodString>;
            path: z.ZodString;
        }, z.core.$strip>>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        type: z.ZodLiteral<"fileChange">;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        queries: z.ZodArray<z.ZodString>;
        resultText: z.ZodNullable<z.ZodString>;
        type: z.ZodLiteral<"webSearch">;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        pattern: z.ZodNullable<z.ZodString>;
        prompt: z.ZodNullable<z.ZodString>;
        resultText: z.ZodNullable<z.ZodString>;
        type: z.ZodLiteral<"webFetch">;
        url: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        path: z.ZodString;
        type: z.ZodLiteral<"imageView">;
    }, z.core.$strip>, z.ZodObject<{
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        error: z.ZodOptional<z.ZodString>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        result: z.ZodOptional<z.ZodUnknown>;
        server: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        statusLabels: z.ZodOptional<z.ZodObject<{
            completed: z.ZodString;
            pending: z.ZodString;
        }, z.core.$strip>>;
        tool: z.ZodString;
        truncation: z.ZodOptional<z.ZodObject<{
            aggregatedOutput: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
            result: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
            resultText: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        type: z.ZodLiteral<"toolCall">;
    }, z.core.$strip>, z.ZodObject<{
        content: z.ZodArray<z.ZodString>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        summary: z.ZodArray<z.ZodString>;
        type: z.ZodLiteral<"reasoning">;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        text: z.ZodString;
        type: z.ZodLiteral<"plan">;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        type: z.ZodLiteral<"contextCompaction">;
    }, z.core.$strip>, z.ZodObject<{
        description: z.ZodString;
        error: z.ZodOptional<z.ZodString>;
        id: z.ZodString;
        outputFile: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        skipTranscript: z.ZodBoolean;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        summary: z.ZodOptional<z.ZodString>;
        taskStatus: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            killed: "killed";
            paused: "paused";
            pending: "pending";
            running: "running";
            stopped: "stopped";
        }>;
        taskType: z.ZodString;
        type: z.ZodLiteral<"backgroundTask">;
        usage: z.ZodOptional<z.ZodObject<{
            durationMs: z.ZodNumber;
            toolUses: z.ZodNumber;
            totalTokens: z.ZodNumber;
        }, z.core.$strip>>;
        workflow: z.ZodOptional<z.ZodObject<{
            agents: z.ZodArray<z.ZodObject<{
                agentType: z.ZodOptional<z.ZodString>;
                attempt: z.ZodNumber;
                cached: z.ZodBoolean;
                durationMs: z.ZodOptional<z.ZodNumber>;
                error: z.ZodOptional<z.ZodString>;
                index: z.ZodNumber;
                isolation: z.ZodOptional<z.ZodString>;
                label: z.ZodString;
                lastProgressAt: z.ZodNumber;
                lastToolName: z.ZodOptional<z.ZodString>;
                lastToolSummary: z.ZodOptional<z.ZodString>;
                model: z.ZodString;
                phaseIndex: z.ZodOptional<z.ZodNumber>;
                phaseTitle: z.ZodOptional<z.ZodString>;
                promptPreview: z.ZodOptional<z.ZodString>;
                queuedAt: z.ZodOptional<z.ZodNumber>;
                resultPreview: z.ZodOptional<z.ZodString>;
                startedAt: z.ZodOptional<z.ZodNumber>;
                state: z.ZodEnum<{
                    done: "done";
                    failed: "failed";
                    queued: "queued";
                    running: "running";
                    skipped: "skipped";
                }>;
                tokens: z.ZodOptional<z.ZodNumber>;
                toolCalls: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            phases: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                kind: z.ZodOptional<z.ZodString>;
                title: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        workflowName: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "type">;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/started">;
}, z.core.$strip>, z.ZodObject<{
    item: z.ZodDiscriminatedUnion<[z.ZodObject<{
        clientRequestId: z.ZodOptional<z.ZodString>;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            text: z.ZodString;
            type: z.ZodLiteral<"text">;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            url: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            path: z.ZodString;
            type: z.ZodLiteral<"localImage">;
        }, z.core.$strip>, z.ZodObject<{
            path: z.ZodString;
            type: z.ZodLiteral<"localFile">;
        }, z.core.$strip>], "type">>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        type: z.ZodLiteral<"userMessage">;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        text: z.ZodString;
        type: z.ZodLiteral<"agentMessage">;
    }, z.core.$strip>, z.ZodObject<{
        aggregatedOutput: z.ZodOptional<z.ZodString>;
        approvalStatus: z.ZodNullable<z.ZodEnum<{
            denied: "denied";
            waiting_for_approval: "waiting_for_approval";
        }>>;
        command: z.ZodString;
        cwd: z.ZodString;
        durationMs: z.ZodOptional<z.ZodNumber>;
        exitCode: z.ZodOptional<z.ZodNumber>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        truncation: z.ZodOptional<z.ZodObject<{
            aggregatedOutput: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
            result: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
            resultText: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        type: z.ZodLiteral<"commandExecution">;
    }, z.core.$strip>, z.ZodObject<{
        approvalStatus: z.ZodNullable<z.ZodEnum<{
            denied: "denied";
            waiting_for_approval: "waiting_for_approval";
        }>>;
        changes: z.ZodArray<z.ZodObject<{
            diff: z.ZodOptional<z.ZodString>;
            kind: z.ZodEnum<{
                add: "add";
                delete: "delete";
                update: "update";
            }>;
            movePath: z.ZodOptional<z.ZodString>;
            path: z.ZodString;
        }, z.core.$strip>>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        type: z.ZodLiteral<"fileChange">;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        queries: z.ZodArray<z.ZodString>;
        resultText: z.ZodNullable<z.ZodString>;
        type: z.ZodLiteral<"webSearch">;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        pattern: z.ZodNullable<z.ZodString>;
        prompt: z.ZodNullable<z.ZodString>;
        resultText: z.ZodNullable<z.ZodString>;
        type: z.ZodLiteral<"webFetch">;
        url: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        path: z.ZodString;
        type: z.ZodLiteral<"imageView">;
    }, z.core.$strip>, z.ZodObject<{
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        error: z.ZodOptional<z.ZodString>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        result: z.ZodOptional<z.ZodUnknown>;
        server: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        statusLabels: z.ZodOptional<z.ZodObject<{
            completed: z.ZodString;
            pending: z.ZodString;
        }, z.core.$strip>>;
        tool: z.ZodString;
        truncation: z.ZodOptional<z.ZodObject<{
            aggregatedOutput: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
            result: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
            resultText: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        type: z.ZodLiteral<"toolCall">;
    }, z.core.$strip>, z.ZodObject<{
        content: z.ZodArray<z.ZodString>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        summary: z.ZodArray<z.ZodString>;
        type: z.ZodLiteral<"reasoning">;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        text: z.ZodString;
        type: z.ZodLiteral<"plan">;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        type: z.ZodLiteral<"contextCompaction">;
    }, z.core.$strip>, z.ZodObject<{
        description: z.ZodString;
        error: z.ZodOptional<z.ZodString>;
        id: z.ZodString;
        outputFile: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        skipTranscript: z.ZodBoolean;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        summary: z.ZodOptional<z.ZodString>;
        taskStatus: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            killed: "killed";
            paused: "paused";
            pending: "pending";
            running: "running";
            stopped: "stopped";
        }>;
        taskType: z.ZodString;
        type: z.ZodLiteral<"backgroundTask">;
        usage: z.ZodOptional<z.ZodObject<{
            durationMs: z.ZodNumber;
            toolUses: z.ZodNumber;
            totalTokens: z.ZodNumber;
        }, z.core.$strip>>;
        workflow: z.ZodOptional<z.ZodObject<{
            agents: z.ZodArray<z.ZodObject<{
                agentType: z.ZodOptional<z.ZodString>;
                attempt: z.ZodNumber;
                cached: z.ZodBoolean;
                durationMs: z.ZodOptional<z.ZodNumber>;
                error: z.ZodOptional<z.ZodString>;
                index: z.ZodNumber;
                isolation: z.ZodOptional<z.ZodString>;
                label: z.ZodString;
                lastProgressAt: z.ZodNumber;
                lastToolName: z.ZodOptional<z.ZodString>;
                lastToolSummary: z.ZodOptional<z.ZodString>;
                model: z.ZodString;
                phaseIndex: z.ZodOptional<z.ZodNumber>;
                phaseTitle: z.ZodOptional<z.ZodString>;
                promptPreview: z.ZodOptional<z.ZodString>;
                queuedAt: z.ZodOptional<z.ZodNumber>;
                resultPreview: z.ZodOptional<z.ZodString>;
                startedAt: z.ZodOptional<z.ZodNumber>;
                state: z.ZodEnum<{
                    done: "done";
                    failed: "failed";
                    queued: "queued";
                    running: "running";
                    skipped: "skipped";
                }>;
                tokens: z.ZodOptional<z.ZodNumber>;
                toolCalls: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            phases: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                kind: z.ZodOptional<z.ZodString>;
                title: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        workflowName: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "type">;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/completed">;
}, z.core.$strip>, z.ZodObject<{
    delta: z.ZodString;
    itemId: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/agentMessage/delta">;
}, z.core.$strip>, z.ZodObject<{
    delta: z.ZodString;
    itemId: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    reset: z.ZodOptional<z.ZodBoolean>;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/commandExecution/outputDelta">;
}, z.core.$strip>, z.ZodObject<{
    delta: z.ZodString;
    itemId: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/fileChange/outputDelta">;
}, z.core.$strip>, z.ZodObject<{
    delta: z.ZodString;
    itemId: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/reasoning/summaryTextDelta">;
}, z.core.$strip>, z.ZodObject<{
    delta: z.ZodString;
    itemId: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/reasoning/textDelta">;
}, z.core.$strip>, z.ZodObject<{
    delta: z.ZodString;
    itemId: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/plan/delta">;
}, z.core.$strip>, z.ZodObject<{
    itemId: z.ZodString;
    message: z.ZodOptional<z.ZodString>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/mcpToolCall/progress">;
}, z.core.$strip>, z.ZodObject<{
    itemId: z.ZodString;
    message: z.ZodOptional<z.ZodString>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/toolCall/progress">;
}, z.core.$strip>, z.ZodObject<{
    item: z.ZodObject<{
        description: z.ZodString;
        error: z.ZodOptional<z.ZodString>;
        id: z.ZodString;
        outputFile: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        skipTranscript: z.ZodBoolean;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        summary: z.ZodOptional<z.ZodString>;
        taskStatus: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            killed: "killed";
            paused: "paused";
            pending: "pending";
            running: "running";
            stopped: "stopped";
        }>;
        taskType: z.ZodString;
        type: z.ZodLiteral<"backgroundTask">;
        usage: z.ZodOptional<z.ZodObject<{
            durationMs: z.ZodNumber;
            toolUses: z.ZodNumber;
            totalTokens: z.ZodNumber;
        }, z.core.$strip>>;
        workflow: z.ZodOptional<z.ZodObject<{
            agents: z.ZodArray<z.ZodObject<{
                agentType: z.ZodOptional<z.ZodString>;
                attempt: z.ZodNumber;
                cached: z.ZodBoolean;
                durationMs: z.ZodOptional<z.ZodNumber>;
                error: z.ZodOptional<z.ZodString>;
                index: z.ZodNumber;
                isolation: z.ZodOptional<z.ZodString>;
                label: z.ZodString;
                lastProgressAt: z.ZodNumber;
                lastToolName: z.ZodOptional<z.ZodString>;
                lastToolSummary: z.ZodOptional<z.ZodString>;
                model: z.ZodString;
                phaseIndex: z.ZodOptional<z.ZodNumber>;
                phaseTitle: z.ZodOptional<z.ZodString>;
                promptPreview: z.ZodOptional<z.ZodString>;
                queuedAt: z.ZodOptional<z.ZodNumber>;
                resultPreview: z.ZodOptional<z.ZodString>;
                startedAt: z.ZodOptional<z.ZodNumber>;
                state: z.ZodEnum<{
                    done: "done";
                    failed: "failed";
                    queued: "queued";
                    running: "running";
                    skipped: "skipped";
                }>;
                tokens: z.ZodOptional<z.ZodNumber>;
                toolCalls: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            phases: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                kind: z.ZodOptional<z.ZodString>;
                title: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        workflowName: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/backgroundTask/progress">;
}, z.core.$strip>, z.ZodObject<{
    item: z.ZodObject<{
        description: z.ZodString;
        error: z.ZodOptional<z.ZodString>;
        id: z.ZodString;
        outputFile: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        skipTranscript: z.ZodBoolean;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        summary: z.ZodOptional<z.ZodString>;
        taskStatus: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            killed: "killed";
            paused: "paused";
            pending: "pending";
            running: "running";
            stopped: "stopped";
        }>;
        taskType: z.ZodString;
        type: z.ZodLiteral<"backgroundTask">;
        usage: z.ZodOptional<z.ZodObject<{
            durationMs: z.ZodNumber;
            toolUses: z.ZodNumber;
            totalTokens: z.ZodNumber;
        }, z.core.$strip>>;
        workflow: z.ZodOptional<z.ZodObject<{
            agents: z.ZodArray<z.ZodObject<{
                agentType: z.ZodOptional<z.ZodString>;
                attempt: z.ZodNumber;
                cached: z.ZodBoolean;
                durationMs: z.ZodOptional<z.ZodNumber>;
                error: z.ZodOptional<z.ZodString>;
                index: z.ZodNumber;
                isolation: z.ZodOptional<z.ZodString>;
                label: z.ZodString;
                lastProgressAt: z.ZodNumber;
                lastToolName: z.ZodOptional<z.ZodString>;
                lastToolSummary: z.ZodOptional<z.ZodString>;
                model: z.ZodString;
                phaseIndex: z.ZodOptional<z.ZodNumber>;
                phaseTitle: z.ZodOptional<z.ZodString>;
                promptPreview: z.ZodOptional<z.ZodString>;
                queuedAt: z.ZodOptional<z.ZodNumber>;
                resultPreview: z.ZodOptional<z.ZodString>;
                startedAt: z.ZodOptional<z.ZodNumber>;
                state: z.ZodEnum<{
                    done: "done";
                    failed: "failed";
                    queued: "queued";
                    running: "running";
                    skipped: "skipped";
                }>;
                tokens: z.ZodOptional<z.ZodNumber>;
                toolCalls: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            phases: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                kind: z.ZodOptional<z.ZodString>;
                title: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        workflowName: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/backgroundTask/completed">;
}, z.core.$strip>, z.ZodObject<{
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    tokenUsage: z.ZodObject<{
        last: z.ZodObject<{
            cachedInputTokens: z.ZodNumber;
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            reasoningOutputTokens: z.ZodNumber;
            totalTokens: z.ZodNumber;
        }, z.core.$strip>;
        modelContextWindow: z.ZodNullable<z.ZodNumber>;
        total: z.ZodObject<{
            cachedInputTokens: z.ZodNumber;
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            reasoningOutputTokens: z.ZodNumber;
            totalTokens: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>;
    type: z.ZodLiteral<"thread/tokenUsage/updated">;
}, z.core.$strip>, z.ZodObject<{
    contextWindowUsage: z.ZodObject<{
        estimated: z.ZodBoolean;
        modelContextWindow: z.ZodNullable<z.ZodNumber>;
        usedTokens: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"thread/contextWindowUsage/updated">;
}, z.core.$strip>, z.ZodObject<{
    explanation: z.ZodOptional<z.ZodString>;
    plan: z.ZodArray<z.ZodObject<{
        status: z.ZodOptional<z.ZodEnum<{
            active: "active";
            completed: "completed";
            failed: "failed";
            pending: "pending";
        }>>;
        step: z.ZodString;
    }, z.core.$strip>>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"turn/plan/updated">;
}, z.core.$strip>, z.ZodObject<{
    diff: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"turn/diff/updated">;
}, z.core.$strip>, z.ZodObject<{
    detail: z.ZodOptional<z.ZodString>;
    errorInfo: z.ZodOptional<z.ZodObject<{
        category: z.ZodEnum<{
            "active-turn-not-steerable": "active-turn-not-steerable";
            "bad-request": "bad-request";
            "budget-exceeded": "budget-exceeded";
            "connection-failed": "connection-failed";
            "context-window-exceeded": "context-window-exceeded";
            "max-output-tokens": "max-output-tokens";
            "max-turns": "max-turns";
            "rate-limit": "rate-limit";
            "stream-disconnected": "stream-disconnected";
            "structured-output-retries": "structured-output-retries";
            "thread-rollback-failed": "thread-rollback-failed";
            "too-many-failed-attempts": "too-many-failed-attempts";
            billing: "billing";
            internal: "internal";
            overloaded: "overloaded";
            policy: "policy";
            sandbox: "sandbox";
            unauthorized: "unauthorized";
            unknown: "unknown";
        }>;
        httpStatusCode: z.ZodNullable<z.ZodNumber>;
        providerCode: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    message: z.ZodString;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"provider/error">;
    willRetry: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>, z.ZodObject<{
    providerThreadId: z.ZodString;
    rateLimits: z.ZodObject<{
        kind: z.ZodEnum<{
            "spend-control": "spend-control";
            "subscription-window": "subscription-window";
            credits: "credits";
            unknown: "unknown";
        }>;
        overageReason: z.ZodNullable<z.ZodString>;
        overageStatus: z.ZodNullable<z.ZodEnum<{
            allowed: "allowed";
            rejected: "rejected";
            unavailable: "unavailable";
            warning: "warning";
        }>>;
        providerId: z.ZodString;
        reachedReason: z.ZodNullable<z.ZodString>;
        status: z.ZodEnum<{
            allowed: "allowed";
            blocked: "blocked";
            unknown: "unknown";
            warning: "warning";
        }>;
        windows: z.ZodArray<z.ZodObject<{
            label: z.ZodNullable<z.ZodString>;
            providerKey: z.ZodNullable<z.ZodString>;
            resetsAtMs: z.ZodNullable<z.ZodNumber>;
            status: z.ZodEnum<{
                allowed: "allowed";
                blocked: "blocked";
                unknown: "unknown";
                warning: "warning";
            }>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    threadId: z.ZodString;
    type: z.ZodLiteral<"provider/rateLimits/updated">;
}, z.core.$strip>, z.ZodObject<{
    category: z.ZodEnum<{
        "compaction-skipped": "compaction-skipped";
        config: "config";
        deprecation: "deprecation";
        general: "general";
    }>;
    details: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    summary: z.ZodOptional<z.ZodString>;
    threadId: z.ZodString;
    type: z.ZodLiteral<"provider/warning">;
}, z.core.$strip>, z.ZodObject<{
    fallbackModel: z.ZodString;
    message: z.ZodString;
    originalModel: z.ZodString;
    providerThreadId: z.ZodString;
    reason: z.ZodEnum<{
        provider: "provider";
        refusal: "refusal";
    }>;
    threadId: z.ZodString;
    type: z.ZodLiteral<"provider/modelFallback">;
}, z.core.$strip>, z.ZodObject<{
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerId: z.ZodString;
    providerThreadId: z.ZodString;
    rawEvent: z.ZodObject<{
        id: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>;
        jsonrpc: z.ZodLiteral<"2.0">;
        method: z.ZodString;
        params: z.ZodOptional<z.ZodType<JsonValue, unknown, z.core.$ZodTypeInternals<JsonValue, unknown>>>;
    }, z.core.$strip>;
    rawType: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"provider/unhandled">;
}, z.core.$strip>], "type">, z.ZodObject<{
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"thread">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"turn">;
        turnId: z.ZodString;
    }, z.core.$strip>], "kind">;
}, z.core.$strip>>;
type ProviderEvent = z.infer<typeof providerEventSchema>;
type ProviderUnhandledEvent = Extract<ProviderEvent, {
    type: "provider/unhandled";
}>;
/** All thread events — provider-originated or system-originated. */
declare const threadEventSchema: z.ZodPipe<z.ZodUnknown, z.ZodUnion<readonly [z.ZodIntersection<z.ZodDiscriminatedUnion<[z.ZodObject<{
    threadId: z.ZodString;
    type: z.ZodLiteral<"thread/started">;
}, z.core.$strip>, z.ZodObject<{
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"thread/identity">;
}, z.core.$strip>, z.ZodObject<{
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"turn/started">;
}, z.core.$strip>, z.ZodObject<{
    error: z.ZodOptional<z.ZodObject<{
        message: z.ZodString;
    }, z.core.$strip>>;
    providerCheckpointId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodNullable<z.ZodString>;
    status: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
    }>;
    threadId: z.ZodString;
    type: z.ZodLiteral<"turn/completed">;
}, z.core.$strip>, z.ZodObject<{
    clientRequestId: z.ZodString;
    providerThreadId: z.ZodString;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"thread">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"turn">;
        turnId: z.ZodString;
    }, z.core.$strip>], "kind">;
    threadId: z.ZodString;
    type: z.ZodLiteral<"turn/input/accepted">;
}, z.core.$strict>, z.ZodObject<{
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    threadName: z.ZodString;
    type: z.ZodLiteral<"thread/name/updated">;
}, z.core.$strip>, z.ZodObject<{
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"thread/compacted">;
}, z.core.$strip>, z.ZodObject<{
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"thread/context/cleared">;
}, z.core.$strip>, z.ZodObject<{
    objective: z.ZodString;
    providerThreadId: z.ZodString;
    status: z.ZodEnum<{
        active: "active";
        budgetLimited: "budgetLimited";
        complete: "complete";
        paused: "paused";
    }>;
    threadId: z.ZodString;
    timeUsedSeconds: z.ZodNumber;
    tokenBudget: z.ZodNullable<z.ZodNumber>;
    tokensUsed: z.ZodNumber;
    type: z.ZodLiteral<"thread/goal/updated">;
}, z.core.$strip>, z.ZodObject<{
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"thread/goal/cleared">;
}, z.core.$strip>, z.ZodObject<{
    item: z.ZodDiscriminatedUnion<[z.ZodObject<{
        clientRequestId: z.ZodOptional<z.ZodString>;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            text: z.ZodString;
            type: z.ZodLiteral<"text">;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            url: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            path: z.ZodString;
            type: z.ZodLiteral<"localImage">;
        }, z.core.$strip>, z.ZodObject<{
            path: z.ZodString;
            type: z.ZodLiteral<"localFile">;
        }, z.core.$strip>], "type">>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        type: z.ZodLiteral<"userMessage">;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        text: z.ZodString;
        type: z.ZodLiteral<"agentMessage">;
    }, z.core.$strip>, z.ZodObject<{
        aggregatedOutput: z.ZodOptional<z.ZodString>;
        approvalStatus: z.ZodNullable<z.ZodEnum<{
            denied: "denied";
            waiting_for_approval: "waiting_for_approval";
        }>>;
        command: z.ZodString;
        cwd: z.ZodString;
        durationMs: z.ZodOptional<z.ZodNumber>;
        exitCode: z.ZodOptional<z.ZodNumber>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        truncation: z.ZodOptional<z.ZodObject<{
            aggregatedOutput: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
            result: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
            resultText: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        type: z.ZodLiteral<"commandExecution">;
    }, z.core.$strip>, z.ZodObject<{
        approvalStatus: z.ZodNullable<z.ZodEnum<{
            denied: "denied";
            waiting_for_approval: "waiting_for_approval";
        }>>;
        changes: z.ZodArray<z.ZodObject<{
            diff: z.ZodOptional<z.ZodString>;
            kind: z.ZodEnum<{
                add: "add";
                delete: "delete";
                update: "update";
            }>;
            movePath: z.ZodOptional<z.ZodString>;
            path: z.ZodString;
        }, z.core.$strip>>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        type: z.ZodLiteral<"fileChange">;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        queries: z.ZodArray<z.ZodString>;
        resultText: z.ZodNullable<z.ZodString>;
        type: z.ZodLiteral<"webSearch">;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        pattern: z.ZodNullable<z.ZodString>;
        prompt: z.ZodNullable<z.ZodString>;
        resultText: z.ZodNullable<z.ZodString>;
        type: z.ZodLiteral<"webFetch">;
        url: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        path: z.ZodString;
        type: z.ZodLiteral<"imageView">;
    }, z.core.$strip>, z.ZodObject<{
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        error: z.ZodOptional<z.ZodString>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        result: z.ZodOptional<z.ZodUnknown>;
        server: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        statusLabels: z.ZodOptional<z.ZodObject<{
            completed: z.ZodString;
            pending: z.ZodString;
        }, z.core.$strip>>;
        tool: z.ZodString;
        truncation: z.ZodOptional<z.ZodObject<{
            aggregatedOutput: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
            result: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
            resultText: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        type: z.ZodLiteral<"toolCall">;
    }, z.core.$strip>, z.ZodObject<{
        content: z.ZodArray<z.ZodString>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        summary: z.ZodArray<z.ZodString>;
        type: z.ZodLiteral<"reasoning">;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        text: z.ZodString;
        type: z.ZodLiteral<"plan">;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        type: z.ZodLiteral<"contextCompaction">;
    }, z.core.$strip>, z.ZodObject<{
        description: z.ZodString;
        error: z.ZodOptional<z.ZodString>;
        id: z.ZodString;
        outputFile: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        skipTranscript: z.ZodBoolean;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        summary: z.ZodOptional<z.ZodString>;
        taskStatus: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            killed: "killed";
            paused: "paused";
            pending: "pending";
            running: "running";
            stopped: "stopped";
        }>;
        taskType: z.ZodString;
        type: z.ZodLiteral<"backgroundTask">;
        usage: z.ZodOptional<z.ZodObject<{
            durationMs: z.ZodNumber;
            toolUses: z.ZodNumber;
            totalTokens: z.ZodNumber;
        }, z.core.$strip>>;
        workflow: z.ZodOptional<z.ZodObject<{
            agents: z.ZodArray<z.ZodObject<{
                agentType: z.ZodOptional<z.ZodString>;
                attempt: z.ZodNumber;
                cached: z.ZodBoolean;
                durationMs: z.ZodOptional<z.ZodNumber>;
                error: z.ZodOptional<z.ZodString>;
                index: z.ZodNumber;
                isolation: z.ZodOptional<z.ZodString>;
                label: z.ZodString;
                lastProgressAt: z.ZodNumber;
                lastToolName: z.ZodOptional<z.ZodString>;
                lastToolSummary: z.ZodOptional<z.ZodString>;
                model: z.ZodString;
                phaseIndex: z.ZodOptional<z.ZodNumber>;
                phaseTitle: z.ZodOptional<z.ZodString>;
                promptPreview: z.ZodOptional<z.ZodString>;
                queuedAt: z.ZodOptional<z.ZodNumber>;
                resultPreview: z.ZodOptional<z.ZodString>;
                startedAt: z.ZodOptional<z.ZodNumber>;
                state: z.ZodEnum<{
                    done: "done";
                    failed: "failed";
                    queued: "queued";
                    running: "running";
                    skipped: "skipped";
                }>;
                tokens: z.ZodOptional<z.ZodNumber>;
                toolCalls: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            phases: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                kind: z.ZodOptional<z.ZodString>;
                title: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        workflowName: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "type">;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/started">;
}, z.core.$strip>, z.ZodObject<{
    item: z.ZodDiscriminatedUnion<[z.ZodObject<{
        clientRequestId: z.ZodOptional<z.ZodString>;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            text: z.ZodString;
            type: z.ZodLiteral<"text">;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            url: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            path: z.ZodString;
            type: z.ZodLiteral<"localImage">;
        }, z.core.$strip>, z.ZodObject<{
            path: z.ZodString;
            type: z.ZodLiteral<"localFile">;
        }, z.core.$strip>], "type">>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        type: z.ZodLiteral<"userMessage">;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        text: z.ZodString;
        type: z.ZodLiteral<"agentMessage">;
    }, z.core.$strip>, z.ZodObject<{
        aggregatedOutput: z.ZodOptional<z.ZodString>;
        approvalStatus: z.ZodNullable<z.ZodEnum<{
            denied: "denied";
            waiting_for_approval: "waiting_for_approval";
        }>>;
        command: z.ZodString;
        cwd: z.ZodString;
        durationMs: z.ZodOptional<z.ZodNumber>;
        exitCode: z.ZodOptional<z.ZodNumber>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        truncation: z.ZodOptional<z.ZodObject<{
            aggregatedOutput: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
            result: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
            resultText: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        type: z.ZodLiteral<"commandExecution">;
    }, z.core.$strip>, z.ZodObject<{
        approvalStatus: z.ZodNullable<z.ZodEnum<{
            denied: "denied";
            waiting_for_approval: "waiting_for_approval";
        }>>;
        changes: z.ZodArray<z.ZodObject<{
            diff: z.ZodOptional<z.ZodString>;
            kind: z.ZodEnum<{
                add: "add";
                delete: "delete";
                update: "update";
            }>;
            movePath: z.ZodOptional<z.ZodString>;
            path: z.ZodString;
        }, z.core.$strip>>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        type: z.ZodLiteral<"fileChange">;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        queries: z.ZodArray<z.ZodString>;
        resultText: z.ZodNullable<z.ZodString>;
        type: z.ZodLiteral<"webSearch">;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        pattern: z.ZodNullable<z.ZodString>;
        prompt: z.ZodNullable<z.ZodString>;
        resultText: z.ZodNullable<z.ZodString>;
        type: z.ZodLiteral<"webFetch">;
        url: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        path: z.ZodString;
        type: z.ZodLiteral<"imageView">;
    }, z.core.$strip>, z.ZodObject<{
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        error: z.ZodOptional<z.ZodString>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        result: z.ZodOptional<z.ZodUnknown>;
        server: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        statusLabels: z.ZodOptional<z.ZodObject<{
            completed: z.ZodString;
            pending: z.ZodString;
        }, z.core.$strip>>;
        tool: z.ZodString;
        truncation: z.ZodOptional<z.ZodObject<{
            aggregatedOutput: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
            result: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
            resultText: z.ZodOptional<z.ZodObject<{
                originalLength: z.ZodNumber;
                retainedHeadLength: z.ZodNumber;
                retainedTailLength: z.ZodNumber;
                truncatedAt: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        type: z.ZodLiteral<"toolCall">;
    }, z.core.$strip>, z.ZodObject<{
        content: z.ZodArray<z.ZodString>;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        summary: z.ZodArray<z.ZodString>;
        type: z.ZodLiteral<"reasoning">;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        text: z.ZodString;
        type: z.ZodLiteral<"plan">;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        type: z.ZodLiteral<"contextCompaction">;
    }, z.core.$strip>, z.ZodObject<{
        description: z.ZodString;
        error: z.ZodOptional<z.ZodString>;
        id: z.ZodString;
        outputFile: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        skipTranscript: z.ZodBoolean;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        summary: z.ZodOptional<z.ZodString>;
        taskStatus: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            killed: "killed";
            paused: "paused";
            pending: "pending";
            running: "running";
            stopped: "stopped";
        }>;
        taskType: z.ZodString;
        type: z.ZodLiteral<"backgroundTask">;
        usage: z.ZodOptional<z.ZodObject<{
            durationMs: z.ZodNumber;
            toolUses: z.ZodNumber;
            totalTokens: z.ZodNumber;
        }, z.core.$strip>>;
        workflow: z.ZodOptional<z.ZodObject<{
            agents: z.ZodArray<z.ZodObject<{
                agentType: z.ZodOptional<z.ZodString>;
                attempt: z.ZodNumber;
                cached: z.ZodBoolean;
                durationMs: z.ZodOptional<z.ZodNumber>;
                error: z.ZodOptional<z.ZodString>;
                index: z.ZodNumber;
                isolation: z.ZodOptional<z.ZodString>;
                label: z.ZodString;
                lastProgressAt: z.ZodNumber;
                lastToolName: z.ZodOptional<z.ZodString>;
                lastToolSummary: z.ZodOptional<z.ZodString>;
                model: z.ZodString;
                phaseIndex: z.ZodOptional<z.ZodNumber>;
                phaseTitle: z.ZodOptional<z.ZodString>;
                promptPreview: z.ZodOptional<z.ZodString>;
                queuedAt: z.ZodOptional<z.ZodNumber>;
                resultPreview: z.ZodOptional<z.ZodString>;
                startedAt: z.ZodOptional<z.ZodNumber>;
                state: z.ZodEnum<{
                    done: "done";
                    failed: "failed";
                    queued: "queued";
                    running: "running";
                    skipped: "skipped";
                }>;
                tokens: z.ZodOptional<z.ZodNumber>;
                toolCalls: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            phases: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                kind: z.ZodOptional<z.ZodString>;
                title: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        workflowName: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "type">;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/completed">;
}, z.core.$strip>, z.ZodObject<{
    delta: z.ZodString;
    itemId: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/agentMessage/delta">;
}, z.core.$strip>, z.ZodObject<{
    delta: z.ZodString;
    itemId: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    reset: z.ZodOptional<z.ZodBoolean>;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/commandExecution/outputDelta">;
}, z.core.$strip>, z.ZodObject<{
    delta: z.ZodString;
    itemId: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/fileChange/outputDelta">;
}, z.core.$strip>, z.ZodObject<{
    delta: z.ZodString;
    itemId: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/reasoning/summaryTextDelta">;
}, z.core.$strip>, z.ZodObject<{
    delta: z.ZodString;
    itemId: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/reasoning/textDelta">;
}, z.core.$strip>, z.ZodObject<{
    delta: z.ZodString;
    itemId: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/plan/delta">;
}, z.core.$strip>, z.ZodObject<{
    itemId: z.ZodString;
    message: z.ZodOptional<z.ZodString>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/mcpToolCall/progress">;
}, z.core.$strip>, z.ZodObject<{
    itemId: z.ZodString;
    message: z.ZodOptional<z.ZodString>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/toolCall/progress">;
}, z.core.$strip>, z.ZodObject<{
    item: z.ZodObject<{
        description: z.ZodString;
        error: z.ZodOptional<z.ZodString>;
        id: z.ZodString;
        outputFile: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        skipTranscript: z.ZodBoolean;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        summary: z.ZodOptional<z.ZodString>;
        taskStatus: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            killed: "killed";
            paused: "paused";
            pending: "pending";
            running: "running";
            stopped: "stopped";
        }>;
        taskType: z.ZodString;
        type: z.ZodLiteral<"backgroundTask">;
        usage: z.ZodOptional<z.ZodObject<{
            durationMs: z.ZodNumber;
            toolUses: z.ZodNumber;
            totalTokens: z.ZodNumber;
        }, z.core.$strip>>;
        workflow: z.ZodOptional<z.ZodObject<{
            agents: z.ZodArray<z.ZodObject<{
                agentType: z.ZodOptional<z.ZodString>;
                attempt: z.ZodNumber;
                cached: z.ZodBoolean;
                durationMs: z.ZodOptional<z.ZodNumber>;
                error: z.ZodOptional<z.ZodString>;
                index: z.ZodNumber;
                isolation: z.ZodOptional<z.ZodString>;
                label: z.ZodString;
                lastProgressAt: z.ZodNumber;
                lastToolName: z.ZodOptional<z.ZodString>;
                lastToolSummary: z.ZodOptional<z.ZodString>;
                model: z.ZodString;
                phaseIndex: z.ZodOptional<z.ZodNumber>;
                phaseTitle: z.ZodOptional<z.ZodString>;
                promptPreview: z.ZodOptional<z.ZodString>;
                queuedAt: z.ZodOptional<z.ZodNumber>;
                resultPreview: z.ZodOptional<z.ZodString>;
                startedAt: z.ZodOptional<z.ZodNumber>;
                state: z.ZodEnum<{
                    done: "done";
                    failed: "failed";
                    queued: "queued";
                    running: "running";
                    skipped: "skipped";
                }>;
                tokens: z.ZodOptional<z.ZodNumber>;
                toolCalls: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            phases: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                kind: z.ZodOptional<z.ZodString>;
                title: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        workflowName: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/backgroundTask/progress">;
}, z.core.$strip>, z.ZodObject<{
    item: z.ZodObject<{
        description: z.ZodString;
        error: z.ZodOptional<z.ZodString>;
        id: z.ZodString;
        outputFile: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        skipTranscript: z.ZodBoolean;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        summary: z.ZodOptional<z.ZodString>;
        taskStatus: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            killed: "killed";
            paused: "paused";
            pending: "pending";
            running: "running";
            stopped: "stopped";
        }>;
        taskType: z.ZodString;
        type: z.ZodLiteral<"backgroundTask">;
        usage: z.ZodOptional<z.ZodObject<{
            durationMs: z.ZodNumber;
            toolUses: z.ZodNumber;
            totalTokens: z.ZodNumber;
        }, z.core.$strip>>;
        workflow: z.ZodOptional<z.ZodObject<{
            agents: z.ZodArray<z.ZodObject<{
                agentType: z.ZodOptional<z.ZodString>;
                attempt: z.ZodNumber;
                cached: z.ZodBoolean;
                durationMs: z.ZodOptional<z.ZodNumber>;
                error: z.ZodOptional<z.ZodString>;
                index: z.ZodNumber;
                isolation: z.ZodOptional<z.ZodString>;
                label: z.ZodString;
                lastProgressAt: z.ZodNumber;
                lastToolName: z.ZodOptional<z.ZodString>;
                lastToolSummary: z.ZodOptional<z.ZodString>;
                model: z.ZodString;
                phaseIndex: z.ZodOptional<z.ZodNumber>;
                phaseTitle: z.ZodOptional<z.ZodString>;
                promptPreview: z.ZodOptional<z.ZodString>;
                queuedAt: z.ZodOptional<z.ZodNumber>;
                resultPreview: z.ZodOptional<z.ZodString>;
                startedAt: z.ZodOptional<z.ZodNumber>;
                state: z.ZodEnum<{
                    done: "done";
                    failed: "failed";
                    queued: "queued";
                    running: "running";
                    skipped: "skipped";
                }>;
                tokens: z.ZodOptional<z.ZodNumber>;
                toolCalls: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            phases: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                kind: z.ZodOptional<z.ZodString>;
                title: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        workflowName: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"item/backgroundTask/completed">;
}, z.core.$strip>, z.ZodObject<{
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    tokenUsage: z.ZodObject<{
        last: z.ZodObject<{
            cachedInputTokens: z.ZodNumber;
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            reasoningOutputTokens: z.ZodNumber;
            totalTokens: z.ZodNumber;
        }, z.core.$strip>;
        modelContextWindow: z.ZodNullable<z.ZodNumber>;
        total: z.ZodObject<{
            cachedInputTokens: z.ZodNumber;
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            reasoningOutputTokens: z.ZodNumber;
            totalTokens: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>;
    type: z.ZodLiteral<"thread/tokenUsage/updated">;
}, z.core.$strip>, z.ZodObject<{
    contextWindowUsage: z.ZodObject<{
        estimated: z.ZodBoolean;
        modelContextWindow: z.ZodNullable<z.ZodNumber>;
        usedTokens: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"thread/contextWindowUsage/updated">;
}, z.core.$strip>, z.ZodObject<{
    explanation: z.ZodOptional<z.ZodString>;
    plan: z.ZodArray<z.ZodObject<{
        status: z.ZodOptional<z.ZodEnum<{
            active: "active";
            completed: "completed";
            failed: "failed";
            pending: "pending";
        }>>;
        step: z.ZodString;
    }, z.core.$strip>>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"turn/plan/updated">;
}, z.core.$strip>, z.ZodObject<{
    diff: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"turn/diff/updated">;
}, z.core.$strip>, z.ZodObject<{
    detail: z.ZodOptional<z.ZodString>;
    errorInfo: z.ZodOptional<z.ZodObject<{
        category: z.ZodEnum<{
            "active-turn-not-steerable": "active-turn-not-steerable";
            "bad-request": "bad-request";
            "budget-exceeded": "budget-exceeded";
            "connection-failed": "connection-failed";
            "context-window-exceeded": "context-window-exceeded";
            "max-output-tokens": "max-output-tokens";
            "max-turns": "max-turns";
            "rate-limit": "rate-limit";
            "stream-disconnected": "stream-disconnected";
            "structured-output-retries": "structured-output-retries";
            "thread-rollback-failed": "thread-rollback-failed";
            "too-many-failed-attempts": "too-many-failed-attempts";
            billing: "billing";
            internal: "internal";
            overloaded: "overloaded";
            policy: "policy";
            sandbox: "sandbox";
            unauthorized: "unauthorized";
            unknown: "unknown";
        }>;
        httpStatusCode: z.ZodNullable<z.ZodNumber>;
        providerCode: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    message: z.ZodString;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"provider/error">;
    willRetry: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>, z.ZodObject<{
    providerThreadId: z.ZodString;
    rateLimits: z.ZodObject<{
        kind: z.ZodEnum<{
            "spend-control": "spend-control";
            "subscription-window": "subscription-window";
            credits: "credits";
            unknown: "unknown";
        }>;
        overageReason: z.ZodNullable<z.ZodString>;
        overageStatus: z.ZodNullable<z.ZodEnum<{
            allowed: "allowed";
            rejected: "rejected";
            unavailable: "unavailable";
            warning: "warning";
        }>>;
        providerId: z.ZodString;
        reachedReason: z.ZodNullable<z.ZodString>;
        status: z.ZodEnum<{
            allowed: "allowed";
            blocked: "blocked";
            unknown: "unknown";
            warning: "warning";
        }>;
        windows: z.ZodArray<z.ZodObject<{
            label: z.ZodNullable<z.ZodString>;
            providerKey: z.ZodNullable<z.ZodString>;
            resetsAtMs: z.ZodNullable<z.ZodNumber>;
            status: z.ZodEnum<{
                allowed: "allowed";
                blocked: "blocked";
                unknown: "unknown";
                warning: "warning";
            }>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    threadId: z.ZodString;
    type: z.ZodLiteral<"provider/rateLimits/updated">;
}, z.core.$strip>, z.ZodObject<{
    category: z.ZodEnum<{
        "compaction-skipped": "compaction-skipped";
        config: "config";
        deprecation: "deprecation";
        general: "general";
    }>;
    details: z.ZodOptional<z.ZodString>;
    providerThreadId: z.ZodString;
    summary: z.ZodOptional<z.ZodString>;
    threadId: z.ZodString;
    type: z.ZodLiteral<"provider/warning">;
}, z.core.$strip>, z.ZodObject<{
    fallbackModel: z.ZodString;
    message: z.ZodString;
    originalModel: z.ZodString;
    providerThreadId: z.ZodString;
    reason: z.ZodEnum<{
        provider: "provider";
        refusal: "refusal";
    }>;
    threadId: z.ZodString;
    type: z.ZodLiteral<"provider/modelFallback">;
}, z.core.$strip>, z.ZodObject<{
    parentToolCallId: z.ZodOptional<z.ZodString>;
    providerId: z.ZodString;
    providerThreadId: z.ZodString;
    rawEvent: z.ZodObject<{
        id: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>;
        jsonrpc: z.ZodLiteral<"2.0">;
        method: z.ZodString;
        params: z.ZodOptional<z.ZodType<JsonValue, unknown, z.core.$ZodTypeInternals<JsonValue, unknown>>>;
    }, z.core.$strip>;
    rawType: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"provider/unhandled">;
}, z.core.$strip>], "type">, z.ZodObject<{
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"thread">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"turn">;
        turnId: z.ZodString;
    }, z.core.$strip>], "kind">;
}, z.core.$strip>>, z.ZodIntersection<z.ZodUnion<readonly [z.ZodObject<{
    direction: z.ZodLiteral<"outbound">;
    initiator: z.ZodEnum<{
        agent: "agent";
        system: "system";
        user: "user";
    }>;
    request: z.ZodObject<{
        method: z.ZodEnum<{
            "thread/start": "thread/start";
            "turn/start": "turn/start";
        }>;
        params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, z.core.$strip>;
    source: z.ZodEnum<{
        spawn: "spawn";
        tell: "tell";
    }>;
    threadId: z.ZodString;
    type: z.ZodLiteral<"client/thread/start">;
}, z.core.$strip>, z.ZodObject<{
    continuationOfRequestId: z.ZodOptional<z.ZodString>;
    direction: z.ZodLiteral<"outbound">;
    execution: z.ZodObject<{
        model: z.ZodString;
        permissionMode: z.ZodEnum<{
            "accept-edits": "accept-edits";
            "workspace-write": "workspace-write";
            auto: "auto";
            full: "full";
            readonly: "readonly";
        }>;
        reasoningLevel: z.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            none: "none";
            ultra: "ultra";
            ultracode: "ultracode";
            xhigh: "xhigh";
        }>;
        seq: z.ZodOptional<z.ZodNumber>;
        serviceTier: z.ZodEnum<{
            default: "default";
            fast: "fast";
        }>;
        source: z.ZodEnum<{
            "client/thread/start": "client/thread/start";
            "client/turn/requested": "client/turn/requested";
            "client/turn/start": "client/turn/start";
        }>;
    }, z.core.$strip>;
    initiator: z.ZodEnum<{
        agent: "agent";
        system: "system";
        user: "user";
    }>;
    input: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        mentions: z.ZodDefault<z.ZodArray<z.ZodObject<{
            end: z.ZodNumber;
            resource: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"thread">;
                label: z.ZodString;
                projectId: z.ZodOptional<z.ZodString>;
                threadId: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"project">;
                label: z.ZodString;
                projectId: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"section">;
                label: z.ZodString;
                sectionId: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                entryKind: z.ZodEnum<{
                    directory: "directory";
                    file: "file";
                }>;
                kind: z.ZodLiteral<"path">;
                label: z.ZodString;
                path: z.ZodString;
                source: z.ZodEnum<{
                    "thread-storage": "thread-storage";
                    workspace: "workspace";
                }>;
            }, z.core.$strip>, z.ZodObject<{
                argumentHint: z.ZodNullable<z.ZodString>;
                kind: z.ZodLiteral<"command">;
                label: z.ZodString;
                name: z.ZodString;
                origin: z.ZodEnum<{
                    builtin: "builtin";
                    project: "project";
                    user: "user";
                }>;
                source: z.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                trigger: z.ZodEnum<{
                    "/": "/";
                }>;
            }, z.core.$strip>, z.ZodObject<{
                icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                itemId: z.ZodString;
                kind: z.ZodLiteral<"plugin">;
                label: z.ZodString;
                pluginId: z.ZodString;
            }, z.core.$strip>], "kind">>;
            start: z.ZodNumber;
        }, z.core.$strip>>>;
        text: z.ZodString;
        type: z.ZodLiteral<"text">;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        url: z.ZodString;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        path: z.ZodString;
        type: z.ZodLiteral<"localImage">;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        mimeType: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        path: z.ZodString;
        sizeBytes: z.ZodOptional<z.ZodNumber>;
        type: z.ZodLiteral<"localFile">;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>], "type">>;
    inputGroups: z.ZodOptional<z.ZodArray<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        mentions: z.ZodDefault<z.ZodArray<z.ZodObject<{
            end: z.ZodNumber;
            resource: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"thread">;
                label: z.ZodString;
                projectId: z.ZodOptional<z.ZodString>;
                threadId: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"project">;
                label: z.ZodString;
                projectId: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"section">;
                label: z.ZodString;
                sectionId: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                entryKind: z.ZodEnum<{
                    directory: "directory";
                    file: "file";
                }>;
                kind: z.ZodLiteral<"path">;
                label: z.ZodString;
                path: z.ZodString;
                source: z.ZodEnum<{
                    "thread-storage": "thread-storage";
                    workspace: "workspace";
                }>;
            }, z.core.$strip>, z.ZodObject<{
                argumentHint: z.ZodNullable<z.ZodString>;
                kind: z.ZodLiteral<"command">;
                label: z.ZodString;
                name: z.ZodString;
                origin: z.ZodEnum<{
                    builtin: "builtin";
                    project: "project";
                    user: "user";
                }>;
                source: z.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                trigger: z.ZodEnum<{
                    "/": "/";
                }>;
            }, z.core.$strip>, z.ZodObject<{
                icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                itemId: z.ZodString;
                kind: z.ZodLiteral<"plugin">;
                label: z.ZodString;
                pluginId: z.ZodString;
            }, z.core.$strip>], "kind">>;
            start: z.ZodNumber;
        }, z.core.$strip>>>;
        text: z.ZodString;
        type: z.ZodLiteral<"text">;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        url: z.ZodString;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        path: z.ZodString;
        type: z.ZodLiteral<"localImage">;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        mimeType: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        path: z.ZodString;
        sizeBytes: z.ZodOptional<z.ZodNumber>;
        type: z.ZodLiteral<"localFile">;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>], "type">>>>;
    request: z.ZodObject<{
        method: z.ZodEnum<{
            "thread/start": "thread/start";
            "turn/start": "turn/start";
        }>;
        params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, z.core.$strip>;
    requestId: z.ZodString;
    senderThreadId: z.ZodNullable<z.ZodString>;
    source: z.ZodEnum<{
        spawn: "spawn";
        tell: "tell";
    }>;
    systemMessageKind: z.ZodOptional<z.ZodEnum<{
        "child-completed": "child-completed";
        "child-failed": "child-failed";
        "child-interrupted": "child-interrupted";
        "child-needs-attention": "child-needs-attention";
        "child-outcome-batch": "child-outcome-batch";
        "ownership-assigned": "ownership-assigned";
        "ownership-removed": "ownership-removed";
        unlabeled: "unlabeled";
    }>>;
    systemMessageSubject: z.ZodOptional<z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"thread">;
        threadId: z.ZodString;
        threadName: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        count: z.ZodNumber;
        kind: z.ZodLiteral<"thread-batch">;
    }, z.core.$strip>], "kind">>>;
    target: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"thread-start">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"new-turn">;
    }, z.core.$strip>, z.ZodObject<{
        expectedTurnId: z.ZodNullable<z.ZodString>;
        kind: z.ZodLiteral<"auto">;
    }, z.core.$strip>, z.ZodObject<{
        expectedTurnId: z.ZodNullable<z.ZodString>;
        kind: z.ZodLiteral<"steer">;
    }, z.core.$strip>], "kind">;
    threadId: z.ZodString;
    type: z.ZodLiteral<"client/turn/requested">;
}, z.core.$strip>, z.ZodObject<{
    message: z.ZodString;
    reason: z.ZodString;
    requestId: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"client/turn/rejected">;
}, z.core.$strip>, z.ZodObject<{
    direction: z.ZodLiteral<"outbound">;
    initiator: z.ZodEnum<{
        agent: "agent";
        system: "system";
        user: "user";
    }>;
    request: z.ZodObject<{
        method: z.ZodEnum<{
            "thread/start": "thread/start";
            "turn/start": "turn/start";
        }>;
        params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, z.core.$strip>;
    source: z.ZodEnum<{
        spawn: "spawn";
        tell: "tell";
    }>;
    threadId: z.ZodString;
    type: z.ZodLiteral<"client/turn/start">;
}, z.core.$strip>, z.ZodObject<{
    code: z.ZodOptional<z.ZodString>;
    detail: z.ZodOptional<z.ZodString>;
    message: z.ZodString;
    reconnectAttempt: z.ZodOptional<z.ZodNumber>;
    reconnectTotal: z.ZodOptional<z.ZodNumber>;
    threadId: z.ZodString;
    type: z.ZodLiteral<"system/error">;
}, z.core.$strip>, z.ZodObject<{
    text: z.ZodString;
    threadId: z.ZodString;
    toolCallId: z.ZodOptional<z.ZodString>;
    turnId: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"system/manager/user_message">;
}, z.core.$strip>, z.ZodObject<{
    reason: z.ZodEnum<{
        "host-daemon-restarted": "host-daemon-restarted";
        "manual-stop": "manual-stop";
        "provider-turn-idle": "provider-turn-idle";
    }>;
    threadId: z.ZodString;
    type: z.ZodLiteral<"system/thread/interrupted">;
}, z.core.$strip>, z.ZodObject<{
    message: z.ZodString;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<JsonValue, unknown, z.core.$ZodTypeInternals<JsonValue, unknown>>>>;
    operation: z.ZodString;
    operationId: z.ZodString;
    status: z.ZodString;
    threadId: z.ZodString;
    type: z.ZodLiteral<"system/operation">;
}, z.core.$strip>, z.ZodObject<{
    interactionId: z.ZodString;
    providerId: z.ZodString;
    providerRequestId: z.ZodString;
    resolution: z.ZodDefault<z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
        decision: z.ZodLiteral<"allow_once">;
        grantedPermissions: z.ZodNullable<z.ZodObject<{
            fileSystem: z.ZodNullable<z.ZodObject<{
                read: z.ZodArray<z.ZodString>;
                write: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
            network: z.ZodNullable<z.ZodObject<{
                enabled: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>>;
        }, z.core.$strict>>;
    }, z.core.$strip>, z.ZodObject<{
        decision: z.ZodLiteral<"allow_for_session">;
        grantedPermissions: z.ZodNullable<z.ZodObject<{
            fileSystem: z.ZodNullable<z.ZodObject<{
                read: z.ZodArray<z.ZodString>;
                write: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
            network: z.ZodNullable<z.ZodObject<{
                enabled: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>>;
        }, z.core.$strict>>;
    }, z.core.$strip>, z.ZodObject<{
        decision: z.ZodLiteral<"deny">;
    }, z.core.$strip>], "decision">>>;
    status: z.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolved: "resolved";
        resolving: "resolving";
    }>;
    statusReason: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    subject: z.ZodObject<{
        itemId: z.ZodString;
        kind: z.ZodLiteral<"permission_grant">;
        permissions: z.ZodObject<{
            fileSystem: z.ZodNullable<z.ZodObject<{
                read: z.ZodArray<z.ZodString>;
                write: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
            network: z.ZodNullable<z.ZodObject<{
                enabled: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>>;
        }, z.core.$strict>;
        toolName: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    threadId: z.ZodString;
    type: z.ZodLiteral<"system/permissionGrant/lifecycle">;
}, z.core.$strip>, z.ZodObject<{
    interactionId: z.ZodString;
    payload: z.ZodObject<{
        kind: z.ZodLiteral<"user_question">;
        questions: z.ZodArray<z.ZodObject<{
            allowFreeText: z.ZodBoolean;
            id: z.ZodString;
            multiSelect: z.ZodBoolean;
            options: z.ZodOptional<z.ZodArray<z.ZodObject<{
                description: z.ZodOptional<z.ZodString>;
                label: z.ZodString;
                value: z.ZodString;
            }, z.core.$strip>>>;
            prompt: z.ZodString;
            shortLabel: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    providerId: z.ZodString;
    providerRequestId: z.ZodString;
    resolution: z.ZodDefault<z.ZodNullable<z.ZodObject<{
        answers: z.ZodRecord<z.ZodString, z.ZodObject<{
            freeText: z.ZodOptional<z.ZodString>;
            selected: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
        kind: z.ZodLiteral<"user_answer">;
    }, z.core.$strip>>>;
    status: z.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolved: "resolved";
        resolving: "resolving";
    }>;
    statusReason: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    threadId: z.ZodString;
    type: z.ZodLiteral<"system/userQuestion/lifecycle">;
}, z.core.$strip>, z.ZodObject<{
    entries: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        startedAt: z.ZodOptional<z.ZodNumber>;
        status: z.ZodOptional<z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            started: "started";
        }>>;
        text: z.ZodString;
        type: z.ZodEnum<{
            output: "output";
            step: "step";
        }>;
    }, z.core.$strip>>;
    environmentId: z.ZodString;
    provisioningId: z.ZodString;
    status: z.ZodEnum<{
        active: "active";
        cancelled: "cancelled";
        completed: "completed";
        failed: "failed";
    }>;
    threadId: z.ZodString;
    type: z.ZodLiteral<"system/thread-provisioning">;
}, z.core.$strip>, z.ZodObject<{
    activeTurnId: z.ZodString;
    activeTurnStartedAt: z.ZodNumber;
    elapsedMs: z.ZodNumber;
    firedAt: z.ZodNumber;
    lastActivityEventAt: z.ZodNumber;
    lastActivityEventSequence: z.ZodNumber;
    lastActivityEventType: z.ZodString;
    providerId: z.ZodString;
    providerThreadId: z.ZodNullable<z.ZodString>;
    reason: z.ZodLiteral<"provider-turn-idle">;
    threadId: z.ZodString;
    thresholdMs: z.ZodNumber;
    type: z.ZodLiteral<"system/provider-turn-watchdog">;
}, z.core.$strip>]>, z.ZodObject<{
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"thread">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"turn">;
        turnId: z.ZodString;
    }, z.core.$strip>], "kind">;
}, z.core.$strip>>]>>;
type ThreadEvent = z.infer<typeof threadEventSchema>;
type ThreadEventType = ThreadEvent["type"];

declare const modelReasoningEffortSchema: z.ZodObject<{
    description: z.ZodString;
    reasoningEffort: z.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        none: "none";
        ultra: "ultra";
        ultracode: "ultracode";
        xhigh: "xhigh";
    }>;
}, z.core.$strip>;
type ModelReasoningEffort = z.infer<typeof modelReasoningEffortSchema>;
declare const availableModelSchema: z.ZodObject<{
    defaultReasoningEffort: z.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        none: "none";
        ultra: "ultra";
        ultracode: "ultracode";
        xhigh: "xhigh";
    }>;
    description: z.ZodString;
    displayName: z.ZodString;
    id: z.ZodString;
    isDefault: z.ZodBoolean;
    model: z.ZodString;
    routeProviderId: z.ZodOptional<z.ZodString>;
    supportedReasoningEfforts: z.ZodArray<z.ZodObject<{
        description: z.ZodString;
        reasoningEffort: z.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            none: "none";
            ultra: "ultra";
            ultracode: "ultracode";
            xhigh: "xhigh";
        }>;
    }, z.core.$strip>>;
}, z.core.$strip>;
type AvailableModel = z.infer<typeof availableModelSchema>;
declare const dynamicToolSchema: z.ZodObject<{
    description: z.ZodString;
    inputSchema: z.ZodUnknown;
    name: z.ZodString;
}, z.core.$strip>;
type DynamicTool = z.infer<typeof dynamicToolSchema>;

declare const NONE_REASONING_EFFORT: ModelReasoningEffort;
declare const LOW_REASONING_EFFORT: ModelReasoningEffort;
declare const MEDIUM_REASONING_EFFORT: ModelReasoningEffort;
declare const HIGH_REASONING_EFFORT: ModelReasoningEffort;
declare const XHIGH_REASONING_EFFORT: ModelReasoningEffort;
declare const ULTRACODE_REASONING_EFFORT: ModelReasoningEffort;
declare const MAX_REASONING_EFFORT: ModelReasoningEffort;
declare function reasoningEffortsForLevels(levels: readonly ReasoningLevel[]): ModelReasoningEffort[];

declare const threadEventScopeSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"thread">;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"turn">;
    turnId: z.ZodString;
}, z.core.$strip>], "kind">;
type ThreadEventScope = z.infer<typeof threadEventScopeSchema>;
interface RequireThreadEventScopeTurnIdArgs {
    scope: ThreadEventScope;
    type: ThreadEventType;
}
declare function threadScope(): ThreadEventScope;
declare function turnScope(turnId: string): ThreadEventScope;
declare function getThreadEventScopeTurnId(scope: ThreadEventScope): string | undefined;
declare function requireThreadEventScopeTurnId(args: RequireThreadEventScopeTurnIdArgs): string;

interface AcceptedUserMessageState {
    pendingAcceptedUserMessages: AcceptedUserMessage[];
}
interface AcceptedUserMessage {
    clientRequestId: ClientTurnRequestId;
}
interface CreateAcceptedUserMessageArgs {
    clientRequestId: ClientTurnRequestId;
}
interface BuildAcceptedUserMessageEventArgs extends CreateAcceptedUserMessageArgs {
    providerThreadId: string;
    threadId: string;
    turnId: string;
}
interface QueueAcceptedUserMessageArgs<TState extends AcceptedUserMessageState> extends CreateAcceptedUserMessageArgs {
    state: TState;
}
declare function buildAcceptedUserMessageEvent(args: BuildAcceptedUserMessageEventArgs): ThreadEvent[];
declare function queueAcceptedUserMessage<TState extends AcceptedUserMessageState>(args: QueueAcceptedUserMessageArgs<TState>): void;

/**
 * Shared adapter utilities.
 *
 * Functions and constants duplicated across the claude-code, pi, and codex
 * adapters are extracted here so each adapter imports from one place.
 */

/**
 * Builds a compact unified-diff-like string from old/new text pairs.
 * Exported so each adapter can call it with its own arg names.
 */
declare function buildEditDiff(filePath: string, oldString: string | undefined, newString: string | undefined): string | undefined;
declare function toOptionalString(value: unknown): string | undefined;
declare function toOptionalRecord(value: unknown): Record<string, unknown> | undefined;
declare function withParentToolCallId<TItem extends ThreadEventItem>(item: TItem, parentToolCallId?: string): TItem;
/**
 * The environment overrides a bridge may hand its provider: the requested
 * variables minus any name a shell would refuse. A rejected name is dropped,
 * never passed through — a provider that inherits an unquotable name can fail
 * its whole session on one bad key.
 */
declare function buildShellEnvOverrides(envVars?: Record<string, string>): Record<string, string>;
declare function toNonNegativeNumber(value: unknown): number;
declare function normalizeProviderCommandOutput(args: {
    emptyPlaceholders: readonly string[];
    text: string;
}): string | undefined;
/**
 * Extracts text from tool result content.
 * Handles strings, arrays of text blocks, and `{ content: [...] }` wrappers.
 */
declare function extractResultText(content: unknown): string;

type BridgeJsonRpcId = string | number;
type BridgeJsonRpcResponse$1 = {
    jsonrpc: "2.0";
    id: BridgeJsonRpcId;
    result: unknown;
} | {
    jsonrpc: "2.0";
    id: BridgeJsonRpcId;
    error: {
        code: number;
        message: string;
    };
};
interface CreateBridgeIoArgs {
    write?: (line: string) => void;
}
declare function createBridgeIo<TMessage>({ write, }?: CreateBridgeIoArgs): {
    send: (message: TMessage | BridgeJsonRpcResponse$1) => void;
    sendError: (id: BridgeJsonRpcId, code: number, message: string) => void;
    sendResult: (id: BridgeJsonRpcId, result: unknown) => void;
};
declare function createBridgeLineHandler(args: {
    handleParsedMessage: (message: unknown) => void;
}): (line: string) => void;
declare function runBridgeRequest<TRequest extends {
    id: BridgeJsonRpcId;
}>(args: {
    handleRequest: (request: TRequest) => Promise<void>;
    request: TRequest;
    sendError: (id: BridgeJsonRpcId, code: number, message: string) => void;
}): void;

declare function withoutBridgeRuntimeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;

/**
 * Shared tool call helpers for bridge processes.
 *
 * Both claude-code and pi bridges forward tool calls from the provider SDK
 * to the host-daemon and feed responses back. This module provides:
 * - The JSON-RPC request type for forwarding tool calls
 * - Response decoding for tool call results from the host-daemon
 * - Generic JSON-RPC response decoding (for matching tool call responses)
 */

interface BridgeToolCallRequest {
    jsonrpc: "2.0";
    id: string | number;
    method: "item/tool/call";
    params: {
        providerThreadId: string;
        threadId?: string;
        turnId: string | null;
        callId: string;
        tool: string;
        arguments: Record<string, unknown>;
    };
}
declare const bridgeRequestEnvelopeSchema: z.ZodObject<{
    id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    jsonrpc: z.ZodLiteral<"2.0">;
    method: z.ZodString;
    params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
declare const jsonRpcSuccessResponseSchema: z.ZodObject<{
    id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    jsonrpc: z.ZodLiteral<"2.0">;
    result: z.ZodUnknown;
}, z.core.$strip>;
declare const jsonRpcErrorResponseSchema: z.ZodObject<{
    error: z.ZodObject<{
        code: z.ZodNumber;
        data: z.ZodOptional<z.ZodUnknown>;
        message: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    jsonrpc: z.ZodLiteral<"2.0">;
}, z.core.$strip>;
type BridgeJsonRpcResponse = z.infer<typeof jsonRpcSuccessResponseSchema> | z.infer<typeof jsonRpcErrorResponseSchema>;
declare function decodeBridgeJsonRpcResponse(input: unknown): BridgeJsonRpcResponse | null;
declare function decodeToolCallResponsePayload(result: unknown): {
    content: string;
    isError: boolean;
};

/**
 * Structural contracts shared by the runtime's generic adapter and the bridge
 * implementations that translate a provider's native protocol.
 *
 * These are the shapes a bridge produces or consumes while it maps its
 * provider onto the canonical protocol. They live in the kit (rather than in
 * `@bb/agent-runtime`) so a bridge shipped from a plugin never depends on the
 * runtime package.
 */

interface ProviderRequestCommandPlan {
    kind: "request";
    method: string;
    params?: object;
}
interface ProviderPostInitializeRequest {
    plan: ProviderRequestCommandPlan;
    required: boolean;
    onResult(result: unknown): void;
}
interface DecodedInteractiveRequest {
    requestId: string | number;
    method: string;
    providerThreadId: string;
    /**
     * Non-empty BB turn id when known. Use null as the canonical unresolved
     * value so the runtime can resolve from the active turn; empty strings are
     * malformed adapter output.
     */
    turnId: string | null;
    payload: PendingInteractionPayload;
    threadId?: string;
}
interface PreparedProviderCommandDispatch {
    rollback(): void;
    /**
     * Claims the prepared correlation if no provider event has consumed it yet,
     * proving this dispatch still owns unstarted work. Returns true (and drops
     * the correlation, so nothing can consume it twice) when the provider never
     * started a turn for this dispatch; false once it did. Callers use it to
     * settle a prompt the provider accepted and finished without emitting any
     * turn activity, without fabricating a turn from a late signal.
     */
    claim(): boolean;
}
interface BuildInteractiveResponseArgs {
    request: DecodedInteractiveRequest;
    resolution: PendingInteractionResolution;
}

declare const jsonRpcEnvelopeSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    method: z.ZodString;
    params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$loose>;
declare const sdkMessageEnvelopeSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    method: z.ZodLiteral<"sdk/message">;
    params: z.ZodObject<{
        message: z.ZodUnknown;
        parent_tool_use_id: z.ZodOptional<z.ZodString>;
        threadId: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>;
}, z.core.$loose>;
declare const threadIdentityEnvelopeSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    method: z.ZodLiteral<"thread/identity">;
    params: z.ZodObject<{
        providerThreadId: z.ZodOptional<z.ZodString>;
        threadId: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>;
}, z.core.$loose>;
declare const threadContextWindowUsageEnvelopeSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    method: z.ZodLiteral<"thread/contextWindowUsage/updated">;
    params: z.ZodObject<{
        contextWindowUsage: z.ZodObject<{
            estimated: z.ZodBoolean;
            modelContextWindow: z.ZodNullable<z.ZodNumber>;
            usedTokens: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        threadId: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>;
}, z.core.$loose>;
declare const errorEnvelopeSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    method: z.ZodLiteral<"error">;
    params: z.ZodOptional<z.ZodObject<{
        message: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
}, z.core.$loose>;

declare function mimeTypeFromExtension(filePath: string): string;

interface BridgeToolCallResult {
    content: string;
    isError?: boolean;
}
interface ForwardBridgeToolCallArgs {
    arguments: Record<string, unknown>;
    providerThreadId: string;
    /**
     * The session the pending call belongs to. `resolvePendingToolCalls`
     * error-resolves by scope identity, so a bridge passes its own session
     * object and settles that session's calls on close/replace without touching
     * calls minted by a successor session under the same thread id.
     */
    scope: object;
    threadId: string;
    toolName: string;
}
interface PendingToolCallTracker {
    /**
     * Mints an `item/tool/call` JSON-RPC request toward the runtime and returns
     * a promise settled by the matching response (or by
     * `resolvePendingToolCalls`). Never rejects: failures resolve as
     * `isError: true` results.
     */
    forwardToolCall: (args: ForwardBridgeToolCallArgs) => Promise<BridgeToolCallResult>;
    /** Returns true when the response settled a pending tool call. */
    handleToolCallResponse: (response: BridgeJsonRpcResponse) => boolean;
    /** Error-resolves every pending call minted under `scope`. */
    resolvePendingToolCalls: (scope: object, message: string) => void;
}
/**
 * Tracks the bridge's outgoing tool-call requests: mints request ids, sends
 * the `item/tool/call` envelope, and matches responses back to their waiting
 * promise via `decodeToolCallResponsePayload`.
 */
declare function createPendingToolCallTracker(options: {
    sendToolCall: (request: BridgeToolCallRequest) => void;
}): PendingToolCallTracker;

/**
 * The single statement of when an interactive provider request is answered
 * without ever reaching the user.
 *
 * Both sides of the bridge boundary enforce it and they must agree: a bridge
 * auto-denies its provider's own permission prompts, and the runtime
 * auto-denies the inbound requests that still arrive (a bridge whose provider
 * only learns the policy after the prompt is already in flight). Stating it
 * twice is how the two sides drift, so it lives in the kit — the one place a
 * plugin-shipped bridge and `@bb/agent-runtime` can both import from.
 */

interface InteractiveRequestPolicyInput {
    permissionEscalation: PermissionEscalation | null;
}
declare function shouldAutoDenyInteractiveRequest(policy: InteractiveRequestPolicyInput): boolean;

/**
 * The bridge export shape.
 *
 * A provider bridge is a module inside its plugin's `bb.host` artifact that
 * *exports* its surface instead of starting itself: the daemon-side bootstrap
 * imports the artifact, finds this export, and owns the process boundary
 * (argv, plugin-scoped directories, stdin framing, signals). That inversion is
 * what lets one artifact carry both a bridge and a host RPC entry, and what
 * lets a bridge be imported by tests without taking over stdio.
 */
/** The name a bridge must export from its plugin's host artifact. */
declare const PROVIDER_BRIDGE_EXPORT_NAME = "experimental_providerBridge";
/** Where this bridge process may keep files, scoped to the owning plugin. */
interface ProviderBridgeContext {
    /** The plugin that ships this bridge. */
    pluginId: string;
    /** Persistent, per-plugin, survives daemon restarts and plugin updates. */
    dataDir: string;
    /** This process only; removed when it exits. */
    tempDir: string;
}
interface ProviderBridgeDefinition {
    /** One decoded stdin line of the Provider Bridge Protocol. */
    handleLine: (line: string) => void;
    /**
     * Called once before the first line is read, with the process's
     * plugin-scoped directories. Omit it when the bridge keeps no files.
     */
    start?: (context: ProviderBridgeContext) => void;
    /** Stdin closed: the runtime is gone and the bridge must shut down. */
    onClose?: () => void;
    onSigterm?: () => void;
    onSigint?: () => void;
}
interface ProviderBridgeEntry extends ProviderBridgeDefinition {
    /** Bumped when the bootstrap↔bridge contract changes incompatibly. */
    experimental_apiVersion: 1;
}
declare function experimental_defineProviderBridge(definition: ProviderBridgeDefinition): ProviderBridgeEntry;

interface ProviderTurnState {
    assistantMessageCounter: number;
    counter: number;
    currentTurnId: string | undefined;
    cumulativeTokens: ThreadEventTokenUsageBreakdown;
    openAssistantMessageIdsByScope: Map<string, string>;
    openScopedItemIdsByScope: Map<string, string>;
    /** Accepted turn input queued while no turn was open; drained on turn start. */
    pendingAcceptedUserMessages: AcceptedUserMessage[];
    toolItemsByCallId: Map<string, ThreadEventItem>;
}
interface CreateProviderTurnStateRegistryOptions<TState extends ProviderTurnState> {
    createState: () => TState;
    /**
     * When provided, idle entries for which this returns false are skipped by
     * LRU pruning — e.g. threads whose state tracks open background tasks that
     * outlive turns. Entries with an active turn are never pruned regardless.
     */
    isEvictable?: (state: TState) => boolean;
    maxEntries?: number;
    onTurnFinish?: (args: FinishProviderTurnArgs<TState>) => void;
    onTurnStart?: (args: EnsureProviderTurnStartedArgs<TState> & {
        turnId: string;
    }) => void;
    turnIdPrefix?: string;
}
interface ProviderTurnStateRegistry<TState extends ProviderTurnState> {
    buildErrorEvents(args: BuildProviderErrorEventsArgs): ThreadEvent[];
    ensureTurnStarted(args: EnsureProviderTurnStartedArgs<TState>): string;
    finishTurn(args: FinishProviderTurnArgs<TState>): void;
    get(args: GetProviderTurnStateArgs): TState | null;
    getCurrentOrLastTurnId(args: GetCurrentOrLastProviderTurnIdArgs<TState>): string;
    getOrCreate(args: GetProviderTurnStateArgs): TState;
    getOrCreateAssistantMessageId(args: GetOrCreateAssistantMessageIdArgs<TState>): string;
    resolveCompletedAssistantMessageId(args: ResolveCompletedAssistantMessageIdArgs<TState>): string;
}
interface EnsureProviderTurnStartedArgs<TState extends ProviderTurnState> {
    events: ThreadEvent[];
    state: TState;
    threadId: string;
}
interface FinishProviderTurnArgs<TState extends ProviderTurnState> {
    state: TState;
    threadId: string;
}
interface BuildProviderErrorEventsArgs {
    contextThreadId?: string;
    detail: string;
}
interface GetProviderTurnStateArgs {
    threadId: string;
}
interface GetCurrentOrLastProviderTurnIdArgs<TState extends ProviderTurnState> {
    state: TState;
}
interface GetOrCreateAssistantMessageIdArgs<TState extends ProviderTurnState> {
    assistantIdPrefix: string;
    parentToolCallId?: string;
    state: TState;
}
interface ResolveCompletedAssistantMessageIdArgs<TState extends ProviderTurnState> {
    assistantIdPrefix: string;
    parentToolCallId?: string;
    providerMessageId?: string;
    state: TState;
}
declare function createProviderTurnStateRegistry<TState extends ProviderTurnState>(options: CreateProviderTurnStateRegistryOptions<TState>): ProviderTurnStateRegistry<TState>;

interface ResolveProviderTerminalTurnArgs<TState extends ProviderTurnState & AcceptedUserMessageState> {
    events: ThreadEvent[];
    registry: ProviderTurnStateRegistry<TState>;
    state: TState;
    threadId: string;
}
/**
 * Resolve the turn owned by a provider terminal signal. Accepted input can
 * finish before the provider emits an ordinary event that starts the turn.
 * The pending-input queue proves that the terminal signal still owns work;
 * once a turn starts or a session closes, that queue is drained instead.
 */
declare function resolveProviderTerminalTurn<TState extends ProviderTurnState & AcceptedUserMessageState>(args: ResolveProviderTerminalTurnArgs<TState>): string | undefined;

type JsonRpcObject = Record<string, unknown>;
interface JsonRpcMessage extends JsonRpcObject {
    jsonrpc: "2.0";
    id?: string | number;
    method: string;
    params?: unknown;
}
interface ProviderInboundRequest {
    id?: string | number;
    method: string;
    params?: unknown;
}
type ProviderRuntimeEvent = JsonRpcObject;
declare class ProviderRequestDecodeError extends Error {
    readonly code = -32602;
    constructor(message: string);
}
declare class ProviderResponseEncodeError extends Error {
    readonly code = -32602;
    constructor(message: string);
}

type ProviderRawEventCoverage = "noise" | "normalized" | "unknown";
interface ProviderRawEventDescription {
    kind: string;
    coverage: ProviderRawEventCoverage;
}
interface ProviderParsedRawEvent {
    kind: string;
}
interface ProviderVisibilityMetadata<TRawEvent extends ProviderParsedRawEvent = ProviderParsedRawEvent> {
    parseRawEvent(event: JsonRpcMessage): TRawEvent;
    describeParsedRawEvent(event: TRawEvent): ProviderRawEventDescription;
    describeRawEvent(event: JsonRpcMessage): ProviderRawEventDescription;
}
interface CreateProviderVisibilityMetadataArgs<TRawEvent extends ProviderParsedRawEvent> {
    parseRawEvent(event: JsonRpcMessage): TRawEvent;
    describeParsedRawEvent(event: TRawEvent): ProviderRawEventDescription;
}
declare function createProviderVisibilityMetadata<TRawEvent extends ProviderParsedRawEvent>(args: CreateProviderVisibilityMetadataArgs<TRawEvent>): ProviderVisibilityMetadata<TRawEvent>;

/**
 * Shared fallback helpers for provider events that do not yet have a
 * first-class translation path.
 */

interface CreateUnhandledProviderEventArgs {
    providerId: string;
    rawEvent: JsonRpcMessage;
    rawType: string;
    threadId?: string;
    providerThreadId?: string;
    turnId?: string;
    parentToolCallId?: string;
}
interface BuildUnhandledProviderEventsArgs {
    includeKnown?: boolean;
    providerId: string;
    rawEvent: JsonRpcMessage;
    visibilityMetadata: Pick<ProviderVisibilityMetadata, "describeParsedRawEvent" | "parseRawEvent">;
    turnId?: string;
    parentToolCallId?: string;
}
declare function createUnhandledProviderEvent(args: CreateUnhandledProviderEventArgs): ProviderUnhandledEvent;
declare function buildUnhandledProviderEvents(args: BuildUnhandledProviderEventsArgs): ThreadEvent[];

interface StringRecord {
    [key: string]: unknown;
}
declare function isRecord(value: unknown): value is StringRecord;
declare function getRecordProperty(value: StringRecord, key: string): StringRecord | null;
declare function getStringProperty(value: StringRecord, key: string): string | undefined;
declare function getRawSdkMessage(event: JsonRpcMessage): StringRecord | null;

interface CounterScopedItemIdState {
    openScopedItemIdsByScope: Map<string, string>;
    scopedItemCounter: number;
}
interface CounterScopedItemIdArgs<TState extends CounterScopedItemIdState> {
    parentToolCallId?: string;
    providerItemId?: string;
    scopeId: string | number;
    state: TState;
}
declare function createScopedItemIdFactory(args: {
    prefix: string;
}): {
    createId: (scopeId?: string | number) => string;
    getOrCreate<TState extends CounterScopedItemIdState>(item: CounterScopedItemIdArgs<TState>): string;
    resolveCompleted<TState extends CounterScopedItemIdState>(item: CounterScopedItemIdArgs<TState>): string;
};

/**
 * Zod schemas for well-known tool arguments used by both Claude Code and Pi
 * bridges.
 *
 * These tools genuinely use different arg names across SDK versions, so the
 * schemas express the real variants rather than picking one.
 */
declare const bashArgsSchema: z.ZodObject<{
    command: z.ZodOptional<z.ZodString>;
    cwd: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
declare const textBlockSchema: z.ZodObject<{
    text: z.ZodString;
    type: z.ZodLiteral<"text">;
}, z.core.$strip>;

type FileChangeItem = Extract<ThreadEventItem, {
    type: "fileChange";
}>;
type ToolCallItem = Extract<ThreadEventItem, {
    type: "toolCall";
}>;
/**
 * The generic pending `toolCall` item a provider falls back to when a tool
 * use has no richer translation (unknown tool, or a known tool whose
 * arguments failed to parse). Raw arguments are attached when they are a
 * record.
 */
declare function buildGenericToolCallItem(args: {
    args: unknown;
    callId: string;
    toolName: string;
}): ToolCallItem;
declare function buildFileChangeItem(args: {
    callId: string;
    newText?: string;
    oldText?: string;
    path: string;
}): FileChangeItem;
interface CompleteStartedToolItemArgs {
    callId: string;
    commandOutputText?: string;
    exitCode?: number;
    outputText?: string;
    parentToolCallId?: string;
    startedItem: ThreadEventItem;
    status: ThreadEventItemStatus;
    toolCallResult?: unknown;
}
declare function completeStartedToolItem(args: CompleteStartedToolItemArgs): ThreadEventItem | null;
declare function buildToolResultItem(args: {
    callId: string;
    commandOutputText?: string;
    commandToolNames: ReadonlySet<string>;
    fileChangeToolNames: ReadonlySet<string>;
    isError: boolean;
    outputText?: string;
    parentToolCallId?: string;
    startedItem?: ThreadEventItem;
    toolCallResult?: unknown;
    toolName?: string;
}): ThreadEventItem;

declare const unstampedThreadIdBrand: unique symbol;
type UnstampedThreadId = string & {
    readonly [unstampedThreadIdBrand]: "runtime-stamped-thread-id";
};
declare const UNSTAMPED_THREAD_ID: UnstampedThreadId;

/**
 * The bb Provider Bridge Protocol version.
 *
 * Negotiated in both directions during `initialize`. Bump only for changes an
 * older bridge or runtime cannot tolerate: removing a method, changing the
 * meaning of an existing field, or tightening a previously lenient parse.
 * Additive changes (new optional capability, new method a bridge may not
 * implement, new notification the runtime may not understand) do NOT bump the
 * version — unknown methods answer -32601, unknown notifications are ignored,
 * and unknown capability fields pass through. That tolerance is the point of
 * the protocol: bridges version with their plugin, not with the daemon.
 */
declare const PROVIDER_BRIDGE_PROTOCOL_VERSION: 1;

/** Runtime → bridge `initialize` params. */
declare const initializeParamsSchema: z.ZodObject<{
    client: z.ZodObject<{
        name: z.ZodString;
        version: z.ZodString;
    }, z.core.$strip>;
    protocolVersion: z.ZodNumber;
}, z.core.$loose>;
/** Bridge → runtime `initialize` result. */
declare const initializeResultSchema: z.ZodObject<{
    capabilities: z.ZodPipe<z.ZodTransform<{}, unknown>, z.ZodObject<{
        approvalEnforcedBy: z.ZodDefault<z.ZodEnum<{
            provider: "provider";
            runtime: "runtime";
        }>>;
        fork: z.ZodDefault<z.ZodEnum<{
            checkpoint: "checkpoint";
            none: "none";
            tip: "tip";
        }>>;
        sessionRestore: z.ZodDefault<z.ZodBoolean>;
        threadArchive: z.ZodDefault<z.ZodBoolean>;
        threadGoalClear: z.ZodDefault<z.ZodBoolean>;
        threadRename: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$loose>>;
    protocolVersion: z.ZodNumber;
}, z.core.$loose>;
type InitializeResult = z.infer<typeof initializeResultSchema>;

/**
 * The canonical execution options carried on session and turn commands.
 *
 * Deliberately provider-agnostic: there are no provider-specific fields here
 * and none may be added. Provider-flavored knobs (Claude's plan mode, memory
 * and subagent toggles, mock-CLI traffic, …) travel in `providerOptions` — an
 * opaque bag the provider's own plugin derives from its settings and only its
 * bridge interprets. The runtime and server pass it through untouched.
 *
 * The runtime never diffs these options. They ride every command; the bridge
 * reconciles internally (apply live where it can, rebuild its provider
 * session where it must) and a rebuild is always reported via the
 * `session/replaced` notification — never silent.
 */
declare const bridgeExecutionOptionsSchema: z.ZodIntersection<z.ZodObject<{
    envVars: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    instructions: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    reasoningLevel: z.ZodOptional<z.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        none: "none";
        ultra: "ultra";
        ultracode: "ultracode";
        xhigh: "xhigh";
    }>>;
    serviceTier: z.ZodOptional<z.ZodEnum<{
        default: "default";
        fast: "fast";
    }>>;
}, z.core.$strip>, z.ZodDiscriminatedUnion<[z.ZodObject<{
    approvalReviewer: z.ZodLiteral<"user">;
    permissionEscalation: z.ZodEnum<{
        ask: "ask";
        deny: "deny";
    }>;
    permissionMode: z.ZodLiteral<"accept-edits">;
    permissionScope: z.ZodLiteral<"workspace">;
}, z.core.$strip>, z.ZodObject<{
    approvalReviewer: z.ZodLiteral<"automatic">;
    permissionEscalation: z.ZodEnum<{
        ask: "ask";
        deny: "deny";
    }>;
    permissionMode: z.ZodLiteral<"auto">;
    permissionScope: z.ZodLiteral<"workspace">;
}, z.core.$strip>, z.ZodObject<{
    approvalReviewer: z.ZodNull;
    permissionEscalation: z.ZodNull;
    permissionMode: z.ZodLiteral<"full">;
    permissionScope: z.ZodLiteral<"full">;
}, z.core.$strip>], "permissionMode">>;
type BridgeExecutionOptions = z.infer<typeof bridgeExecutionOptionsSchema>;

/**
 * Canonical runtime → bridge request methods. One vocabulary for every
 * provider: a bridge maps these to its provider's native dialect internally
 * (codex `thread/stop` → `turn/interrupt`, `thread/discard` →
 * `thread/archive`, …). Methods gated by a handshake capability are simply
 * never sent to a bridge that did not advertise them.
 */
declare const BRIDGE_REQUEST_METHODS: {
    readonly initialize: "initialize";
    readonly modelList: "model/list";
    readonly threadStart: "thread/start";
    readonly threadResume: "thread/resume";
    readonly threadFork: "thread/fork";
    readonly threadStop: "thread/stop";
    readonly threadDiscard: "thread/discard";
    readonly threadNameSet: "thread/name/set";
    readonly threadArchive: "thread/archive";
    readonly threadUnarchive: "thread/unarchive";
    readonly threadGoalClear: "thread/goal/clear";
    readonly turnStart: "turn/start";
    readonly turnSteer: "turn/steer";
    readonly skillsConfigure: "skills/configure";
};
declare const modelListParamsSchema: z.ZodObject<{
    cwd: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
declare const threadStartParamsSchema: z.ZodObject<{
    cwd: z.ZodString;
    disallowedTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    dynamicTools: z.ZodOptional<z.ZodArray<z.ZodObject<{
        description: z.ZodString;
        inputSchema: z.ZodUnknown;
        name: z.ZodString;
    }, z.core.$strip>>>;
    input: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        mentions: z.ZodDefault<z.ZodArray<z.ZodObject<{
            end: z.ZodNumber;
            resource: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"thread">;
                label: z.ZodString;
                projectId: z.ZodOptional<z.ZodString>;
                threadId: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"project">;
                label: z.ZodString;
                projectId: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"section">;
                label: z.ZodString;
                sectionId: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                entryKind: z.ZodEnum<{
                    directory: "directory";
                    file: "file";
                }>;
                kind: z.ZodLiteral<"path">;
                label: z.ZodString;
                path: z.ZodString;
                source: z.ZodEnum<{
                    "thread-storage": "thread-storage";
                    workspace: "workspace";
                }>;
            }, z.core.$strip>, z.ZodObject<{
                argumentHint: z.ZodNullable<z.ZodString>;
                kind: z.ZodLiteral<"command">;
                label: z.ZodString;
                name: z.ZodString;
                origin: z.ZodEnum<{
                    builtin: "builtin";
                    project: "project";
                    user: "user";
                }>;
                source: z.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                trigger: z.ZodEnum<{
                    "/": "/";
                }>;
            }, z.core.$strip>, z.ZodObject<{
                icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                itemId: z.ZodString;
                kind: z.ZodLiteral<"plugin">;
                label: z.ZodString;
                pluginId: z.ZodString;
            }, z.core.$strip>], "kind">>;
            start: z.ZodNumber;
        }, z.core.$strip>>>;
        text: z.ZodString;
        type: z.ZodLiteral<"text">;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        url: z.ZodString;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        path: z.ZodString;
        type: z.ZodLiteral<"localImage">;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        mimeType: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        path: z.ZodString;
        sizeBytes: z.ZodOptional<z.ZodNumber>;
        type: z.ZodLiteral<"localFile">;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>], "type">>>;
    instructionMode: z.ZodEnum<{
        append: "append";
        replace: "replace";
    }>;
    options: z.ZodIntersection<z.ZodObject<{
        envVars: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        instructions: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        reasoningLevel: z.ZodOptional<z.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            none: "none";
            ultra: "ultra";
            ultracode: "ultracode";
            xhigh: "xhigh";
        }>>;
        serviceTier: z.ZodOptional<z.ZodEnum<{
            default: "default";
            fast: "fast";
        }>>;
    }, z.core.$strip>, z.ZodDiscriminatedUnion<[z.ZodObject<{
        approvalReviewer: z.ZodLiteral<"user">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
        permissionMode: z.ZodLiteral<"accept-edits">;
        permissionScope: z.ZodLiteral<"workspace">;
    }, z.core.$strip>, z.ZodObject<{
        approvalReviewer: z.ZodLiteral<"automatic">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
        permissionMode: z.ZodLiteral<"auto">;
        permissionScope: z.ZodLiteral<"workspace">;
    }, z.core.$strip>, z.ZodObject<{
        approvalReviewer: z.ZodNull;
        permissionEscalation: z.ZodNull;
        permissionMode: z.ZodLiteral<"full">;
        permissionScope: z.ZodLiteral<"full">;
    }, z.core.$strip>], "permissionMode">>;
    threadId: z.ZodString;
}, z.core.$loose>;
declare const threadResumeParamsSchema: z.ZodObject<{
    cwd: z.ZodString;
    disallowedTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    dynamicTools: z.ZodOptional<z.ZodArray<z.ZodObject<{
        description: z.ZodString;
        inputSchema: z.ZodUnknown;
        name: z.ZodString;
    }, z.core.$strip>>>;
    instructionMode: z.ZodEnum<{
        append: "append";
        replace: "replace";
    }>;
    options: z.ZodIntersection<z.ZodObject<{
        envVars: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        instructions: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        reasoningLevel: z.ZodOptional<z.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            none: "none";
            ultra: "ultra";
            ultracode: "ultracode";
            xhigh: "xhigh";
        }>>;
        serviceTier: z.ZodOptional<z.ZodEnum<{
            default: "default";
            fast: "fast";
        }>>;
    }, z.core.$strip>, z.ZodDiscriminatedUnion<[z.ZodObject<{
        approvalReviewer: z.ZodLiteral<"user">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
        permissionMode: z.ZodLiteral<"accept-edits">;
        permissionScope: z.ZodLiteral<"workspace">;
    }, z.core.$strip>, z.ZodObject<{
        approvalReviewer: z.ZodLiteral<"automatic">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
        permissionMode: z.ZodLiteral<"auto">;
        permissionScope: z.ZodLiteral<"workspace">;
    }, z.core.$strip>, z.ZodObject<{
        approvalReviewer: z.ZodNull;
        permissionEscalation: z.ZodNull;
        permissionMode: z.ZodLiteral<"full">;
        permissionScope: z.ZodLiteral<"full">;
    }, z.core.$strip>], "permissionMode">>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
}, z.core.$loose>;
declare const threadForkParamsSchema: z.ZodObject<{
    cwd: z.ZodString;
    disallowedTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    dynamicTools: z.ZodOptional<z.ZodArray<z.ZodObject<{
        description: z.ZodString;
        inputSchema: z.ZodUnknown;
        name: z.ZodString;
    }, z.core.$strip>>>;
    instructionMode: z.ZodEnum<{
        append: "append";
        replace: "replace";
    }>;
    options: z.ZodIntersection<z.ZodObject<{
        envVars: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        instructions: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        reasoningLevel: z.ZodOptional<z.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            none: "none";
            ultra: "ultra";
            ultracode: "ultracode";
            xhigh: "xhigh";
        }>>;
        serviceTier: z.ZodOptional<z.ZodEnum<{
            default: "default";
            fast: "fast";
        }>>;
    }, z.core.$strip>, z.ZodDiscriminatedUnion<[z.ZodObject<{
        approvalReviewer: z.ZodLiteral<"user">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
        permissionMode: z.ZodLiteral<"accept-edits">;
        permissionScope: z.ZodLiteral<"workspace">;
    }, z.core.$strip>, z.ZodObject<{
        approvalReviewer: z.ZodLiteral<"automatic">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
        permissionMode: z.ZodLiteral<"auto">;
        permissionScope: z.ZodLiteral<"workspace">;
    }, z.core.$strip>, z.ZodObject<{
        approvalReviewer: z.ZodNull;
        permissionEscalation: z.ZodNull;
        permissionMode: z.ZodLiteral<"full">;
        permissionScope: z.ZodLiteral<"full">;
    }, z.core.$strip>], "permissionMode">>;
    sourceProviderCheckpointId: z.ZodOptional<z.ZodString>;
    sourceProviderThreadId: z.ZodString;
    threadId: z.ZodString;
}, z.core.$loose>;
declare const threadStopParamsSchema: z.ZodObject<{
    activeTurnId: z.ZodNullable<z.ZodString>;
    intent: z.ZodEnum<{
        interrupt: "interrupt";
        release: "release";
    }>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
}, z.core.$loose>;
declare const threadDiscardParamsSchema: z.ZodObject<{
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
}, z.core.$loose>;
declare const threadArchiveParamsSchema: z.ZodObject<{
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
}, z.core.$loose>;
declare const threadUnarchiveParamsSchema: z.ZodObject<{
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
}, z.core.$loose>;
declare const threadGoalClearParamsSchema: z.ZodObject<{
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
}, z.core.$loose>;
declare const threadNameSetParamsSchema: z.ZodObject<{
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    title: z.ZodString;
}, z.core.$loose>;
declare const turnStartParamsSchema: z.ZodObject<{
    clientRequestId: z.ZodString;
    input: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        mentions: z.ZodDefault<z.ZodArray<z.ZodObject<{
            end: z.ZodNumber;
            resource: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"thread">;
                label: z.ZodString;
                projectId: z.ZodOptional<z.ZodString>;
                threadId: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"project">;
                label: z.ZodString;
                projectId: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"section">;
                label: z.ZodString;
                sectionId: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                entryKind: z.ZodEnum<{
                    directory: "directory";
                    file: "file";
                }>;
                kind: z.ZodLiteral<"path">;
                label: z.ZodString;
                path: z.ZodString;
                source: z.ZodEnum<{
                    "thread-storage": "thread-storage";
                    workspace: "workspace";
                }>;
            }, z.core.$strip>, z.ZodObject<{
                argumentHint: z.ZodNullable<z.ZodString>;
                kind: z.ZodLiteral<"command">;
                label: z.ZodString;
                name: z.ZodString;
                origin: z.ZodEnum<{
                    builtin: "builtin";
                    project: "project";
                    user: "user";
                }>;
                source: z.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                trigger: z.ZodEnum<{
                    "/": "/";
                }>;
            }, z.core.$strip>, z.ZodObject<{
                icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                itemId: z.ZodString;
                kind: z.ZodLiteral<"plugin">;
                label: z.ZodString;
                pluginId: z.ZodString;
            }, z.core.$strip>], "kind">>;
            start: z.ZodNumber;
        }, z.core.$strip>>>;
        text: z.ZodString;
        type: z.ZodLiteral<"text">;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        url: z.ZodString;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        path: z.ZodString;
        type: z.ZodLiteral<"localImage">;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        mimeType: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        path: z.ZodString;
        sizeBytes: z.ZodOptional<z.ZodNumber>;
        type: z.ZodLiteral<"localFile">;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>], "type">>;
    options: z.ZodIntersection<z.ZodObject<{
        envVars: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        instructions: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        reasoningLevel: z.ZodOptional<z.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            none: "none";
            ultra: "ultra";
            ultracode: "ultracode";
            xhigh: "xhigh";
        }>>;
        serviceTier: z.ZodOptional<z.ZodEnum<{
            default: "default";
            fast: "fast";
        }>>;
    }, z.core.$strip>, z.ZodDiscriminatedUnion<[z.ZodObject<{
        approvalReviewer: z.ZodLiteral<"user">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
        permissionMode: z.ZodLiteral<"accept-edits">;
        permissionScope: z.ZodLiteral<"workspace">;
    }, z.core.$strip>, z.ZodObject<{
        approvalReviewer: z.ZodLiteral<"automatic">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
        permissionMode: z.ZodLiteral<"auto">;
        permissionScope: z.ZodLiteral<"workspace">;
    }, z.core.$strip>, z.ZodObject<{
        approvalReviewer: z.ZodNull;
        permissionEscalation: z.ZodNull;
        permissionMode: z.ZodLiteral<"full">;
        permissionScope: z.ZodLiteral<"full">;
    }, z.core.$strip>], "permissionMode">>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
}, z.core.$loose>;
declare const turnSteerParamsSchema: z.ZodObject<{
    clientRequestId: z.ZodString;
    expectedTurnId: z.ZodString;
    input: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        mentions: z.ZodDefault<z.ZodArray<z.ZodObject<{
            end: z.ZodNumber;
            resource: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"thread">;
                label: z.ZodString;
                projectId: z.ZodOptional<z.ZodString>;
                threadId: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"project">;
                label: z.ZodString;
                projectId: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"section">;
                label: z.ZodString;
                sectionId: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                entryKind: z.ZodEnum<{
                    directory: "directory";
                    file: "file";
                }>;
                kind: z.ZodLiteral<"path">;
                label: z.ZodString;
                path: z.ZodString;
                source: z.ZodEnum<{
                    "thread-storage": "thread-storage";
                    workspace: "workspace";
                }>;
            }, z.core.$strip>, z.ZodObject<{
                argumentHint: z.ZodNullable<z.ZodString>;
                kind: z.ZodLiteral<"command">;
                label: z.ZodString;
                name: z.ZodString;
                origin: z.ZodEnum<{
                    builtin: "builtin";
                    project: "project";
                    user: "user";
                }>;
                source: z.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                trigger: z.ZodEnum<{
                    "/": "/";
                }>;
            }, z.core.$strip>, z.ZodObject<{
                icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                itemId: z.ZodString;
                kind: z.ZodLiteral<"plugin">;
                label: z.ZodString;
                pluginId: z.ZodString;
            }, z.core.$strip>], "kind">>;
            start: z.ZodNumber;
        }, z.core.$strip>>>;
        text: z.ZodString;
        type: z.ZodLiteral<"text">;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        url: z.ZodString;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        path: z.ZodString;
        type: z.ZodLiteral<"localImage">;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        mimeType: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        path: z.ZodString;
        sizeBytes: z.ZodOptional<z.ZodNumber>;
        type: z.ZodLiteral<"localFile">;
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z.core.$strip>], "type">>;
    options: z.ZodIntersection<z.ZodObject<{
        envVars: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        instructions: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        reasoningLevel: z.ZodOptional<z.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            none: "none";
            ultra: "ultra";
            ultracode: "ultracode";
            xhigh: "xhigh";
        }>>;
        serviceTier: z.ZodOptional<z.ZodEnum<{
            default: "default";
            fast: "fast";
        }>>;
    }, z.core.$strip>, z.ZodDiscriminatedUnion<[z.ZodObject<{
        approvalReviewer: z.ZodLiteral<"user">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
        permissionMode: z.ZodLiteral<"accept-edits">;
        permissionScope: z.ZodLiteral<"workspace">;
    }, z.core.$strip>, z.ZodObject<{
        approvalReviewer: z.ZodLiteral<"automatic">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
        permissionMode: z.ZodLiteral<"auto">;
        permissionScope: z.ZodLiteral<"workspace">;
    }, z.core.$strip>, z.ZodObject<{
        approvalReviewer: z.ZodNull;
        permissionEscalation: z.ZodNull;
        permissionMode: z.ZodLiteral<"full">;
        permissionScope: z.ZodLiteral<"full">;
    }, z.core.$strip>], "permissionMode">>;
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
}, z.core.$loose>;
/**
 * The canonical skill-injection payload. One shape for every provider: the
 * staged roots plus their skills. Each bridge transforms a root into its
 * provider's native form (a Claude local plugin, a codex extra skills root, a
 * pi additional skill path, an ACP prompt listing) — the per-provider shapes
 * never cross the wire.
 */
declare const skillsConfigureParamsSchema: z.ZodObject<{
    roots: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        path: z.ZodString;
        skills: z.ZodArray<z.ZodObject<{
            description: z.ZodString;
            name: z.ZodString;
        }, z.core.$loose>>;
    }, z.core.$loose>>;
}, z.core.$loose>;

/**
 * Bridge → runtime notifications. Everything that is a bb `ThreadEvent`
 * (assistant text, tool calls, token usage, context-window usage, …) rides
 * `thread/event` already translated and already stamped with bridge-minted
 * turn/item ids. The remaining notifications are runtime signals that are not
 * timeline events.
 */
declare const BRIDGE_NOTIFICATION_METHODS: {
    readonly threadEvent: "thread/event";
    readonly threadIdentity: "thread/identity";
    readonly sessionReplaced: "session/replaced";
    readonly threadOpenWork: "thread/openWork";
    readonly providerRaw: "provider/raw";
    readonly error: "error";
};
declare const threadEventNotificationSchema: z.ZodObject<{
    event: z.ZodPipe<z.ZodUnknown, z.ZodUnion<readonly [z.ZodIntersection<z.ZodDiscriminatedUnion<[z.ZodObject<{
        threadId: z.ZodString;
        type: z.ZodLiteral<"thread/started">;
    }, z.core.$strip>, z.ZodObject<{
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"thread/identity">;
    }, z.core.$strip>, z.ZodObject<{
        parentToolCallId: z.ZodOptional<z.ZodString>;
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"turn/started">;
    }, z.core.$strip>, z.ZodObject<{
        error: z.ZodOptional<z.ZodObject<{
            message: z.ZodString;
        }, z.core.$strip>>;
        providerCheckpointId: z.ZodOptional<z.ZodString>;
        providerThreadId: z.ZodNullable<z.ZodString>;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        threadId: z.ZodString;
        type: z.ZodLiteral<"turn/completed">;
    }, z.core.$strip>, z.ZodObject<{
        clientRequestId: z.ZodString;
        providerThreadId: z.ZodString;
        scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"thread">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"turn">;
            turnId: z.ZodString;
        }, z.core.$strip>], "kind">;
        threadId: z.ZodString;
        type: z.ZodLiteral<"turn/input/accepted">;
    }, z.core.$strict>, z.ZodObject<{
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        threadName: z.ZodString;
        type: z.ZodLiteral<"thread/name/updated">;
    }, z.core.$strip>, z.ZodObject<{
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"thread/compacted">;
    }, z.core.$strip>, z.ZodObject<{
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"thread/context/cleared">;
    }, z.core.$strip>, z.ZodObject<{
        objective: z.ZodString;
        providerThreadId: z.ZodString;
        status: z.ZodEnum<{
            active: "active";
            budgetLimited: "budgetLimited";
            complete: "complete";
            paused: "paused";
        }>;
        threadId: z.ZodString;
        timeUsedSeconds: z.ZodNumber;
        tokenBudget: z.ZodNullable<z.ZodNumber>;
        tokensUsed: z.ZodNumber;
        type: z.ZodLiteral<"thread/goal/updated">;
    }, z.core.$strip>, z.ZodObject<{
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"thread/goal/cleared">;
    }, z.core.$strip>, z.ZodObject<{
        item: z.ZodDiscriminatedUnion<[z.ZodObject<{
            clientRequestId: z.ZodOptional<z.ZodString>;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                text: z.ZodString;
                type: z.ZodLiteral<"text">;
            }, z.core.$strip>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                url: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                path: z.ZodString;
                type: z.ZodLiteral<"localImage">;
            }, z.core.$strip>, z.ZodObject<{
                path: z.ZodString;
                type: z.ZodLiteral<"localFile">;
            }, z.core.$strip>], "type">>;
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            type: z.ZodLiteral<"userMessage">;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            text: z.ZodString;
            type: z.ZodLiteral<"agentMessage">;
        }, z.core.$strip>, z.ZodObject<{
            aggregatedOutput: z.ZodOptional<z.ZodString>;
            approvalStatus: z.ZodNullable<z.ZodEnum<{
                denied: "denied";
                waiting_for_approval: "waiting_for_approval";
            }>>;
            command: z.ZodString;
            cwd: z.ZodString;
            durationMs: z.ZodOptional<z.ZodNumber>;
            exitCode: z.ZodOptional<z.ZodNumber>;
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            truncation: z.ZodOptional<z.ZodObject<{
                aggregatedOutput: z.ZodOptional<z.ZodObject<{
                    originalLength: z.ZodNumber;
                    retainedHeadLength: z.ZodNumber;
                    retainedTailLength: z.ZodNumber;
                    truncatedAt: z.ZodNumber;
                }, z.core.$strip>>;
                result: z.ZodOptional<z.ZodObject<{
                    originalLength: z.ZodNumber;
                    retainedHeadLength: z.ZodNumber;
                    retainedTailLength: z.ZodNumber;
                    truncatedAt: z.ZodNumber;
                }, z.core.$strip>>;
                resultText: z.ZodOptional<z.ZodObject<{
                    originalLength: z.ZodNumber;
                    retainedHeadLength: z.ZodNumber;
                    retainedTailLength: z.ZodNumber;
                    truncatedAt: z.ZodNumber;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            type: z.ZodLiteral<"commandExecution">;
        }, z.core.$strip>, z.ZodObject<{
            approvalStatus: z.ZodNullable<z.ZodEnum<{
                denied: "denied";
                waiting_for_approval: "waiting_for_approval";
            }>>;
            changes: z.ZodArray<z.ZodObject<{
                diff: z.ZodOptional<z.ZodString>;
                kind: z.ZodEnum<{
                    add: "add";
                    delete: "delete";
                    update: "update";
                }>;
                movePath: z.ZodOptional<z.ZodString>;
                path: z.ZodString;
            }, z.core.$strip>>;
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            type: z.ZodLiteral<"fileChange">;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            queries: z.ZodArray<z.ZodString>;
            resultText: z.ZodNullable<z.ZodString>;
            type: z.ZodLiteral<"webSearch">;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            pattern: z.ZodNullable<z.ZodString>;
            prompt: z.ZodNullable<z.ZodString>;
            resultText: z.ZodNullable<z.ZodString>;
            type: z.ZodLiteral<"webFetch">;
            url: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            path: z.ZodString;
            type: z.ZodLiteral<"imageView">;
        }, z.core.$strip>, z.ZodObject<{
            arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            error: z.ZodOptional<z.ZodString>;
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            result: z.ZodOptional<z.ZodUnknown>;
            server: z.ZodOptional<z.ZodString>;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            statusLabels: z.ZodOptional<z.ZodObject<{
                completed: z.ZodString;
                pending: z.ZodString;
            }, z.core.$strip>>;
            tool: z.ZodString;
            truncation: z.ZodOptional<z.ZodObject<{
                aggregatedOutput: z.ZodOptional<z.ZodObject<{
                    originalLength: z.ZodNumber;
                    retainedHeadLength: z.ZodNumber;
                    retainedTailLength: z.ZodNumber;
                    truncatedAt: z.ZodNumber;
                }, z.core.$strip>>;
                result: z.ZodOptional<z.ZodObject<{
                    originalLength: z.ZodNumber;
                    retainedHeadLength: z.ZodNumber;
                    retainedTailLength: z.ZodNumber;
                    truncatedAt: z.ZodNumber;
                }, z.core.$strip>>;
                resultText: z.ZodOptional<z.ZodObject<{
                    originalLength: z.ZodNumber;
                    retainedHeadLength: z.ZodNumber;
                    retainedTailLength: z.ZodNumber;
                    truncatedAt: z.ZodNumber;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            type: z.ZodLiteral<"toolCall">;
        }, z.core.$strip>, z.ZodObject<{
            content: z.ZodArray<z.ZodString>;
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            summary: z.ZodArray<z.ZodString>;
            type: z.ZodLiteral<"reasoning">;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            text: z.ZodString;
            type: z.ZodLiteral<"plan">;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            type: z.ZodLiteral<"contextCompaction">;
        }, z.core.$strip>, z.ZodObject<{
            description: z.ZodString;
            error: z.ZodOptional<z.ZodString>;
            id: z.ZodString;
            outputFile: z.ZodOptional<z.ZodString>;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            skipTranscript: z.ZodBoolean;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            summary: z.ZodOptional<z.ZodString>;
            taskStatus: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                killed: "killed";
                paused: "paused";
                pending: "pending";
                running: "running";
                stopped: "stopped";
            }>;
            taskType: z.ZodString;
            type: z.ZodLiteral<"backgroundTask">;
            usage: z.ZodOptional<z.ZodObject<{
                durationMs: z.ZodNumber;
                toolUses: z.ZodNumber;
                totalTokens: z.ZodNumber;
            }, z.core.$strip>>;
            workflow: z.ZodOptional<z.ZodObject<{
                agents: z.ZodArray<z.ZodObject<{
                    agentType: z.ZodOptional<z.ZodString>;
                    attempt: z.ZodNumber;
                    cached: z.ZodBoolean;
                    durationMs: z.ZodOptional<z.ZodNumber>;
                    error: z.ZodOptional<z.ZodString>;
                    index: z.ZodNumber;
                    isolation: z.ZodOptional<z.ZodString>;
                    label: z.ZodString;
                    lastProgressAt: z.ZodNumber;
                    lastToolName: z.ZodOptional<z.ZodString>;
                    lastToolSummary: z.ZodOptional<z.ZodString>;
                    model: z.ZodString;
                    phaseIndex: z.ZodOptional<z.ZodNumber>;
                    phaseTitle: z.ZodOptional<z.ZodString>;
                    promptPreview: z.ZodOptional<z.ZodString>;
                    queuedAt: z.ZodOptional<z.ZodNumber>;
                    resultPreview: z.ZodOptional<z.ZodString>;
                    startedAt: z.ZodOptional<z.ZodNumber>;
                    state: z.ZodEnum<{
                        done: "done";
                        failed: "failed";
                        queued: "queued";
                        running: "running";
                        skipped: "skipped";
                    }>;
                    tokens: z.ZodOptional<z.ZodNumber>;
                    toolCalls: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
                phases: z.ZodArray<z.ZodObject<{
                    index: z.ZodNumber;
                    kind: z.ZodOptional<z.ZodString>;
                    title: z.ZodString;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            workflowName: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>], "type">;
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"item/started">;
    }, z.core.$strip>, z.ZodObject<{
        item: z.ZodDiscriminatedUnion<[z.ZodObject<{
            clientRequestId: z.ZodOptional<z.ZodString>;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                text: z.ZodString;
                type: z.ZodLiteral<"text">;
            }, z.core.$strip>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                url: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                path: z.ZodString;
                type: z.ZodLiteral<"localImage">;
            }, z.core.$strip>, z.ZodObject<{
                path: z.ZodString;
                type: z.ZodLiteral<"localFile">;
            }, z.core.$strip>], "type">>;
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            type: z.ZodLiteral<"userMessage">;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            text: z.ZodString;
            type: z.ZodLiteral<"agentMessage">;
        }, z.core.$strip>, z.ZodObject<{
            aggregatedOutput: z.ZodOptional<z.ZodString>;
            approvalStatus: z.ZodNullable<z.ZodEnum<{
                denied: "denied";
                waiting_for_approval: "waiting_for_approval";
            }>>;
            command: z.ZodString;
            cwd: z.ZodString;
            durationMs: z.ZodOptional<z.ZodNumber>;
            exitCode: z.ZodOptional<z.ZodNumber>;
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            truncation: z.ZodOptional<z.ZodObject<{
                aggregatedOutput: z.ZodOptional<z.ZodObject<{
                    originalLength: z.ZodNumber;
                    retainedHeadLength: z.ZodNumber;
                    retainedTailLength: z.ZodNumber;
                    truncatedAt: z.ZodNumber;
                }, z.core.$strip>>;
                result: z.ZodOptional<z.ZodObject<{
                    originalLength: z.ZodNumber;
                    retainedHeadLength: z.ZodNumber;
                    retainedTailLength: z.ZodNumber;
                    truncatedAt: z.ZodNumber;
                }, z.core.$strip>>;
                resultText: z.ZodOptional<z.ZodObject<{
                    originalLength: z.ZodNumber;
                    retainedHeadLength: z.ZodNumber;
                    retainedTailLength: z.ZodNumber;
                    truncatedAt: z.ZodNumber;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            type: z.ZodLiteral<"commandExecution">;
        }, z.core.$strip>, z.ZodObject<{
            approvalStatus: z.ZodNullable<z.ZodEnum<{
                denied: "denied";
                waiting_for_approval: "waiting_for_approval";
            }>>;
            changes: z.ZodArray<z.ZodObject<{
                diff: z.ZodOptional<z.ZodString>;
                kind: z.ZodEnum<{
                    add: "add";
                    delete: "delete";
                    update: "update";
                }>;
                movePath: z.ZodOptional<z.ZodString>;
                path: z.ZodString;
            }, z.core.$strip>>;
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            type: z.ZodLiteral<"fileChange">;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            queries: z.ZodArray<z.ZodString>;
            resultText: z.ZodNullable<z.ZodString>;
            type: z.ZodLiteral<"webSearch">;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            pattern: z.ZodNullable<z.ZodString>;
            prompt: z.ZodNullable<z.ZodString>;
            resultText: z.ZodNullable<z.ZodString>;
            type: z.ZodLiteral<"webFetch">;
            url: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            path: z.ZodString;
            type: z.ZodLiteral<"imageView">;
        }, z.core.$strip>, z.ZodObject<{
            arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            error: z.ZodOptional<z.ZodString>;
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            result: z.ZodOptional<z.ZodUnknown>;
            server: z.ZodOptional<z.ZodString>;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            statusLabels: z.ZodOptional<z.ZodObject<{
                completed: z.ZodString;
                pending: z.ZodString;
            }, z.core.$strip>>;
            tool: z.ZodString;
            truncation: z.ZodOptional<z.ZodObject<{
                aggregatedOutput: z.ZodOptional<z.ZodObject<{
                    originalLength: z.ZodNumber;
                    retainedHeadLength: z.ZodNumber;
                    retainedTailLength: z.ZodNumber;
                    truncatedAt: z.ZodNumber;
                }, z.core.$strip>>;
                result: z.ZodOptional<z.ZodObject<{
                    originalLength: z.ZodNumber;
                    retainedHeadLength: z.ZodNumber;
                    retainedTailLength: z.ZodNumber;
                    truncatedAt: z.ZodNumber;
                }, z.core.$strip>>;
                resultText: z.ZodOptional<z.ZodObject<{
                    originalLength: z.ZodNumber;
                    retainedHeadLength: z.ZodNumber;
                    retainedTailLength: z.ZodNumber;
                    truncatedAt: z.ZodNumber;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            type: z.ZodLiteral<"toolCall">;
        }, z.core.$strip>, z.ZodObject<{
            content: z.ZodArray<z.ZodString>;
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            summary: z.ZodArray<z.ZodString>;
            type: z.ZodLiteral<"reasoning">;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            text: z.ZodString;
            type: z.ZodLiteral<"plan">;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            type: z.ZodLiteral<"contextCompaction">;
        }, z.core.$strip>, z.ZodObject<{
            description: z.ZodString;
            error: z.ZodOptional<z.ZodString>;
            id: z.ZodString;
            outputFile: z.ZodOptional<z.ZodString>;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            skipTranscript: z.ZodBoolean;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            summary: z.ZodOptional<z.ZodString>;
            taskStatus: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                killed: "killed";
                paused: "paused";
                pending: "pending";
                running: "running";
                stopped: "stopped";
            }>;
            taskType: z.ZodString;
            type: z.ZodLiteral<"backgroundTask">;
            usage: z.ZodOptional<z.ZodObject<{
                durationMs: z.ZodNumber;
                toolUses: z.ZodNumber;
                totalTokens: z.ZodNumber;
            }, z.core.$strip>>;
            workflow: z.ZodOptional<z.ZodObject<{
                agents: z.ZodArray<z.ZodObject<{
                    agentType: z.ZodOptional<z.ZodString>;
                    attempt: z.ZodNumber;
                    cached: z.ZodBoolean;
                    durationMs: z.ZodOptional<z.ZodNumber>;
                    error: z.ZodOptional<z.ZodString>;
                    index: z.ZodNumber;
                    isolation: z.ZodOptional<z.ZodString>;
                    label: z.ZodString;
                    lastProgressAt: z.ZodNumber;
                    lastToolName: z.ZodOptional<z.ZodString>;
                    lastToolSummary: z.ZodOptional<z.ZodString>;
                    model: z.ZodString;
                    phaseIndex: z.ZodOptional<z.ZodNumber>;
                    phaseTitle: z.ZodOptional<z.ZodString>;
                    promptPreview: z.ZodOptional<z.ZodString>;
                    queuedAt: z.ZodOptional<z.ZodNumber>;
                    resultPreview: z.ZodOptional<z.ZodString>;
                    startedAt: z.ZodOptional<z.ZodNumber>;
                    state: z.ZodEnum<{
                        done: "done";
                        failed: "failed";
                        queued: "queued";
                        running: "running";
                        skipped: "skipped";
                    }>;
                    tokens: z.ZodOptional<z.ZodNumber>;
                    toolCalls: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
                phases: z.ZodArray<z.ZodObject<{
                    index: z.ZodNumber;
                    kind: z.ZodOptional<z.ZodString>;
                    title: z.ZodString;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            workflowName: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>], "type">;
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"item/completed">;
    }, z.core.$strip>, z.ZodObject<{
        delta: z.ZodString;
        itemId: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"item/agentMessage/delta">;
    }, z.core.$strip>, z.ZodObject<{
        delta: z.ZodString;
        itemId: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        providerThreadId: z.ZodString;
        reset: z.ZodOptional<z.ZodBoolean>;
        threadId: z.ZodString;
        type: z.ZodLiteral<"item/commandExecution/outputDelta">;
    }, z.core.$strip>, z.ZodObject<{
        delta: z.ZodString;
        itemId: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"item/fileChange/outputDelta">;
    }, z.core.$strip>, z.ZodObject<{
        delta: z.ZodString;
        itemId: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"item/reasoning/summaryTextDelta">;
    }, z.core.$strip>, z.ZodObject<{
        delta: z.ZodString;
        itemId: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"item/reasoning/textDelta">;
    }, z.core.$strip>, z.ZodObject<{
        delta: z.ZodString;
        itemId: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"item/plan/delta">;
    }, z.core.$strip>, z.ZodObject<{
        itemId: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"item/mcpToolCall/progress">;
    }, z.core.$strip>, z.ZodObject<{
        itemId: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"item/toolCall/progress">;
    }, z.core.$strip>, z.ZodObject<{
        item: z.ZodObject<{
            description: z.ZodString;
            error: z.ZodOptional<z.ZodString>;
            id: z.ZodString;
            outputFile: z.ZodOptional<z.ZodString>;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            skipTranscript: z.ZodBoolean;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            summary: z.ZodOptional<z.ZodString>;
            taskStatus: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                killed: "killed";
                paused: "paused";
                pending: "pending";
                running: "running";
                stopped: "stopped";
            }>;
            taskType: z.ZodString;
            type: z.ZodLiteral<"backgroundTask">;
            usage: z.ZodOptional<z.ZodObject<{
                durationMs: z.ZodNumber;
                toolUses: z.ZodNumber;
                totalTokens: z.ZodNumber;
            }, z.core.$strip>>;
            workflow: z.ZodOptional<z.ZodObject<{
                agents: z.ZodArray<z.ZodObject<{
                    agentType: z.ZodOptional<z.ZodString>;
                    attempt: z.ZodNumber;
                    cached: z.ZodBoolean;
                    durationMs: z.ZodOptional<z.ZodNumber>;
                    error: z.ZodOptional<z.ZodString>;
                    index: z.ZodNumber;
                    isolation: z.ZodOptional<z.ZodString>;
                    label: z.ZodString;
                    lastProgressAt: z.ZodNumber;
                    lastToolName: z.ZodOptional<z.ZodString>;
                    lastToolSummary: z.ZodOptional<z.ZodString>;
                    model: z.ZodString;
                    phaseIndex: z.ZodOptional<z.ZodNumber>;
                    phaseTitle: z.ZodOptional<z.ZodString>;
                    promptPreview: z.ZodOptional<z.ZodString>;
                    queuedAt: z.ZodOptional<z.ZodNumber>;
                    resultPreview: z.ZodOptional<z.ZodString>;
                    startedAt: z.ZodOptional<z.ZodNumber>;
                    state: z.ZodEnum<{
                        done: "done";
                        failed: "failed";
                        queued: "queued";
                        running: "running";
                        skipped: "skipped";
                    }>;
                    tokens: z.ZodOptional<z.ZodNumber>;
                    toolCalls: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
                phases: z.ZodArray<z.ZodObject<{
                    index: z.ZodNumber;
                    kind: z.ZodOptional<z.ZodString>;
                    title: z.ZodString;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            workflowName: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"item/backgroundTask/progress">;
    }, z.core.$strip>, z.ZodObject<{
        item: z.ZodObject<{
            description: z.ZodString;
            error: z.ZodOptional<z.ZodString>;
            id: z.ZodString;
            outputFile: z.ZodOptional<z.ZodString>;
            parentToolCallId: z.ZodOptional<z.ZodString>;
            skipTranscript: z.ZodBoolean;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            summary: z.ZodOptional<z.ZodString>;
            taskStatus: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                killed: "killed";
                paused: "paused";
                pending: "pending";
                running: "running";
                stopped: "stopped";
            }>;
            taskType: z.ZodString;
            type: z.ZodLiteral<"backgroundTask">;
            usage: z.ZodOptional<z.ZodObject<{
                durationMs: z.ZodNumber;
                toolUses: z.ZodNumber;
                totalTokens: z.ZodNumber;
            }, z.core.$strip>>;
            workflow: z.ZodOptional<z.ZodObject<{
                agents: z.ZodArray<z.ZodObject<{
                    agentType: z.ZodOptional<z.ZodString>;
                    attempt: z.ZodNumber;
                    cached: z.ZodBoolean;
                    durationMs: z.ZodOptional<z.ZodNumber>;
                    error: z.ZodOptional<z.ZodString>;
                    index: z.ZodNumber;
                    isolation: z.ZodOptional<z.ZodString>;
                    label: z.ZodString;
                    lastProgressAt: z.ZodNumber;
                    lastToolName: z.ZodOptional<z.ZodString>;
                    lastToolSummary: z.ZodOptional<z.ZodString>;
                    model: z.ZodString;
                    phaseIndex: z.ZodOptional<z.ZodNumber>;
                    phaseTitle: z.ZodOptional<z.ZodString>;
                    promptPreview: z.ZodOptional<z.ZodString>;
                    queuedAt: z.ZodOptional<z.ZodNumber>;
                    resultPreview: z.ZodOptional<z.ZodString>;
                    startedAt: z.ZodOptional<z.ZodNumber>;
                    state: z.ZodEnum<{
                        done: "done";
                        failed: "failed";
                        queued: "queued";
                        running: "running";
                        skipped: "skipped";
                    }>;
                    tokens: z.ZodOptional<z.ZodNumber>;
                    toolCalls: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
                phases: z.ZodArray<z.ZodObject<{
                    index: z.ZodNumber;
                    kind: z.ZodOptional<z.ZodString>;
                    title: z.ZodString;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            workflowName: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"item/backgroundTask/completed">;
    }, z.core.$strip>, z.ZodObject<{
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        tokenUsage: z.ZodObject<{
            last: z.ZodObject<{
                cachedInputTokens: z.ZodNumber;
                inputTokens: z.ZodNumber;
                outputTokens: z.ZodNumber;
                reasoningOutputTokens: z.ZodNumber;
                totalTokens: z.ZodNumber;
            }, z.core.$strip>;
            modelContextWindow: z.ZodNullable<z.ZodNumber>;
            total: z.ZodObject<{
                cachedInputTokens: z.ZodNumber;
                inputTokens: z.ZodNumber;
                outputTokens: z.ZodNumber;
                reasoningOutputTokens: z.ZodNumber;
                totalTokens: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>;
        type: z.ZodLiteral<"thread/tokenUsage/updated">;
    }, z.core.$strip>, z.ZodObject<{
        contextWindowUsage: z.ZodObject<{
            estimated: z.ZodBoolean;
            modelContextWindow: z.ZodNullable<z.ZodNumber>;
            usedTokens: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"thread/contextWindowUsage/updated">;
    }, z.core.$strip>, z.ZodObject<{
        explanation: z.ZodOptional<z.ZodString>;
        plan: z.ZodArray<z.ZodObject<{
            status: z.ZodOptional<z.ZodEnum<{
                active: "active";
                completed: "completed";
                failed: "failed";
                pending: "pending";
            }>>;
            step: z.ZodString;
        }, z.core.$strip>>;
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"turn/plan/updated">;
    }, z.core.$strip>, z.ZodObject<{
        diff: z.ZodOptional<z.ZodString>;
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"turn/diff/updated">;
    }, z.core.$strip>, z.ZodObject<{
        detail: z.ZodOptional<z.ZodString>;
        errorInfo: z.ZodOptional<z.ZodObject<{
            category: z.ZodEnum<{
                "active-turn-not-steerable": "active-turn-not-steerable";
                "bad-request": "bad-request";
                "budget-exceeded": "budget-exceeded";
                "connection-failed": "connection-failed";
                "context-window-exceeded": "context-window-exceeded";
                "max-output-tokens": "max-output-tokens";
                "max-turns": "max-turns";
                "rate-limit": "rate-limit";
                "stream-disconnected": "stream-disconnected";
                "structured-output-retries": "structured-output-retries";
                "thread-rollback-failed": "thread-rollback-failed";
                "too-many-failed-attempts": "too-many-failed-attempts";
                billing: "billing";
                internal: "internal";
                overloaded: "overloaded";
                policy: "policy";
                sandbox: "sandbox";
                unauthorized: "unauthorized";
                unknown: "unknown";
            }>;
            httpStatusCode: z.ZodNullable<z.ZodNumber>;
            providerCode: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        message: z.ZodString;
        providerThreadId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"provider/error">;
        willRetry: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>, z.ZodObject<{
        providerThreadId: z.ZodString;
        rateLimits: z.ZodObject<{
            kind: z.ZodEnum<{
                "spend-control": "spend-control";
                "subscription-window": "subscription-window";
                credits: "credits";
                unknown: "unknown";
            }>;
            overageReason: z.ZodNullable<z.ZodString>;
            overageStatus: z.ZodNullable<z.ZodEnum<{
                allowed: "allowed";
                rejected: "rejected";
                unavailable: "unavailable";
                warning: "warning";
            }>>;
            providerId: z.ZodString;
            reachedReason: z.ZodNullable<z.ZodString>;
            status: z.ZodEnum<{
                allowed: "allowed";
                blocked: "blocked";
                unknown: "unknown";
                warning: "warning";
            }>;
            windows: z.ZodArray<z.ZodObject<{
                label: z.ZodNullable<z.ZodString>;
                providerKey: z.ZodNullable<z.ZodString>;
                resetsAtMs: z.ZodNullable<z.ZodNumber>;
                status: z.ZodEnum<{
                    allowed: "allowed";
                    blocked: "blocked";
                    unknown: "unknown";
                    warning: "warning";
                }>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
        threadId: z.ZodString;
        type: z.ZodLiteral<"provider/rateLimits/updated">;
    }, z.core.$strip>, z.ZodObject<{
        category: z.ZodEnum<{
            "compaction-skipped": "compaction-skipped";
            config: "config";
            deprecation: "deprecation";
            general: "general";
        }>;
        details: z.ZodOptional<z.ZodString>;
        providerThreadId: z.ZodString;
        summary: z.ZodOptional<z.ZodString>;
        threadId: z.ZodString;
        type: z.ZodLiteral<"provider/warning">;
    }, z.core.$strip>, z.ZodObject<{
        fallbackModel: z.ZodString;
        message: z.ZodString;
        originalModel: z.ZodString;
        providerThreadId: z.ZodString;
        reason: z.ZodEnum<{
            provider: "provider";
            refusal: "refusal";
        }>;
        threadId: z.ZodString;
        type: z.ZodLiteral<"provider/modelFallback">;
    }, z.core.$strip>, z.ZodObject<{
        parentToolCallId: z.ZodOptional<z.ZodString>;
        providerId: z.ZodString;
        providerThreadId: z.ZodString;
        rawEvent: z.ZodObject<{
            id: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>;
            jsonrpc: z.ZodLiteral<"2.0">;
            method: z.ZodString;
            params: z.ZodOptional<z.ZodType<JsonValue, unknown, z.core.$ZodTypeInternals<JsonValue, unknown>>>;
        }, z.core.$strip>;
        rawType: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"provider/unhandled">;
    }, z.core.$strip>], "type">, z.ZodObject<{
        scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"thread">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"turn">;
            turnId: z.ZodString;
        }, z.core.$strip>], "kind">;
    }, z.core.$strip>>, z.ZodIntersection<z.ZodUnion<readonly [z.ZodObject<{
        direction: z.ZodLiteral<"outbound">;
        initiator: z.ZodEnum<{
            agent: "agent";
            system: "system";
            user: "user";
        }>;
        request: z.ZodObject<{
            method: z.ZodEnum<{
                "thread/start": "thread/start";
                "turn/start": "turn/start";
            }>;
            params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, z.core.$strip>;
        source: z.ZodEnum<{
            spawn: "spawn";
            tell: "tell";
        }>;
        threadId: z.ZodString;
        type: z.ZodLiteral<"client/thread/start">;
    }, z.core.$strip>, z.ZodObject<{
        continuationOfRequestId: z.ZodOptional<z.ZodString>;
        direction: z.ZodLiteral<"outbound">;
        execution: z.ZodObject<{
            model: z.ZodString;
            permissionMode: z.ZodEnum<{
                "accept-edits": "accept-edits";
                "workspace-write": "workspace-write";
                auto: "auto";
                full: "full";
                readonly: "readonly";
            }>;
            reasoningLevel: z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                none: "none";
                ultra: "ultra";
                ultracode: "ultracode";
                xhigh: "xhigh";
            }>;
            seq: z.ZodOptional<z.ZodNumber>;
            serviceTier: z.ZodEnum<{
                default: "default";
                fast: "fast";
            }>;
            source: z.ZodEnum<{
                "client/thread/start": "client/thread/start";
                "client/turn/requested": "client/turn/requested";
                "client/turn/start": "client/turn/start";
            }>;
        }, z.core.$strip>;
        initiator: z.ZodEnum<{
            agent: "agent";
            system: "system";
            user: "user";
        }>;
        input: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            mentions: z.ZodDefault<z.ZodArray<z.ZodObject<{
                end: z.ZodNumber;
                resource: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"thread">;
                    label: z.ZodString;
                    projectId: z.ZodOptional<z.ZodString>;
                    threadId: z.ZodString;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"project">;
                    label: z.ZodString;
                    projectId: z.ZodString;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"section">;
                    label: z.ZodString;
                    sectionId: z.ZodString;
                }, z.core.$strip>, z.ZodObject<{
                    entryKind: z.ZodEnum<{
                        directory: "directory";
                        file: "file";
                    }>;
                    kind: z.ZodLiteral<"path">;
                    label: z.ZodString;
                    path: z.ZodString;
                    source: z.ZodEnum<{
                        "thread-storage": "thread-storage";
                        workspace: "workspace";
                    }>;
                }, z.core.$strip>, z.ZodObject<{
                    argumentHint: z.ZodNullable<z.ZodString>;
                    kind: z.ZodLiteral<"command">;
                    label: z.ZodString;
                    name: z.ZodString;
                    origin: z.ZodEnum<{
                        builtin: "builtin";
                        project: "project";
                        user: "user";
                    }>;
                    source: z.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    trigger: z.ZodEnum<{
                        "/": "/";
                    }>;
                }, z.core.$strip>, z.ZodObject<{
                    icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    itemId: z.ZodString;
                    kind: z.ZodLiteral<"plugin">;
                    label: z.ZodString;
                    pluginId: z.ZodString;
                }, z.core.$strip>], "kind">>;
                start: z.ZodNumber;
            }, z.core.$strip>>>;
            text: z.ZodString;
            type: z.ZodLiteral<"text">;
            visibility: z.ZodOptional<z.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            url: z.ZodString;
            visibility: z.ZodOptional<z.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z.core.$strip>, z.ZodObject<{
            path: z.ZodString;
            type: z.ZodLiteral<"localImage">;
            visibility: z.ZodOptional<z.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z.core.$strip>, z.ZodObject<{
            mimeType: z.ZodOptional<z.ZodString>;
            name: z.ZodOptional<z.ZodString>;
            path: z.ZodString;
            sizeBytes: z.ZodOptional<z.ZodNumber>;
            type: z.ZodLiteral<"localFile">;
            visibility: z.ZodOptional<z.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z.core.$strip>], "type">>;
        inputGroups: z.ZodOptional<z.ZodArray<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            mentions: z.ZodDefault<z.ZodArray<z.ZodObject<{
                end: z.ZodNumber;
                resource: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"thread">;
                    label: z.ZodString;
                    projectId: z.ZodOptional<z.ZodString>;
                    threadId: z.ZodString;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"project">;
                    label: z.ZodString;
                    projectId: z.ZodString;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"section">;
                    label: z.ZodString;
                    sectionId: z.ZodString;
                }, z.core.$strip>, z.ZodObject<{
                    entryKind: z.ZodEnum<{
                        directory: "directory";
                        file: "file";
                    }>;
                    kind: z.ZodLiteral<"path">;
                    label: z.ZodString;
                    path: z.ZodString;
                    source: z.ZodEnum<{
                        "thread-storage": "thread-storage";
                        workspace: "workspace";
                    }>;
                }, z.core.$strip>, z.ZodObject<{
                    argumentHint: z.ZodNullable<z.ZodString>;
                    kind: z.ZodLiteral<"command">;
                    label: z.ZodString;
                    name: z.ZodString;
                    origin: z.ZodEnum<{
                        builtin: "builtin";
                        project: "project";
                        user: "user";
                    }>;
                    source: z.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    trigger: z.ZodEnum<{
                        "/": "/";
                    }>;
                }, z.core.$strip>, z.ZodObject<{
                    icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    itemId: z.ZodString;
                    kind: z.ZodLiteral<"plugin">;
                    label: z.ZodString;
                    pluginId: z.ZodString;
                }, z.core.$strip>], "kind">>;
                start: z.ZodNumber;
            }, z.core.$strip>>>;
            text: z.ZodString;
            type: z.ZodLiteral<"text">;
            visibility: z.ZodOptional<z.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            url: z.ZodString;
            visibility: z.ZodOptional<z.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z.core.$strip>, z.ZodObject<{
            path: z.ZodString;
            type: z.ZodLiteral<"localImage">;
            visibility: z.ZodOptional<z.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z.core.$strip>, z.ZodObject<{
            mimeType: z.ZodOptional<z.ZodString>;
            name: z.ZodOptional<z.ZodString>;
            path: z.ZodString;
            sizeBytes: z.ZodOptional<z.ZodNumber>;
            type: z.ZodLiteral<"localFile">;
            visibility: z.ZodOptional<z.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z.core.$strip>], "type">>>>;
        request: z.ZodObject<{
            method: z.ZodEnum<{
                "thread/start": "thread/start";
                "turn/start": "turn/start";
            }>;
            params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, z.core.$strip>;
        requestId: z.ZodString;
        senderThreadId: z.ZodNullable<z.ZodString>;
        source: z.ZodEnum<{
            spawn: "spawn";
            tell: "tell";
        }>;
        systemMessageKind: z.ZodOptional<z.ZodEnum<{
            "child-completed": "child-completed";
            "child-failed": "child-failed";
            "child-interrupted": "child-interrupted";
            "child-needs-attention": "child-needs-attention";
            "child-outcome-batch": "child-outcome-batch";
            "ownership-assigned": "ownership-assigned";
            "ownership-removed": "ownership-removed";
            unlabeled: "unlabeled";
        }>>;
        systemMessageSubject: z.ZodOptional<z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"thread">;
            threadId: z.ZodString;
            threadName: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            count: z.ZodNumber;
            kind: z.ZodLiteral<"thread-batch">;
        }, z.core.$strip>], "kind">>>;
        target: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"thread-start">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"new-turn">;
        }, z.core.$strip>, z.ZodObject<{
            expectedTurnId: z.ZodNullable<z.ZodString>;
            kind: z.ZodLiteral<"auto">;
        }, z.core.$strip>, z.ZodObject<{
            expectedTurnId: z.ZodNullable<z.ZodString>;
            kind: z.ZodLiteral<"steer">;
        }, z.core.$strip>], "kind">;
        threadId: z.ZodString;
        type: z.ZodLiteral<"client/turn/requested">;
    }, z.core.$strip>, z.ZodObject<{
        message: z.ZodString;
        reason: z.ZodString;
        requestId: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"client/turn/rejected">;
    }, z.core.$strip>, z.ZodObject<{
        direction: z.ZodLiteral<"outbound">;
        initiator: z.ZodEnum<{
            agent: "agent";
            system: "system";
            user: "user";
        }>;
        request: z.ZodObject<{
            method: z.ZodEnum<{
                "thread/start": "thread/start";
                "turn/start": "turn/start";
            }>;
            params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, z.core.$strip>;
        source: z.ZodEnum<{
            spawn: "spawn";
            tell: "tell";
        }>;
        threadId: z.ZodString;
        type: z.ZodLiteral<"client/turn/start">;
    }, z.core.$strip>, z.ZodObject<{
        code: z.ZodOptional<z.ZodString>;
        detail: z.ZodOptional<z.ZodString>;
        message: z.ZodString;
        reconnectAttempt: z.ZodOptional<z.ZodNumber>;
        reconnectTotal: z.ZodOptional<z.ZodNumber>;
        threadId: z.ZodString;
        type: z.ZodLiteral<"system/error">;
    }, z.core.$strip>, z.ZodObject<{
        text: z.ZodString;
        threadId: z.ZodString;
        toolCallId: z.ZodOptional<z.ZodString>;
        turnId: z.ZodOptional<z.ZodString>;
        type: z.ZodLiteral<"system/manager/user_message">;
    }, z.core.$strip>, z.ZodObject<{
        reason: z.ZodEnum<{
            "host-daemon-restarted": "host-daemon-restarted";
            "manual-stop": "manual-stop";
            "provider-turn-idle": "provider-turn-idle";
        }>;
        threadId: z.ZodString;
        type: z.ZodLiteral<"system/thread/interrupted">;
    }, z.core.$strip>, z.ZodObject<{
        message: z.ZodString;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<JsonValue, unknown, z.core.$ZodTypeInternals<JsonValue, unknown>>>>;
        operation: z.ZodString;
        operationId: z.ZodString;
        status: z.ZodString;
        threadId: z.ZodString;
        type: z.ZodLiteral<"system/operation">;
    }, z.core.$strip>, z.ZodObject<{
        interactionId: z.ZodString;
        providerId: z.ZodString;
        providerRequestId: z.ZodString;
        resolution: z.ZodDefault<z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
            decision: z.ZodLiteral<"allow_once">;
            grantedPermissions: z.ZodNullable<z.ZodObject<{
                fileSystem: z.ZodNullable<z.ZodObject<{
                    read: z.ZodArray<z.ZodString>;
                    write: z.ZodArray<z.ZodString>;
                }, z.core.$strip>>;
                network: z.ZodNullable<z.ZodObject<{
                    enabled: z.ZodNullable<z.ZodBoolean>;
                }, z.core.$strip>>;
            }, z.core.$strict>>;
        }, z.core.$strip>, z.ZodObject<{
            decision: z.ZodLiteral<"allow_for_session">;
            grantedPermissions: z.ZodNullable<z.ZodObject<{
                fileSystem: z.ZodNullable<z.ZodObject<{
                    read: z.ZodArray<z.ZodString>;
                    write: z.ZodArray<z.ZodString>;
                }, z.core.$strip>>;
                network: z.ZodNullable<z.ZodObject<{
                    enabled: z.ZodNullable<z.ZodBoolean>;
                }, z.core.$strip>>;
            }, z.core.$strict>>;
        }, z.core.$strip>, z.ZodObject<{
            decision: z.ZodLiteral<"deny">;
        }, z.core.$strip>], "decision">>>;
        status: z.ZodEnum<{
            interrupted: "interrupted";
            pending: "pending";
            resolved: "resolved";
            resolving: "resolving";
        }>;
        statusReason: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        subject: z.ZodObject<{
            itemId: z.ZodString;
            kind: z.ZodLiteral<"permission_grant">;
            permissions: z.ZodObject<{
                fileSystem: z.ZodNullable<z.ZodObject<{
                    read: z.ZodArray<z.ZodString>;
                    write: z.ZodArray<z.ZodString>;
                }, z.core.$strip>>;
                network: z.ZodNullable<z.ZodObject<{
                    enabled: z.ZodNullable<z.ZodBoolean>;
                }, z.core.$strip>>;
            }, z.core.$strict>;
            toolName: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        threadId: z.ZodString;
        type: z.ZodLiteral<"system/permissionGrant/lifecycle">;
    }, z.core.$strip>, z.ZodObject<{
        interactionId: z.ZodString;
        payload: z.ZodObject<{
            kind: z.ZodLiteral<"user_question">;
            questions: z.ZodArray<z.ZodObject<{
                allowFreeText: z.ZodBoolean;
                id: z.ZodString;
                multiSelect: z.ZodBoolean;
                options: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    description: z.ZodOptional<z.ZodString>;
                    label: z.ZodString;
                    value: z.ZodString;
                }, z.core.$strip>>>;
                prompt: z.ZodString;
                shortLabel: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
        providerId: z.ZodString;
        providerRequestId: z.ZodString;
        resolution: z.ZodDefault<z.ZodNullable<z.ZodObject<{
            answers: z.ZodRecord<z.ZodString, z.ZodObject<{
                freeText: z.ZodOptional<z.ZodString>;
                selected: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
            kind: z.ZodLiteral<"user_answer">;
        }, z.core.$strip>>>;
        status: z.ZodEnum<{
            interrupted: "interrupted";
            pending: "pending";
            resolved: "resolved";
            resolving: "resolving";
        }>;
        statusReason: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        threadId: z.ZodString;
        type: z.ZodLiteral<"system/userQuestion/lifecycle">;
    }, z.core.$strip>, z.ZodObject<{
        entries: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            startedAt: z.ZodOptional<z.ZodNumber>;
            status: z.ZodOptional<z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                started: "started";
            }>>;
            text: z.ZodString;
            type: z.ZodEnum<{
                output: "output";
                step: "step";
            }>;
        }, z.core.$strip>>;
        environmentId: z.ZodString;
        provisioningId: z.ZodString;
        status: z.ZodEnum<{
            active: "active";
            cancelled: "cancelled";
            completed: "completed";
            failed: "failed";
        }>;
        threadId: z.ZodString;
        type: z.ZodLiteral<"system/thread-provisioning">;
    }, z.core.$strip>, z.ZodObject<{
        activeTurnId: z.ZodString;
        activeTurnStartedAt: z.ZodNumber;
        elapsedMs: z.ZodNumber;
        firedAt: z.ZodNumber;
        lastActivityEventAt: z.ZodNumber;
        lastActivityEventSequence: z.ZodNumber;
        lastActivityEventType: z.ZodString;
        providerId: z.ZodString;
        providerThreadId: z.ZodNullable<z.ZodString>;
        reason: z.ZodLiteral<"provider-turn-idle">;
        threadId: z.ZodString;
        thresholdMs: z.ZodNumber;
        type: z.ZodLiteral<"system/provider-turn-watchdog">;
    }, z.core.$strip>]>, z.ZodObject<{
        scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"thread">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"turn">;
            turnId: z.ZodString;
        }, z.core.$strip>], "kind">;
    }, z.core.$strip>>]>>;
    threadId: z.ZodString;
}, z.core.$loose>;

/**
 * Bridge → runtime requests: the two channels where the provider needs an
 * answer from bb mid-turn. Both carry canonical bb shapes — the bridge maps
 * its provider's native forms in both directions.
 */
declare const BRIDGE_INBOUND_REQUEST_METHODS: {
    readonly toolCall: "item/tool/call";
    readonly interactionRequest: "interaction/request";
};

/**
 * JSON-RPC error codes on the bridge wire.
 *
 * The hygiene rules these back (from #853): an undecodable request is
 * answered with `INVALID_PARAMS` carrying the validation issues — never
 * silently dropped; an unrecognized method is answered with
 * `METHOD_NOT_FOUND`; request vs response is discriminated on the presence of
 * `method`, never on result-shape guessing.
 */
declare const BRIDGE_JSON_RPC_ERRORS: {
    /** Standard JSON-RPC: params failed schema validation. */
    readonly INVALID_PARAMS: -32602;
    /** Standard JSON-RPC: method not implemented by this bridge. */
    readonly METHOD_NOT_FOUND: -32601;
    /** Generic bridge failure. */
    readonly BRIDGE_ERROR: -32000;
    /** A turn/steer arrived but the session has no active turn. */
    readonly NO_ACTIVE_TURN: -32001;
    /** thread/resume for a session the provider can no longer restore. */
    readonly SESSION_NOT_RESTORABLE: -32002;
    /** thread/fork with a checkpoint on a bridge that only forks at the tip. */
    readonly FORK_CHECKPOINT_UNSUPPORTED: -32003;
};

interface SanitizeInheritedChildProcessEnvArgs {
    env: NodeJS.ProcessEnv;
    /**
     * The user's login-shell PATH, substituted for the inherited one. Omit to
     * keep the parent's PATH: that is a real distinction, not a default. A
     * daemon started by launchd or systemd inherits a minimal PATH that finds
     * none of the user's tools, so anything spawning user-facing executables
     * (plugin hosts, provider bridges) passes the resolved shell PATH, while a
     * child that must run exactly what the parent runs must not.
     */
    shellPath?: string;
}
/**
 * The one answer to "what does a bb-spawned child process inherit": the
 * parent's env minus bb runtime-owned variables (`BB_*`) and `NODE_ENV`,
 * optionally with the user's login-shell PATH substituted. Callers overlay
 * only the child-specific bb env they intentionally expose afterward.
 */
declare function sanitizeInheritedChildProcessEnv(args: SanitizeInheritedChildProcessEnvArgs): NodeJS.ProcessEnv;

declare const hostDaemonAcpLaunchSpecSchema: z.ZodObject<{
    args: z.ZodArray<z.ZodString>;
    command: z.ZodString;
    cwd: z.ZodOptional<z.ZodString>;
    displayName: z.ZodString;
    env: z.ZodRecord<z.ZodString, z.ZodString>;
    modelCli: z.ZodOptional<z.ZodPipe<z.ZodObject<{
        listArgs: z.ZodArray<z.ZodString>;
        primaryModels: z.ZodArray<z.ZodString>;
        selectFlag: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodTransform<{
        listArgs: string[];
        primaryModels: string[];
        selectFlag?: string | undefined;
    } | undefined, {
        listArgs: string[];
        primaryModels: string[];
        selectFlag?: string | undefined;
    }>>>;
    nativeReasoning: z.ZodOptional<z.ZodObject<{
        configId: z.ZodString;
        defaultLevel: z.ZodOptional<z.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            none: "none";
            ultra: "ultra";
            ultracode: "ultracode";
            xhigh: "xhigh";
        }>>;
        levelValues: z.ZodOptional<z.ZodRecord<z.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            none: "none";
            ultra: "ultra";
            ultracode: "ultracode";
            xhigh: "xhigh";
        }> & z.core.$partial, z.ZodString>>;
        supportedLevels: z.ZodArray<z.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            none: "none";
            ultra: "ultra";
            ultracode: "ultracode";
            xhigh: "xhigh";
        }>>;
    }, z.core.$strict>>;
    nativeSkillRoots: z.ZodOptional<z.ZodObject<{
        project: z.ZodDefault<z.ZodArray<z.ZodString>>;
        user: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
    permissionCli: z.ZodOptional<z.ZodObject<{
        full: z.ZodOptional<z.ZodArray<z.ZodString>>;
        insertAfterArgs: z.ZodOptional<z.ZodNumber>;
        readonly: z.ZodOptional<z.ZodArray<z.ZodString>>;
        workspaceWrite: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
    reasoningCli: z.ZodOptional<z.ZodObject<{
        defaultLevel: z.ZodOptional<z.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            none: "none";
            ultra: "ultra";
            ultracode: "ultracode";
            xhigh: "xhigh";
        }>>;
        flag: z.ZodString;
        levelValues: z.ZodOptional<z.ZodRecord<z.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            none: "none";
            ultra: "ultra";
            ultracode: "ultracode";
            xhigh: "xhigh";
        }> & z.core.$partial, z.ZodString>>;
        supportedLevels: z.ZodArray<z.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            none: "none";
            ultra: "ultra";
            ultracode: "ultracode";
            xhigh: "xhigh";
        }>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
type HostDaemonAcpLaunchSpec = z.infer<typeof hostDaemonAcpLaunchSpecSchema>;
declare function normalizeHostDaemonAcpLaunchSpec(spec: HostDaemonAcpLaunchSpec): HostDaemonAcpLaunchSpec;

export { BRIDGE_INBOUND_REQUEST_METHODS, BRIDGE_JSON_RPC_ERRORS, BRIDGE_NOTIFICATION_METHODS, BRIDGE_REQUEST_METHODS, DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG, DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT, HIGH_REASONING_EFFORT, LOCAL_BASH_TASK_TYPE, LOCAL_WORKFLOW_TASK_TYPE, LOW_REASONING_EFFORT, MAX_REASONING_EFFORT, MEDIUM_REASONING_EFFORT, NONE_REASONING_EFFORT, PROVIDER_BRIDGE_EXPORT_NAME, PROVIDER_BRIDGE_PROTOCOL_VERSION, ProviderRequestDecodeError, ProviderResponseEncodeError, ULTRACODE_REASONING_EFFORT, UNSTAMPED_THREAD_ID, USER_QUESTION_MAX_OPTIONS, USER_QUESTION_MAX_QUESTIONS, XHIGH_REASONING_EFFORT, acpNativeReasoningSchema, acpPermissionCliSchema, acpReasoningCliSchema, backgroundTaskItemStatus, bashArgsSchema, bridgeRequestEnvelopeSchema, buildAcceptedUserMessageEvent, buildEditDiff, buildFileChangeItem, buildGenericToolCallItem, buildShellEnvOverrides, buildToolResultItem, buildUnhandledProviderEvents, claudeCodeMockCliTrafficConfigSchema, claudeTaskToolNameSchema, claudeTaskToolOutputSchema, completeStartedToolItem, createBridgeIo, createBridgeLineHandler, createPendingToolCallTracker, createProviderTurnStateRegistry, createProviderVisibilityMetadata, createScopedItemIdFactory, createStandaloneBuiltinCompactCommandInput, createUnhandledProviderEvent, decodeBridgeJsonRpcResponse, decodeToolCallResponsePayload, dynamicToolSchema, errorEnvelopeSchema, experimental_defineProviderBridge, extractResultText, getRawSdkMessage, getRecordProperty, getStringProperty, getThreadEventScopeTurnId, hostDaemonAcpLaunchSpecSchema, initializeParamsSchema, instructionModeValues, isApprovalPendingInteractionPayload, isApprovalPendingInteractionResolution, isBackgroundAgentTaskType, isClaudeCodeMockCliTrafficEndpoint, isRecord, isSettledBackgroundTaskStatus, isStandaloneBuiltinCompactCommand, isUserQuestionPendingInteractionPayload, isUserQuestionPendingInteractionResolution, jsonRpcEnvelopeSchema, jsonValueSchema, mimeTypeFromExtension, modelListParamsSchema, normalizeHostDaemonAcpLaunchSpec, normalizeProviderCommandOutput, pendingInteractionCommandActionSchema, pendingInteractionFileSystemPermissionsSchema, pendingInteractionMacOsPermissionsSchema, pendingInteractionNetworkPermissionsSchema, pendingInteractionRequestedPermissionProfileSchema, pendingInteractionResolutionSchema, permissionEscalationValues, queueAcceptedUserMessage, reasoningEffortsForLevels, reasoningLevelSchema, reasoningLevelValues, removeCommandMentionsFromPromptInput, requireThreadEventScopeTurnId, resolveProviderTerminalTurn, runBridgeRequest, runtimePermissionScopeValues, sanitizeInheritedChildProcessEnv, sdkMessageEnvelopeSchema, shouldAutoDenyInteractiveRequest, skillsConfigureParamsSchema, textBlockSchema, threadArchiveParamsSchema, threadContextWindowUsageEnvelopeSchema, threadDiscardParamsSchema, threadEventNotificationSchema, threadForkParamsSchema, threadGoalClearParamsSchema, threadIdentityEnvelopeSchema, threadNameSetParamsSchema, threadResumeParamsSchema, threadScope, threadStartParamsSchema, threadStopParamsSchema, threadUnarchiveParamsSchema, toNonNegativeNumber, toOptionalRecord, toOptionalString, toPositiveNumber, turnScope, turnStartParamsSchema, turnSteerParamsSchema, withParentToolCallId, withoutBridgeRuntimeEnv };
export type { AcceptedUserMessageState, ApprovalPendingInteractionPayload, AvailableModel, BackgroundTaskStatus, BackgroundTaskUsage, BridgeExecutionOptions, BridgeJsonRpcResponse, BridgeToolCallRequest, BuildInteractiveResponseArgs, ClaudeCodeMockCliTrafficConfig, ClaudeTaskToolOutput, ClientTurnRequestId, DecodedInteractiveRequest, DynamicTool, EnsureProviderTurnStartedArgs, HostDaemonAcpLaunchSpec, InitializeResult, InstructionMode, JsonObject, JsonRpcMessage, JsonValue, ModelReasoningEffort, PendingInteractionApprovalDecision, PendingInteractionApprovalSubject, PendingInteractionCommandAction, PendingInteractionGrantablePermissionProfile, PendingInteractionGrantedPermissionProfile, PendingInteractionPayload, PendingInteractionRequestedPermissionProfile, PendingInteractionResolution, PendingInteractionUserQuestionQuestion, PermissionEscalation, PermissionMode, PreparedProviderCommandDispatch, PromptInput, ProviderBridgeContext, ProviderBridgeDefinition, ProviderBridgeEntry, ProviderErrorCategory, ProviderErrorInfo, ProviderInboundRequest, ProviderPostInitializeRequest, ProviderRateLimitState, ProviderRateLimitStatus, ProviderRateLimitWindow, ProviderRawEventCoverage, ProviderRawEventDescription, ProviderRuntimeEvent, ProviderTurnStateRegistry, ProviderVisibilityMetadata, ReasoningLevel, RuntimePermissionPolicy, RuntimePermissionScope, ServiceTier, ThreadEvent, ThreadEventBackgroundTaskItem, ThreadEventContextWindowUsage, ThreadEventItem, ThreadEventItemApprovalStatus, ThreadEventItemStatus, ThreadEventPlanStep, ThreadEventScope, ThreadEventTokenUsage, ThreadEventTokenUsageBreakdown, ThreadEventTurnStatus, ThreadEventUserContent, ThreadEventWebFetchItem, ThreadEventWebSearchItem, UserQuestionPendingInteractionPayload, UserQuestionPendingInteractionResolution, WorkflowAgentSnapshot, WorkflowAgentState, WorkflowPhaseSnapshot, WorkflowProgressSnapshot };
