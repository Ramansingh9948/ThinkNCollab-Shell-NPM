/*
  src/commands/tasks/create-task.js — Create a new task interactively
 */
const chalk = require('chalk');

module.exports = {
    name:         'create-task',
    description:  'Create a new task in current room',
    aliases:      ['newtask', 'addtask'],
    requiresAuth: true,
    requiresRoom: true,

    async execute(args, shell) {
        const { input, select, confirm } = require('@inquirer/prompts');
        const roomId = shell.ws.getCurrentRoom();

        try {
            // Fetch columns of current room's board
            const { columns } = await shell.api._request('GET', `/thinknsh/${roomId}/cli/columns`);
            if (!columns?.length) {
                console.log(chalk.red('❌ No columns found in this room\'s board'));
                return;
            }

            console.log(chalk.cyan('\n  // create-task\n'));

            const title = await input({
                message: 'Task title:',
                validate: v => v.trim().length >= 3 || 'Min 3 characters'
            });

            const description = await input({ message: 'Description (optional):' });

            const columnId = await select({
                message: 'Column:',
                choices: columns.map(c => ({ name: c.title, value: c._id }))
            });

            const priority = await select({
                message: 'Priority:',
                choices: [
                    { name: 'low',    value: 'low' },
                    { name: 'medium', value: 'medium' },
                    { name: 'high',   value: 'high' },
                ],
                default: 'medium'
            });

            const categories = [
                'Bugs', 'Feature Requests', 'Improvements / Enhancements',
                'Production Critical Issues', 'Security Issues', 'Performance Issues',
                'UI/UX Issues', 'Testing & QA', 'DevOps & Infrastructure',
                'Refactoring & Code Quality', 'Documentation', 'Other'
            ];
            const category = await select({
                message: 'Category:',
                choices: categories.map(c => ({ name: c, value: c }))
            });

            const dueDateStr = await input({
                message: 'Due date (YYYY-MM-DD, optional):',
                validate: v => {
                    if (!v) return true;
                    return !isNaN(Date.parse(v)) || 'Invalid date format';
                }
            });

            const confirmed = await confirm({ message: 'Create task?', default: true });
            if (!confirmed) { console.log(chalk.dim('  Cancelled.')); return; }

            const payload = {
                title:       title.trim(),
                description: description.trim() || undefined,
                columnId,
                priority,
                category:    category === 'Other' ? undefined : category,
                dueDate:     dueDateStr ? new Date(dueDateStr).toISOString() : undefined,
                source:      'cli',
            };

            const result = await shell.api._request('POST', `/thinknsh/${roomId}/cli/tasks`, payload);

            console.log(chalk.green(`\n✅ Task created: "${result.task.title}"`));
            console.log(chalk.dim(`   ID: ${result.task._id}`));
            console.log(chalk.dim(`   Column: ${result.task.columnId?.title || columnId}\n`));

            shell.pushNotification({
                type:    'notification',
                level:   'success',
                title:   'Task Created',
                message: result.task.title,
            });

        } catch (err) {
            if (err.message?.includes('403'))
                console.log(chalk.red('❌ You are not a member of this room'));
            else
                console.log(chalk.red(`❌ ${err.message}`));
        }
    }
};