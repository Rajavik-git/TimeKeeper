/** Immutable API snapshot taken before inference starts. */
export interface TransitionContext {
  sessionId: string | null;
  period: { id: string; assignmentRevision: number; caseId: string | null } | null;
}

export function captureTransitionContext(status: {
  activeSession: { id: string };
  activePeriod?: TransitionContext["period"];
}): TransitionContext {
  const period = status.activePeriod;
  return {
    sessionId: status.activeSession.id,
    period: period
      ? { id: period.id, assignmentRevision: period.assignmentRevision, caseId: period.caseId }
      : null,
  };
}

export function transitionInput(
  context: TransitionContext,
  transitionAt: string,
  caseId: string | null,
) {
  return {
    sessionId: context.sessionId,
    transitionAt,
    caseId,
    expectedActivePeriodId: context.period?.id ?? null,
    expectedAssignmentRevision: context.period?.assignmentRevision ?? null,
  };
}
