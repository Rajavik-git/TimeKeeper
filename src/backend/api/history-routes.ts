import { Hono } from "hono";
import type { HistoryService } from "../application/history.js";
import type {
  HistoryAcceptInput,
  HistoryGenerateInput,
  HistoryFailure,
  HistoryProposalInput,
} from "../../contracts/history.js";
import { apiError } from "./errors.js";

/** Public projections exclude workflow claims; only claim receives the private token. */
export function historyRoutes(history: HistoryService): Hono {
  const app = new Hono();
  app.onError(apiError);
  app.get("/history", (c) => c.json(history.state(c.req.query("sessionId"))));
  app.post("/history/generate", async (c) =>
    c.json(await history.generate(await c.req.json<HistoryGenerateInput>())),
  );
  app.get("/history/jobs/:id", (c) => c.json(history.job(c.req.param("id"))));
  app.post("/history/claim", (c) => c.json(history.claim()));
  app.post("/history/jobs/:id/complete", async (c) => {
    const input = await c.req.json<{ claimId: string; proposals: HistoryProposalInput[] }>();
    return c.json(history.complete(c.req.param("id"), input.claimId, input.proposals));
  });
  app.post("/history/jobs/:id/fail", async (c) => {
    const input = await c.req.json<{ claimId: string; error: HistoryFailure }>();
    return c.json(history.fail(c.req.param("id"), input.claimId, input.error));
  });
  app.post("/history/proposals/:id/accept", async (c) =>
    c.json(history.accept(c.req.param("id"), await c.req.json<HistoryAcceptInput>())),
  );
  app.post("/history/proposals/:id/reject", async (c) => {
    const input = await c.req.json<{ expectedRevision: number }>();
    return c.json(history.reject(c.req.param("id"), input.expectedRevision));
  });
  return app;
}
