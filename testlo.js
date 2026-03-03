// test-login.js - Simple test for your login command
const chalk = require('chalk');

// Mock shell object
const mockShell = {
    config: { configDir: './test-config' },
    api: {
        async login(email, password) {
            console.log(chalk.blue(`🔍 API called with: ${email} / ${password}`));
            return {
                user: { name: 'Raman Singh', email },
                token: 'fake-token-123'
            };
        }
    },
    printMessage: (msg) => console.log(msg)
};

// Your login command logic (simplified)
async function testLogin() {
    const readline = require('readline');
    const fs = require('fs-extra');
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    console.log(chalk.cyan('📝 Enter your credentials:'));
    
    // Get email
    const email = await new Promise((resolve) => {
        rl.question(chalk.yellow('Email: '), (answer) => {
            resolve(answer);
        });
    });
    
    // Get password
    const password = await new Promise((resolve) => {
        rl.question(chalk.yellow('Password: '), (answer) => {
            resolve(answer);
        });
    });
    
    rl.close();
    
    console.log(chalk.cyan('🔐 Logging in...'));
    
    try {
        const result = await mockShell.api.login(email, password);
        console.log(chalk.green(`✅ Welcome, ${result.user.name}!`));
    } catch (error) {
        console.log(chalk.red(`❌ Failed: ${error.message}`));
    }
}

// Run it
testLogin();