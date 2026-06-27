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
       const room = shell.ws.getCurrentRoom();
if (!room) { console.log(chalk.yellow('⚠️  Not in any room')); return; }
console.log(chalk.cyan(`👋 Leaving room...`));
await shell.ws.leaveRoom();
console.log(chalk.green(`✅ Left room`));
       
    }
};