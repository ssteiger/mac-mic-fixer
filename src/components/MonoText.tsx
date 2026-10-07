import { StyleSheet, Text, type TextProps } from "react-native";
import { colors, fonts } from "../theme";

export function MonoText({ style, ...props }: TextProps) {
  return <Text {...props} style={[styles.text, style]} />;
}

const styles = StyleSheet.create({
  text: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.text,
  },
});
