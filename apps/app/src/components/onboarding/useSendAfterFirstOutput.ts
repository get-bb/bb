import { useEffect, useRef } from "react";

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
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (!enabled || !hasOutput || sentRef.current) return;
    const timer = window.setTimeout(() => {
      sentRef.current = true;
      sendRef.current();
    }, settleMs);
    return () => window.clearTimeout(timer);
  }, [enabled, hasOutput, settleMs]);
}
