/*
  Leave Command
  
  Usage: leave
 */

const chalk = require('chalk');

module.exports = {
    name: 'leave',
    description: 'Leave current room',
    aliases: ['exit-room', 'part'],
    requiresAuth: true,
    requiresRoom: true,
    
    async execute(args, shell) {
        const room = shell.api.getCurrentRoom();
        
        if (!room) {
            console.log(chalk.yellow('⚠️  Not in any room'));
            return;
        }
        
        console.log(chalk.cyan(`👋 Leaving room: ${room.name}...`));
        
        try {
            await shell.api.leaveRoom();
            console.log(chalk.green(`✅ Left room: ${room.name}`));
        } catch (error) {
            console.log(chalk.red(`❌ Failed to leave: ${error.message}`));
        }
    }
};