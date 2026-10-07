import { useCallback, useEffect, useState } from "react";
import {
  addMicListener,
  type DeviceState,
  errorMessage,
  type InputDevice,
  type InputProcess,
  MicDiagnostics,
  type Permissions,
} from "../native/MicDiagnostics";

const PROCESS_POLL_INTERVAL_MS = 1500;

export function useMicState() {
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [deviceState, setDeviceState] = useState<DeviceState | null>(null);
  const [processes, setProcesses] = useState<InputProcess[]>([]);
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [visible, setVisible] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      const [nextDevices, nextState] = await Promise.all([
        MicDiagnostics.getInputDevices(),
        MicDiagnostics.getDeviceState(),
      ]);
      setDevices(nextDevices);
      setDeviceState(nextState);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, []);

  const refreshProcesses = useCallback(async () => {
    try {
      setProcesses(await MicDiagnostics.getInputProcesses());
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, []);

  const refreshPermissions = useCallback(async () => {
    try {
      setPermissions(await MicDiagnostics.getPermissions());
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      refreshDevices(),
      refreshProcesses(),
      refreshPermissions(),
    ]);
  }, [refreshDevices, refreshProcesses, refreshPermissions]);

  useEffect(() => {
    refreshAll();
    MicDiagnostics.isPopoverVisible().then(setVisible);
    const subscriptions = [
      addMicListener("onDevicesChanged", refreshDevices),
      addMicListener("onDeviceStateChanged", refreshDevices),
      addMicListener("onPopoverVisibility", (event) =>
        setVisible(event.visible),
      ),
    ];
    return () => {
      for (const subscription of subscriptions) {
        subscription.remove();
      }
    };
  }, [refreshAll, refreshDevices]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    refreshAll();
    const timer = setInterval(refreshProcesses, PROCESS_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [visible, refreshAll, refreshProcesses]);

  return {
    devices,
    deviceState,
    processes,
    permissions,
    visible,
    loadError,
    refreshAll,
    refreshDevices,
    refreshPermissions,
  };
}
