import { requireOptionalNativeModule } from "expo";

export interface NativeClientCertificates {
  getAlias(serverUrl: string): string | null;
  prepare(serverUrl: string): Promise<void>;
  choose(serverUrl: string): Promise<string | null>;
  stopUsing(serverUrl: string): Promise<void>;
  forget(serverUrl: string): Promise<void>;
  restartApp(): void;
}

export const nativeClientCertificates =
  requireOptionalNativeModule<NativeClientCertificates>("BbClientCertificates");
