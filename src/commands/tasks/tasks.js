/*
  src/commands/tasks/tasks.js — List my tasks + suggestions in current room
 */
const chalk = require('chalk');

module.exports = {
    name:         'tasks',
    description:  'List your tasks + suggested tasks in the current room',
    aliases:      ['mytasks', 'my-tasks'],
    requiresAuth: true,
    requiresRoom: true,

    async execute(args, shell) {
        const user   = shell.api.getUser();
        const roomId = shell.ws.getCurrentRoom();

        if (!user)   { console.log(chalk.red('❌ Please login first')); return; }
        if (!roomId) { console.log(chalk.yellow('⚠️  Join a room first: join <room-id>')); return; }

        // ── Flags ────────────────────────────────────────────────────────────
        const showAll       = args.includes('--all')   || args.includes('-a');
        const noSuggestions = args.includes('--no-suggest') || args.includes('-ns');
        const filterStatus  = args.find(a => ['pending','inprogress','review','completed','reopened'].includes(a));
        const topN          = args.find(a => /^\d+$/.test(a)) || 5;

        // ── Color maps ───────────────────────────────────────────────────────
        const stColors = {
            pending:    chalk.yellow,
            inprogress: chalk.blue,
            review:     chalk.magenta,
            completed:  chalk.green,
            reopened:   chalk.cyan,
        };
        const prColors = {
            critical: chalk.red,
            high:     chalk.hex('#FF6B35'),
            medium:   chalk.yellow,
            low:      chalk.green,
        };
        const scoreColor = s => s >= 80 ? chalk.red(s) : s >= 60 ? chalk.yellow(s) : chalk.green(s);
        const plColor    = pl => ({
            CRITICAL: chalk.red,
            HIGH:     chalk.hex('#FF6B35'),
            MEDIUM:   chalk.yellow,
            LOW:      chalk.green,
            'VERY LOW': chalk.dim,
        }[pl] || chalk.white);

        // ── Helpers ──────────────────────────────────────────────────────────
        const fmtDue = dueDate => {
            if (!dueDate) return '';
            const d    = new Date(dueDate);
            const days = Math.ceil((d - new Date().setHours(0,0,0,0)) / 86400000);
            const str  = d.toLocaleDateString('en-IN', { day:'2-digit', month:'short' });
            if (days < 0)  return chalk.red(` due:${str}(!)`);
            if (days === 0) return chalk.yellow(` due:TODAY`);
            if (days === 1) return chalk.yellow(` due:${str}`);
            return chalk.dim(` due:${str}`);
        };

        const divider  = (color = chalk.cyan) => color('  ' + '─'.repeat(58));
        const subline  = (label, val) =>
            `     ${chalk.dim(label+':')} ${chalk.dim(val)}`;

        // ── Fetch ────────────────────────────────────────────────────────────
        process.stdout.write(chalk.dim('  Fetching tasks...\r'));

        let result;
        try {
            result = await shell.api._request('GET', `/thinknsh/${roomId}/tasks?n=${topN}`);
        } catch (err) {
            console.log(chalk.red(`\n  ❌ ${err.message}\n`));
            return;
        }

        process.stdout.write(' '.repeat(30) + '\r'); // clear spinner line

        // ════════════════════════════════════════════════════════════════════
        //  MY TASKS
        // ════════════════════════════════════════════════════════════════════
        let tasks = result.tasks || [];

        if (filterStatus) tasks = tasks.filter(t => t.status === filterStatus);
        if (!showAll)      tasks = tasks.filter(t => !['completed','done'].includes(t.status));

        console.log(divider());
        console.log(chalk.cyan(`  MY TASKS`) + chalk.dim(`  (${tasks.length} active${result.total > tasks.length ? ` of ${result.total}` : ''})`));
        console.log(divider());

        if (!tasks.length) {
            console.log(chalk.dim('\n  No assigned tasks.\n'));
        } else {
            tasks.forEach((task, i) => {
                const sc = stColors[task.status]   || chalk.white;
                const pc = prColors[task.priority] || chalk.white;

                const num      = chalk.dim(`  ${String(i+1).padStart(2)}.`);
                const status   = sc(`[${(task.status || 'unknown').padEnd(10)}]`);
                const title    = task.status === 'completed'
                    ? chalk.dim(task.title)
                    : chalk.white(task.title);
                const due      = fmtDue(task.dueDate);
                const myStatus = task.myStatus && task.myStatus !== task.status
                    ? chalk.dim(` (${task.myStatus})`)
                    : '';
                const col      = task.column ? chalk.dim(` [${task.column}]`) : '';

                console.log(`\n${num} ${status} ${title}`);

console.log(subline('id', `${task.taskID ? '#' + task.taskID : task._id}`) +
    `  ${chalk.dim('priority:')} ${pc(task.priority)}` +
    due + myStatus + col);

                if (task.description) {
                    const desc = task.description.length > 90
                        ? task.description.slice(0, 87) + '...'
                        : task.description;
                    console.log(`     ${chalk.dim(desc)}`);
                }
            });
        }

        // ════════════════════════════════════════════════════════════════════
        //  SUGGESTIONS
        // ════════════════════════════════════════════════════════════════════
        if (!noSuggestions) {
            const suggestions = result.suggestions?.tasks    || [];
            const insights    = result.suggestions?.insights || {};
            const meta        = result.suggestions?.metadata || {};

            console.log('\n' + divider(chalk.magenta));
            console.log(chalk.magenta(`  SUGGESTED FOR YOU`) +
                chalk.dim(`  (top ${suggestions.length}${meta.totalScored ? ` of ${meta.totalScored} available` : ''})`));
            console.log(divider(chalk.magenta));

            if (!suggestions.length) {
                console.log(chalk.dim('\n  No suggestions — all tasks are assigned.\n'));
            } else {
                suggestions.forEach((task, i) => {
                    const pc  = prColors[task.priority] || chalk.white;
                    const plc = plColor(task.priorityLevel);
                    const due = fmtDue(task.dueDate);
                    const col = task.column ? chalk.dim(` [${task.column}]`) : '';
                    const assignees = task.assigneeCount
                        ? chalk.dim(` · ${task.assigneeCount} assigned`)
                        : chalk.dim(' · unassigned');
                    const urgentTag = task.isOverdue
                        ? chalk.red(' ⚠ OVERDUE')
                        : task.isUrgent ? chalk.yellow(' ⏰ URGENT') : '';

                    const num   = chalk.dim(`  ${String(i+1).padStart(2)}.`);
                    const score = `[score:${scoreColor(task.score)}]`;
                    const level = plc(`[${task.priorityLevel}]`);

                    console.log(`\n${num} ${score} ${level} ${chalk.white(task.title)}${urgentTag}`);
                    console.log(subline('id', task._id) +
                        `  ${chalk.dim('priority:')} ${pc(task.priority)}` +
                        due + col + assignees);

                    if (task.priorityReason) {
                        console.log(`     ${chalk.dim('↳ ' + task.priorityReason)}`);
                    }
                });

                // ── Insights bar ─────────────────────────────────────────────
                console.log('\n' + divider(chalk.dim));
                if (insights.focusRecommendation) {
                    console.log(`  ${chalk.magenta('💡')} ${chalk.white(insights.focusRecommendation)}`);
                }
                if (insights.estimatedTime) {
                    console.log(`  ${chalk.dim('⏱  Est. time:')} ${chalk.white(insights.estimatedTime)}`);
                }
                if (meta.scoreRange) {
                    console.log(`  ${chalk.dim('📊 Score range:')} ${chalk.white(`${meta.scoreRange.min}–${meta.scoreRange.max}`)}  ${chalk.dim('avg:')} ${chalk.white(meta.scoreRange.avg)}`);
                }
            }
        }

        // ── Footer ───────────────────────────────────────────────────────────
        console.log('\n' + divider());
        console.log(chalk.dim('  task <id>  ·  complete <id>  ·  tasks --all  ·  tasks 10  ·  tasks --no-suggest'));
        console.log(divider() + '\n');
    }
};