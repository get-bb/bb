import type {
  PendingInteraction,
  PluginPendingInteraction,
  ProviderPendingInteraction,
  ThreadQueuedMessage,
} from "@bb/domain";

/**
 * Synthetic pending interactions for the `/dev/interactions` showcase: one
 * per banner variant, including the shapes the fake e2e provider cannot
 * produce (plugin forms, plan approval, permission grant, multi-question).
 * Not product data; ids are deliberately invalid so a tap shows the inline
 * error path instead of resolving anything.
 */

export const DEV_THREAD_ID = "dev-thread";

function provider(
  id: string,
  payload: ProviderPendingInteraction["payload"],
  overrides: Partial<ProviderPendingInteraction> = {},
): ProviderPendingInteraction {
  return {
    id,
    threadId: DEV_THREAD_ID,
    turnId: "turn-dev",
    providerId: "fake",
    providerThreadId: "pt-dev",
    providerRequestId: `req-${id}`,
    status: "pending",
    statusReason: null,
    createdAt: Date.now(),
    resolvedAt: null,
    payload,
    resolution: null,
    ...overrides,
  };
}

function plugin(
  id: string,
  pluginId: string,
  rendererId: string,
  title: string,
  data: PluginPendingInteraction["payload"]["data"],
): PluginPendingInteraction {
  return {
    id,
    threadId: DEV_THREAD_ID,
    turnId: null,
    status: "pending",
    statusReason: null,
    createdAt: Date.now(),
    resolvedAt: null,
    origin: { kind: "plugin", pluginId, rendererId },
    payload: { kind: "plugin", title, data },
    resolution: null,
  };
}

interface InteractionFixture {
  title: string;
  interaction: PendingInteraction;
}

