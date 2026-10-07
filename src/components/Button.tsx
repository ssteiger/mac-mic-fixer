import { useState } from "react";
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from "react-native";
import { colors } from "../theme";
import { MonoText } from "./MonoText";

interface Props {
  title: string;
  onPress: () => void;
  /** "selected" is a chip that shows the current choice in a group. */
  kind?: "default" | "primary" | "selected" | "plain";
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  onPress,
  kind = "default",
  disabled,
  busy,
  style,
}: Props) {
  const [hovered, setHovered] = useState(false);
  const inactive = disabled || busy;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.button,
        kind === "primary" && styles.primary,
        kind === "selected" && styles.selected,
        kind === "plain" && styles.plain,
        hovered && !inactive && kind !== "primary" && styles.hovered,
        pressed && styles.pressed,
        inactive && kind !== "selected" && styles.inactive,
        style,
      ]}
    >
      <MonoText
        numberOfLines={1}
        style={[
          styles.title,
          kind === "primary" && styles.primaryTitle,
          kind === "plain" && styles.plainTitle,
        ]}
      >
        {busy ? "..." : title}
      </MonoText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: {
    backgroundColor: colors.barFill,
    borderColor: colors.barFill,
  },
  selected: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderStrong,
  },
  plain: {
    borderColor: "transparent",
    paddingHorizontal: 4,
  },
  hovered: {
    backgroundColor: colors.surface,
  },
  pressed: {
    opacity: 0.6,
  },
  inactive: {
    opacity: 0.45,
  },
  title: {
    fontSize: 11,
    color: colors.text,
  },
  primaryTitle: {
    color: colors.background,
    fontWeight: "600",
  },
  plainTitle: {
    color: colors.accent,
  },
});
