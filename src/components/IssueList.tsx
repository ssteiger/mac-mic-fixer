import { StyleSheet, View } from "react-native";
import type { FixId, Issue } from "../health";
import { colors, severityColor } from "../theme";
import { Button } from "./Button";
import { MonoText } from "./MonoText";

export const FIX_LABELS: Record<FixId, string> = {
  unmute: "Unmute",
  resetVolume: "Reset volume",
  matchSampleRate: "Match rates",
  useBuiltIn: "Use built-in",
  openMicPrivacy: "Settings",
  reselect: "Re-select",
  restartCoreAudio: "Restart audio",
};

interface Props {
  issues: Issue[];
  busy: string | null;
  onFix: (fix: FixId) => void;
}

export function IssueList({ issues, busy, onFix }: Props) {
  return (
    <View style={styles.list}>
      {issues.map(({ fix, ...issue }) => (
        <View
          key={issue.id}
          style={[
            styles.issue,
            { borderLeftColor: severityColor[issue.severity] },
          ]}
        >
          <View style={styles.text}>
            <MonoText
              style={[styles.title, { color: severityColor[issue.severity] }]}
            >
              {issue.title}
            </MonoText>
            <MonoText style={styles.detail}>{issue.detail}</MonoText>
          </View>
          {fix && (
            <Button
              title={FIX_LABELS[fix]}
              kind="primary"
              busy={busy === fix}
              disabled={busy !== null && busy !== fix}
              onPress={() => onFix(fix)}
            />
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 6,
  },
  issue: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 3,
    borderWidth: 1,
    borderLeftWidth: 3,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  text: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 11,
    fontWeight: "600",
  },
  detail: {
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
  },
});
