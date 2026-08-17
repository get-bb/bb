Warning: truncated output (original token count: 149831)
Total output lines: 14407

// Portable type declarations for `@get-bb/plugin-sdk`. Unpublished BB
// workspace contracts are flattened; public subpaths may reuse the
// package root without requiring any other @bb/* package.
//
// Confused by the API, or need a symbol that isn't here? Clone the BB repo
// and read the real source: https://github.com/get-bb/bb

import * as react from 'react';
import { ComponentType, ReactNode } from 'react';
import * as z from 'zod';
import { z as z$1 } from 'zod';
import Database from 'better-sqlite3';
import { Context } from 'hono';

/**
 * App-wide server-backed preferences.
 * Client-local settings stay in the frontend localStorage helpers instead.
 */
declare const appSettingsSchema: z$1.ZodObject<{
    showKeyboardHints: z$1.ZodBoolean;
    steerActiveThreadOnEnter: z$1.ZodBoolean;
    showUnhandledProviderEvents: z$1.ZodBoolean;
    codexMemoryEnabled: z$1.ZodBoolean;
    claudeCodeMemoryEnabled: z$1.ZodBoolean;
    codexSubagentsDisabled: z$1.ZodBoolean;
    claudeCodeSubagentsDisabled: z$1.ZodBoolean;
    claudeCodeWorkflowsDisabled: z$1.ZodBoolean;
    onboardingCompletedAt: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strict>;
type AppSettings = z$1.infer<typeof appSettingsSchema>;

declare const appKeybindingOverridesSchema: z$1.ZodArray<z$1.ZodObject<{
    command: z$1.ZodEnum<{
        "thread.jump.1": "thread.jump.1";
        "thread.jump.2": "thread.jump.2";
        "thread.jump.3": "thread.jump.3";
        "thread.jump.4": "thread.jump.4";
        "thread.jump.5": "thread.jump.5";
        "thread.jump.6": "thread.jump.6";
        "thread.jump.7": "thread.jump.7";
        "thread.jump.8": "thread.jump.8";
        "thread.jump.9": "thread.jump.9";
        "question.select.1": "question.select.1";
        "question.select.2": "question.select.2";
        "question.select.3": "question.select.3";
        "question.select.4": "question.select.4";
        "question.select.5": "question.select.5";
        "question.select.6": "question.select.6";
        "question.select.7": "question.select.7";
        "question.select.8": "question.select.8";
        "question.select.9": "question.select.9";
        "pane.focus.1": "pane.focus.1";
        "pane.focus.2": "pane.focus.2";
        "pane.focus.3": "pane.focus.3";
        "pane.focus.4": "pane.focus.4";
        "pane.focus.5": "pane.focus.5";
        "pane.focus.6": "pane.focus.6";
        "pane.focus.7": "pane.focus.7";
        "pane.focus.8": "pane.focus.8";
        "thread.new": "thread.new";
        "thread.search": "thread.search";
        "thread.rename": "thread.rename";
        "thread.archive": "thread.archive";
        "thread.previous": "thread.previous";
        "thread.next": "thread.next";
        "pane.focus.previous": "pane.focus.previous";
        "pane.focus.next": "pane.focus.next";
        "pane.maximize.toggle": "pane.maximize.toggle";
        "pane.close": "pane.close";
        "window.new": "window.new";
        "settings.open": "settings.open";
        "settings.openServers": "settings.openServers";
        "sidebar.toggle": "sidebar.toggle";
        "panel.newTab": "panel.newTab";
        "panel.close": "panel.close";
        "panel.toggle": "panel.toggle";
        "file.quickOpen": "file.quickOpen";
        "diff.toggle": "diff.toggle";
        "terminal.open": "terminal.open";
        "composer.focus": "composer.focus";
        "modelPicker.toggle": "modelPicker.toggle";
        "modelPicker.cycleModel": "modelPicker.cycleModel";
        "modelPicker.cycleModelBackward": "modelPicker.cycleModelBackward";
        "modelPicker.cycleProvider": "modelPicker.cycleProvider";
        "modelPicker.cycleProviderBackward": "modelPicker.cycleProviderBackward";
        "modelPicker.cycleReasoning": "modelPicker.cycleReasoning";
        "modelPicker.cycleReasoningBackward": "modelPicker.cycleReasoningBackward";
        "browser.focusLocation": "browser.focusLocation";
        "browser.reload": "browser.reload";
        "workspace.openPreferred": "workspace.openPreferred";
    }>;
    shortcut: z$1.ZodNullable<z$1.ZodObject<{
        key: z$1.ZodString;
        mod: z$1.ZodBoolean;
        meta: z$1.ZodBoolean;
        control: z$1.ZodBoolean;
        alt: z$1.ZodBoolean;
        shift: z$1.ZodBoolean;
    }, z$1.core.$strict>>;
}, z$1.core.$strict>>;
type AppKeybindingOverrides = z$1.infer<typeof appKeybindingOverridesSchema>;

interface JsonObject {
    [key: string]: JsonValue$1;
}
type JsonValue$1 = string | number | boolean | null | JsonValue$1[] | JsonObject;

declare const appThemeSchema: z$1.ZodObject<{
    themeId: z$1.ZodString;
    customCss: z$1.ZodNullable<z$1.ZodString>;
    faviconColor: z$1.ZodEnum<{
        default: "default";
        red: "red";
        orange: "orange";
        yellow: "yellow";
        green: "green";
        teal: "teal";
        blue: "blue";
        purple: "purple";
        pink: "pink";
    }>;
    resolvedCodeTheme: z$1.ZodDefault<z$1.ZodObject<{
        dark: z$1.ZodString;
        light: z$1.ZodString;
        files: z$1.ZodRecord<z$1.ZodString, z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>>;
    }, z$1.core.$strict>>;
}, z$1.core.$strip>;
type AppTheme = z$1.infer<typeof appThemeSchema>;
/**
 * The complete appearance selection a client sends when changing the palette
 * and/or favicon tint. The server validates `themeId` (built-in id or an
 * existing custom theme) and resolves the CSS from disk for custom themes.
 * Callers changing only one facet must carry the other facet forward explicitly.
 */
declare const appThemeSelectionSchema: z$1.ZodObject<{
    themeId: z$1.ZodString;
    faviconColor: z$1.ZodEnum<{
        default: "default";
        red: "red";
        orange: "orange";
        yellow: "yellow";
        green: "green";
        teal: "teal";
        blue: "blue";
        purple: "purple";
        pink: "pink";
    }>;
}, z$1.core.$strip>;
type AppThemeSelection = z$1.infer<typeof appThemeSelectionSchema>;

declare const changedMessageSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    type: z$1.ZodLiteral<"changed">;
    entity: z$1.ZodLiteral<"thread">;
    id: z$1.ZodOptional<z$1.ZodString>;
    metadata: z$1.ZodOptional<z$1.ZodObject<{
        backgroundActivityChanged: z$1.ZodOptional<z$1.ZodBoolean>;
        eventTypes: z$1.ZodOptional<z$1.ZodReadonly<z$1.ZodArray<z$1.ZodString & z$1.ZodType<"thread/started" | "thread/identity" | "turn/started" | "turn/completed" | "turn/input/accepted" | "thread/name/updated" | "thread/compacted" | "thread/context/cleared" | "thread/goal/updated" | "thread/goal/cleared" | "item/started" | "item/completed" | "item/agentMessage/delta" | "item/commandExecution/outputDelta" | "item/fileChange/outputDelta" | "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" | "item/plan/delta" | "item/mcpToolCall/progress" | "item/toolCall/progress" | "item/backgroundTask/progress" | "item/backgroundTask/completed" | "thread/tokenUsage/updated" | "thread/contextWindowUsage/updated" | "turn/plan/updated" | "turn/diff/updated" | "provider/error" | "provider/rateLimits/updated" | "provider/warning" | "provider/modelFallback" | "provider/unhandled" | "client/thread/start" | "client/turn/requested" | "client/turn/start" | "client/turn/rejected" | "system/error" | "system/manager/user_message" | "system/thread/interrupted" | "system/operation" | "system/permissionGrant/lifecycle" | "system/userQuestion/lifecycle" | "system/thread-provisioning" | "system/provider-turn-watchdog", string, z$1.core.$ZodTypeInternals<"thread/started" | "thread/identity" | "turn/started" | "turn/completed" | "turn/input/accepted" | "thread/name/updated" | "thread/compacted" | "thread/context/cleared" | "thread/goal/updated" | "thread/goal/cleared" | "item/started" | "item/completed" | "item/agentMessage/delta" | "item/commandExecution/outputDelta" | "item/fileChange/outputDelta" | "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" | "item/plan/delta" | "item/mcpToolCall/progress" | "item/toolCall/progress" | "item/backgroundTask/progress" | "item/backgroundTask/completed" | "thread/tokenUsage/updated" | "thread/contextWindowUsage/updated" | "turn/plan/updated" | "turn/diff/updated" | "provider/error" | "provider/rateLimits/updated" | "provider/warning" | "provider/modelFallback" | "provider/unhandled" | "client/thread/start" | "client/turn/requested" | "client/turn/start" | "client/turn/rejected" | "system/error" | "system/manager/user_message" | "system/thread/interrupted" | "system/operation" | "system/permissionGrant/lifecycle" | "system/userQuestion/lifecycle" | "system/thread-provisioning" | "system/provider-turn-watchdog", string>>>>>;
        hasPendingInteraction: z$1.ZodOptional<z$1.ZodBoolean>;
        projectId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>>;
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "thread-created": "thread-created";
        "thread-deleted": "thread-deleted";
        "events-appended": "events-appended";
        "history-rewritten": "history-rewritten";
        "interactions-changed": "interactions-changed";
        "status-changed": "status-changed";
        "title-changed": "title-changed";
        "queue-changed": "queue-changed";
        "archived-changed": "archived-changed";
        "pin-state-changed": "pin-state-changed";
        "parent-changed": "parent-changed";
        "environment-changed": "environment-changed";
        "read-state-changed": "read-state-changed";
        "order-changed": "order-changed";
        "tabs-changed": "tabs-changed";
        "terminals-changed": "terminals-changed";
    }>>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"changed">;
    entity: z$1.ZodLiteral<"project">;
    id: z$1.ZodOptional<z$1.ZodString>;
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "project-created": "project-created";
        "project-updated": "project-updated";
        "project-deleted": "project-deleted";
        "project-sources-changed": "project-sources-changed";
        "threads-changed": "threads-changed";
        "project-order-changed": "project-order-changed";
    }>>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"changed">;
    entity: z$1.ZodLiteral<"environment">;
    id: z$1.ZodOptional<z$1.ZodString>;
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "status-changed": "status-changed";
        "environment-created": "environment-created";
        "environment-deleted": "environment-deleted";
        "metadata-changed": "metadata-changed";
        "work-status-changed": "work-status-changed";
        "git-refs-changed": "git-refs-changed";
        "thread-storage-changed": "thread-storage-changed";
    }>>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"changed">;
    entity: z$1.ZodLiteral<"host">;
    id: z$1.ZodOptional<z$1.ZodString>;
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "host-connected": "host-connected";
        "host-disconnected": "host-disconnected";
    }>>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"changed">;
    entity: z$1.ZodLiteral<"system">;
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "config-changed": "config-changed";
        "plugins-changed": "plugins-changed";
    }>>>;
}, z$1.core.$strict>], "entity">;
type ChangedMessage = z$1.infer<typeof changedMessageSchema>;

declare const environmentSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    name: z$1.ZodNullable<z$1.ZodString>;
    projectId: z$1.ZodString;
    hostId: z$1.ZodString;
    path: z$1.ZodNullable<z$1.ZodString>;
    managed: z$1.ZodBoolean;
    isGitRepo: z$1.ZodBoolean;
    isWorktree: z$1.ZodBoolean;
    workspaceProvisionType: z$1.ZodEnum<{
        unmanaged: "unmanaged";
        "managed-worktree": "managed-worktree";
        personal: "personal";
    }>;
    branchName: z$1.ZodNullable<z$1.ZodString>;
    baseBranch: z$1.ZodNullable<z$1.ZodString>;
    defaultBranch: z$1.ZodNullable<z$1.ZodString>;
    mergeBaseBranch: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodEnum<{
        error: "error";
        provisioning: "provisioning";
        ready: "ready";
        retiring: "retiring";
        destroying: "destroying";
        destroyed: "destroyed";
    }>;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type Environment = z$1.infer<typeof environmentSchema>;

declare const experimentsSchema: z$1.ZodRecord<z$1.ZodEnum<{
    claudeCodeMockCliTraffic: "claudeCodeMockCliTraffic";
    editMessages: "editMessages";
    newOnboarding: "newOnboarding";
    providerSessionReaping: "providerSessionReaping";
}>, z$1.ZodBoolean>;
type Experiments = z$1.infer<typeof experimentsSchema>;

declare const hostSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    name: z$1.ZodString;
    type: z$1.ZodEnum<{
        persistent: "persistent";
    }>;
    status: z$1.ZodEnum<{
        connected: "connected";
        disconnected: "disconnected";
    }>;
    maxPermissionMode: z$1.ZodEnum<{
        full: "full";
        auto: "auto";
        "accept-edits": "accept-edits";
    }>;
    lastSeenAt: z$1.ZodNullable<z$1.ZodNumber>;
    lastRejectedProtocolVersion: z$1.ZodNullable<z$1.ZodNumber>;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type Host = z$1.infer<typeof hostSchema>;

declare const pendingInteractionResolutionSchema: z$1.ZodUnion<readonly [z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    decision: z$1.ZodLiteral<"allow_once">;
    grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
        network: z$1.ZodNullable<z$1.ZodObject<{
            enabled: z$1.ZodNullable<z$1.ZodBoolean>;
        }, z$1.core.$strip>>;
        fileSystem: z$1.ZodNullable<z$1.ZodObject<{
            read: z$1.ZodArray<z$1.ZodString>;
            write: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strict>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    decision: z$1.ZodLiteral<"allow_for_session">;
    grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
        network: z$1.ZodNullable<z$1.ZodObject<{
            enabled: z$1.ZodNullable<z$1.ZodBoolean>;
        }, z$1.core.$strip>>;
        fileSystem: z$1.ZodNullable<z$1.ZodObject<{
            read: z$1.ZodArray<z$1.ZodString>;
            write: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strict>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    decision: z$1.ZodLiteral<"deny">;
}, z$1.core.$strip>], "decision">, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"user_answer">;
    answers: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
        selected: z$1.ZodArray<z$1.ZodString>;
        freeText: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"plugin_submitted">;
}, z$1.core.$strip>]>;
type PendingInteractionResolution = z$1.infer<typeof pendingInteractionResolutionSchema>;
declare const providerPendingInteractionSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    status: z$1.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    turnId: z$1.ZodString;
    providerId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    providerRequestId: z$1.ZodString;
    origin: z$1.ZodOptional<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"provider">;
        providerId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
        providerRequestId: z$1.ZodString;
    }, z$1.core.$strip>>;
    payload: z$1.ZodUnion<readonly [z$1.ZodObject<{
        kind: z$1.ZodLiteral<"approval">;
        subject: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"command">;
            itemId: z$1.ZodString;
            command: z$1.ZodString;
            cwd: z$1.ZodNullable<z$1.ZodString>;
            actions: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                type: z$1.ZodLiteral<"read">;
                command: z$1.ZodString;
                name: z$1.ZodString;
                path: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                type: z$1.ZodLiteral<"listFiles">;
                command: z$1.ZodString;
                path: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                type: z$1.ZodLiteral<"search">;
                command: z$1.ZodString;
                query: z$1.ZodNullable<z$1.ZodString>;
                path: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                type: z$1.ZodLiteral<"unknown">;
                command: z$1.ZodString;
            }, z$1.core.$strip>], "type">>;
            sessionGrant: z$1.ZodNullable<z$1.ZodObject<{
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"file_change">;
            itemId: z$1.ZodString;
            writeScope: z$1.ZodNullable<z$1.ZodString>;
            sessionGrant: z$1.ZodNullable<z$1.ZodObject<{
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"permission_grant">;
            itemId: z$1.ZodString;
            toolName: z$1.ZodNullable<z$1.ZodString>;
            permissions: z$1.ZodObject<{
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"plan">;
            itemId: z$1.ZodString;
            plan: z$1.ZodString;
            planFilePath: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>], "kind">;
        reason: z$1.ZodNullable<z$1.ZodString>;
        availableDecisions: z$1.ZodArray<z$1.ZodEnum<{
            allow_once: "allow_once";
            allow_for_session: "allow_for_session";
            deny: "deny";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"user_question">;
        questions: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            prompt: z$1.ZodString;
            shortLabel: z$1.ZodOptional<z$1.ZodString>;
            multiSelect: z$1.ZodBoolean;
            options: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
                value: z$1.ZodString;
                label: z$1.ZodString;
                description: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>>;
            allowFreeText: z$1.ZodBoolean;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>]>;
    resolution: z$1.ZodNullable<z$1.ZodUnion<readonly [z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_once">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_for_session">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"deny">;
    }, z$1.core.$strip>], "decision">, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"user_answer">;
        answers: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
            selected: z$1.ZodArray<z$1.ZodString>;
            freeText: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>]>>;
}, z$1.core.$strip>;
type ProviderPendingInteraction = z$1.infer<typeof providerPendingInteractionSchema>;
declare const pluginPendingInteractionSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    status: z$1.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    origin: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin">;
        pluginId: z$1.ZodString;
        rendererId: z$1.ZodString;
    }, z$1.core.$strip>;
    payload: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin">;
        title: z$1.ZodString;
        data: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
    }, z$1.core.$strip>;
    resolution: z$1.ZodNullable<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin_submitted">;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type PluginPendingInteraction = z$1.infer<typeof pluginPendingInteractionSchema>;
type PendingInteraction = ProviderPendingInteraction | PluginPendingInteraction;

declare const projectSourceSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    projectId: z$1.ZodString;
    isDefault: z$1.ZodBoolean;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
    type: z$1.ZodLiteral<"local_path">;
    hostId: z$1.ZodString;
    path: z$1.ZodString;
}, z$1.core.$strip>;
type ProjectSource = z$1.infer<typeof projectSourceSchema>;

declare const reasoningLevelSchema: z$1.ZodEnum<{
    none: "none";
    low: "low";
    medium: "medium";
    high: "high";
    xhigh: "xhigh";
    ultracode: "ultracode";
    max: "max";
    ultra: "ultra";
}>;
type ReasoningLevel = z$1.infer<typeof reasoningLevelSchema>;
declare const serviceTierSchema: z$1.ZodEnum<{
    default: "default";
    fast: "fast";
}>;
type ServiceTier = z$1.infer<typeof serviceTierSchema>;
declare const permissionModeSchema: z$1.ZodEnum<{
    full: "full";
    auto: "auto";
    "accept-edits": "accept-edits";
}>;
type PermissionMode = z$1.infer<typeof permissionModeSchema>;
declare const promptInputSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    visibility: z$1.ZodOptional<z$1.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
    type: z$1.ZodLiteral<"text">;
    text: z$1.ZodString;
    mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
        start: z$1.ZodNumber;
        end: z$1.ZodNumber;
        resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"thread">;
            threadId: z$1.ZodString;
            projectId: z$1.ZodOptional<z$1.ZodString>;
            label: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"project">;
            projectId: z$1.ZodString;
            label: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"section">;
            sectionId: z$1.ZodString;
            label: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"path">;
            source: z$1.ZodEnum<{
                workspace: "workspace";
                "thread-storage": "thread-storage";
            }>;
            entryKind: z$1.ZodEnum<{
                file: "file";
                directory: "directory";
            }>;
            path: z$1.ZodString;
            label: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"command">;
            trigger: z$1.ZodEnum<{
                "/": "/";
            }>;
            name: z$1.ZodString;
            source: z$1.ZodEnum<{
                command: "command";
                skill: "skill";
            }>;
            origin: z$1.ZodEnum<{
                user: "user";
                project: "project";
                builtin: "builtin";
            }>;
            label: z$1.ZodString;
            argumentHint: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"plugin">;
            pluginId: z$1.ZodString;
            icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
            itemId: z$1.ZodString;
            label: z$1.ZodString;
        }, z$1.core.$strip>], "kind">>;
    }, z$1.core.$strip>>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    visibility: z$1.ZodOptional<z$1.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
    type: z$1.ZodLiteral<"image">;
    url: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    visibility: z$1.ZodOptional<z$1.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
    type: z$1.ZodLiteral<"localImage">;
    path: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    visibility: z$1.ZodOptional<z$1.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
    type: z$1.ZodLiteral<"localFile">;
    path: z$1.ZodString;
    name: z$1.ZodOptional<z$1.ZodString>;
    sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
    mimeType: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>], "type">;
