# TimeKeeper

TimeKeeper helps lawyers review work periods, assign cases, validate time, and prepare invoices. It is an École 42 and Screenpipe hackathon project.

The local React interface, Node API, SQLite core, and Tauri shell exist. The five views are My day, Cases, Billing, Activity, and Settings. Screenpipe integration and native release acceptance remain incomplete. See [architecture and implementation](docs/ARCHITECTURE.md).

## Prepare and run

Use the Node version in [`.nvmrc`](.nvmrc). With nvm, run from the repository root:

```sh
nvm install
nvm use
node install.mjs
npm run dev
```

Open `http://127.0.0.1:5173`. Install Screenpipe separately using the [setup guide](docs/SETUP.md). For app development without Screenpipe, use `node install.mjs --skip-screenpipe`. Repeat readiness checks with `npm run setup:check`.

Setup preserves existing configuration and data. Normal startup creates an empty workspace. The health check does not install workflows or prove capture, MCP, or tag synchronization. Desktop development requires a separately running Node API.

## View sample comparisons

Create a separate preview database:

```sh
npm run db:samples -- --database data/comparison-preview.db
TIMEKEEPER_DB=data/comparison-preview.db TIMEKEEPER_PORT=8788 UI_PORT=5174 npm run dev
```

Open `http://127.0.0.1:5174/` and select Cases. The preview has two labelled companies and a 2:1 monthly time comparison. Near midnight, sample periods shorten to avoid future timestamps. Historical billing-balance and case-count percentages remain unavailable.

The importer requires `--database PATH`. It preserves existing records and human edits on rerun, backs up compatible existing databases, and rejects pending migrations. Add `--dry-run` to inspect the plan without opening a database. Setup and startup never import samples.

To add the samples to an existing workspace, explicitly use that database path instead. In Cases, select **[Sample] Atlas Industries** or **[Sample] River Consulting** under **Compare recorded time for**. This comparison uses only the selected client's records in both months. Older incomplete records can still make the All clients comparison unavailable. Other workspace figures remain unchanged by this selector.

## Development checks

Run `npm run format:check`, `npm run lint`, `npm test`, `npm run typecheck`, and `npm run build`. Use `npm run format` or `npm run lint:fix` for available fixes. `npm run contract:gen` regenerates state schemas, API types, and request validators.

Prettier and ESLint exclude generated output and local data; they do not check Rust or SQL. Documentation-only edits require formatting, link, command, and source-reference checks. Run [browser acceptance](tests/acceptance/README.md) separately with an isolated database. Native and Screenpipe acceptance are separate.

`npm run db:reset` deletes the selected database. Use it only for disposable data.

## Documentation

| Topic                                      | Document                                                 |
| ------------------------------------------ | -------------------------------------------------------- |
| Installation and desktop builds            | [Setup](docs/SETUP.md)                                   |
| Business rules and open decisions          | [Requirements](docs/REQUIREMENTS.md)                     |
| System, modules, and implementation limits | [Architecture](docs/ARCHITECTURE.md)                     |
| Schema, migrations, and fixtures           | [Database](docs/DATABASE.md)                             |
| Visual standards and screen behavior       | [Design](design.md)                                      |
| Provider API and event evidence            | [Screenpipe integration](docs/SCREENPIPE_INTEGRATION.md) |
| Historical French schema                   | [Original database](docs/reference/ORIGINAL_DATABASE.md) |
| Browser checks                             | [Acceptance](tests/acceptance/README.md)                 |
| Contributor rules                          | [AGENTS.md](AGENTS.md)                                   |
