import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  CaptureConfig,
  InstrumentCapabilities,
  InstrumentDriver,
  InstrumentDriverDeps,
  PrerequisiteReport,
} from "../driver.js";
import { validateCaptureConfig } from "../driver.js";
import {
  DeviceLostError,
  InstrumentError,
  resolveInstrumentTransport,
  runInstrumentProcess,
  TransportError,
  type ProcessResult,
} from "../transport.js";
import type {
  ScopeCapture,
  ScopeChannelConfig,
  ScopeTrigger,
  WaveformData,
} from "./waveform.js";

const MAX_CAPTURE_MS = 60_000;
const MAX_CAPTURE_SAMPLES = 10_000_000;
const MAX_RAW_WAVEFORM_BYTES = MAX_CAPTURE_SAMPLES;
const MAX_BRIDGE_OUTPUT_BYTES = 256 * 1024;

class ScopeTriggerTimeoutError extends Error {
  readonly code = "TRIGGER_TIMEOUT" as const;
  constructor(
    message: string,
    readonly armedConfiguration: {
      channelConfigs: ScopeChannelConfig[];
      trigger: ScopeTrigger;
      sampleRateHz: number;
      samples: number;
    },
  ) {
    super(`TRIGGER_TIMEOUT: ${message}`);
    this.name = "ScopeTriggerTimeoutError";
  }
}

export interface ScpiProfile {
  readonly vendor: string;
  readonly commands: Readonly<Record<string, string>>;
  /** Parses one waveform response produced by one channel query. */
  parseWaveform(raw: Uint8Array): WaveformData;
}

const SIGLENT_COMMANDS = Object.freeze({
  idn: "*IDN?",
  responseHeadersOff: "CHDR OFF",
  stop: "STOP",
  run: "RUN",
  arm: "ARM",
  triggerStatus: "SAST?",
  sampleRateQuery: "SARA?",
  timebase: "TDIV {timeDiv}",
  channelDisplay: "C{channel}:TRA ON",
  channelScale: "C{channel}:VDIV {scaleV}V",
  channelCoupling: "C{channel}:CPL {coupling}",
  channelScaleQuery: "C{channel}:VDIV?",
  channelOffsetQuery: "C{channel}:OFST?",
  triggerType: "TRSE EDGE,SR,C{channel},HT,OFF",
  triggerSlope: "C{channel}:TRSL {edge}",
  triggerLevel: "C{channel}:TRLV {levelV}V",
  memoryDepth: "MSIZ {samples}",
  waveformSource: "WFSU SP,0,NP,{samples},FP,0",
  waveformQuery: "C{channel}:WF? DAT2",
} as const);

function parseDefiniteBlock(raw: Uint8Array, headerStart = 0): Int8Array {
  if (raw.length < headerStart + 3 || raw[headerStart] !== 35) {
    throw new InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "SCPI waveform is not an IEEE 488.2 definite-length block.",
    );
  }
  const digits = raw[headerStart + 1]! - 48;
  if (
    !Number.isInteger(digits) ||
    digits < 1 ||
    digits > 9 ||
    raw.length < headerStart + 2 + digits
  ) {
    throw new InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "SCPI waveform block header is malformed.",
    );
  }
  let lengthText: string;
  try {
    lengthText = new TextDecoder("ascii", { fatal: true }).decode(
      raw.slice(headerStart + 2, headerStart + 2 + digits),
    );
  } catch (error) {
    throw new InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "SCPI waveform block length is not ASCII.",
      { cause: error },
    );
  }
  if (!/^\d+$/u.test(lengthText)) {
    throw new InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "SCPI waveform block length is malformed.",
    );
  }
  const length = Number(lengthText);
  const from = headerStart + 2 + digits;
  if (
    length < 1 ||
    length > MAX_CAPTURE_SAMPLES ||
    raw.length < from + length
  ) {
    throw new InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "SCPI waveform block is truncated or exceeds the sample bound.",
    );
  }
  const bytes = raw.slice(from, from + length);
  return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function parseSiglentWaveform(raw: Uint8Array): WaveformData {
  const marker = raw.indexOf(35);
  if (marker < 0) {
    throw new InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "Siglent DAT2 waveform lacks an IEEE 488.2 block.",
    );
  }
  const prefix = new TextDecoder("ascii").decode(raw.slice(0, marker));
  if (marker > 0 && !/^C\d+:WF DAT2,$/u.test(prefix)) {
    throw new InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "Siglent DAT2 waveform response header is malformed.",
    );
  }
  const samples = parseDefiniteBlock(raw, marker);
  return {
    // DAT2 carries no timebase. The production path replaces this sentinel
    // with the instrument's SARA? read-back before writing the artifact.
    sampleRateHz: 0,
    // Profile parsers normalize vendor ADC codes into vertical divisions.
    // The production path applies the instrument-read VDIV and OFST values.
    channels: { divisions: Array.from(samples, (sample) => sample / 25) },
  };
}

