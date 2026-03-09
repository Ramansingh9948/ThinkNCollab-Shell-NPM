/**
 * ThinkNCollab Shell Core
 * Inquirer REPL + TCP IPC for notification window
 */

const path   = require('path');
const fs     = require('fs-extra');
const os     = require('os');
const chalk  = require('chalk');
const net    = require('net');
const { spawn } = require('child_process');
const WebSocketManager = require('./websocket');
const EventEmitter     = require('events');
const CommandRegistry  = require('../commands');
const ThinkNCollabAPI  = require('./api-client');

// Find an available port starting from 7379
function getAvailablePort(startPort) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.listen(startPort, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', () => resolve(getAvailablePort(startPort + 1)));
    });
}

class ThinkNCollabShell extends EventEmitter {

    constructor(options = {}) {
        super();

        this.config = {
            historyFile: path.join(os.homedir(), '.thinknsh_history'),
            configDir:   path.join(os.homedir(), '.thinkncollab'),
            maxHistory:  1000,
            websocket: {
                serverUrl:   options.serverUrl   || 'https://thinkncollab.com/thinknsh',
                autoConnect: options.autoConnect || false
            },
            ...options
        };

        fs.ensureDirSync(this.config.configDir);

        this.ws         = new WebSocketManager(this.config.websocket);
        this.currentDir = process.cwd();
        this.username   = os.userInfo().username;
        this.history    = [];
        this.running    = false;

        // TCP notification clients
        this.notifyClients = new Set();
        this.tcpServer     = null;

        this.api = new ThinkNCollabAPI({
            apiUrl: options.apiUrl || 'https://thinkncollab.com',
            wsUrl:  options.wsUrl  || 'https://thinkncollab.com'
        });

        this.commands  = new Map();
        this.aliases   = new Map();
        this.variables = new Map();
        this.isTyping  = false;
        this.typingTimeout = null;

        this.loadHistory();
        this.registerBuiltinCommands();
        this.commandRegistry = new CommandRegistry(this);
        this.setupWebSocketHandlers();
    }

    // ─── TCP Notification Server ──────────────────────────────────────────────

    async startTCPServer() {
        this.notifyPort = await getAvailablePort(7379);

        return new Promise((resolve) => {
            this.tcpServer = net.createServer((socket) => {
                this.notifyClients.add(socket);
                socket.on('close', () => this.notifyClients.delete(socket));
                socket.on('error', () => this.notifyClients.delete(socket));
            });

            this.tcpServer.listen(this.notifyPort, '127.0.0.1', () => {
                resolve();
            });

            this.tcpServer.on('error', (err) => {
                console.log(chalk.yellow(`⚠️  Notification server: ${err.message}`));
                resolve();
            });
        });
    }

    // Send notification event to all connected notification windows
    pushNotification(data) {
        if (this.notifyClients.size === 0) return;
        const line = JSON.stringify(data) + '\n';
        for (const client of this.notifyClients) {
            try { client.write(line); } catch {}
        }
    }

    // ─── Spawn notification window (cross-platform) ───────────────────────────

    spawnNotificationWindow() {
        // Path to notification-window.js (same dir as this file)
        const notifyScript = path.join(__dirname, 'notification-window.js');
        const env = { ...process.env, THINKNSH_NOTIFY_PORT: String(this.notifyPort) };

        try {
            if (process.platform === 'win32') {
                const isVSCode = process.env.TERM_PROGRAM === 'vscode';
                if (isVSCode) {
                    console.log(chalk.yellow('\n  VS Code detected — cannot auto-open new window.'));
                    console.log(chalk.dim('  Open a new terminal tab and run:'));
                    console.log(chalk.cyan(`  $env:THINKNSH_NOTIFY_PORT=${this.notifyPort}; node "${notifyScript}"\n`));
                } else {
                    // Use array args so cmd handles spaces in path correctly
                    const nodeExe = process.execPath;
                    spawn('cmd.exe', [
                        '/c', 'start', 'cmd.exe', '/k',
                        `"${nodeExe}" "${notifyScript}"`
                    ], { detached: true, stdio: 'ignore', env, shell: false }).unref();
                }

            } else if (process.platform === 'darwin') {
                // macOS — Terminal.app
                const script = `tell application "Terminal" to do script "THINKNSH_NOTIFY_PORT=${NOTIFY_PORT} node '${notifyScript}'"`;
                spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref();

            } else {
                // Linux — try common terminal emulators in order
                const terminals = [
                    ['gnome-terminal', ['--', 'node', notifyScript]],
                    ['xterm',          ['-e', `node "${notifyScript}"`]],
                    ['konsole',        ['--noclose', '-e', 'node', notifyScript]],
                    ['xfce4-terminal', ['-e', `node "${notifyScript}"`]],
                    ['x-terminal-emulator', ['-e', `node "${notifyScript}"`]],
                ];
                let spawned = false;
                for (const [cmd, cmdArgs] of terminals) {
                    try {
                        spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore', env }).unref();
                        spawned = true;
                        break;
                    } catch {}
                }
                if (!spawned) {
                    console.log(chalk.yellow('⚠️  Could not auto-open notification window.'));
                    console.log(chalk.dim(`   Run manually: node ${notifyScript}`));
                }
            }
        } catch (err) {
            console.log(chalk.yellow(`⚠️  Could not spawn notification window: ${err.message}`));
            console.log(chalk.dim(`   Run manually: node "${notifyScript}"`));
        }
    }

