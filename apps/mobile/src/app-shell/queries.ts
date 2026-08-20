// The system queries moved to src/data/system; these aliases keep the shell's
// existing imports working.
export {
  useSystemConfig as useSystemConfigQuery,
  useSystemVersion as useSystemVersionQuery,
} from "@/data/system/system-queries";
export { systemVersionQueryKey } from "@/lib/query/query-keys";
