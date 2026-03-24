/**
 * src/commands/tasks/complete.js — Mark your task assignment as completed
 */
const chalk = require('chalk');

module.exports = {
    name:         'complete',
    description:  'Mark a task as completed',
    aliases:      ['done', 'finish', 'complete'],
    requiresAuth: true,

    async execute(args, shell) {
        if (!args[0]) {
            console.log(chalk.red('Usage: complete <task-id>'));
            return;
        }

        const taskId = args[0];

        try {
            const result = await shell.api._request('POST', `/thinknsh/${taskId}/cli/complete`);

            console.log(chalk.green(`✅ Task completed: "${result.task?.title || taskId}"`));

            if (result.allCompleted)
                console.log(chalk.green('  🎉 All assignees have completed this task!'));

            // Push to notification window
            shell.pushNotification({
                type:    'notification',
                level:   'success',
                title:   'Task Completed',
                message: result.task?.title || taskId,
            });

        } catch (err) {
            if (err.message?.includes('403'))
                console.log(chalk.red('❌ You are not assigned to this task'));
            else if (err.message?.includes('404'))
                console.log(chalk.red('❌ Task not found'));
            else if (err.message?.includes('already'))
                console.log(chalk.yellow('⚠️  Task already completed'));
            else
                console.log(chalk.red(`❌ ${err.message}`));
        }
    }
};