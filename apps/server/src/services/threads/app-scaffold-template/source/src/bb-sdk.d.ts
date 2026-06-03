// GENERATED - do not edit. Run pnpm --filter @bb/sdk generate:app-globals-dts to regenerate.
// Source: @bb/sdk current app runtime types.
export {};

declare global {
  type ApplicationId = string;

  type AppDataPath = string;

  interface JsonObject {
    [key: string]: JsonValue;
  }

  type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

  interface AppDataEntry {
    path: AppDataPath;
    value: JsonValue;
    version: string;
    sizeBytes: number;
    modifiedAtMs: number;
  }

  interface BbDataEntry {
    path: AppDataPath;
    value: JsonValue;
  }

  interface BbDataReadArgs {
    path: AppDataPath;
  }

  interface BbDataWriteArgs extends BbDataReadArgs {
    value: JsonValue;
  }

  interface BbDataDeleteArgs extends BbDataReadArgs {
  }

  interface BbDataListArgs {
    prefix?: AppDataPath | "";
  }

  interface BbDataChangeEvent {
    path: AppDataPath;
    value: JsonValue | undefined;
    deleted: boolean;
  }

  type BbDataChangeCallback = (event: BbDataChangeEvent) => void;

  interface BbDataOnChangeArgs {
    callback: BbDataChangeCallback;
    prefix?: AppDataPath | "";
  }

  interface BbMessageSendArgs {
    payload: JsonValue;
    targetThreadId?: string;
  }

  type CurrentAppDataReadArgs = BbDataReadArgs;

  type CurrentAppDataWriteArgs = BbDataWriteArgs;

  type CurrentAppDataDeleteArgs = BbDataDeleteArgs;

  type CurrentAppDataListArgs = BbDataListArgs;

  type CurrentAppDataEntry = BbDataEntry;

  type CurrentAppDataChangeEvent = BbDataChangeEvent;

  type CurrentAppDataChangeCallback = BbDataChangeCallback;

  type CurrentAppDataChangeArgs = BbDataOnChangeArgs;

  type CurrentAppMessageSendArgs = BbMessageSendArgs;

  interface CurrentAppDataArea {
    delete(args: CurrentAppDataDeleteArgs): Promise<void>;
    entries(args?: CurrentAppDataListArgs): Promise<AppDataEntry[]>;
    list(args?: CurrentAppDataListArgs): Promise<CurrentAppDataEntry[]>;
    onChange(args: CurrentAppDataChangeArgs): () => void;
    read(args: CurrentAppDataReadArgs): Promise<JsonValue | undefined>;
    write(args: CurrentAppDataWriteArgs): Promise<void>;
  }

  interface CurrentAppMessageArea {
    send(args: CurrentAppMessageSendArgs): Promise<void>;
  }

  type BbData = CurrentAppDataArea;

  type BbMessage = CurrentAppMessageArea;

  interface Bb {
    appId?: ApplicationId;
    applicationId?: ApplicationId;
    data: CurrentAppDataArea;
    message: CurrentAppMessageArea;
  }

  interface Window {
    bb?: Bb;
  }
}
