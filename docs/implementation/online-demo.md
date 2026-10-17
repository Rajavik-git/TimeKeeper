# Online demo deployment

The shareable [web demo](https://timekeeper-demo.vercel.app) serves the Vite build as static files and mounts the existing Hono API through `api/index.ts` on Vercel Node 22. The function creates `/tmp/timekeeper.db` on a cold start with the same schema, seed, recognition refresh, and canonical demo seed used by `npm run db:reset`. The local development database and desktop process are separate from this deployment.

Vercel function storage is temporary and scoped to an instance. A cold start can restore the fictional seed, and concurrent requests can reach different instances with different state. The demo is suitable for inspecting the interface and trying individual actions, but it does not provide durable or globally consistent records. A shared persistent database is needed before treating an online validation or billing action as durable.

## Desktop emulator

The sixth top tab, **Desktop**, is a browser-only Windows 11-style simulation. Its File Explorer lists the six fictional case folders and their 13 documents. Double-clicking a file opens a simulated Word, PDF, or email window with a short readable extract. Windows can be moved, minimized, restored, closed, and focused from the taskbar. The TimeKeeper icon, tray mark, pill, and demo script open the application in a resizable iframe with `?embedded=1`; that view hides the Desktop tab to avoid nesting emulators.

The pill is the same component as the desktop shell uses. A focused document window sends its title and application name to the pill after a three-second debounce. The pill calls `/api/recognize` and, after confirmation, `/api/periods/switch`; My day and Activity then read the canonical period. High-confidence suggestions show the pill's 20-second auto-confirm countdown, and lower-confidence suggestions require a choice. The browser demo does not observe real Windows applications or record a screen.

`src/frontend/features/emulator/documents.json` is committed static data generated from `demo/documents` by `python3 scripts/generate-demo-document-index.py`. It contains file names, folders, sizes, demo dates, and short text previews. The source documents themselves are outside Vite's public directory and are not deployed. Run `python3 tests/acceptance/emulator.py` with the local API and UI servers to verify the interaction; screenshots are written to the task's emulator report directory.