export const SIGLENT_SDS_PROFILE: ScpiProfile = Object.freeze({
  vendor: "siglent-sds",
  commands: SIGLENT_COMMANDS,
  parseWaveform: parseSiglentWaveform,
});

export const PYVISA_BRIDGE = String.raw`
import json, math, os, re, sys, time
import pyvisa

def numeric_response(value, unit):
    match = re.fullmatch(r"\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?)(?:" + re.escape(unit) + r")?\s*", value)
    if match is None:
        raise ValueError("malformed numeric response for " + unit + ": " + value)
    return float(match.group(1))

def bounded_waveform_read(instrument, max_bytes):
    marker = instrument.read_bytes(1, break_on_termchar=False)
    if marker != b"#":
        raise ValueError("headerless waveform does not begin with an IEEE 488.2 block")
    digit_text = instrument.read_bytes(1, break_on_termchar=False)
    if len(digit_text) != 1 or digit_text < b"1" or digit_text > b"9":
        raise ValueError("waveform block digit count is malformed")
    digits = int(digit_text)
    length_text = instrument.read_bytes(digits, break_on_termchar=False)
    if len(length_text) != digits or not length_text.isdigit():
        raise ValueError("waveform block length is malformed")
    length = int(length_text)
    if length < 1 or length > max_bytes:
        raise ValueError("waveform response exceeds the raw byte bound")
    payload = instrument.read_bytes(length, break_on_termchar=False)
    if len(payload) != length:
        raise ValueError("waveform block is truncated")
    terminator = instrument.read_bytes(2, break_on_termchar=False)
    if terminator != b"\n\n":
        raise ValueError("waveform response terminator is malformed")
    return marker + digit_text + length_text + payload + terminator

action = sys.argv[1]
request = json.loads(sys.argv[2])
rm = pyvisa.ResourceManager("@py")
instrument = rm.open_resource(request["resource"], open_timeout=3000)
instrument.timeout = request.get("ioTimeoutMs", 5000)
try:
    if action == "identify":
        print(json.dumps({"idn": instrument.query("*IDN?").strip()}))
    elif action == "capture":
        for command in request["setupCommands"]:
            instrument.write(command)
        actual_sample_rate_hz = numeric_response(instrument.query(request["sampleRateQuery"]), "Sa/s")
        actual_samples = min(request["samples"], math.ceil(actual_sample_rate_hz * request["durationMs"] / 1000.0))
        instrument.write(request["armCommand"])
        deadline = time.monotonic() + request["triggerTimeoutMs"] / 1000.0
        triggered = False
        while time.monotonic() < deadline:
            status = instrument.query(request["triggerStatusCommand"]).strip().lower()
            if status in ("stop", "stopped", "trig'd", "triggered"):
                triggered = True
                break
            time.sleep(0.01)
        if not triggered:
            instrument.write(request["stopCommand"])
            print(json.dumps({"armedConfiguration": request, "sampleRateHz": actual_sample_rate_hz, "samples": actual_samples}), flush=True)
            sys.exit(42)
        os.makedirs(request["outputDirectory"], exist_ok=True)
        raw_waveforms = {}
        for channel in request["channelConfigs"]:
            channel_name = channel["channel"]
            vdiv_v = numeric_response(instrument.query(request["channelScaleQueries"][channel_name]), "V")
            offset_v = numeric_response(instrument.query(request["channelOffsetQueries"][channel_name]), "V")
            instrument.write(request["waveformQueries"][channel_name])
            raw = bounded_waveform_read(instrument, request["maxRawBytes"])
            raw_path = os.path.join(request["outputDirectory"], "scpi-" + channel_name + ".dat2")
            with open(raw_path, "wb") as handle:
                handle.write(raw)
            raw_waveforms[channel_name] = {"path": raw_path, "vdivV": vdiv_v, "offsetV": offset_v}
        print(json.dumps({"rawWaveforms": raw_waveforms, "durationMs": request["durationMs"], "channelConfigs": request["channelConfigs"], "trigger": request.get("trigger"), "sampleRateHz": actual_sample_rate_hz}))
    else:
        raise ValueError("unsupported action")
finally:
    try: instrument.close()
    finally: rm.close()
`;

