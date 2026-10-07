import type { SignalStatus } from "./hooks/useLevelMeter";
import type {
  DeviceState,
  InputDevice,
  Permissions,
  StatusIconKind,
} from "./native/MicDiagnostics";
import { formatRate } from "./theme";

export type Severity = "ok" | "warning" | "error";

export type FixId =
  | "unmute"
  | "resetVolume"
  | "matchSampleRate"
  | "useBuiltIn"
  | "openMicPrivacy"
  | "reselect"
  | "restartCoreAudio";

export interface Issue {
  id: string;
  severity: Exclude<Severity, "ok">;
  title: string;
  detail: string;
  fix?: FixId;
}

export interface Health {
  severity: Severity;
  issues: Issue[];
  icon: StatusIconKind;
  summary: string;
}

interface HealthInput {
  devices: InputDevice[];
  state: DeviceState | null;
  permissions: Permissions | null;
  signal: SignalStatus;
}

export function computeHealth({
  devices,
  state,
  permissions,
  signal,
}: HealthInput): Health {
  const issues: Issue[] = [];
  const device = state?.device ?? null;
  const volume = state?.volume ?? null;
  const format = state?.format ?? null;
  const builtIn = devices.find(
    (d) => d.transport === "builtIn" && d.isAlive && !d.isDefault,
  );

  if (state && !device) {
    issues.push({
      id: "no-device",
      severity: "error",
      title: "No input device",
      detail:
        devices.length === 0
          ? "macOS sees no microphone at all. Reconnect it, or restart the audio service."
          : "No default input is selected. Pick a device below.",
      fix: devices.length === 0 ? "restartCoreAudio" : undefined,
    });
  }

  if (device && !device.isAlive) {
    issues.push({
      id: "not-alive",
      severity: "error",
      title: `${device.name} stopped responding`,
      detail: "The device is still listed but no longer delivers audio.",
      fix: "reselect",
    });
  }

  if (volume?.muted) {
    issues.push({
      id: "muted",
      severity: "error",
      title: "Input is muted",
      detail: `${device?.name ?? "The input device"} is muted in macOS.`,
      fix: "unmute",
    });
  }

  if (volume?.volume != null && volume.volume < 0.05) {
    issues.push({
      id: "volume-zero",
      severity: "error",
      title: `Input volume is at ${Math.round(volume.volume * 100)}%`,
      detail: "Apps receive (almost) no sound at this level.",
      fix: "resetVolume",
    });
  }

  if (signal === "digitalSilence") {
    issues.push({
      id: "digital-silence",
      severity: "error",
      title: "The mic delivers pure silence",
      detail:
        "The device sends exact zeros. That usually means a hardware mute switch, a privacy block or a stuck driver.",
      fix: "restartCoreAudio",
    });
  } else if (signal === "quiet") {
    issues.push({
      id: "quiet",
      severity: "warning",
      title: "No sound detected",
      detail:
        "Say something. If the meter stays flat, check the cable or try another input.",
      fix: "reselect",
    });
  }

  if (permissions?.self === "denied" || permissions?.self === "restricted") {
    issues.push({
      id: "self-permission",
      severity: "warning",
      title: "Mac Mic Fixer can't hear the mic",
      detail:
        "Allow it under Privacy & Security > Microphone to use the level meter.",
      fix: "openMicPrivacy",
    });
  }

  if (
    device &&
    format &&
    (device.transport === "bluetooth" || device.transport === "bluetoothLE") &&
    format.sampleRate > 0 &&
    format.sampleRate <= 24000
  ) {
    issues.push({
      id: "bluetooth-call-mode",
      severity: "warning",
      title: "Bluetooth headset is in call mode",
      detail: `Recording from ${device.name} drops audio to ${formatRate(
        format.sampleRate,
      )} call quality. The built-in mic sounds much better.`,
      fix: builtIn ? "useBuiltIn" : undefined,
    });
  } else if (
    format?.outputSampleRate &&
    format.sampleRate > 0 &&
    format.sampleRate !== format.outputSampleRate
  ) {
    const canMatch = format.availableSampleRates.includes(
      format.outputSampleRate,
    );
    issues.push({
      id: "rate-mismatch",
      severity: "warning",
      title: "Input and output sample rates differ",
      detail: `Input runs at ${formatRate(format.sampleRate)}, output (${
        format.outputDeviceName ?? "speakers"
      }) at ${formatRate(
        format.outputSampleRate,
      )}. Some apps crackle or go silent with mismatched rates.`,
      fix: canMatch ? "matchSampleRate" : undefined,
    });
  }

  if (
    device &&
    (device.transport === "aggregate" || device.transport === "virtual")
  ) {
    issues.push({
      id: "virtual-device",
      severity: "warning",
      title: "Default input is a virtual device",
      detail: `"${device.name}" only carries sound while the app behind it (Zoom, Teams, Loopback, ...) is running.`,
      fix: builtIn ? "useBuiltIn" : undefined,
    });
  }

  const severity: Severity = issues.some((i) => i.severity === "error")
    ? "error"
    : issues.length > 0
      ? "warning"
      : "ok";

  let icon: StatusIconKind = severity;
  if (volume?.muted) {
    icon = "muted";
  }

  const summary =
    issues.length > 0
      ? issues[0].title
      : device
        ? `Microphone OK: ${device.name}`
        : "Checking microphone...";

  return { severity, issues, icon, summary };
}
