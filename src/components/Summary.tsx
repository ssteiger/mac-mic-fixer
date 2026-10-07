import { StyleSheet, View } from "react-native";
import type { Health } from "../health";
import type { DeviceState } from "../native/MicDiagnostics";
import { colors, formatRate, severityColor } from "../theme";
import { MonoText } from "./MonoText";
import { Hint } from "./Section";

interface Stat {
  label: string;
  value: string;
  color?: string;
}

export function Summary({
  state,
  health,
}: {
  state: DeviceState | null;
  health: Health;
}) {
  const format = state?.format ?? null;
  const volume = state?.volume ?? null;
  if (!state?.device || !format) {
    return <Hint>No input device selected.</Hint>;
  }

  const mismatch =
    format.outputSampleRate != null &&
    format.outputSampleRate !== format.sampleRate;
  const count = health.issues.length;

  const stats: Stat[] = [
    {
      label: "Status",
      value: count === 0 ? "OK" : `${count} issue${count === 1 ? "" : "s"}`,
      color: severityColor[health.severity],
    },
    {
      label: "Input rate",
      value: formatRate(format.sampleRate),
      color: mismatch ? colors.orange : undefined,
    },
    {
      label: "Output rate",
      value: formatRate(format.outputSampleRate),
      color: mismatch ? colors.orange : undefined,
    },
    {
      label: "Volume",
      value: volume?.muted
        ? "Muted"
        : volume?.volume != null
          ? `${Math.round(volume.volume * 100)}%`
          : "Fixed",
      color: volume?.muted ? colors.red : undefined,
    },
    { label: "Channels", value: String(format.channels) },
    {
      label: "Format",
      value: format.bitDepth
        ? `${format.bitDepth}-bit ${format.isFloat ? "fp" : "int"}`
        : "unknown",
    },
  ];

  return (
    <View style={styles.grid}>
      {stats.map((stat) => (
        <View key={stat.label} style={styles.cell}>
          <MonoText style={styles.label}>{stat.label}</MonoText>
          <MonoText
            style={[styles.value, stat.color ? { color: stat.color } : null]}
            numberOfLines={1}
          >
            {stat.value}
          </MonoText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 14,
  },
  cell: {
    width: "33.33%",
    gap: 4,
    paddingRight: 8,
  },
  label: {
    fontSize: 10,
    color: colors.textMuted,
  },
  value: {
    fontSize: 17,
    fontWeight: "600",
  },
});
