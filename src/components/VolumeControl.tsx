import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { VolumeInfo } from "../native/MicDiagnostics";
import { colors } from "../theme";
import { MonoText } from "./MonoText";
import { Hint } from "./Section";
import { Slider } from "./Slider";

interface Props {
  volume: VolumeInfo | null;
  onSetVolume: (volume: number) => Promise<unknown>;
  onSetMuted: (muted: boolean) => void;
}

export function VolumeControl({ volume, onSetVolume, onSetMuted }: Props) {
  const pending = useRef<number | null>(null);
  const inFlight = useRef(false);
  const [muteHovered, setMuteHovered] = useState(false);

  // Coalesce slider drags so only one native call is outstanding at a time.
  const pushVolume = useCallback(
    async (value: number) => {
      pending.current = value;
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      while (pending.current !== null) {
        const next = pending.current;
        pending.current = null;
        await onSetVolume(next).catch(() => {});
      }
      inFlight.current = false;
    },
    [onSetVolume],
  );

  if (!volume) {
    return <Hint>No input device selected.</Hint>;
  }

  return (
    <View style={styles.container}>
      {volume.hasVolume ? (
        <Slider
          value={volume.volume ?? 0}
          disabled={!volume.volumeSettable}
          onChange={pushVolume}
          label="Input volume"
          valueText={[
            volume.volume != null ? `${Math.round(volume.volume * 100)}%` : "–",
            volume.volumeDb != null ? `${volume.volumeDb.toFixed(1)} dB` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      ) : (
        <Hint>
          This device has no software input volume. Adjust the gain on the
          device itself.
        </Hint>
      )}

      {volume.hasMute && (
        <Pressable
          disabled={!volume.muteSettable}
          onPress={() => onSetMuted(!volume.muted)}
          onHoverIn={() => setMuteHovered(true)}
          onHoverOut={() => setMuteHovered(false)}
          style={[
            styles.muteRow,
            volume.muted && styles.muteRowOn,
            muteHovered && styles.muteRowHovered,
            !volume.muteSettable && styles.disabled,
          ]}
        >
          <MonoText style={[styles.muteLabel, volume.muted && styles.muted]}>
            {volume.muted ? "Input muted" : "Mute"}
          </MonoText>
          <MonoText style={[styles.muteValue, volume.muted && styles.muted]}>
            {volume.muted ? "click to unmute" : "off"}
          </MonoText>
        </Pressable>
      )}

      {volume.hasVolume && !volume.volumeSettable && (
        <Hint>
          The device reports its volume but doesn't let macOS change it.
        </Hint>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  muteRow: {
    height: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    borderRadius: 2,
    backgroundColor: colors.surface,
  },
  muteRowOn: {
    backgroundColor: colors.redSurface,
  },
  muteRowHovered: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.5,
  },
  muteLabel: {
    fontSize: 11,
  },
  muteValue: {
    fontSize: 11,
    color: colors.textMuted,
  },
  muted: {
    color: colors.red,
    fontWeight: "600",
  },
});
