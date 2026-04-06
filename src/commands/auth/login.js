/*
  commands/auth/login.js
 */

const chalk    = require('chalk');
const inquirer = require('inquirer');

module.exports = {
    name:         'login',
    description:  'Login to ThinkNCollab',
    aliases:      ['signin'],
    requiresAuth: false,

    async execute(args, shell) {
        // Already logged in?
        if (shell.api.isAuthenticated()) {
            const u = shell.api.getUser();
            console.log(chalk.green(`✅ Already logged in as ${u.name} (${u.email})`));
            console.log(chalk.dim('   Run "logout" first to switch accounts.'));
            return;
        }

        // Collect credentials
        let email    = args[0];
        let password = args[1];

        if (!email || !password) {
            const answers = await inquirer.prompt([
                !email    && { type: 'input',    name: 'email',    message: 'Email:',    validate: v => v.includes('@') || 'Enter a valid email' },
                !password && { type: 'password', name: 'password', message: 'Password:', mask: '*', validate: v => v.length >= 1 || 'Password required' },
            ].filter(Boolean));
            email    = email    || answers.email;
            password = password || answers.password;
        }

        console.log(chalk.blue('🔐 Logging in...'));

        try {
            const result = await shell.api.login(email, password);

            // result.user is already normalised by api-client.getUser()
            // shape: { _id, userId, email, name, userType }
            const user = result.user;

            // ★ Tell the WebSocket manager who the user is + pass the token
            // This must happen BEFORE any join attempt
            shell.ws.setUser(user, result.token);

            // Connect WebSocket if not already connected
            if (!shell.ws.isConnected()) {
                try {
                    await shell.ws.connect(result.token);
                    console.log(chalk.dim('   🔌 Connected to ThinkNCollab server'));
                } catch (wsErr) {
                    // Non-fatal — user can still use REST commands
                    console.log(chalk.yellow(`   ⚠️  WebSocket unavailable: ${wsErr.message}`));
                }
            } else {
                // Already connected — re-announce with new user identity
                shell.ws._announceUser?.();
            }

            console.log(chalk.green(`✅ Welcome, ${user.name}!`));
            console.log(chalk.dim(`   Logged in as ${user.email}`));

        } catch (err) {
            if (err.message.includes('401') || err.message.toLowerCase().includes('invalid') ||
                err.message.toLowerCase().includes('unauthorized')) {
                console.log(chalk.red('❌ Invalid email or password'));
            } else if (err.message.includes('connect') || err.message.includes('ECONNREFUSED')) {
                console.log(chalk.red(`❌ Cannot reach server — is it running?`));
            } else {
                console.log(chalk.red(`❌ Login failed: ${err.message}`));
            }
        }
    }
};