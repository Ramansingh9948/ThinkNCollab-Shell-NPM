/**
 * WebSocket Manager for ThinkNCollab Shell
 * Uses thinknsh: prefixed events for terminal-specific communication
 */

const { io } = require('socket.io-client');
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
        this.currentUser    = null;
        this.roomId         = null;
        this.reconnectCount = 0;
        this.messageQueue   = [];
        this._authToken     = null;
        this._handlersSetup = false;
    }

    // ─── Connect ──────────────────────────────────────────────────────────────

    connect(authToken = null) {
        return new Promise((resolve, reject) => {
            try {
                this._authToken = authToken;

                this.socket = io(this.config.serverUrl + '/thinknsh', {
                    transports:           ['websocket', 'polling'],
                    reconnection:         true,
                    reconnectionAttempts: this.config.reconnectAttempts,
                    reconnectionDelay:    this.config.reconnectDelay,
                    auth: authToken ? { token: authToken } : {},
                });

                const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);

                this.socket.on('connect', () => {
                    clearTimeout(timeout);
                    this.connected      = true;
                    this.reconnectCount = 0;

                    if (this.currentUser) {
                        console.log('🖥️  Emitting thinknsh:connected for', this.currentUser.userId);
                        this.socket.emit('thinknsh:connected', {
                            userId:     this.currentUser.userId,
                            userName:   this.currentUser.name,
                            shellToken: authToken,
                        });
                    }

                    this.processPendingMessages();
                    this.emit('connected', { socketId: this.socket.id });
                    resolve({ success: true, socketId: this.socket.id });
                });
                // One-time listener for confirmation
// this.ws.once('notified', (data) => {
//     console.log(chalk.green(`✅ Notification sent to ${data.sentTo} member(s) in "${data.roomName}"`));
// });

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

                this.socket.on('reconnect', (attemptNumber) => {
                    this.connected = true;
                    this.emit('reconnected', { attemptNumber });

                    // Re-announce user after reconnect
                    if (this.currentUser) {
                        this.socket.emit('thinknsh:connected', {
                            userId:     this.currentUser.userId,
                            userName:   this.currentUser.name,
                            shellToken: this._authToken,
                        });
                    }

                    // Rejoin room after reconnect
                    if (this.roomId && this.currentUser) {
                        this._emitJoin(this.roomId);
                    }
                });

                // ✅ Setup handlers only ONCE per socket instance
                if (!this._handlersSetup) {
                    this.setupEventHandlers();
                    this._handlersSetup = true;
                }

            } catch (error) {
                reject(error);
            }
        });
    }

    // ─── Event Handlers (registered once) ────────────────────────────────────

    setupEventHandlers() {

        // Terminal ready confirmed by server
        this.socket.on('thinknsh:ready', (data) => {
            this.emit('ready', data);
        });

        // ✅ Room join confirmed + history delivered
        this.socket.on('thinknsh:joined', (data) => {
            this.roomId = data.roomId;

            // Emit history separately so shell.js can display it
            if (data.history && data.history.length > 0) {
                this.emit('messageHistory', data.history);
            }

            this.emit('roomJoined', data);
        });

        // Incoming message from terminal users
        this.socket.on('thinknsh:message', (data) => {
            this.emit('message', {
                username:  data.name,
                userId:    data.userId,
                message:   data.message,
                source:    data.source || 'shell',
                timestamp: data.timestamp,
            });
        });

        // Incoming message from web users
        this.socket.on('chat-message', (data) => {
            this.emit('message', {
                username:  data.name,
                userId:    data.userId,
                message:   data.message,
                source:    data.source || 'web',
                timestamp: data.timestamp,
            });
        });

        // User joined from terminal
        this.socket.on('thinknsh:userJoined', (data) => {
            this.emit('userJoined', { username: data.name, source: 'shell' });
        });

        // ✅ User left from terminal
        this.socket.on('thinknsh:userLeft', (data) => {
            this.emit('userLeft', { username: data.name, source: 'shell' });
        });

        // User joined from web
        this.socket.on('user-joined', (name) => {
            this.emit('userJoined', { username: name, source: 'web' });
        });

        // User left from web
        this.socket.on('user-left', (name) => {
            this.emit('userLeft', { username: name, source: 'web' });
        });

        // User list updated
        this.socket.on('user-list', (users) => {
            this.emit('userList', { users });
        });

        // ✅ Manual history fetch response
        this.socket.on('thinknsh:history', (data) => {
            if (data.messages && data.messages.length > 0) {
                this.emit('messageHistory', data.messages);
            } else {
                this.emit('messageHistory', []);
            }
        });

        // Single new-notification listener
        this.socket.on('new-notification', (data) => {
            this.emit('notification', {
                type:       data.type       || 'notification',
                level:      data.type       || 'info',
                title:      data.type       || 'Notification',
                message:    data.message    || '',
                meta:       data.meta       || {},
                taskTitle:  data.taskTitle  || data.meta?.taskTitle  || '',
                assignedBy: data.assignedBy || data.meta?.assignedBy || '',
            });
        });

        // Room activity feed
        this.socket.on('room:activity', (data) => {
            this.emit('roomActivity', {
                action:    data.action,
                label:     data.label,
                userName:  data.userName,
                meta:      data.meta      || {},
                createdAt: data.createdAt || new Date(),
            });
        });

        // Terminal status (online/offline)
        this.socket.on('thinknsh:status', (data) => {
            this.emit('shellStatus', data);
        });

        // Notification list response
        this.socket.on('thinknsh:notifications', (data) => {
            this.emit('notificationList', data.notifications);
        });

        // Server errors
        this.socket.on('thinknsh:error', (data) => {
            this.emit('serverError', data);
        });

        this.socket.on('error', (data) => {
            this.emit('serverError', data);
        });
    }

    // ─── Set user (call after login) ──────────────────────────────────────────

    setUser(user, token = null) {
        this.currentUser = user;
        if (token) this._authToken = token;

        if (this.connected && this.socket) {
            this.socket.emit('thinknsh:connected', {
                userId:     user.userId,
                userName:   user.name,
                shellToken: token || this._authToken,
            });
        }
    }

    // ─── Join room ────────────────────────────────────────────────────────────

    joinRoom(roomId) {
        return new Promise((resolve, reject) => {
            if (!this.connected || !this.socket) return reject(new Error('Not connected'));
            if (!this.currentUser)               return reject(new Error('Not logged in'));

            const timeout = setTimeout(() => reject(new Error('Join timeout')), 5000);

            this.socket.once('thinknsh:joined', (data) => {
                clearTimeout(timeout);
                this.roomId = data.roomId;
                resolve(data);
            });

            this._emitJoin(roomId);
        });
    }

    _emitJoin(roomId) {
        this.socket.emit('thinknsh:join', {
            roomId,
            userId:   this.currentUser.userId,
            name:     this.currentUser.name,
            userType: this.currentUser.userType || 'User',
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
            userType: this.currentUser.userType || 'User',
            message,
        });

        return Promise.resolve({ success: true });
    }

    // ─── Fetch message history manually ──────────────────────────────────────

    getHistory(limit = 30, skip = 0) {
        if (!this.connected || !this.socket) return;
        if (!this.roomId) return;

        this.socket.emit('thinknsh:getHistory', {
            roomId: this.roomId,
            limit,
            skip,
        });
    }

    // ─── Notifications ────────────────────────────────────────────────────────

    getNotifications() {
        if (!this.connected || !this.currentUser) return;
        this.socket.emit('thinknsh:getNotifications', {
            userId: this.currentUser.userId
        });
    }

    // ─── Send notification ────────────────────────────────────────────────────

