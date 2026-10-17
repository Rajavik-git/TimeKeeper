# Online demo deployment

The shareable [web demo](https://timekeeper-demo.vercel.app) serves the Vite build as static files and mounts the existing Hono API through `api/index.ts` on Vercel Node 22. The function creates `/tmp/timekeeper.db` on a cold start with the same schema, seed, recognition refresh, and canonical demo seed used by `npm run db:reset`. The local development database and desktop process are separate from this deployment.

Vercel function storage is temporary and scoped to an instance. A cold start can restore the fictional seed, and concurrent requests can reach different instances with different state. The demo is suitable for inspecting the interface and trying individual actions, but it does not provide durable or globally consistent records. A shared persistent database is needed before treating an online validation or billing action as durable.
