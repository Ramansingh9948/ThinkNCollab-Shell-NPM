/**
 * Teammates Command
 * 
 * Usage: teammates
 *        teammates [name]
 */

const chalk = require('chalk');

module.exports = {
    name: 'teammates',
    description: 'List online teammates',
    aliases: ['members', 'online'],
    requiresAuth: true,
    
    async execute(args, shell) {
        const filter = args[0] ? args[0].toLowerCase() : null;
        
        console.log(chalk.cyan('\n👥 Online Teammates:'));
        console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        
        try {
            const teammates = await shell.api.getTeammates();
            
            const online = teammates.filter(t => t.online);
            const offline = teammates.filter(t => !t.online);
            
            if (online.length === 0) {
                console.log(chalk.yellow('  No teammates online'));
            } else {
                online
                    .filter(t => !filter || t.name.toLowerCase().includes(filter) || t.email.toLowerCase().includes(filter))
                    .forEach(t => {
                        const typing = t.typing ? chalk.green(' (typing...)') : '';
                        const room = t.currentRoom ? chalk.dim(` in ${t.currentRoom}`) : '';
                        console.log(`  ${chalk.green('●')} ${chalk.white(t.name || t.email)}${typing}${room}`);
                        
                        if (t.status && t.status !== 'online') {
                            console.log(chalk.dim(`    ${t.status}`));
                        }
                    });
            }
            
            if (offline.length > 0 && !filter) {
                console.log(chalk.dim(`\n  ... and ${offline.length} offline`));
            }
            
        } catch (error) {
            console.log(chalk.red(`❌ Failed to fetch teammates: ${error.message}`));
        }
    }
};