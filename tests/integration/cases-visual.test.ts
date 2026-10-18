import { activityPeriods, selectActivityPeriod } from "../../src/frontend/calculations/activity";
import { monthlyRecordedTime } from "../../src/frontend/calculations/comparison";
import { dayFees } from "../../src/frontend/calculations/billing";
import { expect, it } from "vitest";
import { memoryDb } from "../fixtures/database.js";
import { createApp } from "../../src/backend/api/app";
import { caseMetrics, clientMetrics } from "../../src/frontend/calculations/cases";
import type { CoreState, State } from "../../src/frontend/api/client";

it("excludes flat fees from Cases to-bill totals while retaining their pricing mode", async () => {
  const db = memoryDb();
  try {
    const app = createApp(db);
    const [state, periods, sources, billing] = await Promise.all([
      app.request("/api/catalog").then((response) => response.json()) as Promise<State>,
      app.request("/api/work-periods").then((response) => response.json()) as Promise<
        CoreState["periods"]
      >,
      app.request("/api/sources").then((response) => response.json()) as Promise<
        CoreState["sources"]
      >,
      app.request("/api/billing/state").then((response) => response.json()) as Promise<
        CoreState["billing"]
      >,
    ]);
    const core: CoreState = {
      periods,
      sources,
      billing,
      sessions: [],
      activeSession: null,
      questions: [],
      coverageGaps: [],
      auditEvents: [],
    };
    const flatFee = state.cases.find(
      (item) =>
        item.clientId ===
        state.clients.find((client) => client.name === "Telavrone Studio Inc.")?.id,
    )!;
    expect(flatFee.mode).toBe("flat_fee");
    expect(caseMetrics(state, core, flatFee).toBill).toBe(0);
    const telavrone = clientMetrics(state, core, flatFee.clientId);
    expect(telavrone.toBill).toBe(0);
    expect(telavrone.hourlyTime).toBe(0);
    const sarah = state.clients.find((client) => client.name === "Sarah Bennett")!;
    expect(clientMetrics(state, core, sarah.id).toBill).toBe(163750);
    const total = state.clients.reduce(
      (sum, client) => sum + clientMetrics(state, core, client.id).toBill,
      0,
    );
    expect(total).toBe(933950);
    const comparison = monthlyRecordedTime(state, core, "2026-10-16");
    expect(comparison.previous.roundedMinutes).toBe(1200);
  } finally {
    db.close();
  }
});

it("combines precise client durations across cases and exposes incomplete totals", async () => {
  const db = memoryDb();
  try {
    const app = createApp(db);
    const state = (await (await app.request("/api/catalog")).json()) as State;
    const periods = (await (await app.request("/api/work-periods")).json()) as CoreState["periods"];
    const first = state.cases.find((item) => item.mode === "hourly")!;
    const second = { ...first, id: 999, title: "Second case" };
    const core: CoreState = {
      periods: [
        {
          ...periods[0],
          id: "precise-a",
          caseId: String(first.id),
          detectedDurationMs: 20000,
          durationOverrideMs: 20000,
          billable: true,
          billingStatus: "unbilled",
          excluded: false,
        },
        {
          ...periods[0],
          id: "precise-b",
          caseId: String(second.id),
          detectedDurationMs: 20000,
          durationOverrideMs: 20000,
          billable: true,
          billingStatus: "unbilled",
          excluded: false,
        },
      ],
      sources: [],
      sessions: [],
      activeSession: null,
      questions: [],
      coverageGaps: [],
      auditEvents: [],
      billing: { invoices: [], lines: [], expenses: [] },
    };
    state.cases.push(second);
    expect(clientMetrics(state, core, first.clientId)).toMatchObject({
      time: 1,
      complete: true,
      unbilledSummary: { preciseDurationMs: 40000, roundedMinutes: 1, complete: true },
    });
    core.periods[1].durationOverrideMs = null;
    core.periods[1].detectedDurationMs = null;
    expect(clientMetrics(state, core, first.clientId)).toMatchObject({
      time: 1,
      complete: false,
    });
    expect(caseMetrics(state, core, second).complete).toBe(false);
  } finally {
    db.close();
  }
});

