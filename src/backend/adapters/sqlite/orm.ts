import type { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";

const connections = new WeakMap<DatabaseSync, ReturnType<typeof drizzle>>();

/** Share the existing connection so raw savepoints cover every query. */
export function orm(db: DatabaseSync) {
  let client = connections.get(db);
  if (!client) {
    client = drizzle({ client: db });
    connections.set(db, client);
  }
  return client;
}
