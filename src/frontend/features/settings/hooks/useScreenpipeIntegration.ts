import { useCallback, useEffect, useRef, useState } from "react";
import type { components } from "../../../../contracts/generated";
import { api } from "../../../api/client";
import { refreshApplication } from "../../../api/queries";

export type ScreenpipeStatus = components["schemas"]["ScreenpipeIntegrationStatus"];
type Operation = "status" | "test" | "sync";

/** Serialize reads and actions so an older poll cannot replace an action result. */
export function useScreenpipeIntegration(active: boolean) {
  const [status, setStatus] = useState<ScreenpipeStatus | null>(null);
  const [pending, setPending] = useState<Operation | null>(null);
  const [error, setError] = useState("");
  const [refreshWarning, setRefreshWarning] = useState("");
  const busy = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (operation: Operation) => {
    if (busy.current) return;
    busy.current = true;
    setPending(operation);
    setError("");
    if (operation === "sync") setRefreshWarning("");
    try {
      const result =
        operation === "status"
          ? await api.GET("/api/integrations/screenpipe")
          : operation === "test"
            ? await api.POST("/api/integrations/screenpipe/test", { body: {} })
            : await api.POST("/api/integrations/screenpipe/sync", { body: {} });
      if (result.error || !result.data) throw new Error("Integration request failed");
      if (!mounted.current) return;
      setStatus(result.data);
      if (operation === "sync") {
        try {
          await refreshApplication();
        } catch {
          if (mounted.current) {
            setRefreshWarning(
              "The sync result is saved. Some application views could not refresh. Reopen My day to try again.",
            );
          }
        }
      }
    } catch {
      if (mounted.current) {
        setError(
          operation === "status"
            ? "Could not load Screenpipe status from TimeKeeper. Check that the TimeKeeper backend is running, then retry. Displayed results may be out of date."
            : "TimeKeeper could not confirm the result. Check the backend, then refresh status before trying again. Displayed results may be out of date.",
        );
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const poll = () => {
      if (document.visibilityState !== "hidden") void run("status");
    };
    poll();
    const timer = window.setInterval(poll, 10_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [active, run]);

  return { status, pending, error, refreshWarning, run };
}
