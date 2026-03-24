/**
 * src/commands/index.js — Command Registry
 */
const chalk = require('chalk');

class CommandRegistry {
    constructor(shell) {
        this.shell      = shell;
        this.commands   = new Map();
        this.aliases    = new Map();
        this.categories = new Map();
        this.loadCommands();
    }

    loadCommands() {
const load = (path, category) => {
    try {
        const cmd = require(path);
        if (!cmd || !cmd.name) {
            console.error(chalk.red(`❌ BAD COMMAND (no name): ${path}`));
            return;
        }
        this.register(cmd, category);
    }
    catch (e) { console.error(chalk.red(`❌ Failed to load ${path}: ${e.message}`)); }
};

        // Auth
        load('./auth/login',    'auth');
        load('./auth/logout',   'auth');
        load('./auth/whoami',   'auth');
        load('./auth/register', 'auth');

        // Team
        load('./team/myteam',    'team');
        load('./team/teammates', 'team');
        load('./team/invite',    'team');

        // Room
        load('./room/join',   'room');
        load('./room/leave',  'room');
        load('./room/rooms',  'room');

        // Message
        load('./message/say', 'message');

        // Shell
        load('./shell/status', 'shell');
        load('./shell/notify', 'shell');

        // Tasks
        load('./tasks/tasks',       'tasks');
        load('./tasks/task',        'tasks');
        load('./tasks/task-status', 'tasks'); 
        // load('./tasks/start',       'tasks');
        load('./tasks/complete',    'tasks');
        // load('./tasks/comment',     'tasks');
        load('./tasks/create-task', 'tasks');
        

        // Terminal
        load('./terminal/share', 'terminal');





    }

    register(command, category) {
         if (!command || !command.name) {
        console.error(chalk.yellow(`⚠️  Skipping invalid command in category: ${category}`));
        return;
    }
        this.commands.set(command.name, command);
        if (!this.categories.has(category)) this.categories.set(category, []);
        this.categories.get(category).push(command.name);
        if (command.aliases) command.aliases.forEach(a => this.aliases.set(a, command.name));
    }

    addAlias(alias, command) { this.aliases.set(alias, command); }

    getCommand(name) {
        if (this.aliases.has(name)) name = this.aliases.get(name);
        return this.commands.get(name);
    }

    async execute(input, shell) {
        const args    = shell.parseCommand(input);
        const cmdName = args[0].toLowerCase();
        const cmdArgs = args.slice(1);

        const command = this.getCommand(cmdName);
        if (!command) return false;

        try {
            if (command.requiresAuth && !shell.api?.isAuthenticated()) {
                console.log(chalk.red('❌ Please login first: login'));
                return true;
            }
            if (command.requiresRoom && !shell.ws?.getCurrentRoom()) {
                console.log(chalk.red('❌ Please join a room first: join <room-id>'));
                return true;
            }
            await command.execute(cmdArgs, shell);
        } catch (error) {
            console.log(chalk.red(`❌ Command error: ${error.message}`));
        }

        return true;
    }

    getHelpText() {
        let help = chalk.cyan('\n📚 Available Commands:\n');
        help += chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');
        for (const [category, commands] of this.categories) {
            help += chalk.yellow(`${category.toUpperCase()}:\n`);
            commands.forEach(cmdName => {
    const cmd = this.commands.get(cmdName);
    if (!cmd || !cmdName) return;  // ← ye line add karo
    const aliases = cmd.aliases ? chalk.dim(` (${cmd.aliases.join(', ')})`) : '';
    help += `  ${chalk.green(cmdName.padEnd(14))}${aliases} - ${cmd.description || ''}\n`;
});
            help += '\n';
        }
        return help;
    }
}

module.exports = CommandRegistry;