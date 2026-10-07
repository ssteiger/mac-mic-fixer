import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "../theme";
import { MonoText } from "./MonoText";

interface Props {
  title: string;
  /** Shown right-aligned next to the title; strings render as muted captions. */
  accessory?: ReactNode;
  children: ReactNode;
}

export function Section({ title, accessory, children }: Props) {
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <MonoText style={styles.title}>{title.toUpperCase()}</MonoText>
        {typeof accessory === "string" ? (
          <MonoText style={styles.caption} numberOfLines={1}>
            {accessory}
          </MonoText>
        ) : (
          accessory
        )}
      </View>
      {children}
    </View>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <MonoText style={styles.hint}>{children}</MonoText>;
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 16,
  },
  title: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1,
    color: colors.textMuted,
  },
  caption: {
    flexShrink: 1,
    fontSize: 10,
    color: colors.textMuted,
  },
  hint: {
    fontSize: 10,
    lineHeight: 15,
    color: colors.textDim,
  },
});