export interface ScpiScopeDriverDeps extends InstrumentDriverDeps {
  profiles?: readonly ScpiProfile[];
  resourceForDeviceId?: (deviceId: string) => string | null;
  bridgeEnv?: NodeJS.ProcessEnv;
}

let configuredPrerequisites: PrerequisiteReport | null = null;

function defaultPrerequisites(): PrerequisiteReport {
  if (configuredPrerequisites !== null) return configuredPrerequisites;
  const pyvisa = spawnSync("python3", ["-c", "import pyvisa"], {
    shell: false,
    timeout: 3_000,
    stdio: "ignore",
  });
  const backend =
    pyvisa.status === 0
      ? spawnSync(
          "python3",
          ["-c", "import pyvisa; r=pyvisa.ResourceManager('@py'); r.close()"],
          {
            shell: false,
            timeout: 3_000,
            stdio: "ignore",
          },
        )
      : null;
  const items = [
    {
      key: "scope.pyvisa",
      configured: pyvisa.status === 0,
      remediation: "Install PyVISA through the confirmed helper-install flow.",
    },
    {
      key: "scope.pyvisa-py-backend",
      configured: backend?.status === 0,
      remediation:
        "Install and configure pyvisa-py through the confirmed helper-install flow.",
    },
  ].filter((item) => !item.configured);
  const report = { configured: items.length === 0, needsConfiguration: items };
  if (report.configured) configuredPrerequisites = report;
  return report;
}

function responseObject(stdout: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (error) {
    throw new InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "PyVISA bridge returned malformed JSON.",
      { cause: error },
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "PyVISA bridge returned a non-object response.",
    );
  }
  return Object.fromEntries(Object.entries(parsed));
}

function profileForIdn(
  idn: string,
  profiles: readonly ScpiProfile[],
): ScpiProfile | null {
  const normalized = idn.toLowerCase();
  return (
    profiles.find((profile) =>
      normalized.includes(profile.vendor.split("-")[0]!.toLowerCase()),
    ) ?? null
  );
}

function render(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(
    /\{([A-Za-z][A-Za-z0-9]*)\}/gu,
    (_match, key: string) => {
      const value = values[key];
      if (value === undefined)
        throw new InstrumentError(
          "INSTRUMENT_PROTOCOL_ERROR",
          `SCPI command template requires ${key}.`,
        );
      return String(value);
    },
  );
}

function requiredCommand(profile: ScpiProfile, key: string): string {
  const command = profile.commands[key];
  if (!command)
    throw new InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      `SCPI profile ${profile.vendor} lacks ${key}.`,
    );
  return command;
}

function scpiResource(host: string, port: number): string {
  return `TCPIP0::${host}::${port}::SOCKET`;
}

