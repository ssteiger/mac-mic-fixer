import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import { DevicePicker, transportLabel } from "./src/components/DevicePicker";
import { type FixAction, FixActions } from "./src/components/FixActions";
import { InUseList } from "./src/components/InUseList";
import { IssueList } from "./src/components/IssueList";
import { LevelHistory } from "./src/components/LevelHistory";
import { LevelMeter } from "./src/components/LevelMeter";
import { MonoText } from "./src/components/MonoText";
import { PermissionsList } from "./src/components/PermissionsList";
import { RatePicker } from "./src/components/RatePicker";
import { Section } from "./src/components/Section";
import { StatusHeader } from "./src/components/StatusHeader";
import { Summary } from "./src/components/Summary";
import { VolumeControl } from "./src/components/VolumeControl";
import { computeHealth, type FixId } from "./src/health";
import { useActionRunner } from "./src/hooks/useActionRunner";
import { useLevelMeter } from "./src/hooks/useLevelMeter";
import { useMicState } from "./src/hooks/useMicState";
import {
  type AppPermission,
  type InputDevice,
  MicDiagnostics,
  SettingsURLs,
} from "./src/native/MicDiagnostics";
import { colors, formatRate, severityColor } from "./src/theme";

function App(): React.JSX.Element {
  const mic = useMicState();
  const { refreshAll, refreshPermissions } = mic;
  const [meterPaused, setMeterPaused] = useState(false);
  const meter = useLevelMeter(mic.visible && !meterPaused);
  const { busy, message, run, dismiss } = useActionRunner();

  const device = mic.deviceState?.device ?? null;
  const format = mic.deviceState?.format ?? null;
  const builtIn = mic.devices.find(
    (d) => d.transport === "builtIn" && d.isAlive && !d.isDefault,
  );

  const health = useMemo(
    () =>
      computeHealth({
        devices: mic.devices,
        state: mic.deviceState,
        permissions: mic.permissions,
        signal: meter.signal,
      }),
    [mic.devices, mic.deviceState, mic.permissions, meter.signal],
  );

  useEffect(() => {
    MicDiagnostics.setStatusIcon(health.icon, health.summary);
  }, [health.icon, health.summary]);

  // Starting the meter may have triggered the macOS permission prompt.
  const meterSettled = meter.signal !== "off" && meter.signal !== "starting";
  useEffect(() => {
    if (meterSettled) {
      refreshPermissions();
    }
  }, [meterSettled, refreshPermissions]);

  const openURL = useCallback(async (url: string) => {
    await Linking.openURL(url);
  }, []);

  const resetVolume = useCallback(
    () =>
      run("resetVolume", async () => {
        const result = await MicDiagnostics.resetInputVolume();
        if (!result.unmuted && !result.volumeSet) {
          return "This device has no software volume or mute controls.";
        }
        return result.volumeSet
          ? "Unmuted and set the input volume to 75%."
          : "Unmuted the input.";
      }),
    [run],
  );

  const reselect = useCallback(
    () =>
      run("reselect", async () => {
        await MicDiagnostics.reselectDefaultInput();
        return "Switched to another input and back.";
      }),
    [run],
  );

  const restartAudio = useCallback(
    () =>
      run("restartCoreAudio", async () => {
        await MicDiagnostics.restartCoreAudio();
        await refreshAll();
        return "The audio service was restarted.";
      }),
    [run, refreshAll],
  );

  const runFix = useCallback(
    (fix: FixId) => {
      switch (fix) {
        case "unmute":
          return run(fix, async () => {
            await MicDiagnostics.setInputMuted(false);
            return "Microphone unmuted.";
          });
        case "resetVolume":
          return resetVolume();
        case "matchSampleRate":
          return run(fix, async () => {
            const rate = format?.outputSampleRate;
            if (!rate) {
              return;
            }
            await MicDiagnostics.setSampleRate(rate);
            return `Input switched to ${formatRate(rate)}.`;
          });
        case "useBuiltIn":
          return run(fix, async () => {
            if (!builtIn) {
              throw new Error("No built-in microphone found.");
            }
            await MicDiagnostics.setDefaultInput(builtIn.id);
            return `Switched to ${builtIn.name}.`;
          });
        case "openMicPrivacy":
          return run(fix, () => openURL(SettingsURLs.microphonePrivacy));
        case "reselect":
          return reselect();
        case "restartCoreAudio":
          return restartAudio();
      }
    },
    [run, resetVolume, reselect, restartAudio, openURL, format, builtIn],
  );

  const selectDevice = (target: InputDevice) =>
    run("selectDevice", () => MicDiagnostics.setDefaultInput(target.id));

  const resetPermission = (app: AppPermission) =>
    run(`reset:${app.client}`, async () => {
      await MicDiagnostics.resetAppPermission(app.client);
      await refreshPermissions();
      return `${app.name} will ask for microphone access again.`;
    });

  const fixActions: FixAction[] = [
    {
      id: "resetVolume",
      title: "Unmute and reset volume",
      description: "Unmutes the input and sets its volume to 75%.",
      button: "Reset",
      onPress: resetVolume,
    },
    {
      id: "reselect",
      title: "Re-select the input device",
      description:
        "Switches to another input and back. Often wakes up a device that stopped delivering sound.",
      button: "Re-select",
      onPress: reselect,
    },
    {
      id: "restartMeter",
      title: "Restart the level meter",
      description: "Reopens the microphone for the meter above.",
      button: "Restart",
      onPress: () =>
        run("restartMeter", async () => {
          await meter.restart();
          return "Level meter restarted.";
        }),
    },
    {
      id: "restartCoreAudio",
      title: "Restart the audio service",
      description:
        'Restarts coreaudiod, which fixes most "no input" problems. Asks for your password; sound in all apps drops for a few seconds.',
      button: "Restart",
      onPress: restartAudio,
    },
    {
      id: "audioMidiSetup",
      title: "Open Audio MIDI Setup",
      description: "Apple's tool for formats, channels and aggregate devices.",
      button: "Open",
      onPress: () =>
        run("audioMidiSetup", () => MicDiagnostics.openAudioMidiSetup()),
    },
  ];

  const levelPeak = meter.level
    ? `peak ${Math.round(meter.level.peak)} dBFS`
    : null;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <StatusHeader
          health={health}
          device={device}
          deviceCount={mic.devices.length}
          signal={meter.signal}
          refreshing={busy === "refresh"}
          onRefresh={() => run("refresh", refreshAll)}
          onOpenSoundSettings={() => openURL(SettingsURLs.soundInput)}
          onQuit={() => MicDiagnostics.quit()}
        />

        {message && (
          <MonoText
            onPress={dismiss}
            style={[
              styles.message,
              message.kind === "error" && styles.messageError,
            ]}
          >
            {message.text}
          </MonoText>
        )}
        {mic.loadError && (
          <MonoText style={[styles.message, styles.messageError]}>
            {mic.loadError}
          </MonoText>
        )}

        {health.issues.length > 0 && (
          <View style={styles.issues}>
            <IssueList issues={health.issues} busy={busy} onFix={runFix} />
          </View>
        )}

        <View style={styles.pickers}>
          <DevicePicker
            devices={mic.devices}
            disabled={busy !== null}
            onSelect={selectDevice}
          />
          <RatePicker
            format={format}
            disabled={busy !== null}
            onSelectRate={(rate) =>
              run("sampleRate", async () => {
                await MicDiagnostics.setSampleRate(rate);
                return `Input switched to ${formatRate(rate)}.`;
              })
            }
          />
        </View>

        <Section
          title="Summary"
          accessory={
            device
              ? `${transportLabel(device.transport).toLowerCase()} · ${
                  meter.signal === "ok" ? "live" : meter.signal
                }`
              : undefined
          }
        >
          <Summary state={mic.deviceState} health={health} />
        </Section>

        <Section
          title="Activity"
          accessory={
            <MonoText
              style={[
                styles.accessory,
                {
                  color:
                    severityColor[meter.signal === "ok" ? "ok" : "warning"],
                },
              ]}
            >
              {meterPaused ? "paused" : (levelPeak ?? "waiting")}
            </MonoText>
          }
        >
          <LevelHistory history={meter.history} />
        </Section>

        <Section title="Levels">
          <LevelMeter
            level={meter.level}
            signal={meter.signal}
            error={meter.error}
            paused={meterPaused}
            onTogglePaused={() => setMeterPaused((paused) => !paused)}
            onOpenPrivacy={() => openURL(SettingsURLs.microphonePrivacy)}
          />
        </Section>

        <Section title="Volume" accessory="drag to adjust">
          <VolumeControl
            volume={mic.deviceState?.volume ?? null}
            onSetVolume={MicDiagnostics.setInputVolume}
            onSetMuted={(muted) =>
              run("mute", async () => {
                await MicDiagnostics.setInputMuted(muted);
              })
            }
          />
        </Section>

        <Section
          title="Recording now"
          accessory={`${mic.processes.filter((p) => !p.isSelf).length} apps`}
        >
          <InUseList processes={mic.processes} />
        </Section>

        <Section title="Permissions">
          <PermissionsList
            permissions={mic.permissions}
            busy={busy}
            onRequestSelf={() =>
              run("requestPermission", async () => {
                await MicDiagnostics.requestMicrophonePermission();
                await refreshPermissions();
              })
            }
            onOpenMicPrivacy={() => openURL(SettingsURLs.microphonePrivacy)}
            onOpenFullDiskAccess={() => openURL(SettingsURLs.fullDiskAccess)}
            onReset={resetPermission}
          />
        </Section>

        <Section title="Fixes">
          <FixActions actions={fixActions} busy={busy} />
        </Section>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  message: {
    fontSize: 11,
    lineHeight: 15,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 3,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 10,
    overflow: "hidden",
  },
  messageError: {
    color: colors.red,
    borderColor: colors.red,
  },
  issues: {
    marginBottom: 12,
  },
  pickers: {
    gap: 6,
    paddingBottom: 14,
  },
  accessory: {
    fontSize: 10,
  },
});

export default App;
