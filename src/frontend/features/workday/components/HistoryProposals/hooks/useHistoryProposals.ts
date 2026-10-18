import { useEffect, useRef, useState } from "react";
import { historyApi } from "../../../../../api/history";
import { Resource, type ResourceState } from "../../../../../api/resource";
import { unavailableMessage } from "../../../../../api/errors";

type HistoryState = Awaited<ReturnType<typeof historyApi.load>>;
export function useHistoryProposals(sessionId: string, refreshWorkspace: () => Promise<void>) {
  const [state, setState] = useState<ResourceState<HistoryState>>({ error: null, isLoading: true });
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const busy = useRef(false);
  const resource = useRef<Resource<HistoryState> | null>(null);
  useEffect(() => {
    mounted.current = true;
    const current = new Resource((signal) => historyApi.load(sessionId, signal), setState);
    resource.current = current;
    void current.refresh().catch(() => {});
    const timer = window.setInterval(() => {
      if (!busy.current) void current.poll().catch(() => {});
    }, 5000);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      current.dispose();
    };
  }, [sessionId]);
  async function run(operation: () => Promise<unknown>, changesWorkspace = false) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setNotice("");
    try {
      await operation();
      if (!mounted.current) return;
      setNotice(
        changesWorkspace ? "Work period saved." : "Request saved. Review the latest status below.",
      );
      await resource.current?.refresh().catch(() => {});
      if (changesWorkspace) {
        try {
          await refreshWorkspace();
        } catch {
          if (mounted.current)
            setNotice(
              "Work period saved. The workspace could not refresh. Reload the application to see it.",
            );
        }
      }
    } catch (error) {
      if (mounted.current) setNotice(error instanceof Error ? error.message : unavailableMessage);
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return { state, pending, notice, run, reload: () => resource.current?.refresh().catch(() => {}) };
}