function numberSetting(
  config: CaptureConfig,
  key: string,
  fallback: number,
): number {
  const value = config.settings?.[key] ?? fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InstrumentError(
      "CAPTURE_CONFIG_INVALID",
      `${key} must be numeric.`,
    );
  }
  return value;
}

function stringSetting(
  config: CaptureConfig,
  key: string,
  fallback: string,
): string {
  const value = config.settings?.[key] ?? fallback;
  if (typeof value !== "string")
    throw new InstrumentError("CAPTURE_CONFIG_INVALID", `${key} must be text.`);
  return value;
}

const SIGLENT_TIME_DIVISIONS_SECONDS = [
  1e-9, 2e-9, 5e-9, 1e-8, 2e-8, 5e-8, 1e-7, 2e-7, 5e-7, 1e-6, 2e-6, 5e-6, 1e-5,
  2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2, 1e-1, 2e-1,
  5e-1, 1, 2, 5, 10, 20, 50, 100,
] as const;

function siglentTimeDivision(durationMs: number): string {
  const requested = durationMs / 14_000;
  const selected =
    SIGLENT_TIME_DIVISIONS_SECONDS.find((value) => value >= requested) ?? 100;
  if (selected < 1e-6) return `${selected * 1e9}NS`;
  if (selected < 1e-3) return `${selected * 1e6}US`;
  if (selected < 1) return `${selected * 1e3}MS`;
  return `${selected}S`;
}

function siglentMemoryDepth(samples: number): string {
  const depths = [
    [14_000, "14K"],
    [140_000, "140K"],
    [1_400_000, "1.4M"],
    [14_000_000, "14M"],
  ] as const;
  return depths.find(([maximum]) => samples <= maximum)?.[1] ?? "14M";
}

