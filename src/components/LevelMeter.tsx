import { type DimensionValue, StyleSheet, View } from "react-native";
import type { SignalStatus } from "../hooks/useLevelMeter";
import type { LevelSample } from "../native/MicDiagnostics";
import { colors } from "../theme";
import { Button } from "./Button";
import { MonoText } from "./MonoText";
import { Hint } from "./Section";

const METER_RANGE_DB = 60;
const HOT_DB = -3;
const ACTIVE_CHANNEL_DB = -50;
const DEAD_CHANNEL_DB = -90;

const fraction = (db: number): DimensionValue =>
  `${Math.min(1, Math.max(0, (db + METER_RANGE_DB) / METER_RANGE_DB)) * 100}%`;

interface Props {
  level: LevelSample | null;
  signal: SignalStatus;
  error: { code?: string; message: string } | null;
  paused: boolean;
  onTogglePaused: () => void;
  onOpenPrivacy: () => void;
}

export function LevelMeter({
  level,
  signal,
  error,
  paused,
  onTogglePaused,
  onOpenPrivacy,
}: Props) {
  const channels = level?.channels ?? [];
  const lonelyChannel = singleActiveChannel(channels);

  return (
    <View style={styles.container}>
      <LevelRow label="Input · RMS" db={level?.rms ?? -120} />
      <LevelRow label="Input · Peak" db={level?.peak ?? -120} />
      {channels.length > 1 &&
        channels.map((channelPeak, index) => (
          <LevelRow
            // biome-ignore lint/suspicious/noArrayIndexKey: channels are identified by their position
            key={index}
            label={`Ch ${index + 1} · Peak`}
            db={channelPeak}
          />
        ))}

      <View style={styles.statusRow}>
        <MonoText
          style={[
            styles.status,
            (signal === "digitalSilence" || signal === "error") && styles.bad,
            signal === "quiet" && styles.warn,
          ]}
        >
          {statusText(signal, paused, error)}
        </MonoText>
        <Button
          title={paused ? "Resume" : "Pause"}
          kind="plain"
          onPress={onTogglePaused}
        />
      </View>

      {error?.code === "permission_denied" && (
        <View style={styles.actions}>
          <Button title="Open Microphone settings" onPress={onOpenPrivacy} />
        </View>
      )}

      {lonelyChannel !== null && (
        <MonoText style={styles.warn}>
          Only channel {lonelyChannel + 1} picks up sound. Apps that record
          channel 1 will hear nothing. Check the input channel in your audio
          interface or app settings.
        </MonoText>
      )}

      <Hint>
        While the meter runs, macOS shows the orange microphone indicator and
        Bluetooth headsets switch to call mode.
      </Hint>
    </View>
  );
}

function LevelRow({ label, db }: { label: string; db: number }) {
  const hot = db > HOT_DB;
  return (
    <View style={styles.row}>
      <MonoText style={styles.label} numberOfLines={1}>
        {label}
      </MonoText>
      <View style={styles.track}>
        <View
          style={[styles.fill, { width: fraction(db) }, hot && styles.fillHot]}
        />
      </View>
      <MonoText style={[styles.value, hot && styles.bad]}>
        {db <= -METER_RANGE_DB ? "-∞ dB" : `${Math.round(db)} dB`}
      </MonoText>
    </View>
  );
}

function singleActiveChannel(channels: number[]): number | null {
  if (channels.length < 2 || channels[0] > DEAD_CHANNEL_DB) {
    return null;
  }
  const active = channels
    .map((peak, index) => ({ peak, index }))
    .filter((channel) => channel.peak > ACTIVE_CHANNEL_DB);
  return active.length > 0 ? active[0].index : null;
}

function statusText(
  signal: SignalStatus,
  paused: boolean,
  error: { message: string } | null,
): string {
  switch (signal) {
    case "off":
      return paused ? "Paused." : "Starts when the popover opens.";
    case "starting":
      return "Opening the microphone...";
    case "quiet":
      return "Very quiet for a few seconds. Say something!";
    case "digitalSilence":
      return "Pure digital silence: the device sends exact zeros.";
    case "error":
      return error?.message ?? "The level meter stopped.";
    case "ok":
      return "Picking up sound.";
  }
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  label: {
    width: 104,
    fontSize: 10,
    color: colors.text,
  },
  track: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.barTrack,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: colors.barFill,
  },
  fillHot: {
    backgroundColor: colors.red,
  },
  value: {
    width: 52,
    fontSize: 10,
    textAlign: "right",
    color: colors.textMuted,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  status: {
    flexShrink: 1,
    fontSize: 10,
    color: colors.textMuted,
  },
  bad: {
    color: colors.red,
  },
  warn: {
    fontSize: 10,
    lineHeight: 14,
    color: colors.orange,
  },
  actions: {
    flexDirection: "row",
  },
});
