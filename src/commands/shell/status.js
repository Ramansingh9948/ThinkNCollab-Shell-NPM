/**
 * Status Command
 * 
 * Usage: status
 */

const chalk = require('chalk');
const os = require('os');

module.exports = {
    name: 'status',
    description: 'Show shell and connection status',
    aliases: ['stats', 'info'],
    requiresAuth: false,
    
    async execute(args, shell) {
        const user = shell.api.getUser();
        const room = shell.api.getCurrentRoom();
        const connected = shell.api.isConnected();
        
        console.log(chalk.cyan('\n📊 ThinkNCollab Shell Status'));
        console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        
        // Connection status
        console.log(`  ${chalk.yellow('Connection:')}    ${connected ? chalk.green('● Online') : chalk.red('○ Offline')}`);
        
        if (connected) {
            console.log(`  ${chalk.yellow('Server:')}        ${shell.api.config.wsUrl}`);
            console.log(`  ${chalk.yellow('Socket ID:')}      ${shell.api.getSocketId() || 'N/A'}`);
        }
        
        // Authentication
        console.log(`  ${chalk.yellow('Auth:')}           ${user ? chalk.green(`✓ ${user.email}`) : chalk.red('✗ Not logged in')}`);
        
        if (user) {
            console.log(`  ${chalk.yellow('User:')}           ${user.name || user.email}`);
            if (user.team) {
                console.log(`  ${chalk.yellow('Team:')}           ${user.team}`);
            }
        }
        
        // Room
        if (room) {
            console.log(`  ${chalk.yellow('Current Room:')}    ${chalk.cyan(room.name)} (${room.id})`);
            console.log(`  ${chalk.yellow('Participants:')}     ${room.participants?.length || 0}`);
        } else {
            console.log(`  ${chalk.yellow('Current Room:')}    ${chalk.gray('None')}`);
        }
        
        // Shell info
        console.log(`\n  ${chalk.yellow('Shell Version:')}  ${require('../../../package.json').version}`);
        console.log(`  ${chalk.yellow('Node Version:')}    ${process.version}`);
        console.log(`  ${chalk.yellow('Platform:')}        ${os.platform()} ${os.arch()}`);
        console.log(`  ${chalk.yellow('Uptime:')}          ${Math.floor(process.uptime() / 60)}m`);
        console.log(`  ${chalk.yellow('Memory:')}          ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);
        console.log(`  ${chalk.yellow('History:')}         ${shell.history.length} commands`);
        
        // Suggestions
        console.log(chalk.dim('\n💡 Tips:'));
        if (!user) {
            console.log(chalk.dim('   • Login with: login <email> <password>'));
        } else if (!room) {
            console.log(chalk.dim('   • Join a room with: join <room-id>'));
            console.log(chalk.dim('   • See available rooms: rooms'));
        } else {
            console.log(chalk.dim('   • Send messages with: say <message>'));
            console.log(chalk.dim('   • See teammates: teammates'));
            console.log(chalk.dim('   • Leave room: leave'));
        }
        
        console.log();
    }
};