import { StyleSheet, View } from "react-native";
import type { InputProcess } from "../native/MicDiagnostics";
import { colors } from "../theme";
import { AppIcon } from "./AppIcon";
import { MonoText } from "./MonoText";
import { Hint } from "./Section";

export function InUseList({ processes }: { processes: InputProcess[] }) {
  const others = processes.filter((process) => !process.isSelf);
  const meterRunning = processes.some((process) => process.isSelf);

  if (others.length === 0) {
    return (
      <Hint>
        No other app is recording right now
        {meterRunning ? " (only the level meter above)." : "."} If an app can't
        hear you, check that it's using the right device.
      </Hint>
    );
  }

  return (
    <View style={styles.list}>
      {others.map((process) => (
        <View key={process.pid} style={styles.row}>
          <AppIcon uri={process.icon} name={process.name} />
          <MonoText style={styles.name} numberOfLines={1}>
            {process.name}
          </MonoText>
          <MonoText style={styles.details} numberOfLines={1}>
            {process.devices.length > 0
              ? process.devices.join(", ")
              : "recording"}
          </MonoText>
          <View style={styles.liveDot} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  name: {
    flexShrink: 0,
    maxWidth: "45%",
    fontSize: 11,
  },
  details: {
    flex: 1,
    fontSize: 10,
    textAlign: "right",
    color: colors.textMuted,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.orange,
  },
});
