// Portable type declarations for `@get-bb/plugin-sdk`. Unpublished BB
// workspace contracts are flattened; public subpaths may reuse the
// package root without requiring any other @bb/* package.
//
// Confused by the API, or need a symbol that isn't here? Clone the BB repo
// and read the real source: https://github.com/get-bb/bb

import * as react from 'react';
import { ComponentType, ComponentPropsWithoutRef, ReactNode } from 'react';
import * as z from 'zod';
import { z as z$1 } from 'zod';
import Database from 'better-sqlite3';
import { Context } from 'hono';

/** Input-form entry: a path, or a path with options. */
declare const providerNativeRootInputSchema: z$1.ZodUnion<readonly [z$1.ZodString, z$1.ZodObject<{
    ancestors: z$1.ZodOptional<z$1.ZodBoolean>;
    namePrefix: z$1.ZodOptional<z$1.ZodString>;
    path: z$1.ZodString;
    recursive: z$1.ZodOptional<z$1.ZodBoolean>;
    skipIfManifest: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strict>]>;
/**
 * One provider-native root as a plugin declares it: a path, or a path with
 * options. `recursive`: the agent scans nested skill directories. `ancestors`
 * (project roots only): scan the same relative directory in every ancestor of
 * the workspace up to the repository root. `namePrefix`: prepended to every
 * name under the root, a vendor plugin's `plugin-name:`; a prefixed root is
 * listed as a plugin root. `skipIfManifest`: a vendor-plugin marker file to
 * skip by.
 */
type ProviderNativeRootInput = z$1.infer<typeof providerNativeRootInputSchema>;
/**
 * Provider-native roots as a plugin's frozen declaration holds them: relative
 * to the target host's home (`user`) or to the workspace (`project`). Paths
 * are relative without dot segments, unique per side, at most 32 per side. A
 * root only one host can name — a moved config directory, a settings entry —
 * is the resolver's answer (`resolveNativeRoots`), never a declared root.
 */
interface ProviderNativeRootsInputLike {
    readonly user?: readonly ProviderNativeRootInput[];
    readonly project?: readonly ProviderNativeRootInput[];
}

declare const appSettingsSchema: z$1.ZodObject<{
    defaultProviderId: z$1.ZodNullable<z$1.ZodString>;
    managedBranchPrefix: z$1.ZodString;
    providerOrder: z$1.ZodArray<z$1.ZodString>;
    showKeyboardHints: z$1.ZodBoolean;
    showUnhandledProviderEvents: z$1.ZodBoolean;
    steerActiveThreadOnEnter: z$1.ZodBoolean;
    streamerMode: z$1.ZodBoolean;
}, z$1.core.$strict>;
type AppSettings = z$1.infer<typeof appSettingsSchema>;

declare const appKeybindingOverridesSchema: z$1.ZodArray<z$1.ZodObject<{
    command: z$1.ZodEnum<{
        "app.back": "app.back";
        "browser.find": "browser.find";
        "browser.focusLocation": "browser.focusLocation";
        "browser.reload": "browser.reload";
        "composer.focus": "composer.focus";
        "diff.toggle": "diff.toggle";
        "file.quickOpen": "file.quickOpen";
        "logs.openServerDaemon": "logs.openServerDaemon";
        "modelPicker.cycleModel": "modelPicker.cycleModel";
        "modelPicker.cycleModelBackward": "modelPicker.cycleModelBackward";
        "modelPicker.cycleProvider": "modelPicker.cycleProvider";
        "modelPicker.cycleProviderBackward": "modelPicker.cycleProviderBackward";
        "modelPicker.cycleReasoning": "modelPicker.cycleReasoning";
        "modelPicker.cycleReasoningBackward": "modelPicker.cycleReasoningBackward";
        "modelPicker.toggle": "modelPicker.toggle";
        "notifications.open": "notifications.open";
        "palette.open": "palette.open";
        "pane.close": "pane.close";
        "pane.focus.1": "pane.focus.1";
        "pane.focus.2": "pane.focus.2";
        "pane.focus.3": "pane.focus.3";
        "pane.focus.4": "pane.focus.4";
        "pane.focus.5": "pane.focus.5";
        "pane.focus.6": "pane.focus.6";
        "pane.focus.7": "pane.focus.7";
        "pane.focus.8": "pane.focus.8";
        "pane.focus.next": "pane.focus.next";
        "pane.focus.previous": "pane.focus.previous";
        "pane.maximize.toggle": "pane.maximize.toggle";
        "panel.close": "panel.close";
        "panel.newTab": "panel.newTab";
        "panel.reopenClosedTab": "panel.reopenClosedTab";
        "panel.toggle": "panel.toggle";
        "question.select.1": "question.select.1";
        "question.select.2": "question.select.2";
        "question.select.3": "question.select.3";
        "question.select.4": "question.select.4";
        "question.select.5": "question.select.5";
        "question.select.6": "question.select.6";
        "question.select.7": "question.select.7";
        "question.select.8": "question.select.8";
        "question.select.9": "question.select.9";
        "settings.open": "settings.open";
        "settings.openServers": "settings.openServers";
        "sidebar.toggle": "sidebar.toggle";
        "terminal.open": "terminal.open";
        "thread.archive": "thread.archive";
        "thread.jump.1": "thread.jump.1";
        "thread.jump.2": "thread.jump.2";
        "thread.jump.3": "thread.jump.3";
        "thread.jump.4": "thread.jump.4";
        "thread.jump.5": "thread.jump.5";
        "thread.jump.6": "thread.jump.6";
        "thread.jump.7": "thread.jump.7";
        "thread.jump.8": "thread.jump.8";
        "thread.jump.9": "thread.jump.9";
        "thread.new": "thread.new";
        "thread.next": "thread.next";
        "thread.previous": "thread.previous";
        "thread.rename": "thread.rename";
        "thread.search": "thread.search";
        "window.new": "window.new";
        "workspace.openPreferred": "workspace.openPreferred";
    }>;
    shortcut: z$1.ZodNullable<z$1.ZodObject<{
        alt: z$1.ZodBoolean;
        control: z$1.ZodBoolean;
        key: z$1.ZodString;
        meta: z$1.ZodBoolean;
        mod: z$1.ZodBoolean;
        shift: z$1.ZodBoolean;
    }, z$1.core.$strict>>;
}, z$1.core.$strict>>;
type AppKeybindingOverrides = z$1.infer<typeof appKeybindingOverridesSchema>;

interface JsonObject {
    [key: string]: JsonValue$1;
}
type JsonValue$1 = string | number | boolean | null | JsonValue$1[] | JsonObject;

declare const appThemeSchema: z$1.ZodObject<{
    customCss: z$1.ZodNullable<z$1.ZodString>;
    faviconColor: z$1.ZodEnum<{
        blue: "blue";
        default: "default";
        green: "green";
        orange: "orange";
        pink: "pink";
        purple: "purple";
        red: "red";
        teal: "teal";
        yellow: "yellow";
    }>;
    resolvedCodeTheme: z$1.ZodDefault<z$1.ZodObject<{
        dark: z$1.ZodString;
        files: z$1.ZodRecord<z$1.ZodString, z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>>;
        light: z$1.ZodString;
    }, z$1.core.$strict>>;
    themeId: z$1.ZodString;
}, z$1.core.$strip>;
type AppTheme = z$1.infer<typeof appThemeSchema>;
declare const appThemeSelectionSchema: z$1.ZodObject<{
    faviconColor: z$1.ZodEnum<{
        blue: "blue";
        default: "default";
        green: "green";
        orange: "orange";
        pink: "pink";
        purple: "purple";
        red: "red";
        teal: "teal";
        yellow: "yellow";
    }>;
    themeId: z$1.ZodString;
}, z$1.core.$strip>;
type AppThemeSelection = z$1.infer<typeof appThemeSelectionSchema>;

declare const browserFrameTargetSchema: z$1.ZodObject<{
    documentEpoch: z$1.ZodNumber;
    frameId: z$1.ZodString;
}, z$1.core.$strict>;
type BrowserFrameTarget = z$1.infer<typeof browserFrameTargetSchema>;
declare const browserFrameDescriptorSchema: z$1.ZodObject<{
    depth: z$1.ZodNumber;
    documentEpoch: z$1.ZodNumber;
    frameId: z$1.ZodString;
    name: z$1.ZodNullable<z$1.ZodString>;
    parentFrameId: z$1.ZodNullable<z$1.ZodString>;
    url: z$1.ZodString;
}, z$1.core.$strict>;
type BrowserFrameDescriptor = z$1.infer<typeof browserFrameDescriptorSchema>;
declare const browserTabDescriptorSchema: z$1.ZodObject<{
    active: z$1.ZodBoolean;
    clientId: z$1.ZodString;
    connected: z$1.ZodBoolean;
    navigationEpoch: z$1.ZodNumber;
    projectId: z$1.ZodNullable<z$1.ZodString>;
    tabId: z$1.ZodString;
    threadId: z$1.ZodNullable<z$1.ZodString>;
    title: z$1.ZodNullable<z$1.ZodString>;
    url: z$1.ZodString;
    windowId: z$1.ZodString;
}, z$1.core.$strict>;
type BrowserTabDescriptor = z$1.infer<typeof browserTabDescriptorSchema>;
declare const browserTabOwnerDescriptorSchema: z$1.ZodObject<{
    active: z$1.ZodBoolean;
    clientId: z$1.ZodString;
    ownerId: z$1.ZodString;
    projectId: z$1.ZodNullable<z$1.ZodString>;
    threadId: z$1.ZodNullable<z$1.ZodString>;
    windowId: z$1.ZodString;
}, z$1.core.$strict>;
type BrowserTabOwnerDescriptor = z$1.infer<typeof browserTabOwnerDescriptorSchema>;
declare const browserTabTargetSchema: z$1.ZodObject<{
    clientId: z$1.ZodString;
    navigationEpoch: z$1.ZodNumber;
    tabId: z$1.ZodString;
    windowId: z$1.ZodString;
}, z$1.core.$strict>;
type BrowserTabTarget = z$1.infer<typeof browserTabTargetSchema>;
declare const browserWaitCriteriaSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    kind: z$1.ZodLiteral<"locator">;
    locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        selectors: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        name: z$1.ZodOptional<z$1.ZodString>;
        role: z$1.ZodString;
    }, z$1.core.$strict>]>;
}, z$1.core.$strict>, z$1.ZodObject<{
    frame: z$1.ZodOptional<z$1.ZodObject<{
        documentEpoch: z$1.ZodNumber;
        frameId: z$1.ZodString;
    }, z$1.core.$strict>>;
    kind: z$1.ZodLiteral<"text">;
    text: z$1.ZodString;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"url">;
    match: z$1.ZodEnum<{
        exact: "exact";
        glob: "glob";
    }>;
    url: z$1.ZodString;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"navigation">;
    phase: z$1.ZodEnum<{
        commit: "commit";
        start: "start";
    }>;
    sameDocument: z$1.ZodBoolean;
}, z$1.core.$strict>, z$1.ZodObject<{
    document: z$1.ZodEnum<{
        current: "current";
        next: "next";
    }>;
    kind: z$1.ZodLiteral<"load-state">;
    state: z$1.ZodEnum<{
        domcontentloaded: "domcontentloaded";
        load: "load";
        networkidle: "networkidle";
    }>;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"popup">;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"request">;
    match: z$1.ZodEnum<{
        exact: "exact";
        glob: "glob";
    }>;
    method: z$1.ZodOptional<z$1.ZodString>;
    url: z$1.ZodString;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"response">;
    match: z$1.ZodEnum<{
        exact: "exact";
        glob: "glob";
    }>;
    method: z$1.ZodOptional<z$1.ZodString>;
    status: z$1.ZodOptional<z$1.ZodNumber>;
    url: z$1.ZodString;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"download-blocked">;
}, z$1.core.$strict>], "kind">;
type BrowserWaitCriteria = z$1.infer<typeof browserWaitCriteriaSchema>;
declare const browserWaitResultSchema: z$1.ZodObject<{
    blocked: z$1.ZodOptional<z$1.ZodBoolean>;
    kind: z$1.ZodEnum<{
        "download-blocked": "download-blocked";
        "load-state": "load-state";
        locator: "locator";
        navigation: "navigation";
        popup: "popup";
        request: "request";
        response: "response";
        text: "text";
        url: "url";
    }>;
    method: z$1.ZodOptional<z$1.ZodString>;
    observedTarget: z$1.ZodOptional<z$1.ZodObject<{
        clientId: z$1.ZodString;
        navigationEpoch: z$1.ZodNumber;
        tabId: z$1.ZodString;
        windowId: z$1.ZodString;
    }, z$1.core.$strict>>;
    originalTarget: z$1.ZodOptional<z$1.ZodObject<{
        clientId: z$1.ZodString;
        navigationEpoch: z$1.ZodNumber;
        tabId: z$1.ZodString;
        windowId: z$1.ZodString;
    }, z$1.core.$strict>>;
    phase: z$1.ZodOptional<z$1.ZodEnum<{
        commit: "commit";
        complete: "complete";
        start: "start";
    }>>;
    sameDocument: z$1.ZodOptional<z$1.ZodBoolean>;
    state: z$1.ZodOptional<z$1.ZodEnum<{
        domcontentloaded: "domcontentloaded";
        load: "load";
        networkidle: "networkidle";
    }>>;
    status: z$1.ZodOptional<z$1.ZodNumber>;
    target: z$1.ZodObject<{
        clientId: z$1.ZodString;
        navigationEpoch: z$1.ZodNumber;
        tabId: z$1.ZodString;
        windowId: z$1.ZodString;
    }, z$1.core.$strict>;
    url: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strict>;
type BrowserWaitResult = z$1.infer<typeof browserWaitResultSchema>;
declare const browserControlErrorSchema: z$1.ZodObject<{
    code: z$1.ZodString;
    details: z$1.ZodOptional<z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>>;
    message: z$1.ZodString;
}, z$1.core.$strict>;
type BrowserControlError = z$1.infer<typeof browserControlErrorSchema>;
declare const browserControlActionSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    kind: z$1.ZodLiteral<"list-frames">;
    maxFrames: z$1.ZodOptional<z$1.ZodNumber>;
}, z$1.core.$strict>, z$1.ZodObject<{
    frame: z$1.ZodOptional<z$1.ZodObject<{
        documentEpoch: z$1.ZodNumber;
        frameId: z$1.ZodString;
    }, z$1.core.$strict>>;
    kind: z$1.ZodLiteral<"snapshot">;
    maxNodes: z$1.ZodOptional<z$1.ZodNumber>;
    mode: z$1.ZodEnum<{
        dom: "dom";
        interactive: "interactive";
    }>;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"click">;
    target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            selectors: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            name: z$1.ZodOptional<z$1.ZodString>;
            role: z$1.ZodString;
        }, z$1.core.$strict>]>;
        target: z$1.ZodLiteral<"locator">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        target: z$1.ZodLiteral<"point">;
        x: z$1.ZodNumber;
        y: z$1.ZodNumber;
    }, z$1.core.$strict>], "target">;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"hover">;
    target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            selectors: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            name: z$1.ZodOptional<z$1.ZodString>;
            role: z$1.ZodString;
        }, z$1.core.$strict>]>;
        target: z$1.ZodLiteral<"locator">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        target: z$1.ZodLiteral<"point">;
        x: z$1.ZodNumber;
        y: z$1.ZodNumber;
    }, z$1.core.$strict>], "target">;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"double-click">;
    target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            selectors: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            name: z$1.ZodOptional<z$1.ZodString>;
            role: z$1.ZodString;
        }, z$1.core.$strict>]>;
        target: z$1.ZodLiteral<"locator">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        target: z$1.ZodLiteral<"point">;
        x: z$1.ZodNumber;
        y: z$1.ZodNumber;
    }, z$1.core.$strict>], "target">;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"right-click">;
    target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            selectors: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            name: z$1.ZodOptional<z$1.ZodString>;
            role: z$1.ZodString;
        }, z$1.core.$strict>]>;
        target: z$1.ZodLiteral<"locator">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        target: z$1.ZodLiteral<"point">;
        x: z$1.ZodNumber;
        y: z$1.ZodNumber;
    }, z$1.core.$strict>], "target">;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"middle-click">;
    target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            selectors: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            name: z$1.ZodOptional<z$1.ZodString>;
            role: z$1.ZodString;
        }, z$1.core.$strict>]>;
        target: z$1.ZodLiteral<"locator">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        target: z$1.ZodLiteral<"point">;
        x: z$1.ZodNumber;
        y: z$1.ZodNumber;
    }, z$1.core.$strict>], "target">;
}, z$1.core.$strict>, z$1.ZodObject<{
    from: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            selectors: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            name: z$1.ZodOptional<z$1.ZodString>;
            role: z$1.ZodString;
        }, z$1.core.$strict>]>;
        target: z$1.ZodLiteral<"locator">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        target: z$1.ZodLiteral<"point">;
        x: z$1.ZodNumber;
        y: z$1.ZodNumber;
    }, z$1.core.$strict>], "target">;
    kind: z$1.ZodLiteral<"drag">;
    to: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            selectors: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            name: z$1.ZodOptional<z$1.ZodString>;
            role: z$1.ZodString;
        }, z$1.core.$strict>]>;
        target: z$1.ZodLiteral<"locator">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        target: z$1.ZodLiteral<"point">;
        x: z$1.ZodNumber;
        y: z$1.ZodNumber;
    }, z$1.core.$strict>], "target">;
}, z$1.core.$strict>, z$1.ZodObject<{
    clear: z$1.ZodOptional<z$1.ZodBoolean>;
    kind: z$1.ZodLiteral<"type">;
    locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        selectors: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        name: z$1.ZodOptional<z$1.ZodString>;
        role: z$1.ZodString;
    }, z$1.core.$strict>]>;
    text: z$1.ZodString;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"select">;
    locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        selectors: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        name: z$1.ZodOptional<z$1.ZodString>;
        role: z$1.ZodString;
    }, z$1.core.$strict>]>;
    value: z$1.ZodString;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"select-multiple">;
    locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        selectors: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        name: z$1.ZodOptional<z$1.ZodString>;
        role: z$1.ZodString;
    }, z$1.core.$strict>]>;
    values: z$1.ZodArray<z$1.ZodString>;
}, z$1.core.$strict>, z$1.ZodObject<{
    files: z$1.ZodArray<z$1.ZodObject<{
        base64: z$1.ZodString;
        mimeType: z$1.ZodString;
        name: z$1.ZodString;
    }, z$1.core.$strict>>;
    kind: z$1.ZodLiteral<"upload">;
    locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        selectors: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        name: z$1.ZodOptional<z$1.ZodString>;
        role: z$1.ZodString;
    }, z$1.core.$strict>]>;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"check">;
    locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        selectors: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        name: z$1.ZodOptional<z$1.ZodString>;
        role: z$1.ZodString;
    }, z$1.core.$strict>]>;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"uncheck">;
    locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        selectors: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        name: z$1.ZodOptional<z$1.ZodString>;
        role: z$1.ZodString;
    }, z$1.core.$strict>]>;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"focus">;
    locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        selectors: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        name: z$1.ZodOptional<z$1.ZodString>;
        role: z$1.ZodString;
    }, z$1.core.$strict>]>;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"scroll-into-view">;
    locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        selectors: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        name: z$1.ZodOptional<z$1.ZodString>;
        role: z$1.ZodString;
    }, z$1.core.$strict>]>;
}, z$1.core.$strict>, z$1.ZodObject<{
    element: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            selectors: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            name: z$1.ZodOptional<z$1.ZodString>;
            role: z$1.ZodString;
        }, z$1.core.$strict>]>;
        target: z$1.ZodLiteral<"locator">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        target: z$1.ZodLiteral<"point">;
        x: z$1.ZodNumber;
        y: z$1.ZodNumber;
    }, z$1.core.$strict>], "target">;
    feedback: z$1.ZodString;
    intent: z$1.ZodEnum<{
        approve: "approve";
        change: "change";
        fix: "fix";
        question: "question";
    }>;
    kind: z$1.ZodLiteral<"annotate">;
}, z$1.core.$strict>, z$1.ZodObject<{
    code: z$1.ZodOptional<z$1.ZodString>;
    key: z$1.ZodString;
    kind: z$1.ZodLiteral<"key">;
    modifiers: z$1.ZodOptional<z$1.ZodArray<z$1.ZodEnum<{
        Alt: "Alt";
        Control: "Control";
        Meta: "Meta";
        Shift: "Shift";
    }>>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    behavior: z$1.ZodOptional<z$1.ZodEnum<{
        auto: "auto";
        smooth: "smooth";
    }>>;
    deltaX: z$1.ZodOptional<z$1.ZodNumber>;
    deltaY: z$1.ZodOptional<z$1.ZodNumber>;
    kind: z$1.ZodLiteral<"scroll">;
    x: z$1.ZodOptional<z$1.ZodNumber>;
    y: z$1.ZodOptional<z$1.ZodNumber>;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"navigate">;
    url: z$1.ZodString;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"open-tab">;
    url: z$1.ZodString;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"activate-tab">;
    tabId: z$1.ZodString;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"close-tab">;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"back">;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"forward">;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"reload">;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"set-viewport-profile">;
    profile: z$1.ZodEnum<{
        "desktop-1280x720": "desktop-1280x720";
        "phone-390x844": "phone-390x844";
        "tablet-768x1024": "tablet-768x1024";
    }>;
}, z$1.core.$strict>, z$1.ZodObject<{
    criteria: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"locator">;
        locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            selectors: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            name: z$1.ZodOptional<z$1.ZodString>;
            role: z$1.ZodString;
        }, z$1.core.$strict>]>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        kind: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"url">;
        match: z$1.ZodEnum<{
            exact: "exact";
            glob: "glob";
        }>;
        url: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"navigation">;
        phase: z$1.ZodEnum<{
            commit: "commit";
            start: "start";
        }>;
        sameDocument: z$1.ZodBoolean;
    }, z$1.core.$strict>, z$1.ZodObject<{
        document: z$1.ZodEnum<{
            current: "current";
            next: "next";
        }>;
        kind: z$1.ZodLiteral<"load-state">;
        state: z$1.ZodEnum<{
            domcontentloaded: "domcontentloaded";
            load: "load";
            networkidle: "networkidle";
        }>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"popup">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"request">;
        match: z$1.ZodEnum<{
            exact: "exact";
            glob: "glob";
        }>;
        method: z$1.ZodOptional<z$1.ZodString>;
        url: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"response">;
        match: z$1.ZodEnum<{
            exact: "exact";
            glob: "glob";
        }>;
        method: z$1.ZodOptional<z$1.ZodString>;
        status: z$1.ZodOptional<z$1.ZodNumber>;
        url: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"download-blocked">;
    }, z$1.core.$strict>], "kind">;
    kind: z$1.ZodLiteral<"wait">;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"clear-viewport-profile">;
}, z$1.core.$strict>, z$1.ZodObject<{
    behavior: z$1.ZodEnum<{
        accept: "accept";
        dismiss: "dismiss";
    }>;
    kind: z$1.ZodLiteral<"set-dialog-handler">;
    promptText: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strict>, z$1.ZodObject<{
    decision: z$1.ZodEnum<{
        allow: "allow";
        deny: "deny";
    }>;
    kind: z$1.ZodLiteral<"set-permissions">;
    permissions: z$1.ZodArray<z$1.ZodEnum<{
        "clipboard-read": "clipboard-read";
        "clipboard-sanitized-write": "clipboard-sanitized-write";
        "display-capture": "display-capture";
        fullscreen: "fullscreen";
        geolocation: "geolocation";
        media: "media";
        notifications: "notifications";
    }>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"diagnostics">;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"get-storage">;
}, z$1.core.$strict>, z$1.ZodObject<{
    cookies: z$1.ZodArray<z$1.ZodString>;
    kind: z$1.ZodLiteral<"set-storage">;
    local: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
    session: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"clear-storage">;
    stores: z$1.ZodArray<z$1.ZodEnum<{
        cookies: "cookies";
        local: "local";
        session: "session";
    }>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"list-cookie-import-sources">;
}, z$1.core.$strict>, z$1.ZodObject<{
    family: z$1.ZodString;
    kind: z$1.ZodLiteral<"import-cookies-from-browser">;
    profileId: z$1.ZodString;
}, z$1.core.$strict>, z$1.ZodObject<{
    confirm: z$1.ZodLiteral<true>;
    kind: z$1.ZodLiteral<"clear-imported-cookies">;
}, z$1.core.$strict>, z$1.ZodObject<{
    format: z$1.ZodOptional<z$1.ZodEnum<{
        jpeg: "jpeg";
        png: "png";
    }>>;
    kind: z$1.ZodLiteral<"screenshot">;
    quality: z$1.ZodOptional<z$1.ZodNumber>;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"screenshot-full-page">;
}, z$1.core.$strict>, z$1.ZodObject<{
    format: z$1.ZodEnum<{
        jpeg: "jpeg";
        png: "png";
    }>;
    kind: z$1.ZodLiteral<"screenshot-element">;
    locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        selectors: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        name: z$1.ZodOptional<z$1.ZodString>;
        role: z$1.ZodString;
    }, z$1.core.$strict>]>;
    quality: z$1.ZodNumber;
}, z$1.core.$strict>, z$1.ZodObject<{
    frame: z$1.ZodOptional<z$1.ZodObject<{
        documentEpoch: z$1.ZodNumber;
        frameId: z$1.ZodString;
    }, z$1.core.$strict>>;
    input: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
    kind: z$1.ZodLiteral<"script">;
    source: z$1.ZodString;
    timeoutMs: z$1.ZodNumber;
    world: z$1.ZodOptional<z$1.ZodEnum<{
        isolated: "isolated";
        main: "main";
    }>>;
}, z$1.core.$strict>], "kind">;
type BrowserControlAction = z$1.infer<typeof browserControlActionSchema>;

declare const changedMessageSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "archived-changed": "archived-changed";
        "environment-changed": "environment-changed";
        "events-appended": "events-appended";
        "history-rewritten": "history-rewritten";
        "interactions-changed": "interactions-changed";
        "order-changed": "order-changed";
        "parent-changed": "parent-changed";
        "pin-state-changed": "pin-state-changed";
        "queue-changed": "queue-changed";
        "read-state-changed": "read-state-changed";
        "status-changed": "status-changed";
        "tabs-changed": "tabs-changed";
        "terminals-changed": "terminals-changed";
        "thread-created": "thread-created";
        "thread-deleted": "thread-deleted";
        "title-changed": "title-changed";
    }>>>;
    entity: z$1.ZodLiteral<"thread">;
    id: z$1.ZodOptional<z$1.ZodString>;
    metadata: z$1.ZodOptional<z$1.ZodObject<{
        backgroundActivityChanged: z$1.ZodOptional<z$1.ZodBoolean>;
        eventTypes: z$1.ZodOptional<z$1.ZodReadonly<z$1.ZodArray<z$1.ZodString & z$1.ZodType<"client/thread/start" | "client/turn/rejected" | "client/turn/requested" | "client/turn/start" | "item/agentMessage/delta" | "item/backgroundTask/completed" | "item/backgroundTask/progress" | "item/commandExecution/outputDelta" | "item/completed" | "item/delegation/completed" | "item/delegation/progress" | "item/fileChange/outputDelta" | "item/mcpToolCall/progress" | "item/plan/delta" | "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" | "item/started" | "item/toolCall/progress" | "provider.env-resolved" | "provider/error" | "provider/modelFallback" | "provider/rateLimits/updated" | "provider/unhandled" | "provider/warning" | "system/error" | "system/interaction/lifecycle" | "system/manager/user_message" | "system/operation" | "system/permissionGrant/lifecycle" | "system/provider-turn-watchdog" | "system/thread-provisioning" | "system/thread/interrupted" | "system/userQuestion/lifecycle" | "thread/compacted" | "thread/context/cleared" | "thread/contextWindowUsage/updated" | "thread/extensionState/updated" | "thread/goal/cleared" | "thread/goal/updated" | "thread/identity" | "thread/name/updated" | "thread/started" | "thread/tokenUsage/updated" | "turn/completed" | "turn/diff/updated" | "turn/input/accepted" | "turn/plan/updated" | "turn/started", string, z$1.core.$ZodTypeInternals<"client/thread/start" | "client/turn/rejected" | "client/turn/requested" | "client/turn/start" | "item/agentMessage/delta" | "item/backgroundTask/completed" | "item/backgroundTask/progress" | "item/commandExecution/outputDelta" | "item/completed" | "item/delegation/completed" | "item/delegation/progress" | "item/fileChange/outputDelta" | "item/mcpToolCall/progress" | "item/plan/delta" | "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" | "item/started" | "item/toolCall/progress" | "provider.env-resolved" | "provider/error" | "provider/modelFallback" | "provider/rateLimits/updated" | "provider/unhandled" | "provider/warning" | "system/error" | "system/interaction/lifecycle" | "system/manager/user_message" | "system/operation" | "system/permissionGrant/lifecycle" | "system/provider-turn-watchdog" | "system/thread-provisioning" | "system/thread/interrupted" | "system/userQuestion/lifecycle" | "thread/compacted" | "thread/context/cleared" | "thread/contextWindowUsage/updated" | "thread/extensionState/updated" | "thread/goal/cleared" | "thread/goal/updated" | "thread/identity" | "thread/name/updated" | "thread/started" | "thread/tokenUsage/updated" | "turn/completed" | "turn/diff/updated" | "turn/input/accepted" | "turn/plan/updated" | "turn/started", string>>>>>;
        hasPendingInteraction: z$1.ZodOptional<z$1.ZodBoolean>;
        projectId: z$1.ZodOptional<z$1.ZodString>;
        statusChange: z$1.ZodOptional<z$1.ZodObject<{
            activity: z$1.ZodObject<{
                activeBackgroundAgentCount: z$1.ZodNumber;
                activeBackgroundCommandCount: z$1.ZodNumber;
                activeGoalCount: z$1.ZodNumber;
                activePlanModeCount: z$1.ZodNumber;
                activeWorkflowCount: z$1.ZodNumber;
            }, z$1.core.$strip>;
            latestAttentionAt: z$1.ZodNumber;
            runtime: z$1.ZodObject<{
                displayStatus: z$1.ZodEnum<{
                    "host-reconnecting": "host-reconnecting";
                    "waiting-for-host": "waiting-for-host";
                    active: "active";
                    error: "error";
                    idle: "idle";
                    pending: "pending";
                    provisioning: "provisioning";
                    starting: "starting";
                    stopping: "stopping";
                }>;
                hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
            }, z$1.core.$strip>;
            status: z$1.ZodEnum<{
                active: "active";
                error: "error";
                idle: "idle";
                pending: "pending";
                starting: "starting";
                stopping: "stopping";
            }>;
            updatedAt: z$1.ZodNumber;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>>;
    type: z$1.ZodLiteral<"changed">;
}, z$1.core.$strict>, z$1.ZodObject<{
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "project-created": "project-created";
        "project-deleted": "project-deleted";
        "project-order-changed": "project-order-changed";
        "project-sources-changed": "project-sources-changed";
        "project-updated": "project-updated";
        "threads-changed": "threads-changed";
    }>>>;
    entity: z$1.ZodLiteral<"project">;
    id: z$1.ZodOptional<z$1.ZodString>;
    type: z$1.ZodLiteral<"changed">;
}, z$1.core.$strict>, z$1.ZodObject<{
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "environment-created": "environment-created";
        "environment-deleted": "environment-deleted";
        "git-refs-changed": "git-refs-changed";
        "metadata-changed": "metadata-changed";
        "status-changed": "status-changed";
        "thread-storage-changed": "thread-storage-changed";
        "work-status-changed": "work-status-changed";
    }>>>;
    entity: z$1.ZodLiteral<"environment">;
    id: z$1.ZodOptional<z$1.ZodString>;
    type: z$1.ZodLiteral<"changed">;
}, z$1.core.$strict>, z$1.ZodObject<{
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "host-connected": "host-connected";
        "host-disconnected": "host-disconnected";
    }>>>;
    entity: z$1.ZodLiteral<"host">;
    id: z$1.ZodOptional<z$1.ZodString>;
    type: z$1.ZodLiteral<"changed">;
}, z$1.core.$strict>, z$1.ZodObject<{
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "config-changed": "config-changed";
        "plugins-changed": "plugins-changed";
        "provider-registrations-changed": "provider-registrations-changed";
    }>>>;
    entity: z$1.ZodLiteral<"system">;
    type: z$1.ZodLiteral<"changed">;
}, z$1.core.$strict>], "entity">;
type ChangedMessage = z$1.infer<typeof changedMessageSchema>;

declare const environmentSchema: z$1.ZodObject<{
    baseBranch: z$1.ZodNullable<z$1.ZodString>;
    branchName: z$1.ZodNullable<z$1.ZodString>;
    createdAt: z$1.ZodNumber;
    defaultBranch: z$1.ZodNullable<z$1.ZodString>;
    hostId: z$1.ZodString;
    id: z$1.ZodString;
    isGitRepo: z$1.ZodBoolean;
    isWorktree: z$1.ZodBoolean;
    managed: z$1.ZodBoolean;
    mergeBaseBranch: z$1.ZodNullable<z$1.ZodString>;
    name: z$1.ZodNullable<z$1.ZodString>;
    path: z$1.ZodNullable<z$1.ZodString>;
    projectId: z$1.ZodString;
    status: z$1.ZodEnum<{
        destroyed: "destroyed";
        destroying: "destroying";
        error: "error";
        provisioning: "provisioning";
        ready: "ready";
        retiring: "retiring";
    }>;
    updatedAt: z$1.ZodNumber;
    workspaceProvisionType: z$1.ZodEnum<{
        "managed-worktree": "managed-worktree";
        personal: "personal";
        unmanaged: "unmanaged";
    }>;
}, z$1.core.$strip>;
type Environment = z$1.infer<typeof environmentSchema>;

declare const experimentsSchema: z$1.ZodRecord<z$1.ZodEnum<{
    changelogPreview: "changelogPreview";
    editMessages: "editMessages";
    mobileApp: "mobileApp";
    sidebarProgressiveDisclosure: "sidebarProgressiveDisclosure";
    timelineWindowing: "timelineWindowing";
}>, z$1.ZodBoolean>;
type Experiments = z$1.infer<typeof experimentsSchema>;

declare const hostSchema: z$1.ZodObject<{
    createdAt: z$1.ZodNumber;
    id: z$1.ZodString;
    lastRejectedProtocolVersion: z$1.ZodNullable<z$1.ZodNumber>;
    lastSeenAt: z$1.ZodNullable<z$1.ZodNumber>;
    maxPermissionMode: z$1.ZodEnum<{
        "accept-edits": "accept-edits";
        auto: "auto";
        full: "full";
    }>;
    name: z$1.ZodString;
    status: z$1.ZodEnum<{
        connected: "connected";
        disconnected: "disconnected";
    }>;
    type: z$1.ZodEnum<{
        persistent: "persistent";
    }>;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type Host = z$1.infer<typeof hostSchema>;

declare const threadEventItemPresentationSchema: z$1.ZodObject<{
    badge: z$1.ZodOptional<z$1.ZodObject<{
        glyph: z$1.ZodString;
        hint: z$1.ZodString;
        label: z$1.ZodString;
        tone: z$1.ZodEnum<{
            destructive: "destructive";
            neutral: "neutral";
        }>;
    }, z$1.core.$strip>>;
    detail: z$1.ZodOptional<z$1.ZodString>;
    icon: z$1.ZodObject<{
        glyph: z$1.ZodString;
    }, z$1.core.$strip>;
    label: z$1.ZodObject<{
        completed: z$1.ZodString;
        pending: z$1.ZodString;
    }, z$1.core.$strip>;
    suppress: z$1.ZodOptional<z$1.ZodBoolean>;
    tint: z$1.ZodOptional<z$1.ZodObject<{
        dark: z$1.ZodString;
        light: z$1.ZodString;
    }, z$1.core.$strip>>;
    title: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ThreadEventItemPresentation = z$1.infer<typeof threadEventItemPresentationSchema>;

declare const pendingInteractionResolutionSchema: z$1.ZodUnion<readonly [z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    decision: z$1.ZodLiteral<"allow_once">;
    grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
        fileSystem: z$1.ZodNullable<z$1.ZodObject<{
            read: z$1.ZodArray<z$1.ZodString>;
            write: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strip>>;
        network: z$1.ZodNullable<z$1.ZodObject<{
            enabled: z$1.ZodNullable<z$1.ZodBoolean>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strict>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    decision: z$1.ZodLiteral<"allow_for_session">;
    grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
        fileSystem: z$1.ZodNullable<z$1.ZodObject<{
            read: z$1.ZodArray<z$1.ZodString>;
            write: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strip>>;
        network: z$1.ZodNullable<z$1.ZodObject<{
            enabled: z$1.ZodNullable<z$1.ZodBoolean>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strict>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    decision: z$1.ZodLiteral<"deny">;
}, z$1.core.$strip>], "decision">, z$1.ZodObject<{
    answers: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
        freeText: z$1.ZodOptional<z$1.ZodString>;
        selected: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strip>>;
    kind: z$1.ZodLiteral<"user_answer">;
}, z$1.core.$strip>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"plugin_submitted">;
}, z$1.core.$strip>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"request_answer">;
    value: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
}, z$1.core.$strip>]>;
type PendingInteractionResolution = z$1.infer<typeof pendingInteractionResolutionSchema>;
declare const providerPendingInteractionSchema: z$1.ZodUnion<readonly [z$1.ZodObject<{
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    id: z$1.ZodString;
    origin: z$1.ZodOptional<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"provider">;
        providerId: z$1.ZodString;
        providerRequestId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
    }, z$1.core.$strip>>;
    payload: z$1.ZodObject<{
        availableDecisions: z$1.ZodArray<z$1.ZodEnum<{
            allow_for_session: "allow_for_session";
            allow_once: "allow_once";
            deny: "deny";
        }>>;
        kind: z$1.ZodLiteral<"approval">;
        reason: z$1.ZodNullable<z$1.ZodString>;
        subject: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            actions: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                command: z$1.ZodString;
                name: z$1.ZodString;
                path: z$1.ZodString;
                type: z$1.ZodLiteral<"read">;
            }, z$1.core.$strip>, z$1.ZodObject<{
                command: z$1.ZodString;
                path: z$1.ZodNullable<z$1.ZodString>;
                type: z$1.ZodLiteral<"listFiles">;
            }, z$1.core.$strip>, z$1.ZodObject<{
                command: z$1.ZodString;
                path: z$1.ZodNullable<z$1.ZodString>;
                query: z$1.ZodNullable<z$1.ZodString>;
                type: z$1.ZodLiteral<"search">;
            }, z$1.core.$strip>, z$1.ZodObject<{
                command: z$1.ZodString;
                type: z$1.ZodLiteral<"unknown">;
            }, z$1.core.$strip>], "type">>;
            command: z$1.ZodString;
            cwd: z$1.ZodNullable<z$1.ZodString>;
            itemId: z$1.ZodString;
            kind: z$1.ZodLiteral<"command">;
            sessionGrant: z$1.ZodNullable<z$1.ZodObject<{
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            itemId: z$1.ZodString;
            kind: z$1.ZodLiteral<"file_change">;
            sessionGrant: z$1.ZodNullable<z$1.ZodObject<{
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
            writeScope: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            itemId: z$1.ZodString;
            kind: z$1.ZodLiteral<"permission_grant">;
            permissions: z$1.ZodObject<{
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>;
            toolName: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            itemId: z$1.ZodString;
            kind: z$1.ZodLiteral<"plan">;
            plan: z$1.ZodString;
            planFilePath: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            itemId: z$1.ZodString;
            kind: z$1.ZodLiteral<"tool_use">;
            presentation: z$1.ZodObject<{
                badge: z$1.ZodOptional<z$1.ZodObject<{
                    glyph: z$1.ZodString;
                    hint: z$1.ZodString;
                    label: z$1.ZodString;
                    tone: z$1.ZodEnum<{
                        destructive: "destructive";
                        neutral: "neutral";
                    }>;
                }, z$1.core.$strip>>;
                detail: z$1.ZodOptional<z$1.ZodString>;
                icon: z$1.ZodObject<{
                    glyph: z$1.ZodString;
                }, z$1.core.$strip>;
                label: z$1.ZodObject<{
                    completed: z$1.ZodString;
                    pending: z$1.ZodString;
                }, z$1.core.$strip>;
                suppress: z$1.ZodOptional<z$1.ZodBoolean>;
                tint: z$1.ZodOptional<z$1.ZodObject<{
                    dark: z$1.ZodString;
                    light: z$1.ZodString;
                }, z$1.core.$strip>>;
                title: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>;
            tool: z$1.ZodString;
        }, z$1.core.$strip>], "kind">;
    }, z$1.core.$strip>;
    providerId: z$1.ZodString;
    providerRequestId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    resolution: z$1.ZodNullable<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_once">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_for_session">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"deny">;
    }, z$1.core.$strip>], "decision">>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    status: z$1.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolved: "resolved";
        resolving: "resolving";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    id: z$1.ZodString;
    origin: z$1.ZodOptional<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"provider">;
        providerId: z$1.ZodString;
        providerRequestId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
    }, z$1.core.$strip>>;
    payload: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"user_question">;
        questions: z$1.ZodArray<z$1.ZodObject<{
            allowFreeText: z$1.ZodBoolean;
            id: z$1.ZodString;
            multiSelect: z$1.ZodBoolean;
            options: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
                description: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
                value: z$1.ZodString;
            }, z$1.core.$strip>>>;
            prompt: z$1.ZodString;
            shortLabel: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>;
    providerId: z$1.ZodString;
    providerRequestId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    resolution: z$1.ZodNullable<z$1.ZodObject<{
        answers: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
            freeText: z$1.ZodOptional<z$1.ZodString>;
            selected: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strip>>;
        kind: z$1.ZodLiteral<"user_answer">;
    }, z$1.core.$strip>>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    status: z$1.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolved: "resolved";
        resolving: "resolving";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    id: z$1.ZodString;
    origin: z$1.ZodOptional<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"provider">;
        providerId: z$1.ZodString;
        providerRequestId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
    }, z$1.core.$strip>>;
    payload: z$1.ZodObject<{
        data: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
        kind: z$1.ZodString & z$1.ZodType<`${string}/${string}`, string, z$1.core.$ZodTypeInternals<`${string}/${string}`, string>>;
        title: z$1.ZodString;
    }, z$1.core.$strip>;
    providerId: z$1.ZodString;
    providerRequestId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    resolution: z$1.ZodNullable<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"request_answer">;
        value: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
    }, z$1.core.$strip>>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    status: z$1.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolved: "resolved";
        resolving: "resolving";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodString;
}, z$1.core.$strip>]>;
type ProviderPendingInteraction = z$1.infer<typeof providerPendingInteractionSchema>;
declare const pluginPendingInteractionSchema: z$1.ZodObject<{
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    id: z$1.ZodString;
    origin: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin">;
        pluginId: z$1.ZodString;
        rendererId: z$1.ZodString;
    }, z$1.core.$strip>;
    payload: z$1.ZodObject<{
        data: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
        kind: z$1.ZodLiteral<"plugin">;
        title: z$1.ZodString;
    }, z$1.core.$strip>;
    resolution: z$1.ZodNullable<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin_submitted">;
    }, z$1.core.$strip>>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    status: z$1.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolved: "resolved";
        resolving: "resolving";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type PluginPendingInteraction = z$1.infer<typeof pluginPendingInteractionSchema>;
type PendingInteraction = ProviderPendingInteraction | PluginPendingInteraction;

declare const providerErrorInfoSchema: z$1.ZodObject<{
    category: z$1.ZodEnum<{
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
    httpStatusCode: z$1.ZodNullable<z$1.ZodNumber>;
    providerCode: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type ProviderErrorInfo = z$1.infer<typeof providerErrorInfoSchema>;
declare const providerRateLimitStateSchema: z$1.ZodObject<{
    kind: z$1.ZodEnum<{
        "spend-control": "spend-control";
        "subscription-window": "subscription-window";
        credits: "credits";
        unknown: "unknown";
    }>;
    overageReason: z$1.ZodNullable<z$1.ZodString>;
    overageStatus: z$1.ZodNullable<z$1.ZodEnum<{
        allowed: "allowed";
        rejected: "rejected";
        unavailable: "unavailable";
        warning: "warning";
    }>>;
    providerId: z$1.ZodString;
    reachedReason: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodEnum<{
        allowed: "allowed";
        blocked: "blocked";
        unknown: "unknown";
        warning: "warning";
    }>;
    windows: z$1.ZodArray<z$1.ZodObject<{
        label: z$1.ZodNullable<z$1.ZodString>;
        providerKey: z$1.ZodNullable<z$1.ZodString>;
        resetsAtMs: z$1.ZodNullable<z$1.ZodNumber>;
        status: z$1.ZodEnum<{
            allowed: "allowed";
            blocked: "blocked";
            unknown: "unknown";
            warning: "warning";
        }>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type ProviderRateLimitState = z$1.infer<typeof providerRateLimitStateSchema>;
declare const threadEventSchema: z$1.ZodPipe<z$1.ZodUnknown, z$1.ZodUnion<readonly [z$1.ZodIntersection<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"thread/started">;
}, z$1.core.$strip>, z$1.ZodObject<{
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"thread/identity">;
}, z$1.core.$strip>, z$1.ZodObject<{
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"turn/started">;
}, z$1.core.$strip>, z$1.ZodObject<{
    error: z$1.ZodOptional<z$1.ZodObject<{
        message: z$1.ZodString;
    }, z$1.core.$strip>>;
    providerCheckpointId: z$1.ZodOptional<z$1.ZodString>;
    providerThreadId: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodEnum<{
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
    }>;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"turn/completed">;
}, z$1.core.$strip>, z$1.ZodObject<{
    clientRequestId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    scope: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"turn">;
        turnId: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"turn/input/accepted">;
}, z$1.core.$strict>, z$1.ZodObject<{
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    threadName: z$1.ZodString;
    type: z$1.ZodLiteral<"thread/name/updated">;
}, z$1.core.$strip>, z$1.ZodObject<{
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"thread/compacted">;
}, z$1.core.$strip>, z$1.ZodObject<{
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"thread/context/cleared">;
}, z$1.core.$strip>, z$1.ZodObject<{
    objective: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    status: z$1.ZodEnum<{
        active: "active";
        budgetLimited: "budgetLimited";
        complete: "complete";
        paused: "paused";
    }>;
    threadId: z$1.ZodString;
    timeUsedSeconds: z$1.ZodNumber;
    tokenBudget: z$1.ZodNullable<z$1.ZodNumber>;
    tokensUsed: z$1.ZodNumber;
    type: z$1.ZodLiteral<"thread/goal/updated">;
}, z$1.core.$strip>, z$1.ZodObject<{
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"thread/goal/cleared">;
}, z$1.core.$strip>, z$1.ZodObject<{
    item: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        clientRequestId: z$1.ZodOptional<z$1.ZodString>;
        content: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            text: z$1.ZodString;
            type: z$1.ZodLiteral<"text">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            path: z$1.ZodString;
            type: z$1.ZodLiteral<"localImage">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            path: z$1.ZodString;
            type: z$1.ZodLiteral<"localFile">;
        }, z$1.core.$strip>], "type">>;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"userMessage">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        text: z$1.ZodString;
        type: z$1.ZodLiteral<"agentMessage">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        aggregatedOutput: z$1.ZodOptional<z$1.ZodString>;
        approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
            denied: "denied";
            waiting_for_approval: "waiting_for_approval";
        }>>;
        command: z$1.ZodString;
        cwd: z$1.ZodString;
        durationMs: z$1.ZodOptional<z$1.ZodNumber>;
        exitCode: z$1.ZodOptional<z$1.ZodNumber>;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
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
        type: z$1.ZodLiteral<"commandExecution">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
            denied: "denied";
            waiting_for_approval: "waiting_for_approval";
        }>>;
        changes: z$1.ZodArray<z$1.ZodObject<{
            diff: z$1.ZodOptional<z$1.ZodString>;
            kind: z$1.ZodEnum<{
                add: "add";
                delete: "delete";
                update: "update";
            }>;
            movePath: z$1.ZodOptional<z$1.ZodString>;
            path: z$1.ZodString;
        }, z$1.core.$strip>>;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        type: z$1.ZodLiteral<"fileChange">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        queries: z$1.ZodArray<z$1.ZodString>;
        resultText: z$1.ZodNullable<z$1.ZodString>;
        type: z$1.ZodLiteral<"webSearch">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        pattern: z$1.ZodNullable<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        prompt: z$1.ZodNullable<z$1.ZodString>;
        resultText: z$1.ZodNullable<z$1.ZodString>;
        type: z$1.ZodLiteral<"webFetch">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        path: z$1.ZodString;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        type: z$1.ZodLiteral<"imageView">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        cmd: z$1.ZodOptional<z$1.ZodString>;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        path: z$1.ZodString;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        type: z$1.ZodLiteral<"fileRead">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        cmd: z$1.ZodOptional<z$1.ZodString>;
        id: z$1.ZodString;
        mode: z$1.ZodEnum<{
            content: "content";
            list: "list";
            path: "path";
        }>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        path: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        query: z$1.ZodString;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        type: z$1.ZodLiteral<"search">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        arguments: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>>;
        durationMs: z$1.ZodOptional<z$1.ZodNumber>;
        error: z$1.ZodOptional<z$1.ZodString>;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        result: z$1.ZodOptional<z$1.ZodUnknown>;
        server: z$1.ZodOptional<z$1.ZodString>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        tool: z$1.ZodString;
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
        type: z$1.ZodLiteral<"toolCall">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        content: z$1.ZodArray<z$1.ZodString>;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        summary: z$1.ZodArray<z$1.ZodString>;
        type: z$1.ZodLiteral<"reasoning">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        text: z$1.ZodString;
        type: z$1.ZodLiteral<"plan">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        explanation: z$1.ZodOptional<z$1.ZodString>;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        steps: z$1.ZodArray<z$1.ZodObject<{
            status: z$1.ZodOptional<z$1.ZodEnum<{
                active: "active";
                completed: "completed";
                failed: "failed";
                pending: "pending";
            }>>;
            step: z$1.ZodString;
        }, z$1.core.$strip>>;
        type: z$1.ZodLiteral<"planSteps">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        type: z$1.ZodLiteral<"contextCompaction">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        description: z$1.ZodString;
        error: z$1.ZodOptional<z$1.ZodString>;
        familyId: z$1.ZodOptional<z$1.ZodString>;
        id: z$1.ZodString;
        outputFile: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        skipTranscript: z$1.ZodBoolean;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        taskStatus: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            killed: "killed";
            paused: "paused";
            pending: "pending";
            running: "running";
            stopped: "stopped";
        }>;
        taskType: z$1.ZodString;
        type: z$1.ZodLiteral<"backgroundTask">;
        usage: z$1.ZodOptional<z$1.ZodObject<{
            durationMs: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            totalTokens: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        workflow: z$1.ZodOptional<z$1.ZodObject<{
            agents: z$1.ZodArray<z$1.ZodObject<{
                agentType: z$1.ZodOptional<z$1.ZodString>;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
                error: z$1.ZodOptional<z$1.ZodString>;
                index: z$1.ZodNumber;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
                lastProgressAt: z$1.ZodNumber;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                model: z$1.ZodString;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                state: z$1.ZodEnum<{
                    done: "done";
                    failed: "failed";
                    queued: "queued";
                    running: "running";
                    skipped: "skipped";
                }>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                kind: z$1.ZodOptional<z$1.ZodString>;
                title: z$1.ZodString;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        workflowName: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        background: z$1.ZodBoolean;
        childRef: z$1.ZodString;
        id: z$1.ZodString;
        label: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"delegation">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodString & z$1.ZodType<`${string}/${string}`, string, z$1.core.$ZodTypeInternals<`${string}/${string}`, string>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        payload: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
        presentation: z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        type: z$1.ZodLiteral<"extension">;
    }, z$1.core.$strip>], "type">;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"item/started">;
}, z$1.core.$strip>, z$1.ZodObject<{
    item: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        clientRequestId: z$1.ZodOptional<z$1.ZodString>;
        content: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            text: z$1.ZodString;
            type: z$1.ZodLiteral<"text">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            path: z$1.ZodString;
            type: z$1.ZodLiteral<"localImage">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            path: z$1.ZodString;
            type: z$1.ZodLiteral<"localFile">;
        }, z$1.core.$strip>], "type">>;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"userMessage">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        text: z$1.ZodString;
        type: z$1.ZodLiteral<"agentMessage">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        aggregatedOutput: z$1.ZodOptional<z$1.ZodString>;
        approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
            denied: "denied";
            waiting_for_approval: "waiting_for_approval";
        }>>;
        command: z$1.ZodString;
        cwd: z$1.ZodString;
        durationMs: z$1.ZodOptional<z$1.ZodNumber>;
        exitCode: z$1.ZodOptional<z$1.ZodNumber>;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
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
        type: z$1.ZodLiteral<"commandExecution">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
            denied: "denied";
            waiting_for_approval: "waiting_for_approval";
        }>>;
        changes: z$1.ZodArray<z$1.ZodObject<{
            diff: z$1.ZodOptional<z$1.ZodString>;
            kind: z$1.ZodEnum<{
                add: "add";
                delete: "delete";
                update: "update";
            }>;
            movePath: z$1.ZodOptional<z$1.ZodString>;
            path: z$1.ZodString;
        }, z$1.core.$strip>>;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        type: z$1.ZodLiteral<"fileChange">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        queries: z$1.ZodArray<z$1.ZodString>;
        resultText: z$1.ZodNullable<z$1.ZodString>;
        type: z$1.ZodLiteral<"webSearch">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        pattern: z$1.ZodNullable<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        prompt: z$1.ZodNullable<z$1.ZodString>;
        resultText: z$1.ZodNullable<z$1.ZodString>;
        type: z$1.ZodLiteral<"webFetch">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        path: z$1.ZodString;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        type: z$1.ZodLiteral<"imageView">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        cmd: z$1.ZodOptional<z$1.ZodString>;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        path: z$1.ZodString;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        type: z$1.ZodLiteral<"fileRead">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        cmd: z$1.ZodOptional<z$1.ZodString>;
        id: z$1.ZodString;
        mode: z$1.ZodEnum<{
            content: "content";
            list: "list";
            path: "path";
        }>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        path: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        query: z$1.ZodString;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        type: z$1.ZodLiteral<"search">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        arguments: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>>;
        durationMs: z$1.ZodOptional<z$1.ZodNumber>;
        error: z$1.ZodOptional<z$1.ZodString>;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        result: z$1.ZodOptional<z$1.ZodUnknown>;
        server: z$1.ZodOptional<z$1.ZodString>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        tool: z$1.ZodString;
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
        type: z$1.ZodLiteral<"toolCall">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        content: z$1.ZodArray<z$1.ZodString>;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        summary: z$1.ZodArray<z$1.ZodString>;
        type: z$1.ZodLiteral<"reasoning">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        text: z$1.ZodString;
        type: z$1.ZodLiteral<"plan">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        explanation: z$1.ZodOptional<z$1.ZodString>;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        steps: z$1.ZodArray<z$1.ZodObject<{
            status: z$1.ZodOptional<z$1.ZodEnum<{
                active: "active";
                completed: "completed";
                failed: "failed";
                pending: "pending";
            }>>;
            step: z$1.ZodString;
        }, z$1.core.$strip>>;
        type: z$1.ZodLiteral<"planSteps">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        type: z$1.ZodLiteral<"contextCompaction">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        description: z$1.ZodString;
        error: z$1.ZodOptional<z$1.ZodString>;
        familyId: z$1.ZodOptional<z$1.ZodString>;
        id: z$1.ZodString;
        outputFile: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        skipTranscript: z$1.ZodBoolean;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        taskStatus: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            killed: "killed";
            paused: "paused";
            pending: "pending";
            running: "running";
            stopped: "stopped";
        }>;
        taskType: z$1.ZodString;
        type: z$1.ZodLiteral<"backgroundTask">;
        usage: z$1.ZodOptional<z$1.ZodObject<{
            durationMs: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            totalTokens: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        workflow: z$1.ZodOptional<z$1.ZodObject<{
            agents: z$1.ZodArray<z$1.ZodObject<{
                agentType: z$1.ZodOptional<z$1.ZodString>;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
                error: z$1.ZodOptional<z$1.ZodString>;
                index: z$1.ZodNumber;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
                lastProgressAt: z$1.ZodNumber;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                model: z$1.ZodString;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                state: z$1.ZodEnum<{
                    done: "done";
                    failed: "failed";
                    queued: "queued";
                    running: "running";
                    skipped: "skipped";
                }>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                kind: z$1.ZodOptional<z$1.ZodString>;
                title: z$1.ZodString;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        workflowName: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        background: z$1.ZodBoolean;
        childRef: z$1.ZodString;
        id: z$1.ZodString;
        label: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"delegation">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodString & z$1.ZodType<`${string}/${string}`, string, z$1.core.$ZodTypeInternals<`${string}/${string}`, string>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        payload: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
        presentation: z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        type: z$1.ZodLiteral<"extension">;
    }, z$1.core.$strip>], "type">;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"item/completed">;
}, z$1.core.$strip>, z$1.ZodObject<{
    delta: z$1.ZodString;
    itemId: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"item/agentMessage/delta">;
}, z$1.core.$strip>, z$1.ZodObject<{
    delta: z$1.ZodString;
    itemId: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    providerThreadId: z$1.ZodString;
    reset: z$1.ZodOptional<z$1.ZodBoolean>;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"item/commandExecution/outputDelta">;
}, z$1.core.$strip>, z$1.ZodObject<{
    delta: z$1.ZodString;
    itemId: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"item/fileChange/outputDelta">;
}, z$1.core.$strip>, z$1.ZodObject<{
    delta: z$1.ZodString;
    itemId: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"item/reasoning/summaryTextDelta">;
}, z$1.core.$strip>, z$1.ZodObject<{
    delta: z$1.ZodString;
    itemId: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"item/reasoning/textDelta">;
}, z$1.core.$strip>, z$1.ZodObject<{
    delta: z$1.ZodString;
    itemId: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"item/plan/delta">;
}, z$1.core.$strip>, z$1.ZodObject<{
    itemId: z$1.ZodString;
    message: z$1.ZodOptional<z$1.ZodString>;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"item/mcpToolCall/progress">;
}, z$1.core.$strip>, z$1.ZodObject<{
    itemId: z$1.ZodString;
    message: z$1.ZodOptional<z$1.ZodString>;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"item/toolCall/progress">;
}, z$1.core.$strip>, z$1.ZodObject<{
    item: z$1.ZodObject<{
        description: z$1.ZodString;
        error: z$1.ZodOptional<z$1.ZodString>;
        familyId: z$1.ZodOptional<z$1.ZodString>;
        id: z$1.ZodString;
        outputFile: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        skipTranscript: z$1.ZodBoolean;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        taskStatus: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            killed: "killed";
            paused: "paused";
            pending: "pending";
            running: "running";
            stopped: "stopped";
        }>;
        taskType: z$1.ZodString;
        type: z$1.ZodLiteral<"backgroundTask">;
        usage: z$1.ZodOptional<z$1.ZodObject<{
            durationMs: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            totalTokens: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        workflow: z$1.ZodOptional<z$1.ZodObject<{
            agents: z$1.ZodArray<z$1.ZodObject<{
                agentType: z$1.ZodOptional<z$1.ZodString>;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
                error: z$1.ZodOptional<z$1.ZodString>;
                index: z$1.ZodNumber;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
                lastProgressAt: z$1.ZodNumber;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                model: z$1.ZodString;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                state: z$1.ZodEnum<{
                    done: "done";
                    failed: "failed";
                    queued: "queued";
                    running: "running";
                    skipped: "skipped";
                }>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                kind: z$1.ZodOptional<z$1.ZodString>;
                title: z$1.ZodString;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        workflowName: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"item/backgroundTask/progress">;
}, z$1.core.$strip>, z$1.ZodObject<{
    item: z$1.ZodObject<{
        description: z$1.ZodString;
        error: z$1.ZodOptional<z$1.ZodString>;
        familyId: z$1.ZodOptional<z$1.ZodString>;
        id: z$1.ZodString;
        outputFile: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        skipTranscript: z$1.ZodBoolean;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        taskStatus: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            killed: "killed";
            paused: "paused";
            pending: "pending";
            running: "running";
            stopped: "stopped";
        }>;
        taskType: z$1.ZodString;
        type: z$1.ZodLiteral<"backgroundTask">;
        usage: z$1.ZodOptional<z$1.ZodObject<{
            durationMs: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            totalTokens: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        workflow: z$1.ZodOptional<z$1.ZodObject<{
            agents: z$1.ZodArray<z$1.ZodObject<{
                agentType: z$1.ZodOptional<z$1.ZodString>;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
                error: z$1.ZodOptional<z$1.ZodString>;
                index: z$1.ZodNumber;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
                lastProgressAt: z$1.ZodNumber;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                model: z$1.ZodString;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                state: z$1.ZodEnum<{
                    done: "done";
                    failed: "failed";
                    queued: "queued";
                    running: "running";
                    skipped: "skipped";
                }>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                kind: z$1.ZodOptional<z$1.ZodString>;
                title: z$1.ZodString;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        workflowName: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"item/backgroundTask/completed">;
}, z$1.core.$strip>, z$1.ZodObject<{
    item: z$1.ZodObject<{
        background: z$1.ZodBoolean;
        childRef: z$1.ZodString;
        id: z$1.ZodString;
        label: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"delegation">;
    }, z$1.core.$strip>;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"item/delegation/progress">;
}, z$1.core.$strip>, z$1.ZodObject<{
    item: z$1.ZodObject<{
        background: z$1.ZodBoolean;
        childRef: z$1.ZodString;
        id: z$1.ZodString;
        label: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"delegation">;
    }, z$1.core.$strip>;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"item/delegation/completed">;
}, z$1.core.$strip>, z$1.ZodObject<{
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    tokenUsage: z$1.ZodObject<{
        last: z$1.ZodObject<{
            cachedInputTokens: z$1.ZodNumber;
            inputTokens: z$1.ZodNumber;
            outputTokens: z$1.ZodNumber;
            reasoningOutputTokens: z$1.ZodNumber;
            totalTokens: z$1.ZodNumber;
        }, z$1.core.$strip>;
        modelContextWindow: z$1.ZodNullable<z$1.ZodNumber>;
        total: z$1.ZodObject<{
            cachedInputTokens: z$1.ZodNumber;
            inputTokens: z$1.ZodNumber;
            outputTokens: z$1.ZodNumber;
            reasoningOutputTokens: z$1.ZodNumber;
            totalTokens: z$1.ZodNumber;
        }, z$1.core.$strip>;
    }, z$1.core.$strip>;
    type: z$1.ZodLiteral<"thread/tokenUsage/updated">;
}, z$1.core.$strip>, z$1.ZodObject<{
    contextWindowUsage: z$1.ZodObject<{
        estimated: z$1.ZodBoolean;
        modelContextWindow: z$1.ZodNullable<z$1.ZodNumber>;
        usedTokens: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"thread/contextWindowUsage/updated">;
}, z$1.core.$strip>, z$1.ZodObject<{
    explanation: z$1.ZodOptional<z$1.ZodString>;
    plan: z$1.ZodArray<z$1.ZodObject<{
        status: z$1.ZodOptional<z$1.ZodEnum<{
            active: "active";
            completed: "completed";
            failed: "failed";
            pending: "pending";
        }>>;
        step: z$1.ZodString;
    }, z$1.core.$strip>>;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"turn/plan/updated">;
}, z$1.core.$strip>, z$1.ZodObject<{
    diff: z$1.ZodOptional<z$1.ZodString>;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"turn/diff/updated">;
}, z$1.core.$strip>, z$1.ZodObject<{
    detail: z$1.ZodOptional<z$1.ZodString>;
    errorInfo: z$1.ZodOptional<z$1.ZodObject<{
        category: z$1.ZodEnum<{
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
        httpStatusCode: z$1.ZodNullable<z$1.ZodNumber>;
        providerCode: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>;
    message: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"provider/error">;
    willRetry: z$1.ZodOptional<z$1.ZodBoolean>;
}, z$1.core.$strip>, z$1.ZodObject<{
    providerThreadId: z$1.ZodString;
    rateLimits: z$1.ZodObject<{
        kind: z$1.ZodEnum<{
            "spend-control": "spend-control";
            "subscription-window": "subscription-window";
            credits: "credits";
            unknown: "unknown";
        }>;
        overageReason: z$1.ZodNullable<z$1.ZodString>;
        overageStatus: z$1.ZodNullable<z$1.ZodEnum<{
            allowed: "allowed";
            rejected: "rejected";
            unavailable: "unavailable";
            warning: "warning";
        }>>;
        providerId: z$1.ZodString;
        reachedReason: z$1.ZodNullable<z$1.ZodString>;
        status: z$1.ZodEnum<{
            allowed: "allowed";
            blocked: "blocked";
            unknown: "unknown";
            warning: "warning";
        }>;
        windows: z$1.ZodArray<z$1.ZodObject<{
            label: z$1.ZodNullable<z$1.ZodString>;
            providerKey: z$1.ZodNullable<z$1.ZodString>;
            resetsAtMs: z$1.ZodNullable<z$1.ZodNumber>;
            status: z$1.ZodEnum<{
                allowed: "allowed";
                blocked: "blocked";
                unknown: "unknown";
                warning: "warning";
            }>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"provider/rateLimits/updated">;
}, z$1.core.$strip>, z$1.ZodObject<{
    entries: z$1.ZodArray<z$1.ZodObject<{
        name: z$1.ZodString;
        reason: z$1.ZodOptional<z$1.ZodString>;
        source: z$1.ZodUnion<readonly [z$1.ZodLiteral<"shell">, z$1.ZodObject<{
            plugin: z$1.ZodString;
        }, z$1.core.$strict>]>;
        value: z$1.ZodUnion<readonly [z$1.ZodString, z$1.ZodObject<{
            masked: z$1.ZodLiteral<true>;
        }, z$1.core.$strict>]>;
    }, z$1.core.$strict>>;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"provider.env-resolved">;
}, z$1.core.$strip>, z$1.ZodObject<{
    kind: z$1.ZodString & z$1.ZodType<`${string}/${string}`, string, z$1.core.$ZodTypeInternals<`${string}/${string}`, string>>;
    payload: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
    providerThreadId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"thread/extensionState/updated">;
}, z$1.core.$strip>, z$1.ZodObject<{
    category: z$1.ZodEnum<{
        "compaction-skipped": "compaction-skipped";
        config: "config";
        deprecation: "deprecation";
        general: "general";
    }>;
    details: z$1.ZodOptional<z$1.ZodString>;
    providerThreadId: z$1.ZodString;
    summary: z$1.ZodOptional<z$1.ZodString>;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"provider/warning">;
}, z$1.core.$strip>, z$1.ZodObject<{
    fallbackModel: z$1.ZodString;
    message: z$1.ZodString;
    originalModel: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    reason: z$1.ZodEnum<{
        provider: "provider";
        refusal: "refusal";
    }>;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"provider/modelFallback">;
}, z$1.core.$strip>, z$1.ZodObject<{
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    providerId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    rawEvent: z$1.ZodObject<{
        id: z$1.ZodOptional<z$1.ZodUnion<readonly [z$1.ZodString, z$1.ZodNumber]>>;
        jsonrpc: z$1.ZodLiteral<"2.0">;
        method: z$1.ZodString;
        params: z$1.ZodOptional<z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>>;
    }, z$1.core.$strip>;
    rawType: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"provider/unhandled">;
}, z$1.core.$strip>], "type">, z$1.ZodObject<{
    scope: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"turn">;
        turnId: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
}, z$1.core.$strip>>, z$1.ZodIntersection<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    direction: z$1.ZodLiteral<"outbound">;
    initiator: z$1.ZodEnum<{
        agent: "agent";
        system: "system";
        user: "user";
    }>;
    request: z$1.ZodObject<{
        method: z$1.ZodEnum<{
            "thread/start": "thread/start";
            "turn/start": "turn/start";
        }>;
        params: z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>;
    }, z$1.core.$strip>;
    source: z$1.ZodEnum<{
        spawn: "spawn";
        tell: "tell";
    }>;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"client/thread/start">;
}, z$1.core.$strip>, z$1.ZodObject<{
    direction: z$1.ZodLiteral<"outbound">;
    execution: z$1.ZodObject<{
        model: z$1.ZodString;
        permissionMode: z$1.ZodEnum<{
            "accept-edits": "accept-edits";
            "workspace-write": "workspace-write";
            auto: "auto";
            full: "full";
            readonly: "readonly";
        }>;
        reasoningLevel: z$1.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            none: "none";
            ultra: "ultra";
            ultracode: "ultracode";
            xhigh: "xhigh";
        }>;
        seq: z$1.ZodOptional<z$1.ZodNumber>;
        serviceTier: z$1.ZodEnum<{
            default: "default";
            fast: "fast";
        }>;
        source: z$1.ZodEnum<{
            "client/thread/start": "client/thread/start";
            "client/turn/requested": "client/turn/requested";
            "client/turn/start": "client/turn/start";
        }>;
    }, z$1.core.$strip>;
    initiator: z$1.ZodEnum<{
        agent: "agent";
        system: "system";
        user: "user";
    }>;
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                label: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                threadId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                label: z$1.ZodString;
                projectId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                label: z$1.ZodString;
                sectionId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                entryKind: z$1.ZodEnum<{
                    directory: "directory";
                    file: "file";
                }>;
                kind: z$1.ZodLiteral<"path">;
                label: z$1.ZodString;
                path: z$1.ZodString;
                source: z$1.ZodEnum<{
                    "thread-storage": "thread-storage";
                    workspace: "workspace";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
                kind: z$1.ZodLiteral<"command">;
                label: z$1.ZodString;
                name: z$1.ZodString;
                origin: z$1.ZodEnum<{
                    builtin: "builtin";
                    project: "project";
                    user: "user";
                }>;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                kind: z$1.ZodLiteral<"plugin">;
                label: z$1.ZodString;
                pluginId: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
            start: z$1.ZodNumber;
        }, z$1.core.$strip>>>;
        text: z$1.ZodString;
        type: z$1.ZodLiteral<"text">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        path: z$1.ZodString;
        type: z$1.ZodLiteral<"localImage">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        mimeType: z$1.ZodOptional<z$1.ZodString>;
        name: z$1.ZodOptional<z$1.ZodString>;
        path: z$1.ZodString;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        type: z$1.ZodLiteral<"localFile">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>], "type">>;
    inputGroups: z$1.ZodOptional<z$1.ZodArray<z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                label: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                threadId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                label: z$1.ZodString;
                projectId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                label: z$1.ZodString;
                sectionId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                entryKind: z$1.ZodEnum<{
                    directory: "directory";
                    file: "file";
                }>;
                kind: z$1.ZodLiteral<"path">;
                label: z$1.ZodString;
                path: z$1.ZodString;
                source: z$1.ZodEnum<{
                    "thread-storage": "thread-storage";
                    workspace: "workspace";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
                kind: z$1.ZodLiteral<"command">;
                label: z$1.ZodString;
                name: z$1.ZodString;
                origin: z$1.ZodEnum<{
                    builtin: "builtin";
                    project: "project";
                    user: "user";
                }>;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                kind: z$1.ZodLiteral<"plugin">;
                label: z$1.ZodString;
                pluginId: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
            start: z$1.ZodNumber;
        }, z$1.core.$strip>>>;
        text: z$1.ZodString;
        type: z$1.ZodLiteral<"text">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        path: z$1.ZodString;
        type: z$1.ZodLiteral<"localImage">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        mimeType: z$1.ZodOptional<z$1.ZodString>;
        name: z$1.ZodOptional<z$1.ZodString>;
        path: z$1.ZodString;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        type: z$1.ZodLiteral<"localFile">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>], "type">>>>;
    request: z$1.ZodObject<{
        method: z$1.ZodEnum<{
            "thread/start": "thread/start";
            "turn/start": "turn/start";
        }>;
        params: z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>;
    }, z$1.core.$strip>;
    requestId: z$1.ZodString;
    retryAttempt: z$1.ZodOptional<z$1.ZodNumber>;
    retryOfRequestId: z$1.ZodOptional<z$1.ZodString>;
    senderThreadId: z$1.ZodNullable<z$1.ZodString>;
    source: z$1.ZodEnum<{
        spawn: "spawn";
        tell: "tell";
    }>;
    systemMessageKind: z$1.ZodOptional<z$1.ZodEnum<{
        "child-completed": "child-completed";
        "child-failed": "child-failed";
        "child-interrupted": "child-interrupted";
        "child-needs-attention": "child-needs-attention";
        "child-outcome-batch": "child-outcome-batch";
        "ownership-assigned": "ownership-assigned";
        "ownership-removed": "ownership-removed";
        unlabeled: "unlabeled";
    }>>;
    systemMessageSubject: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
        threadId: z$1.ZodString;
        threadName: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        count: z$1.ZodNumber;
        kind: z$1.ZodLiteral<"thread-batch">;
    }, z$1.core.$strip>], "kind">>>;
    target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread-start">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"new-turn">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        expectedTurnId: z$1.ZodNullable<z$1.ZodString>;
        kind: z$1.ZodLiteral<"auto">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        expectedTurnId: z$1.ZodNullable<z$1.ZodString>;
        kind: z$1.ZodLiteral<"steer">;
    }, z$1.core.$strip>], "kind">;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"client/turn/requested">;
}, z$1.core.$strip>, z$1.ZodObject<{
    message: z$1.ZodString;
    reason: z$1.ZodString;
    requestId: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"client/turn/rejected">;
}, z$1.core.$strip>, z$1.ZodObject<{
    direction: z$1.ZodLiteral<"outbound">;
    initiator: z$1.ZodEnum<{
        agent: "agent";
        system: "system";
        user: "user";
    }>;
    request: z$1.ZodObject<{
        method: z$1.ZodEnum<{
            "thread/start": "thread/start";
            "turn/start": "turn/start";
        }>;
        params: z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>;
    }, z$1.core.$strip>;
    source: z$1.ZodEnum<{
        spawn: "spawn";
        tell: "tell";
    }>;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"client/turn/start">;
}, z$1.core.$strip>, z$1.ZodObject<{
    code: z$1.ZodOptional<z$1.ZodString>;
    detail: z$1.ZodOptional<z$1.ZodString>;
    message: z$1.ZodString;
    reconnectAttempt: z$1.ZodOptional<z$1.ZodNumber>;
    reconnectTotal: z$1.ZodOptional<z$1.ZodNumber>;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"system/error">;
}, z$1.core.$strip>, z$1.ZodObject<{
    text: z$1.ZodString;
    threadId: z$1.ZodString;
    toolCallId: z$1.ZodOptional<z$1.ZodString>;
    turnId: z$1.ZodOptional<z$1.ZodString>;
    type: z$1.ZodLiteral<"system/manager/user_message">;
}, z$1.core.$strip>, z$1.ZodObject<{
    cause: z$1.ZodOptional<z$1.ZodLiteral<"host-connection-lost">>;
    reason: z$1.ZodEnum<{
        "host-daemon-restarted": "host-daemon-restarted";
        "manual-stop": "manual-stop";
        "provider-turn-idle": "provider-turn-idle";
    }>;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"system/thread/interrupted">;
}, z$1.core.$strip>, z$1.ZodObject<{
    message: z$1.ZodString;
    metadata: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>>>;
    operation: z$1.ZodString;
    operationId: z$1.ZodString;
    status: z$1.ZodString;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"system/operation">;
}, z$1.core.$strip>, z$1.ZodObject<{
    interaction: z$1.ZodUnion<readonly [z$1.ZodObject<{
        id: z$1.ZodString;
        origin: z$1.ZodObject<{
            kind: z$1.ZodLiteral<"provider">;
            providerId: z$1.ZodString;
            providerRequestId: z$1.ZodString;
        }, z$1.core.$strip>;
        payload: z$1.ZodObject<{
            kind: z$1.ZodLiteral<"approval">;
            reason: z$1.ZodNullable<z$1.ZodString>;
            subject: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                actions: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                    command: z$1.ZodString;
                    name: z$1.ZodString;
                    path: z$1.ZodString;
                    type: z$1.ZodLiteral<"read">;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    command: z$1.ZodString;
                    path: z$1.ZodNullable<z$1.ZodString>;
                    type: z$1.ZodLiteral<"listFiles">;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    command: z$1.ZodString;
                    path: z$1.ZodNullable<z$1.ZodString>;
                    query: z$1.ZodNullable<z$1.ZodString>;
                    type: z$1.ZodLiteral<"search">;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    command: z$1.ZodString;
                    type: z$1.ZodLiteral<"unknown">;
                }, z$1.core.$strip>], "type">>;
                command: z$1.ZodString;
                cwd: z$1.ZodNullable<z$1.ZodString>;
                itemId: z$1.ZodString;
                kind: z$1.ZodLiteral<"command">;
                sessionGrant: z$1.ZodNullable<z$1.ZodObject<{
                    fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                        read: z$1.ZodArray<z$1.ZodString>;
                        write: z$1.ZodArray<z$1.ZodString>;
                    }, z$1.core.$strip>>;
                    network: z$1.ZodNullable<z$1.ZodObject<{
                        enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                    }, z$1.core.$strip>>;
                }, z$1.core.$strict>>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                itemId: z$1.ZodString;
                kind: z$1.ZodLiteral<"file_change">;
                sessionGrant: z$1.ZodNullable<z$1.ZodObject<{
                    fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                        read: z$1.ZodArray<z$1.ZodString>;
                        write: z$1.ZodArray<z$1.ZodString>;
                    }, z$1.core.$strip>>;
                    network: z$1.ZodNullable<z$1.ZodObject<{
                        enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                    }, z$1.core.$strip>>;
                }, z$1.core.$strict>>;
                writeScope: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                itemId: z$1.ZodString;
                kind: z$1.ZodLiteral<"permission_grant">;
                permissions: z$1.ZodObject<{
                    fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                        read: z$1.ZodArray<z$1.ZodString>;
                        write: z$1.ZodArray<z$1.ZodString>;
                    }, z$1.core.$strip>>;
                    network: z$1.ZodNullable<z$1.ZodObject<{
                        enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                    }, z$1.core.$strip>>;
                }, z$1.core.$strict>;
                toolName: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                itemId: z$1.ZodString;
                kind: z$1.ZodLiteral<"plan">;
                plan: z$1.ZodString;
                planFilePath: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                itemId: z$1.ZodString;
                kind: z$1.ZodLiteral<"tool_use">;
                presentation: z$1.ZodObject<{
                    badge: z$1.ZodOptional<z$1.ZodObject<{
                        glyph: z$1.ZodString;
                        hint: z$1.ZodString;
                        label: z$1.ZodString;
                        tone: z$1.ZodEnum<{
                            destructive: "destructive";
                            neutral: "neutral";
                        }>;
                    }, z$1.core.$strip>>;
                    detail: z$1.ZodOptional<z$1.ZodString>;
                    icon: z$1.ZodObject<{
                        glyph: z$1.ZodString;
                    }, z$1.core.$strip>;
                    label: z$1.ZodObject<{
                        completed: z$1.ZodString;
                        pending: z$1.ZodString;
                    }, z$1.core.$strip>;
                    suppress: z$1.ZodOptional<z$1.ZodBoolean>;
                    tint: z$1.ZodOptional<z$1.ZodObject<{
                        dark: z$1.ZodString;
                        light: z$1.ZodString;
                    }, z$1.core.$strip>>;
                    title: z$1.ZodOptional<z$1.ZodString>;
                }, z$1.core.$strip>;
                tool: z$1.ZodString;
            }, z$1.core.$strip>], "kind">;
        }, z$1.core.$strip>;
        resolution: z$1.ZodNullable<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            decision: z$1.ZodLiteral<"allow_once">;
            grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            decision: z$1.ZodLiteral<"allow_for_session">;
            grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            decision: z$1.ZodLiteral<"deny">;
        }, z$1.core.$strip>], "decision">>;
        status: z$1.ZodEnum<{
            interrupted: "interrupted";
            pending: "pending";
            resolved: "resolved";
            resolving: "resolving";
        }>;
        statusReason: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        id: z$1.ZodString;
        origin: z$1.ZodObject<{
            kind: z$1.ZodLiteral<"provider">;
            providerId: z$1.ZodString;
            providerRequestId: z$1.ZodString;
        }, z$1.core.$strip>;
        payload: z$1.ZodObject<{
            kind: z$1.ZodLiteral<"user_question">;
            questions: z$1.ZodArray<z$1.ZodObject<{
                allowFreeText: z$1.ZodBoolean;
                id: z$1.ZodString;
                multiSelect: z$1.ZodBoolean;
                options: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
                    description: z$1.ZodOptional<z$1.ZodString>;
                    label: z$1.ZodString;
                    value: z$1.ZodString;
                }, z$1.core.$strip>>>;
                prompt: z$1.ZodString;
                shortLabel: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>;
        resolution: z$1.ZodNullable<z$1.ZodObject<{
            answers: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
                freeText: z$1.ZodOptional<z$1.ZodString>;
                selected: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
            kind: z$1.ZodLiteral<"user_answer">;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            interrupted: "interrupted";
            pending: "pending";
            resolved: "resolved";
            resolving: "resolving";
        }>;
        statusReason: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        id: z$1.ZodString;
        origin: z$1.ZodObject<{
            kind: z$1.ZodLiteral<"plugin">;
            pluginId: z$1.ZodString;
            rendererId: z$1.ZodString;
        }, z$1.core.$strip>;
        payload: z$1.ZodObject<{
            kind: z$1.ZodLiteral<"plugin">;
            title: z$1.ZodString;
        }, z$1.core.$strip>;
        resolution: z$1.ZodNullable<z$1.ZodObject<{
            kind: z$1.ZodLiteral<"plugin_submitted">;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            interrupted: "interrupted";
            pending: "pending";
            resolved: "resolved";
            resolving: "resolving";
        }>;
        statusReason: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        id: z$1.ZodString;
        origin: z$1.ZodObject<{
            kind: z$1.ZodLiteral<"provider">;
            providerId: z$1.ZodString;
            providerRequestId: z$1.ZodString;
        }, z$1.core.$strip>;
        payload: z$1.ZodObject<{
            kind: z$1.ZodString & z$1.ZodType<`${string}/${string}`, string, z$1.core.$ZodTypeInternals<`${string}/${string}`, string>>;
            title: z$1.ZodString;
        }, z$1.core.$strip>;
        resolution: z$1.ZodNullable<z$1.ZodObject<{
            kind: z$1.ZodLiteral<"request_answer">;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            interrupted: "interrupted";
            pending: "pending";
            resolved: "resolved";
            resolving: "resolving";
        }>;
        statusReason: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>]>;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"system/interaction/lifecycle">;
}, z$1.core.$strip>, z$1.ZodObject<{
    interactionId: z$1.ZodString;
    providerId: z$1.ZodString;
    providerRequestId: z$1.ZodString;
    resolution: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_once">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_for_session">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"deny">;
    }, z$1.core.$strip>], "decision">>>;
    status: z$1.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolved: "resolved";
        resolving: "resolving";
    }>;
    statusReason: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
    subject: z$1.ZodObject<{
        itemId: z$1.ZodString;
        kind: z$1.ZodLiteral<"permission_grant">;
        permissions: z$1.ZodObject<{
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>;
        toolName: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"system/permissionGrant/lifecycle">;
}, z$1.core.$strip>, z$1.ZodObject<{
    interactionId: z$1.ZodString;
    payload: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"user_question">;
        questions: z$1.ZodArray<z$1.ZodObject<{
            allowFreeText: z$1.ZodBoolean;
            id: z$1.ZodString;
            multiSelect: z$1.ZodBoolean;
            options: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
                description: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
                value: z$1.ZodString;
            }, z$1.core.$strip>>>;
            prompt: z$1.ZodString;
            shortLabel: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>;
    providerId: z$1.ZodString;
    providerRequestId: z$1.ZodString;
    resolution: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodObject<{
        answers: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
            freeText: z$1.ZodOptional<z$1.ZodString>;
            selected: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strip>>;
        kind: z$1.ZodLiteral<"user_answer">;
    }, z$1.core.$strip>>>;
    status: z$1.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolved: "resolved";
        resolving: "resolving";
    }>;
    statusReason: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"system/userQuestion/lifecycle">;
}, z$1.core.$strip>, z$1.ZodObject<{
    entries: z$1.ZodArray<z$1.ZodObject<{
        key: z$1.ZodString;
        metadata: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>>;
        startedAt: z$1.ZodOptional<z$1.ZodNumber>;
        status: z$1.ZodOptional<z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            started: "started";
        }>>;
        text: z$1.ZodString;
        type: z$1.ZodEnum<{
            output: "output";
            step: "step";
        }>;
    }, z$1.core.$strip>>;
    environmentId: z$1.ZodString;
    provisioningId: z$1.ZodString;
    status: z$1.ZodEnum<{
        active: "active";
        cancelled: "cancelled";
        completed: "completed";
        failed: "failed";
    }>;
    threadId: z$1.ZodString;
    type: z$1.ZodLiteral<"system/thread-provisioning">;
}, z$1.core.$strip>, z$1.ZodObject<{
    activeTurnId: z$1.ZodString;
    activeTurnStartedAt: z$1.ZodNumber;
    elapsedMs: z$1.ZodNumber;
    firedAt: z$1.ZodNumber;
    lastActivityEventAt: z$1.ZodNumber;
    lastActivityEventSequence: z$1.ZodNumber;
    lastActivityEventType: z$1.ZodString;
    providerId: z$1.ZodString;
    providerThreadId: z$1.ZodNullable<z$1.ZodString>;
    reason: z$1.ZodLiteral<"provider-turn-idle">;
    threadId: z$1.ZodString;
    thresholdMs: z$1.ZodNumber;
    type: z$1.ZodLiteral<"system/provider-turn-watchdog">;
}, z$1.core.$strip>], "type">, z$1.ZodObject<{
    scope: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"turn">;
        turnId: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
}, z$1.core.$strip>>]>>;
type ThreadEvent = z$1.infer<typeof threadEventSchema>;
type ThreadEventType = ThreadEvent["type"];

declare const projectSchema: z$1.ZodObject<{
    createdAt: z$1.ZodNumber;
    gitRemoteUrl: z$1.ZodNullable<z$1.ZodString>;
    id: z$1.ZodString;
    kind: z$1.ZodEnum<{
        personal: "personal";
        standard: "standard";
    }>;
    name: z$1.ZodString;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type Project = z$1.infer<typeof projectSchema>;
declare const projectSourceSchema: z$1.ZodObject<{
    createdAt: z$1.ZodNumber;
    hostId: z$1.ZodString;
    id: z$1.ZodString;
    isDefault: z$1.ZodBoolean;
    path: z$1.ZodString;
    projectId: z$1.ZodString;
    type: z$1.ZodLiteral<"local_path">;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type ProjectSource = z$1.infer<typeof projectSourceSchema>;

declare const reasoningLevelSchema: z$1.ZodEnum<{
    high: "high";
    low: "low";
    max: "max";
    medium: "medium";
    none: "none";
    ultra: "ultra";
    ultracode: "ultracode";
    xhigh: "xhigh";
}>;
type ReasoningLevel = z$1.infer<typeof reasoningLevelSchema>;
declare const serviceTierSchema: z$1.ZodEnum<{
    default: "default";
    fast: "fast";
}>;
type ServiceTier = z$1.infer<typeof serviceTierSchema>;
declare const permissionModeSchema: z$1.ZodEnum<{
    "accept-edits": "accept-edits";
    auto: "auto";
    full: "full";
}>;
type PermissionMode = z$1.infer<typeof permissionModeSchema>;
declare const promptInputSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
        end: z$1.ZodNumber;
        resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"thread">;
            label: z$1.ZodString;
            projectId: z$1.ZodOptional<z$1.ZodString>;
            threadId: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"project">;
            label: z$1.ZodString;
            projectId: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"section">;
            label: z$1.ZodString;
            sectionId: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            entryKind: z$1.ZodEnum<{
                directory: "directory";
                file: "file";
            }>;
            kind: z$1.ZodLiteral<"path">;
            label: z$1.ZodString;
            path: z$1.ZodString;
            source: z$1.ZodEnum<{
                "thread-storage": "thread-storage";
                workspace: "workspace";
            }>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            argumentHint: z$1.ZodNullable<z$1.ZodString>;
            kind: z$1.ZodLiteral<"command">;
            label: z$1.ZodString;
            name: z$1.ZodString;
            origin: z$1.ZodEnum<{
                builtin: "builtin";
                project: "project";
                user: "user";
            }>;
            source: z$1.ZodEnum<{
                command: "command";
                skill: "skill";
            }>;
            trigger: z$1.ZodEnum<{
                "/": "/";
            }>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
            itemId: z$1.ZodString;
            kind: z$1.ZodLiteral<"plugin">;
            label: z$1.ZodString;
            pluginId: z$1.ZodString;
        }, z$1.core.$strip>], "kind">>;
        start: z$1.ZodNumber;
    }, z$1.core.$strip>>>;
    text: z$1.ZodString;
    type: z$1.ZodLiteral<"text">;
    visibility: z$1.ZodOptional<z$1.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"image">;
    url: z$1.ZodString;
    visibility: z$1.ZodOptional<z$1.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    path: z$1.ZodString;
    type: z$1.ZodLiteral<"localImage">;
    visibility: z$1.ZodOptional<z$1.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    mimeType: z$1.ZodOptional<z$1.ZodString>;
    name: z$1.ZodOptional<z$1.ZodString>;
    path: z$1.ZodString;
    sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
    type: z$1.ZodLiteral<"localFile">;
    visibility: z$1.ZodOptional<z$1.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
}, z$1.core.$strip>], "type">;
type PromptInput = z$1.infer<typeof promptInputSchema>;
declare const callerExecutionInputSourceSchema: z$1.ZodEnum<{
    "client-preference": "client-preference";
    explicit: "explicit";
}>;
type CallerExecutionInputSource = z$1.infer<typeof callerExecutionInputSourceSchema>;
declare const resolvedThreadExecutionOptionsSchema: z$1.ZodObject<{
    model: z$1.ZodString;
    permissionMode: z$1.ZodEnum<{
        "accept-edits": "accept-edits";
        auto: "auto";
        full: "full";
    }>;
    reasoningLevel: z$1.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        none: "none";
        ultra: "ultra";
        ultracode: "ultracode";
        xhigh: "xhigh";
    }>;
    seq: z$1.ZodOptional<z$1.ZodNumber>;
    serviceTier: z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>;
    source: z$1.ZodEnum<{
        "client/thread/start": "client/thread/start";
        "client/turn/requested": "client/turn/requested";
        "client/turn/start": "client/turn/start";
    }>;
}, z$1.core.$strip>;
type ResolvedThreadExecutionOptions = z$1.infer<typeof resolvedThreadExecutionOptionsSchema>;
declare const projectExecutionDefaultsSchema: z$1.ZodObject<{
    model: z$1.ZodString;
    permissionMode: z$1.ZodEnum<{
        "accept-edits": "accept-edits";
        auto: "auto";
        full: "full";
    }>;
    providerId: z$1.ZodString;
    reasoningLevel: z$1.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        none: "none";
        ultra: "ultra";
        ultracode: "ultracode";
        xhigh: "xhigh";
    }>;
    serviceTier: z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>;
}, z$1.core.$strip>;
type ProjectExecutionDefaults = z$1.infer<typeof projectExecutionDefaultsSchema>;

/**
 * Who owns a wait, as the denormalized `waitHolder` column stores it.
 *
 * This exists only because the orphan sweep and the per-plugin release both
 * need an indexed equality lookup ("every row this plugin is holding"), which
 * a JSON `waitingOn` cannot serve. It is written by the same single writer
 * that writes `waitingOn`, derived from it — never set independently — so the
 * two cannot drift. Core waits have no holder.
 */
declare const queuedMessageWaitHolderSchema: z$1.ZodTemplateLiteral<`plugin:${string}`>;
type QueuedMessageWaitHolder = z$1.infer<typeof queuedMessageWaitHolderSchema>;

declare const PROVIDER_FORK_VALUES: readonly ["none", "tip", "checkpoint"];
type ProviderFork = (typeof PROVIDER_FORK_VALUES)[number];

declare const providerInfoSchema: z$1.ZodObject<{
    available: z$1.ZodBoolean;
    capabilities: z$1.ZodObject<{
        modelCatalogScope: z$1.ZodEnum<{
            host: "host";
            workspace: "workspace";
        }>;
        permissionModes: z$1.ZodArray<z$1.ZodEnum<{
            "accept-edits": "accept-edits";
            auto: "auto";
            full: "full";
        }>>;
        supportsFork: z$1.ZodBoolean;
        supportsNativeUserQuestion: z$1.ZodBoolean;
        supportsServiceTier: z$1.ZodBoolean;
        supportsSessionRewind: z$1.ZodBoolean;
        supportsThreadArchive: z$1.ZodBoolean;
        supportsThreadRename: z$1.ZodBoolean;
    }, z$1.core.$strip>;
    composerActions: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"skills">;
        trigger: z$1.ZodEnum<{
            "/": "/";
        }>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        command: z$1.ZodObject<{
            name: z$1.ZodString;
            trailingText: z$1.ZodString;
            trigger: z$1.ZodEnum<{
                "/": "/";
            }>;
        }, z$1.core.$strip>;
        kind: z$1.ZodLiteral<"plan">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        command: z$1.ZodObject<{
            name: z$1.ZodString;
            trailingText: z$1.ZodString;
            trigger: z$1.ZodEnum<{
                "/": "/";
            }>;
        }, z$1.core.$strip>;
        kind: z$1.ZodLiteral<"goal">;
    }, z$1.core.$strip>], "kind">>;
    displayName: z$1.ZodString;
    extensionKinds: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString & z$1.ZodType<`${string}/${string}`, string, z$1.core.$ZodTypeInternals<`${string}/${string}`, string>>, z$1.ZodObject<{
        item: z$1.ZodBoolean;
        state: z$1.ZodBoolean;
    }, z$1.core.$strip>>>;
    family: z$1.ZodOptional<z$1.ZodString>;
    icon: z$1.ZodOptional<z$1.ZodObject<{
        glyph: z$1.ZodString;
    }, z$1.core.$strip>>;
    id: z$1.ZodString;
    logoUrl: z$1.ZodNullable<z$1.ZodString>;
    maintenance: z$1.ZodObject<{
        health: z$1.ZodBoolean;
        installation: z$1.ZodBoolean;
        usage: z$1.ZodBoolean;
    }, z$1.core.$strip>;
    pluginId: z$1.ZodString;
    reasoningLevels: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
        description: z$1.ZodOptional<z$1.ZodString>;
        id: z$1.ZodString;
        label: z$1.ZodString;
    }, z$1.core.$strip>>>;
    serviceTiers: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
        description: z$1.ZodOptional<z$1.ZodString>;
        id: z$1.ZodString;
        label: z$1.ZodString;
    }, z$1.core.$strip>>>;
    strings: z$1.ZodOptional<z$1.ZodObject<{
        brandPrefix: z$1.ZodOptional<z$1.ZodString>;
        expiredHint: z$1.ZodString;
        iconTint: z$1.ZodOptional<z$1.ZodObject<{
            dark: z$1.ZodString;
            light: z$1.ZodString;
        }, z$1.core.$strip>>;
        installUrl: z$1.ZodString;
        planModeCopy: z$1.ZodOptional<z$1.ZodString>;
        signInHint: z$1.ZodString;
    }, z$1.core.$strip>>;
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
type StoredThreadEventDataFromEvent<TEvent extends ThreadEvent> = Omit<TEvent, "scope" | "threadId" | "type">;
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
    active: "active";
    error: "error";
    idle: "idle";
    pending: "pending";
    starting: "starting";
    stopping: "stopping";
}>;
type ThreadStatus = z$1.infer<typeof threadStatusSchema>;

declare const threadTimelinePendingTodosSchema: z$1.ZodObject<{
    items: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        status: z$1.ZodEnum<{
            completed: "completed";
            in_progress: "in_progress";
            pending: "pending";
        }>;
        text: z$1.ZodString;
    }, z$1.core.$strip>>;
    sourceSeq: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type ThreadTimelinePendingTodos = z$1.infer<typeof threadTimelinePendingTodosSchema>;

declare const threadQueuedMessageSchema: z$1.ZodObject<{
    content: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                label: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                threadId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                label: z$1.ZodString;
                projectId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                label: z$1.ZodString;
                sectionId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                entryKind: z$1.ZodEnum<{
                    directory: "directory";
                    file: "file";
                }>;
                kind: z$1.ZodLiteral<"path">;
                label: z$1.ZodString;
                path: z$1.ZodString;
                source: z$1.ZodEnum<{
                    "thread-storage": "thread-storage";
                    workspace: "workspace";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
                kind: z$1.ZodLiteral<"command">;
                label: z$1.ZodString;
                name: z$1.ZodString;
                origin: z$1.ZodEnum<{
                    builtin: "builtin";
                    project: "project";
                    user: "user";
                }>;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                kind: z$1.ZodLiteral<"plugin">;
                label: z$1.ZodString;
                pluginId: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
            start: z$1.ZodNumber;
        }, z$1.core.$strip>>>;
        text: z$1.ZodString;
        type: z$1.ZodLiteral<"text">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        path: z$1.ZodString;
        type: z$1.ZodLiteral<"localImage">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        mimeType: z$1.ZodOptional<z$1.ZodString>;
        name: z$1.ZodOptional<z$1.ZodString>;
        path: z$1.ZodString;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        type: z$1.ZodLiteral<"localFile">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>], "type">>;
    createdAt: z$1.ZodNumber;
    editable: z$1.ZodBoolean;
    failureReason: z$1.ZodNullable<z$1.ZodString>;
    groupWithNext: z$1.ZodBoolean;
    id: z$1.ZodString;
    model: z$1.ZodString;
    payload: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"inline">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        attempt: z$1.ZodNumber;
        kind: z$1.ZodLiteral<"retry">;
        reason: z$1.ZodString;
        retryOfTurnRequestId: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
    permissionMode: z$1.ZodEnum<{
        "accept-edits": "accept-edits";
        auto: "auto";
        full: "full";
    }>;
    reasoningLevel: z$1.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        none: "none";
        ultra: "ultra";
        ultracode: "ultracode";
        xhigh: "xhigh";
    }>;
    sendAt: z$1.ZodNullable<z$1.ZodNumber>;
    serviceTier: z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>;
    threadId: z$1.ZodString;
    updatedAt: z$1.ZodNumber;
    waitingOn: z$1.ZodNullable<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"time">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread-busy">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"turn-starting">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"provisioning">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        hostName: z$1.ZodString;
        kind: z$1.ZodLiteral<"host-offline">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"interaction">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin">;
        pluginId: z$1.ZodString;
        reason: z$1.ZodString;
    }, z$1.core.$strip>], "kind">>;
}, z$1.core.$strip>;
type ThreadQueuedMessage = z$1.infer<typeof threadQueuedMessageSchema>;

declare const createThreadEnvironmentArgsSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    environmentId: z$1.ZodString;
    type: z$1.ZodLiteral<"reuse">;
}, z$1.core.$strip>, z$1.ZodObject<{
    hostId: z$1.ZodOptional<z$1.ZodString>;
    type: z$1.ZodLiteral<"host">;
    workspace: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        branch: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"existing">;
            name: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            baseBranch: z$1.ZodString;
            kind: z$1.ZodLiteral<"new">;
        }, z$1.core.$strict>], "kind">>;
        path: z$1.ZodNullable<z$1.ZodString>;
        type: z$1.ZodLiteral<"unmanaged">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        baseBranch: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"named">;
            name: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"default">;
        }, z$1.core.$strip>], "kind">;
        type: z$1.ZodLiteral<"managed-worktree">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"personal">;
    }, z$1.core.$strip>], "type">;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"project-default">;
}, z$1.core.$strip>], "type">;
type CreateThreadEnvironmentArgs = z$1.infer<typeof createThreadEnvironmentArgsSchema>;
declare const workspaceFileListResponseSchema: z$1.ZodObject<{
    files: z$1.ZodArray<z$1.ZodObject<{
        name: z$1.ZodString;
        path: z$1.ZodString;
    }, z$1.core.$strip>>;
    truncated: z$1.ZodBoolean;
}, z$1.core.$strip>;
type WorkspaceFileListResponse = z$1.infer<typeof workspaceFileListResponseSchema>;
declare const workspacePathListResponseSchema: z$1.ZodObject<{
    paths: z$1.ZodArray<z$1.ZodObject<{
        kind: z$1.ZodEnum<{
            directory: "directory";
            file: "file";
        }>;
        name: z$1.ZodString;
        path: z$1.ZodString;
        positions: z$1.ZodArray<z$1.ZodNumber>;
        score: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    truncated: z$1.ZodBoolean;
}, z$1.core.$strip>;
type WorkspacePathListResponse = z$1.infer<typeof workspacePathListResponseSchema>;

declare const browserTabsResponseSchema: z$1.ZodObject<{
    owners: z$1.ZodArray<z$1.ZodObject<{
        active: z$1.ZodBoolean;
        clientId: z$1.ZodString;
        ownerId: z$1.ZodString;
        projectId: z$1.ZodNullable<z$1.ZodString>;
        threadId: z$1.ZodNullable<z$1.ZodString>;
        windowId: z$1.ZodString;
    }, z$1.core.$strict>>;
    tabs: z$1.ZodArray<z$1.ZodObject<{
        active: z$1.ZodBoolean;
        clientId: z$1.ZodString;
        connected: z$1.ZodBoolean;
        navigationEpoch: z$1.ZodNumber;
        projectId: z$1.ZodNullable<z$1.ZodString>;
        tabId: z$1.ZodString;
        threadId: z$1.ZodNullable<z$1.ZodString>;
        title: z$1.ZodNullable<z$1.ZodString>;
        url: z$1.ZodString;
        windowId: z$1.ZodString;
    }, z$1.core.$strict>>;
}, z$1.core.$strict>;
type BrowserTabsResponse = z$1.infer<typeof browserTabsResponseSchema>;
declare const browserOpenRequestSchema: z$1.ZodObject<{
    clientId: z$1.ZodOptional<z$1.ZodString>;
    ownerId: z$1.ZodOptional<z$1.ZodString>;
    projectId: z$1.ZodOptional<z$1.ZodString>;
    threadId: z$1.ZodOptional<z$1.ZodString>;
    timeoutMs: z$1.ZodDefault<z$1.ZodNumber>;
    url: z$1.ZodString;
    windowId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strict>;
type BrowserOpenRequest = z$1.infer<typeof browserOpenRequestSchema>;
declare const browserOpenResponseSchema: z$1.ZodObject<{
    target: z$1.ZodObject<{
        clientId: z$1.ZodString;
        navigationEpoch: z$1.ZodNumber;
        tabId: z$1.ZodString;
        windowId: z$1.ZodString;
    }, z$1.core.$strict>;
}, z$1.core.$strict>;
type BrowserOpenResponse = z$1.infer<typeof browserOpenResponseSchema>;
declare const browserControlRequestSchema: z$1.ZodObject<{
    action: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"list-frames">;
        maxFrames: z$1.ZodOptional<z$1.ZodNumber>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        kind: z$1.ZodLiteral<"snapshot">;
        maxNodes: z$1.ZodOptional<z$1.ZodNumber>;
        mode: z$1.ZodEnum<{
            dom: "dom";
            interactive: "interactive";
        }>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"click">;
        target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                selectors: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                name: z$1.ZodOptional<z$1.ZodString>;
                role: z$1.ZodString;
            }, z$1.core.$strict>]>;
            target: z$1.ZodLiteral<"locator">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            target: z$1.ZodLiteral<"point">;
            x: z$1.ZodNumber;
            y: z$1.ZodNumber;
        }, z$1.core.$strict>], "target">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"hover">;
        target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                selectors: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                name: z$1.ZodOptional<z$1.ZodString>;
                role: z$1.ZodString;
            }, z$1.core.$strict>]>;
            target: z$1.ZodLiteral<"locator">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            target: z$1.ZodLiteral<"point">;
            x: z$1.ZodNumber;
            y: z$1.ZodNumber;
        }, z$1.core.$strict>], "target">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"double-click">;
        target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                selectors: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                name: z$1.ZodOptional<z$1.ZodString>;
                role: z$1.ZodString;
            }, z$1.core.$strict>]>;
            target: z$1.ZodLiteral<"locator">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            target: z$1.ZodLiteral<"point">;
            x: z$1.ZodNumber;
            y: z$1.ZodNumber;
        }, z$1.core.$strict>], "target">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"right-click">;
        target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                selectors: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                name: z$1.ZodOptional<z$1.ZodString>;
                role: z$1.ZodString;
            }, z$1.core.$strict>]>;
            target: z$1.ZodLiteral<"locator">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            target: z$1.ZodLiteral<"point">;
            x: z$1.ZodNumber;
            y: z$1.ZodNumber;
        }, z$1.core.$strict>], "target">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"middle-click">;
        target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                selectors: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                name: z$1.ZodOptional<z$1.ZodString>;
                role: z$1.ZodString;
            }, z$1.core.$strict>]>;
            target: z$1.ZodLiteral<"locator">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            target: z$1.ZodLiteral<"point">;
            x: z$1.ZodNumber;
            y: z$1.ZodNumber;
        }, z$1.core.$strict>], "target">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        from: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                selectors: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                name: z$1.ZodOptional<z$1.ZodString>;
                role: z$1.ZodString;
            }, z$1.core.$strict>]>;
            target: z$1.ZodLiteral<"locator">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            target: z$1.ZodLiteral<"point">;
            x: z$1.ZodNumber;
            y: z$1.ZodNumber;
        }, z$1.core.$strict>], "target">;
        kind: z$1.ZodLiteral<"drag">;
        to: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                selectors: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                name: z$1.ZodOptional<z$1.ZodString>;
                role: z$1.ZodString;
            }, z$1.core.$strict>]>;
            target: z$1.ZodLiteral<"locator">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            target: z$1.ZodLiteral<"point">;
            x: z$1.ZodNumber;
            y: z$1.ZodNumber;
        }, z$1.core.$strict>], "target">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        clear: z$1.ZodOptional<z$1.ZodBoolean>;
        kind: z$1.ZodLiteral<"type">;
        locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            selectors: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            name: z$1.ZodOptional<z$1.ZodString>;
            role: z$1.ZodString;
        }, z$1.core.$strict>]>;
        text: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"select">;
        locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            selectors: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            name: z$1.ZodOptional<z$1.ZodString>;
            role: z$1.ZodString;
        }, z$1.core.$strict>]>;
        value: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"select-multiple">;
        locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            selectors: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            name: z$1.ZodOptional<z$1.ZodString>;
            role: z$1.ZodString;
        }, z$1.core.$strict>]>;
        values: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        files: z$1.ZodArray<z$1.ZodObject<{
            base64: z$1.ZodString;
            mimeType: z$1.ZodString;
            name: z$1.ZodString;
        }, z$1.core.$strict>>;
        kind: z$1.ZodLiteral<"upload">;
        locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            selectors: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            name: z$1.ZodOptional<z$1.ZodString>;
            role: z$1.ZodString;
        }, z$1.core.$strict>]>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"check">;
        locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            selectors: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            name: z$1.ZodOptional<z$1.ZodString>;
            role: z$1.ZodString;
        }, z$1.core.$strict>]>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"uncheck">;
        locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            selectors: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            name: z$1.ZodOptional<z$1.ZodString>;
            role: z$1.ZodString;
        }, z$1.core.$strict>]>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"focus">;
        locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            selectors: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            name: z$1.ZodOptional<z$1.ZodString>;
            role: z$1.ZodString;
        }, z$1.core.$strict>]>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"scroll-into-view">;
        locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            selectors: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            name: z$1.ZodOptional<z$1.ZodString>;
            role: z$1.ZodString;
        }, z$1.core.$strict>]>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        element: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                selectors: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                name: z$1.ZodOptional<z$1.ZodString>;
                role: z$1.ZodString;
            }, z$1.core.$strict>]>;
            target: z$1.ZodLiteral<"locator">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            target: z$1.ZodLiteral<"point">;
            x: z$1.ZodNumber;
            y: z$1.ZodNumber;
        }, z$1.core.$strict>], "target">;
        feedback: z$1.ZodString;
        intent: z$1.ZodEnum<{
            approve: "approve";
            change: "change";
            fix: "fix";
            question: "question";
        }>;
        kind: z$1.ZodLiteral<"annotate">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        code: z$1.ZodOptional<z$1.ZodString>;
        key: z$1.ZodString;
        kind: z$1.ZodLiteral<"key">;
        modifiers: z$1.ZodOptional<z$1.ZodArray<z$1.ZodEnum<{
            Alt: "Alt";
            Control: "Control";
            Meta: "Meta";
            Shift: "Shift";
        }>>>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        behavior: z$1.ZodOptional<z$1.ZodEnum<{
            auto: "auto";
            smooth: "smooth";
        }>>;
        deltaX: z$1.ZodOptional<z$1.ZodNumber>;
        deltaY: z$1.ZodOptional<z$1.ZodNumber>;
        kind: z$1.ZodLiteral<"scroll">;
        x: z$1.ZodOptional<z$1.ZodNumber>;
        y: z$1.ZodOptional<z$1.ZodNumber>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"navigate">;
        url: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"open-tab">;
        url: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"activate-tab">;
        tabId: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"close-tab">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"back">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"forward">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"reload">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"set-viewport-profile">;
        profile: z$1.ZodEnum<{
            "desktop-1280x720": "desktop-1280x720";
            "phone-390x844": "phone-390x844";
            "tablet-768x1024": "tablet-768x1024";
        }>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        criteria: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"locator">;
            locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                selectors: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                name: z$1.ZodOptional<z$1.ZodString>;
                role: z$1.ZodString;
            }, z$1.core.$strict>]>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            kind: z$1.ZodLiteral<"text">;
            text: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"url">;
            match: z$1.ZodEnum<{
                exact: "exact";
                glob: "glob";
            }>;
            url: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"navigation">;
            phase: z$1.ZodEnum<{
                commit: "commit";
                start: "start";
            }>;
            sameDocument: z$1.ZodBoolean;
        }, z$1.core.$strict>, z$1.ZodObject<{
            document: z$1.ZodEnum<{
                current: "current";
                next: "next";
            }>;
            kind: z$1.ZodLiteral<"load-state">;
            state: z$1.ZodEnum<{
                domcontentloaded: "domcontentloaded";
                load: "load";
                networkidle: "networkidle";
            }>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"popup">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"request">;
            match: z$1.ZodEnum<{
                exact: "exact";
                glob: "glob";
            }>;
            method: z$1.ZodOptional<z$1.ZodString>;
            url: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"response">;
            match: z$1.ZodEnum<{
                exact: "exact";
                glob: "glob";
            }>;
            method: z$1.ZodOptional<z$1.ZodString>;
            status: z$1.ZodOptional<z$1.ZodNumber>;
            url: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"download-blocked">;
        }, z$1.core.$strict>], "kind">;
        kind: z$1.ZodLiteral<"wait">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"clear-viewport-profile">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        behavior: z$1.ZodEnum<{
            accept: "accept";
            dismiss: "dismiss";
        }>;
        kind: z$1.ZodLiteral<"set-dialog-handler">;
        promptText: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        decision: z$1.ZodEnum<{
            allow: "allow";
            deny: "deny";
        }>;
        kind: z$1.ZodLiteral<"set-permissions">;
        permissions: z$1.ZodArray<z$1.ZodEnum<{
            "clipboard-read": "clipboard-read";
            "clipboard-sanitized-write": "clipboard-sanitized-write";
            "display-capture": "display-capture";
            fullscreen: "fullscreen";
            geolocation: "geolocation";
            media: "media";
            notifications: "notifications";
        }>>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"diagnostics">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"get-storage">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        cookies: z$1.ZodArray<z$1.ZodString>;
        kind: z$1.ZodLiteral<"set-storage">;
        local: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
        session: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"clear-storage">;
        stores: z$1.ZodArray<z$1.ZodEnum<{
            cookies: "cookies";
            local: "local";
            session: "session";
        }>>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"list-cookie-import-sources">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        family: z$1.ZodString;
        kind: z$1.ZodLiteral<"import-cookies-from-browser">;
        profileId: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        confirm: z$1.ZodLiteral<true>;
        kind: z$1.ZodLiteral<"clear-imported-cookies">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        format: z$1.ZodOptional<z$1.ZodEnum<{
            jpeg: "jpeg";
            png: "png";
        }>>;
        kind: z$1.ZodLiteral<"screenshot">;
        quality: z$1.ZodOptional<z$1.ZodNumber>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"screenshot-full-page">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        format: z$1.ZodEnum<{
            jpeg: "jpeg";
            png: "png";
        }>;
        kind: z$1.ZodLiteral<"screenshot-element">;
        locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            selectors: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            name: z$1.ZodOptional<z$1.ZodString>;
            role: z$1.ZodString;
        }, z$1.core.$strict>]>;
        quality: z$1.ZodNumber;
    }, z$1.core.$strict>, z$1.ZodObject<{
        frame: z$1.ZodOptional<z$1.ZodObject<{
            documentEpoch: z$1.ZodNumber;
            frameId: z$1.ZodString;
        }, z$1.core.$strict>>;
        input: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
        kind: z$1.ZodLiteral<"script">;
        source: z$1.ZodString;
        timeoutMs: z$1.ZodNumber;
        world: z$1.ZodOptional<z$1.ZodEnum<{
            isolated: "isolated";
            main: "main";
        }>>;
    }, z$1.core.$strict>], "kind">;
    target: z$1.ZodObject<{
        clientId: z$1.ZodString;
        navigationEpoch: z$1.ZodNumber;
        tabId: z$1.ZodString;
        windowId: z$1.ZodString;
    }, z$1.core.$strict>;
    timeoutMs: z$1.ZodDefault<z$1.ZodNumber>;
}, z$1.core.$strict>;
type BrowserControlRequest = z$1.infer<typeof browserControlRequestSchema>;
declare const browserControlResponseSchema: z$1.ZodObject<{
    value: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
}, z$1.core.$strict>;
type BrowserControlResponse = z$1.infer<typeof browserControlResponseSchema>;
declare const browserBatchRequestSchema: z$1.ZodObject<{
    concurrency: z$1.ZodDefault<z$1.ZodNumber>;
    items: z$1.ZodArray<z$1.ZodObject<{
        action: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"list-frames">;
            maxFrames: z$1.ZodOptional<z$1.ZodNumber>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            kind: z$1.ZodLiteral<"snapshot">;
            maxNodes: z$1.ZodOptional<z$1.ZodNumber>;
            mode: z$1.ZodEnum<{
                dom: "dom";
                interactive: "interactive";
            }>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"click">;
            target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                    frame: z$1.ZodOptional<z$1.ZodObject<{
                        documentEpoch: z$1.ZodNumber;
                        frameId: z$1.ZodString;
                    }, z$1.core.$strict>>;
                    selectors: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strict>, z$1.ZodObject<{
                    frame: z$1.ZodOptional<z$1.ZodObject<{
                        documentEpoch: z$1.ZodNumber;
                        frameId: z$1.ZodString;
                    }, z$1.core.$strict>>;
                    name: z$1.ZodOptional<z$1.ZodString>;
                    role: z$1.ZodString;
                }, z$1.core.$strict>]>;
                target: z$1.ZodLiteral<"locator">;
            }, z$1.core.$strict>, z$1.ZodObject<{
                target: z$1.ZodLiteral<"point">;
                x: z$1.ZodNumber;
                y: z$1.ZodNumber;
            }, z$1.core.$strict>], "target">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"hover">;
            target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                    frame: z$1.ZodOptional<z$1.ZodObject<{
                        documentEpoch: z$1.ZodNumber;
                        frameId: z$1.ZodString;
                    }, z$1.core.$strict>>;
                    selectors: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strict>, z$1.ZodObject<{
                    frame: z$1.ZodOptional<z$1.ZodObject<{
                        documentEpoch: z$1.ZodNumber;
                        frameId: z$1.ZodString;
                    }, z$1.core.$strict>>;
                    name: z$1.ZodOptional<z$1.ZodString>;
                    role: z$1.ZodString;
                }, z$1.core.$strict>]>;
                target: z$1.ZodLiteral<"locator">;
            }, z$1.core.$strict>, z$1.ZodObject<{
                target: z$1.ZodLiteral<"point">;
                x: z$1.ZodNumber;
                y: z$1.ZodNumber;
            }, z$1.core.$strict>], "target">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"double-click">;
            target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                    frame: z$1.ZodOptional<z$1.ZodObject<{
                        documentEpoch: z$1.ZodNumber;
                        frameId: z$1.ZodString;
                    }, z$1.core.$strict>>;
                    selectors: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strict>, z$1.ZodObject<{
                    frame: z$1.ZodOptional<z$1.ZodObject<{
                        documentEpoch: z$1.ZodNumber;
                        frameId: z$1.ZodString;
                    }, z$1.core.$strict>>;
                    name: z$1.ZodOptional<z$1.ZodString>;
                    role: z$1.ZodString;
                }, z$1.core.$strict>]>;
                target: z$1.ZodLiteral<"locator">;
            }, z$1.core.$strict>, z$1.ZodObject<{
                target: z$1.ZodLiteral<"point">;
                x: z$1.ZodNumber;
                y: z$1.ZodNumber;
            }, z$1.core.$strict>], "target">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"right-click">;
            target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                    frame: z$1.ZodOptional<z$1.ZodObject<{
                        documentEpoch: z$1.ZodNumber;
                        frameId: z$1.ZodString;
                    }, z$1.core.$strict>>;
                    selectors: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strict>, z$1.ZodObject<{
                    frame: z$1.ZodOptional<z$1.ZodObject<{
                        documentEpoch: z$1.ZodNumber;
                        frameId: z$1.ZodString;
                    }, z$1.core.$strict>>;
                    name: z$1.ZodOptional<z$1.ZodString>;
                    role: z$1.ZodString;
                }, z$1.core.$strict>]>;
                target: z$1.ZodLiteral<"locator">;
            }, z$1.core.$strict>, z$1.ZodObject<{
                target: z$1.ZodLiteral<"point">;
                x: z$1.ZodNumber;
                y: z$1.ZodNumber;
            }, z$1.core.$strict>], "target">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"middle-click">;
            target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                    frame: z$1.ZodOptional<z$1.ZodObject<{
                        documentEpoch: z$1.ZodNumber;
                        frameId: z$1.ZodString;
                    }, z$1.core.$strict>>;
                    selectors: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strict>, z$1.ZodObject<{
                    frame: z$1.ZodOptional<z$1.ZodObject<{
                        documentEpoch: z$1.ZodNumber;
                        frameId: z$1.ZodString;
                    }, z$1.core.$strict>>;
                    name: z$1.ZodOptional<z$1.ZodString>;
                    role: z$1.ZodString;
                }, z$1.core.$strict>]>;
                target: z$1.ZodLiteral<"locator">;
            }, z$1.core.$strict>, z$1.ZodObject<{
                target: z$1.ZodLiteral<"point">;
                x: z$1.ZodNumber;
                y: z$1.ZodNumber;
            }, z$1.core.$strict>], "target">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            from: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                    frame: z$1.ZodOptional<z$1.ZodObject<{
                        documentEpoch: z$1.ZodNumber;
                        frameId: z$1.ZodString;
                    }, z$1.core.$strict>>;
                    selectors: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strict>, z$1.ZodObject<{
                    frame: z$1.ZodOptional<z$1.ZodObject<{
                        documentEpoch: z$1.ZodNumber;
                        frameId: z$1.ZodString;
                    }, z$1.core.$strict>>;
                    name: z$1.ZodOptional<z$1.ZodString>;
                    role: z$1.ZodString;
                }, z$1.core.$strict>]>;
                target: z$1.ZodLiteral<"locator">;
            }, z$1.core.$strict>, z$1.ZodObject<{
                target: z$1.ZodLiteral<"point">;
                x: z$1.ZodNumber;
                y: z$1.ZodNumber;
            }, z$1.core.$strict>], "target">;
            kind: z$1.ZodLiteral<"drag">;
            to: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                    frame: z$1.ZodOptional<z$1.ZodObject<{
                        documentEpoch: z$1.ZodNumber;
                        frameId: z$1.ZodString;
                    }, z$1.core.$strict>>;
                    selectors: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strict>, z$1.ZodObject<{
                    frame: z$1.ZodOptional<z$1.ZodObject<{
                        documentEpoch: z$1.ZodNumber;
                        frameId: z$1.ZodString;
                    }, z$1.core.$strict>>;
                    name: z$1.ZodOptional<z$1.ZodString>;
                    role: z$1.ZodString;
                }, z$1.core.$strict>]>;
                target: z$1.ZodLiteral<"locator">;
            }, z$1.core.$strict>, z$1.ZodObject<{
                target: z$1.ZodLiteral<"point">;
                x: z$1.ZodNumber;
                y: z$1.ZodNumber;
            }, z$1.core.$strict>], "target">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            clear: z$1.ZodOptional<z$1.ZodBoolean>;
            kind: z$1.ZodLiteral<"type">;
            locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                selectors: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                name: z$1.ZodOptional<z$1.ZodString>;
                role: z$1.ZodString;
            }, z$1.core.$strict>]>;
            text: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"select">;
            locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                selectors: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                name: z$1.ZodOptional<z$1.ZodString>;
                role: z$1.ZodString;
            }, z$1.core.$strict>]>;
            value: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"select-multiple">;
            locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                selectors: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                name: z$1.ZodOptional<z$1.ZodString>;
                role: z$1.ZodString;
            }, z$1.core.$strict>]>;
            values: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            files: z$1.ZodArray<z$1.ZodObject<{
                base64: z$1.ZodString;
                mimeType: z$1.ZodString;
                name: z$1.ZodString;
            }, z$1.core.$strict>>;
            kind: z$1.ZodLiteral<"upload">;
            locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                selectors: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                name: z$1.ZodOptional<z$1.ZodString>;
                role: z$1.ZodString;
            }, z$1.core.$strict>]>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"check">;
            locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                selectors: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                name: z$1.ZodOptional<z$1.ZodString>;
                role: z$1.ZodString;
            }, z$1.core.$strict>]>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"uncheck">;
            locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                selectors: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                name: z$1.ZodOptional<z$1.ZodString>;
                role: z$1.ZodString;
            }, z$1.core.$strict>]>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"focus">;
            locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                selectors: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                name: z$1.ZodOptional<z$1.ZodString>;
                role: z$1.ZodString;
            }, z$1.core.$strict>]>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"scroll-into-view">;
            locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                selectors: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                name: z$1.ZodOptional<z$1.ZodString>;
                role: z$1.ZodString;
            }, z$1.core.$strict>]>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            element: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                    frame: z$1.ZodOptional<z$1.ZodObject<{
                        documentEpoch: z$1.ZodNumber;
                        frameId: z$1.ZodString;
                    }, z$1.core.$strict>>;
                    selectors: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strict>, z$1.ZodObject<{
                    frame: z$1.ZodOptional<z$1.ZodObject<{
                        documentEpoch: z$1.ZodNumber;
                        frameId: z$1.ZodString;
                    }, z$1.core.$strict>>;
                    name: z$1.ZodOptional<z$1.ZodString>;
                    role: z$1.ZodString;
                }, z$1.core.$strict>]>;
                target: z$1.ZodLiteral<"locator">;
            }, z$1.core.$strict>, z$1.ZodObject<{
                target: z$1.ZodLiteral<"point">;
                x: z$1.ZodNumber;
                y: z$1.ZodNumber;
            }, z$1.core.$strict>], "target">;
            feedback: z$1.ZodString;
            intent: z$1.ZodEnum<{
                approve: "approve";
                change: "change";
                fix: "fix";
                question: "question";
            }>;
            kind: z$1.ZodLiteral<"annotate">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            code: z$1.ZodOptional<z$1.ZodString>;
            key: z$1.ZodString;
            kind: z$1.ZodLiteral<"key">;
            modifiers: z$1.ZodOptional<z$1.ZodArray<z$1.ZodEnum<{
                Alt: "Alt";
                Control: "Control";
                Meta: "Meta";
                Shift: "Shift";
            }>>>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            behavior: z$1.ZodOptional<z$1.ZodEnum<{
                auto: "auto";
                smooth: "smooth";
            }>>;
            deltaX: z$1.ZodOptional<z$1.ZodNumber>;
            deltaY: z$1.ZodOptional<z$1.ZodNumber>;
            kind: z$1.ZodLiteral<"scroll">;
            x: z$1.ZodOptional<z$1.ZodNumber>;
            y: z$1.ZodOptional<z$1.ZodNumber>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"navigate">;
            url: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"open-tab">;
            url: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"activate-tab">;
            tabId: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"close-tab">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"back">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"forward">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"reload">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"set-viewport-profile">;
            profile: z$1.ZodEnum<{
                "desktop-1280x720": "desktop-1280x720";
                "phone-390x844": "phone-390x844";
                "tablet-768x1024": "tablet-768x1024";
            }>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            criteria: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"locator">;
                locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                    frame: z$1.ZodOptional<z$1.ZodObject<{
                        documentEpoch: z$1.ZodNumber;
                        frameId: z$1.ZodString;
                    }, z$1.core.$strict>>;
                    selectors: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strict>, z$1.ZodObject<{
                    frame: z$1.ZodOptional<z$1.ZodObject<{
                        documentEpoch: z$1.ZodNumber;
                        frameId: z$1.ZodString;
                    }, z$1.core.$strict>>;
                    name: z$1.ZodOptional<z$1.ZodString>;
                    role: z$1.ZodString;
                }, z$1.core.$strict>]>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                kind: z$1.ZodLiteral<"text">;
                text: z$1.ZodString;
            }, z$1.core.$strict>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"url">;
                match: z$1.ZodEnum<{
                    exact: "exact";
                    glob: "glob";
                }>;
                url: z$1.ZodString;
            }, z$1.core.$strict>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"navigation">;
                phase: z$1.ZodEnum<{
                    commit: "commit";
                    start: "start";
                }>;
                sameDocument: z$1.ZodBoolean;
            }, z$1.core.$strict>, z$1.ZodObject<{
                document: z$1.ZodEnum<{
                    current: "current";
                    next: "next";
                }>;
                kind: z$1.ZodLiteral<"load-state">;
                state: z$1.ZodEnum<{
                    domcontentloaded: "domcontentloaded";
                    load: "load";
                    networkidle: "networkidle";
                }>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"popup">;
            }, z$1.core.$strict>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"request">;
                match: z$1.ZodEnum<{
                    exact: "exact";
                    glob: "glob";
                }>;
                method: z$1.ZodOptional<z$1.ZodString>;
                url: z$1.ZodString;
            }, z$1.core.$strict>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"response">;
                match: z$1.ZodEnum<{
                    exact: "exact";
                    glob: "glob";
                }>;
                method: z$1.ZodOptional<z$1.ZodString>;
                status: z$1.ZodOptional<z$1.ZodNumber>;
                url: z$1.ZodString;
            }, z$1.core.$strict>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"download-blocked">;
            }, z$1.core.$strict>], "kind">;
            kind: z$1.ZodLiteral<"wait">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"clear-viewport-profile">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            behavior: z$1.ZodEnum<{
                accept: "accept";
                dismiss: "dismiss";
            }>;
            kind: z$1.ZodLiteral<"set-dialog-handler">;
            promptText: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            decision: z$1.ZodEnum<{
                allow: "allow";
                deny: "deny";
            }>;
            kind: z$1.ZodLiteral<"set-permissions">;
            permissions: z$1.ZodArray<z$1.ZodEnum<{
                "clipboard-read": "clipboard-read";
                "clipboard-sanitized-write": "clipboard-sanitized-write";
                "display-capture": "display-capture";
                fullscreen: "fullscreen";
                geolocation: "geolocation";
                media: "media";
                notifications: "notifications";
            }>>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"diagnostics">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"get-storage">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            cookies: z$1.ZodArray<z$1.ZodString>;
            kind: z$1.ZodLiteral<"set-storage">;
            local: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
            session: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"clear-storage">;
            stores: z$1.ZodArray<z$1.ZodEnum<{
                cookies: "cookies";
                local: "local";
                session: "session";
            }>>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"list-cookie-import-sources">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            family: z$1.ZodString;
            kind: z$1.ZodLiteral<"import-cookies-from-browser">;
            profileId: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            confirm: z$1.ZodLiteral<true>;
            kind: z$1.ZodLiteral<"clear-imported-cookies">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            format: z$1.ZodOptional<z$1.ZodEnum<{
                jpeg: "jpeg";
                png: "png";
            }>>;
            kind: z$1.ZodLiteral<"screenshot">;
            quality: z$1.ZodOptional<z$1.ZodNumber>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"screenshot-full-page">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            format: z$1.ZodEnum<{
                jpeg: "jpeg";
                png: "png";
            }>;
            kind: z$1.ZodLiteral<"screenshot-element">;
            locator: z$1.ZodUnion<readonly [z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                selectors: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                frame: z$1.ZodOptional<z$1.ZodObject<{
                    documentEpoch: z$1.ZodNumber;
                    frameId: z$1.ZodString;
                }, z$1.core.$strict>>;
                name: z$1.ZodOptional<z$1.ZodString>;
                role: z$1.ZodString;
            }, z$1.core.$strict>]>;
            quality: z$1.ZodNumber;
        }, z$1.core.$strict>, z$1.ZodObject<{
            frame: z$1.ZodOptional<z$1.ZodObject<{
                documentEpoch: z$1.ZodNumber;
                frameId: z$1.ZodString;
            }, z$1.core.$strict>>;
            input: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
            kind: z$1.ZodLiteral<"script">;
            source: z$1.ZodString;
            timeoutMs: z$1.ZodNumber;
            world: z$1.ZodOptional<z$1.ZodEnum<{
                isolated: "isolated";
                main: "main";
            }>>;
        }, z$1.core.$strict>], "kind">;
        id: z$1.ZodString;
        target: z$1.ZodObject<{
            clientId: z$1.ZodString;
            navigationEpoch: z$1.ZodNumber;
            tabId: z$1.ZodString;
            windowId: z$1.ZodString;
        }, z$1.core.$strict>;
    }, z$1.core.$strict>>;
    timeoutMs: z$1.ZodDefault<z$1.ZodNumber>;
}, z$1.core.$strict>;
type BrowserBatchRequest = z$1.infer<typeof browserBatchRequestSchema>;
declare const browserBatchResponseSchema: z$1.ZodObject<{
    results: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        id: z$1.ZodString;
        ok: z$1.ZodLiteral<true>;
        value: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        error: z$1.ZodObject<{
            code: z$1.ZodString;
            details: z$1.ZodOptional<z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>>;
            message: z$1.ZodString;
        }, z$1.core.$strict>;
        id: z$1.ZodString;
        ok: z$1.ZodLiteral<false>;
    }, z$1.core.$strict>], "ok">>;
}, z$1.core.$strict>;
type BrowserBatchResponse = z$1.infer<typeof browserBatchResponseSchema>;

declare const createProjectSourceRequestSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    hostId: z$1.ZodString;
    path: z$1.ZodPipe<z$1.ZodString, z$1.ZodTransform<string, string>>;
    type: z$1.ZodLiteral<"local_path">;
}, z$1.core.$strict>, z$1.ZodObject<{
    hostId: z$1.ZodString;
    remoteUrl: z$1.ZodOptional<z$1.ZodString>;
    targetPath: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodString, z$1.ZodTransform<string, string>>>;
    type: z$1.ZodLiteral<"clone">;
}, z$1.core.$strict>], "type">;
type CreateProjectSourceRequest = z$1.infer<typeof createProjectSourceRequestSchema>;
declare const createProjectRequestSchema: z$1.ZodObject<{
    name: z$1.ZodString;
    source: z$1.ZodObject<{
        hostId: z$1.ZodString;
        path: z$1.ZodPipe<z$1.ZodString, z$1.ZodTransform<string, string>>;
        type: z$1.ZodLiteral<"local_path">;
    }, z$1.core.$strict>;
}, z$1.core.$strip>;
type CreateProjectRequest = z$1.infer<typeof createProjectRequestSchema>;
declare const threadSectionSchema: z$1.ZodObject<{
    createdAt: z$1.ZodNumber;
    id: z$1.ZodString;
    name: z$1.ZodString;
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
    nextProjectId: z$1.ZodNullable<z$1.ZodString>;
    previousProjectId: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type ReorderProjectRequest = z$1.infer<typeof reorderProjectRequestSchema>;
declare const projectListQuerySchema: z$1.ZodObject<{
    include: z$1.ZodOptional<z$1.ZodString>;
    includePersonal: z$1.ZodOptional<z$1.ZodEnum<{
        false: "false";
        true: "true";
    }>>;
}, z$1.core.$strip>;
type ProjectListQuery = z$1.infer<typeof projectListQuerySchema>;
declare const projectFilesQuerySchema: z$1.ZodObject<{
    environmentId: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodOptional<z$1.ZodString>>>;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    limit: z$1.ZodOptional<z$1.ZodOptional<z$1.ZodString>>;
    query: z$1.ZodOptional<z$1.ZodOptional<z$1.ZodString>>;
}, z$1.core.$strip>;
type ProjectFilesQuery = z$1.infer<typeof projectFilesQuerySchema>;
declare const projectPathsQuerySchema: z$1.ZodObject<{
    environmentId: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodOptional<z$1.ZodString>>>;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    includeDirectories: z$1.ZodEnum<{
        false: "false";
        true: "true";
    }>;
    includeFiles: z$1.ZodEnum<{
        false: "false";
        true: "true";
    }>;
    limit: z$1.ZodOptional<z$1.ZodOptional<z$1.ZodString>>;
    query: z$1.ZodOptional<z$1.ZodOptional<z$1.ZodString>>;
}, z$1.core.$strip>;
type ProjectPathsQuery = z$1.infer<typeof projectPathsQuerySchema>;
declare const projectFileContentQuerySchema: z$1.ZodObject<{
    environmentId: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodOptional<z$1.ZodString>>>;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    path: z$1.ZodString;
}, z$1.core.$strip>;
type ProjectFileContentQuery = z$1.infer<typeof projectFileContentQuerySchema>;
declare const projectBranchesQuerySchema: z$1.ZodObject<{
    hostId: z$1.ZodString;
    limit: z$1.ZodOptional<z$1.ZodString>;
    query: z$1.ZodOptional<z$1.ZodString>;
    selectedBranch: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strict>;
type ProjectBranchesQuery = z$1.infer<typeof projectBranchesQuerySchema>;
declare const projectBranchesResponseSchema: z$1.ZodObject<{
    branches: z$1.ZodArray<z$1.ZodString>;
    branchesTruncated: z$1.ZodBoolean;
    checkout: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        branchName: z$1.ZodString;
        headSha: z$1.ZodNullable<z$1.ZodString>;
        kind: z$1.ZodLiteral<"branch">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        headSha: z$1.ZodNullable<z$1.ZodString>;
        kind: z$1.ZodLiteral<"detached">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        branchName: z$1.ZodNullable<z$1.ZodString>;
        kind: z$1.ZodLiteral<"unborn">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"unknown">;
        reason: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
    defaultBranch: z$1.ZodNullable<z$1.ZodString>;
    defaultBranchRelation: z$1.ZodNullable<z$1.ZodEnum<{
        "local-ahead": "local-ahead";
        "local-behind": "local-behind";
        diverged: "diverged";
        equal: "equal";
        unknown: "unknown";
    }>>;
    defaultWorktreeBaseBranch: z$1.ZodNullable<z$1.ZodString>;
    hasUncommittedChanges: z$1.ZodBoolean;
    operation: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"none">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        hasConflicts: z$1.ZodBoolean;
        kind: z$1.ZodLiteral<"merge">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        hasConflicts: z$1.ZodBoolean;
        kind: z$1.ZodLiteral<"rebase">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        hasConflicts: z$1.ZodBoolean;
        kind: z$1.ZodLiteral<"cherry-pick">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        hasConflicts: z$1.ZodBoolean;
        kind: z$1.ZodLiteral<"revert">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        hasConflicts: z$1.ZodBoolean;
        kind: z$1.ZodLiteral<"unknown">;
        reason: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
    originDefaultBranch: z$1.ZodNullable<z$1.ZodString>;
    remoteBranches: z$1.ZodArray<z$1.ZodString>;
    remoteBranchesTruncated: z$1.ZodBoolean;
    selectedBranch: z$1.ZodNullable<z$1.ZodObject<{
        kind: z$1.ZodEnum<{
            local: "local";
            missing: "missing";
            remote: "remote";
        }>;
        name: z$1.ZodString;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type ProjectBranchesResponse = z$1.infer<typeof projectBranchesResponseSchema>;
declare const promptHistoryQuerySchema: z$1.ZodObject<{
    limit: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type PromptHistoryQuery = z$1.infer<typeof promptHistoryQuerySchema>;
declare const promptHistoryResponseSchema: z$1.ZodArray<z$1.ZodObject<{
    createdAt: z$1.ZodNumber;
    id: z$1.ZodString;
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                label: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                threadId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                label: z$1.ZodString;
                projectId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                label: z$1.ZodString;
                sectionId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                entryKind: z$1.ZodEnum<{
                    directory: "directory";
                    file: "file";
                }>;
                kind: z$1.ZodLiteral<"path">;
                label: z$1.ZodString;
                path: z$1.ZodString;
                source: z$1.ZodEnum<{
                    "thread-storage": "thread-storage";
                    workspace: "workspace";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
                kind: z$1.ZodLiteral<"command">;
                label: z$1.ZodString;
                name: z$1.ZodString;
                origin: z$1.ZodEnum<{
                    builtin: "builtin";
                    project: "project";
                    user: "user";
                }>;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                kind: z$1.ZodLiteral<"plugin">;
                label: z$1.ZodString;
                pluginId: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
            start: z$1.ZodNumber;
        }, z$1.core.$strip>>>;
        text: z$1.ZodString;
        type: z$1.ZodLiteral<"text">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        path: z$1.ZodString;
        type: z$1.ZodLiteral<"localImage">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        mimeType: z$1.ZodOptional<z$1.ZodString>;
        name: z$1.ZodOptional<z$1.ZodString>;
        path: z$1.ZodString;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        type: z$1.ZodLiteral<"localFile">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>], "type">>;
}, z$1.core.$strip>>;
type PromptHistoryResponse = z$1.infer<typeof promptHistoryResponseSchema>;
declare const updateProjectRequestSchema: z$1.ZodObject<{
    name: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type UpdateProjectRequest = z$1.infer<typeof updateProjectRequestSchema>;
declare const updateProjectSourceRequestSchema: z$1.ZodObject<{
    isDefault: z$1.ZodOptional<z$1.ZodLiteral<true>>;
    path: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodString, z$1.ZodTransform<string, string>>>;
    type: z$1.ZodLiteral<"local_path">;
}, z$1.core.$strict>;
type UpdateProjectSourceRequest = z$1.infer<typeof updateProjectSourceRequestSchema>;
declare const commandListResponseSchema: z$1.ZodObject<{
    commands: z$1.ZodArray<z$1.ZodObject<{
        argumentHint: z$1.ZodNullable<z$1.ZodString>;
        description: z$1.ZodNullable<z$1.ZodString>;
        name: z$1.ZodString;
        origin: z$1.ZodEnum<{
            builtin: "builtin";
            project: "project";
            user: "user";
        }>;
        pluginId: z$1.ZodOptional<z$1.ZodString>;
        source: z$1.ZodEnum<{
            command: "command";
            skill: "skill";
        }>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type CommandListResponse = z$1.infer<typeof commandListResponseSchema>;
declare const projectCommandsQuerySchema: z$1.ZodObject<{
    environmentId: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodOptional<z$1.ZodString>>>;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    provider: z$1.ZodString;
}, z$1.core.$strict>;
type ProjectCommandsQuery = z$1.infer<typeof projectCommandsQuerySchema>;
declare const skillListResponseSchema: z$1.ZodObject<{
    skills: z$1.ZodArray<z$1.ZodObject<{
        description: z$1.ZodNullable<z$1.ZodString>;
        filePath: z$1.ZodString;
        id: z$1.ZodString;
        manageable: z$1.ZodBoolean;
        name: z$1.ZodString;
        pluginId: z$1.ZodNullable<z$1.ZodString>;
        provider: z$1.ZodNullable<z$1.ZodString>;
        registrySkillId: z$1.ZodNullable<z$1.ZodString>;
        scope: z$1.ZodEnum<{
            "bb-builtin": "bb-builtin";
            "bb-project": "bb-project";
            "bb-user": "bb-user";
            "provider-project": "provider-project";
            "provider-user": "provider-user";
            "shared-project": "shared-project";
            "shared-user": "shared-user";
            plugin: "plugin";
        }>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type SkillListResponse = z$1.infer<typeof skillListResponseSchema>;
declare const skillContentResponseSchema: z$1.ZodObject<{
    content: z$1.ZodString;
    revision: z$1.ZodString;
}, z$1.core.$strip>;
type SkillContentResponse = z$1.infer<typeof skillContentResponseSchema>;
declare const skillFilesResponseSchema: z$1.ZodObject<{
    files: z$1.ZodArray<z$1.ZodString>;
    truncated: z$1.ZodBoolean;
}, z$1.core.$strip>;
type SkillFilesResponse = z$1.infer<typeof skillFilesResponseSchema>;
declare const projectResponseSchema: z$1.ZodObject<{
    createdAt: z$1.ZodNumber;
    gitRemoteUrl: z$1.ZodNullable<z$1.ZodString>;
    id: z$1.ZodString;
    kind: z$1.ZodEnum<{
        personal: "personal";
        standard: "standard";
    }>;
    name: z$1.ZodString;
    sources: z$1.ZodArray<z$1.ZodObject<{
        createdAt: z$1.ZodNumber;
        hostId: z$1.ZodString;
        id: z$1.ZodString;
        isDefault: z$1.ZodBoolean;
        path: z$1.ZodString;
        projectId: z$1.ZodString;
        type: z$1.ZodLiteral<"local_path">;
        updatedAt: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type ProjectResponse = z$1.infer<typeof projectResponseSchema>;
declare const projectWithThreadsResponseSchema: z$1.ZodObject<{
    createdAt: z$1.ZodNumber;
    defaultExecutionOptions: z$1.ZodNullable<z$1.ZodObject<{
        model: z$1.ZodString;
        permissionMode: z$1.ZodEnum<{
            "accept-edits": "accept-edits";
            auto: "auto";
            full: "full";
        }>;
        providerId: z$1.ZodString;
        reasoningLevel: z$1.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            none: "none";
            ultra: "ultra";
            ultracode: "ultracode";
            xhigh: "xhigh";
        }>;
        serviceTier: z$1.ZodEnum<{
            default: "default";
            fast: "fast";
        }>;
    }, z$1.core.$strip>>;
    gitRemoteUrl: z$1.ZodNullable<z$1.ZodString>;
    id: z$1.ZodString;
    kind: z$1.ZodEnum<{
        personal: "personal";
        standard: "standard";
    }>;
    name: z$1.ZodString;
    sources: z$1.ZodArray<z$1.ZodObject<{
        createdAt: z$1.ZodNumber;
        hostId: z$1.ZodString;
        id: z$1.ZodString;
        isDefault: z$1.ZodBoolean;
        path: z$1.ZodString;
        projectId: z$1.ZodString;
        type: z$1.ZodLiteral<"local_path">;
        updatedAt: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    threads: z$1.ZodArray<z$1.ZodObject<{
        activity: z$1.ZodObject<{
            activeBackgroundAgentCount: z$1.ZodNumber;
            activeBackgroundCommandCount: z$1.ZodNumber;
            activeGoalCount: z$1.ZodNumber;
            activePlanModeCount: z$1.ZodNumber;
            activeWorkflowCount: z$1.ZodNumber;
        }, z$1.core.$strip>;
        archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
        createdAt: z$1.ZodNumber;
        deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
        environmentBranchName: z$1.ZodNullable<z$1.ZodString>;
        environmentHostId: z$1.ZodNullable<z$1.ZodString>;
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        environmentName: z$1.ZodNullable<z$1.ZodString>;
        environmentWorkspaceDisplayKind: z$1.ZodEnum<{
            "managed-worktree": "managed-worktree";
            "unmanaged-worktree": "unmanaged-worktree";
            other: "other";
        }>;
        hasPendingInteraction: z$1.ZodBoolean;
        id: z$1.ZodString;
        lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
        latestAttentionAt: z$1.ZodNumber;
        originKind: z$1.ZodNullable<z$1.ZodEnum<{
            fork: "fork";
        }>>;
        originPluginId: z$1.ZodNullable<z$1.ZodString>;
        parentThreadId: z$1.ZodNullable<z$1.ZodString>;
        pinSortKey: z$1.ZodNullable<z$1.ZodString>;
        pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
        projectId: z$1.ZodString;
        providerId: z$1.ZodString;
        queuedWork: z$1.ZodEnum<{
            failed: "failed";
            none: "none";
            waiting: "waiting";
        }>;
        runtime: z$1.ZodObject<{
            displayStatus: z$1.ZodEnum<{
                "host-reconnecting": "host-reconnecting";
                "waiting-for-host": "waiting-for-host";
                active: "active";
                error: "error";
                idle: "idle";
                pending: "pending";
                provisioning: "provisioning";
                starting: "starting";
                stopping: "stopping";
            }>;
            hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
        }, z$1.core.$strip>;
        sectionId: z$1.ZodNullable<z$1.ZodString>;
        sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
        status: z$1.ZodEnum<{
            active: "active";
            error: "error";
            idle: "idle";
            pending: "pending";
            starting: "starting";
            stopping: "stopping";
        }>;
        title: z$1.ZodNullable<z$1.ZodString>;
        titleFallback: z$1.ZodNullable<z$1.ZodString>;
        updatedAt: z$1.ZodNumber;
        visibility: z$1.ZodEnum<{
            hidden: "hidden";
            visible: "visible";
        }>;
    }, z$1.core.$strip>>;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type ProjectWithThreadsResponse = z$1.infer<typeof projectWithThreadsResponseSchema>;
declare const sidebarBootstrapResponseSchema: z$1.ZodObject<{
    personalProject: z$1.ZodObject<{
        createdAt: z$1.ZodNumber;
        defaultExecutionOptions: z$1.ZodNullable<z$1.ZodObject<{
            model: z$1.ZodString;
            permissionMode: z$1.ZodEnum<{
                "accept-edits": "accept-edits";
                auto: "auto";
                full: "full";
            }>;
            providerId: z$1.ZodString;
            reasoningLevel: z$1.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                none: "none";
                ultra: "ultra";
                ultracode: "ultracode";
                xhigh: "xhigh";
            }>;
            serviceTier: z$1.ZodEnum<{
                default: "default";
                fast: "fast";
            }>;
        }, z$1.core.$strip>>;
        gitRemoteUrl: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        kind: z$1.ZodEnum<{
            personal: "personal";
            standard: "standard";
        }>;
        name: z$1.ZodString;
        sources: z$1.ZodArray<z$1.ZodObject<{
            createdAt: z$1.ZodNumber;
            hostId: z$1.ZodString;
            id: z$1.ZodString;
            isDefault: z$1.ZodBoolean;
            path: z$1.ZodString;
            projectId: z$1.ZodString;
            type: z$1.ZodLiteral<"local_path">;
            updatedAt: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        threads: z$1.ZodArray<z$1.ZodObject<{
            activity: z$1.ZodObject<{
                activeBackgroundAgentCount: z$1.ZodNumber;
                activeBackgroundCommandCount: z$1.ZodNumber;
                activeGoalCount: z$1.ZodNumber;
                activePlanModeCount: z$1.ZodNumber;
                activeWorkflowCount: z$1.ZodNumber;
            }, z$1.core.$strip>;
            archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
            createdAt: z$1.ZodNumber;
            deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
            environmentBranchName: z$1.ZodNullable<z$1.ZodString>;
            environmentHostId: z$1.ZodNullable<z$1.ZodString>;
            environmentId: z$1.ZodNullable<z$1.ZodString>;
            environmentName: z$1.ZodNullable<z$1.ZodString>;
            environmentWorkspaceDisplayKind: z$1.ZodEnum<{
                "managed-worktree": "managed-worktree";
                "unmanaged-worktree": "unmanaged-worktree";
                other: "other";
            }>;
            hasPendingInteraction: z$1.ZodBoolean;
            id: z$1.ZodString;
            lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
            latestAttentionAt: z$1.ZodNumber;
            originKind: z$1.ZodNullable<z$1.ZodEnum<{
                fork: "fork";
            }>>;
            originPluginId: z$1.ZodNullable<z$1.ZodString>;
            parentThreadId: z$1.ZodNullable<z$1.ZodString>;
            pinSortKey: z$1.ZodNullable<z$1.ZodString>;
            pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
            projectId: z$1.ZodString;
            providerId: z$1.ZodString;
            queuedWork: z$1.ZodEnum<{
                failed: "failed";
                none: "none";
                waiting: "waiting";
            }>;
            runtime: z$1.ZodObject<{
                displayStatus: z$1.ZodEnum<{
                    "host-reconnecting": "host-reconnecting";
                    "waiting-for-host": "waiting-for-host";
                    active: "active";
                    error: "error";
                    idle: "idle";
                    pending: "pending";
                    provisioning: "provisioning";
                    starting: "starting";
                    stopping: "stopping";
                }>;
                hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
            }, z$1.core.$strip>;
            sectionId: z$1.ZodNullable<z$1.ZodString>;
            sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
            status: z$1.ZodEnum<{
                active: "active";
                error: "error";
                idle: "idle";
                pending: "pending";
                starting: "starting";
                stopping: "stopping";
            }>;
            title: z$1.ZodNullable<z$1.ZodString>;
            titleFallback: z$1.ZodNullable<z$1.ZodString>;
            updatedAt: z$1.ZodNumber;
            visibility: z$1.ZodEnum<{
                hidden: "hidden";
                visible: "visible";
            }>;
        }, z$1.core.$strip>>;
        updatedAt: z$1.ZodNumber;
    }, z$1.core.$strip>;
    projects: z$1.ZodArray<z$1.ZodObject<{
        createdAt: z$1.ZodNumber;
        defaultExecutionOptions: z$1.ZodNullable<z$1.ZodObject<{
            model: z$1.ZodString;
            permissionMode: z$1.ZodEnum<{
                "accept-edits": "accept-edits";
                auto: "auto";
                full: "full";
            }>;
            providerId: z$1.ZodString;
            reasoningLevel: z$1.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                none: "none";
                ultra: "ultra";
                ultracode: "ultracode";
                xhigh: "xhigh";
            }>;
            serviceTier: z$1.ZodEnum<{
                default: "default";
                fast: "fast";
            }>;
        }, z$1.core.$strip>>;
        gitRemoteUrl: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        kind: z$1.ZodEnum<{
            personal: "personal";
            standard: "standard";
        }>;
        name: z$1.ZodString;
        sources: z$1.ZodArray<z$1.ZodObject<{
            createdAt: z$1.ZodNumber;
            hostId: z$1.ZodString;
            id: z$1.ZodString;
            isDefault: z$1.ZodBoolean;
            path: z$1.ZodString;
            projectId: z$1.ZodString;
            type: z$1.ZodLiteral<"local_path">;
            updatedAt: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        threads: z$1.ZodArray<z$1.ZodObject<{
            activity: z$1.ZodObject<{
                activeBackgroundAgentCount: z$1.ZodNumber;
                activeBackgroundCommandCount: z$1.ZodNumber;
                activeGoalCount: z$1.ZodNumber;
                activePlanModeCount: z$1.ZodNumber;
                activeWorkflowCount: z$1.ZodNumber;
            }, z$1.core.$strip>;
            archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
            createdAt: z$1.ZodNumber;
            deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
            environmentBranchName: z$1.ZodNullable<z$1.ZodString>;
            environmentHostId: z$1.ZodNullable<z$1.ZodString>;
            environmentId: z$1.ZodNullable<z$1.ZodString>;
            environmentName: z$1.ZodNullable<z$1.ZodString>;
            environmentWorkspaceDisplayKind: z$1.ZodEnum<{
                "managed-worktree": "managed-worktree";
                "unmanaged-worktree": "unmanaged-worktree";
                other: "other";
            }>;
            hasPendingInteraction: z$1.ZodBoolean;
            id: z$1.ZodString;
            lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
            latestAttentionAt: z$1.ZodNumber;
            originKind: z$1.ZodNullable<z$1.ZodEnum<{
                fork: "fork";
            }>>;
            originPluginId: z$1.ZodNullable<z$1.ZodString>;
            parentThreadId: z$1.ZodNullable<z$1.ZodString>;
            pinSortKey: z$1.ZodNullable<z$1.ZodString>;
            pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
            projectId: z$1.ZodString;
            providerId: z$1.ZodString;
            queuedWork: z$1.ZodEnum<{
                failed: "failed";
                none: "none";
                waiting: "waiting";
            }>;
            runtime: z$1.ZodObject<{
                displayStatus: z$1.ZodEnum<{
                    "host-reconnecting": "host-reconnecting";
                    "waiting-for-host": "waiting-for-host";
                    active: "active";
                    error: "error";
                    idle: "idle";
                    pending: "pending";
                    provisioning: "provisioning";
                    starting: "starting";
                    stopping: "stopping";
                }>;
                hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
            }, z$1.core.$strip>;
            sectionId: z$1.ZodNullable<z$1.ZodString>;
            sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
            status: z$1.ZodEnum<{
                active: "active";
                error: "error";
                idle: "idle";
                pending: "pending";
                starting: "starting";
                stopping: "stopping";
            }>;
            title: z$1.ZodNullable<z$1.ZodString>;
            titleFallback: z$1.ZodNullable<z$1.ZodString>;
            updatedAt: z$1.ZodNumber;
            visibility: z$1.ZodEnum<{
                hidden: "hidden";
                visible: "visible";
            }>;
        }, z$1.core.$strip>>;
        updatedAt: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    sections: z$1.ZodArray<z$1.ZodObject<{
        createdAt: z$1.ZodNumber;
        id: z$1.ZodString;
        name: z$1.ZodString;
        updatedAt: z$1.ZodNumber;
    }, z$1.core.$strict>>;
}, z$1.core.$strip>;
type SidebarBootstrapResponse = z$1.infer<typeof sidebarBootstrapResponseSchema>;
declare const uploadedPromptAttachmentSchema: z$1.ZodObject<{
    mimeType: z$1.ZodOptional<z$1.ZodString>;
    name: z$1.ZodString;
    path: z$1.ZodString;
    sizeBytes: z$1.ZodNumber;
    type: z$1.ZodEnum<{
        localFile: "localFile";
        localImage: "localImage";
    }>;
}, z$1.core.$strip>;
type UploadedPromptAttachment = z$1.infer<typeof uploadedPromptAttachmentSchema>;
declare const copyProjectAttachmentsRequestSchema: z$1.ZodObject<{
    paths: z$1.ZodArray<z$1.ZodString>;
    sourceProjectId: z$1.ZodString;
}, z$1.core.$strict>;
type CopyProjectAttachmentsRequest = z$1.infer<typeof copyProjectAttachmentsRequestSchema>;

declare const registrySkillSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    installUrl: z$1.ZodNullable<z$1.ZodString>;
    installs: z$1.ZodNumber;
    name: z$1.ZodString;
    skillId: z$1.ZodString;
    source: z$1.ZodString;
    stars: z$1.ZodNullable<z$1.ZodNumber>;
    summary: z$1.ZodNullable<z$1.ZodString>;
    topic: z$1.ZodNullable<z$1.ZodString>;
    url: z$1.ZodString;
}, z$1.core.$strip>;
type RegistrySkill = z$1.infer<typeof registrySkillSchema>;
declare const registrySkillsPageSchema: z$1.ZodObject<{
    pagination: z$1.ZodObject<{
        hasMore: z$1.ZodBoolean;
        page: z$1.ZodNumber;
        perPage: z$1.ZodNumber;
        total: z$1.ZodNumber;
    }, z$1.core.$strip>;
    ranking: z$1.ZodEnum<{
        "all-time": "all-time";
        trending: "trending";
    }>;
    skills: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        installUrl: z$1.ZodNullable<z$1.ZodString>;
        installs: z$1.ZodNumber;
        name: z$1.ZodString;
        skillId: z$1.ZodString;
        source: z$1.ZodString;
        stars: z$1.ZodNullable<z$1.ZodNumber>;
        summary: z$1.ZodNullable<z$1.ZodString>;
        topic: z$1.ZodNullable<z$1.ZodString>;
        url: z$1.ZodString;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type RegistrySkillsPage = z$1.infer<typeof registrySkillsPageSchema>;
declare const registryRepositoryStarsSchema: z$1.ZodObject<{
    stars: z$1.ZodNumber;
}, z$1.core.$strip>;
type RegistryRepositoryStars = z$1.infer<typeof registryRepositoryStarsSchema>;
declare const registrySkillDetailSchema: z$1.ZodObject<{
    files: z$1.ZodNullable<z$1.ZodArray<z$1.ZodObject<{
        contents: z$1.ZodString;
        path: z$1.ZodString;
    }, z$1.core.$strip>>>;
    hash: z$1.ZodNullable<z$1.ZodString>;
    id: z$1.ZodString;
    skillId: z$1.ZodString;
    source: z$1.ZodString;
}, z$1.core.$strip>;
type RegistrySkillDetail = z$1.infer<typeof registrySkillDetailSchema>;
declare const registrySkillEntriesResponseSchema: z$1.ZodObject<{
    entries: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        installUrl: z$1.ZodNullable<z$1.ZodString>;
        installs: z$1.ZodNumber;
        name: z$1.ZodString;
        skillId: z$1.ZodString;
        source: z$1.ZodString;
        stars: z$1.ZodNullable<z$1.ZodNumber>;
        summary: z$1.ZodNullable<z$1.ZodString>;
        topic: z$1.ZodNullable<z$1.ZodString>;
        url: z$1.ZodString;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type RegistrySkillEntriesResponse = z$1.infer<typeof registrySkillEntriesResponseSchema>;
declare const registrySkillInstallResponseSchema: z$1.ZodObject<{
    filePath: z$1.ZodString;
    ok: z$1.ZodLiteral<true>;
}, z$1.core.$strip>;
type RegistrySkillInstallResponse = z$1.infer<typeof registrySkillInstallResponseSchema>;

declare const updateEnvironmentRequestSchema: z$1.ZodObject<{
    mergeBaseBranch: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    name: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
}, z$1.core.$strip>;
type UpdateEnvironmentRequest = z$1.infer<typeof updateEnvironmentRequestSchema>;
declare const environmentPathsQuerySchema: z$1.ZodObject<{
    includeDirectories: z$1.ZodEnum<{
        false: "false";
        true: "true";
    }>;
    includeFiles: z$1.ZodEnum<{
        false: "false";
        true: "true";
    }>;
    limit: z$1.ZodOptional<z$1.ZodString>;
    query: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type EnvironmentPathsQuery = z$1.infer<typeof environmentPathsQuerySchema>;
declare const environmentDiffBranchesQuerySchema: z$1.ZodObject<{
    limit: z$1.ZodOptional<z$1.ZodString>;
    query: z$1.ZodOptional<z$1.ZodString>;
    selectedBranch: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type EnvironmentDiffBranchesQuery = z$1.infer<typeof environmentDiffBranchesQuerySchema>;
declare const environmentDiffBranchesResponseSchema: z$1.ZodObject<{
    branches: z$1.ZodArray<z$1.ZodString>;
    branchesTruncated: z$1.ZodBoolean;
    remoteBranches: z$1.ZodArray<z$1.ZodString>;
    remoteBranchesTruncated: z$1.ZodBoolean;
    selectedBranch: z$1.ZodNullable<z$1.ZodObject<{
        kind: z$1.ZodEnum<{
            local: "local";
            missing: "missing";
            remote: "remote";
        }>;
        name: z$1.ZodString;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type EnvironmentDiffBranchesResponse = z$1.infer<typeof environmentDiffBranchesResponseSchema>;
declare const environmentStatusQuerySchema: z$1.ZodObject<{
    mergeBaseBranch: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodString, z$1.ZodString>>;
}, z$1.core.$strip>;
type EnvironmentStatusQuery = z$1.infer<typeof environmentStatusQuerySchema>;
declare const environmentDiffQuerySchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    target: z$1.ZodLiteral<"uncommitted">;
}, z$1.core.$strip>, z$1.ZodObject<{
    mergeBaseBranch: z$1.ZodPipe<z$1.ZodString, z$1.ZodString>;
    target: z$1.ZodLiteral<"branch_committed">;
}, z$1.core.$strip>, z$1.ZodObject<{
    mergeBaseBranch: z$1.ZodPipe<z$1.ZodString, z$1.ZodString>;
    target: z$1.ZodLiteral<"all">;
}, z$1.core.$strip>, z$1.ZodObject<{
    sha: z$1.ZodString;
    target: z$1.ZodLiteral<"commit">;
}, z$1.core.$strip>], "target">;
type EnvironmentDiffQuery = z$1.infer<typeof environmentDiffQuerySchema>;
declare const environmentDiffFileQuerySchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    path: z$1.ZodString;
    side: z$1.ZodEnum<{
        new: "new";
        old: "old";
    }>;
    target: z$1.ZodLiteral<"uncommitted">;
}, z$1.core.$strip>, z$1.ZodObject<{
    mergeBaseRef: z$1.ZodString;
    path: z$1.ZodString;
    side: z$1.ZodEnum<{
        new: "new";
        old: "old";
    }>;
    target: z$1.ZodLiteral<"branch_committed">;
}, z$1.core.$strip>, z$1.ZodObject<{
    mergeBaseRef: z$1.ZodString;
    path: z$1.ZodString;
    side: z$1.ZodEnum<{
        new: "new";
        old: "old";
    }>;
    target: z$1.ZodLiteral<"all">;
}, z$1.core.$strip>, z$1.ZodObject<{
    path: z$1.ZodString;
    sha: z$1.ZodString;
    side: z$1.ZodEnum<{
        new: "new";
        old: "old";
    }>;
    target: z$1.ZodLiteral<"commit">;
}, z$1.core.$strip>], "target">;
type EnvironmentDiffFileQuery = z$1.infer<typeof environmentDiffFileQuerySchema>;
declare const environmentDiffFileResponseSchema: z$1.ZodObject<{
    content: z$1.ZodString;
    contentEncoding: z$1.ZodEnum<{
        base64: "base64";
        utf8: "utf8";
    }>;
    mimeType: z$1.ZodOptional<z$1.ZodString>;
    path: z$1.ZodString;
    sizeBytes: z$1.ZodNumber;
}, z$1.core.$strip>;
type EnvironmentDiffFileResponse = z$1.infer<typeof environmentDiffFileResponseSchema>;
declare const environmentArchiveThreadsResponseSchema: z$1.ZodObject<{
    archivedThreadIds: z$1.ZodArray<z$1.ZodString>;
    ok: z$1.ZodLiteral<true>;
}, z$1.core.$strip>;
type EnvironmentArchiveThreadsResponse = z$1.infer<typeof environmentArchiveThreadsResponseSchema>;
declare const pullRequestMergeMethodSchema: z$1.ZodEnum<{
    merge: "merge";
    rebase: "rebase";
    squash: "squash";
}>;
type PullRequestMergeMethod = z$1.infer<typeof pullRequestMergeMethodSchema>;
declare const commitActionResponseSchema: z$1.ZodObject<{
    action: z$1.ZodLiteral<"commit">;
    commitSha: z$1.ZodString;
    commitSubject: z$1.ZodString;
    message: z$1.ZodString;
    ok: z$1.ZodLiteral<true>;
}, z$1.core.$strip>;
type CommitActionResponse = z$1.infer<typeof commitActionResponseSchema>;
declare const pullRequestReadyActionResponseSchema: z$1.ZodObject<{
    action: z$1.ZodLiteral<"pull_request_ready">;
    message: z$1.ZodString;
    ok: z$1.ZodLiteral<true>;
}, z$1.core.$strip>;
type PullRequestReadyActionResponse = z$1.infer<typeof pullRequestReadyActionResponseSchema>;
declare const pullRequestMergeActionResponseSchema: z$1.ZodObject<{
    action: z$1.ZodLiteral<"pull_request_merge">;
    message: z$1.ZodString;
    method: z$1.ZodEnum<{
        merge: "merge";
        rebase: "rebase";
        squash: "squash";
    }>;
    ok: z$1.ZodLiteral<true>;
}, z$1.core.$strip>;
type PullRequestMergeActionResponse = z$1.infer<typeof pullRequestMergeActionResponseSchema>;
declare const pullRequestDraftActionResponseSchema: z$1.ZodObject<{
    action: z$1.ZodLiteral<"pull_request_draft">;
    message: z$1.ZodString;
    ok: z$1.ZodLiteral<true>;
}, z$1.core.$strip>;
type PullRequestDraftActionResponse = z$1.infer<typeof pullRequestDraftActionResponseSchema>;
declare const environmentStatusResponseSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"available">;
    workspace: z$1.ZodObject<{
        branch: z$1.ZodObject<{
            currentBranch: z$1.ZodNullable<z$1.ZodString>;
            defaultBranch: z$1.ZodString;
        }, z$1.core.$strip>;
        checkout: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            branchName: z$1.ZodString;
            headSha: z$1.ZodNullable<z$1.ZodString>;
            kind: z$1.ZodLiteral<"branch">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            headSha: z$1.ZodNullable<z$1.ZodString>;
            kind: z$1.ZodLiteral<"detached">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            branchName: z$1.ZodNullable<z$1.ZodString>;
            kind: z$1.ZodLiteral<"unborn">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"unknown">;
            reason: z$1.ZodString;
        }, z$1.core.$strip>], "kind">;
        mergeBase: z$1.ZodNullable<z$1.ZodObject<{
            aheadCount: z$1.ZodNumber;
            baseRef: z$1.ZodNullable<z$1.ZodString>;
            behindCount: z$1.ZodNumber;
            commits: z$1.ZodArray<z$1.ZodObject<{
                authorName: z$1.ZodString;
                authoredAt: z$1.ZodNumber;
                sha: z$1.ZodString;
                shortSha: z$1.ZodString;
                subject: z$1.ZodString;
            }, z$1.core.$strip>>;
            deletions: z$1.ZodNumber;
            files: z$1.ZodArray<z$1.ZodObject<{
                deletions: z$1.ZodNullable<z$1.ZodNumber>;
                insertions: z$1.ZodNullable<z$1.ZodNumber>;
                path: z$1.ZodString;
                status: z$1.ZodEnum<{
                    "?": "?";
                    "??": "??";
                    A: "A";
                    C: "C";
                    D: "D";
                    M: "M";
                    R: "R";
                    U: "U";
                }>;
            }, z$1.core.$strip>>;
            hasCommittedUnmergedChanges: z$1.ZodBoolean;
            insertions: z$1.ZodNumber;
            lineStatsComplete: z$1.ZodBoolean;
            mergeBaseBranch: z$1.ZodString;
        }, z$1.core.$strip>>;
        workingTree: z$1.ZodObject<{
            deletions: z$1.ZodNumber;
            files: z$1.ZodArray<z$1.ZodObject<{
                deletions: z$1.ZodNullable<z$1.ZodNumber>;
                insertions: z$1.ZodNullable<z$1.ZodNumber>;
                path: z$1.ZodString;
                status: z$1.ZodEnum<{
                    "?": "?";
                    "??": "??";
                    A: "A";
                    C: "C";
                    D: "D";
                    M: "M";
                    R: "R";
                    U: "U";
                }>;
            }, z$1.core.$strip>>;
            hasUncommittedChanges: z$1.ZodBoolean;
            insertions: z$1.ZodNumber;
            lineStatsComplete: z$1.ZodBoolean;
            state: z$1.ZodEnum<{
                clean: "clean";
                committed_unmerged: "committed_unmerged";
                dirty_and_committed_unmerged: "dirty_and_committed_unmerged";
                dirty_uncommitted: "dirty_uncommitted";
                untracked: "untracked";
            }>;
        }, z$1.core.$strip>;
    }, z$1.core.$strip>;
}, z$1.core.$strict>, z$1.ZodObject<{
    message: z$1.ZodString;
    outcome: z$1.ZodLiteral<"not_applicable">;
    reason: z$1.ZodEnum<{
        non_git_environment: "non_git_environment";
    }>;
}, z$1.core.$strict>, z$1.ZodObject<{
    failure: z$1.ZodObject<{
        code: z$1.ZodEnum<{
            not_git_repo: "not_git_repo";
            not_worktree: "not_worktree";
            path_not_found: "path_not_found";
            permission_denied: "permission_denied";
            unknown: "unknown";
            unknown_environment: "unknown_environment";
            workspace_type_mismatch: "workspace_type_mismatch";
        }>;
        message: z$1.ZodString;
        workspacePath: z$1.ZodString;
    }, z$1.core.$strict>;
    outcome: z$1.ZodLiteral<"unavailable">;
}, z$1.core.$strict>], "outcome">;
declare const environmentPullRequestResponseSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"available">;
    pullRequest: z$1.ZodObject<{
        attention: z$1.ZodEnum<{
            blocked: "blocked";
            changes_requested: "changes_requested";
            checks_failed: "checks_failed";
            checks_pending: "checks_pending";
            closed: "closed";
            conflicts: "conflicts";
            draft: "draft";
            merged: "merged";
            none: "none";
            ready_to_merge: "ready_to_merge";
            review_requested: "review_requested";
        }>;
        baseRefName: z$1.ZodString;
        checks: z$1.ZodObject<{
            failedCount: z$1.ZodNumber;
            passedCount: z$1.ZodNumber;
            pendingCount: z$1.ZodNumber;
            state: z$1.ZodEnum<{
                failing: "failing";
                no_checks: "no_checks";
                passing: "passing";
                pending: "pending";
                unknown: "unknown";
            }>;
            totalCount: z$1.ZodNumber;
        }, z$1.core.$strict>;
        headRefName: z$1.ZodString;
        mergeability: z$1.ZodObject<{
            mergeStateStatus: z$1.ZodNullable<z$1.ZodEnum<{
                BEHIND: "BEHIND";
                BLOCKED: "BLOCKED";
                CLEAN: "CLEAN";
                DIRTY: "DIRTY";
                DRAFT: "DRAFT";
                HAS_HOOKS: "HAS_HOOKS";
                UNKNOWN: "UNKNOWN";
                UNSTABLE: "UNSTABLE";
            }>>;
            mergeable: z$1.ZodNullable<z$1.ZodEnum<{
                CONFLICTING: "CONFLICTING";
                MERGEABLE: "MERGEABLE";
                UNKNOWN: "UNKNOWN";
            }>>;
            state: z$1.ZodEnum<{
                blocked: "blocked";
                conflicts: "conflicts";
                draft: "draft";
                mergeable: "mergeable";
                unknown: "unknown";
            }>;
        }, z$1.core.$strict>;
        number: z$1.ZodNumber;
        review: z$1.ZodObject<{
            reviewRequestCount: z$1.ZodNumber;
            state: z$1.ZodEnum<{
                approved: "approved";
                changes_requested: "changes_requested";
                none: "none";
                review_requested: "review_requested";
                review_required: "review_required";
            }>;
        }, z$1.core.$strict>;
        state: z$1.ZodEnum<{
            closed: "closed";
            draft: "draft";
            merged: "merged";
            open: "open";
        }>;
        title: z$1.ZodString;
        updatedAt: z$1.ZodString;
        url: z$1.ZodString;
    }, z$1.core.$strict>;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"absent">;
}, z$1.core.$strict>, z$1.ZodObject<{
    message: z$1.ZodString;
    outcome: z$1.ZodLiteral<"unavailable">;
}, z$1.core.$strict>], "outcome">;
type EnvironmentPullRequestResponse = z$1.infer<typeof environmentPullRequestResponseSchema>;
declare const environmentDiffResponseSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    diff: z$1.ZodObject<{
        diff: z$1.ZodString;
        files: z$1.ZodString;
        mergeBaseRef: z$1.ZodNullable<z$1.ZodString>;
        shortstat: z$1.ZodString;
        truncated: z$1.ZodBoolean;
    }, z$1.core.$strip>;
    outcome: z$1.ZodLiteral<"available">;
}, z$1.core.$strict>, z$1.ZodObject<{
    message: z$1.ZodString;
    outcome: z$1.ZodLiteral<"not_applicable">;
    reason: z$1.ZodEnum<{
        non_git_environment: "non_git_environment";
    }>;
}, z$1.core.$strict>, z$1.ZodObject<{
    failure: z$1.ZodObject<{
        code: z$1.ZodEnum<{
            not_git_repo: "not_git_repo";
            not_worktree: "not_worktree";
            path_not_found: "path_not_found";
            permission_denied: "permission_denied";
            unknown: "unknown";
            unknown_environment: "unknown_environment";
            workspace_type_mismatch: "workspace_type_mismatch";
        }>;
        message: z$1.ZodString;
        workspacePath: z$1.ZodString;
    }, z$1.core.$strict>;
    outcome: z$1.ZodLiteral<"unavailable">;
}, z$1.core.$strict>], "outcome">;
type EnvironmentDiffResponse = z$1.infer<typeof environmentDiffResponseSchema>;
declare const environmentDiffFilesResponseSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    files: z$1.ZodArray<z$1.ZodObject<{
        additions: z$1.ZodNumber;
        binary: z$1.ZodBoolean;
        changeKind: z$1.ZodEnum<{
            added: "added";
            copied: "copied";
            deleted: "deleted";
            modified: "modified";
            renamed: "renamed";
            type_changed: "type_changed";
        }>;
        deletions: z$1.ZodNumber;
        loadMode: z$1.ZodEnum<{
            auto: "auto";
            on_demand: "on_demand";
            too_large: "too_large";
        }>;
        origin: z$1.ZodEnum<{
            tracked: "tracked";
            untracked: "untracked";
        }>;
        path: z$1.ZodString;
        previousPath: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>;
    initialPatches: z$1.ZodArray<z$1.ZodObject<{
        patch: z$1.ZodString;
        path: z$1.ZodString;
        truncated: z$1.ZodBoolean;
    }, z$1.core.$strip>>;
    mergeBaseRef: z$1.ZodNullable<z$1.ZodString>;
    outcome: z$1.ZodLiteral<"available">;
    shortstat: z$1.ZodString;
    truncated: z$1.ZodBoolean;
}, z$1.core.$strict>, z$1.ZodObject<{
    message: z$1.ZodString;
    outcome: z$1.ZodLiteral<"not_applicable">;
    reason: z$1.ZodEnum<{
        non_git_environment: "non_git_environment";
    }>;
}, z$1.core.$strict>, z$1.ZodObject<{
    failure: z$1.ZodObject<{
        code: z$1.ZodEnum<{
            not_git_repo: "not_git_repo";
            not_worktree: "not_worktree";
            path_not_found: "path_not_found";
            permission_denied: "permission_denied";
            unknown: "unknown";
            unknown_environment: "unknown_environment";
            workspace_type_mismatch: "workspace_type_mismatch";
        }>;
        message: z$1.ZodString;
        workspacePath: z$1.ZodString;
    }, z$1.core.$strict>;
    outcome: z$1.ZodLiteral<"unavailable">;
}, z$1.core.$strict>], "outcome">;
type EnvironmentDiffFilesResponse = z$1.infer<typeof environmentDiffFilesResponseSchema>;
declare const environmentDiffPatchResponseSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"available">;
    patches: z$1.ZodArray<z$1.ZodObject<{
        patch: z$1.ZodString;
        path: z$1.ZodString;
        truncated: z$1.ZodBoolean;
    }, z$1.core.$strip>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    message: z$1.ZodString;
    outcome: z$1.ZodLiteral<"not_applicable">;
    reason: z$1.ZodEnum<{
        non_git_environment: "non_git_environment";
    }>;
}, z$1.core.$strict>, z$1.ZodObject<{
    failure: z$1.ZodObject<{
        code: z$1.ZodEnum<{
            not_git_repo: "not_git_repo";
            not_worktree: "not_worktree";
            path_not_found: "path_not_found";
            permission_denied: "permission_denied";
            unknown: "unknown";
            unknown_environment: "unknown_environment";
            workspace_type_mismatch: "workspace_type_mismatch";
        }>;
        message: z$1.ZodString;
        workspacePath: z$1.ZodString;
    }, z$1.core.$strict>;
    outcome: z$1.ZodLiteral<"unavailable">;
}, z$1.core.$strict>], "outcome">;
type EnvironmentDiffPatchResponse = z$1.infer<typeof environmentDiffPatchResponseSchema>;
declare const environmentDiffPatchRequestSchema: z$1.ZodObject<{
    paths: z$1.ZodArray<z$1.ZodString>;
    target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        type: z$1.ZodLiteral<"uncommitted">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        mergeBaseBranch: z$1.ZodString;
        type: z$1.ZodLiteral<"branch_committed">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        mergeBaseBranch: z$1.ZodString;
        type: z$1.ZodLiteral<"all">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        sha: z$1.ZodString;
        type: z$1.ZodLiteral<"commit">;
    }, z$1.core.$strip>], "type">;
}, z$1.core.$strict>;
type EnvironmentDiffPatchRequest = z$1.infer<typeof environmentDiffPatchRequestSchema>;
type EnvironmentStatusResponse = z$1.infer<typeof environmentStatusResponseSchema>;

declare const providerUsageResponseSchema: z$1.ZodRecord<z$1.ZodString, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    accountEmail: z$1.ZodNullable<z$1.ZodString>;
    planLabel: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodLiteral<"ok">;
    windows: z$1.ZodArray<z$1.ZodObject<{
        cost: z$1.ZodOptional<z$1.ZodObject<{
            limitUsdCents: z$1.ZodNumber;
            usedUsdCents: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        label: z$1.ZodString;
        resetsAt: z$1.ZodNullable<z$1.ZodString>;
        usedPercent: z$1.ZodNumber;
    }, z$1.core.$loose>>;
}, z$1.core.$loose>, z$1.ZodObject<{
    status: z$1.ZodLiteral<"not_installed">;
}, z$1.core.$loose>, z$1.ZodObject<{
    status: z$1.ZodLiteral<"unauthenticated">;
}, z$1.core.$loose>, z$1.ZodObject<{
    status: z$1.ZodLiteral<"expired">;
}, z$1.core.$loose>, z$1.ZodObject<{
    accountEmail: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
    message: z$1.ZodString;
    planLabel: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
    status: z$1.ZodLiteral<"error">;
}, z$1.core.$loose>], "status">>;
type ProviderUsageResponse = z$1.infer<typeof providerUsageResponseSchema>;
type HostDaemonCommandTransport = "onlineRpc" | "settled";
type HostDaemonCommandEnvironmentLane = "read" | "write";
type HostDaemonFlushEventsBeforeResult = boolean | "when-initiated";
interface HostDaemonCommandDescriptor<Type extends string, Schema extends z$1.ZodTypeAny, ResultSchema extends z$1.ZodTypeAny, Transport extends HostDaemonCommandTransport, Retryable extends boolean> {
    type: Type;
    schema: Schema;
    resultSchema: ResultSchema;
    transport: Transport;
    retryable: Retryable;
    flushEventsBeforeResult: HostDaemonFlushEventsBeforeResult;
    envLane: HostDaemonCommandEnvironmentLane | null;
}
declare const hostDaemonCommandRegistry: {
    "thread.rewind.discard": HostDaemonCommandDescriptor<"thread.rewind.discard", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        leaseId: z$1.ZodString;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"thread.rewind.discard">;
    }, z$1.core.$strict>, z$1.ZodObject<{}, z$1.core.$strip>, "settled", false>;
    "thread.rewind.prepare": HostDaemonCommandDescriptor<"thread.rewind.prepare", z$1.ZodObject<{
        bridgeLaunch: z$1.ZodObject<{
            capabilities: z$1.ZodObject<{
                fork: z$1.ZodEnum<{
                    checkpoint: "checkpoint";
                    none: "none";
                    tip: "tip";
                }>;
                permissionModes: z$1.ZodArray<z$1.ZodEnum<{
                    "accept-edits": "accept-edits";
                    auto: "auto";
                    full: "full";
                }>>;
                providerInstallation: z$1.ZodBoolean;
                supportsServiceTier: z$1.ZodBoolean;
                supportsThreadArchive: z$1.ZodBoolean;
                supportsThreadRename: z$1.ZodBoolean;
            }, z$1.core.$strict>;
            envPassthrough: z$1.ZodArray<z$1.ZodString>;
            pluginId: z$1.ZodString;
            providerOptions: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
            source: z$1.ZodObject<{
                byteLength: z$1.ZodNumber;
                digest: z$1.ZodString;
                kind: z$1.ZodLiteral<"artifact">;
            }, z$1.core.$strict>;
        }, z$1.core.$strict>;
        contributedEnv: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            reason: z$1.ZodString;
            secret: z$1.ZodBoolean;
            source: z$1.ZodObject<{
                plugin: z$1.ZodString;
            }, z$1.core.$strict>;
            value: z$1.ZodUnion<readonly [z$1.ZodString, z$1.ZodObject<{
                serverPath: z$1.ZodString;
            }, z$1.core.$strict>]>;
        }, z$1.core.$strict>>>;
        disallowedTools: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
        dynamicTools: z$1.ZodArray<z$1.ZodObject<{
            description: z$1.ZodString;
            inputSchema: z$1.ZodUnknown;
            name: z$1.ZodString;
            presentation: z$1.ZodOptional<z$1.ZodObject<{
                badge: z$1.ZodOptional<z$1.ZodObject<{
                    glyph: z$1.ZodString;
                    hint: z$1.ZodString;
                    label: z$1.ZodString;
                    tone: z$1.ZodEnum<{
                        destructive: "destructive";
                        neutral: "neutral";
                    }>;
                }, z$1.core.$strip>>;
                detail: z$1.ZodOptional<z$1.ZodString>;
                icon: z$1.ZodObject<{
                    glyph: z$1.ZodString;
                }, z$1.core.$strip>;
                label: z$1.ZodObject<{
                    completed: z$1.ZodString;
                    pending: z$1.ZodString;
                }, z$1.core.$strip>;
                suppress: z$1.ZodOptional<z$1.ZodBoolean>;
                tint: z$1.ZodOptional<z$1.ZodObject<{
                    dark: z$1.ZodString;
                    light: z$1.ZodString;
                }, z$1.core.$strip>>;
                title: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        environmentId: z$1.ZodString;
        injectedSkillSources: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            description: z$1.ZodString;
            entryPath: z$1.ZodString;
            kind: z$1.ZodLiteral<"tree">;
            name: z$1.ZodString;
            sourceType: z$1.ZodEnum<{
                "data-dir": "data-dir";
                builtin: "builtin";
            }>;
            treeHash: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            description: z$1.ZodString;
            kind: z$1.ZodLiteral<"workspace-path">;
            name: z$1.ZodString;
            skillFilePath: z$1.ZodString;
            sourceRootPath: z$1.ZodString;
            sourceType: z$1.ZodLiteral<"project">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            description: z$1.ZodString;
            kind: z$1.ZodLiteral<"host-path">;
            name: z$1.ZodString;
            skillFilePath: z$1.ZodString;
            sourceRootPath: z$1.ZodString;
            sourceType: z$1.ZodEnum<{
                "shared-project": "shared-project";
                "shared-user": "shared-user";
            }>;
        }, z$1.core.$strict>], "kind">>;
        instructionMode: z$1.ZodEnum<{
            append: "append";
            replace: "replace";
        }>;
        instructions: z$1.ZodString;
        leaseId: z$1.ZodString;
        options: z$1.ZodIntersection<z$1.ZodObject<{
            model: z$1.ZodString;
            promptMode: z$1.ZodOptional<z$1.ZodLiteral<"plan">>;
            providerOptions: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
            reasoningLevel: z$1.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                none: "none";
                ultra: "ultra";
                ultracode: "ultracode";
                xhigh: "xhigh";
            }>;
            serviceTier: z$1.ZodEnum<{
                default: "default";
                fast: "fast";
            }>;
        }, z$1.core.$strip>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            approvalReviewer: z$1.ZodLiteral<"user">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
            permissionMode: z$1.ZodLiteral<"accept-edits">;
            permissionScope: z$1.ZodLiteral<"workspace">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            approvalReviewer: z$1.ZodLiteral<"automatic">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
            permissionMode: z$1.ZodLiteral<"auto">;
            permissionScope: z$1.ZodLiteral<"workspace">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            approvalReviewer: z$1.ZodNull;
            permissionEscalation: z$1.ZodNull;
            permissionMode: z$1.ZodLiteral<"full">;
            permissionScope: z$1.ZodLiteral<"full">;
        }, z$1.core.$strip>], "permissionMode">>;
        projectId: z$1.ZodString;
        providerId: z$1.ZodString;
        retainThroughProviderCheckpoint: z$1.ZodString;
        sourceProviderThreadId: z$1.ZodString;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"thread.rewind.prepare">;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                "managed-worktree": "managed-worktree";
                personal: "personal";
                unmanaged: "unmanaged";
            }>;
        }, z$1.core.$strip>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        providerThreadId: z$1.ZodString;
    }, z$1.core.$strip>, "settled", false>;
    "thread.start": HostDaemonCommandDescriptor<"thread.start", z$1.ZodObject<{
        bridgeLaunch: z$1.ZodObject<{
            capabilities: z$1.ZodObject<{
                fork: z$1.ZodEnum<{
                    checkpoint: "checkpoint";
                    none: "none";
                    tip: "tip";
                }>;
                permissionModes: z$1.ZodArray<z$1.ZodEnum<{
                    "accept-edits": "accept-edits";
                    auto: "auto";
                    full: "full";
                }>>;
                providerInstallation: z$1.ZodBoolean;
                supportsServiceTier: z$1.ZodBoolean;
                supportsThreadArchive: z$1.ZodBoolean;
                supportsThreadRename: z$1.ZodBoolean;
            }, z$1.core.$strict>;
            envPassthrough: z$1.ZodArray<z$1.ZodString>;
            pluginId: z$1.ZodString;
            providerOptions: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
            source: z$1.ZodObject<{
                byteLength: z$1.ZodNumber;
                digest: z$1.ZodString;
                kind: z$1.ZodLiteral<"artifact">;
            }, z$1.core.$strict>;
        }, z$1.core.$strict>;
        contributedEnv: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            reason: z$1.ZodString;
            secret: z$1.ZodBoolean;
            source: z$1.ZodObject<{
                plugin: z$1.ZodString;
            }, z$1.core.$strict>;
            value: z$1.ZodUnion<readonly [z$1.ZodString, z$1.ZodObject<{
                serverPath: z$1.ZodString;
            }, z$1.core.$strict>]>;
        }, z$1.core.$strict>>>;
        disallowedTools: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
        dynamicTools: z$1.ZodArray<z$1.ZodObject<{
            description: z$1.ZodString;
            inputSchema: z$1.ZodUnknown;
            name: z$1.ZodString;
            presentation: z$1.ZodOptional<z$1.ZodObject<{
                badge: z$1.ZodOptional<z$1.ZodObject<{
                    glyph: z$1.ZodString;
                    hint: z$1.ZodString;
                    label: z$1.ZodString;
                    tone: z$1.ZodEnum<{
                        destructive: "destructive";
                        neutral: "neutral";
                    }>;
                }, z$1.core.$strip>>;
                detail: z$1.ZodOptional<z$1.ZodString>;
                icon: z$1.ZodObject<{
                    glyph: z$1.ZodString;
                }, z$1.core.$strip>;
                label: z$1.ZodObject<{
                    completed: z$1.ZodString;
                    pending: z$1.ZodString;
                }, z$1.core.$strip>;
                suppress: z$1.ZodOptional<z$1.ZodBoolean>;
                tint: z$1.ZodOptional<z$1.ZodObject<{
                    dark: z$1.ZodString;
                    light: z$1.ZodString;
                }, z$1.core.$strip>>;
                title: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        environmentId: z$1.ZodString;
        fork: z$1.ZodOptional<z$1.ZodObject<{
            sourceProviderCheckpointId: z$1.ZodOptional<z$1.ZodString>;
            sourceProviderThreadId: z$1.ZodString;
        }, z$1.core.$strip>>;
        injectedSkillSources: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            description: z$1.ZodString;
            entryPath: z$1.ZodString;
            kind: z$1.ZodLiteral<"tree">;
            name: z$1.ZodString;
            sourceType: z$1.ZodEnum<{
                "data-dir": "data-dir";
                builtin: "builtin";
            }>;
            treeHash: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            description: z$1.ZodString;
            kind: z$1.ZodLiteral<"workspace-path">;
            name: z$1.ZodString;
            skillFilePath: z$1.ZodString;
            sourceRootPath: z$1.ZodString;
            sourceType: z$1.ZodLiteral<"project">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            description: z$1.ZodString;
            kind: z$1.ZodLiteral<"host-path">;
            name: z$1.ZodString;
            skillFilePath: z$1.ZodString;
            sourceRootPath: z$1.ZodString;
            sourceType: z$1.ZodEnum<{
                "shared-project": "shared-project";
                "shared-user": "shared-user";
            }>;
        }, z$1.core.$strict>], "kind">>;
        input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
                end: z$1.ZodNumber;
                resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"thread">;
                    label: z$1.ZodString;
                    projectId: z$1.ZodOptional<z$1.ZodString>;
                    threadId: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"project">;
                    label: z$1.ZodString;
                    projectId: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"section">;
                    label: z$1.ZodString;
                    sectionId: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    entryKind: z$1.ZodEnum<{
                        directory: "directory";
                        file: "file";
                    }>;
                    kind: z$1.ZodLiteral<"path">;
                    label: z$1.ZodString;
                    path: z$1.ZodString;
                    source: z$1.ZodEnum<{
                        "thread-storage": "thread-storage";
                        workspace: "workspace";
                    }>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    argumentHint: z$1.ZodNullable<z$1.ZodString>;
                    kind: z$1.ZodLiteral<"command">;
                    label: z$1.ZodString;
                    name: z$1.ZodString;
                    origin: z$1.ZodEnum<{
                        builtin: "builtin";
                        project: "project";
                        user: "user";
                    }>;
                    source: z$1.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    trigger: z$1.ZodEnum<{
                        "/": "/";
                    }>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                    itemId: z$1.ZodString;
                    kind: z$1.ZodLiteral<"plugin">;
                    label: z$1.ZodString;
                    pluginId: z$1.ZodString;
                }, z$1.core.$strip>], "kind">>;
                start: z$1.ZodNumber;
            }, z$1.core.$strip>>>;
            text: z$1.ZodString;
            type: z$1.ZodLiteral<"text">;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            path: z$1.ZodString;
            type: z$1.ZodLiteral<"localImage">;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            mimeType: z$1.ZodOptional<z$1.ZodString>;
            name: z$1.ZodOptional<z$1.ZodString>;
            path: z$1.ZodString;
            sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
            type: z$1.ZodLiteral<"localFile">;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>], "type">>;
        inputGroups: z$1.ZodOptional<z$1.ZodArray<z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
                end: z$1.ZodNumber;
                resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"thread">;
                    label: z$1.ZodString;
                    projectId: z$1.ZodOptional<z$1.ZodString>;
                    threadId: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"project">;
                    label: z$1.ZodString;
                    projectId: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"section">;
                    label: z$1.ZodString;
                    sectionId: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    entryKind: z$1.ZodEnum<{
                        directory: "directory";
                        file: "file";
                    }>;
                    kind: z$1.ZodLiteral<"path">;
                    label: z$1.ZodString;
                    path: z$1.ZodString;
                    source: z$1.ZodEnum<{
                        "thread-storage": "thread-storage";
                        workspace: "workspace";
                    }>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    argumentHint: z$1.ZodNullable<z$1.ZodString>;
                    kind: z$1.ZodLiteral<"command">;
                    label: z$1.ZodString;
                    name: z$1.ZodString;
                    origin: z$1.ZodEnum<{
                        builtin: "builtin";
                        project: "project";
                        user: "user";
                    }>;
                    source: z$1.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    trigger: z$1.ZodEnum<{
                        "/": "/";
                    }>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                    itemId: z$1.ZodString;
                    kind: z$1.ZodLiteral<"plugin">;
                    label: z$1.ZodString;
                    pluginId: z$1.ZodString;
                }, z$1.core.$strip>], "kind">>;
                start: z$1.ZodNumber;
            }, z$1.core.$strip>>>;
            text: z$1.ZodString;
            type: z$1.ZodLiteral<"text">;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            path: z$1.ZodString;
            type: z$1.ZodLiteral<"localImage">;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            mimeType: z$1.ZodOptional<z$1.ZodString>;
            name: z$1.ZodOptional<z$1.ZodString>;
            path: z$1.ZodString;
            sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
            type: z$1.ZodLiteral<"localFile">;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>], "type">>>>;
        instructionMode: z$1.ZodEnum<{
            append: "append";
            replace: "replace";
        }>;
        instructions: z$1.ZodString;
        options: z$1.ZodIntersection<z$1.ZodObject<{
            model: z$1.ZodString;
            promptMode: z$1.ZodOptional<z$1.ZodLiteral<"plan">>;
            providerOptions: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
            reasoningLevel: z$1.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                none: "none";
                ultra: "ultra";
                ultracode: "ultracode";
                xhigh: "xhigh";
            }>;
            serviceTier: z$1.ZodEnum<{
                default: "default";
                fast: "fast";
            }>;
        }, z$1.core.$strip>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            approvalReviewer: z$1.ZodLiteral<"user">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
            permissionMode: z$1.ZodLiteral<"accept-edits">;
            permissionScope: z$1.ZodLiteral<"workspace">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            approvalReviewer: z$1.ZodLiteral<"automatic">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
            permissionMode: z$1.ZodLiteral<"auto">;
            permissionScope: z$1.ZodLiteral<"workspace">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            approvalReviewer: z$1.ZodNull;
            permissionEscalation: z$1.ZodNull;
            permissionMode: z$1.ZodLiteral<"full">;
            permissionScope: z$1.ZodLiteral<"full">;
        }, z$1.core.$strip>], "permissionMode">>;
        projectId: z$1.ZodString;
        providerId: z$1.ZodString;
        requestId: z$1.ZodString;
        threadId: z$1.ZodString;
        threadStoragePath: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"thread.start">;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                "managed-worktree": "managed-worktree";
                personal: "personal";
                unmanaged: "unmanaged";
            }>;
        }, z$1.core.$strip>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        providerThreadId: z$1.ZodString;
    }, z$1.core.$strip>, "settled", false>;
    "turn.submit": HostDaemonCommandDescriptor<"turn.submit", z$1.ZodObject<{
        bridgeLaunch: z$1.ZodObject<{
            capabilities: z$1.ZodObject<{
                fork: z$1.ZodEnum<{
                    checkpoint: "checkpoint";
                    none: "none";
                    tip: "tip";
                }>;
                permissionModes: z$1.ZodArray<z$1.ZodEnum<{
                    "accept-edits": "accept-edits";
                    auto: "auto";
                    full: "full";
                }>>;
                providerInstallation: z$1.ZodBoolean;
                supportsServiceTier: z$1.ZodBoolean;
                supportsThreadArchive: z$1.ZodBoolean;
                supportsThreadRename: z$1.ZodBoolean;
            }, z$1.core.$strict>;
            envPassthrough: z$1.ZodArray<z$1.ZodString>;
            pluginId: z$1.ZodString;
            providerOptions: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
            source: z$1.ZodObject<{
                byteLength: z$1.ZodNumber;
                digest: z$1.ZodString;
                kind: z$1.ZodLiteral<"artifact">;
            }, z$1.core.$strict>;
        }, z$1.core.$strict>;
        environmentId: z$1.ZodString;
        input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
                end: z$1.ZodNumber;
                resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"thread">;
                    label: z$1.ZodString;
                    projectId: z$1.ZodOptional<z$1.ZodString>;
                    threadId: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"project">;
                    label: z$1.ZodString;
                    projectId: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"section">;
                    label: z$1.ZodString;
                    sectionId: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    entryKind: z$1.ZodEnum<{
                        directory: "directory";
                        file: "file";
                    }>;
                    kind: z$1.ZodLiteral<"path">;
                    label: z$1.ZodString;
                    path: z$1.ZodString;
                    source: z$1.ZodEnum<{
                        "thread-storage": "thread-storage";
                        workspace: "workspace";
                    }>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    argumentHint: z$1.ZodNullable<z$1.ZodString>;
                    kind: z$1.ZodLiteral<"command">;
                    label: z$1.ZodString;
                    name: z$1.ZodString;
                    origin: z$1.ZodEnum<{
                        builtin: "builtin";
                        project: "project";
                        user: "user";
                    }>;
                    source: z$1.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    trigger: z$1.ZodEnum<{
                        "/": "/";
                    }>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                    itemId: z$1.ZodString;
                    kind: z$1.ZodLiteral<"plugin">;
                    label: z$1.ZodString;
                    pluginId: z$1.ZodString;
                }, z$1.core.$strip>], "kind">>;
                start: z$1.ZodNumber;
            }, z$1.core.$strip>>>;
            text: z$1.ZodString;
            type: z$1.ZodLiteral<"text">;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            path: z$1.ZodString;
            type: z$1.ZodLiteral<"localImage">;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            mimeType: z$1.ZodOptional<z$1.ZodString>;
            name: z$1.ZodOptional<z$1.ZodString>;
            path: z$1.ZodString;
            sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
            type: z$1.ZodLiteral<"localFile">;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>], "type">>;
        inputGroups: z$1.ZodOptional<z$1.ZodArray<z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
                end: z$1.ZodNumber;
                resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"thread">;
                    label: z$1.ZodString;
                    projectId: z$1.ZodOptional<z$1.ZodString>;
                    threadId: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"project">;
                    label: z$1.ZodString;
                    projectId: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"section">;
                    label: z$1.ZodString;
                    sectionId: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    entryKind: z$1.ZodEnum<{
                        directory: "directory";
                        file: "file";
                    }>;
                    kind: z$1.ZodLiteral<"path">;
                    label: z$1.ZodString;
                    path: z$1.ZodString;
                    source: z$1.ZodEnum<{
                        "thread-storage": "thread-storage";
                        workspace: "workspace";
                    }>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    argumentHint: z$1.ZodNullable<z$1.ZodString>;
                    kind: z$1.ZodLiteral<"command">;
                    label: z$1.ZodString;
                    name: z$1.ZodString;
                    origin: z$1.ZodEnum<{
                        builtin: "builtin";
                        project: "project";
                        user: "user";
                    }>;
                    source: z$1.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    trigger: z$1.ZodEnum<{
                        "/": "/";
                    }>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                    itemId: z$1.ZodString;
                    kind: z$1.ZodLiteral<"plugin">;
                    label: z$1.ZodString;
                    pluginId: z$1.ZodString;
                }, z$1.core.$strip>], "kind">>;
                start: z$1.ZodNumber;
            }, z$1.core.$strip>>>;
            text: z$1.ZodString;
            type: z$1.ZodLiteral<"text">;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            path: z$1.ZodString;
            type: z$1.ZodLiteral<"localImage">;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            mimeType: z$1.ZodOptional<z$1.ZodString>;
            name: z$1.ZodOptional<z$1.ZodString>;
            path: z$1.ZodString;
            sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
            type: z$1.ZodLiteral<"localFile">;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>], "type">>>>;
        options: z$1.ZodIntersection<z$1.ZodObject<{
            model: z$1.ZodString;
            promptMode: z$1.ZodOptional<z$1.ZodLiteral<"plan">>;
            providerOptions: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
            reasoningLevel: z$1.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                none: "none";
                ultra: "ultra";
                ultracode: "ultracode";
                xhigh: "xhigh";
            }>;
            serviceTier: z$1.ZodEnum<{
                default: "default";
                fast: "fast";
            }>;
        }, z$1.core.$strip>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            approvalReviewer: z$1.ZodLiteral<"user">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
            permissionMode: z$1.ZodLiteral<"accept-edits">;
            permissionScope: z$1.ZodLiteral<"workspace">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            approvalReviewer: z$1.ZodLiteral<"automatic">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
            permissionMode: z$1.ZodLiteral<"auto">;
            permissionScope: z$1.ZodLiteral<"workspace">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            approvalReviewer: z$1.ZodNull;
            permissionEscalation: z$1.ZodNull;
            permissionMode: z$1.ZodLiteral<"full">;
            permissionScope: z$1.ZodLiteral<"full">;
        }, z$1.core.$strip>], "permissionMode">>;
        requestId: z$1.ZodString;
        resumeContext: z$1.ZodObject<{
            bridgeLaunch: z$1.ZodObject<{
                capabilities: z$1.ZodObject<{
                    fork: z$1.ZodEnum<{
                        checkpoint: "checkpoint";
                        none: "none";
                        tip: "tip";
                    }>;
                    permissionModes: z$1.ZodArray<z$1.ZodEnum<{
                        "accept-edits": "accept-edits";
                        auto: "auto";
                        full: "full";
                    }>>;
                    providerInstallation: z$1.ZodBoolean;
                    supportsServiceTier: z$1.ZodBoolean;
                    supportsThreadArchive: z$1.ZodBoolean;
                    supportsThreadRename: z$1.ZodBoolean;
                }, z$1.core.$strict>;
                envPassthrough: z$1.ZodArray<z$1.ZodString>;
                pluginId: z$1.ZodString;
                providerOptions: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
                source: z$1.ZodObject<{
                    byteLength: z$1.ZodNumber;
                    digest: z$1.ZodString;
                    kind: z$1.ZodLiteral<"artifact">;
                }, z$1.core.$strict>;
            }, z$1.core.$strict>;
            contributedEnv: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
                name: z$1.ZodString;
                reason: z$1.ZodString;
                secret: z$1.ZodBoolean;
                source: z$1.ZodObject<{
                    plugin: z$1.ZodString;
                }, z$1.core.$strict>;
                value: z$1.ZodUnion<readonly [z$1.ZodString, z$1.ZodObject<{
                    serverPath: z$1.ZodString;
                }, z$1.core.$strict>]>;
            }, z$1.core.$strict>>>;
            disallowedTools: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
            dynamicTools: z$1.ZodArray<z$1.ZodObject<{
                description: z$1.ZodString;
                inputSchema: z$1.ZodUnknown;
                name: z$1.ZodString;
                presentation: z$1.ZodOptional<z$1.ZodObject<{
                    badge: z$1.ZodOptional<z$1.ZodObject<{
                        glyph: z$1.ZodString;
                        hint: z$1.ZodString;
                        label: z$1.ZodString;
                        tone: z$1.ZodEnum<{
                            destructive: "destructive";
                            neutral: "neutral";
                        }>;
                    }, z$1.core.$strip>>;
                    detail: z$1.ZodOptional<z$1.ZodString>;
                    icon: z$1.ZodObject<{
                        glyph: z$1.ZodString;
                    }, z$1.core.$strip>;
                    label: z$1.ZodObject<{
                        completed: z$1.ZodString;
                        pending: z$1.ZodString;
                    }, z$1.core.$strip>;
                    suppress: z$1.ZodOptional<z$1.ZodBoolean>;
                    tint: z$1.ZodOptional<z$1.ZodObject<{
                        dark: z$1.ZodString;
                        light: z$1.ZodString;
                    }, z$1.core.$strip>>;
                    title: z$1.ZodOptional<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strip>>;
            injectedSkillSources: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                description: z$1.ZodString;
                entryPath: z$1.ZodString;
                kind: z$1.ZodLiteral<"tree">;
                name: z$1.ZodString;
                sourceType: z$1.ZodEnum<{
                    "data-dir": "data-dir";
                    builtin: "builtin";
                }>;
                treeHash: z$1.ZodString;
            }, z$1.core.$strict>, z$1.ZodObject<{
                description: z$1.ZodString;
                kind: z$1.ZodLiteral<"workspace-path">;
                name: z$1.ZodString;
                skillFilePath: z$1.ZodString;
                sourceRootPath: z$1.ZodString;
                sourceType: z$1.ZodLiteral<"project">;
            }, z$1.core.$strict>, z$1.ZodObject<{
                description: z$1.ZodString;
                kind: z$1.ZodLiteral<"host-path">;
                name: z$1.ZodString;
                skillFilePath: z$1.ZodString;
                sourceRootPath: z$1.ZodString;
                sourceType: z$1.ZodEnum<{
                    "shared-project": "shared-project";
                    "shared-user": "shared-user";
                }>;
            }, z$1.core.$strict>], "kind">>;
            instructionMode: z$1.ZodEnum<{
                append: "append";
                replace: "replace";
            }>;
            instructions: z$1.ZodString;
            projectId: z$1.ZodString;
            providerId: z$1.ZodString;
            providerThreadId: z$1.ZodString;
            workspaceContext: z$1.ZodObject<{
                workspacePath: z$1.ZodString;
                workspaceProvisionType: z$1.ZodEnum<{
                    "managed-worktree": "managed-worktree";
                    personal: "personal";
                    unmanaged: "unmanaged";
                }>;
            }, z$1.core.$strip>;
        }, z$1.core.$strict>;
        target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            mode: z$1.ZodLiteral<"start">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            expectedTurnId: z$1.ZodNullable<z$1.ZodString>;
            mode: z$1.ZodLiteral<"auto">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            expectedTurnId: z$1.ZodNullable<z$1.ZodString>;
            mode: z$1.ZodLiteral<"steer">;
        }, z$1.core.$strip>], "mode">;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"turn.submit">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        appliedAs: z$1.ZodEnum<{
            "new-turn": "new-turn";
            steer: "steer";
        }>;
    }, z$1.core.$strip>, "settled", false>;
    "thread.stop": HostDaemonCommandDescriptor<"thread.stop", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        intent: z$1.ZodEnum<{
            interrupt: "interrupt";
            release: "release";
        }>;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"thread.stop">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        providerCheckpointId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, "settled", false>;
    "thread.goal.clear": HostDaemonCommandDescriptor<"thread.goal.clear", z$1.ZodObject<{
        bridgeLaunch: z$1.ZodObject<{
            capabilities: z$1.ZodObject<{
                fork: z$1.ZodEnum<{
                    checkpoint: "checkpoint";
                    none: "none";
                    tip: "tip";
                }>;
                permissionModes: z$1.ZodArray<z$1.ZodEnum<{
                    "accept-edits": "accept-edits";
                    auto: "auto";
                    full: "full";
                }>>;
                providerInstallation: z$1.ZodBoolean;
                supportsServiceTier: z$1.ZodBoolean;
                supportsThreadArchive: z$1.ZodBoolean;
                supportsThreadRename: z$1.ZodBoolean;
            }, z$1.core.$strict>;
            envPassthrough: z$1.ZodArray<z$1.ZodString>;
            pluginId: z$1.ZodString;
            providerOptions: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
            source: z$1.ZodObject<{
                byteLength: z$1.ZodNumber;
                digest: z$1.ZodString;
                kind: z$1.ZodLiteral<"artifact">;
            }, z$1.core.$strict>;
        }, z$1.core.$strict>;
        environmentId: z$1.ZodString;
        options: z$1.ZodIntersection<z$1.ZodObject<{
            model: z$1.ZodString;
            promptMode: z$1.ZodOptional<z$1.ZodLiteral<"plan">>;
            providerOptions: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
            reasoningLevel: z$1.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                none: "none";
                ultra: "ultra";
                ultracode: "ultracode";
                xhigh: "xhigh";
            }>;
            serviceTier: z$1.ZodEnum<{
                default: "default";
                fast: "fast";
            }>;
        }, z$1.core.$strip>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            approvalReviewer: z$1.ZodLiteral<"user">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
            permissionMode: z$1.ZodLiteral<"accept-edits">;
            permissionScope: z$1.ZodLiteral<"workspace">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            approvalReviewer: z$1.ZodLiteral<"automatic">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
            permissionMode: z$1.ZodLiteral<"auto">;
            permissionScope: z$1.ZodLiteral<"workspace">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            approvalReviewer: z$1.ZodNull;
            permissionEscalation: z$1.ZodNull;
            permissionMode: z$1.ZodLiteral<"full">;
            permissionScope: z$1.ZodLiteral<"full">;
        }, z$1.core.$strip>], "permissionMode">>;
        resumeContext: z$1.ZodObject<{
            bridgeLaunch: z$1.ZodObject<{
                capabilities: z$1.ZodObject<{
                    fork: z$1.ZodEnum<{
                        checkpoint: "checkpoint";
                        none: "none";
                        tip: "tip";
                    }>;
                    permissionModes: z$1.ZodArray<z$1.ZodEnum<{
                        "accept-edits": "accept-edits";
                        auto: "auto";
                        full: "full";
                    }>>;
                    providerInstallation: z$1.ZodBoolean;
                    supportsServiceTier: z$1.ZodBoolean;
                    supportsThreadArchive: z$1.ZodBoolean;
                    supportsThreadRename: z$1.ZodBoolean;
                }, z$1.core.$strict>;
                envPassthrough: z$1.ZodArray<z$1.ZodString>;
                pluginId: z$1.ZodString;
                providerOptions: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
                source: z$1.ZodObject<{
                    byteLength: z$1.ZodNumber;
                    digest: z$1.ZodString;
                    kind: z$1.ZodLiteral<"artifact">;
                }, z$1.core.$strict>;
            }, z$1.core.$strict>;
            contributedEnv: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
                name: z$1.ZodString;
                reason: z$1.ZodString;
                secret: z$1.ZodBoolean;
                source: z$1.ZodObject<{
                    plugin: z$1.ZodString;
                }, z$1.core.$strict>;
                value: z$1.ZodUnion<readonly [z$1.ZodString, z$1.ZodObject<{
                    serverPath: z$1.ZodString;
                }, z$1.core.$strict>]>;
            }, z$1.core.$strict>>>;
            disallowedTools: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
            dynamicTools: z$1.ZodArray<z$1.ZodObject<{
                description: z$1.ZodString;
                inputSchema: z$1.ZodUnknown;
                name: z$1.ZodString;
                presentation: z$1.ZodOptional<z$1.ZodObject<{
                    badge: z$1.ZodOptional<z$1.ZodObject<{
                        glyph: z$1.ZodString;
                        hint: z$1.ZodString;
                        label: z$1.ZodString;
                        tone: z$1.ZodEnum<{
                            destructive: "destructive";
                            neutral: "neutral";
                        }>;
                    }, z$1.core.$strip>>;
                    detail: z$1.ZodOptional<z$1.ZodString>;
                    icon: z$1.ZodObject<{
                        glyph: z$1.ZodString;
                    }, z$1.core.$strip>;
                    label: z$1.ZodObject<{
                        completed: z$1.ZodString;
                        pending: z$1.ZodString;
                    }, z$1.core.$strip>;
                    suppress: z$1.ZodOptional<z$1.ZodBoolean>;
                    tint: z$1.ZodOptional<z$1.ZodObject<{
                        dark: z$1.ZodString;
                        light: z$1.ZodString;
                    }, z$1.core.$strip>>;
                    title: z$1.ZodOptional<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strip>>;
            injectedSkillSources: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                description: z$1.ZodString;
                entryPath: z$1.ZodString;
                kind: z$1.ZodLiteral<"tree">;
                name: z$1.ZodString;
                sourceType: z$1.ZodEnum<{
                    "data-dir": "data-dir";
                    builtin: "builtin";
                }>;
                treeHash: z$1.ZodString;
            }, z$1.core.$strict>, z$1.ZodObject<{
                description: z$1.ZodString;
                kind: z$1.ZodLiteral<"workspace-path">;
                name: z$1.ZodString;
                skillFilePath: z$1.ZodString;
                sourceRootPath: z$1.ZodString;
                sourceType: z$1.ZodLiteral<"project">;
            }, z$1.core.$strict>, z$1.ZodObject<{
                description: z$1.ZodString;
                kind: z$1.ZodLiteral<"host-path">;
                name: z$1.ZodString;
                skillFilePath: z$1.ZodString;
                sourceRootPath: z$1.ZodString;
                sourceType: z$1.ZodEnum<{
                    "shared-project": "shared-project";
                    "shared-user": "shared-user";
                }>;
            }, z$1.core.$strict>], "kind">>;
            instructionMode: z$1.ZodEnum<{
                append: "append";
                replace: "replace";
            }>;
            instructions: z$1.ZodString;
            projectId: z$1.ZodString;
            providerId: z$1.ZodString;
            providerThreadId: z$1.ZodString;
            workspaceContext: z$1.ZodObject<{
                workspacePath: z$1.ZodString;
                workspaceProvisionType: z$1.ZodEnum<{
                    "managed-worktree": "managed-worktree";
                    personal: "personal";
                    unmanaged: "unmanaged";
                }>;
            }, z$1.core.$strip>;
        }, z$1.core.$strict>;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"thread.goal.clear">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        cleared: z$1.ZodBoolean;
    }, z$1.core.$strict>, "settled", false>;
    "thread.plan.cancel": HostDaemonCommandDescriptor<"thread.plan.cancel", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        expectedTurnId: z$1.ZodString;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"thread.plan.cancel">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        cancelled: z$1.ZodBoolean;
    }, z$1.core.$strict>, "settled", false>;
    "thread.rename": HostDaemonCommandDescriptor<"thread.rename", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        threadId: z$1.ZodString;
        title: z$1.ZodString;
        type: z$1.ZodLiteral<"thread.rename">;
    }, z$1.core.$strict>, z$1.ZodObject<{}, z$1.core.$strip>, "settled", false>;
    "thread.archive": HostDaemonCommandDescriptor<"thread.archive", z$1.ZodObject<{
        bridgeLaunch: z$1.ZodObject<{
            capabilities: z$1.ZodObject<{
                fork: z$1.ZodEnum<{
                    checkpoint: "checkpoint";
                    none: "none";
                    tip: "tip";
                }>;
                permissionModes: z$1.ZodArray<z$1.ZodEnum<{
                    "accept-edits": "accept-edits";
                    auto: "auto";
                    full: "full";
                }>>;
                providerInstallation: z$1.ZodBoolean;
                supportsServiceTier: z$1.ZodBoolean;
                supportsThreadArchive: z$1.ZodBoolean;
                supportsThreadRename: z$1.ZodBoolean;
            }, z$1.core.$strict>;
            envPassthrough: z$1.ZodArray<z$1.ZodString>;
            pluginId: z$1.ZodString;
            providerOptions: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
            source: z$1.ZodObject<{
                byteLength: z$1.ZodNumber;
                digest: z$1.ZodString;
                kind: z$1.ZodLiteral<"artifact">;
            }, z$1.core.$strict>;
        }, z$1.core.$strict>;
        environmentId: z$1.ZodString;
        providerId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"thread.archive">;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                "managed-worktree": "managed-worktree";
                personal: "personal";
                unmanaged: "unmanaged";
            }>;
        }, z$1.core.$strip>;
    }, z$1.core.$strict>, z$1.ZodObject<{}, z$1.core.$strip>, "settled", false>;
    "thread.unarchive": HostDaemonCommandDescriptor<"thread.unarchive", z$1.ZodObject<{
        bridgeLaunch: z$1.ZodObject<{
            capabilities: z$1.ZodObject<{
                fork: z$1.ZodEnum<{
                    checkpoint: "checkpoint";
                    none: "none";
                    tip: "tip";
                }>;
                permissionModes: z$1.ZodArray<z$1.ZodEnum<{
                    "accept-edits": "accept-edits";
                    auto: "auto";
                    full: "full";
                }>>;
                providerInstallation: z$1.ZodBoolean;
                supportsServiceTier: z$1.ZodBoolean;
                supportsThreadArchive: z$1.ZodBoolean;
                supportsThreadRename: z$1.ZodBoolean;
            }, z$1.core.$strict>;
            envPassthrough: z$1.ZodArray<z$1.ZodString>;
            pluginId: z$1.ZodString;
            providerOptions: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
            source: z$1.ZodObject<{
                byteLength: z$1.ZodNumber;
                digest: z$1.ZodString;
                kind: z$1.ZodLiteral<"artifact">;
            }, z$1.core.$strict>;
        }, z$1.core.$strict>;
        environmentId: z$1.ZodString;
        providerId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"thread.unarchive">;
    }, z$1.core.$strict>, z$1.ZodObject<{}, z$1.core.$strip>, "settled", false>;
    "interactive.resolve": HostDaemonCommandDescriptor<"interactive.resolve", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        interactionId: z$1.ZodString;
        providerId: z$1.ZodString;
        providerRequestId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
        resolution: z$1.ZodUnion<readonly [z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            decision: z$1.ZodLiteral<"allow_once">;
            grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            decision: z$1.ZodLiteral<"allow_for_session">;
            grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            decision: z$1.ZodLiteral<"deny">;
        }, z$1.core.$strip>], "decision">, z$1.ZodObject<{
            answers: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
                freeText: z$1.ZodOptional<z$1.ZodString>;
                selected: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
            kind: z$1.ZodLiteral<"user_answer">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"plugin_submitted">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"request_answer">;
            value: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
        }, z$1.core.$strip>]>;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"interactive.resolve">;
    }, z$1.core.$strict>, z$1.ZodObject<{}, z$1.core.$strip>, "settled", false>;
    "environment.provision": HostDaemonCommandDescriptor<"environment.provision", z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        checkout: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"existing">;
            name: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            baseBranch: z$1.ZodString;
            kind: z$1.ZodLiteral<"new">;
            name: z$1.ZodString;
        }, z$1.core.$strict>], "kind">>;
        environmentId: z$1.ZodString;
        initiator: z$1.ZodNullable<z$1.ZodObject<{
            provisioningId: z$1.ZodString;
            threadId: z$1.ZodString;
        }, z$1.core.$strict>>;
        path: z$1.ZodString;
        type: z$1.ZodLiteral<"environment.provision">;
        workspaceProvisionType: z$1.ZodLiteral<"unmanaged">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        baseBranch: z$1.ZodNullable<z$1.ZodString>;
        branchName: z$1.ZodString;
        environmentId: z$1.ZodString;
        initiator: z$1.ZodNullable<z$1.ZodObject<{
            provisioningId: z$1.ZodString;
            threadId: z$1.ZodString;
        }, z$1.core.$strict>>;
        setupTimeoutMs: z$1.ZodNumber;
        sourcePath: z$1.ZodString;
        targetPath: z$1.ZodString;
        type: z$1.ZodLiteral<"environment.provision">;
        workspaceProvisionType: z$1.ZodLiteral<"managed-worktree">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodString;
        initiator: z$1.ZodNullable<z$1.ZodObject<{
            provisioningId: z$1.ZodString;
            threadId: z$1.ZodString;
        }, z$1.core.$strict>>;
        targetPath: z$1.ZodString;
        type: z$1.ZodLiteral<"environment.provision">;
        workspaceProvisionType: z$1.ZodLiteral<"personal">;
    }, z$1.core.$strict>], "workspaceProvisionType">, z$1.ZodObject<{
        branchName: z$1.ZodNullable<z$1.ZodString>;
        defaultBranch: z$1.ZodNullable<z$1.ZodString>;
        isGitRepo: z$1.ZodBoolean;
        isWorktree: z$1.ZodBoolean;
        path: z$1.ZodString;
        transcript: z$1.ZodArray<z$1.ZodObject<{
            key: z$1.ZodString;
            metadata: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>>;
            startedAt: z$1.ZodOptional<z$1.ZodNumber>;
            status: z$1.ZodOptional<z$1.ZodEnum<{
                completed: "completed";
                failed: "failed";
                started: "started";
            }>>;
            text: z$1.ZodString;
            type: z$1.ZodEnum<{
                output: "output";
                step: "step";
            }>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, "settled", false>;
    "project.clone": HostDaemonCommandDescriptor<"project.clone", z$1.ZodObject<{
        projectSlug: z$1.ZodString;
        remoteUrl: z$1.ZodString;
        targetPath: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"project.clone">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        gitRemoteUrl: z$1.ZodNullable<z$1.ZodString>;
        path: z$1.ZodString;
    }, z$1.core.$strict>, "settled", false>;
    "environment.provision.cancel": HostDaemonCommandDescriptor<"environment.provision.cancel", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        type: z$1.ZodLiteral<"environment.provision.cancel">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        aborted: z$1.ZodBoolean;
    }, z$1.core.$strip>, "settled", false>;
    "environment.destroy": HostDaemonCommandDescriptor<"environment.destroy", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        teardownTimeoutMs: z$1.ZodNumber;
        type: z$1.ZodLiteral<"environment.destroy">;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                "managed-worktree": "managed-worktree";
                personal: "personal";
                unmanaged: "unmanaged";
            }>;
        }, z$1.core.$strip>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        transcript: z$1.ZodArray<z$1.ZodObject<{
            key: z$1.ZodString;
            metadata: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>>;
            startedAt: z$1.ZodOptional<z$1.ZodNumber>;
            status: z$1.ZodOptional<z$1.ZodEnum<{
                completed: "completed";
                failed: "failed";
                started: "started";
            }>>;
            text: z$1.ZodString;
            type: z$1.ZodEnum<{
                output: "output";
                step: "step";
            }>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strict>, "settled", false>;
    "workspace.commit": HostDaemonCommandDescriptor<"workspace.commit", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        message: z$1.ZodString;
        type: z$1.ZodLiteral<"workspace.commit">;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                "managed-worktree": "managed-worktree";
                personal: "personal";
                unmanaged: "unmanaged";
            }>;
        }, z$1.core.$strip>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        commitSha: z$1.ZodString;
        commitSubject: z$1.ZodString;
    }, z$1.core.$strip>, "settled", false>;
    "workspace.pull_request_action": HostDaemonCommandDescriptor<"workspace.pull_request_action", z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        environmentId: z$1.ZodString;
        operation: z$1.ZodLiteral<"ready">;
        type: z$1.ZodLiteral<"workspace.pull_request_action">;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                "managed-worktree": "managed-worktree";
                personal: "personal";
                unmanaged: "unmanaged";
            }>;
        }, z$1.core.$strip>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodString;
        operation: z$1.ZodLiteral<"draft">;
        type: z$1.ZodLiteral<"workspace.pull_request_action">;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                "managed-worktree": "managed-worktree";
                personal: "personal";
                unmanaged: "unmanaged";
            }>;
        }, z$1.core.$strip>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodString;
        method: z$1.ZodEnum<{
            merge: "merge";
            rebase: "rebase";
            squash: "squash";
        }>;
        operation: z$1.ZodLiteral<"merge">;
        type: z$1.ZodLiteral<"workspace.pull_request_action">;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                "managed-worktree": "managed-worktree";
                personal: "personal";
                unmanaged: "unmanaged";
            }>;
        }, z$1.core.$strip>;
    }, z$1.core.$strict>], "operation">, z$1.ZodObject<{}, z$1.core.$strict>, "settled", false>;
    "host.list_files": HostDaemonCommandDescriptor<"host.list_files", z$1.ZodObject<{
        limit: z$1.ZodNumber;
        path: z$1.ZodString;
        query: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"host.list_files">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        files: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            path: z$1.ZodString;
        }, z$1.core.$strip>>;
        truncated: z$1.ZodBoolean;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.list_paths": HostDaemonCommandDescriptor<"host.list_paths", z$1.ZodObject<{
        includeDirectories: z$1.ZodBoolean;
        includeFiles: z$1.ZodBoolean;
        limit: z$1.ZodNumber;
        path: z$1.ZodString;
        query: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"host.list_paths">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        paths: z$1.ZodArray<z$1.ZodObject<{
            kind: z$1.ZodEnum<{
                directory: "directory";
                file: "file";
            }>;
            name: z$1.ZodString;
            path: z$1.ZodString;
            positions: z$1.ZodArray<z$1.ZodNumber>;
            score: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        truncated: z$1.ZodBoolean;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.mkdir": HostDaemonCommandDescriptor<"host.mkdir", z$1.ZodObject<{
        path: z$1.ZodString;
        recursive: z$1.ZodBoolean;
        rootPath: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"host.mkdir">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        ok: z$1.ZodLiteral<true>;
    }, z$1.core.$strict>, "onlineRpc", false>;
    "host.move_path": HostDaemonCommandDescriptor<"host.move_path", z$1.ZodObject<{
        destinationPath: z$1.ZodString;
        rootPath: z$1.ZodOptional<z$1.ZodString>;
        sourcePath: z$1.ZodString;
        type: z$1.ZodLiteral<"host.move_path">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        ok: z$1.ZodLiteral<true>;
    }, z$1.core.$strict>, "onlineRpc", false>;
    "host.remove_path": HostDaemonCommandDescriptor<"host.remove_path", z$1.ZodObject<{
        path: z$1.ZodString;
        recursive: z$1.ZodBoolean;
        rootPath: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"host.remove_path">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        ok: z$1.ZodLiteral<true>;
    }, z$1.core.$strict>, "onlineRpc", false>;
    "host.browse_directory": HostDaemonCommandDescriptor<"host.browse_directory", z$1.ZodObject<{
        path: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"host.browse_directory">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        directory: z$1.ZodString;
        entries: z$1.ZodArray<z$1.ZodObject<{
            kind: z$1.ZodEnum<{
                directory: "directory";
                file: "file";
            }>;
            name: z$1.ZodString;
            path: z$1.ZodString;
        }, z$1.core.$strip>>;
        parent: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.paths_exist": HostDaemonCommandDescriptor<"host.paths_exist", z$1.ZodObject<{
        paths: z$1.ZodPipe<z$1.ZodArray<z$1.ZodString>, z$1.ZodTransform<string[], string[]>>;
        type: z$1.ZodLiteral<"host.paths_exist">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        existence: z$1.ZodRecord<z$1.ZodString, z$1.ZodBoolean>;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "project.inspect": HostDaemonCommandDescriptor<"project.inspect", z$1.ZodObject<{
        path: z$1.ZodString;
        type: z$1.ZodLiteral<"project.inspect">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        gitRemoteUrl: z$1.ZodNullable<z$1.ZodString>;
        path: z$1.ZodString;
    }, z$1.core.$strict>, "onlineRpc", true>;
    "project.clone_default_path": HostDaemonCommandDescriptor<"project.clone_default_path", z$1.ZodObject<{
        projectSlug: z$1.ZodString;
        type: z$1.ZodLiteral<"project.clone_default_path">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        path: z$1.ZodString;
    }, z$1.core.$strict>, "onlineRpc", true>;
    "host.pick_folder": HostDaemonCommandDescriptor<"host.pick_folder", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.pick_folder">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        path: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, "onlineRpc", false>;
    "plugin.host.call": HostDaemonCommandDescriptor<"plugin.host.call", z$1.ZodObject<{
        artifact: z$1.ZodObject<{
            byteLength: z$1.ZodNumber;
            digest: z$1.ZodString;
        }, z$1.core.$strict>;
        callId: z$1.ZodString;
        generation: z$1.ZodString;
        input: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
        method: z$1.ZodString;
        pluginId: z$1.ZodString;
        timeoutMs: z$1.ZodNumber;
        type: z$1.ZodLiteral<"plugin.host.call">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        output: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
    }, z$1.core.$strict>, "onlineRpc", false>;
    "plugin.host.cancel": HostDaemonCommandDescriptor<"plugin.host.cancel", z$1.ZodObject<{
        callId: z$1.ZodString;
        generation: z$1.ZodString;
        pluginId: z$1.ZodString;
        type: z$1.ZodLiteral<"plugin.host.cancel">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        cancelled: z$1.ZodBoolean;
    }, z$1.core.$strict>, "onlineRpc", true>;
    "plugin.host.dispose": HostDaemonCommandDescriptor<"plugin.host.dispose", z$1.ZodObject<{
        generation: z$1.ZodString;
        pluginId: z$1.ZodString;
        type: z$1.ZodLiteral<"plugin.host.dispose">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        disposed: z$1.ZodBoolean;
    }, z$1.core.$strict>, "onlineRpc", true>;
    "connect-tunnel.ensure-identity": HostDaemonCommandDescriptor<"connect-tunnel.ensure-identity", z$1.ZodObject<{
        type: z$1.ZodLiteral<"connect-tunnel.ensure-identity">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        baseDomain: z$1.ZodString;
        label: z$1.ZodString;
    }, z$1.core.$strict>, "onlineRpc", true>;
    "host.list_commands": HostDaemonCommandDescriptor<"host.list_commands", z$1.ZodObject<{
        cwd: z$1.ZodNullable<z$1.ZodString>;
        nativeRoots: z$1.ZodObject<{
            commands: z$1.ZodObject<{
                project: z$1.ZodArray<z$1.ZodObject<{
                    ancestors: z$1.ZodBoolean;
                    namePrefix: z$1.ZodString;
                    path: z$1.ZodString;
                    recursive: z$1.ZodBoolean;
                    skipIfManifest: z$1.ZodOptional<z$1.ZodString>;
                }, z$1.core.$strict>>;
                user: z$1.ZodArray<z$1.ZodObject<{
                    ancestors: z$1.ZodBoolean;
                    namePrefix: z$1.ZodString;
                    path: z$1.ZodString;
                    recursive: z$1.ZodBoolean;
                    skipIfManifest: z$1.ZodOptional<z$1.ZodString>;
                }, z$1.core.$strict>>;
            }, z$1.core.$strict>;
            resolved: z$1.ZodObject<{
                commands: z$1.ZodArray<z$1.ZodObject<{
                    ancestors: z$1.ZodBoolean;
                    fallbackName: z$1.ZodOptional<z$1.ZodString>;
                    namePrefix: z$1.ZodString;
                    origin: z$1.ZodEnum<{
                        project: "project";
                        user: "user";
                    }>;
                    path: z$1.ZodString;
                    recursive: z$1.ZodBoolean;
                    shape: z$1.ZodEnum<{
                        "command-file": "command-file";
                        "skill-file": "skill-file";
                        commands: "commands";
                        skill: "skill";
                        skills: "skills";
                    }>;
                    skipIfManifest: z$1.ZodOptional<z$1.ZodString>;
                }, z$1.core.$strict>>;
                skills: z$1.ZodArray<z$1.ZodObject<{
                    ancestors: z$1.ZodBoolean;
                    fallbackName: z$1.ZodOptional<z$1.ZodString>;
                    namePrefix: z$1.ZodString;
                    origin: z$1.ZodEnum<{
                        project: "project";
                        user: "user";
                    }>;
                    path: z$1.ZodString;
                    recursive: z$1.ZodBoolean;
                    shape: z$1.ZodEnum<{
                        "command-file": "command-file";
                        "skill-file": "skill-file";
                        commands: "commands";
                        skill: "skill";
                        skills: "skills";
                    }>;
                    skipIfManifest: z$1.ZodOptional<z$1.ZodString>;
                }, z$1.core.$strict>>;
            }, z$1.core.$strict>;
            skills: z$1.ZodObject<{
                project: z$1.ZodArray<z$1.ZodObject<{
                    ancestors: z$1.ZodBoolean;
                    namePrefix: z$1.ZodString;
                    path: z$1.ZodString;
                    recursive: z$1.ZodBoolean;
                    skipIfManifest: z$1.ZodOptional<z$1.ZodString>;
                }, z$1.core.$strict>>;
                user: z$1.ZodArray<z$1.ZodObject<{
                    ancestors: z$1.ZodBoolean;
                    namePrefix: z$1.ZodString;
                    path: z$1.ZodString;
                    recursive: z$1.ZodBoolean;
                    skipIfManifest: z$1.ZodOptional<z$1.ZodString>;
                }, z$1.core.$strict>>;
            }, z$1.core.$strict>;
        }, z$1.core.$strict>;
        providerId: z$1.ZodString;
        type: z$1.ZodLiteral<"host.list_commands">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        commands: z$1.ZodArray<z$1.ZodObject<{
            argumentHint: z$1.ZodNullable<z$1.ZodString>;
            description: z$1.ZodNullable<z$1.ZodString>;
            name: z$1.ZodString;
            origin: z$1.ZodEnum<{
                project: "project";
                user: "user";
            }>;
            source: z$1.ZodEnum<{
                command: "command";
                skill: "skill";
            }>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.list_skills": HostDaemonCommandDescriptor<"host.list_skills", z$1.ZodObject<{
        cwd: z$1.ZodNullable<z$1.ZodString>;
        nativeRoots: z$1.ZodObject<{
            commands: z$1.ZodObject<{
                project: z$1.ZodArray<z$1.ZodObject<{
                    ancestors: z$1.ZodBoolean;
                    namePrefix: z$1.ZodString;
                    path: z$1.ZodString;
                    recursive: z$1.ZodBoolean;
                    skipIfManifest: z$1.ZodOptional<z$1.ZodString>;
                }, z$1.core.$strict>>;
                user: z$1.ZodArray<z$1.ZodObject<{
                    ancestors: z$1.ZodBoolean;
                    namePrefix: z$1.ZodString;
                    path: z$1.ZodString;
                    recursive: z$1.ZodBoolean;
                    skipIfManifest: z$1.ZodOptional<z$1.ZodString>;
                }, z$1.core.$strict>>;
            }, z$1.core.$strict>;
            resolved: z$1.ZodObject<{
                commands: z$1.ZodArray<z$1.ZodObject<{
                    ancestors: z$1.ZodBoolean;
                    fallbackName: z$1.ZodOptional<z$1.ZodString>;
                    namePrefix: z$1.ZodString;
                    origin: z$1.ZodEnum<{
                        project: "project";
                        user: "user";
                    }>;
                    path: z$1.ZodString;
                    recursive: z$1.ZodBoolean;
                    shape: z$1.ZodEnum<{
                        "command-file": "command-file";
                        "skill-file": "skill-file";
                        commands: "commands";
                        skill: "skill";
                        skills: "skills";
                    }>;
                    skipIfManifest: z$1.ZodOptional<z$1.ZodString>;
                }, z$1.core.$strict>>;
                skills: z$1.ZodArray<z$1.ZodObject<{
                    ancestors: z$1.ZodBoolean;
                    fallbackName: z$1.ZodOptional<z$1.ZodString>;
                    namePrefix: z$1.ZodString;
                    origin: z$1.ZodEnum<{
                        project: "project";
                        user: "user";
                    }>;
                    path: z$1.ZodString;
                    recursive: z$1.ZodBoolean;
                    shape: z$1.ZodEnum<{
                        "command-file": "command-file";
                        "skill-file": "skill-file";
                        commands: "commands";
                        skill: "skill";
                        skills: "skills";
                    }>;
                    skipIfManifest: z$1.ZodOptional<z$1.ZodString>;
                }, z$1.core.$strict>>;
            }, z$1.core.$strict>;
            skills: z$1.ZodObject<{
                project: z$1.ZodArray<z$1.ZodObject<{
                    ancestors: z$1.ZodBoolean;
                    namePrefix: z$1.ZodString;
                    path: z$1.ZodString;
                    recursive: z$1.ZodBoolean;
                    skipIfManifest: z$1.ZodOptional<z$1.ZodString>;
                }, z$1.core.$strict>>;
                user: z$1.ZodArray<z$1.ZodObject<{
                    ancestors: z$1.ZodBoolean;
                    namePrefix: z$1.ZodString;
                    path: z$1.ZodString;
                    recursive: z$1.ZodBoolean;
                    skipIfManifest: z$1.ZodOptional<z$1.ZodString>;
                }, z$1.core.$strict>>;
            }, z$1.core.$strict>;
        }, z$1.core.$strict>;
        providerId: z$1.ZodString;
        type: z$1.ZodLiteral<"host.list_skills">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        skills: z$1.ZodArray<z$1.ZodObject<{
            description: z$1.ZodNullable<z$1.ZodString>;
            filePath: z$1.ZodString;
            id: z$1.ZodString;
            linked: z$1.ZodBoolean;
            name: z$1.ZodString;
            rootKind: z$1.ZodEnum<{
                "bb-builtin": "bb-builtin";
                "bb-data-dir": "bb-data-dir";
                "bb-project": "bb-project";
                "provider-project": "provider-project";
                "provider-user": "provider-user";
                "shared-project": "shared-project";
                "shared-user": "shared-user";
                plugin: "plugin";
            }>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.delete_skill": HostDaemonCommandDescriptor<"host.delete_skill", z$1.ZodObject<{
        cwd: z$1.ZodNullable<z$1.ZodString>;
        name: z$1.ZodString;
        rootPath: z$1.ZodNullable<z$1.ZodString>;
        scope: z$1.ZodEnum<{
            "bb-project": "bb-project";
            "bb-user": "bb-user";
            "provider-project": "provider-project";
            "provider-user": "provider-user";
        }>;
        type: z$1.ZodLiteral<"host.delete_skill">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        deletedPath: z$1.ZodString;
    }, z$1.core.$strip>, "onlineRpc", false>;
    "host.write_skill": HostDaemonCommandDescriptor<"host.write_skill", z$1.ZodObject<{
        content: z$1.ZodString;
        cwd: z$1.ZodNullable<z$1.ZodString>;
        expectedSha256: z$1.ZodString;
        name: z$1.ZodString;
        scope: z$1.ZodEnum<{
            "bb-project": "bb-project";
            "bb-user": "bb-user";
        }>;
        type: z$1.ZodLiteral<"host.write_skill">;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        filePath: z$1.ZodString;
        outcome: z$1.ZodLiteral<"written">;
        sha256: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        currentSha256: z$1.ZodNullable<z$1.ZodString>;
        outcome: z$1.ZodLiteral<"conflict">;
    }, z$1.core.$strip>], "outcome">, "onlineRpc", false>;
    "host.install_global_skills": HostDaemonCommandDescriptor<"host.install_global_skills", z$1.ZodObject<{
        skills: z$1.ZodArray<z$1.ZodObject<{
            entryPath: z$1.ZodString;
            name: z$1.ZodString;
            treeHash: z$1.ZodString;
        }, z$1.core.$strict>>;
        type: z$1.ZodLiteral<"host.install_global_skills">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        installations: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            path: z$1.ZodString;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>, "onlineRpc", false>;
    "host.global_skills_status": HostDaemonCommandDescriptor<"host.global_skills_status", z$1.ZodObject<{
        names: z$1.ZodArray<z$1.ZodString>;
        type: z$1.ZodLiteral<"host.global_skills_status">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        entries: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            path: z$1.ZodString;
            treeHash: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>, "onlineRpc", true>;
    "host.inspect_git_source": HostDaemonCommandDescriptor<"host.inspect_git_source", z$1.ZodObject<{
        path: z$1.ZodString;
        remoteRefresh: z$1.ZodEnum<{
            background: "background";
            blocking: "blocking";
        }>;
        type: z$1.ZodLiteral<"host.inspect_git_source">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        checkout: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            branchName: z$1.ZodString;
            headSha: z$1.ZodNullable<z$1.ZodString>;
            kind: z$1.ZodLiteral<"branch">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            headSha: z$1.ZodNullable<z$1.ZodString>;
            kind: z$1.ZodLiteral<"detached">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            branchName: z$1.ZodNullable<z$1.ZodString>;
            kind: z$1.ZodLiteral<"unborn">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"unknown">;
            reason: z$1.ZodString;
        }, z$1.core.$strip>], "kind">;
        defaultBranch: z$1.ZodNullable<z$1.ZodString>;
        defaultBranchRelation: z$1.ZodNullable<z$1.ZodEnum<{
            "local-ahead": "local-ahead";
            "local-behind": "local-behind";
            diverged: "diverged";
            equal: "equal";
            unknown: "unknown";
        }>>;
        hasUncommittedChanges: z$1.ZodBoolean;
        operation: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"none">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            hasConflicts: z$1.ZodBoolean;
            kind: z$1.ZodLiteral<"merge">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            hasConflicts: z$1.ZodBoolean;
            kind: z$1.ZodLiteral<"rebase">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            hasConflicts: z$1.ZodBoolean;
            kind: z$1.ZodLiteral<"cherry-pick">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            hasConflicts: z$1.ZodBoolean;
            kind: z$1.ZodLiteral<"revert">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            hasConflicts: z$1.ZodBoolean;
            kind: z$1.ZodLiteral<"unknown">;
            reason: z$1.ZodString;
        }, z$1.core.$strip>], "kind">;
        originDefaultBranch: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.list_branch_options": HostDaemonCommandDescriptor<"host.list_branch_options", z$1.ZodObject<{
        limit: z$1.ZodNumber;
        path: z$1.ZodString;
        query: z$1.ZodOptional<z$1.ZodString>;
        remoteRefresh: z$1.ZodEnum<{
            background: "background";
            none: "none";
        }>;
        selectedBranch: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"host.list_branch_options">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        branches: z$1.ZodArray<z$1.ZodString>;
        branchesTruncated: z$1.ZodBoolean;
        remoteBranches: z$1.ZodArray<z$1.ZodString>;
        remoteBranchesTruncated: z$1.ZodBoolean;
        selectedBranch: z$1.ZodNullable<z$1.ZodObject<{
            kind: z$1.ZodEnum<{
                local: "local";
                missing: "missing";
                remote: "remote";
            }>;
            name: z$1.ZodString;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.file_metadata": HostDaemonCommandDescriptor<"host.file_metadata", z$1.ZodObject<{
        path: z$1.ZodString;
        rootPath: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"host.file_metadata">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        modifiedAtMs: z$1.ZodNumber;
        path: z$1.ZodString;
        sizeBytes: z$1.ZodNumber;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.read_file": HostDaemonCommandDescriptor<"host.read_file", z$1.ZodObject<{
        path: z$1.ZodString;
        ref: z$1.ZodOptional<z$1.ZodString>;
        rootPath: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"host.read_file">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        content: z$1.ZodString;
        contentEncoding: z$1.ZodEnum<{
            base64: "base64";
            utf8: "utf8";
        }>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
        modifiedAtMs: z$1.ZodOptional<z$1.ZodNumber>;
        path: z$1.ZodString;
        sha256: z$1.ZodString;
        sizeBytes: z$1.ZodNumber;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.read_file_relative": HostDaemonCommandDescriptor<"host.read_file_relative", z$1.ZodObject<{
        dotfiles: z$1.ZodEnum<{
            allow: "allow";
            deny: "deny";
        }>;
        path: z$1.ZodString;
        rootPath: z$1.ZodString;
        type: z$1.ZodLiteral<"host.read_file_relative">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        content: z$1.ZodString;
        contentEncoding: z$1.ZodEnum<{
            base64: "base64";
            utf8: "utf8";
        }>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
        modifiedAtMs: z$1.ZodOptional<z$1.ZodNumber>;
        path: z$1.ZodString;
        sha256: z$1.ZodString;
        sizeBytes: z$1.ZodNumber;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.write_file": HostDaemonCommandDescriptor<"host.write_file", z$1.ZodObject<{
        content: z$1.ZodString;
        contentEncoding: z$1.ZodEnum<{
            base64: "base64";
            utf8: "utf8";
        }>;
        createParents: z$1.ZodBoolean;
        expectedSha256: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
        mode: z$1.ZodOptional<z$1.ZodNumber>;
        path: z$1.ZodString;
        rootPath: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"host.write_file">;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"written">;
        sha256: z$1.ZodString;
        sizeBytes: z$1.ZodNumber;
    }, z$1.core.$strict>, z$1.ZodObject<{
        currentSha256: z$1.ZodNullable<z$1.ZodString>;
        outcome: z$1.ZodLiteral<"conflict">;
    }, z$1.core.$strict>], "outcome">, "onlineRpc", false>;
    "provider.list_models": HostDaemonCommandDescriptor<"provider.list_models", z$1.ZodObject<{
        bridgeLaunch: z$1.ZodObject<{
            capabilities: z$1.ZodObject<{
                fork: z$1.ZodEnum<{
                    checkpoint: "checkpoint";
                    none: "none";
                    tip: "tip";
                }>;
                permissionModes: z$1.ZodArray<z$1.ZodEnum<{
                    "accept-edits": "accept-edits";
                    auto: "auto";
                    full: "full";
                }>>;
                providerInstallation: z$1.ZodBoolean;
                supportsServiceTier: z$1.ZodBoolean;
                supportsThreadArchive: z$1.ZodBoolean;
                supportsThreadRename: z$1.ZodBoolean;
            }, z$1.core.$strict>;
            envPassthrough: z$1.ZodArray<z$1.ZodString>;
            pluginId: z$1.ZodString;
            providerOptions: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
            source: z$1.ZodObject<{
                byteLength: z$1.ZodNumber;
                digest: z$1.ZodString;
                kind: z$1.ZodLiteral<"artifact">;
            }, z$1.core.$strict>;
        }, z$1.core.$strict>;
        cwd: z$1.ZodOptional<z$1.ZodString>;
        providerId: z$1.ZodString;
        type: z$1.ZodLiteral<"provider.list_models">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        models: z$1.ZodArray<z$1.ZodObject<{
            defaultReasoningEffort: z$1.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                none: "none";
                ultra: "ultra";
                ultracode: "ultracode";
                xhigh: "xhigh";
            }>;
            description: z$1.ZodString;
            displayName: z$1.ZodString;
            id: z$1.ZodString;
            isDefault: z$1.ZodBoolean;
            model: z$1.ZodString;
            routeProviderId: z$1.ZodOptional<z$1.ZodString>;
            supportedReasoningEfforts: z$1.ZodArray<z$1.ZodObject<{
                description: z$1.ZodString;
                reasoningEffort: z$1.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    none: "none";
                    ultra: "ultra";
                    ultracode: "ultracode";
                    xhigh: "xhigh";
                }>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        selectedOnlyModels: z$1.ZodArray<z$1.ZodObject<{
            defaultReasoningEffort: z$1.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                none: "none";
                ultra: "ultra";
                ultracode: "ultracode";
                xhigh: "xhigh";
            }>;
            description: z$1.ZodString;
            displayName: z$1.ZodString;
            id: z$1.ZodString;
            isDefault: z$1.ZodBoolean;
            model: z$1.ZodString;
            routeProviderId: z$1.ZodOptional<z$1.ZodString>;
            supportedReasoningEfforts: z$1.ZodArray<z$1.ZodObject<{
                description: z$1.ZodString;
                reasoningEffort: z$1.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    none: "none";
                    ultra: "ultra";
                    ultracode: "ultracode";
                    xhigh: "xhigh";
                }>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "provider.health": HostDaemonCommandDescriptor<"provider.health", z$1.ZodObject<{
        bridgeLaunch: z$1.ZodObject<{
            capabilities: z$1.ZodObject<{
                fork: z$1.ZodEnum<{
                    checkpoint: "checkpoint";
                    none: "none";
                    tip: "tip";
                }>;
                permissionModes: z$1.ZodArray<z$1.ZodEnum<{
                    "accept-edits": "accept-edits";
                    auto: "auto";
                    full: "full";
                }>>;
                providerInstallation: z$1.ZodBoolean;
                supportsServiceTier: z$1.ZodBoolean;
                supportsThreadArchive: z$1.ZodBoolean;
                supportsThreadRename: z$1.ZodBoolean;
            }, z$1.core.$strict>;
            envPassthrough: z$1.ZodArray<z$1.ZodString>;
            pluginId: z$1.ZodString;
            providerOptions: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
            source: z$1.ZodObject<{
                byteLength: z$1.ZodNumber;
                digest: z$1.ZodString;
                kind: z$1.ZodLiteral<"artifact">;
            }, z$1.core.$strict>;
        }, z$1.core.$strict>;
        cwd: z$1.ZodOptional<z$1.ZodString>;
        providerId: z$1.ZodString;
        type: z$1.ZodLiteral<"provider.health">;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        supported: z$1.ZodLiteral<false>;
    }, z$1.core.$loose>, z$1.ZodObject<{
        health: z$1.ZodObject<{
            accountEmail: z$1.ZodNullable<z$1.ZodString>;
            canInstall: z$1.ZodBoolean;
            canUpdate: z$1.ZodBoolean;
            installedVersion: z$1.ZodNullable<z$1.ZodString>;
            loginCommand: z$1.ZodNullable<z$1.ZodString>;
            minimumSupportedVersion: z$1.ZodNullable<z$1.ZodString>;
            planLabel: z$1.ZodNullable<z$1.ZodString>;
            status: z$1.ZodEnum<{
                expired: "expired";
                not_installed: "not_installed";
                ready: "ready";
                unauthenticated: "unauthenticated";
                unknown: "unknown";
                unsupported_version: "unsupported_version";
            }>;
            statusMessage: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$loose>;
        supported: z$1.ZodLiteral<true>;
    }, z$1.core.$loose>], "supported">, "onlineRpc", true>;
    "provider.installation.status": HostDaemonCommandDescriptor<"provider.installation.status", z$1.ZodObject<{
        bridgeLaunch: z$1.ZodObject<{
            capabilities: z$1.ZodObject<{
                fork: z$1.ZodEnum<{
                    checkpoint: "checkpoint";
                    none: "none";
                    tip: "tip";
                }>;
                permissionModes: z$1.ZodArray<z$1.ZodEnum<{
                    "accept-edits": "accept-edits";
                    auto: "auto";
                    full: "full";
                }>>;
                providerInstallation: z$1.ZodBoolean;
                supportsServiceTier: z$1.ZodBoolean;
                supportsThreadArchive: z$1.ZodBoolean;
                supportsThreadRename: z$1.ZodBoolean;
            }, z$1.core.$strict>;
            envPassthrough: z$1.ZodArray<z$1.ZodString>;
            pluginId: z$1.ZodString;
            providerOptions: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
            source: z$1.ZodObject<{
                byteLength: z$1.ZodNumber;
                digest: z$1.ZodString;
                kind: z$1.ZodLiteral<"artifact">;
            }, z$1.core.$strict>;
        }, z$1.core.$strict>;
        cwd: z$1.ZodOptional<z$1.ZodString>;
        providerId: z$1.ZodString;
        requirement: z$1.ZodOptional<z$1.ZodLiteral<"thread_rewind">>;
        type: z$1.ZodLiteral<"provider.installation.status">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        currentVersion: z$1.ZodNullable<z$1.ZodString>;
        executableName: z$1.ZodString;
        executablePath: z$1.ZodNullable<z$1.ZodString>;
        installAction: z$1.ZodNullable<z$1.ZodObject<{
            command: z$1.ZodString;
            kind: z$1.ZodEnum<{
                install: "install";
                update: "update";
            }>;
            label: z$1.ZodEnum<{
                Install: "Install";
                Update: "Update";
            }>;
        }, z$1.core.$loose>>;
        installSource: z$1.ZodEnum<{
            external: "external";
            notInstalled: "notInstalled";
            npmGlobal: "npmGlobal";
        }>;
        installed: z$1.ZodBoolean;
        latestVersion: z$1.ZodNullable<z$1.ZodString>;
        minimumSupportedVersion: z$1.ZodNullable<z$1.ZodString>;
        needsUpdate: z$1.ZodBoolean;
        npmGlobalPackageVersion: z$1.ZodNullable<z$1.ZodString>;
        npmPackageName: z$1.ZodNullable<z$1.ZodString>;
        versionUnsupported: z$1.ZodBoolean;
    }, z$1.core.$loose>, "onlineRpc", true>;
    "provider.installation.run": HostDaemonCommandDescriptor<"provider.installation.run", z$1.ZodObject<{
        action: z$1.ZodEnum<{
            install: "install";
            update: "update";
        }>;
        bridgeLaunch: z$1.ZodObject<{
            capabilities: z$1.ZodObject<{
                fork: z$1.ZodEnum<{
                    checkpoint: "checkpoint";
                    none: "none";
                    tip: "tip";
                }>;
                permissionModes: z$1.ZodArray<z$1.ZodEnum<{
                    "accept-edits": "accept-edits";
                    auto: "auto";
                    full: "full";
                }>>;
                providerInstallation: z$1.ZodBoolean;
                supportsServiceTier: z$1.ZodBoolean;
                supportsThreadArchive: z$1.ZodBoolean;
                supportsThreadRename: z$1.ZodBoolean;
            }, z$1.core.$strict>;
            envPassthrough: z$1.ZodArray<z$1.ZodString>;
            pluginId: z$1.ZodString;
            providerOptions: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
            source: z$1.ZodObject<{
                byteLength: z$1.ZodNumber;
                digest: z$1.ZodString;
                kind: z$1.ZodLiteral<"artifact">;
            }, z$1.core.$strict>;
        }, z$1.core.$strict>;
        cwd: z$1.ZodOptional<z$1.ZodString>;
        providerId: z$1.ZodString;
        type: z$1.ZodLiteral<"provider.installation.run">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        events: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            command: z$1.ZodString;
            provider: z$1.ZodString;
            type: z$1.ZodLiteral<"started">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            provider: z$1.ZodString;
            stream: z$1.ZodEnum<{
                stderr: "stderr";
                stdout: "stdout";
            }>;
            text: z$1.ZodString;
            type: z$1.ZodLiteral<"output">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            exitCode: z$1.ZodNullable<z$1.ZodNumber>;
            provider: z$1.ZodString;
            signal: z$1.ZodNullable<z$1.ZodString>;
            success: z$1.ZodBoolean;
            type: z$1.ZodLiteral<"completed">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            message: z$1.ZodString;
            provider: z$1.ZodString;
            type: z$1.ZodLiteral<"error">;
        }, z$1.core.$strip>], "type">>;
    }, z$1.core.$strict>, "onlineRpc", false>;
    "provider.usage": HostDaemonCommandDescriptor<"provider.usage", z$1.ZodObject<{
        bridgeLaunch: z$1.ZodObject<{
            capabilities: z$1.ZodObject<{
                fork: z$1.ZodEnum<{
                    checkpoint: "checkpoint";
                    none: "none";
                    tip: "tip";
                }>;
                permissionModes: z$1.ZodArray<z$1.ZodEnum<{
                    "accept-edits": "accept-edits";
                    auto: "auto";
                    full: "full";
                }>>;
                providerInstallation: z$1.ZodBoolean;
                supportsServiceTier: z$1.ZodBoolean;
                supportsThreadArchive: z$1.ZodBoolean;
                supportsThreadRename: z$1.ZodBoolean;
            }, z$1.core.$strict>;
            envPassthrough: z$1.ZodArray<z$1.ZodString>;
            pluginId: z$1.ZodString;
            providerOptions: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
            source: z$1.ZodObject<{
                byteLength: z$1.ZodNumber;
                digest: z$1.ZodString;
                kind: z$1.ZodLiteral<"artifact">;
            }, z$1.core.$strict>;
        }, z$1.core.$strict>;
        cwd: z$1.ZodOptional<z$1.ZodString>;
        providerId: z$1.ZodString;
        type: z$1.ZodLiteral<"provider.usage">;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        supported: z$1.ZodLiteral<false>;
    }, z$1.core.$loose>, z$1.ZodObject<{
        supported: z$1.ZodLiteral<true>;
        usage: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            accountEmail: z$1.ZodNullable<z$1.ZodString>;
            planLabel: z$1.ZodNullable<z$1.ZodString>;
            status: z$1.ZodLiteral<"ok">;
            windows: z$1.ZodArray<z$1.ZodObject<{
                cost: z$1.ZodOptional<z$1.ZodObject<{
                    limitUsdCents: z$1.ZodNumber;
                    usedUsdCents: z$1.ZodNumber;
                }, z$1.core.$strip>>;
                label: z$1.ZodString;
                resetsAt: z$1.ZodNullable<z$1.ZodString>;
                usedPercent: z$1.ZodNumber;
            }, z$1.core.$loose>>;
        }, z$1.core.$loose>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"not_installed">;
        }, z$1.core.$loose>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"unauthenticated">;
        }, z$1.core.$loose>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"expired">;
        }, z$1.core.$loose>, z$1.ZodObject<{
            accountEmail: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
            message: z$1.ZodString;
            planLabel: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
            status: z$1.ZodLiteral<"error">;
        }, z$1.core.$loose>], "status">;
    }, z$1.core.$loose>], "supported">, "onlineRpc", true>;
    "workspace.status": HostDaemonCommandDescriptor<"workspace.status", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        maxUntrackedLineStatBytes: z$1.ZodNumber;
        maxUntrackedLineStatFiles: z$1.ZodNumber;
        mergeBaseBranch: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"workspace.status">;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                "managed-worktree": "managed-worktree";
                personal: "personal";
                unmanaged: "unmanaged";
            }>;
        }, z$1.core.$strip>;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"available">;
        workspaceStatus: z$1.ZodObject<{
            branch: z$1.ZodObject<{
                currentBranch: z$1.ZodNullable<z$1.ZodString>;
                defaultBranch: z$1.ZodString;
            }, z$1.core.$strip>;
            checkout: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                branchName: z$1.ZodString;
                headSha: z$1.ZodNullable<z$1.ZodString>;
                kind: z$1.ZodLiteral<"branch">;
            }, z$1.core.$strip>, z$1.ZodObject<{
                headSha: z$1.ZodNullable<z$1.ZodString>;
                kind: z$1.ZodLiteral<"detached">;
            }, z$1.core.$strip>, z$1.ZodObject<{
                branchName: z$1.ZodNullable<z$1.ZodString>;
                kind: z$1.ZodLiteral<"unborn">;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"unknown">;
                reason: z$1.ZodString;
            }, z$1.core.$strip>], "kind">;
            mergeBase: z$1.ZodNullable<z$1.ZodObject<{
                aheadCount: z$1.ZodNumber;
                baseRef: z$1.ZodNullable<z$1.ZodString>;
                behindCount: z$1.ZodNumber;
                commits: z$1.ZodArray<z$1.ZodObject<{
                    authorName: z$1.ZodString;
                    authoredAt: z$1.ZodNumber;
                    sha: z$1.ZodString;
                    shortSha: z$1.ZodString;
                    subject: z$1.ZodString;
                }, z$1.core.$strip>>;
                deletions: z$1.ZodNumber;
                files: z$1.ZodArray<z$1.ZodObject<{
                    deletions: z$1.ZodNullable<z$1.ZodNumber>;
                    insertions: z$1.ZodNullable<z$1.ZodNumber>;
                    path: z$1.ZodString;
                    status: z$1.ZodEnum<{
                        "?": "?";
                        "??": "??";
                        A: "A";
                        C: "C";
                        D: "D";
                        M: "M";
                        R: "R";
                        U: "U";
                    }>;
                }, z$1.core.$strip>>;
                hasCommittedUnmergedChanges: z$1.ZodBoolean;
                insertions: z$1.ZodNumber;
                lineStatsComplete: z$1.ZodBoolean;
                mergeBaseBranch: z$1.ZodString;
            }, z$1.core.$strip>>;
            workingTree: z$1.ZodObject<{
                deletions: z$1.ZodNumber;
                files: z$1.ZodArray<z$1.ZodObject<{
                    deletions: z$1.ZodNullable<z$1.ZodNumber>;
                    insertions: z$1.ZodNullable<z$1.ZodNumber>;
                    path: z$1.ZodString;
                    status: z$1.ZodEnum<{
                        "?": "?";
                        "??": "??";
                        A: "A";
                        C: "C";
                        D: "D";
                        M: "M";
                        R: "R";
                        U: "U";
                    }>;
                }, z$1.core.$strip>>;
                hasUncommittedChanges: z$1.ZodBoolean;
                insertions: z$1.ZodNumber;
                lineStatsComplete: z$1.ZodBoolean;
                state: z$1.ZodEnum<{
                    clean: "clean";
                    committed_unmerged: "committed_unmerged";
                    dirty_and_committed_unmerged: "dirty_and_committed_unmerged";
                    dirty_uncommitted: "dirty_uncommitted";
                    untracked: "untracked";
                }>;
            }, z$1.core.$strip>;
        }, z$1.core.$strip>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        failure: z$1.ZodObject<{
            code: z$1.ZodEnum<{
                not_git_repo: "not_git_repo";
                not_worktree: "not_worktree";
                path_not_found: "path_not_found";
                permission_denied: "permission_denied";
                unknown: "unknown";
                unknown_environment: "unknown_environment";
                workspace_type_mismatch: "workspace_type_mismatch";
            }>;
            message: z$1.ZodString;
            workspacePath: z$1.ZodString;
        }, z$1.core.$strict>;
        outcome: z$1.ZodLiteral<"unavailable">;
    }, z$1.core.$strict>], "outcome">, "onlineRpc", true>;
    "workspace.diff": HostDaemonCommandDescriptor<"workspace.diff", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        maxDiffBytes: z$1.ZodNumber;
        maxFileListBytes: z$1.ZodNumber;
        maxUntrackedFiles: z$1.ZodNumber;
        target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            type: z$1.ZodLiteral<"uncommitted">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            mergeBaseBranch: z$1.ZodString;
            type: z$1.ZodLiteral<"branch_committed">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            mergeBaseBranch: z$1.ZodString;
            type: z$1.ZodLiteral<"all">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            sha: z$1.ZodString;
            type: z$1.ZodLiteral<"commit">;
        }, z$1.core.$strip>], "type">;
        type: z$1.ZodLiteral<"workspace.diff">;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                "managed-worktree": "managed-worktree";
                personal: "personal";
                unmanaged: "unmanaged";
            }>;
        }, z$1.core.$strip>;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        diff: z$1.ZodObject<{
            diff: z$1.ZodString;
            files: z$1.ZodString;
            mergeBaseRef: z$1.ZodNullable<z$1.ZodString>;
            shortstat: z$1.ZodString;
            truncated: z$1.ZodBoolean;
        }, z$1.core.$strip>;
        outcome: z$1.ZodLiteral<"available">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        failure: z$1.ZodObject<{
            code: z$1.ZodEnum<{
                not_git_repo: "not_git_repo";
                not_worktree: "not_worktree";
                path_not_found: "path_not_found";
                permission_denied: "permission_denied";
                unknown: "unknown";
                unknown_environment: "unknown_environment";
                workspace_type_mismatch: "workspace_type_mismatch";
            }>;
            message: z$1.ZodString;
            workspacePath: z$1.ZodString;
        }, z$1.core.$strict>;
        outcome: z$1.ZodLiteral<"unavailable">;
    }, z$1.core.$strict>], "outcome">, "onlineRpc", true>;
    "workspace.diffFiles": HostDaemonCommandDescriptor<"workspace.diffFiles", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        maxFiles: z$1.ZodNumber;
        target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            type: z$1.ZodLiteral<"uncommitted">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            mergeBaseBranch: z$1.ZodString;
            type: z$1.ZodLiteral<"branch_committed">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            mergeBaseBranch: z$1.ZodString;
            type: z$1.ZodLiteral<"all">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            sha: z$1.ZodString;
            type: z$1.ZodLiteral<"commit">;
        }, z$1.core.$strip>], "type">;
        type: z$1.ZodLiteral<"workspace.diffFiles">;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                "managed-worktree": "managed-worktree";
                personal: "personal";
                unmanaged: "unmanaged";
            }>;
        }, z$1.core.$strip>;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        files: z$1.ZodArray<z$1.ZodObject<{
            additions: z$1.ZodNumber;
            binary: z$1.ZodBoolean;
            deletions: z$1.ZodNumber;
            origin: z$1.ZodEnum<{
                tracked: "tracked";
                untracked: "untracked";
            }>;
            path: z$1.ZodString;
            previousPath: z$1.ZodNullable<z$1.ZodString>;
            statusLetter: z$1.ZodEnum<{
                A: "A";
                C: "C";
                D: "D";
                M: "M";
                R: "R";
                T: "T";
            }>;
        }, z$1.core.$strip>>;
        mergeBaseRef: z$1.ZodNullable<z$1.ZodString>;
        outcome: z$1.ZodLiteral<"available">;
        shortstat: z$1.ZodString;
        truncated: z$1.ZodBoolean;
    }, z$1.core.$strict>, z$1.ZodObject<{
        failure: z$1.ZodObject<{
            code: z$1.ZodEnum<{
                not_git_repo: "not_git_repo";
                not_worktree: "not_worktree";
                path_not_found: "path_not_found";
                permission_denied: "permission_denied";
                unknown: "unknown";
                unknown_environment: "unknown_environment";
                workspace_type_mismatch: "workspace_type_mismatch";
            }>;
            message: z$1.ZodString;
            workspacePath: z$1.ZodString;
        }, z$1.core.$strict>;
        outcome: z$1.ZodLiteral<"unavailable">;
    }, z$1.core.$strict>], "outcome">, "onlineRpc", true>;
    "workspace.diffPatch": HostDaemonCommandDescriptor<"workspace.diffPatch", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        maxBytesPerFile: z$1.ZodNumber;
        paths: z$1.ZodArray<z$1.ZodString>;
        target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            type: z$1.ZodLiteral<"uncommitted">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            mergeBaseBranch: z$1.ZodString;
            type: z$1.ZodLiteral<"branch_committed">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            mergeBaseBranch: z$1.ZodString;
            type: z$1.ZodLiteral<"all">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            sha: z$1.ZodString;
            type: z$1.ZodLiteral<"commit">;
        }, z$1.core.$strip>], "type">;
        type: z$1.ZodLiteral<"workspace.diffPatch">;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                "managed-worktree": "managed-worktree";
                personal: "personal";
                unmanaged: "unmanaged";
            }>;
        }, z$1.core.$strip>;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"available">;
        patches: z$1.ZodArray<z$1.ZodObject<{
            patch: z$1.ZodString;
            path: z$1.ZodString;
            truncated: z$1.ZodBoolean;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        failure: z$1.ZodObject<{
            code: z$1.ZodEnum<{
                not_git_repo: "not_git_repo";
                not_worktree: "not_worktree";
                path_not_found: "path_not_found";
                permission_denied: "permission_denied";
                unknown: "unknown";
                unknown_environment: "unknown_environment";
                workspace_type_mismatch: "workspace_type_mismatch";
            }>;
            message: z$1.ZodString;
            workspacePath: z$1.ZodString;
        }, z$1.core.$strict>;
        outcome: z$1.ZodLiteral<"unavailable">;
    }, z$1.core.$strict>], "outcome">, "onlineRpc", true>;
    "workspace.pull_request": HostDaemonCommandDescriptor<"workspace.pull_request", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        type: z$1.ZodLiteral<"workspace.pull_request">;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                "managed-worktree": "managed-worktree";
                personal: "personal";
                unmanaged: "unmanaged";
            }>;
        }, z$1.core.$strip>;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"available">;
        pullRequest: z$1.ZodObject<{
            baseRefName: z$1.ZodString;
            checks: z$1.ZodArray<z$1.ZodObject<{
                conclusion: z$1.ZodNullable<z$1.ZodEnum<{
                    action_required: "action_required";
                    cancelled: "cancelled";
                    failure: "failure";
                    neutral: "neutral";
                    skipped: "skipped";
                    stale: "stale";
                    startup_failure: "startup_failure";
                    success: "success";
                    timed_out: "timed_out";
                    unknown: "unknown";
                }>>;
                name: z$1.ZodString;
                startedAt: z$1.ZodNullable<z$1.ZodString>;
                status: z$1.ZodEnum<{
                    completed: "completed";
                    in_progress: "in_progress";
                    queued: "queued";
                    unknown: "unknown";
                }>;
                url: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strict>>;
            headRefName: z$1.ZodString;
            isDraft: z$1.ZodBoolean;
            mergeStateStatus: z$1.ZodNullable<z$1.ZodEnum<{
                BEHIND: "BEHIND";
                BLOCKED: "BLOCKED";
                CLEAN: "CLEAN";
                DIRTY: "DIRTY";
                DRAFT: "DRAFT";
                HAS_HOOKS: "HAS_HOOKS";
                UNKNOWN: "UNKNOWN";
                UNSTABLE: "UNSTABLE";
            }>>;
            mergeable: z$1.ZodNullable<z$1.ZodEnum<{
                CONFLICTING: "CONFLICTING";
                MERGEABLE: "MERGEABLE";
                UNKNOWN: "UNKNOWN";
            }>>;
            number: z$1.ZodNumber;
            reviewDecision: z$1.ZodNullable<z$1.ZodEnum<{
                APPROVED: "APPROVED";
                CHANGES_REQUESTED: "CHANGES_REQUESTED";
                REVIEW_REQUIRED: "REVIEW_REQUIRED";
            }>>;
            reviewRequestCount: z$1.ZodNumber;
            state: z$1.ZodEnum<{
                CLOSED: "CLOSED";
                MERGED: "MERGED";
                OPEN: "OPEN";
            }>;
            title: z$1.ZodString;
            updatedAt: z$1.ZodString;
            url: z$1.ZodString;
        }, z$1.core.$strict>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"absent">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        message: z$1.ZodString;
        outcome: z$1.ZodLiteral<"unavailable">;
    }, z$1.core.$strict>], "outcome">, "onlineRpc", true>;
};
type HostDaemonCommandRegistry = typeof hostDaemonCommandRegistry;
type AnyHostDaemonCommandDescriptor = HostDaemonCommandRegistry[keyof HostDaemonCommandRegistry];
type HostDaemonCommandDescriptorForTransport<Transport extends HostDaemonCommandTransport> = Extract<AnyHostDaemonCommandDescriptor, {
    transport: Transport;
}>;
type HostDaemonResultSchemaMapForTransport<Transport extends HostDaemonCommandTransport> = {
    [Descriptor in HostDaemonCommandDescriptorForTransport<Transport> as Descriptor["type"]]: Descriptor["resultSchema"];
};
type HostDaemonOnlineRpcResultSchemaMap = HostDaemonResultSchemaMapForTransport<"onlineRpc">;
type HostDaemonOnlineRpcResultByType = {
    [K in keyof HostDaemonOnlineRpcResultSchemaMap]: z$1.infer<HostDaemonOnlineRpcResultSchemaMap[K]>;
};

declare const pickFolderResponseSchema: z$1.ZodObject<{
    path: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type PickFolderResponse = z$1.infer<typeof pickFolderResponseSchema>;
declare const pathsExistRequestSchema: z$1.ZodObject<{
    paths: z$1.ZodPipe<z$1.ZodArray<z$1.ZodString>, z$1.ZodTransform<string[], string[]>>;
}, z$1.core.$strip>;
type PathsExistRequest = z$1.infer<typeof pathsExistRequestSchema>;
declare const pathsExistResponseSchema: z$1.ZodObject<{
    existence: z$1.ZodRecord<z$1.ZodString, z$1.ZodBoolean>;
}, z$1.core.$strip>;
type PathsExistResponse = z$1.infer<typeof pathsExistResponseSchema>;
declare const providerCliStatusResponseSchema: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
    currentVersion: z$1.ZodNullable<z$1.ZodString>;
    displayName: z$1.ZodString;
    executableName: z$1.ZodString;
    executablePath: z$1.ZodNullable<z$1.ZodString>;
    installAction: z$1.ZodNullable<z$1.ZodObject<{
        command: z$1.ZodString;
        kind: z$1.ZodEnum<{
            install: "install";
            update: "update";
        }>;
        label: z$1.ZodEnum<{
            Install: "Install";
            Update: "Update";
        }>;
    }, z$1.core.$strip>>;
    installSource: z$1.ZodEnum<{
        external: "external";
        notInstalled: "notInstalled";
        npmGlobal: "npmGlobal";
    }>;
    installed: z$1.ZodBoolean;
    latestVersion: z$1.ZodNullable<z$1.ZodString>;
    minimumSupportedVersion: z$1.ZodNullable<z$1.ZodString>;
    needsUpdate: z$1.ZodBoolean;
    npmGlobalPackageVersion: z$1.ZodNullable<z$1.ZodString>;
    npmPackageName: z$1.ZodNullable<z$1.ZodString>;
    versionUnsupported: z$1.ZodBoolean;
}, z$1.core.$strip>>;
type ProviderCliStatusResponse = z$1.infer<typeof providerCliStatusResponseSchema>;
declare const providerCliInstallRequestSchema: z$1.ZodObject<{
    actionKind: z$1.ZodEnum<{
        install: "install";
        update: "update";
    }>;
    provider: z$1.ZodString;
}, z$1.core.$strip>;
type ProviderCliInstallRequest = z$1.infer<typeof providerCliInstallRequestSchema>;
declare const providerCliInstallEventSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    command: z$1.ZodString;
    provider: z$1.ZodString;
    type: z$1.ZodLiteral<"started">;
}, z$1.core.$strip>, z$1.ZodObject<{
    provider: z$1.ZodString;
    stream: z$1.ZodEnum<{
        stderr: "stderr";
        stdout: "stdout";
    }>;
    text: z$1.ZodString;
    type: z$1.ZodLiteral<"output">;
}, z$1.core.$strip>, z$1.ZodObject<{
    exitCode: z$1.ZodNullable<z$1.ZodNumber>;
    provider: z$1.ZodString;
    signal: z$1.ZodNullable<z$1.ZodString>;
    success: z$1.ZodBoolean;
    type: z$1.ZodLiteral<"completed">;
}, z$1.core.$strip>, z$1.ZodObject<{
    message: z$1.ZodString;
    provider: z$1.ZodString;
    type: z$1.ZodLiteral<"error">;
}, z$1.core.$strip>], "type">;
type ProviderCliInstallEvent = z$1.infer<typeof providerCliInstallEventSchema>;

interface CreateFilePreviewResponse {
    baseUrl: string;
    expiresAtMs: number;
}
type HostFileReadResponse = HostDaemonOnlineRpcResultByType["host.read_file"];
type HostFileWriteResponse = HostDaemonOnlineRpcResultByType["host.write_file"];
type HostFileListResponse = HostDaemonOnlineRpcResultByType["host.list_files"];
type HostPathListResponse = HostDaemonOnlineRpcResultByType["host.list_paths"];
type HostMkdirResponse = HostDaemonOnlineRpcResultByType["host.mkdir"];
type HostMovePathResponse = HostDaemonOnlineRpcResultByType["host.move_path"];
type HostRemovePathResponse = HostDaemonOnlineRpcResultByType["host.remove_path"];

declare const hostDirectoryQuerySchema: z$1.ZodObject<{
    path: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type HostDirectoryQuery = z$1.infer<typeof hostDirectoryQuerySchema>;
declare const hostDirectoryListingSchema: z$1.ZodObject<{
    directory: z$1.ZodString;
    entries: z$1.ZodArray<z$1.ZodObject<{
        kind: z$1.ZodEnum<{
            directory: "directory";
            file: "file";
        }>;
        name: z$1.ZodString;
        path: z$1.ZodString;
    }, z$1.core.$strip>>;
    parent: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type HostDirectoryListing = z$1.infer<typeof hostDirectoryListingSchema>;
declare const hostCloneDefaultPathQuerySchema: z$1.ZodObject<{
    projectId: z$1.ZodString;
}, z$1.core.$strip>;
type HostCloneDefaultPathQuery = z$1.infer<typeof hostCloneDefaultPathQuerySchema>;
declare const hostCloneDefaultPathResponseSchema: z$1.ZodObject<{
    path: z$1.ZodString;
}, z$1.core.$strict>;
type HostCloneDefaultPathResponse = z$1.infer<typeof hostCloneDefaultPathResponseSchema>;
declare const createHostJoinCodeResponseSchema: z$1.ZodObject<{
    expiresAt: z$1.ZodNumber;
    hostId: z$1.ZodString;
    joinCode: z$1.ZodString;
}, z$1.core.$strip>;
type CreateHostJoinCodeResponse = z$1.infer<typeof createHostJoinCodeResponseSchema>;
declare const updateHostRequestSchema: z$1.ZodObject<{
    name: z$1.ZodString;
}, z$1.core.$strict>;
type UpdateHostRequest = z$1.infer<typeof updateHostRequestSchema>;
declare const hostRetryUpdateResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
}, z$1.core.$strict>;
type HostRetryUpdateResponse = z$1.infer<typeof hostRetryUpdateResponseSchema>;
type HostPathsExistRequest = PathsExistRequest;
type HostPathsExistResponse = PathsExistResponse;
declare const hostPickFolderRequestSchema: z$1.ZodObject<{
    clientHostId: z$1.ZodString;
}, z$1.core.$strict>;
type HostPickFolderRequest = z$1.infer<typeof hostPickFolderRequestSchema>;
type HostPickFolderResponse = PickFolderResponse;
type HostProviderCliStatusResponse = ProviderCliStatusResponse;
type HostProviderCliInstallRequest = ProviderCliInstallRequest;
type HostProviderCliInstallEvent = ProviderCliInstallEvent;

declare const pluginUpdateCheckEntrySchema: z$1.ZodObject<{
    blocked: z$1.ZodOptional<z$1.ZodObject<{
        reasons: z$1.ZodArray<z$1.ZodString>;
        version: z$1.ZodString;
    }, z$1.core.$strip>>;
    candidate: z$1.ZodOptional<z$1.ZodObject<{
        display: z$1.ZodString;
        version: z$1.ZodString;
    }, z$1.core.$strip>>;
    detail: z$1.ZodOptional<z$1.ZodString>;
    devMode: z$1.ZodOptional<z$1.ZodLiteral<true>>;
    id: z$1.ZodString;
    installed: z$1.ZodObject<{
        display: z$1.ZodString;
        version: z$1.ZodString;
    }, z$1.core.$strip>;
    outcome: z$1.ZodEnum<{
        "update-available": "update-available";
        current: "current";
        incompatible: "incompatible";
        pinned: "pinned";
        unavailable: "unavailable";
    }>;
}, z$1.core.$strip>;
type PluginUpdateCheckEntry = z$1.infer<typeof pluginUpdateCheckEntrySchema>;
declare const pluginApplyUpdateResultSchema: z$1.ZodObject<{
    applied: z$1.ZodBoolean;
    detail: z$1.ZodOptional<z$1.ZodString>;
    from: z$1.ZodObject<{
        display: z$1.ZodString;
        version: z$1.ZodString;
    }, z$1.core.$strip>;
    outcome: z$1.ZodEnum<{
        "rolled-back": "rolled-back";
        current: "current";
        updated: "updated";
    }>;
    to: z$1.ZodOptional<z$1.ZodObject<{
        display: z$1.ZodString;
        version: z$1.ZodString;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type PluginApplyUpdateResult$1 = z$1.infer<typeof pluginApplyUpdateResultSchema>;
declare const pluginSourceDetailSchema: z$1.ZodObject<{
    engines: z$1.ZodObject<{
        bb: z$1.ZodOptional<z$1.ZodString>;
        bbPluginSdk: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>;
    history: z$1.ZodArray<z$1.ZodObject<{
        activatedAt: z$1.ZodNumber;
        version: z$1.ZodString;
    }, z$1.core.$strip>>;
    installedAt: z$1.ZodOptional<z$1.ZodNumber>;
    integrity: z$1.ZodOptional<z$1.ZodString>;
    range: z$1.ZodOptional<z$1.ZodString>;
    registry: z$1.ZodOptional<z$1.ZodString>;
    requested: z$1.ZodString;
    resolved: z$1.ZodString;
    resolvedTag: z$1.ZodOptional<z$1.ZodString>;
    subdirectory: z$1.ZodOptional<z$1.ZodString>;
    tagPrefix: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type PluginSourceDetail = z$1.infer<typeof pluginSourceDetailSchema>;
declare const installedPluginSchema: z$1.ZodObject<{
    app: z$1.ZodObject<{
        bundle: z$1.ZodNullable<z$1.ZodObject<{
            compatible: z$1.ZodBoolean;
            cssUrl: z$1.ZodNullable<z$1.ZodString>;
            hash: z$1.ZodString;
            jsBytes: z$1.ZodNumber;
            jsUrl: z$1.ZodString;
            sdkMajor: z$1.ZodNumber;
            sdkVersion: z$1.ZodString;
        }, z$1.core.$strip>>;
        hasApp: z$1.ZodBoolean;
    }, z$1.core.$strip>;
    capabilities: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
        detail: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        kind: z$1.ZodEnum<{
            "agent-tool": "agent-tool";
            "thread-integration": "thread-integration";
            skill: "skill";
            theme: "theme";
        }>;
        label: z$1.ZodString;
    }, z$1.core.$strip>>>;
    catalogEntryId: z$1.ZodOptional<z$1.ZodString>;
    catalogMarketplaceName: z$1.ZodOptional<z$1.ZodString>;
    category: z$1.ZodOptional<z$1.ZodString>;
    categoryId: z$1.ZodOptional<z$1.ZodString>;
    cliCommand: z$1.ZodNullable<z$1.ZodObject<{
        name: z$1.ZodString;
        summary: z$1.ZodString;
    }, z$1.core.$strip>>;
    collections: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        rank: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    description: z$1.ZodNullable<z$1.ZodString>;
    enabled: z$1.ZodBoolean;
    handlerStats: z$1.ZodObject<{
        count: z$1.ZodNumber;
        errorCount: z$1.ZodNumber;
        maxMs: z$1.ZodNumber;
        totalMs: z$1.ZodNumber;
    }, z$1.core.$strip>;
    hasSettings: z$1.ZodBoolean;
    icon: z$1.ZodNullable<z$1.ZodString>;
    iconUrl: z$1.ZodNullable<z$1.ZodString>;
    icons: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
    id: z$1.ZodString;
    isOrphanedBuiltin: z$1.ZodBoolean;
    logoDarkUrl: z$1.ZodNullable<z$1.ZodString>;
    logoUrl: z$1.ZodNullable<z$1.ZodString>;
    name: z$1.ZodNullable<z$1.ZodString>;
    provenance: z$1.ZodEnum<{
        builtin: "builtin";
        catalog: "catalog";
        direct: "direct";
    }>;
    providerIds: z$1.ZodArray<z$1.ZodString>;
    publishedAt: z$1.ZodOptional<z$1.ZodISODateTime>;
    publisherLabel: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
    rootDir: z$1.ZodString;
    schedules: z$1.ZodArray<z$1.ZodObject<{
        cron: z$1.ZodString;
        lastError: z$1.ZodNullable<z$1.ZodString>;
        lastRunAt: z$1.ZodNullable<z$1.ZodNumber>;
        lastStatus: z$1.ZodNullable<z$1.ZodEnum<{
            error: "error";
            ok: "ok";
            running: "running";
        }>>;
        name: z$1.ZodString;
        nextRunAt: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    screenshots: z$1.ZodArray<z$1.ZodString>;
    services: z$1.ZodArray<z$1.ZodObject<{
        name: z$1.ZodString;
        state: z$1.ZodEnum<{
            backoff: "backoff";
            running: "running";
            stopped: "stopped";
        }>;
    }, z$1.core.$strip>>;
    source: z$1.ZodString;
    sourceDisplay: z$1.ZodString;
    status: z$1.ZodEnum<{
        "needs-configuration": "needs-configuration";
        degraded: "degraded";
        disabled: "disabled";
        error: "error";
        incompatible: "incompatible";
        missing: "missing";
        running: "running";
    }>;
    statusDetail: z$1.ZodNullable<z$1.ZodString>;
    updateState: z$1.ZodObject<{
        availableVersion: z$1.ZodOptional<z$1.ZodString>;
        blockedReasons: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
        blockedVersion: z$1.ZodOptional<z$1.ZodString>;
        detail: z$1.ZodOptional<z$1.ZodString>;
        lastCheckAt: z$1.ZodOptional<z$1.ZodNumber>;
        lastFailure: z$1.ZodOptional<z$1.ZodObject<{
            at: z$1.ZodNumber;
            detail: z$1.ZodString;
            version: z$1.ZodString;
        }, z$1.core.$strip>>;
        outcome: z$1.ZodOptional<z$1.ZodEnum<{
            "update-available": "update-available";
            current: "current";
            incompatible: "incompatible";
            pinned: "pinned";
            unavailable: "unavailable";
        }>>;
    }, z$1.core.$strip>;
    updatedAt: z$1.ZodOptional<z$1.ZodISODateTime>;
    version: z$1.ZodString;
}, z$1.core.$strip>;
type InstalledPlugin = z$1.infer<typeof installedPluginSchema>;
declare const pluginListResponseSchema: z$1.ZodObject<{
    plugins: z$1.ZodArray<z$1.ZodObject<{
        app: z$1.ZodObject<{
            bundle: z$1.ZodNullable<z$1.ZodObject<{
                compatible: z$1.ZodBoolean;
                cssUrl: z$1.ZodNullable<z$1.ZodString>;
                hash: z$1.ZodString;
                jsBytes: z$1.ZodNumber;
                jsUrl: z$1.ZodString;
                sdkMajor: z$1.ZodNumber;
                sdkVersion: z$1.ZodString;
            }, z$1.core.$strip>>;
            hasApp: z$1.ZodBoolean;
        }, z$1.core.$strip>;
        capabilities: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            detail: z$1.ZodNullable<z$1.ZodString>;
            id: z$1.ZodString;
            kind: z$1.ZodEnum<{
                "agent-tool": "agent-tool";
                "thread-integration": "thread-integration";
                skill: "skill";
                theme: "theme";
            }>;
            label: z$1.ZodString;
        }, z$1.core.$strip>>>;
        catalogEntryId: z$1.ZodOptional<z$1.ZodString>;
        catalogMarketplaceName: z$1.ZodOptional<z$1.ZodString>;
        category: z$1.ZodOptional<z$1.ZodString>;
        categoryId: z$1.ZodOptional<z$1.ZodString>;
        cliCommand: z$1.ZodNullable<z$1.ZodObject<{
            name: z$1.ZodString;
            summary: z$1.ZodString;
        }, z$1.core.$strip>>;
        collections: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            rank: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        description: z$1.ZodNullable<z$1.ZodString>;
        enabled: z$1.ZodBoolean;
        handlerStats: z$1.ZodObject<{
            count: z$1.ZodNumber;
            errorCount: z$1.ZodNumber;
            maxMs: z$1.ZodNumber;
            totalMs: z$1.ZodNumber;
        }, z$1.core.$strip>;
        hasSettings: z$1.ZodBoolean;
        icon: z$1.ZodNullable<z$1.ZodString>;
        iconUrl: z$1.ZodNullable<z$1.ZodString>;
        icons: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
        id: z$1.ZodString;
        isOrphanedBuiltin: z$1.ZodBoolean;
        logoDarkUrl: z$1.ZodNullable<z$1.ZodString>;
        logoUrl: z$1.ZodNullable<z$1.ZodString>;
        name: z$1.ZodNullable<z$1.ZodString>;
        provenance: z$1.ZodEnum<{
            builtin: "builtin";
            catalog: "catalog";
            direct: "direct";
        }>;
        providerIds: z$1.ZodArray<z$1.ZodString>;
        publishedAt: z$1.ZodOptional<z$1.ZodISODateTime>;
        publisherLabel: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
        rootDir: z$1.ZodString;
        schedules: z$1.ZodArray<z$1.ZodObject<{
            cron: z$1.ZodString;
            lastError: z$1.ZodNullable<z$1.ZodString>;
            lastRunAt: z$1.ZodNullable<z$1.ZodNumber>;
            lastStatus: z$1.ZodNullable<z$1.ZodEnum<{
                error: "error";
                ok: "ok";
                running: "running";
            }>>;
            name: z$1.ZodString;
            nextRunAt: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        screenshots: z$1.ZodArray<z$1.ZodString>;
        services: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            state: z$1.ZodEnum<{
                backoff: "backoff";
                running: "running";
                stopped: "stopped";
            }>;
        }, z$1.core.$strip>>;
        source: z$1.ZodString;
        sourceDisplay: z$1.ZodString;
        status: z$1.ZodEnum<{
            "needs-configuration": "needs-configuration";
            degraded: "degraded";
            disabled: "disabled";
            error: "error";
            incompatible: "incompatible";
            missing: "missing";
            running: "running";
        }>;
        statusDetail: z$1.ZodNullable<z$1.ZodString>;
        updateState: z$1.ZodObject<{
            availableVersion: z$1.ZodOptional<z$1.ZodString>;
            blockedReasons: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
            blockedVersion: z$1.ZodOptional<z$1.ZodString>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            lastCheckAt: z$1.ZodOptional<z$1.ZodNumber>;
            lastFailure: z$1.ZodOptional<z$1.ZodObject<{
                at: z$1.ZodNumber;
                detail: z$1.ZodString;
                version: z$1.ZodString;
            }, z$1.core.$strip>>;
            outcome: z$1.ZodOptional<z$1.ZodEnum<{
                "update-available": "update-available";
                current: "current";
                incompatible: "incompatible";
                pinned: "pinned";
                unavailable: "unavailable";
            }>>;
        }, z$1.core.$strip>;
        updatedAt: z$1.ZodOptional<z$1.ZodISODateTime>;
        version: z$1.ZodString;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type PluginListResponse = z$1.infer<typeof pluginListResponseSchema>;
declare const pluginReloadResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    plugins: z$1.ZodArray<z$1.ZodObject<{
        app: z$1.ZodObject<{
            bundle: z$1.ZodNullable<z$1.ZodObject<{
                compatible: z$1.ZodBoolean;
                cssUrl: z$1.ZodNullable<z$1.ZodString>;
                hash: z$1.ZodString;
                jsBytes: z$1.ZodNumber;
                jsUrl: z$1.ZodString;
                sdkMajor: z$1.ZodNumber;
                sdkVersion: z$1.ZodString;
            }, z$1.core.$strip>>;
            hasApp: z$1.ZodBoolean;
        }, z$1.core.$strip>;
        capabilities: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            detail: z$1.ZodNullable<z$1.ZodString>;
            id: z$1.ZodString;
            kind: z$1.ZodEnum<{
                "agent-tool": "agent-tool";
                "thread-integration": "thread-integration";
                skill: "skill";
                theme: "theme";
            }>;
            label: z$1.ZodString;
        }, z$1.core.$strip>>>;
        catalogEntryId: z$1.ZodOptional<z$1.ZodString>;
        catalogMarketplaceName: z$1.ZodOptional<z$1.ZodString>;
        category: z$1.ZodOptional<z$1.ZodString>;
        categoryId: z$1.ZodOptional<z$1.ZodString>;
        cliCommand: z$1.ZodNullable<z$1.ZodObject<{
            name: z$1.ZodString;
            summary: z$1.ZodString;
        }, z$1.core.$strip>>;
        collections: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            rank: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        description: z$1.ZodNullable<z$1.ZodString>;
        enabled: z$1.ZodBoolean;
        handlerStats: z$1.ZodObject<{
            count: z$1.ZodNumber;
            errorCount: z$1.ZodNumber;
            maxMs: z$1.ZodNumber;
            totalMs: z$1.ZodNumber;
        }, z$1.core.$strip>;
        hasSettings: z$1.ZodBoolean;
        icon: z$1.ZodNullable<z$1.ZodString>;
        iconUrl: z$1.ZodNullable<z$1.ZodString>;
        icons: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
        id: z$1.ZodString;
        isOrphanedBuiltin: z$1.ZodBoolean;
        logoDarkUrl: z$1.ZodNullable<z$1.ZodString>;
        logoUrl: z$1.ZodNullable<z$1.ZodString>;
        name: z$1.ZodNullable<z$1.ZodString>;
        provenance: z$1.ZodEnum<{
            builtin: "builtin";
            catalog: "catalog";
            direct: "direct";
        }>;
        providerIds: z$1.ZodArray<z$1.ZodString>;
        publishedAt: z$1.ZodOptional<z$1.ZodISODateTime>;
        publisherLabel: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
        rootDir: z$1.ZodString;
        schedules: z$1.ZodArray<z$1.ZodObject<{
            cron: z$1.ZodString;
            lastError: z$1.ZodNullable<z$1.ZodString>;
            lastRunAt: z$1.ZodNullable<z$1.ZodNumber>;
            lastStatus: z$1.ZodNullable<z$1.ZodEnum<{
                error: "error";
                ok: "ok";
                running: "running";
            }>>;
            name: z$1.ZodString;
            nextRunAt: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        screenshots: z$1.ZodArray<z$1.ZodString>;
        services: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            state: z$1.ZodEnum<{
                backoff: "backoff";
                running: "running";
                stopped: "stopped";
            }>;
        }, z$1.core.$strip>>;
        source: z$1.ZodString;
        sourceDisplay: z$1.ZodString;
        status: z$1.ZodEnum<{
            "needs-configuration": "needs-configuration";
            degraded: "degraded";
            disabled: "disabled";
            error: "error";
            incompatible: "incompatible";
            missing: "missing";
            running: "running";
        }>;
        statusDetail: z$1.ZodNullable<z$1.ZodString>;
        updateState: z$1.ZodObject<{
            availableVersion: z$1.ZodOptional<z$1.ZodString>;
            blockedReasons: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
            blockedVersion: z$1.ZodOptional<z$1.ZodString>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            lastCheckAt: z$1.ZodOptional<z$1.ZodNumber>;
            lastFailure: z$1.ZodOptional<z$1.ZodObject<{
                at: z$1.ZodNumber;
                detail: z$1.ZodString;
                version: z$1.ZodString;
            }, z$1.core.$strip>>;
            outcome: z$1.ZodOptional<z$1.ZodEnum<{
                "update-available": "update-available";
                current: "current";
                incompatible: "incompatible";
                pinned: "pinned";
                unavailable: "unavailable";
            }>>;
        }, z$1.core.$strip>;
        updatedAt: z$1.ZodOptional<z$1.ZodISODateTime>;
        version: z$1.ZodString;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type PluginReloadResponse = z$1.infer<typeof pluginReloadResponseSchema>;
declare const pluginRemoveResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
}, z$1.core.$strip>;
type PluginRemoveResponse = z$1.infer<typeof pluginRemoveResponseSchema>;
declare const pluginSettingsResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    schema: z$1.ZodRecord<z$1.ZodString, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        default: z$1.ZodOptional<z$1.ZodString>;
        description: z$1.ZodOptional<z$1.ZodString>;
        experimental_multiline: z$1.ZodOptional<z$1.ZodBoolean>;
        label: z$1.ZodString;
        secret: z$1.ZodOptional<z$1.ZodLiteral<true>>;
        type: z$1.ZodLiteral<"string">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        default: z$1.ZodOptional<z$1.ZodBoolean>;
        description: z$1.ZodOptional<z$1.ZodString>;
        label: z$1.ZodString;
        type: z$1.ZodLiteral<"boolean">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        default: z$1.ZodOptional<z$1.ZodNumber>;
        description: z$1.ZodOptional<z$1.ZodString>;
        label: z$1.ZodString;
        type: z$1.ZodLiteral<"number">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        default: z$1.ZodOptional<z$1.ZodString>;
        description: z$1.ZodOptional<z$1.ZodString>;
        label: z$1.ZodString;
        options: z$1.ZodArray<z$1.ZodString>;
        type: z$1.ZodLiteral<"select">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        default: z$1.ZodOptional<z$1.ZodString>;
        description: z$1.ZodOptional<z$1.ZodString>;
        label: z$1.ZodString;
        type: z$1.ZodLiteral<"project">;
    }, z$1.core.$strict>], "type">>;
    values: z$1.ZodRecord<z$1.ZodString, z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>>;
}, z$1.core.$strip>;
type PluginSettingsResponse = z$1.infer<typeof pluginSettingsResponseSchema>;
declare const pluginTokenResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    token: z$1.ZodString;
}, z$1.core.$strip>;
type PluginTokenResponse = z$1.infer<typeof pluginTokenResponseSchema>;
declare const pluginCatalogStatusSchema: z$1.ZodObject<{
    includedPluginCount: z$1.ZodNumber;
    optionalPluginCount: z$1.ZodNumber;
    pluginCount: z$1.ZodNumber;
}, z$1.core.$strip>;
type PluginCatalogStatus = z$1.infer<typeof pluginCatalogStatusSchema>;
declare const pluginCatalogSearchResponseSchema: z$1.ZodObject<{
    collections: z$1.ZodArray<z$1.ZodObject<{
        displayName: z$1.ZodString;
        id: z$1.ZodString;
        pluginIds: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strip>>;
    results: z$1.ZodArray<z$1.ZodObject<{
        author: z$1.ZodNullable<z$1.ZodObject<{
            github: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
            name: z$1.ZodString;
            url: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>>;
        category: z$1.ZodOptional<z$1.ZodString>;
        categoryId: z$1.ZodOptional<z$1.ZodString>;
        collections: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            rank: z$1.ZodNumber;
        }, z$1.core.$strip>>>;
        compatible: z$1.ZodBoolean;
        description: z$1.ZodString;
        displayName: z$1.ZodString;
        entryId: z$1.ZodString;
        icon: z$1.ZodNullable<z$1.ZodString>;
        iconTinted: z$1.ZodDefault<z$1.ZodBoolean>;
        iconUrl: z$1.ZodNullable<z$1.ZodString>;
        incompatibleReason: z$1.ZodNullable<z$1.ZodString>;
        installed: z$1.ZodBoolean;
        installs: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodNumber>>;
        marketplace: z$1.ZodString;
        marketplaceDisplayName: z$1.ZodString;
        official: z$1.ZodBoolean;
        overview: z$1.ZodOptional<z$1.ZodString>;
        pluginId: z$1.ZodString;
        publishedAt: z$1.ZodOptional<z$1.ZodISODateTime>;
        publisherKey: z$1.ZodString;
        publisherLabel: z$1.ZodString;
        repositoryUrl: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
        screenshots: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
        source: z$1.ZodString;
        updatedAt: z$1.ZodOptional<z$1.ZodISODateTime>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type PluginCatalogSearchResponse = z$1.infer<typeof pluginCatalogSearchResponseSchema>;
declare const pluginCatalogResolvedSourceSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    kind: z$1.ZodLiteral<"npm">;
    package: z$1.ZodString;
    range: z$1.ZodOptional<z$1.ZodString>;
    registry: z$1.ZodOptional<z$1.ZodString>;
    resolvedIntegrity: z$1.ZodOptional<z$1.ZodString>;
    resolvedVersion: z$1.ZodOptional<z$1.ZodString>;
    tag: z$1.ZodOptional<z$1.ZodString>;
    unresolvedReason: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strict>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"git">;
    range: z$1.ZodOptional<z$1.ZodString>;
    ref: z$1.ZodOptional<z$1.ZodString>;
    resolvedCommit: z$1.ZodOptional<z$1.ZodString>;
    resolvedTag: z$1.ZodOptional<z$1.ZodString>;
    subdir: z$1.ZodOptional<z$1.ZodString>;
    tagPrefix: z$1.ZodOptional<z$1.ZodString>;
    unresolvedReason: z$1.ZodOptional<z$1.ZodString>;
    url: z$1.ZodString;
}, z$1.core.$strict>], "kind">;
type PluginCatalogResolvedSource = z$1.infer<typeof pluginCatalogResolvedSourceSchema>;
declare const pluginCatalogInstallPlanSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    compatible: z$1.ZodBoolean;
    displayName: z$1.ZodString;
    entryId: z$1.ZodString;
    incompatibleReason: z$1.ZodNullable<z$1.ZodString>;
    kind: z$1.ZodLiteral<"bundled">;
    pluginId: z$1.ZodString;
    source: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    author: z$1.ZodObject<{
        github: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
        name: z$1.ZodString;
        url: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>;
    compatible: z$1.ZodBoolean;
    displayName: z$1.ZodString;
    entryId: z$1.ZodString;
    incompatibleReason: z$1.ZodNullable<z$1.ZodString>;
    kind: z$1.ZodLiteral<"marketplace">;
    marketplace: z$1.ZodString;
    marketplaceDisplayName: z$1.ZodString;
    official: z$1.ZodBoolean;
    pluginId: z$1.ZodString;
    resolvedSource: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"npm">;
        package: z$1.ZodString;
        range: z$1.ZodOptional<z$1.ZodString>;
        registry: z$1.ZodOptional<z$1.ZodString>;
        resolvedIntegrity: z$1.ZodOptional<z$1.ZodString>;
        resolvedVersion: z$1.ZodOptional<z$1.ZodString>;
        tag: z$1.ZodOptional<z$1.ZodString>;
        unresolvedReason: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"git">;
        range: z$1.ZodOptional<z$1.ZodString>;
        ref: z$1.ZodOptional<z$1.ZodString>;
        resolvedCommit: z$1.ZodOptional<z$1.ZodString>;
        resolvedTag: z$1.ZodOptional<z$1.ZodString>;
        subdir: z$1.ZodOptional<z$1.ZodString>;
        tagPrefix: z$1.ZodOptional<z$1.ZodString>;
        unresolvedReason: z$1.ZodOptional<z$1.ZodString>;
        url: z$1.ZodString;
    }, z$1.core.$strict>], "kind">;
    source: z$1.ZodString;
}, z$1.core.$strip>], "kind">;
type PluginCatalogInstallPlan = z$1.infer<typeof pluginCatalogInstallPlanSchema>;
declare const pluginMarketplaceSchema: z$1.ZodObject<{
    description: z$1.ZodNullable<z$1.ZodString>;
    displayName: z$1.ZodString;
    entryCount: z$1.ZodNumber;
    lastAttemptAt: z$1.ZodNullable<z$1.ZodNumber>;
    lastError: z$1.ZodNullable<z$1.ZodString>;
    lastRefreshAt: z$1.ZodNullable<z$1.ZodNumber>;
    name: z$1.ZodString;
    official: z$1.ZodBoolean;
    resolvedCommit: z$1.ZodNullable<z$1.ZodString>;
    source: z$1.ZodString;
    sourceKind: z$1.ZodEnum<{
        git: "git";
        https: "https";
        path: "path";
    }>;
}, z$1.core.$strip>;
type PluginMarketplace = z$1.infer<typeof pluginMarketplaceSchema>;
declare const pluginMarketplaceRefreshResultSchema: z$1.ZodObject<{
    error: z$1.ZodNullable<z$1.ZodString>;
    marketplace: z$1.ZodObject<{
        description: z$1.ZodNullable<z$1.ZodString>;
        displayName: z$1.ZodString;
        entryCount: z$1.ZodNumber;
        lastAttemptAt: z$1.ZodNullable<z$1.ZodNumber>;
        lastError: z$1.ZodNullable<z$1.ZodString>;
        lastRefreshAt: z$1.ZodNullable<z$1.ZodNumber>;
        name: z$1.ZodString;
        official: z$1.ZodBoolean;
        resolvedCommit: z$1.ZodNullable<z$1.ZodString>;
        source: z$1.ZodString;
        sourceKind: z$1.ZodEnum<{
            git: "git";
            https: "https";
            path: "path";
        }>;
    }, z$1.core.$strip>;
    name: z$1.ZodString;
    ok: z$1.ZodBoolean;
}, z$1.core.$strip>;
type PluginMarketplaceRefreshResult$1 = z$1.infer<typeof pluginMarketplaceRefreshResultSchema>;

declare const systemExecutionOptionsResponseSchema: z$1.ZodObject<{
    modelLoadError: z$1.ZodNullable<z$1.ZodObject<{
        code: z$1.ZodEnum<{
            auth_required: "auth_required";
            failed: "failed";
            missing_executable: "missing_executable";
            provider_unavailable: "provider_unavailable";
            timeout: "timeout";
        }>;
        providerId: z$1.ZodString;
    }, z$1.core.$strip>>;
    models: z$1.ZodArray<z$1.ZodObject<{
        defaultReasoningEffort: z$1.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            none: "none";
            ultra: "ultra";
            ultracode: "ultracode";
            xhigh: "xhigh";
        }>;
        description: z$1.ZodString;
        displayName: z$1.ZodString;
        id: z$1.ZodString;
        isDefault: z$1.ZodBoolean;
        model: z$1.ZodString;
        routeProviderId: z$1.ZodOptional<z$1.ZodString>;
        supportedReasoningEfforts: z$1.ZodArray<z$1.ZodObject<{
            description: z$1.ZodString;
            reasoningEffort: z$1.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                none: "none";
                ultra: "ultra";
                ultracode: "ultracode";
                xhigh: "xhigh";
            }>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>>;
    permissionCeiling: z$1.ZodEnum<{
        "accept-edits": "accept-edits";
        auto: "auto";
        full: "full";
    }>;
    providers: z$1.ZodArray<z$1.ZodObject<{
        available: z$1.ZodBoolean;
        capabilities: z$1.ZodObject<{
            modelCatalogScope: z$1.ZodEnum<{
                host: "host";
                workspace: "workspace";
            }>;
            permissionModes: z$1.ZodArray<z$1.ZodEnum<{
                "accept-edits": "accept-edits";
                auto: "auto";
                full: "full";
            }>>;
            supportsFork: z$1.ZodBoolean;
            supportsNativeUserQuestion: z$1.ZodBoolean;
            supportsServiceTier: z$1.ZodBoolean;
            supportsSessionRewind: z$1.ZodBoolean;
            supportsThreadArchive: z$1.ZodBoolean;
            supportsThreadRename: z$1.ZodBoolean;
        }, z$1.core.$strip>;
        composerActions: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"skills">;
            trigger: z$1.ZodEnum<{
                "/": "/";
            }>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            command: z$1.ZodObject<{
                name: z$1.ZodString;
                trailingText: z$1.ZodString;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
            }, z$1.core.$strip>;
            kind: z$1.ZodLiteral<"plan">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            command: z$1.ZodObject<{
                name: z$1.ZodString;
                trailingText: z$1.ZodString;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
            }, z$1.core.$strip>;
            kind: z$1.ZodLiteral<"goal">;
        }, z$1.core.$strip>], "kind">>;
        displayName: z$1.ZodString;
        extensionKinds: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString & z$1.ZodType<`${string}/${string}`, string, z$1.core.$ZodTypeInternals<`${string}/${string}`, string>>, z$1.ZodObject<{
            item: z$1.ZodBoolean;
            state: z$1.ZodBoolean;
        }, z$1.core.$strip>>>;
        family: z$1.ZodOptional<z$1.ZodString>;
        icon: z$1.ZodOptional<z$1.ZodObject<{
            glyph: z$1.ZodString;
        }, z$1.core.$strip>>;
        id: z$1.ZodString;
        logoUrl: z$1.ZodNullable<z$1.ZodString>;
        maintenance: z$1.ZodObject<{
            health: z$1.ZodBoolean;
            installation: z$1.ZodBoolean;
            usage: z$1.ZodBoolean;
        }, z$1.core.$strip>;
        pluginId: z$1.ZodString;
        reasoningLevels: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
            description: z$1.ZodOptional<z$1.ZodString>;
            id: z$1.ZodString;
            label: z$1.ZodString;
        }, z$1.core.$strip>>>;
        serviceTiers: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
            description: z$1.ZodOptional<z$1.ZodString>;
            id: z$1.ZodString;
            label: z$1.ZodString;
        }, z$1.core.$strip>>>;
        strings: z$1.ZodOptional<z$1.ZodObject<{
            brandPrefix: z$1.ZodOptional<z$1.ZodString>;
            expiredHint: z$1.ZodString;
            iconTint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            installUrl: z$1.ZodString;
            planModeCopy: z$1.ZodOptional<z$1.ZodString>;
            signInHint: z$1.ZodString;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>>;
    selectedOnlyModels: z$1.ZodArray<z$1.ZodObject<{
        defaultReasoningEffort: z$1.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            none: "none";
            ultra: "ultra";
            ultracode: "ultracode";
            xhigh: "xhigh";
        }>;
        description: z$1.ZodString;
        displayName: z$1.ZodString;
        id: z$1.ZodString;
        isDefault: z$1.ZodBoolean;
        model: z$1.ZodString;
        routeProviderId: z$1.ZodOptional<z$1.ZodString>;
        supportedReasoningEfforts: z$1.ZodArray<z$1.ZodObject<{
            description: z$1.ZodString;
            reasoningEffort: z$1.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                none: "none";
                ultra: "ultra";
                ultracode: "ultracode";
                xhigh: "xhigh";
            }>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type SystemExecutionOptionsResponse = z$1.infer<typeof systemExecutionOptionsResponseSchema>;
declare const systemProvidersQuerySchema: z$1.ZodObject<{
    capability: z$1.ZodOptional<z$1.ZodEnum<{
        usage: "usage";
    }>>;
    environmentId: z$1.ZodOptional<z$1.ZodString>;
    hostId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type SystemProvidersQuery = z$1.infer<typeof systemProvidersQuerySchema>;
declare const systemExecutionOptionsQuerySchema: z$1.ZodObject<{
    environmentId: z$1.ZodOptional<z$1.ZodString>;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    providerId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type SystemExecutionOptionsQuery = z$1.infer<typeof systemExecutionOptionsQuerySchema>;
declare const systemUsageLimitsQuerySchema: z$1.ZodObject<{
    hostId: z$1.ZodOptional<z$1.ZodString>;
    providerId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type SystemUsageLimitsQuery = z$1.infer<typeof systemUsageLimitsQuerySchema>;
declare const systemVoiceTranscriptionResponseSchema: z$1.ZodObject<{
    text: z$1.ZodString;
}, z$1.core.$strip>;
type SystemVoiceTranscriptionResponse = z$1.infer<typeof systemVoiceTranscriptionResponseSchema>;
declare const systemProviderStatesResponseSchema: z$1.ZodObject<{
    providers: z$1.ZodArray<z$1.ZodObject<{
        accountEmail: z$1.ZodNullable<z$1.ZodString>;
        canInstall: z$1.ZodBoolean;
        canUpdate: z$1.ZodBoolean;
        displayName: z$1.ZodString;
        installedVersion: z$1.ZodNullable<z$1.ZodString>;
        loginCommand: z$1.ZodNullable<z$1.ZodString>;
        minimumSupportedVersion: z$1.ZodNullable<z$1.ZodString>;
        planLabel: z$1.ZodNullable<z$1.ZodString>;
        providerId: z$1.ZodString;
        status: z$1.ZodEnum<{
            expired: "expired";
            not_installed: "not_installed";
            ready: "ready";
            unauthenticated: "unauthenticated";
            unknown: "unknown";
            unsupported_version: "unsupported_version";
        }>;
        statusMessage: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$loose>>;
}, z$1.core.$strip>;
type SystemProviderStatesResponse = z$1.infer<typeof systemProviderStatesResponseSchema>;
declare const systemConfigResponseSchema: z$1.ZodObject<{
    aiServices: z$1.ZodObject<{
        inference: z$1.ZodString;
        inferenceFallback: z$1.ZodString;
        services: z$1.ZodArray<z$1.ZodObject<{
            displayName: z$1.ZodString;
            id: z$1.ZodString;
            kinds: z$1.ZodArray<z$1.ZodEnum<{
                inference: "inference";
                voice: "voice";
            }>>;
            pluginId: z$1.ZodString;
        }, z$1.core.$strip>>;
        transcription: z$1.ZodString;
    }, z$1.core.$strip>;
    appearance: z$1.ZodObject<{
        customCss: z$1.ZodNullable<z$1.ZodString>;
        faviconColor: z$1.ZodEnum<{
            blue: "blue";
            default: "default";
            green: "green";
            orange: "orange";
            pink: "pink";
            purple: "purple";
            red: "red";
            teal: "teal";
            yellow: "yellow";
        }>;
        resolvedCodeTheme: z$1.ZodDefault<z$1.ZodObject<{
            dark: z$1.ZodString;
            files: z$1.ZodRecord<z$1.ZodString, z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>>;
            light: z$1.ZodString;
        }, z$1.core.$strict>>;
        themeId: z$1.ZodString;
    }, z$1.core.$strip>;
    customThemes: z$1.ZodArray<z$1.ZodString>;
    dataDir: z$1.ZodString;
    defaultKeybindings: z$1.ZodArray<z$1.ZodObject<{
        command: z$1.ZodEnum<{
            "app.back": "app.back";
            "browser.find": "browser.find";
            "browser.focusLocation": "browser.focusLocation";
            "browser.reload": "browser.reload";
            "composer.focus": "composer.focus";
            "diff.toggle": "diff.toggle";
            "file.quickOpen": "file.quickOpen";
            "logs.openServerDaemon": "logs.openServerDaemon";
            "modelPicker.cycleModel": "modelPicker.cycleModel";
            "modelPicker.cycleModelBackward": "modelPicker.cycleModelBackward";
            "modelPicker.cycleProvider": "modelPicker.cycleProvider";
            "modelPicker.cycleProviderBackward": "modelPicker.cycleProviderBackward";
            "modelPicker.cycleReasoning": "modelPicker.cycleReasoning";
            "modelPicker.cycleReasoningBackward": "modelPicker.cycleReasoningBackward";
            "modelPicker.toggle": "modelPicker.toggle";
            "notifications.open": "notifications.open";
            "palette.open": "palette.open";
            "pane.close": "pane.close";
            "pane.focus.1": "pane.focus.1";
            "pane.focus.2": "pane.focus.2";
            "pane.focus.3": "pane.focus.3";
            "pane.focus.4": "pane.focus.4";
            "pane.focus.5": "pane.focus.5";
            "pane.focus.6": "pane.focus.6";
            "pane.focus.7": "pane.focus.7";
            "pane.focus.8": "pane.focus.8";
            "pane.focus.next": "pane.focus.next";
            "pane.focus.previous": "pane.focus.previous";
            "pane.maximize.toggle": "pane.maximize.toggle";
            "panel.close": "panel.close";
            "panel.newTab": "panel.newTab";
            "panel.reopenClosedTab": "panel.reopenClosedTab";
            "panel.toggle": "panel.toggle";
            "question.select.1": "question.select.1";
            "question.select.2": "question.select.2";
            "question.select.3": "question.select.3";
            "question.select.4": "question.select.4";
            "question.select.5": "question.select.5";
            "question.select.6": "question.select.6";
            "question.select.7": "question.select.7";
            "question.select.8": "question.select.8";
            "question.select.9": "question.select.9";
            "settings.open": "settings.open";
            "settings.openServers": "settings.openServers";
            "sidebar.toggle": "sidebar.toggle";
            "terminal.open": "terminal.open";
            "thread.archive": "thread.archive";
            "thread.jump.1": "thread.jump.1";
            "thread.jump.2": "thread.jump.2";
            "thread.jump.3": "thread.jump.3";
            "thread.jump.4": "thread.jump.4";
            "thread.jump.5": "thread.jump.5";
            "thread.jump.6": "thread.jump.6";
            "thread.jump.7": "thread.jump.7";
            "thread.jump.8": "thread.jump.8";
            "thread.jump.9": "thread.jump.9";
            "thread.new": "thread.new";
            "thread.next": "thread.next";
            "thread.previous": "thread.previous";
            "thread.rename": "thread.rename";
            "thread.search": "thread.search";
            "window.new": "window.new";
            "workspace.openPreferred": "workspace.openPreferred";
        }>;
        desktopOnly: z$1.ZodBoolean;
        shortcut: z$1.ZodNullable<z$1.ZodObject<{
            alt: z$1.ZodBoolean;
            control: z$1.ZodBoolean;
            key: z$1.ZodString;
            meta: z$1.ZodBoolean;
            mod: z$1.ZodBoolean;
            shift: z$1.ZodBoolean;
        }, z$1.core.$strict>>;
        when: z$1.ZodObject<{
            all: z$1.ZodArray<z$1.ZodEnum<{
                browserFocus: "browserFocus";
                editableFocus: "editableFocus";
                macPlatform: "macPlatform";
                mainSurface: "mainSurface";
                modalOpen: "modalOpen";
                modelPickerOpen: "modelPickerOpen";
                promptAvailable: "promptAvailable";
                questionOpen: "questionOpen";
                splitActive: "splitActive";
                terminalFocus: "terminalFocus";
                webSurface: "webSurface";
            }>>;
            none: z$1.ZodArray<z$1.ZodEnum<{
                browserFocus: "browserFocus";
                editableFocus: "editableFocus";
                macPlatform: "macPlatform";
                mainSurface: "mainSurface";
                modalOpen: "modalOpen";
                modelPickerOpen: "modelPickerOpen";
                promptAvailable: "promptAvailable";
                questionOpen: "questionOpen";
                splitActive: "splitActive";
                terminalFocus: "terminalFocus";
                webSurface: "webSurface";
            }>>;
        }, z$1.core.$strict>;
    }, z$1.core.$strict>>;
    experiments: z$1.ZodRecord<z$1.ZodEnum<{
        changelogPreview: "changelogPreview";
        editMessages: "editMessages";
        mobileApp: "mobileApp";
        sidebarProgressiveDisclosure: "sidebarProgressiveDisclosure";
        timelineWindowing: "timelineWindowing";
    }>, z$1.ZodBoolean>;
    featureFlags: z$1.ZodObject<{
        placeholder: z$1.ZodBoolean;
        timelineWindowEventBudget: z$1.ZodNumber;
    }, z$1.core.$strip>;
    generalSettings: z$1.ZodObject<{
        defaultProviderId: z$1.ZodNullable<z$1.ZodString>;
        managedBranchPrefix: z$1.ZodString;
        providerOrder: z$1.ZodArray<z$1.ZodString>;
        showKeyboardHints: z$1.ZodBoolean;
        showUnhandledProviderEvents: z$1.ZodBoolean;
        steerActiveThreadOnEnter: z$1.ZodBoolean;
        streamerMode: z$1.ZodBoolean;
    }, z$1.core.$strict>;
    hostDaemonPort: z$1.ZodNullable<z$1.ZodNumber>;
    keybindingOverrides: z$1.ZodArray<z$1.ZodObject<{
        command: z$1.ZodEnum<{
            "app.back": "app.back";
            "browser.find": "browser.find";
            "browser.focusLocation": "browser.focusLocation";
            "browser.reload": "browser.reload";
            "composer.focus": "composer.focus";
            "diff.toggle": "diff.toggle";
            "file.quickOpen": "file.quickOpen";
            "logs.openServerDaemon": "logs.openServerDaemon";
            "modelPicker.cycleModel": "modelPicker.cycleModel";
            "modelPicker.cycleModelBackward": "modelPicker.cycleModelBackward";
            "modelPicker.cycleProvider": "modelPicker.cycleProvider";
            "modelPicker.cycleProviderBackward": "modelPicker.cycleProviderBackward";
            "modelPicker.cycleReasoning": "modelPicker.cycleReasoning";
            "modelPicker.cycleReasoningBackward": "modelPicker.cycleReasoningBackward";
            "modelPicker.toggle": "modelPicker.toggle";
            "notifications.open": "notifications.open";
            "palette.open": "palette.open";
            "pane.close": "pane.close";
            "pane.focus.1": "pane.focus.1";
            "pane.focus.2": "pane.focus.2";
            "pane.focus.3": "pane.focus.3";
            "pane.focus.4": "pane.focus.4";
            "pane.focus.5": "pane.focus.5";
            "pane.focus.6": "pane.focus.6";
            "pane.focus.7": "pane.focus.7";
            "pane.focus.8": "pane.focus.8";
            "pane.focus.next": "pane.focus.next";
            "pane.focus.previous": "pane.focus.previous";
            "pane.maximize.toggle": "pane.maximize.toggle";
            "panel.close": "panel.close";
            "panel.newTab": "panel.newTab";
            "panel.reopenClosedTab": "panel.reopenClosedTab";
            "panel.toggle": "panel.toggle";
            "question.select.1": "question.select.1";
            "question.select.2": "question.select.2";
            "question.select.3": "question.select.3";
            "question.select.4": "question.select.4";
            "question.select.5": "question.select.5";
            "question.select.6": "question.select.6";
            "question.select.7": "question.select.7";
            "question.select.8": "question.select.8";
            "question.select.9": "question.select.9";
            "settings.open": "settings.open";
            "settings.openServers": "settings.openServers";
            "sidebar.toggle": "sidebar.toggle";
            "terminal.open": "terminal.open";
            "thread.archive": "thread.archive";
            "thread.jump.1": "thread.jump.1";
            "thread.jump.2": "thread.jump.2";
            "thread.jump.3": "thread.jump.3";
            "thread.jump.4": "thread.jump.4";
            "thread.jump.5": "thread.jump.5";
            "thread.jump.6": "thread.jump.6";
            "thread.jump.7": "thread.jump.7";
            "thread.jump.8": "thread.jump.8";
            "thread.jump.9": "thread.jump.9";
            "thread.new": "thread.new";
            "thread.next": "thread.next";
            "thread.previous": "thread.previous";
            "thread.rename": "thread.rename";
            "thread.search": "thread.search";
            "window.new": "window.new";
            "workspace.openPreferred": "workspace.openPreferred";
        }>;
        shortcut: z$1.ZodNullable<z$1.ZodObject<{
            alt: z$1.ZodBoolean;
            control: z$1.ZodBoolean;
            key: z$1.ZodString;
            meta: z$1.ZodBoolean;
            mod: z$1.ZodBoolean;
            shift: z$1.ZodBoolean;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>>;
    keybindings: z$1.ZodArray<z$1.ZodObject<{
        command: z$1.ZodEnum<{
            "app.back": "app.back";
            "browser.find": "browser.find";
            "browser.focusLocation": "browser.focusLocation";
            "browser.reload": "browser.reload";
            "composer.focus": "composer.focus";
            "diff.toggle": "diff.toggle";
            "file.quickOpen": "file.quickOpen";
            "logs.openServerDaemon": "logs.openServerDaemon";
            "modelPicker.cycleModel": "modelPicker.cycleModel";
            "modelPicker.cycleModelBackward": "modelPicker.cycleModelBackward";
            "modelPicker.cycleProvider": "modelPicker.cycleProvider";
            "modelPicker.cycleProviderBackward": "modelPicker.cycleProviderBackward";
            "modelPicker.cycleReasoning": "modelPicker.cycleReasoning";
            "modelPicker.cycleReasoningBackward": "modelPicker.cycleReasoningBackward";
            "modelPicker.toggle": "modelPicker.toggle";
            "notifications.open": "notifications.open";
            "palette.open": "palette.open";
            "pane.close": "pane.close";
            "pane.focus.1": "pane.focus.1";
            "pane.focus.2": "pane.focus.2";
            "pane.focus.3": "pane.focus.3";
            "pane.focus.4": "pane.focus.4";
            "pane.focus.5": "pane.focus.5";
            "pane.focus.6": "pane.focus.6";
            "pane.focus.7": "pane.focus.7";
            "pane.focus.8": "pane.focus.8";
            "pane.focus.next": "pane.focus.next";
            "pane.focus.previous": "pane.focus.previous";
            "pane.maximize.toggle": "pane.maximize.toggle";
            "panel.close": "panel.close";
            "panel.newTab": "panel.newTab";
            "panel.reopenClosedTab": "panel.reopenClosedTab";
            "panel.toggle": "panel.toggle";
            "question.select.1": "question.select.1";
            "question.select.2": "question.select.2";
            "question.select.3": "question.select.3";
            "question.select.4": "question.select.4";
            "question.select.5": "question.select.5";
            "question.select.6": "question.select.6";
            "question.select.7": "question.select.7";
            "question.select.8": "question.select.8";
            "question.select.9": "question.select.9";
            "settings.open": "settings.open";
            "settings.openServers": "settings.openServers";
            "sidebar.toggle": "sidebar.toggle";
            "terminal.open": "terminal.open";
            "thread.archive": "thread.archive";
            "thread.jump.1": "thread.jump.1";
            "thread.jump.2": "thread.jump.2";
            "thread.jump.3": "thread.jump.3";
            "thread.jump.4": "thread.jump.4";
            "thread.jump.5": "thread.jump.5";
            "thread.jump.6": "thread.jump.6";
            "thread.jump.7": "thread.jump.7";
            "thread.jump.8": "thread.jump.8";
            "thread.jump.9": "thread.jump.9";
            "thread.new": "thread.new";
            "thread.next": "thread.next";
            "thread.previous": "thread.previous";
            "thread.rename": "thread.rename";
            "thread.search": "thread.search";
            "window.new": "window.new";
            "workspace.openPreferred": "workspace.openPreferred";
        }>;
        desktopOnly: z$1.ZodBoolean;
        shortcut: z$1.ZodObject<{
            alt: z$1.ZodBoolean;
            control: z$1.ZodBoolean;
            key: z$1.ZodString;
            meta: z$1.ZodBoolean;
            mod: z$1.ZodBoolean;
            shift: z$1.ZodBoolean;
        }, z$1.core.$strict>;
        when: z$1.ZodObject<{
            all: z$1.ZodArray<z$1.ZodEnum<{
                browserFocus: "browserFocus";
                editableFocus: "editableFocus";
                macPlatform: "macPlatform";
                mainSurface: "mainSurface";
                modalOpen: "modalOpen";
                modelPickerOpen: "modelPickerOpen";
                promptAvailable: "promptAvailable";
                questionOpen: "questionOpen";
                splitActive: "splitActive";
                terminalFocus: "terminalFocus";
                webSurface: "webSurface";
            }>>;
            none: z$1.ZodArray<z$1.ZodEnum<{
                browserFocus: "browserFocus";
                editableFocus: "editableFocus";
                macPlatform: "macPlatform";
                mainSurface: "mainSurface";
                modalOpen: "modalOpen";
                modelPickerOpen: "modelPickerOpen";
                promptAvailable: "promptAvailable";
                questionOpen: "questionOpen";
                splitActive: "splitActive";
                terminalFocus: "terminalFocus";
                webSurface: "webSurface";
            }>>;
        }, z$1.core.$strict>;
    }, z$1.core.$strict>>;
    localHelperPorts: z$1.ZodArray<z$1.ZodNumber>;
    pluginThemes: z$1.ZodArray<z$1.ZodObject<{
        description: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        name: z$1.ZodString;
        pluginId: z$1.ZodString;
    }, z$1.core.$strip>>;
    primaryHostId: z$1.ZodNullable<z$1.ZodString>;
    primaryHostPlatform: z$1.ZodNullable<z$1.ZodEnum<{
        darwin: "darwin";
        linux: "linux";
        unknown: "unknown";
        wsl: "wsl";
    }>>;
    serverUrl: z$1.ZodString;
    voiceTranscriptionEnabled: z$1.ZodBoolean;
}, z$1.core.$strip>;
type SystemConfigResponse = z$1.infer<typeof systemConfigResponseSchema>;
declare const systemAttentionResponseSchema: z$1.ZodObject<{
    hasAttention: z$1.ZodBoolean;
}, z$1.core.$strip>;
type SystemAttentionResponse = z$1.infer<typeof systemAttentionResponseSchema>;
declare const themeCatalogResponseSchema: z$1.ZodObject<{
    active: z$1.ZodObject<{
        customCss: z$1.ZodNullable<z$1.ZodString>;
        faviconColor: z$1.ZodEnum<{
            blue: "blue";
            default: "default";
            green: "green";
            orange: "orange";
            pink: "pink";
            purple: "purple";
            red: "red";
            teal: "teal";
            yellow: "yellow";
        }>;
        resolvedCodeTheme: z$1.ZodDefault<z$1.ZodObject<{
            dark: z$1.ZodString;
            files: z$1.ZodRecord<z$1.ZodString, z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>>;
            light: z$1.ZodString;
        }, z$1.core.$strict>>;
        themeId: z$1.ZodString;
    }, z$1.core.$strip>;
    custom: z$1.ZodArray<z$1.ZodString>;
    dir: z$1.ZodString;
    plugins: z$1.ZodArray<z$1.ZodObject<{
        description: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        name: z$1.ZodString;
        pluginId: z$1.ZodString;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type ThemeCatalogResponse = z$1.infer<typeof themeCatalogResponseSchema>;
declare const systemVersionResponseSchema: z$1.ZodObject<{
    currentVersion: z$1.ZodString;
    isDevelopment: z$1.ZodBoolean;
    latestVersion: z$1.ZodNullable<z$1.ZodString>;
    source: z$1.ZodLiteral<"npm">;
    updateAvailable: z$1.ZodBoolean;
    upgradeCommand: z$1.ZodString;
}, z$1.core.$strip>;
type SystemVersionResponse = z$1.infer<typeof systemVersionResponseSchema>;
declare const systemConfigReloadResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
}, z$1.core.$strip>;
declare const systemCliSkillsStatusResponseSchema: z$1.ZodObject<{
    machines: z$1.ZodArray<z$1.ZodObject<{
        hostId: z$1.ZodString;
        hostName: z$1.ZodString;
        status: z$1.ZodEnum<{
            installed: "installed";
            missing: "missing";
            outdated: "outdated";
            unknown: "unknown";
        }>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type SystemCliSkillsStatusResponse = z$1.infer<typeof systemCliSkillsStatusResponseSchema>;
declare const systemInstallCliSkillsRequestSchema: z$1.ZodObject<{
    hostIds: z$1.ZodArray<z$1.ZodString>;
}, z$1.core.$strip>;
type SystemInstallCliSkillsRequest = z$1.infer<typeof systemInstallCliSkillsRequestSchema>;
declare const systemInstallCliSkillsResponseSchema: z$1.ZodObject<{
    results: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        hostId: z$1.ZodString;
        hostName: z$1.ZodString;
        installations: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            path: z$1.ZodString;
        }, z$1.core.$strip>>;
        ok: z$1.ZodLiteral<true>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        errorMessage: z$1.ZodString;
        hostId: z$1.ZodString;
        hostName: z$1.ZodString;
        ok: z$1.ZodLiteral<false>;
    }, z$1.core.$strip>], "ok">>;
}, z$1.core.$strip>;
type SystemInstallCliSkillsResponse = z$1.infer<typeof systemInstallCliSkillsResponseSchema>;
type SystemConfigReloadResponse = z$1.infer<typeof systemConfigReloadResponseSchema>;

declare const terminalSessionSchema: z$1.ZodObject<{
    closeReason: z$1.ZodNullable<z$1.ZodEnum<{
        "daemon-disconnect": "daemon-disconnect";
        "environment-destroyed": "environment-destroyed";
        "open-timeout": "open-timeout";
        "process-exit": "process-exit";
        "thread-archived": "thread-archived";
        "thread-deleted": "thread-deleted";
        user: "user";
    }>>;
    cols: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    environmentId: z$1.ZodNullable<z$1.ZodString>;
    exitCode: z$1.ZodNullable<z$1.ZodNumber>;
    hostId: z$1.ZodString;
    id: z$1.ZodString;
    initialCwd: z$1.ZodString;
    lastUserInputAt: z$1.ZodNullable<z$1.ZodNumber>;
    rows: z$1.ZodNumber;
    status: z$1.ZodEnum<{
        disconnected: "disconnected";
        exited: "exited";
        running: "running";
        starting: "starting";
    }>;
    threadId: z$1.ZodNullable<z$1.ZodString>;
    title: z$1.ZodString;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type TerminalSession = z$1.infer<typeof terminalSessionSchema>;
declare const terminalListResponseSchema: z$1.ZodObject<{
    sessions: z$1.ZodArray<z$1.ZodObject<{
        closeReason: z$1.ZodNullable<z$1.ZodEnum<{
            "daemon-disconnect": "daemon-disconnect";
            "environment-destroyed": "environment-destroyed";
            "open-timeout": "open-timeout";
            "process-exit": "process-exit";
            "thread-archived": "thread-archived";
            "thread-deleted": "thread-deleted";
            user: "user";
        }>>;
        cols: z$1.ZodNumber;
        createdAt: z$1.ZodNumber;
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        exitCode: z$1.ZodNullable<z$1.ZodNumber>;
        hostId: z$1.ZodString;
        id: z$1.ZodString;
        initialCwd: z$1.ZodString;
        lastUserInputAt: z$1.ZodNullable<z$1.ZodNumber>;
        rows: z$1.ZodNumber;
        status: z$1.ZodEnum<{
            disconnected: "disconnected";
            exited: "exited";
            running: "running";
            starting: "starting";
        }>;
        threadId: z$1.ZodNullable<z$1.ZodString>;
        title: z$1.ZodString;
        updatedAt: z$1.ZodNumber;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type TerminalListResponse = z$1.infer<typeof terminalListResponseSchema>;
declare const createTerminalRequestSchema: z$1.ZodObject<{
    cols: z$1.ZodNumber;
    rows: z$1.ZodNumber;
    start: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        mode: z$1.ZodLiteral<"shell">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        command: z$1.ZodString;
        mode: z$1.ZodLiteral<"command">;
    }, z$1.core.$strict>], "mode">>;
    target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
        threadId: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodString;
        kind: z$1.ZodLiteral<"environment">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        cwd: z$1.ZodNullable<z$1.ZodString>;
        hostId: z$1.ZodString;
        kind: z$1.ZodLiteral<"host_path">;
    }, z$1.core.$strict>], "kind">;
    title: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strict>;
type CreateTerminalRequest = z$1.infer<typeof createTerminalRequestSchema>;
declare const updateTerminalRequestSchema: z$1.ZodObject<{
    title: z$1.ZodString;
}, z$1.core.$strict>;
type UpdateTerminalRequest = z$1.infer<typeof updateTerminalRequestSchema>;
declare const terminalInputRequestSchema: z$1.ZodObject<{
    dataBase64: z$1.ZodString;
}, z$1.core.$strict>;
type TerminalInputRequest = z$1.infer<typeof terminalInputRequestSchema>;
declare const terminalResizeRequestSchema: z$1.ZodObject<{
    cols: z$1.ZodNumber;
    rows: z$1.ZodNumber;
}, z$1.core.$strict>;
type TerminalResizeRequest = z$1.infer<typeof terminalResizeRequestSchema>;
declare const terminalOutputQuerySchema: z$1.ZodObject<{
    limitChunks: z$1.ZodOptional<z$1.ZodCoercedNumber<unknown>>;
    sinceSeq: z$1.ZodOptional<z$1.ZodCoercedNumber<unknown>>;
    tailBytes: z$1.ZodOptional<z$1.ZodCoercedNumber<unknown>>;
}, z$1.core.$strict>;
type TerminalOutputQuery = z$1.infer<typeof terminalOutputQuerySchema>;
declare const terminalOutputResponseSchema: z$1.ZodObject<{
    chunks: z$1.ZodArray<z$1.ZodObject<{
        dataBase64: z$1.ZodString;
        seq: z$1.ZodNumber;
    }, z$1.core.$strict>>;
    nextSeq: z$1.ZodNumber;
    truncated: z$1.ZodBoolean;
}, z$1.core.$strict>;
type TerminalOutputResponse = z$1.infer<typeof terminalOutputResponseSchema>;

declare const timelineRowStatusSchema: z$1.ZodEnum<{
    completed: "completed";
    error: "error";
    interrupted: "interrupted";
    pending: "pending";
}>;
type TimelineRowStatus = z$1.infer<typeof timelineRowStatusSchema>;
declare const timelineRowBaseSchema: z$1.ZodObject<{
    createdAt: z$1.ZodNumber;
    id: z$1.ZodString;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type TimelineRowBase = z$1.infer<typeof timelineRowBaseSchema>;
declare const timelineConversationRowSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    attachments: z$1.ZodNullable<z$1.ZodObject<{
        imageUrls: z$1.ZodArray<z$1.ZodString>;
        localFilePaths: z$1.ZodArray<z$1.ZodString>;
        localFiles: z$1.ZodNumber;
        localImagePaths: z$1.ZodArray<z$1.ZodString>;
        localImages: z$1.ZodNumber;
        webImages: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    createdAt: z$1.ZodNumber;
    id: z$1.ZodString;
    initiator: z$1.ZodEnum<{
        agent: "agent";
        system: "system";
        user: "user";
    }>;
    kind: z$1.ZodLiteral<"conversation">;
    mentions: z$1.ZodArray<z$1.ZodObject<{
        end: z$1.ZodNumber;
        resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"thread">;
            label: z$1.ZodString;
            projectId: z$1.ZodOptional<z$1.ZodString>;
            threadId: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"project">;
            label: z$1.ZodString;
            projectId: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"section">;
            label: z$1.ZodString;
            sectionId: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            entryKind: z$1.ZodEnum<{
                directory: "directory";
                file: "file";
            }>;
            kind: z$1.ZodLiteral<"path">;
            label: z$1.ZodString;
            path: z$1.ZodString;
            source: z$1.ZodEnum<{
                "thread-storage": "thread-storage";
                workspace: "workspace";
            }>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            argumentHint: z$1.ZodNullable<z$1.ZodString>;
            kind: z$1.ZodLiteral<"command">;
            label: z$1.ZodString;
            name: z$1.ZodString;
            origin: z$1.ZodEnum<{
                builtin: "builtin";
                project: "project";
                user: "user";
            }>;
            source: z$1.ZodEnum<{
                command: "command";
                skill: "skill";
            }>;
            trigger: z$1.ZodEnum<{
                "/": "/";
            }>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
            itemId: z$1.ZodString;
            kind: z$1.ZodLiteral<"plugin">;
            label: z$1.ZodString;
            pluginId: z$1.ZodString;
        }, z$1.core.$strip>], "kind">>;
        start: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    role: z$1.ZodLiteral<"user">;
    senderThreadId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    systemMessageKind: z$1.ZodEnum<{
        "child-completed": "child-completed";
        "child-failed": "child-failed";
        "child-interrupted": "child-interrupted";
        "child-needs-attention": "child-needs-attention";
        "child-outcome-batch": "child-outcome-batch";
        "ownership-assigned": "ownership-assigned";
        "ownership-removed": "ownership-removed";
        unlabeled: "unlabeled";
    }>;
    systemMessageSubject: z$1.ZodNullable<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
        threadId: z$1.ZodString;
        threadName: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        count: z$1.ZodNumber;
        kind: z$1.ZodLiteral<"thread-batch">;
    }, z$1.core.$strip>], "kind">>;
    text: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    turnRequest: z$1.ZodObject<{
        isGrouped: z$1.ZodBoolean;
        kind: z$1.ZodEnum<{
            message: "message";
            steer: "steer";
        }>;
        status: z$1.ZodEnum<{
            accepted: "accepted";
            pending: "pending";
            rejected: "rejected";
        }>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    attachments: z$1.ZodNullable<z$1.ZodObject<{
        imageUrls: z$1.ZodArray<z$1.ZodString>;
        localFilePaths: z$1.ZodArray<z$1.ZodString>;
        localFiles: z$1.ZodNumber;
        localImagePaths: z$1.ZodArray<z$1.ZodString>;
        localImages: z$1.ZodNumber;
        webImages: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    createdAt: z$1.ZodNumber;
    id: z$1.ZodString;
    kind: z$1.ZodLiteral<"conversation">;
    role: z$1.ZodLiteral<"assistant">;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    text: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    turnRequest: z$1.ZodNull;
}, z$1.core.$strip>], "role">;
type TimelineConversationRow = z$1.infer<typeof timelineConversationRowSchema>;
declare const timelineSystemRowSchema: z$1.ZodUnion<readonly [z$1.ZodObject<{
    createdAt: z$1.ZodNumber;
    detail: z$1.ZodNullable<z$1.ZodString>;
    id: z$1.ZodString;
    kind: z$1.ZodLiteral<"system">;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    status: z$1.ZodNullable<z$1.ZodEnum<{
        completed: "completed";
        error: "error";
        interrupted: "interrupted";
        pending: "pending";
    }>>;
    systemKind: z$1.ZodEnum<{
        debug: "debug";
        error: "error";
        reconnect: "reconnect";
    }>;
    threadId: z$1.ZodString;
    title: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    createdAt: z$1.ZodNumber;
    detail: z$1.ZodNullable<z$1.ZodString>;
    id: z$1.ZodString;
    kind: z$1.ZodLiteral<"system">;
    operationKind: z$1.ZodEnum<{
        "context-clear": "context-clear";
        "provider-unhandled": "provider-unhandled";
        "thread-interrupted": "thread-interrupted";
        "thread-provisioning": "thread-provisioning";
        compaction: "compaction";
        deprecation: "deprecation";
        generic: "generic";
        warning: "warning";
    }>;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    status: z$1.ZodNullable<z$1.ZodEnum<{
        completed: "completed";
        error: "error";
        interrupted: "interrupted";
        pending: "pending";
    }>>;
    systemKind: z$1.ZodLiteral<"operation">;
    threadId: z$1.ZodString;
    title: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    createdAt: z$1.ZodNumber;
    detail: z$1.ZodNullable<z$1.ZodString>;
    id: z$1.ZodString;
    kind: z$1.ZodLiteral<"system">;
    operationKind: z$1.ZodLiteral<"parent-change">;
    parentChange: z$1.ZodObject<{
        action: z$1.ZodEnum<{
            assign: "assign";
            release: "release";
            transfer: "transfer";
        }>;
        nextParentThreadId: z$1.ZodNullable<z$1.ZodString>;
        nextParentThreadTitle: z$1.ZodNullable<z$1.ZodString>;
        previousParentThreadId: z$1.ZodNullable<z$1.ZodString>;
        previousParentThreadTitle: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    status: z$1.ZodEnum<{
        completed: "completed";
        error: "error";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    systemKind: z$1.ZodLiteral<"operation">;
    threadId: z$1.ZodString;
    title: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>], "operationKind">]>;
type TimelineSystemRow = z$1.infer<typeof timelineSystemRowSchema>;
interface TimelineWorkRowBase extends TimelineRowBase {
    kind: "work";
    status: TimelineRowStatus;
}
type TimelineRowPresentation = ThreadEventItemPresentation;
declare const timelineCommandWorkRowSchema: z$1.ZodObject<{
    activityIntents: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        command: z$1.ZodString;
        name: z$1.ZodString;
        path: z$1.ZodNullable<z$1.ZodString>;
        type: z$1.ZodLiteral<"read">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        command: z$1.ZodString;
        path: z$1.ZodNullable<z$1.ZodString>;
        type: z$1.ZodLiteral<"list_files">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        command: z$1.ZodString;
        path: z$1.ZodNullable<z$1.ZodString>;
        query: z$1.ZodNullable<z$1.ZodString>;
        type: z$1.ZodLiteral<"search">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        command: z$1.ZodString;
        type: z$1.ZodLiteral<"unknown">;
    }, z$1.core.$strip>], "type">>;
    approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
        denied: "denied";
        waiting_for_approval: "waiting_for_approval";
    }>>;
    callId: z$1.ZodString;
    command: z$1.ZodString;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    createdAt: z$1.ZodNumber;
    cwd: z$1.ZodNullable<z$1.ZodString>;
    exitCode: z$1.ZodNullable<z$1.ZodNumber>;
    id: z$1.ZodString;
    kind: z$1.ZodLiteral<"work">;
    output: z$1.ZodString;
    outputPreview: z$1.ZodOptional<z$1.ZodObject<{
        totalChars: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    presentation: z$1.ZodOptional<z$1.ZodObject<{
        badge: z$1.ZodOptional<z$1.ZodObject<{
            glyph: z$1.ZodString;
            hint: z$1.ZodString;
            label: z$1.ZodString;
            tone: z$1.ZodEnum<{
                destructive: "destructive";
                neutral: "neutral";
            }>;
        }, z$1.core.$strip>>;
        detail: z$1.ZodOptional<z$1.ZodString>;
        icon: z$1.ZodObject<{
            glyph: z$1.ZodString;
        }, z$1.core.$strip>;
        label: z$1.ZodObject<{
            completed: z$1.ZodString;
            pending: z$1.ZodString;
        }, z$1.core.$strip>;
        suppress: z$1.ZodOptional<z$1.ZodBoolean>;
        tint: z$1.ZodOptional<z$1.ZodObject<{
            dark: z$1.ZodString;
            light: z$1.ZodString;
        }, z$1.core.$strip>>;
        title: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>>;
    source: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    status: z$1.ZodEnum<{
        completed: "completed";
        error: "error";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    workKind: z$1.ZodLiteral<"command">;
}, z$1.core.$strip>;
type TimelineCommandWorkRow = z$1.infer<typeof timelineCommandWorkRowSchema>;
declare const timelineToolWorkRowSchema: z$1.ZodObject<{
    approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
        denied: "denied";
        waiting_for_approval: "waiting_for_approval";
    }>>;
    callId: z$1.ZodString;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    createdAt: z$1.ZodNumber;
    id: z$1.ZodString;
    kind: z$1.ZodLiteral<"work">;
    output: z$1.ZodString;
    outputPreview: z$1.ZodOptional<z$1.ZodObject<{
        totalChars: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    presentation: z$1.ZodOptional<z$1.ZodObject<{
        badge: z$1.ZodOptional<z$1.ZodObject<{
            glyph: z$1.ZodString;
            hint: z$1.ZodString;
            label: z$1.ZodString;
            tone: z$1.ZodEnum<{
                destructive: "destructive";
                neutral: "neutral";
            }>;
        }, z$1.core.$strip>>;
        detail: z$1.ZodOptional<z$1.ZodString>;
        icon: z$1.ZodObject<{
            glyph: z$1.ZodString;
        }, z$1.core.$strip>;
        label: z$1.ZodObject<{
            completed: z$1.ZodString;
            pending: z$1.ZodString;
        }, z$1.core.$strip>;
        suppress: z$1.ZodOptional<z$1.ZodBoolean>;
        tint: z$1.ZodOptional<z$1.ZodObject<{
            dark: z$1.ZodString;
            light: z$1.ZodString;
        }, z$1.core.$strip>>;
        title: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>>;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    status: z$1.ZodEnum<{
        completed: "completed";
        error: "error";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    threadId: z$1.ZodString;
    toolArgs: z$1.ZodNullable<z$1.ZodRecord<z$1.ZodString, z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>>>;
    toolName: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    workKind: z$1.ZodLiteral<"tool">;
}, z$1.core.$strip>;
type TimelineToolWorkRow = z$1.infer<typeof timelineToolWorkRowSchema>;
declare const timelineFileChangeWorkRowSchema: z$1.ZodObject<{
    approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
        denied: "denied";
        waiting_for_approval: "waiting_for_approval";
    }>>;
    callId: z$1.ZodString;
    change: z$1.ZodObject<{
        diff: z$1.ZodNullable<z$1.ZodString>;
        diffStats: z$1.ZodObject<{
            added: z$1.ZodNumber;
            removed: z$1.ZodNumber;
        }, z$1.core.$strip>;
        kind: z$1.ZodNullable<z$1.ZodString>;
        movePath: z$1.ZodNullable<z$1.ZodString>;
        path: z$1.ZodString;
    }, z$1.core.$strip>;
    createdAt: z$1.ZodNumber;
    id: z$1.ZodString;
    kind: z$1.ZodLiteral<"work">;
    presentation: z$1.ZodOptional<z$1.ZodObject<{
        badge: z$1.ZodOptional<z$1.ZodObject<{
            glyph: z$1.ZodString;
            hint: z$1.ZodString;
            label: z$1.ZodString;
            tone: z$1.ZodEnum<{
                destructive: "destructive";
                neutral: "neutral";
            }>;
        }, z$1.core.$strip>>;
        detail: z$1.ZodOptional<z$1.ZodString>;
        icon: z$1.ZodObject<{
            glyph: z$1.ZodString;
        }, z$1.core.$strip>;
        label: z$1.ZodObject<{
            completed: z$1.ZodString;
            pending: z$1.ZodString;
        }, z$1.core.$strip>;
        suppress: z$1.ZodOptional<z$1.ZodBoolean>;
        tint: z$1.ZodOptional<z$1.ZodObject<{
            dark: z$1.ZodString;
            light: z$1.ZodString;
        }, z$1.core.$strip>>;
        title: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>>;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    status: z$1.ZodEnum<{
        completed: "completed";
        error: "error";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    stderr: z$1.ZodNullable<z$1.ZodString>;
    stdout: z$1.ZodNullable<z$1.ZodString>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    workKind: z$1.ZodLiteral<"file-change">;
}, z$1.core.$strip>;
type TimelineFileChangeWorkRow = z$1.infer<typeof timelineFileChangeWorkRowSchema>;
declare const timelineWebSearchWorkRowSchema: z$1.ZodObject<{
    callId: z$1.ZodString;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    createdAt: z$1.ZodNumber;
    id: z$1.ZodString;
    kind: z$1.ZodLiteral<"work">;
    presentation: z$1.ZodOptional<z$1.ZodObject<{
        badge: z$1.ZodOptional<z$1.ZodObject<{
            glyph: z$1.ZodString;
            hint: z$1.ZodString;
            label: z$1.ZodString;
            tone: z$1.ZodEnum<{
                destructive: "destructive";
                neutral: "neutral";
            }>;
        }, z$1.core.$strip>>;
        detail: z$1.ZodOptional<z$1.ZodString>;
        icon: z$1.ZodObject<{
            glyph: z$1.ZodString;
        }, z$1.core.$strip>;
        label: z$1.ZodObject<{
            completed: z$1.ZodString;
            pending: z$1.ZodString;
        }, z$1.core.$strip>;
        suppress: z$1.ZodOptional<z$1.ZodBoolean>;
        tint: z$1.ZodOptional<z$1.ZodObject<{
            dark: z$1.ZodString;
            light: z$1.ZodString;
        }, z$1.core.$strip>>;
        title: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>>;
    queries: z$1.ZodArray<z$1.ZodString>;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    status: z$1.ZodEnum<{
        completed: "completed";
        error: "error";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    workKind: z$1.ZodLiteral<"web-search">;
}, z$1.core.$strip>;
type TimelineWebSearchWorkRow = z$1.infer<typeof timelineWebSearchWorkRowSchema>;
declare const timelineWebFetchWorkRowSchema: z$1.ZodObject<{
    callId: z$1.ZodString;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    createdAt: z$1.ZodNumber;
    id: z$1.ZodString;
    kind: z$1.ZodLiteral<"work">;
    pattern: z$1.ZodNullable<z$1.ZodString>;
    presentation: z$1.ZodOptional<z$1.ZodObject<{
        badge: z$1.ZodOptional<z$1.ZodObject<{
            glyph: z$1.ZodString;
            hint: z$1.ZodString;
            label: z$1.ZodString;
            tone: z$1.ZodEnum<{
                destructive: "destructive";
                neutral: "neutral";
            }>;
        }, z$1.core.$strip>>;
        detail: z$1.ZodOptional<z$1.ZodString>;
        icon: z$1.ZodObject<{
            glyph: z$1.ZodString;
        }, z$1.core.$strip>;
        label: z$1.ZodObject<{
            completed: z$1.ZodString;
            pending: z$1.ZodString;
        }, z$1.core.$strip>;
        suppress: z$1.ZodOptional<z$1.ZodBoolean>;
        tint: z$1.ZodOptional<z$1.ZodObject<{
            dark: z$1.ZodString;
            light: z$1.ZodString;
        }, z$1.core.$strip>>;
        title: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>>;
    prompt: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    status: z$1.ZodEnum<{
        completed: "completed";
        error: "error";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    url: z$1.ZodString;
    workKind: z$1.ZodLiteral<"web-fetch">;
}, z$1.core.$strip>;
type TimelineWebFetchWorkRow = z$1.infer<typeof timelineWebFetchWorkRowSchema>;
declare const timelineImageViewWorkRowSchema: z$1.ZodObject<{
    callId: z$1.ZodString;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    createdAt: z$1.ZodNumber;
    id: z$1.ZodString;
    kind: z$1.ZodLiteral<"work">;
    path: z$1.ZodString;
    presentation: z$1.ZodOptional<z$1.ZodObject<{
        badge: z$1.ZodOptional<z$1.ZodObject<{
            glyph: z$1.ZodString;
            hint: z$1.ZodString;
            label: z$1.ZodString;
            tone: z$1.ZodEnum<{
                destructive: "destructive";
                neutral: "neutral";
            }>;
        }, z$1.core.$strip>>;
        detail: z$1.ZodOptional<z$1.ZodString>;
        icon: z$1.ZodObject<{
            glyph: z$1.ZodString;
        }, z$1.core.$strip>;
        label: z$1.ZodObject<{
            completed: z$1.ZodString;
            pending: z$1.ZodString;
        }, z$1.core.$strip>;
        suppress: z$1.ZodOptional<z$1.ZodBoolean>;
        tint: z$1.ZodOptional<z$1.ZodObject<{
            dark: z$1.ZodString;
            light: z$1.ZodString;
        }, z$1.core.$strip>>;
        title: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>>;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    status: z$1.ZodEnum<{
        completed: "completed";
        error: "error";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    workKind: z$1.ZodLiteral<"image-view">;
}, z$1.core.$strip>;
type TimelineImageViewWorkRow = z$1.infer<typeof timelineImageViewWorkRowSchema>;
declare const timelineFileReadWorkRowSchema: z$1.ZodObject<{
    callId: z$1.ZodString;
    cmd: z$1.ZodNullable<z$1.ZodString>;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    createdAt: z$1.ZodNumber;
    id: z$1.ZodString;
    kind: z$1.ZodLiteral<"work">;
    path: z$1.ZodString;
    presentation: z$1.ZodOptional<z$1.ZodObject<{
        badge: z$1.ZodOptional<z$1.ZodObject<{
            glyph: z$1.ZodString;
            hint: z$1.ZodString;
            label: z$1.ZodString;
            tone: z$1.ZodEnum<{
                destructive: "destructive";
                neutral: "neutral";
            }>;
        }, z$1.core.$strip>>;
        detail: z$1.ZodOptional<z$1.ZodString>;
        icon: z$1.ZodObject<{
            glyph: z$1.ZodString;
        }, z$1.core.$strip>;
        label: z$1.ZodObject<{
            completed: z$1.ZodString;
            pending: z$1.ZodString;
        }, z$1.core.$strip>;
        suppress: z$1.ZodOptional<z$1.ZodBoolean>;
        tint: z$1.ZodOptional<z$1.ZodObject<{
            dark: z$1.ZodString;
            light: z$1.ZodString;
        }, z$1.core.$strip>>;
        title: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>>;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    status: z$1.ZodEnum<{
        completed: "completed";
        error: "error";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    workKind: z$1.ZodLiteral<"file-read">;
}, z$1.core.$strip>;
type TimelineFileReadWorkRow = z$1.infer<typeof timelineFileReadWorkRowSchema>;
declare const timelineSearchWorkRowSchema: z$1.ZodObject<{
    callId: z$1.ZodString;
    cmd: z$1.ZodNullable<z$1.ZodString>;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    createdAt: z$1.ZodNumber;
    id: z$1.ZodString;
    kind: z$1.ZodLiteral<"work">;
    mode: z$1.ZodEnum<{
        content: "content";
        list: "list";
        path: "path";
    }>;
    path: z$1.ZodNullable<z$1.ZodString>;
    presentation: z$1.ZodOptional<z$1.ZodObject<{
        badge: z$1.ZodOptional<z$1.ZodObject<{
            glyph: z$1.ZodString;
            hint: z$1.ZodString;
            label: z$1.ZodString;
            tone: z$1.ZodEnum<{
                destructive: "destructive";
                neutral: "neutral";
            }>;
        }, z$1.core.$strip>>;
        detail: z$1.ZodOptional<z$1.ZodString>;
        icon: z$1.ZodObject<{
            glyph: z$1.ZodString;
        }, z$1.core.$strip>;
        label: z$1.ZodObject<{
            completed: z$1.ZodString;
            pending: z$1.ZodString;
        }, z$1.core.$strip>;
        suppress: z$1.ZodOptional<z$1.ZodBoolean>;
        tint: z$1.ZodOptional<z$1.ZodObject<{
            dark: z$1.ZodString;
            light: z$1.ZodString;
        }, z$1.core.$strip>>;
        title: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>>;
    query: z$1.ZodString;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    status: z$1.ZodEnum<{
        completed: "completed";
        error: "error";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    workKind: z$1.ZodLiteral<"search">;
}, z$1.core.$strip>;
type TimelineSearchWorkRow = z$1.infer<typeof timelineSearchWorkRowSchema>;
declare const timelinePlanStepsWorkRowSchema: z$1.ZodObject<{
    callId: z$1.ZodString;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    createdAt: z$1.ZodNumber;
    explanation: z$1.ZodNullable<z$1.ZodString>;
    id: z$1.ZodString;
    kind: z$1.ZodLiteral<"work">;
    presentation: z$1.ZodOptional<z$1.ZodObject<{
        badge: z$1.ZodOptional<z$1.ZodObject<{
            glyph: z$1.ZodString;
            hint: z$1.ZodString;
            label: z$1.ZodString;
            tone: z$1.ZodEnum<{
                destructive: "destructive";
                neutral: "neutral";
            }>;
        }, z$1.core.$strip>>;
        detail: z$1.ZodOptional<z$1.ZodString>;
        icon: z$1.ZodObject<{
            glyph: z$1.ZodString;
        }, z$1.core.$strip>;
        label: z$1.ZodObject<{
            completed: z$1.ZodString;
            pending: z$1.ZodString;
        }, z$1.core.$strip>;
        suppress: z$1.ZodOptional<z$1.ZodBoolean>;
        tint: z$1.ZodOptional<z$1.ZodObject<{
            dark: z$1.ZodString;
            light: z$1.ZodString;
        }, z$1.core.$strip>>;
        title: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>>;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    status: z$1.ZodEnum<{
        completed: "completed";
        error: "error";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    steps: z$1.ZodArray<z$1.ZodObject<{
        status: z$1.ZodOptional<z$1.ZodEnum<{
            active: "active";
            completed: "completed";
            failed: "failed";
            pending: "pending";
        }>>;
        step: z$1.ZodString;
    }, z$1.core.$strip>>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    workKind: z$1.ZodLiteral<"plan-steps">;
}, z$1.core.$strip>;
type TimelinePlanStepsWorkRow = z$1.infer<typeof timelinePlanStepsWorkRowSchema>;
declare const timelineExtensionWorkRowSchema: z$1.ZodObject<{
    callId: z$1.ZodString;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    createdAt: z$1.ZodNumber;
    extensionKind: z$1.ZodString & z$1.ZodType<`${string}/${string}`, string, z$1.core.$ZodTypeInternals<`${string}/${string}`, string>>;
    id: z$1.ZodString;
    kind: z$1.ZodLiteral<"work">;
    payload: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
    presentation: z$1.ZodObject<{
        badge: z$1.ZodOptional<z$1.ZodObject<{
            glyph: z$1.ZodString;
            hint: z$1.ZodString;
            label: z$1.ZodString;
            tone: z$1.ZodEnum<{
                destructive: "destructive";
                neutral: "neutral";
            }>;
        }, z$1.core.$strip>>;
        detail: z$1.ZodOptional<z$1.ZodString>;
        icon: z$1.ZodObject<{
            glyph: z$1.ZodString;
        }, z$1.core.$strip>;
        label: z$1.ZodObject<{
            completed: z$1.ZodString;
            pending: z$1.ZodString;
        }, z$1.core.$strip>;
        suppress: z$1.ZodOptional<z$1.ZodBoolean>;
        tint: z$1.ZodOptional<z$1.ZodObject<{
            dark: z$1.ZodString;
            light: z$1.ZodString;
        }, z$1.core.$strip>>;
        title: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    status: z$1.ZodEnum<{
        completed: "completed";
        error: "error";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    workKind: z$1.ZodLiteral<"extension">;
}, z$1.core.$strip>;
type TimelineExtensionWorkRow = z$1.infer<typeof timelineExtensionWorkRowSchema>;
declare const timelineApprovalWorkRowSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    approvalKind: z$1.ZodLiteral<"file-edit">;
    createdAt: z$1.ZodNumber;
    id: z$1.ZodString;
    interactionId: z$1.ZodString;
    kind: z$1.ZodLiteral<"work">;
    lifecycle: z$1.ZodEnum<{
        denied: "denied";
        waiting: "waiting";
    }>;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    status: z$1.ZodEnum<{
        completed: "completed";
        error: "error";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    target: z$1.ZodObject<{
        itemId: z$1.ZodString;
        toolName: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    workKind: z$1.ZodLiteral<"approval">;
}, z$1.core.$strip>, z$1.ZodObject<{
    approvalKind: z$1.ZodLiteral<"permission-grant">;
    createdAt: z$1.ZodNumber;
    grantScope: z$1.ZodNullable<z$1.ZodEnum<{
        session: "session";
        turn: "turn";
    }>>;
    id: z$1.ZodString;
    interactionId: z$1.ZodString;
    kind: z$1.ZodLiteral<"work">;
    lifecycle: z$1.ZodEnum<{
        denied: "denied";
        granted: "granted";
        interrupted: "interrupted";
        pending: "pending";
        resolving: "resolving";
    }>;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    status: z$1.ZodEnum<{
        completed: "completed";
        error: "error";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    target: z$1.ZodObject<{
        itemId: z$1.ZodString;
        toolName: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    workKind: z$1.ZodLiteral<"approval">;
}, z$1.core.$strip>], "approvalKind">;
type TimelineApprovalWorkRow = z$1.infer<typeof timelineApprovalWorkRowSchema>;
declare const timelineQuestionWorkRowSchema: z$1.ZodObject<{
    answers: z$1.ZodNullable<z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
        freeText: z$1.ZodOptional<z$1.ZodString>;
        selected: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strip>>>;
    createdAt: z$1.ZodNumber;
    id: z$1.ZodString;
    interactionId: z$1.ZodString;
    kind: z$1.ZodLiteral<"work">;
    lifecycle: z$1.ZodEnum<{
        answered: "answered";
        interrupted: "interrupted";
        pending: "pending";
        resolving: "resolving";
    }>;
    questions: z$1.ZodArray<z$1.ZodObject<{
        allowFreeText: z$1.ZodBoolean;
        id: z$1.ZodString;
        multiSelect: z$1.ZodBoolean;
        options: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
            description: z$1.ZodOptional<z$1.ZodString>;
            label: z$1.ZodString;
            value: z$1.ZodString;
        }, z$1.core.$strip>>>;
        prompt: z$1.ZodString;
        shortLabel: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>>;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    status: z$1.ZodEnum<{
        completed: "completed";
        error: "error";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    workKind: z$1.ZodLiteral<"question">;
}, z$1.core.$strip>;
type TimelineQuestionWorkRow = z$1.infer<typeof timelineQuestionWorkRowSchema>;
interface TimelineDelegationWorkRow extends TimelineWorkRowBase {
    workKind: "delegation";
    callId: string;
    toolName: string;
    childRef: string | null;
    background: boolean;
    subagentType: string | null;
    description: string | null;
    output: string;
    completedAt: number | null;
    childRows: TimelineRow[];
    presentation?: TimelineRowPresentation;
}
declare const timelineWorkflowWorkRowSchema: z$1.ZodObject<{
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    createdAt: z$1.ZodNumber;
    description: z$1.ZodString;
    error: z$1.ZodNullable<z$1.ZodString>;
    id: z$1.ZodString;
    itemId: z$1.ZodString;
    kind: z$1.ZodLiteral<"work">;
    model: z$1.ZodNullable<z$1.ZodString>;
    presentation: z$1.ZodOptional<z$1.ZodObject<{
        badge: z$1.ZodOptional<z$1.ZodObject<{
            glyph: z$1.ZodString;
            hint: z$1.ZodString;
            label: z$1.ZodString;
            tone: z$1.ZodEnum<{
                destructive: "destructive";
                neutral: "neutral";
            }>;
        }, z$1.core.$strip>>;
        detail: z$1.ZodOptional<z$1.ZodString>;
        icon: z$1.ZodObject<{
            glyph: z$1.ZodString;
        }, z$1.core.$strip>;
        label: z$1.ZodObject<{
            completed: z$1.ZodString;
            pending: z$1.ZodString;
        }, z$1.core.$strip>;
        suppress: z$1.ZodOptional<z$1.ZodBoolean>;
        tint: z$1.ZodOptional<z$1.ZodObject<{
            dark: z$1.ZodString;
            light: z$1.ZodString;
        }, z$1.core.$strip>>;
        title: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>>;
    sourceSeqEnd: z$1.ZodNumber;
    sourceSeqStart: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    status: z$1.ZodEnum<{
        completed: "completed";
        error: "error";
        interrupted: "interrupted";
        pending: "pending";
    }>;
    summary: z$1.ZodNullable<z$1.ZodString>;
    taskStatus: z$1.ZodEnum<{
        completed: "completed";
        failed: "failed";
        killed: "killed";
        paused: "paused";
        pending: "pending";
        running: "running";
        stopped: "stopped";
    }>;
    taskType: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    usage: z$1.ZodNullable<z$1.ZodObject<{
        durationMs: z$1.ZodNumber;
        toolUses: z$1.ZodNumber;
        totalTokens: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    workKind: z$1.ZodLiteral<"workflow">;
    workflow: z$1.ZodNullable<z$1.ZodObject<{
        agents: z$1.ZodArray<z$1.ZodObject<{
            agentType: z$1.ZodOptional<z$1.ZodString>;
            attempt: z$1.ZodNumber;
            cached: z$1.ZodBoolean;
            durationMs: z$1.ZodOptional<z$1.ZodNumber>;
            error: z$1.ZodOptional<z$1.ZodString>;
            index: z$1.ZodNumber;
            isolation: z$1.ZodOptional<z$1.ZodString>;
            label: z$1.ZodString;
            lastProgressAt: z$1.ZodNumber;
            lastToolName: z$1.ZodOptional<z$1.ZodString>;
            lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
            model: z$1.ZodString;
            phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
            phaseTitle: z$1.ZodOptional<z$1.ZodString>;
            promptPreview: z$1.ZodOptional<z$1.ZodString>;
            queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
            resultPreview: z$1.ZodOptional<z$1.ZodString>;
            startedAt: z$1.ZodOptional<z$1.ZodNumber>;
            state: z$1.ZodEnum<{
                done: "done";
                failed: "failed";
                queued: "queued";
                running: "running";
                skipped: "skipped";
            }>;
            tokens: z$1.ZodOptional<z$1.ZodNumber>;
            toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
        }, z$1.core.$strip>>;
        phases: z$1.ZodArray<z$1.ZodObject<{
            index: z$1.ZodNumber;
            kind: z$1.ZodOptional<z$1.ZodString>;
            title: z$1.ZodString;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>>;
    workflowName: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type TimelineWorkflowWorkRow = z$1.infer<typeof timelineWorkflowWorkRowSchema>;
type TimelineWorkRow = TimelineCommandWorkRow | TimelineToolWorkRow | TimelineFileChangeWorkRow | TimelineWebSearchWorkRow | TimelineWebFetchWorkRow | TimelineImageViewWorkRow | TimelineFileReadWorkRow | TimelineSearchWorkRow | TimelinePlanStepsWorkRow | TimelineExtensionWorkRow | TimelineApprovalWorkRow | TimelineQuestionWorkRow | TimelineDelegationWorkRow | TimelineWorkflowWorkRow;
interface TimelineTurnRow extends TimelineRowBase {
    kind: "turn";
    turnId: string;
    status: TimelineRowStatus;
    summaryCount: number;
    completedAt: number | null;
    children: TimelineRow[] | null;
}
type TimelineSourceRow = TimelineConversationRow | TimelineWorkRow | TimelineSystemRow;
type TimelineRow = TimelineSourceRow | TimelineTurnRow;

declare const threadCreateOriginSchema: z$1.ZodEnum<{
    app: "app";
    cli: "cli";
    plugin: "plugin";
    sdk: "sdk";
}>;
type ThreadCreateOrigin = z$1.infer<typeof threadCreateOriginSchema>;
type ExecutionInputFieldSource = CallerExecutionInputSource;
declare const createExecutionInputSourcesSchema: z$1.ZodObject<{
    model: z$1.ZodOptional<z$1.ZodEnum<{
        "client-preference": "client-preference";
        explicit: "explicit";
    }>>;
    permissionMode: z$1.ZodOptional<z$1.ZodEnum<{
        "client-preference": "client-preference";
        explicit: "explicit";
    }>>;
    providerId: z$1.ZodOptional<z$1.ZodEnum<{
        "client-preference": "client-preference";
        explicit: "explicit";
    }>>;
    reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
        "client-preference": "client-preference";
        explicit: "explicit";
    }>>;
    serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
        "client-preference": "client-preference";
        explicit: "explicit";
    }>>;
}, z$1.core.$strict>;
type CreateExecutionInputSources = z$1.infer<typeof createExecutionInputSourcesSchema>;
declare const startedOnBehalfOfSchema: z$1.ZodObject<{
    initiator: z$1.ZodEnum<{
        agent: "agent";
        system: "system";
    }>;
    senderThreadId: z$1.ZodString;
}, z$1.core.$strip>;
type StartedOnBehalfOf = z$1.infer<typeof startedOnBehalfOfSchema>;
declare const createThreadRequestSchema: z$1.ZodObject<{
    environment: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        environmentId: z$1.ZodString;
        type: z$1.ZodLiteral<"reuse">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        hostId: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"host">;
        workspace: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            branch: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"existing">;
                name: z$1.ZodString;
            }, z$1.core.$strict>, z$1.ZodObject<{
                baseBranch: z$1.ZodString;
                kind: z$1.ZodLiteral<"new">;
            }, z$1.core.$strict>], "kind">>;
            path: z$1.ZodNullable<z$1.ZodString>;
            type: z$1.ZodLiteral<"unmanaged">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            baseBranch: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"named">;
                name: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"default">;
            }, z$1.core.$strip>], "kind">;
            type: z$1.ZodLiteral<"managed-worktree">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"personal">;
        }, z$1.core.$strip>], "type">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"project-default">;
    }, z$1.core.$strip>], "type">;
    executionInputSources: z$1.ZodOptional<z$1.ZodObject<{
        model: z$1.ZodOptional<z$1.ZodEnum<{
            "client-preference": "client-preference";
            explicit: "explicit";
        }>>;
        permissionMode: z$1.ZodOptional<z$1.ZodEnum<{
            "client-preference": "client-preference";
            explicit: "explicit";
        }>>;
        providerId: z$1.ZodOptional<z$1.ZodEnum<{
            "client-preference": "client-preference";
            explicit: "explicit";
        }>>;
        reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
            "client-preference": "client-preference";
            explicit: "explicit";
        }>>;
        serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
            "client-preference": "client-preference";
            explicit: "explicit";
        }>>;
    }, z$1.core.$strict>>;
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                label: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                threadId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                label: z$1.ZodString;
                projectId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                label: z$1.ZodString;
                sectionId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                entryKind: z$1.ZodEnum<{
                    directory: "directory";
                    file: "file";
                }>;
                kind: z$1.ZodLiteral<"path">;
                label: z$1.ZodString;
                path: z$1.ZodString;
                source: z$1.ZodEnum<{
                    "thread-storage": "thread-storage";
                    workspace: "workspace";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
                kind: z$1.ZodLiteral<"command">;
                label: z$1.ZodString;
                name: z$1.ZodString;
                origin: z$1.ZodEnum<{
                    builtin: "builtin";
                    project: "project";
                    user: "user";
                }>;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                kind: z$1.ZodLiteral<"plugin">;
                label: z$1.ZodString;
                pluginId: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
            start: z$1.ZodNumber;
        }, z$1.core.$strip>>>;
        text: z$1.ZodString;
        type: z$1.ZodLiteral<"text">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        path: z$1.ZodString;
        type: z$1.ZodLiteral<"localImage">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        mimeType: z$1.ZodOptional<z$1.ZodString>;
        name: z$1.ZodOptional<z$1.ZodString>;
        path: z$1.ZodString;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        type: z$1.ZodLiteral<"localFile">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>], "type">>;
    model: z$1.ZodOptional<z$1.ZodString>;
    origin: z$1.ZodEnum<{
        app: "app";
        cli: "cli";
        plugin: "plugin";
        sdk: "sdk";
    }>;
    originKind: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodEnum<{
        fork: "fork";
    }>>>;
    originPluginId: z$1.ZodOptional<z$1.ZodString>;
    parentThreadId: z$1.ZodOptional<z$1.ZodString>;
    permissionMode: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodUnion<readonly [z$1.ZodEnum<{
        "accept-edits": "accept-edits";
        auto: "auto";
        full: "full";
    }>, z$1.ZodLiteral<"workspace-write">]>, z$1.ZodTransform<"accept-edits" | "auto" | "full", "accept-edits" | "auto" | "full" | "workspace-write">>>;
    projectId: z$1.ZodString;
    providerId: z$1.ZodOptional<z$1.ZodString>;
    reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        none: "none";
        ultra: "ultra";
        ultracode: "ultracode";
        xhigh: "xhigh";
    }>>;
    sectionId: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    sendAt: z$1.ZodOptional<z$1.ZodNumber>;
    serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>>;
    sourceSeqEnd: z$1.ZodOptional<z$1.ZodNumber>;
    sourceThreadId: z$1.ZodOptional<z$1.ZodString>;
    startedOnBehalfOf: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodObject<{
        initiator: z$1.ZodEnum<{
            agent: "agent";
            system: "system";
        }>;
        senderThreadId: z$1.ZodString;
    }, z$1.core.$strip>>>;
    title: z$1.ZodOptional<z$1.ZodString>;
    visibility: z$1.ZodOptional<z$1.ZodEnum<{
        hidden: "hidden";
        visible: "visible";
    }>>;
}, z$1.core.$strip>;
type CreateThreadRequest = z$1.infer<typeof createThreadRequestSchema>;
declare const forkThreadRequestSchema: z$1.ZodObject<{
    agentContextSeed: z$1.ZodOptional<z$1.ZodArray<z$1.ZodIntersection<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                label: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                threadId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                label: z$1.ZodString;
                projectId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                label: z$1.ZodString;
                sectionId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                entryKind: z$1.ZodEnum<{
                    directory: "directory";
                    file: "file";
                }>;
                kind: z$1.ZodLiteral<"path">;
                label: z$1.ZodString;
                path: z$1.ZodString;
                source: z$1.ZodEnum<{
                    "thread-storage": "thread-storage";
                    workspace: "workspace";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
                kind: z$1.ZodLiteral<"command">;
                label: z$1.ZodString;
                name: z$1.ZodString;
                origin: z$1.ZodEnum<{
                    builtin: "builtin";
                    project: "project";
                    user: "user";
                }>;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                kind: z$1.ZodLiteral<"plugin">;
                label: z$1.ZodString;
                pluginId: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
            start: z$1.ZodNumber;
        }, z$1.core.$strip>>>;
        text: z$1.ZodString;
        type: z$1.ZodLiteral<"text">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        path: z$1.ZodString;
        type: z$1.ZodLiteral<"localImage">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        mimeType: z$1.ZodOptional<z$1.ZodString>;
        name: z$1.ZodOptional<z$1.ZodString>;
        path: z$1.ZodString;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        type: z$1.ZodLiteral<"localFile">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>], "type">, z$1.ZodObject<{
        visibility: z$1.ZodLiteral<"agent-only">;
    }, z$1.core.$strip>>>>;
    environment: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        environmentId: z$1.ZodString;
        type: z$1.ZodLiteral<"reuse">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        hostId: z$1.ZodOptional<z$1.ZodString>;
        type: z$1.ZodLiteral<"host">;
        workspace: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            branch: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"existing">;
                name: z$1.ZodString;
            }, z$1.core.$strict>, z$1.ZodObject<{
                baseBranch: z$1.ZodString;
                kind: z$1.ZodLiteral<"new">;
            }, z$1.core.$strict>], "kind">>;
            path: z$1.ZodNullable<z$1.ZodString>;
            type: z$1.ZodLiteral<"unmanaged">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            baseBranch: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"named">;
                name: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"default">;
            }, z$1.core.$strip>], "kind">;
            type: z$1.ZodLiteral<"managed-worktree">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"personal">;
        }, z$1.core.$strip>], "type">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"project-default">;
    }, z$1.core.$strip>], "type">>;
    input: z$1.ZodOptional<z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                label: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                threadId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                label: z$1.ZodString;
                projectId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                label: z$1.ZodString;
                sectionId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                entryKind: z$1.ZodEnum<{
                    directory: "directory";
                    file: "file";
                }>;
                kind: z$1.ZodLiteral<"path">;
                label: z$1.ZodString;
                path: z$1.ZodString;
                source: z$1.ZodEnum<{
                    "thread-storage": "thread-storage";
                    workspace: "workspace";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
                kind: z$1.ZodLiteral<"command">;
                label: z$1.ZodString;
                name: z$1.ZodString;
                origin: z$1.ZodEnum<{
                    builtin: "builtin";
                    project: "project";
                    user: "user";
                }>;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                kind: z$1.ZodLiteral<"plugin">;
                label: z$1.ZodString;
                pluginId: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
            start: z$1.ZodNumber;
        }, z$1.core.$strip>>>;
        text: z$1.ZodString;
        type: z$1.ZodLiteral<"text">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        path: z$1.ZodString;
        type: z$1.ZodLiteral<"localImage">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        mimeType: z$1.ZodOptional<z$1.ZodString>;
        name: z$1.ZodOptional<z$1.ZodString>;
        path: z$1.ZodString;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        type: z$1.ZodLiteral<"localFile">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>], "type">>>;
    origin: z$1.ZodDefault<z$1.ZodEnum<{
        app: "app";
        cli: "cli";
        plugin: "plugin";
        sdk: "sdk";
    }>>;
    originPluginId: z$1.ZodOptional<z$1.ZodString>;
    permissionMode: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodUnion<readonly [z$1.ZodEnum<{
        "accept-edits": "accept-edits";
        auto: "auto";
        full: "full";
    }>, z$1.ZodLiteral<"workspace-write">]>, z$1.ZodTransform<"accept-edits" | "auto" | "full", "accept-edits" | "auto" | "full" | "workspace-write">>>;
    sourceSeqEnd: z$1.ZodOptional<z$1.ZodNumber>;
    sourceThreadId: z$1.ZodString;
    title: z$1.ZodOptional<z$1.ZodString>;
    visibility: z$1.ZodDefault<z$1.ZodEnum<{
        hidden: "hidden";
        visible: "visible";
    }>>;
}, z$1.core.$strict>;
type ForkThreadRequest = z$1.infer<typeof forkThreadRequestSchema>;
declare const sendMessageRequestSchema: z$1.ZodObject<{
    executionInputSources: z$1.ZodOptional<z$1.ZodObject<{
        model: z$1.ZodOptional<z$1.ZodEnum<{
            "client-preference": "client-preference";
            explicit: "explicit";
        }>>;
        permissionMode: z$1.ZodOptional<z$1.ZodEnum<{
            "client-preference": "client-preference";
            explicit: "explicit";
        }>>;
        reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
            "client-preference": "client-preference";
            explicit: "explicit";
        }>>;
        serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
            "client-preference": "client-preference";
            explicit: "explicit";
        }>>;
    }, z$1.core.$strict>>;
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                label: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                threadId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                label: z$1.ZodString;
                projectId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                label: z$1.ZodString;
                sectionId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                entryKind: z$1.ZodEnum<{
                    directory: "directory";
                    file: "file";
                }>;
                kind: z$1.ZodLiteral<"path">;
                label: z$1.ZodString;
                path: z$1.ZodString;
                source: z$1.ZodEnum<{
                    "thread-storage": "thread-storage";
                    workspace: "workspace";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
                kind: z$1.ZodLiteral<"command">;
                label: z$1.ZodString;
                name: z$1.ZodString;
                origin: z$1.ZodEnum<{
                    builtin: "builtin";
                    project: "project";
                    user: "user";
                }>;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                kind: z$1.ZodLiteral<"plugin">;
                label: z$1.ZodString;
                pluginId: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
            start: z$1.ZodNumber;
        }, z$1.core.$strip>>>;
        text: z$1.ZodString;
        type: z$1.ZodLiteral<"text">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        path: z$1.ZodString;
        type: z$1.ZodLiteral<"localImage">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        mimeType: z$1.ZodOptional<z$1.ZodString>;
        name: z$1.ZodOptional<z$1.ZodString>;
        path: z$1.ZodString;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        type: z$1.ZodLiteral<"localFile">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>], "type">>;
    mode: z$1.ZodEnum<{
        "queue-if-active": "queue-if-active";
        "steer-if-active": "steer-if-active";
        auto: "auto";
        start: "start";
        steer: "steer";
    }>;
    model: z$1.ZodOptional<z$1.ZodString>;
    permissionMode: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodUnion<readonly [z$1.ZodEnum<{
        "accept-edits": "accept-edits";
        auto: "auto";
        full: "full";
    }>, z$1.ZodLiteral<"workspace-write">]>, z$1.ZodTransform<"accept-edits" | "auto" | "full", "accept-edits" | "auto" | "full" | "workspace-write">>>;
    reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        none: "none";
        ultra: "ultra";
        ultracode: "ultracode";
        xhigh: "xhigh";
    }>>;
    sendAt: z$1.ZodOptional<z$1.ZodNumber>;
    senderThreadId: z$1.ZodOptional<z$1.ZodString>;
    serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>>;
}, z$1.core.$strip>;
type SendMessageRequest = z$1.infer<typeof sendMessageRequestSchema>;
/**
 * A discriminated union rather than a flat record with nullable extras: a
 * `sent` message has no queued row and no wait, and modelling those as "null
 * for now" would invite every caller to check fields that cannot exist.
 */
declare const sendMessageResponseSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    delivery: z$1.ZodLiteral<"sent">;
    ok: z$1.ZodLiteral<true>;
}, z$1.core.$strip>, z$1.ZodObject<{
    delivery: z$1.ZodLiteral<"queued">;
    ok: z$1.ZodLiteral<true>;
    queuedMessage: z$1.ZodObject<{
        content: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
                end: z$1.ZodNumber;
                resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"thread">;
                    label: z$1.ZodString;
                    projectId: z$1.ZodOptional<z$1.ZodString>;
                    threadId: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"project">;
                    label: z$1.ZodString;
                    projectId: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"section">;
                    label: z$1.ZodString;
                    sectionId: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    entryKind: z$1.ZodEnum<{
                        directory: "directory";
                        file: "file";
                    }>;
                    kind: z$1.ZodLiteral<"path">;
                    label: z$1.ZodString;
                    path: z$1.ZodString;
                    source: z$1.ZodEnum<{
                        "thread-storage": "thread-storage";
                        workspace: "workspace";
                    }>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    argumentHint: z$1.ZodNullable<z$1.ZodString>;
                    kind: z$1.ZodLiteral<"command">;
                    label: z$1.ZodString;
                    name: z$1.ZodString;
                    origin: z$1.ZodEnum<{
                        builtin: "builtin";
                        project: "project";
                        user: "user";
                    }>;
                    source: z$1.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    trigger: z$1.ZodEnum<{
                        "/": "/";
                    }>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                    itemId: z$1.ZodString;
                    kind: z$1.ZodLiteral<"plugin">;
                    label: z$1.ZodString;
                    pluginId: z$1.ZodString;
                }, z$1.core.$strip>], "kind">>;
                start: z$1.ZodNumber;
            }, z$1.core.$strip>>>;
            text: z$1.ZodString;
            type: z$1.ZodLiteral<"text">;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            path: z$1.ZodString;
            type: z$1.ZodLiteral<"localImage">;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            mimeType: z$1.ZodOptional<z$1.ZodString>;
            name: z$1.ZodOptional<z$1.ZodString>;
            path: z$1.ZodString;
            sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
            type: z$1.ZodLiteral<"localFile">;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>], "type">>;
        createdAt: z$1.ZodNumber;
        editable: z$1.ZodBoolean;
        failureReason: z$1.ZodNullable<z$1.ZodString>;
        groupWithNext: z$1.ZodBoolean;
        id: z$1.ZodString;
        model: z$1.ZodString;
        payload: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"inline">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            attempt: z$1.ZodNumber;
            kind: z$1.ZodLiteral<"retry">;
            reason: z$1.ZodString;
            retryOfTurnRequestId: z$1.ZodString;
        }, z$1.core.$strip>], "kind">;
        permissionMode: z$1.ZodEnum<{
            "accept-edits": "accept-edits";
            auto: "auto";
            full: "full";
        }>;
        reasoningLevel: z$1.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            none: "none";
            ultra: "ultra";
            ultracode: "ultracode";
            xhigh: "xhigh";
        }>;
        sendAt: z$1.ZodNullable<z$1.ZodNumber>;
        serviceTier: z$1.ZodEnum<{
            default: "default";
            fast: "fast";
        }>;
        threadId: z$1.ZodString;
        updatedAt: z$1.ZodNumber;
        waitingOn: z$1.ZodNullable<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"time">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"thread-busy">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"turn-starting">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"provisioning">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            hostName: z$1.ZodString;
            kind: z$1.ZodLiteral<"host-offline">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"interaction">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"plugin">;
            pluginId: z$1.ZodString;
            reason: z$1.ZodString;
        }, z$1.core.$strip>], "kind">>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>], "delivery">;
type SendMessageResponse = z$1.infer<typeof sendMessageResponseSchema>;
declare const editMessageRequestSchema: z$1.ZodObject<{
    executionInputSources: z$1.ZodOptional<z$1.ZodObject<{
        model: z$1.ZodOptional<z$1.ZodEnum<{
            "client-preference": "client-preference";
            explicit: "explicit";
        }>>;
        permissionMode: z$1.ZodOptional<z$1.ZodEnum<{
            "client-preference": "client-preference";
            explicit: "explicit";
        }>>;
        reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
            "client-preference": "client-preference";
            explicit: "explicit";
        }>>;
        serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
            "client-preference": "client-preference";
            explicit: "explicit";
        }>>;
    }, z$1.core.$strict>>;
    expectedRequestSequence: z$1.ZodOptional<z$1.ZodNumber>;
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                label: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                threadId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                label: z$1.ZodString;
                projectId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                label: z$1.ZodString;
                sectionId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                entryKind: z$1.ZodEnum<{
                    directory: "directory";
                    file: "file";
                }>;
                kind: z$1.ZodLiteral<"path">;
                label: z$1.ZodString;
                path: z$1.ZodString;
                source: z$1.ZodEnum<{
                    "thread-storage": "thread-storage";
                    workspace: "workspace";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
                kind: z$1.ZodLiteral<"command">;
                label: z$1.ZodString;
                name: z$1.ZodString;
                origin: z$1.ZodEnum<{
                    builtin: "builtin";
                    project: "project";
                    user: "user";
                }>;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                kind: z$1.ZodLiteral<"plugin">;
                label: z$1.ZodString;
                pluginId: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
            start: z$1.ZodNumber;
        }, z$1.core.$strip>>>;
        text: z$1.ZodString;
        type: z$1.ZodLiteral<"text">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        path: z$1.ZodString;
        type: z$1.ZodLiteral<"localImage">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        mimeType: z$1.ZodOptional<z$1.ZodString>;
        name: z$1.ZodOptional<z$1.ZodString>;
        path: z$1.ZodString;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        type: z$1.ZodLiteral<"localFile">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>], "type">>;
    model: z$1.ZodOptional<z$1.ZodString>;
    operationId: z$1.ZodString;
    permissionMode: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodUnion<readonly [z$1.ZodEnum<{
        "accept-edits": "accept-edits";
        auto: "auto";
        full: "full";
    }>, z$1.ZodLiteral<"workspace-write">]>, z$1.ZodTransform<"accept-edits" | "auto" | "full", "accept-edits" | "auto" | "full" | "workspace-write">>>;
    reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        none: "none";
        ultra: "ultra";
        ultracode: "ultracode";
        xhigh: "xhigh";
    }>>;
    senderThreadId: z$1.ZodOptional<z$1.ZodString>;
    serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>>;
}, z$1.core.$strict>;
type EditMessageRequest = z$1.infer<typeof editMessageRequestSchema>;
declare const editMessageResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    operationId: z$1.ZodString;
    requestSequence: z$1.ZodNumber;
}, z$1.core.$strict>;
type EditMessageResponse = z$1.infer<typeof editMessageResponseSchema>;
/**
 * What a retry did, mirroring `sendMessageResponseSchema`: a retry is a
 * dispatch of a turn that already exists, so it is delivered or queued on
 * exactly the same terms as a send. The two retry-specific facts ride along,
 * because a caller that let the server pick the turn has no other way to learn
 * which one it picked.
 */
declare const retryTurnResponseSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    attempt: z$1.ZodNumber;
    delivery: z$1.ZodLiteral<"sent">;
    ok: z$1.ZodLiteral<true>;
    turnRequestId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    attempt: z$1.ZodNumber;
    delivery: z$1.ZodLiteral<"queued">;
    ok: z$1.ZodLiteral<true>;
    queuedMessageId: z$1.ZodString;
    sendAt: z$1.ZodNullable<z$1.ZodNumber>;
    turnRequestId: z$1.ZodString;
    waitingOn: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"time">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread-busy">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"turn-starting">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"provisioning">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        hostName: z$1.ZodString;
        kind: z$1.ZodLiteral<"host-offline">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"interaction">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin">;
        pluginId: z$1.ZodString;
        reason: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
}, z$1.core.$strip>], "delivery">;
type RetryTurnResponse = z$1.infer<typeof retryTurnResponseSchema>;
declare const createQueuedMessageRequestSchema: z$1.ZodObject<{
    executionInputSources: z$1.ZodOptional<z$1.ZodObject<{
        model: z$1.ZodOptional<z$1.ZodEnum<{
            "client-preference": "client-preference";
            explicit: "explicit";
        }>>;
        permissionMode: z$1.ZodOptional<z$1.ZodEnum<{
            "client-preference": "client-preference";
            explicit: "explicit";
        }>>;
        reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
            "client-preference": "client-preference";
            explicit: "explicit";
        }>>;
        serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
            "client-preference": "client-preference";
            explicit: "explicit";
        }>>;
    }, z$1.core.$strict>>;
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                label: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                threadId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                label: z$1.ZodString;
                projectId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                label: z$1.ZodString;
                sectionId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                entryKind: z$1.ZodEnum<{
                    directory: "directory";
                    file: "file";
                }>;
                kind: z$1.ZodLiteral<"path">;
                label: z$1.ZodString;
                path: z$1.ZodString;
                source: z$1.ZodEnum<{
                    "thread-storage": "thread-storage";
                    workspace: "workspace";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
                kind: z$1.ZodLiteral<"command">;
                label: z$1.ZodString;
                name: z$1.ZodString;
                origin: z$1.ZodEnum<{
                    builtin: "builtin";
                    project: "project";
                    user: "user";
                }>;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                kind: z$1.ZodLiteral<"plugin">;
                label: z$1.ZodString;
                pluginId: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
            start: z$1.ZodNumber;
        }, z$1.core.$strip>>>;
        text: z$1.ZodString;
        type: z$1.ZodLiteral<"text">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        path: z$1.ZodString;
        type: z$1.ZodLiteral<"localImage">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        mimeType: z$1.ZodOptional<z$1.ZodString>;
        name: z$1.ZodOptional<z$1.ZodString>;
        path: z$1.ZodString;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        type: z$1.ZodLiteral<"localFile">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>], "type">>;
    model: z$1.ZodOptional<z$1.ZodString>;
    permissionMode: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodUnion<readonly [z$1.ZodEnum<{
        "accept-edits": "accept-edits";
        auto: "auto";
        full: "full";
    }>, z$1.ZodLiteral<"workspace-write">]>, z$1.ZodTransform<"accept-edits" | "auto" | "full", "accept-edits" | "auto" | "full" | "workspace-write">>>;
    reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        none: "none";
        ultra: "ultra";
        ultracode: "ultracode";
        xhigh: "xhigh";
    }>>;
    senderThreadId: z$1.ZodOptional<z$1.ZodString>;
    serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>>;
}, z$1.core.$strip>;
type CreateQueuedMessageRequest = z$1.infer<typeof createQueuedMessageRequestSchema>;
declare const updateQueuedMessageRequestSchema: z$1.ZodObject<{
    expectedUpdatedAt: z$1.ZodNumber;
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                label: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                threadId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                label: z$1.ZodString;
                projectId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                label: z$1.ZodString;
                sectionId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                entryKind: z$1.ZodEnum<{
                    directory: "directory";
                    file: "file";
                }>;
                kind: z$1.ZodLiteral<"path">;
                label: z$1.ZodString;
                path: z$1.ZodString;
                source: z$1.ZodEnum<{
                    "thread-storage": "thread-storage";
                    workspace: "workspace";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
                kind: z$1.ZodLiteral<"command">;
                label: z$1.ZodString;
                name: z$1.ZodString;
                origin: z$1.ZodEnum<{
                    builtin: "builtin";
                    project: "project";
                    user: "user";
                }>;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                kind: z$1.ZodLiteral<"plugin">;
                label: z$1.ZodString;
                pluginId: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
            start: z$1.ZodNumber;
        }, z$1.core.$strip>>>;
        text: z$1.ZodString;
        type: z$1.ZodLiteral<"text">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        path: z$1.ZodString;
        type: z$1.ZodLiteral<"localImage">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        mimeType: z$1.ZodOptional<z$1.ZodString>;
        name: z$1.ZodOptional<z$1.ZodString>;
        path: z$1.ZodString;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        type: z$1.ZodLiteral<"localFile">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>], "type">>;
}, z$1.core.$strip>;
type UpdateQueuedMessageRequest = z$1.infer<typeof updateQueuedMessageRequestSchema>;
declare const sendQueuedMessageRequestSchema: z$1.ZodObject<{
    mode: z$1.ZodEnum<{
        auto: "auto";
        steer: "steer";
    }>;
}, z$1.core.$strip>;
type SendQueuedMessageRequest = z$1.infer<typeof sendQueuedMessageRequestSchema>;
declare const reorderQueuedMessageRequestSchema: z$1.ZodObject<{
    groupBoundaryQueuedMessageId: z$1.ZodOptional<z$1.ZodString>;
    nextQueuedMessageId: z$1.ZodNullable<z$1.ZodString>;
    previousQueuedMessageId: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type ReorderQueuedMessageRequest = z$1.infer<typeof reorderQueuedMessageRequestSchema>;
declare const setQueuedMessageGroupBoundaryRequestSchema: z$1.ZodObject<{
    expectedGroupedPrefixQueuedMessageIds: z$1.ZodArray<z$1.ZodString>;
    groupBoundaryQueuedMessageId: z$1.ZodString;
}, z$1.core.$strip>;
type SetQueuedMessageGroupBoundaryRequest = z$1.infer<typeof setQueuedMessageGroupBoundaryRequestSchema>;
declare const sendQueuedMessageResponseSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    delivery: z$1.ZodLiteral<"sent">;
    ok: z$1.ZodLiteral<true>;
}, z$1.core.$strip>, z$1.ZodObject<{
    delivery: z$1.ZodLiteral<"queued">;
    ok: z$1.ZodLiteral<true>;
    queuedMessage: z$1.ZodObject<{
        content: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
                end: z$1.ZodNumber;
                resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"thread">;
                    label: z$1.ZodString;
                    projectId: z$1.ZodOptional<z$1.ZodString>;
                    threadId: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"project">;
                    label: z$1.ZodString;
                    projectId: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"section">;
                    label: z$1.ZodString;
                    sectionId: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    entryKind: z$1.ZodEnum<{
                        directory: "directory";
                        file: "file";
                    }>;
                    kind: z$1.ZodLiteral<"path">;
                    label: z$1.ZodString;
                    path: z$1.ZodString;
                    source: z$1.ZodEnum<{
                        "thread-storage": "thread-storage";
                        workspace: "workspace";
                    }>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    argumentHint: z$1.ZodNullable<z$1.ZodString>;
                    kind: z$1.ZodLiteral<"command">;
                    label: z$1.ZodString;
                    name: z$1.ZodString;
                    origin: z$1.ZodEnum<{
                        builtin: "builtin";
                        project: "project";
                        user: "user";
                    }>;
                    source: z$1.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    trigger: z$1.ZodEnum<{
                        "/": "/";
                    }>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                    itemId: z$1.ZodString;
                    kind: z$1.ZodLiteral<"plugin">;
                    label: z$1.ZodString;
                    pluginId: z$1.ZodString;
                }, z$1.core.$strip>], "kind">>;
                start: z$1.ZodNumber;
            }, z$1.core.$strip>>>;
            text: z$1.ZodString;
            type: z$1.ZodLiteral<"text">;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            path: z$1.ZodString;
            type: z$1.ZodLiteral<"localImage">;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            mimeType: z$1.ZodOptional<z$1.ZodString>;
            name: z$1.ZodOptional<z$1.ZodString>;
            path: z$1.ZodString;
            sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
            type: z$1.ZodLiteral<"localFile">;
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
        }, z$1.core.$strip>], "type">>;
        createdAt: z$1.ZodNumber;
        editable: z$1.ZodBoolean;
        failureReason: z$1.ZodNullable<z$1.ZodString>;
        groupWithNext: z$1.ZodBoolean;
        id: z$1.ZodString;
        model: z$1.ZodString;
        payload: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"inline">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            attempt: z$1.ZodNumber;
            kind: z$1.ZodLiteral<"retry">;
            reason: z$1.ZodString;
            retryOfTurnRequestId: z$1.ZodString;
        }, z$1.core.$strip>], "kind">;
        permissionMode: z$1.ZodEnum<{
            "accept-edits": "accept-edits";
            auto: "auto";
            full: "full";
        }>;
        reasoningLevel: z$1.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            none: "none";
            ultra: "ultra";
            ultracode: "ultracode";
            xhigh: "xhigh";
        }>;
        sendAt: z$1.ZodNullable<z$1.ZodNumber>;
        serviceTier: z$1.ZodEnum<{
            default: "default";
            fast: "fast";
        }>;
        threadId: z$1.ZodString;
        updatedAt: z$1.ZodNumber;
        waitingOn: z$1.ZodNullable<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"time">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"thread-busy">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"turn-starting">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"provisioning">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            hostName: z$1.ZodString;
            kind: z$1.ZodLiteral<"host-offline">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"interaction">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"plugin">;
            pluginId: z$1.ZodString;
            reason: z$1.ZodString;
        }, z$1.core.$strip>], "kind">>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>], "delivery">;
type SendQueuedMessageResponse = z$1.infer<typeof sendQueuedMessageResponseSchema>;
declare const threadListResponseSchema: z$1.ZodArray<z$1.ZodObject<{
    activity: z$1.ZodObject<{
        activeBackgroundAgentCount: z$1.ZodNumber;
        activeBackgroundCommandCount: z$1.ZodNumber;
        activeGoalCount: z$1.ZodNumber;
        activePlanModeCount: z$1.ZodNumber;
        activeWorkflowCount: z$1.ZodNumber;
    }, z$1.core.$strip>;
    archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
    createdAt: z$1.ZodNumber;
    deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
    environmentBranchName: z$1.ZodNullable<z$1.ZodString>;
    environmentHostId: z$1.ZodNullable<z$1.ZodString>;
    environmentId: z$1.ZodNullable<z$1.ZodString>;
    environmentName: z$1.ZodNullable<z$1.ZodString>;
    environmentWorkspaceDisplayKind: z$1.ZodEnum<{
        "managed-worktree": "managed-worktree";
        "unmanaged-worktree": "unmanaged-worktree";
        other: "other";
    }>;
    hasPendingInteraction: z$1.ZodBoolean;
    id: z$1.ZodString;
    lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
    latestAttentionAt: z$1.ZodNumber;
    originKind: z$1.ZodNullable<z$1.ZodEnum<{
        fork: "fork";
    }>>;
    originPluginId: z$1.ZodNullable<z$1.ZodString>;
    parentThreadId: z$1.ZodNullable<z$1.ZodString>;
    pinSortKey: z$1.ZodNullable<z$1.ZodString>;
    pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
    projectId: z$1.ZodString;
    providerId: z$1.ZodString;
    queuedWork: z$1.ZodEnum<{
        failed: "failed";
        none: "none";
        waiting: "waiting";
    }>;
    runtime: z$1.ZodObject<{
        displayStatus: z$1.ZodEnum<{
            "host-reconnecting": "host-reconnecting";
            "waiting-for-host": "waiting-for-host";
            active: "active";
            error: "error";
            idle: "idle";
            pending: "pending";
            provisioning: "provisioning";
            starting: "starting";
            stopping: "stopping";
        }>;
        hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>;
    sectionId: z$1.ZodNullable<z$1.ZodString>;
    sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodEnum<{
        active: "active";
        error: "error";
        idle: "idle";
        pending: "pending";
        starting: "starting";
        stopping: "stopping";
    }>;
    title: z$1.ZodNullable<z$1.ZodString>;
    titleFallback: z$1.ZodNullable<z$1.ZodString>;
    updatedAt: z$1.ZodNumber;
    visibility: z$1.ZodEnum<{
        hidden: "hidden";
        visible: "visible";
    }>;
}, z$1.core.$strip>>;
type ThreadListResponse = z$1.infer<typeof threadListResponseSchema>;
declare const resolveThreadMentionsRequestSchema: z$1.ZodObject<{
    threadIds: z$1.ZodArray<z$1.ZodString>;
}, z$1.core.$strict>;
type ResolveThreadMentionsRequest = z$1.infer<typeof resolveThreadMentionsRequestSchema>;
declare const resolveThreadMentionsResponseSchema: z$1.ZodArray<z$1.ZodObject<{
    label: z$1.ZodString;
    projectId: z$1.ZodString;
    threadId: z$1.ZodString;
}, z$1.core.$strict>>;
type ResolveThreadMentionsResponse = z$1.infer<typeof resolveThreadMentionsResponseSchema>;
declare const threadSearchResponseSchema: z$1.ZodObject<{
    active: z$1.ZodObject<{
        results: z$1.ZodArray<z$1.ZodObject<{
            matches: z$1.ZodArray<z$1.ZodObject<{
                highlightRanges: z$1.ZodArray<z$1.ZodObject<{
                    end: z$1.ZodNumber;
                    start: z$1.ZodNumber;
                }, z$1.core.$strict>>;
                sourceKind: z$1.ZodEnum<{
                    assistant_message: "assistant_message";
                    system_message: "system_message";
                    title: "title";
                    title_fallback: "title_fallback";
                    user_message: "user_message";
                }>;
                sourceSeq: z$1.ZodNullable<z$1.ZodNumber>;
                text: z$1.ZodString;
            }, z$1.core.$strict>>;
            thread: z$1.ZodObject<{
                activity: z$1.ZodObject<{
                    activeBackgroundAgentCount: z$1.ZodNumber;
                    activeBackgroundCommandCount: z$1.ZodNumber;
                    activeGoalCount: z$1.ZodNumber;
                    activePlanModeCount: z$1.ZodNumber;
                    activeWorkflowCount: z$1.ZodNumber;
                }, z$1.core.$strip>;
                archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
                createdAt: z$1.ZodNumber;
                deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
                environmentBranchName: z$1.ZodNullable<z$1.ZodString>;
                environmentHostId: z$1.ZodNullable<z$1.ZodString>;
                environmentId: z$1.ZodNullable<z$1.ZodString>;
                environmentName: z$1.ZodNullable<z$1.ZodString>;
                environmentWorkspaceDisplayKind: z$1.ZodEnum<{
                    "managed-worktree": "managed-worktree";
                    "unmanaged-worktree": "unmanaged-worktree";
                    other: "other";
                }>;
                hasPendingInteraction: z$1.ZodBoolean;
                id: z$1.ZodString;
                lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
                latestAttentionAt: z$1.ZodNumber;
                originKind: z$1.ZodNullable<z$1.ZodEnum<{
                    fork: "fork";
                }>>;
                originPluginId: z$1.ZodNullable<z$1.ZodString>;
                parentThreadId: z$1.ZodNullable<z$1.ZodString>;
                pinSortKey: z$1.ZodNullable<z$1.ZodString>;
                pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
                projectId: z$1.ZodString;
                providerId: z$1.ZodString;
                queuedWork: z$1.ZodEnum<{
                    failed: "failed";
                    none: "none";
                    waiting: "waiting";
                }>;
                runtime: z$1.ZodObject<{
                    displayStatus: z$1.ZodEnum<{
                        "host-reconnecting": "host-reconnecting";
                        "waiting-for-host": "waiting-for-host";
                        active: "active";
                        error: "error";
                        idle: "idle";
                        pending: "pending";
                        provisioning: "provisioning";
                        starting: "starting";
                        stopping: "stopping";
                    }>;
                    hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
                }, z$1.core.$strip>;
                sectionId: z$1.ZodNullable<z$1.ZodString>;
                sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
                status: z$1.ZodEnum<{
                    active: "active";
                    error: "error";
                    idle: "idle";
                    pending: "pending";
                    starting: "starting";
                    stopping: "stopping";
                }>;
                title: z$1.ZodNullable<z$1.ZodString>;
                titleFallback: z$1.ZodNullable<z$1.ZodString>;
                updatedAt: z$1.ZodNumber;
                visibility: z$1.ZodEnum<{
                    hidden: "hidden";
                    visible: "visible";
                }>;
            }, z$1.core.$strip>;
        }, z$1.core.$strict>>;
        total: z$1.ZodNumber;
    }, z$1.core.$strict>;
    archived: z$1.ZodObject<{
        results: z$1.ZodArray<z$1.ZodObject<{
            matches: z$1.ZodArray<z$1.ZodObject<{
                highlightRanges: z$1.ZodArray<z$1.ZodObject<{
                    end: z$1.ZodNumber;
                    start: z$1.ZodNumber;
                }, z$1.core.$strict>>;
                sourceKind: z$1.ZodEnum<{
                    assistant_message: "assistant_message";
                    system_message: "system_message";
                    title: "title";
                    title_fallback: "title_fallback";
                    user_message: "user_message";
                }>;
                sourceSeq: z$1.ZodNullable<z$1.ZodNumber>;
                text: z$1.ZodString;
            }, z$1.core.$strict>>;
            thread: z$1.ZodObject<{
                activity: z$1.ZodObject<{
                    activeBackgroundAgentCount: z$1.ZodNumber;
                    activeBackgroundCommandCount: z$1.ZodNumber;
                    activeGoalCount: z$1.ZodNumber;
                    activePlanModeCount: z$1.ZodNumber;
                    activeWorkflowCount: z$1.ZodNumber;
                }, z$1.core.$strip>;
                archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
                createdAt: z$1.ZodNumber;
                deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
                environmentBranchName: z$1.ZodNullable<z$1.ZodString>;
                environmentHostId: z$1.ZodNullable<z$1.ZodString>;
                environmentId: z$1.ZodNullable<z$1.ZodString>;
                environmentName: z$1.ZodNullable<z$1.ZodString>;
                environmentWorkspaceDisplayKind: z$1.ZodEnum<{
                    "managed-worktree": "managed-worktree";
                    "unmanaged-worktree": "unmanaged-worktree";
                    other: "other";
                }>;
                hasPendingInteraction: z$1.ZodBoolean;
                id: z$1.ZodString;
                lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
                latestAttentionAt: z$1.ZodNumber;
                originKind: z$1.ZodNullable<z$1.ZodEnum<{
                    fork: "fork";
                }>>;
                originPluginId: z$1.ZodNullable<z$1.ZodString>;
                parentThreadId: z$1.ZodNullable<z$1.ZodString>;
                pinSortKey: z$1.ZodNullable<z$1.ZodString>;
                pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
                projectId: z$1.ZodString;
                providerId: z$1.ZodString;
                queuedWork: z$1.ZodEnum<{
                    failed: "failed";
                    none: "none";
                    waiting: "waiting";
                }>;
                runtime: z$1.ZodObject<{
                    displayStatus: z$1.ZodEnum<{
                        "host-reconnecting": "host-reconnecting";
                        "waiting-for-host": "waiting-for-host";
                        active: "active";
                        error: "error";
                        idle: "idle";
                        pending: "pending";
                        provisioning: "provisioning";
                        starting: "starting";
                        stopping: "stopping";
                    }>;
                    hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
                }, z$1.core.$strip>;
                sectionId: z$1.ZodNullable<z$1.ZodString>;
                sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
                status: z$1.ZodEnum<{
                    active: "active";
                    error: "error";
                    idle: "idle";
                    pending: "pending";
                    starting: "starting";
                    stopping: "stopping";
                }>;
                title: z$1.ZodNullable<z$1.ZodString>;
                titleFallback: z$1.ZodNullable<z$1.ZodString>;
                updatedAt: z$1.ZodNumber;
                visibility: z$1.ZodEnum<{
                    hidden: "hidden";
                    visible: "visible";
                }>;
            }, z$1.core.$strip>;
        }, z$1.core.$strict>>;
        total: z$1.ZodNumber;
    }, z$1.core.$strict>;
}, z$1.core.$strict>;
type ThreadSearchResponse = z$1.infer<typeof threadSearchResponseSchema>;
declare const threadResponseSchema: z$1.ZodObject<{
    activeBackgroundAgentCount: z$1.ZodNumber;
    archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
    canSpawnChild: z$1.ZodBoolean;
    createdAt: z$1.ZodNumber;
    deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
    environmentId: z$1.ZodNullable<z$1.ZodString>;
    id: z$1.ZodString;
    lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
    latestAttentionAt: z$1.ZodNumber;
    originKind: z$1.ZodNullable<z$1.ZodEnum<{
        fork: "fork";
    }>>;
    originPluginId: z$1.ZodNullable<z$1.ZodString>;
    parentThreadId: z$1.ZodNullable<z$1.ZodString>;
    pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
    projectId: z$1.ZodString;
    providerId: z$1.ZodString;
    queuedMessageCount: z$1.ZodNumber;
    runtime: z$1.ZodObject<{
        displayStatus: z$1.ZodEnum<{
            "host-reconnecting": "host-reconnecting";
            "waiting-for-host": "waiting-for-host";
            active: "active";
            error: "error";
            idle: "idle";
            pending: "pending";
            provisioning: "provisioning";
            starting: "starting";
            stopping: "stopping";
        }>;
        hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>;
    sectionId: z$1.ZodNullable<z$1.ZodString>;
    sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodEnum<{
        active: "active";
        error: "error";
        idle: "idle";
        pending: "pending";
        starting: "starting";
        stopping: "stopping";
    }>;
    title: z$1.ZodNullable<z$1.ZodString>;
    titleFallback: z$1.ZodNullable<z$1.ZodString>;
    updatedAt: z$1.ZodNumber;
    visibility: z$1.ZodEnum<{
        hidden: "hidden";
        visible: "visible";
    }>;
}, z$1.core.$strip>;
type ThreadResponse = z$1.infer<typeof threadResponseSchema>;
declare const threadGetQuerySchema: z$1.ZodObject<{
    include: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ThreadGetQuery = z$1.infer<typeof threadGetQuerySchema>;
declare const threadWithIncludesResponseSchema: z$1.ZodObject<{
    activeBackgroundAgentCount: z$1.ZodNumber;
    archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
    canSpawnChild: z$1.ZodBoolean;
    createdAt: z$1.ZodNumber;
    deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
    environment: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodObject<{
        baseBranch: z$1.ZodNullable<z$1.ZodString>;
        branchName: z$1.ZodNullable<z$1.ZodString>;
        createdAt: z$1.ZodNumber;
        defaultBranch: z$1.ZodNullable<z$1.ZodString>;
        hostId: z$1.ZodString;
        id: z$1.ZodString;
        isGitRepo: z$1.ZodBoolean;
        isWorktree: z$1.ZodBoolean;
        managed: z$1.ZodBoolean;
        mergeBaseBranch: z$1.ZodNullable<z$1.ZodString>;
        name: z$1.ZodNullable<z$1.ZodString>;
        path: z$1.ZodNullable<z$1.ZodString>;
        projectId: z$1.ZodString;
        status: z$1.ZodEnum<{
            destroyed: "destroyed";
            destroying: "destroying";
            error: "error";
            provisioning: "provisioning";
            ready: "ready";
            retiring: "retiring";
        }>;
        updatedAt: z$1.ZodNumber;
        workspaceProvisionType: z$1.ZodEnum<{
            "managed-worktree": "managed-worktree";
            personal: "personal";
            unmanaged: "unmanaged";
        }>;
    }, z$1.core.$strip>>>;
    environmentId: z$1.ZodNullable<z$1.ZodString>;
    host: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodObject<{
        createdAt: z$1.ZodNumber;
        id: z$1.ZodString;
        lastRejectedProtocolVersion: z$1.ZodNullable<z$1.ZodNumber>;
        lastSeenAt: z$1.ZodNullable<z$1.ZodNumber>;
        maxPermissionMode: z$1.ZodEnum<{
            "accept-edits": "accept-edits";
            auto: "auto";
            full: "full";
        }>;
        name: z$1.ZodString;
        status: z$1.ZodEnum<{
            connected: "connected";
            disconnected: "disconnected";
        }>;
        type: z$1.ZodEnum<{
            persistent: "persistent";
        }>;
        updatedAt: z$1.ZodNumber;
    }, z$1.core.$strip>>>;
    id: z$1.ZodString;
    lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
    latestAttentionAt: z$1.ZodNumber;
    originKind: z$1.ZodNullable<z$1.ZodEnum<{
        fork: "fork";
    }>>;
    originPluginId: z$1.ZodNullable<z$1.ZodString>;
    parentThreadId: z$1.ZodNullable<z$1.ZodString>;
    pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
    projectId: z$1.ZodString;
    providerId: z$1.ZodString;
    queuedMessageCount: z$1.ZodNumber;
    runtime: z$1.ZodObject<{
        displayStatus: z$1.ZodEnum<{
            "host-reconnecting": "host-reconnecting";
            "waiting-for-host": "waiting-for-host";
            active: "active";
            error: "error";
            idle: "idle";
            pending: "pending";
            provisioning: "provisioning";
            starting: "starting";
            stopping: "stopping";
        }>;
        hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>;
    sectionId: z$1.ZodNullable<z$1.ZodString>;
    sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodEnum<{
        active: "active";
        error: "error";
        idle: "idle";
        pending: "pending";
        starting: "starting";
        stopping: "stopping";
    }>;
    title: z$1.ZodNullable<z$1.ZodString>;
    titleFallback: z$1.ZodNullable<z$1.ZodString>;
    updatedAt: z$1.ZodNumber;
    visibility: z$1.ZodEnum<{
        hidden: "hidden";
        visible: "visible";
    }>;
}, z$1.core.$strip>;
type ThreadWithIncludesResponse = z$1.infer<typeof threadWithIncludesResponseSchema>;
declare const threadPendingInteractionsResponseSchema: z$1.ZodArray<z$1.ZodUnion<readonly [z$1.ZodUnion<readonly [z$1.ZodObject<{
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    id: z$1.ZodString;
    origin: z$1.ZodOptional<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"provider">;
        providerId: z$1.ZodString;
        providerRequestId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
    }, z$1.core.$strip>>;
    payload: z$1.ZodObject<{
        availableDecisions: z$1.ZodArray<z$1.ZodEnum<{
            allow_for_session: "allow_for_session";
            allow_once: "allow_once";
            deny: "deny";
        }>>;
        kind: z$1.ZodLiteral<"approval">;
        reason: z$1.ZodNullable<z$1.ZodString>;
        subject: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            actions: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                command: z$1.ZodString;
                name: z$1.ZodString;
                path: z$1.ZodString;
                type: z$1.ZodLiteral<"read">;
            }, z$1.core.$strip>, z$1.ZodObject<{
                command: z$1.ZodString;
                path: z$1.ZodNullable<z$1.ZodString>;
                type: z$1.ZodLiteral<"listFiles">;
            }, z$1.core.$strip>, z$1.ZodObject<{
                command: z$1.ZodString;
                path: z$1.ZodNullable<z$1.ZodString>;
                query: z$1.ZodNullable<z$1.ZodString>;
                type: z$1.ZodLiteral<"search">;
            }, z$1.core.$strip>, z$1.ZodObject<{
                command: z$1.ZodString;
                type: z$1.ZodLiteral<"unknown">;
            }, z$1.core.$strip>], "type">>;
            command: z$1.ZodString;
            cwd: z$1.ZodNullable<z$1.ZodString>;
            itemId: z$1.ZodString;
            kind: z$1.ZodLiteral<"command">;
            sessionGrant: z$1.ZodNullable<z$1.ZodObject<{
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            itemId: z$1.ZodString;
            kind: z$1.ZodLiteral<"file_change">;
            sessionGrant: z$1.ZodNullable<z$1.ZodObject<{
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
            writeScope: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            itemId: z$1.ZodString;
            kind: z$1.ZodLiteral<"permission_grant">;
            permissions: z$1.ZodObject<{
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>;
            toolName: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            itemId: z$1.ZodString;
            kind: z$1.ZodLiteral<"plan">;
            plan: z$1.ZodString;
            planFilePath: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            itemId: z$1.ZodString;
            kind: z$1.ZodLiteral<"tool_use">;
            presentation: z$1.ZodObject<{
                badge: z$1.ZodOptional<z$1.ZodObject<{
                    glyph: z$1.ZodString;
                    hint: z$1.ZodString;
                    label: z$1.ZodString;
                    tone: z$1.ZodEnum<{
                        destructive: "destructive";
                        neutral: "neutral";
                    }>;
                }, z$1.core.$strip>>;
                detail: z$1.ZodOptional<z$1.ZodString>;
                icon: z$1.ZodObject<{
                    glyph: z$1.ZodString;
                }, z$1.core.$strip>;
                label: z$1.ZodObject<{
                    completed: z$1.ZodString;
                    pending: z$1.ZodString;
                }, z$1.core.$strip>;
                suppress: z$1.ZodOptional<z$1.ZodBoolean>;
                tint: z$1.ZodOptional<z$1.ZodObject<{
                    dark: z$1.ZodString;
                    light: z$1.ZodString;
                }, z$1.core.$strip>>;
                title: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>;
            tool: z$1.ZodString;
        }, z$1.core.$strip>], "kind">;
    }, z$1.core.$strip>;
    providerId: z$1.ZodString;
    providerRequestId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    resolution: z$1.ZodNullable<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_once">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_for_session">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"deny">;
    }, z$1.core.$strip>], "decision">>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    status: z$1.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolved: "resolved";
        resolving: "resolving";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    id: z$1.ZodString;
    origin: z$1.ZodOptional<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"provider">;
        providerId: z$1.ZodString;
        providerRequestId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
    }, z$1.core.$strip>>;
    payload: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"user_question">;
        questions: z$1.ZodArray<z$1.ZodObject<{
            allowFreeText: z$1.ZodBoolean;
            id: z$1.ZodString;
            multiSelect: z$1.ZodBoolean;
            options: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
                description: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
                value: z$1.ZodString;
            }, z$1.core.$strip>>>;
            prompt: z$1.ZodString;
            shortLabel: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>;
    providerId: z$1.ZodString;
    providerRequestId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    resolution: z$1.ZodNullable<z$1.ZodObject<{
        answers: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
            freeText: z$1.ZodOptional<z$1.ZodString>;
            selected: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strip>>;
        kind: z$1.ZodLiteral<"user_answer">;
    }, z$1.core.$strip>>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    status: z$1.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolved: "resolved";
        resolving: "resolving";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    id: z$1.ZodString;
    origin: z$1.ZodOptional<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"provider">;
        providerId: z$1.ZodString;
        providerRequestId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
    }, z$1.core.$strip>>;
    payload: z$1.ZodObject<{
        data: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
        kind: z$1.ZodString & z$1.ZodType<`${string}/${string}`, string, z$1.core.$ZodTypeInternals<`${string}/${string}`, string>>;
        title: z$1.ZodString;
    }, z$1.core.$strip>;
    providerId: z$1.ZodString;
    providerRequestId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    resolution: z$1.ZodNullable<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"request_answer">;
        value: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
    }, z$1.core.$strip>>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    status: z$1.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolved: "resolved";
        resolving: "resolving";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodString;
}, z$1.core.$strip>]>, z$1.ZodObject<{
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    id: z$1.ZodString;
    origin: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin">;
        pluginId: z$1.ZodString;
        rendererId: z$1.ZodString;
    }, z$1.core.$strip>;
    payload: z$1.ZodObject<{
        data: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
        kind: z$1.ZodLiteral<"plugin">;
        title: z$1.ZodString;
    }, z$1.core.$strip>;
    resolution: z$1.ZodNullable<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin_submitted">;
    }, z$1.core.$strip>>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    status: z$1.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolved: "resolved";
        resolving: "resolving";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>]>>;
type ThreadPendingInteractionsResponse = z$1.infer<typeof threadPendingInteractionsResponseSchema>;
declare const threadQueuedMessageListResponseSchema: z$1.ZodArray<z$1.ZodObject<{
    content: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                label: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                threadId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                label: z$1.ZodString;
                projectId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                label: z$1.ZodString;
                sectionId: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                entryKind: z$1.ZodEnum<{
                    directory: "directory";
                    file: "file";
                }>;
                kind: z$1.ZodLiteral<"path">;
                label: z$1.ZodString;
                path: z$1.ZodString;
                source: z$1.ZodEnum<{
                    "thread-storage": "thread-storage";
                    workspace: "workspace";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
                kind: z$1.ZodLiteral<"command">;
                label: z$1.ZodString;
                name: z$1.ZodString;
                origin: z$1.ZodEnum<{
                    builtin: "builtin";
                    project: "project";
                    user: "user";
                }>;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                kind: z$1.ZodLiteral<"plugin">;
                label: z$1.ZodString;
                pluginId: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
            start: z$1.ZodNumber;
        }, z$1.core.$strip>>>;
        text: z$1.ZodString;
        type: z$1.ZodLiteral<"text">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        path: z$1.ZodString;
        type: z$1.ZodLiteral<"localImage">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        mimeType: z$1.ZodOptional<z$1.ZodString>;
        name: z$1.ZodOptional<z$1.ZodString>;
        path: z$1.ZodString;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        type: z$1.ZodLiteral<"localFile">;
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
    }, z$1.core.$strip>], "type">>;
    createdAt: z$1.ZodNumber;
    editable: z$1.ZodBoolean;
    failureReason: z$1.ZodNullable<z$1.ZodString>;
    groupWithNext: z$1.ZodBoolean;
    id: z$1.ZodString;
    model: z$1.ZodString;
    payload: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"inline">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        attempt: z$1.ZodNumber;
        kind: z$1.ZodLiteral<"retry">;
        reason: z$1.ZodString;
        retryOfTurnRequestId: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
    permissionMode: z$1.ZodEnum<{
        "accept-edits": "accept-edits";
        auto: "auto";
        full: "full";
    }>;
    reasoningLevel: z$1.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        none: "none";
        ultra: "ultra";
        ultracode: "ultracode";
        xhigh: "xhigh";
    }>;
    sendAt: z$1.ZodNullable<z$1.ZodNumber>;
    serviceTier: z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>;
    threadId: z$1.ZodString;
    updatedAt: z$1.ZodNumber;
    waitingOn: z$1.ZodNullable<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"time">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread-busy">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"turn-starting">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"provisioning">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        hostName: z$1.ZodString;
        kind: z$1.ZodLiteral<"host-offline">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"interaction">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin">;
        pluginId: z$1.ZodString;
        reason: z$1.ZodString;
    }, z$1.core.$strip>], "kind">>;
}, z$1.core.$strip>>;
type ThreadQueuedMessageListResponse = z$1.infer<typeof threadQueuedMessageListResponseSchema>;
declare const threadChildSummaryResponseSchema: z$1.ZodObject<{
    nonDeletedChildCount: z$1.ZodNumber;
}, z$1.core.$strip>;
type ThreadChildSummaryResponse = z$1.infer<typeof threadChildSummaryResponseSchema>;
declare const deleteThreadRequestSchema: z$1.ZodObject<{
    childThreadsConfirmed: z$1.ZodBoolean;
}, z$1.core.$strip>;
type DeleteThreadRequest = z$1.infer<typeof deleteThreadRequestSchema>;
declare const updateThreadRequestSchema: z$1.ZodObject<{
    model: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    parentThreadId: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    reasoningLevel: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        none: "none";
        ultra: "ultra";
        ultracode: "ultracode";
        xhigh: "xhigh";
    }>>>;
    sectionId: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    title: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    visibility: z$1.ZodOptional<z$1.ZodEnum<{
        hidden: "hidden";
        visible: "visible";
    }>>;
}, z$1.core.$strip>;
type UpdateThreadRequest = z$1.infer<typeof updateThreadRequestSchema>;
declare const reorderPinnedThreadRequestSchema: z$1.ZodObject<{
    nextThreadId: z$1.ZodNullable<z$1.ZodString>;
    previousThreadId: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type ReorderPinnedThreadRequest = z$1.infer<typeof reorderPinnedThreadRequestSchema>;
declare const threadOpenSplitSchema: z$1.ZodEnum<{
    down: "down";
    left: "left";
    replace: "replace";
    right: "right";
    top: "top";
}>;
type ThreadOpenSplit = z$1.infer<typeof threadOpenSplitSchema>;
declare const threadOpenFileSchema: z$1.ZodObject<{
    lineNumber: z$1.ZodNullable<z$1.ZodNumber>;
    path: z$1.ZodString;
    source: z$1.ZodEnum<{
        "thread-storage": "thread-storage";
        workspace: "workspace";
    }>;
}, z$1.core.$strict>;
type ThreadOpenFile = z$1.infer<typeof threadOpenFileSchema>;
declare const threadOpenResponseSchema: z$1.ZodObject<{
    delivered: z$1.ZodNumber;
}, z$1.core.$strip>;
type ThreadOpenResponse = z$1.infer<typeof threadOpenResponseSchema>;
declare const threadPaneActionSchema: z$1.ZodEnum<{
    "clear-spotlight": "clear-spotlight";
    maximize: "maximize";
    restore: "restore";
    spotlight: "spotlight";
    toggle: "toggle";
}>;
type ThreadPaneAction = z$1.infer<typeof threadPaneActionSchema>;
declare const threadPaneActionResponseSchema: z$1.ZodObject<{
    delivered: z$1.ZodNumber;
}, z$1.core.$strip>;
type ThreadPaneActionResponse = z$1.infer<typeof threadPaneActionResponseSchema>;
declare const threadArchiveAllResponseSchema: z$1.ZodObject<{
    archivedThreadIds: z$1.ZodArray<z$1.ZodString>;
    ok: z$1.ZodLiteral<true>;
}, z$1.core.$strip>;
type ThreadArchiveAllResponse = z$1.infer<typeof threadArchiveAllResponseSchema>;
declare const threadListQuerySchema: z$1.ZodObject<{
    archived: z$1.ZodOptional<z$1.ZodEnum<{
        false: "false";
        true: "true";
    }>>;
    hasParent: z$1.ZodOptional<z$1.ZodEnum<{
        false: "false";
        true: "true";
    }>>;
    includeHidden: z$1.ZodOptional<z$1.ZodEnum<{
        false: "false";
        true: "true";
    }>>;
    limit: z$1.ZodOptional<z$1.ZodString>;
    offset: z$1.ZodOptional<z$1.ZodString>;
    originKind: z$1.ZodOptional<z$1.ZodEnum<{
        fork: "fork";
    }>>;
    originPluginId: z$1.ZodOptional<z$1.ZodString>;
    parentThreadId: z$1.ZodOptional<z$1.ZodString>;
    projectId: z$1.ZodOptional<z$1.ZodString>;
    sectionId: z$1.ZodOptional<z$1.ZodString>;
    sourceThreadId: z$1.ZodOptional<z$1.ZodString>;
    unsectioned: z$1.ZodOptional<z$1.ZodEnum<{
        false: "false";
        true: "true";
    }>>;
}, z$1.core.$strip>;
type ThreadListQuery = z$1.infer<typeof threadListQuerySchema>;
/**
 * Grouping for `GET /threads/count`. Omitted, the route answers one total.
 * `host` groups by the host the thread's environment lives on; a thread with
 * no environment yet counts under the `null` key.
 */
declare const threadCountGroupBySchema: z$1.ZodEnum<{
    host: "host";
    project: "project";
    provider: "provider";
}>;
type ThreadCountGroupBy = z$1.infer<typeof threadCountGroupBySchema>;
/**
 * `total` is always the count of every matching thread. `groups` is present
 * exactly when `groupBy` was requested — an ungrouped count has no group list,
 * rather than one anonymous group.
 */
declare const threadCountResponseSchema: z$1.ZodObject<{
    groups: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
        count: z$1.ZodNumber;
        key: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>>;
    total: z$1.ZodNumber;
}, z$1.core.$strip>;
type ThreadCountResponse = z$1.infer<typeof threadCountResponseSchema>;
declare const threadRunningResponseSchema: z$1.ZodArray<z$1.ZodObject<{
    hostId: z$1.ZodNullable<z$1.ZodString>;
    id: z$1.ZodString;
}, z$1.core.$strip>>;
type ThreadRunningResponse = z$1.infer<typeof threadRunningResponseSchema>;
declare const threadSearchQuerySchema: z$1.ZodObject<{
    limitPerGroup: z$1.ZodOptional<z$1.ZodString>;
    query: z$1.ZodString;
}, z$1.core.$strip>;
type ThreadSearchQuery = z$1.infer<typeof threadSearchQuerySchema>;
declare const threadTimelineQuerySchema: z$1.ZodObject<{
    afterSequence: z$1.ZodOptional<z$1.ZodString>;
    beforeAnchorId: z$1.ZodOptional<z$1.ZodString>;
    beforeAnchorSeq: z$1.ZodOptional<z$1.ZodString>;
    includeNestedRows: z$1.ZodOptional<z$1.ZodEnum<{
        false: "false";
        true: "true";
    }>>;
    segmentLimit: z$1.ZodOptional<z$1.ZodString>;
    summaryOnly: z$1.ZodOptional<z$1.ZodEnum<{
        false: "false";
        true: "true";
    }>>;
}, z$1.core.$strip>;
type ThreadTimelineQuery = z$1.infer<typeof threadTimelineQuerySchema>;
declare const timelineTurnSummaryDetailsQuerySchema: z$1.ZodObject<{
    sourceSeqEnd: z$1.ZodString;
    sourceSeqStart: z$1.ZodString;
    turnId: z$1.ZodString;
}, z$1.core.$strip>;
type TimelineTurnSummaryDetailsQuery = z$1.infer<typeof timelineTurnSummaryDetailsQuerySchema>;
declare const threadStorageFilesQuerySchema: z$1.ZodObject<{
    limit: z$1.ZodOptional<z$1.ZodString>;
    query: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ThreadStorageFilesQuery = z$1.infer<typeof threadStorageFilesQuerySchema>;
declare const threadStoragePathsQuerySchema: z$1.ZodObject<{
    includeDirectories: z$1.ZodEnum<{
        false: "false";
        true: "true";
    }>;
    includeFiles: z$1.ZodEnum<{
        false: "false";
        true: "true";
    }>;
    limit: z$1.ZodOptional<z$1.ZodString>;
    query: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ThreadStoragePathsQuery = z$1.infer<typeof threadStoragePathsQuerySchema>;
declare const threadStorageLocationResponseSchema: z$1.ZodObject<{
    hostId: z$1.ZodString;
    storageRootPath: z$1.ZodString;
}, z$1.core.$strict>;
type ThreadStorageLocationResponse = z$1.infer<typeof threadStorageLocationResponseSchema>;
declare const timelineTurnSummaryDetailsResponseSchema: z$1.ZodObject<{
    rows: z$1.ZodArray<z$1.ZodType<TimelineRow, unknown, z$1.core.$ZodTypeInternals<TimelineRow, unknown>>>;
}, z$1.core.$strip>;
type TimelineTurnSummaryDetailsResponse = z$1.infer<typeof timelineTurnSummaryDetailsResponseSchema>;
declare const threadTimelineResponseSchema: z$1.ZodObject<{
    activeBackgroundCommands: z$1.ZodArray<z$1.ZodObject<{
        completedAt: z$1.ZodNullable<z$1.ZodNumber>;
        createdAt: z$1.ZodNumber;
        description: z$1.ZodString;
        error: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        itemId: z$1.ZodString;
        kind: z$1.ZodLiteral<"work">;
        model: z$1.ZodNullable<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        sourceSeqEnd: z$1.ZodNumber;
        sourceSeqStart: z$1.ZodNumber;
        startedAt: z$1.ZodNumber;
        status: z$1.ZodEnum<{
            completed: "completed";
            error: "error";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        summary: z$1.ZodNullable<z$1.ZodString>;
        taskStatus: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            killed: "killed";
            paused: "paused";
            pending: "pending";
            running: "running";
            stopped: "stopped";
        }>;
        taskType: z$1.ZodString;
        threadId: z$1.ZodString;
        turnId: z$1.ZodNullable<z$1.ZodString>;
        usage: z$1.ZodNullable<z$1.ZodObject<{
            durationMs: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            totalTokens: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        workKind: z$1.ZodLiteral<"workflow">;
        workflow: z$1.ZodNullable<z$1.ZodObject<{
            agents: z$1.ZodArray<z$1.ZodObject<{
                agentType: z$1.ZodOptional<z$1.ZodString>;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
                error: z$1.ZodOptional<z$1.ZodString>;
                index: z$1.ZodNumber;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
                lastProgressAt: z$1.ZodNumber;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                model: z$1.ZodString;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                state: z$1.ZodEnum<{
                    done: "done";
                    failed: "failed";
                    queued: "queued";
                    running: "running";
                    skipped: "skipped";
                }>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                kind: z$1.ZodOptional<z$1.ZodString>;
                title: z$1.ZodString;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        workflowName: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>;
    activePromptMode: z$1.ZodNullable<z$1.ZodObject<{
        mode: z$1.ZodLiteral<"plan">;
        prompt: z$1.ZodString;
        providerId: z$1.ZodString;
    }, z$1.core.$strict>>;
    activeThinking: z$1.ZodNullable<z$1.ZodObject<{
        id: z$1.ZodString;
        startedAt: z$1.ZodNumber;
        text: z$1.ZodString;
        updatedAt: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    activeWorkflows: z$1.ZodArray<z$1.ZodObject<{
        completedAt: z$1.ZodNullable<z$1.ZodNumber>;
        createdAt: z$1.ZodNumber;
        description: z$1.ZodString;
        error: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        itemId: z$1.ZodString;
        kind: z$1.ZodLiteral<"work">;
        model: z$1.ZodNullable<z$1.ZodString>;
        presentation: z$1.ZodOptional<z$1.ZodObject<{
            badge: z$1.ZodOptional<z$1.ZodObject<{
                glyph: z$1.ZodString;
                hint: z$1.ZodString;
                label: z$1.ZodString;
                tone: z$1.ZodEnum<{
                    destructive: "destructive";
                    neutral: "neutral";
                }>;
            }, z$1.core.$strip>>;
            detail: z$1.ZodOptional<z$1.ZodString>;
            icon: z$1.ZodObject<{
                glyph: z$1.ZodString;
            }, z$1.core.$strip>;
            label: z$1.ZodObject<{
                completed: z$1.ZodString;
                pending: z$1.ZodString;
            }, z$1.core.$strip>;
            suppress: z$1.ZodOptional<z$1.ZodBoolean>;
            tint: z$1.ZodOptional<z$1.ZodObject<{
                dark: z$1.ZodString;
                light: z$1.ZodString;
            }, z$1.core.$strip>>;
            title: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        sourceSeqEnd: z$1.ZodNumber;
        sourceSeqStart: z$1.ZodNumber;
        startedAt: z$1.ZodNumber;
        status: z$1.ZodEnum<{
            completed: "completed";
            error: "error";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        summary: z$1.ZodNullable<z$1.ZodString>;
        taskStatus: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            killed: "killed";
            paused: "paused";
            pending: "pending";
            running: "running";
            stopped: "stopped";
        }>;
        taskType: z$1.ZodString;
        threadId: z$1.ZodString;
        turnId: z$1.ZodNullable<z$1.ZodString>;
        usage: z$1.ZodNullable<z$1.ZodObject<{
            durationMs: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            totalTokens: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        workKind: z$1.ZodLiteral<"workflow">;
        workflow: z$1.ZodNullable<z$1.ZodObject<{
            agents: z$1.ZodArray<z$1.ZodObject<{
                agentType: z$1.ZodOptional<z$1.ZodString>;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
                error: z$1.ZodOptional<z$1.ZodString>;
                index: z$1.ZodNumber;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
                lastProgressAt: z$1.ZodNumber;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                model: z$1.ZodString;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                state: z$1.ZodEnum<{
                    done: "done";
                    failed: "failed";
                    queued: "queued";
                    running: "running";
                    skipped: "skipped";
                }>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                kind: z$1.ZodOptional<z$1.ZodString>;
                title: z$1.ZodString;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        workflowName: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>;
    contextBoundarySeq: z$1.ZodNullable<z$1.ZodNumber>;
    contextWindowUsage: z$1.ZodOptional<z$1.ZodObject<{
        estimated: z$1.ZodBoolean;
        modelContextWindow: z$1.ZodNumber;
        usedTokens: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    delta: z$1.ZodOptional<z$1.ZodObject<{
        rowOrder: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
        upsertRows: z$1.ZodArray<z$1.ZodType<TimelineRow, unknown, z$1.core.$ZodTypeInternals<TimelineRow, unknown>>>;
    }, z$1.core.$strip>>;
    goal: z$1.ZodNullable<z$1.ZodObject<{
        objective: z$1.ZodString;
        sourceSeq: z$1.ZodNumber;
        status: z$1.ZodEnum<{
            active: "active";
            budgetLimited: "budgetLimited";
            complete: "complete";
            paused: "paused";
        }>;
        timeUsedSeconds: z$1.ZodNumber;
        tokenBudget: z$1.ZodNullable<z$1.ZodNumber>;
        tokensUsed: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    maxSeq: z$1.ZodNumber;
    modelFallback: z$1.ZodNullable<z$1.ZodObject<{
        detectedAt: z$1.ZodNumber;
        fallbackModel: z$1.ZodString;
        message: z$1.ZodString;
        originalModel: z$1.ZodString;
        reason: z$1.ZodEnum<{
            provider: "provider";
            refusal: "refusal";
        }>;
        sourceSeq: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    pendingTodos: z$1.ZodNullable<z$1.ZodObject<{
        items: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            status: z$1.ZodEnum<{
                completed: "completed";
                in_progress: "in_progress";
                pending: "pending";
            }>;
            text: z$1.ZodString;
        }, z$1.core.$strip>>;
        sourceSeq: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    rows: z$1.ZodArray<z$1.ZodType<TimelineRow, unknown, z$1.core.$ZodTypeInternals<TimelineRow, unknown>>>;
    timelinePage: z$1.ZodObject<{
        hasOlderRows: z$1.ZodBoolean;
        kind: z$1.ZodEnum<{
            latest: "latest";
            older: "older";
        }>;
        olderCursor: z$1.ZodNullable<z$1.ZodObject<{
            anchorId: z$1.ZodString;
            anchorSeq: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        returnedSegmentCount: z$1.ZodNumber;
        segmentLimit: z$1.ZodNumber;
    }, z$1.core.$strict>;
}, z$1.core.$strip>;
type ThreadTimelineResponse = z$1.infer<typeof threadTimelineResponseSchema>;
declare const threadConversationOutlineResponseSchema: z$1.ZodObject<{
    items: z$1.ZodArray<z$1.ZodObject<{
        attachmentSummary: z$1.ZodNullable<z$1.ZodObject<{
            fileCount: z$1.ZodNumber;
            imageCount: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        id: z$1.ZodString;
        preview: z$1.ZodString;
        role: z$1.ZodEnum<{
            assistant: "assistant";
            user: "user";
        }>;
    }, z$1.core.$strict>>;
    maxSeq: z$1.ZodNumber;
}, z$1.core.$strict>;
type ThreadConversationOutlineResponse = z$1.infer<typeof threadConversationOutlineResponseSchema>;
declare const threadStorageFileListResponseSchema: z$1.ZodObject<{
    files: z$1.ZodArray<z$1.ZodObject<{
        name: z$1.ZodString;
        path: z$1.ZodString;
    }, z$1.core.$strip>>;
    storageRootPath: z$1.ZodString;
    truncated: z$1.ZodBoolean;
}, z$1.core.$strip>;
type ThreadStorageFileListResponse = z$1.infer<typeof threadStorageFileListResponseSchema>;
declare const threadStoragePathListResponseSchema: z$1.ZodObject<{
    paths: z$1.ZodArray<z$1.ZodObject<{
        kind: z$1.ZodEnum<{
            directory: "directory";
            file: "file";
        }>;
        name: z$1.ZodString;
        path: z$1.ZodString;
        positions: z$1.ZodArray<z$1.ZodNumber>;
        score: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    storageRootPath: z$1.ZodString;
    truncated: z$1.ZodBoolean;
}, z$1.core.$strip>;
type ThreadStoragePathListResponse = z$1.infer<typeof threadStoragePathListResponseSchema>;

declare const threadTabsResponseSchema: z$1.ZodObject<{
    revision: z$1.ZodNumber;
    tabs: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"thread-info">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"git-diff">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        actionId: z$1.ZodString;
        fileOpenerOwner: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            environmentId: z$1.ZodNullable<z$1.ZodString>;
            kind: z$1.ZodLiteral<"workspace-file-preview">;
            projectId: z$1.ZodNullable<z$1.ZodString>;
            tab: z$1.ZodObject<{
                lineRange: z$1.ZodNullable<z$1.ZodObject<{
                    endLineNumber: z$1.ZodNumber;
                    startLineNumber: z$1.ZodNumber;
                }, z$1.core.$strict>>;
                path: z$1.ZodString;
                source: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"working-tree">;
                }, z$1.core.$strict>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"head">;
                }, z$1.core.$strict>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"merge-base">;
                    ref: z$1.ZodString;
                }, z$1.core.$strict>], "kind">;
                statusLabel: z$1.ZodNullable<z$1.ZodLiteral<"deleted">>;
            }, z$1.core.$strict>;
            threadId: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            environmentId: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
            hostId: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
            kind: z$1.ZodLiteral<"host-file-preview">;
            tab: z$1.ZodObject<{
                lineRange: z$1.ZodNullable<z$1.ZodObject<{
                    endLineNumber: z$1.ZodNumber;
                    startLineNumber: z$1.ZodNumber;
                }, z$1.core.$strict>>;
                path: z$1.ZodString;
            }, z$1.core.$strict>;
            threadId: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            environmentId: z$1.ZodNullable<z$1.ZodString>;
            kind: z$1.ZodLiteral<"thread-storage-file-preview">;
            tab: z$1.ZodObject<{
                lineRange: z$1.ZodNullable<z$1.ZodObject<{
                    endLineNumber: z$1.ZodNumber;
                    startLineNumber: z$1.ZodNumber;
                }, z$1.core.$strict>>;
                path: z$1.ZodString;
            }, z$1.core.$strict>;
            threadId: z$1.ZodString;
        }, z$1.core.$strict>], "kind">>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"plugin-panel">;
        paramsJson: z$1.ZodNullable<z$1.ZodString>;
        pluginId: z$1.ZodString;
        title: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"workspace-file-preview">;
        lineRange: z$1.ZodNullable<z$1.ZodObject<{
            endLineNumber: z$1.ZodNumber;
            startLineNumber: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        path: z$1.ZodString;
        projectId: z$1.ZodNullable<z$1.ZodString>;
        source: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"working-tree">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"head">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"merge-base">;
            ref: z$1.ZodString;
        }, z$1.core.$strict>], "kind">;
        statusLabel: z$1.ZodNullable<z$1.ZodLiteral<"deleted">>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        hostId: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"host-file-preview">;
        lineRange: z$1.ZodNullable<z$1.ZodObject<{
            endLineNumber: z$1.ZodNumber;
            startLineNumber: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        path: z$1.ZodString;
        threadId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        isPinned: z$1.ZodBoolean;
        kind: z$1.ZodLiteral<"thread-storage-file-preview">;
        lineRange: z$1.ZodNullable<z$1.ZodObject<{
            endLineNumber: z$1.ZodNumber;
            startLineNumber: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        path: z$1.ZodString;
        threadId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"browser">;
        title: z$1.ZodNullable<z$1.ZodString>;
        url: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"new-tab">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"side-chat">;
        sourceMessageText: z$1.ZodString;
        sourceSeqEnd: z$1.ZodNullable<z$1.ZodNumber>;
        threadId: z$1.ZodNullable<z$1.ZodString>;
        title: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"terminal">;
        target: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"thread">;
            threadId: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            environmentId: z$1.ZodString;
            kind: z$1.ZodLiteral<"environment">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            cwd: z$1.ZodNullable<z$1.ZodString>;
            hostId: z$1.ZodString;
            kind: z$1.ZodLiteral<"host_path">;
        }, z$1.core.$strict>], "kind">>;
        terminalId: z$1.ZodString;
    }, z$1.core.$strict>], "kind">>;
}, z$1.core.$strict>;
type ThreadTabsResponse = z$1.infer<typeof threadTabsResponseSchema>;
declare const updateThreadTabsRequestSchema: z$1.ZodObject<{
    expectedRevision: z$1.ZodNumber;
    tabs: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"thread-info">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"git-diff">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        actionId: z$1.ZodString;
        fileOpenerOwner: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            environmentId: z$1.ZodNullable<z$1.ZodString>;
            kind: z$1.ZodLiteral<"workspace-file-preview">;
            projectId: z$1.ZodNullable<z$1.ZodString>;
            tab: z$1.ZodObject<{
                lineRange: z$1.ZodNullable<z$1.ZodObject<{
                    endLineNumber: z$1.ZodNumber;
                    startLineNumber: z$1.ZodNumber;
                }, z$1.core.$strict>>;
                path: z$1.ZodString;
                source: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"working-tree">;
                }, z$1.core.$strict>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"head">;
                }, z$1.core.$strict>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"merge-base">;
                    ref: z$1.ZodString;
                }, z$1.core.$strict>], "kind">;
                statusLabel: z$1.ZodNullable<z$1.ZodLiteral<"deleted">>;
            }, z$1.core.$strict>;
            threadId: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            environmentId: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
            hostId: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
            kind: z$1.ZodLiteral<"host-file-preview">;
            tab: z$1.ZodObject<{
                lineRange: z$1.ZodNullable<z$1.ZodObject<{
                    endLineNumber: z$1.ZodNumber;
                    startLineNumber: z$1.ZodNumber;
                }, z$1.core.$strict>>;
                path: z$1.ZodString;
            }, z$1.core.$strict>;
            threadId: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            environmentId: z$1.ZodNullable<z$1.ZodString>;
            kind: z$1.ZodLiteral<"thread-storage-file-preview">;
            tab: z$1.ZodObject<{
                lineRange: z$1.ZodNullable<z$1.ZodObject<{
                    endLineNumber: z$1.ZodNumber;
                    startLineNumber: z$1.ZodNumber;
                }, z$1.core.$strict>>;
                path: z$1.ZodString;
            }, z$1.core.$strict>;
            threadId: z$1.ZodString;
        }, z$1.core.$strict>], "kind">>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"plugin-panel">;
        paramsJson: z$1.ZodNullable<z$1.ZodString>;
        pluginId: z$1.ZodString;
        title: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"workspace-file-preview">;
        lineRange: z$1.ZodNullable<z$1.ZodObject<{
            endLineNumber: z$1.ZodNumber;
            startLineNumber: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        path: z$1.ZodString;
        projectId: z$1.ZodNullable<z$1.ZodString>;
        source: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"working-tree">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"head">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"merge-base">;
            ref: z$1.ZodString;
        }, z$1.core.$strict>], "kind">;
        statusLabel: z$1.ZodNullable<z$1.ZodLiteral<"deleted">>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        hostId: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"host-file-preview">;
        lineRange: z$1.ZodNullable<z$1.ZodObject<{
            endLineNumber: z$1.ZodNumber;
            startLineNumber: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        path: z$1.ZodString;
        threadId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        isPinned: z$1.ZodBoolean;
        kind: z$1.ZodLiteral<"thread-storage-file-preview">;
        lineRange: z$1.ZodNullable<z$1.ZodObject<{
            endLineNumber: z$1.ZodNumber;
            startLineNumber: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        path: z$1.ZodString;
        threadId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"browser">;
        title: z$1.ZodNullable<z$1.ZodString>;
        url: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"new-tab">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"side-chat">;
        sourceMessageText: z$1.ZodString;
        sourceSeqEnd: z$1.ZodNullable<z$1.ZodNumber>;
        threadId: z$1.ZodNullable<z$1.ZodString>;
        title: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"terminal">;
        target: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"thread">;
            threadId: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            environmentId: z$1.ZodString;
            kind: z$1.ZodLiteral<"environment">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            cwd: z$1.ZodNullable<z$1.ZodString>;
            hostId: z$1.ZodString;
            kind: z$1.ZodLiteral<"host_path">;
        }, z$1.core.$strict>], "kind">>;
        terminalId: z$1.ZodString;
    }, z$1.core.$strict>], "kind">>;
}, z$1.core.$strict>;
type UpdateThreadTabsRequest = z$1.infer<typeof updateThreadTabsRequestSchema>;

/**
 * A value that survives a JSON round trip without coercion or data loss.
 *
 * Host boundaries still validate values at runtime because TypeScript cannot
 * exclude non-finite numbers and plugin bundles can bypass static types.
 */
type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};

/** A JSON-safe path segment reported by a Standard Schema validation issue. */
type PluginRpcIssuePathSegment = string | number;
/** Validator-neutral validation detail carried by an RPC error envelope. */
interface PluginRpcValidationIssue {
    message: string;
    path?: PluginRpcIssuePathSegment[];
}
/** Stable wire error categories for plugin RPC. */
type PluginRpcErrorCode = "handler_error" | "invalid_input" | "invalid_json" | "invalid_output" | "non_json_result" | "unknown_method";
/** Structured RPC failure returned as `{ ok: false, error }`. */
interface PluginRpcError {
    code: PluginRpcErrorCode;
    message: string;
    issues?: PluginRpcValidationIssue[];
}
/**
 * The validator-neutral subset of Standard Schema v1 used by plugin contracts.
 * Zod 4 schemas implement this interface directly; other validators can do
 * the same without becoming part of BB's public protocol.
 */
interface StandardSchemaV1<Input = unknown, Output = Input> {
    readonly "~standard": {
        readonly version: 1;
        readonly vendor: string;
        readonly validate: (value: unknown) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
        readonly types?: {
            readonly input: Input;
            readonly output: Output;
        };
    };
}
type StandardSchemaV1Result<Output> = {
    readonly value: Output;
    readonly issues?: undefined;
} | {
    readonly issues: readonly StandardSchemaV1Issue[];
};
interface StandardSchemaV1Issue {
    readonly message: string;
    readonly path?: PropertyKey | readonly (PropertyKey | {
        readonly key: PropertyKey;
    })[];
}
type StandardSchemaV1InferInput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["input"];
type StandardSchemaV1InferOutput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["output"];
interface PluginRpcMethodContract<InputSchema extends StandardSchemaV1 = StandardSchemaV1, OutputSchema extends StandardSchemaV1 = StandardSchemaV1> {
    readonly input: InputSchema;
    readonly output: OutputSchema;
}
type PluginRpcContract = Readonly<Record<string, PluginRpcMethodContract>>;
/** Define a shared RPC contract while preserving exact method/schema types. */
declare function defineRpcContract<const Contract extends PluginRpcContract>(contract: Contract): Contract;
type PluginRpcHandlers<Contract extends PluginRpcContract> = {
    [Method in keyof Contract]: (input: StandardSchemaV1InferOutput<Contract[Method]["input"]>) => StandardSchemaV1InferInput<Contract[Method]["output"]> | Promise<StandardSchemaV1InferInput<Contract[Method]["output"]>>;
};
type PluginRpcCallInput<Method extends PluginRpcMethodContract> = StandardSchemaV1InferInput<Method["input"]>;
type PluginRpcCallArgs<Method extends PluginRpcMethodContract> = null extends PluginRpcCallInput<Method> ? [input?: PluginRpcCallInput<Method>] : [input: PluginRpcCallInput<Method>];
type PluginRpcResult<Method extends PluginRpcMethodContract> = StandardSchemaV1InferOutput<Method["output"]>;

/**
 * The `@get-bb/plugin-sdk/app` contract (plugin design §5.2) — pure types with no
 * side effects. The BB app imports these to keep its real implementation in
 * sync (`satisfies PluginSdkApp`). Plugin authors import the same shapes through
 * `@get-bb/plugin-sdk/app`.
 *
 * Per-slot props are versioned contracts: additive-only within an SDK major.
 */
/** Props passed to a `homepageSection` component. */
interface PluginHomepageSectionProps {
    /** Project in view on the compose surface; null when none is selected. */
    projectId: string | null;
}
/**
 * Props passed to a `settingsSection` component.
 *
 * Deliberately empty in V1; versioned additive like the other slot props.
 */
interface PluginSettingsSectionProps {
}
/**
 * Props passed to an `experimental_appOverlay` component.
 *
 * Deliberately empty while the component reads live app state through SDK
 * hooks; versioned additive like the other slot props.
 */
interface ExperimentalAppOverlayProps {
}
/** Props passed to a `navPanel` component (it owns its whole route). */
interface PluginNavPanelProps {
    /**
     * The route remainder after the panel root, "" at the root. The panel's
     * route is `/plugins/<pluginId>/<path>/*`, so a deep link like
     * `/plugins/notes/notes/work/ideas.md` renders the panel with
     * `subPath: "work/ideas.md"`. Navigate within the panel via
     * `useBbNavigate().toPluginPanel(path, { subPath })` — browser
     * back/forward then walks panel-internal history.
     */
    subPath: string;
}
/**
 * Props passed to a panel tab opened by a `threadPanelAction`.
 *
 * This slot is rendered only for an existing thread. Use
 * `experimental_newThreadPanelAction` for the root New thread screen.
 */
interface PluginThreadPanelProps {
    threadId: string;
    /**
     * The JSON value the action's `openPanel` call passed (round-tripped
     * through persistence, so the tab restores across reloads); null when the
     * action opened the panel without params.
     */
    params: JsonValue | null;
}
/** Props passed to a panel tab opened by `experimental_newThreadPanelAction`. */
interface PluginNewThreadPanelProps {
    /** Project selected in the root composer; null in projectless compose. */
    projectId: string | null;
    /**
     * The JSON value the action's `openPanel` call passed (round-tripped
     * through persistence, so the tab restores across reloads); null when the
     * action opened the panel without params.
     */
    params: JsonValue | null;
}
interface PluginPendingInteractionView {
    id: string;
    threadId: string;
    title: string;
    payload: JsonValue;
    createdAt: number;
    expiresAt: number | null;
}
interface PluginPendingInteractionProps {
    interaction: PluginPendingInteractionView;
    submit(value: JsonValue): Promise<void>;
    cancel(): Promise<void>;
}
/**
 * Props for a `sidebarFooterAction` — host-rendered (no plugin component).
 * Deliberately empty; the registration's `run` carries the behavior.
 */
interface PluginSidebarFooterActionProps {
}
/** Props passed to an experimental sidebar-footer disclosure component. */
interface ExperimentalSidebarFooterDisclosureProps {
    /** Hide this disclosure without affecting another plugin's open disclosure. */
    dismiss(): void;
}
/** Display and accessibility metadata for a host-owned sidebar shortcut. */
interface ExperimentalSidebarNavigationShortcut {
    label: string;
    ariaKeyShortcuts: string;
}
/** Host-owned behavior represented by one sidebar navigation item. */
type ExperimentalSidebarNavigationAction = {
    kind: "new-thread";
} | {
    kind: "search-threads";
} | {
    kind: "open-extensions";
} | {
    kind: "open-plugin-panel";
    pluginId: string;
    panelId: string;
};
/** Semantic icon identity for one sidebar navigation item. */
type ExperimentalSidebarNavigationIcon = {
    kind: "host";
    name: "extensions" | "new-thread" | "search";
} | {
    kind: "plugin";
    pluginId: string;
    icon: string | null;
};
/** One host-owned destination or action a plugin may arrange. */
interface ExperimentalSidebarNavigationItem {
    id: string;
    label: string;
    icon: ExperimentalSidebarNavigationIcon;
    action: ExperimentalSidebarNavigationAction;
    isDisabled: boolean;
    shortcut: ExperimentalSidebarNavigationShortcut | null;
    experimental_splitProps: {
        onPointerDown?: (event: react.PointerEvent<HTMLElement>) => void;
    };
}
/** How the host should activate a sidebar navigation item. */
interface ExperimentalSidebarNavigationActivationOptions {
    openInSplit: boolean;
}
/** Props passed to an `experimental_sidebarNavigation` component. */
interface ExperimentalSidebarNavigationProps {
    items: readonly ExperimentalSidebarNavigationItem[];
    activeItemId: string | null;
    isCompactViewport: boolean;
    experimental_activate(itemId: string, options: ExperimentalSidebarNavigationActivationOptions): void;
    experimental_Original: ComponentType;
}
/**
 * Props passed to an `experimental_threadList` component — the sidebar's
 * scrolling thread area, replaced wholesale by one plugin.
 */
interface PluginThreadListProps {
    /** The thread the route currently shows; null on non-thread routes. */
    activeThreadId: string | null;
    /** The project the route currently shows; null when none is selected. */
    activeProjectId: string | null;
    /** True on phone-width viewports and coarse pointers. */
    isCompactViewport: boolean;
    /**
     * Call after the user opens a thread. It closes the mobile sidebar drawer.
     */
    onNavigate: () => void;
    /**
     * Compatibility value for the former sidebar search field. BB now searches
     * threads in the quick palette, so the host always supplies "".
     *
     * @deprecated The quick palette owns thread search. Ignore this value.
     */
    searchQuery: string;
    /**
     * BB's thread list, bound to this sidebar instance. Render it to delegate
     * conditionally without re-entering plugin replacement resolution.
     *
     * @experimental Audit before relying on this as a stable contract.
     */
    Original: ComponentType;
    /** @deprecated Renamed to `Original` in SDK 0.4.16; removed in bb 0.42. */
    experimental_Original?: ComponentType;
}
/**
 * Props passed to an `experimental_threadHeaderAction` component, rendered in
 * the thread header's action row.
 */
interface PluginThreadHeaderActionProps {
    /**
     * The thread this header belongs to. Never null: the slot is not rendered
     * on the compose screen or other non-thread routes. A split layout renders
     * one header per pane, so the component mounts once per visible thread,
     * each with its own id — keep per-thread state in the component, never in a
     * module-level singleton.
     */
    threadId: string;
    projectId: string;
    /**
     * True on phone-width viewports and coarse pointers. Collapse to an
     * icon-sized control when it is true — the row is short.
     */
    isCompactViewport: boolean;
}
/** One bounded function executed inside the selected Browser page. */
interface ExperimentalBrowserPageContentScriptRequest {
    expectedNavigationEpoch: number;
    /** Defaults to `isolated`; use `main` only to inspect page-owned JS state. */
    world?: "isolated" | "main";
    /**
     * A function expression receiving a frozen `{ input, signal }` object. It
     * defaults to an isolated JavaScript world with page DOM access. The
     * explicit main world reaches page-owned JavaScript state. Neither world
     * has Electron, Node, or BB app-shell capabilities.
     */
    source: string;
    /** JSON-only input copied into the page. Defaults to `null`. */
    input?: JsonValue;
    /** Requested timeout in milliseconds. The host enforces its own hard cap. */
    timeoutMs?: number;
}
interface ExperimentalBrowserPageCapture {
    navigationEpoch: number;
    dataUrl: string;
    pixelSize: {
        width: number;
        height: number;
    };
}
interface ExperimentalBrowserPageContentScriptResult {
    navigationEpoch: number;
    value: JsonValue;
}
/** Props passed to an `experimental_browserAction` component. */
interface PluginBrowserActionProps {
    tabId: string;
    navigationEpoch: number | null;
    threadId: string | null;
    projectId: string | null;
    url: string;
    /**
     * False when the running desktop shell predates Browser-page scripts. Plugins
     * should keep their action visible but disabled and explain the upgrade.
     */
    experimental_pageContentScriptsAvailable: boolean;
    /**
     * Execute a bounded content script against this exact Browser tab. Results
     * are JSON-only. Cancellation, navigation, timeout, and lifecycle failures
     * reject without retargeting another tab.
     */
    experimental_runPageContentScript(request: ExperimentalBrowserPageContentScriptRequest, options: {
        signal: AbortSignal;
    }): Promise<ExperimentalBrowserPageContentScriptResult>;
    /**
     * Capture this exact Browser tab for plugin-owned preview UI. Bind the
     * capture to a prior script with `expectedNavigationEpoch` when they must
     * describe the same immutable page revision.
     */
    experimental_capturePage(options?: {
        format?: "jpeg" | "png";
        quality?: number;
        expectedNavigationEpoch?: number;
    }): Promise<ExperimentalBrowserPageCapture>;
    /**
     * Tab-local host for plugin overlays. Portal modal or selection chrome here
     * so it stays clipped to the Browser panel and the host can hide the native
     * page view beneath it.
     */
    experimental_overlayRoot?: HTMLElement | null;
    /**
     * Hide the native Browser view while a portalled menu or dialog is open.
     * Calls are idempotent; the host also releases the lease on every slot
     * lifecycle edge.
     */
    experimental_setOverlayOpen(open: boolean): void;
}
/**
 * Where a file being opened by a `fileOpener` lives. `path` semantics follow
 * the source: workspace paths are relative to the environment's worktree,
 * thread-storage paths are relative to the thread's storage root, host paths
 * are absolute on the thread's host.
 */
interface PluginFileOpenerSource {
    kind: "host" | "thread-storage" | "workspace";
    threadId: string | null;
    environmentId: string | null;
    projectId: string | null;
    /**
     * Explicit host selected for a project-backed workspace file. Omitted when
     * the source is resolved by its environment/thread or the primary host.
     *
     * @experimental Audit before relying on this as a stable contract.
     */
    experimental_hostId?: string;
}
/** Props passed to a `fileOpener` component (rendered as a panel file tab). */
interface PluginFileOpenerProps {
    path: string;
    source: PluginFileOpenerSource;
    /**
     * BB's file preview, bound to this file. Render it to delegate conditionally
     * without re-entering plugin replacement resolution.
     *
     * @experimental Audit before relying on this as a stable contract.
     */
    Original: ComponentType;
    /** @deprecated Renamed to `Original` in SDK 0.4.16; removed in bb 0.42. */
    experimental_Original?: ComponentType;
}
/** How a code line longer than the viewport is presented. */
type CodeOverflowMode = "scroll" | "wrap";
/** How a diff presents its two sides. */
type DiffViewMode = "split" | "unified";
/** A 1-based, inclusive line range. */
interface SourceCodeLineRange {
    start: number;
    end: number;
}
/** One complete text side of a diff, resolved by the caller. */
interface ExperimentalDiffFileContent {
    /** File path for this side. May differ between `old` and `new` for a rename. */
    path: string;
    /** Complete UTF-8 file contents, including unchanged lines outside the patch. */
    content: string;
}
/** Complete text contents for both sides of a diff. */
interface ExperimentalDiffFullFileContents {
    old: ExperimentalDiffFileContent;
    new: ExperimentalDiffFileContent;
}
/**
 * Props of the host-owned `experimental_SourceCode` component — BB's source
 * viewer. The host owns syntax highlighting, gutters, wrapping, line-selection
 * presentation, and the live BB code theme; the caller owns loading the text
 * and any surrounding chrome.
 */
interface SourceCodeProps {
    /** The complete source text to render. */
    content: string;
    /** File path or name. Drives language detection and the a11y label. */
    path: string;
    /** Long-line presentation. Defaults to `"scroll"`. */
    overflow?: CodeOverflowMode;
    /**
     * Lines to highlight and scroll into view (1-based, inclusive). Defaults to
     * `null` — nothing highlighted.
     */
    highlightedLines?: SourceCodeLineRange | null;
    /** Applied to the renderer's root element. */
    className?: string;
}
/**
 * Props of the host-owned `experimental_Diff` component — BB's diff viewer.
 * The host owns patch normalization (a patch without a `diff --git` header is
 * completed from `path`), syntax highlighting, unified/split presentation,
 * gutters, line-selection presentation, optional full-file context expansion,
 * and the live BB code theme. Content that cannot be parsed as a patch
 * degrades to plain monospace text.
 */
interface DiffProps {
    /** Unified patch text for exactly ONE file. */
    patch: string;
    /**
     * The file the patch applies to. Used to complete a patch that arrives
     * without a `diff --git` header (GitHub's REST patches, single `@@` hunks)
     * and for language detection.
     */
    path: string;
    /** Side-by-side or inline. Defaults to `"unified"`. */
    view?: DiffViewMode;
    /** Long-line presentation. Defaults to `"scroll"`. */
    overflow?: CodeOverflowMode;
    /** Whether the gutter shows line numbers. Defaults to `true`. */
    showLineNumbers?: boolean;
    /**
     * Complete text for both file sides. When present and consistent with the
     * patch, BB enables expand-context controls between hunks. The caller owns
     * loading these contents; omit the field to render from the patch alone.
     */
    experimental_fullFileContents?: ExperimentalDiffFullFileContents;
    /** Applied to the renderer's root element. */
    className?: string;
}
/**
 * Props passed to an `experimental_sourceCodeRenderer` component. Every value
 * is already resolved — the replacement never re-applies a host default.
 */
interface PluginSourceCodeRendererProps {
    content: string;
    path: string;
    overflow: CodeOverflowMode;
    highlightedLines: SourceCodeLineRange | null;
    /**
     * BB's source renderer, bound to this request. Render it to delegate
     * conditionally without re-entering plugin replacement resolution.
     *
     * @experimental Audit before relying on this as a stable contract.
     */
    Original: ComponentType;
    /** @deprecated Renamed to `Original` in SDK 0.4.16; removed in bb 0.42. */
    experimental_Original?: ComponentType;
}
/**
 * Props passed to an `experimental_diffRenderer` component. `patch` is always
 * a complete single-file unified patch, whatever shape the caller supplied,
 * and optional full-file context is resolved to an object or `null`.
 */
interface PluginDiffRendererProps {
    patch: string;
    path: string;
    view: DiffViewMode;
    overflow: CodeOverflowMode;
    showLineNumbers: boolean;
    /**
     * Caller-resolved text for both sides, or `null` when the caller supplied
     * only the patch. A replacement can use this to implement context expansion,
     * but must verify that the paths and hunk lines agree with `patch` before
     * treating the contents as complete. BB's original renderer performs that
     * verification when it mounts.
     */
    experimental_fullFileContents: ExperimentalDiffFullFileContents | null;
    /**
     * BB's diff renderer, bound to this request. Render it to delegate
     * conditionally without re-entering plugin replacement resolution.
     *
     * @experimental Audit before relying on this as a stable contract.
     */
    Original: ComponentType;
    /** @deprecated Renamed to `Original` in SDK 0.4.16; removed in bb 0.42. */
    experimental_Original?: ComponentType;
}
/**
 * Message context passed to a `messageDirective` component — the assistant
 * (or nested agent) message that contained the directive.
 */
interface PluginMessageDirectiveMessage {
    id: string;
    threadId: string;
    turnId: string | null;
    projectId: string | null;
}
/**
 * Open a worktree-relative file in the host's workspace file viewer. Returns
 * true when the host accepted the path; false when the path is invalid or the
 * viewer declined it.
 */
type PluginMessageDirectiveOpenWorkspaceFile = (path: string) => boolean;
/**
 * Props passed to a `messageDirective` component. Attributes are untrusted
 * strings parsed from the directive; the plugin validates its own fields.
 */
interface PluginMessageDirectiveProps {
    /** Parsed, untrusted directive attributes (e.g. `{ file: "demo.html" }`). */
    attributes: Readonly<Record<string, string>>;
    /** Original directive source text (useful for diagnostics / crash fallback). */
    source: string;
    message: PluginMessageDirectiveMessage;
    /**
     * Opens a worktree-relative file in the host's workspace file viewer. Null
     * when the message surface has no workspace viewer available.
     */
    openWorkspaceFile: PluginMessageDirectiveOpenWorkspaceFile | null;
}
interface PluginHomepageSectionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    title: string;
    component: ComponentType<PluginHomepageSectionProps>;
}
interface PluginSettingsSectionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Optional host-rendered section heading. */
    title?: string;
    /**
     * Optional one-line host-rendered subheading under `title`, in the built-in
     * SettingsSection idiom (ignored when `title` is absent).
     */
    description?: string;
    component: ComponentType<PluginSettingsSectionProps>;
}
/**
 * Render app-wide plugin UI outside BB's layout regions.
 *
 * The host mounts each registration once per app window through the ordinary
 * plugin React boundary. The component therefore keeps PluginContext, router,
 * query, realtime, and other app-level SDK contexts when it renders fixed UI
 * or creates a React portal. BB supplies no chrome, positioning, visibility,
 * or interaction policy; the plugin owns those details and responsive
 * behavior. Registrations are additive and a crash hides only that overlay.
 */
interface ExperimentalAppOverlayRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    component: ComponentType<ExperimentalAppOverlayProps>;
}
/**
 * Owner-defined validator for a fixed tab's transient target. The host first
 * verifies that the value is JSON-safe, then calls this validator before
 * selecting the tab or delivering the target.
 */
interface ExperimentalFixedTabTargetContract<Target extends JsonValue> {
    validate(value: JsonValue): value is Target;
}
/** Stable, owner-scoped reference used by the app-panel controller. */
type ExperimentalPluginFixedTabReference<Target extends JsonValue = never> = {
    /** The owning `navPanel` id; validated against the containing registration. */
    readonly panelId: string;
    /** Unique within the owning nav panel; letters, digits, `-`, `_`. */
    readonly id: string;
} & ([Target] extends [never] ? {
    /** An untargeted tab cannot be opened with a target. */
    readonly experimental_target?: never;
} : {
    /** Owner validation required before the host delivers a target. */
    readonly experimental_target: ExperimentalFixedTabTargetContract<Target>;
});
/** A fixed tab declared by a plugin nav panel. */
type PluginFixedTabRegistration<Target extends JsonValue = never> = ExperimentalPluginFixedTabReference<Target> & {
    title: string;
    /** Icon hint (BB icon name); unknown names fall back to a generic icon. */
    icon: string;
    component: ComponentType<PluginNavPanelProps>;
    /** `flush` lets the component own padding and scrolling. */
    layout?: "flush" | "padded";
};
/** A fixed tab with either no target or an owner-validated JSON target. */
type PluginFixedTabDeclaration = PluginFixedTabRegistration | PluginFixedTabRegistration<JsonValue>;
interface PluginNavPanelRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    title: string;
    /** Icon hint (BB icon name); unknown names fall back to a generic icon. */
    icon: string;
    /** URL segment under `/plugins/<pluginId>/`; letters, digits, `-`, `_`. */
    path: string;
    component: ComponentType<PluginNavPanelProps>;
    /**
     * Ordered, non-closable tabs shown in this page's host-owned right panel.
     * BB owns selection and persistence and always includes its native Browser
     * and Terminal tools beside them. One tab is active in each visible split
     * pane, so multiple fixed-tab components can be mounted concurrently. A
     * component mounts only while its tab is active in a visible pane and the
     * panel is open, and receives the same `subPath` as the page component.
     *
     * Experimental: see docs/api_to_audit.md.
     */
    fixedTabs?: readonly PluginFixedTabDeclaration[];
    /**
     * Optional presentational component rendered at the trailing edge of this
     * panel's sidebar row. It receives no props so it can own a narrow live
     * value through the ordinary SDK hooks without coupling that state to the
     * host sidebar. The host does not mount it on compact viewports and clips it
     * to a small, single-line box on wider viewports. It shares the trailing
     * action column, fading out for the host's options button on hover or focus;
     * do not render controls or rely on unbounded content here.
     *
     * Experimental: see docs/api_to_audit.md.
     */
    experimental_sidebarAccessory?: ComponentType;
    /**
     * Optional component rendered on the right side of the shared title bar
     * (e.g. a sync button or a count). Contained separately from the body: a
     * throwing headerContent is hidden without breaking the title bar.
     */
    headerContent?: ComponentType<PluginNavPanelProps>;
}
/**
 * What a plugin action passes when it asks the host to open one of its panel
 * tabs. Shared by every `openPanel` entry point so a plugin registering more
 * than one kind of action can write a single open routine;
 * `PluginTargetedPanelActionOpenOptions` adds the `actionId` a caller
 * outside a panel action must pass to name the panel it wants.
 */
interface PluginPanelActionOpenOptions {
    /** Tab label. Default: the action's `title`. */
    title?: string;
    /**
     * Persisted with the tab and handed to the component as its `params` prop.
     * Must be a JSON value; anything else is a declined open.
     */
    params?: JsonValue;
}
/**
 * Context handed to a `threadPanelAction`'s `run`.
 *
 * The action is thread-only and is never offered on the root New thread
 * screen, so `threadId` is always present.
 */
interface PluginThreadPanelActionContext {
    /** The thread whose panel launcher invoked the action. */
    threadId: string;
    /**
     * Open a tab in the thread's side panel rendering this action's
     * `component`. `title` labels the tab (default: the action's `title`);
     * `params` must be JSON-serializable — it is persisted with the tab and
     * reaches the component as its `params` prop. Opening with params
     * identical to an already-open tab of this action focuses that tab
     * (updating its title) instead of duplicating it. May be called more than
     * once (different params ⇒ multiple tabs) or not at all.
     *
     * Returns true when the host accepted the open; false when it declined —
     * from this launcher, only a `params` that is not a JSON value. The true /
     * false contract is shared with `messageAction`'s `openPanel` and
     * `useBbNavigate().openThreadPanel` (which decline for more reasons) so one
     * open routine can serve every action kind. A decline is never thrown: the
     * host logs it and reports it here.
     */
    openPanel(options?: PluginPanelActionOpenOptions): boolean;
}
interface PluginThreadPanelActionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Label of the action row in the panel's new-tab launcher. */
    title: string;
    /**
     * Icon hint (BB icon name) used when the plugin ships no logo; the
     * launcher row and opened tabs prefer the plugin's logo.
     */
    icon?: string;
    /** Rendered inside every panel tab this action opens. */
    component: ComponentType<PluginThreadPanelProps>;
    /**
     * How the host frames the tab content. "padded" (default) wraps the
     * component in the panel's scroll container with standard padding —
     * right for document-like content. "flush" gives the component the full
     * tab area (no padding, definite height, no host scrolling) — right for
     * app-like content that manages its own layout, such as
     * `ThreadChat`.
     */
    layout?: "flush" | "padded";
    /**
     * Runs when the user activates the action: call your RPC methods, show a
     * toast, and/or open panel tabs via `context.openPanel`. Omitted =
     * immediately open a panel tab with defaults. Errors (sync or async) are
     * contained and logged; they never break the launcher.
     */
    run?(context: PluginThreadPanelActionContext): void | Promise<void>;
}
/** Context handed to an `experimental_newThreadPanelAction`'s `run`. */
interface PluginNewThreadPanelActionContext {
    /** Project selected in the root composer; null in projectless compose. */
    projectId: string | null;
    /**
     * Open a tab in the root New thread screen's side panel rendering this
     * action's `component`. The title, params, deduplication, return value, and
     * error semantics match `threadPanelAction`.
     */
    openPanel(options?: PluginPanelActionOpenOptions): boolean;
}
/** Registration for the root New thread screen's panel Actions list. */
interface PluginNewThreadPanelActionRegistration {
    /** Unique within this slot for the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Label of the action row in the panel's new-tab launcher. */
    title: string;
    /** Icon hint (BB icon name) used when the plugin ships no logo. */
    icon?: string;
    /** Rendered inside every panel tab this action opens. */
    component: ComponentType<PluginNewThreadPanelProps>;
    /** Host framing; matches `threadPanelAction`. */
    layout?: "flush" | "padded";
    /**
     * Runs when the user activates the action. Omitted = immediately open a
     * panel tab with defaults. Errors are contained and logged.
     */
    run?(context: PluginNewThreadPanelActionContext): void | Promise<void>;
}
/** A compact plugin-owned control in the Browser tab's navigation chrome. */
interface PluginBrowserActionRegistration {
    /** Unique within this slot for the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Host label for the contribution and its overflow row. */
    title: string;
    /** Render exactly one accessible 28px control; portal larger UI. */
    component: ComponentType<PluginBrowserActionProps>;
}
interface PluginPendingInteractionRegistration {
    /**
     * The renderer's plugin-local name. Two addresses resolve to it: the
     * `rendererId` a backend passes to `bb.ui.requestInput`, and the `<name>`
     * half of a provider bridge's `interaction/request` kind
     * `"<pluginId>/<name>"` (docs/provider-plugin-api.md §4), which the client
     * splits on the slash to find this registration under its plugin.
     * `bb.ui.requestInput` validates `rendererId` against `/^[a-zA-Z0-9_-]+$/`;
     * an extension kind must match `/^[a-z0-9-]+\/[a-z0-9-]+$/`
     * (`EXTENSION_KIND_PATTERN` in @bb/domain), so an id addressable both ways
     * uses lowercase letters, digits, and "-" only.
     */
    id: string;
    component: ComponentType<PluginPendingInteractionProps>;
}
/** Context handed to a `sidebarFooterAction`'s `run`. */
interface PluginSidebarFooterActionContext {
    /**
     * Navigate to this plugin's detail page in Tools, where declarative settings
     * and `settingsSection` slots render.
     */
    openSettings(): void;
}
/**
 * An icon button in the app sidebar footer (next to Settings / bug report).
 * Host-rendered for consistent chrome — plugins supply icon, label, and
 * `run` behavior only.
 */
interface PluginSidebarFooterActionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Tooltip and accessible label for the icon button. */
    title: string;
    /** Icon hint (BB icon name); unknown names fall back to a generic icon. */
    icon: string;
    /**
     * Runs when the user activates the action (e.g. call `openSettings()`,
     * open a panel via other surfaces, toast). Errors (sync or async) are
     * contained and logged; they never break the sidebar.
     */
    run(context: PluginSidebarFooterActionContext): void | Promise<void>;
}
/** Context handed to an experimental sidebar-footer action. */
interface ExperimentalSidebarFooterActionContext {
    /** Navigate to this plugin's detail page in Tools. */
    openPluginDetails(): void;
}
/** Fields shared by both experimental sidebar-footer item behaviors. */
interface ExperimentalSidebarFooterItemBase {
    /** Unique within the plugin's unified sidebar footer; letters, digits, `-`, `_`. */
    id: string;
    /** Tooltip and accessible label for the host-rendered icon button. */
    label: string;
    /** BB icon-name hint; unknown names fall back to a generic icon. */
    icon: string;
}
/** A sidebar-footer item that runs a callback when activated. */
interface ExperimentalSidebarFooterActionRegistration extends ExperimentalSidebarFooterItemBase {
    kind: "action";
    onActivate(context: ExperimentalSidebarFooterActionContext): void | Promise<void>;
}
/** A sidebar-footer item that reveals plugin-rendered content above the row. */
interface ExperimentalSidebarFooterDisclosureRegistration extends ExperimentalSidebarFooterItemBase {
    kind: "disclosure";
    component: ComponentType<ExperimentalSidebarFooterDisclosureProps>;
}
/** One host-rendered item in the app sidebar footer. */
type ExperimentalSidebarFooterItemRegistration = ExperimentalSidebarFooterActionRegistration | ExperimentalSidebarFooterDisclosureRegistration;
/** Live controls for an experimental sidebar-footer disclosure. */
interface ExperimentalSidebarFooterDisclosureController {
    /** Request that the host open this disclosure, replacing any open sibling. */
    open(): void;
    /** Close this disclosure if it is currently open. */
    close(): void;
    /** Open this disclosure, or close it when it is currently open. */
    toggle(): void;
}
/** Managed registration surface for items in the app sidebar footer. */
interface ExperimentalSidebarFooter {
    register(registration: ExperimentalSidebarFooterActionRegistration): void;
    register(registration: ExperimentalSidebarFooterDisclosureRegistration): ExperimentalSidebarFooterDisclosureController;
}
/**
 * The one status bb would paint for a thread, already resolved through the
 * host's precedence (attention before work; plan and goal before the generic
 * spinner). Draw your own glyph for it — the SDK ships no status component.
 *
 * Treat an unrecognized value as "none": bb adds kinds over time, and an
 * older plugin must degrade to drawing nothing rather than throwing.
 *
 * "draft" and "working-draft" are never reported here: an unsubmitted composer
 * draft is per-client state the host reads per row, which an array-wide view
 * cannot. A thread holding a draft reports whatever it would report without
 * one.
 */
type PluginSidebarThreadIndicator = "background-agent" | "background-command" | "draft" | "goal" | "none" | "plan-mode" | "runtime" | "unread-error" | "unread-success" | "waiting-for-input" | "workflow" | "working-draft";
/**
 * How a thread's environment presents its workspace: a worktree bb manages,
 * a worktree the user manages, or anything else (a plain checkout).
 */
type PluginSidebarWorkspaceKind = "managed-worktree" | "other" | "unmanaged-worktree";
/** Live work counts on a thread. All zero means nothing is running. */
interface PluginSidebarThreadActivity {
    workflows: number;
    backgroundAgents: number;
    backgroundCommands: number;
    planMode: number;
    goals: number;
}
/**
 * One thread in the sidebar's live view.
 *
 * A deliberate copy of the fields a sidebar needs — not a re-export of the
 * host's internal thread row type, which changes whenever the app needs a
 * field. Timestamps are epoch milliseconds.
 */
interface PluginSidebarThread {
    id: string;
    projectId: string;
    /** Null while a thread is still unnamed; pair with `titleFallback`. */
    title: string | null;
    titleFallback: string | null;
    /** The thread this one was forked from or spawned under; null at the root. */
    parentThreadId: string | null;
    sectionId: string | null;
    /** How this thread came to exist under its parent; null for root threads. */
    originKind: "fork" | null;
    /** The plugin that spawned it, or null for non-plugin origins. */
    originPluginId: string | null;
    /** The agent provider this thread runs on; resolve it through
     * {@link PluginSdkApp.experimental_useProviders} for a name and icon. */
    providerId: string;
    /** The agent is blocked on the user: an approval or a question. */
    hasPendingInteraction: boolean;
    activity: PluginSidebarThreadActivity;
    indicator: PluginSidebarThreadIndicator;
    /**
     * The host's accessible label for `indicator`, e.g. "Thread needs user
     * input"; null when the indicator is "none". Use it for `aria-label` so
     * screen-reader text stays consistent across sidebars.
     */
    indicatorLabel: string | null;
    isUnread: boolean;
    isPinned: boolean;
    isArchived: boolean;
    environment: {
        id: string | null;
        name: string | null;
        branchName: string | null;
        workspaceDisplayKind: PluginSidebarWorkspaceKind;
    } | null;
    /**
     * The machine this thread's work runs on, with the name resolved for you.
     * Null when the thread has no environment yet, or when its host is not in
     * the known-hosts list. Useful where a thread has no branch to show — a
     * personal-project thread has a machine but no worktree.
     */
    host: {
        id: string;
        name: string;
    } | null;
    createdAt: number;
    updatedAt: number;
    lastReadAt: number | null;
    latestAttentionAt: number;
}
/**
 * The pull request for a thread's branch, narrowed to what a sidebar row
 * needs. `attention` is bb's rolled-up "does this need you" signal, so a row
 * can colour a badge without reading checks, review, and mergeability itself.
 */
interface PluginSidebarPullRequest {
    number: number;
    title: string;
    url: string;
    state: "closed" | "draft" | "merged" | "open";
    attention: "blocked" | "changes_requested" | "checks_failed" | "checks_pending" | "closed" | "conflicts" | "draft" | "merged" | "none" | "ready_to_merge" | "review_requested";
}
interface PluginSidebarThreadPullRequestState {
    /** True while the first lookup for this thread's environment is in flight. */
    isLoading: boolean;
    /**
     * The pull request, or null when the branch has none, the thread has no
     * environment, or the lookup could not run (a git-host hiccup). A row should
     * treat null as "nothing to show", never as an error.
     */
    pullRequest: PluginSidebarPullRequest | null;
}
/** One project in the sidebar's live view. */
interface PluginSidebarProject {
    id: string;
    name: string;
    /** True for the implicit personal project. */
    isPersonal: boolean;
}
interface PluginSidebarThreadsState {
    status: "error" | "loading" | "ready";
    threads: readonly PluginSidebarThread[];
    projects: readonly PluginSidebarProject[];
}
/**
 * The provider directory (see {@link PluginSdkApp.experimental_useProviders}):
 * every registered agent provider in picker order, as the same `ProviderInfo`
 * the host's own pickers read. `logoUrl` is server-relative
 * (`/api/v1/system/providers/<id>/logo`) or null when the provider declared a
 * glyph or no icon; `strings` carries the provider's declared copy.
 */
interface PluginProvidersState {
    status: "error" | "loading" | "ready";
    providers: readonly ProviderInfo[];
}
/**
 * One TextMate token rule from the active code theme, in the shape VS Code
 * theme files author it.
 */
interface PluginCodeThemeTokenRule {
    /** Scope(s) the rule paints; absent means the theme's base rule. */
    scope?: string | readonly string[];
    settings: {
        /** `#rrggbb` or `#rrggbbaa`. */
        foreground?: string;
        background?: string;
        /** Space-separated TextMate font styles, e.g. `"bold italic"`. */
        fontStyle?: string;
    };
}
/**
 * The active code theme as a VS Code theme file: the same document BB's own
 * highlighter renders from, so a plugin that embeds a third-party editor can
 * translate it into that editor's theme format rather than guessing colors
 * from CSS variables.
 */
interface PluginCodeThemeData {
    /** Registered theme name — a bundled Shiki name or a BB-registered id. */
    name: string;
    type: "dark" | "light";
    /** Default editor foreground, as `#rrggbb[aa]`. */
    fg: string;
    /** Default editor background, as `#rrggbb[aa]`. */
    bg: string;
    /** VS Code workbench colors (`editor.background`, `editorCursor.foreground`, …). */
    colors: Readonly<Record<string, string>>;
    tokenColors: readonly PluginCodeThemeTokenRule[];
}
/**
 * The code theme BB is currently rendering with (see
 * {@link PluginSdkApp.experimental_useCodeTheme}). `mode` and `name` change
 * the moment the user switches palette or light/dark; `theme` follows once
 * the theme file resolves, and keeps the previous document until then so a
 * consumer never has to paint an unthemed frame. Compare `theme.name` with
 * `name` to tell a settled state from one still resolving.
 */
interface PluginCodeThemeState {
    mode: "dark" | "light";
    name: string;
    /** null only before the first theme file resolves. */
    theme: PluginCodeThemeData | null;
}
/**
 * Act on threads from a plugin surface. Every method routes to the host's own
 * flow, so optimistic updates, toasts, dialogs, pane closing, and route repair
 * behave exactly as they do in the built-in sidebar. Unknown thread ids are
 * ignored by `open` and rejected by the rest.
 */
interface PluginSidebarThreadActions {
    /**
     * Navigate to a thread. `split: true` applies bb's split placement rules —
     * a right split by default, focus when the thread is already open, replace
     * at the pane cap — and falls back to plain navigation where splits are off.
     */
    open(threadId: string, options?: {
        split?: boolean;
    }): void;
    /**
     * Go to the new-thread screen. Passing `projectId` also makes that project
     * the composer's selection, so the thread is created where you asked.
     */
    openNewThread(options?: {
        projectId?: string;
        focusPrompt?: boolean;
    }): void;
    setPinned(threadId: string, pinned: boolean): Promise<void>;
    setRead(threadId: string, read: boolean): Promise<void>;
    /** Silent rename — no dialog. For inline editing in your own row. */
    rename(threadId: string, title: string): Promise<void>;
    /** Archives the thread AND its children, closing any panes showing them. */
    archive(threadId: string): void;
    /**
     * Opens bb's delete confirmation, which counts child threads first. Deletion
     * is destructive and recursive, so the host owns the confirmation: there is
     * deliberately no silent `delete`.
     */
    requestDelete(threadId: string): void;
}
/**
 * Render a plugin component in the thread header's action row.
 *
 * The frontend sibling of the backend `bb.ui.registerThreadAction`, which
 * renders a host-owned button and runs server-side. Use that one for "do a
 * thing"; use this one when the control must draw live state.
 *
 * The host places it at the left end of the action row, before the workspace
 * button, git actions, the panel toggle, maximize, and close. That row is a
 * 48px chrome row with 28px controls: render one inline control that fits, and
 * put anything taller in a portalled popover.
 */
interface PluginThreadHeaderActionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /**
     * Names the region the host wraps around your component (a labelled group).
     * It does NOT label your control: an icon-only button still needs its own
     * accessible name.
     */
    title: string;
    component: ComponentType<PluginThreadHeaderActionProps>;
}
/** One pane's place in the split layout, as fractions of the split area. */
interface PluginSidebarSplitPane {
    paneId: string;
    rect: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /** This pane holds the thread the row represents. */
    isMe: boolean;
    isFocused: boolean;
}
/**
 * Drag-to-split support for one row, plus where that thread currently sits in
 * the split layout.
 */
interface PluginSidebarThreadSplit {
    /**
     * Spread onto the row's interactive element. Carries the pointer handler
     * that starts a split drag; empty when splits are unavailable, so spreading
     * it is always safe.
     *
     * The host owns every rule: the gesture engages only once the pointer leaves
     * the sidebar toward the main area (so a list with its own drag-to-reorder
     * keeps working), an edge drop splits, a center drop replaces, an
     * already-open thread focuses its pane, and the pane cap coerces a split
     * into a replace.
     */
    splitProps: {
        onPointerDown?: (event: react.PointerEvent<HTMLElement>) => void;
    };
    /**
     * False on compact viewports, when the user disabled splits, and for an
     * unknown thread id. Gate any "open in split" affordance you draw on it.
     */
    isAvailable: boolean;
    /**
     * Where this thread sits in the split layout, or null when it is not open in
     * one (including single-pane layouts). Draw a mini-map, a tint, or nothing.
     */
    layout: {
        panes: readonly PluginSidebarSplitPane[];
    } | null;
}
/**
 * Replace the sidebar's thread list with a plugin component.
 *
 * Unlike every other slot, this one is EXCLUSIVE: two lists cannot share one
 * scroll area. Registering activates the replacement while the plugin is
 * enabled. If multiple plugins register one, the first in deterministic slot
 * order is active by default; removing it reveals the next. The user can pin
 * BB's list or a specific provider under Settings → Appearance. A plugin can
 * also use its own setting and render `Original` conditionally.
 * An absent or crashing replacement falls back to BB's list rather than
 * leaving the user with no sidebar.
 *
 * The plugin gets the scrolling list and nothing else. The New-thread button,
 * the search action, the plugin nav rows, and the footer stay host-rendered in
 * every sidebar — they are shared surfaces (other plugins live in two of
 * them), and a replaced list must not be able to remove them.
 */
interface PluginThreadListRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Label shown in Settings → Appearance and capability details. */
    title: string;
    /** Optional one-line description shown with the provider choice. */
    description?: string;
    component: ComponentType<PluginThreadListProps>;
}
/** Replace the bounded navigation controls above the sidebar thread list. */
interface ExperimentalSidebarNavigationRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Label shown in Settings → Appearance and capability details. */
    title: string;
    /** Optional one-line description shown with the provider choice. */
    description?: string;
    component: ComponentType<ExperimentalSidebarNavigationProps>;
}
/**
 * Register this plugin as a viewer/editor for file extensions. By default,
 * matching files render the first applicable opener in deterministic slot
 * order. The user can pin BB's preview or a specific opener per extension
 * under Settings → Files. The file tab's "Open with" menu can override that
 * choice for one open. A plugin can also use its own setting and render
 * `Original` conditionally. Applies to working-tree, host, and
 * thread-storage files — never to git-ref snapshots (diff views always use
 * BB's preview).
 */
interface PluginFileOpenerRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Label in the "Open with" menu (e.g. "Notes editor"). */
    title: string;
    /** Lowercase extensions without the dot (e.g. ["md", "mdx"]). */
    extensions: readonly string[];
    component: ComponentType<PluginFileOpenerProps>;
}
/**
 * Replace BB's source-code renderer everywhere it renders supplied source
 * text — the native file preview and every plugin that calls
 * `experimental_SourceCode`. Like `experimental_threadList` this slot is
 * **exclusive**: one renderer at a time. Registering activates it while the
 * plugin is enabled; if several are registered the first in deterministic slot
 * order wins. A missing, disabled, or crashing replacement falls back to BB's
 * renderer, and a replacement can render `Original` to delegate
 * per call (behind its own setting, by language, by size — whatever it needs).
 */
interface PluginSourceCodeRendererRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Label shown in capability details. */
    title: string;
    /** Optional one-line description shown with the provider choice. */
    description?: string;
    component: ComponentType<PluginSourceCodeRendererProps>;
}
/**
 * Replace BB's diff renderer everywhere it renders supplied diff content — the
 * timeline file diffs, the environment diff panel's text bodies, and every
 * plugin that calls `experimental_Diff`. Exclusive, with the same activation,
 * fallback, and `Original` delegation rules as
 * {@link PluginSourceCodeRendererRegistration}.
 */
interface PluginDiffRendererRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Label shown in capability details. */
    title: string;
    /** Optional one-line description shown with the provider choice. */
    description?: string;
    component: ComponentType<PluginDiffRendererProps>;
}
/**
 * Register a leaf message directive rendered inside assistant (and nested
 * agent) message Markdown. `id` is the directive name: `inline-vis` matches
 * `::inline-vis{file="demo.html"}`.
 */
interface PluginMessageDirectiveRegistration {
    /**
     * The directive name. Lowercase kebab-case beginning with a letter.
     */
    id: string;
    component: ComponentType<PluginMessageDirectiveProps>;
}
/**
 * A narrow, stable reference to one rendered chat message — NOT an internal
 * timeline row. `sourceSeqEnd` is the last source event sequence the message
 * covers, the anchor the server accepts for provider-history forks.
 */
interface ThreadChatMessageReference {
    id: string;
    threadId: string;
    role: "assistant" | "user";
    /** Visible text of the message. */
    text: string;
    sourceSeqEnd: number;
}
/**
 * What a caller that is *not* itself a panel action passes to open one — a
 * `messageAction`'s `run`, or any component via `useBbNavigate()`. A panel
 * action opening its own tab is already the target, so it passes the bare
 * {@link PluginPanelActionOpenOptions} instead.
 */
interface PluginTargetedPanelActionOpenOptions extends PluginPanelActionOpenOptions {
    /** A `threadPanelAction` id registered by this same plugin. */
    actionId: string;
}
/** Context handed to a `messageAction`'s `run`. */
interface PluginMessageActionContext {
    /** The thread whose timeline surfaced the action. */
    threadId: string;
    message: ThreadChatMessageReference;
    /**
     * Present only when the action was invoked from the text-selection menu;
     * the exact text the user highlighted inside `message`.
     */
    selectedText?: string;
    /**
     * Open one of this plugin's `threadPanelAction` components in the current
     * thread's side panel — the registration-callback equivalent of
     * `useBbNavigate().openThreadPanel`.
     *
     * Returns true when the host accepted the open; false when it declined —
     * `params` was not a JSON value, the action id names no `threadPanelAction`
     * of this plugin, or the surface has no side panel (only the main thread
     * view does; a `ThreadChat` embedded in a plugin panel does not). A decline
     * is never thrown: the host logs it and reports it here.
     */
    openPanel(options: PluginTargetedPanelActionOpenOptions): boolean;
}
/**
 * An action on chat messages: an icon button in the per-message action bar
 * (user and assistant messages) and an entry in the assistant-message
 * text-selection menu. Host-rendered chrome — the plugin supplies title,
 * icon hint, and `run` behavior only.
 */
interface PluginMessageActionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Tooltip / menu label for the action. */
    title: string;
    /** Icon hint (BB icon name); unknown names fall back to a generic icon. */
    icon?: string;
    /**
     * Runs when the user activates the action. Errors (sync or async) are
     * contained and logged; they never break the timeline.
     */
    run(context: PluginMessageActionContext): void | Promise<void>;
}
/** Context handed to a `commandPaletteAction`'s `isAvailable` and `run`. */
interface PluginCommandPaletteActionContext {
    /** The thread in view, or null on a surface without one. */
    threadId: string | null;
    projectId: string | null;
    /**
     * Open one of this plugin's `threadPanelAction` components in the current
     * thread's side panel, exactly as `messageAction`'s `openPanel` does.
     *
     * Returns true when the host accepted the open; false when it declined —
     * `params` was not a JSON value, the action id names no `threadPanelAction`
     * of this plugin, or the surface has no side panel. Only the main thread
     * view has one, and the palette opens anywhere, so guard with `isAvailable`
     * rather than assuming.
     */
    openPanel(options: PluginTargetedPanelActionOpenOptions): boolean;
}
/**
 * A row in bb's quick palette (Mod+Shift+P), listed under the plugin's name
 * beside bb's own commands. Host-rendered: the plugin supplies a title and
 * `run`, and the host owns matching, ordering, and recency.
 */
interface PluginCommandPaletteActionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** The row's label, e.g. "Linear: open issue for this thread". */
    title: string;
    /**
     * Hide the row when it cannot do anything — typically when it needs a thread
     * and there is none. Called while the palette is open; keep it cheap and
     * synchronous. Omitted means always listed.
     */
    isAvailable?(context: PluginCommandPaletteActionContext): boolean;
    /**
     * Runs after the palette closes and focus is restored. Errors (sync or
     * async) are contained and logged; they never break the palette.
     */
    run(context: PluginCommandPaletteActionContext): void | Promise<void>;
}
/**
 * Supply the inline React mark bb draws for one agent provider.
 *
 * A manifest `branding.icon` (or a provider's `logoUrl`) is fetched and drawn
 * through `<img>`, a separate document where `currentColor` resolves to black
 * — invisible on dark themes and unreachable from app CSS. A component is
 * rendered inline, so it inherits the app's theme colors and the host's sizing
 * classes. Register a static color logo as a file and a theme-aware mark here.
 *
 * The host passes only `className` (sizing plus the provider's color class);
 * the component must render an inline SVG (or other inline markup) and must
 * not fetch. One registration per provider id per plugin; when two plugins
 * claim the same provider id the host keeps the first by plugin id and warns.
 */
interface PluginProviderIconRegistration {
    /**
     * The provider this mark is for — the id bb knows the provider by (the
     * provider declaration's id, e.g. `codex` or `acp-cursor`), not the plugin
     * id. Letters, digits, `-`, `_`.
     */
    providerId: string;
    /** Inline, theme-aware mark. Receives the host's sizing/color className. */
    icon: ComponentType<{
        className?: string;
    }>;
}
/**
 * The declarative presentation persisted with a timeline item (docs/
 * provider-plugin-api.md §3): what every client renders when no plugin code
 * is present. A renderer receives it so it can reuse the bridge's label,
 * glyph and tint instead of re-deriving them from the payload.
 */
interface PluginTimelineRowPresentation {
    label: {
        pending: string;
        completed: string;
    };
    icon: {
        glyph: string;
    };
    title?: string;
    /** Short Markdown, length-capped at ingest. */
    detail?: string;
    suppress?: boolean;
    tint?: {
        light: string;
        dark: string;
    };
}
type PluginTimelineRowStatus = "completed" | "error" | "interrupted" | "pending";
/** The projected row a `experimental_timelineRenderer` component receives. */
interface PluginTimelineRendererRow {
    id: string;
    threadId: string;
    turnId: string | null;
    /**
     * The item kind the renderer registered for: this plugin's extension kind
     * (`"<pluginId>/<name>"`) or `"tool"` for a generic tool item.
     */
    kind: string;
    /** The tool name for a `"tool"` row; null for an extension row. */
    toolName: string | null;
    status: PluginTimelineRowStatus;
    startedAt: number;
    completedAt: number | null;
}
interface PluginTimelineRendererProps {
    row: PluginTimelineRendererRow;
    /**
     * The item's data: an extension item's payload (validated against the
     * plugin's declared schema at ingest), or for a `"tool"` row the call's
     * `{ arguments, output }`.
     */
    payload: JsonValue;
    /**
     * The bridge's presentation for the row. Null only for a generic tool row
     * persisted before bridges attached presentation (grammar v2); an
     * extension row always has one.
     */
    presentation: PluginTimelineRowPresentation | null;
    /** The thread the row belongs to. */
    thread: {
        id: string;
        providerId: string | null;
    };
    /**
     * The host's declarative base for this row's body (the presentation's
     * `detail`, or the tool call's arguments and output). Render it to keep
     * the default body beside the plugin's own content.
     */
    Original: ComponentType<Record<never, never>>;
}
/**
 * Render the expanded body of the timeline rows this plugin owns: its own
 * extension item kinds (`"<pluginId>/<name>"`, where `<pluginId>` is this
 * plugin), and `"tool"` for the generic tool items of the providers this
 * plugin registered. Core kinds (message, command, fileChange, fileRead,
 * search, delegation, planSteps, …) always use the core renderers and are
 * customized through the bridge's presentation alone.
 *
 * The row's header — the bridge's label, glyph, tint and headline — stays
 * host-rendered so the timeline reads uniformly; the component owns the
 * body. When no renderer is registered for a kind (the plugin is not loaded,
 * uninstalled, or never shipped an app bundle) the declarative base renders
 * instead, so a row never goes blank. Crashes are contained per row.
 */
interface PluginTimelineRendererRegistration {
    /**
     * `"<pluginId>/<name>"` for one of this plugin's extension kinds, or
     * `"tool"` for the generic tool items of this plugin's providers.
     */
    kind: string;
    component: ComponentType<PluginTimelineRendererProps>;
}
interface PluginAppSlots {
    homepageSection(registration: PluginHomepageSectionRegistration): void;
    settingsSection(registration: PluginSettingsSectionRegistration): void;
    /**
     * Render one app-wide overlay component (see
     * {@link ExperimentalAppOverlayRegistration}). Experimental: see
     * docs/api_to_audit.md.
     */
    experimental_appOverlay(registration: ExperimentalAppOverlayRegistration): void;
    navPanel(registration: PluginNavPanelRegistration): void;
    /**
     * Add an action to an existing thread's panel launcher. This slot is
     * thread-only; use `experimental_newThreadPanelAction` for root compose.
     */
    threadPanelAction(registration: PluginThreadPanelActionRegistration): void;
    /**
     * Add an action to the root New thread screen's panel launcher (see
     * {@link PluginNewThreadPanelActionRegistration}). Experimental: see
     * docs/api_to_audit.md.
     */
    experimental_newThreadPanelAction(registration: PluginNewThreadPanelActionRegistration): void;
    pendingInteraction(registration: PluginPendingInteractionRegistration): void;
    sidebarFooterAction(registration: PluginSidebarFooterActionRegistration): void;
    /** Replace the bounded sidebar navigation controls. */
    experimental_sidebarNavigation(registration: ExperimentalSidebarNavigationRegistration): void;
    /**
     * Replace the sidebar's thread list (see
     * {@link PluginThreadListRegistration}). Experimental: see
     * docs/api_to_audit.md for what to audit before the prefix drops.
     */
    experimental_threadList(registration: PluginThreadListRegistration): void;
    /**
     * Render a component in the thread header's action row (see
     * {@link PluginThreadHeaderActionRegistration}). Experimental: see
     * docs/api_to_audit.md.
     */
    experimental_threadHeaderAction(registration: PluginThreadHeaderActionRegistration): void;
    /**
     * Render one compact component in the Browser tab chrome. Experimental: see
     * docs/api_to_audit.md.
     */
    experimental_browserAction(registration: PluginBrowserActionRegistration): void;
    fileOpener(registration: PluginFileOpenerRegistration): void;
    /**
     * Replace BB's source-code renderer (see
     * {@link PluginSourceCodeRendererRegistration}). Experimental: see
     * docs/api_to_audit.md.
     */
    experimental_sourceCodeRenderer(registration: PluginSourceCodeRendererRegistration): void;
    /**
     * Replace BB's diff renderer (see
     * {@link PluginDiffRendererRegistration}). Experimental: see
     * docs/api_to_audit.md.
     */
    experimental_diffRenderer(registration: PluginDiffRendererRegistration): void;
    messageDirective(registration: PluginMessageDirectiveRegistration): void;
    messageAction(registration: PluginMessageActionRegistration): void;
    /**
     * Add a row to the quick palette (see
     * {@link PluginCommandPaletteActionRegistration}).
     */
    commandPaletteAction(registration: PluginCommandPaletteActionRegistration): void;
    /**
     * Draw one agent provider's icon with an inline React component instead of
     * its `<img>`-rendered logo file (see
     * {@link PluginProviderIconRegistration}). Experimental: see
     * docs/api_to_audit.md.
     */
    experimental_providerIcon(registration: PluginProviderIconRegistration): void;
    /**
     * Render the body of this plugin's own timeline rows: its extension kinds
     * and its providers' generic tool items (see
     * {@link PluginTimelineRendererRegistration}). Experimental: see
     * docs/api_to_audit.md.
     */
    experimental_timelineRenderer(registration: PluginTimelineRendererRegistration): void;
}
interface PluginAppComposer {
    customize(registration: ComposerCustomization): void;
}
/** Stable lifecycle values for one content-script instance in one bb client. */
interface PluginContentScriptContext {
    /** The id of the plugin that owns this script. */
    readonly pluginId: string;
    /** Monotonic per-client generation, starting at 1. */
    readonly generation: number;
    /** Aborted before cleanup begins on replacement, deactivation, or teardown. */
    readonly signal: AbortSignal;
    /**
     * Persistently decorate any thread row for this plugin generation.
     *
     * The status is owned by the frontend generation and therefore survives
     * route changes. Passing `null` clears the plugin's status for that thread.
     * The host clears every remaining status when the frontend generation
     * deactivates.
     *
     * Optional so bundles can feature-detect support while this experimental
     * surface rolls out across 0.x clients.
     */
    readonly experimental_setThreadRowStatus?: (threadId: string, status: PluginComposerThreadRowStatus | null) => void;
}
/** Cleanup returned by a frontend content script. */
type PluginContentScriptDisposer = () => void | Promise<void>;
/**
 * Trusted same-origin JavaScript/TypeScript mounted once per active frontend
 * generation in each bb app window or browser tab.
 */
interface PluginContentScriptRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /**
     * Install behavior into the bb app shell. The host awaits a returned
     * promise, retains the plugin's imported frontend stylesheet for this
     * generation, contains failures, and calls the returned disposer exactly
     * once. Styling or decorating existing app-shell DOM belongs here rather
     * than in an always-on frontend stylesheet.
     */
    mount(context: PluginContentScriptContext): void | PluginContentScriptDisposer | Promise<void | PluginContentScriptDisposer>;
}
/** Lifecycle surface for trusted frontend content scripts. */
interface PluginAppContentScripts {
    register(registration: PluginContentScriptRegistration): void;
}
interface PluginAppBuilder {
    slots: PluginAppSlots;
    composer: PluginAppComposer;
    contentScripts: PluginAppContentScripts;
    /** Experimental managed region for actions and disclosures in the sidebar footer. */
    experimental_sidebarFooter: ExperimentalSidebarFooter;
}
type PluginAppSetup = (app: PluginAppBuilder) => void;
/**
 * The opaque product of `definePluginApp` — a plugin's `app.tsx` default
 * export. The host re-runs `setup` against a fresh collector on every
 * (re)interpretation, replacing that plugin's registrations wholesale.
 */
interface PluginAppDefinition {
    /** Brand the host checks before interpreting a bundle's default export. */
    readonly __bbPluginApp: true;
    readonly setup: PluginAppSetup;
}
interface PluginRpcClient<Contract extends PluginRpcContract = PluginRpcContract> {
    /**
     * Invoke one of the plugin's `bb.rpc` methods (POST
     * /api/v1/plugins/&lt;id&gt;/rpc/&lt;method&gt;). Resolves with the method's
     * inferred output; rejects with an `Error` carrying the server's message,
     * stable `code`, and validation `issues` when present.
     */
    call<Method extends Extract<keyof Contract, string>>(method: Method, ...args: PluginRpcCallArgs<Contract[Method]>): Promise<PluginRpcResult<Contract[Method]>>;
}
interface PluginSettingsState {
    /**
     * Effective non-secret setting values (secret settings are excluded —
     * read them server-side). Undefined while loading or unavailable.
     */
    values: Record<string, string | number | boolean> | undefined;
    isLoading: boolean;
}
/** State of the app's shared realtime connection to the bb server. */
type PluginRealtimeConnectionState = "connected" | "connecting" | "reconnecting";
/** Where `useComposer()` writes. */
type PluginComposerScope = {
    kind: "thread";
    threadId: string;
} | {
    kind: "queued-message";
    threadId: string;
    queuedMessageId: string;
} | {
    kind: "side-chat";
    projectId: string;
    parentThreadId: string;
    tabId: string;
    childThreadId: string | null;
} | {
    kind: "new-thread";
    /** Root compose's effective selected project; null only while unresolved. */
    projectId: string | null;
};
/** One plugin-owned composer customization registration. */
interface ComposerCustomization {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Composer kinds where this customization is active; omit for all kinds. */
    scopes?: readonly PluginComposerScope["kind"][];
    actions?: readonly {
        id: string;
        component: ComponentType;
    }[];
    banners?: readonly {
        id: string;
        /** Host chrome around the banner. Defaults to `"card"`. */
        chrome?: "bare" | "card";
        component: ComponentType;
    }[];
    plusMenu?: readonly ComposerPlusMenuItem[];
    richText?: ComposerRichTextSpec;
}
/** Host-rendered menu row in the composer's `+` menu. */
interface ComposerPlusMenuItem {
    id: string;
    label: string;
    /** BB icon name; unknown names fall back to the generic plugin icon. */
    icon?: string;
    /** Accessible description for the host-rendered row. */
    description?: string;
    disabled?: boolean | ((view: ComposerView) => boolean);
    run(context: {
        composer: PluginComposerApi;
        view: ComposerView;
    }): void | Promise<void>;
}
/** Reactive read-side of the composer a plugin surface is mounted in. */
interface ComposerView {
    scope: PluginComposerScope;
    layout: "compact" | "expanded" | "zen";
    draft: {
        text: string;
        isEmpty: boolean;
        attachmentCount: number;
    };
    run: {
        isRunning: boolean;
        isSubmitting: boolean;
    };
}
interface ComposerRichTextSpec {
    /** Content-derived paint: match ranges receive `className`; text is never mutated. */
    effects?: readonly {
        id: string;
        /** Plain-text offsets into the current structured draft. */
        match(text: string): readonly {
            from: number;
            to: number;
        }[];
        className: string;
    }[];
    /** Debounced, read-only observation of the structured draft. */
    onDraftChange?(draft: ComposerStructuredDraft, view: ComposerView): void;
}
interface ComposerStructuredDraft {
    text: string;
    mentions: readonly {
        from: number;
        to: number;
        provider: string;
        id: string;
        label: string;
    }[];
}
/** Host-rendered paint applied to the editable composer text. */
interface PluginComposerTextEffect {
    className: string;
}
/** Host-rendered status that temporarily replaces a thread's draft glyph. */
interface PluginComposerThreadRowStatus {
    /** BB icon-name hint; unknown names fall back to the generic plugin icon. */
    icon: string;
    /** Accessible label for the status glyph. */
    label: string;
    /**
     * Semantic host treatment for the status glyph. `running` automatically
     * shimmers; terminal `success` and `error` tones are static. Defaults to the
     * neutral tone.
     */
    tone?: "default" | "error" | "running" | "success";
}
/** An @-mention pill bound to one of the calling plugin's mention providers. */
interface PluginComposerMention {
    /** Mention provider id registered by THIS plugin via `bb.ui.registerMentionProvider`. */
    provider: string;
    /** Item id your provider's `resolve` will receive at send time. */
    id: string;
    /** Pill text shown in the composer. */
    label: string;
}
/**
 * Programmatic access to the chat composer draft — the same shared draft the
 * built-in "Add to chat" affordances (file preview, diff, terminal selections)
 * write to. While a queued message is being edited, writes land in that
 * message's inline editor. In a side chat, writes land in the visible side-chat
 * draft. Otherwise, inside a thread context writes land in that thread's draft;
 * anywhere else (nav panel, homepage section) they seed the new-thread composer
 * draft, which persists until the user sends or clears it.
 */
interface PluginComposerApi {
    scope: PluginComposerScope;
    /** Current plain text for this composer scope. */
    readonly text: string;
    /**
     * Replace the draft's plain text. Attachments are preserved. Inline mentions
     * outside the changed range are preserved and rebased; mentions overlapped
     * by the replacement are removed because their text representation changed.
     */
    setText(next: string): void;
    /**
     * Replace the draft's plain text from the latest committed value. Uses the
     * same structured-state reconciliation as `setText`.
     */
    updateText(updater: (current: string) => string): void;
    /** Clear plain text without clearing independently attached files. */
    clear(): void;
    /**
     * Apply a host-rendered effect to this composer's editable text, or clear it.
     * Effects are scoped to the calling plugin and automatically clear when the
     * slot unmounts or its composer scope changes.
     */
    setTextEffect(effect: PluginComposerTextEffect | null): void;
    /**
     * Lock or unlock editing for this composer. Locks are scoped to the calling
     * plugin and automatically release when the slot unmounts or its composer
     * scope changes.
     */
    setInputLock(locked: boolean): void;
    /**
     * Append text to the draft as a `> ` blockquote block and focus the
     * composer. Blank text is a no-op. This is the "reference this selection
     * in chat" primitive.
     */
    addQuote(text: string): void;
    /**
     * Insert an @-mention pill that resolves through this plugin's mention
     * provider at send time — the durable way to reference an entity whose
     * content should be fetched fresh when the message is sent.
     */
    insertMention(mention: PluginComposerMention): void;
    /** Focus the composer caret at the end of the draft. */
    focus(): void;
    /**
     * Submit this composer's draft through the composer's OWN submit pipeline,
     * queued until `sendAt` instead of dispatched now.
     *
     * This is a real submission, not a plugin-issued send: the host builds the
     * request exactly as pressing Enter would, so the draft's attachments and
     * @-mentions, and — in the new-thread composer — the provider, model,
     * reasoning level, service tier, permission mode and environment the user
     * has selected on screen, all travel with it. A plugin cannot assemble that
     * tuple itself, which is why sending from the backend instead would silently
     * run the message with different settings than the ones in front of the user.
     *
     * In a thread composer the message is queued as a row instead of being
     * sent or queued for the next idle moment. In the new-thread composer the
     * thread is created `pending` and its first message becomes the queued row.
     * Either way the resulting row is core's: the queued card above the
     * composer, the countdown, Send now and Delete all work with no further
     * plugin involvement.
     *
     * Resolves once the host has accepted the submission and cleared the draft.
     * Rejects when the composer refused to submit — a scope with no submit
     * pipeline (a queued-message editor, a side chat), an empty draft, or a
     * composer that is not ready (still loading its execution defaults, missing
     * an environment). The rejection's message is safe to show to the user.
     * Failures of the underlying request are reported by bb's own submit error
     * handling and restore the draft, exactly as an interactive failure does.
     *
     * Experimental: see docs/api_to_audit.md.
     */
    experimental_submit(options: ExperimentalComposerSubmitOptions): Promise<void>;
}
/**
 * What `experimental_submit` does differently from pressing Enter.
 *
 * There is deliberately no zero-argument overload and no "submit now" arm: a
 * plugin that wants a draft sent immediately is asking for the affordance the
 * user already has, and handing plugins an unconditional "send this draft"
 * button is a much larger surface than scheduling needs.
 */
interface ExperimentalComposerSubmitOptions {
    /**
     * Epoch ms the submission should dispatch at. Must be in the future; the
     * host does not second-guess how far ahead it is.
     */
    sendAt: number;
}
/**
 * A consumer-supplied action on the messages of one `ThreadChat` instance,
 * rendered in the embedded timeline's per-message action bar alongside the
 * native and slot-registered actions. Unlike the `messageAction` slot this is
 * scoped to the rendering component, not registered globally.
 */
interface ThreadChatMessageAction {
    /** Unique within this ThreadChat instance; letters, digits, `-`, `_`. */
    id: string;
    /** Tooltip / menu label for the action. */
    title: string;
    /** Icon hint (BB icon name); unknown names fall back to a generic icon. */
    icon?: string;
    /**
     * Message roles the action applies to. Omitted = both user and assistant
     * messages.
     */
    roles?: readonly ("assistant" | "user")[];
    /**
     * Runs when the user activates the action. Errors (sync or async) are
     * contained and logged; they never break the timeline.
     */
    run(message: ThreadChatMessageReference): void | Promise<void>;
}
/**
 * Props of the host-owned `ThreadChat` component — one thread's chat
 * (timeline, and for the composer variants the full send/queue/draft
 * engine), rendered by the BB app inside a plugin slot. This is the
 * deliberate exception to the no-host-components rule (§5.5): a stable
 * product capability, not a UI kit. Versioned additive like slot props;
 * internal timeline rows, query hooks, and prompt-box configuration are
 * deliberately not exposed.
 */
interface ThreadChatProps {
    threadId: string;
    /**
     * "full" (default) is the page presentation (centered reading width);
     * "compact" is the side-panel presentation; "timeline" renders the
     * transcript without a composer.
     */
    variant?: "compact" | "full" | "timeline";
    /**
     * "contained" (default) fills and scrolls inside a bounded parent;
     * "document" grows with its content and defers scrolling to the page.
     */
    layout?: "contained" | "document";
    /** Bump to focus the composer (ignored by `variant: "timeline"`). */
    focusRequest?: number;
    /**
     * Who controls the permission mode sends run with. "inherit" (default)
     * pins every send to the thread's own resolved default and renders the
     * picker as a dimmed label — a plugin surface can never widen it.
     * "editable" gives this chat its own picker, so the user can raise or
     * lower permissions for this thread independently of the thread it was
     * forked from. Ignored by `variant: "timeline"` (no composer).
     */
    permissionPolicy?: "editable" | "inherit";
    className?: string;
    /** Rendered above the conversation, scrolling with it. */
    leadingContent?: ReactNode;
    /**
     * Actions rendered in this instance's per-message action bar (see
     * {@link ThreadChatMessageAction}).
     */
    messageActions?: readonly ThreadChatMessageAction[];
}
/**
 * The controlled execution selection resolved by the picker.
 *
 * Deliberately a single concrete shape, not a union: this value exists to be
 * forwarded verbatim to `bb.sdk.threads.spawn`, so it must name a real
 * provider and model.
 */
interface ExperimentalProviderModelPickerValue {
    providerId: string;
    model: string;
    reasoningLevel: ReasoningLevel;
    /** Present only when the selected provider supports service tiers. */
    serviceTier?: ServiceTier;
}
/** Where the picker resolves the live provider and model catalog. */
type ExperimentalProviderModelPickerRouting = {
    kind: "host";
    hostId: string;
} | {
    kind: "environment";
    environmentId: string;
};
/**
 * Props of the host-owned `experimental_ProviderModelPicker` component.
 * Provider switches emit one coherent value after the live catalog resolves
 * its default model, reasoning level, and service-tier capability. Failed or
 * empty catalogs leave `value` unchanged. Omit `routing` to use bb's
 * primary-machine routing. Environment routing is required when a provider's
 * model catalog depends on the selected workspace.
 */
interface ExperimentalProviderModelPickerProps {
    value: ExperimentalProviderModelPickerValue;
    onChange(value: ExperimentalProviderModelPickerValue): void;
    /** Route discovery through an explicit machine or existing environment. */
    routing?: ExperimentalProviderModelPickerRouting;
    /** Allow switching providers. Defaults to true; false hides provider tabs. */
    allowProviderChange?: boolean;
    /** Horizontal popover alignment. Defaults to `"start"`. */
    align?: "center" | "end" | "start";
    /** Render the shared selection summary without allowing changes. */
    disabled?: boolean;
    className?: string;
}
/** Props of BB's controlled, host-resolved permission-mode picker. */
interface ExperimentalPermissionModePickerProps {
    /** Provider whose supported modes determine the available choices. */
    providerId: string;
    value: PermissionMode;
    onChange(value: PermissionMode): void;
    /** Route capability and machine-ceiling resolution like the execution picker. */
    routing?: ExperimentalProviderModelPickerRouting;
    /** Horizontal menu alignment. Defaults to `"end"`. */
    align?: "center" | "end" | "start";
    /** Render the resolved mode without allowing changes. */
    disabled?: boolean;
    className?: string;
}
/**
 * Every selection the composer resolved, JSON-serializable so a plugin can
 * forward it to its own backend rpc verbatim and hand it straight to
 * `bb.sdk.threads.spawn`.
 *
 * The split is deliberate: the composer owns *user selections*, the plugin
 * owns *filing and attribution*. `bb.sdk.threads.spawn` auto-fills
 * `origin: "plugin"` and `originPluginId`, so a thread created this way stays
 * attributed to the plugin — which it would not be if the component created
 * the thread itself. The plugin adds `sectionId`, `parentThreadId`, `title`,
 * and `visibility` to the request on its own; they are deliberately not
 * composer props.
 */
interface NewThreadRequest {
    /**
     * The selected project id. Choosing "Don't work in a project" submits BB's
     * personal-project id (not `null`) together with a `personal` workspace
     * environment. Forward those fields unchanged to `threads.spawn`; if the
     * plugin needs project metadata, request it from the plugin backend with
     * `bb.sdk.projects.list({ includePersonal: true })`.
     */
    projectId: string;
    providerId: string;
    model: string;
    reasoningLevel: ReasoningLevel;
    permissionMode: PermissionMode;
    /** Omitted when the selected provider has no service tiers. */
    serviceTier?: ServiceTier;
    /**
     * Per-field provenance (caller-explicit vs. default) for the execution
     * options above, forwarded to `spawn` so the server records what the user
     * actually chose.
     */
    executionInputSources: CreateExecutionInputSources;
    environment: CreateThreadEnvironmentArgs;
    input: PromptInput[];
    /**
     * Epoch ms the first turn should dispatch at. Present only when the
     * submission came from `useComposer().experimental_submit` — a scheduled
     * create — and absent otherwise, which is what makes an ordinary submission
     * start work at once. Forward it to `threads.spawn` unchanged: the thread is
     * created `pending` and its first message is queued as a row until then.
     */
    sendAt?: number;
}
/**
 * Props of the host-owned `experimental_NewThreadComposer` component — bb's
 * full new-thread compose surface (prompt editor with @-mentions and expand,
 * attachments, provider/model/reasoning picker, voice, submit, and the row
 * beneath with project, environment, branch-from, and permission mode),
 * rendered by the BB app inside a plugin slot.
 *
 * It is the create-side counterpart to `ThreadChat`: same deliberate
 * exception to the no-host-components rule (§5.5), same additive versioning.
 */
interface NewThreadComposerProps {
    /**
     * Seeds the project picker. The user can change it, including choosing
     * "Don't work in a project"; see {@link NewThreadRequest.projectId} for the
     * submitted projectless shape.
     */
    defaultProjectId?: string;
    /**
     * Seeds the provider picker. Like every `default*` prop this is a SEED, not
     * a controlled value: the composer stays uncontrolled, the user can change
     * it, and when omitted the composer falls back to the project's remembered
     * execution defaults exactly as before. When provided it takes precedence
     * over those project defaults.
     *
     * Re-seeding: the `default*` props are value-compared each render. When any
     * of them changes after mount, the composer re-seeds EVERY execution and
     * environment selection from the new props — including selections the user
     * had already touched — so switching between two saved records in the same
     * mounted composer reloads that record's values (the same rule
     * `defaultProjectId` already follows).
     *
     * Every seeded field is reported as caller-explicit in the submitted
     * request's `executionInputSources`. That is what makes the seed survive
     * `threads.spawn`: the server drops a requested `providerId`/`model` that
     * carries no provenance source and re-derives it from the project's stored
     * defaults, which would silently undo the seed.
     */
    defaultProviderId?: string;
    /** Seeds the model picker. Same seed semantics as {@link defaultProviderId}. */
    defaultModel?: string;
    /**
     * Seeds the reasoning-level picker. Same seed semantics as
     * {@link defaultProviderId}. If the seeded model does not support this
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
/**
 * Props for BB's semantic URL link. The host owns ordinary activation while
 * retaining browser-owned anchor behavior for app routes, modifiers, explicit
 * targets, copying, and unsupported schemes. New top-level targets preserve
 * supplied `rel` tokens and receive safe defaults unless `opener` is explicit.
 * Experimental: see docs/api_to_audit.md.
 */
interface UrlLinkProps extends Omit<ComponentPropsWithoutRef<"a">, "href"> {
    href: string;
}
/** A live file whose identity is complete without ambient route context. */
type ExperimentalLiveFileTarget = {
    kind: "workspace";
    environmentId: string;
    path: string;
} | {
    kind: "host";
    hostId: string;
    path: string;
} | {
    kind: "thread-storage";
    threadId: string;
    path: string;
};
/** One-based location to reveal after a live file opens. */
type ExperimentalFileLocation = {
    kind: "line";
    line: number;
    column: number | null;
} | {
    kind: "range";
    startLine: number;
    endLine: number;
};
/** Options shared by BB's preview and preferred-external file intents. */
interface ExperimentalFileOpenOptions {
    target: ExperimentalLiveFileTarget;
    location: ExperimentalFileLocation | null;
}
/**
 * Props for BB's host-rendered semantic file link. Valid targets receive a
 * scheme-safe anchor href; traversal paths, ill-formed Unicode, and other
 * malformed runtime targets remain inert.
 */
interface ExperimentalFileLinkProps extends Omit<ComponentPropsWithoutRef<"a">, "href" | "target"> {
    target: ExperimentalLiveFileTarget;
    location?: ExperimentalFileLocation | null;
}
/** The panel surface resolved by the component making the request. */
type ExperimentalAppPanelSurface = {
    kind: "current";
};
/**
 * The owning fixed tab's current memory-only target. It survives tab, panel,
 * and route remounts during the current app session, but is never persisted
 * across a refresh. Call `clear` when the owner returns to its untargeted state.
 */
interface ExperimentalFixedTabTargetState<Target extends JsonValue> {
    readonly sequence: number;
    readonly target: Target;
    clear(): void;
}
type ExperimentalOpenFixedTabOptions<Target extends JsonValue> = {
    surface: ExperimentalAppPanelSurface;
    tab: ExperimentalPluginFixedTabReference<Target>;
    /** Omit to select the tab without replacing its current session target. */
    target?: NoInfer<Target>;
};
/** Surface-aware controller for selecting owner-scoped fixed tabs. */
interface ExperimentalAppPanel {
    openFixedTab<Target extends JsonValue = never>(options: ExperimentalOpenFixedTabOptions<Target>): boolean;
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
    openThreadPanel(options: PluginTargetedPanelActionOpenOptions): boolean;
    /**
     * Open an HTTP(S) URL using this client's BB browser preference. Returns
     * false for schemes the host does not own. Experimental: see
     * docs/api_to_audit.md.
     */
    openUrl(url: string): boolean;
    /** Open a live file in this surface's shared BB preview panel. */
    experimental_openFilePreview(options: ExperimentalFileOpenOptions): boolean;
    /** Open a live file in this client's preferred external file target. */
    experimental_openFileExternally(options: ExperimentalFileOpenOptions): boolean;
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
    /** Select one of this plugin's eligible fixed tabs on the current surface. */
    experimental_useAppPanel(): ExperimentalAppPanel;
    /** Read or clear the owning tab's validated, session-scoped target. */
    experimental_useFixedTabTarget<Target extends JsonValue>(tab: ExperimentalPluginFixedTabReference<Target>): ExperimentalFixedTabTargetState<Target> | null;
    useComposer(): PluginComposerApi;
    /**
     * The sidebar's live thread view (see {@link PluginSidebarThreadsState}).
     * Reads the host's own cache and realtime subscriptions, so it costs no
     * extra request and updates exactly when the built-in sidebar does.
     *
     * `threads` is one array of every visible thread and is not capped. Thread
     * objects keep their identity across updates while the underlying entry is
     * unchanged, so a memoized row re-renders only when its own thread changed;
     * the array itself is new on every update. Window your rows (render only
     * what is on screen) as the built-in sidebar does — a list that mounts one
     * row per thread is slow on phones with many threads.
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
     * The provider directory (see {@link PluginProvidersState}). Reads the
     * host's own cached provider roster, so a plugin that shows a thread's
     * provider never re-vendors provider names, icons, or copy. Experimental:
     * see docs/api_to_audit.md.
     */
    experimental_useProviders(): PluginProvidersState;
    /**
     * The active code theme as a VS Code theme file (see
     * {@link PluginCodeThemeState}), for a plugin that renders code with an
     * engine of its own and needs BB's palette to reach it. Experimental: see
     * docs/api_to_audit.md.
     */
    experimental_useCodeTheme(): PluginCodeThemeState;
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
     * A real anchor whose ordinary HTTP(S) activation uses BB's URL preference.
     * Experimental: see docs/api_to_audit.md.
     */
    UrlLink: ComponentType<UrlLinkProps>;
    /** Host-rendered live-file link backed by the shared navigation controller. */
    experimental_FileLink: ComponentType<ExperimentalFileLinkProps>;
    /**
     * The host-owned new-thread compose surface (see
     * {@link NewThreadComposerProps}). Experimental: see
     * docs/api_to_audit.md for what to audit before the prefix drops.
     */
    experimental_NewThreadComposer: ComponentType<NewThreadComposerProps>;
    /**
     * BB's controlled provider/model/reasoning picker. Provider changes emit
     * only after the new provider's verified defaults and capabilities resolve,
     * so `onChange` always receives one coherent value. Experimental: see
     * docs/api_to_audit.md.
     */
    experimental_ProviderModelPicker: ComponentType<ExperimentalProviderModelPickerProps>;
    /**
     * BB's controlled permission-mode picker. The host resolves provider
     * capabilities and the routed machine's permission ceiling. Experimental:
     * see docs/api_to_audit.md.
     */
    experimental_PermissionModePicker: ComponentType<ExperimentalPermissionModePickerProps>;
    /**
     * The host-owned source viewer (see {@link SourceCodeProps}). Renders
     * supplied source text with BB's syntax highlighting, gutters, and live code
     * theme, and honours an active `experimental_sourceCodeRenderer`
     * replacement. Experimental: see docs/api_to_audit.md.
     */
    experimental_SourceCode: ComponentType<SourceCodeProps>;
    /**
     * The host-owned diff viewer (see {@link DiffProps}). Renders supplied patch
     * content with BB's normalization, optional full-file context expansion,
     * syntax highlighting, unified/split presentation, and live code theme, and
     * honours an active
     * `experimental_diffRenderer` replacement. Experimental: see
     * docs/api_to_audit.md.
     */
    experimental_Diff: ComponentType<DiffProps>;
    useComposerView(): ComposerView;
}

interface BrowserTabsArgs {
    signal?: AbortSignal;
}
interface BrowserBatchArgs extends BrowserBatchRequest {
    signal?: AbortSignal;
}
interface BrowserControlArgs extends BrowserControlRequest {
    signal?: AbortSignal;
}
interface BrowserOpenArgs extends BrowserOpenRequest {
    signal?: AbortSignal;
}
interface BrowserWaitArgs {
    target: BrowserTabTarget;
    criteria: BrowserWaitCriteria;
    timeoutMs: number;
    signal?: AbortSignal;
}
type BrowserBatchResult = BrowserBatchResponse;
type BrowserTabsResult = BrowserTabsResponse;
type BrowserControlResult = BrowserControlResponse;
type BrowserOpenResult = BrowserOpenResponse;
interface BrowserArea {
    batch(args: BrowserBatchArgs): Promise<BrowserBatchResult>;
    control(args: BrowserControlArgs): Promise<BrowserControlResult>;
    open(args: BrowserOpenArgs): Promise<BrowserOpenResult>;
    tabs(args?: BrowserTabsArgs): Promise<BrowserTabsResult>;
    wait(args: BrowserWaitArgs): Promise<BrowserControlResult>;
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
    status(args: EnvironmentStatusArgs): Promise<EnvironmentStatusResult>;
    update(args: EnvironmentUpdateArgs): Promise<EnvironmentUpdateResult>;
}

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
    contentEncoding?: "base64" | "utf8";
    createParents?: boolean;
    expectedSha256?: string | null;
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
interface ProjectSidebarBootstrapArgs {
    signal?: AbortSignal;
}
interface ProjectAttachmentFileLike {
    arrayBuffer(): Promise<ArrayBuffer>;
    readonly name: string;
    readonly type?: string;
}
interface ProjectAttachmentUploadArgsBase {
    mimeType?: string;
    projectId: string;
}
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
    content: string;
    contentEncoding: "base64" | "utf8";
    mimeType: string;
    sizeBytes: number;
}
type ProjectFilesResult = WorkspaceFileListResponse;
type ProjectGetResult = ProjectResponse;
type ProjectListResult = ProjectResponse[] | ProjectWithThreadsResponse[];
type ProjectPathsResult = WorkspacePathListResponse;
type ProjectPromptHistoryResult = PromptHistoryResponse;
type ProjectReorderResult = ProjectResponse[];
type ProjectSidebarBootstrapResult = SidebarBootstrapResponse;
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
    sidebarBootstrap(args?: ProjectSidebarBootstrapArgs): Promise<ProjectSidebarBootstrapResult>;
    sources: ProjectSourcesArea;
    update(args: ProjectUpdateArgs): Promise<ProjectUpdateResult>;
}

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
    capability?: SystemProvidersQuery["capability"];
    signal?: AbortSignal;
};
type ProviderModelsArgs = ProviderHostRoutingArgs & {
    providerId?: string;
    signal?: AbortSignal;
};
type ProviderListResult = ProviderInfo[];
type ProviderModelsResult = SystemExecutionOptionsResponse;
interface ProvidersArea {
    list(args?: ProviderListArgs): Promise<ProviderListResult>;
    models(args?: ProviderModelsArgs): Promise<ProviderModelsResult>;
}

interface PluginIdArgs {
    pluginId: string;
}
interface PluginInstallArgs {
    source: string;
    subdirectory?: string;
    plugin?: string;
}
interface PluginCatalogInstallArgs {
    entryId: string;
    marketplace?: string;
    confirmedSource?: PluginCatalogResolvedSource;
}
interface PluginCatalogInstallPlanArgs {
    entryId: string;
    marketplace?: string;
    signal?: AbortSignal;
}
interface PluginMarketplaceAddArgs {
    source: string;
}
interface PluginMarketplaceListArgs {
    signal?: AbortSignal;
}
interface PluginMarketplaceRefreshArgs {
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
type PluginCatalogSearchResult = PluginCatalogSearchResponse;
type PluginCatalogInstallPlanResult = PluginCatalogInstallPlan;
type PluginMarketplaceListResult = PluginMarketplace[];
type PluginMarketplaceAddResult = PluginMarketplace;
type PluginMarketplaceRefreshResult = PluginMarketplaceRefreshResult$1[];
interface PluginMarketplaceRemoveResult {
    convertedPluginIds: string[];
}
interface PluginCatalogArea {
    install(args: PluginCatalogInstallArgs): Promise<PluginInstallResult>;
    installPlan(args: PluginCatalogInstallPlanArgs): Promise<PluginCatalogInstallPlanResult>;
    search(args: PluginCatalogSearchArgs): Promise<PluginCatalogSearchResult>;
    status(args?: PluginCatalogStatusArgs): Promise<PluginCatalogStatusResult>;
}
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
type BbRealtimeEventName = "environment:changed" | "host:changed" | "project:changed" | "realtime:connection" | "system:changed" | "system:config-changed" | "thread:changed";
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
type BbRealtimeConnectionState = "connected" | "connecting" | "disconnected";
interface BbRealtimeConnectionEvent {
    reconnectDelayMs: number | null;
    reconnected: boolean;
    state: BbRealtimeConnectionState;
}
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
    get(args?: ThemeGetArgs): Promise<ThemeGetResult>;
    catalog(args?: ThemeCatalogArgs): Promise<ThemeCatalogResult>;
    set(selection: ThemeSetInput): Promise<ThemeSetResult>;
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
interface SystemProviderStatesArgs extends SystemProvidersQuery {
    signal?: AbortSignal;
}
type SystemProviderStatesResult = SystemProviderStatesResponse;
type SystemVersionResult = SystemVersionResponse;
interface SystemArea {
    attention(args?: SystemAttentionArgs): Promise<SystemAttentionResult>;
    config(args?: SystemConfigArgs): Promise<SystemConfigResult>;
    executionOptions(args?: SystemExecutionOptionsArgs): Promise<SystemExecutionOptionsResult>;
    cliSkillsStatus(args?: SystemCliSkillsStatusArgs): Promise<SystemCliSkillsStatusResult>;
    installCliSkills(args: SystemInstallCliSkillsArgs): Promise<SystemInstallCliSkillsResult>;
    reloadConfig(): Promise<SystemReloadConfigResult>;
    transcribeVoice(args: SystemVoiceTranscriptionArgs): Promise<SystemVoiceTranscriptionResult>;
    updateExperiments(args: Experiments): Promise<SystemUpdateExperimentsResult>;
    updateGeneralSettings(args: AppSettings): Promise<SystemUpdateGeneralSettingsResult>;
    updateKeyboardSettings(args: AppKeybindingOverrides): Promise<SystemUpdateKeyboardSettingsResult>;
    providerStates(args?: SystemProviderStatesArgs): Promise<SystemProviderStatesResult>;
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
    cwd?: string;
    environmentId?: never;
    hostId: string;
    kind: "host_path";
    threadId?: never;
}
interface TerminalHostPathCreateScope {
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
/**
 * Counting is a server-side `SELECT count(*)`: a caller that only needs "how
 * many threads are running on this host" must never page rows through
 * `threads.list`, which would both cost memory and miscount past its limit.
 *
 * Every filter is genuinely absent by default. `parentThreadId` is
 * three-valued: omitted does not filter on parentage at all, the
 * `THREAD_COUNT_ROOT_PARENT` sentinel (`"none"`) counts root threads only, and
 * any other value counts that parent's children. Archived and deleted threads
 * are excluded by the route.
 */
interface ThreadCountArgs {
    groupBy?: ThreadCountGroupBy;
    hostId?: string;
    parentThreadId?: string;
    projectId?: string;
    providerId?: string;
    signal?: AbortSignal;
    status?: ThreadStatus;
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
type ThreadCountResult = ThreadCountResponse;
/**
 * The threads occupying capacity right now — canonical status `starting` or
 * `active`, archived and deleted excluded, hidden included (a hidden thread
 * burns a real slot). Each row is just `id` and `hostId` — the machine whose
 * pool the thread occupies, from its environment or, before one is attached,
 * from the start intent it was admitted with; null only when neither names
 * one. Anything else a policy needs it fetches by id.
 *
 * **Exact inside the `message.dispatch` hook, a snapshot everywhere else.**
 * Hook passes are serialized under one server-wide lock and a cleared first
 * attempt commits its `pending -> starting` flip before that lock releases, so
 * a handler reading this sees every admission granted ahead of it in the same
 * burst — which is what makes "five quick creates against a limit of two" hold
 * three of them instead of admitting all five. Read from a background service,
 * a timer or a `turn.failed` listener it is an ordinary query racing with every
 * concurrent dispatch, exactly like {@link ThreadsArea.count}.
 *
 * One boundary: a warm follow-up admitted on an already-live `idle` thread
 * flips `idle -> active` inside the send transaction, just AFTER the lock
 * releases. First-dispatch admissions are exact; a burst of follow-ups to
 * distinct idle threads can momentarily under-report.
 */
type ThreadRunningResult = ThreadRunningResponse;
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
type ThreadSendResult = SendMessageResponse;
type ThreadRetryResult = RetryTurnResponse;
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
type ThreadQueueListResult = ThreadQueuedMessageListResponse;
type ThreadTabsResult = ThreadTabsResponse;
type ThreadTabsUpdateResult = ThreadTabsResponse;
type ThreadStorageFilesResult = ThreadStorageFileListResponse;
type ThreadStorageLocationResult = ThreadStorageLocationResponse;
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
interface ThreadForkArgs extends Omit<ForkThreadRequest, "origin" | "visibility"> {
    origin?: ForkThreadRequest["origin"];
    visibility?: ForkThreadRequest["visibility"];
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
interface ThreadRetryArgs {
    threadId: string;
    /**
     * The failed turn to re-submit. Omitted means the thread's most recent turn,
     * which is the one whose failure put it in `error`; naming one asserts which
     * failure you decided on and fails if the thread has moved on since.
     */
    turnRequestId?: string;
    /**
     * Epoch ms to retry at. Omitted attempts the retry now — it may still queue
     * behind a busy thread or a plugin wait, like any other dispatch.
     */
    sendAt?: number;
    /** Why the turn is being retried, shown verbatim on the queued row. */
    reason?: string;
}
interface ThreadActionArgs {
    threadId: string;
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
/**
 * Both filters are genuinely absent by default: no filter lists every live
 * queued row in the workspace, which is what `bb thread queue list` with no
 * thread and a limiter plugin's own bookkeeping ask for.
 */
interface ThreadQueueListArgs {
    /** `plugin:<id>` — every row that plugin is holding the wait on. */
    waitHolder?: QueuedMessageWaitHolder;
    signal?: AbortSignal;
    threadId?: string;
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
    beforeSeq?: string;
    limit?: string;
    order?: "asc" | "desc";
    signal?: AbortSignal;
    threadId: string;
    types?: readonly [ThreadEventType, ...ThreadEventType[]];
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
/**
 * Queued rows across every thread.
 *
 * The per-thread list, send-now, edit, reorder and delete all live on
 * `queuedMessages`, which is where a row's own operations belong. This area
 * exists for the one question a thread-scoped list cannot answer: "what is
 * queued right now, anywhere" — a workspace-wide pending view, or a plugin
 * recovering the rows it is holding after a restart.
 */
interface ThreadQueueArea {
    list(args?: ThreadQueueListArgs): Promise<ThreadQueueListResult>;
}
interface ThreadsArea {
    archive(args: ThreadActionArgs): Promise<ThreadArchiveResult>;
    archiveAll(args: ThreadActionArgs): Promise<ThreadArchiveAllResult>;
    childSummary(args: ThreadStatusArgs): Promise<ThreadChildSummaryResult>;
    compact(args: ThreadActionArgs): Promise<ThreadCompactResult>;
    cancelPlan(args: ThreadActionArgs): Promise<ThreadBannerActionResult>;
    clearContext(args: ThreadActionArgs): Promise<ThreadBannerActionResult>;
    clearGoal(args: ThreadActionArgs): Promise<ThreadBannerActionResult>;
    conversationOutline(args: ThreadStatusArgs): Promise<ThreadConversationOutlineResult>;
    count(args?: ThreadCountArgs): Promise<ThreadCountResult>;
    defaultExecutionOptions(args: ThreadStatusArgs): Promise<ThreadDefaultExecutionOptionsResult>;
    delete(args: ThreadDeleteArgs): Promise<ThreadDeleteResult>;
    editMessage(args: ThreadEditMessageArgs): Promise<ThreadEditMessageResult>;
    events: ThreadEventsArea;
    fork(args: ThreadForkArgs): Promise<ThreadForkResult>;
    get(args: ThreadGetArgs): Promise<ThreadGetResult>;
    queue: ThreadQueueArea;
    interactions: ThreadInteractionsArea;
    list(args?: ThreadListArgs): Promise<ThreadListResult>;
    listRunning(args?: {
        signal?: AbortSignal;
    }): Promise<ThreadRunningResult>;
    markRead(args: ThreadActionArgs): Promise<ThreadReadStateResult>;
    markUnread(args: ThreadActionArgs): Promise<ThreadReadStateResult>;
    open(args: ThreadOpenArgs): Promise<ThreadOpenResult>;
    paneAction(args: ThreadPaneActionArgs): Promise<ThreadPaneActionResult>;
    output(args: ThreadOutputArgs): Promise<ThreadOutputResponse>;
    pin(args: ThreadActionArgs): Promise<ThreadMutationResult>;
    promptHistory(args: ThreadPromptHistoryArgs): Promise<ThreadPromptHistoryResult>;
    queuedMessages: ThreadQueuedMessagesArea;
    reorderPinned(args: ThreadPinOrderArgs): Promise<ThreadPinOrderResult>;
    resolveMentions(args: ThreadResolveMentionsArgs): Promise<ThreadResolveMentionsResult>;
    /**
     * Re-submit a failed turn. The retry is an ordinary dispatch attempt, so a
     * `sendAt` in the future queues it on the clock and a `message.dispatch` hook
     * can still hold it; the response says which of the two happened.
     */
    retry(args: ThreadRetryArgs): Promise<ThreadRetryResult>;
    search(args: ThreadSearchArgs): Promise<ThreadSearchResult>;
    send(args: ThreadSendArgs): Promise<ThreadSendResult>;
    spawn(args: ThreadSpawnArgs): Promise<ThreadSpawnResult>;
    stop(args: ThreadActionArgs): Promise<ThreadStopResult>;
    tabs: ThreadTabsArea;
    timeline(args: ThreadTimelineArgs): Promise<ThreadTimelineResult>;
    timelineTurnSummaryDetails(args: ThreadTimelineTurnSummaryDetailsArgs): Promise<ThreadTimelineTurnSummaryDetailsResult>;
    storageFiles(args: ThreadStorageFilesArgs): Promise<ThreadStorageFilesResult>;
    storageLocation(args: ThreadStatusArgs): Promise<ThreadStorageLocationResult>;
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

interface BbSdkAreas extends BbRealtime {
    browser: BrowserArea;
    environments: EnvironmentsArea;
    files: FilesArea;
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
interface BbSdk extends BbSdkAreas {
    guide: GuideArea;
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
type ExperimentalHostWatchChangeType = "create" | "delete" | "update";
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
type PluginSettingDescriptor = {
    type: "string";
    label: string;
    description?: string;
    /** Stored in a 0600 file under <dataDir>/plugins/<id>/secrets/, never in the db or sent to the frontend. */
    secret?: true;
    /**
     * Render as a multi-line text field; for JSON or lists. Secrets cannot
     * be multi-line.
     */
    experimental_multiline?: boolean;
    /** Synchronously validate without transforming a proposed value. */
    experimental_schema?: StandardSchemaV1<string, string>;
    default?: string;
} | {
    type: "boolean";
    label: string;
    description?: string;
    /** Synchronously validate without transforming a proposed value. */
    experimental_schema?: StandardSchemaV1<boolean, boolean>;
    default?: boolean;
} | {
    type: "number";
    label: string;
    description?: string;
    experimental_schema?: StandardSchemaV1<number, number>;
    default?: number;
} | {
    type: "select";
    label: string;
    description?: string;
    options: string[];
    /** Synchronously validate without transforming a proposed value. */
    experimental_schema?: StandardSchemaV1<string, string>;
    default?: string;
} | {
    type: "project";
    label: string;
    description?: string;
    /** Synchronously validate without transforming a proposed value. */
    experimental_schema?: StandardSchemaV1<string, string>;
    default?: string;
};
type PluginSettingDescriptors = Record<string, PluginSettingDescriptor>;
type PluginSettingValue = string | number | boolean;
/** `default` present → non-optional value; absent → `T | undefined`. */
type PluginSettingsValues<Ds extends Record<string, PluginSettingDescriptor>> = {
    [K in keyof Ds]: Ds[K] extends {
        default: string | number | boolean;
    } ? PluginSettingValueOf<Ds[K]> : PluginSettingValueOf<Ds[K]> | undefined;
};
type PluginSettingValueOf<D extends PluginSettingDescriptor> = D extends {
    type: "boolean";
} ? boolean : D extends {
    type: "number";
} ? number : string;
interface PluginSettingsHandle<Ds extends Record<string, PluginSettingDescriptor>> {
    /** Load-safe: callable inside the factory. */
    get(): Promise<PluginSettingsValues<Ds>>;
    /** Validate and persist this handle's fields; `null` unsets a stored value. */
    experimental_set(values: Partial<{
        [K in keyof Ds]: PluginSettingValueOf<Ds[K]> | null;
    }>): Promise<PluginSettingsValues<Ds>>;
    /** Fires after effective values change through any settings write. */
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
     * The plugin's own SQLite database at <dataDir>/plugins/<id>/data.db — the
     * server's better-sqlite3, WAL mode, busy_timeout 5000. Returns the same
     * open handle for the whole plugin load, so calling it per request is
     * cheap; a new handle is opened only on the first call or after the
     * plugin closed the previous one. The host closes handles on
     * dispose/reload; a closed handle throws on use.
     */
    database(): Database.Database;
    /**
     * Ordered-statement migration helper: statement index = migration id in a
     * `_bb_migrations` table; unapplied statements run in one transaction. The
     * host records each statement hash and rejects changed or reused indexes.
     * Append-only — never reorder or edit shipped statements.
     */
    migrate(db: Database.Database, statements: string[]): void;
}
/**
 * Why a turn failed, assembled by core from the failed turn's own records so a
 * listener never has to replay the event log to find out.
 *
 * Ids and failure facts only. There is no thread DTO and no copy of the
 * message that failed: a retry re-submits the turn BY REFERENCE
 * (`bb.sdk.threads.retry`), so the id is the whole of what a policy needs, and
 * anything else about the thread is one `bb.sdk.threads.get` away and fresher
 * for being read when it is used.
 */
interface PluginTurnFailedEvent {
    /** The thread the failed turn ran on. */
    threadId: string;
    /**
     * The failed turn's `client/turn/requested` id — what
     * `bb.sdk.threads.retry` takes as `turnRequestId`. On a retry's failure this
     * is the RETRY's id; core walks back to the request the chain started from
     * when it queues the next attempt.
     */
    requestId: string;
    /** The provider turn, when the failure happened inside one. */
    turnId: string | null;
    /**
     * The failure's structured classification: the provider's own report when
     * the failure happened inside a turn, or the typed rejection code (a rate
     * limit, an auth failure) when the provider refused the request at the
     * door. Null when neither carried one, so a retry policy must handle null
     * rather than assume.
     */
    errorInfo: ProviderErrorInfo | null;
    /**
     * Whether the provider accepted the turn's input before failing. True is a
     * mid-stream failure — the input is already part of the provider's
     * conversation, so core's retry continues it instead of re-sending the
     * blocks. False is a request the provider never took, which a retry
     * re-sends verbatim.
     */
    inputAccepted: boolean;
    /**
     * The most recent rate-limit snapshot this thread's provider reported, or
     * null when the provider reports no windows.
     */
    rateLimits: ProviderRateLimitState | null;
    /**
     * Which attempt just failed: 1 is the original dispatch, 2 the first retry.
     * A policy caps its own retries by comparing against this.
     */
    attemptNumber: number;
}
/**
 * Lifecycle events a plugin can observe with `bb.events.on` (design §4.5).
 *
 * **Events are announcements core makes.** Something already happened; a
 * handler is told about it and whatever it returns is IGNORED. Handlers run
 * fire-and-forget after the change is applied and can never block or veto it.
 * The surface that *can* is `bb.experimental_hooks`, where core asks a
 * question and acts on the answer — the same split git draws between its
 * post-commit and pre-commit hooks.
 *
 * `thread` is the same public DTO GET /threads/:id serves and `entry` is the
 * queued row GET /threads/:id/queued-messages serves.
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
    /** Fired after a pending interaction row is committed. */
    "interaction.pending": {
        thread: ThreadResponse;
        interaction: PendingInteraction;
    };
    /**
     * Fired after a dispatch attempt is queued as a row — by a `message.dispatch`
     * hook's `wait` decision, by a `sendAt` in the future, or by a core wait (the
     * thread is busy, its turn is still starting, provisioning, or awaiting an
     * interaction).
     *
     * Every listener sees every queued row, not just the ones it is holding: an
     * observer that only wants its own filters on
     * `entry.waitingOn?.kind === "plugin" && entry.waitingOn.pluginId === bb.pluginId`.
     *
     * A re-queue fires this again with the new wait, because a row that moved
     * from one wait to another is news to whoever was waiting on the old one.
     */
    "message.queued": {
        entry: ThreadQueuedMessage;
    };
    /**
     * Fired after a queued row's waits all cleared and it dispatched. The turn
     * it carried runs after this, so a handler must not assume it has started.
     */
    "message.dispatched": {
        entry: ThreadQueuedMessage;
    };
    /**
     * Fired after a turn failed and the thread has already landed in `error`.
     *
     * An announcement, not a question: the failure stands exactly as core
     * applied it, and a listener that wants another attempt asks for one with
     * `bb.sdk.threads.retry({ threadId, turnRequestId, sendAt })`. That retry is
     * an ordinary dispatch attempt, so it still passes the `message.dispatch`
     * hook — a retry coming back after a rate-limit window respects a limiter
     * that is at capacity instead of jumping the queue.
     */
    "turn.failed": PluginTurnFailedEvent;
}
type PluginThreadEventName = keyof PluginThreadEventPayloads;
type PluginThreadEventHandler<E extends PluginThreadEventName> = (payload: PluginThreadEventPayloads[E]) => void | Promise<void>;
/**
 * What a `message.dispatch` hook answers.
 *
 * `proceed` lets the attempt continue. `wait` QUEUES the message as a row
 * whose `waitingOn` names this plugin and carries `reason` verbatim; the
 * row stays queued until `sendAt` comes due, capacity frees, the user sends
 * it now, or the orphan sweep clears it because this plugin is no longer
 * running. `sendAt` (epoch ms) sets the row's own `sendAt`, so core's due sweep
 * re-attempts at that instant without the plugin holding a timer of its own —
 * which is what a rate-limit window wants. `reject` refuses the attempt
 * outright: `message` is shown to the user verbatim.
 *
 * There is deliberately no "handled it myself" answer and no amendment arm —
 * a hook is a decision, never an owner or an author of the work.
 */
type MessageDispatchHookDecision = {
    action: "proceed";
} | {
    action: "wait";
    reason: string;
    sendAt?: number | null;
} | {
    action: "reject";
    message: string;
};
/**
 * The execution tuple as core resolved it before this hook ran. `model` and
 * the three option fields are null only when no default has been resolved for
 * them yet; `providerId` is always resolved.
 */
interface PluginDispatchExecution {
    providerId: string;
    model: string | null;
    reasoningLevel: ReasoningLevel | null;
    serviceTier: ServiceTier | null;
    permissionMode: PermissionMode | null;
}
/**
 * Where each execution value came from. `explicit` is a user choice,
 * `client-preference` a remembered client default, and null means core
 * resolved it from project/provider defaults. A hook that must not act against
 * a deliberate choice checks for `explicit` here.
 */
interface PluginDispatchExecutionSources {
    providerId: ExecutionInputFieldSource | null;
    model: ExecutionInputFieldSource | null;
    reasoningLevel: ExecutionInputFieldSource | null;
    serviceTier: ExecutionInputFieldSource | null;
    permissionMode: ExecutionInputFieldSource | null;
}
/**
 * The prompt this dispatch carries. `blocks` is the message itself; `text` is
 * the concatenated text of its text blocks, which is what a rules-based hook
 * actually wants to match on.
 */
interface PluginDispatchInput {
    blocks: readonly PromptInput[];
    text: string;
}
/**
 * How this attempt would reach the provider.
 *
 * `start-turn` is a dispatch that begins a turn: a thread's first message, a
 * plain send to an idle or `pending` thread, or a steer-mode message that
 * found no running turn to join. `join-turn` is an injection into a turn that
 * is already executing.
 *
 * Decision powers are identical for both — a steer is hooked exactly like a
 * send, uniformly. A hook that limits concurrency proceeds on `join-turn`: the
 * thread already holds its slot, so joining it asks for nothing new.
 */
type PluginDispatchAttemptKind = "join-turn" | "start-turn";
/**
 * What core hands a `message.dispatch` hook: the one checkpoint, run before a
 * message reaches a provider. The exception is a user's explicit Send-now on a
 * queued row, which bypasses the pass by design — it is the user overriding
 * policy, and a policy that could veto its own override would not be one.
 *
 * It runs identically whether the attempt is inline (someone just sent) or
 * from a drain (a queued row became eligible again), and whether the message
 * is a thread's first, a follow-up, a steer, or a retry of a failed turn. A
 * handler must therefore be idempotent for one logical dispatch: passes re-run
 * on every drain, on restart, and on retry.
 */
interface MessageDispatchHookContext {
    /**
     * The target thread. Never null: thread creation is unhooked — it is a cheap
     * row — so by the time the first message is decided about, the thread exists
     * in `pending`, with its provider resolved and nothing provisioned.
     */
    thread: ThreadResponse;
    project: Project;
    /** Null until an environment is chosen (a queued or not-yet-provisioned thread). */
    environment: Environment | null;
    /**
     * The machine the work will run on. Resolved from the environment when one
     * is attached, and before that from the start intent the thread was created
     * with — so a per-host policy counts a cold start against the pool it is
     * about to occupy. Null only when neither names a machine.
     */
    host: Host | null;
    input: PluginDispatchInput;
    requestedExecution: PluginDispatchExecution;
    /** Where each execution value came from. */
    executionSources: PluginDispatchExecutionSources;
    /** Whether this attempt starts a turn or joins a running one. */
    attempt: PluginDispatchAttemptKind;
    /**
     * The queued row this attempt is re-trying, or null when the attempt is
     * inline and no row has ever existed for it.
     *
     * This is how a hook tells a fresh send from a re-attempt of something it
     * already decided about — the replacement for the old
     * `isReleaseReevaluation`/`hold` pair. A hook that counts in-flight work
     * should treat the two identically; a hook that logs should not
     * double-count.
     */
    queuedMessage: ThreadQueuedMessage | null;
    /** How the dispatch was requested; null for internal/core-driven sends. */
    origin: ThreadCreateOrigin | null;
    originPluginId: string | null;
    startedOnBehalfOf: StartedOnBehalfOf | null;
    parentThreadId: string | null;
}
/**
 * The hooks a plugin can answer, each mapping its key to the context core
 * hands the handler and the decision core acts on. `on()` and the handler type
 * derive from this map — and so does the server's hook registry — so a
 * half-added hook does not compile.
 *
 * One hook today: `message.dispatch`, THE admission checkpoint, run identically
 * for a thread's first message, a follow-up, a steer, a retry, and every
 * re-attempt a drain makes. It replaced the earlier `thread.create` +
 * `turn.submit` pair, whose split was an accident of where the code happened to
 * branch rather than a difference a plugin needed to see — the attempt's own
 * `attempt` kind carries what actually differs.
 */
interface PluginHookSignatures {
    "message.dispatch": {
        context: MessageDispatchHookContext;
        decision: MessageDispatchHookDecision;
    };
}
type PluginHookName = keyof PluginHookSignatures;
type PluginHookHandler<K extends PluginHookName> = (context: PluginHookSignatures[K]["context"]) => PluginHookSignatures[K]["decision"] | Promise<PluginHookSignatures[K]["decision"]>;
interface PluginHooks {
    /**
     * Answer a hook.
     *
     * **Hooks are questions core asks.** Core stops at a checkpoint, hands the
     * handler a context, and ACTS ON what it returns — the opposite of
     * `bb.events`, whose handlers are told what already happened and whose
     * return value is ignored. It is the same split git draws between its
     * pre-commit and post-commit hooks, and the reason the two live in separate
     * namespaces rather than behind one `on`.
     *
     * Handlers for a hook run as a deterministic chain in plugin install order,
     * a `reject` short-circuits the pass, and `wait` decisions are COLLECTED
     * across the whole pass rather than short-circuiting. The attempt proceeds
     * only when a pass yields no waits. When several plugins wait, the FIRST owns
     * the row's `waitingOn` and the rest have their reasons appended to it, so
     * one decision produces one card rather than one per plugin; each of them
     * answers again on the next attempt, so nothing is lost by not owning the
     * row.
     *
     * Fail-closed: a handler that throws or exceeds the 10 second decision box
     * FAILS THE ATTEMPT with this plugin named. Decide in milliseconds — if the
     * answer needs real work, return `wait` with a `sendAt` and answer again on
     * the re-attempt.
     *
     * The whole pass runs under one server-wide lock, so a counting handler never
     * races another attempt. It also means a handler that blocks delays every
     * other attempt, up to the box.
     *
     * Passes re-run on every drain, on restart and on retry. A handler must be
     * idempotent for one logical dispatch.
     *
     * At most one handler per hook per plugin; registering a second replaces
     * nothing and throws.
     */
    on<K extends PluginHookName>(hook: K, handler: PluginHookHandler<K>): void;
    /**
     * Ask core to re-attempt the messages queued behind plugin waits.
     *
     * **The pair to `on`.** `on` answers the question core asks; `recheck`
     * asks core to ask it again. Core owns the re-draining and the clock — the
     * `sendAt` due sweep is still core's — and a plugin owns every other
     * condition its own waits depend on. When that condition changes, say so
     * here and answer the hook again on the re-attempt; there is no way to
     * release a specific row, and there does not need to be.
     *
     * The walk re-attempts every plugin-queued row IN QUEUE ORDER, each one
     * claimed exactly once, running the full `message.dispatch` pass over it —
     * every plugin's handler, not just the caller's. A row that is still blocked
     * simply re-queues, which is what makes an unwarranted request safe: nobody
     * has to work out whether their own condition was the last one the message
     * was waiting on. The existing per-thread re-queue pacing bounds the churn,
     * so a plugin that stays full is not re-asked in a loop.
     *
     * Bursts coalesce: several calls before the walk starts produce one walk.
     *
     * **Resolves when the walk is SCHEDULED, not when it finishes.** The walk is
     * a background pass with no caller to report to — its failures land on the
     * rows, exactly as the due sweep's do. Awaiting completion would also mean
     * awaiting a full hook pass from inside whatever called this, which for a
     * handler holding the evaluation lock could not complete. Fire and forget.
     */
    recheck(hook: PluginHookName): Promise<void>;
}
type PluginHttpAuthMode = "local" | "none" | "token";
type PluginHttpHandler = (context: Context) => Response | Promise<Response>;
interface ExperimentalPluginWebSocket {
    send(data: string | Uint8Array): void;
    close(code?: number, reason?: string): void;
    readonly readyState: number;
}
interface ExperimentalPluginWebSocketContext {
    request: Request;
    url: URL;
    headers: Headers;
}
interface ExperimentalPluginWebSocketHandlers {
    onOpen?(socket: ExperimentalPluginWebSocket): void | Promise<void>;
    onMessage?(socket: ExperimentalPluginWebSocket, data: string | Uint8Array): void | Promise<void>;
    onClose?(socket: ExperimentalPluginWebSocket, event: {
        code: number;
        reason: string;
    }): void | Promise<void>;
    onError?(socket: ExperimentalPluginWebSocket, error: Error): void;
}
type ExperimentalPluginWebSocketHandler = (context: ExperimentalPluginWebSocketContext) => ExperimentalPluginWebSocketHandlers;
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
    /**
     * Register a WebSocket route in the same `/http/` namespace as `route`.
     * A GET request upgrades only when it carries `Upgrade: websocket`.
     * Auth modes and exact-path matching are identical to HTTP routes.
     */
    experimental_websocket(path: string, handler: ExperimentalPluginWebSocketHandler, opts?: {
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
     * `needs-configuration` and stops restarting until the next load. An
     * error raised outside the `start` promise (an unlistened EventEmitter
     * 'error', a throw in a timer callback, a detached rejection) counts as
     * a crash too: the run is aborted and restarted the same way.
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
type PluginInteractionCancelReason = "plugin-disposed" | "request-aborted" | "server-restarted" | "thread-deleted" | "thread-stopped" | "timeout" | "user";
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
    /** Preferred top-level command name (`bb <name> …`): lowercase [a-z0-9-]+.
     * A core collision logs an activation warning and remains available through
     * `bb plugin run <plugin-id>`. */
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
     * name collisions; the plugin is warned and remains explicitly callable by id.
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
 * The row title of a plugin tool call while it is pending and once it
 * settled. Each label is capped at 80 characters and rendered as plain text.
 */
interface PluginAgentToolLabels {
    /** Label shown while the tool call is pending. */
    pending: string;
    /** Label shown after the tool call completes successfully. */
    completed: string;
}
/**
 * How calls to a native plugin tool read as a timeline row (grammar v3). Every
 * field is optional at registration: the server fills what the plugin leaves
 * out (a generic `Running <name>` / `Ran <name>` label; the plugin's branding
 * glyph, then `Toolbox`) and hands one complete presentation to the provider
 * bridge with the tool definition.
 */
interface PluginAgentToolPresentation {
    /** Row title while the call is pending and once it settled. */
    label?: PluginAgentToolLabels;
    /**
     * A named host glyph (`{ glyph: "Workflow" }`), or one of this plugin's
     * own declared icons by its namespaced glyph (`{ glyph: "<pluginId>/<name>" }`,
     * an entry of the manifest's `bb.branding.experimental_icons` map). A
     * namespaced glyph that names another plugin or an undeclared name rejects
     * the tool registration.
     */
    icon?: {
        glyph: string;
    };
    /** Low-value rows clients collapse by default (a question a dedicated
     * interaction row already shows, a bookkeeping call). */
    suppress?: boolean;
    /** Accent colour per theme; omitted rows use the neutral row tint. */
    tint?: {
        light: string;
        dark: string;
    };
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
     * How calls to this tool read as a timeline row (grammar v3). When omitted,
     * BB shows the standard tool name (`Running <name>` / `Ran <name>`) and the
     * plugin's branding glyph. Approval, error, and interruption states keep
     * BB's standard rendering. See docs/api_to_audit.md.
     */
    presentation?: PluginAgentToolPresentation;
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
        kind: "personal" | "standard";
        name: string;
        gitRemoteUrl: string | null;
    };
    environment: {
        id: string;
        name: string | null;
        path: string | null;
        workspaceProvisionType: "managed-worktree" | "personal" | "unmanaged";
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
     * already accepts. Recursive local `$ref` chains are rejected. */
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
type PluginProviderReasoningLevel = "high" | "low" | "max" | "medium" | "none" | "ultra" | "ultracode" | "xhigh";
/**
 * Composer actions a provider supports, by name only. The skills
 * slash-command typeahead is universal — BB injects skills into every
 * provider — so it is implicit and never declared, and the composer owns the
 * trigger syntax (`/plan `, `/goal `) rather than each declaration repeating
 * it.
 */
type PluginProviderComposerAction = "goal" | "plan";
/**
 * Pre-session capability facts about a provider. A capability earns a field
 * here only when it passes BOTH tests: (1) a consumer outside the provider's
 * own plugin needs the fact, and (2) the fact is needed before / without a
 * live session (picker rendering, route gating, cross-plugin tool
 * composition — including with the host offline). Every boolean is a
 * provider-native fact — the provider implements the feature; the flag only
 * tells external consumers it exists. Session-behavior facts remain handshake
 * capabilities reported by the running bridge. Sessionless maintenance
 * methods are declared here so callers can decide whether to probe without
 * starting the bridge first.
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
    /** Permission modes the provider can actually run in. Non-empty, no
     * duplicates. */
    permissionModes: readonly PluginProviderPermissionMode[];
    /** The provider's coarse fallback reasoning ladder (see
     * {@link PluginProviderReasoningLevel}). Non-empty, no duplicates. */
    reasoningLevels: readonly PluginProviderReasoningLevel[];
}
/**
 * Provider copy core surfaces render from per-provider tables today (usage
 * banners, sign-in hints, the mobile picker, the agent guide). Declared once
 * here so no core surface keys copy on a provider id. Mirrors
 * `ProviderStrings` in `@bb/domain`, which is the client projection.
 */
interface PluginProviderStrings {
    /** How to sign in on the host ("Run `claude` on the machine to sign in."). */
    signInHint: string;
    /** Shown when a session's credentials expired. */
    expiredHint: string;
    /** Where to install the agent. */
    installUrl: string;
    /** Brand prefix stripped from model display names ("Claude "). */
    brandPrefix?: string;
    /** Plan-mode banner copy for providers that declare the `plan` action. */
    planModeCopy?: string;
    /** Per-theme tint for the provider icon. */
    iconTint?: {
        light: string;
        dark: string;
    };
}
/**
 * One selectable option for a picker — a service tier or a reasoning level.
 * `id` is the wire value the bridge receives; `label` is what the picker
 * shows. Declared lists are the cold-cache fallback; `model/list` is precise
 * per model.
 */
interface PluginProviderOptionDescriptor {
    id: string;
    label: string;
    description?: string;
}
/**
 * Payload schemas for one extension kind this provider emits, keyed by the
 * kind's local name (the server prefixes the plugin id to form the
 * namespaced `"<pluginId>/<name>"`). `item` validates `item.open` payloads
 * with `type: "extension"`, `state` validates `extension.state` payloads;
 * each is optional so a kind can be item-only or state-only. Schemas are
 * Standard Schema v1 validators (zod 4 schemas qualify).
 */
interface PluginProviderExtensionKindDeclaration {
    item?: StandardSchemaV1;
    state?: StandardSchemaV1;
}
/**
 * Per-command context handed to
 * {@link PluginProviderDeclaration.deriveProviderOptions}. The
 * server builds one for every session and turn command it dispatches on a
 * thread of this provider.
 */
interface PluginProviderOptionsContext {
    threadId: string;
    projectId: string;
    /** The resolved model id for this command. */
    model: string;
    /** BB's permission mode for this command (already clamped to the host). */
    permissionMode: PluginProviderPermissionMode;
    /**
     * `"plan"` when the prompt entered plan mode through this provider's
     * declared `plan` composer action. Absent for an ordinary prompt — plan
     * mode is a BB prompt mode, so the bridge maps it onto whatever the agent
     * calls it natively.
     */
    promptMode?: "plan";
    /**
     * This plugin's own settings values (`bb.settings.define`), read at call
     * time. Secret settings are omitted — provider options ride the daemon
     * wire and are persisted with the session, so a secret must never be
     * derived into them.
     */
    settings: Readonly<Record<string, PluginSettingValue | undefined>>;
}
/** See {@link PluginProviderDeclaration.models}. */
type PluginProviderModelCatalogScope = "host" | "workspace";
/**
 * One cold-cache fallback model. The provider's live `model/list` result is
 * the only real model source; this list stands in only while no probe has
 * completed, or when a probe fails transiently, so the picker is not empty.
 * `id` is the wire model id the bridge receives.
 */
interface PluginProviderFallbackModel {
    id: string;
    /** Picker display name ("Opus 5 (1M)"). */
    displayName: string;
    description: string;
    /** Reasoning levels this model supports, lowest to highest. Non-empty. */
    supportedReasoningEfforts: readonly {
        reasoningEffort: PluginProviderReasoningLevel;
        description: string;
    }[];
    /** Must be one of `supportedReasoningEfforts`. */
    defaultReasoningEffort: PluginProviderReasoningLevel;
    /** Exactly one entry in the list is the default. */
    isDefault: boolean;
}
/**
 * Which sessionless maintenance requests a provider bridge implements. The
 * server skips the requests a provider does not declare, and clients omit
 * the matching surfaces, without starting the bridge first.
 */
interface PluginProviderMaintenance {
    /** `provider/health`: host-local readiness, never a network health check. */
    health?: boolean;
    /** `provider/usage`: subscription usage windows. False means usage settings
     * omit the provider. A shared bridge that declares true may still report
     * usage unavailable for one provider id or return no windows. */
    usage?: boolean;
    /** `provider/installation/status` and `provider/installation/run`:
     * host-local installation management. */
    installation?: boolean;
}
/** One provider-native root as a plugin declares it: a path, or a path with options. */
type PluginProviderNativeRootEntry = ProviderNativeRootInput;
/** Provider-native roots as a plugin declares them, one list per side. */
type PluginProviderNativeRoots = ProviderNativeRootsInputLike;
/**
 * One provider this plugin contributes to BB's provider registry.
 *
 * Ids are stable public identifiers — thread rows and routes reference them —
 * and are collision-rejected: a declaration whose id matches another plugin's
 * live registration is refused; the first registration wins and no id is
 * reserved ahead of time. Registrations are replaced wholesale on plugin
 * reload, like every other plugin surface.
 *
 * A declaration owns the provider's static metadata and bridge options. The
 * executable implementation is the plugin's own provider bridge: the
 * `experimental_providerBridge` export of the `bb.host` artifact the manifest
 * names (`PROVIDER_BRIDGE_EXPORT_NAME` in the bridge kit), built into the
 * artifact BB ships to hosts. Declaring a provider in a plugin with no
 * `bb.host` entry is refused, because the picker entry would exist and no
 * turn on it could ever run; a `bb.host` entry whose artifact failed to
 * build still stages the declaration so the provider is listed as
 * unavailable.
 */
interface PluginProviderDeclaration {
    /** Stable provider id: 2–64 characters of lowercase letters, digits, and
     * "-", starting with a letter or digit. Existing ids must never change —
     * threads persist them. */
    id: string;
    /** Picker display name: 1–80 characters, non-blank. */
    displayName: string;
    /**
     * Optional grouping key (same grammar as `id`) for providers that share a
     * family — the ACP agents, for example — so clients can group them without
     * parsing a prefix out of the id. Grouping only: no policy keys on it.
     */
    family?: string;
    /**
     * Optional picker icon: a named host glyph (`"Zap"`) or a plugin-relative
     * path starting with `"./"` (`"./icons/agent.svg"`) — the two forms
     * `bb.branding.icon` takes — or, unlike `bb.branding.icon`, one of this
     * plugin's declared icons by its namespaced glyph (`"<pluginId>/<name>"`,
     * an entry of the manifest's `bb.branding.experimental_icons` map; the
     * plugin id must be this plugin's and the name must be declared, else the
     * plugin fails to load). Paths follow the manifest entry-path escape rules
     * — no leading "/", no ".." segments, no backslashes.
     */
    icon?: string;
    /**
     * Provider-owned static options passed opaquely to this plugin's bridge on
     * every sessionless and session request. Core validates that the value is
     * JSON, but does not interpret its keys. This is intended for immutable
     * launch metadata shared by every host (for example an ACP command spec),
     * not user or machine configuration.
     */
    experimental_bridgeOptions?: Readonly<Record<string, JsonValue>>;
    /**
     * Whether the provider is always listed or only listed on hosts where its
     * bridge reports it installed. Defaults to `"always"`.
     */
    experimental_visibility?: "always" | "installed";
    /**
     * The sessionless maintenance requests the provider's bridge implements
     * (docs/provider-plugin-api.md §1). Each defaults to false when omitted.
     */
    maintenance?: PluginProviderMaintenance;
    /** Pre-session capability facts (see the declaration tests on
     * {@link PluginProviderCapabilities}). */
    capabilities: PluginProviderCapabilities;
    /** Composer actions this provider supports. No duplicates; may be empty
     * (the universal skills typeahead is implicit). */
    composerActions: readonly PluginProviderComposerAction[];
    /** Provider copy for core surfaces ({@link PluginProviderStrings}). */
    strings?: PluginProviderStrings;
    /** Service tiers this provider accepts, as picker options. Non-empty when
     * present, unique ids. The coarse `capabilities.supportsServiceTier` stays
     * until WS2a stabilizes. */
    serviceTiers?: readonly PluginProviderOptionDescriptor[];
    /** Reasoning levels as picker options with labels, beside the coarse
     * `capabilities.reasoningLevels` ladder (ids only). Non-empty when present,
     * unique ids. WS2a merges the two. */
    reasoningLevels?: readonly PluginProviderOptionDescriptor[];
    /** Extension kinds this provider's bridge may emit, keyed by local name
     * (`[a-z0-9-]+`). The server validates extension payloads against these
     * schemas at ingest and persists a `provider/unhandled` on a miss. */
    extensionKinds?: Readonly<Record<string, PluginProviderExtensionKindDeclaration>>;
    /**
     * Cold-cache fallback models ({@link PluginProviderFallbackModel}). The
     * server offers them only while a model probe has not completed or failed
     * transiently; the live `model/list` result always replaces them. Ids must
     * be unique and exactly one entry must be the default.
     */
    models?: {
        /**
         * Optional: a provider that only declares a catalog `scope` needs no
         * fallback list, and an omitted list reads as no fallbacks at all.
         */
        fallback?: readonly PluginProviderFallbackModel[];
        /**
         * How far one `model/list` answer travels. `"host"` means the catalog is
         * the same everywhere on a machine — the bridge answers from account or
         * agent state and ignores the workspace path — so bb probes once per host
         * and reuses the answer for every environment on it. `"workspace"` (the
         * default) means project configuration can change the answer, so bb
         * probes per workspace and sends the path.
         *
         * Declaring `"host"` wrongly is a stale catalog in a workspace that
         * configured its own models; declaring `"workspace"` wrongly costs a
         * redundant probe. The default is therefore the safe one.
         */
        scope?: PluginProviderModelCatalogScope;
    };
    /**
     * Daemon environment variables this provider's bridge may read. Provider
     * processes are spawned with every inherited `BB_*` variable stripped, so a
     * bridge that honors an operator override (a CLI path, say) names it here
     * and the daemon forwards exactly those variables. Names are
     * `[A-Z_][A-Z0-9_]*`, at most 32.
     */
    env?: {
        passthrough: readonly string[];
    };
    /**
     * Directories this provider's agent reads its own skills from, relative to
     * the target host's home directory (`user`) or to the workspace
     * (`project`). An agent with skills of its own — an ACP agent pointed at
     * `.cursor/skills`, say — names them here so bb can list them beside its
     * own; core never guesses a provider's skill layout. Paths are relative
     * and may not contain dot segments; each side holds at most 32 roots. One
     * declaration is global, so a directory only one host can name (an agent's
     * settings-configured skills directory, say) is not declared here but
     * resolved on that host (`experimental_resolvesNativeRoots`).
     */
    experimental_nativeSkillRoots?: PluginProviderNativeRoots;
    /**
     * Directories this provider's agent reads its own slash commands from —
     * flat directories of `*.md` prompt files (`.claude/commands`, say) — in
     * the same two-sided shape as `experimental_nativeSkillRoots`. bb offers
     * them in the composer beside the agent's skills.
     */
    experimental_nativeCommandRoots?: PluginProviderNativeRoots;
    /**
     * This plugin's `bb.host` entry implements
     * `experimental_nativeRootsHostContract` (`@get-bb/plugin-sdk/host`): core
     * calls `resolveNativeRoots({ cwd })` on the workspace host when it lists
     * commands or skills, and scans what comes back beside the declared roots.
     * This is where a provider's host-only knowledge goes — a config-moved
     * directory, an installed vendor plugin, a config-file entry — including
     * project-scoped entries, which a global declaration cannot carry.
     */
    experimental_resolvesNativeRoots?: boolean;
    /**
     * Derive this provider's opaque per-command options. Called synchronously
     * by the server for every session and turn command on a thread of this
     * provider, with the command's {@link PluginProviderOptionsContext}; the
     * returned JSON object reaches this plugin's bridge as
     * `options.providerOptions`, merged over `experimental_bridgeOptions`. Core
     * never interprets its keys — this is where a provider's own knobs (memory,
     * native subagents, a native plan flag) travel instead of on the shared
     * execution contract. A throw fails the command with the plugin named, so
     * a buggy hook cannot silently run a turn with default knobs. Must be fast:
     * it sits on the turn-submit path.
     */
    deriveProviderOptions?: (context: PluginProviderOptionsContext) => Readonly<Record<string, JsonValue>>;
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
     * rejected and surfaced as this plugin's status detail. Recursive local
     * JSON Schema `$ref` chains are rejected because some model providers reject
     * the complete tool list when any one tool contains them.
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
}
/**
 * Provider registration (docs/provider-plugin-api.md §1). Owns only
 * registration; `bb.agents` keeps `configure`, `registerTool`, and
 * `contributeInstructions`.
 */
interface PluginProviders {
    /**
     * Register an agent provider this plugin contributes (see
     * docs/api_to_audit.md before relying on it). The declaration is validated
     * at call time; the provider joins the server's provider registry when the
     * plugin load commits and then appears in provider listings as exactly one
     * client shape, `ProviderInfo`. Ids are flat and collision-rejected: the
     * first live registration of an id wins, a later one from another plugin
     * fails that plugin's load, and no id is reserved ahead of time. A plugin
     * may register several providers and may re-register after `dispose()` (a
     * settings-driven re-declaration); registrations are replaced wholesale on
     * plugin reload, like every other surface. The disposer removes the
     * registration.
     */
    register(declaration: PluginProviderDeclaration): {
        dispose(): void;
    };
    experimental_contributeEnv(providerId: string, resolve: (context: ExperimentalPluginProviderEnvContext) => readonly ExperimentalPluginProviderEnvEntry[] | Promise<readonly ExperimentalPluginProviderEnvEntry[]>): void;
    experimental_contributeEnvHealth(providerId: string, resolve: (context: ExperimentalPluginProviderEnvHealthContext) => ExperimentalPluginProviderEnvHealth | null | Promise<ExperimentalPluginProviderEnvHealth | null>): void;
}
interface ExperimentalPluginProviderEnvContext {
    threadId: string;
    projectId: string;
    hostId: string;
}
interface ExperimentalPluginProviderEnvEntry {
    name: string;
    value: string | {
        serverPath: string;
    };
    reason: string;
    secret: boolean;
}
interface ExperimentalPluginProviderEnvHealthContext {
    hostId: string;
}
interface ExperimentalPluginProviderEnvHealth {
    label: string;
    statusMessage: string;
}
type PluginMentionTrigger = "!" | "#" | "$" | "@" | "~";
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
     * The operator-configured public app URL from `BB_APP_URL`, or `null` when
     * the operator has not configured one. This value is not bind-gated.
     */
    readonly experimental_appUrl: string | null;
    /**
     * This BB server's own loopback base URL (e.g. "http://127.0.0.1:38886"),
     * which serves the SPA + /api + /ws. For plugins that proxy or relay
     * traffic back to the server itself (e.g. a tunnel). Bind-gated like
     * `bb.sdk`: reading it before the server is listening throws, so prefer
     * reading it from handlers, services, and timers.
     */
    readonly loopbackBaseUrl: string;
    /**
     * This server's data directory — the one holding `config.json`, `bb.db` and
     * `plugins/<id>/`. A plugin cannot compute it: a dev server derives it from
     * its repo root and instance id, so a plugin that guesses `~/.bb` reads the
     * production file while the dev server reads another one.
     *
     * For reading bb-managed files a plugin is migrating away from. A plugin's
     * OWN storage is `bb.storage`, which is scoped for it; this is deliberately
     * not a place to write.
     */
    readonly experimental_dataDir: string;
}
/**
 * What a plugin's AI service does. `inference` answers bb's server-side helper
 * completions (thread titles, commit messages: a prompt and a JSON Schema in,
 * a structured value out); `voice` transcribes recorded speech.
 */
type PluginAiServiceKind = "inference" | "voice";
/**
 * An AI service a plugin offers from its `bb.host` entry, which implements
 * `experimental_aiServicesHostContract` (`@get-bb/plugin-sdk/ai-services`).
 * The user selects it with `BB_INFERENCE` / `BB_TRANSCRIPTION` set to
 * `<id>/<model>`; core calls the plugin's host entry on the primary host with
 * the `id` on every request, so one entry can serve several services.
 */
interface PluginAiServiceDeclaration {
    /** The `<serviceId>` segment of the user's setting; stable, lowercase. */
    readonly id: string;
    /** Shown beside the id wherever the setting's options are listed. */
    readonly displayName: string;
    /** Which kinds this service answers; a kind it lacks is not offered. */
    readonly kinds: readonly PluginAiServiceKind[];
}
interface PluginAiServices {
    /**
     * Register an AI service. Call during the factory; the registration lands
     * when the plugin load commits and is removed on reload or disable. The
     * plugin must declare a `bb.host` entry; registering without one fails the
     * load. A declared entry that fails to build fails the load on the build
     * error after the factory, with any provider the factory declared listed
     * as unavailable. Throws on an id another live plugin already serves.
     */
    register(declaration: PluginAiServiceDeclaration): {
        dispose(): void;
    };
}
interface PluginBrowserTabFilter {
    threadId?: string;
    projectId?: string;
    active?: boolean;
}
interface PluginBrowserOpenOptions {
    clientId?: string;
    windowId?: string;
    ownerId?: string;
    threadId?: string;
    projectId?: string;
    timeoutMs?: number;
}
interface PluginBrowser {
    /** List connected and inactive Browser tabs during an audited tool or CLI call. */
    listTabs(context: PluginAgentToolContext | PluginCliContext, filter?: PluginBrowserTabFilter): readonly BrowserTabDescriptor[];
    /** List visible panel owners that can create a first or subsequent tab. */
    listOwners(context: PluginAgentToolContext | PluginCliContext, filter?: PluginBrowserTabFilter): readonly BrowserTabOwnerDescriptor[];
    /**
     * Create a thread-owned native Browser tab for this tool or CLI context.
     * If the destination thread is not mounted, BB runs it in the background
     * without changing the visible app layout. Explicit thread/project options
     * select another destination.
     */
    openTab(context: PluginAgentToolContext | PluginCliContext, url: string, options?: PluginBrowserOpenOptions): Promise<BrowserTabTarget>;
    /**
     * Run one bounded operation against an exact tab revision. BB never silently
     * retargets a different client, window, tab, or post-navigation page.
     *
     * The `script` action executes full-trust code against the user's current
     * browser session. It defaults to an isolated world; `world: "main"` is only
     * for page-owned JavaScript state such as React hints. `context` must be the
     * live context passed to an audited agent tool or CLI call; unfinished Browser
     * work is cancelled when that call returns.
     */
    run(target: BrowserTabTarget, action: BrowserControlAction, options: {
        context: PluginAgentToolContext | PluginCliContext;
        timeoutMs?: number;
    }): Promise<JsonValue>;
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
     * resulting set to that host's daemon. When an enrolled host is offline,
     * the server retains the declaration and delivers it on the next
     * credentialed daemon session. A connected daemon that reports no machine
     * credential is rejected. Tunnel identity is deliberately not accepted
     * here: it is owned by the daemon's trusted enrollment.
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
    /** Agent provider registration (docs/provider-plugin-api.md §1). */
    readonly providers: PluginProviders;
    /** Host-rendered UI contributions (design §4.9). */
    readonly ui: PluginUi;
    /**
     * Additive plugin lifecycle listeners (design §4.5). Announcements core
     * makes: a handler's return value is ignored.
     */
    readonly events: PluginEvents;
    /**
     * Questions core asks and acts on the answer to. Today: the dispatch
     * checkpoint messages pass through on their way to a provider (a user's
     * Send-now bypasses it by design), which a handler may let go, queue with a
     * reason, or refuse.
     */
    readonly experimental_hooks: PluginHooks;
    /** Plugin-reported status (needs-configuration). */
    readonly status: PluginStatusApi;
    /** Read-only facts about the running server (loopback base URL). */
    readonly server: PluginServerApi;
    /** Connected BB Browser discovery and exact-tab control. */
    readonly experimental_browser: PluginBrowser;
    /** Server-to-daemon host control-plane declarations. */
    readonly hosts: PluginHosts;
    /**
     * AI services this plugin serves from its `bb.host` entry (helper
     * inference, voice transcription). See `@get-bb/plugin-sdk/ai-services`.
     */
    readonly experimental_aiServices: PluginAiServices;
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
export type { BbContext, BbNavigate, BbPluginApi, BrowserControlAction, BrowserControlError, BrowserFrameDescriptor, BrowserFrameTarget, BrowserTabDescriptor, BrowserTabOwnerDescriptor, BrowserTabTarget, BrowserWaitCriteria, BrowserWaitResult, CodeOverflowMode, ComposerCustomization, ComposerPlusMenuItem, ComposerRichTextSpec, ComposerStructuredDraft, ComposerView, DiffProps, DiffViewMode, ExperimentalAppOverlayProps, ExperimentalAppOverlayRegistration, ExperimentalAppPanel, ExperimentalAppPanelSurface, ExperimentalBrowserPageCapture, ExperimentalBrowserPageContentScriptRequest, ExperimentalBrowserPageContentScriptResult, ExperimentalComposerSubmitOptions, ExperimentalDiffFileContent, ExperimentalDiffFullFileContents, ExperimentalFileLinkProps, ExperimentalFileLocation, ExperimentalFileOpenOptions, ExperimentalFixedTabTargetContract, ExperimentalFixedTabTargetState, ExperimentalHostCallOptions, ExperimentalHostClient, ExperimentalHostEntry, ExperimentalHostPaths, ExperimentalHostRpcContext, ExperimentalHostRpcHandlers, ExperimentalHostSignalContract, ExperimentalHostSignalEvent, ExperimentalHostSignals, ExperimentalHostWatchChange, ExperimentalHostWatchChangeType, ExperimentalHostWatchEvent, ExperimentalHostWatchListener, ExperimentalHostWatchOptions, ExperimentalHostWatchSubscription, ExperimentalHostWorkerLease, ExperimentalLiveFileTarget, ExperimentalOpenFixedTabOptions, ExperimentalPermissionModePickerProps, ExperimentalPluginFixedTabReference, ExperimentalPluginProviderEnvContext, ExperimentalPluginProviderEnvEntry, ExperimentalPluginProviderEnvHealth, ExperimentalPluginProviderEnvHealthContext, ExperimentalPluginWebSocket, ExperimentalPluginWebSocketContext, ExperimentalPluginWebSocketHandler, ExperimentalPluginWebSocketHandlers, ExperimentalProviderModelPickerProps, ExperimentalProviderModelPickerRouting, ExperimentalProviderModelPickerValue, ExperimentalSidebarFooter, ExperimentalSidebarFooterActionContext, ExperimentalSidebarFooterActionRegistration, ExperimentalSidebarFooterDisclosureController, ExperimentalSidebarFooterDisclosureProps, ExperimentalSidebarFooterDisclosureRegistration, ExperimentalSidebarFooterItemBase, ExperimentalSidebarFooterItemRegistration, ExperimentalSidebarNavigationAction, ExperimentalSidebarNavigationActivationOptions, ExperimentalSidebarNavigationIcon, ExperimentalSidebarNavigationItem, ExperimentalSidebarNavigationProps, ExperimentalSidebarNavigationRegistration, ExperimentalSidebarNavigationShortcut, JsonValue, MarkdownProps, MessageDispatchHookContext, MessageDispatchHookDecision, NewThreadComposerProps, NewThreadRequest, PluginAgentConfiguration, PluginAgentConfigurationContext, PluginAgentToolContentPart, PluginAgentToolContext, PluginAgentToolLabels, PluginAgentToolPresentation, PluginAgentToolRegistrationBase, PluginAgentToolResult, PluginAgentToolSelection, PluginAgents, PluginAiServiceDeclaration, PluginAiServiceKind, PluginAiServices, PluginAppBuilder, PluginAppComposer, PluginAppContentScripts, PluginAppDefinition, PluginAppSetup, PluginAppSlots, PluginBackground, PluginBrowser, PluginBrowserActionProps, PluginBrowserActionRegistration, PluginBrowserOpenOptions, PluginBrowserTabFilter, PluginCli, PluginCliCommandInfo, PluginCliContext, PluginCliExecutionResult, PluginCliOutputLimitError, PluginCliRegistration, PluginCliResult, PluginCodeThemeData, PluginCodeThemeState, PluginCodeThemeTokenRule, PluginCommandPaletteActionContext, PluginCommandPaletteActionRegistration, PluginComposerApi, PluginComposerMention, PluginComposerScope, PluginComposerTextEffect, PluginComposerThreadRowStatus, PluginContentScriptContext, PluginContentScriptDisposer, PluginContentScriptRegistration, PluginDiffRendererProps, PluginDiffRendererRegistration, PluginDispatchAttemptKind, PluginDispatchExecution, PluginDispatchExecutionSources, PluginDispatchInput, PluginEvents, PluginFileOpenerProps, PluginFileOpenerRegistration, PluginFileOpenerSource, PluginFixedTabDeclaration, PluginFixedTabRegistration, PluginHomepageSectionProps, PluginHomepageSectionRegistration, PluginHookHandler, PluginHookName, PluginHookSignatures, PluginHooks, PluginHosts, PluginHttp, PluginHttpAuthMode, PluginHttpHandler, PluginInteractionCancelReason, PluginInteractionRequest, PluginInteractionResult, PluginKvStorage, PluginLogger, PluginMentionItem, PluginMentionProviderRegistration, PluginMentionSearchContext, PluginMentionTrigger, PluginMessageActionContext, PluginMessageActionRegistration, PluginMessageDirectiveMessage, PluginMessageDirectiveOpenWorkspaceFile, PluginMessageDirectiveProps, PluginMessageDirectiveRegistration, PluginNavPanelProps, PluginNavPanelRegistration, PluginNewThreadPanelActionContext, PluginNewThreadPanelActionRegistration, PluginNewThreadPanelProps, PluginPanelActionOpenOptions, PluginPendingInteractionProps, PluginPendingInteractionRegistration, PluginPendingInteractionView, PluginProviderCapabilities, PluginProviderComposerAction, PluginProviderDeclaration, PluginProviderExtensionKindDeclaration, PluginProviderFallbackModel, PluginProviderIconRegistration, PluginProviderMaintenance, PluginProviderModelCatalogScope, PluginProviderNativeRootEntry, PluginProviderNativeRoots, PluginProviderOptionDescriptor, PluginProviderOptionsContext, PluginProviderPermissionMode, PluginProviderReasoningLevel, PluginProviderStrings, PluginProviders, PluginProvidersState, PluginRealtime, PluginRealtimeConnectionState, PluginRpc, PluginRpcCallArgs, PluginRpcClient, PluginRpcContract, PluginRpcError, PluginRpcErrorCode, PluginRpcHandlers, PluginRpcIssuePathSegment, PluginRpcMethodContract, PluginRpcResult, PluginRpcValidationIssue, PluginSdkApp, PluginServerApi, PluginSettingDescriptor, PluginSettingDescriptors, PluginSettingValue, PluginSettings, PluginSettingsHandle, PluginSettingsSectionProps, PluginSettingsSectionRegistration, PluginSettingsState, PluginSettingsValues, PluginSharedPortTunnelIdentity, PluginSidebarFooterActionContext, PluginSidebarFooterActionProps, PluginSidebarFooterActionRegistration, PluginSidebarProject, PluginSidebarPullRequest, PluginSidebarSplitPane, PluginSidebarThread, PluginSidebarThreadActions, PluginSidebarThreadActivity, PluginSidebarThreadIndicator, PluginSidebarThreadPullRequestState, PluginSidebarThreadSplit, PluginSidebarThreadsState, PluginSidebarWorkspaceKind, PluginSourceCodeRendererProps, PluginSourceCodeRendererRegistration, PluginStatusApi, PluginStorage, PluginTargetedPanelActionOpenOptions, PluginThreadEventHandler, PluginThreadEventName, PluginThreadEventPayloads, PluginThreadHeaderActionProps, PluginThreadHeaderActionRegistration, PluginThreadListProps, PluginThreadListRegistration, PluginThreadPanelActionContext, PluginThreadPanelActionRegistration, PluginThreadPanelProps, PluginTimelineRendererProps, PluginTimelineRendererRegistration, PluginTimelineRendererRow, PluginTimelineRowPresentation, PluginTimelineRowStatus, PluginTurnFailedEvent, PluginUi, SourceCodeLineRange, SourceCodeProps, StandardSchemaV1, StandardSchemaV1InferInput, StandardSchemaV1InferOutput, StandardSchemaV1Issue, StandardSchemaV1Result, ThreadChatMessageAction, ThreadChatMessageReference, ThreadChatProps, UrlLinkProps };
