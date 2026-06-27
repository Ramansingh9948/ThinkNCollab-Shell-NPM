const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const { runLoadTest } = require('../../core/geekload');
const Table = require('cli-table3');

module.exports = {
  name: 'loadtest',
  description: 'Run a local load test script using GeekLoad',
  aliases: ['geekload'],
  requiresAuth: false,

  async execute(args, shell) {
    if (!args[0]) {
      console.log(chalk.red('Usage: loadtest <script-path>'));
      return;
    }

    const scriptPath = path.resolve(process.cwd(), args[0]);
    if (!fs.existsSync(scriptPath)) {
      console.log(chalk.red(`❌ Script not found: ${args[0]}`));
      return;
    }

    console.log(chalk.cyan(`\n📋 Loading test script: ${args[0]}`));

    try {
      const results = await runLoadTest(scriptPath);

      const table = new Table({
        head: [chalk.green('Metric'), chalk.green('Value')],
        colWidths: [25, 20]
      });

      table.push(
        ['Virtual Users', results.virtual_users],
        ['Duration (sec)', results.duration_sec],
        ['Total Requests', results.total_requests],
        ['Failed Requests', results.failed_requests],
        ['Requests/sec (RPS)', results.requests_per_sec],
        ['Failure Rate', `${(results.failure_rate * 100).toFixed(2)}%`],
        ['Average Latency (ms)', results.avg_latency_ms],
        ['p95 Latency (ms)', results.p95_latency_ms],
        ['p99 Latency (ms)', results.p99_latency_ms]
      );

      console.log(table.toString());

      if (results.failures.length > 0) {
        console.log(chalk.yellow(`\n⚠️  Recorded Failures (${results.failures.length}):`));
        results.failures.slice(0, 5).forEach((f, idx) => {
          console.log(chalk.dim(`   ${idx + 1}. [${f.method}] ${f.url}`));
          f.failures.forEach(msg => {
            console.log(chalk.red(`      - ${msg}`));
          });
        });
        if (results.failures.length > 5) {
          console.log(chalk.dim(`   ... and ${results.failures.length - 5} more failures`));
        }
      }

      if (results.errors.length > 0) {
        console.log(chalk.red(`\n❌ Execution Errors (${results.errors.length}):`));
        results.errors.slice(0, 5).forEach((e, idx) => {
          console.log(chalk.red(`   VU ${e.vuId} Error: ${e.message}`));
        });
      }

    } catch (err) {
      console.log(chalk.red(`❌ Load test execution failed: ${err.message}`));
    }
  }
};
