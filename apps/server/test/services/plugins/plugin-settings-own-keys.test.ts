import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getPluginSettingsValues,
  setPluginSettingsValues,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { deleteSecretFile, writeSecretFile } from "@bb/secret-storage";
import type {
  PluginSettingDescriptor,
  PluginSettingDescriptors,
  PluginSettingValue,
} from "@get-bb/plugin-sdk";
import {
  coerceStoredPluginSettingValue,
  registerSettingDescriptors,
  validateSettingsUpdate,
} from "@get-bb/plugin-sdk/internal/host-policy";
import {
  pluginSecretsDir,
  readPluginSettingsValuesSync,
  writePluginSettingsUpdate,
} from "../../../src/services/plugins/plugin-settings.js";

interface StoreArgs {
  db: DbConnection;
  dataDir: string;
  pluginId: string;
  descriptors: PluginSettingDescriptors;
}

function legacyIsSecret(descriptor: PluginSettingDescriptor): boolean {
  return descriptor.type === "string" && descriptor.secret === true;
}

async function legacyWritePluginSettingsUpdate(
  args: StoreArgs & { values: Record<string, unknown> },
): Promise<void> {
  const rowUpdates: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(args.values)) {
    const descriptor = args.descriptors[key];
    if (!descriptor) continue;
    if (legacyIsSecret(descriptor)) {
      const path = join(pluginSecretsDir(args.dataDir, args.pluginId), key);
      if (value === null) await deleteSecretFile(path);
      else await writeSecretFile(path, value as string);
      continue;
    }
    rowUpdates[key] = value === null ? null : JSON.stringify(value);
  }
  if (Object.keys(rowUpdates).length > 0) {
    setPluginSettingsValues(args.db, args.pluginId, rowUpdates);
  }
}

function legacyParseStoredSettingValue(
  descriptor: PluginSettingDescriptor,
  raw: string | undefined,
): PluginSettingValue | undefined {
  let parsed: unknown;
  if (raw !== undefined) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
  }
  return coerceStoredPluginSettingValue(descriptor, parsed);
}

function legacyReadPluginSettingsValuesSync(
  args: Omit<StoreArgs, "dataDir">,
): Record<string, PluginSettingValue | undefined> {
  const stored = getPluginSettingsValues(args.db, args.pluginId);
  const values: Record<string, PluginSettingValue | undefined> = {};
  for (const [key, descriptor] of Object.entries(args.descriptors)) {
    if (legacyIsSecret(descriptor)) continue;
    values[key] = legacyParseStoredSettingValue(descriptor, stored[key]);
  }
  return values;
}

const PLUGIN_ID = "own-keys";

const inheritedNames = [
  "constructor",
  "toString",
  "hasOwnProperty",
  "valueOf",
  "isPrototypeOf",
];

function descriptors(): PluginSettingDescriptors {
  return {
    apiKey: { type: "string", label: "API key", secret: true },
    note: { type: "string", label: "Note" },
    autoSync: { type: "boolean", label: "Sync", default: true },
    retries: { type: "number", label: "Retries", default: 3 },
  };
}

