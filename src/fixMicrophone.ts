import { MicDiagnostics } from "./native/MicDiagnostics";
import { formatRate } from "./theme";

const STANDARD_RATES = [48000, 44100];

/**
 * Resets the input after a call app (Slack, Zoom, Teams, ...) left it
 * crackling or silent: disables Background Music's driver, restarts
 * coreaudiod, switches to the built-in mic at a standard sample rate and
 * unmutes it. Resolves with a sentence describing what changed.
 */
export async function fixMicrophone(): Promise<string> {
  const steps: string[] = [];

  const disabled = await MicDiagnostics.restartCoreAudio(true);
  if (disabled.length > 0) {
    steps.push(`disabled ${disabled.join(" and ")}`);
  }
  steps.push("restarted the audio service");

  const devices = await MicDiagnostics.getInputDevices();
  const builtIn = devices.find((d) => d.transport === "builtIn" && d.isAlive);
  if (builtIn) {
    if (!builtIn.isDefault) {
      await MicDiagnostics.setDefaultInput(builtIn.id);
    }
    steps.push(`selected ${builtIn.name}`);
  }

  const { format } = await MicDiagnostics.getDeviceState();
  if (format && !STANDARD_RATES.includes(format.sampleRate)) {
    const rate = STANDARD_RATES.find((r) =>
      format.availableSampleRates.includes(r),
    );
    if (rate) {
      await MicDiagnostics.setSampleRate(rate);
      steps.push(`set it to ${formatRate(rate)}`);
    }
  }

  const volume = await MicDiagnostics.resetInputVolume();
  if (volume.volumeSet) {
    steps.push("unmuted it at 75% volume");
  } else if (volume.unmuted) {
    steps.push("unmuted it");
  }

  const sentence =
    steps.length > 1
      ? `${steps.slice(0, -1).join(", ")} and ${steps[steps.length - 1]}`
      : steps[0];
  return `${sentence[0].toUpperCase()}${sentence.slice(1)}. Speak to check the meter.`;
}
