const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');

module.exports = {
    name: 'login',
    description: 'Login to ThinkNCollab',
    aliases: ['signin'],
    requiresAuth: false,

    async execute(args, shell) {
        let email, password;

        try {
            if (args.length === 0) {
                const { input, password: pwdFn } = require('@inquirer/prompts');
                email    = await input({ message: 'Email:' });
                password = await pwdFn({ message: 'Password:', mask: '*' });

            } else if (args.length >= 2) {
                email    = args[0];
                password = args[1];
            } else {
                console.log(chalk.red('❌ Usage: login <email> <password>'));
                console.log(chalk.dim('   or:  login (interactive)'));
                return;
            }

            if (!email || !password) {
                console.log(chalk.red('❌ Email and password required'));
                return;
            }

            console.log(chalk.cyan('🔐 Logging in...'));

            if (!shell.api) { console.log(chalk.red('❌ API not initialized')); return; }

            const result = await shell.api.login(email, password);

            await fs.writeJson(path.join(shell.config.configDir, 'session.json'), {
                user:      result.user,
                token:     result.token,
                timestamp: new Date().toISOString()
            });

            console.log(chalk.green(`✅ Welcome, ${result.user.name || result.user.email}!`));

            // Auto-connect to WebSocket + join personal notification room
            try {
                const token  = result.token;
                const userId = result.user._id ;
                const name   = result.user.name || result.user.email;

                // Set user in websocket manager
                shell.ws._token = token;
                shell.ws.setUser({ userId, name, userType: 'User' }, token);

                // Connect to backend
                await shell.ws.connect(token);

                // Join personal notification room (for task assignments etc.)
                shell.ws.joinUserRoom(userId);

                console.log(chalk.green('🔌 Connected to ThinkNCollab server'));
            } catch (wsErr) {
                console.log(chalk.yellow(`⚠️  Could not connect to server: ${wsErr.message}`));
            }

        } catch (err) {
            if (err.name === 'ExitPromptError' || err.message?.includes('force closed')) {
                console.log(chalk.yellow('⚠️  Cancelled'));
            } else {
                console.log(chalk.red(`❌ Login failed: ${err.message}`));
            }
        }
    }
};