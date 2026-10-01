import { act } from "@testing-library/react";
import { defaultScheduler, notifyManager } from "@tanstack/react-query";

export function createQueryNotificationScheduler() {
  const pending = new Map<ReturnType<typeof setTimeout>, () => void>();

  return {
    install() {
      notifyManager.setScheduler((callback) => {
        const timer = setTimeout(() => {
          pending.delete(timer);
          callback();
        }, 0);
        pending.set(timer, callback);
      });
    },
    async flush() {
      do {
        await act(async () => {
          for (const [timer, callback] of [...pending]) {
            clearTimeout(timer);
            pending.delete(timer);
            callback();
          }
          await Promise.resolve();
        });
      } while (pending.size > 0);
    },
    restore() {
      for (const timer of pending.keys()) clearTimeout(timer);
      pending.clear();
      notifyManager.setScheduler(defaultScheduler);
    },
  };
}
