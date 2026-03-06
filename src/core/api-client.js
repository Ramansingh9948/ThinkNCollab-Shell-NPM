/**
 * ThinkNCollab API Client
 * Handles HTTP requests to the backend
 */

const https = require('https');
const http  = require('http');
const path  = require('path');
const fs    = require('fs-extra');
const os    = require('os');

class ThinkNCollabAPI {

    constructor(options = {}) {
        this.apiUrl   = (options.apiUrl || 'https://thinkncollab.com').replace(/\/$/, '');
        this.wsUrl    = (options.wsUrl  || 'https://thinkncollab.com').replace(/\/$/, '');
        this.session  = null;
        this.sessionPath = path.join(os.homedir(), '.thinkncollab', 'session.json');

        // Load existing session on startup
        this._loadSession();
    }

    // ─── Session management ───────────────────────────────────────────────────

    _loadSession() {
        try {
            if (fs.existsSync(this.sessionPath)) {
                this.session = fs.readJsonSync(this.sessionPath);
            }
        } catch {}
    }

    _saveSession(session) {
        try {
            fs.ensureDirSync(path.dirname(this.sessionPath));
            fs.writeJsonSync(this.sessionPath, session);
            this.session = session;
        } catch {}
    }

    _clearSession() {
        try {
            fs.removeSync(this.sessionPath);
            this.session = null;
        } catch {}
    }

    isAuthenticated() {
        return !!(this.session?.token);
    }

    getToken() {
        return this.session?.token || null;
    }

    getUser() {
        return this.session?.user || null;
    }

    // ─── HTTP helper ──────────────────────────────────────────────────────────

    _request(method, endpoint, body = null, headers = {}) {
        return new Promise((resolve, reject) => {
            const url      = new URL(this.apiUrl + endpoint);
            const isHttps  = url.protocol === 'https:';
            const lib      = isHttps ? https : http;

            const bodyStr  = body ? JSON.stringify(body) : null;

            const options = {
                hostname: url.hostname,
                port:     url.port || (isHttps ? 443 : 80),
                path:     url.pathname + url.search,
                method,
                headers: {
                    'Content-Type':  'application/json',
                    'Accept':        'application/json',
                    ...headers,
                    ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
                }
            };

            const req = lib.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            reject(new Error(parsed.error || parsed.message || `HTTP ${res.statusCode}`));
                        } else {
                            resolve(parsed);
                        }
                    } catch {
                        reject(new Error(`Invalid response: ${data}`));
                    }
                });
            });

            req.on('error', (err) => {
                if (err.code === 'ECONNREFUSED') {
                    reject(new Error(`Cannot connect to server at ${this.apiUrl} — is it running?`));
                } else {
                    reject(err);
                }
            });

            if (bodyStr) req.write(bodyStr);
            req.end();
        });
    }

    // ─── Auth API ─────────────────────────────────────────────────────────────

    async login(email, password) {
        // Your backend reads from headers
        const result = await this._request('POST', '/thinknsh/login', null, {
            'x-email':    email,
            'x-password': password,
            'x-machine-id': require('os').hostname()
        });

        // Save session
        this._saveSession({
            token: result.shellToken,
            user: {
                _id:   result._id,
                email: result.email,
                name:  result.name,
            },
            timestamp: new Date().toISOString()
        });

        return {
            token: result.shellToken,
            user: {
                _id:   result._id,
                email: result.email,
                name:  result.name,
            }
        };
    }

    async logout() {
        this._clearSession();
        return { success: true };
    }

    async whoami() {
        if (!this.isAuthenticated()) throw new Error('Not logged in');
        return this.getUser();
    }
}

module.exports = ThinkNCollabAPI;