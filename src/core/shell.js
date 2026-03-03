/**
 * ThinkNCollab Shell Core
 * Main shell class with WebSocket integration
 */

const readline = require('readline');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const chalk = require('chalk');
const { exec, spawn } = require('child_process');
const WebSocketManager = require('./websocket');
const EventEmitter = require('events');
const CommandRegistry = require('../commands');
const ThinkNCollabAPI = require('./api-client');

class ThinkNCollabShell extends EventEmitter {
constructor(options = {}) {
    super();
    
    // Configuration
    this.config = {
        historyFile: path.join(os.homedir(), '.thinknsh_history'),
        configDir: path.join(os.homedir(), '.thinkncollab'),
        maxHistory: 1000,
        prompt: options.prompt || 'thinknsh> ',
        websocket: {
            serverUrl: options.serverUrl || 'https://api.thinkncollab.com',
            autoConnect: options.autoConnect || false
        },
        ...options
    };
    
    // Ensure config directory exists
    fs.ensureDirSync(this.config.configDir);
    
    // Initialize components
    this.ws = new WebSocketManager(this.config.websocket);
    this.rl = null;
    this.currentDir = process.cwd();
    this.username = os.userInfo().username;
    this.hostname = os.hostname();
    this.history = [];
    
    // ✅ FIX: Initialize API first
    this.api = new ThinkNCollabAPI({
        apiUrl: options.apiUrl || 'http://localhost:3001',
        wsUrl: options.wsUrl || 'http://localhost:3001'
    });
    
    // ✅ FIX: Remove these lines - they're causing duplication!
    this.commands = new Map();      //  ← REMOVE THIS
    this.aliases = new Map();      //   ← REMOVE THIS
    
    this.variables = new Map();
    this.isTyping = false;
    this.typingTimeout = null;
    
    // Load history
    this.loadHistory();
    
    // ✅ FIX: Register built-in commands FIRST
    this.registerBuiltinCommands();
    
    // ✅ FIX: THEN initialize command registry (this will have its own Map)
    this.commandRegistry = new CommandRegistry(this);  // ← Use different name!
    
    // Setup WebSocket event handlers
    this.setupWebSocketHandlers();
}
    
    /**
     * Setup WebSocket event handlers
     */
    setupWebSocketHandlers() {
        this.ws.on('connected', (data) => {
            this.printMessage(chalk.green(`✅ Connected to ThinkNCollab server (ID: ${data.socketId})`));
            this.emit('ws:connected', data);
        });
        
        this.ws.on('disconnected', (data) => {
            this.printMessage(chalk.yellow(`⚠️ Disconnected: ${data.reason}`));
            this.emit('ws:disconnected', data);
        });
        
        this.ws.on('reconnected', (data) => {
            this.printMessage(chalk.green(`✅ Reconnected after ${data.attemptNumber} attempts`));
            this.emit('ws:reconnected', data);
        });
        
        this.ws.on('message', (data) => {
            this.handleIncomingMessage(data);
        });
        
        this.ws.on('notification', (data) => {
            this.handleNotification(data);
        });
        
        this.ws.on('userJoined', (data) => {
            this.printMessage(chalk.cyan(`👤 ${data.username} joined the room`));
            this.emit('user:joined', data);
        });
        
        this.ws.on('userLeft', (data) => {
            this.printMessage(chalk.yellow(`👤 ${data.username} left the room`));
            this.emit('user:left', data);
        });
        
        this.ws.on('userTyping', (data) => {
            if (data.isTyping) {
                this.showTypingIndicator(data.username);
            } else {
                this.hideTypingIndicator(data.username);
            }
        });
        
        this.ws.on('terminalOutput', (data) => {
            this.printMessage(chalk.dim(`[${data.username}] $ ${data.command}`));
            this.printMessage(chalk.gray(data.output));
        });
        
        this.ws.on('error', (error) => {
            this.printMessage(chalk.red(`❌ WebSocket error: ${error.message}`));
        });
    }
    
