// Portable type declarations for `@get-bb/plugin-sdk`. Unpublished BB
// workspace contracts are flattened; public subpaths may reuse the
// package root without requiring any other @bb/* package.
//
// Confused by the API, or need a symbol that isn't here? Clone the BB repo
// and read the real source: https://github.com/get-bb/bb

import { z } from 'zod';

declare const acpReasoningCliSchema: z.ZodObject<{
    flag: z.ZodString;
    supportedLevels: z.ZodArray<z.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>>;
    levelValues: z.ZodOptional<z.ZodRecord<z.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }> & z.core.$partial, z.ZodString>>;
    defaultLevel: z.ZodOptional<z.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>>;
}, z.core.$strict>;
declare const acpNativeReasoningSchema: z.ZodObject<{
    configId: z.ZodString;
    supportedLevels: z.ZodArray<z.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>>;
    levelValues: z.ZodOptional<z.ZodRecord<z.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }> & z.core.$partial, z.ZodString>>;
    defaultLevel: z.ZodOptional<z.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>>;
}, z.core.$strict>;
declare const acpPermissionCliSchema: z.ZodObject<{
    full: z.ZodOptional<z.ZodArray<z.ZodString>>;
    workspaceWrite: z.ZodOptional<z.ZodArray<z.ZodString>>;
    readonly: z.ZodOptional<z.ZodArray<z.ZodString>>;
    insertAfterArgs: z.ZodOptional<z.ZodNumber>;
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
    pending: "pending";
    running: "running";
    paused: "paused";
    completed: "completed";
    failed: "failed";
    killed: "killed";
    stopped: "stopped";
}>;
type BackgroundTaskStatus = z.infer<typeof backgroundTaskStatusSchema>;
declare const workflowAgentStateSchema: z.ZodEnum<{
    running: "running";
    failed: "failed";
    queued: "queued";
    done: "done";
    skipped: "skipped";
}>;
type WorkflowAgentState = z.infer<typeof workflowAgentStateSchema>;
declare const workflowAgentSnapshotSchema: z.ZodObject<{
    index: z.ZodNumber;
    label: z.ZodString;
    state: z.ZodEnum<{
        running: "running";
        failed: "failed";
        queued: "queued";
        done: "done";
        skipped: "skipped";
    }>;
    model: z.ZodString;
    attempt: z.ZodNumber;
    cached: z.ZodBoolean;
    lastProgressAt: z.ZodNumber;
    phaseIndex: z.ZodOptional<z.ZodNumber>;
    phaseTitle: z.ZodOptional<z.ZodString>;
    agentType: z.ZodOptional<z.ZodString>;
    isolation: z.ZodOptional<z.ZodString>;
    queuedAt: z.ZodOptional<z.ZodNumber>;
    startedAt: z.ZodOptional<z.ZodNumber>;
    lastToolName: z.ZodOptional<z.ZodString>;
    lastToolSummary: z.ZodOptional<z.ZodString>;
    promptPreview: z.ZodOptional<z.ZodString>;
    resultPreview: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
    tokens: z.ZodOptional<z.ZodNumber>;
    toolCalls: z.ZodOptional<z.ZodNumber>;
    durationMs: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
type WorkflowAgentSnapshot = z.infer<typeof workflowAgentSnapshotSchema>;
declare const workflowPhaseSnapshotSchema: z.ZodObject<{
    index: z.ZodNumber;
    title: z.ZodString;
    kind: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type WorkflowPhaseSnapshot = z.infer<typeof workflowPhaseSnapshotSchema>;
/**
 * Full merged workflow state at a point in time. Providers emit progress as
 * delta batches; the adapter folds them by (record type, index) so every
 * persisted snapshot supersedes the previous one.
 */
declare const workflowProgressSnapshotSchema: z.ZodObject<{
    phases: z.ZodArray<z.ZodObject<{
        index: z.ZodNumber;
        title: z.ZodString;
        kind: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    agents: z.ZodArray<z.ZodObject<{
        index: z.ZodNumber;
        label: z.ZodString;
        state: z.ZodEnum<{
            running: "running";
            failed: "failed";
            queued: "queued";
            done: "done";
            skipped: "skipped";
        }>;
        model: z.ZodString;
        attempt: z.ZodNumber;
        cached: z.ZodBoolean;
        lastProgressAt: z.ZodNumber;
        phaseIndex: z.ZodOptional<z.ZodNumber>;
        phaseTitle: z.ZodOptional<z.ZodString>;
        agentType: z.ZodOptional<z.ZodString>;
        isolation: z.ZodOptional<z.ZodString>;
        queuedAt: z.ZodOptional<z.ZodNumber>;
        startedAt: z.ZodOptional<z.ZodNumber>;
        lastToolName: z.ZodOptional<z.ZodString>;
        lastToolSummary: z.ZodOptional<z.ZodString>;
        promptPreview: z.ZodOptional<z.ZodString>;
        resultPreview: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodString>;
        tokens: z.ZodOptional<z.ZodNumber>;
        toolCalls: z.ZodOptional<z.ZodNumber>;
        durationMs: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
type WorkflowProgressSnapshot = z.infer<typeof workflowProgressSnapshotSchema>;
declare const backgroundTaskUsageSchema: z.ZodObject<{
    totalTokens: z.ZodNumber;
    toolUses: z.ZodNumber;
    durationMs: z.ZodNumber;
}, z.core.$strip>;
type BackgroundTaskUsage = z.infer<typeof backgroundTaskUsageSchema>;
/**
 * Canonical derivation from the provider-reported task status to the shared
 * item-status machinery: paused stays pending because a paused workflow is
 * resumable; stopped maps to interrupted (user/system stop, not a failure).
 */
declare function backgroundTaskItemStatus(taskStatus: BackgroundTaskStatus): "pending" | "completed" | "failed" | "interrupted";
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
            pending: "pending";
            completed: "completed";
            in_progress: "in_progress";
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
    type: z.ZodLiteral<"read">;
    command: z.ZodString;
    name: z.ZodString;
    path: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"listFiles">;
    command: z.ZodString;
    path: z.ZodNullable<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"search">;
    command: z.ZodString;
    query: z.ZodNullable<z.ZodString>;
    path: z.ZodNullable<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"unknown">;
    command: z.ZodString;
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
    preferences: z.ZodEnum<{
        none: "none";
        read_only: "read_only";
        read_write: "read_write";
    }>;
    automations: z.ZodUnion<readonly [z.ZodLiteral<"none">, z.ZodLiteral<"all">, z.ZodObject<{
        kind: z.ZodLiteral<"bundle_ids">;
        bundleIds: z.ZodArray<z.ZodString>;
    }, z.core.$strip>]>;
    launchServices: z.ZodBoolean;
    accessibility: z.ZodBoolean;
    calendar: z.ZodBoolean;
    reminders: z.ZodBoolean;
    contacts: z.ZodEnum<{
        none: "none";
        read_only: "read_only";
        read_write: "read_write";
    }>;
}, z.core.$strip>;
declare const pendingInteractionRequestedPermissionProfileSchema: z.ZodObject<{
    network: z.ZodNullable<z.ZodObject<{
        enabled: z.ZodNullable<z.ZodBoolean>;
    }, z.core.$strip>>;
    fileSystem: z.ZodNullable<z.ZodObject<{
        read: z.ZodArray<z.ZodString>;
        write: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    macos: z.ZodNullable<z.ZodObject<{
        preferences: z.ZodEnum<{
            none: "none";
            read_only: "read_only";
            read_write: "read_write";
        }>;
        automations: z.ZodUnion<readonly [z.ZodLiteral<"none">, z.ZodLiteral<"all">, z.ZodObject<{
            kind: z.ZodLiteral<"bundle_ids">;
            bundleIds: z.ZodArray<z.ZodString>;
        }, z.core.$strip>]>;
        launchServices: z.ZodBoolean;
        accessibility: z.ZodBoolean;
        calendar: z.ZodBoolean;
        reminders: z.ZodBoolean;
        contacts: z.ZodEnum<{
            none: "none";
            read_only: "read_only";
            read_write: "read_write";
        }>;
    }, z.core.$strip>>;
}, z.core.$strip>;
type PendingInteractionRequestedPermissionProfile = z.infer<typeof pendingInteractionRequestedPermissionProfileSchema>;
declare const pendingInteractionGrantablePermissionProfileSchema: z.ZodObject<{
    network: z.ZodNullable<z.ZodObject<{
        enabled: z.ZodNullable<z.ZodBoolean>;
    }, z.core.$strip>>;
    fileSystem: z.ZodNullable<z.ZodObject<{
        read: z.ZodArray<z.ZodString>;
        write: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strict>;
type PendingInteractionGrantablePermissionProfile = z.infer<typeof pendingInteractionGrantablePermissionProfileSchema>;
declare const pendingInteractionGrantedPermissionProfileSchema: z.ZodObject<{
    network: z.ZodNullable<z.ZodObject<{
        enabled: z.ZodNullable<z.ZodBoolean>;
    }, z.core.$strip>>;
    fileSystem: z.ZodNullable<z.ZodObject<{
        read: z.ZodArray<z.ZodString>;
        write: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strict>;
type PendingInteractionGrantedPermissionProfile = z.infer<typeof pendingInteractionGrantedPermissionProfileSchema>;
declare const pendingInteractionApprovalDecisionSchema: z.ZodEnum<{
    allow_once: "allow_once";
    allow_for_session: "allow_for_session";
    deny: "deny";
}>;
type PendingInteractionApprovalDecision = z.infer<typeof pendingInteractionApprovalDecisionSchema>;
declare const pendingInteractionApprovalSubjectSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"command">;
    itemId: z.ZodString;
    command: z.ZodString;
    cwd: z.ZodNullable<z.ZodString>;
    actions: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"read">;
        command: z.ZodString;
        name: z.ZodString;
        path: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"listFiles">;
        command: z.ZodString;
        path: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"search">;
        command: z.ZodString;
        query: z.ZodNullable<z.ZodString>;
        path: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"unknown">;
        command: z.ZodString;
    }, z.core.$strip>], "type">>;
    sessionGrant: z.ZodNullable<z.ZodObject<{
        network: z.ZodNullable<z.ZodObject<{
            enabled: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>>;
        fileSystem: z.ZodNullable<z.ZodObject<{
            read: z.ZodArray<z.ZodString>;
            write: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strict>>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"file_change">;
    itemId: z.ZodString;
    writeScope: z.ZodNullable<z.ZodString>;
    sessionGrant: z.ZodNullable<z.ZodObject<{
        network: z.ZodNullable<z.ZodObject<{
            enabled: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>>;
        fileSystem: z.ZodNullable<z.ZodObject<{
            read: z.ZodArray<z.ZodString>;
            write: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strict>>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"permission_grant">;
    itemId: z.ZodString;
    toolName: z.ZodNullable<z.ZodString>;
    permissions: z.ZodObject<{
        network: z.ZodNullable<z.ZodObject<{
            enabled: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>>;
        fileSystem: z.ZodNullable<z.ZodObject<{
            read: z.ZodArray<z.ZodString>;
            write: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strict>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"plan">;
    itemId: z.ZodString;
    plan: z.ZodString;
    planFilePath: z.ZodNullable<z.ZodString>;
}, z.core.$strip>], "kind">;
type PendingInteractionApprovalSubject = z.infer<typeof pendingInteractionApprovalSubjectSchema>;
declare const approvalPendingInteractionPayloadSchema: z.ZodObject<{
    kind: z.ZodLiteral<"approval">;
    subject: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"command">;
        itemId: z.ZodString;
        command: z.ZodString;
        cwd: z.ZodNullable<z.ZodString>;
        actions: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"read">;
            command: z.ZodString;
            name: z.ZodString;
            path: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"listFiles">;
            command: z.ZodString;
            path: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"search">;
            command: z.ZodString;
            query: z.ZodNullable<z.ZodString>;
            path: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"unknown">;
            command: z.ZodString;
        }, z.core.$strip>], "type">>;
        sessionGrant: z.ZodNullable<z.ZodObject<{
            network: z.ZodNullable<z.ZodObject<{
                enabled: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>>;
            fileSystem: z.ZodNullable<z.ZodObject<{
                read: z.ZodArray<z.ZodString>;
                write: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strict>>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"file_change">;
        itemId: z.ZodString;
        writeScope: z.ZodNullable<z.ZodString>;
        sessionGrant: z.ZodNullable<z.ZodObject<{
            network: z.ZodNullable<z.ZodObject<{
                enabled: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>>;
            fileSystem: z.ZodNullable<z.ZodObject<{
                read: z.ZodArray<z.ZodString>;
                write: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strict>>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"permission_grant">;
        itemId: z.ZodString;
        toolName: z.ZodNullable<z.ZodString>;
        permissions: z.ZodObject<{
            network: z.ZodNullable<z.ZodObject<{
                enabled: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>>;
            fileSystem: z.ZodNullable<z.ZodObject<{
                read: z.ZodArray<z.ZodString>;
                write: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strict>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"plan">;
        itemId: z.ZodString;
        plan: z.ZodString;
        planFilePath: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>], "kind">;
    reason: z.ZodNullable<z.ZodString>;
    availableDecisions: z.ZodArray<z.ZodEnum<{
        allow_once: "allow_once";
        allow_for_session: "allow_for_session";
        deny: "deny";
    }>>;
}, z.core.$strip>;
type ApprovalPendingInteractionPayload = z.infer<typeof approvalPendingInteractionPayloadSchema>;
declare const USER_QUESTION_MAX_QUESTIONS = 4;
declare const USER_QUESTION_MAX_OPTIONS = 4;
declare const pendingInteractionUserQuestionQuestionSchema: z.ZodObject<{
    id: z.ZodString;
    prompt: z.ZodString;
    shortLabel: z.ZodOptional<z.ZodString>;
    multiSelect: z.ZodBoolean;
    options: z.ZodOptional<z.ZodArray<z.ZodObject<{
        value: z.ZodString;
        label: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    allowFreeText: z.ZodBoolean;
}, z.core.$strip>;
type PendingInteractionUserQuestionQuestion = z.infer<typeof pendingInteractionUserQuestionQuestionSchema>;
declare const userQuestionPendingInteractionPayloadSchema: z.ZodObject<{
    kind: z.ZodLiteral<"user_question">;
    questions: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        prompt: z.ZodString;
        shortLabel: z.ZodOptional<z.ZodString>;
        multiSelect: z.ZodBoolean;
        options: z.ZodOptional<z.ZodArray<z.ZodObject<{
            value: z.ZodString;
            label: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        allowFreeText: z.ZodBoolean;
    }, z.core.$strip>>;
}, z.core.$strip>;
type UserQuestionPendingInteractionPayload = z.infer<typeof userQuestionPendingInteractionPayloadSchema>;
declare const pluginPendingInteractionPayloadSchema: z.ZodObject<{
    kind: z.ZodLiteral<"plugin">;
    title: z.ZodString;
    data: z.ZodType<JsonValue, unknown, z.core.$ZodTypeInternals<JsonValue, unknown>>;
}, z.core.$strip>;
type PluginPendingInteractionPayload = z.infer<typeof pluginPendingInteractionPayloadSchema>;
declare const pendingInteractionPayloadSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"approval">;
    subject: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"command">;
        itemId: z.ZodString;
        command: z.ZodString;
        cwd: z.ZodNullable<z.ZodString>;
        actions: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"read">;
            command: z.ZodString;
            name: z.ZodString;
            path: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"listFiles">;
            command: z.ZodString;
            path: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"search">;
            command: z.ZodString;
            query: z.ZodNullable<z.ZodString>;
            path: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"unknown">;
            command: z.ZodString;
        }, z.core.$strip>], "type">>;
        sessionGrant: z.ZodNullable<z.ZodObject<{
            network: z.ZodNullable<z.ZodObject<{
                enabled: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>>;
            fileSystem: z.ZodNullable<z.ZodObject<{
                read: z.ZodArray<z.ZodString>;
                write: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strict>>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"file_change">;
        itemId: z.ZodString;
        writeScope: z.ZodNullable<z.ZodString>;
        sessionGrant: z.ZodNullable<z.ZodObject<{
            network: z.ZodNullable<z.ZodObject<{
                enabled: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>>;
            fileSystem: z.ZodNullable<z.ZodObject<{
                read: z.ZodArray<z.ZodString>;
                write: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strict>>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"permission_grant">;
        itemId: z.ZodString;
        toolName: z.ZodNullable<z.ZodString>;
        permissions: z.ZodObject<{
            network: z.ZodNullable<z.ZodObject<{
                enabled: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>>;
            fileSystem: z.ZodNullable<z.ZodObject<{
                read: z.ZodArray<z.ZodString>;
                write: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strict>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"plan">;
        itemId: z.ZodString;
        plan: z.ZodString;
        planFilePath: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>], "kind">;
    reason: z.ZodNullable<z.ZodString>;
    availableDecisions: z.ZodArray<z.ZodEnum<{
        allow_once: "allow_once";
        allow_for_session: "allow_for_session";
        deny: "deny";
    }>>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"user_question">;
    questions: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        prompt: z.ZodString;
        shortLabel: z.ZodOptional<z.ZodString>;
        multiSelect: z.ZodBoolean;
        options: z.ZodOptional<z.ZodArray<z.ZodObject<{
            value: z.ZodString;
            label: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        allowFreeText: z.ZodBoolean;
    }, z.core.$strip>>;
}, z.core.$strip>], "kind">;
type PendingInteractionPayload = z.infer<typeof pendingInteractionPayloadSchema>;
type AnyPendingInteractionPayload = PendingInteractionPayload | PluginPendingInteractionPayload;
declare function isApprovalPendingInteractionPayload(payload: AnyPendingInteractionPayload): payload is ApprovalPendingInteractionPayload;
declare function isUserQuestionPendingInteractionPayload(payload: AnyPendingInteractionPayload): payload is UserQuestionPendingInteractionPayload;
declare const approvalPendingInteractionResolutionSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    decision: z.ZodLiteral<"allow_once">;
    grantedPermissions: z.ZodNullable<z.ZodObject<{
        network: z.ZodNullable<z.ZodObject<{
            enabled: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>>;
        fileSystem: z.ZodNullable<z.ZodObject<{
            read: z.ZodArray<z.ZodString>;
            write: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strict>>;
}, z.core.$strip>, z.ZodObject<{
    decision: z.ZodLiteral<"allow_for_session">;
    grantedPermissions: z.ZodNullable<z.ZodObject<{
        network: z.ZodNullable<z.ZodObject<{
            enabled: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>>;
        fileSystem: z.ZodNullable<z.ZodObject<{
            read: z.ZodArray<z.ZodString>;
            write: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strict>>;
}, z.core.$strip>, z.ZodObject<{
    decision: z.ZodLiteral<"deny">;
}, z.core.$strip>], "decision">;
type ApprovalPendingInteractionResolution = z.infer<typeof approvalPendingInteractionResolutionSchema>;
declare const userQuestionPendingInteractionResolutionSchema: z.ZodObject<{
    kind: z.ZodLiteral<"user_answer">;
    answers: z.ZodRecord<z.ZodString, z.ZodObject<{
        selected: z.ZodArray<z.ZodString>;
        freeText: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
type UserQuestionPendingInteractionResolution = z.infer<typeof userQuestionPendingInteractionResolutionSchema>;
declare const pendingInteractionResolutionSchema: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
    decision: z.ZodLiteral<"allow_once">;
    grantedPermissions: z.ZodNullable<z.ZodObject<{
        network: z.ZodNullable<z.ZodObject<{
            enabled: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>>;
        fileSystem: z.ZodNullable<z.ZodObject<{
            read: z.ZodArray<z.ZodString>;
            write: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strict>>;
}, z.core.$strip>, z.ZodObject<{
    decision: z.ZodLiteral<"allow_for_session">;
    grantedPermissions: z.ZodNullable<z.ZodObject<{
        network: z.ZodNullable<z.ZodObject<{
            enabled: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>>;
        fileSystem: z.ZodNullable<z.ZodObject<{
            read: z.ZodArray<z.ZodString>;
            write: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strict>>;
}, z.core.$strip>, z.ZodObject<{
    decision: z.ZodLiteral<"deny">;
}, z.core.$strip>], "decision">, z.ZodObject<{
    kind: z.ZodLiteral<"user_answer">;
    answers: z.ZodRecord<z.ZodString, z.ZodObject<{
        selected: z.ZodArray<z.ZodString>;
        freeText: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
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
    none: "none";
    low: "low";
    medium: "medium";
    high: "high";
    xhigh: "xhigh";
    ultracode: "ultracode";
    max: "max";
    ultra: "ultra";
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
    replace: "replace";
    append: "append";
}>;
type InstructionMode = z.infer<typeof instructionModeSchema>;
declare const permissionModeSchema: z.ZodEnum<{
    full: "full";
    auto: "auto";
    "accept-edits": "accept-edits";
}>;
type PermissionMode = z.infer<typeof permissionModeSchema>;
declare const permissionEscalationValues: readonly ["ask", "deny"];
declare const permissionEscalationSchema: z.ZodEnum<{
    deny: "deny";
    ask: "ask";
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
    visibility: z.ZodOptional<z.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
    type: z.ZodLiteral<"text">;
    text: z.ZodString;
    mentions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        start: z.ZodNumber;
        end: z.ZodNumber;
        resource: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"thread">;
            threadId: z.ZodString;
            projectId: z.ZodOptional<z.ZodString>;
            label: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"project">;
            projectId: z.ZodString;
            label: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"section">;
            sectionId: z.ZodString;
            label: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"path">;
            source: z.ZodEnum<{
                workspace: "workspace";
                "thread-storage": "thread-storage";
            }>;
            entryKind: z.ZodEnum<{
                file: "file";
                directory: "directory";
            }>;
            path: z.ZodString;
            label: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"command">;
            trigger: z.ZodEnum<{
                "/": "/";
            }>;
            name: z.ZodString;
            source: z.ZodEnum<{
                command: "command";
                skill: "skill";
            }>;
            origin: z.ZodEnum<{
                user: "user";
                project: "project";
                builtin: "builtin";
            }>;
            label: z.ZodString;
            argumentHint: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"plugin">;
            pluginId: z.ZodString;
            icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            itemId: z.ZodString;
            label: z.ZodString;
        }, z.core.$strip>], "kind">>;
    }, z.core.$strip>>>;
}, z.core.$strip>, z.ZodObject<{
    visibility: z.ZodOptional<z.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
    type: z.ZodLiteral<"image">;
    url: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    visibility: z.ZodOptional<z.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
    type: z.ZodLiteral<"localImage">;
    path: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    visibility: z.ZodOptional<z.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
    type: z.ZodLiteral<"localFile">;
    path: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    sizeBytes: z.ZodOptional<z.ZodNumber>;
    mimeType: z.ZodOptional<z.ZodString>;
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
    permissionMode: z.ZodLiteral<"accept-edits">;
    permissionScope: z.ZodLiteral<"workspace">;
    approvalReviewer: z.ZodLiteral<"user">;
    permissionEscalation: z.ZodEnum<{
        deny: "deny";
        ask: "ask";
    }>;
}, z.core.$strip>, z.ZodObject<{
    permissionMode: z.ZodLiteral<"auto">;
    permissionScope: z.ZodLiteral<"workspace">;
    approvalReviewer: z.ZodLiteral<"automatic">;
    permissionEscalation: z.ZodEnum<{
        deny: "deny";
        ask: "ask";
    }>;
}, z.core.$strip>, z.ZodObject<{
    permissionMode: z.ZodLiteral<"full">;
    permissionScope: z.ZodLiteral<"full">;
    approvalReviewer: z.ZodNull;
    permissionEscalation: z.ZodNull;
}, z.core.$strip>], "permissionMode">;
type RuntimePermissionPolicy = z.infer<typeof runtimePermissionPolicySchema>;

declare const clientTurnRequestIdSchema: z.ZodString;
type ClientTurnRequestId = z.infer<typeof clientTurnRequestIdSchema>;

declare const threadEventItemStatusSchema: z.ZodEnum<{
    pending: "pending";
    completed: "completed";
    failed: "failed";
    interrupted: "interrupted";
}>;
type ThreadEventItemStatus = z.infer<typeof threadEventItemStatusSchema>;
declare const threadEventItemApprovalStatusSchema: z.ZodNullable<z.ZodEnum<{
    waiting_for_approval: "waiting_for_approval";
    denied: "denied";
}>>;
type ThreadEventItemApprovalStatus = z.infer<typeof threadEventItemApprovalStatusSchema>;
declare const threadEventTurnStatusSchema: z.ZodEnum<{
    completed: "completed";
    failed: "failed";
    interrupted: "interrupted";
}>;
type ThreadEventTurnStatus = z.infer<typeof threadEventTurnStatusSchema>;
declare const providerErrorCategorySchema: z.ZodEnum<{
    unknown: "unknown";
    "active-turn-not-steerable": "active-turn-not-steerable";
    "bad-request": "bad-request";
    "connection-failed": "connection-failed";
    "context-window-exceeded": "context-window-exceeded";
    billing: "billing";
    "budget-exceeded": "budget-exceeded";
    internal: "internal";
    "max-output-tokens": "max-output-tokens";
    "max-turns": "max-turns";
    overloaded: "overloaded";
    policy: "policy";
    "rate-limit": "rate-limit";
    sandbox: "sandbox";
    "stream-disconnected": "stream-disconnected";
    "structured-output-retries": "structured-output-retries";
    "thread-rollback-failed": "thread-rollback-failed";
    "too-many-failed-attempts": "too-many-failed-attempts";
    unauthorized: "unauthorized";
}>;
type ProviderErrorCategory = z.infer<typeof providerErrorCategorySchema>;
declare const providerErrorInfoSchema: z.ZodObject<{
    category: z.ZodEnum<{
        unknown: "unknown";
        "active-turn-not-steerable": "active-turn-not-steerable";
        "bad-request": "bad-request";
        "connection-failed": "connection-failed";
        "context-window-exceeded": "context-window-exceeded";
        billing: "billing";
        "budget-exceeded": "budget-exceeded";
        internal: "internal";
        "max-output-tokens": "max-output-tokens";
        "max-turns": "max-turns";
        overloaded: "overloaded";
        policy: "policy";
        "rate-limit": "rate-limit";
        sandbox: "sandbox";
        "stream-disconnected": "stream-disconnected";
        "structured-output-retries": "structured-output-retries";
        "thread-rollback-failed": "thread-rollback-failed";
        "too-many-failed-attempts": "too-many-failed-attempts";
        unauthorized: "unauthorized";
    }>;
    providerCode: z.ZodNullable<z.ZodString>;
    httpStatusCode: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
type ProviderErrorInfo = z.infer<typeof providerErrorInfoSchema>;
declare const providerRateLimitStatusSchema: z.ZodEnum<{
    unknown: "unknown";
    allowed: "allowed";
    warning: "warning";
    blocked: "blocked";
}>;
type ProviderRateLimitStatus = z.infer<typeof providerRateLimitStatusSchema>;
declare const providerRateLimitWindowSchema: z.ZodObject<{
    providerKey: z.ZodNullable<z.ZodString>;
    label: z.ZodNullable<z.ZodString>;
    status: z.ZodEnum<{
        unknown: "unknown";
        allowed: "allowed";
        warning: "warning";
        blocked: "blocked";
    }>;
    resetsAtMs: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
type ProviderRateLimitWindow = z.infer<typeof providerRateLimitWindowSchema>;
declare const providerRateLimitStateSchema: z.ZodObject<{
    providerId: z.ZodString;
    status: z.ZodEnum<{
        unknown: "unknown";
        allowed: "allowed";
        warning: "warning";
        blocked: "blocked";
    }>;
    kind: z.ZodEnum<{
        unknown: "unknown";
        "subscription-window": "subscription-window";
        credits: "credits";
        "spend-control": "spend-control";
    }>;
    windows: z.ZodArray<z.ZodObject<{
        providerKey: z.ZodNullable<z.ZodString>;
        label: z.ZodNullable<z.ZodString>;
        status: z.ZodEnum<{
            unknown: "unknown";
            allowed: "allowed";
            warning: "warning";
            blocked: "blocked";
        }>;
        resetsAtMs: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    reachedReason: z.ZodNullable<z.ZodString>;
    overageStatus: z.ZodNullable<z.ZodEnum<{
        allowed: "allowed";
        warning: "warning";
        rejected: "rejected";
        unavailable: "unavailable";
    }>>;
    overageReason: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
type ProviderRateLimitState = z.infer<typeof providerRateLimitStateSchema>;
declare const threadEventPlanStepSchema: z.ZodObject<{
    step: z.ZodString;
    status: z.ZodOptional<z.ZodEnum<{
        pending: "pending";
        completed: "completed";
        failed: "failed";
        active: "active";
    }>>;
}, z.core.$strip>;
type ThreadEventPlanStep = z.infer<typeof threadEventPlanStepSchema>;
declare const threadEventWebSearchItemSchema: z.ZodObject<{
    type: z.ZodLiteral<"webSearch">;
    id: z.ZodString;
    queries: z.ZodArray<z.ZodString>;
    resultText: z.ZodNullable<z.ZodString>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type ThreadEventWebSearchItem = z.infer<typeof threadEventWebSearchItemSchema>;
declare const threadEventWebFetchItemSchema: z.ZodObject<{
    type: z.ZodLiteral<"webFetch">;
    id: z.ZodString;
    url: z.ZodString;
    prompt: z.ZodNullable<z.ZodString>;
    pattern: z.ZodNullable<z.ZodString>;
    resultText: z.ZodNullable<z.ZodString>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type ThreadEventWebFetchItem = z.infer<typeof threadEventWebFetchItemSchema>;
declare const threadEventUserContentSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"text">;
    text: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"image">;
    url: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"localImage">;
    path: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"localFile">;
    path: z.ZodString;
}, z.core.$strip>], "type">;
type ThreadEventUserContent = z.infer<typeof threadEventUserContentSchema>;
declare const threadEventTokenUsageBreakdownSchema: z.ZodObject<{
    totalTokens: z.ZodNumber;
    inputTokens: z.ZodNumber;
    cachedInputTokens: z.ZodNumber;
    outputTokens: z.ZodNumber;
    reasoningOutputTokens: z.ZodNumber;
}, z.core.$strip>;
type ThreadEventTokenUsageBreakdown = z.infer<typeof threadEventTokenUsageBreakdownSchema>;
declare const threadEventContextWindowUsageSchema: z.ZodObject<{
    usedTokens: z.ZodNullable<z.ZodNumber>;
    modelContextWindow: z.ZodNullable<z.ZodNumber>;
    estimated: z.ZodBoolean;
}, z.core.$strip>;
type ThreadEventContextWindowUsage = z.infer<typeof threadEventContextWindowUsageSchema>;
declare const threadEventTokenUsageSchema: z.ZodObject<{
    total: z.ZodObject<{
        totalTokens: z.ZodNumber;
        inputTokens: z.ZodNumber;
        cachedInputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        reasoningOutputTokens: z.ZodNumber;
    }, z.core.$strip>;
    last: z.ZodObject<{
        totalTokens: z.ZodNumber;
        inputTokens: z.ZodNumber;
        cachedInputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        reasoningOutputTokens: z.ZodNumber;
    }, z.core.$strip>;
    modelContextWindow: z.ZodNullable<z.ZodNumber>;
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
    type: z.ZodLiteral<"backgroundTask">;
    id: z.ZodString;
    taskType: z.ZodString;
    description: z.ZodString;
    status: z.ZodEnum<{
        pending: "pending";
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
    }>;
    taskStatus: z.ZodEnum<{
        pending: "pending";
        running: "running";
        paused: "paused";
        completed: "completed";
        failed: "failed";
        killed: "killed";
        stopped: "stopped";
    }>;
    skipTranscript: z.ZodBoolean;
    workflowName: z.ZodOptional<z.ZodString>;
    workflow: z.ZodOptional<z.ZodObject<{
        phases: z.ZodArray<z.ZodObject<{
            index: z.ZodNumber;
            title: z.ZodString;
            kind: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        agents: z.ZodArray<z.ZodObject<{
            index: z.ZodNumber;
            label: z.ZodString;
            state: z.ZodEnum<{
                running: "running";
                failed: "failed";
                queued: "queued";
                done: "done";
                skipped: "skipped";
            }>;
            model: z.ZodString;
            attempt: z.ZodNumber;
            cached: z.ZodBoolean;
            lastProgressAt: z.ZodNumber;
            phaseIndex: z.ZodOptional<z.ZodNumber>;
            phaseTitle: z.ZodOptional<z.ZodString>;
            agentType: z.ZodOptional<z.ZodString>;
            isolation: z.ZodOptional<z.ZodString>;
            queuedAt: z.ZodOptional<z.ZodNumber>;
            startedAt: z.ZodOptional<z.ZodNumber>;
            lastToolName: z.ZodOptional<z.ZodString>;
            lastToolSummary: z.ZodOptional<z.ZodString>;
            promptPreview: z.ZodOptional<z.ZodString>;
            resultPreview: z.ZodOptional<z.ZodString>;
            error: z.ZodOptional<z.ZodString>;
            tokens: z.ZodOptional<z.ZodNumber>;
            toolCalls: z.ZodOptional<z.ZodNumber>;
            durationMs: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    usage: z.ZodOptional<z.ZodObject<{
        totalTokens: z.ZodNumber;
        toolUses: z.ZodNumber;
        durationMs: z.ZodNumber;
    }, z.core.$strip>>;
    summary: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
    outputFile: z.ZodOptional<z.ZodString>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type ThreadEventBackgroundTaskItem = z.infer<typeof threadEventBackgroundTaskItemSchema>;
declare const threadEventItemSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"userMessage">;
    id: z.ZodString;
    content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        url: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"localImage">;
        path: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"localFile">;
        path: z.ZodString;
    }, z.core.$strip>], "type">>;
    clientRequestId: z.ZodOptional<z.ZodString>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"agentMessage">;
    id: z.ZodString;
    text: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"commandExecution">;
    id: z.ZodString;
    command: z.ZodString;
    cwd: z.ZodString;
    status: z.ZodEnum<{
        pending: "pending";
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
    }>;
    approvalStatus: z.ZodNullable<z.ZodEnum<{
        waiting_for_approval: "waiting_for_approval";
        denied: "denied";
    }>>;
    aggregatedOutput: z.ZodOptional<z.ZodString>;
    exitCode: z.ZodOptional<z.ZodNumber>;
    durationMs: z.ZodOptional<z.ZodNumber>;
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
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"fileChange">;
    id: z.ZodString;
    changes: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        kind: z.ZodEnum<{
            add: "add";
            delete: "delete";
            update: "update";
        }>;
        movePath: z.ZodOptional<z.ZodString>;
        diff: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    status: z.ZodEnum<{
        pending: "pending";
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
    }>;
    approvalStatus: z.ZodNullable<z.ZodEnum<{
        waiting_for_approval: "waiting_for_approval";
        denied: "denied";
    }>>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"webSearch">;
    id: z.ZodString;
    queries: z.ZodArray<z.ZodString>;
    resultText: z.ZodNullable<z.ZodString>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"webFetch">;
    id: z.ZodString;
    url: z.ZodString;
    prompt: z.ZodNullable<z.ZodString>;
    pattern: z.ZodNullable<z.ZodString>;
    resultText: z.ZodNullable<z.ZodString>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"imageView">;
    id: z.ZodString;
    path: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"toolCall">;
    id: z.ZodString;
    server: z.ZodOptional<z.ZodString>;
    tool: z.ZodString;
    arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    statusLabels: z.ZodOptional<z.ZodObject<{
        pending: z.ZodString;
        completed: z.ZodString;
    }, z.core.$strip>>;
    status: z.ZodEnum<{
        pending: "pending";
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
    }>;
    result: z.ZodOptional<z.ZodUnknown>;
    error: z.ZodOptional<z.ZodString>;
    durationMs: z.ZodOptional<z.ZodNumber>;
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
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"reasoning">;
    id: z.ZodString;
    summary: z.ZodArray<z.ZodString>;
    content: z.ZodArray<z.ZodString>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"plan">;
    id: z.ZodString;
    text: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"contextCompaction">;
    id: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"backgroundTask">;
    id: z.ZodString;
    taskType: z.ZodString;
    description: z.ZodString;
    status: z.ZodEnum<{
        pending: "pending";
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
    }>;
    taskStatus: z.ZodEnum<{
        pending: "pending";
        running: "running";
        paused: "paused";
        completed: "completed";
        failed: "failed";
        killed: "killed";
        stopped: "stopped";
    }>;
    skipTranscript: z.ZodBoolean;
    workflowName: z.ZodOptional<z.ZodString>;
    workflow: z.ZodOptional<z.ZodObject<{
        phases: z.ZodArray<z.ZodObject<{
            index: z.ZodNumber;
            title: z.ZodString;
            kind: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        agents: z.ZodArray<z.ZodObject<{
            index: z.ZodNumber;
            label: z.ZodString;
            state: z.ZodEnum<{
                running: "running";
                failed: "failed";
                queued: "queued";
                done: "done";
                skipped: "skipped";
            }>;
            model: z.ZodString;
            attempt: z.ZodNumber;
            cached: z.ZodBoolean;
            lastProgressAt: z.ZodNumber;
            phaseIndex: z.ZodOptional<z.ZodNumber>;
            phaseTitle: z.ZodOptional<z.ZodString>;
            agentType: z.ZodOptional<z.ZodString>;
            isolation: z.ZodOptional<z.ZodString>;
            queuedAt: z.ZodOptional<z.ZodNumber>;
            startedAt: z.ZodOptional<z.ZodNumber>;
            lastToolName: z.ZodOptional<z.ZodString>;
            lastToolSummary: z.ZodOptional<z.ZodString>;
            promptPreview: z.ZodOptional<z.ZodString>;
            resultPreview: z.ZodOptional<z.ZodString>;
            error: z.ZodOptional<z.ZodString>;
            tokens: z.ZodOptional<z.ZodNumber>;
            toolCalls: z.ZodOptional<z.ZodNumber>;
            durationMs: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    usage: z.ZodOptional<z.ZodObject<{
        totalTokens: z.ZodNumber;
        toolUses: z.ZodNumber;
        durationMs: z.ZodNumber;
    }, z.core.$strip>>;
    summary: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
    outputFile: z.ZodOptional<z.ZodString>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>], "type">;
type ThreadEventItem = z.infer<typeof threadEventItemSchema>;
declare const providerEventSchema: z.ZodIntersection<z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"thread/started">;
    threadId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"thread/identity">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"turn/started">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"turn/completed">;
    threadId: z.ZodString;
    providerThreadId: z.ZodNullable<z.ZodString>;
    status: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
    }>;
    error: z.ZodOptional<z.ZodObject<{
        message: z.ZodString;
    }, z.core.$strip>>;
    providerCheckpointId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"turn/input/accepted">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    clientRequestId: z.ZodString;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"thread">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"turn">;
        turnId: z.ZodString;
    }, z.core.$strip>], "kind">;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"thread/name/updated">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    threadName: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"thread/compacted">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"thread/context/cleared">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"thread/goal/updated">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    objective: z.ZodString;
    status: z.ZodEnum<{
        paused: "paused";
        active: "active";
        budgetLimited: "budgetLimited";
        complete: "complete";
    }>;
    tokenBudget: z.ZodNullable<z.ZodNumber>;
    tokensUsed: z.ZodNumber;
    timeUsedSeconds: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"thread/goal/cleared">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/started">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    item: z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"userMessage">;
        id: z.ZodString;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            url: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"localImage">;
            path: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"localFile">;
            path: z.ZodString;
        }, z.core.$strip>], "type">>;
        clientRequestId: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"agentMessage">;
        id: z.ZodString;
        text: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"commandExecution">;
        id: z.ZodString;
        command: z.ZodString;
        cwd: z.ZodString;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        approvalStatus: z.ZodNullable<z.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        aggregatedOutput: z.ZodOptional<z.ZodString>;
        exitCode: z.ZodOptional<z.ZodNumber>;
        durationMs: z.ZodOptional<z.ZodNumber>;
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
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"fileChange">;
        id: z.ZodString;
        changes: z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            kind: z.ZodEnum<{
                add: "add";
                delete: "delete";
                update: "update";
            }>;
            movePath: z.ZodOptional<z.ZodString>;
            diff: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        approvalStatus: z.ZodNullable<z.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"webSearch">;
        id: z.ZodString;
        queries: z.ZodArray<z.ZodString>;
        resultText: z.ZodNullable<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"webFetch">;
        id: z.ZodString;
        url: z.ZodString;
        prompt: z.ZodNullable<z.ZodString>;
        pattern: z.ZodNullable<z.ZodString>;
        resultText: z.ZodNullable<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"imageView">;
        id: z.ZodString;
        path: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"toolCall">;
        id: z.ZodString;
        server: z.ZodOptional<z.ZodString>;
        tool: z.ZodString;
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        statusLabels: z.ZodOptional<z.ZodObject<{
            pending: z.ZodString;
            completed: z.ZodString;
        }, z.core.$strip>>;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        result: z.ZodOptional<z.ZodUnknown>;
        error: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
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
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"reasoning">;
        id: z.ZodString;
        summary: z.ZodArray<z.ZodString>;
        content: z.ZodArray<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"plan">;
        id: z.ZodString;
        text: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"contextCompaction">;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"backgroundTask">;
        id: z.ZodString;
        taskType: z.ZodString;
        description: z.ZodString;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        taskStatus: z.ZodEnum<{
            pending: "pending";
            running: "running";
            paused: "paused";
            completed: "completed";
            failed: "failed";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z.ZodBoolean;
        workflowName: z.ZodOptional<z.ZodString>;
        workflow: z.ZodOptional<z.ZodObject<{
            phases: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                title: z.ZodString;
                kind: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            agents: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                label: z.ZodString;
                state: z.ZodEnum<{
                    running: "running";
                    failed: "failed";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z.ZodString;
                attempt: z.ZodNumber;
                cached: z.ZodBoolean;
                lastProgressAt: z.ZodNumber;
                phaseIndex: z.ZodOptional<z.ZodNumber>;
                phaseTitle: z.ZodOptional<z.ZodString>;
                agentType: z.ZodOptional<z.ZodString>;
                isolation: z.ZodOptional<z.ZodString>;
                queuedAt: z.ZodOptional<z.ZodNumber>;
                startedAt: z.ZodOptional<z.ZodNumber>;
                lastToolName: z.ZodOptional<z.ZodString>;
                lastToolSummary: z.ZodOptional<z.ZodString>;
                promptPreview: z.ZodOptional<z.ZodString>;
                resultPreview: z.ZodOptional<z.ZodString>;
                error: z.ZodOptional<z.ZodString>;
                tokens: z.ZodOptional<z.ZodNumber>;
                toolCalls: z.ZodOptional<z.ZodNumber>;
                durationMs: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        usage: z.ZodOptional<z.ZodObject<{
            totalTokens: z.ZodNumber;
            toolUses: z.ZodNumber;
            durationMs: z.ZodNumber;
        }, z.core.$strip>>;
        summary: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodString>;
        outputFile: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "type">;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/completed">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    item: z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"userMessage">;
        id: z.ZodString;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            url: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"localImage">;
            path: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"localFile">;
            path: z.ZodString;
        }, z.core.$strip>], "type">>;
        clientRequestId: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"agentMessage">;
        id: z.ZodString;
        text: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"commandExecution">;
        id: z.ZodString;
        command: z.ZodString;
        cwd: z.ZodString;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        approvalStatus: z.ZodNullable<z.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        aggregatedOutput: z.ZodOptional<z.ZodString>;
        exitCode: z.ZodOptional<z.ZodNumber>;
        durationMs: z.ZodOptional<z.ZodNumber>;
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
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"fileChange">;
        id: z.ZodString;
        changes: z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            kind: z.ZodEnum<{
                add: "add";
                delete: "delete";
                update: "update";
            }>;
            movePath: z.ZodOptional<z.ZodString>;
            diff: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        approvalStatus: z.ZodNullable<z.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"webSearch">;
        id: z.ZodString;
        queries: z.ZodArray<z.ZodString>;
        resultText: z.ZodNullable<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"webFetch">;
        id: z.ZodString;
        url: z.ZodString;
        prompt: z.ZodNullable<z.ZodString>;
        pattern: z.ZodNullable<z.ZodString>;
        resultText: z.ZodNullable<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"imageView">;
        id: z.ZodString;
        path: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"toolCall">;
        id: z.ZodString;
        server: z.ZodOptional<z.ZodString>;
        tool: z.ZodString;
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        statusLabels: z.ZodOptional<z.ZodObject<{
            pending: z.ZodString;
            completed: z.ZodString;
        }, z.core.$strip>>;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        result: z.ZodOptional<z.ZodUnknown>;
        error: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
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
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"reasoning">;
        id: z.ZodString;
        summary: z.ZodArray<z.ZodString>;
        content: z.ZodArray<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"plan">;
        id: z.ZodString;
        text: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"contextCompaction">;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"backgroundTask">;
        id: z.ZodString;
        taskType: z.ZodString;
        description: z.ZodString;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        taskStatus: z.ZodEnum<{
            pending: "pending";
            running: "running";
            paused: "paused";
            completed: "completed";
            failed: "failed";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z.ZodBoolean;
        workflowName: z.ZodOptional<z.ZodString>;
        workflow: z.ZodOptional<z.ZodObject<{
            phases: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                title: z.ZodString;
                kind: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            agents: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                label: z.ZodString;
                state: z.ZodEnum<{
                    running: "running";
                    failed: "failed";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z.ZodString;
                attempt: z.ZodNumber;
                cached: z.ZodBoolean;
                lastProgressAt: z.ZodNumber;
                phaseIndex: z.ZodOptional<z.ZodNumber>;
                phaseTitle: z.ZodOptional<z.ZodString>;
                agentType: z.ZodOptional<z.ZodString>;
                isolation: z.ZodOptional<z.ZodString>;
                queuedAt: z.ZodOptional<z.ZodNumber>;
                startedAt: z.ZodOptional<z.ZodNumber>;
                lastToolName: z.ZodOptional<z.ZodString>;
                lastToolSummary: z.ZodOptional<z.ZodString>;
                promptPreview: z.ZodOptional<z.ZodString>;
                resultPreview: z.ZodOptional<z.ZodString>;
                error: z.ZodOptional<z.ZodString>;
                tokens: z.ZodOptional<z.ZodNumber>;
                toolCalls: z.ZodOptional<z.ZodNumber>;
                durationMs: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        usage: z.ZodOptional<z.ZodObject<{
            totalTokens: z.ZodNumber;
            toolUses: z.ZodNumber;
            durationMs: z.ZodNumber;
        }, z.core.$strip>>;
        summary: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodString>;
        outputFile: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "type">;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/agentMessage/delta">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    itemId: z.ZodString;
    delta: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/commandExecution/outputDelta">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    itemId: z.ZodString;
    delta: z.ZodString;
    reset: z.ZodOptional<z.ZodBoolean>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/fileChange/outputDelta">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    itemId: z.ZodString;
    delta: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/reasoning/summaryTextDelta">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    itemId: z.ZodString;
    delta: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/reasoning/textDelta">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    itemId: z.ZodString;
    delta: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/plan/delta">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    itemId: z.ZodString;
    delta: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/mcpToolCall/progress">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    itemId: z.ZodString;
    message: z.ZodOptional<z.ZodString>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/toolCall/progress">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    itemId: z.ZodString;
    message: z.ZodOptional<z.ZodString>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/backgroundTask/progress">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    item: z.ZodObject<{
        type: z.ZodLiteral<"backgroundTask">;
        id: z.ZodString;
        taskType: z.ZodString;
        description: z.ZodString;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        taskStatus: z.ZodEnum<{
            pending: "pending";
            running: "running";
            paused: "paused";
            completed: "completed";
            failed: "failed";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z.ZodBoolean;
        workflowName: z.ZodOptional<z.ZodString>;
        workflow: z.ZodOptional<z.ZodObject<{
            phases: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                title: z.ZodString;
                kind: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            agents: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                label: z.ZodString;
                state: z.ZodEnum<{
                    running: "running";
                    failed: "failed";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z.ZodString;
                attempt: z.ZodNumber;
                cached: z.ZodBoolean;
                lastProgressAt: z.ZodNumber;
                phaseIndex: z.ZodOptional<z.ZodNumber>;
                phaseTitle: z.ZodOptional<z.ZodString>;
                agentType: z.ZodOptional<z.ZodString>;
                isolation: z.ZodOptional<z.ZodString>;
                queuedAt: z.ZodOptional<z.ZodNumber>;
                startedAt: z.ZodOptional<z.ZodNumber>;
                lastToolName: z.ZodOptional<z.ZodString>;
                lastToolSummary: z.ZodOptional<z.ZodString>;
                promptPreview: z.ZodOptional<z.ZodString>;
                resultPreview: z.ZodOptional<z.ZodString>;
                error: z.ZodOptional<z.ZodString>;
                tokens: z.ZodOptional<z.ZodNumber>;
                toolCalls: z.ZodOptional<z.ZodNumber>;
                durationMs: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        usage: z.ZodOptional<z.ZodObject<{
            totalTokens: z.ZodNumber;
            toolUses: z.ZodNumber;
            durationMs: z.ZodNumber;
        }, z.core.$strip>>;
        summary: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodString>;
        outputFile: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/backgroundTask/completed">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    item: z.ZodObject<{
        type: z.ZodLiteral<"backgroundTask">;
        id: z.ZodString;
        taskType: z.ZodString;
        description: z.ZodString;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        taskStatus: z.ZodEnum<{
            pending: "pending";
            running: "running";
            paused: "paused";
            completed: "completed";
            failed: "failed";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z.ZodBoolean;
        workflowName: z.ZodOptional<z.ZodString>;
        workflow: z.ZodOptional<z.ZodObject<{
            phases: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                title: z.ZodString;
                kind: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            agents: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                label: z.ZodString;
                state: z.ZodEnum<{
                    running: "running";
                    failed: "failed";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z.ZodString;
                attempt: z.ZodNumber;
                cached: z.ZodBoolean;
                lastProgressAt: z.ZodNumber;
                phaseIndex: z.ZodOptional<z.ZodNumber>;
                phaseTitle: z.ZodOptional<z.ZodString>;
                agentType: z.ZodOptional<z.ZodString>;
                isolation: z.ZodOptional<z.ZodString>;
                queuedAt: z.ZodOptional<z.ZodNumber>;
                startedAt: z.ZodOptional<z.ZodNumber>;
                lastToolName: z.ZodOptional<z.ZodString>;
                lastToolSummary: z.ZodOptional<z.ZodString>;
                promptPreview: z.ZodOptional<z.ZodString>;
                resultPreview: z.ZodOptional<z.ZodString>;
                error: z.ZodOptional<z.ZodString>;
                tokens: z.ZodOptional<z.ZodNumber>;
                toolCalls: z.ZodOptional<z.ZodNumber>;
                durationMs: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        usage: z.ZodOptional<z.ZodObject<{
            totalTokens: z.ZodNumber;
            toolUses: z.ZodNumber;
            durationMs: z.ZodNumber;
        }, z.core.$strip>>;
        summary: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodString>;
        outputFile: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"thread/tokenUsage/updated">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    tokenUsage: z.ZodObject<{
        total: z.ZodObject<{
            totalTokens: z.ZodNumber;
            inputTokens: z.ZodNumber;
            cachedInputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            reasoningOutputTokens: z.ZodNumber;
        }, z.core.$strip>;
        last: z.ZodObject<{
            totalTokens: z.ZodNumber;
            inputTokens: z.ZodNumber;
            cachedInputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            reasoningOutputTokens: z.ZodNumber;
        }, z.core.$strip>;
        modelContextWindow: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"thread/contextWindowUsage/updated">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    contextWindowUsage: z.ZodObject<{
        usedTokens: z.ZodNullable<z.ZodNumber>;
        modelContextWindow: z.ZodNullable<z.ZodNumber>;
        estimated: z.ZodBoolean;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"turn/plan/updated">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    plan: z.ZodArray<z.ZodObject<{
        step: z.ZodString;
        status: z.ZodOptional<z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            active: "active";
        }>>;
    }, z.core.$strip>>;
    explanation: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"turn/diff/updated">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    diff: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"provider/error">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    message: z.ZodString;
    detail: z.ZodOptional<z.ZodString>;
    willRetry: z.ZodOptional<z.ZodBoolean>;
    errorInfo: z.ZodOptional<z.ZodObject<{
        category: z.ZodEnum<{
            unknown: "unknown";
            "active-turn-not-steerable": "active-turn-not-steerable";
            "bad-request": "bad-request";
            "connection-failed": "connection-failed";
            "context-window-exceeded": "context-window-exceeded";
            billing: "billing";
            "budget-exceeded": "budget-exceeded";
            internal: "internal";
            "max-output-tokens": "max-output-tokens";
            "max-turns": "max-turns";
            overloaded: "overloaded";
            policy: "policy";
            "rate-limit": "rate-limit";
            sandbox: "sandbox";
            "stream-disconnected": "stream-disconnected";
            "structured-output-retries": "structured-output-retries";
            "thread-rollback-failed": "thread-rollback-failed";
            "too-many-failed-attempts": "too-many-failed-attempts";
            unauthorized: "unauthorized";
        }>;
        providerCode: z.ZodNullable<z.ZodString>;
        httpStatusCode: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"provider/rateLimits/updated">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    rateLimits: z.ZodObject<{
        providerId: z.ZodString;
        status: z.ZodEnum<{
            unknown: "unknown";
            allowed: "allowed";
            warning: "warning";
            blocked: "blocked";
        }>;
        kind: z.ZodEnum<{
            unknown: "unknown";
            "subscription-window": "subscription-window";
            credits: "credits";
            "spend-control": "spend-control";
        }>;
        windows: z.ZodArray<z.ZodObject<{
            providerKey: z.ZodNullable<z.ZodString>;
            label: z.ZodNullable<z.ZodString>;
            status: z.ZodEnum<{
                unknown: "unknown";
                allowed: "allowed";
                warning: "warning";
                blocked: "blocked";
            }>;
            resetsAtMs: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        reachedReason: z.ZodNullable<z.ZodString>;
        overageStatus: z.ZodNullable<z.ZodEnum<{
            allowed: "allowed";
            warning: "warning";
            rejected: "rejected";
            unavailable: "unavailable";
        }>>;
        overageReason: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"provider/warning">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    category: z.ZodEnum<{
        deprecation: "deprecation";
        config: "config";
        general: "general";
    }>;
    summary: z.ZodOptional<z.ZodString>;
    details: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"provider/modelFallback">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    originalModel: z.ZodString;
    fallbackModel: z.ZodString;
    reason: z.ZodEnum<{
        refusal: "refusal";
        provider: "provider";
    }>;
    message: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"provider/unhandled">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    providerId: z.ZodString;
    rawType: z.ZodString;
    rawEvent: z.ZodObject<{
        jsonrpc: z.ZodLiteral<"2.0">;
        id: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>;
        method: z.ZodString;
        params: z.ZodOptional<z.ZodType<JsonValue, unknown, z.core.$ZodTypeInternals<JsonValue, unknown>>>;
    }, z.core.$strip>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
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
    type: z.ZodLiteral<"thread/started">;
    threadId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"thread/identity">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"turn/started">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"turn/completed">;
    threadId: z.ZodString;
    providerThreadId: z.ZodNullable<z.ZodString>;
    status: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
    }>;
    error: z.ZodOptional<z.ZodObject<{
        message: z.ZodString;
    }, z.core.$strip>>;
    providerCheckpointId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"turn/input/accepted">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    clientRequestId: z.ZodString;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"thread">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"turn">;
        turnId: z.ZodString;
    }, z.core.$strip>], "kind">;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"thread/name/updated">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    threadName: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"thread/compacted">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"thread/context/cleared">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"thread/goal/updated">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    objective: z.ZodString;
    status: z.ZodEnum<{
        paused: "paused";
        active: "active";
        budgetLimited: "budgetLimited";
        complete: "complete";
    }>;
    tokenBudget: z.ZodNullable<z.ZodNumber>;
    tokensUsed: z.ZodNumber;
    timeUsedSeconds: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"thread/goal/cleared">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/started">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    item: z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"userMessage">;
        id: z.ZodString;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            url: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"localImage">;
            path: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"localFile">;
            path: z.ZodString;
        }, z.core.$strip>], "type">>;
        clientRequestId: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"agentMessage">;
        id: z.ZodString;
        text: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"commandExecution">;
        id: z.ZodString;
        command: z.ZodString;
        cwd: z.ZodString;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        approvalStatus: z.ZodNullable<z.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        aggregatedOutput: z.ZodOptional<z.ZodString>;
        exitCode: z.ZodOptional<z.ZodNumber>;
        durationMs: z.ZodOptional<z.ZodNumber>;
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
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"fileChange">;
        id: z.ZodString;
        changes: z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            kind: z.ZodEnum<{
                add: "add";
                delete: "delete";
                update: "update";
            }>;
            movePath: z.ZodOptional<z.ZodString>;
            diff: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        approvalStatus: z.ZodNullable<z.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"webSearch">;
        id: z.ZodString;
        queries: z.ZodArray<z.ZodString>;
        resultText: z.ZodNullable<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"webFetch">;
        id: z.ZodString;
        url: z.ZodString;
        prompt: z.ZodNullable<z.ZodString>;
        pattern: z.ZodNullable<z.ZodString>;
        resultText: z.ZodNullable<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"imageView">;
        id: z.ZodString;
        path: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"toolCall">;
        id: z.ZodString;
        server: z.ZodOptional<z.ZodString>;
        tool: z.ZodString;
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        statusLabels: z.ZodOptional<z.ZodObject<{
            pending: z.ZodString;
            completed: z.ZodString;
        }, z.core.$strip>>;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        result: z.ZodOptional<z.ZodUnknown>;
        error: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
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
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"reasoning">;
        id: z.ZodString;
        summary: z.ZodArray<z.ZodString>;
        content: z.ZodArray<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"plan">;
        id: z.ZodString;
        text: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"contextCompaction">;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"backgroundTask">;
        id: z.ZodString;
        taskType: z.ZodString;
        description: z.ZodString;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        taskStatus: z.ZodEnum<{
            pending: "pending";
            running: "running";
            paused: "paused";
            completed: "completed";
            failed: "failed";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z.ZodBoolean;
        workflowName: z.ZodOptional<z.ZodString>;
        workflow: z.ZodOptional<z.ZodObject<{
            phases: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                title: z.ZodString;
                kind: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            agents: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                label: z.ZodString;
                state: z.ZodEnum<{
                    running: "running";
                    failed: "failed";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z.ZodString;
                attempt: z.ZodNumber;
                cached: z.ZodBoolean;
                lastProgressAt: z.ZodNumber;
                phaseIndex: z.ZodOptional<z.ZodNumber>;
                phaseTitle: z.ZodOptional<z.ZodString>;
                agentType: z.ZodOptional<z.ZodString>;
                isolation: z.ZodOptional<z.ZodString>;
                queuedAt: z.ZodOptional<z.ZodNumber>;
                startedAt: z.ZodOptional<z.ZodNumber>;
                lastToolName: z.ZodOptional<z.ZodString>;
                lastToolSummary: z.ZodOptional<z.ZodString>;
                promptPreview: z.ZodOptional<z.ZodString>;
                resultPreview: z.ZodOptional<z.ZodString>;
                error: z.ZodOptional<z.ZodString>;
                tokens: z.ZodOptional<z.ZodNumber>;
                toolCalls: z.ZodOptional<z.ZodNumber>;
                durationMs: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        usage: z.ZodOptional<z.ZodObject<{
            totalTokens: z.ZodNumber;
            toolUses: z.ZodNumber;
            durationMs: z.ZodNumber;
        }, z.core.$strip>>;
        summary: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodString>;
        outputFile: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "type">;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/completed">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    item: z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"userMessage">;
        id: z.ZodString;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            url: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"localImage">;
            path: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"localFile">;
            path: z.ZodString;
        }, z.core.$strip>], "type">>;
        clientRequestId: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"agentMessage">;
        id: z.ZodString;
        text: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"commandExecution">;
        id: z.ZodString;
        command: z.ZodString;
        cwd: z.ZodString;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        approvalStatus: z.ZodNullable<z.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        aggregatedOutput: z.ZodOptional<z.ZodString>;
        exitCode: z.ZodOptional<z.ZodNumber>;
        durationMs: z.ZodOptional<z.ZodNumber>;
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
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"fileChange">;
        id: z.ZodString;
        changes: z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            kind: z.ZodEnum<{
                add: "add";
                delete: "delete";
                update: "update";
            }>;
            movePath: z.ZodOptional<z.ZodString>;
            diff: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        approvalStatus: z.ZodNullable<z.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"webSearch">;
        id: z.ZodString;
        queries: z.ZodArray<z.ZodString>;
        resultText: z.ZodNullable<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"webFetch">;
        id: z.ZodString;
        url: z.ZodString;
        prompt: z.ZodNullable<z.ZodString>;
        pattern: z.ZodNullable<z.ZodString>;
        resultText: z.ZodNullable<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"imageView">;
        id: z.ZodString;
        path: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"toolCall">;
        id: z.ZodString;
        server: z.ZodOptional<z.ZodString>;
        tool: z.ZodString;
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        statusLabels: z.ZodOptional<z.ZodObject<{
            pending: z.ZodString;
            completed: z.ZodString;
        }, z.core.$strip>>;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        result: z.ZodOptional<z.ZodUnknown>;
        error: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
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
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"reasoning">;
        id: z.ZodString;
        summary: z.ZodArray<z.ZodString>;
        content: z.ZodArray<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"plan">;
        id: z.ZodString;
        text: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"contextCompaction">;
        id: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"backgroundTask">;
        id: z.ZodString;
        taskType: z.ZodString;
        description: z.ZodString;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        taskStatus: z.ZodEnum<{
            pending: "pending";
            running: "running";
            paused: "paused";
            completed: "completed";
            failed: "failed";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z.ZodBoolean;
        workflowName: z.ZodOptional<z.ZodString>;
        workflow: z.ZodOptional<z.ZodObject<{
            phases: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                title: z.ZodString;
                kind: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            agents: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                label: z.ZodString;
                state: z.ZodEnum<{
                    running: "running";
                    failed: "failed";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z.ZodString;
                attempt: z.ZodNumber;
                cached: z.ZodBoolean;
                lastProgressAt: z.ZodNumber;
                phaseIndex: z.ZodOptional<z.ZodNumber>;
                phaseTitle: z.ZodOptional<z.ZodString>;
                agentType: z.ZodOptional<z.ZodString>;
                isolation: z.ZodOptional<z.ZodString>;
                queuedAt: z.ZodOptional<z.ZodNumber>;
                startedAt: z.ZodOptional<z.ZodNumber>;
                lastToolName: z.ZodOptional<z.ZodString>;
                lastToolSummary: z.ZodOptional<z.ZodString>;
                promptPreview: z.ZodOptional<z.ZodString>;
                resultPreview: z.ZodOptional<z.ZodString>;
                error: z.ZodOptional<z.ZodString>;
                tokens: z.ZodOptional<z.ZodNumber>;
                toolCalls: z.ZodOptional<z.ZodNumber>;
                durationMs: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        usage: z.ZodOptional<z.ZodObject<{
            totalTokens: z.ZodNumber;
            toolUses: z.ZodNumber;
            durationMs: z.ZodNumber;
        }, z.core.$strip>>;
        summary: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodString>;
        outputFile: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "type">;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/agentMessage/delta">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    itemId: z.ZodString;
    delta: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/commandExecution/outputDelta">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    itemId: z.ZodString;
    delta: z.ZodString;
    reset: z.ZodOptional<z.ZodBoolean>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/fileChange/outputDelta">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    itemId: z.ZodString;
    delta: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/reasoning/summaryTextDelta">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    itemId: z.ZodString;
    delta: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/reasoning/textDelta">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    itemId: z.ZodString;
    delta: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/plan/delta">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    itemId: z.ZodString;
    delta: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/mcpToolCall/progress">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    itemId: z.ZodString;
    message: z.ZodOptional<z.ZodString>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/toolCall/progress">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    itemId: z.ZodString;
    message: z.ZodOptional<z.ZodString>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/backgroundTask/progress">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    item: z.ZodObject<{
        type: z.ZodLiteral<"backgroundTask">;
        id: z.ZodString;
        taskType: z.ZodString;
        description: z.ZodString;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        taskStatus: z.ZodEnum<{
            pending: "pending";
            running: "running";
            paused: "paused";
            completed: "completed";
            failed: "failed";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z.ZodBoolean;
        workflowName: z.ZodOptional<z.ZodString>;
        workflow: z.ZodOptional<z.ZodObject<{
            phases: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                title: z.ZodString;
                kind: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            agents: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                label: z.ZodString;
                state: z.ZodEnum<{
                    running: "running";
                    failed: "failed";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z.ZodString;
                attempt: z.ZodNumber;
                cached: z.ZodBoolean;
                lastProgressAt: z.ZodNumber;
                phaseIndex: z.ZodOptional<z.ZodNumber>;
                phaseTitle: z.ZodOptional<z.ZodString>;
                agentType: z.ZodOptional<z.ZodString>;
                isolation: z.ZodOptional<z.ZodString>;
                queuedAt: z.ZodOptional<z.ZodNumber>;
                startedAt: z.ZodOptional<z.ZodNumber>;
                lastToolName: z.ZodOptional<z.ZodString>;
                lastToolSummary: z.ZodOptional<z.ZodString>;
                promptPreview: z.ZodOptional<z.ZodString>;
                resultPreview: z.ZodOptional<z.ZodString>;
                error: z.ZodOptional<z.ZodString>;
                tokens: z.ZodOptional<z.ZodNumber>;
                toolCalls: z.ZodOptional<z.ZodNumber>;
                durationMs: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        usage: z.ZodOptional<z.ZodObject<{
            totalTokens: z.ZodNumber;
            toolUses: z.ZodNumber;
            durationMs: z.ZodNumber;
        }, z.core.$strip>>;
        summary: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodString>;
        outputFile: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"item/backgroundTask/completed">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    item: z.ZodObject<{
        type: z.ZodLiteral<"backgroundTask">;
        id: z.ZodString;
        taskType: z.ZodString;
        description: z.ZodString;
        status: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        taskStatus: z.ZodEnum<{
            pending: "pending";
            running: "running";
            paused: "paused";
            completed: "completed";
            failed: "failed";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z.ZodBoolean;
        workflowName: z.ZodOptional<z.ZodString>;
        workflow: z.ZodOptional<z.ZodObject<{
            phases: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                title: z.ZodString;
                kind: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            agents: z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                label: z.ZodString;
                state: z.ZodEnum<{
                    running: "running";
                    failed: "failed";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z.ZodString;
                attempt: z.ZodNumber;
                cached: z.ZodBoolean;
                lastProgressAt: z.ZodNumber;
                phaseIndex: z.ZodOptional<z.ZodNumber>;
                phaseTitle: z.ZodOptional<z.ZodString>;
                agentType: z.ZodOptional<z.ZodString>;
                isolation: z.ZodOptional<z.ZodString>;
                queuedAt: z.ZodOptional<z.ZodNumber>;
                startedAt: z.ZodOptional<z.ZodNumber>;
                lastToolName: z.ZodOptional<z.ZodString>;
                lastToolSummary: z.ZodOptional<z.ZodString>;
                promptPreview: z.ZodOptional<z.ZodString>;
                resultPreview: z.ZodOptional<z.ZodString>;
                error: z.ZodOptional<z.ZodString>;
                tokens: z.ZodOptional<z.ZodNumber>;
                toolCalls: z.ZodOptional<z.ZodNumber>;
                durationMs: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        usage: z.ZodOptional<z.ZodObject<{
            totalTokens: z.ZodNumber;
            toolUses: z.ZodNumber;
            durationMs: z.ZodNumber;
        }, z.core.$strip>>;
        summary: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodString>;
        outputFile: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"thread/tokenUsage/updated">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    tokenUsage: z.ZodObject<{
        total: z.ZodObject<{
            totalTokens: z.ZodNumber;
            inputTokens: z.ZodNumber;
            cachedInputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            reasoningOutputTokens: z.ZodNumber;
        }, z.core.$strip>;
        last: z.ZodObject<{
            totalTokens: z.ZodNumber;
            inputTokens: z.ZodNumber;
            cachedInputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            reasoningOutputTokens: z.ZodNumber;
        }, z.core.$strip>;
        modelContextWindow: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"thread/contextWindowUsage/updated">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    contextWindowUsage: z.ZodObject<{
        usedTokens: z.ZodNullable<z.ZodNumber>;
        modelContextWindow: z.ZodNullable<z.ZodNumber>;
        estimated: z.ZodBoolean;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"turn/plan/updated">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    plan: z.ZodArray<z.ZodObject<{
        step: z.ZodString;
        status: z.ZodOptional<z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            active: "active";
        }>>;
    }, z.core.$strip>>;
    explanation: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"turn/diff/updated">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    diff: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"provider/error">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    message: z.ZodString;
    detail: z.ZodOptional<z.ZodString>;
    willRetry: z.ZodOptional<z.ZodBoolean>;
    errorInfo: z.ZodOptional<z.ZodObject<{
        category: z.ZodEnum<{
            unknown: "unknown";
            "active-turn-not-steerable": "active-turn-not-steerable";
            "bad-request": "bad-request";
            "connection-failed": "connection-failed";
            "context-window-exceeded": "context-window-exceeded";
            billing: "billing";
            "budget-exceeded": "budget-exceeded";
            internal: "internal";
            "max-output-tokens": "max-output-tokens";
            "max-turns": "max-turns";
            overloaded: "overloaded";
            policy: "policy";
            "rate-limit": "rate-limit";
            sandbox: "sandbox";
            "stream-disconnected": "stream-disconnected";
            "structured-output-retries": "structured-output-retries";
            "thread-rollback-failed": "thread-rollback-failed";
            "too-many-failed-attempts": "too-many-failed-attempts";
            unauthorized: "unauthorized";
        }>;
        providerCode: z.ZodNullable<z.ZodString>;
        httpStatusCode: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"provider/rateLimits/updated">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    rateLimits: z.ZodObject<{
        providerId: z.ZodString;
        status: z.ZodEnum<{
            unknown: "unknown";
            allowed: "allowed";
            warning: "warning";
            blocked: "blocked";
        }>;
        kind: z.ZodEnum<{
            unknown: "unknown";
            "subscription-window": "subscription-window";
            credits: "credits";
            "spend-control": "spend-control";
        }>;
        windows: z.ZodArray<z.ZodObject<{
            providerKey: z.ZodNullable<z.ZodString>;
            label: z.ZodNullable<z.ZodString>;
            status: z.ZodEnum<{
                unknown: "unknown";
                allowed: "allowed";
                warning: "warning";
                blocked: "blocked";
            }>;
            resetsAtMs: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        reachedReason: z.ZodNullable<z.ZodString>;
        overageStatus: z.ZodNullable<z.ZodEnum<{
            allowed: "allowed";
            warning: "warning";
            rejected: "rejected";
            unavailable: "unavailable";
        }>>;
        overageReason: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"provider/warning">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    category: z.ZodEnum<{
        deprecation: "deprecation";
        config: "config";
        general: "general";
    }>;
    summary: z.ZodOptional<z.ZodString>;
    details: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"provider/modelFallback">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    originalModel: z.ZodString;
    fallbackModel: z.ZodString;
    reason: z.ZodEnum<{
        refusal: "refusal";
        provider: "provider";
    }>;
    message: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"provider/unhandled">;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    providerId: z.ZodString;
    rawType: z.ZodString;
    rawEvent: z.ZodObject<{
        jsonrpc: z.ZodLiteral<"2.0">;
        id: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>;
        method: z.ZodString;
        params: z.ZodOptional<z.ZodType<JsonValue, unknown, z.core.$ZodTypeInternals<JsonValue, unknown>>>;
    }, z.core.$strip>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>], "type">, z.ZodObject<{
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"thread">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"turn">;
        turnId: z.ZodString;
    }, z.core.$strip>], "kind">;
}, z.core.$strip>>, z.ZodIntersection<z.ZodUnion<readonly [z.ZodObject<{
    type: z.ZodLiteral<"client/thread/start">;
    threadId: z.ZodString;
    direction: z.ZodLiteral<"outbound">;
    source: z.ZodEnum<{
        spawn: "spawn";
        tell: "tell";
    }>;
    initiator: z.ZodEnum<{
        user: "user";
        system: "system";
        agent: "agent";
    }>;
    request: z.ZodObject<{
        method: z.ZodEnum<{
            "thread/start": "thread/start";
            "turn/start": "turn/start";
        }>;
        params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"client/turn/requested">;
    threadId: z.ZodString;
    direction: z.ZodLiteral<"outbound">;
    requestId: z.ZodString;
    continuationOfRequestId: z.ZodOptional<z.ZodString>;
    source: z.ZodEnum<{
        spawn: "spawn";
        tell: "tell";
    }>;
    initiator: z.ZodEnum<{
        user: "user";
        system: "system";
        agent: "agent";
    }>;
    senderThreadId: z.ZodNullable<z.ZodString>;
    systemMessageKind: z.ZodOptional<z.ZodEnum<{
        "ownership-assigned": "ownership-assigned";
        "ownership-removed": "ownership-removed";
        "child-needs-attention": "child-needs-attention";
        "child-completed": "child-completed";
        "child-failed": "child-failed";
        "child-interrupted": "child-interrupted";
        "child-outcome-batch": "child-outcome-batch";
        unlabeled: "unlabeled";
    }>>;
    systemMessageSubject: z.ZodOptional<z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"thread">;
        threadId: z.ZodString;
        threadName: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"thread-batch">;
        count: z.ZodNumber;
    }, z.core.$strip>], "kind">>>;
    input: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        mentions: z.ZodDefault<z.ZodArray<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
            resource: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"thread">;
                threadId: z.ZodString;
                projectId: z.ZodOptional<z.ZodString>;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"project">;
                projectId: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"section">;
                sectionId: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"path">;
                source: z.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"command">;
                trigger: z.ZodEnum<{
                    "/": "/";
                }>;
                name: z.ZodString;
                source: z.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z.ZodString;
                argumentHint: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"plugin">;
                pluginId: z.ZodString;
                icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                itemId: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>], "kind">>;
        }, z.core.$strip>>>;
    }, z.core.$strip>, z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"image">;
        url: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"localImage">;
        path: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"localFile">;
        path: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        sizeBytes: z.ZodOptional<z.ZodNumber>;
        mimeType: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "type">>;
    inputGroups: z.ZodOptional<z.ZodArray<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        mentions: z.ZodDefault<z.ZodArray<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
            resource: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"thread">;
                threadId: z.ZodString;
                projectId: z.ZodOptional<z.ZodString>;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"project">;
                projectId: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"section">;
                sectionId: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"path">;
                source: z.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"command">;
                trigger: z.ZodEnum<{
                    "/": "/";
                }>;
                name: z.ZodString;
                source: z.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z.ZodString;
                argumentHint: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"plugin">;
                pluginId: z.ZodString;
                icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                itemId: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>], "kind">>;
        }, z.core.$strip>>>;
    }, z.core.$strip>, z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"image">;
        url: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"localImage">;
        path: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"localFile">;
        path: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        sizeBytes: z.ZodOptional<z.ZodNumber>;
        mimeType: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "type">>>>;
    target: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"thread-start">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"new-turn">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"auto">;
        expectedTurnId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"steer">;
        expectedTurnId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>], "kind">;
    request: z.ZodObject<{
        method: z.ZodEnum<{
            "thread/start": "thread/start";
            "turn/start": "turn/start";
        }>;
        params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, z.core.$strip>;
    execution: z.ZodObject<{
        seq: z.ZodOptional<z.ZodNumber>;
        model: z.ZodString;
        serviceTier: z.ZodEnum<{
            default: "default";
            fast: "fast";
        }>;
        reasoningLevel: z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>;
        source: z.ZodEnum<{
            "client/thread/start": "client/thread/start";
            "client/turn/requested": "client/turn/requested";
            "client/turn/start": "client/turn/start";
        }>;
        permissionMode: z.ZodEnum<{
            readonly: "readonly";
            full: "full";
            auto: "auto";
            "accept-edits": "accept-edits";
            "workspace-write": "workspace-write";
        }>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"client/turn/rejected">;
    threadId: z.ZodString;
    requestId: z.ZodString;
    reason: z.ZodString;
    message: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"client/turn/start">;
    threadId: z.ZodString;
    direction: z.ZodLiteral<"outbound">;
    source: z.ZodEnum<{
        spawn: "spawn";
        tell: "tell";
    }>;
    initiator: z.ZodEnum<{
        user: "user";
        system: "system";
        agent: "agent";
    }>;
    request: z.ZodObject<{
        method: z.ZodEnum<{
            "thread/start": "thread/start";
            "turn/start": "turn/start";
        }>;
        params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"system/error">;
    threadId: z.ZodString;
    code: z.ZodOptional<z.ZodString>;
    message: z.ZodString;
    detail: z.ZodOptional<z.ZodString>;
    reconnectAttempt: z.ZodOptional<z.ZodNumber>;
    reconnectTotal: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"system/manager/user_message">;
    threadId: z.ZodString;
    text: z.ZodString;
    toolCallId: z.ZodOptional<z.ZodString>;
    turnId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"system/thread/interrupted">;
    threadId: z.ZodString;
    reason: z.ZodEnum<{
        "manual-stop": "manual-stop";
        "host-daemon-restarted": "host-daemon-restarted";
        "provider-turn-idle": "provider-turn-idle";
    }>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"system/operation">;
    threadId: z.ZodString;
    operation: z.ZodString;
    status: z.ZodString;
    message: z.ZodString;
    operationId: z.ZodString;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<JsonValue, unknown, z.core.$ZodTypeInternals<JsonValue, unknown>>>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"system/permissionGrant/lifecycle">;
    threadId: z.ZodString;
    interactionId: z.ZodString;
    providerId: z.ZodString;
    providerRequestId: z.ZodString;
    status: z.ZodEnum<{
        pending: "pending";
        interrupted: "interrupted";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    resolution: z.ZodDefault<z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
        decision: z.ZodLiteral<"allow_once">;
        grantedPermissions: z.ZodNullable<z.ZodObject<{
            network: z.ZodNullable<z.ZodObject<{
                enabled: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>>;
            fileSystem: z.ZodNullable<z.ZodObject<{
                read: z.ZodArray<z.ZodString>;
                write: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strict>>;
    }, z.core.$strip>, z.ZodObject<{
        decision: z.ZodLiteral<"allow_for_session">;
        grantedPermissions: z.ZodNullable<z.ZodObject<{
            network: z.ZodNullable<z.ZodObject<{
                enabled: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>>;
            fileSystem: z.ZodNullable<z.ZodObject<{
                read: z.ZodArray<z.ZodString>;
                write: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strict>>;
    }, z.core.$strip>, z.ZodObject<{
        decision: z.ZodLiteral<"deny">;
    }, z.core.$strip>], "decision">>>;
    statusReason: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    subject: z.ZodObject<{
        kind: z.ZodLiteral<"permission_grant">;
        itemId: z.ZodString;
        toolName: z.ZodNullable<z.ZodString>;
        permissions: z.ZodObject<{
            network: z.ZodNullable<z.ZodObject<{
                enabled: z.ZodNullable<z.ZodBoolean>;
            }, z.core.$strip>>;
            fileSystem: z.ZodNullable<z.ZodObject<{
                read: z.ZodArray<z.ZodString>;
                write: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strict>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"system/userQuestion/lifecycle">;
    threadId: z.ZodString;
    interactionId: z.ZodString;
    providerId: z.ZodString;
    providerRequestId: z.ZodString;
    status: z.ZodEnum<{
        pending: "pending";
        interrupted: "interrupted";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    resolution: z.ZodDefault<z.ZodNullable<z.ZodObject<{
        kind: z.ZodLiteral<"user_answer">;
        answers: z.ZodRecord<z.ZodString, z.ZodObject<{
            selected: z.ZodArray<z.ZodString>;
            freeText: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>>;
    statusReason: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    payload: z.ZodObject<{
        kind: z.ZodLiteral<"user_question">;
        questions: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            prompt: z.ZodString;
            shortLabel: z.ZodOptional<z.ZodString>;
            multiSelect: z.ZodBoolean;
            options: z.ZodOptional<z.ZodArray<z.ZodObject<{
                value: z.ZodString;
                label: z.ZodString;
                description: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>>;
            allowFreeText: z.ZodBoolean;
        }, z.core.$strip>>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"system/thread-provisioning">;
    threadId: z.ZodString;
    provisioningId: z.ZodString;
    status: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        active: "active";
        cancelled: "cancelled";
    }>;
    environmentId: z.ZodString;
    entries: z.ZodArray<z.ZodObject<{
        type: z.ZodEnum<{
            output: "output";
            step: "step";
        }>;
        key: z.ZodString;
        text: z.ZodString;
        startedAt: z.ZodOptional<z.ZodNumber>;
        status: z.ZodOptional<z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            started: "started";
        }>>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"system/provider-turn-watchdog">;
    threadId: z.ZodString;
    reason: z.ZodLiteral<"provider-turn-idle">;
    thresholdMs: z.ZodNumber;
    elapsedMs: z.ZodNumber;
    activeTurnId: z.ZodString;
    activeTurnStartedAt: z.ZodNumber;
    lastActivityEventSequence: z.ZodNumber;
    lastActivityEventType: z.ZodString;
    lastActivityEventAt: z.ZodNumber;
    providerId: z.ZodString;
    providerThreadId: z.ZodNullable<z.ZodString>;
    firedAt: z.ZodNumber;
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
    reasoningEffort: z.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>;
    description: z.ZodString;
}, z.core.$strip>;
type ModelReasoningEffort = z.infer<typeof modelReasoningEffortSchema>;
declare const availableModelSchema: z.ZodObject<{
    id: z.ZodString;
    model: z.ZodString;
    displayName: z.ZodString;
    routeProviderId: z.ZodOptional<z.ZodString>;
    description: z.ZodString;
    supportedReasoningEfforts: z.ZodArray<z.ZodObject<{
        reasoningEffort: z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>;
        description: z.ZodString;
    }, z.core.$strip>>;
    defaultReasoningEffort: z.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>;
    isDefault: z.ZodBoolean;
}, z.core.$strip>;
type AvailableModel = z.infer<typeof availableModelSchema>;
declare const dynamicToolSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    inputSchema: z.ZodUnknown;
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
declare function cloneReasoningEfforts(efforts: readonly ModelReasoningEffort[]): ModelReasoningEffort[];

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
interface DrainAcceptedUserMessagesArgs<TState extends AcceptedUserMessageState> {
    events: ThreadEvent[];
    providerThreadId: string;
    state: TState;
    threadId: string;
    turnId: string;
}
declare function buildAcceptedUserMessageEvent(args: BuildAcceptedUserMessageEventArgs): ThreadEvent[];
declare function queueAcceptedUserMessage<TState extends AcceptedUserMessageState>(args: QueueAcceptedUserMessageArgs<TState>): void;
declare function drainAcceptedUserMessages<TState extends AcceptedUserMessageState>(args: DrainAcceptedUserMessagesArgs<TState>): void;

/**
 * Shared adapter utilities.
 *
 * Functions and constants duplicated across the claude-code, pi, and codex
 * adapters are extracted here so each adapter imports from one place.
 */

interface NormalizeProviderCommandOutputArgs {
    emptyPlaceholders: readonly string[];
    text: string;
}
interface DiffCumulativeTextArgs {
    nextText: string;
    previousText?: string;
}
interface DiffCumulativeTextResult {
    delta: string;
    nextText: string;
    reset: boolean;
}
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
/**
 * The same overrides expressed as a codex/pi-style `shell_environment_policy`
 * config bag, for providers whose session construction takes config keys
 * rather than an environment map.
 */
declare function buildShellEnvironmentPolicyConfig(envVars?: Record<string, string>): Record<string, string> | undefined;
declare function extractEnvOverrides(config: Record<string, unknown> | undefined): Record<string, string>;
declare function toNonNegativeNumber(value: unknown): number;
declare function normalizeProviderCommandOutput(args: NormalizeProviderCommandOutputArgs): string | undefined;
declare function diffCumulativeText(args: DiffCumulativeTextArgs): DiffCumulativeTextResult | null;
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
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    method: z.ZodString;
    params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
declare const jsonRpcSuccessResponseSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    result: z.ZodUnknown;
}, z.core.$strip>;
declare const jsonRpcErrorResponseSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    error: z.ZodObject<{
        code: z.ZodNumber;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$strip>;
}, z.core.$strip>;
type BridgeJsonRpcResponse = z.infer<typeof jsonRpcSuccessResponseSchema> | z.infer<typeof jsonRpcErrorResponseSchema>;
declare function decodeBridgeJsonRpcResponse(input: unknown): BridgeJsonRpcResponse | null;
declare function decodeToolCallResponsePayload(result: unknown): {
    content: string;
    isError: boolean;
};

type ToolCallResult = {
    content: string;
    isError?: boolean;
};
interface PendingBridgeToolCall {
    resolve: (value: ToolCallResult) => void;
}
interface RegisteredBridgeSession {
    closing: boolean;
    pendingToolCalls: Map<string | number, PendingBridgeToolCall>;
}
interface CloseThreadSessionArgs {
    graceful?: boolean;
    message: string;
    threadId: string;
}
interface BridgeSessionRegistryOptions<TSession extends RegisteredBridgeSession, TCloseResult> {
    closeSessionGracefully: (session: TSession) => Promise<TCloseResult>;
    getProviderThreadId: (session: TSession, threadId: string) => string;
    nextToolCallRequestId?: () => number;
    resolveAdditionalPendingWork?: (session: TSession, message: string) => void;
    sendToolCall: (request: BridgeToolCallRequest) => void;
    stopSession?: (session: TSession) => Promise<TCloseResult> | TCloseResult;
}
type BridgeToolCallForwarder = (toolName: string, args: Record<string, unknown>) => Promise<ToolCallResult>;
declare function createBridgeSessionRegistry<TSession extends RegisteredBridgeSession, TCloseResult = void>(options: BridgeSessionRegistryOptions<TSession, TCloseResult>): {
    closeThreadSession: (args: CloseThreadSessionArgs) => Promise<TCloseResult | undefined>;
    closeThreadSessionsGracefully: (message: string) => Promise<void>;
    createForwardToolCall: (getThreadId: () => string) => BridgeToolCallForwarder;
    handleToolCallResponse: (response: BridgeJsonRpcResponse) => boolean;
    resolvePendingSessionWork: (session: TSession, message: string) => void;
    resolvePendingToolCalls: (session: TSession, message: string) => void;
    sessions: Map<string, TSession>;
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
        threadId: z.ZodOptional<z.ZodString>;
        parent_tool_use_id: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>;
}, z.core.$loose>;
declare const threadIdentityEnvelopeSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    method: z.ZodLiteral<"thread/identity">;
    params: z.ZodObject<{
        threadId: z.ZodOptional<z.ZodString>;
        providerThreadId: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>;
}, z.core.$loose>;
declare const threadContextWindowUsageEnvelopeSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    method: z.ZodLiteral<"thread/contextWindowUsage/updated">;
    params: z.ZodObject<{
        threadId: z.ZodOptional<z.ZodString>;
        contextWindowUsage: z.ZodObject<{
            usedTokens: z.ZodNullable<z.ZodNumber>;
            modelContextWindow: z.ZodNullable<z.ZodNumber>;
            estimated: z.ZodBoolean;
        }, z.core.$strip>;
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

declare const pendingInteractionRequestedPermissionProfileInputSchema: z.ZodPipe<z.ZodObject<{
    network: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodOptional<z.ZodPipe<z.ZodObject<{
        enabled: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodOptional<z.ZodBoolean>>;
    }, z.core.$strip>, z.ZodTransform<{
        enabled: boolean | null;
    }, {
        enabled?: boolean | undefined;
    }>>>>;
    fileSystem: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodOptional<z.ZodPipe<z.ZodObject<{
        read: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodOptional<z.ZodArray<z.ZodString>>>;
        write: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodOptional<z.ZodArray<z.ZodString>>>;
    }, z.core.$strip>, z.ZodTransform<{
        read: string[];
        write: string[];
    }, {
        read?: string[] | undefined;
        write?: string[] | undefined;
    }>>>>;
    macos: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodOptional<z.ZodPipe<z.ZodObject<{
        preferences: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodOptional<z.ZodEnum<{
            none: "none";
            read_only: "read_only";
            read_write: "read_write";
        }>>>;
        automations: z.ZodOptional<z.ZodPipe<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"none">, z.ZodLiteral<"all">, z.ZodPipe<z.ZodObject<{
            bundleIds: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodOptional<z.ZodArray<z.ZodString>>>;
        }, z.core.$strip>, z.ZodTransform<{
            kind: "bundle_ids";
            bundleIds: string[];
        }, {
            bundleIds?: string[] | undefined;
        }>>]>>>, z.ZodTransform<"none" | "all" | {
            kind: "bundle_ids";
            bundleIds: string[];
        }, "none" | "all" | {
            kind: "bundle_ids";
            bundleIds: string[];
        } | undefined>>>;
        launchServices: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodOptional<z.ZodBoolean>>;
        accessibility: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodOptional<z.ZodBoolean>>;
        calendar: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodOptional<z.ZodBoolean>>;
        reminders: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodOptional<z.ZodBoolean>>;
        contacts: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodOptional<z.ZodEnum<{
            none: "none";
            read_only: "read_only";
            read_write: "read_write";
        }>>>;
    }, z.core.$strip>, z.ZodTransform<{
        preferences: "none" | "read_only" | "read_write";
        automations: "none" | "all" | {
            kind: "bundle_ids";
            bundleIds: string[];
        };
        launchServices: boolean;
        accessibility: boolean;
        calendar: boolean;
        reminders: boolean;
        contacts: "none" | "read_only" | "read_write";
    }, {
        preferences?: "none" | "read_only" | "read_write" | undefined;
        automations?: "none" | "all" | {
            kind: "bundle_ids";
            bundleIds: string[];
        } | undefined;
        launchServices?: boolean | undefined;
        accessibility?: boolean | undefined;
        calendar?: boolean | undefined;
        reminders?: boolean | undefined;
        contacts?: "none" | "read_only" | "read_write" | undefined;
    }>>>>;
}, z.core.$strip>, z.ZodTransform<{
    network: {
        enabled: boolean | null;
    } | null;
    fileSystem: {
        read: string[];
        write: string[];
    } | null;
    macos: {
        preferences: "none" | "read_only" | "read_write";
        automations: "none" | "all" | {
            kind: "bundle_ids";
            bundleIds: string[];
        };
        launchServices: boolean;
        accessibility: boolean;
        calendar: boolean;
        reminders: boolean;
        contacts: "none" | "read_only" | "read_write";
    } | null;
}, {
    network?: {
        enabled: boolean | null;
    } | undefined;
    fileSystem?: {
        read: string[];
        write: string[];
    } | undefined;
    macos?: {
        preferences: "none" | "read_only" | "read_write";
        automations: "none" | "all" | {
            kind: "bundle_ids";
            bundleIds: string[];
        };
        launchServices: boolean;
        accessibility: boolean;
        calendar: boolean;
        reminders: boolean;
        contacts: "none" | "read_only" | "read_write";
    } | undefined;
}>>;
type PendingInteractionRequestedPermissionProfileInput = z.input<typeof pendingInteractionRequestedPermissionProfileInputSchema>;
declare function normalizePendingInteractionRequestedPermissionProfile(input: PendingInteractionRequestedPermissionProfileInput): PendingInteractionRequestedPermissionProfile;

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
    openReasoningItemIdsByScope: Map<string, string>;
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

type ProviderRawEventCoverage = "normalized" | "noise" | "unknown";
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
declare function getMessageContentTypes(message: StringRecord): string[];

interface CounterScopedItemIdState {
    openReasoningItemIdsByScope: Map<string, string>;
    reasoningItemCounter: number;
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
    type: z.ZodLiteral<"text">;
    text: z.ZodString;
}, z.core.$strip>;

interface ToolUseTranslationInput {
    args: unknown;
    callId: string;
    parentToolCallId?: string;
    toolName: string;
}
interface ParsedCommandToolArguments {
    command: string;
    cwd: string;
}
interface ParsedFileChangeToolArguments {
    arguments: Record<string, unknown>;
    newText?: string;
    oldText?: string;
    path?: string;
}
interface BuildToolUseItemOptions {
    commandToolNames: ReadonlySet<string>;
    fileChangeToolNames: ReadonlySet<string>;
    parseCommand: (args: unknown) => ParsedCommandToolArguments | null;
    parseFileChange: (args: unknown) => ParsedFileChangeToolArguments | null;
    translateSpecialToolUse?: (input: ToolUseTranslationInput) => ThreadEventItem | null;
}
declare function buildToolUseItem(input: ToolUseTranslationInput, options: BuildToolUseItemOptions): ThreadEventItem;
interface CompleteStartedToolItemArgs {
    callId: string;
    commandOutputText?: string;
    exitCode?: number;
    outputText?: string;
    parentToolCallId?: string;
    preserveUndefinedToolCallFields?: boolean;
    startedItem: ThreadEventItem;
    status: ThreadEventItemStatus;
    toolCallResult?: unknown;
}
declare function completeStartedToolItem(args: CompleteStartedToolItemArgs): ThreadEventItem | null;
declare function buildToolResultItem(args: {
    callId: string;
    commandOutputText?: string;
    commandToolNames: ReadonlySet<string>;
    completeWebItems?: boolean;
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
    protocolVersion: z.ZodNumber;
    client: z.ZodObject<{
        name: z.ZodString;
        version: z.ZodString;
    }, z.core.$strip>;
}, z.core.$loose>;
/** Bridge → runtime `initialize` result. */
declare const initializeResultSchema: z.ZodObject<{
    protocolVersion: z.ZodNumber;
    capabilities: z.ZodPipe<z.ZodTransform<{}, unknown>, z.ZodObject<{
        sessionRestore: z.ZodDefault<z.ZodBoolean>;
        threadArchive: z.ZodDefault<z.ZodBoolean>;
        threadRename: z.ZodDefault<z.ZodBoolean>;
        threadGoalClear: z.ZodDefault<z.ZodBoolean>;
        fork: z.ZodDefault<z.ZodEnum<{
            none: "none";
            tip: "tip";
            checkpoint: "checkpoint";
        }>>;
        approvalEnforcedBy: z.ZodDefault<z.ZodEnum<{
            runtime: "runtime";
            provider: "provider";
        }>>;
    }, z.core.$loose>>;
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
    model: z.ZodOptional<z.ZodString>;
    serviceTier: z.ZodOptional<z.ZodEnum<{
        fast: "fast";
        default: "default";
    }>>;
    reasoningLevel: z.ZodOptional<z.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>>;
    instructions: z.ZodOptional<z.ZodString>;
    envVars: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>, z.ZodDiscriminatedUnion<[z.ZodObject<{
    permissionMode: z.ZodLiteral<"accept-edits">;
    permissionScope: z.ZodLiteral<"workspace">;
    approvalReviewer: z.ZodLiteral<"user">;
    permissionEscalation: z.ZodEnum<{
        ask: "ask";
        deny: "deny";
    }>;
}, z.core.$strip>, z.ZodObject<{
    permissionMode: z.ZodLiteral<"auto">;
    permissionScope: z.ZodLiteral<"workspace">;
    approvalReviewer: z.ZodLiteral<"automatic">;
    permissionEscalation: z.ZodEnum<{
        ask: "ask";
        deny: "deny";
    }>;
}, z.core.$strip>, z.ZodObject<{
    permissionMode: z.ZodLiteral<"full">;
    permissionScope: z.ZodLiteral<"full">;
    approvalReviewer: z.ZodNull;
    permissionEscalation: z.ZodNull;
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
    input: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        mentions: z.ZodDefault<z.ZodArray<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
            resource: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"thread">;
                threadId: z.ZodString;
                projectId: z.ZodOptional<z.ZodString>;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"project">;
                projectId: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"section">;
                sectionId: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"path">;
                source: z.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"command">;
                trigger: z.ZodEnum<{
                    "/": "/";
                }>;
                name: z.ZodString;
                source: z.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z.ZodString;
                argumentHint: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"plugin">;
                pluginId: z.ZodString;
                icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                itemId: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>], "kind">>;
        }, z.core.$strip>>>;
    }, z.core.$strip>, z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"image">;
        url: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"localImage">;
        path: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"localFile">;
        path: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        sizeBytes: z.ZodOptional<z.ZodNumber>;
        mimeType: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "type">>>;
    threadId: z.ZodString;
    cwd: z.ZodString;
    options: z.ZodIntersection<z.ZodObject<{
        model: z.ZodOptional<z.ZodString>;
        serviceTier: z.ZodOptional<z.ZodEnum<{
            fast: "fast";
            default: "default";
        }>>;
        reasoningLevel: z.ZodOptional<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>>;
        instructions: z.ZodOptional<z.ZodString>;
        envVars: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>, z.ZodDiscriminatedUnion<[z.ZodObject<{
        permissionMode: z.ZodLiteral<"accept-edits">;
        permissionScope: z.ZodLiteral<"workspace">;
        approvalReviewer: z.ZodLiteral<"user">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
    }, z.core.$strip>, z.ZodObject<{
        permissionMode: z.ZodLiteral<"auto">;
        permissionScope: z.ZodLiteral<"workspace">;
        approvalReviewer: z.ZodLiteral<"automatic">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
    }, z.core.$strip>, z.ZodObject<{
        permissionMode: z.ZodLiteral<"full">;
        permissionScope: z.ZodLiteral<"full">;
        approvalReviewer: z.ZodNull;
        permissionEscalation: z.ZodNull;
    }, z.core.$strip>], "permissionMode">>;
    dynamicTools: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
        inputSchema: z.ZodUnknown;
    }, z.core.$strip>>>;
    disallowedTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    instructionMode: z.ZodEnum<{
        append: "append";
        replace: "replace";
    }>;
}, z.core.$loose>;
declare const threadResumeParamsSchema: z.ZodObject<{
    providerThreadId: z.ZodString;
    threadId: z.ZodString;
    cwd: z.ZodString;
    options: z.ZodIntersection<z.ZodObject<{
        model: z.ZodOptional<z.ZodString>;
        serviceTier: z.ZodOptional<z.ZodEnum<{
            fast: "fast";
            default: "default";
        }>>;
        reasoningLevel: z.ZodOptional<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>>;
        instructions: z.ZodOptional<z.ZodString>;
        envVars: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>, z.ZodDiscriminatedUnion<[z.ZodObject<{
        permissionMode: z.ZodLiteral<"accept-edits">;
        permissionScope: z.ZodLiteral<"workspace">;
        approvalReviewer: z.ZodLiteral<"user">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
    }, z.core.$strip>, z.ZodObject<{
        permissionMode: z.ZodLiteral<"auto">;
        permissionScope: z.ZodLiteral<"workspace">;
        approvalReviewer: z.ZodLiteral<"automatic">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
    }, z.core.$strip>, z.ZodObject<{
        permissionMode: z.ZodLiteral<"full">;
        permissionScope: z.ZodLiteral<"full">;
        approvalReviewer: z.ZodNull;
        permissionEscalation: z.ZodNull;
    }, z.core.$strip>], "permissionMode">>;
    dynamicTools: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
        inputSchema: z.ZodUnknown;
    }, z.core.$strip>>>;
    disallowedTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    instructionMode: z.ZodEnum<{
        append: "append";
        replace: "replace";
    }>;
}, z.core.$loose>;
declare const threadForkParamsSchema: z.ZodObject<{
    sourceProviderThreadId: z.ZodString;
    sourceProviderCheckpointId: z.ZodOptional<z.ZodString>;
    threadId: z.ZodString;
    cwd: z.ZodString;
    options: z.ZodIntersection<z.ZodObject<{
        model: z.ZodOptional<z.ZodString>;
        serviceTier: z.ZodOptional<z.ZodEnum<{
            fast: "fast";
            default: "default";
        }>>;
        reasoningLevel: z.ZodOptional<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>>;
        instructions: z.ZodOptional<z.ZodString>;
        envVars: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>, z.ZodDiscriminatedUnion<[z.ZodObject<{
        permissionMode: z.ZodLiteral<"accept-edits">;
        permissionScope: z.ZodLiteral<"workspace">;
        approvalReviewer: z.ZodLiteral<"user">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
    }, z.core.$strip>, z.ZodObject<{
        permissionMode: z.ZodLiteral<"auto">;
        permissionScope: z.ZodLiteral<"workspace">;
        approvalReviewer: z.ZodLiteral<"automatic">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
    }, z.core.$strip>, z.ZodObject<{
        permissionMode: z.ZodLiteral<"full">;
        permissionScope: z.ZodLiteral<"full">;
        approvalReviewer: z.ZodNull;
        permissionEscalation: z.ZodNull;
    }, z.core.$strip>], "permissionMode">>;
    dynamicTools: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
        inputSchema: z.ZodUnknown;
    }, z.core.$strip>>>;
    disallowedTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    instructionMode: z.ZodEnum<{
        append: "append";
        replace: "replace";
    }>;
}, z.core.$loose>;
declare const threadStopParamsSchema: z.ZodObject<{
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    intent: z.ZodEnum<{
        interrupt: "interrupt";
        release: "release";
    }>;
    activeTurnId: z.ZodNullable<z.ZodString>;
}, z.core.$loose>;
declare const threadDiscardParamsSchema: z.ZodObject<{
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
}, z.core.$loose>;
declare const threadArchiveParamsSchema: z.ZodObject<{
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
}, z.core.$loose>;
declare const threadUnarchiveParamsSchema: z.ZodObject<{
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
}, z.core.$loose>;
declare const threadGoalClearParamsSchema: z.ZodObject<{
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
}, z.core.$loose>;
declare const threadNameSetParamsSchema: z.ZodObject<{
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    title: z.ZodString;
}, z.core.$loose>;
declare const turnStartParamsSchema: z.ZodObject<{
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    input: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        mentions: z.ZodDefault<z.ZodArray<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
            resource: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"thread">;
                threadId: z.ZodString;
                projectId: z.ZodOptional<z.ZodString>;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"project">;
                projectId: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"section">;
                sectionId: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"path">;
                source: z.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"command">;
                trigger: z.ZodEnum<{
                    "/": "/";
                }>;
                name: z.ZodString;
                source: z.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z.ZodString;
                argumentHint: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"plugin">;
                pluginId: z.ZodString;
                icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                itemId: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>], "kind">>;
        }, z.core.$strip>>>;
    }, z.core.$strip>, z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"image">;
        url: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"localImage">;
        path: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"localFile">;
        path: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        sizeBytes: z.ZodOptional<z.ZodNumber>;
        mimeType: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "type">>;
    clientRequestId: z.ZodString;
    options: z.ZodIntersection<z.ZodObject<{
        model: z.ZodOptional<z.ZodString>;
        serviceTier: z.ZodOptional<z.ZodEnum<{
            fast: "fast";
            default: "default";
        }>>;
        reasoningLevel: z.ZodOptional<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>>;
        instructions: z.ZodOptional<z.ZodString>;
        envVars: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>, z.ZodDiscriminatedUnion<[z.ZodObject<{
        permissionMode: z.ZodLiteral<"accept-edits">;
        permissionScope: z.ZodLiteral<"workspace">;
        approvalReviewer: z.ZodLiteral<"user">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
    }, z.core.$strip>, z.ZodObject<{
        permissionMode: z.ZodLiteral<"auto">;
        permissionScope: z.ZodLiteral<"workspace">;
        approvalReviewer: z.ZodLiteral<"automatic">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
    }, z.core.$strip>, z.ZodObject<{
        permissionMode: z.ZodLiteral<"full">;
        permissionScope: z.ZodLiteral<"full">;
        approvalReviewer: z.ZodNull;
        permissionEscalation: z.ZodNull;
    }, z.core.$strip>], "permissionMode">>;
}, z.core.$loose>;
declare const turnSteerParamsSchema: z.ZodObject<{
    expectedTurnId: z.ZodString;
    threadId: z.ZodString;
    providerThreadId: z.ZodString;
    input: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        mentions: z.ZodDefault<z.ZodArray<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
            resource: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"thread">;
                threadId: z.ZodString;
                projectId: z.ZodOptional<z.ZodString>;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"project">;
                projectId: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"section">;
                sectionId: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"path">;
                source: z.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"command">;
                trigger: z.ZodEnum<{
                    "/": "/";
                }>;
                name: z.ZodString;
                source: z.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z.ZodString;
                argumentHint: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"plugin">;
                pluginId: z.ZodString;
                icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                itemId: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>], "kind">>;
        }, z.core.$strip>>>;
    }, z.core.$strip>, z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"image">;
        url: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"localImage">;
        path: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        visibility: z.ZodOptional<z.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z.ZodLiteral<"localFile">;
        path: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        sizeBytes: z.ZodOptional<z.ZodNumber>;
        mimeType: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "type">>;
    clientRequestId: z.ZodString;
    options: z.ZodIntersection<z.ZodObject<{
        model: z.ZodOptional<z.ZodString>;
        serviceTier: z.ZodOptional<z.ZodEnum<{
            fast: "fast";
            default: "default";
        }>>;
        reasoningLevel: z.ZodOptional<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>>;
        instructions: z.ZodOptional<z.ZodString>;
        envVars: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>, z.ZodDiscriminatedUnion<[z.ZodObject<{
        permissionMode: z.ZodLiteral<"accept-edits">;
        permissionScope: z.ZodLiteral<"workspace">;
        approvalReviewer: z.ZodLiteral<"user">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
    }, z.core.$strip>, z.ZodObject<{
        permissionMode: z.ZodLiteral<"auto">;
        permissionScope: z.ZodLiteral<"workspace">;
        approvalReviewer: z.ZodLiteral<"automatic">;
        permissionEscalation: z.ZodEnum<{
            ask: "ask";
            deny: "deny";
        }>;
    }, z.core.$strip>, z.ZodObject<{
        permissionMode: z.ZodLiteral<"full">;
        permissionScope: z.ZodLiteral<"full">;
        approvalReviewer: z.ZodNull;
        permissionEscalation: z.ZodNull;
    }, z.core.$strip>], "permissionMode">>;
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
            name: z.ZodString;
            description: z.ZodString;
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
    threadId: z.ZodString;
    event: z.ZodPipe<z.ZodUnknown, z.ZodUnion<readonly [z.ZodIntersection<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"thread/started">;
        threadId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"thread/identity">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"turn/started">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"turn/completed">;
        threadId: z.ZodString;
        providerThreadId: z.ZodNullable<z.ZodString>;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        error: z.ZodOptional<z.ZodObject<{
            message: z.ZodString;
        }, z.core.$strip>>;
        providerCheckpointId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"turn/input/accepted">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        clientRequestId: z.ZodString;
        scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"thread">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"turn">;
            turnId: z.ZodString;
        }, z.core.$strip>], "kind">;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"thread/name/updated">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        threadName: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"thread/compacted">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"thread/context/cleared">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"thread/goal/updated">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        objective: z.ZodString;
        status: z.ZodEnum<{
            active: "active";
            paused: "paused";
            budgetLimited: "budgetLimited";
            complete: "complete";
        }>;
        tokenBudget: z.ZodNullable<z.ZodNumber>;
        tokensUsed: z.ZodNumber;
        timeUsedSeconds: z.ZodNumber;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"thread/goal/cleared">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"item/started">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        item: z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"userMessage">;
            id: z.ZodString;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                url: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                type: z.ZodLiteral<"localImage">;
                path: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                type: z.ZodLiteral<"localFile">;
                path: z.ZodString;
            }, z.core.$strip>], "type">>;
            clientRequestId: z.ZodOptional<z.ZodString>;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"agentMessage">;
            id: z.ZodString;
            text: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"commandExecution">;
            id: z.ZodString;
            command: z.ZodString;
            cwd: z.ZodString;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            approvalStatus: z.ZodNullable<z.ZodEnum<{
                waiting_for_approval: "waiting_for_approval";
                denied: "denied";
            }>>;
            aggregatedOutput: z.ZodOptional<z.ZodString>;
            exitCode: z.ZodOptional<z.ZodNumber>;
            durationMs: z.ZodOptional<z.ZodNumber>;
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
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"fileChange">;
            id: z.ZodString;
            changes: z.ZodArray<z.ZodObject<{
                path: z.ZodString;
                kind: z.ZodEnum<{
                    add: "add";
                    delete: "delete";
                    update: "update";
                }>;
                movePath: z.ZodOptional<z.ZodString>;
                diff: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            approvalStatus: z.ZodNullable<z.ZodEnum<{
                waiting_for_approval: "waiting_for_approval";
                denied: "denied";
            }>>;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"webSearch">;
            id: z.ZodString;
            queries: z.ZodArray<z.ZodString>;
            resultText: z.ZodNullable<z.ZodString>;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"webFetch">;
            id: z.ZodString;
            url: z.ZodString;
            prompt: z.ZodNullable<z.ZodString>;
            pattern: z.ZodNullable<z.ZodString>;
            resultText: z.ZodNullable<z.ZodString>;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"imageView">;
            id: z.ZodString;
            path: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"toolCall">;
            id: z.ZodString;
            server: z.ZodOptional<z.ZodString>;
            tool: z.ZodString;
            arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            statusLabels: z.ZodOptional<z.ZodObject<{
                pending: z.ZodString;
                completed: z.ZodString;
            }, z.core.$strip>>;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            result: z.ZodOptional<z.ZodUnknown>;
            error: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
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
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"reasoning">;
            id: z.ZodString;
            summary: z.ZodArray<z.ZodString>;
            content: z.ZodArray<z.ZodString>;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"plan">;
            id: z.ZodString;
            text: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"contextCompaction">;
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"backgroundTask">;
            id: z.ZodString;
            taskType: z.ZodString;
            description: z.ZodString;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            taskStatus: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                paused: "paused";
                pending: "pending";
                running: "running";
                killed: "killed";
                stopped: "stopped";
            }>;
            skipTranscript: z.ZodBoolean;
            workflowName: z.ZodOptional<z.ZodString>;
            workflow: z.ZodOptional<z.ZodObject<{
                phases: z.ZodArray<z.ZodObject<{
                    index: z.ZodNumber;
                    title: z.ZodString;
                    kind: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>;
                agents: z.ZodArray<z.ZodObject<{
                    index: z.ZodNumber;
                    label: z.ZodString;
                    state: z.ZodEnum<{
                        failed: "failed";
                        running: "running";
                        queued: "queued";
                        done: "done";
                        skipped: "skipped";
                    }>;
                    model: z.ZodString;
                    attempt: z.ZodNumber;
                    cached: z.ZodBoolean;
                    lastProgressAt: z.ZodNumber;
                    phaseIndex: z.ZodOptional<z.ZodNumber>;
                    phaseTitle: z.ZodOptional<z.ZodString>;
                    agentType: z.ZodOptional<z.ZodString>;
                    isolation: z.ZodOptional<z.ZodString>;
                    queuedAt: z.ZodOptional<z.ZodNumber>;
                    startedAt: z.ZodOptional<z.ZodNumber>;
                    lastToolName: z.ZodOptional<z.ZodString>;
                    lastToolSummary: z.ZodOptional<z.ZodString>;
                    promptPreview: z.ZodOptional<z.ZodString>;
                    resultPreview: z.ZodOptional<z.ZodString>;
                    error: z.ZodOptional<z.ZodString>;
                    tokens: z.ZodOptional<z.ZodNumber>;
                    toolCalls: z.ZodOptional<z.ZodNumber>;
                    durationMs: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            usage: z.ZodOptional<z.ZodObject<{
                totalTokens: z.ZodNumber;
                toolUses: z.ZodNumber;
                durationMs: z.ZodNumber;
            }, z.core.$strip>>;
            summary: z.ZodOptional<z.ZodString>;
            error: z.ZodOptional<z.ZodString>;
            outputFile: z.ZodOptional<z.ZodString>;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>], "type">;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"item/completed">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        item: z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"userMessage">;
            id: z.ZodString;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                url: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                type: z.ZodLiteral<"localImage">;
                path: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                type: z.ZodLiteral<"localFile">;
                path: z.ZodString;
            }, z.core.$strip>], "type">>;
            clientRequestId: z.ZodOptional<z.ZodString>;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"agentMessage">;
            id: z.ZodString;
            text: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"commandExecution">;
            id: z.ZodString;
            command: z.ZodString;
            cwd: z.ZodString;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            approvalStatus: z.ZodNullable<z.ZodEnum<{
                waiting_for_approval: "waiting_for_approval";
                denied: "denied";
            }>>;
            aggregatedOutput: z.ZodOptional<z.ZodString>;
            exitCode: z.ZodOptional<z.ZodNumber>;
            durationMs: z.ZodOptional<z.ZodNumber>;
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
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"fileChange">;
            id: z.ZodString;
            changes: z.ZodArray<z.ZodObject<{
                path: z.ZodString;
                kind: z.ZodEnum<{
                    add: "add";
                    delete: "delete";
                    update: "update";
                }>;
                movePath: z.ZodOptional<z.ZodString>;
                diff: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            approvalStatus: z.ZodNullable<z.ZodEnum<{
                waiting_for_approval: "waiting_for_approval";
                denied: "denied";
            }>>;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"webSearch">;
            id: z.ZodString;
            queries: z.ZodArray<z.ZodString>;
            resultText: z.ZodNullable<z.ZodString>;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"webFetch">;
            id: z.ZodString;
            url: z.ZodString;
            prompt: z.ZodNullable<z.ZodString>;
            pattern: z.ZodNullable<z.ZodString>;
            resultText: z.ZodNullable<z.ZodString>;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"imageView">;
            id: z.ZodString;
            path: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"toolCall">;
            id: z.ZodString;
            server: z.ZodOptional<z.ZodString>;
            tool: z.ZodString;
            arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            statusLabels: z.ZodOptional<z.ZodObject<{
                pending: z.ZodString;
                completed: z.ZodString;
            }, z.core.$strip>>;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            result: z.ZodOptional<z.ZodUnknown>;
            error: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
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
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"reasoning">;
            id: z.ZodString;
            summary: z.ZodArray<z.ZodString>;
            content: z.ZodArray<z.ZodString>;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"plan">;
            id: z.ZodString;
            text: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"contextCompaction">;
            id: z.ZodString;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"backgroundTask">;
            id: z.ZodString;
            taskType: z.ZodString;
            description: z.ZodString;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            taskStatus: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                paused: "paused";
                pending: "pending";
                running: "running";
                killed: "killed";
                stopped: "stopped";
            }>;
            skipTranscript: z.ZodBoolean;
            workflowName: z.ZodOptional<z.ZodString>;
            workflow: z.ZodOptional<z.ZodObject<{
                phases: z.ZodArray<z.ZodObject<{
                    index: z.ZodNumber;
                    title: z.ZodString;
                    kind: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>;
                agents: z.ZodArray<z.ZodObject<{
                    index: z.ZodNumber;
                    label: z.ZodString;
                    state: z.ZodEnum<{
                        failed: "failed";
                        running: "running";
                        queued: "queued";
                        done: "done";
                        skipped: "skipped";
                    }>;
                    model: z.ZodString;
                    attempt: z.ZodNumber;
                    cached: z.ZodBoolean;
                    lastProgressAt: z.ZodNumber;
                    phaseIndex: z.ZodOptional<z.ZodNumber>;
                    phaseTitle: z.ZodOptional<z.ZodString>;
                    agentType: z.ZodOptional<z.ZodString>;
                    isolation: z.ZodOptional<z.ZodString>;
                    queuedAt: z.ZodOptional<z.ZodNumber>;
                    startedAt: z.ZodOptional<z.ZodNumber>;
                    lastToolName: z.ZodOptional<z.ZodString>;
                    lastToolSummary: z.ZodOptional<z.ZodString>;
                    promptPreview: z.ZodOptional<z.ZodString>;
                    resultPreview: z.ZodOptional<z.ZodString>;
                    error: z.ZodOptional<z.ZodString>;
                    tokens: z.ZodOptional<z.ZodNumber>;
                    toolCalls: z.ZodOptional<z.ZodNumber>;
                    durationMs: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            usage: z.ZodOptional<z.ZodObject<{
                totalTokens: z.ZodNumber;
                toolUses: z.ZodNumber;
                durationMs: z.ZodNumber;
            }, z.core.$strip>>;
            summary: z.ZodOptional<z.ZodString>;
            error: z.ZodOptional<z.ZodString>;
            outputFile: z.ZodOptional<z.ZodString>;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>], "type">;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"item/agentMessage/delta">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        itemId: z.ZodString;
        delta: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"item/commandExecution/outputDelta">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        itemId: z.ZodString;
        delta: z.ZodString;
        reset: z.ZodOptional<z.ZodBoolean>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"item/fileChange/outputDelta">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        itemId: z.ZodString;
        delta: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"item/reasoning/summaryTextDelta">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        itemId: z.ZodString;
        delta: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"item/reasoning/textDelta">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        itemId: z.ZodString;
        delta: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"item/plan/delta">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        itemId: z.ZodString;
        delta: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"item/mcpToolCall/progress">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        itemId: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"item/toolCall/progress">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        itemId: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"item/backgroundTask/progress">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        item: z.ZodObject<{
            type: z.ZodLiteral<"backgroundTask">;
            id: z.ZodString;
            taskType: z.ZodString;
            description: z.ZodString;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            taskStatus: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                paused: "paused";
                pending: "pending";
                running: "running";
                killed: "killed";
                stopped: "stopped";
            }>;
            skipTranscript: z.ZodBoolean;
            workflowName: z.ZodOptional<z.ZodString>;
            workflow: z.ZodOptional<z.ZodObject<{
                phases: z.ZodArray<z.ZodObject<{
                    index: z.ZodNumber;
                    title: z.ZodString;
                    kind: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>;
                agents: z.ZodArray<z.ZodObject<{
                    index: z.ZodNumber;
                    label: z.ZodString;
                    state: z.ZodEnum<{
                        failed: "failed";
                        running: "running";
                        queued: "queued";
                        done: "done";
                        skipped: "skipped";
                    }>;
                    model: z.ZodString;
                    attempt: z.ZodNumber;
                    cached: z.ZodBoolean;
                    lastProgressAt: z.ZodNumber;
                    phaseIndex: z.ZodOptional<z.ZodNumber>;
                    phaseTitle: z.ZodOptional<z.ZodString>;
                    agentType: z.ZodOptional<z.ZodString>;
                    isolation: z.ZodOptional<z.ZodString>;
                    queuedAt: z.ZodOptional<z.ZodNumber>;
                    startedAt: z.ZodOptional<z.ZodNumber>;
                    lastToolName: z.ZodOptional<z.ZodString>;
                    lastToolSummary: z.ZodOptional<z.ZodString>;
                    promptPreview: z.ZodOptional<z.ZodString>;
                    resultPreview: z.ZodOptional<z.ZodString>;
                    error: z.ZodOptional<z.ZodString>;
                    tokens: z.ZodOptional<z.ZodNumber>;
                    toolCalls: z.ZodOptional<z.ZodNumber>;
                    durationMs: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            usage: z.ZodOptional<z.ZodObject<{
                totalTokens: z.ZodNumber;
                toolUses: z.ZodNumber;
                durationMs: z.ZodNumber;
            }, z.core.$strip>>;
            summary: z.ZodOptional<z.ZodString>;
            error: z.ZodOptional<z.ZodString>;
            outputFile: z.ZodOptional<z.ZodString>;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"item/backgroundTask/completed">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        item: z.ZodObject<{
            type: z.ZodLiteral<"backgroundTask">;
            id: z.ZodString;
            taskType: z.ZodString;
            description: z.ZodString;
            status: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                interrupted: "interrupted";
                pending: "pending";
            }>;
            taskStatus: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                paused: "paused";
                pending: "pending";
                running: "running";
                killed: "killed";
                stopped: "stopped";
            }>;
            skipTranscript: z.ZodBoolean;
            workflowName: z.ZodOptional<z.ZodString>;
            workflow: z.ZodOptional<z.ZodObject<{
                phases: z.ZodArray<z.ZodObject<{
                    index: z.ZodNumber;
                    title: z.ZodString;
                    kind: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>;
                agents: z.ZodArray<z.ZodObject<{
                    index: z.ZodNumber;
                    label: z.ZodString;
                    state: z.ZodEnum<{
                        failed: "failed";
                        running: "running";
                        queued: "queued";
                        done: "done";
                        skipped: "skipped";
                    }>;
                    model: z.ZodString;
                    attempt: z.ZodNumber;
                    cached: z.ZodBoolean;
                    lastProgressAt: z.ZodNumber;
                    phaseIndex: z.ZodOptional<z.ZodNumber>;
                    phaseTitle: z.ZodOptional<z.ZodString>;
                    agentType: z.ZodOptional<z.ZodString>;
                    isolation: z.ZodOptional<z.ZodString>;
                    queuedAt: z.ZodOptional<z.ZodNumber>;
                    startedAt: z.ZodOptional<z.ZodNumber>;
                    lastToolName: z.ZodOptional<z.ZodString>;
                    lastToolSummary: z.ZodOptional<z.ZodString>;
                    promptPreview: z.ZodOptional<z.ZodString>;
                    resultPreview: z.ZodOptional<z.ZodString>;
                    error: z.ZodOptional<z.ZodString>;
                    tokens: z.ZodOptional<z.ZodNumber>;
                    toolCalls: z.ZodOptional<z.ZodNumber>;
                    durationMs: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            usage: z.ZodOptional<z.ZodObject<{
                totalTokens: z.ZodNumber;
                toolUses: z.ZodNumber;
                durationMs: z.ZodNumber;
            }, z.core.$strip>>;
            summary: z.ZodOptional<z.ZodString>;
            error: z.ZodOptional<z.ZodString>;
            outputFile: z.ZodOptional<z.ZodString>;
            parentToolCallId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"thread/tokenUsage/updated">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        tokenUsage: z.ZodObject<{
            total: z.ZodObject<{
                totalTokens: z.ZodNumber;
                inputTokens: z.ZodNumber;
                cachedInputTokens: z.ZodNumber;
                outputTokens: z.ZodNumber;
                reasoningOutputTokens: z.ZodNumber;
            }, z.core.$strip>;
            last: z.ZodObject<{
                totalTokens: z.ZodNumber;
                inputTokens: z.ZodNumber;
                cachedInputTokens: z.ZodNumber;
                outputTokens: z.ZodNumber;
                reasoningOutputTokens: z.ZodNumber;
            }, z.core.$strip>;
            modelContextWindow: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"thread/contextWindowUsage/updated">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        contextWindowUsage: z.ZodObject<{
            usedTokens: z.ZodNullable<z.ZodNumber>;
            modelContextWindow: z.ZodNullable<z.ZodNumber>;
            estimated: z.ZodBoolean;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"turn/plan/updated">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        plan: z.ZodArray<z.ZodObject<{
            step: z.ZodString;
            status: z.ZodOptional<z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                active: "active";
                pending: "pending";
            }>>;
        }, z.core.$strip>>;
        explanation: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"turn/diff/updated">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        diff: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"provider/error">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        message: z.ZodString;
        detail: z.ZodOptional<z.ZodString>;
        willRetry: z.ZodOptional<z.ZodBoolean>;
        errorInfo: z.ZodOptional<z.ZodObject<{
            category: z.ZodEnum<{
                unknown: "unknown";
                "active-turn-not-steerable": "active-turn-not-steerable";
                "bad-request": "bad-request";
                "connection-failed": "connection-failed";
                "context-window-exceeded": "context-window-exceeded";
                billing: "billing";
                "budget-exceeded": "budget-exceeded";
                internal: "internal";
                "max-output-tokens": "max-output-tokens";
                "max-turns": "max-turns";
                overloaded: "overloaded";
                policy: "policy";
                "rate-limit": "rate-limit";
                sandbox: "sandbox";
                "stream-disconnected": "stream-disconnected";
                "structured-output-retries": "structured-output-retries";
                "thread-rollback-failed": "thread-rollback-failed";
                "too-many-failed-attempts": "too-many-failed-attempts";
                unauthorized: "unauthorized";
            }>;
            providerCode: z.ZodNullable<z.ZodString>;
            httpStatusCode: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"provider/rateLimits/updated">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        rateLimits: z.ZodObject<{
            providerId: z.ZodString;
            status: z.ZodEnum<{
                unknown: "unknown";
                allowed: "allowed";
                warning: "warning";
                blocked: "blocked";
            }>;
            kind: z.ZodEnum<{
                unknown: "unknown";
                "subscription-window": "subscription-window";
                credits: "credits";
                "spend-control": "spend-control";
            }>;
            windows: z.ZodArray<z.ZodObject<{
                providerKey: z.ZodNullable<z.ZodString>;
                label: z.ZodNullable<z.ZodString>;
                status: z.ZodEnum<{
                    unknown: "unknown";
                    allowed: "allowed";
                    warning: "warning";
                    blocked: "blocked";
                }>;
                resetsAtMs: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
            reachedReason: z.ZodNullable<z.ZodString>;
            overageStatus: z.ZodNullable<z.ZodEnum<{
                allowed: "allowed";
                warning: "warning";
                rejected: "rejected";
                unavailable: "unavailable";
            }>>;
            overageReason: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"provider/warning">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        category: z.ZodEnum<{
            deprecation: "deprecation";
            config: "config";
            general: "general";
        }>;
        summary: z.ZodOptional<z.ZodString>;
        details: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"provider/modelFallback">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        originalModel: z.ZodString;
        fallbackModel: z.ZodString;
        reason: z.ZodEnum<{
            provider: "provider";
            refusal: "refusal";
        }>;
        message: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"provider/unhandled">;
        threadId: z.ZodString;
        providerThreadId: z.ZodString;
        providerId: z.ZodString;
        rawType: z.ZodString;
        rawEvent: z.ZodObject<{
            jsonrpc: z.ZodLiteral<"2.0">;
            id: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>;
            method: z.ZodString;
            params: z.ZodOptional<z.ZodType<JsonValue, unknown, z.core.$ZodTypeInternals<JsonValue, unknown>>>;
        }, z.core.$strip>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "type">, z.ZodObject<{
        scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"thread">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"turn">;
            turnId: z.ZodString;
        }, z.core.$strip>], "kind">;
    }, z.core.$strip>>, z.ZodIntersection<z.ZodUnion<readonly [z.ZodObject<{
        type: z.ZodLiteral<"client/thread/start">;
        threadId: z.ZodString;
        direction: z.ZodLiteral<"outbound">;
        source: z.ZodEnum<{
            spawn: "spawn";
            tell: "tell";
        }>;
        initiator: z.ZodEnum<{
            user: "user";
            agent: "agent";
            system: "system";
        }>;
        request: z.ZodObject<{
            method: z.ZodEnum<{
                "thread/start": "thread/start";
                "turn/start": "turn/start";
            }>;
            params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"client/turn/requested">;
        threadId: z.ZodString;
        direction: z.ZodLiteral<"outbound">;
        requestId: z.ZodString;
        continuationOfRequestId: z.ZodOptional<z.ZodString>;
        source: z.ZodEnum<{
            spawn: "spawn";
            tell: "tell";
        }>;
        initiator: z.ZodEnum<{
            user: "user";
            agent: "agent";
            system: "system";
        }>;
        senderThreadId: z.ZodNullable<z.ZodString>;
        systemMessageKind: z.ZodOptional<z.ZodEnum<{
            "ownership-assigned": "ownership-assigned";
            "ownership-removed": "ownership-removed";
            "child-needs-attention": "child-needs-attention";
            "child-completed": "child-completed";
            "child-failed": "child-failed";
            "child-interrupted": "child-interrupted";
            "child-outcome-batch": "child-outcome-batch";
            unlabeled: "unlabeled";
        }>>;
        systemMessageSubject: z.ZodOptional<z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"thread">;
            threadId: z.ZodString;
            threadName: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"thread-batch">;
            count: z.ZodNumber;
        }, z.core.$strip>], "kind">>>;
        input: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            visibility: z.ZodOptional<z.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            mentions: z.ZodDefault<z.ZodArray<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
                resource: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"thread">;
                    threadId: z.ZodString;
                    projectId: z.ZodOptional<z.ZodString>;
                    label: z.ZodString;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"project">;
                    projectId: z.ZodString;
                    label: z.ZodString;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"section">;
                    sectionId: z.ZodString;
                    label: z.ZodString;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"path">;
                    source: z.ZodEnum<{
                        workspace: "workspace";
                        "thread-storage": "thread-storage";
                    }>;
                    entryKind: z.ZodEnum<{
                        file: "file";
                        directory: "directory";
                    }>;
                    path: z.ZodString;
                    label: z.ZodString;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"command">;
                    trigger: z.ZodEnum<{
                        "/": "/";
                    }>;
                    name: z.ZodString;
                    source: z.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    origin: z.ZodEnum<{
                        user: "user";
                        project: "project";
                        builtin: "builtin";
                    }>;
                    label: z.ZodString;
                    argumentHint: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"plugin">;
                    pluginId: z.ZodString;
                    icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    itemId: z.ZodString;
                    label: z.ZodString;
                }, z.core.$strip>], "kind">>;
            }, z.core.$strip>>>;
        }, z.core.$strip>, z.ZodObject<{
            visibility: z.ZodOptional<z.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z.ZodLiteral<"image">;
            url: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            visibility: z.ZodOptional<z.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z.ZodLiteral<"localImage">;
            path: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            visibility: z.ZodOptional<z.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z.ZodLiteral<"localFile">;
            path: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            sizeBytes: z.ZodOptional<z.ZodNumber>;
            mimeType: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>], "type">>;
        inputGroups: z.ZodOptional<z.ZodArray<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            visibility: z.ZodOptional<z.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            mentions: z.ZodDefault<z.ZodArray<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
                resource: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"thread">;
                    threadId: z.ZodString;
                    projectId: z.ZodOptional<z.ZodString>;
                    label: z.ZodString;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"project">;
                    projectId: z.ZodString;
                    label: z.ZodString;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"section">;
                    sectionId: z.ZodString;
                    label: z.ZodString;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"path">;
                    source: z.ZodEnum<{
                        workspace: "workspace";
                        "thread-storage": "thread-storage";
                    }>;
                    entryKind: z.ZodEnum<{
                        file: "file";
                        directory: "directory";
                    }>;
                    path: z.ZodString;
                    label: z.ZodString;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"command">;
                    trigger: z.ZodEnum<{
                        "/": "/";
                    }>;
                    name: z.ZodString;
                    source: z.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    origin: z.ZodEnum<{
                        user: "user";
                        project: "project";
                        builtin: "builtin";
                    }>;
                    label: z.ZodString;
                    argumentHint: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>, z.ZodObject<{
                    kind: z.ZodLiteral<"plugin">;
                    pluginId: z.ZodString;
                    icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    itemId: z.ZodString;
                    label: z.ZodString;
                }, z.core.$strip>], "kind">>;
            }, z.core.$strip>>>;
        }, z.core.$strip>, z.ZodObject<{
            visibility: z.ZodOptional<z.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z.ZodLiteral<"image">;
            url: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            visibility: z.ZodOptional<z.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z.ZodLiteral<"localImage">;
            path: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            visibility: z.ZodOptional<z.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z.ZodLiteral<"localFile">;
            path: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            sizeBytes: z.ZodOptional<z.ZodNumber>;
            mimeType: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>], "type">>>>;
        target: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"thread-start">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"new-turn">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"auto">;
            expectedTurnId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"steer">;
            expectedTurnId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>], "kind">;
        request: z.ZodObject<{
            method: z.ZodEnum<{
                "thread/start": "thread/start";
                "turn/start": "turn/start";
            }>;
            params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, z.core.$strip>;
        execution: z.ZodObject<{
            seq: z.ZodOptional<z.ZodNumber>;
            model: z.ZodString;
            serviceTier: z.ZodEnum<{
                fast: "fast";
                default: "default";
            }>;
            reasoningLevel: z.ZodEnum<{
                none: "none";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
                ultracode: "ultracode";
                max: "max";
                ultra: "ultra";
            }>;
            source: z.ZodEnum<{
                "client/thread/start": "client/thread/start";
                "client/turn/requested": "client/turn/requested";
                "client/turn/start": "client/turn/start";
            }>;
            permissionMode: z.ZodEnum<{
                readonly: "readonly";
                "accept-edits": "accept-edits";
                auto: "auto";
                full: "full";
                "workspace-write": "workspace-write";
            }>;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"client/turn/rejected">;
        threadId: z.ZodString;
        requestId: z.ZodString;
        reason: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"client/turn/start">;
        threadId: z.ZodString;
        direction: z.ZodLiteral<"outbound">;
        source: z.ZodEnum<{
            spawn: "spawn";
            tell: "tell";
        }>;
        initiator: z.ZodEnum<{
            user: "user";
            agent: "agent";
            system: "system";
        }>;
        request: z.ZodObject<{
            method: z.ZodEnum<{
                "thread/start": "thread/start";
                "turn/start": "turn/start";
            }>;
            params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"system/error">;
        threadId: z.ZodString;
        code: z.ZodOptional<z.ZodString>;
        message: z.ZodString;
        detail: z.ZodOptional<z.ZodString>;
        reconnectAttempt: z.ZodOptional<z.ZodNumber>;
        reconnectTotal: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"system/manager/user_message">;
        threadId: z.ZodString;
        text: z.ZodString;
        toolCallId: z.ZodOptional<z.ZodString>;
        turnId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"system/thread/interrupted">;
        threadId: z.ZodString;
        reason: z.ZodEnum<{
            "manual-stop": "manual-stop";
            "host-daemon-restarted": "host-daemon-restarted";
            "provider-turn-idle": "provider-turn-idle";
        }>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"system/operation">;
        threadId: z.ZodString;
        operation: z.ZodString;
        status: z.ZodString;
        message: z.ZodString;
        operationId: z.ZodString;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<JsonValue, unknown, z.core.$ZodTypeInternals<JsonValue, unknown>>>>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"system/permissionGrant/lifecycle">;
        threadId: z.ZodString;
        interactionId: z.ZodString;
        providerId: z.ZodString;
        providerRequestId: z.ZodString;
        status: z.ZodEnum<{
            interrupted: "interrupted";
            pending: "pending";
            resolving: "resolving";
            resolved: "resolved";
        }>;
        resolution: z.ZodDefault<z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
            decision: z.ZodLiteral<"allow_once">;
            grantedPermissions: z.ZodNullable<z.ZodObject<{
                network: z.ZodNullable<z.ZodObject<{
                    enabled: z.ZodNullable<z.ZodBoolean>;
                }, z.core.$strip>>;
                fileSystem: z.ZodNullable<z.ZodObject<{
                    read: z.ZodArray<z.ZodString>;
                    write: z.ZodArray<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strict>>;
        }, z.core.$strip>, z.ZodObject<{
            decision: z.ZodLiteral<"allow_for_session">;
            grantedPermissions: z.ZodNullable<z.ZodObject<{
                network: z.ZodNullable<z.ZodObject<{
                    enabled: z.ZodNullable<z.ZodBoolean>;
                }, z.core.$strip>>;
                fileSystem: z.ZodNullable<z.ZodObject<{
                    read: z.ZodArray<z.ZodString>;
                    write: z.ZodArray<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strict>>;
        }, z.core.$strip>, z.ZodObject<{
            decision: z.ZodLiteral<"deny">;
        }, z.core.$strip>], "decision">>>;
        statusReason: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        subject: z.ZodObject<{
            kind: z.ZodLiteral<"permission_grant">;
            itemId: z.ZodString;
            toolName: z.ZodNullable<z.ZodString>;
            permissions: z.ZodObject<{
                network: z.ZodNullable<z.ZodObject<{
                    enabled: z.ZodNullable<z.ZodBoolean>;
                }, z.core.$strip>>;
                fileSystem: z.ZodNullable<z.ZodObject<{
                    read: z.ZodArray<z.ZodString>;
                    write: z.ZodArray<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strict>;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"system/userQuestion/lifecycle">;
        threadId: z.ZodString;
        interactionId: z.ZodString;
        providerId: z.ZodString;
        providerRequestId: z.ZodString;
        status: z.ZodEnum<{
            interrupted: "interrupted";
            pending: "pending";
            resolving: "resolving";
            resolved: "resolved";
        }>;
        resolution: z.ZodDefault<z.ZodNullable<z.ZodObject<{
            kind: z.ZodLiteral<"user_answer">;
            answers: z.ZodRecord<z.ZodString, z.ZodObject<{
                selected: z.ZodArray<z.ZodString>;
                freeText: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>>;
        statusReason: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        payload: z.ZodObject<{
            kind: z.ZodLiteral<"user_question">;
            questions: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                prompt: z.ZodString;
                shortLabel: z.ZodOptional<z.ZodString>;
                multiSelect: z.ZodBoolean;
                options: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    value: z.ZodString;
                    label: z.ZodString;
                    description: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
                allowFreeText: z.ZodBoolean;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"system/thread-provisioning">;
        threadId: z.ZodString;
        provisioningId: z.ZodString;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            active: "active";
            cancelled: "cancelled";
        }>;
        environmentId: z.ZodString;
        entries: z.ZodArray<z.ZodObject<{
            type: z.ZodEnum<{
                output: "output";
                step: "step";
            }>;
            key: z.ZodString;
            text: z.ZodString;
            startedAt: z.ZodOptional<z.ZodNumber>;
            status: z.ZodOptional<z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                started: "started";
            }>>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        }, z.core.$strip>>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"system/provider-turn-watchdog">;
        threadId: z.ZodString;
        reason: z.ZodLiteral<"provider-turn-idle">;
        thresholdMs: z.ZodNumber;
        elapsedMs: z.ZodNumber;
        activeTurnId: z.ZodString;
        activeTurnStartedAt: z.ZodNumber;
        lastActivityEventSequence: z.ZodNumber;
        lastActivityEventType: z.ZodString;
        lastActivityEventAt: z.ZodNumber;
        providerId: z.ZodString;
        providerThreadId: z.ZodNullable<z.ZodString>;
        firedAt: z.ZodNumber;
    }, z.core.$strip>]>, z.ZodObject<{
        scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"thread">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"turn">;
            turnId: z.ZodString;
        }, z.core.$strip>], "kind">;
    }, z.core.$strip>>]>>;
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
    displayName: z.ZodString;
    command: z.ZodString;
    args: z.ZodArray<z.ZodString>;
    env: z.ZodRecord<z.ZodString, z.ZodString>;
    cwd: z.ZodOptional<z.ZodString>;
    modelCli: z.ZodOptional<z.ZodPipe<z.ZodObject<{
        listArgs: z.ZodArray<z.ZodString>;
        selectFlag: z.ZodOptional<z.ZodString>;
        primaryModels: z.ZodArray<z.ZodString>;
    }, z.core.$strict>, z.ZodTransform<{
        listArgs: string[];
        primaryModels: string[];
        selectFlag?: string | undefined;
    } | undefined, {
        listArgs: string[];
        primaryModels: string[];
        selectFlag?: string | undefined;
    }>>>;
    reasoningCli: z.ZodOptional<z.ZodObject<{
        flag: z.ZodString;
        supportedLevels: z.ZodArray<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>>;
        levelValues: z.ZodOptional<z.ZodRecord<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }> & z.core.$partial, z.ZodString>>;
        defaultLevel: z.ZodOptional<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>>;
    }, z.core.$strict>>;
    nativeReasoning: z.ZodOptional<z.ZodObject<{
        configId: z.ZodString;
        supportedLevels: z.ZodArray<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>>;
        levelValues: z.ZodOptional<z.ZodRecord<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }> & z.core.$partial, z.ZodString>>;
        defaultLevel: z.ZodOptional<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>>;
    }, z.core.$strict>>;
    nativeSkillRoots: z.ZodOptional<z.ZodObject<{
        user: z.ZodDefault<z.ZodArray<z.ZodString>>;
        project: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
    permissionCli: z.ZodOptional<z.ZodObject<{
        full: z.ZodOptional<z.ZodArray<z.ZodString>>;
        workspaceWrite: z.ZodOptional<z.ZodArray<z.ZodString>>;
        readonly: z.ZodOptional<z.ZodArray<z.ZodString>>;
        insertAfterArgs: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
type HostDaemonAcpLaunchSpec = z.infer<typeof hostDaemonAcpLaunchSpecSchema>;
declare function normalizeHostDaemonAcpLaunchSpec(spec: HostDaemonAcpLaunchSpec): HostDaemonAcpLaunchSpec;

export { BRIDGE_INBOUND_REQUEST_METHODS, BRIDGE_JSON_RPC_ERRORS, BRIDGE_NOTIFICATION_METHODS, BRIDGE_REQUEST_METHODS, DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG, DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT, HIGH_REASONING_EFFORT, LOCAL_BASH_TASK_TYPE, LOCAL_WORKFLOW_TASK_TYPE, LOW_REASONING_EFFORT, MAX_REASONING_EFFORT, MEDIUM_REASONING_EFFORT, NONE_REASONING_EFFORT, PROVIDER_BRIDGE_EXPORT_NAME, PROVIDER_BRIDGE_PROTOCOL_VERSION, ProviderRequestDecodeError, ProviderResponseEncodeError, ULTRACODE_REASONING_EFFORT, UNSTAMPED_THREAD_ID, USER_QUESTION_MAX_OPTIONS, USER_QUESTION_MAX_QUESTIONS, XHIGH_REASONING_EFFORT, acpNativeReasoningSchema, acpPermissionCliSchema, acpReasoningCliSchema, backgroundTaskItemStatus, bashArgsSchema, bridgeRequestEnvelopeSchema, buildAcceptedUserMessageEvent, buildEditDiff, buildShellEnvOverrides, buildShellEnvironmentPolicyConfig, buildToolResultItem, buildToolUseItem, buildUnhandledProviderEvents, claudeCodeMockCliTrafficConfigSchema, claudeTaskToolNameSchema, claudeTaskToolOutputSchema, cloneReasoningEfforts, completeStartedToolItem, createBridgeIo, createBridgeLineHandler, createBridgeSessionRegistry, createProviderTurnStateRegistry, createProviderVisibilityMetadata, createScopedItemIdFactory, createStandaloneBuiltinCompactCommandInput, createUnhandledProviderEvent, decodeBridgeJsonRpcResponse, decodeToolCallResponsePayload, diffCumulativeText, drainAcceptedUserMessages, dynamicToolSchema, errorEnvelopeSchema, experimental_defineProviderBridge, extractEnvOverrides, extractResultText, getMessageContentTypes, getRawSdkMessage, getRecordProperty, getStringProperty, getThreadEventScopeTurnId, hostDaemonAcpLaunchSpecSchema, initializeParamsSchema, instructionModeValues, isApprovalPendingInteractionPayload, isApprovalPendingInteractionResolution, isBackgroundAgentTaskType, isClaudeCodeMockCliTrafficEndpoint, isRecord, isSettledBackgroundTaskStatus, isStandaloneBuiltinCompactCommand, isUserQuestionPendingInteractionPayload, isUserQuestionPendingInteractionResolution, jsonRpcEnvelopeSchema, jsonValueSchema, mimeTypeFromExtension, modelListParamsSchema, normalizeHostDaemonAcpLaunchSpec, normalizePendingInteractionRequestedPermissionProfile, normalizeProviderCommandOutput, pendingInteractionCommandActionSchema, pendingInteractionFileSystemPermissionsSchema, pendingInteractionMacOsPermissionsSchema, pendingInteractionNetworkPermissionsSchema, pendingInteractionResolutionSchema, permissionEscalationValues, queueAcceptedUserMessage, reasoningEffortsForLevels, reasoningLevelSchema, reasoningLevelValues, removeCommandMentionsFromPromptInput, requireThreadEventScopeTurnId, resolveProviderTerminalTurn, runBridgeRequest, runtimePermissionScopeValues, sanitizeInheritedChildProcessEnv, sdkMessageEnvelopeSchema, shouldAutoDenyInteractiveRequest, skillsConfigureParamsSchema, textBlockSchema, threadArchiveParamsSchema, threadContextWindowUsageEnvelopeSchema, threadDiscardParamsSchema, threadEventNotificationSchema, threadForkParamsSchema, threadGoalClearParamsSchema, threadIdentityEnvelopeSchema, threadNameSetParamsSchema, threadResumeParamsSchema, threadScope, threadStartParamsSchema, threadStopParamsSchema, threadUnarchiveParamsSchema, toNonNegativeNumber, toOptionalRecord, toOptionalString, toPositiveNumber, turnScope, turnStartParamsSchema, turnSteerParamsSchema, withParentToolCallId, withoutBridgeRuntimeEnv };
export type { AcceptedUserMessageState, ApprovalPendingInteractionPayload, AvailableModel, BackgroundTaskStatus, BackgroundTaskUsage, BridgeExecutionOptions, BridgeJsonRpcResponse, BridgeToolCallRequest, BuildInteractiveResponseArgs, ClaudeCodeMockCliTrafficConfig, ClaudeTaskToolOutput, ClientTurnRequestId, DecodedInteractiveRequest, DynamicTool, EnsureProviderTurnStartedArgs, HostDaemonAcpLaunchSpec, InitializeResult, InstructionMode, JsonObject, JsonRpcMessage, JsonValue, ModelReasoningEffort, PendingBridgeToolCall, PendingInteractionApprovalDecision, PendingInteractionApprovalSubject, PendingInteractionCommandAction, PendingInteractionGrantablePermissionProfile, PendingInteractionGrantedPermissionProfile, PendingInteractionPayload, PendingInteractionRequestedPermissionProfile, PendingInteractionResolution, PendingInteractionUserQuestionQuestion, PermissionEscalation, PermissionMode, PreparedProviderCommandDispatch, PromptInput, ProviderBridgeContext, ProviderBridgeDefinition, ProviderBridgeEntry, ProviderErrorCategory, ProviderErrorInfo, ProviderInboundRequest, ProviderPostInitializeRequest, ProviderRateLimitState, ProviderRateLimitStatus, ProviderRateLimitWindow, ProviderRawEventCoverage, ProviderRawEventDescription, ProviderRuntimeEvent, ProviderTurnStateRegistry, ProviderVisibilityMetadata, ReasoningLevel, RuntimePermissionPolicy, RuntimePermissionScope, ServiceTier, ThreadEvent, ThreadEventBackgroundTaskItem, ThreadEventContextWindowUsage, ThreadEventItem, ThreadEventItemApprovalStatus, ThreadEventItemStatus, ThreadEventPlanStep, ThreadEventScope, ThreadEventTokenUsage, ThreadEventTokenUsageBreakdown, ThreadEventTurnStatus, ThreadEventUserContent, ThreadEventWebFetchItem, ThreadEventWebSearchItem, ToolUseTranslationInput, UserQuestionPendingInteractionPayload, UserQuestionPendingInteractionResolution, WorkflowAgentSnapshot, WorkflowAgentState, WorkflowPhaseSnapshot, WorkflowProgressSnapshot };
