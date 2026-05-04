/*
  src/commands/tasks/task-submit.js — Submit task for auto-verification
  Usage: task-submit <taskId>  OR  submit <taskId>
*/
const chalk  = require('chalk');
const crypto = require('crypto');

// ─── Virtual User Runner ──────────────────────────────────────────────────────

async function runHttpTest(testConfig) {
  const { baseUrl, method = 'GET', endpoint, headers = {}, body, expect } = testConfig;

  if (!baseUrl || !endpoint) {
    throw new Error('testConfig missing baseUrl or endpoint');
  }

  const url = baseUrl.replace(/\/$/, '') + endpoint;

  // node 18+ has native fetch, fallback to http for older
  let res, responseBody;
  try {
    const fetchFn = globalThis.fetch || require('node-fetch');
    const fetchOpts = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body && method !== 'GET' ? { body: JSON.stringify(body) } : {})
    };
    res = await fetchFn(url, fetchOpts);
    responseBody = await res.json().catch(() => ({}));
  } catch (err) {
    throw new Error(`Could not reach ${url} — is your server running? (${err.message})`);
  }

  return { status: res.status, body: responseBody };
}

async function runBrowserTest(testConfig) {
  // Playwright — optional dep, graceful error if not installed
  let playwright;
  try {
    playwright = require('playwright');
  } catch {
    throw new Error(
      'Playwright not installed. Run: npm install -g playwright && npx playwright install chromium'
    );
  }

  const { url, flow = [], expect } = testConfig;
  if (!url) throw new Error('testConfig missing url for browser type');

  const browser = await playwright.chromium.launch({ headless: true });
  const page    = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });

    // Run flow steps
    for (const step of flow) {
      switch (step.action) {
        case 'fill':
          await page.fill(step.selector, step.value || '');
          break;
        case 'click':
          await page.click(step.selector);
          break;
        case 'wait':
          await page.waitForTimeout(step.ms || 1000);
          break;
        case 'waitForElement':
          await page.waitForSelector(step.selector, { timeout: 8000 });
          break;
        case 'select':
          await page.selectOption(step.selector, step.value);
          break;
      }
    }

    // Capture result
    const currentUrl  = page.url();
    const bodyText    = await page.textContent('body').catch(() => '');

    // Check element exists
    let elementExists = false;
    let elementText   = '';
    if (expect?.element) {
      try {
        await page.waitForSelector(expect.element, { timeout: 5000 });
        elementExists = true;
        elementText   = await page.textContent(expect.element).catch(() => '');
      } catch { elementExists = false; }
    }

    return { url: currentUrl, elementExists, elementText, bodyText };

  } finally {
    await browser.close();
  }
}

// ─── Local Judge — compare result against testConfig.expect ──────────────────

function judgeLocally(testConfig, result) {
  const { type, expect } = testConfig;
  const failures = [];

  if (type === 'http') {
    if (expect?.status !== undefined && result.status !== expect.status) {
      failures.push(`Status: expected ${expect.status}, got ${result.status}`);
    }
    if (expect?.body) {
      for (const [key, condition] of Object.entries(expect.body)) {
        const actual = getNestedValue(result.body, key);
        if (condition?.exists) {
          if (actual === undefined || actual === null)
            failures.push(`body.${key}: expected to exist`);
        } else if (condition?.eq !== undefined) {
          if (actual !== condition.eq)
            failures.push(`body.${key}: expected "${condition.eq}", got "${actual}"`);
        } else if (condition?.contains !== undefined) {
          if (!String(actual).includes(String(condition.contains)))
            failures.push(`body.${key}: expected to contain "${condition.contains}"`);
        }
      }
    }
  }

  if (type === 'browser') {
    if (expect?.element && !result.elementExists) {
      failures.push(`Element "${expect.element}" not found on page`);
    }
    if (expect?.text && result.elementText) {
      if (!result.elementText.includes(expect.text))
        failures.push(`Element text: expected to contain "${expect.text}", got "${result.elementText}"`);
    }
    if (expect?.redirectUrl) {
      const actualPath = new URL(result.url).pathname;
      if (!actualPath.includes(expect.redirectUrl))
        failures.push(`URL: expected "${expect.redirectUrl}", got "${actualPath}"`);
    }
  }

  return {
    passed: failures.length === 0,
    reason: failures.length === 0 ? 'All checks passed' : failures.join(' | '),
    failures
  };
}