    /**
     * Start the shell
     */
    async start() {
        this.showWelcome();
        
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: this.getPrompt(),
            completer: this.completer.bind(this)
        });
        
        // Handle input
        this.rl.on('line', async (line) => {
            const input = line.trim();
            
            if (input) {
                this.history.push(input);
                this.saveHistory();
                await this.execute(input);
            }
            
            this.rl.setPrompt(this.getPrompt());
            this.rl.prompt();
        });
        
        // Handle exit
        this.rl.on('close', () => {
            this.cleanup();
            process.exit(0);
        });
        
        // Handle signals
        process.on('SIGINT', () => {
            this.handleInterrupt();
        });
        
        this.rl.prompt();
        
        // Auto-connect if configured
        if (this.config.websocket.autoConnect) {
            await this.ws.connect();
        }
    }
    
    /**
     * Execute a command
     */
async execute(input) {
    if (!input.trim()) return;
    
    // Add to history
    this.history.push(input);
    this.saveHistory();
    
    const args = this.parseCommand(input);
    const cmdName = args[0].toLowerCase();
    const cmdArgs = args.slice(1);
    
    // DEBUG
    console.log(chalk.dim(`[Exec] Command: ${cmdName}`));
    
    // Check system commands first (cd, ls, etc.)
    if (this.systemCommands && this.systemCommands.has(cmdName)) {
        const cmd = this.systemCommands.get(cmdName);
        try {
            const result = await cmd.handler(cmdArgs, this);
            if (result !== undefined) console.log(result);
        } catch (error) {
            console.log(chalk.red(`Error: ${error.message}`));
        }
        return;
    }
    
    // Check registry commands
    if (this.commandRegistry) {
        const handled = await this.commandRegistry.execute(input, this);
        if (handled) return;
    }
    
    // If not a built-in command, run as system command
    await this.executeSystemCommand(input);
}
    
    /**
     * Helper to get session path - ADD THIS METHOD
     */
    getSessionPath() {
        return path.join(this.config.configDir, 'session.json');
    }
    
    /**
     * Print message without breaking prompt - ADD THIS METHOD
     */
    printMessage(message) {
        if (this.rl) {
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            console.log(message);
            this.rl.prompt(true);
        } else {
            console.log(message);
        }
    }
    /**
     * Register built-in commands
     */
    registerBuiltinCommands() {
        // Core shell commands
        this.registerCommand('help', this.helpCommand.bind(this), 'Show this help');
        this.registerCommand('exit', () => process.exit(0), 'Exit the shell');
        this.registerCommand('quit', () => process.exit(0), 'Exit the shell');
        this.registerCommand('clear', () => console.clear(), 'Clear the screen');
        this.registerCommand('history', this.historyCommand.bind(this), 'Show command history');
        
        // Directory commands
        this.registerCommand('cd', this.cdCommand.bind(this), 'Change directory');
        this.registerCommand('pwd', () => process.cwd(), 'Print working directory');
        this.registerCommand('ls', this.lsCommand.bind(this), 'List files');
        
        // WebSocket commands
        this.registerCommand('connect', this.connectCommand.bind(this), 'Connect to WebSocket server');
        this.registerCommand('disconnect', () => this.ws.disconnect(), 'Disconnect from WebSocket');
        this.registerCommand('status', this.statusCommand.bind(this), 'Show connection status');
        
        // Room commands
        this.registerCommand('join', this.joinCommand.bind(this), 'Join a collaboration room');
        this.registerCommand('leave', () => this.ws.leaveRoom(), 'Leave current room');
        this.registerCommand('rooms', this.roomsCommand.bind(this), 'List available rooms');
        this.registerCommand('users', this.usersCommand.bind(this), 'List users in room');
        
        // Message commands
        this.registerCommand('say', this.sayCommand.bind(this), 'Send a message to the room');
        this.registerCommand('msg', this.sayCommand.bind(this), 'Send a message (alias)');
        
        // Notification commands
        this.registerCommand('notify', this.notifyCommand.bind(this), 'Send a notification');
        
        // Alias commands
        this.registerCommand('alias', this.aliasCommand.bind(this), 'Create an alias');
        this.registerCommand('unalias', this.unaliasCommand.bind(this), 'Remove an alias');
        
        // Variable commands
        this.registerCommand('set', this.setCommand.bind(this), 'Set a variable');
        this.registerCommand('unset', this.unsetCommand.bind(this), 'Unset a variable');
        
        // Add aliases
        this.addAlias('ll', 'ls -la');
        this.addAlias('..', 'cd ..');
        this.addAlias('...', 'cd ../..');
        this.addAlias('~', 'cd ~');
    }
    
    /**
     * Register a command
     */
    registerCommand(name, handler, description = '') {
        this.commands.set(name, { handler, description });
    }
    
    /**
     * Add an alias
     */
    addAlias(alias, command) {
        this.aliases.set(alias, command);
    }
    
    /**
     * Get formatted prompt
     */
