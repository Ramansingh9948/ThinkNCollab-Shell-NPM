/**
 * Say Command
 * 
 * Usage: say <message>
 */

const chalk = require('chalk');

module.exports = {
    name: 'say',
    description: 'Send a message to the current room',
    aliases: ['msg', 'm', 'send'],
    requiresAuth: true,
    requiresRoom: true,
    
    async execute(args, shell) {
        const message = args.join(' ');
        
        if (!message) {
            console.log(chalk.red('❌ Usage: say <message>'));
            return;
        }
        
        try {
            await shell.api.sendMessage(message);
            
            // Clear typing indicator
            if (shell.isTyping) {
                shell.api.sendTyping(false);
                shell.isTyping = false;
                clearTimeout(shell.typingTimeout);
            }
            
            // Echo locally (server will also broadcast)
            const user = shell.api.getUser();
            const time = new Date().toLocaleTimeString();
            console.log(chalk.dim(`[${time}] `) + chalk.green(`You: ${message}`));
            
        } catch (error) {
            console.log(chalk.red(`❌ Failed to send: ${error.message}`));
        }
    }
};