function captureConfiguration(
  config: CaptureConfig,
  profile: ScpiProfile,
): {
  channelConfigs: ScopeChannelConfig[];
  trigger: ScopeTrigger | null;
  triggerTimeoutMs: number;
  samples: number;
  setupCommands: string[];
  waveformQueries: Record<string, string>;
  channelScaleQueries: Record<string, string>;
  channelOffsetQueries: Record<string, string>;
} {
  const channelConfigs = config.channels.map((index): ScopeChannelConfig => {
    const channel = `C${index + 1}`;
    const rangeV = numberSetting(config, `channel.${channel}.rangeV`, 5);
    const coupling = stringSetting(config, `channel.${channel}.coupling`, "dc");
    const attenuation = numberSetting(
      config,
      `channel.${channel}.attenuation`,
      1,
    );
    if (
      rangeV <= 0 ||
      (coupling !== "ac" && coupling !== "dc") ||
      attenuation <= 0
    ) {
      throw new InstrumentError(
        "CAPTURE_CONFIG_INVALID",
        `Channel ${channel} configuration is invalid.`,
      );
    }
    return { channel, rangeV, coupling, attenuation };
  });
  const triggerChannel = config.settings?.["trigger.channel"];
  let trigger: ScopeTrigger | null = null;
  if (triggerChannel !== undefined && triggerChannel !== null) {
    const channel = String(triggerChannel);
    const edge = stringSetting(config, "trigger.edge", "rising");
    const levelV = numberSetting(config, "trigger.levelV", 0);
    if (
      !channelConfigs.some((item) => item.channel === channel) ||
      (edge !== "rising" && edge !== "falling")
    ) {
      throw new InstrumentError(
        "CAPTURE_CONFIG_INVALID",
        "SCPI trigger configuration is invalid.",
      );
    }
    trigger = { channel, edge, levelV };
  }
  const triggerTimeoutMs = numberSetting(
    config,
    "trigger.timeoutMs",
    config.durationMs + 1_000,
  );
  const samples = Math.ceil((config.sampleRateHz * config.durationMs) / 1_000);
  if (
    !Number.isInteger(triggerTimeoutMs) ||
    triggerTimeoutMs < 1 ||
    samples > MAX_CAPTURE_SAMPLES
  ) {
    throw new InstrumentError(
      "CAPTURE_CONFIG_INVALID",
      "SCPI capture exceeds timeout or sample bounds.",
    );
  }
  const setupCommands = [
    requiredCommand(profile, "responseHeadersOff"),
    requiredCommand(profile, "stop"),
    render(requiredCommand(profile, "timebase"), {
      timeDiv: siglentTimeDivision(config.durationMs),
    }),
  ];
  for (const channel of channelConfigs) {
    const values = {
      channel: channel.channel.slice(1),
      scaleV: channel.rangeV / 8,
      coupling: channel.coupling === "dc" ? "D1M" : "A1M",
    };
    setupCommands.push(
      render(requiredCommand(profile, "channelDisplay"), values),
      render(requiredCommand(profile, "channelScale"), values),
      render(requiredCommand(profile, "channelCoupling"), values),
    );
  }
  setupCommands.push(
    render(requiredCommand(profile, "memoryDepth"), {
      samples: siglentMemoryDepth(samples),
    }),
  );
  if (trigger) {
    const values = {
      channel: trigger.channel.slice(1),
      edge: trigger.edge === "rising" ? "POS" : "NEG",
      levelV: trigger.levelV,
    };
    setupCommands.push(
      render(requiredCommand(profile, "triggerType"), values),
      render(requiredCommand(profile, "triggerSlope"), values),
      render(requiredCommand(profile, "triggerLevel"), values),
    );
  }
  setupCommands.push(
    render(requiredCommand(profile, "waveformSource"), { samples }),
  );
  const waveformQueries = Object.fromEntries(
    channelConfigs.map((channel) => [
      channel.channel,
      render(requiredCommand(profile, "waveformQuery"), {
        channel: channel.channel.slice(1),
      }),
    ]),
  );
  const channelScaleQueries = Object.fromEntries(
    channelConfigs.map((channel) => [
      channel.channel,
      render(requiredCommand(profile, "channelScaleQuery"), {
        channel: channel.channel.slice(1),
      }),
    ]),
  );
  const channelOffsetQueries = Object.fromEntries(
    channelConfigs.map((channel) => [
      channel.channel,
      render(requiredCommand(profile, "channelOffsetQuery"), {
        channel: channel.channel.slice(1),
      }),
    ]),
  );
  return {
    channelConfigs,
    trigger,
    triggerTimeoutMs,
    samples,
    setupCommands,
    waveformQueries,
    channelScaleQueries,
    channelOffsetQueries,
  };
}

function parsedChannelConfigs(value: unknown): ScopeChannelConfig[] {
  if (!Array.isArray(value)) {
    throw new InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "SCPI channel metadata is malformed.",
    );
  }
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new InstrumentError(
        "INSTRUMENT_PROTOCOL_ERROR",
        "SCPI channel metadata is malformed.",
      );
    }
    const channel = Reflect.get(item, "channel");
    const rangeV = Reflect.get(item, "rangeV");
    const coupling = Reflect.get(item, "coupling");
    const attenuation = Reflect.get(item, "attenuation");
    if (
      typeof channel !== "string" ||
      typeof rangeV !== "number" ||
      (coupling !== "ac" && coupling !== "dc") ||
      typeof attenuation !== "number"
    ) {
      throw new InstrumentError(
        "INSTRUMENT_PROTOCOL_ERROR",
        "SCPI channel metadata is malformed.",
      );
    }
    return { channel, rangeV, coupling, attenuation };
  });
}

function parsedTrigger(value: unknown): ScopeTrigger | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "SCPI trigger metadata is malformed.",
    );
  }
  const channel = Reflect.get(value, "channel");
  const edge = Reflect.get(value, "edge");
  const levelV = Reflect.get(value, "levelV");
  if (
    typeof channel !== "string" ||
    (edge !== "rising" && edge !== "falling") ||
    typeof levelV !== "number"
  ) {
    throw new InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "SCPI trigger metadata is malformed.",
    );
  }
  return { channel, edge, levelV };
}

