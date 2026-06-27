/*
  GitHub commits Command
 */
const chalk = require('chalk');
const Table = require('cli-table3');

module.exports = {
    name: 'commits',
    description: 'List recent GitHub commits for the linked repository',
    aliases: ['gh-commits'],
    requiresAuth: true,
    requiresRoom: true,

    async execute(args, shell) {
        const roomId = shell.ws.getCurrentRoom();
        if (!roomId) {
            console.log(chalk.yellow('⚠️  Please join a room first: join <room-id>'));
            return;
        }

        console.log(chalk.dim('\n  Fetching recent commits...\r'));
        try {
            const commits = await shell.api._request('GET', `/thinknsh/${roomId}/github/commits`);
            console.log(' '.repeat(30) + '\r'); // clear line

            console.log(chalk.cyan(`\n🐙 Recent Commits (Last 15):`));
            console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

            if (!commits || commits.length === 0) {
                console.log(chalk.dim('  No commits found.'));
                console.log();
                return;
            }

            const table = new Table({
                head: ['SHA', 'Message', 'Author', 'Date'],
                colWidths: [10, 45, 18, 15]
            });

            commits.forEach(commit => {
                const shortSha = commit.sha.slice(0, 7);
                const shortMsg = commit.message.split('\n')[0];
                table.push([
                    chalk.yellow(shortSha),
                    chalk.white(shortMsg.length > 40 ? shortMsg.slice(0, 37) + '...' : shortMsg),
                    commit.author || '-',
                    new Date(commit.date).toLocaleDateString()
                ]);
            });

            console.log(table.toString());
            console.log();
        } catch (error) {
            console.log(' '.repeat(30) + '\r');
            console.log(chalk.red(`❌ Failed to fetch commits: ${error.message}`));
        }
    }
};
