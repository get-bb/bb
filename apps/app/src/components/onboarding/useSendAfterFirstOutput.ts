import { useEffect, useEffectEvent, useRef } from "react";

export function useSendAfterFirstOutput({
  enabled,
  hasOutput,
  settleMs,
  send,
}: {
  enabled: boolean;
  hasOutput: boolean;
  settleMs: number;
  send: () => void;
}): void {
  const sentRef = useRef(false);
  const sendLatest = useEffectEvent(() => send());
  useEffect(() => {
    if (!enabled || !hasOutput || sentRef.current) return;
    const timer = window.setTimeout(() => {
      sentRef.current = true;
      sendLatest();
    }, settleMs);
    return () => window.clearTimeout(timer);
  }, [enabled, hasOutput, settleMs]);
}
