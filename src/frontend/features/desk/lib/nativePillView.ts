import { calendarDay } from "../../../../shared/dates";
import type { State, CoreState } from "../../../api/client";
import {
  configuredRate,
  dayFees,
  effectiveMs,
  formatNearestMinuteDuration,
} from "../../../calculations/billing";
import { money } from "../../../shared/format";
import { timeValidationUnavailable } from "../../../shared/lib/timeValidation";
export function nativePillView(
  catalogState: State | undefined,
  workspaceState: Omit<CoreState, "auditEvents"> | undefined,
  today: string,
  dismissedQuestion: string | null,
) {
  const active = workspaceState?.activeSession ?? null;
  const current = workspaceState?.periods.find(
    (p) => p.sessionId === active?.id && p.endedAt === null,
  );
  const caseById = (id: string | null | undefined) =>
    catalogState?.cases.find((item) => item.id === id);
  const caseItem = caseById(current?.caseId);
  const owner = catalogState?.clients.find((client) => client.id === caseItem?.clientId);
  const setting = catalogState?.settings;
  const currency = setting?.currency ?? "USD";
  const pending = (
    workspaceState?.periods.filter((p) => !p.excluded && (!p.timeValidated || !p.caseId)) ?? []
  ).sort((a, b) => {
    const readyA = timeValidationUnavailable(a, today) === null;
    const readyB = timeValidationUnavailable(b, today) === null;
    return (
      Number(readyB) - Number(readyA) ||
      (readyA && readyB
        ? effectiveMs(a)! - effectiveMs(b)!
        : a.startedAt.localeCompare(b.startedAt))
    );
  });
  const readyPending = pending.filter(
    (period) => timeValidationUnavailable(period, today) === null,
  );
  const question = workspaceState?.questions.find(
    (q) => q.sessionId === active?.id && q.status === "pending",
  );
  const questionPeriod = workspaceState?.periods.find((p) => p.id === question?.periodId);
  const showQuestion = !!question && !!questionPeriod && !questionPeriod.excluded;
  const duringCall = /call|phone|video/i.test(current?.label ?? "");
  const showQuestionNotice =
    showQuestion &&
    !!setting?.notifications &&
    question?.questionId !== dismissedQuestion &&
    !(setting.pillWithholdCalls && duringCall);
  const periodMs = current ? effectiveMs(current) : null;
  const hourlyRate = catalogState && caseItem ? configuredRate(catalogState, caseItem.id) : null;
  const currentFees =
    catalogState && workspaceState && current
      ? dayFees(
          current.billingStatus === "billed" && current.appliedCurrency
            ? {
                ...catalogState,
                settings: { ...catalogState.settings, currency: current.appliedCurrency },
              }
            : catalogState,
          [current],
        )
      : null;
  const amount =
    currentFees?.cents != null &&
    currentFees.currency &&
    (current?.billingStatus === "billed" || hourlyRate?.origin !== "flat_fee")
      ? money(currentFees.cents, currentFees.currency)
      : "—";
  const barValue =
    setting?.pillDisplay === "time"
      ? current
        ? formatNearestMinuteDuration(periodMs)
        : "—"
      : amount;
  const day =
    workspaceState?.periods.filter((p) => calendarDay(p.startedAt) === today && !p.excluded) ?? [];
  const todayFees = catalogState && workspaceState ? dayFees(catalogState, day) : null;
  const todayAmount =
    todayFees?.cents != null && todayFees.currency
      ? money(todayFees.cents, todayFees.currency)
      : "—";

  return {
    active,
    current,
    caseById,
    caseItem,
    owner,
    setting,
    currency,
    pending,
    readyPending,
    question,
    questionPeriod,
    showQuestion,
    showQuestionNotice,
    periodMs,
    hourlyRate,
    amount,
    barValue,
    todayAmount,
  };
}
