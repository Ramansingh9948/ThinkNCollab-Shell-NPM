/**
 * Command Registry - Loads and manages all commands
 */

const chalk = require('chalk');

class CommandRegistry {
    constructor(shell) {
        this.shell = shell;
        this.commands = new Map();
        this.aliases = new Map();
        this.categories = new Map();

        this.loadCommands();
    }

    loadCommands() {
        try {
            this.register(require('./auth/login'),        'auth');
            this.register(require('./auth/logout'),       'auth');
            this.register(require('./auth/whoami'),       'auth');
            this.register(require('./team/myteam'),       'team');
            this.register(require('./team/teammates'),    'team');
            this.register(require('./team/invite'),       'team');
            this.register(require('./room/join'),         'room');
            this.register(require('./room/leave'),        'room');
            this.register(require('./room/rooms'),        'room');
            this.register(require('./message/say'),       'message');
            this.register(require('./shell/status'),      'shell');
        } catch (error) {
            console.error(chalk.red(`❌ Failed to load command: ${error.message}`));
            console.error(error.stack);
        }
    }

    register(command, category) {
        this.commands.set(command.name, command);

        if (!this.categories.has(category)) {
            this.categories.set(category, []);
        }
        this.categories.get(category).push(command.name);

        if (command.aliases) {
            command.aliases.forEach(alias => this.aliases.set(alias, command.name));
        }
    }

    addAlias(alias, command) {
        this.aliases.set(alias, command);
    }

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
                console.log(chalk.red('❌ Please login first: login <email> <password>'));
                return true;
            }

            if (command.requiresRoom && !shell.api?.getCurrentRoom()) {
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
                const cmd     = this.commands.get(cmdName);
                const aliases = cmd.aliases ? chalk.dim(` (${cmd.aliases.join(', ')})`) : '';
                help += `  ${chalk.green(cmdName.padEnd(12))}${aliases} - ${cmd.description}\n`;
            });
            help += '\n';
        }

        return help;
    }
}

module.exports = CommandRegistry;