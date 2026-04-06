/*
  src/commands/auth/register.js
  Register new account — opens browser with pre-auth session
 */

const chalk = require('chalk');
const { exec } = require('child_process');

module.exports = {
    name: 'register',
    description: 'Create a new ThinkNCollab account',
    aliases: ['signup', 'reg'],
    requiresAuth: false,

    async execute(args, shell) {
        try {
            console.log(chalk.cyan('🌐 Opening registration in browser...'));

            const baseUrl = shell.api.apiUrl || 'http://localhost:3001';

            // Generate a CLI source token so backend knows it came from terminal
            const crypto  = require('crypto');
            const cliRef  = crypto.randomBytes(8).toString('hex');

            const url = `${baseUrl}/register?ref=cli&cliRef=${cliRef}`;

            // Open browser cross-platform
            const openCmd = process.platform === 'win32'
                ? `start "" "${url}"`
                : process.platform === 'darwin'
                    ? `open "${url}"`
                    : `xdg-open "${url}"`;

            exec(openCmd, (err) => {
                if (err) {
                    console.log(chalk.yellow('⚠️  Could not open browser automatically.'));
                    console.log(chalk.dim('   Open this URL manually:'));
                    console.log(chalk.cyan(`   ${url}`));
                }
            });

            console.log(chalk.green(`✅ Registration page opened!`));
            console.log(chalk.dim(`   URL: ${url}`));
            console.log('');
            console.log(chalk.dim('   After registering, come back and run:'));
            console.log(chalk.cyan('   login'));

        } catch (err) {
            console.log(chalk.red(`❌ Error: ${err.message}`));
        }
    }
};