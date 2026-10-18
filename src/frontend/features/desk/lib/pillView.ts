import {
  BillingStatus,
  CaseStatus,
  PillDisplay,
  QuestionStatus,
  RateOrigin,
} from "../../../../contracts/states.generated";
import { calendarTime } from "../../../../shared/dates";
import type { CoreState, State } from "../../../api/client";
import { configuredRate, effectiveMs, formatPreciseDuration } from "../../../calculations/billing";
import { money } from "../../../shared/format";
import { pillDisplayLabels } from "../../../shared/presentation/catalog";

/** Both windows display the same application state and saved display preference. */
type PillWorkspace = Pick<CoreState, "activeSession" | "periods" | "questions">;

export function pillView(state?: State, workspace?: PillWorkspace, offline = false) {
  const active = workspace?.activeSession;
  const current = workspace?.periods.find(
    (period) => period.sessionId === active?.id && period.endedAt === null,
  );
  const item = state?.cases.find((caseItem) => caseItem.id === current?.caseId);
  const owner = state?.clients.find((client) => client.id === item?.clientId);
  const display = state?.settings.pillDisplay ?? PillDisplay.Fees;
  const duration = current ? effectiveMs(current) : null;
  const rate = state && item ? configuredRate(state, item.id) : null;
  const billed = current?.billingStatus === BillingStatus.Billed;
  const rateCents = billed ? current.appliedHourlyRateCents : rate?.rateCents;
  const currency = billed ? current.appliedCurrency : state?.settings.currency;
  const amount =
    duration !== null && rate && rate.origin !== RateOrigin.FlatFee && rateCents != null && currency
      ? money(Math.round((duration * rateCents) / 3600000), currency)
      : "—";
  const pending =
    workspace?.periods.filter(
      (period) => period.sessionId === active?.id && !period.excluded && !period.timeValidated,
    ).length ?? 0;
  const question = workspace?.questions.find(
    (entry) => entry.sessionId === active?.id && entry.status === QuestionStatus.Pending,
  );
  const labelSuggestsCall = Boolean(current && /call|phone|video/i.test(current.label));
  const notice =
    state?.settings.notifications &&
    question &&
    (!state.settings.pillWithholdCalls || !labelSuggestsCall)
      ? "A work period needs a case assignment"
      : null;
  return {
    active,
    current,
    offline,
    pending,
    notice,
    clientLabel: offline
      ? "Cannot reach TimeKeeper"
      : !active
        ? "No active session"
        : display === PillDisplay.Case
          ? (item?.title ?? "No current case")
          : (owner?.name ?? "Session active"),
    metricTitle:
      display === PillDisplay.Case ? undefined : `${pillDisplayLabels[display]} for this period`,
    metricValue: offline
      ? "—"
      : display === PillDisplay.Case
        ? ""
        : display === PillDisplay.Time
          ? duration === null
            ? "—"
            : formatPreciseDuration(duration)
          : amount,
    caseTitle: active ? (item?.title ?? "No current case") : "No active session",
    ownerLabel: owner?.name ?? "Unassigned",
    sessionTime: active ? calendarTime(active.startedAt) : null,
    periodTime: current ? calendarTime(current.startedAt) : "—",
    periodDuration: duration === null ? "Unknown" : formatPreciseDuration(duration),
    caseId: current?.caseId ?? "",
    assignmentDisabled: !current || billed,
    cases: state?.cases.filter((entry) => entry.status === CaseStatus.Active) ?? [],
  };
}

export type PillView = ReturnType<typeof pillView>;
