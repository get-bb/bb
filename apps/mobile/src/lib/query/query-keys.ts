const SYSTEM_CONFIG_QUERY_KEY = "systemConfig";

type SystemConfigQueryKey = readonly [typeof SYSTEM_CONFIG_QUERY_KEY];

export function systemConfigQueryKey(): SystemConfigQueryKey {
  return [SYSTEM_CONFIG_QUERY_KEY];
}
