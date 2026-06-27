const cp = require('child_process');
const vm = require('vm');
const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const { AsyncLocalStorage } = require('async_hooks');

const activeVUStore = new AsyncLocalStorage();

class CheckExpression {
  constructor(target, args = []) {
    this.target = target;
    this.args = args;
    this.ops = [];
    this.invert = false;
    this.msg = null;
    this.storeName = null;
  }
  equal(value) { this.ops.push({ op: 'eq', value }); return this; }
  great(value) { this.ops.push({ op: 'gt', value }); return this; }
  less(value) { this.ops.push({ op: 'lt', value }); return this; }
  contains(value) { this.ops.push({ op: 'contains', value }); return this; }
  isContained(value) { this.ops.push({ op: 'isContained', value }); return this; }
  exists() { this.ops.push({ op: 'exists' }); return this; }
  not() { this.invert = !this.invert; return this; }
  message(text) { this.msg = text; return this; }
  store(name) { this.storeName = name; return this; }
}

function statusCode() { return new CheckExpression('status'); }
function text() { return new CheckExpression('text'); }
function regexp(expr, group = 0, index = 0) { return new CheckExpression('regex', [expr, group, index]); }
function cookie(name) { return new CheckExpression('cookie', [name]); }
function header(name) { return new CheckExpression('header', [name]); }
function xPath(expr) { return new CheckExpression('xpath', [expr]); }

class HttpResult {
  constructor(statusCode, headers, body) {
    this.statusCode = statusCode;
    this.headers = headers;
    this.body = {
      asText: body,
      asObject: (() => {
        try { return JSON.parse(body); } catch { return {}; }
      })(),
      asBytes: Array.from(Buffer.from(body))
    };
  }
}

class HttpRequest {
  constructor(method, url, path, conn) {
    this.method = method;
    this.url = url;
    this.path = path;
    this.conn = conn;
    this.headersMap = {};
    this.cookiesMap = {};
    this.queryParams = {};
    this.bodyData = null;
    this.checks = [];
  }

  header(name, value) { this.headersMap[name] = value; return this; }
  cookie(name, value) { this.cookiesMap[name] = value; return this; }
  query(name, value) { this.queryParams[name] = value; return this; }
  body(obj) { this.bodyData = obj; return this; }
  then(check) {
    if (typeof check === 'function' || check instanceof CheckExpression) {
      this.checks.push(check);
    }
    return this;
  }

