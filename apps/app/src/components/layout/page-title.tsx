import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { atom, useSetAtom } from "jotai";
import { z } from "zod";
import type { ExperimentalPageTitle } from "@get-bb/plugin-sdk/app";
import { useLocation } from "react-router-dom";
import { resolveToolsBreadcrumbs } from "@/components/tools/tools-navigation";

const pageTitleSchema = z
  .union([
    z
      .object({ title: z.string(), windowTitle: z.string().optional() })
      .strict(),
    z
      .object({
        breadcrumbs: z.array(
          z
            .object({
              label: z.string(),
              to: z
                .string()
                .regex(/^\/(?!\/)/)
                .optional(),
            })
            .strict(),
        ),
        windowTitle: z.string().optional(),
      })
      .strict(),
  ])
  .nullable();

type Entry = { owner: object; value: ExperimentalPageTitle };
type PageTitleHost = {
  value: ExperimentalPageTitle | null;
  publish: (entry: Entry | null, owner: object) => void;
};
const PageTitleContext = createContext<PageTitleHost | null>(null);
export const focusedPageTitleAtom = atom<ExperimentalPageTitle | null>(null);

export function PageTitleProvider({
  children,
  scope,
  focused = true,
  fallback = null,
}: {
  children: ReactNode;
  scope: string;
  focused?: boolean;
  fallback?: ExperimentalPageTitle | null;
}) {
  const [entry, setEntry] = useState<(Entry & { scope: string }) | null>(null);
  const value = entry?.scope === scope ? entry.value : fallback;
  const publish = useMemo<PageTitleHost["publish"]>(
    () => (next, owner) =>
      setEntry((current) =>
        next ? { ...next, scope } : current?.owner === owner ? null : current,
      ),
    [scope],
  );
  const host = useMemo<PageTitleHost>(
    () => ({ value, publish }),
    [value, publish],
  );
  const setFocusedTitle = useSetAtom(focusedPageTitleAtom);
  useLayoutEffect(() => {
    if (!focused) return;
    setFocusedTitle(value);
    return () =>
      setFocusedTitle((current) => (current === value ? null : current));
  }, [focused, setFocusedTitle, value]);
  return (
    <PageTitleContext.Provider value={host}>
      {children}
    </PageTitleContext.Provider>
  );
}

export function usePageTitleValue() {
  return useContext(PageTitleContext)?.value ?? null;
}

export function usePageTitle(value: ExperimentalPageTitle | null) {
  const host = useContext(PageTitleContext);
  if (!host) throw new Error("experimental_usePageTitle requires a page host");
  const serialized = JSON.stringify(value);
  const publish = host.publish;
  useLayoutEffect(() => {
    const owner = {};
    const parsed = pageTitleSchema.parse(JSON.parse(serialized));
    publish(parsed === null ? null : { owner, value: parsed }, owner);
    return () => publish(null, owner);
  }, [publish, serialized]);
}

export function useToolsPageTitle(label: string | null, enabled = true) {
  const location = useLocation();
  const breadcrumbs = resolveToolsBreadcrumbs(
    location.pathname,
    location.search,
    label,
  );
  usePageTitle(
    enabled && label && breadcrumbs
      ? {
          breadcrumbs:
            breadcrumbs.length === 2
              ? [...breadcrumbs, { label }]
              : breadcrumbs,
        }
      : null,
  );
}
