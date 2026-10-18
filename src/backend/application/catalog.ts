import {
  clientTypes,
  clientBillingModes,
  caseStatuses,
  caseBillingModes,
  baseUnits,
  pillDisplays,
  markerTypes,
  clientRuleTypes,
  CaseStatus,
  ClientBillingMode,
  ClientRuleType,
  ClientType,
  CaseBillingMode,
  MarkerType,
  systemTaskCodes,
} from "../domain/states.js";
import {
  DEFAULT_DAILY_RESEARCH_CAP_UNITS,
  researchCapHours,
} from "../../shared/client-rule-policy.js";
import { randomUUID } from "node:crypto";
import { calendarDay, isCalendarDay } from "../../shared/dates.js";
import { nextCaseReference } from "../domain/nomenclature.js";
import { defaultWeights } from "../domain/recognition.js";
import type {
  CatalogCase,
  CatalogClient,
  CatalogClientRule,
  CatalogPort,
  CatalogSettings,
  CatalogTaskType,
} from "../ports/catalog.js";
import { AppError } from "./errors.js";

type Validator = (value: unknown) => unknown;
const invalid = (message: string): never => {
  throw new AppError("invalid-request", message);
};
const text: Validator = (value) => (typeof value === "string" ? value : invalid("string required"));
const requiredText: Validator = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : invalid("nonempty string required");
const identifier: Validator = (value) =>
  typeof value === "string" && value.trim() && value.length <= 200 ? value : invalid("invalid ID");
const boolean: Validator = (value) =>
  typeof value === "boolean" ? value : invalid("boolean required");
const number =
  (minimum = 0, maximum = Number.MAX_SAFE_INTEGER, integer = false): Validator =>
  (value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum &&
    (!integer || Number.isSafeInteger(value))
      ? value
      : invalid("number outside permitted range");
const cents = number(0, Number.MAX_SAFE_INTEGER, true);
const nullable =
  (validate: Validator): Validator =>
  (value) =>
    value === null ? null : validate(value);
const member =
  (...values: string[]): Validator =>
  (value) =>
    typeof value === "string" && values.includes(value) ? value : invalid("invalid choice");
const clientCode: Validator = (value) =>
  typeof value === "string" && /^[A-Z][A-Z0-9]*$/.test(value)
    ? value
    : invalid("Client code must be uppercase letters or digits");
const day: Validator = (value) =>
  typeof value === "string" && isCalendarDay(value) ? value : invalid("invalid calendar day");
const currency: Validator = (value) =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value)
    ? value
    : invalid("currency must contain three uppercase letters");

/** Select only declared fields, validate each value, and reject misspelled attributes. */
function patch<T>(
  input: Record<string, unknown>,
  validators: Record<keyof T, Validator>,
): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(validators, key)) invalid(`unknown field: ${key}`);
    result[key] = validators[key as keyof T](value);
  }
  if (!Object.keys(result).length) invalid("at least one field required");
  return result as Partial<T>;
}
const clientFields: Record<keyof Omit<CatalogClient, "id">, Validator> = {
  name: requiredText,
  code: nullable(clientCode),
  active: boolean,
  type: member(...clientTypes),
  mode: member(...clientBillingModes),
  hourlyRateCents: nullable(cents),
  vatApplicable: boolean,
  billingAddress: text,
};
const caseFields: Record<keyof Omit<CatalogCase, "id" | "reference">, Validator> = {
  clientId: identifier,
  title: requiredText,
  hourlyRateCents: nullable(cents),
  status: member(...caseStatuses),
  category: text,
  caseNumber: text,
  opposingParty: text,
  mode: member(...caseBillingModes),
  flatFeeCents: nullable(cents),
  hourCap: nullable(number()),
  successFeePercent: nullable(number(0, 100)),
  budgetCents: nullable(cents),
  openedOn: nullable(day),
};
const settingsFields: Record<keyof Omit<CatalogSettings, "id">, Validator> = {
  workspaceId: identifier,
  globalHourlyRateCents: cents,
  currency,
  lawyerName: text,
  address: text,
  vatNumber: text,
  baseUnit: member(...baseUnits),
  vatRate: number(0, 100),
  confidenceThreshold: number(0, 1),
  excludedApps: text,
  captureRetention: text,
  notifications: boolean,
  pillPosition: text,
  pillAlwaysOnTop: boolean,
  pillDisplay: member(...pillDisplays),
  pillWithholdCalls: boolean,
  invoicePrefix: requiredText,
  nextNumber: number(1, Number.MAX_SAFE_INTEGER, true),
};
const taskFields: Record<keyof Omit<CatalogTaskType, "id">, Validator> = {
  code: requiredText,
  label: requiredText,
  billableByDefault: boolean,
  offScreen: boolean,
  sortOrder: number(0, Number.MAX_SAFE_INTEGER, true),
};
function found<T>(value: T | undefined, label: string): T {
  if (!value) throw new AppError("not-found", `${label} not found`);
  return value;
}