    // ─── WebSocket → push to notification window ──────────────────────────────

    setupWebSocketHandlers() {
        this.ws.on('connected',    (d) => this.pushNotification({ type: 'connected', socketId: d.socketId }));
        this.ws.on('disconnected', (d) => this.pushNotification({ type: 'disconnected', reason: d.reason }));
        this.ws.on('reconnected',  (d) => this.pushNotification({ type: 'connected', socketId: 'reconnected' }));
        this.ws.on('message',      (d) => this.pushNotification({ type: 'message', from: d.username, text: d.message }));
        this.ws.on('userJoined',   (d) => this.pushNotification({ type: 'userJoined', username: d.username }));
        this.ws.on('userLeft',     (d) => this.pushNotification({ type: 'userLeft',   username: d.username }));
        this.ws.on('userTyping',   (d) => this.pushNotification({ type: d.isTyping ? 'typing' : 'stoppedTyping', username: d.username }));
        this.ws.on('notification', (d) => this.pushNotification({ type: 'notification', level: d.type, title: d.title, message: d.message }));
        this.ws.on('error',        (e) => this.pushNotification({ type: 'notification', level: 'error', title: 'WebSocket Error', message: e.message }));
    }

    // ─── Start ────────────────────────────────────────────────────────────────

    async start() {
        this.showWelcome();

        // 1. Start TCP server for notification IPC
        await this.startTCPServer();
        console.log(chalk.dim(`  Notification server ready on port ${this.notifyPort}`));

        // 2. Spawn notification window
        this.spawnNotificationWindow();
        console.log(chalk.dim('  Notification window opening...\n'));

        this.running = true;

        process.on('SIGINT', () => {
            console.log(chalk.yellow('\nUse "exit" to quit'));
        });

        if (this.config.websocket.autoConnect) {
            await this.ws.connect();
        }

        const { input } = require('@inquirer/prompts');

        while (this.running) {
            try {
                const line = await input({
                    message:  this.getPromptText(),
                    required: false,
                }).catch(() => null);

                if (line === null) {
                    console.log(chalk.yellow('Use "exit" to quit'));
                    continue;
                }

                const trimmed = line.trim();
                if (!trimmed) continue;

                this.history.push(trimmed);
                this.saveHistory();
                await this.execute(trimmed);

            } catch (err) {
                if (err.name === 'ExitPromptError' || err.message?.includes('force closed')) {
                    console.log(chalk.yellow('Use "exit" to quit'));
                } else {
                    console.log(chalk.red(`Shell error: ${err.message}`));
                }
            }
        }
    }

    restoreReadline() {}

    // ─── Execute ──────────────────────────────────────────────────────────────

    async execute(input) {
        if (!input.trim()) return;

        const args    = this.parseCommand(input);
        const cmdName = args[0].toLowerCase();
        const cmdArgs = args.slice(1);

        if (this.commands.has(cmdName)) {
            const cmd = this.commands.get(cmdName);
            try {
                const result = await cmd.handler(cmdArgs, this);
                if (result !== undefined) console.log(result);
            } catch (err) {
                console.log(chalk.red(`Error: ${err.message}`));
            }
            return;
        }

        if (this.commandRegistry) {
            const handled = await this.commandRegistry.execute(input, this);
            if (handled) return;
        }

        await this.executeSystemCommand(input);
    }

    // ─── Prompt ───────────────────────────────────────────────────────────────

