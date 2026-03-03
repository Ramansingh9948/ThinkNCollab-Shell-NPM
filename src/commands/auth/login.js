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
        let usedInteractive = false;

        try {
            if (args.length === 0) {
                usedInteractive = true;
                console.log(chalk.cyan('📝 Enter your credentials:'));

                // Fully shut down shell.rl first
                if (shell.rl) {
                    shell.rl.removeAllListeners();
                    shell.rl.close();
                    shell.rl = null;
                }

                // Use raw mode for BOTH — no readline involved at all
                email = await askRaw('Email: ', false);
                password = await askRaw('Password: ', true);

            } else if (args.length >= 2) {
                email = args[0];
                password = args[1];
            } else {
                console.log(chalk.red('❌ Usage: login <email> <password>'));
                console.log(chalk.dim('   or:  login (for interactive mode)'));
                return;
            }

            if (!email || !password) {
                console.log(chalk.red('❌ Email and password required'));
                return;
            }

            console.log(chalk.cyan('🔐 Logging in...'));

            if (!shell.api) {
                console.log(chalk.red('❌ API not initialized'));
                return;
            }

            const result = await shell.api.login(email, password);

            const sessionPath = path.join(shell.config.configDir, 'session.json');
            await fs.writeJson(sessionPath, {
                user: result.user,
                token: result.token,
                timestamp: new Date().toISOString()
            });

            console.log(chalk.green(`✅ Welcome, ${result.user.name || result.user.email}!`));

        } catch (error) {
            console.log(chalk.red(`❌ Login failed: ${error.message}`));
        } finally {
            if (usedInteractive) {
                restoreShell(shell);
            }
        }
    }
};

// ─── Raw input for both visible and hidden fields ─────────────────────────────

function askRaw(prompt, hidden) {
    return new Promise((resolve, reject) => {
        process.stdout.write(chalk.yellow(prompt));

        const stdin = process.stdin;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');

        let input = '';

        function onData(char) {
            const code = char.charCodeAt(0);

            if (char === '\r' || char === '\n' || code === 4) {
                // Enter pressed
                stdin.removeListener('data', onData);
                stdin.setRawMode(false);
                stdin.pause();
                process.stdout.write('\n');
                resolve(input);

            } else if (code === 3) {
                // Ctrl+C
                stdin.removeListener('data', onData);
                stdin.setRawMode(false);
                process.stdout.write('\n');
                reject(new Error('Cancelled'));

            } else if (code === 127 || code === 8) {
                // Backspace
                if (input.length > 0) {
                    input = input.slice(0, -1);
                    if (!hidden) {
                        process.stdout.write('\b \b');
                    } else {
                        process.stdout.write('\b \b');
                    }
                }

            } else if (code >= 32) {
                // Printable character only
                input += char;
                if (!hidden) {
                    process.stdout.write(char); // Show email chars
                } else {
                    process.stdout.write('*');  // Mask password
                }
            }
            // Ignore all control characters (arrows, function keys, etc.)
        }
stdin.removeAllListeners('data'); 
        stdin.on('data', onData);
    });
}

// ─── Restore shell readline after interactive input ───────────────────────────

function restoreShell(shell) {
    const readline = require('readline');

    if (process.stdin.isTTY && process.stdin.isRaw) {
        process.stdin.setRawMode(false);
    }

    process.stdin.resume();

    shell.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: shell.getPrompt(),
        completer: shell.completer.bind(shell),
    });

    shell.rl.on('line', async (line) => {
        const input = line.trim();
        if (input) {
            shell.history.push(input);
            shell.saveHistory();
            await shell.execute(input);
        }
        shell.rl.setPrompt(shell.getPrompt());
        shell.rl.prompt();
    });

    shell.rl.on('close', () => {
        shell.cleanup();
        process.exit(0);
    });

    shell.rl.prompt();
}