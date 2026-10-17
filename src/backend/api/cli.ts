import { SqliteRepository } from '../adapters/sqlite/repository.js';
import { TimeKeeperService } from '../application/service.js';
import { createApi, listenLocal } from './server.js';

const path = process.argv[2];
const portArg = process.argv[3];
const port = portArg === undefined ? 0 : Number(portArg);
if (!path || !Number.isSafeInteger(port) || port < 0 || port > 65535) {
  console.error('Usage: npm run api:serve -- <database-file> [port]');
  process.exitCode = 2;
} else {
  const repo = new SqliteRepository(path);
  const server = createApi(new TimeKeeperService(repo), {
    // The Tauri host will supply its exact WebView origin after platform verification.
    allowedOrigins: []
  });
  const binding = await listenLocal(server,port);
  console.log(`TimeKeeper API listening on 127.0.0.1:${binding.port}`);
  const shutdown = async () => { await binding.close(); repo.close(); };
  process.once('SIGINT',()=>{void shutdown()});
  process.once('SIGTERM',()=>{void shutdown()});
}
