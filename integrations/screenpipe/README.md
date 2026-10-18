# Screenpipe integration

Screenpipe owns recording and window detection; TimeKeeper reads its recorded activity and never writes Screenpipe memories or reads its database ([integration research](../../docs/SCREENPIPE_INTEGRATION.md)). Ported from `origin/mcp-and-api-merge` onto the canonical API.

| Part         | Where                                                            | Role                                                                                              |
| ------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| MCP server   | `src/mcp/server.ts` (`npm run mcp:serve`)                        | Loopback HTTP MCP at `http://127.0.0.1:3032/mcp` for Screenpipe chat; also runs the session link. |
| Session link | `src/mcp/screenpipe-link.ts`                                     | The TimeKeeper session follows Screenpipe recording (reads only Screenpipe's public `/health`).   |
| Skill        | `timekeeper/SKILL.md`                                            | Chat instructions for the MCP tools.                                                              |
| Pipes        | `pipes/start-timekeeper/pipe.md`, `pipes/end-timekeeper/pipe.md` | Manual Start and End buttons. They call the MCP tools, or the command-line fallback below.        |
| Fallbacks    | `src/mcp/start-session.ts`, `src/mcp/end-session.ts`             | Same logic as `start_session` and `end_session`, for pipes that cannot call MCP tools.            |

## Set up

1. Choose a random token and add it to the repository's `.env` (never commit it): `TIMEKEEPER_MCP_TOKEN=<token>`. The HTTP transport refuses to start without it.
2. Start TimeKeeper (desktop app, or `npm run dev`), then `npm run mcp:serve` in this repository.
3. In Screenpipe's Connections settings, add a custom MCP connection named `timekeeper` with the URL `http://127.0.0.1:3032/mcp` and the header `Authorization: Bearer <token>`.
4. Copy `timekeeper/SKILL.md` into Screenpipe's skills folder as `timekeeper/SKILL.md` (for example `~/.screenpipe/skills/timekeeper/SKILL.md`).
5. Copy each pipe folder into Screenpipe's pipes folder. If a pipe cannot call MCP tools, copy its `.env.example` to `.env` beside the installed `pipe.md` and set `TIMEKEEPER_START_COMMAND` or `TIMEKEEPER_END_COMMAND`. These commands run the fallbacks with Screenpipe's bundled `bun`; the examples are in each `.env.example`.

The stdio transport (`npx tsx src/mcp/server.ts`) needs no token: it serves one local client through its own pipes.

## Environment

| Variable                        | Default                                         | Use                                                      |
| ------------------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| `TIMEKEEPER_MCP_TOKEN`          | none (required for HTTP)                        | Bearer token Screenpipe sends to the MCP server.         |
| `TIMEKEEPER_MCP_PORT`           | `3032`                                          | MCP HTTP port when `--http` has no port.                 |
| `TIMEKEEPER_API_URL`            | `http://127.0.0.1:8787`                         | TimeKeeper API origin.                                   |
| `TIMEKEEPER_LAUNCH_COMMAND`     | none                                            | Opens TimeKeeper when its API is not running on Start.   |
| `SCREENPIPE_URL`                | `http://127.0.0.1:3030`                         | Screenpipe API; the link reads only `/health`.           |
| `TIMEKEEPER_LINK_GRACE_SECONDS` | `60`                                            | How long Screenpipe may stop before the session ends.    |
| `TIMEKEEPER_MCP_STATE`          | `data/screenpipe-link.json` (working directory) | Session link state, kept across restarts.                |
| `TIMEKEEPER_START_COMMAND`      | none                                            | Start pipe fallback, set in the installed pipe's `.env`. |
| `TIMEKEEPER_END_COMMAND`        | none                                            | End pipe fallback, set in the installed pipe's `.env`.   |

## Not ported yet

TODO: JEV case-switch assessment (`jev-check`, the `timekeeper` pipe and the `record_case_transition` / `tab_detection_status` tools from `origin/mcp-and-api-merge`). It sends recorded screen fields to the hosted TypeSafe service and needs a `TYPESAFE_API_KEY` and an approved `JEV_ALLOWED_FIELDS` selection. Until then, case changes come from the desk pill, which reads the focused window from Screenpipe and asks the lawyer to confirm.
