import { useState } from "react";
import { AssignmentOrigin, QuestionStatus } from "../../../../contracts/states.generated";
import { api, type CoreState, type EntityId, type ScreenProps } from "../../../api/client";
import { validatePeriods as runValidation, validationMessage } from "../../../api/validatePeriods";
import { showToast } from "../../../shared/components/Toast/Toast";
import type { DayData } from "./useDayResources";
type Period = CoreState["periods"][number];
type Props = Pick<ScreenProps, "action" | "refresh"> & {
  data: DayData | null;
  onValidatedQuestion: () => void;
};
/** All day assignment and approval commands use the displayed resource's revisions. */
export function useDayCommands({ data, action, refresh, onValidatedQuestion }: Props) {
  const periods = data?.periods ?? [];
  const [validating, setValidating] = useState(false);
  const questionFor = (periodId: string) =>
    data?.questions.find(
      (question) => question.periodId === periodId && question.status === QuestionStatus.Pending,
    );
  const assign = (periodId: string, caseId: EntityId) => {
    const period = periods.find((item) => item.id === periodId);
    if (!period) return;
    const question = questionFor(periodId);
    if (question)
      return action(
        api.POST("/api/questions/answer", {
          body: {
            questionId: question.questionId,
            sessionId: question.sessionId,
            periodId,
            expectedAssignmentRevision: question.expectedAssignmentRevision,
            caseId: String(caseId),
            responseCommandId: crypto.randomUUID(),
          },
        }),
      );
    return action(
      api.POST("/api/work-periods/{id}/assignment", {
        params: { path: { id: periodId } },
        body: {
          caseId: String(caseId),
          expectedAssignmentRevision: period.assignmentRevision,
          origin: AssignmentOrigin.Lawyer,
        },
      }),
    );
  };
  const validate = async (target: Period[], focusQuestion = false) => {
    if (validating || !target.length) return;
    setValidating(true);
    showToast(`Validating ${target.length} period${target.length === 1 ? "" : "s"}…`);
    try {
      const result = await runValidation(target, refresh);
      showToast(
        validationMessage(result.successful, target.length, result.refreshFailed, result.stale),
      );
      if (focusQuestion && result.successful) onValidatedQuestion();
    } finally {
      setValidating(false);
    }
  };
  return { assign, validate, validating };
}
