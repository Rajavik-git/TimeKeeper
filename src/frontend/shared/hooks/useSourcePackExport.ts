import { useRef, useState } from "react";
import { sourcePackRequest, type SourcePackRequest } from "../../api/source-pack";
import { api, type EntityId, type ScreenProps } from "../../api/client";

/** Both source-pack views share request, download, and repeat-click handling. */
export function useSourcePackExport(
  action: ScreenProps["action"],
  caseId: EntityId,
  reference: string,
) {
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const create = async (body: SourcePackRequest) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await action(
        api.POST("/api/catalog/cases/{id}/source-pack", {
          params: { path: { id: String(caseId) } },
          body: sourcePackRequest(body),
        }),
        setError,
      );
      if (!result) {
        setError((current) => current || "Could not create source pack. Try again.");
        return;
      }
      setReceipt(result.export.sha256);
      const url = URL.createObjectURL(
        new Blob([result.payload], { type: "application/json;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `source-pack-${reference}-${result.export.id}.json`;
      try {
        link.click();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    } catch {
      setError("Could not create source pack. Your selection is preserved. Try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { receipt, busy, error, create };
}
