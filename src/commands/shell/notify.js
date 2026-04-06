/*
  src/commands/shell/notify.js — Send notifications to room
 */
const chalk = require('chalk');

module.exports = {
    name:        'notify',
    description: 'Send a notification to the current room',
    aliases:     ['notif'],
    requiresAuth: true,
    requiresRoom: true,

    // Usage:
    //   notify info  <message>
    //   notify warn  <message>
    //   notify error <message>
    //   notify success <message>
    //   notify <message>          ← defaults to 'info'

    async execute(args, shell) {
        if (!args.length) {
            console.log(chalk.yellow('Usage: notify <level> <message>'));
            console.log(chalk.dim('  Levels: info | warn | error | success'));
            console.log(chalk.dim('  Example: notify info deployment done'));
            return;
        }

        const levels = ['info', 'warn', 'warning', 'error', 'success'];
        let level, message;

        if (levels.includes(args[0].toLowerCase())) {
            level   = args[0].toLowerCase() === 'warning' ? 'warn' : args[0].toLowerCase();
            message = args.slice(1).join(' ');
        } else {
            level   = 'info';
            message = args.join(' ');
        }

        if (!message.trim()) {
            console.log(chalk.red('❌ Message cannot be empty'));
            return;
        }

        const levelColors = {
            info:    chalk.blue,
            warn:    chalk.yellow,
            error:   chalk.red,
            success: chalk.green,
        };
        const levelIcons = {
            info:    'ℹ️ ',
            warn:    '⚠️ ',
            error:   '❌',
            success: '✅',
        };

        const color = levelColors[level] || chalk.blue;
        const icon  = levelIcons[level]  || 'ℹ️ ';

        try {
            await shell.ws.sendNotification(
                {
                    type:    level,
                    title:   `${level.charAt(0).toUpperCase() + level.slice(1)} from terminal`,
                    message: message,
                    data:    {
                        sentBy: shell.api.getUser()?.name || 'unknown',
                        via:    'thinknsh',
                    },
                },
                'room'
            );

            // Also push to local notification window
            shell.pushNotification({
                type:    'notification',
                level:   level,
                title:   `Notify — ${level}`,
                message: message,
            });

            console.log(color(`${icon}  Notification sent → [${level}] ${message}`));

        } catch (err) {
            console.log(chalk.red(`❌ Failed to send notification: ${err.message}`));
        }
    }
};