import { useCallback, useEffect, useRef, useState } from "react";
import { errorCode, errorMessage } from "../native/MicDiagnostics";

export interface ActionMessage {
  kind: "success" | "info" | "error";
  text: string;
}

const MESSAGE_DURATION_MS = 6000;

/** Runs one async action at a time and reports its outcome as a transient message. */
export function useActionRunner() {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearTimer = useCallback(() => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
  }, []);

  const show = useCallback(
    (next: ActionMessage) => {
      clearTimer();
      setMessage(next);
      timer.current = setTimeout(() => setMessage(null), MESSAGE_DURATION_MS);
    },
    [clearTimer],
  );

  const run = useCallback(
    async (id: string, action: () => Promise<unknown>) => {
      setBusy(id);
      try {
        const text = await action();
        if (typeof text === "string" && text) {
          show({ kind: "success", text });
        }
      } catch (error) {
        show({
          kind: errorCode(error) === "cancelled" ? "info" : "error",
          text: errorMessage(error),
        });
      } finally {
        setBusy(null);
      }
    },
    [show],
  );

  const dismiss = useCallback(() => {
    clearTimer();
    setMessage(null);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return { busy, message, run, dismiss };
}