it("calculates Activity fees from corrected canonical duration and applied rates", async () => {
  const db = memoryDb();
  try {
    const app = createApp(db);
    const state = (await (await app.request("/api/catalog")).json()) as State;
    const periods = (await (await app.request("/api/work-periods")).json()) as CoreState["periods"];
    const item = state.cases.find((item) => item.mode === "hourly")!;
    item.hourlyRateCents = 30000;
    const period: CoreState["periods"][number] = {
      ...periods[0],
      id: "corrected",
      caseId: String(item.id),
      detectedDurationMs: 6480000,
      durationOverrideMs: 60000,
      excluded: false,
      billable: true,
      billingStatus: "unbilled" as const,
    };
    const core: CoreState = {
      periods: [period],
      sources: [],
      sessions: [],
      activeSession: null,
      questions: [],
      coverageGaps: [],
      auditEvents: [],
      billing: { invoices: [], lines: [], expenses: [] },
    };
    expect(dayFees(state, core, [period])).toMatchObject({
      cents: 500,
      complete: true,
      currency: state.settings.currency,
    });
    period.billingStatus = "billed";
    period.appliedHourlyRateCents = 24000;
    period.appliedCurrency = state.settings.currency;
    expect(dayFees(state, core, [period])).toMatchObject({
      cents: 400,
      complete: true,
      currency: state.settings.currency,
    });
    period.appliedCurrency = null;
    expect(dayFees(state, core, [period])).toMatchObject({ cents: null, complete: false });
  } finally {
    db.close();
  }
});

it("shows canonical UUID periods without substituting unrelated fixture evidence", async () => {
  const db = memoryDb();
  try {
    const app = createApp(db);
    const state = (await (await app.request("/api/catalog")).json()) as State;
    const periods = (await (await app.request("/api/work-periods")).json()) as CoreState["periods"];
    const uuid = "4bbd11eb-2bce-49aa-a782-1e9a639a3970";
    const canonical = {
      ...periods[0],
      id: uuid,
      label: "Canonical-only period",
      detectedDurationMs: null,
    };
    const core: CoreState = {
      periods: [canonical],
      sources: [],
      sessions: [],
      activeSession: null,
      questions: [],
      coverageGaps: [],
      auditEvents: [],
      billing: { invoices: [], lines: [], expenses: [] },
    };
    const rows = activityPeriods(state, core);
    expect(selectActivityPeriod(rows, uuid)).toMatchObject({
      id: uuid,
      label: "Canonical-only period",
    });
    expect(selectActivityPeriod(rows, "missing-period")).toBeUndefined();
    expect(activityPeriods(state, core, "", "missing-case")).toEqual([]);
  } finally {
    db.close();
  }
});

it("keeps opaque catalog IDs through summaries, rates, and Activity filters", async () => {
  const db = memoryDb();
  try {
    const app = createApp(db);
    const state = (await (await app.request("/api/catalog")).json()) as State;
    const periods = (await (await app.request("/api/work-periods")).json()) as CoreState["periods"];
    const owner = { ...state.clients[0], id: "client-opaque" };
    const item = {
      ...state.cases[0],
      id: "case-opaque",
      clientId: owner.id,
      mode: "hourly",
      hourlyRateCents: 30000,
    };
    state.clients = [owner];
    state.cases = [item];
    const period = {
      ...periods[0],
      id: "period-opaque",
      caseId: item.id,
      durationOverrideMs: 60000,
      excluded: false,
      billable: true,
      billingStatus: "unbilled" as const,
    };
    const core: CoreState = {
      periods: [period],
      sources: [],
      sessions: [],
      activeSession: null,
      questions: [],
      coverageGaps: [],
      auditEvents: [],
      billing: { invoices: [], lines: [], expenses: [] },
    };
    expect(clientMetrics(state, core, owner.id)).toMatchObject({ time: 1, toBill: 500 });
    expect(dayFees(state, core, [period])).toMatchObject({
      cents: 500,
      complete: true,
      currency: state.settings.currency,
    });
    expect(activityPeriods(state, core, owner.id, item.id)).toHaveLength(1);
  } finally {
    db.close();
  }
});
