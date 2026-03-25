const chalk = require('chalk');

module.exports = {
    name: 'whoami',
    description: 'Show current user information',
    aliases: ['user', 'me'],
    requiresAuth: false,

async execute(args, shell) {
    const user    = shell.api.getUser();
    const room    = shell.ws.getCurrentRoom?.();
    const session = shell.api.session;

    // ✅ Server se last session history fetch karo
    let lastSession = null;
    try {
        const history = await shell.api._request('GET', '/thinknsh/session/history');
        // Current session chhod ke last wali lo
        const prev = history.find(s => s._id !== session?.shellSessionId);
        if (prev) lastSession = prev;
    } catch {}

    console.log(chalk.cyan('\n👤 User Information:'));
    console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(`  ${chalk.yellow('Name:')}         ${user.name || 'Not set'}`);
    console.log(`  ${chalk.yellow('Email:')}        ${user.email}`);
    console.log(`  ${chalk.yellow('User ID:')}      ${user._id || 'N/A'}`);
    console.log(`  ${chalk.yellow('Type:')}         ${user.userType || 'User'}`);
    console.log(`  ${chalk.yellow('Status:')}       ${shell.ws.isConnected?.() ? chalk.green('● Online') : chalk.gray('○ Offline')}`);

    if (room) {
        console.log(`  ${chalk.yellow('Room:')}         ${chalk.cyan(room)}`);
    }

    if (session?.timestamp) {
        console.log(`  ${chalk.yellow('Login At:')}     ${chalk.dim(new Date(session.timestamp).toLocaleString())}`);
    }

    // ✅ Server se actual logout time
    if (lastSession?.logoutAt) {
        console.log(`  ${chalk.yellow('Last Logout:')}  ${chalk.dim(new Date(lastSession.logoutAt).toLocaleString())}`);
    } else if (lastSession?.lastSeenAt) {
        console.log(`  ${chalk.yellow('Last Seen:')}    ${chalk.dim(new Date(lastSession.lastSeenAt).toLocaleString())} ${chalk.red('(crash?)')}`);
    }

    if (lastSession?.machineId) {
        console.log(`  ${chalk.yellow('Last Machine:')} ${chalk.dim(lastSession.machineId)}`);
    }

    console.log();
}
};