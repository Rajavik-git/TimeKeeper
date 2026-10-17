import { createHash } from "node:crypto";
import { calendarDay, isCalendarDay, isTimeZone, systemTimeZone } from "../../shared/dates.js";
import { AppError } from "./service.js";
import { formatInvoiceCsv } from "./invoice-csv.js";
import type {
  SourceExportPort,
  SourceExportRequest,
  SourceExportResponse,
} from "../ports/source-export.js";

const invalid = (message: string): never => {
  throw new AppError("invalid-request", message);
};
const scopes = new Set(["invoice", "case", "dateRange", "selectedPeriods"]);
const supportedOptions = new Set(["blur", "personal", "audio", "audit"]);

function validate(request: SourceExportRequest): string {
  if (!request || typeof request !== "object" || !scopes.has(request.scope))
    invalid("invalid source pack scope");
  if (
    !Array.isArray(request.options) ||
    request.options.some((option) => !supportedOptions.has(option))
  )
    invalid("invalid source pack options");
  const timeZone = request.timeZone ?? systemTimeZone();
  if (typeof timeZone !== "string" || !isTimeZone(timeZone)) invalid("invalid timeZone");
  for (const value of [request.from, request.to])
    if (value !== undefined && (typeof value !== "string" || !isCalendarDay(value)))
      invalid("invalid source pack calendar day");
  if (request.from && request.to && request.from > request.to)
    invalid("from must be on or before to");
  if (request.scope === "dateRange" && (!request.from || !request.to))
    invalid("date range required");
  if (
    request.scope === "invoice" &&
    (!Number.isSafeInteger(request.invoiceId) || request.invoiceId! < 1)
  )
    invalid("invoice required");
  if (
    request.scope === "selectedPeriods" &&
    (!Array.isArray(request.periodIds) ||
      !request.periodIds.length ||
      request.periodIds.some((id) => typeof id !== "string" || !id))
  )
    invalid("period selection required");
  return timeZone;
}
/** Redact known client names only in declared descriptive text fields. */
function clientNameRedactor(names: readonly string[]): (value: string) => string {
  const escapedNames = [...new Set(names.filter(Boolean))]
    .sort((left, right) => right.length - left.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!escapedNames.length) return (value) => value;
  const pattern = new RegExp(escapedNames.join("|"), "giu");
  return (value) => value.replace(pattern, "[client redacted]");
}

/** Source packs contain stored observations and exact period values; no media is fetched. */
export class SourceExportService {
  constructor(
    private readonly port: SourceExportPort,
    private readonly now = () => new Date().toISOString(),
  ) {}
  exportCase(caseId: string, request: SourceExportRequest): SourceExportResponse {
    const timeZone = validate(request);
    return this.port.transaction(() => {
      const snapshot = this.port.snapshot();
      const item = snapshot.catalog.cases.find((item) => item.id === caseId);
      if (!item) throw new AppError("not-found", "case not found");
      if (request.scope === "invoice" && this.port.invoiceCaseId(request.invoiceId!) !== caseId)
        invalid("invoice does not belong to this case");
      const blockedApps = snapshot.catalog.settings.excludedApps
        .split(",")
        .map((value) => value.trim().toLocaleLowerCase("en-US"))
        .filter(Boolean);
      const periods = snapshot.periods.filter((period) => {
        if (period.caseId !== caseId || period.excluded) return false;
        if (
          request.options.includes("personal") &&
          period.demoApp &&
          blockedApps.some((app) => period.demoApp!.toLocaleLowerCase("en-US").includes(app))
        )
          return false;
        if (request.scope === "invoice") return period.invoiceId === request.invoiceId;
        if (request.scope === "dateRange") {
          const day = calendarDay(period.startedAt, timeZone);
          return day >= request.from! && day <= request.to!;
        }
        if (request.scope === "selectedPeriods") return request.periodIds!.includes(period.id);
        return true;
      });
      if (!periods.length) invalid("No periods in source pack scope");
      const periodIds = periods.map((period) => period.id);
      const selected = new Set(periodIds);
      const sources = snapshot.sources.filter(
        (source) =>
          source.workPeriodId !== null &&
          selected.has(source.workPeriodId) &&
          (request.options.includes("audio") || source.contentType !== "audio"),
      );
      const auditEvents = request.options.includes("audit")
        ? snapshot.auditEvents.filter(
            (event) => event.periodId !== null && selected.has(event.periodId),
          )
        : [];
      const otherNames = snapshot.catalog.clients
        .filter((client) => client.id !== item.clientId)
        .map((client) => client.name);
      const redact = clientNameRedactor(otherNames);
      const pack = {
        version: 2,
        caseId,
        scope: request.scope,
        timeZone,
        periods: periods.map((period) => ({
          ...period,
          label: period.label && redact(period.label),
          demoApp: period.demoApp && redact(period.demoApp),
          demoWindowTitle: period.demoWindowTitle && redact(period.demoWindowTitle),
        })),
        sources: sources.map((source) => ({
          ...source,
          excerpt: source.excerpt && redact(source.excerpt),
          detectedMarker: source.detectedMarker && redact(source.detectedMarker),
        })),
        auditEvents: auditEvents.map((event) => ({
          ...event,
          actor: redact(event.actor),
          action: redact(event.action),
          before: redact(event.before),
          after: redact(event.after),
        })),
        options: request.options,
      };
      const payload = JSON.stringify(pack);
      const receipt = this.recordReceipt(payload, periodIds, request.options);
      return { export: receipt, payload };
    });
  }
  /** The receipt encoding is versioned independently of the exported payload. */
  recordReceipt(payload: string, periodIds: string[], options: string[]) {
    return this.port.transaction(() => {
      const sha256 = createHash("sha256").update(payload).digest("hex");
      const createdAt = this.now();
      const receipt = this.port.saveReceipt({ periodIds, options, sha256, createdAt });
      this.port.auditExport(sha256, createdAt);
      return receipt;
    });
  }
  invoiceCsv(id: number) {
    return this.port.transaction(() => {
      const invoice = this.port.invoice(id);
      if (!invoice) throw new AppError("not-found", "invoice not found");
      return { csv: formatInvoiceCsv(invoice) };
    });
  }
}
