#!/usr/bin/env node

/**
 * ThinkNCollab Shell - CLI Entry Point
 * 
 * Usage:
 *   thinknsh              - Start interactive shell
 *   thinknsh <command>    - Run single command
 *   thinknsh --help       - Show help
 */

const path = require('path');
const chalk = require('chalk');
const ThinkNCollabShell = require('../src/core/shell');

// Parse arguments
const args = process.argv.slice(2);

// Show help
if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${chalk.cyan('ThinkNCollab Shell - CLI')}

${chalk.yellow('Usage:')}
  thinknsh              Start interactive shell
  thinknsh <command>    Run single command
  thinknsh --help       Show this help
  thinknsh --version    Show version

${chalk.yellow('Examples:')}
  thinknsh
  thinknsh join room-123
  thinknsh status
  thinknsh help

${chalk.dim('For more commands, type "help" in the interactive shell')}
    `);
    process.exit(0);
}

// Show version
if (args.includes('--version') || args.includes('-v')) {
    const pkg = require('../package.json');
    console.log(pkg.version);
    process.exit(0);
}

// Create and start shell
const shell = new ThinkNCollabShell({
    serverUrl: process.env.THINKNCOLLAB_SERVER || 'https://api.thinkncollab.com',
    autoConnect: process.env.THINKNCOLLAB_AUTO_CONNECT === 'true'
});

// If arguments provided, execute command and exit
if (args.length > 0) {
    shell.execute(args.join(' ')).then(() => {
        process.exit(0);
    }).catch((error) => {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
    });
} else {
    // Start interactive shell
    shell.start().catch((error) => {
        console.error(chalk.red(`Fatal error: ${error.message}`));
        process.exit(1);
    });
}