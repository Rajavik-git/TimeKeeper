import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { apiError } from "../../src/backend/api/errors.js";
import { openDb } from "../../src/backend/adapters/sqlite/repository.js";
import { orm } from "../../src/backend/adapters/sqlite/orm.js";
import { settings } from "../../src/backend/adapters/sqlite/tables.js";

it("returns a sanitized input error when an ORM write violates an extension guard", async () => {
  const db = openDb(":memory:");
  try {
    const app = new Hono().onError(apiError).post("/settings", (context) => {
      orm(db).update(settings).set({ next_number: 0 }).run();
      return context.json({ saved: true });
    });
    const response = await app.request("/settings", { method: "POST" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid-request",
      message: "storage constraint rejected input",
    });
    expect(db.prepare("SELECT next_number FROM settings").get()?.next_number).toBe(1);
  } finally {
    db.close();
  }
});

it("preserves constraint responses when a query library wraps the SQLite error", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE items (name TEXT UNIQUE NOT NULL)");
    const insert = db.prepare("INSERT INTO items (name) VALUES (?)");
    insert.run("private case name");
    const app = new Hono().onError(apiError).post("/items", () => {
      try {
        insert.run("private case name");
      } catch (cause) {
        throw new Error("Failed SQL query with private case name", { cause });
      }
      return new Response(null, { status: 201 });
    });
    const response = await app.request("/items", { method: "POST" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "conflict",
      message: "storage constraint conflict",
    });
  } finally {
    db.close();
  }
});

it("keeps unknown query failures private", async () => {
  const app = new Hono().onError(apiError).get("/items", () => {
    throw new Error("private SQL parameters", { cause: new Error("private database path") });
  });
  const response = await app.request("/items");
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "internal", message: "internal error" });
});