  sync() {
    let fullUrl = this.url.replace(/\/$/, '') + '/' + this.path.replace(/^\//, '');
    const qKeys = Object.keys(this.queryParams);
    if (qKeys.length > 0) {
      const qString = qKeys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(this.queryParams[k])}`).join('&');
      fullUrl += (fullUrl.includes('?') ? '&' : '?') + qString;
    }

    const args = ['-i', '-s', '-L', '-X', this.method];
    
    Object.entries(this.headersMap).forEach(([k, v]) => {
      args.push('-H', `${k}: ${v}`);
    });

    const cKeys = Object.keys(this.cookiesMap);
    if (cKeys.length > 0) {
      const cString = cKeys.map(k => `${k}=${this.cookiesMap[k]}`).join('; ');
      args.push('-b', cString);
    }

    if (this.bodyData) {
      const bodyStr = typeof this.bodyData === 'object' ? JSON.stringify(this.bodyData) : String(this.bodyData);
      args.push('-d', bodyStr);
      if (!this.headersMap['Content-Type'] && !this.headersMap['content-type']) {
        args.push('-H', 'Content-Type: application/json');
      }
    }

    args.push(fullUrl);

    const startTime = Date.now();
    const run = cp.spawnSync('curl', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const latency = Date.now() - startTime;

    if (run.error) {
      throw new Error(`Failed to execute HTTP request: ${run.error.message}`);
    }

    const stdout = run.stdout || '';
    const delimiter = stdout.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n';
    const firstDelimIdx = stdout.indexOf(delimiter);

    let headerSection = '';
    let bodySection = '';

    if (firstDelimIdx !== -1) {
      headerSection = stdout.slice(0, firstDelimIdx);
      bodySection = stdout.slice(firstDelimIdx + delimiter.length);
    } else {
      headerSection = stdout;
    }

    const lines = headerSection.split(/\r?\n/);
    const statusLine = lines[0] || '';
    const statusMatch = statusLine.match(/HTTP\/[\d\.]+\s+(\d+)/);
    const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;

    const headers = {};
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        const k = line.slice(0, colonIdx).trim().toLowerCase();
        const v = line.slice(colonIdx + 1).trim();
        headers[k] = v;
      }
    }

    const result = new HttpResult(statusCode, headers, bodySection);

    const store = activeVUStore.getStore();
    if (store) {
      store.stats.totalRequests++;
      store.stats.latencies.push(latency);

      let requestPassed = true;
      const failures = [];

      for (const check of this.checks) {
        if (typeof check === 'function') {
          try {
            check(result);
          } catch (err) {
            requestPassed = false;
            failures.push(err.message);
          }
        } else if (check instanceof CheckExpression) {
          const checkPassed = evaluateCheck(check, result, store.session);
          if (!checkPassed.passed) {
            requestPassed = false;
            failures.push(checkPassed.reason);
          }
        }
      }

      if (!requestPassed) {
        store.stats.failedRequests++;
        store.stats.failures.push({
          url: fullUrl,
          method: this.method,
          failures
        });
      }
    }

    return result;
  }
}

function evaluateCheck(check, result, session) {
  let actualVal;
  
  if (check.target === 'status') {
    actualVal = result.statusCode;
  } else if (check.target === 'text') {
    actualVal = result.body.asText;
  } else if (check.target === 'regex') {
    const [pattern, group, index] = check.args;
    const regex = new RegExp(pattern);
    const match = result.body.asText.match(regex);
    actualVal = match ? (match[group] || '') : '';
  } else if (check.target === 'cookie') {
    const [cookieName] = check.args;
    const setCookie = result.headers['set-cookie'] || '';
    const match = setCookie.match(new RegExp(`${cookieName}=([^;]+)`));
    actualVal = match ? match[1] : undefined;
  } else if (check.target === 'header') {
    const [headerName] = check.args;
    actualVal = result.headers[headerName.toLowerCase()];
  } else if (check.target === 'xpath') {
    const [expr] = check.args;
    actualVal = result.body.asText.includes(expr) ? expr : '';
  }

  let passed = true;
  let reason = '';

  for (const opInfo of check.ops) {
    const { op, value } = opInfo;
    let opPass = false;
    
    switch (op) {
      case 'eq':
        opPass = actualVal == value;
        if (!opPass) reason = `Expected "${value}", got "${actualVal}"`;
        break;
      case 'gt':
        opPass = Number(actualVal) > Number(value);
        if (!opPass) reason = `Expected > ${value}, got ${actualVal}`;
        break;
      case 'lt':
        opPass = Number(actualVal) < Number(value);
        if (!opPass) reason = `Expected < ${value}, got ${actualVal}`;
        break;
      case 'contains':
        opPass = String(actualVal).includes(String(value));
        if (!opPass) reason = `Expected to contain "${value}", got "${actualVal}"`;
        break;
      case 'isContained':
        opPass = String(value).includes(String(actualVal));
        if (!opPass) reason = `Expected "${actualVal}" to be contained in "${value}"`;
        break;
      case 'exists':
        opPass = actualVal !== undefined && actualVal !== null;
        if (!opPass) reason = `Expected to exist, but was undefined/null`;
        break;
    }

    if (check.invert) {
      opPass = !opPass;
      if (!opPass) reason = `Inverted check failed: ${reason}`;
    }

    if (!opPass) {
      passed = false;
      break;
    }
  }

  if (passed && check.storeName) {
    session[check.storeName] = actualVal;
  }

  if (!passed && check.msg) {
    reason = check.msg;
  }

  return { passed, reason };
}

class HttpConnection {
  constructor(url, options) {
    this.url = url;
    this.options = options;
  }
  connect() { return this; }
  get(path) { return new HttpRequest('GET', this.url, path, this); }
  put(path) { return new HttpRequest('PUT', this.url, path, this); }
  post(path) { return new HttpRequest('POST', this.url, path, this); }
  patch(path) { return new HttpRequest('PATCH', this.url, path, this); }
  delete(path) { return new HttpRequest('DELETE', this.url, path, this); }
  options(path) { return new HttpRequest('OPTIONS', this.url, path, this); }
  head(path) { return new HttpRequest('HEAD', this.url, path, this); }
}

function http(url, options) { return new HttpConnection(url, options); }
function http2(url, options) { return new HttpConnection(url, options); }

function websocket(url, options) {
  return {
    connect() { return this; },
    sendText(val) {},
    sendArray(val) {},
    receiveText() { return ''; },
    receiveArray() { return []; }
  };
}

function swagger(url, options) {
  return {
    show() { console.log('Swagger definition loaded from ' + url); }
  };
}

class StageClass {
  constructor(runner) {
    this.runner = runner;
  }
  async run(title, users, groups) {
    await this.runner.runStage(title, users, groups);
  }
}

class GroupClass {
  run(scenario, users, profile) {
    return { scenario, users, profile };
  }
}

class GeekLoadRunner {
  constructor() {
    this.stats = {
      totalRequests: 0,
      failedRequests: 0,
      latencies: [],
      failures: [],
      errors: [],
      stopped: false
    };
    this.results = null;
    this.completionPromise = new Promise((resolve) => {
      this.resolveCompletion = resolve;
    });
    this.stageStarted = false;
  }

  async pause(min, max) {
    const parseDuration = (str) => {
      const match = String(str).match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/);
      if (!match) return 1000;
      const val = parseFloat(match[1]);
      const unit = match[2] || 'ms';
      if (unit === 's') return val * 1000;
      if (unit === 'm') return val * 60 * 1000;
      if (unit === 'h') return val * 60 * 60 * 1000;
      return val;
    };
    const minMs = parseDuration(min);
    const maxMs = max ? parseDuration(max) : minMs;
    const delay = minMs + Math.random() * (maxMs - minMs);
    
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  async runStage(title, users, groups) {
    this.stageStarted = true;
    console.log(chalk.cyan(`\n🚀 Starting Stage: "${title}"`));
    console.log(chalk.dim(`   Total Virtual Users: ${users}\n`));

    const startTime = Date.now();
    const vuPromises = [];

    for (const group of groups) {
      const { scenario, users: groupUsers, profile } = group;
      const durationMs = this.parseDuration(profile);

      console.log(chalk.dim(`   Spawning Group scenario... [VUs: ${groupUsers}, Duration: ${profile}]`));

      for (let i = 0; i < groupUsers; i++) {
        vuPromises.push(this.runVU(scenario, durationMs, i + 1));
      }
    }

    await Promise.all(vuPromises);

    const endTime = Date.now();
    const durationSec = (endTime - startTime) / 1000;

    const latencies = this.stats.latencies.sort((a, b) => a - b);
    const totalRequests = this.stats.totalRequests;
    const failedRequests = this.stats.failedRequests;

    const p95Idx = Math.floor(latencies.length * 0.95);
    const p95 = latencies.length > 0 ? latencies[p95Idx] : 0;

    const p99Idx = Math.floor(latencies.length * 0.99);
    const p99 = latencies.length > 0 ? latencies[p99Idx] : 0;

    const avg = latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;

    const rps = durationSec > 0 ? parseFloat((totalRequests / durationSec).toFixed(2)) : 0;
    const failureRate = totalRequests > 0 ? parseFloat((failedRequests / totalRequests).toFixed(4)) : 0;

    this.results = {
      virtual_users: users,
      duration_sec: parseFloat(durationSec.toFixed(2)),
      p95_latency_ms: p95,
      p99_latency_ms: p99,
      avg_latency_ms: avg,
      failure_rate: failureRate,
      requests_per_sec: rps,
      total_requests: totalRequests,
      failed_requests: failedRequests,
      failures: this.stats.failures,
      errors: this.stats.errors
    };

    this.resolveCompletion(this.results);
  }

  parseDuration(str) {
    const match = String(str).match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/);
    if (!match) return 5000;
    const val = parseFloat(match[1]);
    const unit = match[2] || 'ms';
    if (unit === 's') return val * 1000;
    if (unit === 'm') return val * 60 * 1000;
    if (unit === 'h') return val * 60 * 60 * 1000;
    return val;
  }

  async runVU(scenarioFn, durationMs, vuId) {
    const endTime = Date.now() + durationMs;
    const session = {};

    while (Date.now() < endTime && !this.stats.stopped) {
      try {
        await activeVUStore.run({ stats: this.stats, session, vuId }, async () => {
          if (typeof scenarioFn === 'function') {
            await scenarioFn();
          } else {
            throw new Error(`Scenario is not an executable function: ${scenarioFn}`);
          }
        });
      } catch (err) {
        this.stats.errors.push({
          vuId,
          time: Date.now(),
          message: err.message
        });
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }
}

function transpile(code) {
  let processed = code;
  
  // 1. Convert standard function declarations to async:
  processed = processed.replace(/(?<!async\s+)function\s+([\w\$]+)\s*\(/g, 'async function $1(');
  
  // 2. Convert arrow functions to async:
  processed = processed.replace(/(?<!async\s+)([\w\$]+|\([^\)]*\))\s*=>/g, 'async $1 =>');
  
  // 3. Prepend "await " to calls ending in .sync()
  processed = processed.replace(/(?<!await\s+)([\w\$\(\)\.\'\"\[\]\-]+)\.sync\(\)/g, 'await $1.sync()');
  
  // 4. Prepend "await " to pause(...)
  processed = processed.replace(/(?<!await\s+)pause\(/g, 'await pause(');
  
  // Clean up double await
  processed = processed.replace(/await\s+await\s+/g, 'await ');
  
  return processed;
}

async function runLoadTest(scriptPath) {
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Load test script not found: ${scriptPath}`);
  }

