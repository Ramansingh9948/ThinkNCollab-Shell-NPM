/**
 * src/core/shell.js — ThinkNCollab Shell Core
 */

const path   = require('path');
const fs     = require('fs-extra');
const os     = require('os');
const chalk  = require('chalk');
const net    = require('net');
const { spawn } = require('child_process');
const EventEmitter     = require('events');
const WebSocketManager = require('./websocket');
const CommandRegistry  = require('../commands');
const ThinkNCollabAPI  = require('./api-client');
const { loadProjectConfig, hasProjectConfig } = require('./project-config');

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
                serverUrl:   options.serverUrl   || 'http://localhost:3001',
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

        // TCP notification IPC
        this.notifyClients = new Set();
        this.tcpServer     = null;

        this.api = new ThinkNCollabAPI({
            apiUrl: options.apiUrl || 'http://localhost:3001',
            wsUrl:  options.wsUrl  || 'http://localhost:3001'
        });

        this.commands  = new Map();
        this.aliases   = new Map();
        this.variables = new Map();

        // ★ Restore persisted session on startup
        // Handles both .tncproject boot AND manual login from a previous session
        if (this.api.isAuthenticated()) {
            this.ws.setUser(this.api.getUser(), this.api.getToken());
        }

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
            this.tcpServer.listen(this.notifyPort, '127.0.0.1', () => resolve());
            this.tcpServer.on('error', (err) => {
                console.log(chalk.yellow(`⚠️  Notification server: ${err.message}`));
                resolve();
            });
        });
    }

    pushNotification(data) {
        if (this.notifyClients.size === 0) return;
        const line = JSON.stringify(data) + '\n';
        for (const client of this.notifyClients) {
            try { client.write(line); } catch {}
        }
    }

    // ─── Spawn notification window ────────────────────────────────────────────

    spawnNotificationWindow() {
        const notifyScript = path.join(__dirname, 'notification-window.js');
        const env = { ...process.env, THINKNSH_NOTIFY_PORT: String(this.notifyPort) };

        try {
            if (process.platform === 'win32') {
                const isVSCode = process.env.TERM_PROGRAM === 'vscode';
                if (isVSCode) {
                    console.log(chalk.yellow('\n  VS Code detected — open a new terminal tab and run:'));
                    console.log(chalk.cyan(`  $env:THINKNSH_NOTIFY_PORT=${this.notifyPort}; node "${notifyScript}"\n`));
                } else {
                    const nodeExe = process.execPath;
                    spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', `"${nodeExe}" "${notifyScript}"`],
                        { detached: true, stdio: 'ignore', env, shell: false }).unref();
                }
            } else if (process.platform === 'darwin') {
                const script = `tell application "Terminal" to do script "THINKNSH_NOTIFY_PORT=${this.notifyPort} node '${notifyScript}'"`;
                spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref();
            } else {
                const terminals = [
                    ['gnome-terminal', ['--', 'node', notifyScript]],
                    ['xterm',          ['-e', `node "${notifyScript}"`]],
                    ['konsole',        ['--noclose', '-e', 'node', notifyScript]],
                ];
                for (const [cmd, args] of terminals) {
                    try { spawn(cmd, args, { detached: true, stdio: 'ignore', env }).unref(); break; } catch {}
                }
            }
        } catch (err) {
            console.log(chalk.yellow(`⚠️  Could not spawn notification window: ${err.message}`));
            console.log(chalk.dim(`   Run manually: node "${notifyScript}"`));
        }
    }

    // ─── WebSocket → Shell + TCP bridge ──────────────────────────────────────

    setupWebSocketHandlers() {
        this.ws.on('connected',    (d) => this.pushNotification({ type: 'connected',    socketId: d.socketId }));
        this.ws.on('disconnected', (d) => this.pushNotification({ type: 'disconnected', reason: d.reason }));
        this.ws.on('reconnected',  ()  => this.pushNotification({ type: 'connected',    socketId: 'reconnected' }));

        this.ws.on('message', (d) => {
            const myId = this.api.getUser()?._id;
            if (myId && d.userId === myId) return;
            this.pushNotification({ type: 'message', from: d.username, text: d.message });
        });

        this.ws.on('messageHistory', (messages) => {
            if (!messages?.length) return;
            console.log(chalk.dim('\n  ─── Room History ───────────────────────────────'));
            messages.forEach(msg => {
                const from    = msg.name || msg.username || msg.sender?.name || 'Unknown';
                const text    = msg.message || msg.content || msg.text || '';
                const ts      = msg.timestamp || msg.createdAt;
                const timeStr = ts ? chalk.dim(`[${new Date(ts).toLocaleTimeString()}]`) : '';
                console.log(`  ${timeStr} ${chalk.cyan(from + ':')} ${chalk.white(text)}`);
            });
            console.log(chalk.dim('  ────────────────────────────────────────────────\n'));
        });

        this.ws.on('userJoined',   (d) => this.pushNotification({ type: 'userJoined',   username: d.username }));
        this.ws.on('userLeft',     (d) => this.pushNotification({ type: 'userLeft',     username: d.username }));

        this.ws.on('notification', (d) => {
            this.pushNotification({
                type:       'notification',
                level:      d.type,
                title:      d.title,
                message:    d.message,
                taskTitle:  d.taskTitle,
                assignedBy: d.assignedBy,
            });
        });

        this.ws.on('error', (e) => {
            console.log(chalk.red(`⚠️  WebSocket error: ${e.message}`));
            this.pushNotification({ type: 'notification', level: 'error', title: 'WebSocket Error', message: e.message });
        });
    }

    // ─── Start ────────────────────────────────────────────────────────────────

    async start() {
        this.showWelcome();

        await this.startTCPServer();
        console.log(chalk.dim(`  Notification server ready on port ${this.notifyPort}`));

        this.spawnNotificationWindow();
        console.log(chalk.dim('  Notification window opening...\n'));

        this.running = true;
        process.on('SIGINT', () => console.log(chalk.yellow('\nUse "exit" to quit')));

        // Try .tncproject auto-boot first
        const booted = await this._bootFromProjectConfig();

        // If no .tncproject but autoConnect is set, connect WS anyway
        if (!booted && this.config.websocket.autoConnect) {
            await this.ws.connect().catch(() => {});
        }

        const { input } = require('@inquirer/prompts');

        while (this.running) {
            try {
                const line = await input({ message: this.getPromptText(), required: false }).catch(() => null);
                if (line === null) { console.log(chalk.yellow('Use "exit" to quit')); continue; }
                const trimmed = line.trim();
                if (!trimmed) continue;
                this.history.push(trimmed);
                this.saveHistory();
                await this.execute(trimmed);
            } catch (err) {
                if (err.name === 'ExitPromptError' || err.message?.includes('force closed'))
                    console.log(chalk.yellow('Use "exit" to quit'));
                else
                    console.log(chalk.red(`Shell error: ${err.message}`));
            }
        }
    }

    // ─── Boot from .tncproject ────────────────────────────────────────────────

    async _bootFromProjectConfig() {
        if (!hasProjectConfig()) return false;

        let cfg;
        try {
            cfg = loadProjectConfig();
        } catch (err) {
            console.log(chalk.yellow(`⚠️  .tncproject: ${err.message}\n`));
            return false;
        }

        console.log(chalk.dim(`  📄 .tncproject found`));
        console.log(chalk.dim(`     Room : ${cfg.roomId}`));
        console.log(chalk.dim(`     File : ${cfg.filePath}\n`));

        // Send raw encrypted file to server — server decrypts, returns shellToken
        let result;
        try {
            result = await this.api._request('POST', '/config/verify-config', {
                fileBase64: cfg.fileBase64,
                roomId:     cfg.roomId,
            });
        } catch (err) {
            console.log(chalk.red(`❌ .tncproject auth failed: ${err.message}`));
            console.log(chalk.dim('   Falling back to manual login.\n'));
            return false;
        }

        // Save session exactly like manual login
        this.api._saveSession({
            token: result.shellToken,
            user: {
                _id:      result._id.toString(),
                userId:   result._id.toString(),
                email:    result.email,
                name:     result.name,
                userType: 'User',
            },
            timestamp: new Date().toISOString(),
        });

        this.ws.setUser(this.api.getUser(), result.shellToken);

        // Connect WebSocket
        try {
            await this.ws.connect(result.shellToken);
        } catch (err) {
            console.log(chalk.yellow(`⚠️  WebSocket: ${err.message}`));
            console.log(chalk.green(`✅ ${result.name} logged in (offline mode)\n`));
            return true;
        }

        // Auto-join the project room
        try {
            await this.ws.joinRoom(result.roomId.toString());
            console.log(chalk.green(`✅ ${result.name} → room "${result.roomName || result.roomId}"\n`));
        } catch (err) {
            console.log(chalk.yellow(`⚠️  Could not auto-join room: ${err.message}`));
            console.log(chalk.dim('   Use "join <room-id>" manually.\n'));
        }

        return true;
    }

    // ─── Execute ──────────────────────────────────────────────────────────────

    async execute(input) {
        if (!input.trim()) return;

        const args    = this.parseCommand(input);
        const cmdName = args[0].toLowerCase();
        const cmdArgs = args.slice(1);

        if (this.commands.has(cmdName)) {
            try { await this.commands.get(cmdName).handler(cmdArgs, this); }
            catch (err) { console.log(chalk.red(`Error: ${err.message}`)); }
            process.stdout.write('\r\n');
            return;
        }

        if (this.commandRegistry) {
            const handled = await this.commandRegistry.execute(input, this);
            if (handled) {
                process.stdout.write('\r\n');
                return;
            }
        }

        await this.executeSystemCommand(input);
    }

    // ─── Prompt ───────────────────────────────────────────────────────────────

    getPromptText() {
        let p = '';
        const room = this.ws.getCurrentRoom?.();
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

        return `${this.username}@thinknsh:${displayPath} $`;
    }

    getPrompt()       { return this.getPromptText(); }
    printMessage(msg) { console.log(msg); }

    // ─── Built-ins ────────────────────────────────────────────────────────────

    registerBuiltinCommands() {
        const r = (name, handler, desc) => this.commands.set(name, { handler, description: desc });

        r('help',       this.helpCommand.bind(this),      'Show available commands');
        r('exit',       () => { this.cleanup(); process.exit(0); }, 'Exit the shell');
        r('quit',       () => { this.cleanup(); process.exit(0); }, 'Exit the shell');
        r('clear',      () => console.clear(),            'Clear screen');
        r('history',    this.historyCommand.bind(this),   'Show command history');
        r('cd',         this.cdCommand.bind(this),        'Change directory');
        r('pwd',        () => console.log(process.cwd()), 'Print working directory');
        r('ls',         this.lsCommand.bind(this),        'List files');
        r('connect',    this.connectCommand.bind(this),   'Connect to WebSocket');
        r('disconnect', () => this.ws.disconnect(),       'Disconnect WebSocket');
        r('status',     this.statusCommand.bind(this),    'Show connection status');
        r('join',       this.joinCommand.bind(this),      'Join a room');
        r('leave',      () => this.ws.leaveRoom?.(),      'Leave current room');
        r('rooms',      this.roomsCommand.bind(this),     'List rooms');
        r('say',        this.sayCommand.bind(this),       'Send a message');
        r('msg',        this.sayCommand.bind(this),       'Send a message');
        r('set',        this.setCommand.bind(this),       'Set a variable');
        r('unset',      this.unsetCommand.bind(this),     'Unset a variable');

        this.addAlias('ll',  'ls -la');
        this.addAlias('..',  'cd ..');
        this.addAlias('~',   'cd ~');
    }

    registerCommand(name, handler, description = '') { this.commands.set(name, { handler, description }); }
    addAlias(alias, command) { this.aliases.set(alias, command); }

    async helpCommand() {
        if (this.commandRegistry) console.log(this.commandRegistry.getHelpText());
        console.log(chalk.dim('  Any unrecognised command runs in your system shell\n'));
    }

    historyCommand() {
        this.history.forEach((cmd, i) => console.log(`${(i + 1).toString().padStart(4)}  ${cmd}`));
    }

    async cdCommand(args) {
        const target = args.join(' ').trim() || os.homedir();
        try {
            let newPath;
            if (target === '~')   newPath = os.homedir();
            else if (target === '..') newPath = path.dirname(this.currentDir);
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
            const showAll  = args.includes('-a');
            const filtered = showAll ? files : files.filter(f => !f.startsWith('.'));
            const fileList = await Promise.all(filtered.map(async (file) => {
                const stat = await fs.stat(path.join(this.currentDir, file));
                return { name: file, isDir: stat.isDirectory() };
            }));
            fileList.forEach(f => f.isDir ? console.log(chalk.blue(f.name + '/')) : console.log(f.name));
        } catch (err) { console.log(chalk.red(`ls: ${err.message}`)); }
    }

    async connectCommand() {
        console.log(chalk.cyan('🔌 Connecting...'));
        try { await this.ws.connect(); }
        catch (err) { console.log(chalk.red(`❌ ${err.message}`)); }
    }

    async statusCommand() {
        const connected = this.ws.isConnected();
        console.log(chalk.cyan('\n📊 Status:'));
        console.log(`  WebSocket : ${connected ? chalk.green('✓ Connected') : chalk.red('✗ Disconnected')}`);
        if (connected) console.log(`  Socket ID : ${chalk.dim(this.ws.getSocketId())}`);
        const room = this.ws.getCurrentRoom();
        console.log(`  Room      : ${room ? chalk.green(room) : chalk.yellow('None')}`);
        console.log(`  Auth      : ${this.api.isAuthenticated() ? chalk.green('✓ Logged in') : chalk.yellow('Not logged in')}`);
        const user = this.api.getUser();
        if (user) console.log(`  User      : ${chalk.dim(user.name || user.email)}`);
        console.log('');
    }

    async joinCommand(args) {
        if (!args[0]) { console.log(chalk.red('Usage: join <room-id>')); return; }
        if (!this.ws.isConnected()) { console.log(chalk.yellow('Connecting...')); await this.ws.connect(); }
        try {
            const result = await this.ws.joinRoom(args[0]);
            console.log(chalk.green(`✅ Joined: ${result.roomName || args[0]}`));
        } catch (err) { console.log(chalk.red(`❌ ${err.message}`)); }
    }

    async roomsCommand() {
        if (!this.ws.isConnected()) { console.log(chalk.yellow('Not connected')); return; }
        this.ws.socket.emit('rooms:list');
        this.ws.socket.once('rooms:list', (data) => {
            if (data.rooms?.length) data.rooms.forEach(r => console.log(`  ${chalk.cyan(r.name || r.id)} — 👥 ${r.participantCount || 0}`));
            else console.log('  No rooms');
        });
    }

    async sayCommand(args) {
        const message = args.join(' ');
        if (!message) { console.log(chalk.red('Usage: say <message>')); return; }
        try {
            await this.ws.sendMessage(message);
            const displayName = this.api.getUser()?.name || this.username;
            console.log(chalk.green(`You: ${message}`));
            this.pushNotification({ type: 'message', from: `You (${displayName})`, text: message });
        } catch (err) { console.log(chalk.red(`Failed: ${err.message}`)); }
    }

    async setCommand(args) {
        if (!args.length) { for (const [k, v] of this.variables) console.log(`  ${chalk.green(k.padEnd(12))} = ${v}`); return; }
        this.variables.set(args[0], args.slice(1).join(' '));
        console.log(chalk.green(`${args[0]} = ${args.slice(1).join(' ')}`));
    }

    async unsetCommand(args) {
        if (!args[0]) return;
        this.variables.delete(args[0]);
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
                cwd:   this.currentDir,
                shell: true,
                stdio: 'inherit'
            });
            child.on('close', (code) => {
                // Update currentDir in case command changed it (cd won't but others might)
                try { this.currentDir = process.cwd(); } catch {}
                process.stdout.write('\r\n');
                resolve();
            });
            child.on('error', () => {
                console.log(chalk.red(`Command not found: ${command}`));
                resolve();
            });
        });
    }

    showWelcome() {
        try { const figlet = require('figlet'); console.log(chalk.cyan(figlet.textSync('ThinkNCollab', { font: 'Standard' }))); } catch {}
        console.log(chalk.cyan(`
╔══════════════════════════════════════════════════════╗
║     ThinkNCollab Shell v0.0.5                        ║
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