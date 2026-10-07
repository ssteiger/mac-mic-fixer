/**
 * @format
 */

import ReactTestRenderer from "react-test-renderer";
import App from "../App";

jest.mock("../src/native/MicDiagnostics", () => ({
  MicDiagnostics: {
    getInputDevices: jest.fn(async () => []),
    getDeviceState: jest.fn(async () => ({
      device: null,
      volume: null,
      format: null,
    })),
    getInputProcesses: jest.fn(async () => []),
    getPermissions: jest.fn(async () => ({
      self: "authorized",
      fullDiskAccess: false,
      apps: [],
      error: null,
    })),
    isPopoverVisible: jest.fn(async () => false),
    setStatusIcon: jest.fn(),
    startLevelMeter: jest.fn(async () => {}),
    stopLevelMeter: jest.fn(async () => {}),
  },
  addMicListener: () => ({ remove: () => {} }),
  SettingsURLs: {},
  errorMessage: (error: unknown) => String(error),
  errorCode: () => undefined,
}));

test("renders correctly", async () => {
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<App />);
  });
});
