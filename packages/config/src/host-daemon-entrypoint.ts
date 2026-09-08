import {
  readOptionalEnvVar,
  resolveEnvLoader,
  type EnvLoaderArgs,
} from "./env.js";
import {
  BB_SERVER_HEADERS_ENV,
  BB_BRIDGE_DIR_ENV,
  BB_CLI_DIR_ENV,
  BB_CONNECT_MACHINE_CREDENTIAL_ENV,
  BB_HOST_ENROLL_KEY_ENV,
  BB_HOST_DAEMON_AUTO_UPDATE_ENV,
  BB_HOST_ID_ENV,
  BB_HOST_NAME_ENV,
} from "./env-vars.js";
import { assignIfDefined } from "./objects.js";

export interface HostDaemonEntrypointConfig {
  BB_BRIDGE_DIR?: string;
  BB_CLI_DIR?: string;
  BB_SERVER_HEADERS?: Record<string, string>;
  BB_HOST_ENROLL_KEY?: string;
  BB_HOST_DAEMON_AUTO_UPDATE?: boolean;
  BB_HOST_ID?: string;
  BB_HOST_NAME?: string;
}

type LoadHostDaemonEntrypointConfigArgs = EnvLoaderArgs;

export function loadHostDaemonEntrypointConfig(
  args: LoadHostDaemonEntrypointConfigArgs = {},
): HostDaemonEntrypointConfig {
  const loader = resolveEnvLoader(args);
  const config: HostDaemonEntrypointConfig = {};
  const bridgeDir = readOptionalEnvVar({
    context: loader.context,
    definition: BB_BRIDGE_DIR_ENV,
    env: loader.env,
  });
  const cliDir = readOptionalEnvVar({
    context: loader.context,
    definition: BB_CLI_DIR_ENV,
    env: loader.env,
  });
  const enrollKey = readOptionalEnvVar({
    context: loader.context,
    definition: BB_HOST_ENROLL_KEY_ENV,
    env: loader.env,
  });
  const autoUpdate = readOptionalEnvVar({
    context: loader.context,
    definition: BB_HOST_DAEMON_AUTO_UPDATE_ENV,
    env: loader.env,
  });
  const machineCredential = readOptionalEnvVar({
    context: loader.context,
    definition: BB_CONNECT_MACHINE_CREDENTIAL_ENV,
    env: loader.env,
  });
  const serverHeaders =
    readOptionalEnvVar({
      context: loader.context,
      definition: BB_SERVER_HEADERS_ENV,
      env: loader.env,
    }) ??
    (machineCredential === undefined
      ? undefined
      : { "x-bb-connect-machine": machineCredential });
  const hostId = readOptionalEnvVar({
    context: loader.context,
    definition: BB_HOST_ID_ENV,
    env: loader.env,
  });
  const hostName = readOptionalEnvVar({
    context: loader.context,
    definition: BB_HOST_NAME_ENV,
    env: loader.env,
  });

  assignIfDefined({
    key: "BB_BRIDGE_DIR",
    target: config,
    value: bridgeDir,
  });
  assignIfDefined({
    key: "BB_CLI_DIR",
    target: config,
    value: cliDir,
  });
  assignIfDefined({
    key: "BB_SERVER_HEADERS",
    target: config,
    value: serverHeaders,
  });
  assignIfDefined({
    key: "BB_HOST_DAEMON_AUTO_UPDATE",
    target: config,
    value: autoUpdate,
  });
  assignIfDefined({
    key: "BB_HOST_ENROLL_KEY",
    target: config,
    value: enrollKey,
  });
  assignIfDefined({
    key: "BB_HOST_ID",
    target: config,
    value: hostId,
  });
  assignIfDefined({
    key: "BB_HOST_NAME",
    target: config,
    value: hostName,
  });
  return config;
}
