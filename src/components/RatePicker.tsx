import { StyleSheet, View } from "react-native";
import type { FormatInfo } from "../native/MicDiagnostics";
import { Button } from "./Button";

interface Props {
  format: FormatInfo | null;
  disabled: boolean;
  onSelectRate: (rate: number) => void;
}

export function RatePicker({ format, disabled, onSelectRate }: Props) {
  if (!format || format.availableSampleRates.length === 0) {
    return null;
  }
  return (
    <View style={styles.row}>
      {format.availableSampleRates.map((rate) => {
        const selected = rate === format.sampleRate;
        return (
          <Button
            key={rate}
            title={shortRate(rate)}
            kind={selected ? "selected" : "default"}
            disabled={disabled || selected}
            onPress={() => onSelectRate(rate)}
            style={styles.chip}
          />
        );
      })}
    </View>
  );
}

function shortRate(hz: number): string {
  const khz = hz / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)}k`;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    flexGrow: 1,
    flexBasis: 50,
  },
});
