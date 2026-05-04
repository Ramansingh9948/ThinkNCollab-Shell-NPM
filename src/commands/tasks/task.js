/*
  src/commands/tasks/task-info.js — View task details + testConfig + webhook URL
  Usage: task-info <taskId>  OR  info <taskId>
*/
const chalk = require('chalk');

module.exports = {
  name:         'task-info',
  description:  'View full task details including test config and webhook URL',
  aliases:      ['task', 'info', 'taskInfo', '--t' ],
  requiresAuth: true,

  async execute(args, shell) {
    if (!args[0]) {
      console.log(chalk.red('Usage: task-info <task-id>'));
      console.log(chalk.dim('  Alias: info <task-id>'));
      return;
    }

    const taskId = args[0];

    let task;
    try {
      task = await shell.api._request('GET', `/thinknsh/${taskId}/cli`);
    } catch (err) {
      if (err.message?.includes('404')) console.log(chalk.red('❌ Task not found'));
      else if (err.message?.includes('403')) console.log(chalk.red('❌ Access denied'));
      else console.log(chalk.red(`❌ ${err.message}`));
      return;
    }

    const stColors = {
      pending:    chalk.yellow,
      inprogress: chalk.blue,
      review:     chalk.magenta,
      completed:  chalk.green,
      reopened:   chalk.cyan,
    };
    const prColors = { high: chalk.red, medium: chalk.yellow, low: chalk.green };
    const stColor  = stColors[task.status]   || chalk.white;
    const prColor  = prColors[task.priority] || chalk.white;

    // ── Basic Info ────────────────────────────────────────────────────────────
    console.log(chalk.cyan('\n  ─── Task Info ───────────────────────────────────'));
    console.log(`  ${chalk.dim('id      ')}  ${chalk.dim(task._id)}`);
    console.log(`  ${chalk.dim('title   ')}  ${chalk.bold(task.title)}`);
    console.log(`  ${chalk.dim('status  ')}  ${stColor(task.status)}`);
    console.log(`  ${chalk.dim('priority')}  ${prColor(task.priority)}`);
    if (task.category)
      console.log(`  ${chalk.dim('category')}  ${chalk.dim(task.category)}`);
    if (task.dueDate)
      console.log(`  ${chalk.dim('due     ')}  ${chalk.yellow(new Date(task.dueDate).toLocaleDateString())}`);
    if (task.description) {
      console.log(chalk.dim('\n  description:'));
      task.description.split('\n').forEach(l => console.log(`    ${chalk.white(l)}`));
    }

    // ── Assignees ─────────────────────────────────────────────────────────────
    if (task.assignedTo?.length) {
      console.log(chalk.dim('\n  assignees:'));
      task.assignedTo.forEach(a => {
        const name    = a.userId?.name || 'Unknown';
        const stBadge = a.status === 'completed' ? chalk.green('✓') :
                        a.status === 'accepted'  ? chalk.blue('●') :
                        a.status === 'rejected'  ? chalk.red('✗') : chalk.dim('○');
        console.log(`    ${stBadge} ${name} ${chalk.dim(`[${a.status}]`)}`);
      });
    }

    // ── Test Config ───────────────────────────────────────────────────────────
    if (task.testConfig?.type) {
      const tc = task.testConfig;

      console.log(chalk.cyan('\n  ─── Test Config ─────────────────────────────────'));
      console.log(`  ${chalk.dim('type    ')}  ${chalk.bold(tc.type)}`);

      if (tc.type === 'http') {
        console.log(`  ${chalk.dim('method  ')}  ${chalk.green(tc.method || 'GET')}`);
        console.log(`  ${chalk.dim('target  ')}  ${chalk.white((tc.baseUrl || '') + (tc.endpoint || ''))}`);
        if (tc.body && Object.keys(tc.body).length) {
          console.log(`  ${chalk.dim('body    ')}  ${chalk.dim(JSON.stringify(tc.body))}`);
        }
        if (tc.expect) {
          console.log(chalk.dim('\n  expect:'));
          if (tc.expect.status !== undefined)
            console.log(`    ${chalk.dim('status')}  ${chalk.green(tc.expect.status)}`);
          if (tc.expect.body) {
            Object.entries(tc.expect.body).forEach(([key, condition]) => {
              const condStr = typeof condition === 'object'
                ? Object.entries(condition).map(([op, val]) => `${op}: ${val}`).join(', ')
                : String(condition);
              console.log(`    ${chalk.dim('body.' + key)}  ${chalk.cyan(condStr)}`);
            });
          }
        }
      }

      if (tc.type === 'browser') {
        console.log(`  ${chalk.dim('url     ')}  ${chalk.white(tc.url || '')}`);
        if (tc.flow?.length) {
          console.log(chalk.dim('\n  flow:'));
          tc.flow.forEach((step, i) => {
            console.log(`    ${chalk.dim(i + 1 + '.')} ${chalk.green(step.action)} ${chalk.dim(step.selector || '')} ${step.value ? chalk.white(`"${step.value}"`) : ''}`);
          });
        }
        if (tc.expect) {
          console.log(chalk.dim('\n  expect:'));
          if (tc.expect.element)
            console.log(`    ${chalk.dim('element    ')}  ${chalk.cyan(tc.expect.element)}`);
          if (tc.expect.text)
            console.log(`    ${chalk.dim('text       ')}  ${chalk.cyan(`contains "${tc.expect.text}"`)}`);
          if (tc.expect.redirectUrl)
            console.log(`    ${chalk.dim('redirectUrl')}  ${chalk.cyan(tc.expect.redirectUrl)}`);
        }
      }

      if (tc.type === 'json') {
        if (tc.expect?.condition) {
          console.log(chalk.dim('\n  conditions:'));
          Object.entries(tc.expect.condition).forEach(([key, ops]) => {
            const condStr = Object.entries(ops).map(([op, val]) => `${op} ${val}`).join(', ');
            console.log(`    ${chalk.dim(key)}  ${chalk.cyan(condStr)}`);
          });
        }
      }

      if (tc.type === 'exitCode')
        console.log(`  ${chalk.dim('expect  ')}  exitCode ${chalk.green(tc.expect?.exitCode ?? 0)}`);

      if (tc.type === 'stdout')
        console.log(`  ${chalk.dim('expect  ')}  stdout "${chalk.green(tc.expect?.stdout || '')}"`);

      if (tc.type === 'regex')
        console.log(`  ${chalk.dim('expect  ')}  regex ${chalk.green(tc.expect?.regex || '')}`);

    } else {
      console.log(chalk.yellow('\n  ⚠️  No test config — task will need manual completion'));
      console.log(chalk.dim('   Use: complete <task-id>'));
    }

    // ── Webhook ───────────────────────────────────────────────────────────────
    if (task.webhookSecret) {
      const apiUrl     = shell.api.apiUrl || 'https://thinkncollab.com';
      const webhookUrl = `${apiUrl}/webhooks/tasks/${taskId}/judge`;

      console.log(chalk.cyan('\n  ─── Webhook ─────────────────────────────────────'));
      console.log(`  ${chalk.dim('url    ')}  ${chalk.white(webhookUrl)}`);
      console.log(`  ${chalk.dim('secret ')}  ${chalk.dim(task.webhookSecret)}`);
      console.log(`  ${chalk.dim('header ')}  ${chalk.dim('x-tnc-signature: sha256=<HMAC of body>')}`);
      console.log(chalk.dim('\n  To submit from your project:'));
      console.log(chalk.cyan('  submit ' + taskId));
    }

    // ── Last Verdict ──────────────────────────────────────────────────────────
    if (task.lastVerdict?.at) {
      const v      = task.lastVerdict;
      const passed = v.passed;
      const badge  = passed ? chalk.bgGreen.black(' PASS ') : chalk.bgRed.white(' FAIL ');
      const ts     = new Date(v.at).toLocaleString();

      console.log(chalk.cyan('\n  ─── Last Verdict ────────────────────────────────'));
      console.log(`  ${badge}  ${passed ? chalk.green(v.reason) : chalk.red(v.reason)}`);
      console.log(`  ${chalk.dim('at')}  ${chalk.dim(ts)}`);
      if (v.diff) {
        console.log(`  ${chalk.dim('expected')}  ${chalk.cyan(JSON.stringify(v.diff.expected ?? v.diff.conditions))}`);
        console.log(`  ${chalk.dim('actual  ')}  ${chalk.yellow(JSON.stringify(v.diff.actual))}`);
      }
    }

    console.log(chalk.cyan('  ─────────────────────────────────────────────────\n'));
  }
};