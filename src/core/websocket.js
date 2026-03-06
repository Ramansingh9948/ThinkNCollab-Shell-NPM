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
        this.currentUser    = null;  // { userId, name, userType }
        this.roomId         = null;
        this.reconnectCount = 0;
        this.messageQueue   = [];
    }

    // ─── Connect ──────────────────────────────────────────────────────────────

    connect(authToken = null) {
        return new Promise((resolve, reject) => {
            try {
                // Connect to /thinknsh namespace — isolated from web
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
                    this._authToken     = authToken;

                    // Announce terminal to backend — join personal notification room
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
                    // Rejoin room after reconnect
                    if (this.roomId && this.currentUser) {
                        this._emitJoin(this.roomId);
                    }
                });

                this.setupEventHandlers(authToken);

            } catch (error) {
                reject(error);
            }
        });
    }

    // ─── thinknsh: event handlers ─────────────────────────────────────────────

    setupEventHandlers(authToken) {

        // Terminal ready confirmed by server
        this.socket.on('thinknsh:ready', (data) => {
            this.emit('ready', data);
        });

        // Room join confirmed
        this.socket.on('thinknsh:joined', (data) => {
            this.roomId = data.roomId;
            this.emit('roomJoined', data);
        });

        // Incoming message from terminal or web
        this.socket.on('thinknsh:message', (data) => {
            this.emit('message', {
                username:  data.name,
                userId:    data.userId,
                message:   data.message,
                source:    data.source || 'web',
                timestamp: data.timestamp,
            });
        });

        // Also listen to standard chat-message (from web users)
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

        // User joined from web
        this.socket.on('user-joined', (name) => {
            this.emit('userJoined', { username: name, source: 'web' });
        });

        // User left
        this.socket.on('user-left', (name) => {
            this.emit('userLeft', { username: name });
        });

        // User list updated
        this.socket.on('user-list', (users) => {
            this.emit('userList', { users });
        });

        // Notifications from NotificationEngine
        this.socket.on('new-notification', (notification) => {
            this.emit('notification', {
                type:    notification.type    || 'info',
                title:   notification.type    || 'Notification',
                message: notification.message || '',
                meta:    notification.meta    || {},
            });
        });

        // Terminal status (online/offline) — website sends this
        this.socket.on('thinknsh:status', (data) => {
            this.emit('shellStatus', data);
        });

        // ── new-notification from NotificationEngine → forward to TCP window ──
        this.socket.on('new-notification', (data) => {
            // This goes to shell.js pushNotification → TCP → notification window
            this.emit('notification', {
                type:    data.type    || 'notification',
                level:   data.type   || 'info',
                title:   data.type   || 'Notification',
                message: data.message || '',
                taskTitle:  data.taskTitle  || data.meta?.taskTitle  || '',
                assignedBy: data.assignedBy || data.meta?.assignedBy || '',
            });
        });

        // Notification list response
        this.socket.on('thinknsh:notifications', (data) => {
            this.emit('notificationList', data.notifications);
        });

        // Error from server
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
        // If already connected, announce now
        if (this.connected && this.socket) {
            this.socket.emit('thinknsh:connected', {
                userId:     user.userId,
                shellToken: token,
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

    // ─── Get unread notifications ─────────────────────────────────────────────

    getNotifications() {
        if (!this.connected || !this.currentUser) return;
        this.socket.emit('thinknsh:getNotifications', { userId: this.currentUser.userId });
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
            shellToken: this._token || null,
        });
    }

    sendTyping() {}  // add later if needed

    ping() {
        if (this.connected && this.socket) this.socket.emit('ping');
    }

    processPendingMessages() {
        if (this.messageQueue.length > 0 && this.roomId && this.currentUser) {
            this.messageQueue.forEach(msg => this.sendMessage(msg));
            this.messageQueue = [];
        }
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket      = null;
            this.connected   = false;
            this.currentUser = null;
            this.roomId      = null;
        }
    }

    isConnected()    { return this.connected && !!this.socket?.connected; }
    getCurrentRoom() { return this.roomId; }
    getSocketId()    { return this.socket?.id || null; }
    getParticipants() { return Promise.resolve([]); }
}

module.exports = WebSocketManager;