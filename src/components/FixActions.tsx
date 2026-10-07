import { StyleSheet, View } from "react-native";
import { colors } from "../theme";
import { Button } from "./Button";
import { MonoText } from "./MonoText";

export interface FixAction {
  id: string;
  title: string;
  description: string;
  button: string;
  onPress: () => void;
}

export function FixActions({
  actions,
  busy,
}: {
  actions: FixAction[];
  busy: string | null;
}) {
  return (
    <View style={styles.list}>
      {actions.map((action) => (
        <View key={action.id} style={styles.row}>
          <View style={styles.text}>
            <MonoText style={styles.title}>{action.title}</MonoText>
            <MonoText style={styles.description}>{action.description}</MonoText>
          </View>
          <Button
            title={action.button}
            busy={busy === action.id}
            disabled={busy !== null && busy !== action.id}
            onPress={action.onPress}
            style={styles.button}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  text: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 11,
    fontWeight: "600",
  },
  description: {
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
  },
  button: {
    minWidth: 76,
  },
});
