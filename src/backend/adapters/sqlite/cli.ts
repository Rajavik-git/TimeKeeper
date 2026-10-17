import { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrate.js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: npm run db:migrate -- <database-file>');
  process.exitCode = 2;
} else {
  const db = new DatabaseSync(path);
  try { migrate(db); } finally { db.close(); }
}
