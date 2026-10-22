import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  type ReactNode,
} from "react";
import { atom, useSetAtom } from "jotai";
import { z } from "zod";
import type {
  ExperimentalPageTitle,
  PluginNavPanelRegistration,
} from "@get-bb/plugin-sdk/app";

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

const PageTitleContext = createContext<ExperimentalPageTitle | null>(null);
export const focusedPageTitleAtom = atom<ExperimentalPageTitle | null>(null);

export function PageTitleProvider({
  children,
  value,
  focused = true,
}: {
  children: ReactNode;
  value: ExperimentalPageTitle | null;
  focused?: boolean;
}) {
  const serialized = JSON.stringify(value);
  const parsed = useMemo(
    () => pageTitleSchema.parse(JSON.parse(serialized)),
    [serialized],
  );
  const setFocusedTitle = useSetAtom(focusedPageTitleAtom);
  useLayoutEffect(() => {
    if (!focused) return;
    setFocusedTitle(parsed);
    return () =>
      setFocusedTitle((current) => (current === parsed ? null : current));
  }, [focused, parsed, setFocusedTitle]);
  return (
    <PageTitleContext.Provider value={parsed}>
      {children}
    </PageTitleContext.Provider>
  );
}

export function usePageTitleValue() {
  return useContext(PageTitleContext);
}

type UsePageTitle = NonNullable<
  PluginNavPanelRegistration["experimental_usePageTitle"]
>;

export function PageTitleHookHost({
  usePageTitle,
  subPath,
  focused = true,
  children,
}: {
  usePageTitle: UsePageTitle;
  subPath: string;
  focused?: boolean;
  children: ReactNode;
}) {
  const value = usePageTitle({ subPath });
  return (
    <PageTitleProvider value={value} focused={focused}>
      {children}
    </PageTitleProvider>
  );
}
