import type { HistoryClaim, HistoryProposalInput } from "../../../src/contracts/history.js";
import { checkSettings } from "./config.js";
import {
  buildCaseRequest,
  callJev,
  interpretCase,
  parseAllowedFields,
  permittedObservation,
  type CaseRecord,
  type JevResponse,
} from "./jev.js";

type Judgment = { caseId: string | null; confidence: number | null };
type Choice = NonNullable<NonNullable<JevResponse["answers"]>["case_selection"]>;

/** Judge every distinct permitted context, preserving A -> B -> A changes. */
export async function proposeHistory(
  claim: HistoryClaim,
  env: NodeJS.ProcessEnv,
  fetcher: typeof fetch,
): Promise<HistoryProposalInput[]> {
  if (!env.TYPESAFE_API_KEY?.trim()) throw new Error("not-configured");
  let allowed: Set<string>;
  try {
    allowed = parseAllowedFields(env.JEV_ALLOWED_FIELDS);
  } catch {
    throw new Error("not-configured");
  }
  const settings = checkSettings(env);
  const end = Date.parse(claim.job.endAt);
  // A point at the exclusive range end cannot start a positive observation window.
  const sources = [...new Map(claim.sources.map((s) => [s.id, s])).values()]
    .filter(
      (s) =>
        Date.parse(s.recordedAt) >= Date.parse(claim.job.startAt) && Date.parse(s.recordedAt) < end,
    )
    .sort(
      (a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.id.localeCompare(b.id),
    );
  const contexts = new Map<string, Record<string, string>>();
  const sourceContexts = new Map<string, string>();
  for (const source of sources) {
    const context = permittedObservation(
      {
        frameId: null,
        timestampMs: Date.parse(source.recordedAt),
        timestampIso: source.recordedAt,
        app: source.appName ?? null,
        title: source.windowName ?? null,
        text: source.excerpt ?? "",
      },
      "observation",
      allowed,
      settings.maxTextChars,
    );
    if (!context) continue;
    const key = JSON.stringify(context);
    contexts.set(key, context);
    sourceContexts.set(source.id, key);
  }
  if (contexts.size > 2048) throw new Error("history-too-large");
  const cases: CaseRecord[] = claim.cases.map((c) => ({
    id: c.id,
    client_id: c.clientId,
    reference: c.reference,
    title: c.title,
    client_name: c.clientName,
  }));
  const judgments = new Map<string, Judgment>();
  const entries = [...contexts];
  // Independent choices share candidates in batches. Captures never enter the pipe chat.
  if (cases.length)
    for (let offset = 0; offset < entries.length; offset += 32) {
      const batch = entries.slice(offset, offset + 32);
      const base = buildCaseRequest(env.MODEL || "jev-latest", batch[0][1], cases, allowed, null);
      const questions: Record<string, typeof base.body.questions.case_selection> = {};
      const observations: Record<string, Record<string, string>> = {};
      for (let index = 0; index < batch.length; index++) {
        const name = `context_${index}`;
        observations[name] = batch[index][1];
        questions[name] = {
          ...base.body.questions.case_selection,
          instructions:
            base.body.questions.case_selection.instructions.replace(
              /\bobservation\b/g,
              `observations.${name}`,
            ) +
            " Judge only this historical observation. Application changes alone do not establish case changes. Do not infer completed work or duration.",
        };
      }
      const result = await callJev(
        {
          model: base.body.model,
          state: { observations, candidates: base.body.state.candidates },
          questions,
        },
        env.TYPESAFE_API_KEY,
        fetcher,
      );
      if (!result.ok) throw new Error("inference-failed");
      const answers = result.json.answers as Record<string, Choice> | undefined;
      for (let index = 0; index < batch.length; index++) {
        const answer = interpretCase(
          { model: result.json.model, answers: { case_selection: answers?.[`context_${index}`] } },
          base.alias,
          cases,
          settings.minConfidence,
        );
        if ("error" in answer) throw new Error("inference-failed");
        judgments.set(batch[index][0], {
          caseId: answer.status === "proposal" ? answer.case_id : null,
          confidence: answer.confidence,
        });
      }
    }
  const instants = new Map<string, typeof sources>();
  for (const source of sources) {
    const at = new Date(source.recordedAt).toISOString();
    const rows = instants.get(at) ?? [];
    rows.push(source);
    instants.set(at, rows);
  }
  const proposals: HistoryProposalInput[] = [];
  let previousUnknownContext: string | undefined;
  for (const [at, rows] of instants) {
    const results = rows.map(
      (source) =>
        judgments.get(sourceContexts.get(source.id) ?? "") ?? { caseId: null, confidence: null },
    );
    const caseIds = new Set(results.map((result) => result.caseId));
    const caseId = caseIds.size === 1 ? results[0].caseId : null;
    const confidence = caseId === null ? null : Math.min(...results.map((r) => r.confidence ?? 0));
    const unknownContext = JSON.stringify(
      [...new Set(rows.map((s) => sourceContexts.get(s.id) ?? s.appName ?? ""))].sort(),
    );
    const prior = proposals.at(-1);
    const gap = prior ? Date.parse(at) - Date.parse(prior.endedAt) > 60_000 : false;
    // The exclusive endpoint contains this observation; it does not estimate worked duration.
    const endedAt = new Date(Math.min(Date.parse(at) + 1, end)).toISOString();
    if (
      prior &&
      prior.caseId === caseId &&
      !gap &&
      (caseId !== null || previousUnknownContext === unknownContext)
    ) {
      prior.endedAt = endedAt;
      prior.sourceIds.push(...rows.map((s) => s.id));
      if (confidence !== null) prior.confidence = Math.min(prior.confidence ?? 1, confidence);
    } else {
      proposals.push({
        caseId,
        confidence,
        startedAt: at,
        endedAt,
        label: (rows[0].windowName || rows[0].appName || "Recorded context").slice(0, 300),
        sourceIds: rows.map((s) => s.id),
        hasGaps: gap,
      });
    }
    previousUnknownContext = unknownContext;
  }
  if (proposals.length > 100) throw new Error("history-too-large");
  return proposals;
}
