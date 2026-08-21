// Pure deep-link resolution. The RN glue lives in app/+native-intent.tsx and
// src/app-shell (profile switching, navigation).
export { addServerPathForLink, resolveIncomingLink } from "./incoming-link";