  const scriptContent = fs.readFileSync(scriptPath, 'utf8');
  const runner = new GeekLoadRunner();

  const context = vm.createContext({
    Stage: new StageClass(runner),
    Group: new GroupClass(),
    http,
    http2,
    websocket,
    swagger,
    pause: runner.pause.bind(runner),
    statusCode,
    text,
    regexp,
    cookie,
    header,
    xPath,
    Log: {
      message(txt) { console.log(chalk.dim(`[Log] ${txt}`)); },
      warning(txt) { console.log(chalk.yellow(`[Warning] ${txt}`)); },
      error(txt) { console.log(chalk.red(`[Error] ${txt}`)); }
    },
    config: {},
    console: console,
    globalThis: {}
  });

  const transpiledCode = transpile(scriptContent);
  const wrappedCode = `
(async () => {
  try {
    ${transpiledCode}
  } catch (err) {
    globalThis.__geekload_err = err;
  }
})()
`;

  const script = new vm.Script(wrappedCode);
  script.runInContext(context);

  // Setup safety fallback timeout
  setTimeout(() => {
    if (!runner.stageStarted) {
      const err = context.globalThis.__geekload_err || new Error('Script execution failed to call Stage.run');
      runner.resolveCompletion(Promise.reject(err));
    }
  }, 1000);

  return runner.completionPromise;
}

module.exports = {
  runLoadTest,
  transpile
};
