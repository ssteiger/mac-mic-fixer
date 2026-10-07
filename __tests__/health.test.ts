import { computeHealth } from "../src/health";
import type {
  DeviceState,
  FormatInfo,
  InputDevice,
  Permissions,
  VolumeInfo,
} from "../src/native/MicDiagnostics";

const builtIn: InputDevice = {
  id: 1,
  uid: "BuiltInMicrophoneDevice",
  name: "MacBook Pro Microphone",
  manufacturer: "Apple Inc.",
  transport: "builtIn",
  channels: 1,
  isDefault: true,
  isAlive: true,
  isRunningSomewhere: false,
};

const airPods: InputDevice = {
  ...builtIn,
  id: 2,
  uid: "airpods",
  name: "AirPods Pro",
  transport: "bluetooth",
};

const volume: VolumeInfo = {
  hasVolume: true,
  volumeSettable: true,
  volume: 0.7,
  volumeDb: -10,
  hasMute: true,
  muteSettable: true,
  muted: false,
};

const format: FormatInfo = {
  sampleRate: 48000,
  availableSampleRates: [44100, 48000],
  channels: 1,
  bitDepth: 24,
  isFloat: false,
  outputDeviceName: "MacBook Pro Speakers",
  outputSampleRate: 48000,
};

function stateFor(
  device: InputDevice,
  overrides: Partial<DeviceState> = {},
): DeviceState {
  return { device, volume, format, ...overrides };
}

const allowed: Permissions = {
  self: "authorized",
  fullDiskAccess: true,
  apps: [],
  error: null,
};

describe("computeHealth", () => {
  it("reports a healthy default setup", () => {
    const health = computeHealth({
      devices: [builtIn],
      state: stateFor(builtIn),
      permissions: allowed,
      signal: "ok",
    });
    expect(health.severity).toBe("ok");
    expect(health.icon).toBe("ok");
    expect(health.issues).toEqual([]);
  });

  it("flags a muted input with the muted icon and an unmute fix", () => {
    const state = stateFor(builtIn);
    state.volume = { ...volume, muted: true };
    const health = computeHealth({
      devices: [builtIn],
      state,
      permissions: allowed,
      signal: "ok",
    });
    expect(health.severity).toBe("error");
    expect(health.icon).toBe("muted");
    expect(health.issues[0]).toMatchObject({ id: "muted", fix: "unmute" });
  });

  it("flags a missing device and offers to restart the audio service", () => {
    const health = computeHealth({
      devices: [],
      state: { device: null, volume: null, format: null },
      permissions: allowed,
      signal: "off",
    });
    expect(health.icon).toBe("error");
    expect(health.issues[0]).toMatchObject({
      id: "no-device",
      fix: "restartCoreAudio",
    });
  });

  it("detects digital silence from the level meter", () => {
    const health = computeHealth({
      devices: [builtIn],
      state: stateFor(builtIn),
      permissions: allowed,
      signal: "digitalSilence",
    });
    expect(health.issues.map((issue) => issue.id)).toContain("digital-silence");
  });

  it("warns about mismatched sample rates when they can be matched", () => {
    const state = stateFor(builtIn);
    state.format = { ...format, sampleRate: 44100 };
    const health = computeHealth({
      devices: [builtIn],
      state,
      permissions: allowed,
      signal: "ok",
    });
    expect(health.severity).toBe("warning");
    expect(health.issues[0]).toMatchObject({
      id: "rate-mismatch",
      fix: "matchSampleRate",
    });
  });

  it("explains Bluetooth call mode and suggests the built-in mic", () => {
    const state = stateFor({ ...airPods, isDefault: true });
    state.format = { ...format, sampleRate: 16000 };
    const health = computeHealth({
      devices: [
        { ...builtIn, isDefault: false },
        { ...airPods, isDefault: true },
      ],
      state,
      permissions: allowed,
      signal: "ok",
    });
    expect(health.issues[0]).toMatchObject({
      id: "bluetooth-call-mode",
      fix: "useBuiltIn",
    });
  });
});
