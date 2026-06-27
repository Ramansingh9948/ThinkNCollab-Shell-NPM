

const chalk  = require('chalk');
const crypto = require('crypto');
const cp     = require('child_process');
const path   = require('path');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getFetchFn() {
  return globalThis.fetch || require('node-fetch');
}

// Parse raw Set-Cookie header into Playwright cookie objects
function parseCookieHeader(raw, base) {
  const domain  = new URL(base).hostname;
  const cookies = [];
  const parts   = raw.split(/,(?=[^ ][^=]+=)/);

  for (const part of parts) {
    const segments = part.split(';').map(s => s.trim());
    const [nameVal, ...attrs] = segments;
    const eqIdx = nameVal.indexOf('=');
    if (eqIdx === -1) continue;

    const name  = nameVal.slice(0, eqIdx).trim();
    const value = nameVal.slice(eqIdx + 1).trim();
    const attrMap = {};

    for (const attr of attrs) {
      const [k, v] = attr.split('=').map(s => s.trim());
      attrMap[k.toLowerCase()] = v || true;
    }

    cookies.push({
      name,
      value,
      domain:   attrMap.domain  || domain,
      path:     attrMap.path    || '/',
      httpOnly: !!attrMap.httponly,
      secure:   !!attrMap.secure,
      sameSite: attrMap.samesite === 'None'   ? 'None'
               : attrMap.samesite === 'Strict' ? 'Strict'
               : 'Lax',
    });
  }

  return cookies;
}

