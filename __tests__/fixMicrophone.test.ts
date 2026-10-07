import { fixMicrophone } from "../src/fixMicrophone";
import {
  type FormatInfo,
  type InputDevice,
  MicDiagnostics,
} from "../src/native/MicDiagnostics";

jest.mock("../src/native/MicDiagnostics", () => ({
  MicDiagnostics: {
    restartCoreAudio: jest.fn(),
    getInputDevices: jest.fn(),
    setDefaultInput: jest.fn(async () => {}),
    getDeviceState: jest.fn(),
    setSampleRate: jest.fn(async () => {}),
    resetInputVolume: jest.fn(),
  },
}));

const mic = jest.mocked(MicDiagnostics);

const builtIn: InputDevice = {
  id: 1,
  uid: "BuiltInMicrophoneDevice",
  name: "MacBook Pro Microphone",
  manufacturer: "Apple Inc.",
  transport: "builtIn",
  channels: 1,
  isDefault: false,
  isAlive: true,
  isRunningSomewhere: false,
};

const zoomDevice: InputDevice = {
  ...builtIn,
  id: 2,
  uid: "zoom",
  name: "ZoomAudioDevice",
  transport: "virtual",
  isDefault: true,
};

const format: FormatInfo = {
  sampleRate: 48000,
  availableSampleRates: [44100, 48000, 96000],
  channels: 1,
  bitDepth: 24,
  isFloat: false,
  outputDeviceName: "MacBook Pro Speakers",
  outputSampleRate: 48000,
};

beforeEach(() => {
  jest.clearAllMocks();
  mic.restartCoreAudio.mockResolvedValue([]);
  mic.getInputDevices.mockResolvedValue([zoomDevice, builtIn]);
  mic.getDeviceState.mockResolvedValue({
    device: builtIn,
    volume: null,
    format,
  });
  mic.resetInputVolume.mockResolvedValue({ unmuted: true, volumeSet: true });
});

test("disables conflicting drivers, restarts audio and selects the built-in mic", async () => {
  mic.restartCoreAudio.mockResolvedValue(["Background Music Device.driver"]);

  const result = await fixMicrophone();

  expect(mic.restartCoreAudio).toHaveBeenCalledWith(true);
  expect(mic.setDefaultInput).toHaveBeenCalledWith(builtIn.id);
  expect(mic.setSampleRate).not.toHaveBeenCalled();
  expect(mic.resetInputVolume).toHaveBeenCalled();
  expect(result).toBe(
    "Disabled Background Music Device.driver, restarted the audio service, selected MacBook Pro Microphone and unmuted it at 75% volume. Speak to check the meter.",
  );
});

test("does not re-select a built-in mic that is already the default", async () => {
  mic.getInputDevices.mockResolvedValue([{ ...builtIn, isDefault: true }]);

  await fixMicrophone();

  expect(mic.setDefaultInput).not.toHaveBeenCalled();
});

test("resets an unusual sample rate to 48 kHz", async () => {
  mic.getDeviceState.mockResolvedValue({
    device: builtIn,
    volume: null,
    format: { ...format, sampleRate: 96000 },
  });

  await fixMicrophone();

  expect(mic.setSampleRate).toHaveBeenCalledWith(48000);
});

test("stops when the password prompt is cancelled", async () => {
  mic.restartCoreAudio.mockRejectedValue(new Error("Restart cancelled."));

  await expect(fixMicrophone()).rejects.toThrow("Restart cancelled.");
  expect(mic.setDefaultInput).not.toHaveBeenCalled();
});