    getPromptText() {
        let p = '';
        const room  = this.ws.getCurrentRoom?.();
        if (room) p += `[${room}] `;
        if (this.ws.isConnected?.()) p += '● ';

        let displayPath = this.currentDir;
        const homeDir   = os.homedir();

        if (process.platform === 'win32') {
            if (displayPath.toLowerCase() === homeDir.toLowerCase()) displayPath = '~';
            else if (displayPath.toLowerCase().startsWith(homeDir.toLowerCase()))
                displayPath = '~' + displayPath.slice(homeDir.length).replace(/\\/g, '/');
            else displayPath = displayPath.replace(/\\/g, '/');
        } else {
            displayPath = displayPath.replace(homeDir, '~');
        }

        p += `${this.username}@thinknsh:${displayPath} $`;
        return p;
    }

    getPrompt() { return this.getPromptText(); }

    printMessage(msg) { console.log(msg); }

    // ─── Built-ins ────────────────────────────────────────────────────────────

    registerBuiltinCommands() {
        this.registerCommand('help',       this.helpCommand.bind(this),      'Show available commands');
        this.registerCommand('exit',       () => { this.cleanup(); process.exit(0); }, 'Exit the shell');
        this.registerCommand('quit',       () => { this.cleanup(); process.exit(0); }, 'Exit the shell');
        this.registerCommand('clear',      () => console.clear(),            'Clear screen');
        this.registerCommand('history',    this.historyCommand.bind(this),   'Show command history');
        this.registerCommand('cd',         this.cdCommand.bind(this),        'Change directory');
        this.registerCommand('pwd',        () => console.log(process.cwd()), 'Print working directory');
        this.registerCommand('ls',         this.lsCommand.bind(this),        'List files');
        this.registerCommand('connect',    this.connectCommand.bind(this),   'Connect to WebSocket');
        this.registerCommand('disconnect', () => this.ws.disconnect(),       'Disconnect WebSocket');
        this.registerCommand('status',     this.statusCommand.bind(this),    'Show status');
        this.registerCommand('join',       this.joinCommand.bind(this),      'Join a room');
        this.registerCommand('leave',      () => this.ws.leaveRoom?.(),      'Leave current room');
        this.registerCommand('rooms',      this.roomsCommand.bind(this),     'List rooms');
        this.registerCommand('users',      this.usersCommand.bind(this),     'List users in room');
        this.registerCommand('say',        this.sayCommand.bind(this),       'Send a message');
        this.registerCommand('msg',        this.sayCommand.bind(this),       'Send a message (alias)');
        this.registerCommand('notify',     this.notifyCommand.bind(this),    'Send a notification');
        this.registerCommand('alias',      this.aliasCommand.bind(this),     'Create an alias');
        this.registerCommand('unalias',    this.unaliasCommand.bind(this),   'Remove an alias');
        this.registerCommand('set',        this.setCommand.bind(this),       'Set a variable');
        this.registerCommand('unset',      this.unsetCommand.bind(this),     'Unset a variable');

        this.addAlias('ll',  'ls -la');
        this.addAlias('..',  'cd ..');
        this.addAlias('...', 'cd ../..');
        this.addAlias('~',   'cd ~');
    }

    registerCommand(name, handler, description = '') { this.commands.set(name, { handler, description }); }
    addAlias(alias, command) { this.aliases.set(alias, command); }

    async helpCommand() {
        const categories = {
            'Core':          ['help', 'exit', 'quit', 'clear', 'history'],
            'Filesystem':    ['cd', 'pwd', 'ls'],
            'WebSocket':     ['connect', 'disconnect', 'status'],
            'Rooms':         ['join', 'leave', 'rooms', 'users'],
            'Messages':      ['say', 'msg'],
            'Notifications': ['notify'],
            'Aliases':       ['alias', 'unalias'],
            'Variables':     ['set', 'unset']
        };
        console.log(chalk.cyan('\n📚 Available Commands:'));
        console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        for (const [category, cmds] of Object.entries(categories)) {
            console.log(chalk.yellow(`\n${category}:`));
            cmds.forEach(cmd => {
                const c = this.commands.get(cmd);
                if (c) console.log(`  ${chalk.green(cmd.padEnd(12))} - ${c.description}`);
            });
        }
        console.log(chalk.dim('\nAny other command runs in your system shell\n'));
    }

