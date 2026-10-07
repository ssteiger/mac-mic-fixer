import { NativeEventEmitter, NativeModules } from "react-native";

export type Transport =
  | "builtIn"
  | "usb"
  | "bluetooth"
  | "bluetoothLE"
  | "aggregate"
  | "virtual"
  | "hdmi"
  | "displayPort"
  | "airPlay"
  | "thunderbolt"
  | "pci"
  | "fireWire"
  | "avb"
  | "continuity"
  | "unknown";

export interface InputDevice {
  id: number;
  uid: string;
  name: string;
  manufacturer: string;
  transport: Transport;
  channels: number;
  isDefault: boolean;
  isAlive: boolean;
  isRunningSomewhere: boolean;
}

export interface VolumeInfo {
  hasVolume: boolean;
  volumeSettable: boolean;
  /** 0...1 */
  volume: number | null;
  volumeDb: number | null;
  hasMute: boolean;
  muteSettable: boolean;
  muted: boolean | null;
}

export interface FormatInfo {
  sampleRate: number;
  availableSampleRates: number[];
  channels: number;
  bitDepth: number;
  isFloat: boolean;
  outputDeviceName: string | null;
  outputSampleRate: number | null;
}

export interface DeviceState {
  device: InputDevice | null;
  volume: VolumeInfo | null;
  format: FormatInfo | null;
}

export interface InputProcess {
  pid: number;
  bundleId: string | null;
  name: string;
  /** data: URI */
  icon: string | null;
  devices: string[];
  isSelf: boolean;
}

export type AuthorizationStatus =
  | "authorized"
  | "denied"
  | "restricted"
  | "notDetermined";

export interface AppPermission {
  /** Bundle identifier, or an absolute path when `isPath` is true. */
  client: string;
  isPath: boolean;
  name: string;
  icon: string | null;
  allowed: boolean;
  installed: boolean;
  /** Unix timestamp in seconds. */
  lastModified: number;
}

export interface Permissions {
  self: AuthorizationStatus;
  fullDiskAccess: boolean;
  apps: AppPermission[];
  error: string | null;
}

export interface LevelSample {
  /** dBFS, floored at -120 */
  rms: number;
  peak: number;
  /** True when every sample was exactly zero. */
  silent: boolean;
  /** Peak dBFS per channel. */
  channels: number[];
}

export type StatusIconKind = "ok" | "warning" | "muted" | "error";

interface MicDiagnosticsModule {
  getInputDevices(): Promise<InputDevice[]>;
  getDeviceState(): Promise<DeviceState>;
  setDefaultInput(deviceId: number): Promise<void>;
  setInputVolume(volume: number): Promise<VolumeInfo>;
  setInputMuted(muted: boolean): Promise<VolumeInfo>;
  setSampleRate(sampleRate: number): Promise<void>;
  getInputProcesses(): Promise<InputProcess[]>;
  getPermissions(): Promise<Permissions>;
  requestMicrophonePermission(): Promise<AuthorizationStatus>;
  resetAppPermission(bundleId: string): Promise<void>;
  startLevelMeter(): Promise<void>;
  stopLevelMeter(): Promise<void>;
  resetLevelMeter(): Promise<void>;
  /**
   * Asks for the admin password the first time (installing a helper), then
   * for Touch ID. Resolves with the file names of the drivers it disabled.
   */
  restartCoreAudio(disableConflictingDrivers: boolean): Promise<string[]>;
  reselectDefaultInput(): Promise<void>;
  resetInputVolume(): Promise<{ unmuted: boolean; volumeSet: boolean }>;
  openAudioMidiSetup(): Promise<void>;
  setStatusIcon(kind: StatusIconKind, toolTip: string): void;
  isPopoverVisible(): Promise<boolean>;
  closePopover(): void;
  quit(): void;
}

interface EventPayloads {
  onDevicesChanged: undefined;
  onDeviceStateChanged: undefined;
  onLevel: LevelSample;
  onLevelMeterError: { message: string };
  onPopoverVisibility: { visible: boolean };
}

export const MicDiagnostics: MicDiagnosticsModule =
  NativeModules.MicDiagnostics;

const emitter = new NativeEventEmitter(NativeModules.MicDiagnostics);

export function addMicListener<E extends keyof EventPayloads>(
  event: E,
  listener: (payload: EventPayloads[E]) => void,
) {
  return emitter.addListener(event, listener);
}

export const SettingsURLs = {
  microphonePrivacy:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  fullDiskAccess:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
  soundInput: "x-apple.systempreferences:com.apple.preference.sound?input",
};

export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return undefined;
}
