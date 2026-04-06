/*
  Invite Command
  
  Usage: invite <email>
         invite <email> --role <role>
 */

const chalk = require('chalk');

module.exports = {
    name: 'invite',
    description: 'Invite someone to your team',
    aliases: ['inv'],
    requiresAuth: true,
    
    async execute(args, shell) {
        if (args.length === 0) {
            console.log(chalk.red('❌ Usage: invite <email> [--role <role>]'));
            console.log(chalk.dim('  Roles: admin, member, viewer'));
            return;
        }
        
        const email = args[0];
        const roleIndex = args.indexOf('--role');
        const role = roleIndex !== -1 && args[roleIndex + 1] ? args[roleIndex + 1] : 'member';
        
        console.log(chalk.cyan(`📧 Inviting ${email} as ${role}...`));
        
        try {
            const result = await shell.api.inviteTeammate(email, role);
            
            console.log(chalk.green(`✅ Invitation sent to ${email}`));
            
            if (result.inviteLink) {
                console.log(chalk.dim(`📎 Invite link: ${result.inviteLink}`));
            }
            
        } catch (error) {
            if (error.message.includes('already')) {
                console.log(chalk.yellow(`⚠️  ${email} is already a team member`));
            } else {
                console.log(chalk.red(`❌ Invitation failed: ${error.message}`));
            }
        }
    }
};