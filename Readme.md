# ThinkNCollab Shell (`thinknsh`)

A powerful collaborative shell with WebSocket integration for real-time team collaboration — built on top of the ThinkNCollab platform.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [CLI Flags](#cli-flags)
- [Interactive Shell](#interactive-shell)
- [Commands Reference](#commands-reference)
  - [Auth Commands](#auth-commands)
  - [Team Commands](#team-commands)
  - [Room Commands](#room-commands)
  - [Message Commands](#message-commands)
  - [Shell Commands](#shell-commands)
- [Single-Command Mode](#single-command-mode)
- [Built-in Shell Features](#built-in-shell-features)
- [Examples](#examples)
- [Environment Variables](#environment-variables)

---

## Features

- 🚀 **Custom Shell** — Full-featured interactive command-line interface
- 🔌 **WebSocket Integration** — Real-time communication with ThinkNCollab servers
- 👥 **Room Collaboration** — Join rooms and collaborate with teammates live
- 💬 **Messaging** — Send and receive messages in real-time
- 🔔 **Notifications** — Get notified of tasks, uploads, and room events
- 📁 **File System** — Built-in file system commands (ls, cd, pwd, cat, mkdir)
- ⚡ **Command System** — Extensible command registration by category
- 🔧 **Aliases** — Create and manage custom command shortcuts
- 📊 **Variables** — Shell variable support (`set`, `$VAR`)
- 📜 **History** — Persistent command history across sessions
- 🎨 **Colored Output** — Beautiful chalk-powered terminal output

---

## Installation

```bash
# Install globally (recommended)
npm install -g thinkncollab-shell

# Or install locally in a project
npm install thinkncollab-shell
```

After global install, the `thinknsh` binary is available everywhere on your system.

---

## Quick Start

```bash
# 1. Start the interactive shell
thinknsh

# 2. Log in to your ThinkNCollab account
thinknsh> login

# 3. Join a room
thinknsh> join my-room

# 4. Send a message
thinknsh> say Hello team!

# 5. Check your status
thinknsh> status
```

---

## Configuration

By default `thinknsh` connects to `https://thinkncollab.com`. In production, set environment variables before starting the shell:

```bash
export THINKNCOLLAB_SERVER=https://thinkncollab.com
export THINKNCOLLAB_API_URL=https://thinkncollab.com
export THINKNCOLLAB_WS_URL=https://thinkncollab.com
thinknsh
```

Or inline for a single session:

```bash
THINKNCOLLAB_SERVER=https://thinkncollab.com thinknsh
```

---

## CLI Flags

These flags are used **before** entering the interactive shell (passed directly to the `thinknsh` binary).

| Flag | Alias | Description |
|------|-------|-------------|
| `--help` | `-h` | Show help message and exit |
| `--version` | `-v` | Print the installed version and exit |

```bash
thinknsh --help
thinknsh --version
```

---

## Interactive Shell

Running `thinknsh` with no arguments starts the **interactive shell** — a persistent REPL where you stay logged in, maintain a WebSocket connection, and run commands one after another.

```
$ thinknsh

  ████████╗██╗  ██╗██╗███╗   ██╗██╗  ██╗███╗   ██╗
     ╚══██╔╝██║  ██║██║████╗  ██║██║ ██╔╝████╗  ██║
        ██║ ███████║██║██╔██╗ ██║█████╔╝ ██╔██╗ ██║
        ██║ ██╔══██║██║██║╚██╗██║██╔═██╗ ██║╚██╗██║
        ██║ ██║  ██║██║██║ ╚████║██║  ██╗██║ ╚████║
        ╚═╝ ╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝  ╚═══╝

thinknsh> _
```

Type `help` inside the shell to list all available commands at any time.

---

## Commands Reference

### Auth Commands

#### `login`
Authenticate with your ThinkNCollab account. Prompts for email and password interactively.

```bash
thinknsh> login
# Enter your email: you@example.com
# Enter your password: ********
# ✅ Logged in as you@example.com
```

#### `logout`
End your current session and clear saved credentials.

```bash
thinknsh> logout
# ✅ Logged out successfully
```

#### `whoami`
Display information about the currently authenticated user.

```bash
thinknsh> whoami
# 👤 Logged in as: Ramanh (raman@thinkncollab.com)
# 🏢 Team: ThinkNCollab Core
```

---

### Team Commands

#### `myteam`
Show details about your current team — name, plan, member count.

```bash
thinknsh> myteam
# 🏢 Team: ThinkNCollab Core
# 📋 Plan: Pro
# 👥 Members: 8
```

#### `teammates`
List all members in your team with their online status.

```bash
thinknsh> teammates
# 👥 Team Members:
#   🟢 Raman Singh       (you)
#   🟢 Omkar Yadav
#   🔴 Radhika Chauhan     (offline)
#   🟡 --------------      (away)
```

#### `invite <email>`
Send a team invitation to an email address.

```bash
thinknsh> invite newmember@example.com
# ✅ Invitation sent to newmember@example.com
```

---

### Room Commands

#### `join <room-id>`
Join a collaboration room. Establishes a WebSocket connection and streams live activity.

```bash
thinknsh> join room-abc123
# 🚪 Joined room: room-abc123
# 👥 Members online: 3
# 📜 Recent activity loaded
```

You will automatically receive real-time notifications for messages, task updates, and file uploads while inside a room.

#### `leave`
Leave the currently active room and disconnect from its WebSocket stream.

```bash
thinknsh> leave
# 👋 Left room: room-abc123
```

#### `rooms`
List all rooms available to you — showing name, ID, and member count.

```bash
thinknsh> rooms
# 📁 Your Rooms:
#   [1] frontend-team    (ID: room-abc123)  👥 4 members
#   [2] backend-infra    (ID: room-def456)  👥 2 members
#   [3] design-review    (ID: room-ghi789)  👥 6 members
```

---

### Message Commands

#### `say <message>`
Send a message to the room you are currently in. Requires you to be in a room (use `join` first).

```bash
thinknsh> say Hey team, PR is ready for review!
# 💬 [You → frontend-team]: Hey team, PR is ready for review!
```

Supports multi-word messages — no quotes needed.

```bash
thinknsh> say Pushing the hotfix now, give me 5 minutes
```

---

### Shell Commands

#### `status`
Show a full overview of your current shell session: auth status, active room, WebSocket connection, server URL, and version.

```bash
thinknsh> status
# ──────────────────────────────────────
#  ThinkNCollab Shell — Session Status
# ──────────────────────────────────────
#  User       : Raman Singh
#  Email      : raman@example.com
#  Server     : https://app.thinkncollab.com
#  WebSocket  : ✅ Connected
#  Active Room: frontend-team (room-abc123)
#  Version    : 1.2.0
# ──────────────────────────────────────
```

#### `help`
List all registered commands grouped by category, with descriptions.

```bash
thinknsh> help
```

#### `clear`
Clear the terminal screen.

```bash
thinknsh> clear
```

#### `exit` / `quit`
Exit the interactive shell gracefully.

```bash
thinknsh> exit
```

---

## Single-Command Mode

You can run **any command as a one-liner** without entering the interactive shell. The shell executes the command and exits immediately — great for scripting or CI pipelines.

```bash
thinknsh status
thinknsh whoami
thinknsh join room-abc123
thinknsh say "Deployment complete ✅"
thinknsh rooms
```

Multi-word commands work naturally:

```bash
thinknsh say Build passed. Deploying to staging now.
thinknsh invite contractor@example.com
```

---

## Built-in Shell Features

### Command History
The interactive shell remembers your previously run commands across sessions. Use the **Up/Down arrow keys** to navigate history.

### Aliases
Create shortcuts for frequently used commands:

```bash
thinknsh> alias fe="join room-abc123"
thinknsh> fe          # runs: join room-abc123
```

### Shell Variables
Set and use variables within the shell:

```bash
thinknsh> set ROOM=room-abc123
thinknsh> join $ROOM
```

### Tab Completion
Press `Tab` to autocomplete commands and room names.

### Piping & Chaining (Single-command mode)
Chain commands using `&&` in your terminal:

```bash
thinknsh login && thinknsh join room-abc123 && thinknsh status
```

---

## Examples

```bash
# Check who you are
thinknsh whoami

# See all your rooms, then join one
thinknsh rooms
thinknsh join room-abc123

# Send a quick message without opening the shell
thinknsh say "Hotfix deployed to production"

# Invite a new member
thinknsh invite dev@company.com

# Full interactive session
thinknsh
thinknsh> login
thinknsh> rooms
thinknsh> join frontend-team
thinknsh> say Good morning everyone 🚀
thinknsh> teammates
thinknsh> status
thinknsh> exit
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `THINKNCOLLAB_SERVER` | `https://thinkncollab.com` | Main server URL (REST + WebSocket base) |
| `THINKNCOLLAB_API_URL` | `https://thinkncollab.com` | REST API base URL (overrides SERVER for API calls) |
| `THINKNCOLLAB_WS_URL` | `https://thinkncollab.com` | WebSocket server URL |
| `THINKNCOLLAB_AUTO_CONNECT` | `false` | Set to `true` to auto-connect WebSocket on shell start |

In production, all three URL variables typically point to the same host:

```bash
export THINKNCOLLAB_SERVER=https://app.thinkncollab.com
export THINKNCOLLAB_API_URL=https://app.thinkncollab.com
export THINKNCOLLAB_WS_URL=https://app.thinkncollab.com
export THINKNCOLLAB_AUTO_CONNECT=true
```

---

## License

MIT © ThinkNCollab