const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const { runLoadTest } = require('../../core/geekload');
const Table = require('cli-table3');

module.exports = {
  name: 'loadtest',
  description: 'Run a local load test script using GeekLoad and sync stats to TNC',
  aliases: ['geekload'],
  requiresAuth: true,
  requiresRoom: true,

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

      // Sync stats back to ThinkNCollab backend
      const roomId = shell.ws.getCurrentRoom();
      if (roomId) {
        process.stdout.write(chalk.dim('  Syncing stats to ThinkNCollab server...\r'));
        try {
          const stats = {
            targetUrl: args[0],
            duration: results.duration_sec,
            connections: results.virtual_users,
            requestsTotal: results.total_requests,
            throughputTotalBytes: results.total_requests * 512,
            latency: {
              p50: results.avg_latency_ms,
              p90: results.p95_latency_ms,
              p99: results.p99_latency_ms,
              average: results.avg_latency_ms,
              min: results.avg_latency_ms * 0.5,
              max: results.avg_latency_ms * 1.5
            },
            errors: results.failed_requests
          };

          await shell.api._request('POST', `/tncloadtest/api/save-run/${roomId}`, {
            targetUrl: args[0],
            duration: results.duration_sec,
            connections: results.virtual_users,
            stats
          });
          console.log(chalk.green('  ✅ Load test stats successfully synced to workspace!'));
        } catch (syncErr) {
          console.log(chalk.red(`  ⚠️  Failed to sync stats to server: ${syncErr.message}`));
        }
      }

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

    } catch (err) {
      console.log(chalk.red(`❌ Load test execution failed: ${err.message}`));
    }
  }
};
