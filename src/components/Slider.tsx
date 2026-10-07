import { useRef, useState } from "react";
import {
  type DimensionValue,
  type GestureResponderEvent,
  StyleSheet,
  View,
} from "react-native";
import { colors } from "../theme";
import { MonoText } from "./MonoText";

interface Props {
  /** 0...1 */
  value: number;
  onChange: (value: number) => void;
  label: string;
  valueText: string;
  disabled?: boolean;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const percent = (value: number): DimensionValue => `${value * 100}%`;

/** A full-width bar that fills up to the value; drag anywhere on it to change the value. */
export function Slider({ value, onChange, label, valueText, disabled }: Props) {
  const width = useRef(1);
  const dragStart = useRef({ pageX: 0, value: 0 });
  const [dragValue, setDragValue] = useState<number | null>(null);
  const shown = clamp(dragValue ?? value);

  const update = (next: number) => {
    const clamped = clamp(next);
    setDragValue(clamped);
    onChange(clamped);
  };

  const onGrant = (event: GestureResponderEvent) => {
    const start = event.nativeEvent.locationX / width.current;
    dragStart.current = { pageX: event.nativeEvent.pageX, value: start };
    update(start);
  };

  const onMove = (event: GestureResponderEvent) => {
    const delta =
      (event.nativeEvent.pageX - dragStart.current.pageX) / width.current;
    update(dragStart.current.value + delta);
  };

  return (
    <View
      style={[styles.bar, disabled && styles.disabled]}
      onLayout={(event) => {
        width.current = Math.max(1, event.nativeEvent.layout.width);
      }}
      onStartShouldSetResponder={() => !disabled}
      onMoveShouldSetResponder={() => !disabled}
      onResponderTerminationRequest={() => false}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={() => setDragValue(null)}
      onResponderTerminate={() => setDragValue(null)}
    >
      <View
        pointerEvents="none"
        style={[styles.fill, { width: percent(shown) }]}
      />
      <View pointerEvents="none" style={styles.labels}>
        <MonoText style={styles.label} numberOfLines={1}>
          {label}
        </MonoText>
        <MonoText style={styles.value}>{valueText}</MonoText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 26,
    borderRadius: 2,
    backgroundColor: colors.surface,
    overflow: "hidden",
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.5,
  },
  fill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.surfaceRaised,
  },
  labels: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    gap: 8,
  },
  label: {
    flexShrink: 1,
    fontSize: 11,
  },
  value: {
    fontSize: 11,
    color: colors.textMuted,
  },
});