type PromptInput = z$1.infer<typeof promptInputSchema>;
declare const resolvedThreadExecutionOptionsSchema: z$1.ZodObject<{
    seq: z$1.ZodOptional<z$1.ZodNumber>;
    model: z$1.ZodString;
    serviceTier: z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>;
    reasoningLevel: z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>;
    permissionMode: z$1.ZodEnum<{
        full: "full";
        auto: "auto";
        "accept-edits": "accept-edits";
    }>;
    source: z$1.ZodEnum<{
        "client/thread/start": "client/thread/start";
        "client/turn/requested": "client/turn/requested";
        "client/turn/start": "client/turn/start";
    }>;
}, z$1.core.$strip>;
type ResolvedThreadExecutionOptions = z$1.infer<typeof resolvedThreadExecutionOptionsSchema>;
declare const projectExecutionDefaultsSchema: z$1.ZodObject<{
    providerId: z$1.ZodString;
    model: z$1.ZodString;
    serviceTier: z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>;
    reasoningLevel: z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>;
    permissionMode: z$1.ZodEnum<{
        full: "full";
        auto: "auto";
        "accept-edits": "accept-edits";
    }>;
}, z$1.core.$strip>;
type ProjectExecutionDefaults = z$1.infer<typeof projectExecutionDefaultsSchema>;

/** All thread events — provider-originated or system-originated. */
declare const threadEventSchema: z$1.ZodPipe<z$1.ZodUnknown, z$1.ZodUnion<readonly [z$1.ZodIntersection<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/started">;
    threadId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/identity">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"turn/started">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"turn/completed">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodEnum<{
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
    }>;
    error: z$1.ZodOptional<z$1.ZodObject<{
        message: z$1.ZodString;
    }, z$1.core.$strip>>;
    providerCheckpointId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"turn/input/accepted">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    clientRequestId: z$1.ZodString;
    scope: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"turn">;
        turnId: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
}, z$1.core.$strict>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/name/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    threadName: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/compacted">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/context/cleared">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/goal/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    objective: z$1.ZodString;
    status: z$1.ZodEnum<{
        active: "active";
        paused: "paused";
        budgetLimited: "budgetLimited";
        complete: "complete";
    }>;
    tokenBudget: z$1.ZodNullable<z$1.ZodNumber>;
    tokensUsed: z$1.ZodNumber;
    timeUsedSeconds: z$1.ZodNumber;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/goal/cleared">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/started">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    item: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        type: z$1.ZodLiteral<"userMessage">;
        id: z$1.ZodString;
        content: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            type: z$1.ZodLiteral<"text">;
            text: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"localImage">;
            path: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"localFile">;
            path: z$1.ZodString;
        }, z$1.core.$strip>], "type">>;
        clientRequestId: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"agentMessage">;
        id: z$1.ZodString;
        text: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"commandExecution">;
        id: z$1.ZodString;
        command: z$1.ZodString;
        cwd: z$1.ZodString;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        aggregatedOutput: z$1.ZodOptional<z$1.ZodString>;
        exitCode: z$1.ZodOptional<z$1.ZodNumber>;
        durationMs: z$1.ZodOptional<z$1.ZodNumber>;
        truncation: z$1.ZodOptional<z$1.ZodObject<{
            aggregatedOutput: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            result: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            resultText: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"fileChange">;
        id: z$1.ZodString;
        changes: z$1.ZodArray<z$1.ZodObject<{
            path: z$1.ZodString;
            kind: z$1.ZodEnum<{
                add: "add";
                delete: "delete";
                update: "update";
            }>;
            movePath: z$1.ZodOptional<z$1.ZodString>;
            diff: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"webSearch">;
        id: z$1.ZodString;
        queries: z$1.ZodArray<z$1.ZodString>;
        resultText: z$1.ZodNullable<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"webFetch">;
        id: z$1.ZodString;
        url: z$1.ZodString;
        prompt: z$1.ZodNullable<z$1.ZodString>;
        pattern: z$1.ZodNullable<z$1.ZodString>;
        resultText: z$1.ZodNullable<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"imageView">;
        id: z$1.ZodString;
        path: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"toolCall">;
        id: z$1.ZodString;
        server: z$1.ZodOptional<z$1.ZodString>;
        tool: z$1.ZodString;
        arguments: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>>;
        statusLabels: z$1.ZodOptional<z$1.ZodObject<{
            pending: z$1.ZodString;
            completed: z$1.ZodString;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        result: z$1.ZodOptional<z$1.ZodUnknown>;
        error: z$1.ZodOptional<z$1.ZodString>;
        durationMs: z$1.ZodOptional<z$1.ZodNumber>;
        truncation: z$1.ZodOptional<z$1.ZodObject<{
            aggregatedOutput: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            result: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            resultText: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"reasoning">;
        id: z$1.ZodString;
        summary: z$1.ZodArray<z$1.ZodString>;
        content: z$1.ZodArray<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"plan">;
        id: z$1.ZodString;
        text: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"contextCompaction">;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"backgroundTask">;
        id: z$1.ZodString;
        taskType: z$1.ZodString;
        description: z$1.ZodString;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        taskStatus: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            paused: "paused";
            pending: "pending";
            running: "running";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z$1.ZodBoolean;
        workflowName: z$1.ZodOptional<z$1.ZodString>;
        workflow: z$1.ZodOptional<z$1.ZodObject<{
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                title: z$1.ZodString;
                kind: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
            agents: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                label: z$1.ZodString;
                state: z$1.ZodEnum<{
                    failed: "failed";
                    running: "running";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z$1.ZodString;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                lastProgressAt: z$1.ZodNumber;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                agentType: z$1.ZodOptional<z$1.ZodString>;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                error: z$1.ZodOptional<z$1.ZodString>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        usage: z$1.ZodOptional<z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            durationMs: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        error: z$1.ZodOptional<z$1.ZodString>;
        outputFile: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/completed">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    item: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        type: z$1.ZodLiteral<"userMessage">;
        id: z$1.ZodString;
        content: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            type: z$1.ZodLiteral<"text">;
            text: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"localImage">;
            path: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"localFile">;
            path: z$1.ZodString;
        }, z$1.core.$strip>], "type">>;
        clientRequestId: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"agentMessage">;
        id: z$1.ZodString;
        text: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"commandExecution">;
        id: z$1.ZodString;
        command: z$1.ZodString;
        cwd: z$1.ZodString;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        aggregatedOutput: z$1.ZodOptional<z$1.ZodString>;
        exitCode: z$1.ZodOptional<z$1.ZodNumber>;
        durationMs: z$1.ZodOptional<z$1.ZodNumber>;
        truncation: z$1.ZodOptional<z$1.ZodObject<{
            aggregatedOutput: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            result: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            resultText: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"fileChange">;
        id: z$1.ZodString;
        changes: z$1.ZodArray<z$1.ZodObject<{
            path: z$1.ZodString;
            kind: z$1.ZodEnum<{
                add: "add";
                delete: "delete";
                update: "update";
            }>;
            movePath: z$1.ZodOptional<z$1.ZodString>;
            diff: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"webSearch">;
        id: z$1.ZodString;
        queries: z$1.ZodArray<z$1.ZodString>;
        resultText: z$1.ZodNullable<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"webFetch">;
        id: z$1.ZodString;
        url: z$1.ZodString;
        prompt: z$1.ZodNullable<z$1.ZodString>;
        pattern: z$1.ZodNullable<z$1.ZodString>;
        resultText: z$1.ZodNullable<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"imageView">;
        id: z$1.ZodString;
        path: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"toolCall">;
        id: z$1.ZodString;
        server: z$1.ZodOptional<z$1.ZodString>;
        tool: z$1.ZodString;
        arguments: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>>;
        statusLabels: z$1.ZodOptional<z$1.ZodObject<{
            pending: z$1.ZodString;
            completed: z$1.ZodString;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        result: z$1.ZodOptional<z$1.ZodUnknown>;
        error: z$1.ZodOptional<z$1.ZodString>;
        durationMs: z$1.ZodOptional<z$1.ZodNumber>;
        truncation: z$1.ZodOptional<z$1.ZodObject<{
            aggregatedOutput: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            result: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            resultText: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"reasoning">;
        id: z$1.ZodString;
        summary: z$1.ZodArray<z$1.ZodString>;
        content: z$1.ZodArray<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"plan">;
        id: z$1.ZodString;
        text: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"contextCompaction">;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"backgroundTask">;
        id: z$1.ZodString;
        taskType: z$1.ZodString;
        description: z$1.ZodString;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        taskStatus: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            paused: "paused";
            pending: "pending";
            running: "running";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z$1.ZodBoolean;
        workflowName: z$1.ZodOptional<z$1.ZodString>;
        workflow: z$1.ZodOptional<z$1.ZodObject<{
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                title: z$1.ZodString;
                kind: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
            agents: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                label: z$1.ZodString;
                state: z$1.ZodEnum<{
                    failed: "failed";
                    running: "running";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z$1.ZodString;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                lastProgressAt: z$1.ZodNumber;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                agentType: z$1.ZodOptional<z$1.ZodString>;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                error: z$1.ZodOptional<z$1.ZodString>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        usage: z$1.ZodOptional<z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            durationMs: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        error: z$1.ZodOptional<z$1.ZodString>;
        outputFile: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/agentMessage/delta">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    delta: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/commandExecution/outputDelta">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    delta: z$1.ZodString;
    reset: z$1.ZodOptional<z$1.ZodBoolean>;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/fileChange/outputDelta">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    delta: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/reasoning/summaryTextDelta">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    delta: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/reasoning/textDelta">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    delta: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/plan/delta">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    delta: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/mcpToolCall/progress">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    message: z$1.ZodOptional<z$1.ZodString>;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/toolCall/progress">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    message: z$1.ZodOptional<z$1.ZodString>;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/backgroundTask/progress">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    item: z$1.ZodObject<{
        type: z$1.ZodLiteral<"backgroundTask">;
        id: z$1.ZodString;
        taskType: z$1.ZodString;
        description: z$1.ZodString;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        taskStatus: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            paused: "paused";
            pending: "pending";
            running: "running";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z$1.ZodBoolean;
        workflowName: z$1.ZodOptional<z$1.ZodString>;
        workflow: z$1.ZodOptional<z$1.ZodObject<{
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                title: z$1.ZodString;
                kind: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
            agents: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                label: z$1.ZodString;
                state: z$1.ZodEnum<{
                    failed: "failed";
                    running: "running";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z$1.ZodString;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                lastProgressAt: z$1.ZodNumber;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                agentType: z$1.ZodOptional<z$1.ZodString>;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                error: z$1.ZodOptional<z$1.ZodString>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        usage: z$1.ZodOptional<z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            durationMs: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        error: z$1.ZodOptional<z$1.ZodString>;
        outputFile: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/backgroundTask/completed">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    item: z$1.ZodObject<{
        type: z$1.ZodLiteral<"backgroundTask">;
        id: z$1.ZodString;
        taskType: z$1.ZodString;
        description: z$1.ZodString;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        taskStatus: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            paused: "paused";
            pending: "pending";
            running: "running";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z$1.ZodBoolean;
        workflowName: z$1.ZodOptional<z$1.ZodString>;
        workflow: z$1.ZodOptional<z$1.ZodObject<{
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                title: z$1.ZodString;
                kind: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
            agents: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                label: z$1.ZodString;
                state: z$1.ZodEnum<{
                    failed: "failed";
                    running: "running";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z$1.ZodString;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                lastProgressAt: z$1.ZodNumber;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                agentType: z$1.ZodOptional<z$1.ZodString>;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                error: z$1.ZodOptional<z$1.ZodString>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        usage: z$1.ZodOptional<z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            durationMs: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        error: z$1.ZodOptional<z$1.ZodString>;
        outputFile: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/tokenUsage/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    tokenUsage: z$1.ZodObject<{
        total: z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            inputTokens: z$1.ZodNumber;
            cachedInputTokens: z$1.ZodNumber;
            outputTokens: z$1.ZodNumber;
            reasoningOutputTokens: z$1.ZodNumber;
        }, z$1.core.$strip>;
        last: z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            inputTokens: z$1.ZodNumber;
            cachedInputTokens: z$1.ZodNumber;
            outputTokens: z$1.ZodNumber;
            reasoningOutputTokens: z$1.ZodNumber;
        }, z$1.core.$strip>;
        modelContextWindow: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/contextWindowUsage/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    contextWindowUsage: z$1.ZodObject<{
        usedTokens: z$1.ZodNullable<z$1.ZodNumber>;
        modelContextWindow: z$1.ZodNullable<z$1.ZodNumber>;
        estimated: z$1.ZodBoolean;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"turn/plan/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    plan: z$1.ZodArray<z$1.ZodObject<{
        step: z$1.ZodString;
        status: z$1.ZodOptional<z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            active: "active";
            pending: "pending";
        }>>;
    }, z$1.core.$strip>>;
    explanation: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"turn/diff/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    diff: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"provider/error">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    message: z$1.ZodString;
    detail: z$1.ZodOptional<z$1.ZodString>;
    willRetry: z$1.ZodOptional<z$1.ZodBoolean>;
    errorInfo: z$1.ZodOptional<z$1.ZodObject<{
        category: z$1.ZodEnum<{
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
        providerCode: z$1.ZodNullable<z$1.ZodString>;
        httpStatusCode: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"provider/rateLimits/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    rateLimits: z$1.ZodObject<{
        providerId: z$1.ZodString;
        status: z$1.ZodEnum<{
            unknown: "unknown";
            allowed: "allowed";
            warning: "warning";
            blocked: "blocked";
        }>;
        kind: z$1.ZodEnum<{
            unknown: "unknown";
            "subscription-window": "subscription-window";
            credits: "credits";
            "spend-control": "spend-control";
        }>;
        windows: z$1.ZodArray<z$1.ZodObject<{
            providerKey: z$1.ZodNullable<z$1.ZodString>;
            label: z$1.ZodNullable<z$1.ZodString>;
            status: z$1.ZodEnum<{
                unknown: "unknown";
                allowed: "allowed";
                warning: "warning";
                blocked: "blocked";
            }>;
            resetsAtMs: z$1.ZodNullable<z$1.ZodNumber>;
        }, z$1.core.$strip>>;
        reachedReason: z$1.ZodNullable<z$1.ZodString>;
        overageStatus: z$1.ZodNullable<z$1.ZodEnum<{
            allowed: "allowed";
            warning: "warning";
            rejected: "rejected";
            unavailable: "unavailable";
        }>>;
        overageReason: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"provider/warning">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    category: z$1.ZodEnum<{
        deprecation: "deprecation";
        config: "config";
        general: "general";
    }>;
    summary: z$1.ZodOptional<z$1.ZodString>;
    details: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"provider/modelFallback">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    originalModel: z$1.ZodString;
    fallbackModel: z$1.ZodString;
    reason: z$1.ZodEnum<{
        refusal: "refusal";
        provider: "provider";
    }>;
    message: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"provider/unhandled">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    providerId: z$1.ZodString;
    rawType: z$1.ZodString;
    rawEvent: z$1.ZodObject<{
        jsonrpc: z$1.ZodLiteral<"2.0">;
        id: z$1.ZodOptional<z$1.ZodUnion<readonly [z$1.ZodString, z$1.ZodNumber]>>;
        method: z$1.ZodString;
        params: z$1.ZodOptional<z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>>;
    }, z$1.core.$strip>;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>], "type">, z$1.ZodObject<{
    scope: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"turn">;
        turnId: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
}, z$1.core.$strip>>, z$1.ZodIntersection<z$1.ZodUnion<readonly [z$1.ZodObject<{
    type: z$1.ZodLiteral<"client/thread/start">;
    threadId: z$1.ZodString;
    direction: z$1.ZodLiteral<"outbound">;
    source: z$1.ZodEnum<{
        spawn: "spawn";
        tell: "tell";
    }>;
    initiator: z$1.ZodEnum<{
        user: "user";
        system: "system";
        agent: "agent";
    }>;
    request: z$1.ZodObject<{
        method: z$1.ZodEnum<{
            "thread/start": "thread/start";
            "turn/start": "turn/start";
        }>;
        params: z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"client/turn/requested">;
    threadId: z$1.ZodString;
    direction: z$1.ZodLiteral<"outbound">;
    requestId: z$1.ZodString;
    continuationOfRequestId: z$1.ZodOptional<z$1.ZodString>;
    source: z$1.ZodEnum<{
        spawn: "spawn";
        tell: "tell";
    }>;
    initiator: z$1.ZodEnum<{
        user: "user";
        system: "system";
        agent: "agent";
    }>;
    senderThreadId: z$1.ZodNullable<z$1.ZodString>;
    systemMessageKind: z$1.ZodOptional<z$1.ZodEnum<{
        "ownership-assigned": "ownership-assigned";
        "ownership-removed": "ownership-removed";
        "child-needs-attention": "child-needs-attention";
        "child-completed": "child-completed";
        "child-failed": "child-failed";
        "child-interrupted": "child-interrupted";
        "child-outcome-batch": "child-outcome-batch";
        unlabeled: "unlabeled";
    }>>;
    systemMessageSubject: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
        threadId: z$1.ZodString;
        threadName: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread-batch">;
        count: z$1.ZodNumber;
    }, z$1.core.$strip>], "kind">>>;
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>;
    inputGroups: z$1.ZodOptional<z$1.ZodArray<z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>>>;
    target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread-start">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"new-turn">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"auto">;
        expectedTurnId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"steer">;
        expectedTurnId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>], "kind">;
    request: z$1.ZodObject<{
        method: z$1.ZodEnum<{
            "thread/start": "thread/start";
            "turn/start": "turn/start";
        }>;
        params: z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>;
    }, z$1.core.$strip>;
    execution: z$1.ZodObject<{
        seq: z$1.ZodOptional<z$1.ZodNumber>;
        model: z$1.ZodString;
        serviceTier: z$1.ZodEnum<{
            default: "default";
            fast: "fast";
        }>;
        reasoningLevel: z$1.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>;
        source: z$1.ZodEnum<{
            "client/thread/start": "client/thread/start";
            "client/turn/requested": "client/turn/requested";
            "client/turn/start": "client/turn/start";
        }>;
        permissionMode: z$1.ZodEnum<{
            readonly: "readonly";
            full: "full";
            auto: "auto";
            "accept-edits": "accept-edits";
            "workspace-write": "workspace-write";
        }>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"client/turn/rejected">;
    threadId: z$1.ZodString;
    requestId: z$1.ZodString;
    reason: z$1.ZodString;
    message: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"client/turn/start">;
    threadId: z$1.ZodString;
    direction: z$1.ZodLiteral<"outbound">;
    source: z$1.ZodEnum<{
        spawn: "spawn";
        tell: "tell";
    }>;
    initiator: z$1.ZodEnum<{
        user: "user";
        system: "system";
        agent: "agent";
    }>;
    request: z$1.ZodObject<{
        method: z$1.ZodEnum<{
            "thread/start": "thread/start";
            "turn/start": "turn/start";
        }>;
        params: z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/error">;
    threadId: z$1.ZodString;
    code: z$1.ZodOptional<z$1.ZodString>;
    message: z$1.ZodString;
    detail: z$1.ZodOptional<z$1.ZodString>;
    reconnectAttempt: z$1.ZodOptional<z$1.ZodNumber>;
    reconnectTotal: z$1.ZodOptional<z$1.ZodNumber>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/manager/user_message">;
    threadId: z$1.ZodString;
    text: z$1.ZodString;
    toolCallId: z$1.ZodOptional<z$1.ZodString>;
    turnId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/thread/interrupted">;
    threadId: z$1.ZodString;
    reason: z$1.ZodEnum<{
        "manual-stop": "manual-stop";
        "host-daemon-restarted": "host-daemon-restarted";
        "provider-turn-idle": "provider-turn-idle";
    }>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/operation">;
    threadId: z$1.ZodString;
    operation: z$1.ZodString;
    status: z$1.ZodString;
    message: z$1.ZodString;
    operationId: z$1.ZodString;
    metadata: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/permissionGrant/lifecycle">;
    threadId: z$1.ZodString;
    interactionId: z$1.ZodString;
    providerId: z$1.ZodString;
    providerRequestId: z$1.ZodString;
    status: z$1.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    resolution: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_once">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_for_session">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"deny">;
    }, z$1.core.$strip>], "decision">>>;
    statusReason: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
    subject: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"permission_grant">;
        itemId: z$1.ZodString;
        toolName: z$1.ZodNullable<z$1.ZodString>;
        permissions: z$1.ZodObject<{
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/userQuestion/lifecycle">;
    threadId: z$1.ZodString;
    interactionId: z$1.ZodString;
    providerId: z$1.ZodString;
    providerRequestId: z$1.ZodString;
    status: z$1.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    resolution: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"user_answer">;
        answers: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
            selected: z$1.ZodArray<z$1.ZodString>;
            freeText: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>>>;
    statusReason: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
    payload: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"user_question">;
        questions: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            prompt: z$1.ZodString;
            shortLabel: z$1.ZodOptional<z$1.ZodString>;
            multiSelect: z$1.ZodBoolean;
            options: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
                value: z$1.ZodString;
                label: z$1.ZodString;
                description: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>>;
            allowFreeText: z$1.ZodBoolean;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/thread-provisioning">;
    threadId: z$1.ZodString;
    provisioningId: z$1.ZodString;
    status: z$1.ZodEnum<{
        completed: "completed";
        failed: "failed";
        active: "active";
        cancelled: "cancelled";
    }>;
    environmentId: z$1.ZodString;
    entries: z$1.ZodArray<z$1.ZodObject<{
        type: z$1.ZodEnum<{
            output: "output";
            step: "step";
        }>;
        key: z$1.ZodString;
        text: z$1.ZodString;
        startedAt: z$1.ZodOptional<z$1.ZodNumber>;
        status: z$1.ZodOptional<z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            started: "started";
        }>>;
        metadata: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/provider-turn-watchdog">;
    threadId: z$1.ZodString;
    reason: z$1.ZodLiteral<"provider-turn-idle">;
    thresholdMs: z$1.ZodNumber;
    elapsedMs: z$1.ZodNumber;
    activeTurnId: z$1.ZodString;
    activeTurnStartedAt: z$1.ZodNumber;
    lastActivityEventSequence: z$1.ZodNumber;
    lastActivityEventType: z$1.ZodString;
    lastActivityEventAt: z$1.ZodNumber;
    providerId: z$1.ZodString;
    providerThreadId: z$1.ZodNullable<z$1.ZodString>;
    firedAt: z$1.ZodNumber;
}, z$1.core.$strip>]>, z$1.ZodObject<{
    scope: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"turn">;
        turnId: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
}, z$1.core.$strip>>]>>;
type ThreadEvent = z$1.infer<typeof threadEventSchema>;
type ThreadEventType = ThreadEvent["type"];

/**
 * How completely a provider can clone one of its sessions — the single
 * vocabulary shared by the provider declaration
 * (`bb.agents.experimental_registerProvider`), the server→daemon
 * `bridgeLaunch`, and the bridge's `initialize` handshake.
 *
 * - `"none"`: sessions cannot be cloned at all.
 * - `"tip"`: only the current end of a session can be cloned (ACP
 *   `session/fork`), so thread fork works but edit-past-message rewind
 *   cannot.
 * - `"checkpoint"`: a session can be recreated at an earlier point, which is
 *   what edit-past-message rewind needs.
 *
 * The values are ordered least to most capable: a declaration is a ceiling
 * the handshake may narrow but never widen.
 */
declare const PROVIDER_FORK_VALUES: readonly ["none", "tip", "checkpoint"];
type ProviderFork = (typeof PROVIDER_FORK_VALUES)[number];

declare const providerInfoSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    displayName: z$1.ZodString;
    logoUrl: z$1.ZodNullable<z$1.ZodString>;
    capabilities: z$1.ZodObject<{
        supportsThreadArchive: z$1.ZodBoolean;
        supportsThreadRename: z$1.ZodBoolean;
        supportsServiceTier: z$1.ZodBoolean;
        supportsNativeUserQuestion: z$1.ZodBoolean;
        supportsFork: z$1.ZodBoolean;
        supportsSessionRewind: z$1.ZodBoolean;
        permissionModes: z$1.ZodArray<z$1.ZodEnum<{
            full: "full";
            auto: "auto";
            "accept-edits": "accept-edits";
        }>>;
    }, z$1.core.$strip>;
    composerActions: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"skills">;
        trigger: z$1.ZodEnum<{
            "/": "/";
        }>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plan">;
        command: z$1.ZodObject<{
            trigger: z$1.ZodEnum<{
                "/": "/";
            }>;
            name: z$1.ZodString;
            trailingText: z$1.ZodString;
        }, z$1.core.$strip>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"goal">;
        command: z$1.ZodObject<{
            trigger: z$1.ZodEnum<{
                "/": "/";
            }>;
            name: z$1.ZodString;
            trailingText: z$1.ZodString;
        }, z$1.core.$strip>;
    }, z$1.core.$strip>], "kind">>;
    available: z$1.ZodBoolean;
}, z$1.core.$strip>;
type ProviderInfo = z$1.infer<typeof providerInfoSchema>;

declare const threadEventScopeSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    kind: z$1.ZodLiteral<"thread">;
}, z$1.core.$strip>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"turn">;
    turnId: z$1.ZodString;
}, z$1.core.$strip>], "kind">;
type ThreadEventScope = z$1.infer<typeof threadEventScopeSchema>;

type ThreadEventByType = {
    [TType in ThreadEventType]: Extract<ThreadEvent, {
        type: TType;
    }>;
};
type ThreadEventForType<TType extends ThreadEventType> = ThreadEventByType[TType];
type StoredThreadEventDataFromEvent<TEvent extends ThreadEvent> = Omit<TEvent, "threadId" | "type" | "scope">;
interface ThreadEventRowBase {
    id: string;
    scope: ThreadEventScope;
    threadId: string;
    seq: number;
    createdAt: number;
}
type ThreadEventRowFromEvent<TEvent extends ThreadEvent> = ThreadEventRowBase & {
    type: TEvent["type"];
    data: StoredThreadEventDataFromEvent<TEvent>;
};
type ThreadEventRowOfType<TType extends ThreadEventType> = ThreadEventRowFromEvent<ThreadEventForType<TType>>;
type ThreadEventRow = {
    [TType in ThreadEventType]: ThreadEventRowOfType<TType>;
}[ThreadEventType];

declare const threadStatusSchema: z$1.ZodEnum<{
    error: "error";
    active: "active";
    starting: "starting";
    idle: "idle";
    stopping: "stopping";
}>;
type ThreadStatus = z$1.infer<typeof threadStatusSchema>;

declare const threadTimelinePendingTodosSchema: z$1.ZodObject<{
    sourceSeq: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
    items: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        text: z$1.ZodString;
        status: z$1.ZodEnum<{
            completed: "completed";
            pending: "pending";
            in_progress: "in_progress";
        }>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type ThreadTimelinePendingTodos = z$1.infer<typeof threadTimelinePendingTodosSchema>;

declare const threadQueuedMessageSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    content: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>;
    model: z$1.ZodString;
    reasoningLevel: z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>;
    permissionMode: z$1.ZodEnum<{
        full: "full";
        auto: "auto";
        "accept-edits": "accept-edits";
    }>;
    serviceTier: z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>;
    groupWithNext: z$1.ZodBoolean;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type ThreadQueuedMessage = z$1.infer<typeof threadQueuedMessageSchema>;

declare const createThreadEnvironmentArgsSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    type: z$1.ZodLiteral<"reuse">;
    environmentId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"host">;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    workspace: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        type: z$1.ZodLiteral<"unmanaged">;
        path: z$1.ZodNullable<z$1.ZodString>;
        branch: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"existing">;
            name: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"new">;
            baseBranch: z$1.ZodString;
        }, z$1.core.$strict>], "kind">>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"managed-worktree">;
        baseBranch: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"named">;
            name: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"default">;
        }, z$1.core.$strip>], "kind">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"personal">;
    }, z$1.core.$strip>], "type">;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"project-default">;
}, z$1.core.$strip>], "type">;
type CreateThreadEnvironmentArgs = z$1.infer<typeof createThreadEnvironmentArgsSchema>;
declare const workspaceFileListResponseSchema: z$1.ZodObject<{
    files: z$1.ZodArray<z$1.ZodObject<{
        path: z$1.ZodString;
        name: z$1.ZodString;
    }, z$1.core.$strip>>;
    truncated: z$1.ZodBoolean;
}, z$1.core.$strip>;
type WorkspaceFileListResponse = z$1.infer<typeof workspaceFileListResponseSchema>;
declare const workspacePathListResponseSchema: z$1.ZodObject<{
    paths: z$1.ZodArray<z$1.ZodObject<{
        kind: z$1.ZodEnum<{
            file: "file";
            directory: "directory";
        }>;
        path: z$1.ZodString;
        name: z$1.ZodString;
        score: z$1.ZodNumber;
        positions: z$1.ZodArray<z$1.ZodNumber>;
    }, z$1.core.$strip>>;
    truncated: z$1.ZodBoolean;
}, z$1.core.$strip>;
type WorkspacePathListResponse = z$1.infer<typeof workspacePathListResponseSchema>;

