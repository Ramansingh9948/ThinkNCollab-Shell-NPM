const chalk = require('chalk');

module.exports = {
    name: 'myTask',
    description: 'My Tasks in the Room',
    aliases: ['mytasks'],
    requiresAuth: true,

    async execute(args, shell) {
        const user  = shell.api.getUser();
        const token = shell.api.getToken();

        try {
            if (!user || !token) {
                console.log(chalk.red('❌ Please login first: login'));
                return;
            }

            // FIX: getCurrentRoom() lives on shell.ws, not shell.api
            const roomId = shell.ws.getCurrentRoom();

            if (!roomId) {
                console.log(chalk.yellow('⚠️  Please join a room first: join <room-id>'));
                return;
            }

            if (!shell.api) {
                console.log(chalk.red('❌ API not initialized'));
                return;
            }

            console.log(chalk.dim('  Fetching tasks...'));

            // FIX: pass `roomId` (was passing undefined `roomId` from shell.api.getCurrentRoom())
            const result = await shell.api.mytasks(user, token, roomId);

            if (!result || !result.tasks || result.tasks.length === 0) {
                console.log(chalk.yellow('  No tasks found in this room.'));
                return;
            }

            console.log(chalk.cyan(`\n📋 Your Tasks in room: ${chalk.white(roomId)}\n`));
            console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

            result.tasks.forEach((task, index) => {
                const statusColor = {
                    completed: chalk.green,
                    in_progress: chalk.yellow,
                    pending: chalk.dim,
                }[task.status] || chalk.white;

                const status  = statusColor(`[${task.status || 'pending'}]`);
                const title   = chalk.white(task.title || task.name || 'Untitled');
                const due     = task.dueDate ? chalk.dim(` — due: ${new Date(task.dueDate).toLocaleDateString()}`) : '';

                console.log(`  ${chalk.dim(`${index + 1}.`)} ${status} ${title}${due}`);

                if (task.description) {
                    console.log(`     ${chalk.dim(task.description)}`);
                }
            });

            console.log(chalk.dim('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
            console.log(chalk.green(`  ✅ ${result.tasks.length} task(s) fetched successfully.\n`));

        } catch (err) {
            if (err.name === 'ExitPromptError' || err.message?.includes('force closed')) {
                console.log(chalk.yellow('⚠️  Cancelled'));
            } else {
                console.log(chalk.red(`❌ Fetching tasks failed: ${err.message}`));
            }
        }
    }
};