import { Hono } from "hono";
import { cors } from "hono/cors";
import { updateTimeEntry } from "../application/assignment.js";
import { assignmentPort } from "../adapters/sqlite/assignment.js";
import { nextCaseReference } from "../domain/nomenclature.js";
import {
  defaultWeights,
  decision,
  type MarkerType,
} from "../domain/recognition.js";
import { recognizeBlock } from "../adapters/sqlite/recognition.js";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  all,
  one,
  insert,
  update,
  audit,
  transaction,
  state,
  type Table,
  reprice,
  rate,
  priceLine,
  reset,
} from "../adapters/sqlite/repository.js";

const demoDate = "2026-10-16";
const id = (s: string) => {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) throw Error("Invalid ID");
  return n;
};
const required = (value: unknown, label: string) => {
  if (value === null || value === undefined || value === "")
    throw Error(`${label} is required`);
  return value;
};
const row = (db: DatabaseSync, t: Table, n: number) => {
  const v = one(db, t, n);
  if (!v) throw Error("Not found");
  return v;
};
export function createApp(db: DatabaseSync) {
  const app = new Hono();
  const allowedOrigins = new Set([
    "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost",
    "http://127.0.0.1:5173", "http://localhost:5173",
  ]);
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("Origin");
    if (origin && !allowedOrigins.has(origin)) return c.json({ error: "Origin not allowed" }, 403);
    return cors({ origin: origin ?? "", allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"], allowHeaders: ["Content-Type"] })(c, next);
  });
  app.onError((err, c) =>
    c.json({ error: err.message }, err.message === "Not found" ? 404 : 400),
  );
  app.get("/api/state", (c) => c.json(state(db)));

  app.post("/api/demo/reset", (c) =>
    c.json(
      transaction(db, () => {
        reset(db);
        audit(db, "Demo reset");
        return state(db);
      }),
    ),
  );
  app.patch("/api/time-entries/:id", async (c) => {
    const entryId = id(c.req.param("id"));
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(updateTimeEntry(assignmentPort(db), entryId, body));
  });
  app.post("/api/day/approve", async (c) => {
    const { date } = await c.req.json<{ date: string }>();
    return c.json(
      transaction(db, () => {
        let approved = 0,
          unassigned = 0;
        for (const l of all(db, "time_entry").filter((x) => x.date === date)) {
          if (!l.matter_id) {
            unassigned++;
            continue;
          }
          if (l.review_status !== "approved") {
            update(db, "time_entry", Number(l.id), {
              review_status: "approved",
            });
            audit(
              db,
              "Time entry approved",
              "to_review",
              "approved",
              Number(l.id),
              l.block_id as number | null,
            );
            approved++;
          }
        }
        return { approved, unassigned };
      }),
    );
  });
  app.post("/api/matters/:id/approve", (c) => {
    const n = id(c.req.param("id"));
    row(db, "matter", n);
    return c.json(
      transaction(db, () => {
        let approved = 0;
        for (const l of all(db, "time_entry").filter(
          (x) => x.matter_id === n && x.review_status !== "approved",
        )) {
          update(db, "time_entry", Number(l.id), { review_status: "approved" });
          audit(
            db,
            "Time entry approved",
            "to_review",
            "approved",
            Number(l.id),
            l.block_id as number | null,
          );
          approved++;
        }
        return { approved };
      }),
    );
  });
  app.post("/api/time-entries/:id/discard", (c) => {
    const l = row(db, "time_entry", id(c.req.param("id")));
    if (l.billing_status === "billed" || !l.block_id)
      throw Error("Block cannot be discarded");
    return c.json(
      transaction(db, () => {
        const b = update(db, "block", Number(l.block_id), {
          state: "discarded",
        });
        db.prepare("DELETE FROM time_entry WHERE id=?").run(Number(l.id));
        audit(
          db,
          "Block discarded",
          String(l.label),
          "not counted",
          null,
          Number(l.block_id),
        );
        return b;
      }),
    );
  });
  app.post("/api/blocks/:id/recover", (c) => {
    const b = row(db, "block", id(c.req.param("id")));
    if (
      b.state !== "discarded" ||
      all(db, "time_entry").some((l) => l.block_id === b.id)
    )
      throw Error("Block cannot be recovered");
    return c.json(
      transaction(db, () => {
        const task = all(db, "task").find((t) => t.code === "RECH")!;
        const l = insert(db, "time_entry", {
          block_id: b.id,
          matter_id: null,
          task_id: task.id,
          date: b.date,
          tenths_of_hour: Math.max(1, Math.round(Number(b.minutes) / 6)),
          label: `${b.app} · ${b.window_title}`,
          amount_cents: 0,
          rate_origin: "base",
          billable: true,
          reason: null,
          review_status: "to_review",
          billing_status: "to_bill",
          invoice_id: null,
        });
        update(db, "block", Number(b.id), { state: "to_check" });
        reprice(db);
        audit(
          db,
          "Block recovered",
          "",
          "to assign",
          Number(l.id),
          Number(b.id),
        );
        return row(db, "time_entry", Number(l.id));
      }),
    );
  });
  app.post("/api/time-entries/manual", async (c) => {
    const b = await c.req.json<Record<string, unknown>>();
    return c.json(
      transaction(db, () => {
        required(b.matter_id, "Case");
        required(b.task_id, "Task");
        if (!Number.isInteger(b.tenths_of_hour) || Number(b.tenths_of_hour) < 1)
          throw Error("Invalid duration");
        const l = insert(db, "time_entry", {
          block_id: null,
          matter_id: b.matter_id,
          task_id: b.task_id,
          date: b.date ?? demoDate,
          tenths_of_hour: b.tenths_of_hour,
          label: b.label || row(db, "task", Number(b.task_id)).label,
          amount_cents: 0,
          rate_origin: rate(db, Number(b.matter_id)).origin,
          billable: true,
          reason: null,
          review_status: "approved",
          billing_status: "to_bill",
          invoice_id: null,
        });
        reprice(db);
        audit(db, "Off-screen time added", "", String(l.label), Number(l.id));
        return row(db, "time_entry", Number(l.id));
      }),
    );
  });
  app.post("/api/matters", async (c) => {
    const b = await c.req.json<Record<string, unknown>>();
    return c.json(
      transaction(db, () => {
        required(b.client_id, "Client");
        required(b.title, "Title");
        const d = insert(db, "matter", {
          client_id: b.client_id,
          reference: (() => {
            const client = row(db, "client", Number(b.client_id));
            const year = new Date().getFullYear();
            const last = db
              .prepare(
                "SELECT COALESCE(MAX(CAST(substr(reference,6,3) AS INTEGER)),0) AS last FROM matter WHERE substr(reference,1,4)=?",
              )
              .get(String(year)) as { last: number };
            return nextCaseReference(year, Number(last.last), String(client.code));
          })(),
          title: String(b.title).trim(),
          category: "N/A",
          case_number: "N/A",
          opposing_party: b.opposing_party || "N/A",
          mode: "hourly",
          own_rate_cents: null,
          flat_fee_cents: null,
          hour_cap: null,
          success_fee_percent: null,
          budget_cents: null,
          status: "open",
          opened_on: new Date().toISOString().slice(0, 10),
        });
        if (b.opposing_party)
          insert(db, "marker", {
            matter_id: d.id,
            type: "opposing_party",
            value: b.opposing_party,
            weight: defaultWeights.opposing_party,
            learned: false,
          });
        audit(db, "Case created", "", String(d.title));
        return d;
      }),
    );
  });
  app.post("/api/markers", async (c) => {
    const b = await c.req.json<Record<string, unknown>>();
    return c.json(
      transaction(db, () => {
        const r = insert(db, "marker", {
          matter_id: b.matter_id,
          type: b.type,
          value: required(b.value, "Value"),
          weight: defaultWeights[b.type as MarkerType],
          learned: false,
        });
        audit(db, "Marker added", "", String(r.value));
        return r;
      }),
    );
  });
  app.delete("/api/markers/:id", (c) => {
    const r = row(db, "marker", id(c.req.param("id")));
    return c.json(
      transaction(db, () => {
        db.prepare("DELETE FROM marker WHERE id=?").run(Number(r.id));
        audit(db, "Marker removed", String(r.value));
        return { deleted: true };
      }),
    );
  });
  app.post("/api/expenses", async (c) => {
    const b = await c.req.json<Record<string, unknown>>();
    return c.json(
      transaction(db, () => {
        const f = insert(db, "expense", {
          matter_id: b.matter_id,
          date: b.date ?? demoDate,
          label: required(b.label, "Label"),
          type: b.type,
          amount_cents: b.amount_cents,
          invoice_id: null,
        });
        audit(db, "Expense added", "", JSON.stringify(f));
        return f;
      }),
    );
  });
  app.delete("/api/expenses/:id", (c) => {
    const f = row(db, "expense", id(c.req.param("id")));
    if (f.invoice_id) throw Error("Expense already billed");
    return c.json(
      transaction(db, () => {
        db.prepare("DELETE FROM expense WHERE id=?").run(Number(f.id));
        audit(db, "Expense removed", JSON.stringify(f));
        return { deleted: true };
      }),
    );
  });
  app.post("/api/invoices", async (c) => {
    const body = await c.req.json<{
      matter_id: number;
      type: "deposit" | "final";
    }>();
    const d = row(db, "matter", body.matter_id);
    if (!["deposit", "final"].includes(body.type)) throw Error("Invalid type");
    return c.json(
      transaction(db, () => {
        reprice(db);
        const client = row(db, "client", Number(d.client_id)),
          cab = row(db, "firm", 1),
          p = row(db, "setting", 1),
          r = rate(db, Number(d.id));
        const lines = all(db, "time_entry").filter(
          (l) =>
            l.matter_id === d.id && l.billable && l.billing_status !== "billed",
        );
        if (lines.some((l) => l.review_status !== "approved"))
          throw Error("Approve all entries first");
        const expenses = all(db, "expense").filter(
          (f) => f.matter_id === d.id && !f.invoice_id,
        );
        const flatFeeDue =
          r.flat_fee &&
          body.type === "final" &&
          !all(db, "invoice").some(
            (f) => f.matter_id === d.id && f.type === "final",
          );
        let ht = 0,
          debours = 0;
        const num =
          String(p.invoice_prefix) + String(p.next_number).padStart(4, "0");
        const fid = Number(
          db.prepare("SELECT COALESCE(MAX(id),0)+1 AS id FROM invoice").get()
            ?.id,
        );
        const frozen: Record<string, unknown>[] = [];
        if (flatFeeDue) {
          frozen.push({
            invoice_id: fid,
            origin: "flat_fee",
            origin_id: d.id,
            label: `Agreed flat fee · ${d.title}`,
            tenths_of_hour: 0,
            rate_cents: 0,
            amount_cents: d.flat_fee_cents,
            vat: true,
          });
          ht += Number(d.flat_fee_cents);
        }
        for (const l of lines) {
          const price = priceLine(db, l),
            amount = r.flat_fee ? 0 : Number(l.amount_cents);
          frozen.push({
            invoice_id: fid,
            origin: "time_entry",
            origin_id: l.id,
            label: l.label,
            tenths_of_hour: l.tenths_of_hour,
            rate_cents: r.flat_fee ? 0 : price.rate_cents,
            amount_cents: amount,
            vat: true,
          });
          ht += amount;
        }
        for (const f of expenses) {
          const isD = f.type === "disbursement";
          frozen.push({
            invoice_id: fid,
            origin: "expense",
            origin_id: f.id,
            label: f.label,
            tenths_of_hour: 0,
            rate_cents: 0,
            amount_cents: f.amount_cents,
            vat: !isD,
          });
          if (isD) debours += Number(f.amount_cents);
          else ht += Number(f.amount_cents);
        }
        if (ht + debours === 0) throw Error("Nothing to invoice");
        const vat = client.vat_applicable
          ? Math.round((ht * Number(cab.vat_rate)) / 100)
          : 0;
        const invoice = insert(db, "invoice", {
          id: fid,
          matter_id: d.id,
          number: num,
          date: demoDate,
          type: body.type,
          subtotal_cents: ht,
          vat_cents: vat,
          disbursements_cents: debours,
          status: "issued",
        });
        for (const item of frozen) insert(db, "invoice_line", item);
        for (const l of lines) {
          update(db, "time_entry", Number(l.id), {
            billing_status: "billed",
            invoice_id: fid,
          });
          audit(
            db,
            "Billed",
            "to_bill",
            num,
            Number(l.id),
            l.block_id as number | null,
          );
        }
        for (const f of expenses)
          update(db, "expense", Number(f.id), { invoice_id: fid });
        update(db, "setting", 1, { next_number: Number(p.next_number) + 1 });
        audit(db, "Invoice issued", "", num);
        return invoice;
      }),
    );
  });
  app.get("/api/invoices/:id/csv", (c) => {
    const f = row(db, "invoice", id(c.req.param("id"))),
      d = row(db, "matter", Number(f.matter_id)),
      client = row(db, "client", Number(d.client_id));
    const esc = (x: unknown) => '"' + String(x).replaceAll('"', '""') + '"';
    const rows = [
      "number;date;client;matter;label;hours;rate_ex_vat;amount_ex_vat;vat",
    ];
    for (const l of all(db, "invoice_line").filter(
      (x) => x.invoice_id === f.id,
    ))
      rows.push(
        [
          f.number,
          f.date,
          client.name,
          d.title,
          l.label,
          (Number(l.tenths_of_hour) / 10).toFixed(1),
          (Number(l.rate_cents) / 100).toFixed(2),
          (Number(l.amount_cents) / 100).toFixed(2),
          l.vat ? "yes" : "no",
        ]
          .map(esc)
          .join(";"),
      );
    return c.json({ csv: rows.join("\n") });
  });
  app.get("/api/blocks/:id/recognition", (c) => {
    const block = row(db, "block", id(c.req.param("id")));
    const threshold = Number(row(db, "setting", 1).confidence_threshold);
    const candidates = recognizeBlock(db, block);
    return c.json({
      block_id: block.id,
      threshold,
      decision: decision(candidates, threshold),
      candidates,
    });
  });
  app.get("/api/sources/:id", (c) => {
    const l = row(db, "time_entry", id(c.req.param("id")));
    if (!l.block_id) throw Error("Not found");
    const b = row(db, "block", Number(l.block_id));
    return c.json({
      time_entry: l,
      block: b,
      sources: all(db, "source").filter((x) => x.block_id === b.id),
      jev_reviews: all(db, "jev_review").filter((x) => x.block_id === b.id),
      audit: all(db, "audit_event").filter(
        (x) => x.time_entry_id === l.id || x.block_id === b.id,
      ),
    });
  });
  app.post("/api/sources/:id/export", async (c) => {
    const l = row(db, "time_entry", id(c.req.param("id")));
    const b = l.block_id ? row(db, "block", Number(l.block_id)) : null;
    const body = await c.req.json<{ options: string[] }>();
    return c.json(
      transaction(db, () => {
        const pack = {
          time_entry: l,
          block: b,
          sources: all(db, "source").filter((x) => x.block_id === b?.id),
          audit: all(db, "audit_event").filter((x) => x.time_entry_id === l.id),
          options: body.options,
        };
        const hash = createHash("sha256")
          .update(JSON.stringify(pack))
          .digest("hex");
        const e = insert(db, "source_export", {
          time_entry_ids: String(l.id),
          options: body.options.join(","),
          sha256: hash,
          created_at: `${demoDate} ${new Date().toTimeString().slice(0, 5)}`,
        });
        audit(
          db,
          "Source pack generated",
          "",
          `SHA-256 ${hash.slice(0, 16)}…`,
          Number(l.id),
          l.block_id as number | null,
        );
        return e;
      }),
    );
  });
  app.post("/api/pauses", async (c) => {
    const b = await c.req.json<Record<string, unknown>>();
    return c.json(
      transaction(db, () => {
        const p = insert(db, "pause", {
          date: b.date ?? demoDate,
          start_time: required(b.start_time, "Start time"),
          end_time: null,
          origin: "button",
          reason: b.reason ?? "",
        });
        audit(db, "Capture paused", "", "", null, 14);
        return p;
      }),
    );
  });
  app.patch("/api/pauses/:id", async (c) => {
    const n = id(c.req.param("id"));
    const b = await c.req.json<{ end_time: string }>();
    return c.json(
      transaction(db, () => {
        const p = update(db, "pause", n, {
          end_time: required(b.end_time, "End time"),
        });
        audit(db, "Capture resumed", "", "", null, 14);
        return p;
      }),
    );
  });
  app.post("/api/blocks/:id/close", async (c) => {
    const b = row(db, "block", id(c.req.param("id")));
    const body = await c.req.json<{ minutes: number }>();
    if (!Number.isInteger(body.minutes) || body.minutes < 1)
      throw Error("Invalid duration");
    return c.json(
      transaction(db, () => {
        const l = all(db, "time_entry").find((x) => x.block_id === b.id);
        if (!l || l.billing_status === "billed")
          throw Error("Block cannot be closed");
        const before = Number(l.tenths_of_hour);
        update(db, "time_entry", Number(l.id), {
          tenths_of_hour: before + Math.max(1, Math.round(body.minutes / 6)),
        });
        update(db, "block", Number(b.id), {
          minutes: Number(b.minutes) + body.minutes,
          state: "assigned",
        });
        reprice(db);
        audit(
          db,
          "Block closed",
          String(before),
          String(row(db, "time_entry", Number(l.id)).tenths_of_hour),
          Number(l.id),
          Number(b.id),
          "TimeKeepr",
        );
        return row(db, "time_entry", Number(l.id));
      }),
    );
  });
  for (const t of ["firm", "setting", "client", "matter", "task"] as const)
    app.patch(`/api/${t}/:id`, async (c) => {
      const n = id(c.req.param("id"));
      const body = await c.req.json<Record<string, unknown>>();
      return c.json(
        transaction(db, () => {
          const before = row(db, t, n);
          if (t === "matter" && "reference" in body)
            throw Error("Case reference is immutable");
          if (
            t === "client" &&
            "code" in body &&
            !/^[A-Z][A-Z0-9]*$/.test(String(body.code))
          )
            throw Error("Client code must be uppercase letters or digits");
          const after = update(db, t, n, body);
          reprice(db);
          audit(
            db,
            `${t} updated`,
            JSON.stringify(before),
            JSON.stringify(after),
          );
          return after;
        }),
      );
    });
  app.post("/api/clients", async (c) => {
    const b = await c.req.json<{ name: string; rate_cents: number }>();
    return c.json(
      transaction(db, () => {
        const r = insert(db, "client", {
          name: required(b.name, "Name"),
          code: (() => {
            const code = String(
              required((b as { code?: string }).code, "Code"),
            ).trim();
            if (!/^[A-Z][A-Z0-9]*$/.test(code))
              throw Error("Client code must be uppercase letters or digits");
            return code;
          })(),
          type: "individual",
          mode: "hourly",
          rate_cents: required(b.rate_cents, "Rate"),
          vat_applicable: true,
          billing_address: "[ADDRESS]",
        });
        audit(db, "Client created", "", String(r.name));
        return r;
      }),
    );
  });
  app.post("/api/tasks", async (c) => {
    const b = await c.req.json<{ code: string; label: string }>();
    return c.json(
      transaction(db, () => {
        const r = insert(db, "task", {
          code: required(b.code, "Code"),
          label: required(b.label, "Label"),
          billable_by_default: true,
          off_screen: false,
          sort_order: all(db, "task").length + 1,
        });
        audit(db, "Task created", "", String(r.label));
        return r;
      }),
    );
  });
  app.post("/api/client-rules", async (c) => {
    const b = await c.req.json<{ client_id: number; type: string }>();
    const cap = b.type === "daily_research_cap";
    if (!cap && b.type !== "nonbillable_travel") throw Error("Invalid type");
    return c.json(
      transaction(db, () => {
        const r = insert(db, "client_rule", {
          client_id: b.client_id,
          type: b.type,
          value: cap ? 5 : 0,
          label: cap
            ? "No more than 0.5 h of billable research per day"
            : "Travel is not billable",
        });
        reprice(db);
        audit(db, "Client rule created", "", String(r.label));
        return r;
      }),
    );
  });
  app.delete("/api/client-rules/:id", (c) => {
    const r = row(db, "client_rule", id(c.req.param("id")));
    return c.json(
      transaction(db, () => {
        db.prepare("DELETE FROM client_rule WHERE id=?").run(Number(r.id));
        reprice(db);
        audit(db, "Client rule removed", String(r.label));
        return { deleted: true };
      }),
    );
  });
  return app;
}
