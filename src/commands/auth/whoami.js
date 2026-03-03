/**
 * Whoami Command
 * 
 * Usage: whoami
 */

const chalk = require('chalk');

module.exports = {
    name: 'whoami',
    description: 'Show current user information',
    aliases: ['user', 'me'],
    requiresAuth: true,
    
    async execute(args, shell) {
        const user = shell.api.getUser();
        const room = shell.api.getCurrentRoom();
        
        console.log(chalk.cyan('\n👤 User Information:'));
        console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        console.log(`  ${chalk.yellow('Email:')}     ${user.email}`);
        console.log(`  ${chalk.yellow('Name:')}      ${user.name || 'Not set'}`);
        console.log(`  ${chalk.yellow('User ID:')}   ${user.id || 'N/A'}`);
        
        if (user.team) {
            console.log(`  ${chalk.yellow('Team:')}      ${user.team}`);
        }
        
        if (user.role) {
            console.log(`  ${chalk.yellow('Role:')}      ${user.role}`);
        }
        
        console.log(`  ${chalk.yellow('Status:')}    ${shell.api.isConnected() ? chalk.green('Online') : chalk.gray('Offline')}`);
        
        if (room) {
            console.log(`  ${chalk.yellow('Room:')}      ${chalk.cyan(room.name)} (${room.id})`);
        }
        
        // Show last login if available
        if (user.lastLogin) {
            const lastLogin = new Date(user.lastLogin).toLocaleString();
            console.log(`  ${chalk.yellow('Last Login:')} ${lastLogin}`);
        }
        
        console.log();
    }
};