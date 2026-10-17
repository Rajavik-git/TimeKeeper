# TimeKeeper

TimeKeeper is a planned desktop application for macOS and Windows. It uses Screenpipe memory to help lawyers review time spent on clients and legal cases. The project is part of a hackathon organized by École 42 and Screenpipe.

## Status and scope

The repository contains documentation and the folder skeleton defined in [AGENTS.md](AGENTS.md). Empty folders contain `.gitkeep` placeholders so Git can retain them. The selected stack is Tauri, React, a local Node.js backend, and SQLite. No dependencies, executable application, SQL migration, or runtime integration exists yet.

## Development setup

The application cannot run locally yet. Git is sufficient to clone the current documentation checkout. The other prerequisites below prepare the planned development environment.

### Prerequisites

| Requirement | Setup |
| --- | --- |
| Git | Install Git to clone the repository. |
| Node.js | Install an [LTS release](https://nodejs.org/en/download) for the React frontend and Node backend. The project version remains to be pinned. |
| Rust and Cargo | Install the stable toolchain through [rustup](https://rust-lang.org/tools/install/). These tools build the Tauri host. The project version remains to be pinned. |
| macOS build tools | Install Xcode Command Line Tools with `xcode-select --install`. Full Xcode is optional for this desktop-only project. |
| Windows build tools | Install Microsoft C++ Build Tools with the **Desktop development with C++** workload and Microsoft Edge WebView2 Runtime. Use the Rust MSVC toolchain for the target architecture. |
| Screenpipe | Integration development requires a compatible desktop release, the required capture permissions, and access to its running local API. The supported release and authentication setup remain to be verified. |

Follow the official [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) for the native build tools. These platform requirements do not establish a tested TimeKeeper compatibility matrix.

The JavaScript package manager has not been selected. SQLite will be an application dependency and does not require a separate database server. No SQLite CLI is required by the current design.

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

JEV is optional and belongs only to the Screenpipe workflow. Skip this section unless you enable that integration. Installing and starting TimeKeeper does not require JEV, a TypeSafe API key, or the TypeSafe SDK. See the [integration boundary](docs/ARCHITECTURE.md#mcp-and-jev-boundaries).

When enabled, the proposed integration calls JEV through TypeSafe's hosted API. It does not require a local JEV binary, model download, or GPU.

1. Create an API key in the [TypeSafe console](https://console.typesafe.ai/), as described in its [quick start](https://docs.typesafe.ai/introduction/quickstart).
2. Allow the Screenpipe workflow to reach `POST https://api.typesafe.ai/v1/systemone` over HTTPS. Requests use bearer-key authentication. See the [TypeSafe API reference](https://docs.typesafe.ai/api).
3. Keep the key with the Screenpipe workflow that makes the request. TimeKeeper's frontend and application backend do not need it. See the [JEV ownership boundary](docs/ARCHITECTURE.md#mcp-and-jev-boundaries).

Prefer Screenpipe's native credential storage when the selected release supports the required connection. Screenpipe documents a secure store and local connection proxies, but its integration list does not include TypeSafe. Custom TypeSafe connection support and credential delivery remain unverified. A `.env` file is not a required setup step. See [Screenpipe credential storage](https://docs.screenpipe.com/connection-reference#credential-storage).

If the workflow uses the [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript), it requires Node.js 22 or newer. The provider's installation command is:

```sh
npm install @typesafe-ai/sdk
```

Run this only inside the Screenpipe workflow helper's package after that package exists. The current repository has no package manifest. Direct HTTP requests do not require the SDK. The SDK reads `TYPESAFE_API_KEY` from its process environment. A key stored by Screenpipe is not automatically available to the SDK without an integration that supplies it.

Before sending recorded context, resolve the [permitted-data decision](docs/DESIGN_REVIEW.md#decisions-needed-before-dependent-implementation). The JEV integration is not implemented or tested yet.

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

No `package.json`, `Cargo.toml`, Tauri configuration, or database migrations exist. Dependency installation, local startup, migration, build, lint, and test commands must be added here when the corresponding tooling exists.

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
