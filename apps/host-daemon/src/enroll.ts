import {
  hostDaemonEnrollResponseSchema,
  type HostDaemonEnrollRequest,
} from "@bb/host-daemon-contract";

interface EnrollHostArgs {
  fetchFn?: typeof fetch;
  hostId: string;
  hostName: string;
  hostType: HostDaemonEnrollRequest["hostType"];
  connectMachineId?: string;
  machineCredential?: string;
  serverUrl: string;
  token: string;
}

interface EnrollHostResult {
  hostId: string;
  hostKey: string;
}

interface EnrollHeaders extends Record<string, string> {
  authorization: string;
  "content-type": string;
}

function buildEnrollUrl(serverUrl: string): string {
  return new URL("/internal/hosts/enroll", serverUrl).toString();
}

function summarizeErrorDetail(detail: string): string {
  const compact = detail.replace(/\s+/gu, " ").trim();
  if (compact.length <= 200) {
    return compact;
  }
  return `${compact.slice(0, 197)}...`;
}

export async function enrollDaemonHost(
  args: EnrollHostArgs,
): Promise<EnrollHostResult> {
  const fetchFn = args.fetchFn ?? fetch;
  const headers: EnrollHeaders = {
    authorization: `Bearer ${args.token}`,
    "content-type": "application/json",
  };
  if (args.machineCredential !== undefined) {
    headers["x-bb-connect-machine"] = args.machineCredential;
  }
  const body: HostDaemonEnrollRequest = {
    hostId: args.hostId,
    hostName: args.hostName,
    hostType: args.hostType,
  };
  if (args.connectMachineId !== undefined) {
    body.connectMachineId = args.connectMachineId;
  }
  const response = await fetchFn(buildEnrollUrl(args.serverUrl), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (response.status !== 201) {
    const detail = await response.text();
    throw new Error(
      `Failed to enroll daemon host: ${response.status} ${response.statusText}${detail ? ` - ${summarizeErrorDetail(detail)}` : ""}`,
    );
  }

  return hostDaemonEnrollResponseSchema.parse(await response.json());
}
