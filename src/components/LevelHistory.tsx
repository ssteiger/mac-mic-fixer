import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { HISTORY_BUCKET_MS, HISTORY_LENGTH } from "../hooks/useLevelMeter";
import { colors, heatColors } from "../theme";
import { MonoText } from "./MonoText";

const ROWS = 7;
const COLUMNS = HISTORY_LENGTH / ROWS;
const SOUND_DB = -50;
const CLIP_DB = -1;

function cellColor(peak: number | null): string {
  if (peak === null || peak <= -70) {
    return heatColors[0];
  }
  if (peak > CLIP_DB) {
    return colors.red;
  }
  if (peak <= SOUND_DB) {
    return heatColors[1];
  }
  if (peak <= -30) {
    return heatColors[2];
  }
  if (peak <= -15) {
    return heatColors[3];
  }
  return heatColors[4];
}

const seconds = (buckets: number) =>
  `${((buckets * HISTORY_BUCKET_MS) / 1000).toFixed(1)}s`;

/** GitHub-style grid of recent peak levels: one column per ~second, newest bottom right. */
export const LevelHistory = memo(function LevelHistory({
  history,
}: {
  history: number[];
}) {
  const padded: (number | null)[] = [
    ...Array<null>(HISTORY_LENGTH - history.length).fill(null),
    ...history,
  ];
  const columns = Array.from({ length: COLUMNS }, (_, column) =>
    padded.slice(column * ROWS, (column + 1) * ROWS),
  );

  let longestQuiet = 0;
  let quietRun = 0;
  for (const peak of history) {
    quietRun = peak <= SOUND_DB ? quietRun + 1 : 0;
    longestQuiet = Math.max(longestQuiet, quietRun);
  }
  const loudest = history.length > 0 ? Math.max(...history) : null;
  const clipped = history.filter((peak) => peak > CLIP_DB).length;
  const span = (HISTORY_LENGTH * HISTORY_BUCKET_MS) / 1000;

  return (
    <View style={styles.container}>
      <View style={styles.axis}>
        {[span, (span * 2) / 3, span / 3].map((s) => (
          <MonoText key={s} style={styles.axisLabel}>
            {`-${Math.round(s)}s`}
          </MonoText>
        ))}
        <MonoText style={styles.axisLabel}>now</MonoText>
      </View>
      <View style={styles.grid}>
        {columns.map((cells, column) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: columns are fixed time slots
          <View key={column} style={styles.column}>
            {cells.map((peak, row) => (
              <View
                // biome-ignore lint/suspicious/noArrayIndexKey: cells are fixed time slots
                key={row}
                style={[styles.cell, { backgroundColor: cellColor(peak) }]}
              />
            ))}
          </View>
        ))}
      </View>
      <MonoText style={styles.footer}>
        {history.length === 0
          ? "Waiting for audio..."
          : [
              `Loudest ${loudest !== null ? Math.round(loudest) : "-"} dBFS`,
              `longest quiet ${seconds(longestQuiet)}`,
              clipped > 0 ? `${clipped} clipped` : "no clipping",
            ].join(" · ")}
      </MonoText>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  axis: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  axisLabel: {
    fontSize: 9,
    color: colors.textMuted,
  },
  grid: {
    flexDirection: "row",
    gap: 2,
  },
  column: {
    flex: 1,
    gap: 2,
  },
  cell: {
    aspectRatio: 1,
    borderRadius: 1,
  },
  footer: {
    fontSize: 10,
    color: colors.textMuted,
  },
});
