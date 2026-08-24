import { useAtom } from "jotai";
import {
  REWRITE_LOCALHOST_LINKS_DEFAULT,
  REWRITE_LOCALHOST_LINKS_STORAGE_KEY,
} from "@bb/client-core";
import { createBooleanPreferenceAtom } from "./browser-storage";

// The pure rewrite rule and preference constants live in @bb/client-core so the
// native markdown renderer applies the same rewrite; the jotai atom stays here.
export { rewriteLocalhostLinkHref } from "@bb/client-core";

const rewriteLocalhostLinksPreferenceAtom = createBooleanPreferenceAtom(
  REWRITE_LOCALHOST_LINKS_STORAGE_KEY,
  REWRITE_LOCALHOST_LINKS_DEFAULT,
);

export function useRewriteLocalhostLinksPreference() {
  return useAtom(rewriteLocalhostLinksPreferenceAtom);
}
