/**
 * Logout Command
 * 
 * Usage: logout
 */

const chalk = require('chalk');
const fs = require('fs-extra');

module.exports = {
    name: 'logout',
    description: 'Logout from ThinkNCollab',
    aliases: ['signout', 'exit'],
    requiresAuth: true,
    
    async execute(args, shell) {
        shell.printMessage(chalk.cyan('👋 Logging out...'));
        
        try {
            await shell.api.logout();
            
            // Remove session file
            const sessionPath = shell.getSessionPath();
            await fs.remove(sessionPath);
            
            shell.printMessage(chalk.green('✅ Logged out successfully'));
            
        } catch (error) {
            shell.printMessage(chalk.red(`❌ Logout failed: ${error.message}`));
        }
    }
};