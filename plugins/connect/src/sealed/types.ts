import type { DeviceSurface } from "@bb/sealed-channel";
import type { SealedDeviceStatus } from "./devices.js";

export const SEALED_REALTIME_CHANNEL = "connect-sealed";
export const SEALED_ROUTE_PATH = "/sealed";
export const SEALED_INFO_ROUTE_PATH = "/sealed/info";
export const SEALED_HTTP_PREFIX = "/api/v1/plugins/connect/http";

export interface SealedDeviceSummary {
  id: string;
  name: string;
  surface: DeviceSurface;
  status: SealedDeviceStatus;
  fingerprint: string;
  createdAt: number;
  approvedAt: number | null;
  revokedAt: number | null;
  lastSeenAt: number | null;
  connected: boolean;
  parentId: string | null;
  approvedVia: "device-code" | "manual" | "delegation" | "account-gate" | null;
}

export interface SealedStatus {
  protocolVersion: number;
  publicKey: string;
  fingerprint: string;
  identityCreatedAt: number;
  required: boolean;
  activeChannels: number;
  devices: SealedDeviceSummary[];
}

export interface SealedInfo {
  protocolVersion: number;
  publicKey: string;
  fingerprint: string;
  required: boolean;
  connectHost?: string;
}

export interface SealedDeviceCode {
  code: string;
  expiresAt: number;
  serverKey: string;
  fingerprint: string;
}