    historyCommand() {
        this.history.forEach((cmd, i) => console.log(`${(i + 1).toString().padStart(4)}  ${cmd}`));
    }

    async cdCommand(args) {
        const target = args.join(' ').trim() || os.homedir();
        try {
            let newPath;
            if (target === '~' || target === '~/' || target === '~\\') newPath = os.homedir();
            else if (target.startsWith('~/') || target.startsWith('~\\')) newPath = path.join(os.homedir(), target.slice(2));
            else if (target === '..') newPath = path.dirname(this.currentDir);
            else if (target === '-') newPath = this.previousDir || this.currentDir;
            else if (process.platform === 'win32' && target.match(/^[a-zA-Z]:[\\/]/)) newPath = target;
            else newPath = path.resolve(this.currentDir, target);
            newPath = path.normalize(newPath);
            const stats = await fs.stat(newPath);
            if (!stats.isDirectory()) { console.log(chalk.red(`cd: not a directory: ${target}`)); return; }
            this.previousDir = this.currentDir;
            process.chdir(newPath);
            this.currentDir = process.cwd();
        } catch { console.log(chalk.red(`cd: no such directory: ${target}`)); }
    }

    async lsCommand(args) {
        try {
            const files    = await fs.readdir(this.currentDir);
            const showAll  = args.includes('-a') || args.includes('--all');
            const filtered = showAll ? files : files.filter(f => !f.startsWith('.'));
            const fileList = await Promise.all(filtered.map(async (file) => {
                const stat = await fs.stat(path.join(this.currentDir, file));
                return { name: file, isDir: stat.isDirectory(), mode: stat.mode };
            }));
            fileList.forEach(f => {
                if (f.isDir)             console.log(chalk.blue(f.name + '/'));
                else if (f.mode & 0o111) console.log(chalk.green(f.name + '*'));
                else                     console.log(f.name);
            });
        } catch (err) { console.log(chalk.red(`ls: ${err.message}`)); }
    }

    async connectCommand(args) {
        console.log(chalk.cyan(`🔌 Connecting...`));
        try { await this.ws.connect(); }
        catch (err) { console.log(chalk.red(`❌ ${err.message}`)); }
    }

    async statusCommand() {
        const connected = this.ws.isConnected();
        console.log(chalk.cyan('\n📊 Status:'));
        console.log(`WebSocket: ${connected ? chalk.green('✓ Connected') : chalk.red('✗ Disconnected')}`);
        if (connected) {
            console.log(`Socket ID: ${chalk.dim(this.ws.getSocketId())}`);
            console.log(`Server:    ${chalk.dim(this.ws.config.serverUrl)}`);
        }
        const room = this.ws.getCurrentRoom();
        console.log(`Room:      ${room ? chalk.green(room) : chalk.yellow('None')}`);
        console.log(`Directory: ${chalk.blue(this.currentDir)}`);
    }

    async joinCommand(args) {
        if (!args[0]) { console.log(chalk.red('Usage: join <room-id> [password]')); return; }
        if (!this.ws.isConnected()) { console.log(chalk.yellow('Connecting...')); await this.ws.connect(); }
        console.log(chalk.cyan(`🔗 Joining: ${args[0]}...`));
        try {
            const result = await this.ws.joinRoom(args[0], args[1]);
            console.log(chalk.green(`Joined: ${result.roomName || args[0]}`));
        } catch (err) { console.log(chalk.red(`❌ ${err.message}`)); }
    }

    async roomsCommand() {
        if (!this.ws.isConnected()) { console.log(chalk.yellow('Not connected')); return; }
        this.ws.socket.emit('rooms:list');
        this.ws.socket.once('rooms:list', (data) => {
            if (data.rooms?.length) data.rooms.forEach(r => console.log(`  ${chalk.cyan(r.name || r.id)} — 👥 ${r.participantCount || 0}`));
            else console.log('  No rooms available');
        });
    }

    async usersCommand() {
        if (!this.ws.isConnected()) { console.log(chalk.yellow('Not connected')); return; }
        const room = this.ws.getCurrentRoom();
        if (!room) { console.log(chalk.yellow('Not in a room')); return; }
        try {
            const users = await this.ws.getParticipants();
            users.forEach(u => console.log(`  ${chalk.green('●')} ${u.username}${u.isTyping ? chalk.dim(' (typing...)') : ''}`));
        } catch (err) { console.log(chalk.red(`Failed: ${err.message}`)); }
    }

