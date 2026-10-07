export const colors = {
  background: "#1b1d24",
  surface: "#262932",
  surfaceRaised: "#343844",
  border: "#3a3e4a",
  borderStrong: "#5a5f6e",
  divider: "#2c2f38",
  text: "#e6e7ec",
  textMuted: "#8b8f9c",
  textDim: "#5f6371",
  barTrack: "#2c2f38",
  barFill: "#c4c7d4",
  accent: "#8fb0f5",
  red: "#ef6f77",
  redSurface: "#47292f",
  orange: "#e9ac66",
  green: "#86d09c",
};

/** Level history cells, from quiet to loud. */
export const heatColors = [
  "#262932",
  "#2f3a55",
  "#41598f",
  "#5f82d4",
  "#93b3fa",
];

export const fonts = {
  mono: "Menlo",
};

export const severityColor = {
  ok: colors.green,
  warning: colors.orange,
  error: colors.red,
};

export function formatRate(hz: number | null | undefined): string {
  if (!hz) {
    return "unknown";
  }
  const khz = hz / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
}
