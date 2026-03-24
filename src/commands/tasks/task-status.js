// src/commands/tasks/task-status.js
const chalk = require('chalk');

const STATUS_MAP = {
    accept:   'accepted',
    start:    'inprogress',
    complete: 'completed',
    reject:   'rejected',
    done:     'completed',
};

module.exports = {
    name:         'task-status',
    description:  'Update your task status',
    aliases:      ['accept', 'start', 'complete', 'reject', 'done'],
    requiresAuth: true,
    requiresRoom: true,

    async execute(args, shell) {
        const roomId  = shell.ws.getCurrentRoom();
        const taskId  = args[0];
        // invoked as 'accept <id>', 'start <id>', etc.
        const verb    = shell._lastCommand || 'task-status';
        const status  = STATUS_MAP[verb] || args[1];

        if (!taskId) {
            console.log(chalk.yellow('  Usage: accept <taskId> | start <taskId> | complete <taskId>'));
            return;
        }
        if (!status) {
            console.log(chalk.yellow('  Usage: task-status <taskId> <accepted|inprogress|completed|rejected>'));
            return;
        }

        const statusColors = {
            accepted:   chalk.green,
            inprogress: chalk.blue,
            completed:  chalk.green,
            rejected:   chalk.red,
        };
        const col = statusColors[status] || chalk.white;

        try {
            const result = await shell.api._request(
                'POST',
                `/thinknsh/${roomId}/tasks/${taskId}/status`,
                { status }
            );

            console.log(col(`\n  ✓ Task "${result.taskTitle}" → ${status}`));
            if (result.allCompleted) {
                console.log(chalk.green('  🎉 All assignees done — task fully completed!\n'));
            } else {
                console.log('');
            }

        } catch (err) {
            console.log(chalk.red(`\n  ❌ ${err.message}\n`));
        }
    }
};