/**
 * Command Registry - Loads and manages all commands
 */

const fs = require('fs-extra');
const path = require('path');
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
    console.log(chalk.cyan('📚 Loading commands...'));
    
    try {
        // Authentication Commands
        this.register(require('./auth/login'), 'auth');
        console.log('  ✅ Loaded login');
        
        this.register(require('./auth/logout'), 'auth');
        console.log('  ✅ Loaded logout');
        
        this.register(require('./auth/whoami'), 'auth');
        console.log('  ✅ Loaded whoami');
        
        // Team Commands
        this.register(require('./team/myteam'), 'team');
        console.log('  ✅ Loaded myteam');
        
        this.register(require('./team/teammates'), 'team');
        console.log('  ✅ Loaded teammates');
        
        this.register(require('./team/invite'), 'team');
        console.log('  ✅ Loaded invite');
        
        // Room Commands
        this.register(require('./room/join'), 'room');
        console.log('  ✅ Loaded join');
        
        this.register(require('./room/leave'), 'room');
        console.log('  ✅ Loaded leave');
        
        this.register(require('./room/rooms'), 'room');
        console.log('  ✅ Loaded rooms');
        
        // Message Commands
        this.register(require('./message/say'), 'message');
        console.log('  ✅ Loaded say');
        
        // Shell Commands
        this.register(require('./shell/status'), 'shell');
        console.log('  ✅ Loaded status');
        
    } catch (error) {
        console.error(chalk.red(`❌ Failed to load command: ${error.message}`));
        console.error(error.stack);
    }
    
    console.log(chalk.green(`✅ Loaded ${this.commands.size} commands`));
}
    
    register(command, category) {
        this.commands.set(command.name, command);
        
        if (!this.categories.has(category)) {
            this.categories.set(category, []);
        }
        this.categories.get(category).push(command.name);
        
        // Register aliases
        if (command.aliases) {
            command.aliases.forEach(alias => {
                this.aliases.set(alias, command.name);
            });
        }
    }
    
    addAlias(alias, command) {
        this.aliases.set(alias, command);
    }
    
    getCommand(name) {
        // Check alias first
        if (this.aliases.has(name)) {
            name = this.aliases.get(name);
        }
        return this.commands.get(name);
    }
    
async execute(input, shell) {
    const args = shell.parseCommand(input);
    const cmdName = args[0].toLowerCase();
    const cmdArgs = args.slice(1);
    
    console.log(chalk.yellow(`[Registry] Looking for: "${cmdName}"`));
    console.log(chalk.yellow(`[Registry] Available:`, Array.from(this.commands.keys())));
    
    const command = this.getCommand(cmdName);
    
    if (!command) {
        console.log(chalk.red(`[Registry] NOT FOUND: ${cmdName}`));
        return false;
    }
    
    console.log(chalk.green(`[Registry] FOUND: ${command.name}`));
    
    try {
        // Check authentication requirement
        if (command.requiresAuth && !shell.api?.isAuthenticated()) {
            console.log(chalk.red('❌ Please login first: login <email> <password>'));
            return true;
        }
        
        // Check room requirement
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
                const cmd = this.commands.get(cmdName);
                const aliases = cmd.aliases ? chalk.dim(` (${cmd.aliases.join(', ')})`) : '';
                help += `  ${chalk.green(cmdName.padEnd(12))}${aliases} - ${cmd.description}\n`;
            });
            
            help += '\n';
        }
        
        return help;
    }
}

module.exports = CommandRegistry;