async function artifactFromResponse(
  response: Record<string, unknown>,
  directory: string,
  profile: ScpiProfile,
): Promise<ScopeCapture> {
  const durationMs = response.durationMs;
  const channelConfigs = response.channelConfigs;
  const trigger = response.trigger;
  const sampleRateHz = response.sampleRateHz;
  const rawWaveforms = response.rawWaveforms;
  if (
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    typeof sampleRateHz !== "number" ||
    !Number.isFinite(sampleRateHz) ||
    sampleRateHz <= 0 ||
    typeof rawWaveforms !== "object" ||
    rawWaveforms === null ||
    Array.isArray(rawWaveforms)
  ) {
    throw new InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "SCPI capture metadata is malformed.",
    );
  }
  const root = await realpath(directory);
  const parsedConfigs = parsedChannelConfigs(channelConfigs);
  const channels: Record<string, number[]> = {};
  let samples: number | null = null;
  for (const channelConfig of parsedConfigs) {
    const metadata = Reflect.get(rawWaveforms, channelConfig.channel);
    if (typeof metadata !== "object" || metadata === null) {
      throw new InstrumentError(
        "INSTRUMENT_PROTOCOL_ERROR",
        `SCPI waveform metadata for ${channelConfig.channel} is malformed.`,
      );
    }
    const rawPath = Reflect.get(metadata, "path");
    const vdivV = Reflect.get(metadata, "vdivV");
    const offsetV = Reflect.get(metadata, "offsetV");
    if (
      typeof rawPath !== "string" ||
      typeof vdivV !== "number" ||
      !Number.isFinite(vdivV) ||
      vdivV <= 0 ||
      typeof offsetV !== "number" ||
      !Number.isFinite(offsetV)
    ) {
      throw new InstrumentError(
        "INSTRUMENT_PROTOCOL_ERROR",
        `SCPI waveform metadata for ${channelConfig.channel} is malformed.`,
      );
    }
    const confinedPath = await realpath(resolve(rawPath));
    const confined = relative(root, confinedPath);
    if (
      confined === ".." ||
      confined.startsWith(`..${sep}`) ||
      isAbsolute(confined)
    ) {
      throw new InstrumentError(
        "INSTRUMENT_PROTOCOL_ERROR",
        "SCPI raw waveform escaped its capture directory.",
      );
    }
    let parsed: WaveformData;
    try {
      parsed = profile.parseWaveform(await readFile(confinedPath));
    } finally {
      await unlink(confinedPath).catch(() => undefined);
    }
    const series = Object.values(parsed.channels);
    if (series.length !== 1 || series[0] === undefined) {
      throw new InstrumentError(
        "INSTRUMENT_PROTOCOL_ERROR",
        `SCPI profile ${profile.vendor} returned an ambiguous waveform.`,
      );
    }
    if (samples !== null && samples !== series[0].length) {
      throw new InstrumentError(
        "INSTRUMENT_PROTOCOL_ERROR",
        "SCPI channels returned unequal waveform lengths.",
      );
    }
    if (series[0].some((value) => !Number.isFinite(value))) {
      throw new InstrumentError(
        "INSTRUMENT_PROTOCOL_ERROR",
        `SCPI profile ${profile.vendor} returned non-finite samples.`,
      );
    }
    samples = series[0].length;
    channels[channelConfig.channel] = series[0].map(
      (divisions) => (divisions * vdivV - offsetV) * channelConfig.attenuation,
    );
  }
  if (samples === null || samples < 1 || samples > MAX_CAPTURE_SAMPLES)
    throw new InstrumentError(
      "INSTRUMENT_PROTOCOL_ERROR",
      "SCPI waveform contains no bounded samples.",
    );
  const artifactPath = resolve(directory, "scpi-waveform.json");
  await writeFile(
    artifactPath,
    JSON.stringify({
      schema: "finite-state-scope-v1",
      sampleRateHz,
      channels,
    }),
    "utf8",
  );
  await access(artifactPath);
  return {
    path: artifactPath,
    format: "finite-state-scope-json-v1",
    durationMs: (samples / sampleRateHz) * 1_000,
    channels: parsedConfigs.length,
    channelConfigs: parsedConfigs,
    trigger: parsedTrigger(trigger),
    sampleRateHz,
    samples,
  };
}

