import { useEffect, useRef, useState } from "react";
import {
  experimental_Icon as Icon,
  experimental_useRpcMutation,
  experimental_useRpcQuery,
  useComposer,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { clientChannel, requestNotificationPermission } from "./client.js";
import { pushNotificationsRpcContract } from "./contract.js";
import { useNotificationPermission } from "./notification-permission.js";

export function NotificationsHint() {
  const composer = useComposer();
  const threadId =
    composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const channel = clientChannel();
  const { values } = useSettings();
  const [permission, setPermission] = useNotificationPermission();
  const [visibleDocument, setVisibleDocument] = useState(
    () => !document.hidden,
  );
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [finishedId, setFinishedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clicked = useRef(false);
  const shownId = useRef<string | null>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const enabled =
    threadId !== null &&
    channel !== null &&
    values?.[`${channel}Enabled`] === true &&
    permission === "default" &&
    visibleDocument;
  const query = experimental_useRpcQuery({
    contract: pushNotificationsRpcContract,
    method: "notificationsHint.eligibility",
    input: { threadId: threadId ?? "", channel: channel ?? "web" },
    enabled,
  });
  const { mutate: markShown } = experimental_useRpcMutation({
    contract: pushNotificationsRpcContract,
    method: "notificationsHint.shown",
  });
  const { mutate: accept } = experimental_useRpcMutation({
    contract: pushNotificationsRpcContract,
    method: "notificationsHint.accept",
  });
  const { mutate: dismiss } = experimental_useRpcMutation({
    contract: pushNotificationsRpcContract,
    method: "notificationsHint.dismiss",
  });
  const candidateId =
    enabled && !query.error ? (query.data?.suggestion?.id ?? null) : null;
  const suggestionId = candidateId === finishedId ? null : candidateId;
  const nextCheckAt = query.data?.nextCheckAt;
  const refetch = query.refetch;

  useEffect(() => {
    clicked.current = false;
  }, [candidateId]);

  useEffect(() => {
    const refresh = () => setVisibleDocument(!document.hidden);
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);

  useEffect(() => {
    if (!enabled || nextCheckAt == null) return;
    const timer = window.setTimeout(
      () => void refetch(),
      Math.min(2_147_483_647, Math.max(1, nextCheckAt - Date.now())),
    );
    return () => window.clearTimeout(timer);
  }, [enabled, nextCheckAt, refetch]);

  useEffect(() => {
    if (suggestionId === null || shownId.current === suggestionId) return;
    const recordShown = () => {
      if (shownId.current === suggestionId) return;
      shownId.current = suggestionId;
      void markShown({ id: suggestionId }).catch(() => {
        shownId.current = null;
      });
    };
    const element = hintRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      recordShown();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) recordShown();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [suggestionId, markShown]);

  useEffect(() => {
    if (!confirmation) return;
    const timer = window.setTimeout(() => setConfirmation(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [confirmation]);

  async function turnOn(id: string) {
    if (clicked.current) return;
    clicked.current = true;
    setBusy(true);
    setError(null);
    const accepted = accept({ id }).catch(() => undefined);
    try {
      const result = await requestNotificationPermission();
      setPermission(result);
      setFinishedId(id);
      setConfirmation(result === "granted");
    } catch {
      setFinishedId(id);
    } finally {
      await accepted;
      setBusy(false);
    }
  }

  async function notNow(id: string) {
    if (clicked.current) return;
    clicked.current = true;
    setBusy(true);
    setError(null);
    try {
      await dismiss({ id });
      setFinishedId(id);
    } catch {
      clicked.current = false;
      setError("Couldn't save this choice. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (confirmation) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Notifications on
      </p>
    );
  }
  if (suggestionId === null) return null;
  return (
    <div
      ref={hintRef}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm"
    >
      <Icon
        name="BellDot"
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="min-w-0 flex-1 text-muted-foreground">
        Get notified when this needs you
      </span>
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void turnOn(suggestionId)}
          className="rounded-md bg-foreground px-3 py-1.5 font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          Turn on
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void notNow(suggestionId)}
          className="text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          Not now
        </button>
      </div>
      {error ? (
        <p role="status" className="w-full text-muted-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}
