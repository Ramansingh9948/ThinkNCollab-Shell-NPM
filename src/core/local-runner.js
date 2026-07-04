/**
 * src/core/local-runner.js
 * Executes the local .tnc/workflows/*.yml when triggered from browser via thinknsh socket.
 * Reads workflow from process.cwd() (user's project directory), runs each step,
 * streams logs to terminal, and submits verdict back to TNC via webhook.
 */

const fs      = require('fs');
const path    = require('path');
const { spawn } = require('child_process');
const crypto  = require('crypto');

function getFetch() {
  return globalThis.fetch || require('node-fetch');
}

/**
 * Parse .tnc/workflows/*.yml into an array of { name, run } step objects.
 */
function parseWorkflow(ymlContent) {
  const lines = ymlContent.split('\n');
  let workflowName = 'TNC Local CI';
  let steps = [];
  let currentStepName = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line || line.startsWith('#') || line.startsWith('on:') ||
        line.startsWith('jobs:') || line.startsWith('build:') ||
        line.startsWith('runs-on:') || line.startsWith('uses:')) continue;

    if (line.startsWith('name:') && !currentStepName) {
      workflowName = line.slice(5).trim().replace(/['"]/g, '');
      continue;
    }

    if (line.startsWith('- name:')) {
      currentStepName = line.slice(7).trim().replace(/['"]/g, '');
      continue;
    }

    if (line.startsWith('name:') && currentStepName === '') {
      currentStepName = line.slice(5).trim().replace(/['"]/g, '');
      continue;
    }

    if (line.startsWith('- run:') || line.startsWith('run:')) {
      const prefix = line.startsWith('- run:') ? '- run:' : 'run:';
      let runCmd = line.slice(prefix.length).trim();

      if (runCmd === '|') {
        // Multiline block
        const block = [];
        let j = i + 1;
        while (j < lines.length) {
          const next = lines[j];
          const m = next.match(/^(\s+)(.*)/);
          if (m && m[1].length >= 10) { block.push(next.trim()); j++; }
          else break;
        }
        runCmd = block.join('\n');
        i = j - 1;
      }

      if (runCmd) {
        steps.push({ name: currentStepName || runCmd.slice(0, 40), run: runCmd });
        currentStepName = '';
      }
    }
  }

  return { workflowName, steps };
}

/**
 * Run a single shell command, stream output to terminal, resolve with exitCode.
 */
function runStep(cmd, cwd, onData) {
  return new Promise((resolve) => {
    const isWin   = process.platform === 'win32';
    const shell   = isWin ? 'cmd.exe' : '/bin/sh';
    const args    = isWin ? ['/s', '/c', cmd] : ['-c', cmd];
    const proc    = spawn(shell, args, {
      cwd,
      env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: 'true' }
    });

    proc.stdout.on('data', d => onData(d.toString()));
    proc.stderr.on('data', d => onData(d.toString()));
    proc.on('close', code => resolve(code ?? 0));
  });
}

/**
 * Submit result back to TNC via webhook.
 */
async function submitResult(apiUrl, taskId, webhookSecret, result) {
  const fetch = getFetch();
  const body  = JSON.stringify(result);
  const sig   = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
  const res   = await fetch(`${apiUrl}/webhooks/tasks/${taskId}/judge`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-tnc-signature': sig },
    body,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Webhook ${res.status}`);
  }
  return res.json();
}

/**
 * Main entry — triggered when server emits task:run-local to CLI socket.
 * @param {Object} opts  { taskId, webhookSecret, apiUrl, chalk, shell }
 */
async function runLocal({ taskId, webhookSecret, apiUrl, chalk, shell }) {
  const projectRoot  = process.cwd();
  const workflowsDir = path.join(projectRoot, '.tnc', 'workflows');

  console.log(chalk.cyan(`\n📡 TNC Build triggered for task: ${taskId}`));
  console.log(chalk.dim(`   Project: ${projectRoot}`));

  // 1. Find workflow file
  if (!fs.existsSync(workflowsDir)) {
    console.log(chalk.red(`❌ No .tnc/workflows/ directory found in ${projectRoot}`));
    console.log(chalk.yellow(`   Create one: mkdir -p .tnc/workflows && touch .tnc/workflows/tnc-ci.yml`));
    return;
  }

  const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
  if (!files.length) {
    console.log(chalk.red('❌ No .yml workflow files found in .tnc/workflows/'));
    return;
  }

  const workflowFile = files[0];
  const content      = fs.readFileSync(path.join(workflowsDir, workflowFile), 'utf8');
  const { workflowName, steps } = parseWorkflow(content);

  if (!steps.length) {
    console.log(chalk.red(`❌ No runnable steps found in ${workflowFile}`));
    return;
  }

  console.log(chalk.cyan(`\n🚀 [TNC Actions] Running: "${workflowName}" (${workflowFile})`));
  console.log(chalk.dim(`   ${steps.length} step(s)\n`));

  // 2. Execute each step
  const stepResults = [];
  let overallPassed = true;
  let logsBuffer    = '';

  for (let s = 0; s < steps.length; s++) {
    const step = steps[s];
    console.log(chalk.cyan(`⚙️  [Step ${s + 1}/${steps.length}] "${step.name}"`));
    console.log(chalk.gray(`$ ${step.run}\n`));

    const onData = chunk => {
      process.stdout.write(chunk);
      logsBuffer += chunk;
    };

    const exitCode  = await runStep(step.run, projectRoot, onData);
    const stepPassed = exitCode === 0;

    stepResults.push({ name: step.name, command: step.run, exitCode, passed: stepPassed });

    if (stepPassed) {
      console.log(chalk.green(`\n✅ "${step.name}" passed\n`));
    } else {
      overallPassed = false;
      console.log(chalk.red(`\n❌ "${step.name}" failed (exit ${exitCode}). Aborting.\n`));
      break;
    }
  }

  // 3. Print summary
  const border = overallPassed ? chalk.green('─'.repeat(50)) : chalk.red('─'.repeat(50));
  const badge  = overallPassed ? chalk.bgGreen.black(' PASS ') : chalk.bgRed.white(' FAIL ');
  console.log(border);
  console.log(`  ${badge}  ${workflowName}`);
  console.log(border + '\n');

  // 4. Submit verdict to TNC via webhook
  const result = {
    exitCode: overallPassed ? 0 : 1,
    stdout:   logsBuffer,
    stderr:   '',
    output: {
      workflow: workflowName,
      status:   overallPassed ? 'passed' : 'failed',
      stepsCount: steps.length,
      stepsRun:   stepResults
    },
    json: {
      workflow: workflowName,
      status:   overallPassed ? 'passed' : 'failed',
      stepsCount: steps.length,
      stepsRun:   stepResults
    }
  };

  try {
    console.log(chalk.dim('  Syncing verdict with TNC...'));
    await submitResult(apiUrl, taskId, webhookSecret, result);
    console.log(chalk.green('  ✓ Verdict saved — task updated on TNC!\n'));
  } catch (err) {
    console.log(chalk.yellow(`  ⚠️  Sync failed: ${err.message}\n`));
  }

  // 5. Push notification
  if (shell && shell.pushNotification) {
    shell.pushNotification({
      type:   'verdict',
      passed: overallPassed,
      title:  workflowName,
      reason: overallPassed ? 'TNC Local CI pipeline passed' : `Failed at: ${stepResults[stepResults.length - 1]?.name}`,
      taskId,
      at:     new Date().toISOString(),
    });
  }
}

module.exports = { runLocal };
