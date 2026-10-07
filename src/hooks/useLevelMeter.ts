import { useCallback, useEffect, useRef, useState } from "react";
import {
  addMicListener,
  errorCode,
  errorMessage,
  type LevelSample,
  MicDiagnostics,
} from "../native/MicDiagnostics";

export type SignalStatus =
  | "off"
  | "starting"
  | "ok"
  | "quiet"
  | "digitalSilence"
  | "error";

const QUIET_THRESHOLD_DB = -50;
const SILENCE_GRACE_MS = 3000;

export const HISTORY_BUCKET_MS = 150;
export const HISTORY_LENGTH = 7 * 34;

export function useLevelMeter(enabled: boolean) {
  const [level, setLevel] = useState<LevelSample | null>(null);
  const [signal, setSignal] = useState<SignalStatus>("off");
  const [error, setError] = useState<{ code?: string; message: string } | null>(
    null,
  );
  /** Peak dBFS per HISTORY_BUCKET_MS since the meter started, oldest first. */
  const [history, setHistory] = useState<number[]>([]);
  const quietSince = useRef<number | null>(null);
  const silentSince = useRef<number | null>(null);
  const bucket = useRef<{ start: number; peak: number } | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLevel(null);
      setSignal("off");
      return;
    }

    let cancelled = false;
    quietSince.current = null;
    silentSince.current = null;
    bucket.current = null;
    setHistory([]);
    setError(null);
    setSignal("starting");

    const levelSubscription = addMicListener("onLevel", (sample) => {
      const now = Date.now();
      if (!sample.silent) {
        silentSince.current = null;
      } else if (silentSince.current === null) {
        silentSince.current = now;
      }
      if (sample.peak >= QUIET_THRESHOLD_DB) {
        quietSince.current = null;
      } else if (quietSince.current === null) {
        quietSince.current = now;
      }

      const current = bucket.current;
      if (!current) {
        bucket.current = { start: now, peak: sample.peak };
      } else {
        current.peak = Math.max(current.peak, sample.peak);
        if (now - current.start >= HISTORY_BUCKET_MS) {
          const { peak } = current;
          bucket.current = null;
          setHistory((previous) => [
            ...previous.slice(-(HISTORY_LENGTH - 1)),
            peak,
          ]);
        }
      }

      setLevel(sample);
      if (
        silentSince.current !== null &&
        now - silentSince.current > SILENCE_GRACE_MS
      ) {
        setSignal("digitalSilence");
      } else if (
        quietSince.current !== null &&
        now - quietSince.current > SILENCE_GRACE_MS
      ) {
        setSignal("quiet");
      } else {
        setSignal("ok");
      }
    });
    const errorSubscription = addMicListener("onLevelMeterError", (event) => {
      setError({ message: event.message });
      setSignal("error");
    });

    MicDiagnostics.startLevelMeter().catch((startError) => {
      if (!cancelled) {
        setError({
          code: errorCode(startError),
          message: errorMessage(startError),
        });
        setSignal("error");
      }
    });

    return () => {
      cancelled = true;
      levelSubscription.remove();
      errorSubscription.remove();
      MicDiagnostics.stopLevelMeter();
    };
  }, [enabled]);

  const restart = useCallback(async () => {
    quietSince.current = null;
    silentSince.current = null;
    setError(null);
    setSignal("starting");
    await MicDiagnostics.resetLevelMeter();
  }, []);

  return { level, signal, error, history, restart };
}
