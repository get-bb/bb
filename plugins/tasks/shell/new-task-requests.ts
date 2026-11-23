import { useEffect, useRef } from "react";
import type { PluginCommandContext } from "@get-bb/plugin-sdk/app";

const shells = new Set<() => void>();
let pending = false;

export function requestNewTask(context: PluginCommandContext): void {
  const latest = [...shells].at(-1);
  if (latest !== undefined) {
    latest();
    return;
  }
  pending = true;
  context.navigate.toPluginPanel("tasks");
}

export function useNewTaskRequests(open: () => void): void {
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const handle = () => openRef.current();
    shells.add(handle);
    if (pending) {
      pending = false;
      handle();
    }
    return () => {
      shells.delete(handle);
    };
  }, []);
}
