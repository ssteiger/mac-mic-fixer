import { StyleSheet, View } from "react-native";
import type { Health } from "../health";
import type { SignalStatus } from "../hooks/useLevelMeter";
import type { InputDevice } from "../native/MicDiagnostics";
import { colors, severityColor } from "../theme";
import { Button } from "./Button";
import { MonoText } from "./MonoText";

interface Props {
  health: Health;
  device: InputDevice | null;
  deviceCount: number;
  signal: SignalStatus;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenSoundSettings: () => void;
  onQuit: () => void;
}

export function StatusHeader({
  health,
  device,
  deviceCount,
  signal,
  refreshing,
  onRefresh,
  onOpenSoundSettings,
  onQuit,
}: Props) {
  const count = health.issues.length;
  const status =
    count > 0
      ? `${count} problem${count === 1 ? "" : "s"}`
      : signal === "ok"
        ? "mic working"
        : "no problems";
  const subtitle = [
    `${deviceCount} input${deviceCount === 1 ? "" : "s"}`,
    device ? status : "no input selected",
  ].join(" · ");

  return (
    <View style={styles.container}>
      <MicGlyph color={severityColor[health.severity]} />
      <View style={styles.titleText}>
        <MonoText style={styles.title}>Mac Mic Fixer</MonoText>
        <MonoText style={styles.subtitle} numberOfLines={1}>
          {subtitle.toUpperCase()}
        </MonoText>
      </View>
      <View style={styles.actions}>
        <Button
          title="↻"
          busy={refreshing}
          onPress={onRefresh}
          style={styles.square}
        />
        <Button
          title="Sound"
          onPress={onOpenSoundSettings}
          style={styles.squareWide}
        />
        <Button title="Quit" onPress={onQuit} style={styles.squareWide} />
      </View>
    </View>
  );
}

function MicGlyph({ color }: { color: string }) {
  return (
    <View style={styles.glyph}>
      <View style={[styles.glyphCapsule, { backgroundColor: color }]} />
      <View style={[styles.glyphStem, { backgroundColor: color }]} />
      <View style={[styles.glyphBase, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingBottom: 14,
  },
  glyph: {
    width: 26,
    height: 26,
    borderRadius: 4,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  glyphCapsule: {
    width: 8,
    height: 11,
    borderRadius: 4,
  },
  glyphStem: {
    width: 2,
    height: 3,
  },
  glyphBase: {
    width: 8,
    height: 2,
    borderRadius: 1,
  },
  titleText: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 9,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  actions: {
    flexDirection: "row",
    gap: 4,
  },
  square: {
    width: 28,
    height: 28,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  squareWide: {
    height: 28,
    paddingHorizontal: 8,
    paddingVertical: 0,
  },
});
