import type { components } from "../../contracts/generated.js";
import {
  calendarDay,
  dayBounds,
  isCalendarDay,
  isTimeZone,
  systemTimeZone,
} from "../../shared/dates.js";
import { AppError } from "./errors.js";
import type { CatalogService } from "./catalog.js";
import type { TimeKeeperService } from "./service.js";

export interface WorkspaceQuery {
  date?: string;
  from?: string;
  to?: string;
  timeZone?: string;
  sessionId?: string;
  clientId?: string;
  caseId?: string;
}

export function calendarFilter(query: WorkspaceQuery) {
  const { date, from, to } = query;
  const timeZone = query.timeZone ?? systemTimeZone();
  if (!isTimeZone(timeZone)) throw new AppError("invalid-request", "invalid timeZone");
  for (const [name, value] of Object.entries({ date, from, to })) {
    if (value !== undefined && !isCalendarDay(value))
      throw new AppError("invalid-request", `${name} must be a valid calendar day`);
  }
  if (from && to && from > to)
    throw new AppError("invalid-request", "from must be on or before to");
  return (startedAt: string) => {
    const day = calendarDay(startedAt, timeZone);
    return (!date || day === date) && (!from || day >= from) && (!to || day <= to);
  };
}

export function periodQuery(query: WorkspaceQuery) {
  calendarFilter(query);
  const timeZone = query.timeZone ?? systemTimeZone();
  let from = query.from;
  let to = query.to;
  if (query.date) {
    if (!from || query.date > from) from = query.date;
    if (!to || query.date < to) to = query.date;
  }
  return {
    startedFrom: from ? dayBounds(from, timeZone).startAt : undefined,
    startedBefore: to ? dayBounds(to, timeZone).endAt : undefined,
    sessionId: query.sessionId,
    clientId: query.clientId,
    caseId: query.caseId,
  };
}

type WorkspaceCore = Pick<
  TimeKeeperService,
  "queryPeriods" | "activeSession" | "listSessions" | "allSources" | "allQuestions" | "coverageGaps"
>;

/** Read catalogue and work records consistently without exposing storage to HTTP handlers. */
export class WorkspaceService {
  constructor(
    private readonly transaction: <T>(work: () => T) => T,
    private readonly core: WorkspaceCore,
    private readonly catalog: Pick<CatalogService, "getCatalog">,
    private readonly billingState: () => components["schemas"]["BillingState"],
  ) {}

  snapshot(query: WorkspaceQuery = {}): components["schemas"]["WorkspaceSnapshot"] {
    return this.transaction(() => {
      const periods = this.core.queryPeriods(periodQuery(query));
      const matchesDay = calendarFilter(query);
      const periodIds = new Set(periods.map((period) => period.id));
      const scoped = [
        query.date,
        query.from,
        query.to,
        query.clientId,
        query.caseId,
        query.sessionId,
      ].some((value) => value !== undefined);
      return {
        catalogState: this.catalog.getCatalog(),
        workspaceState: {
          activeSession: this.core.activeSession(),
          sessions: this.core.listSessions(),
          periods,
          sources: this.core
            .allSources()
            .filter(
              (source) =>
                !scoped || (source.workPeriodId !== null && periodIds.has(source.workPeriodId)),
            ),
          questions: this.core
            .allQuestions()
            .filter((question) => !scoped || periodIds.has(question.periodId)),
          coverageGaps: this.core.coverageGaps().filter((gap) => matchesDay(gap.startedAt)),
          billing: this.billingState(),
        },
      };
    });
  }
}
