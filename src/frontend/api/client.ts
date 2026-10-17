import createClient from "openapi-fetch";
import type { paths, components } from "../../contracts/generated";
export const api = createClient<paths>({ baseUrl: "__TAURI_INTERNALS__" in window ? "http://127.0.0.1:8787" : "" });
export type State = components["schemas"]["State"];
export type CoreState = {
  activeSession: components["schemas"]["Session"] | null;
  sessions: components["schemas"]["Session"][];
  periods: components["schemas"]["WorkPeriod"][];
  sources: components["schemas"]["PeriodSource"][];
  questions: components["schemas"]["PendingQuestion"][];
  coverageGaps: components["schemas"]["CoverageGap"][];
  billing: components["schemas"]["BillingState"];
};
export type TimeEntry = components["schemas"]["time_entry"];
export type Matter = components["schemas"]["matter"];
export type Client = components["schemas"]["client"];
export type Recognition = components["schemas"]["Recognition"];
export type Block = components["schemas"]["block"];
export type View =
  "desk" | "myDay" | "matters" | "preInvoices" | "source" | "settings";
export type ScreenProps = {
  s: State;
  core: CoreState;
  refresh: () => Promise<void>;
  action: <T>(
    promise: Promise<{ data?: T; error?: unknown }>,
  ) => Promise<T | undefined>;
  navigate: (view: View, matterId?: number) => void;
  selectedCase?: number;
  source: (id: string) => void;
};
export const money = (cts: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(
    cts / 100,
  );
export const hours = (tenths_of_hour: number) =>
  `${(tenths_of_hour / 10).toLocaleString("en-IE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h`;
export const shortDate = (d: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(
    new Date(d + "T00:00:00Z"),
  );
export const today = "2026-10-16";
export function matter(s: State, id: number | null) {
  return s.matter.find((d) => d.id === id);
}
export function client(s: State, id: number | null) {
  const d = matter(s, id);
  return d ? s.client.find((c) => c.id === d.client_id) : undefined;
}
export function label(s: State, id: number | null) {
  const d = matter(s, id),
    c = client(s, id);
  return d && c ? `${c.name} · ${d.reference} · ${d.title}` : "Unassigned case";
}
export function task(s: State, id: number | null) {
  return s.task.find((t) => t.id === id)?.label ?? "—";
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
