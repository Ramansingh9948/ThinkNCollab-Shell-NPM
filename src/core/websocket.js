/**
 * WebSocket Manager for ThinkNCollab Shell
 * Handles all real-time communication
 */

const { io } = require('socket.io-client');
const EventEmitter = require('events');

class WebSocketManager extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            serverUrl: config.serverUrl || 'https://api.thinkncollab.com',
            reconnectAttempts: config.reconnectAttempts || 5,
            reconnectDelay: config.reconnectDelay || 1000,
            autoConnect: config.autoConnect || false,
            ...config
        };
        
        this.socket = null;
        this.connected = false;
        this.userId = null;
        this.roomId = null;
        this.reconnectCount = 0;
        this.pendingMessages = [];
        this.messageQueue = [];
        
        // Bind methods
        this.connect = this.connect.bind(this);
        this.disconnect = this.disconnect.bind(this);
        this.joinRoom = this.joinRoom.bind(this);
        this.leaveRoom = this.leaveRoom.bind(this);
        this.sendMessage = this.sendMessage.bind(this);
        this.sendNotification = this.sendNotification.bind(this);
    }
    
    /**
     * Connect to WebSocket server
     */
    connect(authToken = null) {
        return new Promise((resolve, reject) => {
            try {
                const options = {
                    transports: ['websocket', 'polling'],
                    reconnection: true,
                    reconnectionAttempts: this.config.reconnectAttempts,
                    reconnectionDelay: this.config.reconnectDelay,
                    query: {}
                };
                
                if (authToken) {
                    options.query.token = authToken;
                }
                
                this.socket = io(this.config.serverUrl, options);
                
                // Connection established
                this.socket.on('connect', () => {
                    this.connected = true;
                    this.reconnectCount = 0;
                    this.userId = this.socket.id;
                    
                    // Process any pending messages
                    this.processPendingMessages();
                    
                    this.emit('connected', { socketId: this.socket.id });
                    resolve({ success: true, socketId: this.socket.id });
                });
                
                // Connection error
                this.socket.on('connect_error', (error) => {
                    this.emit('error', { type: 'connection', error: error.message });
                    
                    if (this.reconnectCount >= this.config.reconnectAttempts) {
                        reject(new Error(`Failed to connect after ${this.config.reconnectAttempts} attempts`));
                    }
                    this.reconnectCount++;
                });
                
                // Disconnection
                this.socket.on('disconnect', (reason) => {
                    this.connected = false;
                    this.emit('disconnected', { reason });
                    
                    if (reason === 'io server disconnect') {
                        // Server disconnected, don't reconnect
                        this.socket = null;
                    }
                });
                
                // Reconnection
                this.socket.on('reconnect', (attemptNumber) => {
                    this.connected = true;
                    this.emit('reconnected', { attemptNumber });
                    
                    // Rejoin room if we were in one
                    if (this.roomId) {
                        this.joinRoom(this.roomId);
                    }
                });
                
                // Custom event handlers
                this.setupEventHandlers();
                
            } catch (error) {
                reject(error);
            }
        });
    }
    
    /**
     * Setup custom event handlers
     */
    setupEventHandlers() {
        // Room events
        this.socket.on('room:joined', (data) => {
            this.roomId = data.roomId;
            this.emit('roomJoined', data);
        });
        
        this.socket.on('room:left', (data) => {
            this.roomId = null;
            this.emit('roomLeft', data);
        });
        
        this.socket.on('room:participants', (data) => {
            this.emit('roomParticipants', data);
        });
        
        // Message events
        this.socket.on('message:new', (data) => {
            this.emit('message', data);
        });
        
        this.socket.on('message:history', (data) => {
            this.emit('messageHistory', data);
        });
        
        // User events
        this.socket.on('user:joined', (data) => {
            this.emit('userJoined', data);
        });
        
        this.socket.on('user:left', (data) => {
            this.emit('userLeft', data);
        });
        
        this.socket.on('user:typing', (data) => {
            this.emit('userTyping', data);
        });
        
        // Notification events
        this.socket.on('notification', (data) => {
            this.emit('notification', data);
        });
        
        // Terminal sharing events
        this.socket.on('terminal:output', (data) => {
            this.emit('terminalOutput', data);
        });
        
        this.socket.on('terminal:command', (data) => {
            this.emit('terminalCommand', data);
        });
        
        // Error events
        this.socket.on('error', (data) => {
            this.emit('serverError', data);
        });
    }
    
    /**
     * Disconnect from WebSocket server
     */
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.connected = false;
            this.userId = null;
            this.roomId = null;
            this.emit('disconnected', { reason: 'manual' });
        }
    }
    
    /**
     * Join a collaboration room
     */
    joinRoom(roomId, password = null) {
        return new Promise((resolve, reject) => {
            if (!this.connected || !this.socket) {
                reject(new Error('WebSocket not connected'));
                return;
            }
            
            const payload = { roomId };
            if (password) payload.password = password;
            
            this.socket.emit('room:join', payload);
            
            // Wait for response
            const timeout = setTimeout(() => {
                reject(new Error('Join room timeout'));
            }, 5000);
            
            this.socket.once('room:joined', (data) => {
                clearTimeout(timeout);
                this.roomId = data.roomId;
                resolve(data);
            });
            
            this.socket.once('room:error', (data) => {
                clearTimeout(timeout);
                reject(new Error(data.message));
            });
        });
    }
    
    /**
     * Leave current room
     */
    leaveRoom() {
        if (!this.connected || !this.socket || !this.roomId) {
            return Promise.reject(new Error('Not in a room'));
        }
        
        return new Promise((resolve) => {
            this.socket.emit('room:leave', { roomId: this.roomId });
            this.roomId = null;
            resolve({ success: true });
        });
    }
    
    /**
     * Send message to current room
     */
    sendMessage(message, type = 'text') {
        if (!this.connected || !this.socket) {
            // Queue message for later
            this.messageQueue.push({ message, type });
            return Promise.resolve({ queued: true });
        }
        
        if (!this.roomId) {
            return Promise.reject(new Error('Not in a room'));
        }
        
        return new Promise((resolve) => {
            const payload = {
                roomId: this.roomId,
                message,
                type,
                timestamp: new Date().toISOString()
            };
            
            this.socket.emit('message:send', payload);
            resolve({ success: true, id: `msg_${Date.now()}` });
        });
    }
    
    /**
     * Send notification to room/users
     */
    sendNotification(notification, target = 'room') {
        if (!this.connected || !this.socket) {
            return Promise.reject(new Error('WebSocket not connected'));
        }
        
        const payload = {
            type: notification.type || 'info',
            title: notification.title,
            message: notification.message,
            data: notification.data,
            target: target === 'room' ? this.roomId : target,
            timestamp: new Date().toISOString()
        };
        
        this.socket.emit('notification:send', payload);
        
        return Promise.resolve({ success: true });
    }
    
    /**
     * Share terminal output with room
     */
    shareTerminalOutput(command, output) {
        if (!this.connected || !this.socket || !this.roomId) {
            return;
        }
        
        this.socket.emit('terminal:share', {
            roomId: this.roomId,
            command,
            output,
            timestamp: new Date().toISOString()
        });
    }
    
    /**
     * Send typing indicator
     */
    sendTyping(isTyping = true) {
        if (!this.connected || !this.socket || !this.roomId) {
            return;
        }
        
        this.socket.emit('user:typing', {
            roomId: this.roomId,
            isTyping
        });
    }
    
    /**
     * Get room participants
     */
    getParticipants() {
        if (!this.connected || !this.socket || !this.roomId) {
            return Promise.reject(new Error('Not connected to a room'));
        }
        
        return new Promise((resolve) => {
            this.socket.emit('room:getParticipants', { roomId: this.roomId });
            
            this.socket.once('room:participants', (data) => {
                resolve(data.participants);
            });
        });
    }
    
    /**
     * Get message history
     */
    getMessageHistory(limit = 50) {
        if (!this.connected || !this.socket || !this.roomId) {
            return Promise.reject(new Error('Not connected to a room'));
        }
        
        return new Promise((resolve) => {
            this.socket.emit('message:getHistory', {
                roomId: this.roomId,
                limit
            });
            
            this.socket.once('message:history', (data) => {
                resolve(data.messages);
            });
        });
    }
    
    /**
     * Process pending messages after reconnection
     */
    processPendingMessages() {
        if (this.messageQueue.length > 0) {
            this.messageQueue.forEach(item => {
                this.sendMessage(item.message, item.type);
            });
            this.messageQueue = [];
        }
    }
    
    /**
     * Check connection status
     */
    isConnected() {
        return this.connected && this.socket && this.socket.connected;
    }
    
    /**
     * Get current room info
     */
    getCurrentRoom() {
        return this.roomId;
    }
    
    /**
     * Get socket ID
     */
    getSocketId() {
        return this.userId;
    }
}

module.exports = WebSocketManager;