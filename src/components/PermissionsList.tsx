import { StyleSheet, View } from "react-native";
import type {
  AppPermission,
  AuthorizationStatus,
  Permissions,
} from "../native/MicDiagnostics";
import { colors } from "../theme";
import { AppIcon } from "./AppIcon";
import { Button } from "./Button";
import { MonoText } from "./MonoText";
import { Hint } from "./Section";

const SELF_STATUS: Record<AuthorizationStatus, string> = {
  authorized: "allowed",
  denied: "denied",
  restricted: "blocked by profile",
  notDetermined: "not asked yet",
};

interface Props {
  permissions: Permissions | null;
  busy: string | null;
  onRequestSelf: () => void;
  onOpenMicPrivacy: () => void;
  onOpenFullDiskAccess: () => void;
  onReset: (app: AppPermission) => void;
}

export function PermissionsList({
  permissions,
  busy,
  onRequestSelf,
  onOpenMicPrivacy,
  onOpenFullDiskAccess,
  onReset,
}: Props) {
  if (!permissions) {
    return <Hint>Loading...</Hint>;
  }

  const apps = [...permissions.apps].sort(
    (a, b) => Number(a.allowed) - Number(b.allowed),
  );

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <MonoText style={styles.name}>Mac Mic Fixer</MonoText>
        {permissions.self === "notDetermined" && (
          <Button title="Allow" kind="plain" onPress={onRequestSelf} />
        )}
        <Status ok={permissions.self === "authorized"}>
          {SELF_STATUS[permissions.self]}
        </Status>
      </View>

      {permissions.fullDiskAccess ? (
        apps.length > 0 ? (
          apps.map((app) => (
            <View key={app.client} style={styles.row}>
              <AppIcon uri={app.icon} name={app.name} />
              <MonoText style={styles.name} numberOfLines={1}>
                {app.name}
                {!app.installed && (
                  <MonoText style={styles.details}> · not installed</MonoText>
                )}
              </MonoText>
              {!app.isPath && (
                <Button
                  title="Reset"
                  kind="plain"
                  busy={busy === `reset:${app.client}`}
                  disabled={busy !== null}
                  onPress={() => onReset(app)}
                />
              )}
              <Status ok={app.allowed}>
                {app.allowed ? "allowed" : "denied"}
              </Status>
            </View>
          ))
        ) : (
          <Hint>No app has asked for the microphone yet.</Hint>
        )
      ) : (
        <Hint>
          To list which apps may use the microphone, Mac Mic Fixer needs Full
          Disk Access (it only reads the macOS privacy database). After granting
          it, quit and reopen Mac Mic Fixer.
        </Hint>
      )}

      {permissions.error && (
        <MonoText style={styles.error}>{permissions.error}</MonoText>
      )}

      {permissions.fullDiskAccess && (
        <Hint>
          "Reset" makes macOS ask that app for permission again the next time it
          uses the microphone.
        </Hint>
      )}

      <View style={styles.buttons}>
        <Button title="Microphone settings" onPress={onOpenMicPrivacy} />
        {!permissions.fullDiskAccess && (
          <Button
            title="Grant Full Disk Access"
            onPress={onOpenFullDiskAccess}
          />
        )}
      </View>
    </View>
  );
}

function Status({ ok, children }: { ok: boolean; children: string }) {
  return (
    <MonoText
      style={[styles.status, { color: ok ? colors.green : colors.red }]}
    >
      {children}
    </MonoText>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 20,
  },
  name: {
    flex: 1,
    fontSize: 11,
  },
  details: {
    fontSize: 10,
    color: colors.textDim,
  },
  status: {
    fontSize: 10,
    textAlign: "right",
  },
  error: {
    fontSize: 10,
    color: colors.red,
  },
  buttons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
});
