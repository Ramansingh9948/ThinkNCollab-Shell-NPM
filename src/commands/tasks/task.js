/**
 * src/commands/tasks/task.js — View single task detail
 */
const chalk = require('chalk');

module.exports = {
    name:         'task',
    description:  'View task details by ID',
    aliases:      ['t'],
    requiresAuth: true,

    async execute(args, shell) {
        if (!args[0]) {
            console.log(chalk.red('Usage: task <task-id>'));
            return;
        }

        const taskId = args[0];

        try {
            const task = await shell.api._request('GET', `/thinknsh/${taskId}/cli`);

            const stColors = {
                pending:   chalk.yellow,
                inprogress: chalk.blue,
                review:    chalk.magenta,
                completed: chalk.green,
                reopened:  chalk.cyan,
            };
            const prColors = { high: chalk.red, medium: chalk.yellow, low: chalk.green };
            const stColor  = stColors[task.status]  || chalk.white;
            const prColor  = prColors[task.priority] || chalk.white;

            console.log(chalk.cyan('\n  ─── Task ────────────────────────────────────────'));
            console.log(`  ${chalk.dim('id')}       ${chalk.dim(task._id)}`);
            console.log(`  ${chalk.dim('title')}    ${chalk.bold(task.title)}`);
            console.log(`  ${chalk.dim('status')}   ${stColor(task.status)}`);
            console.log(`  ${chalk.dim('priority')} ${prColor(task.priority)}`);
            if (task.category)
                console.log(`  ${chalk.dim('category')} ${chalk.dim(task.category)}`);
            if (task.dueDate)
                console.log(`  ${chalk.dim('due')}      ${chalk.yellow(new Date(task.dueDate).toLocaleDateString())}`);
            if (task.description) {
                console.log(chalk.dim('\n  description:'));
                task.description.split('\n').forEach(l => console.log(`    ${chalk.white(l)}`));
            }

            if (task.assignedTo?.length) {
                console.log(chalk.dim('\n  assignees:'));
                task.assignedTo.forEach(a => {
                    const name   = a.userId?.name || 'Unknown';
                    const stBadge = a.status === 'completed' ? chalk.green('✓') :
                                    a.status === 'accepted'  ? chalk.blue('●') :
                                    a.status === 'rejected'  ? chalk.red('✗') : chalk.dim('○');
                    console.log(`    ${stBadge} ${name} ${chalk.dim(`[${a.status}]`)}`);
                });
            }

            if (task.columnId?.name || task.columnName)
                console.log(`\n  ${chalk.dim('column')}   ${task.columnId?.name || task.columnName}`);
            if (task.boardName)
                console.log(`  ${chalk.dim('board')}    ${task.boardName}`);

            console.log(chalk.cyan('  ─────────────────────────────────────────────────\n'));

        } catch (err) {
            if (err.message?.includes('403'))
                console.log(chalk.red('❌ Access denied — you are not a member of this room'));
            else if (err.message?.includes('404'))
                console.log(chalk.red('❌ Task not found'));
            else
                console.log(chalk.red(`❌ ${err.message}`));
        }
    }
};