function extractCsrf(html, customSelector) {
  if (customSelector) {
    const nameMatch = customSelector.match(/name=['"]([^'"]+)['"]/);
    if (nameMatch) {
      const re = new RegExp(
        `name=["']${nameMatch[1]}["'][^>]*value=["']([^"']+)["']|value=["']([^"']+)["'][^>]*name=["']${nameMatch[1]}["']`
      );
      const m = html.match(re);
      if (m) return { field: nameMatch[1], token: m[1] || m[2] };
    }
  }

  const patterns = [
    { field: '_csrf',                      re: /name=["']_csrf["'][^>]*value=["']([^"']+)["']/ },
    { field: '_token',                     re: /name=["']_token["'][^>]*value=["']([^"']+)["']/ },
    { field: 'authenticity_token',         re: /name=["']authenticity_token["'][^>]*value=["']([^"']+)["']/ },
    { field: '__RequestVerificationToken', re: /name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)["']/ },
  ];

  for (const { field, re } of patterns) {
    const m = html.match(re);
    if (m) return { field, token: m[1] };
  }

  return null;
}

// ─── Strategy: request ────────────────────────────────────────────────────────
async function authViaRequest(context, base, email, password, authConfig) {
  const fetch      = getFetchFn();
  const signinPath = authConfig.signinUrl || '/signin';
  const signinUrl  = base.replace(/\/$/, '') + signinPath;

  console.log(chalk.dim(`  → [request] GET ${signinUrl}`));

  // 1. GET signin page — grab CSRF + initial cookies
  const getRes = await fetch(signinUrl, {
    headers:  { 'User-Agent': 'Mozilla/5.0 (compatible; TNCBot/1.0)' },
    redirect: 'follow',
  });
  const html       = await getRes.text();
  const getCookies = getRes.headers.get('set-cookie') || '';
  const csrf       = extractCsrf(html, authConfig.csrfSelector);

  if (csrf) console.log(chalk.dim(`  → CSRF detected: ${csrf.field}`));

  // 2. POST credentials
  const formBody = new URLSearchParams({ email, password });
  if (csrf) formBody.append(csrf.field, csrf.token);

  console.log(chalk.dim(`  → [request] POST ${signinUrl}`));

  const postRes = await fetch(signinUrl, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie':        getCookies,
      'User-Agent':   'Mozilla/5.0 (compatible; TNCBot/1.0)',
      'Referer':       signinUrl,
    },
    body:     formBody.toString(),
    redirect: 'manual',
  });

  // 3. Extract session cookies — follow redirect manually if needed
  let finalCookies = postRes.headers.get('set-cookie');

  if (!finalCookies && postRes.status >= 300 && postRes.status < 400) {
    const loc = postRes.headers.get('location');
    if (loc) {
      const redirectRes = await fetch(
        loc.startsWith('http') ? loc : base + loc,
        { headers: { 'Cookie': getCookies }, redirect: 'manual' }
      );
      finalCookies = redirectRes.headers.get('set-cookie');
    }
  }

  if (!finalCookies) {
    throw new Error(
      'Auth failed — no session cookie returned. ' +
      'Check testUser credentials or switch to strategy: "form"'
    );
  }

  const parsed = parseCookieHeader(finalCookies, base);
  if (!parsed.length) throw new Error('Could not parse session cookies from response');

  await context.addCookies(parsed);
  console.log(chalk.dim(`  → Cookies injected: ${parsed.map(c => c.name).join(', ')}`));
}

async function authViaForm(page, base, email, password, authConfig) {
  const signinPath = authConfig.signinUrl || '/signin';
  await page.goto(base + signinPath, { waitUntil: 'networkidle', timeout: 15000 });
  console.log(chalk.dim(`  → [form] ${page.url()}`));

  if (!page.url().includes(signinPath.replace(/^\//, ''))) return;

  await page.evaluate(() => {
    document.querySelectorAll('form input, form button, form > div, form > section').forEach(el => {
      el.style.display    = '';
      el.style.visibility = 'visible';
      el.style.opacity    = '1';
    });
  });

  const fields = authConfig.fields || {};

  const emailSel = fields.email || [
    'input[type="email"]', 'input[name="email"]',
    'input[id="email"]',   'input[autocomplete="email"]',
  ].join(', ');

  const passSel = fields.password || [
    'input[type="password"]', 'input[name="password"]',
    'input[id="password"]',   'input[autocomplete="current-password"]',
  ].join(', ');

  const submitSel = fields.submit || [
    'button[type="submit"]',       'input[type="submit"]',
    'button:has-text("Sign in")',  'button:has-text("Login")',
    'button:has-text("Log in")',   'button:has-text("Continue")',
    'form button',
  ].join(', ');

  await page.locator(emailSel).first().fill(email);
  console.log(chalk.dim(`  → Email filled`));
  await page.locator(passSel).first().fill(password);
  console.log(chalk.dim(`  → Password filled`));

  const hasSubmit = await page.locator(submitSel).first().count().catch(() => 0);
  if (hasSubmit) {
    await page.locator(submitSel).first().click();
    console.log(chalk.dim(`  → Submit clicked`));
  } else {
    await page.locator(passSel).first().press('Enter');
    console.log(chalk.dim(`  → Submitted via Enter`));
  }

  const successPath = authConfig.successRedirect || null;
  await page.waitForURL(
    u => successPath
      ? u.includes(successPath)
      : !u.includes('/signin') && !u.includes('/login') && !u.includes('/verify'),
    { timeout: 15000 }
  ).catch(() => {});

  if (page.url().includes('/signin') || page.url().includes('/login')) {
    const errText = await page
      .locator('.flash, .error, .alert, [class*="error"], [role="alert"]')
      .first().textContent().catch(() => null);
    throw new Error(
      `Auth failed — still on signin.${errText ? ` Page: "${errText.trim()}"` : ' Check credentials.'}`
    );
  }

  console.log(chalk.dim(`  → Redirected: ${page.url()}`));
}

// ─── Strategy: cookie ─────────────────────────────────────────────────────────
async function authViaCookie(context, base, authConfig) {
  const cookies = authConfig.cookies;
  if (!Array.isArray(cookies) || !cookies.length) {
    throw new Error('auth.strategy "cookie" requires auth.cookies array in testConfig');
  }

  const domain = new URL(base).hostname;
  const normalized = cookies.map(c => ({
    name:     c.name,
    value:    c.value,
    domain:   c.domain   || domain,
    path:     c.path     || '/',
    httpOnly: c.httpOnly || false,
    secure:   c.secure   || false,
    sameSite: c.sameSite || 'Lax',
  }));

  await context.addCookies(normalized);
  console.log(chalk.dim(`  → Cookies injected: ${normalized.map(c => c.name).join(', ')}`));
}

// ─── Auth Dispatcher ──────────────────────────────────────────────────────────
async function authenticate(page, context, base, testUser, authConfig = {}) {
  const strategy = authConfig.strategy || 'request';
  console.log(chalk.dim(`  → Auth strategy: ${strategy}`));

  switch (strategy) {
    case 'request':
      await authViaRequest(context, base, testUser.email, testUser.password, authConfig);
      break;
    case 'form':
      await authViaForm(page, base, testUser.email, testUser.password, authConfig);
      break;
    case 'cookie':
      await authViaCookie(context, base, authConfig);
      break;
    case 'skip':
      console.log(chalk.dim(`  → Auth skipped`));
      break;
    default:
      throw new Error(`Unknown auth strategy: "${strategy}". Use: request | form | cookie | skip`);
  }
}

// ─── HTTP Test ────────────────────────────────────────────────────────────────
async function runHttpTest(testConfig, testUser, authConfig = {}) {
  const { baseUrl, method = 'GET', endpoint, headers = {}, body } = testConfig;
  if (!baseUrl || !endpoint) throw new Error('testConfig missing baseUrl or endpoint');

  const url   = baseUrl.replace(/\/$/, '') + endpoint;
  const fetch = getFetchFn();

  // ── Auth — session cookie lo ──────────────────────────────────────────────
  let sessionCookie = '';
  if (testUser && authConfig.strategy !== 'skip') {
    const signinUrl  = baseUrl.replace(/\/$/, '') + (authConfig.signinUrl || '/signin');
    const getRes     = await fetch(signinUrl, { redirect: 'follow' });
    const html       = await getRes.text();
    const getCookie  = getRes.headers.get('set-cookie') || '';
    const csrf       = extractCsrf(html, authConfig.csrfSelector);

    const formBody = new URLSearchParams({ email: testUser.email, password: testUser.password });
    if (csrf) formBody.append(csrf.field, csrf.token);

    const postRes = await fetch(signinUrl, {
      method:   'POST',
      headers:  { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': getCookie },
      body:     formBody.toString(),
      redirect: 'manual',
    });

    const setCookie = postRes.headers.get('set-cookie');
    if (setCookie) {
      sessionCookie = setCookie.split(',').map(c => c.split(';')[0].trim()).join('; ');
      console.log(chalk.dim(`  → HTTP auth: cookie obtained`));
    } else {
      console.log(chalk.yellow(`  ⚠️  HTTP auth: no cookie returned`));
    }
  }

  // ── API call ──────────────────────────────────────────────────────────────
  let res, responseBody;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(sessionCookie ? { 'Cookie': sessionCookie } : {}),
        ...headers,
      },
      ...(body && method !== 'GET' ? { body: JSON.stringify(body) } : {})
    });
    responseBody = await res.json().catch(() => ({}));
  } catch (err) {
    throw new Error(`Could not reach ${url} — is your server running? (${err.message})`);
  }

  return { status: res.status, body: responseBody };
}

// ─── Browser Test ─────────────────────────────────────────────────────────────
async function runBrowserTest(testConfig, testUser, boardAuth = {}) { 
  let playwright;
  try {
    playwright = require('playwright');
  } catch {
    throw new Error(
      'Playwright not installed.\n  Run: npm install -g playwright && npx playwright install chromium'
    );
  }

  const { url, flow = [], expect, auth = {} } = testConfig;
  if (!url) throw new Error('testConfig missing url');

  const authConfig = { ...boardAuth, ...auth };

  const base    = new URL(url).origin;
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page    = await context.newPage();

  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
   const strategy = authConfig.strategy || (testUser ? 'request' : 'skip');
  if (strategy === 'cookie') {
    await authenticate(page, context, base, testUser, authConfig);
  } else if (testUser && strategy !== 'skip') {
    await authenticate(page, context, base, testUser, authConfig);
  
    } else if (!testUser && strategy !== 'skip') {
      console.log(chalk.yellow(`  ⚠️  No testUser — auth skipped`));
    }

    // ── Navigate to target ────────────────────────────────────────────────────
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });

    if (page.url().includes('/signin') || page.url().includes('/login')) {
      throw new Error('Auth failed — redirected to signin on target page');
    }

    console.log(chalk.dim(`  → Target: ${page.url()}`));

    // ── Flow steps ────────────────────────────────────────────────────────────
    for (const step of flow) {
      switch (step.action) {
        case 'fill':          await page.fill(step.selector, step.value || '');             break;
        case 'click':         await page.click(step.selector);                               break;
        case 'wait':          await page.waitForTimeout(step.ms || 1000);                    break;
        case 'waitForElement':await page.waitForSelector(step.selector, { timeout: 8000 }); break;
        case 'select':        await page.selectOption(step.selector, step.value);            break;
        case 'screenshot':    await page.screenshot({ path: step.path || '/tmp/tnc.png' }); break;
      }
    }

    // ── Capture result ────────────────────────────────────────────────────────
    const currentUrl = page.url();
    const bodyText   = await page.textContent('body').catch(() => '');

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

// Helper to run a local command and capture exitCode & stdout/stderr
function runLocalCommand(command) {
  return new Promise((resolve) => {
    cp.exec(command, (error, stdout, stderr) => {
      const exitCode = error ? (error.code || 1) : 0;
      resolve({
        exitCode,
        stdout: stdout.toString(),
        stderr: stderr.toString()
      });
    });
  });
}

// ─── Local Judge ──────────────────────────────────────────────────────────────
function judgeLocally(testConfig, result) {
  const { type, value, condition, expect } = testConfig;
  const failures = [];

  try {
    switch (type) {
      case 'exitCode': {
        const passed = result.exitCode === value;
        return {
          passed,
          reason: passed
            ? `Exit code matched: ${value}`
            : `Expected exit code ${value}, got ${result.exitCode}`
        };
      }

      case 'stdout': {
        const actualOut = (result.stdout || '').trim();
        const expectedOut = (value || '').trim();
        const passed = actualOut === expectedOut;
        return {
          passed,
          reason: passed ? `Output matched` : `Output mismatch`,
          diff: passed ? undefined : { expected: expectedOut, actual: actualOut }
        };
      }

      case 'regex': {
        const pattern = new RegExp(value);
        const target = result.stdout || result.output || '';
        const passed = pattern.test(target);
        return {
          passed,
          reason: passed ? `Regex matched: ${value}` : `Regex did not match: ${value}`
        };
      }

      case 'http': {
        if (expect?.status !== undefined && result.status !== expect.status) {
          failures.push(`Status: expected ${expect.status}, got ${result.status}`);
        }
        if (expect?.body) {
          for (const [key, condition] of Object.entries(expect.body)) {
            const actualVal = getNestedValue(result.body || {}, key);
            if (condition?.exists) {
              if (actualVal === undefined || actualVal === null)
                failures.push(`body.${key}: expected to exist`);
            } else if (condition?.eq !== undefined) {
              if (actualVal !== condition.eq)
                failures.push(`body.${key}: expected "${condition.eq}", got "${actualVal}"`);
            } else if (condition?.contains !== undefined) {
              if (!String(actualVal).includes(String(condition.contains)))
                failures.push(`body.${key}: expected to contain "${condition.contains}"`);
            }
          }
        }
        break;
      }

      case 'json': {
        const actualData = result.output || result.json || {};
        if (condition) {
          return judgeWithConditions(condition, actualData);
        } else {
          const passed = JSON.stringify(value) === JSON.stringify(actualData);
          return {
            passed,
            reason: passed ? `JSON matched` : `JSON mismatch`,
            diff: passed ? undefined : { expected: value, actual: actualData }
          };
        }
      }
      case 'loadtest':
      case 'geekload': {
        const actualData = result.output || result.json || {};
        const cond = condition || expect?.condition || expect || {};
        return judgeWithConditions(cond, actualData);
      }

      case 'browser': {
        if (expect?.element && !result.elementExists) {
          failures.push(`Element "${expect.element}" not found on page`);
        }
        if (expect?.text && result.elementText) {
          if (!result.elementText.includes(expect.text))
            failures.push(`Element text: expected to contain "${expect.text}", got "${result.elementText}"`);
        }
        if (expect?.redirectUrl) {
          try {
            const actualPath = new URL(result.url).pathname;
            if (!actualPath.includes(expect.redirectUrl))
              failures.push(`URL: expected "${expect.redirectUrl}", got "${actualPath}"`);
          } catch {
            failures.push(`Invalid URL in result: "${result.url}"`);
          }
        }
        break;
      }

      default:
        return { passed: false, reason: `Unknown test type: ${type}` };
    }

    return {
      passed: failures.length === 0,
      reason: failures.length === 0 ? 'All checks passed' : failures.join(' | '),
      failures,
    };
  } catch (err) {
    return { passed: false, reason: `Judge error: ${err.message}` };
  }
}

function judgeWithConditions(conditions, actual) {
  const failures = [];

  for (const [key, ops] of Object.entries(conditions)) {
    const actualVal = actual[key];

    if (actualVal === undefined) {
      failures.push(`Missing key: "${key}"`);
      continue;
    }

    for (const [op, expected] of Object.entries(ops)) {
      let pass = false;
      switch (op) {
        case 'gte':     pass = actualVal >= expected; break;
        case 'lte':     pass = actualVal <= expected; break;
        case 'gt':      pass = actualVal > expected;  break;
        case 'lt':      pass = actualVal < expected;  break;
        case 'eq':      pass = actualVal === expected; break;
        case 'contains': pass = String(actualVal).includes(String(expected)); break;
        case 'regex':   pass = new RegExp(expected).test(String(actualVal)); break;
        default:        pass = false;
      }
      if (!pass) {
        failures.push(`"${key}" failed: ${actualVal} ${op} ${expected}`);
      }
    }
  }

  return {
    passed: failures.length === 0,
    reason: failures.length === 0
      ? `All conditions passed`
      : `Failed conditions: ${failures.join('; ')}`,
    diff: failures.length > 0 ? { conditions, actual } : undefined
  };
}

function getNestedValue(obj, key) {
  return key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

// ─── Webhook ──────────────────────────────────────────────────────────────────
async function hitWebhook(apiUrl, taskId, webhookSecret, payload) {
  const body      = JSON.stringify(payload);
  const signature = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
  const fetch     = getFetchFn();

  const res = await fetch(`${apiUrl}/webhooks/tasks/${taskId}/judge`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-tnc-signature': signature },
    body,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Webhook failed: ${res.status}`);
  }

  return res.json();
}

// ─── Command ──────────────────────────────────────────────────────────────────
module.exports = {
  name:         'task-submit',
  description:  'Auto-test and submit a task for verification',
  aliases:      ['submit'],
  requiresAuth: true,

  async execute(args, shell) {
    if (!args[0]) {
      console.log(chalk.red('Usage: task-submit <task-id>'));
      console.log(chalk.dim('  Alias: submit <task-id>'));
      return;
    }

    const taskId = args[0];
    const apiUrl = shell.api.apiUrl || 'https://thinkncollab.com';

    // ── Fetch task ────────────────────────────────────────────────────────────
    let task;
    try {
      task = await shell.api._request('GET', `/thinknsh/${taskId}/cli`);
    } catch (err) {
      if      (err.message?.includes('404')) console.log(chalk.red('❌ Task not found'));
      else if (err.message?.includes('403')) console.log(chalk.red('❌ Access denied'));
      else                                   console.log(chalk.red(`❌ ${err.message}`));
      return;
    }

    if (!task.testConfig) {
      console.log(chalk.yellow('⚠️  This task has no test config defined.'));
      console.log(chalk.dim('   complete <task-id>  to mark manually\n'));
      return;
    }

    const { title, testConfig, webhookSecret } = task;

    const testUser = (task.testuserEmail && task.testuserPassword)
      ? { email: task.testuserEmail, password: task.testuserPassword }
        : null;

      const boardAuth = {
      strategy:     task.testauthStrategy  || 'request',
      signinUrl:    task.testauthSigninUrl || '/signin',
      csrfSelector: task.testauthCsrf     || null,
    };

    // ── Print summary ─────────────────────────────────────────────────────────
    console.log(chalk.cyan(`\n  ── Submitting: "${title}" ──────────────────────`));
    console.log(chalk.dim(`  Type     : ${testConfig.type}`));
const authConfig = { ...boardAuth, ...(testConfig.auth || {}) };
    if (testConfig.type === 'http') {
      console.log(chalk.dim(`  Target   : ${testConfig.method || 'GET'} ${testConfig.baseUrl}${testConfig.endpoint}`));
    } else if (testConfig.type === 'browser') {
      const strategy = testConfig.auth?.strategy || (testUser ? 'request' : 'skip');
      console.log(chalk.dim(`  Target   : ${testConfig.url}`));
      console.log(chalk.dim(`  Auth     : ${strategy}`));
    if (testUser) console.log(chalk.dim(`  TestUser : ${testUser.email}`));
      else          console.log(chalk.yellow(`  ⚠️  No testUser — auth will be skipped`));
    }
    console.log(chalk.dim(`  Running virtual user...\n`));

    // ── Run test ──────────────────────────────────────────────────────────────
    let result;
    try {
      if (testConfig.type === 'http') {
        result = await runHttpTest(testConfig, testUser, authConfig);
        console.log(chalk.dim(`  → Status : ${result.status}`));
        console.log(chalk.dim(`  → Body   : ${JSON.stringify(result.body).slice(0, 80)}`));

      } else if (testConfig.type === 'browser') {
        console.log(chalk.dim(`  → Launching headless browser...`));
        result = await runBrowserTest(testConfig, testUser, authConfig);
        console.log(chalk.dim(`  → Page   : ${result.url}`));
        console.log(chalk.dim(`  → Element: ${result.elementExists ? 'found ✓' : 'not found ✗'}`));
        if (result.elementText)
          console.log(chalk.dim(`  → Text   : "${result.elementText.trim().slice(0, 60)}"`));

      } else if (testConfig.type === 'exitCode' || testConfig.type === 'stdout' || testConfig.type === 'regex') {
        const cmd = testConfig.command || testConfig.script;
        if (!cmd) {
          throw new Error(`testConfig type "${testConfig.type}" requires a "command" or "script" to execute.`);
        }
        console.log(chalk.dim(`  → Executing local command: "${cmd}"`));
        const runRes = await runLocalCommand(cmd);
        result = {
          exitCode: runRes.exitCode,
          stdout: runRes.stdout,
          stderr: runRes.stderr
        };
        console.log(chalk.dim(`  → Exit Code: ${result.exitCode}`));
        if (result.stdout) console.log(chalk.dim(`  → Stdout   : ${result.stdout.trim().slice(0, 80)}`));

      } else if (testConfig.type === 'json') {
        const cmd = testConfig.command || testConfig.script;
        if (cmd) {
          console.log(chalk.dim(`  → Executing local command: "${cmd}"`));
          const runRes = await runLocalCommand(cmd);
          let parsedJson = {};
          try {
            parsedJson = JSON.parse(runRes.stdout.trim());
          } catch (e) {
            throw new Error(`Command executed but stdout was not valid JSON: ${runRes.stdout}`);
          }
          result = {
            exitCode: runRes.exitCode,
            stdout: runRes.stdout,
            stderr: runRes.stderr,
            json: parsedJson,
            output: parsedJson
          };
        } else {
          throw new Error('testConfig type "json" requires a "command" or "script" to output JSON.');
        }

      } else if (testConfig.type === 'loadtest' || testConfig.type === 'geekload') {
        const script = testConfig.script || testConfig.command;
        if (!script) {
          throw new Error(`testConfig type "${testConfig.type}" requires a "script" or "command" specifying the load test script path.`);
        }
        const scriptPath = path.resolve(process.cwd(), script);
        console.log(chalk.dim(`  → Running GeekLoad test script: ${script}`));
        const { runLoadTest } = require('../../core/geekload');
        const loadtestResult = await runLoadTest(scriptPath);

        const Table = require('cli-table3');
        const table = new Table({
          head: [chalk.cyan('Metric'), chalk.cyan('Value')],
          colWidths: [25, 20]
        });
        table.push(
          ['Virtual Users', loadtestResult.virtual_users],
          ['Duration (sec)', loadtestResult.duration_sec],
          ['Total Requests', loadtestResult.total_requests],
          ['Failed Requests', loadtestResult.failed_requests],
          ['Failure Rate', `${(loadtestResult.failure_rate * 100).toFixed(2)}%`],
          ['p95 Latency (ms)', loadtestResult.p95_latency_ms]
        );
        console.log('\n' + table.toString() + '\n');

        result = {
          exitCode: loadtestResult.failed_requests > 0 ? 1 : 0,
          output: loadtestResult,
          json: loadtestResult
        };

      } else {
        console.log(chalk.red(`❌ Unsupported test type: ${testConfig.type}`));
        return;
      }
    } catch (err) {
      console.log(chalk.red(`\n  ❌ Virtual user failed: ${err.message}\n`));
      return;
    }

    // ── Judge ─────────────────────────────────────────────────────────────────
    const verdict = judgeLocally(testConfig, result);
    const border  = verdict.passed ? chalk.green('─'.repeat(50)) : chalk.red('─'.repeat(50));
    const badge   = verdict.passed ? chalk.bgGreen.black(' PASS ') : chalk.bgRed.white(' FAIL ');

    console.log('\n' + border);
    console.log(`  ${badge}  ${chalk.bold(title)}`);
    console.log(`  ${chalk.dim('Result :')} ${verdict.passed ? chalk.green(verdict.reason) : chalk.red(verdict.reason)}`);
    console.log(border);

    // ── Webhook ───────────────────────────────────────────────────────────────
    try {
      console.log(chalk.dim('\n  Syncing with ThinkNCollab...'));
      await hitWebhook(apiUrl, taskId, webhookSecret, result);
      console.log(chalk.green('  ✓ Verdict saved — task updated\n'));
    } catch (err) {
      console.log(chalk.yellow(`  ⚠️  Webhook sync failed: ${err.message}`));
      console.log(chalk.dim('  Local result shown above is accurate.\n'));
    }

    // ── Notification ──────────────────────────────────────────────────────────
    shell.pushNotification({
      type:   'verdict',
      passed: verdict.passed,
      title,
      reason: verdict.reason,
      taskId,
      at:     new Date().toISOString(),
    });
  },
};