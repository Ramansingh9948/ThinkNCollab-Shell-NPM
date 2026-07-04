/*
  Version Command

  Usage: version
 */
const chalk = require('chalk');

module.exports = {
    name: 'version',
    description: 'Show shell CLI version',
    aliases: ['v', '-v', '--version'],
    requiresAuth: false,

    async execute(args, shell) {
        const pkg = require('../../../package.json');
        console.log(`\n  ${chalk.yellow('ThinkNCollab CLI Version:')}  ${chalk.green(pkg.version)}\n`);
    }
};
