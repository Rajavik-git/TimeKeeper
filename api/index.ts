import { existsSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { createApp } from '../src/backend/api/app.js';
import { refreshDemoRecognition } from '../src/backend/adapters/sqlite/recognition.js';
import { seedCanonicalDemo } from '../src/backend/adapters/sqlite/demo-core.js';

const databasePath = '/tmp/timekeeper.db';

function openDemoDatabase(): DatabaseSync {
  const needsSeed = !existsSync(databasePath);
  const db = new DatabaseSync(databasePath);
  if (!needsSeed) return db;
  try {
    db.exec(readFileSync(resolve(process.cwd(), 'src/backend/adapters/sqlite/schema.sql'), 'utf8'));
    db.exec(readFileSync(resolve(process.cwd(), 'src/backend/adapters/sqlite/seed.sql'), 'utf8'));
    refreshDemoRecognition(db);
    seedCanonicalDemo(db);
    return db;
  } catch (error) {
    db.close();
    rmSync(databasePath, { force: true });
    throw error;
  }
}

let app: ReturnType<typeof createApp> | undefined;

export default {
  fetch(request: Request): Response | Promise<Response> {
    app ??= createApp(openDemoDatabase());
    return app.fetch(request);
  },
};
