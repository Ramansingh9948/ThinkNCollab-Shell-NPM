# ThinkNCollab Shell (`thinknsh`)

A real-time collaborative terminal shell with WebSocket integration, built on top of the ThinkNCollab platform. Run commands, join rooms, chat with teammates, manage tasks, share terminals — all from your CLI.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [CLI Flags](#cli-flags)
- [Interactive Shell](#interactive-shell)
- [Commands Reference](#commands-reference)
  - [Auth Commands](#auth-commands)
  - [Room Commands](#room-commands)
  - [Message Commands](#message-commands)
  - [Task Commands](#task-commands)
  - [Terminal Share Commands](#terminal-share-commands)
  - [Notification Commands](#notification-commands)
  - [Shell Commands](#shell-commands)
- [`.tncproject` Auto-Boot](#tncproject-auto-boot)
- [Notification Window](#notification-window)
- [Built-in Shell Features](#built-in-shell-features)
- [Single-Command Mode](#single-command-mode)
- [Examples](#examples)

---

## Features

- 🚀 **Custom Shell** — Full-featured interactive REPL with persistent history
- 🔌 **WebSocket Integration** — Real-time bidirectional sync with ThinkNCollab servers
- 👥 **Room Collaboration** — Join rooms, chat, and see who's online in real time
- 📋 **Task Management** — Accept, start, complete, and reject tasks from the CLI
- 📺 **Terminal Sharing** — Share your live terminal session with teammates (read + write access)
- 🔔 **Notification Window** — Background TCP-based popup window for live events
- 🔑 **`.tncproject` Auto-Boot** — Drop a config file in your project root to auto-login and join a room on shell start
- 🛡️ **Shell Token Auth** — Secure HMAC-SHA256 token validation for shell connections
- 📁 **File System** — Built-in `ls`, `cd`, `pwd`, plus passthrough to your system shell
- 📜 **History** — Persisted command history at `~/.thinknsh_history`
- 🎨 **Colored Output** — chalk-powered terminal output

---

## Installation

```bash
# Install globally (recommended)
npm install -g thinkncollab-shell

# Or install locally in a project
npm install thinkncollab-shell
```

After a global install the `thinknsh` binary is available everywhere on your system.

---

## Quick Start

```bash
# 1. Start the interactive shell
thinknsh

# 2. Log in
thinknsh> login

# 3. Join a room
thinknsh> join <room-id>

# 4. Send a message
thinknsh> say Hello team!

# 5. Check session status
thinknsh> status
```

---

## Configuration

By default `thinknsh` connects to `https://thinkncollab.com`. Override the server in any session using environment variables:

```bash
export THINKNCOLLAB_SERVER=https://thinkncollab.com
export THINKNCOLLAB_API_URL=https://thinkncollab.com
export THINKNCOLLAB_WS_URL=https://thinkncollab.com
thinknsh
```

Or inline for a single run:

```bash
THINKNCOLLAB_SERVER=https://thinkncollab.com thinknsh
```

Session credentials are saved to `~/.thinkncollab/session.json` and are automatically restored on the next launch — you only need to `login` once.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `THINKNCOLLAB_SERVER` | `https://thinkncollab.com` | Base URL for both REST and WebSocket |
| `THINKNCOLLAB_API_URL` | `https://thinkncollab.com` | REST API base URL (overrides SERVER for API calls) |
| `THINKNCOLLAB_WS_URL` | `https://thinkncollab.com` | WebSocket server URL |
| `THINKNCOLLAB_AUTO_CONNECT` | `false` | Set to `true` to auto-connect WebSocket on shell start |
| `THINKNSH_NOTIFY_PORT` | auto-assigned | TCP port for the notification window (set automatically) |

In production all three URL variables typically point to the same host:

```bash
export THINKNCOLLAB_SERVER=https://thinkncollab.com
export THINKNCOLLAB_API_URL=https://thinkncollab.com
export THINKNCOLLAB_WS_URL=https://thinkncollab.com
export THINKNCOLLAB_AUTO_CONNECT=true
```

---

## CLI Flags

These flags are used **before** entering the interactive shell.

| Flag | Alias | Description |
|---|---|---|
| `--help` | `-h` | Show help and exit |
| `--version` | `-v` | Print installed version and exit |

```bash
thinknsh --help
thinknsh --version
```

---

## Interactive Shell

Running `thinknsh` with no arguments starts the interactive shell. A notification window opens automatically in a new terminal (on macOS, Windows, and most Linux DEs).

```
$ thinknsh

  ████████╗██╗  ██╗██╗███╗   ██╗██╗  ██╗███╗   ██╗ ...
  ╔══════════════════════════════════════════════════════╗
  ║     ThinkNCollab Shell v0.0.5                        ║
  ║     Type 'help' for commands                         ║
  ╚══════════════════════════════════════════════════════╝

  Notification server ready on port 7379
  Notification window opening...

username@thinknsh:~ $
```

The prompt shows your current room and connection state:

```
[room-abc123] ● username@thinknsh:~/projects $
```

Type `help` at any time to list all available commands.

---

## Commands Reference

### Auth Commands

#### `login`
Authenticate interactively with your ThinkNCollab account. Credentials are saved and restored automatically on subsequent launches.

```
thinknsh> login
  Email   : you@example.com
  Password: ********
  ✅ Logged in as You
```

#### `logout`
End the current session and clear saved credentials.

```
thinknsh> logout
  ✅ Logged out successfully
```

#### `whoami`
Display the currently authenticated user.

```
thinknsh> whoami
  👤 Logged in as: Raman Singh (raman@thinkncollab.com)
```

---

### Room Commands

#### `join <room-id>`
Join a collaboration room. Establishes a WebSocket connection, loads the last 30 messages, and starts streaming live events.

```
thinknsh> join room-abc123
  ✅ Joined: My Project Room
```

#### `leave`
Leave the current room and disconnect from its event stream.

```
thinknsh> leave
```

#### `rooms`
List all rooms you have access to.

```
thinknsh> rooms
  [1] frontend-team   (ID: room-abc123)  👥 4 members
  [2] backend-infra   (ID: room-def456)  👥 2 members
```

---

### Message Commands

#### `say <message>` / `msg <message>`
Send a message to the room you are currently in. No quotes needed for multi-word messages.

```
thinknsh> say PR is up for review — branch feature/auth-fix
```

---

### Task Commands

These commands require you to be logged in and in a room. They emit real-time events to all room members and update the [Shell Users presence page](https://thinkncollab.com) instantly.

#### `task list`
Show tasks assigned to you in the current room.

```
thinknsh> task list
  [1] Fix login redirect bug       — high    · pending
  [2] Write API documentation      — medium  · in-progress
  [3] Review onboarding flow       — low     · pending
```

#### `task accept <task-id>`
Mark a task as accepted. Emits a `task:accepted` event to the room — teammates see it live on the board.

```
thinknsh> task accept 64f1a2b3c4d5e6f7a8b9c0d1
  ✅ Task accepted: Fix login redirect bug
```

#### `task start <task-id>`
Mark a task as in-progress and broadcast a `task:started` event. Your active task appears on the Shell Users presence page for all teammates to see.

```
thinknsh> task start 64f1a2b3c4d5e6f7a8b9c0d1
  ▶ Started: Fix login redirect bug
```

#### `task complete <task-id>`
Mark a task as completed. Emits `task:completed` — the card on the board animates green for all viewers and your active task slot clears on the presence page.

```
thinknsh> task complete 64f1a2b3c4d5e6f7a8b9c0d1
  ✓ Completed: Fix login redirect bug
```

#### `task reject <task-id>`
Reject a task assignment. Emits `task:rejected` to the room.

```
thinknsh> task reject 64f1a2b3c4d5e6f7a8b9c0d1
  ✕ Rejected: Fix login redirect bug
```

---

### Terminal Share Commands

Terminal sharing lets you stream your live shell session to teammates. Viewers watch in real time; you can optionally grant write access to specific users.

#### `share start`
Start sharing your terminal in the current room. A session ID is created and room members are notified.

```
thinknsh> share start
  📺 Terminal share started
  Session : ts-7x9k2m
  Room    : frontend-team
```

#### `share stop`
End the current sharing session. All viewers are disconnected.

```
thinknsh> share stop
  📺 Terminal share ended
```

#### `share grant <user-id>`
Grant write access to a viewer. They can now send input to your shell.

```
thinknsh> share grant 64f1a2b3c4d5e6f7a8b9c0d1
  ✍️  Write access granted
```

#### `share revoke <user-id>`
Revoke write access from a user (they remain a read-only viewer).

```
thinknsh> share revoke 64f1a2b3c4d5e6f7a8b9c0d1
```

#### `share kick <user-id>`
Remove a viewer from the session entirely.

```
thinknsh> share kick 64f1a2b3c4d5e6f7a8b9c0d1
```

#### `share status`
List current viewers and which ones have write access.

```
thinknsh> share status
  Viewers  : 2
    👁  Priya Sharma        (read-only)
    ✍  Alex Kumar           (write)
```

---

### Notification Commands

#### `notify <message>`
Send a push notification to all other members in the current room. The message appears in their notification feed instantly.

```
thinknsh> notify Staging deploy complete — please re-test
  📢 Notification sent to 3 member(s)
```

Supports optional type and title:

```
thinknsh> notify type=task_progress title="Build Done" All tests passing
```

---

### Shell Commands

#### `status`
Show a full overview of your session.

```
thinknsh> status
  WebSocket : ✓ Connected
  Socket ID : abc123...
  Room      : frontend-team
  Auth      : ✓ Logged in
  User      : Raman Singh
```

#### `help`
List all registered commands grouped by category.

#### `clear`
Clear the terminal screen.

#### `cd <path>`
Change the working directory. Supports `~`, `..`, absolute and relative paths.

#### `ls [-a]`
List files in the current directory. Pass `-a` to include hidden files.

#### `pwd`
Print the current working directory.

#### `history`
Show the full command history for this session.

#### `set [key value]`
Set a shell variable. Run with no arguments to list all variables.

```
thinknsh> set ROOM room-abc123
thinknsh> join $ROOM
```

#### `unset <key>`
Delete a shell variable.

#### `connect` / `disconnect`
Manually connect or disconnect the WebSocket.

#### `exit` / `quit`
Exit the shell gracefully (saves history, closes TCP notification server, disconnects WebSocket).

---

## `.tncproject` Auto-Boot

Place a `.tncproject` file in your project root to auto-login and auto-join a room when `thinknsh` starts in that directory — no manual `login` or `join` needed.

```
.tncproject
```

On startup the shell sends the encrypted config to the server, receives a shell token, saves the session, connects WebSocket, and joins the project room automatically:

```
  📄 tncproject found
     Room : room-abc123
     File : /home/user/myproject/.tncproject

  ✅ Raman Singh → room "My Project Room"
```

If `.tncproject` auth fails, the shell falls back to manual login.

---

## Notification Window

When `thinknsh` starts it launches a background TCP notification server on an auto-assigned port (default start: `7379`) and opens a second terminal window to display live events — messages, task updates, user joins/leaves — without interrupting your main shell prompt.

On **VS Code** (Windows) the notification window cannot be auto-spawned. The shell prints the command to run it manually:

```
  VS Code detected — open a new terminal tab and run:
  $env:THINKNSH_NOTIFY_PORT=7379; node "path/to/notification-window.js"
```

On **macOS** it opens in a new Terminal.app window. On **Linux** it tries `gnome-terminal`, `xterm`, and `konsole` in order.

---

## Built-in Shell Features

### Persistent History
Command history is saved to `~/.thinknsh_history` (up to 1000 entries) and restored on every launch. Use **Up/Down arrows** to navigate.

### Session Persistence
After `login`, your session token is saved to `~/.thinkncollab/session.json`. The next time you start `thinknsh` you are already authenticated — no password prompt.

### Shell Variables
```bash
thinknsh> set ROOM room-abc123
thinknsh> join $ROOM
```

### Aliases
Built-in aliases: `ll` → `ls -la`, `..` → `cd ..`, `~` → `cd ~`.

### System Shell Passthrough
Any command that is not a `thinknsh` built-in runs directly in your system shell (`bash` / `cmd.exe`):

```bash
thinknsh> git status
thinknsh> npm install
thinknsh> python manage.py migrate
```

> **Note:** On Windows, `open`, `which`, `grep`, `touch`, and `cat` are blocked (not available in cmd.exe) — use Windows equivalents or WSL.

### Quote Parsing
Single and double quotes are supported for arguments with spaces:

```bash
thinknsh> say "Deployment done — all green ✅"
thinknsh> notify "title=Release v2.1" Pushed to prod
```

---

## Single-Command Mode

Run any command as a one-liner without entering the interactive shell:

```bash
thinknsh status
thinknsh whoami
thinknsh rooms
thinknsh join room-abc123
thinknsh say "Deployment complete ✅"
thinknsh task list
thinknsh notify "All tests passing"
```

Chain with `&&` for scripting:

```bash
thinknsh login && thinknsh join room-abc123 && thinknsh say "I'm online"
```

---

## Examples

```bash
# Full interactive session
thinknsh
thinknsh> login
thinknsh> rooms
thinknsh> join room-abc123
thinknsh> say Good morning everyone 🚀
thinknsh> task list
thinknsh> task accept 64f1a...
thinknsh> task start 64f1a...
thinknsh> task complete 64f1a...
thinknsh> share start
thinknsh> share grant 64f2b...
thinknsh> share stop
thinknsh> notify "Daily standup in 5 mins"
thinknsh> status
thinknsh> exit

# .tncproject auto-boot (no login needed)
cd ~/myproject         # contains .tncproject
thinknsh               # auto-logs in + auto-joins room

# Quick one-liners from CI / scripts
thinknsh say "Build #142 passed ✅"
thinknsh notify "Hotfix deployed to production"
thinknsh task complete $TASK_ID
```

---

## License

© ThinkNCollab