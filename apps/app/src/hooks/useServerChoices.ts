import { useEffect, useState } from "react";
import { getServerChoices, type ServerChoice } from "@/lib/server-choices";

export function useServerChoices() {
  const [capability] = useState(getServerChoices);
  const [choices, setChoices] = useState<ServerChoice[]>([]);
  useEffect(() => {
    if (capability === null) return;
    let disposed = false;
    let receivedEvent = false;
    const unsubscribe = capability.subscribe((choices) => {
      receivedEvent = true;
      if (!disposed) setChoices(choices);
    });
    void capability
      .list()
      .then((choices) => {
        if (!disposed && !receivedEvent) setChoices(choices);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [capability]);
  return { choices, select: capability?.select };
}
