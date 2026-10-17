import createClient from "openapi-fetch";
import type { paths, components } from "../../contracts/generated";
export { money, shortDate } from "../shared/format";
export const api = createClient<paths>({
  baseUrl: "__TAURI_INTERNALS__" in window ? "http://127.0.0.1:8787" : "",
});
export type State = components["schemas"]["Catalog"];
export type CoreState = {
  activeSession: components["schemas"]["Session"] | null;
  sessions: components["schemas"]["Session"][];
  periods: components["schemas"]["WorkPeriod"][];
  sources: components["schemas"]["PeriodSource"][];
  questions: components["schemas"]["PendingQuestion"][];
  coverageGaps: components["schemas"]["CoverageGap"][];
  billing: components["schemas"]["BillingState"];
  auditEvents: components["schemas"]["AuditEvent"][];
};
export type EntityId = string | number;
export const sameId = (left: EntityId | null | undefined, right: EntityId | null | undefined) =>
  left != null && right != null && String(left) === String(right);
export type Case = components["schemas"]["CatalogCase"];
export type Client = components["schemas"]["CatalogClient"];
export type Recognition = components["schemas"]["Recognition"];
export type View = "desk" | "myDay" | "matters" | "preInvoices" | "source" | "settings";
export type ScreenProps = {
  catalogState: State;
  workspaceState: CoreState;
  refresh: () => Promise<void>;
  action: <T>(promise: Promise<{ data?: T; error?: unknown }>) => Promise<T | undefined>;
  navigate: (view: View, caseId?: EntityId) => void;
  selectedCase?: EntityId;
  openPeriodActivity: (periodId: string) => void;
};
export { tenthsOfHour as formatTenthsOfHour } from "../shared/format";
export function caseById(catalogState: State, caseId: EntityId | null) {
  return catalogState.cases.find((item) => sameId(item.id, caseId));
}
export function clientForCase(catalogState: State, caseId: EntityId | null) {
  const item = caseById(catalogState, caseId);
  return item ? catalogState.clients.find((owner) => sameId(owner.id, item.clientId)) : undefined;
}
export function caseLabel(catalogState: State, caseId: EntityId | null) {
  const item = caseById(catalogState, caseId);
  const owner = clientForCase(catalogState, caseId);
  return item && owner ? `${owner.name} · ${item.reference} · ${item.title}` : "Unassigned case";
}
export function task(catalogState: State, id: EntityId | null) {
  return catalogState.taskTypes.find((t) => t.id === id)?.label ?? "—";
}
export function originLabel(origin: string): string {
  return (
    (
      {
        base: "base rate",
        client: "client rate",
        matter: "case rate",
        flat_fee: "flat fee",
      } as Record<string, string>
    )[origin] ?? origin
  );
}
