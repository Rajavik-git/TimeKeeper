import { useRef, useState } from "react";

/** Each form owns its pending request, persistent error, and discard decision. */
export function useDraftDialog(close: () => void, dirty: boolean) {
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const requestClose = () => {
    if (pendingRef.current) return;
    if (dirty) setDiscarding(true);
    else close();
  };
  const submit = async (operation: () => Promise<void>) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    setDiscarding(false);
    try {
      await operation();
    } catch {
      setError("Could not save. Your changes are kept. Try again.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  return { pending, error, setError, discarding, setDiscarding, requestClose, submit };
}
