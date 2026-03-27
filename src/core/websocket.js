/**
 * src/core/websocket.js — WebSocket Manager for ThinkNCollab Shell
 */

const { io }   = require('socket.io-client');
const EventEmitter = require('events');

class WebSocketManager extends EventEmitter {

    constructor(config = {}) {
        super();
        this.config = {
            serverUrl:         config.serverUrl         || 'https://thinkncollab.com',
            reconnectAttempts: config.reconnectAttempts || 5,
            reconnectDelay:    config.reconnectDelay    || 1000,
            ...config
        };

        this.socket         = null;
        this.connected      = false;
        this.currentUser    = null;   // always { userId, name, userType }
        this.roomId         = null;
        this.reconnectCount = 0;
        this.messageQueue   = [];
        this._authToken     = null;
        this._handlersSetup = false;
        this._serverReady   = false;
    }

    // ─── Connect ──────────────────────────────────────────────────────────────

    connect(authToken = null) {
        return new Promise((resolve, reject) => {
            try {
                if (authToken) this._authToken = authToken;

                this.socket = io(this.config.serverUrl + '/thinknsh', {
                    transports:           ['websocket', 'polling'],
                    reconnection:         true,
                    reconnectionAttempts: this.config.reconnectAttempts,
                    reconnectionDelay:    this.config.reconnectDelay,
                    auth: this._authToken ? { token: this._authToken } : {},
                });

                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout'));
                }, 10000);

                this.socket.on('connect', () => {
                    clearTimeout(timeout);
                    this.connected      = true;
                    this.reconnectCount = 0;

                    // Announce user immediately on connect if we have one
                    if (this.currentUser) {
                        this._announceUser();
                    }

                    this.processPendingMessages();
                    this.emit('connected', { socketId: this.socket.id });
                    resolve({ success: true, socketId: this.socket.id });
                });

                this.socket.on('connect_error', (error) => {
                    clearTimeout(timeout);
                    if (this.reconnectCount === 0) {
                        reject(new Error(`Cannot connect to ${this.config.serverUrl}`));
                    }
                    this.reconnectCount++;
                    this.emit('error', { message: error.message });
                });

                this.socket.on('disconnect', (reason) => {
                    this.connected = false;
                    this.emit('disconnected', { reason });
                });

                this.socket.on('reconnect', () => {
                    this.connected = true;
                    this.emit('reconnected', {});

                    if (this.currentUser) this._announceUser();
                    if (this.roomId && this.currentUser) this._emitJoin(this.roomId);
                });

                if (!this._handlersSetup) {
                    this.setupEventHandlers();
                    this._handlersSetup = true;
                }

            } catch (error) {
                reject(error);
            }
        });
    }

    // ─── Announce user to server (thinknsh:connected) ─────────────────────────

    _announceUser() {
        if (!this.socket || !this.currentUser) return;
        this.socket.emit('thinknsh:connected', {
            userId:     this.currentUser.userId,
            userName:   this.currentUser.name,
            shellToken: this._authToken,
        });
    }

    // ─── Set user — called right after login ──────────────────────────────────

    /**
     * Accepts any of these shapes and normalises to { userId, name, userType }:
     *   { _id, userId, name, email, userType }   ← from api-client.getUser()
     *   { userId, name, userType }                ← legacy
     */
    setUser(user, token = null) {
        if (!user) return;

        if (token) this._authToken = token;

        // Normalise — support both _id and userId
        const id = (user.userId || user._id || '').toString();
        this.currentUser = {
            userId:   id,
            name:     user.name  || user.email || 'Unknown',
            userType: user.userType || user.model || user.role || 'User',
        };

        // If already connected, announce immediately
        if (this.connected && this.socket) {
            this._announceUser();
        }
    }

    // ─── Event Handlers ───────────────────────────────────────────────────────

    setupEventHandlers() {

        this.socket.on('thinknsh:ready', (data) => {
            this._serverReady = true;
            this.emit('ready', data);
        });

        this.socket.on('thinknsh:joined', (data) => {
            this.roomId = data.roomId;
            if (data.history?.length) this.emit('messageHistory', data.history);
            this.emit('roomJoined', data);
        });

        this.socket.on('thinknsh:message', (data) => {
            this.emit('message', {
                username:  data.name,
                userId:    data.userId,
                message:   data.message,
                source:    'shell',
                timestamp: data.timestamp,
            });
        });

        this.socket.on('chat-message', (data) => {
            this.emit('message', {
                username:  data.name,
                userId:    data.userId,
                message:   data.message,
                source:    data.source || 'web',
                timestamp: data.timestamp,
            });
        });

        this.socket.on('thinknsh:userJoined', (data) => {
            this.emit('userJoined', { username: data.name, source: 'shell' });
        });

        this.socket.on('thinknsh:userLeft', (data) => {
            this.emit('userLeft', { username: data.name, source: 'shell' });
        });

        this.socket.on('user-joined', (name) => {
            this.emit('userJoined', { username: name, source: 'web' });
        });

        this.socket.on('user-left', (name) => {
            this.emit('userLeft', { username: name, source: 'web' });
        });

        this.socket.on('user-list', (users) => {
            this.emit('userList', { users });
        });

        this.socket.on('thinknsh:history', (data) => {
            this.emit('messageHistory', data.messages?.length ? data.messages : []);
        });

        this.socket.on('new-notification', (data) => {
            this.emit('notification', {
                type:       data.type    || 'info',
                level:      data.type    || 'info',
                title:      data.title   || 'Notification',
                message:    data.message || '',
                meta:       data.meta    || {},
                taskTitle:  data.taskTitle  || data.meta?.taskTitle  || '',
                assignedBy: data.assignedBy || data.meta?.assignedBy || '',
            });
        });

        this.socket.on('room:activity', (data) => {
            this.emit('roomActivity', data);
        });

        this.socket.on('thinknsh:status', (data) => {
            this.emit('shellStatus', data);
        });

        this.socket.on('thinknsh:notifications', (data) => {
            this.emit('notificationList', data.notifications);
        });

        // Server errors — emit as 'serverError' so shell.js can handle separately
        this.socket.on('thinknsh:error', (data) => {
            this.emit('serverError', data);
        });

        this.socket.on('error', (data) => {
            this.emit('serverError', data);
        });
    }

    // ─── Join room ────────────────────────────────────────────────────────────

    joinRoom(roomId) {
        return new Promise((resolve, reject) => {
            if (!this.connected || !this.socket)
                return reject(new Error('Not connected to server'));
            if (!this.currentUser)
                return reject(new Error('Not logged in — run: login'));

            const timeout = setTimeout(() => {
                this.socket.off('thinknsh:joined', onJoined);
                this.socket.off('thinknsh:error',  onError);
                this.socket.off('thinknsh:ready',  onReady);
                reject(new Error('Join timeout'));
            }, 8000);

            const onJoined = (data) => {
                clearTimeout(timeout);
                this.socket.off('thinknsh:error', onError);
                this.roomId = data.roomId;
                resolve(data);
            };

            // onReady declared at top so onError can reference it regardless of branch
            let onReady = null;

            const onError = (data) => {
                clearTimeout(timeout);
                this.socket.off('thinknsh:joined', onJoined);
                if (onReady) this.socket.off('thinknsh:ready', onReady);
                reject(new Error(data.message || 'Join error'));
            };

            const doJoin = () => {
                this.socket.once('thinknsh:joined', onJoined);
                this.socket.once('thinknsh:error',  onError);
                this._emitJoin(roomId);
            };

            if (this._serverReady) {
                doJoin();
            } else {
                onReady = () => {
                    this._serverReady = true;
                    doJoin();
                };
                this.socket.once('thinknsh:ready', onReady);
            }
        });
    }

    _emitJoin(roomId) {
        if (!this.socket || !this.currentUser) return;
        this.socket.emit('thinknsh:join', {
            roomId,
            userId:   this.currentUser.userId,
            name:     this.currentUser.name,
            userType: this.currentUser.userType,
        });
    }

    // ─── Leave room ───────────────────────────────────────────────────────────

    leaveRoom() {
        if (this.socket && this.roomId) {
            this.socket.emit('leave-room', { roomId: this.roomId });
            this.roomId = null;
        }
        return Promise.resolve({ success: true });
    }

    // ─── Send message ─────────────────────────────────────────────────────────

    sendMessage(message) {
        if (!this.connected || !this.socket) {
            this.messageQueue.push(message);
            return Promise.resolve({ queued: true });
        }
        if (!this.roomId)      return Promise.reject(new Error('Not in a room — run: join <room-id>'));
        if (!this.currentUser) return Promise.reject(new Error('Not logged in — run: login'));

        this.socket.emit('thinknsh:message', {
            roomId:   this.roomId,
            userId:   this.currentUser.userId,
            name:     this.currentUser.name,
            userType: this.currentUser.userType,
            message,
        });

        return Promise.resolve({ success: true });
    }

    // ─── History ──────────────────────────────────────────────────────────────

    getHistory(limit = 30, skip = 0) {
        if (!this.connected || !this.socket || !this.roomId) return;
        this.socket.emit('thinknsh:getHistory', { roomId: this.roomId, limit, skip });
    }

    // ─── Notifications ────────────────────────────────────────────────────────

    getNotifications() {
        if (!this.connected || !this.currentUser) return;
        this.socket.emit('thinknsh:getNotifications', { userId: this.currentUser.userId });
    }

    sendNotification(notification, target = 'room') {
        if (!this.connected || !this.socket)
            return Promise.reject(new Error('Not connected'));

        this.socket.emit('notification:send', {
            type:      notification.type    || 'info',
            title:     notification.title   || 'Notification',
            message:   notification.message,
            data:      notification.data    || {},
            target:    target === 'room' ? this.roomId : target,
            timestamp: new Date().toISOString()
        });

        return Promise.resolve({ success: true });
    }

    markNotificationsRead(notificationIds = []) {
        if (!this.connected || !this.currentUser) return;
        this.socket.emit('thinknsh:markRead', {
            userId: this.currentUser.userId,
            notificationIds,
        });
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    processPendingMessages() {
        if (this.messageQueue.length && this.roomId && this.currentUser) {
            this.messageQueue.forEach(msg => this.sendMessage(msg));
            this.messageQueue = [];
        }
    }

    disconnect() {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
            this.socket         = null;
            this.connected      = false;
            this.currentUser    = null;
            this.roomId         = null;
            this._handlersSetup = false;
        this._serverReady   = false;
            this._serverReady   = false;
        }
    }

    isConnected()    { return this.connected && !!this.socket?.connected; }
    getCurrentRoom() { return this.roomId; }
    getSocketId()    { return this.socket?.id || null; }
    getParticipants(){ return Promise.resolve([]); }
    sendTyping()     {}
    ping()           { if (this.connected && this.socket) this.socket.emit('ping'); }
}

module.exports = WebSocketManager;