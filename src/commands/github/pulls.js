/*
  GitHub pulls Command
 */
const chalk = require('chalk');
const Table = require('cli-table3');

module.exports = {
    name: 'pulls',
    description: 'List open GitHub pull requests for the linked repository',
    aliases: ['prs', 'gh-pulls', 'gh-prs'],
    requiresAuth: true,
    requiresRoom: true,

    async execute(args, shell) {
        const roomId = shell.ws.getCurrentRoom();
        if (!roomId) {
            console.log(chalk.yellow('⚠️  Please join a room first: join <room-id>'));
            return;
        }

        console.log(chalk.dim('\n  Fetching open pull requests...\r'));
        try {
            const pulls = await shell.api._request('GET', `/thinknsh/${roomId}/github/pulls`);
            console.log(' '.repeat(30) + '\r'); // clear line

            console.log(chalk.cyan(`\n🐙 Open GitHub Pull Requests:`));
            console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

            if (!pulls || pulls.length === 0) {
                console.log(chalk.dim('  No open pull requests found.'));
                console.log();
                return;
            }

            const table = new Table({
                head: ['#', 'Title', 'Author', 'Status', 'Updated At'],
                colWidths: [8, 45, 15, 10, 15]
            });

            pulls.forEach(pr => {
                const statusStr = pr.draft ? chalk.gray('Draft') : chalk.green('Open');
                table.push([
                    chalk.green(`#${pr.number}`),
                    chalk.white(pr.title.length > 40 ? pr.title.slice(0, 37) + '...' : pr.title),
                    pr.user || '-',
                    statusStr,
                    new Date(pr.updated_at).toLocaleDateString()
                ]);
            });

            console.log(table.toString());
            console.log();
        } catch (error) {
            console.log(' '.repeat(30) + '\r');
            console.log(chalk.red(`❌ Failed to fetch pull requests: ${error.message}`));
        }
    }
};
