import { recognize, type Catalog } from "../domain/recognition.js";
import type { CatalogState } from "../ports/catalog.js";

export interface CaseSuggestion {
  caseId: string;
  client: string;
  title: string;
  reference: string;
  reason: string;
}
export interface WindowRecognition {
  suggestion: CaseSuggestion | null;
  alternatives: CaseSuggestion[];
  confidence: "high" | "low";
}

/**
 * Suggests an active canonical case for a window title. The suggestion is advisory:
 * the lawyer confirms it through the pill before any period is written.
 */
export function recognizeWindow(
  windowTitle: string,
  appName: string,
  catalog: Pick<CatalogState, "clients" | "cases" | "markers">,
): WindowRecognition {
  const active = catalog.cases.filter((item) => item.status === "active");
  // The domain matcher uses numeric keys; map opaque canonical IDs to positions.
  const caseIndex = new Map(active.map((item, index) => [item.id, index + 1]));
  const clientIndex = new Map(catalog.clients.map((client, index) => [client.id, index + 1]));
  const domainCatalog: Catalog = {
    clients: catalog.clients.map((client) => ({
      id: clientIndex.get(client.id)!,
      name: client.name,
      code: client.code ?? "",
    })),
    matters: active.map((item) => ({
      id: caseIndex.get(item.id)!,
      client_id: clientIndex.get(item.clientId) ?? 0,
      reference: item.reference,
    })),
    markers: [
      ...catalog.markers
        .filter((marker) => caseIndex.has(marker.caseId))
        .map((marker) => ({
          id: marker.id,
          matter_id: caseIndex.get(marker.caseId)!,
          type: marker.type,
          value: marker.value,
          weight: marker.weight,
        })),
      ...active
        .filter((item) => item.opposingParty.trim())
        .map((item, index) => ({
          id: -(index + 1),
          matter_id: caseIndex.get(item.id)!,
          type: "opposing_party" as const,
          value: item.opposingParty,
          weight: 0.6,
        })),
    ],
  };
  const candidates = recognize({ app: appName, window_title: windowTitle }, domainCatalog);
  const mapped = candidates.map((candidate) => {
    const item = active[candidate.matter_id - 1];
    const client = catalog.clients.find((owner) => owner.id === item.clientId);
    const first = candidate.found[0];
    return {
      caseId: item.id,
      client: client?.name ?? "",
      title: item.title,
      reference: item.reference,
      reason: first ? `${first.type.replaceAll("_", " ")}: ${first.value}` : "",
    };
  });
  const top = candidates[0];
  const tied =
    !!top && candidates.some((candidate) => candidate !== top && candidate.score === top.score);
  return {
    suggestion: mapped[0] ?? null,
    alternatives: mapped.slice(1, 4),
    confidence: top && !tied && top.score >= 0.8 ? "high" : "low",
  };
}