function bridgeFailure(result: ProcessResult, action: string): never {
  const detail =
    result.stderr.trim().slice(0, 2_000) || `exit ${result.code ?? "unknown"}`;
  if (/VI_ERROR_CONN_LOST|connection.*(?:reset|closed|lost)/iu.test(detail)) {
    throw new DeviceLostError(
      `SCPI scope connection was lost during ${action}.`,
      null,
    );
  }
  throw new InstrumentError(
    "INSTRUMENT_PROTOCOL_ERROR",
    `SCPI ${action} failed: ${detail}`,
  );
}

export function createScpiScopeDriver(
  deps: ScpiScopeDriverDeps,
): InstrumentDriver {
  const runner = deps.runner ?? runInstrumentProcess;
  const prerequisites = deps.prerequisiteReport ?? defaultPrerequisites;
  const profiles = deps.profiles ?? [SIGLENT_SDS_PROFILE];
  return {
    id: "scpi-lan-scope",
    async detect(transport) {
      const resolved = resolveInstrumentTransport(transport);
      if (resolved.kind === "usb")
        throw new TransportError(
          "TRANSPORT_NOT_IMPLEMENTED",
          "SCPI scope v1 requires LAN.",
        );
      const resource = scpiResource(resolved.host, resolved.port);
      const result = await runner(
        {
          command: "python3",
          args: ["-c", PYVISA_BRIDGE, "identify", JSON.stringify({ resource })],
          timeoutMs: 5_000,
          maxOutputBytes: MAX_BRIDGE_OUTPUT_BYTES,
          env: deps.bridgeEnv,
        },
        new AbortController().signal,
      );
      if (result.code !== 0) return null;
      const idn = responseObject(result.stdout).idn;
      if (typeof idn !== "string")
        throw new InstrumentError(
          "INSTRUMENT_PROTOCOL_ERROR",
          "SCPI *IDN? response is malformed.",
        );
      const profile = profileForIdn(idn, profiles);
      if (!profile) return null;
      return {
        kind: "scope",
        channels: 4,
        maxSampleRateHz: 2_000_000_000,
        features: [
          "capture:block",
          "trigger:edge",
          `dialect:${profile.vendor}`,
        ],
      };
    },
    async open(transport, claim, signal) {
      deps.verifyClaim(claim, claim.deviceId);
      signal.throwIfAborted();
      const resolved = resolveInstrumentTransport(transport);
      if (resolved.kind === "usb")
        throw new TransportError(
          "TRANSPORT_NOT_IMPLEMENTED",
          "SCPI scope v1 requires LAN.",
        );
      const resource = scpiResource(resolved.host, resolved.port);
      const registeredResource =
        deps.resourceForDeviceId?.(claim.deviceId)?.trim() || null;
      if (registeredResource === null || registeredResource !== resource) {
        throw new InstrumentError(
          "INSTRUMENT_NOT_FOUND",
          "SCPI claim is not bound by the registry to this PyVISA resource.",
        );
      }
      let profile: ScpiProfile | null;
      {
        const result = await runner(
          {
            command: "python3",
            args: [
              "-c",
              PYVISA_BRIDGE,
              "identify",
              JSON.stringify({ resource }),
            ],
            timeoutMs: 5_000,
            maxOutputBytes: MAX_BRIDGE_OUTPUT_BYTES,
            env: deps.bridgeEnv,
          },
          signal,
        );
        if (result.code !== 0) bridgeFailure(result, "identification");
        const idn = responseObject(result.stdout).idn;
        profile = typeof idn === "string" ? profileForIdn(idn, profiles) : null;
        if (!profile)
          throw new InstrumentError(
            "INSTRUMENT_NOT_FOUND",
            "SCPI scope dialect is unsupported.",
          );
      }
      const capabilities: InstrumentCapabilities = {
        kind: "scope",
        channels: 4,
        maxSampleRateHz: 2_000_000_000,
        features: [
          "capture:block",
          "trigger:edge",
          `dialect:${profile.vendor}`,
        ],
      };
      let closed = false;
      let released = false;
      const release = () => {
        closed = true;
        if (!released) {
          released = true;
          deps.releaseClaim?.(claim);
        }
      };
      signal.addEventListener("abort", release, { once: true });
      return {
        deviceId: claim.deviceId,
        capabilities,
        async capture(config, captureSignal) {
          if (closed)
            throw new InstrumentError(
              "SESSION_CLOSED",
              "SCPI scope session is closed.",
            );
          validateCaptureConfig(config, capabilities, MAX_CAPTURE_MS);
          deps.verifyClaim(claim, claim.deviceId);
          const armed = captureConfiguration(config, profile);
          captureSignal.throwIfAborted();
          await mkdir(config.artifactSink.directory, { recursive: true });
          let completed = false;
          let preserveAfterTriggerTimeout = false;
          try {
            const result = await runner(
              {
                command: "python3",
                args: [
                  "-c",
                  PYVISA_BRIDGE,
                  "capture",
                  JSON.stringify({
                    resource,
                    outputDirectory: config.artifactSink.directory,
                    durationMs: config.durationMs,
                    sampleRateHz: config.sampleRateHz,
                    ...armed,
                    armCommand: requiredCommand(profile, "arm"),
                    stopCommand: requiredCommand(profile, "stop"),
                    triggerStatusCommand: requiredCommand(
                      profile,
                      "triggerStatus",
                    ),
                    sampleRateQuery: requiredCommand(
                      profile,
                      "sampleRateQuery",
                    ),
                    maxRawBytes: MAX_RAW_WAVEFORM_BYTES,
                  }),
                ],
                timeoutMs: armed.triggerTimeoutMs + 15_000,
                maxOutputBytes: MAX_BRIDGE_OUTPUT_BYTES,
                env: deps.bridgeEnv,
              },
              captureSignal,
            );
            if (result.code === 42 && armed.trigger !== null) {
              const timeout = responseObject(result.stdout);
              const sampleRateHz =
                typeof timeout.sampleRateHz === "number"
                  ? timeout.sampleRateHz
                  : config.sampleRateHz;
              const samples =
                typeof timeout.samples === "number"
                  ? timeout.samples
                  : armed.samples;
              throw new ScopeTriggerTimeoutError(
                "The armed SCPI edge did not occur before the deadline.",
                {
                  channelConfigs: armed.channelConfigs,
                  trigger: armed.trigger,
                  sampleRateHz,
                  samples,
                },
              );
            }
            if (result.code === 42) {
              throw new InstrumentError(
                "INSTRUMENT_PROTOCOL_ERROR",
                "SCPI bridge reported NO_TRIGGER without an armed trigger.",
              );
            }
            if (result.code !== 0) bridgeFailure(result, "capture");
            const artifact = await artifactFromResponse(
              responseObject(result.stdout),
              config.artifactSink.directory,
              profile,
            );
            await config.artifactSink.record(artifact);
            completed = true;
            return artifact;
          } catch (error) {
            preserveAfterTriggerTimeout =
              error instanceof ScopeTriggerTimeoutError;
            throw error;
          } finally {
            if (
              captureSignal.aborted ||
              (!completed && !preserveAfterTriggerTimeout)
            )
              release();
          }
        },
        async close() {
          signal.removeEventListener("abort", release);
          release();
        },
      };
    },
    prerequisites,
  };
}