export function buildInteractionFixtures(): InteractionFixture[] {
  return [
    {
      title: "Approval: command",
      interaction: provider("dev-approval-command", {
        kind: "approval",
        reason: null,
        availableDecisions: ["allow_once", "allow_for_session", "deny"],
        subject: {
          kind: "command",
          itemId: "item-1",
          command: "pnpm exec turbo run test --filter=@bb/mobile",
          cwd: "/Users/dev/repo/apps/mobile",
          actions: [
            {
              type: "read",
              command: "cat",
              name: "package.json",
              path: "package.json",
            },
          ],
          sessionGrant: {
            network: { enabled: true },
            fileSystem: { read: ["/Users/dev/repo"], write: [] },
          },
        },
      }),
    },
    {
      title: "Approval: command (resolving)",
      interaction: provider(
        "dev-approval-resolving",
        {
          kind: "approval",
          reason: "Claude wants to run a script",
          availableDecisions: ["allow_once", "deny"],
          subject: {
            kind: "command",
            itemId: "item-2",
            command: "bash scripts/deploy.sh",
            cwd: null,
            actions: [],
            sessionGrant: null,
          },
        },
        {
          status: "resolving",
          resolution: { decision: "allow_once", grantedPermissions: null },
        },
      ),
    },
    {
      title: "Approval: file change",
      interaction: provider("dev-approval-file", {
        kind: "approval",
        reason: null,
        availableDecisions: ["allow_once", "allow_for_session", "deny"],
        subject: {
          kind: "file_change",
          itemId: "item-3",
          writeScope: "/Users/dev/repo/src",
          sessionGrant: {
            network: null,
            fileSystem: { read: [], write: ["/Users/dev/repo/src"] },
          },
        },
      }),
    },
    {
      title: "Approval: permission grant",
      interaction: provider("dev-approval-grant", {
        kind: "approval",
        reason: null,
        availableDecisions: ["allow_once", "deny"],
        subject: {
          kind: "permission_grant",
          itemId: "item-4",
          toolName: "web_fetch",
          permissions: {
            network: { enabled: true },
            fileSystem: { read: ["/tmp/cache"], write: [] },
          },
        },
      }),
    },
    {
      title: "Approval: plan",
      interaction: provider("dev-approval-plan", {
        kind: "approval",
        reason: null,
        availableDecisions: ["allow_once", "deny"],
        subject: {
          kind: "plan",
          itemId: "item-5",
          plan: [
            "# Ship the queue UI",
            "",
            "1. Port the list model.",
            "2. Wire **Send now** and the group toggle.",
            "3. Add `move up` / `move down`.",
            "",
            "```bash",
            "pnpm exec turbo run typecheck --filter=@bb/mobile",
            "```",
          ].join("\n"),
          planFilePath: "/Users/dev/repo/plans/queue.md",
        },
      }),
    },
    {
      title: "User question: single select + Other",
      interaction: provider("dev-question-single", {
        kind: "user_question",
        questions: [
          {
            id: "color",
            prompt: "Which accent color should the banner use?",
            shortLabel: "Color",
            multiSelect: false,
            allowFreeText: true,
            options: [
              {
                value: "blue",
                label: "Blue",
                description: "Matches the web app",
              },
              {
                value: "green",
                label: "Green",
                description: "Higher contrast",
              },
              { value: "none", label: "No accent" },
            ],
          },
        ],
      }),
    },
    {
      title: "User question: several questions, multi select, free text",
      interaction: provider("dev-question-multi", {
        kind: "user_question",
        questions: [
          {
            id: "platforms",
            prompt: "Which platforms should we test on?",
            shortLabel: "Platforms",
            multiSelect: true,
            allowFreeText: true,
            options: [
              { value: "ios", label: "iOS" },
              { value: "android", label: "Android" },
              { value: "web", label: "Web" },
            ],
          },
          {
            id: "notes",
            prompt: "Anything else the release notes should mention?",
            shortLabel: "Notes",
            multiSelect: false,
            allowFreeText: true,
          },
        ],
      }),
    },
    {
      title: "Plugin: ask-user-question (with previews)",
      interaction: plugin(
        "dev-plugin-ask",
        "ask-user-question",
        "ask-user-question",
        "Pick a layout",
        {
          questions: [
            {
              id: "layout",
              prompt: "Which layout for the settings screen?",
              shortLabel: "Layout",
              multiSelect: false,
              allowFreeText: true,
              options: [
                {
                  value: "list",
                  label: "Grouped list",
                  description: "iOS-style grouped rows",
                  preview:
                    "┌──────────────┐\n│ Account     ›│\n│ Servers     ›│\n└──────────────┘",
                },
                {
                  value: "cards",
                  label: "Cards",
                  description: "One card per section",
                  preview: "[ Account ]\n[ Servers ]",
                },
              ],
            },
          ],
        },
      ),
    },
    {
      title: "Plugin: secret-request",
      interaction: plugin(
        "dev-plugin-secret",
        "secrets",
        "secret-request",
        "Add secrets to /Users/dev/repo/.env",
        {
          purpose: "The deploy script needs the staging credentials.",
          destination: { kind: "dotenv", path: "/Users/dev/repo/.env" },
          fields: [
            {
              name: "STAGING_API_KEY",
              description: "From the staging dashboard",
            },
            { name: "STAGING_WEBHOOK_SECRET", description: null },
          ],
        },
      ),
    },
    {
      title: "Plugin: unknown renderer",
      interaction: plugin(
        "dev-plugin-unknown",
        "my-fancy-plugin",
        "fancy-form",
        "Review the generated diagram",
        { nodes: 12 },
      ),
    },
    {
      title: "Plugin: malformed payload",
      interaction: plugin(
        "dev-plugin-invalid",
        "secrets",
        "secret-request",
        "Broken secret request",
        { fields: [] },
      ),
    },
  ];
}

export function buildQueuedMessageFixtures(): ThreadQueuedMessage[] {
  const base = {
    model: "fake-model",
    reasoningLevel: "medium" as const,
    permissionMode: "auto" as const,
    serviceTier: "default" as const,
    createdAt: 1,
    updatedAt: 1,
  };
  return [
    {
      ...base,
      id: "dev-q1",
      groupWithNext: true,
      content: [
        {
          type: "text",
          text: "First: run the tests and paste the failures.",
          mentions: [],
        },
      ],
    },
    {
      ...base,
      id: "dev-q2",
      groupWithNext: false,
      content: [
        { type: "text", text: "Then fix the lint warnings.", mentions: [] },
        { type: "localFile", path: "notes/lint.md" },
      ],
    },
    {
      ...base,
      id: "dev-q3",
      groupWithNext: false,
      content: [
        {
          type: "text",
          text: "Finally write up what changed for the PR description, with a short summary line and a bulleted list of the files touched.",
          mentions: [],
        },
      ],
    },
  ];
}
