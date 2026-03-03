/**
 * Join Command
 * 
 * Usage: join <room-id>
 *        join <room-name>
 */

const chalk = require('chalk');

module.exports = {
    name: 'join',
    description: 'Join a collaboration room',
    aliases: ['enter', 'goto'],
    requiresAuth: true,
    
    async execute(args, shell) {
        if (args.length === 0) {
            console.log(chalk.red('❌ Usage: join <room-id> [password]'));
            return;
        }
        
        const roomId = args[0];
        const password = args[1];
        
        console.log(chalk.cyan(`🔗 Joining room: ${roomId}...`));
        
        try {
            const result = await shell.api.joinRoom(roomId, password);
            
            console.log(chalk.green(`✅ Joined ${result.room.name}`));
            
            // Show room info
            console.log(chalk.dim(`  📝 ${result.room.description || 'No description'}`));
            console.log(chalk.dim(`  👥 ${result.participants.length} participants`));
            
            // Show recent messages
            if (result.recentMessages && result.recentMessages.length > 0) {
                console.log(chalk.cyan('\n📜 Recent messages:'));
                result.recentMessages.slice(-3).forEach(msg => {
                    const time = new Date(msg.timestamp).toLocaleTimeString();
                    console.log(chalk.dim(`  [${time}] ${msg.username}: ${msg.message}`));
                });
            }
            
            // Show participants
            if (result.participants.length > 0) {
                console.log(chalk.cyan('\n👥 In room:'));
                const online = result.participants.filter(p => p.online);
                online.forEach(p => {
                    const you = p.email === shell.api.getUser().email ? chalk.green(' (you)') : '';
                    console.log(`  ${chalk.green('●')} ${p.name || p.email}${you}`);
                });
            }
            
            console.log(chalk.dim('\n💡 Type "say <message>" to chat'));
            
        } catch (error) {
            if (error.message.includes('password')) {
                console.log(chalk.red(`❌ Room requires password: join ${roomId} <password>`));
            } else if (error.message.includes('not found')) {
                console.log(chalk.red(`❌ Room not found: ${roomId}`));
                console.log(chalk.dim('💡 Type "rooms" to see available rooms'));
            } else {
                console.log(chalk.red(`❌ Failed to join: ${error.message}`));
            }
        }
    }
};