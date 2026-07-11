const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');

module.exports = {
  name: 'build',
  description: 'Run local CI/CD workflow build pipelines and sync stats to TNC',
  aliases: ['pipeline', 'run-ci'],
  requiresAuth: true,
  requiresRoom: true,

  async execute(args, shell) {
    const workflowFile = args[0] || 'tnc-ci.yml';
    const projectRoot = process.cwd();
    const workflowPath = path.join(projectRoot, '.tnc/workflows', workflowFile);

    if (!fs.existsSync(workflowPath)) {
      console.log(chalk.red(`❌ Workflow file not found: .tnc/workflows/${workflowFile}`));
      return;
    }

    console.log(chalk.cyan(`\n📋 Loading local CI/CD workflow: ${workflowFile}`));

    // Read YAML file
    const content = fs.readFileSync(workflowPath, 'utf8');
    const lines = content.split('\n');
    let workflowName = workflowFile;
    let steps = [];
    let currentStepName = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('name:')) {
        workflowName = line.substring(5).trim().replace(/['"]/g, '');
        continue;
      }
      if (line.startsWith('-')) {
        const cleaned = line.substring(1).trim();
        if (cleaned.startsWith('name:')) {
          currentStepName = cleaned.substring(5).trim().replace(/['"]/g, '');
        } else if (cleaned.startsWith('run:')) {
          let runCmd = cleaned.substring(4).trim();
          if ((runCmd.startsWith('"') && runCmd.endsWith('"')) || (runCmd.startsWith("'") && runCmd.endsWith("'"))) {
            runCmd = runCmd.substring(1, runCmd.length - 1);
          }
          if (runCmd === '|') {
            let block = [];
            let j = i + 1;
            while (j < lines.length) {
              const next = lines[j];
              const match = next.match(/^(\s+)(.*)/);
              if (match && match[1].length > 4) {
                block.push(next.trim());
                j++;
              } else {
                break;
              }
            }
            runCmd = block.join('\n');
            i = j - 1;
          }
          steps.push({
            name: currentStepName || `run: ${runCmd.substring(0, 30)}`,
            run: runCmd
          });
          currentStepName = '';
        }
      } else if (line.startsWith('name:')) {
        currentStepName = line.substring(5).trim().replace(/['"]/g, '');
      } else if (line.startsWith('run:')) {
        let runCmd = line.substring(4).trim();
        if ((runCmd.startsWith('"') && runCmd.endsWith('"')) || (runCmd.startsWith("'") && runCmd.endsWith("'"))) {
          runCmd = runCmd.substring(1, runCmd.length - 1);
        }
        if (runCmd === '|') {
          let block = [];
          let j = i + 1;
          while (j < lines.length) {
            const next = lines[j];
            const match = next.match(/^(\s+)(.*)/);
            if (match && match[1].length > 4) {
              block.push(next.trim());
              j++;
            } else {
              break;
            }
          }
          runCmd = block.join('\n');
          i = j - 1;
        }
        steps.push({
          name: currentStepName || `run: ${runCmd.substring(0, 30)}`,
          run: runCmd
        });
        currentStepName = '';
      }
    }

    if (steps.length === 0) {
      console.log(chalk.red('❌ No build steps parsed from workflow'));
      return;
    }

    const logs = [];
    logs.push(`🚀 [TNC Actions] Starting Local Workflow: "${workflowName}" (${workflowFile})`);
    console.log(chalk.green(`🚀 [TNC Actions] Starting Local Workflow: "${workflowName}" (${workflowFile})`));

    let overallPassed = true;

    for (let s = 0; s < steps.length; s++) {
      const step = steps[s];
      const stepStartMsg = `\n⚙️ [Step ${s+1}/${steps.length}] "${step.name}"\n$ ${step.run}`;
      logs.push(stepStartMsg);
      console.log(chalk.yellow(stepStartMsg));

      const exitCode = await new Promise((resolve) => {
        const shellCmd = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
        const shellArgs = process.platform === 'win32' ? ['/s', '/c', step.run] : ['-c', step.run];
        
        const proc = spawn(shellCmd, shellArgs, {
          cwd: projectRoot,
          env: { ...process.env, PATH: process.env.PATH, PUPPETEER_SKIP_DOWNLOAD: 'true' }
        });

        proc.stdout.on('data', (chunk) => {
          const chunkStr = chunk.toString().trim();
          if (chunkStr) {
            chunkStr.split('\n').forEach(line => {
              logs.push(`[stdout] ${line}`);
              console.log(chalk.dim(`  ${line}`));
            });
          }
        });

        proc.stderr.on('data', (chunk) => {
          const chunkStr = chunk.toString().trim();
          if (chunkStr) {
            chunkStr.split('\n').forEach(line => {
              logs.push(`[stderr] ${line}`);
              console.log(chalk.red(`  ${line}`));
            });
          }
        });

        proc.on('close', (code) => {
          resolve(code);
        });
      });

      if (exitCode !== 0) {
        overallPassed = false;
        const failMsg = `❌ [Step Failed] Step "${step.name}" exited with status code: ${exitCode}`;
        logs.push(failMsg);
        console.log(chalk.red(failMsg));
        break;
      } else {
        const passMsg = `✅ [Step Passed] Step "${step.name}" completed successfully`;
        logs.push(passMsg);
        console.log(chalk.green(passMsg));
      }
    }

    if (overallPassed) {
      const successMsg = `\n🎉 Workflow ran successfully! status code: 0`;
      logs.push(successMsg);
      console.log(chalk.green(successMsg));
    } else {
      const failMsg = `\n❌ Workflow failed!`;
      logs.push(failMsg);
      console.log(chalk.red(failMsg));
    }

    // Sync stats back to ThinkNCollab backend
    const roomId = shell.ws.getCurrentRoom();
    if (roomId) {
      process.stdout.write(chalk.dim('  Syncing stats to ThinkNCollab server...\r'));
      try {
        await shell.api._request('POST', `/tnccicd/api/save-run/${roomId}`, {
          workflowFile,
          status: overallPassed ? 'passed' : 'failed',
          logs
        });
        console.log(chalk.green('  ✅ Pipeline stats successfully synced to workspace!'));
      } catch (syncErr) {
        console.log(chalk.red(`  ⚠️  Failed to sync stats to server: ${syncErr.message}`));
      }
    }
  }
};
