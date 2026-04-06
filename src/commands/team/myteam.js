/*
  MyTeam Command
  
  Usage: myteam
         myteam [team-id]
 */

const chalk = require('chalk');
const Table = require('cli-table3');

module.exports = {
    name: 'myteam',
    description: 'Show team information and members',
    aliases: ['team', 'org'],
    requiresAuth: true,
    
    async execute(args, shell) {
        const teamId = args[0] || shell.api.getUser()?.team;
        
        if (!teamId) {
            console.log(chalk.yellow('⚠️  You are not part of any team'));
            console.log(chalk.dim('💡 Ask your team admin for an invite'));
            return;
        }
        
        console.log(chalk.cyan(`\n👥 Team Information: ${teamId}`));
        console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        
        try {
            const teamInfo = await shell.api.getTeamInfo(teamId);
            
            // Team details
            console.log(`  ${chalk.yellow('Name:')}        ${teamInfo.name}`);
            console.log(`  ${chalk.yellow('Members:')}     ${teamInfo.memberCount}`);
            console.log(`  ${chalk.yellow('Rooms:')}       ${teamInfo.roomCount}`);
            console.log(`  ${chalk.yellow('Created:')}     ${new Date(teamInfo.createdAt).toLocaleDateString()}`);
            
            if (teamInfo.description) {
                console.log(`  ${chalk.yellow('Description:')} ${teamInfo.description}`);
            }
            
            console.log();
            
            // Team members table
            const table = new Table({
                head: ['Status', 'Name', 'Email', 'Role', 'Current Room'],
                colWidths: [8, 20, 25, 12, 20]
            });
            
            teamInfo.members.forEach(member => {
                const status = member.online ? chalk.green('●') : chalk.gray('○');
                const room = member.currentRoom || '-';
                table.push([
                    status,
                    member.name || member.email.split('@')[0],
                    member.email,
                    member.role || 'member',
                    room
                ]);
            });
            
            console.log(table.toString());
            console.log();
            
            // Team activity
            if (teamInfo.recentActivity && teamInfo.recentActivity.length > 0) {
                console.log(chalk.cyan('📊 Recent Activity:'));
                teamInfo.recentActivity.slice(0, 5).forEach(activity => {
                    const time = new Date(activity.timestamp).toLocaleTimeString();
                    console.log(chalk.dim(`  [${time}] ${activity.user}: ${activity.action}`));
                });
            }
            
        } catch (error) {
            console.log(chalk.red(`❌ Failed to fetch team info: ${error.message}`));
        }
    }
};