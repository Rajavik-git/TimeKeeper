import { useEffect, useState } from "react";
import type { components } from "../../../../contracts/generated";
import { api } from "../../../api/client";
import type { CoreState } from "../../../api/client";
import type { Period } from "../../../calculations/billing";
import { timeValidationUnavailable } from "../../../shared/lib/timeValidation";
import type { nativePillView } from "../lib/nativePillView";
type Feedback = {
  id: string;
  text: string;
  undoToken: string | null;
  undoExpiresAt: string | null;
  showText: boolean;
};
function message(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string")
    return error.message;
  return fallback;
}
type DecisionResult = components["schemas"]["PillDecisionResult"];
/** A 202 reply means the case or duration is still missing; only 200 carries an undo token. */
function decisionResult(
  response: { data?: unknown; error?: unknown },
  fallback: string,
): DecisionResult {
  const data = response.data as Partial<DecisionResult> | undefined;
  if (
    response.error ||
    !data?.period ||
    typeof data.undoToken !== "string" ||
    typeof data.undoExpiresAt !== "string" ||
    !Number.isFinite(Date.parse(data.undoExpiresAt))
  )
    throw Error(message(response.error ?? response.data, fallback));
  return data as DecisionResult;
}

export function usePillCommands({
  workspaceState,
  today,
  question,
  questionPeriod,
  caseById,
  refresh,
  setExpanded,
  setRecent,
  setSelectedCase,
  setDismissedQuestion,
}: Pick<ReturnType<typeof nativePillView>, "question" | "questionPeriod" | "caseById"> & {
  workspaceState: Omit<CoreState, "auditEvents"> | undefined;
  today: string;
  refresh: () => Promise<void>;
  setExpanded: (value: boolean) => void;
  setRecent: (value: null) => void;
  setSelectedCase: (value: string) => void;
  setDismissedQuestion: (value: string) => void;
}) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const feedbackId = feedback?.id;
  const feedbackExpiresAt = feedback?.undoExpiresAt ?? null;
  useEffect(() => {
    if (!feedbackId) return;
    const textTimer = window.setTimeout(
      () =>
        setFeedback((value) => {
          if (value?.id !== feedbackId) return value;
          return value.undoToken ? { ...value, showText: false } : null;
        }),
      2000,
    );
    const undoTimer = window.setTimeout(
      () =>
        setFeedback((value) => {
          if (value?.id !== feedbackId) return value;
          return value.showText ? { ...value, undoToken: null } : null;
        }),
      feedbackExpiresAt ? Math.max(0, Date.parse(feedbackExpiresAt) - Date.now()) : 2000,
    );
    return () => {
      window.clearTimeout(textTimer);
      window.clearTimeout(undoTimer);
    };
  }, [feedbackId, feedbackExpiresAt]);
  const confirmInline = (
    text: string,
    undoToken: string | null,
    undoExpiresAt: string | null = null,
  ) =>
    setFeedback({
      id: crypto.randomUUID(),
      text,
      undoToken: undoExpiresAt && Date.parse(undoExpiresAt) > Date.now() ? undoToken : null,
      undoExpiresAt,
      showText: true,
    });
  const validate = async (periods: Period[]) => {
    setBusy(true);
    setError("");
    try {
      const ready = periods.filter((period) => timeValidationUnavailable(period, today) === null);
      if (ready.length !== periods.length || !ready.length)
        throw Error("Only finished periods from past local calendar days can be validated.");
      const response = await api.POST("/api/pill/decision", {
        body: {
          kind: "validate",
          periodIds: ready.map((p) => p.id),
          expectedEffectiveRevisions: Object.fromEntries(
            ready.map((period) => [period.id, period.effectiveRevision]),
          ),
        },
      });
      const decided = decisionResult(
        response,
        "A case and duration are required before validation.",
      );
      setExpanded(false);
      setRecent(null);
      confirmInline(
        ready.length === 1 ? "Period validated" : `${ready.length} periods validated`,
        decided.undoToken,
        decided.undoExpiresAt,
      );
      await refresh();
    } catch (cause) {
      setError(message(cause, "Unable to validate."));
    } finally {
      setBusy(false);
    }
  };
  const assign = async (periodId: string, caseId: string) => {
    const period = workspaceState?.periods.find((p) => p.id === periodId);
    if (!period) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.POST("/api/pill/decision", {
        body: {
          kind: "assign",
          periodId,
          caseId,
          expectedAssignmentRevision: period.assignmentRevision,
        },
      });
      const decided = decisionResult(response, "Unable to assign this case.");
      setSelectedCase("");
      setExpanded(false);
      setRecent(null);
      if (question?.periodId === periodId) setDismissedQuestion(question.questionId);
      confirmInline(
        `Assigned to ${caseById(caseId)?.title ?? "case"}`,
        decided.undoToken,
        decided.undoExpiresAt,
      );
      await refresh();
    } catch (cause) {
      setError(message(cause, "Unable to assign this case."));
    } finally {
      setBusy(false);
    }
  };
  const excludeQuestion = async () => {
    if (!questionPeriod) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.POST("/api/pill/decision", {
        body: {
          kind: "exclude",
          periodId: questionPeriod.id,
          expectedAssignmentRevision: questionPeriod.assignmentRevision,
          expectedEffectiveRevision: questionPeriod.effectiveRevision,
        },
      });
      const decided = decisionResult(response, "Unable to leave this period out.");
      setSelectedCase("");
      setExpanded(false);
      setRecent(null);
      if (question?.questionId) setDismissedQuestion(question.questionId);
      confirmInline("Marked as not client work", decided.undoToken, decided.undoExpiresAt);
      await refresh();
    } catch (cause) {
      setError(message(cause, "Unable to leave this period out."));
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    if (
      !feedback?.undoToken ||
      !feedback.undoExpiresAt ||
      Date.parse(feedback.undoExpiresAt) <= Date.now() ||
      busy
    )
      return;
    setBusy(true);
    setError("");
    try {
      const response = await api.POST("/api/pill/undo", {
        body: { undoToken: feedback.undoToken },
      });
      if (response.error)
        throw Error(message(response.error, "This choice can no longer be undone."));
      setRecent(null);
      setExpanded(false);
      confirmInline("Choice undone", null);
      await refresh();
    } catch (cause) {
      setError(message(cause, "This choice can no longer be undone."));
      setFeedback(null);
    } finally {
      setBusy(false);
    }
  };

  return { feedback, error, setError, busy, validate, assign, excludeQuestion, undo };
}
