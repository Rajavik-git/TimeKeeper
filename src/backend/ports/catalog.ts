import type { components } from "../../contracts/generated.js";

export type CatalogSettings = components["schemas"]["CatalogSettings"];
export type CatalogClient = components["schemas"]["CatalogClient"];
export type CatalogCase = components["schemas"]["CatalogCase"];
export type CatalogTaskType = components["schemas"]["CatalogTaskType"];
export type CatalogMarker = components["schemas"]["CatalogMarker"];
export type CatalogClientRule = components["schemas"]["CatalogClientRule"];
export type CatalogState = components["schemas"]["Catalog"];
export type CatalogAuditEvent = components["schemas"]["AuditEvent"];

export interface CatalogPort {
  transaction<T>(work: () => T): T;
  state(): CatalogState;
  client(id: string): CatalogClient | undefined;
  case(id: string): CatalogCase | undefined;
  taskType(id: number): CatalogTaskType | undefined;
  marker(id: number): CatalogMarker | undefined;
  clientRule(id: number): CatalogClientRule | undefined;
  createClient(value: CatalogClient, at: string): CatalogClient;
  updateClient(id: string, patch: Partial<Omit<CatalogClient, "id">>, at: string): CatalogClient;
  createCase(value: CatalogCase, at: string): CatalogCase;
  updateCase(
    id: string,
    patch: Partial<Omit<CatalogCase, "id" | "reference">>,
    at: string,
  ): CatalogCase;
  updateSettings(patch: Partial<Omit<CatalogSettings, "id">>, at: string): CatalogSettings;
  createTaskType(value: Omit<CatalogTaskType, "id">): CatalogTaskType;
  updateTaskType(id: number, patch: Partial<Omit<CatalogTaskType, "id">>): CatalogTaskType;
  createMarker(value: Omit<CatalogMarker, "id">): CatalogMarker;
  removeMarker(id: number): void;
  createClientRule(value: Omit<CatalogClientRule, "id">): CatalogClientRule;
  removeClientRule(id: number): void;
  lastCaseSequence(year: number): number;
  audit(action: string, before: string, after: string, at: string): void;
  auditEvents(): CatalogAuditEvent[];
}