getPrompt() {
    let prompt = '';
    
    // Add room indicator if in a room
    const room = this.ws.getCurrentRoom();
    if (room) {
        prompt += chalk.magenta(`[${room}] `);
    }
    
    // Add connection indicator
    if (this.ws.isConnected()) {
        prompt += chalk.green('● ');
    }
    
    // FIX: Better path display for Windows
    let displayPath = this.currentDir;
    const homeDir = os.homedir();
    
    if (process.platform === 'win32') {
        // Windows: Show clean path without C:\Users\username
        if (displayPath.toLowerCase() === homeDir.toLowerCase()) {
            displayPath = '~';  // At home directory
        } else if (displayPath.toLowerCase().startsWith(homeDir.toLowerCase())) {
            // In subdirectory of home
            const relativePath = displayPath.slice(homeDir.length);
            displayPath = '~' + relativePath.replace(/\\/g, '/');
        } else {
            // Outside home, show full path with forward slashes for consistency
            displayPath = displayPath.replace(/\\/g, '/');
        }
    } else {
        // Unix: Use ~ for home
        displayPath = displayPath.replace(homeDir, '~');
    }
    
    prompt += chalk.cyan(`${this.username}@thinknsh`) + ':';
    prompt += chalk.blue(displayPath) + ' ';
    
    // Add prompt symbol
    prompt += chalk.green('$ ');
    
    return prompt;
}
    
    /**
     * Parse command with quotes
     */
/**
 * Parse command with support for quoted strings and escaped spaces
 */
parseCommand(input) {
    const args = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    let escapeNext = false;
    
    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        
        // Handle escape character
        if (char === '\\' && !escapeNext && !inQuotes) {
            escapeNext = true;
            continue;
        }
        
        if (escapeNext) {
            current += char;
            escapeNext = false;
            continue;
        }
        
        // Handle quotes
        if ((char === '"' || char === "'") && !inQuotes) {
            inQuotes = true;
            quoteChar = char;
            continue;
        } else if (char === quoteChar && inQuotes) {
            inQuotes = false;
            quoteChar = '';
            continue;
        }
        
        // Handle spaces (argument separator)
        if (char === ' ' && !inQuotes) {
            if (current) {
                args.push(current);
                current = '';
            }
            continue;
        }
        
        // Add character to current argument
        current += char;
    }
    
    // Add last argument
    if (current) {
        args.push(current);
    }
    
    return args;
}
    
    /**
     * Execute system command
     */
    executeSystemCommand(command) {
        return new Promise((resolve) => {
            const child = spawn(command, [], {
                cwd: this.currentDir,
                shell: true,
                stdio: 'inherit',
                env: {
                    ...process.env,
                    THINKNCOLLAB_SHELL: '1'
                }
            });
            
            child.on('close', (code) => {
                if (code !== 0) {
                    // Command failed, but we don't show error for normal commands
                }
                resolve();
            });
            
            child.on('error', (error) => {
                console.log(chalk.red(`Command not found: ${command}`));
                resolve();
            });
        });
    }
    
    /**
     * Command handlers
     */
    async helpCommand(args) {
        console.log(chalk.cyan('\n📚 Available Commands:'));
        console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        
        const categories = {
            'Core': ['help', 'exit', 'quit', 'clear', 'history'],
            'Filesystem': ['cd', 'pwd', 'ls'],
            'WebSocket': ['connect', 'disconnect', 'status'],
            'Rooms': ['join', 'leave', 'rooms', 'users'],
            'Messages': ['say', 'msg'],
            'Notifications': ['notify'],
            'Aliases': ['alias', 'unalias'],
            'Variables': ['set', 'unset']
        };
        
        for (const [category, cmds] of Object.entries(categories)) {
            console.log(chalk.yellow(`\n${category}:`));
            cmds.forEach(cmd => {
                const command = this.commands.get(cmd);
                if (command) {
                    console.log(`  ${chalk.green(cmd.padEnd(12))} - ${command.description}`);
                }
            });
        }
        
        console.log(chalk.dim('\nAny other command is passed to your system shell\n'));
    }
    