sendNotification(notification, target = 'room') {
    if (!this.connected || !this.socket) {
        return Promise.reject(new Error('Not connected'));
    }

    const payload = {
        type:      notification.type    || 'info',
        title:     notification.title   || 'Notification',
        message:   notification.message,
        data:      notification.data    || {},
        target:    target === 'room' ? this.roomId : target,
        timestamp: new Date().toISOString()
    };

    this.socket.emit('notification:send', payload);
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

    joinUserRoom(userId) {
        if (!this.socket || !userId) return;
        this.socket.emit('thinknsh:connected', {
            userId,
            userName:   this.currentUser?.name || '',
            shellToken: this._authToken || null,
        });
    }

    ping() {
        if (this.connected && this.socket) this.socket.emit('ping');
    }

    processPendingMessages() {
        if (this.messageQueue.length > 0 && this.roomId && this.currentUser) {
            this.messageQueue.forEach(msg => this.sendMessage(msg));
            this.messageQueue = [];
        }
    }

    sendTyping() {} // add later if needed

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket         = null;
            this.connected      = false;
            this.currentUser    = null;
            this.roomId         = null;
            this._handlersSetup = false;
        }
    }

    isConnected()     { return this.connected && !!this.socket?.connected; }
    getCurrentRoom()  { return this.roomId; }
    getSocketId()     { return this.socket?.id || null; }
    getParticipants() { return Promise.resolve([]); }
}

module.exports = WebSocketManager;