import { Image, StyleSheet, View } from "react-native";
import { colors } from "../theme";
import { MonoText } from "./MonoText";

export function AppIcon({ uri, name }: { uri: string | null; name: string }) {
  if (uri) {
    return <Image source={{ uri }} style={styles.icon} />;
  }
  return (
    <View style={[styles.icon, styles.placeholder]}>
      <MonoText style={styles.letter}>{name.charAt(0).toUpperCase()}</MonoText>
    </View>
  );
}

const styles = StyleSheet.create({
  icon: {
    width: 16,
    height: 16,
  },
  placeholder: {
    borderRadius: 3,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  letter: {
    fontSize: 9,
    fontWeight: "600",
    color: colors.textMuted,
  },
});