export class CatalogService {
  constructor(
    private readonly port: CatalogPort,
    private readonly now = () => new Date().toISOString(),
  ) {}
  listClients() {
    return this.port.listClients();
  }
  listCases(query: { clientId?: string; status?: string } = {}) {
    if (query.status && !caseStatuses.includes(query.status as (typeof caseStatuses)[number]))
      throw new AppError("invalid-request", "invalid case status");
    return this.port.transaction(() => {
      const clients = new Map(this.port.listClients().map((client) => [client.id, client]));
      return this.port
        .listCases()
        .filter(
          (item) =>
            (!query.clientId || item.clientId === query.clientId) &&
            (!query.status || item.status === query.status),
        )
        .map((item) => ({
          ...item,
          clientName: clients.get(item.clientId)?.name ?? "",
        }));
    });
  }
  getSettings() {
    return this.port.getSettings();
  }
  getCatalog() {
    return this.port.transaction(() => this.port.state());
  }
  auditEvents() {
    return this.port.auditEvents();
  }
  searchCases(query: string) {
    const normalized = (text: string) =>
      text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("en-US");
    const needle = normalized(query.trim());
    if (!needle) return { clients: [], cases: [] };
    return this.port.transaction(() => {
      const catalog = { clients: this.port.listClients(), cases: this.port.listCases() };
      const clientsById = new Map(catalog.clients.map((client) => [client.id, client]));
      return {
        clients: catalog.clients.filter((client) => normalized(client.name).includes(needle)),
        cases: catalog.cases.filter((item) =>
          [
            item.title,
            item.reference,
            item.category,
            item.opposingParty,
            clientsById.get(item.clientId)?.name ?? "",
          ].some((value) => normalized(value).includes(needle)),
        ),
      };
    });
  }
  private change<T>(action: string, before: unknown, work: (at: string) => T): T {
    return this.port.transaction(() => {
      const at = this.now();
      const result = work(at);
      this.port.audit(
        action,
        before === undefined ? "" : JSON.stringify(before),
        JSON.stringify(result),
        at,
      );
      return result;
    });
  }
  createClient(input: Record<string, unknown>) {
    const { id = randomUUID(), ...attributes } = input;
    identifier(id);
    const values = patch<Omit<CatalogClient, "id">>(attributes, clientFields);
    if (!values.name) invalid("name required");
    return this.change("Client created", undefined, (at) =>
      this.port.createClient(
        {
          id: id as string,
          code: null,
          active: true,
          type: ClientType.Individual,
          mode: ClientBillingMode.Hourly,
          hourlyRateCents: null,
          vatApplicable: false,
          billingAddress: "",
          ...values,
          name: values.name!,
        },
        at,
      ),
    );
  }
  updateClient(id: string, input: Record<string, unknown>) {
    return this.change(
      "Client updated",
      found(this.port.auditSnapshot("client", id), "client"),
      (at) => this.port.updateClient(id, patch(input, clientFields), at),
    );
  }
  createCase(input: Record<string, unknown>) {
    const { id = randomUUID(), reference, ...attributes } = input;
    identifier(id);
    const values = patch<Omit<CatalogCase, "id" | "reference">>(attributes, caseFields);
    if (!values.clientId || !values.title) invalid("clientId and title required");
    return this.change("Case created", undefined, (at) => {
      const client = found(this.port.client(values.clientId!), "client");
      const openedOn = calendarDay(at);
      let assignedReference: string;
      if (reference === undefined) {
        if (!client.code) invalid("client code required to allocate a case reference");
        const year = Number(openedOn.slice(0, 4));
        const lastSequence = this.port.lastCaseSequence(year);
        if (lastSequence >= 999) throw new AppError("conflict", "annual case sequence exhausted");
        assignedReference = nextCaseReference(year, lastSequence, client.code!);
      } else assignedReference = requiredText(reference) as string;
      const result = this.port.createCase(
        {
          id: id as string,
          clientId: client.id,
          reference: assignedReference,
          title: values.title!,
          hourlyRateCents: null,
          status: CaseStatus.Active,
          category: "",
          caseNumber: "",
          opposingParty: "",
          mode: CaseBillingMode.Hourly,
          flatFeeCents: null,
          hourCap: null,
          successFeePercent: null,
          budgetCents: null,
          openedOn,
          ...values,
        },
        at,
      );
      if (values.opposingParty?.trim())
        this.port.createMarker({
          caseId: result.id,
          type: MarkerType.OpposingParty,
          value: values.opposingParty,
          weight: defaultWeights[MarkerType.OpposingParty],
          learned: false,
          hits: 0,
          lastSeenAt: null,
        });
      return result;
    });
  }
  updateCase(id: string, input: Record<string, unknown>) {
    if ("reference" in input) invalid("Case reference is immutable");
    const values = patch(input, caseFields);
    return this.change("Case updated", found(this.port.auditSnapshot("case", id), "case"), (at) => {
      if (values.clientId !== undefined) found(this.port.client(values.clientId), "client");
      return this.port.updateCase(id, values, at);
    });
  }
  updateSettings(input: Record<string, unknown>) {
    return this.change(
      "Settings updated",
      found(this.port.auditSnapshot("settings", 1), "settings"),
      (at) => this.port.updateSettings(patch(input, settingsFields), at),
    );
  }
  createTaskType(input: Record<string, unknown>) {
    const values = patch<Omit<CatalogTaskType, "id">>(input, taskFields);
    if (!values.code || !values.label) invalid("code and label required");
    if (systemTaskCodes.some((code) => code === values.code))
      invalid("Built-in task codes are reserved");
    return this.change("Task created", undefined, () =>
      this.port.createTaskType({
        code: values.code!,
        label: values.label!,
        billableByDefault: true,
        offScreen: false,
        sortOrder: this.port.listTaskTypes().length + 1,
        ...values,
      }),
    );
  }
  updateTaskType(id: number, input: Record<string, unknown>) {
    const current = found(this.port.taskType(id), "task type");
    const values = patch(input, taskFields);
    if (values.code !== undefined && values.code !== current.code) {
      if (systemTaskCodes.some((code) => code === current.code))
        invalid("Built-in task codes are immutable; edit the label instead");
      if (systemTaskCodes.some((code) => code === values.code))
        invalid("Built-in task codes are reserved");
    }
    return this.change("Task updated", current, () => this.port.updateTaskType(id, values));
  }
  createMarker(input: Record<string, unknown>) {
    const value = patch<{ caseId: string; type: MarkerType; value: string; weight: number }>(
      input,
      {
        caseId: identifier,
        type: member(...markerTypes),
        value: requiredText,
        weight: number(0, 1),
      },
    );
    if (!value.caseId || !value.type || !value.value) invalid("caseId, type and value required");
    return this.change("Marker added", undefined, () => {
      found(this.port.case(value.caseId!), "case");
      return this.port.createMarker({
        caseId: value.caseId!,
        type: value.type!,
        value: value.value!,
        weight: value.weight ?? defaultWeights[value.type!],
        learned: false,
        hits: 0,
        lastSeenAt: null,
      });
    });
  }
  removeMarker(id: number) {
    return this.change(
      "Marker removed",
      found(this.port.auditSnapshot("marker", id), "marker"),
      () => {
        this.port.removeMarker(id);
        return { deleted: true };
      },
    );
  }
  createClientRule(input: Record<string, unknown>) {
    const values = patch<Pick<CatalogClientRule, "clientId" | "type" | "value" | "label">>(input, {
      clientId: identifier,
      type: member(...clientRuleTypes),
      value: number(0, Number.MAX_SAFE_INTEGER, true),
      label: requiredText,
    });
    if (!values.clientId || !values.type) invalid("clientId and type required");
    const cap = values.type === ClientRuleType.DailyResearchCap;
    return this.change("Client rule created", undefined, () => {
      found(this.port.client(values.clientId!), "client");
      return this.port.createClientRule({
        clientId: values.clientId!,
        type: values.type!,
        value: values.value ?? (cap ? DEFAULT_DAILY_RESEARCH_CAP_UNITS : 0),
        label:
          values.label ??
          (cap
            ? `No more than ${researchCapHours(values.value ?? DEFAULT_DAILY_RESEARCH_CAP_UNITS)} h of billable research per day`
            : "Travel is not billable"),
      });
    });
  }
  removeClientRule(id: number) {
    return this.change(
      "Client rule removed",
      found(this.port.auditSnapshot("clientRule", id), "client rule"),
      () => {
        this.port.removeClientRule(id);
        return { deleted: true };
      },
    );
  }
}
