/*
  GitHub issues Command
 */
const chalk = require('chalk');
const Table = require('cli-table3');

module.exports = {
    name: 'issues',
    description: 'List open GitHub issues for the linked repository',
    aliases: ['gh-issues'],
    requiresAuth: true,
    requiresRoom: true,

    async execute(args, shell) {
        const roomId = shell.ws.getCurrentRoom();
        if (!roomId) {
            console.log(chalk.yellow('⚠️  Please join a room first: join <room-id>'));
            return;
        }

        console.log(chalk.dim('\n  Fetching open issues...\r'));
        try {
            const issues = await shell.api._request('GET', `/thinknsh/${roomId}/github/issues`);
            console.log(' '.repeat(30) + '\r'); // clear line

            console.log(chalk.cyan(`\n🐙 Open GitHub Issues:`));
            console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

            if (!issues || issues.length === 0) {
                console.log(chalk.dim('  No open issues found in the linked repository.'));
                console.log();
                return;
            }

            const table = new Table({
                head: ['#', 'Title', 'Author', 'Comments', 'Updated At'],
                colWidths: [8, 45, 15, 10, 15]
            });

            issues.forEach(issue => {
                table.push([
                    chalk.green(`#${issue.number}`),
                    chalk.white(issue.title.length > 40 ? issue.title.slice(0, 37) + '...' : issue.title),
                    issue.user || '-',
                    issue.comments,
                    new Date(issue.updated_at).toLocaleDateString()
                ]);
            });

            console.log(table.toString());
            console.log();
        } catch (error) {
            console.log(' '.repeat(30) + '\r');
            console.log(chalk.red(`❌ Failed to fetch issues: ${error.message}`));
        }
    }
};
