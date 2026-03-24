const chalk = require('chalk');

module.exports = {
    name: 'whoami',
    description: 'Show current user information',
    aliases: ['user', 'me'],
    requiresAuth: true,

    async execute(args, shell) {
        const user    = shell.api.getUser();
        const room    = shell.ws.getCurrentRoom?.();
        const session = shell.api.session;  // timestamp yahan hai

        console.log(chalk.cyan('\n👤 User Information:'));
        console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        console.log(`  ${chalk.yellow('Name:')}        ${user.name || 'Not set'}`);
        console.log(`  ${chalk.yellow('Email:')}       ${user.email}`);
        console.log(`  ${chalk.yellow('User ID:')}     ${user._id || 'N/A'}`);
        console.log(`  ${chalk.yellow('Type:')}        ${user.userType || 'User'}`);
        console.log(`  ${chalk.yellow('Status:')}      ${shell.ws.isConnected?.() ? chalk.green('● Online') : chalk.gray('○ Offline')}`);

        if (room) {
            console.log(`  ${chalk.yellow('Room:')}        ${chalk.cyan(room)}`);
        }

        if (session?.timestamp) {
            const loginTime = new Date(session.timestamp).toLocaleString();
            console.log(`  ${chalk.yellow('Session start:')} ${chalk.dim(loginTime)}`);
        }

        console.log();
    }
};