    async sayCommand(args) {
        const message = args.join(' ');
        if (!message) { console.log(chalk.red('Usage: say <message>')); return; }
        try {
            await this.ws.sendMessage(message);
            console.log(chalk.green(`You: ${message}`));
        } catch (err) { console.log(chalk.red(`Failed: ${err.message}`)); }
    }

    async notifyCommand(args) {
        const type = args[0] || 'info';
        const msg  = args.slice(1).join(' ');
        if (!msg) { console.log(chalk.red('Usage: notify <type> <message>')); return; }
        try {
            await this.ws.sendNotification({ type, title: 'Shell Notification', message: msg });
            console.log(chalk.green('Notification sent'));
        } catch (err) { console.log(chalk.red(`Failed: ${err.message}`)); }
    }

    async aliasCommand(args) {
        if (!args.length) { for (const [a, c] of this.aliases) console.log(`  ${chalk.green(a.padEnd(12))} → ${chalk.dim(c)}`); return; }
        if (args.length < 2) { console.log(chalk.red('Usage: alias <n> <cmd>')); return; }
        this.addAlias(args[0], args.slice(1).join(' '));
        console.log(chalk.green(`${args[0]} → ${args.slice(1).join(' ')}`));
    }

    async unaliasCommand(args) {
        if (!args[0]) { console.log(chalk.red('Usage: unalias <n>')); return; }
        this.aliases.delete(args[0]) ? console.log(chalk.green(`Removed: ${args[0]}`)) : console.log(chalk.red(`Not found: ${args[0]}`));
    }

    async setCommand(args) {
        if (!args.length) { for (const [k, v] of this.variables) console.log(`  ${chalk.green(k.padEnd(12))} = ${v}`); return; }
        if (args.length < 2) { console.log(chalk.red('Usage: set <n> <value>')); return; }
        this.variables.set(args[0], args.slice(1).join(' '));
        console.log(chalk.green(`${args[0]} = ${args.slice(1).join(' ')}`));
    }

    async unsetCommand(args) {
        if (!args[0]) { console.log(chalk.red('Usage: unset <n>')); return; }
        this.variables.delete(args[0]) ? console.log(chalk.green(`Removed`)) : console.log(chalk.red(`Not found`));
    }

    getSessionPath() { return path.join(this.config.configDir, 'session.json'); }

    parseCommand(input) {
        const args = [];
        let current = '', inQuotes = false, quoteChar = '', escapeNext = false;
        for (const char of input) {
            if (char === '\\' && !escapeNext && !inQuotes) { escapeNext = true; continue; }
            if (escapeNext) { current += char; escapeNext = false; continue; }
            if ((char === '"' || char === "'") && !inQuotes) { inQuotes = true; quoteChar = char; continue; }
            if (char === quoteChar && inQuotes) { inQuotes = false; quoteChar = ''; continue; }
            if (char === ' ' && !inQuotes) { if (current) { args.push(current); current = ''; } continue; }
            current += char;
        }
        if (current) args.push(current);
        return args;
    }

    executeSystemCommand(command) {
        return new Promise((resolve) => {
            const child = spawn(command, [], {
                cwd: this.currentDir, shell: true, stdio: 'inherit',
                env: { ...process.env, THINKNCOLLAB_SHELL: '1' }
            });
            child.on('close', () => resolve());
            child.on('error', () => { console.log(chalk.red(`Command not found: ${command}`)); resolve(); });
        });
    }

    showWelcome() {
        try {
            const figlet = require('figlet');
            console.log(chalk.cyan(figlet.textSync('ThinkNCollab', { font: 'Standard' })));
        } catch {}
        console.log(chalk.cyan(`
╔══════════════════════════════════════════════════════╗
║     ThinkNCollab Shell v0.0.05                       ║
║     Type 'help' for commands                         ║
╚══════════════════════════════════════════════════════╝`));
    }

    loadHistory() {
        try {
            if (fs.existsSync(this.config.historyFile))
                this.history = fs.readFileSync(this.config.historyFile, 'utf8').split('\n').filter(l => l.trim());
        } catch {}
    }

    saveHistory() {
        try { fs.writeFileSync(this.config.historyFile, this.history.slice(-this.config.maxHistory).join('\n')); } catch {}
    }

    cleanup() {
        if (this.tcpServer) { try { this.tcpServer.close(); } catch {} }
        if (this.ws) this.ws.disconnect();
        this.saveHistory();
    }
}

module.exports = ThinkNCollabShell;