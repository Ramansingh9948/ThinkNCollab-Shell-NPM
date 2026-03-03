/**
 * Rooms Command
 * 
 * Usage: rooms
 *        rooms --all
 */

const chalk = require('chalk');

module.exports = {
    name: 'rooms',
    description: 'List available rooms',
    aliases: ['channels', 'ls'],
    requiresAuth: true,
    
    async execute(args, shell) {
        const showAll = args.includes('--all') || args.includes('-a');
        
        console.log(chalk.cyan('\n📋 Available Rooms:'));
        console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        
        try {
            const rooms = await shell.api.getRooms();
            const currentRoom = shell.api.getCurrentRoom();
            
            if (rooms.length === 0) {
                console.log(chalk.yellow('  No rooms available'));
                console.log(chalk.dim('💡 Create a room with: join <new-room-name>'));
                return;
            }
            
            // Separate my rooms and other rooms
            const myRooms = rooms.filter(r => r.isMember);
            const otherRooms = rooms.filter(r => !r.isMember);
            
            if (myRooms.length > 0) {
                console.log(chalk.yellow('\n  YOUR ROOMS:'));
                myRooms.forEach(room => {
                    const current = currentRoom && currentRoom.id === room.id ? chalk.green(' (current)') : '';
                    const active = room.active ? chalk.green('●') : chalk.gray('○');
                    console.log(`  ${active} ${chalk.white(room.name)}${current}`);
                    console.log(chalk.dim(`     ${room.participants} online · ${room.description || ''}`));
                });
            }
            
            if (otherRooms.length > 0 && showAll) {
                console.log(chalk.yellow('\n  PUBLIC ROOMS:'));
                otherRooms.slice(0, 10).forEach(room => {
                    console.log(`  ○ ${chalk.white(room.name)}`);
                    console.log(chalk.dim(`     ${room.participants} online · ${room.description || ''}`));
                });
                
                if (otherRooms.length > 10) {
                    console.log(chalk.dim(`  ... and ${otherRooms.length - 10} more (use --all to see all)`));
                }
            } else if (otherRooms.length > 0) {
                console.log(chalk.dim(`\n  📌 ${otherRooms.length} other rooms available (use --all to see)`));
            }
            
            console.log(chalk.dim('\n💡 Type "join <room-name>" to join a room'));
            
        } catch (error) {
            console.log(chalk.red(`❌ Failed to fetch rooms: ${error.message}`));
        }
    }
};