function getNestedValue(obj, key) {
  return key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

// ─── Hit TNC Webhook ──────────────────────────────────────────────────────────

async function hitWebhook(apiUrl, taskId, webhookSecret, payload) {
  const body      = JSON.stringify(payload);
  const signature = 'sha256=' + crypto
    .createHmac('sha256', webhookSecret)
    .update(body)
    .digest('hex');

  const fetchFn = globalThis.fetch || require('node-fetch');
  const res = await fetchFn(
    `${apiUrl}/webhooks/tasks/${taskId}/judge`,
    {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-tnc-signature': signature
      },
      body
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Webhook failed: ${res.status}`);
  }

  return res.json();
}

// ─── Command ──────────────────────────────────────────────────────────────────

module.exports = {
  name:        'task-submit',
  description: 'Auto-test and submit a task for verification',
  aliases:     ['submit'],
  requiresAuth: true,

  async execute(args, shell) {
    if (!args[0]) {
      console.log(chalk.red('Usage: task-submit <task-id>'));
      console.log(chalk.dim('  Alias: submit <task-id>'));
      return;
    }

    const taskId = args[0];
    const apiUrl = shell.api.apiUrl || 'https://thinkncollab.com';

    // ── Fetch task ───────────────────────────────────────────────────────────
    let task;
    try {
      task = await shell.api._request('GET', `/thinknsh/${taskId}/cli`);
    } catch (err) {
      if (err.message?.includes('404')) console.log(chalk.red('❌ Task not found'));
      else if (err.message?.includes('403')) console.log(chalk.red('❌ Access denied'));
      else console.log(chalk.red(`❌ ${err.message}`));
      return;
    }

    if (!task.testConfig) {
      console.log(chalk.yellow('⚠️  This task has no test config defined.'));
      console.log(chalk.dim('   Ask the assigner to add a test config, or use:'));
      console.log(chalk.dim('   complete <task-id>  to mark manually\n'));
      return;
    }

    const { testConfig, webhookSecret, title } = task;

    console.log(chalk.cyan(`\n  ── Submitting: "${title}" ──────────────────────`));
    console.log(chalk.dim(`  Type    : ${testConfig.type}`));

    if (testConfig.type === 'http') {
      console.log(chalk.dim(`  Target  : ${testConfig.method} ${testConfig.baseUrl}${testConfig.endpoint}`));
    } else if (testConfig.type === 'browser') {
      console.log(chalk.dim(`  Target  : ${testConfig.url}`));
    }

    console.log(chalk.dim(`  Running virtual user...\n`));

    // ── Run virtual user ─────────────────────────────────────────────────────
    let result;
    try {
      if (testConfig.type === 'http') {
        result = await runHttpTest(testConfig);
        console.log(chalk.dim(`  → ${testConfig.method} ${testConfig.baseUrl}${testConfig.endpoint}`));
        console.log(chalk.dim(`  → Status  : ${result.status}`));
        console.log(chalk.dim(`  → Body    : ${JSON.stringify(result.body).slice(0, 80)}`));
      } else if (testConfig.type === 'browser') {
        console.log(chalk.dim(`  → Launching headless browser...`));
        result = await runBrowserTest(testConfig);
        console.log(chalk.dim(`  → Page    : ${result.url}`));
        console.log(chalk.dim(`  → Element : ${result.elementExists ? 'found' : 'not found'}`));
        if (result.elementText) console.log(chalk.dim(`  → Text    : "${result.elementText.trim().slice(0, 60)}"`));
      } else {
        console.log(chalk.red(`❌ Unsupported test type: ${testConfig.type}`));
        return;
      }
    } catch (err) {
      console.log(chalk.red(`\n  ❌ Virtual user failed: ${err.message}\n`));
      return;
    }

    // ── Local judge ──────────────────────────────────────────────────────────
    const localVerdict = judgeLocally(testConfig, result);

    const border = localVerdict.passed
      ? chalk.green('─'.repeat(50))
      : chalk.red('─'.repeat(50));
    const badge  = localVerdict.passed
      ? chalk.bgGreen.black(' PASS ')
      : chalk.bgRed.white(' FAIL ');

    console.log('\n' + border);
    console.log(`  ${badge}  ${chalk.bold(title)}`);
    console.log(`  ${chalk.dim('Result  :')} ${localVerdict.passed ? chalk.green(localVerdict.reason) : chalk.red(localVerdict.reason)}`);
    console.log(border);

    // ── Hit webhook → server persists + emits socket ─────────────────────────
    try {
      console.log(chalk.dim('\n  Syncing with ThinkNCollab...'));
      await hitWebhook(apiUrl, taskId, webhookSecret, result);
      console.log(chalk.green('  ✓ Verdict saved — task updated\n'));
    } catch (err) {
      // Webhook failed — show warning but don't block the user
      console.log(chalk.yellow(`  ⚠️  Webhook sync failed: ${err.message}`));
      console.log(chalk.dim('  Local result shown above is accurate.\n'));
    }

    // ── Notification window ──────────────────────────────────────────────────
    shell.pushNotification({
      type:   'verdict',
      passed: localVerdict.passed,
      title,
      reason: localVerdict.reason,
      taskId,
      at:     new Date().toISOString()
    });
  }
};