describe("settings storage looks up only the plugin's own setting names", () => {
  let legacy: StoreArgs;
  let current: StoreArgs;
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-own-keys-"));
    legacy = {
      db: createMigratedConnection(),
      dataDir: join(workDir, "legacy"),
      pluginId: PLUGIN_ID,
      descriptors: descriptors(),
    };
    current = {
      db: createMigratedConnection(),
      dataDir: join(workDir, "current"),
      pluginId: PLUGIN_ID,
      descriptors: descriptors(),
    };
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  async function secretFiles(args: StoreArgs): Promise<string[]> {
    return readdir(pluginSecretsDir(args.dataDir, args.pluginId)).catch(
      () => [],
    );
  }

  it("writes the same rows and secret files for the plugin's own names", async () => {
    const updates: Array<Record<string, unknown>> = [
      { note: "hello", autoSync: false, retries: 4.5, apiKey: "sk-1" },
      { note: "again", unknownKey: "ignored" },
      { note: null, apiKey: null, retries: 0 },
      {},
    ];
    for (const values of updates) {
      await legacyWritePluginSettingsUpdate({ ...legacy, values });
      await writePluginSettingsUpdate({ ...current, values });
      expect(getPluginSettingsValues(current.db, PLUGIN_ID)).toEqual(
        getPluginSettingsValues(legacy.db, PLUGIN_ID),
      );
      expect(await secretFiles(current)).toEqual(await secretFiles(legacy));
    }
    expect(getPluginSettingsValues(current.db, PLUGIN_ID)).toEqual({
      autoSync: "false",
      retries: "0",
    });
  });

  it("keeps a secret value out of the rows in both versions", async () => {
    const values = { apiKey: "sk-secret" };
    await legacyWritePluginSettingsUpdate({ ...legacy, values });
    await writePluginSettingsUpdate({ ...current, values });
    expect(getPluginSettingsValues(current.db, PLUGIN_ID)).toEqual({});
    expect(
      await readFile(
        join(pluginSecretsDir(current.dataDir, PLUGIN_ID), "apiKey"),
        "utf8",
      ),
    ).toBe("sk-secret");
  });

  it("stores nothing for inherited names, where the legacy write stored a row for them", async () => {
    const values: Record<string, unknown> = {
      constructor: "x",
      toString: 1,
      hasOwnProperty: true,
      valueOf: null,
      isPrototypeOf: { nested: [1] },
      note: "real",
    };
    await legacyWritePluginSettingsUpdate({ ...legacy, values });
    await writePluginSettingsUpdate({ ...current, values });

    expect(
      Object.keys(getPluginSettingsValues(legacy.db, PLUGIN_ID)).sort(),
    ).toEqual([
      "constructor",
      "hasOwnProperty",
      "isPrototypeOf",
      "note",
      "toString",
    ]);
    expect(getPluginSettingsValues(current.db, PLUGIN_ID)).toEqual({
      note: '"real"',
    });
    expect(await secretFiles(current)).toEqual([]);
  });

  it("ignores an own __proto__ key from a parsed request body in both versions", async () => {
    const values: Record<string, unknown> = JSON.parse(
      '{"__proto__": "x", "note": "real"}',
    );
    await legacyWritePluginSettingsUpdate({ ...legacy, values });
    await writePluginSettingsUpdate({ ...current, values });
    expect(getPluginSettingsValues(current.db, PLUGIN_ID)).toEqual(
      getPluginSettingsValues(legacy.db, PLUGIN_ID),
    );
    expect(getPluginSettingsValues(current.db, PLUGIN_ID)).toEqual({
      note: '"real"',
    });
  });

  it.each(inheritedNames)(
    "never stores a row for %s even when it deletes",
    async (name) => {
      await writePluginSettingsUpdate({
        ...current,
        values: { [name]: null },
      });
      await writePluginSettingsUpdate({ ...current, values: { [name]: "v" } });
      expect(getPluginSettingsValues(current.db, PLUGIN_ID)).toEqual({});
    },
  );

  it("still stores a setting that the plugin really named after an inherited member", async () => {
    const own = registerSettingDescriptors(
      {},
      {
        constructor: { type: "string", label: "Constructor", default: "c" },
        toString: { type: "boolean", label: "To string" },
      },
    );
    const values = { constructor: "kept", toString: true, valueOf: "dropped" };
    expect(validateSettingsUpdate(own, values)).toEqual([
      'unknown setting "valueOf"',
    ]);
    await legacyWritePluginSettingsUpdate({
      ...legacy,
      descriptors: own,
      values,
    });
    await writePluginSettingsUpdate({ ...current, descriptors: own, values });
    expect(getPluginSettingsValues(current.db, PLUGIN_ID)).toEqual({
      constructor: '"kept"',
      toString: "true",
    });
    expect(
      Object.keys(getPluginSettingsValues(legacy.db, PLUGIN_ID)).sort(),
    ).toEqual(["constructor", "toString", "valueOf"]);
    expect(
      readPluginSettingsValuesSync({
        db: current.db,
        pluginId: PLUGIN_ID,
        descriptors: own,
      }),
    ).toEqual({ constructor: "kept", toString: true });
  });

  it("reads the same values as the legacy lookup, with or without stored rows", () => {
    const own = registerSettingDescriptors(
      {},
      {
        constructor: { type: "string", label: "Constructor", default: "c" },
        toString: { type: "boolean", label: "To string" },
        hasOwnProperty: { type: "number", label: "Count", default: 2 },
        note: { type: "string", label: "Note" },
        retries: { type: "number", label: "Retries", default: 3 },
        apiKey: { type: "string", label: "API key", secret: true },
      },
    );
    const read = (db: DbConnection) => ({
      legacy: legacyReadPluginSettingsValuesSync({
        db,
        pluginId: PLUGIN_ID,
        descriptors: own,
      }),
      current: readPluginSettingsValuesSync({
        db,
        pluginId: PLUGIN_ID,
        descriptors: own,
      }),
    });

    const empty = read(current.db);
    expect(empty.current).toEqual(empty.legacy);
    expect(empty.current).toEqual({
      constructor: "c",
      toString: undefined,
      hasOwnProperty: 2,
      note: undefined,
      retries: 3,
    });

    setPluginSettingsValues(current.db, PLUGIN_ID, {
      constructor: JSON.stringify("stored"),
      toString: "not json",
      note: JSON.stringify("n"),
      retries: JSON.stringify(" 7 "),
    });
    const stored = read(current.db);
    expect(stored.current).toEqual(stored.legacy);
    expect(stored.current).toEqual({
      constructor: "stored",
      toString: undefined,
      hasOwnProperty: 2,
      note: "n",
      retries: 7,
    });
  });
});
