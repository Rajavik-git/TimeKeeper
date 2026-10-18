# Connect Screenpipe to TimeKeeper

TimeKeeper reads Screenpipe's recorded window context and screenshots through its local API. Screenpipe chat calls TimeKeeper through a separate MCP server. [Setup](../../docs/SETUP.md#connect-screenpipe) covers the provider URL and API token; [integration behavior](../../docs/SCREENPIPE_INTEGRATION.md) explains the limits.

## Set up

1. Prepare TimeKeeper using the [setup guide](../../docs/SETUP.md) and keep `npm run dev` running.
2. Generate a random token locally, for example with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Store it as `TIMEKEEPER_MCP_TOKEN` in the root `.env`. This token protects TimeKeeper MCP; it is separate from `SCREENPIPE_API_KEY`.
3. In another terminal at the repository root, start HTTP MCP with manual session commands:

   ```sh
   node --env-file-if-exists=.env --import tsx src/mcp/server.ts --http 3032
   ```

4. In Screenpipe's Connections settings, add a custom MCP connection named `timekeeper`. Set its URL to `http://127.0.0.1:3032/mcp` and its header to `Authorization: Bearer <your token>`. Test and enable the connection.
5. Import or copy [the TimeKeeper skill](timekeeper/SKILL.md) into Screenpipe's skills folder as `timekeeper/SKILL.md`. The usual local folder is `~/.screenpipe/skills/timekeeper/`. Confirm the selected Screenpipe release's folder before copying.
6. Optionally install the [Start](pipes/start-timekeeper/pipe.md) and [End](pipes/end-timekeeper/pipe.md) folders in Screenpipe's pipes folder. They are manual actions, not capture listeners. Prefer MCP; configure a pipe's `.env.example` only if its command-line fallback is needed.
7. Open a new Screenpipe chat and ask for TimeKeeper status. Start or end a session only when intended. Verify the returned status before describing a command as completed.

These instructions describe the implemented connection contract. Installed-release compatibility and native behavior still require acceptance on each platform. Setup does not install this integration automatically.

### Follow Screenpipe recording

Instead of the manual-session command, run:

```sh
npm run mcp:serve
```

This script fixes HTTP port 3032 and enables `--screenpipe-link`. The link polls Screenpipe's public health every ten seconds. It starts a TimeKeeper session when Screenpipe reports running, unless one is already active. After Screenpipe stops or becomes unreachable for 60 seconds by default, it ends the linked session at the last observation of recording. Starting this process can therefore change session state immediately.

The link persists delivery state in `data/screenpipe-link.json`. Its timestamps are health observations, not exact recording events. A lost connection can look like stopped recording. After an explicit end, it does not restart the session during the same observed recording run. Check `screenpipe_link_status` to inspect delivery state. Durable delivery of arbitrary commands to a stopped API remains unresolved.

### Other transports and fallbacks

For a local stdio client, run `node --env-file-if-exists=.env --import tsx src/mcp/server.ts`. Stdio needs no HTTP token and does not start the recording-session link.

The manual pipes can run `src/mcp/start-session.ts` and `src/mcp/end-session.ts` when they cannot call MCP. Their [Start configuration](pipes/start-timekeeper/.env.example) and [End configuration](pipes/end-timekeeper/.env.example) use absolute paths and Screenpipe's available runtime. Bun is optional for those examples; TimeKeeper development uses Node. A fallback does not load the repository's `.env` automatically.

## Tools

The [API reference](../../docs/API.md#mcp-tools) lists the eight implemented tools and their write boundaries. The chat skill does not register tools, listen for window changes, run JEV, or calculate billing totals.

Case suggestions come from the desk pill's deterministic matching of application name and window title. High-confidence suggestions apply after 20 seconds unless the lawyer intervenes. Unknown-case answers use revision guards. JEV assessment is implemented, with source integration and validation pending. See the [integration tracker](../../docs/FEATURES.md#implemented-integrations-awaiting-validation).

## Environment

| Variable                        | Default                                      | Use                                                                                            |
| ------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `TIMEKEEPER_MCP_TOKEN`          | None, required for HTTP                      | Bearer token for TimeKeeper MCP.                                                               |
| `TIMEKEEPER_MCP_PORT`           | `3032`                                       | Port when direct `--http` has no numeric argument. `mcp:serve` explicitly selects 3032.        |
| `TIMEKEEPER_API_URL`            | `http://127.0.0.1:<TIMEKEEPER_PORT or 8787>` | TimeKeeper API origin. A trailing `/api` is accepted.                                          |
| `TIMEKEEPER_LAUNCH_COMMAND`     | Unset                                        | Optional shell command to open TimeKeeper when Start finds its API unavailable.                |
| `SCREENPIPE_URL`                | Unset                                        | Preferred Screenpipe origin. Falls back to `SCREENPIPE_API_URL`, then `http://127.0.0.1:3030`. |
| `TIMEKEEPER_LINK_GRACE_SECONDS` | `60`                                         | Stop or connection-loss grace period.                                                          |
| `TIMEKEEPER_MCP_STATE`          | `data/screenpipe-link.json`                  | Link state path, relative to the working directory.                                            |
| `TIMEKEEPER_START_COMMAND`      | Unset                                        | Start fallback in the installed pipe's `.env`.                                                 |
| `TIMEKEEPER_END_COMMAND`        | Unset                                        | End fallback in the installed pipe's `.env`.                                                   |

Keep credentials out of URLs, chat, screenshots, and version control. A launch command can open the app; it does not provide a general stopped-app command inbox.
