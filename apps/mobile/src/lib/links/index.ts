// Pure deep-link resolution. The RN glue lives in app/+native-intent.tsx and
// src/app-shell (profile switching, navigation).
export {
  ADD_SERVER_PATH,
  BB_URL_SCHEME,
  addServerPathForLink,
  isDeveloperRoutePath,
  mapWebPathToMobilePath,
  matchProfileForWebLink,
  parseIncomingLink,
  resolveIncomingLink,
  type IncomingLink,
  type LinkProfileLike,
  type LinkResolution,
  type ResolveIncomingLinkContext,
} from "./incoming-link";
