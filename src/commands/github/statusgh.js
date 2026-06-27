/*
  GitHub statusgh Command
 */
const chalk = require('chalk');

module.exports = {
    name: 'statusgh',
    description: 'Show GitHub connection and linked repository status',
    aliases: ['statusgt', 'gh-status'],
    requiresAuth: true,
    requiresRoom: true,

    async execute(args, shell) {
        const roomId = shell.ws.getCurrentRoom();
        if (!roomId) {
            console.log(chalk.yellow('⚠️  Please join a room first: join <room-id>'));
            return;
        }

        console.log(chalk.dim('\n  Fetching GitHub status...\r'));
        try {
            const status = await shell.api._request('GET', `/thinknsh/${roomId}/github/status`);
            console.log(' '.repeat(30) + '\r'); // clear line

            console.log(chalk.cyan(`\n🐙 GitHub Integration Status:`));
            console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

            console.log(`  ${chalk.yellow('GitHub Connection:')}  ${status.connected ? chalk.green('Connected ✓') : chalk.red('Not Connected ✗')}`);
            if (status.githubUsername) {
                console.log(`  ${chalk.yellow('GitHub Username:')}    ${status.githubUsername}`);
            }

            console.log(`  ${chalk.yellow('Repository Linked:')}  ${status.repoLinked ? chalk.green('Linked ✓') : chalk.red('Not Linked ✗')}`);
            if (status.repo) {
                console.log(`  ${chalk.yellow('Repository Name:')}    ${status.repo.fullName || `${status.repo.owner}/${status.repo.name}`}`);
            }

            console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
            if (!status.connected) {
                console.log(chalk.yellow('\n💡 Please connect your GitHub account via the Web Dashboard integration panel.'));
            } else if (!status.repoLinked) {
                console.log(chalk.yellow('\n💡 Please link a GitHub repository to this room on the Web Dashboard repository setting page.'));
            }
            console.log();
        } catch (error) {
            console.log(' '.repeat(30) + '\r');
            console.log(chalk.red(`❌ Failed to fetch GitHub status: ${error.message}`));
        }
    }
};
