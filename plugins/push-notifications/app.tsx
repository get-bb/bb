import { useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  experimental_usePluginId,
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSdk,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import {
  CLIENT_NOTIFICATION_CHANNEL,
  type pushNotificationsRpcContract,
} from "./contract.js";
import {
  clientChannel,
  createClientDelivery,
  notificationPermission,
  type ClientChannel,
} from "./client.js";

type PromptOutcome = "accepted" | "denied" | "dismissed";

const PROMPT_OUTCOME_EVENTS = {
  accepted: "notification_prompt_accepted",
  denied: "notification_prompt_denied",
  dismissed: "notification_prompt_dismissed",
} as const;

function readPromptAnswered(storageKey: string): boolean {
  try {
    return window.localStorage.getItem(storageKey) !== null;
  } catch {
    return true;
  }
}

function rememberPromptAnswer(storageKey: string, outcome: PromptOutcome) {
  try {
    window.localStorage.setItem(storageKey, outcome);
  } catch {
    return;
  }
}

function NotificationDelivery() {
  const navigate = useBbNavigate();
  const { values } = useSettings();
  const delivery = useRef<ReturnType<typeof createClientDelivery> | null>(null);
  useEffect(() => {
    const next = createClientDelivery((id) => navigate.toThread(id));
    delivery.current = next;
    return () => {
      delivery.current = null;
      next.dispose();
    };
  }, [navigate]);
  useRealtime(CLIENT_NOTIFICATION_CHANNEL, (payload) => {
    const channel = clientChannel();
    const enabled = channel !== null && values?.[`${channel}Enabled`] === true;
    void delivery.current?.deliver(payload, enabled).catch(() => undefined);
  });
  return null;
}

function RunningThreadPrompt({
  channel,
  onAnswered,
}: {
  channel: ClientChannel;
  onAnswered: (outcome: PromptOutcome) => void;
}) {
  const { threadId } = useBbContext();
  const { threads } = experimental_useSidebarThreads();
  const sdk = useSdk();
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const undecided = notificationPermission() === "default";
  const running =
    undecided &&
    threadId !== null &&
    threads.some(
      (thread) =>
        thread.id === threadId &&
        (thread.status === "starting" || thread.status === "active"),
    );
  if (running && !shown) setShown(true);
  const reportedShownRef = useRef(false);
  useEffect(() => {
    if (!shown || reportedShownRef.current) return;
    reportedShownRef.current = true;
    void sdk.system
      .experimental_recordTelemetryEvent({
        name: "notification_prompt_shown",
        properties: { surface: "thread" },
      })
      .catch(() => undefined);
  }, [sdk, shown]);
  if (!shown || !undecided || threadId === null) return null;

  const answer = (outcome: PromptOutcome) => {
    void sdk.system
      .experimental_recordTelemetryEvent({
        name: PROMPT_OUTCOME_EVENTS[outcome],
        properties: { surface: "thread" },
      })
      .catch(() => undefined);
    onAnswered(outcome);
  };

  async function allow() {
    setBusy(true);
    try {
      const result = await Notification.requestPermission();
      answer(
        result === "granted"
          ? "accepted"
          : result === "denied"
            ? "denied"
            : "dismissed",
      );
    } catch {
      answer("dismissed");
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Notification prompt"
      className="fixed top-16 right-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] items-start gap-3 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
    >
      <Icon
        name="BellDot"
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium">
          Get notified when this agent needs you?
        </p>
        <p className="text-xs text-muted-foreground">
          {channel === "desktop" ? "bb" : "This browser"} will show a system
          notification when a thread finishes or asks a question.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            disabled={busy}
            onClick={() => void allow()}
          >
            Turn on
          </button>
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            disabled={busy}
            onClick={() => answer("dismissed")}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

function NotificationPrompt() {
  const { values } = useSettings();
  const pluginId = experimental_usePluginId();
  const storageKey = `${pluginId}.notification-prompt`;
  const [answered, setAnswered] = useState(() =>
    readPromptAnswered(storageKey),
  );
  const channel = clientChannel();
  if (
    answered ||
    channel === null ||
    values?.[`${channel}Enabled`] !== true ||
    notificationPermission() !== "default"
  ) {
    return null;
  }
  return (
    <RunningThreadPrompt
      channel={channel}
      onAnswered={(outcome) => {
        rememberPromptAnswer(storageKey, outcome);
        setAnswered(true);
      }}
    />
  );
}

function NotificationSettings() {
  const rpc = useRpc<typeof pushNotificationsRpcContract>();
  const { values } = useSettings();
  const channel = clientChannel();
  const [permission, setPermission] = useState(notificationPermission);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => setPermission(notificationPermission());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  if (channel === null) return null;
  const enabled = values?.[`${channel}Enabled`] === true;
  const status =
    permission === "unsupported"
      ? "System notifications are unavailable here. Use a supported browser over HTTPS or localhost."
      : permission === "denied"
        ? "Notifications are blocked. Allow them in your browser or system notification settings, then return here."
        : permission === "granted"
          ? "Notifications allowed. Your system notification settings also apply."
          : "Allow notifications on this device to receive thread updates.";

  async function requestPermission() {
    setBusy(true);
    setMessage(null);
    try {
      setPermission(await Notification.requestPermission());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function testNotification() {
    if (channel === null) return;
    setBusy(true);
    setMessage(null);
    try {
      await rpc.call("notifications.test", { channel });
      setMessage(
        `Test sent to connected ${channel} clients with notification permission.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <h3 className="font-medium">
        {channel === "desktop" ? "This desktop app" : "This browser"}
      </h3>
      <p className="text-muted-foreground" role="status">
        {status}
      </p>
      {permission === "default" ? (
        <button
          type="button"
          className="rounded-md border border-border px-3 py-2 disabled:opacity-50"
          disabled={busy || !enabled}
          onClick={() => void requestPermission()}
        >
          Allow notifications
        </button>
      ) : null}
      {permission === "granted" ? (
        <button
          type="button"
          className="rounded-md border border-border px-3 py-2 disabled:opacity-50"
          disabled={busy || !enabled}
          onClick={() => void testNotification()}
        >
          Send test notification
        </button>
      ) : null}
      {!enabled ? (
        <p className="text-muted-foreground">
          Enable {channel} notifications above to receive updates.
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-muted-foreground">
          {message}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Channel settings apply to this bb server. Each browser needs permission.
        Click a notification to open its thread.
      </p>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "delivery",
    component: NotificationDelivery,
  });
  app.slots.experimental_appOverlay({
    id: "prompt",
    component: NotificationPrompt,
  });
  app.slots.settingsSection({ id: "device", component: NotificationSettings });
});