async cdCommand(args) {
    // Join all args to handle paths with spaces
    const target = args.join(' ').trim() || os.homedir();
    
    if (!target) {
        // No args, go home
        try {
            process.chdir(os.homedir());
            this.currentDir = process.cwd();
        } catch (error) {
            console.log(chalk.red(`cd: ${error.message}`));
        }
        return;
    }
    
    try {
        let newPath;
        
        // Handle special cases
        if (target === '~' || target === '~/' || target === '~\\') {
            newPath = os.homedir();
        } else if (target.startsWith('~/') || target.startsWith('~\\')) {
            // Handle ~/path with possible spaces
            const rest = target.slice(2);
            newPath = path.join(os.homedir(), rest);
        } else if (target === '..') {
            newPath = path.dirname(this.currentDir);
        } else if (target === '.') {
            newPath = this.currentDir;
        } else if (target === '-') {
            // Go to previous directory
            newPath = this.previousDir || this.currentDir;
        } else {
            // Handle Windows paths with spaces
            if (process.platform === 'win32') {
                // Check if it's an absolute path (with drive letter)
                if (target.match(/^[a-zA-Z]:[\\/]/) || target.match(/^[a-zA-Z]:$/)) {
                    newPath = target;
                } else {
                    // Relative path - resolve from current directory
                    newPath = path.resolve(this.currentDir, target);
                }
            } else {
                newPath = path.resolve(this.currentDir, target);
            }
        }
        
        // Normalize path (fixes any // or \/ issues)
        newPath = path.normalize(newPath);
        
        // Check if directory exists
        await fs.access(newPath);
        const stats = await fs.stat(newPath);
        
        if (!stats.isDirectory()) {
            console.log(chalk.red(`cd: ${target}: Not a directory`));
            return;
        }
        
        // Store previous directory
        this.previousDir = this.currentDir;
        
        // Change directory
        process.chdir(newPath);
        this.currentDir = process.cwd();
        
    } catch (error) {
        console.log(chalk.red(`cd: ${target}: No such directory`));
    }
}
    
    async lsCommand(args) {
        try {
            const files = await fs.readdir(this.currentDir);
            const showAll = args.includes('-a') || args.includes('--all');
            
            const filtered = showAll ? files : files.filter(f => !f.startsWith('.'));
            
            // Get file stats
            const fileList = await Promise.all(
                filtered.map(async (file) => {
                    const stat = await fs.stat(path.join(this.currentDir, file));
                    return {
                        name: file,
                        isDir: stat.isDirectory(),
                        size: stat.size,
                        mode: stat.mode
                    };
                })
            );
            
            // Colorize output
            fileList.forEach(file => {
                if (file.isDir) {
                    console.log(chalk.blue(file.name + '/'));
                } else if (file.mode & 0o111) {
                    console.log(chalk.green(file.name + '*'));
                } else {
                    console.log(file.name);
                }
            });
        } catch (error) {
            console.log(chalk.red(`ls: ${error.message}`));
        }
    }
    
    async connectCommand(args) {
        const serverUrl = args[0] || this.config.websocket.serverUrl;
        
        console.log(chalk.cyan(`🔌 Connecting to ${serverUrl}...`));
        
        try {
            await this.ws.connect();
        } catch (error) {
            console.log(chalk.red(`❌ Connection failed: ${error.message}`));
        }
    }
    
    async statusCommand() {
        console.log(chalk.cyan('\n📊 Status:'));
        console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        
        const connected = this.ws.isConnected();
        console.log(`WebSocket: ${connected ? chalk.green('✓ Connected') : chalk.red('✗ Disconnected')}`);
        
        if (connected) {
            console.log(`Socket ID: ${chalk.dim(this.ws.getSocketId())}`);
            console.log(`Server: ${chalk.dim(this.ws.config.serverUrl)}`);
        }
        
        const room = this.ws.getCurrentRoom();
        console.log(`Room: ${room ? chalk.green(room) : chalk.yellow('None')}`);
        
        console.log(`Current Directory: ${chalk.blue(this.currentDir)}`);
        console.log(`History: ${chalk.yellow(this.history.length)} commands`);
        console.log(`Commands: ${chalk.green(this.commands.size)} registered`);
        console.log(`Aliases: ${chalk.green(this.aliases.size)} defined`);
    }
    
    async joinCommand(args) {
        const roomId = args[0];
        
        if (!roomId) {
            console.log(chalk.red('Usage: join <room-id> [password]'));
            return;
        }
        
        const password = args[1];
        
        if (!this.ws.isConnected()) {
            console.log(chalk.yellow('Not connected. Connecting first...'));
            await this.ws.connect();
        }
        
        console.log(chalk.cyan(`🔗 Joining room: ${roomId}...`));
        
        try {
            const result = await this.ws.joinRoom(roomId, password);
            console.log(chalk.green(`✅ Joined room: ${result.roomName || roomId}`));
            console.log(chalk.dim(`Participants: ${result.participantCount || '?'}`));
        } catch (error) {
            console.log(chalk.red(`❌ Failed to join: ${error.message}`));
        }
    }
    
    async roomsCommand() {
        if (!this.ws.isConnected()) {
            console.log(chalk.yellow('Not connected to WebSocket server'));
            return;
        }
        
        console.log(chalk.cyan('\n📋 Available Rooms:'));
        console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        
        // Request rooms list
        this.ws.socket.emit('rooms:list');
        
        this.ws.socket.once('rooms:list', (data) => {
            if (data.rooms && data.rooms.length > 0) {
                data.rooms.forEach(room => {
                    const current = room.id === this.ws.getCurrentRoom() ? chalk.green(' (current)') : '';
                    console.log(`  ${chalk.cyan(room.name || room.id)}${current}`);
                    if (room.description) {
                        console.log(`    ${chalk.dim(room.description)}`);
                    }
                    console.log(`    ${chalk.yellow('👥 ' + (room.participantCount || 0))} participants`);
                });
            } else {
                console.log('  No rooms available');
            }
        });
    }
    
    async usersCommand() {
        if (!this.ws.isConnected()) {
            console.log(chalk.yellow('Not connected'));
            return;
        }
        
        const room = this.ws.getCurrentRoom();
        if (!room) {
            console.log(chalk.yellow('Not in a room'));
            return;
        }
        
        console.log(chalk.cyan(`\n👥 Users in ${room}:`));
        console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        
        try {
            const participants = await this.ws.getParticipants();
            participants.forEach(user => {
                const typing = user.isTyping ? chalk.green(' (typing...)') : '';
                console.log(`  ${chalk.green('●')} ${user.username}${typing}`);
                if (user.status) {
                    console.log(`    ${chalk.dim(user.status)}`);
                }
            });
        } catch (error) {
            console.log(chalk.red(`Failed to get users: ${error.message}`));
        }
    }
    
    async sayCommand(args) {
        const message = args.join(' ');
        
        if (!message) {
            console.log(chalk.red('Usage: say <message>'));
            return;
        }
        
        try {
            await this.ws.sendMessage(message);
            
            // Clear typing indicator
            if (this.isTyping) {
                this.ws.sendTyping(false);
                this.isTyping = false;
                clearTimeout(this.typingTimeout);
            }
            
            // Echo locally
            console.log(chalk.green(`You: ${message}`));
        } catch (error) {
            console.log(chalk.red(`Failed to send: ${error.message}`));
        }
    }
    
    async notifyCommand(args) {
        const type = args[0] || 'info';
        const message = args.slice(1).join(' ');
        
        if (!message) {
            console.log(chalk.red('Usage: notify <type> <message>'));
            console.log(chalk.dim('Types: info, success, warning, error'));
            return;
        }
        
        try {
            await this.ws.sendNotification({
                type,
                title: 'Shell Notification',
                message
            });
            
            console.log(chalk.green('✅ Notification sent'));
        } catch (error) {
            console.log(chalk.red(`Failed to send notification: ${error.message}`));
        }
    }
    
    async aliasCommand(args) {
        if (args.length === 0) {
            // List aliases
            console.log(chalk.cyan('\n🔧 Current Aliases:'));
            console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
            
            if (this.aliases.size === 0) {
                console.log('  No aliases defined');
            } else {
                for (const [alias, cmd] of this.aliases) {
                    console.log(`  ${chalk.green(alias.padEnd(12))} → ${chalk.dim(cmd)}`);
                }
            }
            return;
        }
        
        if (args.length < 2) {
            console.log(chalk.red('Usage: alias <name> <command>'));
            return;
        }
        
        const name = args[0];
        const command = args.slice(1).join(' ');
        
        this.addAlias(name, command);
        console.log(chalk.green(`✅ Alias created: ${name} → ${command}`));
    }
    
    async unaliasCommand(args) {
        if (args.length === 0) {
            console.log(chalk.red('Usage: unalias <name>'));
            return;
        }
        
        const name = args[0];
        
        if (this.aliases.delete(name)) {
            console.log(chalk.green(`✅ Alias removed: ${name}`));
        } else {
            console.log(chalk.red(`Alias not found: ${name}`));
        }
    }
    
    async setCommand(args) {
        if (args.length === 0) {
            // List variables
            console.log(chalk.cyan('\n📋 Variables:'));
            console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
            
            if (this.variables.size === 0) {
                console.log('  No variables set');
            } else {
                for (const [key, value] of this.variables) {
                    console.log(`  ${chalk.green(key.padEnd(12))} = ${chalk.yellow(JSON.stringify(value))}`);
                }
            }
            return;
        }
        
        if (args.length < 2) {
            console.log(chalk.red('Usage: set <name> <value>'));
            return;
        }
        
        const name = args[0];
        const value = args.slice(1).join(' ');
        
        this.variables.set(name, value);
        console.log(chalk.green(`✅ Variable set: ${name} = ${value}`));
    }
    
    async unsetCommand(args) {
        if (args.length === 0) {
            console.log(chalk.red('Usage: unset <name>'));
            return;
        }
        
        const name = args[0];
        
        if (this.variables.delete(name)) {
            console.log(chalk.green(`✅ Variable removed: ${name}`));
        } else {
            console.log(chalk.red(`Variable not found: ${name}`));
        }
    }
    
    setVariable(assignment) {
        const parts = assignment.split('=');
        const name = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        
        // Remove quotes if present
        const cleanValue = value.replace(/^["']|["']$/g, '');
        
        this.variables.set(name, cleanValue);
        console.log(chalk.dim(`Variable set: ${name}=${cleanValue}`));
    }
    
    historyCommand() {
        this.history.forEach((cmd, i) => {
            console.log(`${(i + 1).toString().padStart(4)}  ${cmd}`);
        });
    }
    
    /**
     * Handle incoming messages
     */
    handleIncomingMessage(data) {
        // Clear current line
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        
        // Show message
        const prefix = data.username === this.username ? 'You' : data.username;
        console.log(`${chalk.cyan(`[${prefix}]`)} ${data.message}`);
        
        // Redraw prompt
        this.rl.prompt(true);
    }
    
    /**
     * Handle notifications
     */
    handleNotification(data) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        
        let color = chalk.blue;
        switch (data.type) {
            case 'success': color = chalk.green; break;
            case 'warning': color = chalk.yellow; break;
            case 'error': color = chalk.red; break;
            default: color = chalk.blue;
        }
        
        console.log(color(`📢 ${data.title}: ${data.message}`));
        this.rl.prompt(true);
    }
    
    /**
     * Show typing indicator
     */
    showTypingIndicator(username) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(chalk.dim(`👤 ${username} is typing...`));
        this.rl.prompt(true);
    }
    
    /**
     * Hide typing indicator
     */
    hideTypingIndicator(username) {
        // Just redraw prompt
        this.rl.prompt(true);
    }
    
    /**
     * Handle typing detection
     */
    handleTyping() {
        if (!this.isTyping && this.ws.getCurrentRoom()) {
            this.isTyping = true;
            this.ws.sendTyping(true);
        }
        
        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            if (this.isTyping) {
                this.isTyping = false;
                this.ws.sendTyping(false);
            }
        }, 2000);
    }
    
    /**
     * Print message without breaking prompt
     */
    printMessage(message) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(message);
        this.rl.prompt(true);
    }
    
    /**
     * Show welcome message
     */
    showWelcome() {
        const figlet = require('figlet');
        
        console.log(chalk.cyan(figlet.textSync('ThinkNCollab', {
            font: 'Standard',
            horizontalLayout: 'default',
            verticalLayout: 'default'
        })));
        
        console.log(chalk.cyan(`
╔══════════════════════════════════════════════════════╗
║     ThinkNCollab Shell v0.0.01                        ║
║     Type 'help' for commands                          ║
╚══════════════════════════════════════════════════════╝
        `));
    }
    
    /**
     * Command completer
     */
    completer(line) {
        const commands = Array.from(this.commands.keys());
        const aliases = Array.from(this.aliases.keys());
        const all = [...commands, ...aliases];
        
        const hits = all.filter(cmd => cmd.startsWith(line));
        return [hits.length ? hits : all, line];
    }
    
    /**
     * Handle interrupt (Ctrl+C)
     */
    handleInterrupt() {
        if (this.isTyping) {
            this.isTyping = false;
            this.ws.sendTyping(false);
            clearTimeout(this.typingTimeout);
        }
        
        console.log(chalk.yellow('\nUse "exit" to quit, or press Ctrl+C again'));
    }
    
    /**
     * Load command history
     */
    loadHistory() {
        try {
            if (fs.existsSync(this.config.historyFile)) {
                const data = fs.readFileSync(this.config.historyFile, 'utf8');
                this.history = data.split('\n').filter(line => line.trim());
            }
        } catch (error) {
            // Ignore
        }
    }
    
    /**
     * Save command history
     */
    saveHistory() {
        try {
            const toSave = this.history.slice(-this.config.maxHistory);
            fs.writeFileSync(this.config.historyFile, toSave.join('\n'));
        } catch (error) {
            // Ignore
        }
    }
    
    /**
     * Cleanup before exit
     */
    cleanup() {
        if (this.ws) {
            this.ws.disconnect();
        }
        this.saveHistory();
    }
}

module.exports = ThinkNCollabShell;