declare const createProjectSourceRequestSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    hostId: z$1.ZodString;
    type: z$1.ZodLiteral<"local_path">;
    path: z$1.ZodPipe<z$1.ZodString, z$1.ZodTransform<string, string>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    hostId: z$1.ZodString;
    type: z$1.ZodLiteral<"clone">;
    targetPath: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodString, z$1.ZodTransform<string, string>>>;
    remoteUrl: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strict>], "type">;
type CreateProjectSourceRequest = z$1.infer<typeof createProjectSourceRequestSchema>;
declare const createProjectRequestSchema: z$1.ZodObject<{
    name: z$1.ZodString;
    source: z$1.ZodObject<{
        hostId: z$1.ZodString;
        type: z$1.ZodLiteral<"local_path">;
        path: z$1.ZodPipe<z$1.ZodString, z$1.ZodTransform<string, string>>;
    }, z$1.core.$strict>;
}, z$1.core.$strip>;
type CreateProjectRequest = z$1.infer<typeof createProjectRequestSchema>;
declare const threadSectionSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    name: z$1.ZodString;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strict>;
type ThreadSectionResponse = z$1.infer<typeof threadSectionSchema>;
declare const createThreadSectionRequestSchema: z$1.ZodObject<{
    name: z$1.ZodString;
}, z$1.core.$strict>;
type CreateThreadSectionRequest = z$1.infer<typeof createThreadSectionRequestSchema>;
declare const updateThreadSectionRequestSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    name: z$1.ZodString;
}, z$1.core.$strict>;
type UpdateThreadSectionRequest = z$1.infer<typeof updateThreadSectionRequestSchema>;
declare const deleteThreadSectionRequestSchema: z$1.ZodObject<{
    id: z$1.ZodString;
}, z$1.core.$strict>;
type DeleteThreadSectionRequest = z$1.infer<typeof deleteThreadSectionRequestSchema>;
declare const threadSectionMutationResponseSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    name: z$1.ZodString;
    updatedThreadCount: z$1.ZodNumber;
}, z$1.core.$strict>;
type ThreadSectionMutationResponse = z$1.infer<typeof threadSectionMutationResponseSchema>;
declare const reorderProjectRequestSchema: z$1.ZodObject<{
    previousProjectId: z$1.ZodNullable<z$1.ZodString>;
    nextProjectId: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type ReorderProjectRequest = z$1.infer<typeof reorderProjectRequestSchema>;
declare const projectListQuerySchema: z$1.ZodObject<{
    include: z$1.ZodOptional<z$1.ZodString>;
    includePersonal: z$1.ZodOptional<z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>>;
}, z$1.core.$strip>;
type ProjectListQuery = z$1.infer<typeof projectListQuerySchema>;
declare const projectFilesQuerySchema: z$1.ZodObject<{
    query: z$1.ZodOptional<z$1.ZodOptional<z$1.ZodString>>;
    limit: z$1.ZodOptional<z$1.ZodOptional<z$1.ZodString>>;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    environmentId: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodOptional<z$1.ZodString>>>;
}, z$1.core.$strip>;
type ProjectFilesQuery = z$1.infer<typeof projectFilesQuerySchema>;
declare const projectPathsQuerySchema: z$1.ZodObject<{
    query: z$1.ZodOptional<z$1.ZodOptional<z$1.ZodString>>;
    limit: z$1.ZodOptional<z$1.ZodOptional<z$1.ZodString>>;
    includeFiles: z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>;
    includeDirectories: z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    environmentId: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodOptional<z$1.ZodString>>>;
}, z$1.core.$strip>;
type ProjectPathsQuery = z$1.infer<typeof projectPathsQuerySchema>;
declare const projectFileContentQuerySchema: z$1.ZodObject<{
    path: z$1.ZodString;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    environmentId: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodOptional<z$1.ZodString>>>;
}, z$1.core.$strip>;
type ProjectFileContentQuery = z$1.infer<typeof projectFileContentQuerySchema>;
declare const projectBranchesQuerySchema: z$1.ZodObject<{
    query: z$1.ZodOptional<z$1.ZodString>;
    limit: z$1.ZodOptional<z$1.ZodString>;
    hostId: z$1.ZodString;
    selectedBranch: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ProjectBranchesQuery = z$1.infer<typeof projectBranchesQuerySchema>;
declare const projectBranchesResponseSchema: z$1.ZodObject<{
    branches: z$1.ZodArray<z$1.ZodString>;
    branchesTruncated: z$1.ZodBoolean;
    checkout: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"branch">;
        branchName: z$1.ZodString;
        headSha: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"detached">;
        headSha: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"unborn">;
        branchName: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"unknown">;
        reason: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
    defaultBranch: z$1.ZodNullable<z$1.ZodString>;
    defaultBranchRelation: z$1.ZodNullable<z$1.ZodEnum<{
        unknown: "unknown";
        equal: "equal";
        "local-behind": "local-behind";
        "local-ahead": "local-ahead";
        diverged: "diverged";
    }>>;
    hasUncommittedChanges: z$1.ZodBoolean;
    operation: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"none">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"merge">;
        hasConflicts: z$1.ZodBoolean;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"rebase">;
        hasConflicts: z$1.ZodBoolean;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"cherry-pick">;
        hasConflicts: z$1.ZodBoolean;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"revert">;
        hasConflicts: z$1.ZodBoolean;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"unknown">;
        reason: z$1.ZodString;
        hasConflicts: z$1.ZodBoolean;
    }, z$1.core.$strip>], "kind">;
    originDefaultBranch: z$1.ZodNullable<z$1.ZodString>;
    remoteBranches: z$1.ZodArray<z$1.ZodString>;
    remoteBranchesTruncated: z$1.ZodBoolean;
    selectedBranch: z$1.ZodNullable<z$1.ZodObject<{
        name: z$1.ZodString;
        kind: z$1.ZodEnum<{
            local: "local";
            remote: "remote";
            missing: "missing";
        }>;
    }, z$1.core.$strip>>;
    defaultWorktreeBaseBranch: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type ProjectBranchesResponse = z$1.infer<typeof projectBranchesResponseSchema>;
declare const promptHistoryQuerySchema: z$1.ZodObject<{
    limit: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type PromptHistoryQuery = z$1.infer<typeof promptHistoryQ…99831 tokens truncated…d model does not support this
     * level, the composer reconciles to the closest supported one.
     */
    defaultReasoningLevel?: ReasoningLevel;
    /**
     * Seeds the service-tier picker. Same seed semantics as
     * {@link defaultProviderId}. Ignored (and omitted from the submitted
     * request) when the selected provider has no service tiers.
     */
    defaultServiceTier?: ServiceTier;
    /** Seeds the permission-mode picker. Same seed semantics as {@link defaultProviderId}. */
    defaultPermissionMode?: PermissionMode;
    /**
     * Seeds the environment and branch pickers from a previously submitted
     * `NewThreadRequest.environment`. Same seed semantics as
     * {@link defaultProviderId}: a seed the user can change, taking precedence
     * over the composer's own environment default when provided.
     *
     * Round trip: feeding a submitted request's `environment` back in and
     * resubmitting untouched reproduces an equivalent environment, with these
     * documented limits — the composer cannot represent every args variant:
     *
     * - `{ type: "project-default" }` seeds nothing; the composer resolves its
     *   own default and submits that concrete environment instead.
     * - A `host` environment whose host no longer exists (or whose project has
     *   no source on it) falls back to the composer's default host, exactly as
     *   the primary compose surface would.
     * - A `reuse` environment whose worktree no longer has unarchived threads
     *   falls back the same way.
     * - An `unmanaged` workspace's `path` has no composer control; the seeded
     *   selection submits `path: null` (the host's configured checkout). The
     *   composer itself never produces a non-null `path`, so real round trips
     *   are unaffected.
     * - A `managed-worktree` with `baseBranch: { kind: "default" }` leaves the
     *   branch picker on its default, which may resolve to a named base branch
     *   when the project configures a dedicated worktree base — the same branch
     *   the original `default` submission would have created from.
     */
    defaultEnvironment?: CreateThreadEnvironmentArgs;
    /** Seeds the draft, only while the draft is still empty. */
    initialPrompt?: string;
    placeholder?: string;
    /**
     * "contained" (default) fills and scrolls inside a bounded parent;
     * "document" grows with its content and defers scrolling to the page.
     */
    layout?: "contained" | "document";
    /** Bump to focus the editor. */
    focusRequest?: number;
    className?: string;
    /**
     * Where the draft persists. Drafts survive reloads and are shared by every
     * composer using the same key; defaults to a key scoped to this plugin.
     */
    draftKey?: string;
    /**
     * Fires on submit with every selection resolved. The draft clears when this
     * resolves and is KEPT if it throws, so a failed create never loses what the
     * user typed.
     */
    onSubmit: (request: NewThreadRequest) => void | Promise<void>;
}
/**
 * Props of the host-owned `Markdown` component — bb's chat message renderer
 * (the same typography, spacing, and code styling as timeline messages).
 * Use it wherever plugin UI quotes or previews message content so it reads
 * like the rest of the chat. Like `ThreadChat`, this is a stable product
 * capability, not a UI kit; renderer internals stay private.
 */
interface MarkdownProps {
    /** Markdown source, rendered exactly like a chat message body. */
    content: string;
    className?: string;
}
/** Current app selection, derived from the route. */
interface BbContext {
    projectId: string | null;
    threadId: string | null;
}
interface BbNavigate {
    toThread(threadId: string): void;
    toProject(projectId: string): void;
    /**
     * Navigate to one of this plugin's own nav panels by its `path`.
     * `subPath` targets a location inside the panel (the component's
     * `subPath` prop); `replace` swaps the current history entry instead of
     * pushing — use it for redirects so back does not bounce.
     */
    toPluginPanel(path: string, options?: {
        subPath?: string;
        replace?: boolean;
    }): void;
    /**
     * Navigate to the root compose surface (the new-thread screen). Pass
     * `initialPrompt` to seed the composer draft and `focusPrompt` to focus the
     * composer on arrival — the pairing behind "Create via chat" style entry
     * points that drop the user into chat with a prefilled prompt.
     */
    toCompose(options?: {
        initialPrompt?: string;
        focusPrompt?: boolean;
    }): void;
    /**
     * Open one of this plugin's registered thread-panel actions in the current
     * thread surface. Returns false when the surface has no thread side panel or
     * the action is unavailable.
     */
    openThreadPanel(options: {
        actionId: string;
        title?: string;
        params?: JsonValue;
    }): boolean;
}
/**
 * Everything `@get-bb/plugin-sdk/app` resolves to at runtime. The BB app builds
 * the real implementation and `satisfies` this interface; `bb plugin build`
 * shims the specifier to that object on `globalThis.__bbPluginRuntime`.
 */
interface PluginSdkApp {
    definePluginApp(setup: PluginAppSetup): PluginAppDefinition;
    useRpc<Contract extends PluginRpcContract = PluginRpcContract>(): PluginRpcClient<Contract>;
    useRealtime(channel: string, handler: (payload: unknown) => void): void;
    /**
     * Observe the same shared connection that delivers `useRealtime` signals.
     * Use a subsequent transition to `connected` to reconcile server state that
     * may have changed while ephemeral signals could not be delivered. The first
     * connection can transition from `connecting` and is not a reconnection.
     */
    useRealtimeConnectionState(): PluginRealtimeConnectionState;
    useSettings(): PluginSettingsState;
    useBbContext(): BbContext;
    useBbNavigate(): BbNavigate;
    useComposer(): PluginComposerApi;
    /**
     * The sidebar's live thread view (see {@link PluginSidebarThreadsState}).
     * Reads the host's own cache and realtime subscriptions, so it costs no
     * extra request and updates exactly when the built-in sidebar does.
     * Experimental: see docs/api_to_audit.md.
     */
    experimental_useSidebarThreads(): PluginSidebarThreadsState;
    /**
     * Thread actions bound to the host's mutations (see
     * {@link PluginSidebarThreadActions}). Experimental: see
     * docs/api_to_audit.md.
     */
    experimental_useSidebarThreadActions(): PluginSidebarThreadActions;
    /**
     * The pull request for one thread's branch (see
     * {@link PluginSidebarThreadPullRequestState}).
     *
     * Per row and opt-in, because it costs a git-host lookup: it is NOT on the
     * thread payload every sidebar loads. Threads sharing an environment share
     * one query, and the host owns the polling and staleness rules — an open PR
     * with pending checks refreshes, a merged one does not.
     *
     * Experimental: see docs/api_to_audit.md.
     */
    experimental_useSidebarThreadPullRequest(threadId: string): PluginSidebarThreadPullRequestState;
    /**
     * Per-row drag-to-split support (see {@link PluginSidebarThreadSplit}).
     * Call it once per rendered row, like the built-in sidebar does.
     * Experimental: see docs/api_to_audit.md.
     */
    experimental_useSidebarThreadSplit(threadId: string): PluginSidebarThreadSplit;
    /**
     * The host-owned chat component (see {@link ThreadChatProps}). Together
     * with `Markdown`, the only components the SDK ships — everything else
     * stays vendored per §5.5.
     */
    ThreadChat: ComponentType<ThreadChatProps>;
    /**
     * The host-owned chat-message markdown renderer (see
     * {@link MarkdownProps}).
     */
    Markdown: ComponentType<MarkdownProps>;
    /**
     * The host-owned new-thread compose surface (see
     * {@link NewThreadComposerProps}). Experimental: see
     * docs/api_to_audit.md for what to audit before the prefix drops.
     */
    experimental_NewThreadComposer: ComponentType<NewThreadComposerProps>;
    useComposerView(): ComposerView;
}

interface EnvironmentActionArgs {
    environmentId: string;
}
interface EnvironmentGetArgs extends EnvironmentActionArgs {
    signal?: AbortSignal;
}
type EnvironmentMergeBaseBranchUpdateValue = Exclude<UpdateEnvironmentRequest["mergeBaseBranch"], undefined>;
type EnvironmentNameUpdateValue = Exclude<UpdateEnvironmentRequest["name"], undefined>;
interface EnvironmentMergeBaseBranchUpdate {
    mergeBaseBranch: EnvironmentMergeBaseBranchUpdateValue;
    name?: EnvironmentNameUpdateValue;
}
interface EnvironmentNameUpdate {
    mergeBaseBranch?: EnvironmentMergeBaseBranchUpdateValue;
    name: EnvironmentNameUpdateValue;
}
type EnvironmentUpdateFields = EnvironmentMergeBaseBranchUpdate | EnvironmentNameUpdate;
type EnvironmentUpdateArgs = EnvironmentUpdateFields & {
    environmentId: string;
};
interface EnvironmentStatusArgs extends EnvironmentStatusQuery {
    environmentId: string;
    signal?: AbortSignal;
}
type EnvironmentDiffArgs = EnvironmentDiffQuery & {
    environmentId: string;
    signal?: AbortSignal;
};
type EnvironmentDiffFileArgs = EnvironmentDiffFileQuery & {
    environmentId: string;
    signal?: AbortSignal;
};
interface EnvironmentDiffBranchesArgs extends EnvironmentDiffBranchesQuery {
    environmentId: string;
    signal?: AbortSignal;
}
interface EnvironmentCommitArgs {
    environmentId: string;
}
interface EnvironmentSquashMergeArgs {
    environmentId: string;
    mergeBaseBranch: string;
}
interface EnvironmentPullRequestMergeArgs {
    environmentId: string;
    method: PullRequestMergeMethod;
}
type EnvironmentDiffPatchArgs = EnvironmentDiffPatchRequest & {
    environmentId: string;
    signal?: AbortSignal;
};
interface EnvironmentPathsArgs extends EnvironmentPathsQuery {
    environmentId: string;
    signal?: AbortSignal;
}
type EnvironmentArchiveThreadsResult = EnvironmentArchiveThreadsResponse;
type EnvironmentCommitResult = CommitActionResponse;
type EnvironmentDiffResult = EnvironmentDiffResponse;
type EnvironmentDiffBranchesResult = EnvironmentDiffBranchesResponse;
type EnvironmentDiffFileResult = EnvironmentDiffFileResponse;
type EnvironmentDiffFilesResult = EnvironmentDiffFilesResponse;
type EnvironmentDiffPatchResult = EnvironmentDiffPatchResponse;
type EnvironmentGetResult = Environment;
type EnvironmentMarkPullRequestDraftResult = PullRequestDraftActionResponse;
type EnvironmentMarkPullRequestReadyResult = PullRequestReadyActionResponse;
type EnvironmentMergePullRequestResult = PullRequestMergeActionResponse;
type EnvironmentPathsResult = WorkspacePathListResponse;
type EnvironmentPullRequestResult = EnvironmentPullRequestResponse;
type EnvironmentSquashMergeResult = SquashMergeActionResponse;
type EnvironmentStatusResult = EnvironmentStatusResponse;
type EnvironmentUpdateResult = Environment;
interface EnvironmentsArea {
    archiveThreads(args: EnvironmentActionArgs): Promise<EnvironmentArchiveThreadsResult>;
    commit(args: EnvironmentCommitArgs): Promise<EnvironmentCommitResult>;
    diff(args: EnvironmentDiffArgs): Promise<EnvironmentDiffResult>;
    diffBranches(args: EnvironmentDiffBranchesArgs): Promise<EnvironmentDiffBranchesResult>;
    diffFile(args: EnvironmentDiffFileArgs): Promise<EnvironmentDiffFileResult>;
    diffFiles(args: EnvironmentDiffArgs): Promise<EnvironmentDiffFilesResult>;
    diffPatch(args: EnvironmentDiffPatchArgs): Promise<EnvironmentDiffPatchResult>;
    get(args: EnvironmentGetArgs): Promise<EnvironmentGetResult>;
    pullRequest(args: EnvironmentGetArgs): Promise<EnvironmentPullRequestResult>;
    markPullRequestDraft(args: EnvironmentActionArgs): Promise<EnvironmentMarkPullRequestDraftResult>;
    markPullRequestReady(args: EnvironmentActionArgs): Promise<EnvironmentMarkPullRequestReadyResult>;
    mergePullRequest(args: EnvironmentPullRequestMergeArgs): Promise<EnvironmentMergePullRequestResult>;
    paths(args: EnvironmentPathsArgs): Promise<EnvironmentPathsResult>;
    squashMerge(args: EnvironmentSquashMergeArgs): Promise<EnvironmentSquashMergeResult>;
    status(args: EnvironmentStatusArgs): Promise<EnvironmentStatusResult>;
    update(args: EnvironmentUpdateArgs): Promise<EnvironmentUpdateResult>;
}

/**
 * Host file primitives. `hostId` may be omitted to target the server's
 * primary (local) host. `rootPath`, when set, confines the target beneath
 * that absolute root on the host (symlink-safe).
 */
interface FileReadArgs {
    hostId?: string;
    path: string;
    rootPath?: string;
    signal?: AbortSignal;
}
interface FileWriteArgs {
    hostId?: string;
    path: string;
    rootPath?: string;
    content: string;
    /** Defaults to "utf8". */
    contentEncoding?: "utf8" | "base64";
    /** Defaults to false. */
    createParents?: boolean;
    /**
     * Optimistic-concurrency guard: omitted → unconditional write; a hash →
     * write only when the current content hashes to it (use `read().sha256`);
     * null → create-only. A failed guard resolves to the `conflict` outcome.
     */
    expectedSha256?: string | null;
    /** POSIX permission bits used when creating a file (for example 0o600). */
    mode?: number;
}
interface FileListArgs {
    hostId?: string;
    path: string;
    query?: string;
    limit?: number;
    signal?: AbortSignal;
}
interface PathListArgs extends FileListArgs {
    includeFiles: boolean;
    includeDirectories: boolean;
}
interface FileMkdirArgs {
    hostId?: string;
    path: string;
    rootPath?: string;
    recursive?: boolean;
}
interface FileMoveArgs {
    hostId?: string;
    sourcePath: string;
    destinationPath: string;
    rootPath?: string;
}
interface FileRemoveArgs {
    hostId?: string;
    path: string;
    rootPath?: string;
    recursive?: boolean;
}
interface FilePreviewArgs {
    hostId?: string;
    rootPath: string;
    signal?: AbortSignal;
    ttlMs?: number;
}
type FileReadResult = HostFileReadResponse;
type FileWriteResult = HostFileWriteResponse;
type FileListResult = HostFileListResponse;
type PathListResult = HostPathListResponse;
type FileMkdirResult = HostMkdirResponse;
type FileMoveResult = HostMovePathResponse;
type FileRemoveResult = HostRemovePathResponse;
type FilePreviewResult = CreateFilePreviewResponse;
interface FilesArea {
    read(args: FileReadArgs): Promise<FileReadResult>;
    write(args: FileWriteArgs): Promise<FileWriteResult>;
    list(args: FileListArgs): Promise<FileListResult>;
    listPaths(args: PathListArgs): Promise<PathListResult>;
    mkdir(args: FileMkdirArgs): Promise<FileMkdirResult>;
    move(args: FileMoveArgs): Promise<FileMoveResult>;
    remove(args: FileRemoveArgs): Promise<FileRemoveResult>;
    createPreview(args: FilePreviewArgs): Promise<FilePreviewResult>;
}

interface GuideRenderArgs {
    chapter?: string;
}
interface GuideRenderResult {
    chapter?: string;
    content: string;
}
interface GuideArea {
    render(args?: GuideRenderArgs): GuideRenderResult;
}

interface HostGetArgs {
    hostId: string;
    signal?: AbortSignal;
}
interface HostDeleteArgs {
    hostId: string;
}
interface HostUpdateArgs extends UpdateHostRequest {
    hostId: string;
}
interface HostRetryUpdateArgs {
    hostId: string;
}
interface HostDirectoryArgs extends HostDirectoryQuery {
    hostId: string;
    signal?: AbortSignal;
}
interface HostCloneDefaultPathArgs extends HostCloneDefaultPathQuery {
    hostId: string;
    signal?: AbortSignal;
}
interface HostPathsExistArgs extends HostPathsExistRequest {
    hostId: string;
    signal?: AbortSignal;
}
interface HostPickFolderArgs extends HostPickFolderRequest {
    hostId: string;
    signal?: AbortSignal;
}
interface HostProviderCliInstallArgs extends HostProviderCliInstallRequest {
    hostId: string;
}
interface HostListArgs {
    signal?: AbortSignal;
}
type HostCreateJoinCodeResult = CreateHostJoinCodeResponse;
type HostDeleteResult = {
    ok: true;
};
type HostDirectoryResult = HostDirectoryListing;
type HostGetResult = Host;
type HostCloneDefaultPathResult = HostCloneDefaultPathResponse;
type HostProviderCliInstallResult = HostProviderCliInstallEvent[];
type HostListResult = Host[];
type HostPathsExistResult = HostPathsExistResponse;
type HostPickFolderResult = HostPickFolderResponse;
type HostProviderCliStatusResult = HostProviderCliStatusResponse;
type HostRetryUpdateResult = HostRetryUpdateResponse;
type HostUpdateResult = Host;
interface HostsArea {
    createJoinCode(): Promise<HostCreateJoinCodeResult>;
    delete(args: HostDeleteArgs): Promise<HostDeleteResult>;
    directory(args: HostDirectoryArgs): Promise<HostDirectoryResult>;
    get(args: HostGetArgs): Promise<HostGetResult>;
    cloneDefaultPath(args: HostCloneDefaultPathArgs): Promise<HostCloneDefaultPathResult>;
    installProviderCli(args: HostProviderCliInstallArgs): Promise<HostProviderCliInstallResult>;
    list(args?: HostListArgs): Promise<HostListResult>;
    pathsExist(args: HostPathsExistArgs): Promise<HostPathsExistResult>;
    pickFolder(args: HostPickFolderArgs): Promise<HostPickFolderResult>;
    providerCliStatus(args: HostGetArgs): Promise<HostProviderCliStatusResult>;
    retryUpdate(args: HostRetryUpdateArgs): Promise<HostRetryUpdateResult>;
    update(args: HostUpdateArgs): Promise<HostUpdateResult>;
}

interface ProjectListArgs {
    include?: ProjectListQuery["include"];
    /** Include the singleton personal project. Defaults to false for compatibility. */
    includePersonal?: boolean;
    signal?: AbortSignal;
}
interface ProjectCreateArgs extends CreateProjectRequest {
}
interface ProjectGetArgs {
    projectId: string;
    signal?: AbortSignal;
}
interface ProjectUpdateArgs extends UpdateProjectRequest {
    projectId: string;
}
interface ProjectDeleteArgs {
    projectId: string;
}
interface ProjectReorderArgs extends ReorderProjectRequest {
    projectId: string;
}
interface ProjectPromptHistoryArgs extends PromptHistoryQuery {
    projectId: string;
    signal?: AbortSignal;
}
/** Select one project workspace source, or omit both for the primary host. */
type ProjectWorkspaceRoutingArgs = {
    environmentId: string;
    hostId?: never;
} | {
    environmentId?: never;
    hostId: string;
} | {
    environmentId?: never;
    hostId?: never;
};
type ProjectFilesArgs = ProjectWorkspaceRoutingArgs & Omit<ProjectFilesQuery, "environmentId" | "hostId"> & {
    projectId: string;
    signal?: AbortSignal;
};
type ProjectPathsArgs = ProjectWorkspaceRoutingArgs & Omit<ProjectPathsQuery, "environmentId" | "hostId"> & {
    projectId: string;
    signal?: AbortSignal;
};
type ProjectCommandsArgs = ProjectWorkspaceRoutingArgs & Omit<ProjectCommandsQuery, "environmentId" | "hostId"> & {
    projectId: string;
    signal?: AbortSignal;
};
type ProjectFileContentArgs = ProjectWorkspaceRoutingArgs & Omit<ProjectFileContentQuery, "environmentId" | "hostId"> & {
    projectId: string;
    signal?: AbortSignal;
};
interface ProjectBranchesArgs extends ProjectBranchesQuery {
    projectId: string;
    signal?: AbortSignal;
}
interface ProjectDefaultExecutionOptionsArgs {
    projectId: string;
    signal?: AbortSignal;
}
interface ProjectAttachmentFileLike {
    arrayBuffer(): Promise<ArrayBuffer>;
    readonly name: string;
    readonly type?: string;
}
interface ProjectAttachmentUploadArgsBase {
    /** MIME override. Omit to use the File/Blob type, when available. */
    mimeType?: string;
    projectId: string;
}
/**
 * Upload bytes owned by this SDK client. A bare Blob/byte buffer needs an
 * explicit filename; File-like values can supply their own name.
 */
type ProjectAttachmentUploadArgs = ProjectAttachmentUploadArgsBase & ({
    clientFile: ProjectAttachmentFileLike;
    filename?: string;
} | {
    clientFile: ArrayBuffer | Blob | Uint8Array;
    filename: string;
});
interface ProjectAttachmentReadArgs {
    path: string;
    projectId: string;
    signal?: AbortSignal;
}
interface ProjectAttachmentCopyArgs extends CopyProjectAttachmentsRequest {
    projectId: string;
}
type ProjectSourceAddArgs = CreateProjectSourceRequest & {
    projectId: string;
};
interface ProjectSourceUpdateArgs extends UpdateProjectSourceRequest {
    projectId: string;
    sourceId: string;
}
interface ProjectSourceDeleteArgs {
    projectId: string;
    sourceId: string;
}
type ProjectBranchesResult = ProjectBranchesResponse;
interface ProjectAttachmentReadResult {
    bytes: Uint8Array;
    mimeType: string;
    sizeBytes: number;
}
type ProjectAttachmentUploadResult = UploadedPromptAttachment;
type ProjectCommandsResult = CommandListResponse;
type ProjectCreateResult = ProjectResponse;
type ProjectDefaultExecutionOptionsResult = ProjectExecutionDefaults | null;
type ProjectDeleteResult = {
    ok: true;
};
interface ProjectFileContentResult {
    /** UTF-8 text or base64, as selected by `contentEncoding`. */
    content: string;
    contentEncoding: "utf8" | "base64";
    mimeType: string;
    sizeBytes: number;
}
type ProjectFilesResult = WorkspaceFileListResponse;
type ProjectGetResult = ProjectResponse;
type ProjectListResult = ProjectResponse[] | ProjectWithThreadsResponse[];
type ProjectPathsResult = WorkspacePathListResponse;
type ProjectPromptHistoryResult = PromptHistoryResponse;
type ProjectReorderResult = ProjectResponse[];
type ProjectSourceAddResult = ProjectSource;
type ProjectSourceDeleteResult = {
    ok: true;
};
type ProjectSourceUpdateResult = ProjectSource;
type ProjectUpdateResult = ProjectResponse;
interface ProjectSourcesArea {
    add(args: ProjectSourceAddArgs): Promise<ProjectSourceAddResult>;
    delete(args: ProjectSourceDeleteArgs): Promise<ProjectSourceDeleteResult>;
    update(args: ProjectSourceUpdateArgs): Promise<ProjectSourceUpdateResult>;
}
interface ProjectAttachmentsArea {
    copy(args: ProjectAttachmentCopyArgs): Promise<void>;
    read(args: ProjectAttachmentReadArgs): Promise<ProjectAttachmentReadResult>;
    upload(args: ProjectAttachmentUploadArgs): Promise<ProjectAttachmentUploadResult>;
}
interface ProjectsArea {
    attachments: ProjectAttachmentsArea;
    branches(args: ProjectBranchesArgs): Promise<ProjectBranchesResult>;
    commands(args: ProjectCommandsArgs): Promise<ProjectCommandsResult>;
    create(args: ProjectCreateArgs): Promise<ProjectCreateResult>;
    defaultExecutionOptions(args: ProjectDefaultExecutionOptionsArgs): Promise<ProjectDefaultExecutionOptionsResult>;
    delete(args: ProjectDeleteArgs): Promise<ProjectDeleteResult>;
    fileContent(args: ProjectFileContentArgs): Promise<ProjectFileContentResult>;
    files(args: ProjectFilesArgs): Promise<ProjectFilesResult>;
    get(args: ProjectGetArgs): Promise<ProjectGetResult>;
    list(args?: ProjectListArgs): Promise<ProjectListResult>;
    paths(args: ProjectPathsArgs): Promise<ProjectPathsResult>;
    promptHistory(args: ProjectPromptHistoryArgs): Promise<ProjectPromptHistoryResult>;
    reorder(args: ProjectReorderArgs): Promise<ProjectReorderResult>;
    sources: ProjectSourcesArea;
    update(args: ProjectUpdateArgs): Promise<ProjectUpdateResult>;
}

/** Select exactly one provider-discovery host source, or omit both for primary. */
type ProviderHostRoutingArgs = {
    environmentId: string;
    hostId?: never;
} | {
    environmentId?: never;
    hostId: string;
} | {
    environmentId?: never;
    hostId?: never;
};
type ProviderListArgs = ProviderHostRoutingArgs & {
    signal?: AbortSignal;
};
type ProviderModelsArgs = ProviderHostRoutingArgs & {
    providerId?: string;
    signal?: AbortSignal;
};
type ProviderListResult = ProviderInfo[];
type ProviderModelsResult = SystemExecutionOptionsResponse;
interface ProvidersArea {
    /** List providers on the environment host, explicit host, or primary host. */
    list(args?: ProviderListArgs): Promise<ProviderListResult>;
    /** List models on the environment host, explicit host, or primary host. */
    models(args?: ProviderModelsArgs): Promise<ProviderModelsResult>;
}

interface PluginIdArgs {
    pluginId: string;
}
/** Install directly from a path:, git:, npm:, or builtin: source spec. */
interface PluginInstallArgs {
    /**
     * `path:<dir>`, `builtin:<name>`, `npm:<package>[@<version|tag|range>]`, or
     * `git:<url>[@<spec>]`. A git spec is one ref, or a semver range resolved
     * over the repository's `[<tagPrefix>]vX.Y.Z` release tags:
     * `git:<url>@semver:<range>` and `git:<url>@semver:<tagPrefix>:<range>` say
     * range explicitly, `git:<url>@ref:<name>` says ref explicitly, and a bare
     * `^1.2.0` resolves over tags unless the repository also has a ref of that
     * literal name (which is refused as ambiguous).
     */
    source: string;
    /**
     * Directory of a multi-plugin repository to install, relative to the
     * repository root (`git:` and `path:` sources only).
     */
    subdirectory?: string;
    /**
     * Name of a `.bb/plugins.json` collection entry to install, resolved to its
     * directory in the repository. Mutually exclusive with `subdirectory`.
     */
    plugin?: string;
}
/** Install a catalog entry, from BB's official catalog or another marketplace. */
interface PluginCatalogInstallArgs {
    entryId: string;
    /**
     * Marketplace that lists the entry. Omitted resolves across every
     * marketplace: exactly one match installs, none falls back to the bundled
     * official plugin of that name, and several are refused as ambiguous.
     */
    marketplace?: string;
    /**
     * Source facts returned by installPlan for a third-party entry. The server
     * refuses the install when the listing or its git commit changed afterward.
     */
    confirmedSource?: PluginCatalogResolvedSource;
}
/** Ask what an install would do before confirming it. */
interface PluginCatalogInstallPlanArgs {
    entryId: string;
    marketplace?: string;
    signal?: AbortSignal;
}
/** Add a marketplace by `https:` manifest URL, `git:<url>[@ref]`, or `path:<dir>`. */
interface PluginMarketplaceAddArgs {
    source: string;
}
interface PluginMarketplaceListArgs {
    signal?: AbortSignal;
}
interface PluginMarketplaceRefreshArgs {
    /** One marketplace to refresh; omitted refreshes every one of them. */
    name?: string;
    signal?: AbortSignal;
}
interface PluginMarketplaceRemoveArgs {
    name: string;
}
interface PluginReloadArgs {
    pluginId?: string;
}
interface PluginSettingsUpdateArgs extends PluginIdArgs {
    values: Record<string, JsonValue$1>;
}
interface PluginTokenArgs extends PluginIdArgs {
    rotate?: boolean;
}
interface PluginCheckUpdatesArgs {
    pluginId?: string;
    signal?: AbortSignal;
}
interface PluginRpcArgs<TOutput> extends PluginIdArgs {
    input?: JsonValue$1;
    method: string;
    outputSchema: z$1.ZodType<TOutput>;
}
interface PluginCatalogSearchArgs {
    query: string;
    signal?: AbortSignal;
}
interface PluginCatalogStatusArgs {
    signal?: AbortSignal;
}
interface PluginGetSettingsArgs extends PluginIdArgs {
    signal?: AbortSignal;
}
interface PluginGetSourceArgs extends PluginIdArgs {
    signal?: AbortSignal;
}
interface PluginListArgs {
    signal?: AbortSignal;
}
interface PluginListUpdateResultsArgs {
    signal?: AbortSignal;
}
type PluginDisableResult = InstalledPlugin;
type PluginEnableResult = InstalledPlugin;
type PluginGetSettingsResult = PluginSettingsResponse;
type PluginInstallResult = InstalledPlugin;
type PluginListResult = PluginListResponse;
type PluginReloadResult = PluginReloadResponse;
type PluginRemoveResult = PluginRemoveResponse;
type PluginTokenResult = PluginTokenResponse;
type PluginUpdateSettingsResult = PluginSettingsResponse;
type PluginGetSourceResult = PluginSourceDetail;
type PluginCheckUpdatesResult = PluginUpdateCheckEntry[];
type PluginApplyUpdateResult = PluginApplyUpdateResult$1;
type PluginCatalogStatusResult = PluginCatalogStatus;
type PluginCatalogSearchResult = PluginCatalogSearchResult$1[];
type PluginCatalogInstallPlanResult = PluginCatalogInstallPlan;
type PluginMarketplaceListResult = PluginMarketplace[];
type PluginMarketplaceAddResult = PluginMarketplace;
type PluginMarketplaceRefreshResult = PluginMarketplaceRefreshResult$1[];
interface PluginMarketplaceRemoveResult {
    /** Installs whose provenance became `direct`; they keep running as before. */
    convertedPluginIds: string[];
}
interface PluginCatalogArea {
    install(args: PluginCatalogInstallArgs): Promise<PluginInstallResult>;
    /** The true resolved source an install would use, before anything runs. */
    installPlan(args: PluginCatalogInstallPlanArgs): Promise<PluginCatalogInstallPlanResult>;
    search(args: PluginCatalogSearchArgs): Promise<PluginCatalogSearchResult>;
    status(args?: PluginCatalogStatusArgs): Promise<PluginCatalogStatusResult>;
}
/** Registered marketplaces. Adding one installs nothing; removing one uninstalls nothing. */
interface PluginMarketplacesArea {
    add(args: PluginMarketplaceAddArgs): Promise<PluginMarketplaceAddResult>;
    list(args?: PluginMarketplaceListArgs): Promise<PluginMarketplaceListResult>;
    refresh(args?: PluginMarketplaceRefreshArgs): Promise<PluginMarketplaceRefreshResult>;
    remove(args: PluginMarketplaceRemoveArgs): Promise<PluginMarketplaceRemoveResult>;
}
interface PluginsArea {
    applyUpdate(args: PluginIdArgs): Promise<PluginApplyUpdateResult>;
    callRpc<TOutput>(args: PluginRpcArgs<TOutput>): Promise<TOutput>;
    checkUpdates(args?: PluginCheckUpdatesArgs): Promise<PluginCheckUpdatesResult>;
    catalog: PluginCatalogArea;
    marketplaces: PluginMarketplacesArea;
    disable(args: PluginIdArgs): Promise<PluginDisableResult>;
    enable(args: PluginIdArgs): Promise<PluginEnableResult>;
    getSettings(args: PluginGetSettingsArgs): Promise<PluginGetSettingsResult>;
    getSource(args: PluginGetSourceArgs): Promise<PluginGetSourceResult>;
    install(args: PluginInstallArgs): Promise<PluginInstallResult>;
    list(args?: PluginListArgs): Promise<PluginListResult>;
    listUpdateResults(args?: PluginListUpdateResultsArgs): Promise<PluginCheckUpdatesResult>;
    reload(args?: PluginReloadArgs): Promise<PluginReloadResult>;
    remove(args: PluginIdArgs): Promise<PluginRemoveResult>;
    token(args: PluginTokenArgs): Promise<PluginTokenResult>;
    updateSettings(args: PluginSettingsUpdateArgs): Promise<PluginUpdateSettingsResult>;
}

type BbRealtimeUnsubscribe = () => void;
type BbRealtimeEventName = "thread:changed" | "project:changed" | "environment:changed" | "host:changed" | "system:changed" | "system:config-changed" | "realtime:connection";
type ThreadRealtimeEvent = Extract<ChangedMessage, {
    entity: "thread";
}>;
type ProjectRealtimeEvent = Extract<ChangedMessage, {
    entity: "project";
}>;
type EnvironmentRealtimeEvent = Extract<ChangedMessage, {
    entity: "environment";
}>;
type HostRealtimeEvent = Extract<ChangedMessage, {
    entity: "host";
}>;
type SystemRealtimeEvent = Extract<ChangedMessage, {
    entity: "system";
}>;
type BbRealtimeConnectionState = "connecting" | "connected" | "disconnected";
interface BbRealtimeConnectionEvent {
    reconnectDelayMs: number | null;
    reconnected: boolean;
    state: BbRealtimeConnectionState;
}
/**
 * Entity-changed events are delivered as one shared object to every matching
 * listener; their payload types are readonly so a listener cannot mutate what
 * the next listener receives.
 */
interface BbRealtimeEventMap {
    "thread:changed": ThreadRealtimeEvent;
    "project:changed": ProjectRealtimeEvent;
    "environment:changed": EnvironmentRealtimeEvent;
    "host:changed": HostRealtimeEvent;
    "system:changed": SystemRealtimeEvent;
    "system:config-changed": SystemRealtimeEvent;
    "realtime:connection": BbRealtimeConnectionEvent;
}
type BbRealtimeCallback<TEventName extends BbRealtimeEventName> = (event: BbRealtimeEventMap[TEventName]) => void;
interface ThreadRealtimeSubscribeArgs {
    callback: BbRealtimeCallback<"thread:changed">;
    event: "thread:changed";
    threadId?: string;
}
interface ProjectRealtimeSubscribeArgs {
    callback: BbRealtimeCallback<"project:changed">;
    event: "project:changed";
    projectId?: string;
}
interface EnvironmentRealtimeSubscribeArgs {
    callback: BbRealtimeCallback<"environment:changed">;
    environmentId?: string;
    event: "environment:changed";
}
interface HostRealtimeSubscribeArgs {
    callback: BbRealtimeCallback<"host:changed">;
    event: "host:changed";
    hostId?: string;
}
interface SystemRealtimeSubscribeArgs {
    callback: BbRealtimeCallback<"system:changed">;
    event: "system:changed";
}
interface SystemConfigRealtimeSubscribeArgs {
    callback: BbRealtimeCallback<"system:config-changed">;
    event: "system:config-changed";
}
/**
 * Connection listeners are pure observers — they never open or hold the
 * socket. A listener registered while a socket already exists receives the
 * latest connection event as a snapshot on the next microtask, so a status
 * UI mounted after connect still learns the current state.
 */
interface RealtimeConnectionSubscribeArgs {
    callback: BbRealtimeCallback<"realtime:connection">;
    event: "realtime:connection";
}
type BbRealtimeSubscribeArgsUnion = ThreadRealtimeSubscribeArgs | ProjectRealtimeSubscribeArgs | EnvironmentRealtimeSubscribeArgs | HostRealtimeSubscribeArgs | SystemRealtimeSubscribeArgs | SystemConfigRealtimeSubscribeArgs | RealtimeConnectionSubscribeArgs;
type BbRealtimeSubscribeArgs<TEventName extends BbRealtimeEventName = BbRealtimeEventName> = Extract<BbRealtimeSubscribeArgsUnion, {
    event: TEventName;
}>;
interface BbRealtime {
    subscribe<TEventName extends BbRealtimeEventName>(args: BbRealtimeSubscribeArgs<TEventName>): BbRealtimeUnsubscribe;
}

interface StatusGetArgs {
    projectId?: string;
    signal?: AbortSignal;
    threadId?: string;
}
interface StatusThreadSummary {
    environmentId: string | null;
    id: string;
    parentThreadId: string | null;
    pinnedAt: number | null;
    projectId: string;
    status: ThreadStatus;
    title: string | null;
}
type StatusProject = ProjectResponse;
type StatusChildThreads = ThreadListResponse;
interface StatusResult {
    childThreads: StatusChildThreads | null;
    pendingTodos: ThreadTimelinePendingTodos | null;
    project: StatusProject | null;
    thread: StatusThreadSummary | null;
}
interface StatusArea {
    get(args?: StatusGetArgs): Promise<StatusResult>;
}

interface SkillWorkspaceArgs {
    projectId: string;
    environmentId: string | null;
}
interface SkillListArgs extends SkillWorkspaceArgs {
    signal?: AbortSignal;
}
interface SkillIdentityArgs extends SkillListArgs {
    skillId: string;
}
interface SkillContentArgs extends SkillIdentityArgs {
    path: string;
}
interface SkillUpdateArgs extends SkillWorkspaceArgs {
    skillId: string;
    content: string;
    revision: string;
}
interface SkillDeleteArgs extends SkillWorkspaceArgs {
    skillId: string;
}
/**
 * Registry calls proxy out to skills.sh and GitHub, and the browse grid fans
 * out one per card. Callers pass their query's AbortSignal so abandoning a
 * page cancels its requests instead of leaving them in flight.
 */
interface AbortableArgs {
    signal?: AbortSignal;
}
interface RegistrySkillsSearchArgs extends AbortableArgs {
    query?: string;
    page?: number;
    perPage?: number;
}
interface RegistrySkillIdArgs extends AbortableArgs {
    registrySkillId: string;
}
interface RegistrySkillEntriesArgs extends AbortableArgs {
    registrySkillIds: readonly string[];
}
interface RegistrySkillSourceArgs extends AbortableArgs {
    source: string;
    skillId: string;
}
interface RegistryRepositoryArgs extends AbortableArgs {
    source: string;
}
/**
 * Install is a mutation and deliberately takes no signal: its body is parsed
 * with a strict schema, so an extra key would throw at runtime.
 */
interface RegistrySkillInstallArgs {
    registrySkillId: string;
}
interface SkillsRegistryArea {
    detail(args: RegistrySkillSourceArgs): Promise<RegistrySkillDetail>;
    entries(args: RegistrySkillEntriesArgs): Promise<RegistrySkillEntriesResponse>;
    get(args: RegistrySkillIdArgs): Promise<RegistrySkill>;
    install(args: RegistrySkillInstallArgs): Promise<RegistrySkillInstallResponse>;
    repositoryStars(args: RegistryRepositoryArgs): Promise<RegistryRepositoryStars>;
    search(args?: RegistrySkillsSearchArgs): Promise<RegistrySkillsPage>;
}
interface SkillsArea {
    getContent(args: SkillContentArgs): Promise<SkillContentResponse>;
    list(args: SkillListArgs): Promise<SkillListResponse>;
    listFiles(args: SkillIdentityArgs): Promise<SkillFilesResponse>;
    registry: SkillsRegistryArea;
    remove(args: SkillDeleteArgs): Promise<{
        deletedPath: string;
    }>;
    update(args: SkillUpdateArgs): Promise<{
        filePath: string;
        revision: string;
    }>;
}

type ThemeGetResult = AppTheme;
type ThemeCatalogResult = ThemeCatalogResponse;
type ThemeSetInput = AppThemeSelection;
type ThemeSetResult = AppTheme;
interface ThemeCatalogArgs {
    signal?: AbortSignal;
}
interface ThemeGetArgs {
    signal?: AbortSignal;
}
interface ThemeArea {
    /** The active app palette, resolved server-side (built-in id or custom CSS). */
    get(args?: ThemeGetArgs): Promise<ThemeGetResult>;
    /** The custom-theme directory plus discovered themes and the active palette. */
    catalog(args?: ThemeCatalogArgs): Promise<ThemeCatalogResult>;
    /** Set the complete app appearance selection in one request. */
    set(selection: ThemeSetInput): Promise<ThemeSetResult>;
    /**
     * Activate a palette by id while preserving the active favicon color. This
     * compatibility shorthand reads the active appearance before writing the
     * complete selection; prefer the object form when both values are known.
     */
    set(themeId: string): Promise<ThemeSetResult>;
}

interface SystemAttentionArgs {
    signal?: AbortSignal;
}
interface SystemConfigArgs {
    signal?: AbortSignal;
}
interface SystemExecutionOptionsArgs extends SystemExecutionOptionsQuery {
    signal?: AbortSignal;
}
interface SystemUsageLimitsArgs extends SystemUsageLimitsQuery {
    signal?: AbortSignal;
}
interface SystemVersionArgs {
    force?: boolean;
    signal?: AbortSignal;
}
interface SystemVoiceTranscriptionArgs {
    file: Blob;
    prompt?: string;
    signal?: AbortSignal;
}
type SystemAttentionResult = SystemAttentionResponse;
type SystemConfigResult = SystemConfigResponse;
type SystemExecutionOptionsResult = SystemExecutionOptionsResponse;
type SystemReloadConfigResult = SystemConfigReloadResponse;
type SystemInstallCliSkillsArgs = SystemInstallCliSkillsRequest;
interface SystemCliSkillsStatusArgs {
    /** Omit for every enrolled machine. */
    hostIds?: readonly string[];
    signal?: AbortSignal;
}
type SystemCliSkillsStatusResult = SystemCliSkillsStatusResponse;
type SystemInstallCliSkillsResult = SystemInstallCliSkillsResponse;
type SystemVoiceTranscriptionResult = SystemVoiceTranscriptionResponse;
type SystemUpdateExperimentsResult = Experiments;
type SystemUpdateGeneralSettingsResult = AppSettings;
type SystemUpdateKeyboardSettingsResult = AppKeybindingOverrides;
type SystemUsageLimitsResult = ProviderUsageResponse;
interface SystemOnboardingArgs extends SystemProvidersQuery {
    signal?: AbortSignal;
}
interface SystemOnboardingReposArgs extends SystemOnboardingReposQuery {
    signal?: AbortSignal;
}
type SystemOnboardingAgentsResult = OnboardingAgentOverview;
type SystemOnboardingReposResult = DiscoverReposResult;
type SystemVersionResult = SystemVersionResponse;
interface SystemArea {
    attention(args?: SystemAttentionArgs): Promise<SystemAttentionResult>;
    config(args?: SystemConfigArgs): Promise<SystemConfigResult>;
    executionOptions(args?: SystemExecutionOptionsArgs): Promise<SystemExecutionOptionsResult>;
    /**
     * Copy bb's built-in CLI skills into each named machine's global agent skill
     * roots (`~/.agents/skills` and `~/.claude/skills`). Machines install
     * independently; the result reports each machine's outcome.
     */
    /** Per-machine install state of bb's built-in CLI skills. */
    cliSkillsStatus(args?: SystemCliSkillsStatusArgs): Promise<SystemCliSkillsStatusResult>;
    installCliSkills(args: SystemInstallCliSkillsArgs): Promise<SystemInstallCliSkillsResult>;
    reloadConfig(): Promise<SystemReloadConfigResult>;
    transcribeVoice(args: SystemVoiceTranscriptionArgs): Promise<SystemVoiceTranscriptionResult>;
    updateExperiments(args: Experiments): Promise<SystemUpdateExperimentsResult>;
    updateGeneralSettings(args: AppSettings): Promise<SystemUpdateGeneralSettingsResult>;
    updateKeyboardSettings(args: AppKeybindingOverrides): Promise<SystemUpdateKeyboardSettingsResult>;
    /** Report one onboarding funnel event to anonymous telemetry. */
    onboardingEvent(args: OnboardingTelemetryEvent): Promise<{
        ok: true;
    }>;
    /** Live agent state for onboarding: install, auth, and plan per provider. */
    onboardingAgents(args?: SystemOnboardingArgs): Promise<SystemOnboardingAgentsResult>;
    /** Candidate projects discovered on the host, ranked for onboarding. */
    onboardingRepos(args?: SystemOnboardingReposArgs): Promise<SystemOnboardingReposResult>;
    usageLimits(args?: SystemUsageLimitsArgs): Promise<SystemUsageLimitsResult>;
    version(args?: SystemVersionArgs): Promise<SystemVersionResult>;
}

interface TerminalThreadScope {
    cwd?: never;
    environmentId?: never;
    hostId?: never;
    kind: "thread";
    threadId: string;
}
interface TerminalEnvironmentScope {
    environmentId: string;
    cwd?: never;
    hostId?: never;
    kind: "environment";
    threadId?: never;
}
interface TerminalHostPathListScope {
    /** Optional exact initial working-directory filter on the selected host. */
    cwd?: string;
    environmentId?: never;
    hostId: string;
    kind: "host_path";
    threadId?: never;
}
interface TerminalHostPathCreateScope {
    /** Null starts in the selected host's home directory. */
    cwd: string | null;
    environmentId?: never;
    hostId: string;
    kind: "host_path";
    threadId?: never;
}
type TerminalListScope = TerminalThreadScope | TerminalEnvironmentScope | TerminalHostPathListScope;
type TerminalCreateScope = TerminalThreadScope | TerminalEnvironmentScope | TerminalHostPathCreateScope;
interface TerminalListArgs {
    signal?: AbortSignal;
    scope: TerminalListScope;
}
interface TerminalCreateArgs {
    cols: number;
    rows: number;
    scope: TerminalCreateScope;
    start?: CreateTerminalRequest["start"];
    title?: string;
}
interface TerminalTargetArgs {
    terminalId: string;
}
interface TerminalGetArgs extends TerminalTargetArgs {
    signal?: AbortSignal;
}
interface TerminalRenameArgs extends TerminalTargetArgs {
    title: UpdateTerminalRequest["title"];
}
interface TerminalCloseArgs extends TerminalTargetArgs {
    mode: "force" | "if-clean";
}
interface TerminalInputArgs extends TerminalTargetArgs {
    dataBase64: TerminalInputRequest["dataBase64"];
}
interface TerminalResizeArgs extends TerminalTargetArgs {
    cols: TerminalResizeRequest["cols"];
    rows: TerminalResizeRequest["rows"];
}
interface TerminalOutputArgs extends TerminalTargetArgs {
    limitChunks?: TerminalOutputQuery["limitChunks"];
    signal?: AbortSignal;
    sinceSeq?: TerminalOutputQuery["sinceSeq"];
    tailBytes?: TerminalOutputQuery["tailBytes"];
}
type TerminalRestartArgs = TerminalTargetArgs;
type TerminalListResult = TerminalListResponse;
type TerminalCreateResult = TerminalSession;
type TerminalGetResult = TerminalSession;
type TerminalRenameResult = TerminalSession;
type TerminalCloseResult = TerminalSession;
type TerminalInputResult = TerminalSession;
type TerminalResizeResult = TerminalSession;
type TerminalOutputResult = TerminalOutputResponse;
type TerminalRestartResult = TerminalSession;
interface TerminalsArea {
    close(args: TerminalCloseArgs): Promise<TerminalCloseResult>;
    create(args: TerminalCreateArgs): Promise<TerminalCreateResult>;
    get(args: TerminalGetArgs): Promise<TerminalGetResult>;
    input(args: TerminalInputArgs): Promise<TerminalInputResult>;
    list(args: TerminalListArgs): Promise<TerminalListResult>;
    output(args: TerminalOutputArgs): Promise<TerminalOutputResult>;
    rename(args: TerminalRenameArgs): Promise<TerminalRenameResult>;
    /**
     * Replace a terminal with a shell at the same scope, size, and title.
     * The server serializes concurrent restarts and opens the replacement before
     * closing the old session, so a failed open leaves the old terminal running.
     * The original command is not replayed because terminal sessions do not
     * persist launch commands. The replacement has a new terminal ID.
     */
    restart(args: TerminalRestartArgs): Promise<TerminalRestartResult>;
    resize(args: TerminalResizeArgs): Promise<TerminalResizeResult>;
}

interface ThreadListArgs {
    archived?: boolean;
    sectionId?: string;
    hasParent?: boolean;
    includeHidden?: boolean;
    limit?: number;
    offset?: number;
    originKind?: ThreadListQuery["originKind"];
    originPluginId?: string;
    parentThreadId?: string;
    projectId?: string;
    signal?: AbortSignal;
    sourceThreadId?: string;
    unsectioned?: boolean;
}
interface ThreadSearchArgs extends ThreadSearchQuery {
    signal?: AbortSignal;
}
interface ThreadResolveMentionsArgs extends ResolveThreadMentionsRequest {
    signal?: AbortSignal;
}
interface ThreadGetArgs {
    include?: ThreadGetQuery["include"];
    signal?: AbortSignal;
    threadId: string;
}
type ThreadGetResult = ThreadResponse | ThreadWithIncludesResponse;
type ThreadListResult = ThreadListResponse;
type ThreadSearchResult = ThreadSearchResponse;
type ThreadResolveMentionsResult = ResolveThreadMentionsResponse;
interface ThreadOutputResponse {
    output: string | null;
}
type ThreadMutationResult = ThreadResponse;
type ThreadSpawnResult = ThreadResponse;
type ThreadForkResult = ThreadResponse;
type ThreadInteractionGetResult = PendingInteraction;
type ThreadInteractionListResult = ThreadPendingInteractionsResponse;
type ThreadInteractionResolveResult = PendingInteraction;
type ThreadInteractionRespondResult = PendingInteraction;
type ThreadInteractionCancelResult = PendingInteraction;
type ThreadEventsListResult = ThreadEventRow[];
type ThreadEventWaitResult = ThreadEventRow | null;
type ThreadTimelineResult = ThreadTimelineResponse;
type ThreadArchiveResult = ThreadArchiveAllResponse;
type ThreadOpenResult = ThreadOpenResponse;
type ThreadPaneActionResult = ThreadPaneActionResponse;
type ThreadDeleteResult = {
    ok: true;
};
type ThreadSendResult = {
    ok: true;
};
type ThreadRateLimitRecoveryResult = ProviderRateLimitRecoveryStatus;
type ThreadContinueAfterRateLimitResult = ContinueAfterProviderRateLimitResponse;
type ThreadEditMessageResult = EditMessageResponse;
type ThreadStopResult = {
    ok: true;
};
type ThreadCompactResult = {
    ok: true;
};
type ThreadBannerActionResult = {
    ok: true;
};
type ThreadUnarchiveResult = {
    ok: true;
};
type ThreadArchiveAllResult = ThreadArchiveAllResponse;
type ThreadReadStateResult = ThreadResponse;
type ThreadPinOrderResult = ThreadListResponse;
type ThreadPromptHistoryResult = PromptHistoryResponse;
type ThreadQueuedMessagesResult = ThreadQueuedMessageListResponse;
type ThreadQueuedMessageCreateResult = ThreadQueuedMessage;
type ThreadQueuedMessageUpdateResult = ThreadQueuedMessage;
type ThreadQueuedMessageDeleteResult = {
    ok: true;
};
type ThreadQueuedMessageReorderResult = ThreadQueuedMessageListResponse;
type ThreadQueuedMessageSendResult = SendQueuedMessageResponse;
type ThreadQueuedMessageGroupBoundaryResult = ThreadQueuedMessageListResponse;
type ThreadTabsResult = ThreadTabsResponse;
type ThreadTabsUpdateResult = ThreadTabsResponse;
type ThreadStorageFilesResult = ThreadStorageFileListResponse;
type ThreadStoragePathsResult = ThreadStoragePathListResponse;
type ThreadChildSummaryResult = ThreadChildSummaryResponse;
type ThreadDefaultExecutionOptionsResult = ResolvedThreadExecutionOptions | null;
type ThreadConversationOutlineResult = ThreadConversationOutlineResponse;
type ThreadTimelineTurnSummaryDetailsResult = TimelineTurnSummaryDetailsResponse;
interface ThreadSpawnBaseArgs extends Omit<CreateThreadRequest, "input" | "origin" | "originKind" | "startedOnBehalfOf"> {
    origin?: CreateThreadRequest["origin"];
    originKind?: CreateThreadRequest["originKind"];
    startedOnBehalfOf?: CreateThreadRequest["startedOnBehalfOf"];
}
type ThreadSpawnArgs = ThreadSpawnBaseArgs & ({
    input: CreateThreadRequest["input"];
    prompt?: never;
} | {
    input?: never;
    prompt: string;
});
interface ThreadForkArgs extends Omit<ForkThreadRequest, "origin" | "visibility" | "workspace"> {
    origin?: ForkThreadRequest["origin"];
    visibility?: ForkThreadRequest["visibility"];
    workspace?: ForkThreadRequest["workspace"];
}
interface ThreadUpdateArgs extends UpdateThreadRequest {
    threadId: string;
}
interface ThreadDeleteArgs extends DeleteThreadRequest {
    threadId: string;
}
interface ThreadSendArgs extends SendMessageRequest {
    threadId: string;
}
interface ThreadEditMessageArgs extends EditMessageRequest {
    threadId: string;
}
interface ThreadActionArgs {
    threadId: string;
}
interface ThreadContinueAfterRateLimitArgs extends ThreadActionArgs {
    failedRequestId: string;
    mode: NonNullable<ContinueAfterProviderRateLimitRequest["mode"]>;
}
interface ThreadStatusArgs extends ThreadActionArgs {
    signal?: AbortSignal;
}
interface ThreadPromptHistoryArgs extends PromptHistoryQuery {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadPinOrderArgs extends ReorderPinnedThreadRequest {
    threadId: string;
}
interface ThreadQueuedMessageArgs {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadQueuedMessageCreateArgs extends CreateQueuedMessageRequest {
    threadId: string;
}
interface ThreadQueuedMessageUpdateArgs extends ThreadQueuedMessageTargetArgs, UpdateQueuedMessageRequest {
}
interface ThreadQueuedMessageTargetArgs {
    queuedMessageId: string;
    threadId: string;
}
interface ThreadQueuedMessageSendArgs extends ThreadQueuedMessageTargetArgs, SendQueuedMessageRequest {
}
interface ThreadQueuedMessageReorderArgs extends ThreadQueuedMessageTargetArgs, ReorderQueuedMessageRequest {
}
interface ThreadQueuedMessageGroupBoundaryArgs extends SetQueuedMessageGroupBoundaryRequest {
    threadId: string;
}
interface ThreadStorageFilesArgs extends ThreadStorageFilesQuery {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadStoragePathsArgs extends ThreadStoragePathsQuery {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadTimelineTurnSummaryDetailsArgs extends TimelineTurnSummaryDetailsQuery {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadTabsUpdateArgs extends UpdateThreadTabsRequest {
    threadId: string;
}
interface ThreadOpenArgs {
    threadId: string;
    split?: ThreadOpenSplit;
    file: ThreadOpenFile | null;
}
interface ThreadPaneActionArgs {
    action: ThreadPaneAction;
    threadId: string;
}
interface ThreadEventsListArgs {
    afterSeq?: string;
    limit?: string;
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadEventWaitArgs {
    afterSeq?: string;
    signal?: AbortSignal;
    threadId: string;
    type: string;
    waitMs: string;
}
interface ThreadTimelineArgs extends ThreadTimelineQuery {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadOutputArgs {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadInteractionListArgs {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadInteractionTargetArgs {
    interactionId: string;
    threadId: string;
}
interface ThreadInteractionGetArgs extends ThreadInteractionTargetArgs {
    signal?: AbortSignal;
}
interface ThreadInteractionResolveArgs extends ThreadInteractionTargetArgs {
    resolution: PendingInteractionResolution;
}
interface ThreadInteractionRespondArgs extends ThreadInteractionTargetArgs {
    value: JsonValue$1;
}
type ThreadWaitTarget = {
    kind: "status";
    status: ThreadStatus;
} | {
    kind: "event";
    eventType: string;
};
interface ThreadWaitArgs {
    event?: string;
    pollIntervalMs?: number;
    signal?: AbortSignal;
    status?: ThreadStatus;
    threadId: string;
    timeoutMs?: number;
}
type ThreadWaitResult = {
    event: NonNullable<ThreadEventWaitResult>;
    matched: true;
    target: Extract<ThreadWaitTarget, {
        kind: "event";
    }>;
    threadId: string;
} | {
    matched: true;
    target: Extract<ThreadWaitTarget, {
        kind: "status";
    }>;
    thread: ThreadGetResult;
    threadId: string;
};
interface ThreadInteractionsArea {
    cancel(args: ThreadInteractionTargetArgs): Promise<ThreadInteractionCancelResult>;
    get(args: ThreadInteractionGetArgs): Promise<ThreadInteractionGetResult>;
    list(args: ThreadInteractionListArgs): Promise<ThreadInteractionListResult>;
    resolve(args: ThreadInteractionResolveArgs): Promise<ThreadInteractionResolveResult>;
    respond(args: ThreadInteractionRespondArgs): Promise<ThreadInteractionRespondResult>;
}
interface ThreadEventsArea {
    list(args: ThreadEventsListArgs): Promise<ThreadEventsListResult>;
    wait(args: ThreadEventWaitArgs): Promise<ThreadEventWaitResult>;
}
interface ThreadQueuedMessagesArea {
    create(args: ThreadQueuedMessageCreateArgs): Promise<ThreadQueuedMessageCreateResult>;
    delete(args: ThreadQueuedMessageTargetArgs): Promise<ThreadQueuedMessageDeleteResult>;
    list(args: ThreadQueuedMessageArgs): Promise<ThreadQueuedMessagesResult>;
    reorder(args: ThreadQueuedMessageReorderArgs): Promise<ThreadQueuedMessageReorderResult>;
    send(args: ThreadQueuedMessageSendArgs): Promise<ThreadQueuedMessageSendResult>;
    setGroupBoundary(args: ThreadQueuedMessageGroupBoundaryArgs): Promise<ThreadQueuedMessageGroupBoundaryResult>;
    update(args: ThreadQueuedMessageUpdateArgs): Promise<ThreadQueuedMessageUpdateResult>;
}
interface ThreadTabsArea {
    get(args: ThreadStatusArgs): Promise<ThreadTabsResult>;
    update(args: ThreadTabsUpdateArgs): Promise<ThreadTabsUpdateResult>;
}
interface ThreadsArea {
    archive(args: ThreadActionArgs): Promise<ThreadArchiveResult>;
    archiveAll(args: ThreadActionArgs): Promise<ThreadArchiveAllResult>;
    childSummary(args: ThreadStatusArgs): Promise<ThreadChildSummaryResult>;
    continueAfterRateLimit(args: ThreadContinueAfterRateLimitArgs): Promise<ThreadContinueAfterRateLimitResult>;
    compact(args: ThreadActionArgs): Promise<ThreadCompactResult>;
    cancelPlan(args: ThreadActionArgs): Promise<ThreadBannerActionResult>;
    clearGoal(args: ThreadActionArgs): Promise<ThreadBannerActionResult>;
    conversationOutline(args: ThreadStatusArgs): Promise<ThreadConversationOutlineResult>;
    defaultExecutionOptions(args: ThreadStatusArgs): Promise<ThreadDefaultExecutionOptionsResult>;
    delete(args: ThreadDeleteArgs): Promise<ThreadDeleteResult>;
    editMessage(args: ThreadEditMessageArgs): Promise<ThreadEditMessageResult>;
    events: ThreadEventsArea;
    fork(args: ThreadForkArgs): Promise<ThreadForkResult>;
    get(args: ThreadGetArgs): Promise<ThreadGetResult>;
    interactions: ThreadInteractionsArea;
    list(args?: ThreadListArgs): Promise<ThreadListResult>;
    markRead(args: ThreadActionArgs): Promise<ThreadReadStateResult>;
    markUnread(args: ThreadActionArgs): Promise<ThreadReadStateResult>;
    open(args: ThreadOpenArgs): Promise<ThreadOpenResult>;
    paneAction(args: ThreadPaneActionArgs): Promise<ThreadPaneActionResult>;
    output(args: ThreadOutputArgs): Promise<ThreadOutputResponse>;
    pin(args: ThreadActionArgs): Promise<ThreadMutationResult>;
    promptHistory(args: ThreadPromptHistoryArgs): Promise<ThreadPromptHistoryResult>;
    queuedMessages: ThreadQueuedMessagesArea;
    rateLimitRecovery(args: ThreadStatusArgs): Promise<ThreadRateLimitRecoveryResult>;
    reorderPinned(args: ThreadPinOrderArgs): Promise<ThreadPinOrderResult>;
    resolveMentions(args: ThreadResolveMentionsArgs): Promise<ThreadResolveMentionsResult>;
    search(args: ThreadSearchArgs): Promise<ThreadSearchResult>;
    send(args: ThreadSendArgs): Promise<ThreadSendResult>;
    spawn(args: ThreadSpawnArgs): Promise<ThreadSpawnResult>;
    /**
     * Stop active work and release the loaded agent runtime. This operation is
     * idempotent and preserves thread history for a later resume.
     */
    stop(args: ThreadActionArgs): Promise<ThreadStopResult>;
    tabs: ThreadTabsArea;
    timeline(args: ThreadTimelineArgs): Promise<ThreadTimelineResult>;
    timelineTurnSummaryDetails(args: ThreadTimelineTurnSummaryDetailsArgs): Promise<ThreadTimelineTurnSummaryDetailsResult>;
    storageFiles(args: ThreadStorageFilesArgs): Promise<ThreadStorageFilesResult>;
    storagePaths(args: ThreadStoragePathsArgs): Promise<ThreadStoragePathsResult>;
    unarchive(args: ThreadActionArgs): Promise<ThreadUnarchiveResult>;
    unpin(args: ThreadActionArgs): Promise<ThreadMutationResult>;
    update(args: ThreadUpdateArgs): Promise<ThreadMutationResult>;
    wait(args: ThreadWaitArgs): Promise<ThreadWaitResult>;
}

type ThreadSectionCreateResult = ThreadSectionResponse;
type ThreadSectionUpdateResult = ThreadSectionMutationResponse;
type ThreadSectionDeleteResult = ThreadSectionMutationResponse;
type ThreadSectionListResult = ThreadSectionResponse[];
interface ThreadSectionListArgs {
    signal?: AbortSignal;
}
interface ThreadSectionsArea {
    create(args: CreateThreadSectionRequest): Promise<ThreadSectionCreateResult>;
    delete(args: DeleteThreadSectionRequest): Promise<ThreadSectionDeleteResult>;
    list(args?: ThreadSectionListArgs): Promise<ThreadSectionListResult>;
    update(args: UpdateThreadSectionRequest): Promise<ThreadSectionUpdateResult>;
}

interface BbSdk extends BbRealtime {
    environments: EnvironmentsArea;
    files: FilesArea;
    guide: GuideArea;
    hosts: HostsArea;
    projects: ProjectsArea;
    plugins: PluginsArea;
    providers: ProvidersArea;
    skills: SkillsArea;
    status: StatusArea;
    system: SystemArea;
    terminals: TerminalsArea;
    theme: ThemeArea;
    threadSections: ThreadSectionsArea;
    threads: ThreadsArea;
}

interface ExperimentalHostSignalContract<PayloadSchema extends StandardSchemaV1 = StandardSchemaV1> {
    readonly payload: PayloadSchema;
}
type ExperimentalHostSignals = Readonly<Record<string, ExperimentalHostSignalContract>>;
interface ExperimentalHostCallOptions {
    readonly hostId: string;
    readonly signal?: AbortSignal;
}
interface ExperimentalHostClient<Contract extends PluginRpcContract, Signals extends ExperimentalHostSignals = {}> {
    call<MethodName extends keyof Contract & string>(method: MethodName, input: StandardSchemaV1InferInput<Contract[MethodName]["input"]>, options: ExperimentalHostCallOptions): Promise<PluginRpcResult<Contract[MethodName]>>;
    /**
     * Subscribe to unexpected exits of this plugin's worker on a host daemon.
     * Graceful reload, disable, uninstall, and daemon shutdown do not emit this
     * event. A later call starts a fresh worker.
     */
    experimental_onWorkerExit(handler: (event: {
        readonly hostId: string;
    }) => void | Promise<void>): () => void;
    /** Subscribe to a validated, ephemeral signal from this plugin's host entry. */
    experimental_onSignal<SignalName extends keyof Signals & string>(signal: SignalName, handler: (event: ExperimentalHostSignalEvent<Signals, SignalName>) => void | Promise<void>): () => void;
}
interface ExperimentalHostSignalEvent<Signals extends ExperimentalHostSignals, SignalName extends keyof Signals & string> {
    readonly hostId: string;
    readonly payload: StandardSchemaV1InferOutput<Signals[SignalName]["payload"]>;
}
interface ExperimentalHostPaths {
    /** Persistent directory scoped to this plugin on this daemon. */
    readonly dataDir: string;
    /** Temporary directory scoped to this worker process. */
    readonly tempDir: string;
}
type ExperimentalHostWatchChangeType = "create" | "update" | "delete";
interface ExperimentalHostWatchChange {
    readonly path: string;
    readonly type: ExperimentalHostWatchChangeType;
}
type ExperimentalHostWatchEvent = {
    readonly kind: "changed";
    readonly changes: readonly ExperimentalHostWatchChange[];
} | {
    readonly kind: "rescan-required";
} | {
    readonly kind: "watch-error";
    readonly message: string;
};
interface ExperimentalHostWatchOptions {
    /** Absolute directory observed by the daemon's native watcher service. */
    readonly rootPath: string;
    /** Root-relative ignore entries using the native watcher syntax. */
    readonly ignoredPaths?: readonly string[];
    /** Quiet period before one coalesced delivery. Defaults to 75 ms. */
    readonly debounceMs?: number;
    /** Maximum time changes may wait. Defaults to 500 ms. */
    readonly maxWaitMs?: number;
}
interface ExperimentalHostWatchSubscription {
    dispose(): Promise<void>;
}
interface ExperimentalHostWorkerLease {
    /** Release this worker-retention lease. Safe to call more than once. */
    dispose(): Promise<void>;
}
type ExperimentalHostWatchListener = (event: ExperimentalHostWatchEvent) => void | Promise<void>;
interface ExperimentalHostRpcContext<Signals extends ExperimentalHostSignals = {}> {
    /** Aborted when this request is cancelled or its worker is disposed. */
    readonly signal: AbortSignal;
    /** Aborted once for the lifetime of this worker process. */
    readonly lifecycle: {
        readonly signal: AbortSignal;
    };
    readonly experimental_paths: ExperimentalHostPaths;
    /** Publish a validated, ephemeral event to this plugin's server entry. */
    experimental_emitSignal<SignalName extends keyof Signals & string>(signal: SignalName, payload: StandardSchemaV1InferInput<Signals[SignalName]["payload"]>): Promise<void>;
    /** Observe raw filesystem changes through the daemon's native watcher. */
    experimental_watch(options: ExperimentalHostWatchOptions, listener: ExperimentalHostWatchListener): Promise<ExperimentalHostWatchSubscription>;
    /**
     * Keep this worker alive after the current call finishes. Active calls and
     * filesystem watches already retain it; use this only for other background
     * work. The daemon may stop an unretained worker after an idle period.
     */
    experimental_retainWorker(): ExperimentalHostWorkerLease;
}
type ExperimentalHostRpcHandlers<Contract extends PluginRpcContract, Signals extends ExperimentalHostSignals = {}> = {
    [MethodName in keyof Contract]: (input: StandardSchemaV1InferOutput<Contract[MethodName]["input"]>, context: ExperimentalHostRpcContext<Signals>) => StandardSchemaV1InferInput<Contract[MethodName]["output"]> | Promise<StandardSchemaV1InferInput<Contract[MethodName]["output"]>>;
};
interface ExperimentalHostEntry<Contract extends PluginRpcContract = PluginRpcContract, Signals extends ExperimentalHostSignals = {}> {
    readonly experimental_apiVersion: 1;
    readonly contract: Contract;
    readonly experimental_signals?: Signals;
    readonly handlers: ExperimentalHostRpcHandlers<Contract, Signals>;
    readonly dispose?: () => void | Promise<void>;
}
/** Define the single host executable exported by `bb.host`. */
declare function experimental_defineHostEntry<const Contract extends PluginRpcContract, const Signals extends ExperimentalHostSignals = {}>(args: {
    contract: Contract;
    experimental_signals?: Signals;
    handlers: ExperimentalHostRpcHandlers<Contract, Signals>;
    dispose?: () => void | Promise<void>;
}): ExperimentalHostEntry<Contract, Signals>;

/**
 * The backend plugin API contract — the `bb` object handed to a plugin's
 * `server.ts` factory (`export default function plugin(bb: BbPluginApi)`).
 *
 * Types only: the implementation lives in the BB server
 * (apps/server/src/services/plugins/plugin-api.ts), which imports these
 * shapes so the contract and the implementation cannot drift. Plugin authors
 * import them type-only (`import type { BbPluginApi } from
 * "@get-bb/plugin-sdk"`); the import is erased when BB loads the file.
 *
 * Runtime classes stay host-side. NeedsConfigurationError in particular is
 * matched by NAME, so plugin code needs no runtime import:
 * `throw Object.assign(new Error(msg), { name: "NeedsConfigurationError" })`.
 */
interface PluginLogger {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}
/**
 * Declarative settings descriptors (`bb.settings.define`). Deliberately plain
 * data — not zod — so the host can render settings forms and the CLI can
 * parse values without executing plugin code.
 */
type PluginSettingDescriptor = {
    type: "string";
    label: string;
    description?: string;
    /** Stored in a 0600 file under <dataDir>/plugins/<id>/secrets/, never in the db or sent to the frontend. */
    secret?: true;
    default?: string;
} | {
    type: "boolean";
    label: string;
    description?: string;
    default?: boolean;
} | {
    type: "select";
    label: string;
    description?: string;
    options: string[];
    default?: string;
} | {
    type: "project";
    label: string;
    description?: string;
    default?: string;
};
type PluginSettingDescriptors = Record<string, PluginSettingDescriptor>;
type PluginSettingValue = string | boolean;
/** `default` present → non-optional value; absent → `T | undefined`. */
type PluginSettingsValues<Ds extends Record<string, PluginSettingDescriptor>> = {
    [K in keyof Ds]: Ds[K] extends {
        default: string | boolean;
    } ? PluginSettingValueOf<Ds[K]> : PluginSettingValueOf<Ds[K]> | undefined;
};
type PluginSettingValueOf<D extends PluginSettingDescriptor> = D extends {
    type: "boolean";
} ? boolean : string;
interface PluginSettingsHandle<Ds extends Record<string, PluginSettingDescriptor>> {
    /** Load-safe: callable inside the factory. */
    get(): Promise<PluginSettingsValues<Ds>>;
    /** Fires after values change through the settings route/CLI. */
    onChange(listener: (next: PluginSettingsValues<Ds>, prev: PluginSettingsValues<Ds>) => void): void;
}
interface PluginSettings {
    define<Ds extends Record<string, PluginSettingDescriptor>>(descriptors: Ds): PluginSettingsHandle<Ds>;
}
interface PluginKvStorage {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    list(prefix?: string): Promise<string[]>;
}
interface PluginStorage {
    /** Namespaced JSON key-value rows in bb.db; values ≤256KB each. */
    kv: PluginKvStorage;
    /**
     * Open (or reuse the path of) the plugin's own SQLite database at
     * <dataDir>/plugins/<id>/data.db — the server's better-sqlite3, WAL mode,
     * busy_timeout 5000. Handles are host-tracked and closed on
     * dispose/reload; a closed handle throws on use.
     */
    database(): Database.Database;
    /**
     * Ordered-statement migration helper: statement index = migration id in a
     * `_bb_migrations` table; unapplied statements run in one transaction.
     * Append-only — never reorder or edit shipped statements.
     */
    migrate(db: Database.Database, statements: string[]): void;
}
/**
 * Thread lifecycle events a plugin can observe (design §4.5). Observe-only:
 * handlers run fire-and-forget after the transition is applied and can never
 * block or veto it. `thread` is the same public DTO GET /threads/:id serves.
 */
interface PluginThreadEventPayloads {
    /** Fired after a thread row is created. */
    "thread.created": {
        thread: ThreadResponse;
    };
    /** Fired when a thread transitions into `active`. */
    "thread.active": {
        thread: ThreadResponse;
    };
    /** Fired when a thread transitions into `idle`. `lastAssistantText` is
     * assembled the same way GET /threads/:id/output is. */
    "thread.idle": {
        thread: ThreadResponse;
        lastAssistantText: string | null;
    };
    /** Fired when a thread transitions into `error`. `error` is the latest
     * system/error event message, when one exists. */
    "thread.failed": {
        thread: ThreadResponse;
        error: string | null;
    };
    /** Fired after a thread is archived (including cascade archives). */
    "thread.archived": {
        thread: ThreadResponse;
    };
    /** Fired after a thread is soft-deleted. */
    "thread.deleted": {
        thread: ThreadResponse;
    };
}
type PluginThreadEventName = keyof PluginThreadEventPayloads;
type PluginThreadEventHandler<E extends PluginThreadEventName> = (payload: PluginThreadEventPayloads[E]) => void | Promise<void>;
type PluginHttpAuthMode = "local" | "token" | "none";
type PluginHttpHandler = (context: Context) => Response | Promise<Response>;
interface PluginHttp {
    /**
     * Register an HTTP route, mounted at
     * `/api/v1/plugins/<id>/http/<path>`. Auth modes (default "local"):
     * - "local": Origin/Host must be a local BB app origin; non-GET requires
     *   content-type application/json (forces a CORS preflight).
     * - "token": requires the per-plugin token (`bb plugin token <id>`) via
     *   the x-bb-plugin-token header or ?token=.
     * - "none": no checks — only for signature-verified webhooks.
     */
    route(method: string, path: string, handler: PluginHttpHandler, opts?: {
        auth?: PluginHttpAuthMode;
    }): void;
}
interface PluginRpc {
    /**
     * Register a Standard Schema-driven rpc contract and its inferred handlers,
     * served at POST
     * `/api/v1/plugins/<id>/rpc/<method>` with "local" auth semantics. The
     * host validates input before invocation and output before strict JSON
     * serialization. The response is `{ ok: true, result }` or
     * `{ ok: false, error: { code, message, issues? } }`.
     */
    register<Contract extends PluginRpcContract>(contract: Contract, handlers: PluginRpcHandlers<Contract>): void;
}
interface PluginRealtime {
    /**
     * Broadcast an ephemeral `plugin-signal` WS message
     * `{ pluginId, channel, payload }` to every connected client (V1 has no
     * per-channel subscriptions). `payload` must be JSON-serializable;
     * `undefined` is normalized to `null`. Nothing is persisted.
     */
    publish(channel: string, payload: unknown): void;
}
interface PluginBackground {
    /**
     * Register a long-lived background service. `start` runs after the
     * factory completes and should resolve when `signal` aborts
     * (dispose/reload/disable/shutdown). A crash restarts it with capped
     * exponential backoff; throwing NeedsConfigurationError marks the plugin
     * `needs-configuration` and stops restarting until the next load.
     */
    service(name: string, service: {
        start(signal: AbortSignal): void | Promise<void>;
    }): void;
    /**
     * Register a cron schedule (5-field expression, server-local time). The
     * durable row keyed (pluginId, name) is upserted at load; the periodic
     * sweep claims due rows with a CAS on next_run_at, but only while this
     * plugin is loaded. Failures land in last_status/last_error, visible in
     * `bb plugin list`.
     */
    schedule(name: string, cron: string, fn: () => void | Promise<void>): void;
}
interface PluginCliCommandInfo {
    name: string;
    summary: string;
    usage: string;
}
/** Context forwarded from the invoking CLI when known; all fields optional. */
interface PluginCliContext {
    cwd?: string;
    threadId?: string;
    projectId?: string;
    /** Aborted when the invoking CLI HTTP request disconnects. */
    signal?: AbortSignal;
}
type PluginInteractionCancelReason = "user" | "request-aborted" | "thread-stopped" | "thread-deleted" | "plugin-disposed" | "server-restarted" | "timeout";
type PluginInteractionResult = {
    outcome: "submitted";
    value: JsonValue;
} | {
    outcome: "cancelled";
    reason: PluginInteractionCancelReason;
};
interface PluginInteractionRequest {
    threadId: string;
    rendererId: string;
    title: string;
    payload: JsonValue;
    /** Defaults to ten minutes; capped at one hour. */
    timeoutMs?: number;
}
interface PluginCliResult {
    exitCode: number;
    stdout?: string;
    stderr?: string;
}
/**
 * Maximum combined UTF-8 bytes accepted from plugin CLI stdout and stderr.
 * This is the shared source of truth for production and the testing harness.
 */
declare const PLUGIN_CLI_OUTPUT_MAX_BYTES: number;
interface PluginCliOutputLimitError {
    code: "plugin_cli_output_too_large";
    message: string;
    maxBytes: number;
    stdoutBytes: number;
    stderrBytes: number;
    totalBytes: number;
}
/** Normalized host result returned by the plugin CLI HTTP/testing boundary. */
interface PluginCliExecutionResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    error?: PluginCliOutputLimitError;
}
interface PluginCliRegistration {
    /** Top-level command name (`bb <name> …`): lowercase [a-z0-9-]+, and not
     * a core bb command (see RESERVED_BB_CLI_COMMANDS in the server). */
    name: string;
    summary: string;
    /** Subcommand metadata rendered in help and the plugin-commands skill
     * without executing plugin code. Parsing argv is plugin-owned. */
    commands?: PluginCliCommandInfo[];
    run(argv: string[], ctx: PluginCliContext): PluginCliResult | Promise<PluginCliResult>;
}
interface PluginCli {
    /**
     * Register this plugin's `bb` subcommand. One registration per factory
     * execution; a repeated call is rejected. Core bb commands always win
     * name collisions; reserved names are rejected at registration.
     */
    register(registration: PluginCliRegistration): void;
}
/** Per-turn context handed to bb.agents context providers (design §4.4). */
/** MCP-style content parts a native tool may return (design §4.4). */
type PluginAgentToolContentPart = {
    type: "text";
    text: string;
} | {
    type: "image";
    data: string;
    mimeType: string;
};
type PluginAgentToolResult = string | {
    content: PluginAgentToolContentPart[];
    isError?: boolean;
};
/** Per-call context handed to a native tool's execute (design §4.4). */
interface PluginAgentToolContext {
    threadId: string;
    projectId: string;
    /** The tool-call request's abort signal (aborts if the daemon round-trip
     * is torn down mid-call). */
    signal: AbortSignal;
}
/**
 * Native timeline labels for a plugin tool, keyed by BB's own timeline row
 * status. This is experimental: BB may refine its presentation contract
 * before the field is stabilized.
 */
interface PluginAgentToolExperimentalStatusLabels {
    /** Label shown while the tool call is pending. */
    pending: string;
    /** Label shown after the tool call completes successfully. */
    completed: string;
}
interface PluginAgentToolRegistrationBase {
    /** Tool name shown to the model: [a-zA-Z0-9_-]+, unique across plugins,
     * and not a built-in dynamic tool (see RESERVED_AGENT_TOOL_NAMES in the
     * server). */
    name: string;
    description: string;
    /**
     * Optional usage snippet appended to the thread instructions whenever
     * this tool is in the session's tool set (mirrors the built-in
     * update_environment_directory guidance). Limited to 4096 characters.
     */
    instructions?: string;
    /**
     * Optional native timeline labels. When omitted, BB shows the standard
     * tool name and arguments (for example, `Ran tool search_docs …`). Labels
     * apply only while the call is pending and after successful completion;
     * approval, error, and interruption states keep BB's standard rendering.
     */
    experimental_statusLabels?: PluginAgentToolExperimentalStatusLabels;
}
/** Stable, plain-data context resolved by the server for one agent session. */
interface PluginAgentConfigurationContext {
    thread: {
        id: string;
        title: string | null;
        parentThreadId: string | null;
        sourceThreadId: string | null;
    };
    project: {
        id: string;
        kind: "standard" | "personal";
        name: string;
        gitRemoteUrl: string | null;
    };
    environment: {
        id: string;
        name: string | null;
        path: string | null;
        workspaceProvisionType: "unmanaged" | "managed-worktree" | "personal";
        branchName: string | null;
    };
    host: {
        id: string;
        name: string;
    };
    provider: {
        id: string;
        model: string;
        /**
         * The provider's declared capabilities, so a plugin can decide what to
         * contribute from what the provider says it does rather than from its own
         * copy of a provider id list.
         */
        capabilities: {
            /**
             * The provider ships its own user-question affordance and bb routes it
             * into the pending-interaction path. A plugin offering the same thing
             * should withhold it here, or the model gets two ways to ask once.
             */
            supportsNativeUserQuestion: boolean;
        };
    };
    /** How the thread was spawned. A side chat is the builtin side-chat
     * plugin's fork: `{ kind: "fork", pluginId: "side-chat" }`. */
    origin: {
        kind: "fork" | null;
        pluginId: string | null;
    };
}
/** Object form of a {@link PluginAgentConfiguration} tools entry: selects a
 * registered tool and overrides the parameter schema advertised to the
 * provider for this resolution only. */
interface PluginAgentToolSelection {
    /** Name of a tool registered by this plugin via `registerTool`. */
    name: string;
    /** JSON-schema object (root `type: "object"`, JSON-serializable, at most
     * 128 KiB serialized) sent to the provider in place of the registered
     * parameter schema. Execution-side validation still runs the registered
     * parameters, so the override must only narrow what the registered schema
     * already accepts. */
    parameters: Record<string, unknown>;
}
/** Per-resolution selection returned by {@link PluginAgents.configure}. */
interface PluginAgentConfiguration {
    /** Tool names registered by this plugin, or {@link PluginAgentToolSelection}
     * entries to also override a tool's advertised parameter schema for this
     * resolution. Duplicate or unknown names, or an invalid override, reject
     * this plugin's complete selection for the resolution. */
    tools: Array<string | PluginAgentToolSelection>;
    /** Skill frontmatter names from this plugin's manifest skill roots.
     * Duplicate or unknown names reject this plugin's complete selection. */
    skills: string[];
    /** Optional dynamic instructions. Output is truncated to 4096 characters. */
    instructions?: string;
}
/**
 * Permission modes a provider can run a session in — BB's own permission
 * vocabulary, ordered least ("accept-edits") to most ("full") privileged.
 */
type PluginProviderPermissionMode = "accept-edits" | "auto" | "full";
/**
 * Coarse reasoning-effort ladder entries, ordered lowest to highest. The
 * declared ladder is a fallback only: precise per-model reasoning sets come
 * from the provider's model list at runtime.
 */
type PluginProviderReasoningLevel = "none" | "low" | "medium" | "high" | "xhigh" | "ultracode" | "max" | "ultra";
/**
 * Composer actions a provider supports, by name only. The skills
 * slash-command typeahead is universal — BB injects skills into every
 * provider — so it is implicit and never declared, and the composer owns the
 * trigger syntax (`/plan `, `/goal `) rather than each declaration repeating
 * it.
 */
type PluginProviderComposerAction = "plan" | "goal";
/**
 * Pre-session capability facts about a provider. A capability earns a field
 * here only when it passes BOTH tests: (1) a consumer outside the provider's
 * own plugin needs the fact, and (2) the fact is needed before / without a
 * live session (picker rendering, route gating, cross-plugin tool
 * composition — including with the host offline). Every boolean is a
 * provider-native fact — the provider implements the feature; the flag only
 * tells external consumers it exists. Everything else is a handshake fact the
 * bridge reports at `initialize`, where it cannot drift from behavior.
 */
interface PluginProviderCapabilities {
    /** The provider accepts a fast/priority service-tier choice — shows the
     * service-tier toggle in the picker. */
    supportsServiceTier: boolean;
    /** The provider ships its own native ask-user-question tool — the
     * ask-user-question plugin skips registering its duplicate. */
    supportsNativeUserQuestion: boolean;
    /**
     * How completely the provider can clone a session: `"none"` (not at all),
     * `"tip"` (only the current end, so thread fork works but edit-past-message
     * rewind cannot), or `"checkpoint"` (recreate the session at an earlier
     * point, which rewind needs). Gates the fork and edit-past-message
     * affordances. The bridge reports the same fact at `initialize`, where it
     * may narrow this declaration but never widen it.
     */
    fork: ProviderFork;
    /** The provider accepts an explicit context-compaction request — gates the
     * compact affordance. */
    supportsManualCompaction: boolean;
    /** The provider keeps its own thread archive, so BB mirrors archive and
     * unarchive onto it instead of tracking the state only in bb's own rows. */
    supportsThreadArchive: boolean;
    /** The provider stores a thread name of its own, so BB forwards renames to
     * it. */
    supportsThreadRename: boolean;
    /** The provider can run BB's Workflow tools — gates the workflows opt-in on
     * new threads. */
    supportsWorkflows: boolean;
    /** Permission modes the provider can actually run in. Non-empty, no
     * duplicates. */
    permissionModes: readonly PluginProviderPermissionMode[];
    /** The provider's coarse fallback reasoning ladder (see
     * {@link PluginProviderReasoningLevel}). Non-empty, no duplicates. */
    reasoningLevels: readonly PluginProviderReasoningLevel[];
}
/**
 * One provider this plugin contributes to BB's provider registry.
 *
 * Ids are stable public identifiers — thread rows and routes reference them —
 * and are collision-rejected: a declaration whose id matches another plugin's
 * live registration, or reserves a first-party provider it does not own, is
 * refused. Registrations are replaced wholesale on plugin reload, like every
 * other plugin surface.
 *
 * A declaration is metadata only. The implementation is the plugin's own
 * provider bridge, named by `bb.providerBridge` in the manifest and built into
 * the artifact BB ships to hosts — declaring a provider without one is
 * refused, because the picker entry would exist and no turn on it could ever
 * run.
 */
interface PluginProviderDeclaration {
    /** Stable provider id: 2–64 characters of lowercase letters, digits, and
     * "-", starting with a letter or digit. Existing ids must never change —
     * threads persist them. */
    id: string;
    /** Picker display name: 1–80 characters, non-blank. */
    displayName: string;
    /**
     * Optional picker icon, in the same grammar as `bb.branding.icon`: either a
     * named host glyph (`"Zap"`) or a plugin-relative path starting with `"./"`
     * (`"./icons/agent.svg"`). Paths follow the manifest entry-path escape rules
     * — no leading "/", no ".." segments, no backslashes.
     */
    icon?: string;
    /** Pre-session capability facts (see the declaration tests on
     * {@link PluginProviderCapabilities}). */
    capabilities: PluginProviderCapabilities;
    /** Composer actions this provider supports. No duplicates; may be empty
     * (the universal skills typeahead is implicit). */
    composerActions: readonly PluginProviderComposerAction[];
}
interface PluginAgents {
    /**
     * Select this plugin's statically registered tools and manifest skills for
     * each thread/session resolution, with optional dynamic instructions. The
     * callback is synchronous and runs at `thread.start` / `turn.submit`; it
     * never rebuilds registrations. Exactly one callback may be registered per
     * factory execution. A throw, malformed result, duplicate id, unknown id,
     * or more than 256 tool/skill ids fails closed for this plugin only.
     *
     * Tools take effect when the provider session is next started or resumed;
     * an already-running session is not hot-mutated. Instructions follow the
     * same boundary: a live provider session keeps the instructions it was
     * constructed with, and a changed selection applies when the session is
     * next constructed. Skill changes follow BB's environment runtime policy:
     * a busy runtime keeps its current catalog until a safe relaunch. Side chats
     * are ordinary plugin-owned forks here — read `origin` to detect them — and
     * their returned tool, skill, and dynamic-instruction selections apply at the
     * same boundaries.
     */
    configure(provider: (context: PluginAgentConfigurationContext) => PluginAgentConfiguration): void;
    /**
     * Register a native dynamic tool (design §4.4). `parameters` is either a
     * zod schema (validated per call; execute receives the parsed value) or a
     * plain JSON-schema object (no validation; execute receives the raw
     * arguments as `unknown`). Tool-set changes apply on the NEXT session
     * start — a tool registered mid-session is not hot-added to running
     * provider sessions. A second registration of the same name within this
     * plugin is rejected; a name already registered by another plugin is
     * rejected and surfaced as this plugin's status detail.
     */
    registerTool<Schema extends z.ZodType>(tool: PluginAgentToolRegistrationBase & {
        parameters: Schema;
        execute(params: z.output<Schema>, ctx: PluginAgentToolContext): PluginAgentToolResult | Promise<PluginAgentToolResult>;
    }): void;
    registerTool(tool: PluginAgentToolRegistrationBase & {
        /** Raw JSON-schema escape hatch; params arrive unvalidated. */
        parameters: Record<string, unknown>;
        execute(params: unknown, ctx: PluginAgentToolContext): PluginAgentToolResult | Promise<PluginAgentToolResult>;
    }): void;
    /**
     * Contribute a dynamic section appended to thread instructions. The
     * provider runs when a thread's runtime command config is resolved
     * (thread.start / turn.submit); return null to contribute nothing for
     * that resolution. A live provider session keeps the instructions it was
     * constructed with — a changed contribution takes effect when the
     * provider session is next constructed (thread start or resume after a
     * daemon restart, environment switch, or provider restart), never
     * mid-session. Must be synchronous and fast — it sits on the
     * thread-start path. Output longer than 4096 characters is truncated; a
     * throwing provider is logged against the plugin and contributes nothing.
     * A repeated registration within one factory execution is rejected.
     */
    contributeInstructions(provider: (ctx: {
        threadId: string;
        projectId: string;
    }) => string | null): void;
    /**
     * Register an agent provider this plugin contributes (experimental — see
     * docs/api_to_audit.md before relying on it). The declaration is validated
     * at call time; the provider joins the server's provider registry when the
     * plugin load commits and then appears in provider listings. Ids are stable
     * and collision-rejected: an id already claimed by a core provider or
     * another plugin fails this plugin's load. A plugin may register several
     * providers and may re-register after `dispose()` (a settings-driven
     * re-declaration); registrations are replaced wholesale on plugin reload,
     * like every other surface. The disposer removes the registration.
     */
    experimental_registerProvider(declaration: PluginProviderDeclaration): {
        dispose(): void;
    };
}
type PluginMentionTrigger = "@" | "#" | "$" | "!" | "~";
/** Search context handed to a mention provider (design §4.9). `projectId`/
 * `threadId` are null when the composer has not committed one yet. */
interface PluginMentionSearchContext {
    trigger: PluginMentionTrigger;
    query: string;
    projectId: string | null;
    threadId: string | null;
}
/** One row a mention provider returns from `search`. `id` is the provider's
 * own item id — the host namespaces it before it reaches the wire. */
interface PluginMentionItem {
    id: string;
    title: string;
    subtitle?: string;
    icon?: string;
}
interface PluginMentionProviderRegistration {
    /** Unique within this plugin: [a-zA-Z0-9_-]+ (no ":" — the host composes
     * wire item ids as "<providerId>:<itemId>"). */
    id: string;
    /** Section label shown above this provider's rows in the mention menu. */
    label: string;
    /**
     * Composer trigger characters this provider should answer. Omit to use the
     * default `@` mention trigger. Valid triggers are `@`, `#`, `$`, `!`, and `~`.
     */
    triggers?: readonly PluginMentionTrigger[];
    /**
     * Runs server-side as the user types after one of this provider's triggers
     * in the composer. Each call is time-boxed (2s) and failure-isolated: a slow
     * or throwing provider contributes an empty list — it can never break the
     * mention menu.
     */
    search(ctx: PluginMentionSearchContext): PluginMentionItem[] | Promise<PluginMentionItem[]>;
    /**
     * Resolves one picked item into agent context, called once per unique
     * item at message send time. The returned `context` is attached to the
     * message as an agent-visible (user-hidden) prompt input. Throwing blocks
     * the send with a visible error.
     */
    resolve(itemId: string): {
        context: string;
    } | Promise<{
        context: string;
    }>;
}
interface PluginUi {
    /** Block until the app submits or cancels a plugin-owned composer form. */
    requestInput(request: PluginInteractionRequest, options?: {
        signal?: AbortSignal;
    }): Promise<PluginInteractionResult>;
    /**
     * Register a mention provider for the shipped app's composer (design §4.9).
     * Providers default to the `@` trigger and may opt into `#`, `$`, `!`, or
     * `~` with `triggers`. Items group under `label` in the mention menu; a
     * picked item becomes a `{ kind: "plugin" }` mention resource whose context
     * is resolved once at send time. Multiple providers per plugin; ids must be
     * unique within the plugin.
     */
    registerMentionProvider(provider: PluginMentionProviderRegistration): void;
}
interface PluginEvents {
    /**
     * Add a thread lifecycle listener. Multiple listeners for the same event are
     * additive and run independently in registration order.
     */
    on<E extends PluginThreadEventName>(event: E, handler: PluginThreadEventHandler<E>): void;
}
interface PluginServerApi {
    /**
     * This BB server's own loopback base URL (e.g. "http://127.0.0.1:38886"),
     * which serves the SPA + /api + /ws. For plugins that proxy or relay
     * traffic back to the server itself (e.g. a tunnel). Bind-gated like
     * `bb.sdk`: reading it before the server is listening throws, so prefer
     * reading it from handlers, services, and timers.
     */
    readonly loopbackBaseUrl: string;
}
interface PluginSharedPortTunnelIdentity {
    /** Gate routing label assigned to this machine. */
    label: string;
    /** Gate apex without a scheme, e.g. "getbb.app". */
    baseDomain: string;
}
interface PluginHosts {
    /** Create the owning plugin's typed client for its singular `bb.host` entry. */
    experimental_client<Contract extends PluginRpcContract, Signals extends ExperimentalHostSignals = {}>(args: {
        contract: Contract;
        experimental_signals?: Signals;
    }): ExperimentalHostClient<Contract, Signals>;
    /**
     * Ensure this enrolled host has a gate label and return its read-only public
     * identity. The daemon chooses the trusted gate and desired label; plugins
     * cannot influence either credential-bearing destination.
     */
    ensureSharedPortTunnel(hostId: string): Promise<PluginSharedPortTunnelIdentity>;
    /**
     * Replace this plugin's desired shared-loopback ports for one host. The
     * server aggregates declarations, owns generations, and delivers the
     * resulting set to that host's daemon. Tunnel identity is deliberately not
     * accepted here: it is owned by the daemon's trusted enrollment.
     */
    declareSharedPorts(hostId: string, ports: readonly number[]): void;
}
interface PluginStatusApi {
    /**
     * Mark this plugin `needs-configuration` (with a message shown in
     * `bb plugin list` and the UI) instead of failing — e.g. a factory or
     * service that finds no API key configured. Cleared on the next load;
     * saving settings does not auto-reload in V1, so ask the user to
     * `bb plugin reload <id>` after configuring.
     */
    needsConfiguration(message: string): void;
}
/**
 * The API object handed to a plugin's factory (design §4). Implemented by
 * the BB server; this contract is what plugin `server.ts` files compile
 * against.
 */
interface BbPluginApi {
    /** The plugin's own id (namespaces storage, routes, commands). */
    readonly pluginId: string;
    /** Leveled, plugin-scoped logger. */
    readonly log: PluginLogger;
    /** Declarative settings (design §4.2). */
    readonly settings: PluginSettings;
    /** Namespaced KV + per-plugin database (design §4.3). */
    readonly storage: PluginStorage;
    /** HTTP routes under /api/v1/plugins/<id>/http/* (design §4.6). */
    readonly http: PluginHttp;
    /** RPC methods under /api/v1/plugins/<id>/rpc/<method> (design §4.6). */
    readonly rpc: PluginRpc;
    /** Ephemeral push to connected frontends (design §4.7). */
    readonly realtime: PluginRealtime;
    /** Long-lived services + cron schedules (design §4.8). */
    readonly background: PluginBackground;
    /** Agent-facing `bb` CLI subcommand (design §4.4). */
    readonly cli: PluginCli;
    /** Per-turn agent context contributions (design §4.4). */
    readonly agents: PluginAgents;
    /** Host-rendered UI contributions (design §4.9). */
    readonly ui: PluginUi;
    /** Additive plugin lifecycle listeners (design §4.5). */
    readonly events: PluginEvents;
    /** Plugin-reported status (needs-configuration). */
    readonly status: PluginStatusApi;
    /** Read-only facts about the running server (loopback base URL). */
    readonly server: PluginServerApi;
    /** Server-to-daemon host control-plane declarations. */
    readonly hosts: PluginHosts;
    /**
     * The full BB SDK, bound to this server over loopback (design §4.1).
     * Bind-gated: reading this before the host binds the SDK throws. The real
     * server binds it before loading plugins, so it is available from the
     * moment factories run there — but isolated harnesses may not, so prefer
     * using it from handlers, services, and timers for portability.
     * `threads.spawn` defaults `origin` to "plugin" and `originPluginId` to
     * this plugin's id so spawned threads are attributed automatically.
     */
    readonly sdk: BbSdk;
    /**
     * Register cleanup to run on reload/disable/shutdown. Hooks run LIFO.
     * The sanctioned place to clear timers and close connections.
     */
    onDispose(hook: () => void | Promise<void>): void;
}

export { PLUGIN_CLI_OUTPUT_MAX_BYTES, defineRpcContract, experimental_defineHostEntry };
export type { BbContext, BbNavigate, BbPluginApi, ComposerCustomization, ComposerPlusMenuItem, ComposerRichTextSpec, ComposerStructuredDraft, ComposerView, ExperimentalHostCallOptions, ExperimentalHostClient, ExperimentalHostEntry, ExperimentalHostPaths, ExperimentalHostRpcContext, ExperimentalHostRpcHandlers, ExperimentalHostSignalContract, ExperimentalHostSignalEvent, ExperimentalHostSignals, ExperimentalHostWatchChange, ExperimentalHostWatchChangeType, ExperimentalHostWatchEvent, ExperimentalHostWatchListener, ExperimentalHostWatchOptions, ExperimentalHostWatchSubscription, ExperimentalHostWorkerLease, JsonValue, MarkdownProps, NewThreadComposerProps, NewThreadRequest, PluginAgentConfiguration, PluginAgentConfigurationContext, PluginAgentToolContentPart, PluginAgentToolContext, PluginAgentToolExperimentalStatusLabels, PluginAgentToolRegistrationBase, PluginAgentToolResult, PluginAgentToolSelection, PluginAgents, PluginAppBuilder, PluginAppComposer, PluginAppContentScripts, PluginAppDefinition, PluginAppSetup, PluginAppSlots, PluginBackground, PluginCli, PluginCliCommandInfo, PluginCliContext, PluginCliExecutionResult, PluginCliOutputLimitError, PluginCliRegistration, PluginCliResult, PluginComposerApi, PluginComposerMention, PluginComposerScope, PluginComposerTextEffect, PluginComposerThreadRowStatus, PluginContentScriptContext, PluginContentScriptDisposer, PluginContentScriptRegistration, PluginEvents, PluginFileOpenerProps, PluginFileOpenerRegistration, PluginFileOpenerSource, PluginHomepageSectionProps, PluginHomepageSectionRegistration, PluginHosts, PluginHttp, PluginHttpAuthMode, PluginHttpHandler, PluginInteractionCancelReason, PluginInteractionRequest, PluginInteractionResult, PluginKvStorage, PluginLogger, PluginMentionItem, PluginMentionProviderRegistration, PluginMentionSearchContext, PluginMentionTrigger, PluginMessageActionContext, PluginMessageActionRegistration, PluginMessageActionThreadPanelOptions, PluginMessageDirectiveMessage, PluginMessageDirectiveOpenWorkspaceFile, PluginMessageDirectiveProps, PluginMessageDirectiveRegistration, PluginNavPanelProps, PluginNavPanelRegistration, PluginNewThreadPanelActionContext, PluginNewThreadPanelActionRegistration, PluginNewThreadPanelProps, PluginPendingInteractionProps, PluginPendingInteractionRegistration, PluginPendingInteractionView, PluginProviderCapabilities, PluginProviderComposerAction, PluginProviderDeclaration, PluginProviderIconRegistration, PluginProviderPermissionMode, PluginProviderReasoningLevel, PluginRealtime, PluginRealtimeConnectionState, PluginRpc, PluginRpcCallArgs, PluginRpcClient, PluginRpcContract, PluginRpcError, PluginRpcErrorCode, PluginRpcHandlers, PluginRpcIssuePathSegment, PluginRpcMethodContract, PluginRpcResult, PluginRpcValidationIssue, PluginSdkApp, PluginServerApi, PluginSettingDescriptor, PluginSettingDescriptors, PluginSettingValue, PluginSettings, PluginSettingsHandle, PluginSettingsSectionProps, PluginSettingsSectionRegistration, PluginSettingsState, PluginSettingsValues, PluginSharedPortTunnelIdentity, PluginSidebarFooterActionContext, PluginSidebarFooterActionProps, PluginSidebarFooterActionRegistration, PluginSidebarProject, PluginSidebarPullRequest, PluginSidebarSplitPane, PluginSidebarThread, PluginSidebarThreadActions, PluginSidebarThreadActivity, PluginSidebarThreadIndicator, PluginSidebarThreadPullRequestState, PluginSidebarThreadSplit, PluginSidebarThreadsState, PluginSidebarWorkspaceKind, PluginStatusApi, PluginStorage, PluginThreadEventHandler, PluginThreadEventName, PluginThreadEventPayloads, PluginThreadHeaderActionProps, PluginThreadHeaderActionRegistration, PluginThreadListProps, PluginThreadListRegistration, PluginThreadPanelActionContext, PluginThreadPanelActionRegistration, PluginThreadPanelProps, PluginUi, StandardSchemaV1, StandardSchemaV1InferInput, StandardSchemaV1InferOutput, StandardSchemaV1Issue, StandardSchemaV1Result, ThreadChatMessageAction, ThreadChatMessageReference, ThreadChatProps };
