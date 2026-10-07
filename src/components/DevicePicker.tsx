import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { InputDevice, Transport } from "../native/MicDiagnostics";
import { colors } from "../theme";
import { MonoText } from "./MonoText";
import { Hint } from "./Section";

const TRANSPORT_LABELS: Record<Transport, string> = {
  builtIn: "Built-in",
  usb: "USB",
  bluetooth: "Bluetooth",
  bluetoothLE: "Bluetooth LE",
  aggregate: "Aggregate",
  virtual: "Virtual",
  hdmi: "HDMI",
  displayPort: "DisplayPort",
  airPlay: "AirPlay",
  thunderbolt: "Thunderbolt",
  pci: "PCI",
  fireWire: "FireWire",
  avb: "AVB",
  continuity: "iPhone",
  unknown: "Other",
};

export function transportLabel(transport: Transport): string {
  return TRANSPORT_LABELS[transport] ?? "Other";
}

interface Props {
  devices: InputDevice[];
  disabled: boolean;
  onSelect: (device: InputDevice) => void;
}

export function DevicePicker({ devices, disabled, onSelect }: Props) {
  if (devices.length === 0) {
    return <Hint>No input devices found. Connect a microphone.</Hint>;
  }
  return (
    <View style={styles.grid}>
      {devices.map((device) => (
        <DeviceChip
          key={device.id}
          device={device}
          disabled={disabled}
          onPress={() => !device.isDefault && onSelect(device)}
        />
      ))}
    </View>
  );
}

function DeviceChip({
  device,
  disabled,
  onPress,
}: {
  device: InputDevice;
  disabled: boolean;
  onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const details = [
    transportLabel(device.transport),
    `${device.channels} ch`,
    device.isAlive ? null : "not responding",
  ].filter(Boolean);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.chip,
        hovered && styles.chipHovered,
        device.isDefault && styles.chipSelected,
      ]}
    >
      <View style={styles.nameRow}>
        <MonoText
          style={[
            styles.name,
            device.isDefault && styles.nameSelected,
            !device.isAlive && styles.dead,
          ]}
          numberOfLines={1}
        >
          {device.name}
        </MonoText>
        {device.isRunningSomewhere && <View style={styles.activeDot} />}
      </View>
      <MonoText style={styles.details} numberOfLines={1}>
        {details.join(" · ")}
      </MonoText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 6,
  },
  chip: {
    width: "49%",
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 2,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipHovered: {
    backgroundColor: colors.surface,
  },
  chipSelected: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderStrong,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  name: {
    flexShrink: 1,
    fontSize: 11,
    color: colors.textMuted,
  },
  nameSelected: {
    color: colors.text,
    fontWeight: "600",
  },
  dead: {
    color: colors.red,
  },
  details: {
    fontSize: 9,
    color: colors.textDim,
  },
  activeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.orange,
  },
});
