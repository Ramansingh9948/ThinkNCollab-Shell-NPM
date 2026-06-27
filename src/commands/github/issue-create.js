/*
  GitHub issue-create Command
 */
const chalk = require('chalk');

module.exports = {
    name: 'issue-create',
    description: 'Create a new GitHub issue in the linked repository',
    aliases: ['create-issue', 'gh-issue-create', 'gh-create-issue'],
    requiresAuth: true,
    requiresRoom: true,

    async execute(args, shell) {
        const roomId = shell.ws.getCurrentRoom();
        if (!roomId) {
            console.log(chalk.yellow('⚠️  Please join a room first: join <room-id>'));
            return;
        }

        let title = args[0];
        let body = args.slice(1).join(' ');

        // If title/body not provided via command line, prompt interactively
        if (!title) {
            try {
                const inquirer = require('inquirer');
                const answers = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'title',
                        message: 'Enter issue title:',
                        validate: input => input.trim() ? true : 'Title is required'
                    },
                    {
                        type: 'input',
                        name: 'body',
                        message: 'Enter issue description (body) (optional):'
                    }
                ]);
                title = answers.title;
                body = answers.body;
            } catch (err) {
                console.log(chalk.red('❌ Missing arguments. Usage: issue-create <title> <body>'));
                return;
            }
        }

        console.log(chalk.dim('\n  Creating GitHub issue...\r'));
        try {
            const result = await shell.api._request('POST', `/thinknsh/${roomId}/github/issues`, {
                title,
                body
            });
            console.log(' '.repeat(30) + '\r'); // clear line

            console.log(chalk.green(`\n✅ GitHub issue created successfully!`));
            console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
            console.log(`  ${chalk.yellow('Issue Number:')}  #${result.number}`);
            console.log(`  ${chalk.yellow('Title:')}         ${result.title}`);
            console.log(`  ${chalk.yellow('URL:')}           ${chalk.cyan(result.html_url)}`);
            console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
        } catch (error) {
            console.log(' '.repeat(30) + '\r');
            console.log(chalk.red(`❌ Failed to create issue: ${error.message}`));
        }
    }
};
