# TimeKeeper

TimeKeeper is a planned desktop application for macOS and Windows. It uses Screenpipe memory to help lawyers review time spent on clients and legal cases. The project is part of a hackathon organized by École 42 and Screenpipe.

## Status and scope

The repository contains the product documentation and a disabled Screenpipe pipe with optional JEV instructions. The desktop application, backend API, MCP tools, and database migrations are not implemented. The selected application stack is Tauri, React, a local Node.js backend, and SQLite. See [AGENTS.md](AGENTS.md) for code ownership.

## Development setup

The desktop application cannot run locally yet. The tools below prepare its future development environment. The Screenpipe pipe does not require a TimeKeeper Node.js package or TypeSafe SDK.

### Prerequisites

| Requirement | Setup |
| --- | --- |
| Git | Install Git to clone the repository. |
| Node.js and npm | Install a supported [Node.js release](https://nodejs.org/en/download) for future application development. The application toolchain remains to be pinned. |
| Rust and Cargo | Install the stable toolchain through [rustup](https://rust-lang.org/tools/install/). These tools build the Tauri host. The project version remains to be pinned. |
| macOS build tools | Install Xcode Command Line Tools with `xcode-select --install`. Full Xcode is optional for this desktop-only project. |
| Windows build tools | Install Microsoft C++ Build Tools with the **Desktop development with C++** workload and Microsoft Edge WebView2 Runtime. Use the Rust MSVC toolchain for the target architecture. |
| Screenpipe | Integration development requires a compatible desktop release, the required capture permissions, and access to its running local API. The supported release and authentication setup remain to be verified. |

Follow the official [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) for the native build tools. These platform requirements do not establish a tested TimeKeeper compatibility matrix.

Application dependencies remain unconfigured. SQLite will be an application dependency and does not require a separate database server or CLI.

### Install the tools on macOS

Run these commands in Terminal with zsh or bash. Skip tools that are already installed. Finish each installer before continuing.

1. Install Xcode Command Line Tools, which also provide Git.

   ```sh
   xcode-select --install
   ```

2. Install Rust and Cargo with the official [rustup installer](https://rust-lang.org/tools/install/). Select the default stable toolchain when prompted.

   ```sh
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

3. Load Cargo into the current terminal after the default installation.

   ```sh
   . "$HOME/.cargo/env"
   ```

4. Install [nvm](https://github.com/nvm-sh/nvm#installing-and-updating), the Node.js version manager.

   ```sh
   export NVM_DIR="$HOME/.nvm"
   curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
   ```

   Apply any shell-profile instructions printed by the installer so that future terminals can load nvm.

5. Load nvm and install the latest Node.js LTS release, which includes npm.

   ```sh
   . "$NVM_DIR/nvm.sh"
   nvm install --lts
   ```

   If nvm was already installed, use `nvm install --lts` in a terminal where nvm is loaded.

### Install the tools on Windows

Run these commands in PowerShell with [WinGet](https://learn.microsoft.com/en-us/windows/package-manager/winget/) available. Skip tools that are already installed. Finish each installer before continuing.

1. Install Git and Node.js LTS.

   ```powershell
   winget install --id Git.Git --exact --source winget
   winget install --id OpenJS.NodeJS.LTS --exact --source winget
   ```

2. Open the C++ Build Tools installer.

   ```powershell
   winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --source winget --interactive
   ```

   Select **Desktop development with C++** in the installer. If Build Tools is already installed, use Visual Studio Installer to add this workload.

3. If WebView2 Runtime is missing, install it.

   ```powershell
   winget install --id Microsoft.EdgeWebView2Runtime --exact --source winget
   ```

4. Install Rust and Cargo through rustup.

   ```powershell
   winget install --id Rustlang.Rustup --exact --source winget
   ```

5. Open a new PowerShell window, then select the stable MSVC toolchain.

   ```powershell
   rustup default stable-msvc
   ```

The native-tool and Rust steps follow the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows). The package IDs are available in the [Microsoft WinGet registry](https://github.com/microsoft/winget-pkgs).

### Verify the tools

Check that the terminal can find the installed tools:

```sh
git --version
node --version
npm --version
rustc --version
cargo --version
```

On macOS, `xcode-select -p` checks the selected developer-tools directory. On Windows, `rustup show active-toolchain` identifies the active Rust toolchain. These checks confirm tool availability, not application or integration readiness.

### Optional JEV integration for Screenpipe

The integration consists of [pipe.md](integrations/screenpipe/pipes/timekeeper/pipe.md). Its instructions let the Screenpipe agent ask JEV whether the active case changed and, if so, which existing case matches. The pipe needs no helper script, SDK, package install, or separate skill import. To run the chain Screenpipe → MCP → JEV → result from a terminal, use the read-only [JEV tab-change check](integrations/screenpipe/jev-check/README.md). JEV is optional: without the installed pipe's `.env`, the workflow skips JEV. See the [pipe workflow](docs/ARCHITECTURE.md#jev-pipe-workflow).

JEV has no workflow memory. Each comparison includes the active case, its previous observation, and the newer observation. `same_case` returns `no_change`; `uncertain` does not switch the assignment. For a supported switch, the workflow identifies a unique existing destination automatically and returns `identified` with `applied: false`. It sends an unresolved-switch request through MCP only when no unique destination matches. Read-only MCP case queries remain allowed.

Missing previous evidence means uncertain, not unchanged. Initial assignment, operational failures, and incomplete lookups do not trigger the switch request. The scoped MCP tool does not exist yet; a qualifying unresolved switch returns `blocked` with delivery `not_sent` while the tool is unavailable.

1. Start Screenpipe with its local API available.
2. Import the pipe with Screenpipe's [local pipe installation](https://docs.screenpipe.com/scheduled-tasks), using the CLI installed with your Screenpipe release rather than an unpinned package. The desktop app keeps it under `~/.screenpipe/cli/<version>/`. Replace the absolute source path below.

   In bash:

   ```sh
   SCREENPIPE_CLI="$HOME/.screenpipe/cli/<version>/screenpipe"
   cd "$(mktemp -d)" && "$SCREENPIPE_CLI" pipe install "/ABSOLUTE/PATH/TimeKeeper/integrations/screenpipe/pipes/timekeeper"
   ```

   In PowerShell:

   ```powershell
   $cli = "$env:USERPROFILE\.screenpipe\cli\<version>\screenpipe.exe"
   Push-Location (New-Item -ItemType Directory -Path (Join-Path $env:TEMP ([guid]::NewGuid()))); & $cli pipe install "C:\ABSOLUTE\PATH\TimeKeeper\integrations\screenpipe\pipes\timekeeper"; Pop-Location
   ```

3. If you want to use JEV, create `~/.screenpipe/pipes/timekeeper/.env` in a local editor with these settings. Preserve any existing credentials.

   ```dotenv
   JEV_ALLOWED_FIELDS=
   TYPESAFE_API_KEY=
   TYPESAFE_MODEL=jev-latest
   ```

4. If you created `.env`, fill `TYPESAFE_API_KEY` locally with a key from the [TypeSafe console](https://console.typesafe.ai/). Set `JEV_ALLOWED_FIELDS` to the approved comma-separated fields listed [below](#allowed-jev-fields). There is no separate enable flag. An empty key or field selection prevents a request.
5. Select a working AI preset for the task in **Scheduled tasks → My tasks**. Keep the pipe disabled until the required TimeKeeper tools and workflow contracts exist.

To skip JEV, leave `.env` absent or move it out of the installed pipe directory. The agent must explicitly load this file in the same invocation as the request; it must not fall back to a key from the process environment. Keep the key out of `pipe.md`, prompts, and logs. The frontend and application backend do not need it.

The pipe uses `schedule: manual` and `enabled: false`. Results retain the original target, baseline case, source references, and assignment revision. The application remains the only assignment writer. An identified destination is not saved or made the active case; matched-case persistence and repeated switch detection remain open. Missing TimeKeeper API and MCP tools, folder detection, and event delivery still prevent an end-to-end workflow.

Field filtering and response checks are agent instructions, not code-enforced guarantees. Enabled JEV requests use TypeSafe's hosted API. Live requests, Screenpipe loading, and desktop platform behavior have not been verified.

#### Allowed JEV fields

`JEV_ALLOWED_FIELDS` is a TimeKeeper setting. It tells the Screenpipe agent which information it may send to TypeSafe. `previous_observation.` fields describe earlier evidence associated with the active case and its assignment revision. `observation.` fields describe the newer activity. `candidates.` fields describe existing cases returned by TimeKeeper.

| Field | Information permitted in the request |
| --- | --- |
| `previous_observation.text` | Recorded screen text from the earlier observation. |
| `previous_observation.app_name` | Application name from the earlier observation. |
| `previous_observation.window_title` | Window title from the earlier observation. |
| `previous_observation.url` | Page URL from the earlier observation, when available. |
| `observation.text` | Recorded screen text, such as accessibility text or OCR output. |
| `observation.app_name` | Name of the application associated with the observation. |
| `observation.window_title` | Title of the recorded window. |
| `observation.url` | Page URL associated with the observation, when available. It can be stale; see the note below. |
| `candidates.reference` | Reference of each candidate case. |
| `candidates.title` | Title of each candidate case. |
| `candidates.client_name` | Name of the client associated with each candidate case. |

For example, this selection permits screen text and window titles from both observations, case references, and case titles:

```dotenv
JEV_ALLOWED_FIELDS=previous_observation.text,previous_observation.window_title,observation.text,observation.window_title,candidates.reference,candidates.title
```

This selection sends recorded screen text to TypeSafe. A narrower selection is permitted but less reliable. In a synthetic test with `jev-1.13.0`, window titles alone produced `same_case` for a switch to an unknown folder and for an ambiguous inbox, which would silently keep the previous case. See the [design review](docs/DESIGN_REVIEW.md).

Select only fields approved for your deployment. Previous-observation fields require explicit selection; permission for `observation.` fields does not include them. A comparison needs at least one permitted nonblank field from each observation; any selectable field counts, so the window-title example above is sufficient.

URL fields are weaker evidence than window titles. On Windows with Screenpipe 2.7.109, captures of a newly selected browser tab kept the previous tab's URL, which can wrongly suggest that work continued on the same page. Initial assignment needs only the newer observation. Every candidate also needs at least one permitted descriptive field containing text. Missing required content or an unsupported selection prevents a request.

The pipe instructs the agent to exclude screenshots, actual case and client IDs, timestamps, and assignment revisions. It uses temporary aliases for case and client IDs. Selecting a field does not redact private information within its text. See the [configuration and data boundary](docs/ARCHITECTURE.md#jev-configuration-and-data-boundary) for the full contract.

### Get the source

1. Clone the repository.

   ```sh
   git clone https://github.com/Rajavik-git/TimeKeeper.git
   ```

2. Open the project directory.

   ```sh
   cd TimeKeeper
   ```

3. Read [AGENTS.md](AGENTS.md), the [requirements](docs/REQUIREMENTS.md), and the [architecture](docs/ARCHITECTURE.md).
4. Review the [implementation gates](docs/DESIGN_REVIEW.md) before starting application work.

No root `package.json`, `Cargo.toml`, Tauri configuration, or database migration exists. Application dependencies and commands such as `npm ci` and `npm run dev` are not configured. There are no application build or test commands yet.

## MVP behavior

The planned application lets lawyers configure clients and cases, review recorded work, correct and validate time, and track billing status. The [requirements](docs/REQUIREMENTS.md) define the full scope, business rules, and acceptance examples.

## Documentation

| Document | Responsibility |
| --- | --- |
| [Requirements](docs/REQUIREMENTS.md) | Agreed business rules, use cases, acceptance examples, and open product decisions. |
| [Architecture](docs/ARCHITECTURE.md) | Components, ownership, lifecycle, and recovery. |
| [Database](docs/DATABASE.md) | Work-period model, proposed fields, and integrity constraints. |
| [Original database](docs/reference/ORIGINAL_DATABASE.md) | Historical transcription of the supplied diagram. |
| [Screenpipe integration research](docs/SCREENPIPE_INTEGRATION.md) | API evidence, proposed matching methods, and provider limitations. |
| [Screenpipe event research](docs/SCREENPIPE_EVENTS.md) | Trigger mechanisms and release verification gates. |
| [Design review](docs/DESIGN_REVIEW.md) | Remaining risks and implementation checkpoints. |
| [Contributor instructions](AGENTS.md) | Code organization, dependency rules, and working practices. |

The requirements define product behavior. The architecture and database documents explain its intended implementation. Research evidence does not establish runtime support in an installed release.
