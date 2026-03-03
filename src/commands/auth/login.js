// commands/auth/login.js
const chalk = require('chalk');
const inquirer = require('inquirer');
const fs = require('fs-extra');
const path = require('path');

module.exports = {
    name: 'login',
    description: 'Login to ThinkNCollab',
    aliases: ['signin'],
    requiresAuth: false,
    
    async execute(args, shell) {
        let email, password;
        
        // SHELL KO ROKO - taaki woh input na chura le!
        if (shell.rl) {
            shell.rl.pause();  // ⛔ Shell ko chup karo
        }
        
        try {
            if (args.length === 0) {
                // SIRF EK BAAR PROMPT - DOBAARA NAHI!
                const answers = await inquirer.prompt([
                    { 
                        type: 'input', 
                        name: 'email', 
                        message: 'Email:',
                        validate: (input) => input.includes('@') ? true : 'Email sahi daal be!'
                    },
                    { 
                        type: 'password', 
                        name: 'password', 
                        message: 'Password:',
                        mask: '*'
                    }
                ]);
                email = answers.email;
                password = answers.password;
            } else if (args.length >= 2) {
                email = args[0];
                password = args[1];
            } else {
                console.log(chalk.red('❌ Sahi se likh: login <email> <password>'));
                return;
            }
            
            console.log(chalk.cyan('🔐 Login ho raha hai...'));
            
            if (!shell.api) {
                console.log(chalk.red('❌ API band hai'));
                return;
            }
            
            // API call
            const result = await shell.api.login(email, password);
            
            // Session save
            const sessionPath = path.join(shell.config.configDir, 'session.json');
            await fs.writeJson(sessionPath, {
                user: result.user,
                token: result.token,
                timestamp: new Date().toISOString()
            });
            
            console.log(chalk.green(`✅ Swagat hai, ${result.user.name || result.user.email}!`));
            
        } catch (error) {
            console.log(chalk.red(`❌ Login fail: ${error.message}`));
        } finally {
            // SHELL KO WAPAS JAGA DO
            if (shell.rl) {
                // IMPORTANT: Input buffer saaf karo
                shell.rl.removeAllListeners('line');  // Purane listeners hatao
                shell.rl.resume();  // ✅ Shell wapas chalao
                
                // Naya listener lagao
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
                
                shell.rl.prompt();
            }
        }
    }
};