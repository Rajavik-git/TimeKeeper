// Read-only views for the Screenpipe chat, plus the lawyer's answer to an unknown-folder question.
import {
  activeSession,
  getJson,
  postJson,
  toFailure,
  type ApiDeps,
  type Catalog,
  type Failure,
  type PendingQuestion,
  type Session,
  type WorkPeriod,
} from "./api.js";

export interface CaseSummary {
  id: string;
  clientId: string;
  clientName: string;
  reference: string;
  title: string;
}

export interface PeriodSummary {
  id: string;
  caseId: string | null;
  /** "<reference> - <title>", or null for an unresolved period. */
  case: string | null;
  startedAt: string;
  endedAt: string | null;
  /** Increases with each change of the period's case, for example the lawyer's answer. */
  assignmentRevision: number;
  timeValidated: boolean;
}

export interface QuestionSummary {
  questionId: string;
  periodId: string;
  status: PendingQuestion["status"];
  startedAt: string | null;
  endedAt: string | null;
}

export type CasesResult = { status: "ok"; cases: CaseSummary[] } | Failure;
export type PeriodsResult =
  { status: "ok"; session: Session | null; periods: PeriodSummary[] } | Failure;
export type QuestionsResult =
  { status: "ok"; session: Session | null; questions: QuestionSummary[] } | Failure;
export type AnswerResult = { status: "answered"; period: PeriodSummary } | Failure;

const byStart = <T extends { startedAt: string }>(a: T, b: T) =>
  Date.parse(a.startedAt) - Date.parse(b.startedAt);

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

/** Only active cases are candidates for matching. */
export async function listCases(deps: ApiDeps): Promise<CasesResult> {
  try {
    const catalog = await getJson<Catalog>(deps, "/api/catalog");
    const clients = new Map(catalog.clients.map((client) => [client.id, client.name]));
    return {
      status: "ok",
      cases: catalog.cases
        .filter((item) => item.status === "active")
        .map(({ id, clientId, reference, title }) => ({
          id,
          clientId,
          clientName: clients.get(clientId) ?? "",
          reference,
          title,
        })),
    };
  } catch (error) {
    return toFailure(error);
  }
}

/** The given session, else the active one, else the most recent one. */
async function targetSession(deps: ApiDeps, sessionId?: string): Promise<Session | null> {
  if (sessionId) return getJson<Session>(deps, `/api/sessions/${encodeURIComponent(sessionId)}`);
  const active = await activeSession(deps);
  if (active) return active;
  const sessions = await getJson<Session[]>(deps, "/api/sessions");
  return [...sessions].sort(byStart).at(-1) ?? null;
}

async function caseLabels(deps: ApiDeps): Promise<Map<string, string>> {
  const catalog = await getJson<Catalog>(deps, "/api/catalog");
  return new Map(catalog.cases.map((item) => [item.id, `${item.reference} - ${item.title}`]));
}

const summary = (period: WorkPeriod, labels: Map<string, string>): PeriodSummary => ({
  id: period.id,
  caseId: period.caseId,
  case: period.caseId ? (labels.get(period.caseId) ?? null) : null,
  startedAt: period.startedAt,
  endedAt: period.endedAt,
  assignmentRevision: period.assignmentRevision,
  timeValidated: period.timeValidated,
});

const sessionPeriods = async (deps: ApiDeps, sessionId: string) =>
  (await getJson<WorkPeriod[]>(deps, "/api/work-periods")).filter(
    (period) => period.sessionId === sessionId,
  );

/** Work periods of a session, oldest first, with the case reference. */
export async function listWorkPeriods(
  deps: ApiDeps,
  input: { sessionId?: unknown } = {},
): Promise<PeriodsResult> {
  try {
    const session = await targetSession(deps, optionalString(input.sessionId));
    if (!session) return { status: "ok", session: null, periods: [] };
    const [periods, labels] = await Promise.all([
      sessionPeriods(deps, session.id),
      caseLabels(deps),
    ]);
    return {
      status: "ok",
      session,
      periods: periods.map((period) => summary(period, labels)).sort(byStart),
    };
  } catch (error) {
    return toFailure(error);
  }
}

/** Questions of a session (pending by default) with their period's times. */
export async function listQuestions(
  deps: ApiDeps,
  input: { sessionId?: unknown; status?: unknown } = {},
): Promise<QuestionsResult> {
  const wanted = input.status === undefined ? "pending" : optionalString(input.status);
  try {
    const session = await targetSession(deps, optionalString(input.sessionId));
    if (!session) return { status: "ok", session: null, questions: [] };
    const [questions, periods] = await Promise.all([
      getJson<PendingQuestion[]>(deps, "/api/questions"),
      sessionPeriods(deps, session.id),
    ]);
    const periodById = new Map(periods.map((period) => [period.id, period]));
    return {
      status: "ok",
      session,
      questions: questions
        .filter((q) => q.sessionId === session.id && (wanted === "all" || q.status === wanted))
        .map((q) => ({
          questionId: q.questionId,
          periodId: q.periodId,
          status: q.status,
          startedAt: periodById.get(q.periodId)?.startedAt ?? null,
          endedAt: periodById.get(q.periodId)?.endedAt ?? null,
        })),
    };
  } catch (error) {
    return toFailure(error);
  }
}

/**
 * Assigns the case the lawyer chose to the question's period. The API binds the answer to the
 * period's assignment revision and refuses a stale question instead of overwriting a newer case.
 */
export async function answerQuestion(
  deps: ApiDeps,
  input: { questionId?: unknown; caseId?: unknown },
): Promise<AnswerResult> {
  const questionId = optionalString(input.questionId);
  const caseId = optionalString(input.caseId);
  if (!questionId || !caseId)
    return {
      status: "error",
      error: "invalid-request",
      message: "questionId and caseId (from list_cases) are required",
    };
  try {
    const question = (await getJson<PendingQuestion[]>(deps, "/api/questions")).find(
      (q) => q.questionId === questionId,
    );
    if (!question) return { status: "error", error: "not-found", message: "question not found" };
    const response = await postJson<WorkPeriod | { error: string; message: string }>(
      deps,
      "/api/questions/answer",
      {
        questionId,
        sessionId: question.sessionId,
        periodId: question.periodId,
        expectedAssignmentRevision: question.expectedAssignmentRevision,
        caseId,
        responseCommandId: `chat-answer-${deps.newId()}`,
      },
    );
    // 202 carries a business refusal that is still open (for example a billed period).
    if ("error" in response.body)
      return { status: "error", error: response.body.error, message: response.body.message };
    return { status: "answered", period: summary(response.body, await caseLabels(deps)) };
  } catch (error) {
    return toFailure(error);
  }
}
