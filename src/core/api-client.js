/**
 * src/core/api-client.js
 */

const https = require('https');
const http  = require('http');
const path  = require('path');
const fs    = require('fs-extra');
const os    = require('os');

class ThinkNCollabAPI {

    constructor(options = {}) { 
        this.apiUrl      = (options.apiUrl || 'https://thinkncollab.com').replace(/\/$/, '');
        this.wsUrl       = (options.wsUrl  || 'https://thinkncollab.com').replace(/\/$/, '');
        this.session     = null;
        this.sessionPath = path.join(os.homedir(), '.thinkncollab', 'session.json');
        this._loadSession();
    }

    // ─── Session ──────────────────────────────────────────────────────────────

    _loadSession() {
        try {
            if (fs.existsSync(this.sessionPath))
                this.session = fs.readJsonSync(this.sessionPath);
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
        try { fs.removeSync(this.sessionPath); } catch {}
        this.session = null;
    }

    isAuthenticated() { return !!(this.session?.token); }
    getToken()        { return this.session?.token || null; }

    /*
      Returns user in a CONSISTENT shape used everywhere:
        { _id, userId, email, name, userType }
     
      Both _id and userId are the same string so callers can use either.
    */
    getUser() {
        const u = this.session?.user;
        if (!u) return null;
        const id = (u._id || u.userId || '').toString();
        return {
            _id:      id,
            userId:   id,           // ws.setUser / _emitJoin use userId
            email:    u.email  || '',
            name:     u.name   || '',
            userType: u.userType || u.model || 'User',
        };
    }

    // ─── HTTP helper ──────────────────────────────────────────────────────────

    _request(method, endpoint, body = null, headers = {}) {
        return new Promise((resolve, reject) => {
            const url     = new URL(this.apiUrl + endpoint);
            const isHttps = url.protocol === 'https:';
            const lib     = isHttps ? https : http;
            const bodyStr = body ? JSON.stringify(body) : null;

            const options = {
                hostname: url.hostname,
                port:     url.port || (isHttps ? 443 : 80),
                path:     url.pathname + url.search,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept':       'application/json',
                    ...(this.session?.token ? { 'x-shell-token': this.session.token } : {}),
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
                        if (res.statusCode >= 400)
                            reject(new Error(parsed.error || parsed.message || `HTTP ${res.statusCode}`));
                        else
                            resolve(parsed);
                    } catch {
                        reject(new Error(`Invalid response: ${data.slice(0, 100)}`));
                    }
                });
            });

            req.on('error', (err) => {
                if (err.code === 'ECONNREFUSED')
                    reject(new Error(`Cannot connect to server at ${this.apiUrl} — is it running?`));
                else
                    reject(err);
            });

            if (bodyStr) req.write(bodyStr);
            req.end();
        });
    }

    // ─── Auth ─────────────────────────────────────────────────────────────────

async login(email, password) {
    const result = await this._request('POST', '/thinknsh/login', null, {
        'x-email':      email,
        'x-password':   password,
        'x-machine-id': os.hostname()
    });

    this._saveSession({
        token:          result.shellToken,
        shellSessionId: result.shellSessionId,  
        user: {
            _id:      result._id,
            userId:   result._id,
            email:    result.email,
            name:     result.name,
            userType: result.userType || result.model || 'User',
        },
        timestamp: new Date().toISOString()
    });

    return {
        token: result.shellToken,
        user:  this.getUser()
    };
}

// ─── Session event logger ─────────────────────────────────────────────────

async logEvent(type, roomId = null, meta = {}) {
    const sessionId = this.session?.shellSessionId;
    if (!sessionId) return;
    await this._request('POST', '/thinknsh/session/event', {
        sessionId, type, roomId, meta
    }).catch(() => {}); // silently fail — never block shell
}

// ─── Heartbeat — keeps lastSeenAt fresh while shell is open ──────────────

startHeartbeat(intervalMs = 60000) {
    if (this._heartbeatTimer) return; // already running
    this._heartbeatTimer = setInterval(() => {
        const sessionId = this.session?.shellSessionId;
        if (!sessionId) return;
        this._request('POST', '/thinknsh/session/event', {
            sessionId,
            type: 'heartbeat',
            meta: { ts: new Date().toISOString() }
        }).catch(() => {});
    }, intervalMs);
}

stopHeartbeat() {
    if (this._heartbeatTimer) {
        clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = null;
    }
}

async logout() {
    const sessionId = this.session?.shellSessionId;
    if (sessionId) {
        await this._request('POST', '/thinknsh/session/end', { sessionId }).catch(() => {});
    }
    this.stopHeartbeat();
    this._clearSession();
    return { success: true };
}
    async whoami() {
        if (!this.isAuthenticated()) throw new Error('Not logged in');
        return this.getUser();
    }

    // ─── Rooms ────────────────────────────────────────────────────────────────

    /**
     * joinRoom — validates membership server-side and returns room meta.
     * Called by commands/room/join.js BEFORE the WebSocket thinknsh:join emit.
     */
    async joinRoom(roomId, password) {
        if (!roomId) throw new Error('roomId is required');

        const result = await this._request('POST', `/thinknsh/rooms/${roomId}/join`,
            password ? { password } : null
        );

        // Normalise response — server may return different shapes
        return {
            room: result.room || result,
            participants: result.participants || result.members || [],
            recentMessages: result.recentMessages || result.history || [],
        };
    }

    /**
     * getRooms — list rooms the user belongs to
     */
    async getRooms() {
        return this._request('GET', '/thinknsh/rooms');
    }

    // ─── Tasks ────────────────────────────────────────────────────────────────

    async mytasks(roomId, limit) {
        if (!roomId) throw new Error('roomId is required');
        const user = this.getUser();
        let ep = `/thinknsh/tasks?roomId=${encodeURIComponent(roomId)}`;
        if (user?._id) ep += `&userId=${encodeURIComponent(user._id)}`;
        if (limit)     ep += `&n=${limit}`;
        return this._request('GET', ep);
    }

    /**
     * Generic request wrapper for task command modules that call
     * shell.api.request(method, path, { params, body })
     */
    async request(method, endpoint, options = {}) {
        let ep = endpoint;

        // Append query params
        if (options.params && Object.keys(options.params).length) {
            const qs = new URLSearchParams(options.params).toString();
            ep += (ep.includes('?') ? '&' : '?') + qs;
        }

        return this._request(method.toUpperCase(), ep, options.body || null);
    }
}

module.exports = ThinkNCollabAPI;