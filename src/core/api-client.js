/**
 * ThinkNCollab API Client
 * Handles all communication with thinkncollab.com
 */

const axios = require('axios');
const { io } = require('socket.io-client');
const EventEmitter = require('events');

class ThinkNCollabAPI extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            apiUrl: config.apiUrl || 'http://localhost:3001',
            wsUrl: config.wsUrl || 'https://ws.thinkncollab.com',
            ...config
        };
        
        this.token = null;
        this.user = null;
        this.socket = null;
        this.currentRoom = null;
    }
    
// In src/core/api-client.js
// src/core/api-client.js
async login(email, password) {
    try {
        console.log(chalk.dim(`API call: ${this.config.apiUrl}/thinknsh/login`));
        
        const response = await axios.post(`${this.config.apiUrl}/thinknsh/login`, {
            email,
            password
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log(chalk.dim('API response:', response.data));
        
        if (response.data.shellToken) {
            this.token = response.data.shellToken;
            this.user = {
                email: response.data.email,
                name: response.data.name || email.split('@')[0]
            };
            
            // WebSocket connect
            this.connectWebSocket();
            
            return {
                success: true,
                user: this.user,
                token: this.token
            };
        }
        throw new Error(response.data.error || 'Login failed');
    } catch (error) {
        console.error(chalk.red('API error:'), error.message);
        throw new Error(error.response?.data?.error || error.message);
    }
}
    
    /**
     * Check if authenticated
     */
    isAuthenticated() {
        return !!this.token && !!this.user;
    }
    
    /**
     * Get current user
     */
    getUser() {
        return this.user;
    }
    
    /**
     * Get current room
     */
    getCurrentRoom() {
        return this.currentRoom;
    }
    
    /**
     * Connect WebSocket
     */
    connectWebSocket() {
        if (!this.token) return;
        
        this.socket = io(this.config.wsUrl, {
            transports: ['websocket'],
            query: { token: this.token }
        });
        
        this.socket.on('connect', () => {
            this.emit('connected', { socketId: this.socket.id });
        });
        
        this.socket.on('room:joined', (data) => {
            this.currentRoom = data.room;
            this.emit('roomJoined', data);
        });
        
        this.socket.on('message:new', (data) => {
            this.emit('message', data);
        });
        
        // ... other event handlers
    }
    
    /**
     * Join a room
     */
    async joinRoom(roomId, password = null) {
        return new Promise((resolve, reject) => {
            this.socket.emit('room:join', { roomId, password });
            
            this.socket.once('room:joined', (data) => {
                this.currentRoom = data.room;
                resolve(data);
            });
            
            this.socket.once('room:error', (data) => {
                reject(new Error(data.message));
            });
        });
    }
    
    /**
     * Leave current room
     */
    leaveRoom() {
        if (this.socket && this.currentRoom) {
            this.socket.emit('room:leave');
            this.currentRoom = null;
        }
    }
    
    /**
     * Send message
     */
    async sendMessage(message) {
        this.socket.emit('message:send', {
            message,
            timestamp: new Date().toISOString()
        });
    }
    
    /**
     * Get team info
     */
    async getTeamInfo(teamId) {
        try {
            const response = await axios.get(`${this.config.apiUrl}/teams/${teamId}`, {
                headers: { Authorization: `Bearer ${this.token}` }
            });
            return response.data;
        } catch (error) {
            throw new Error(error.response?.data?.error || error.message);
        }
    }
    
    /**
     * Logout
     */
    async logout() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        
        this.token = null;
        this.user = null;
        this.currentRoom = null;
        
        return { success: true };
    }
}

module.exports = ThinkNCollabAPI;