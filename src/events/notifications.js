/*
  Notification System for ThinkNCollab Shell
 */

const EventEmitter = require('events');
const chalk = require('chalk');

class NotificationManager extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.options = {
            sound: options.sound || false,
            desktop: options.desktop || false,
            ...options
        };
        
        this.notifications = [];
        this.maxNotifications = 100;
        this.unreadCount = 0;
    }
    
    /* Show a notification
     */
    show(notification) {
        const notif = {
            id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: notification.type || 'info',
            title: notification.title || 'Notification',
            message: notification.message,
            timestamp: new Date(),
            read: false,
            data: notification.data || {}
        };
        
        this.notifications.unshift(notif);
        this.unreadCount++;
        
        // Trim old notifications
        if (this.notifications.length > this.maxNotifications) {
            this.notifications.pop();
        }
        
        // Emit event
        this.emit('notification', notif);
        
        // Show in console
        this.showInConsole(notif);
        
        // Desktop notification
        if (this.options.desktop) {
            this.showDesktopNotification(notif);
        }
        
        // Sound
        if (this.options.sound) {
            this.playSound();
        }
        
        return notif;
    }
    
    /* Show notification in console
     */
    showInConsole(notification) {
        let color = chalk.blue;
        let symbol = 'ℹ';
        
        switch (notification.type) {
            case 'success':
                color = chalk.green;
                symbol = '✓';
                break;
            case 'warning':
                color = chalk.yellow;
                symbol = '⚠';
                break;
            case 'error':
                color = chalk.red;
                symbol = '✗';
                break;
            case 'info':
            default:
                color = chalk.blue;
                symbol = 'ℹ';
                break;
        }
        
        console.log(color(`${symbol} ${notification.title}: ${notification.message}`));
    }
    
    /* Show desktop notification (if supported)
     */
    showDesktopNotification(notification) {
        // Check if running in Electron
        if (process.type === 'renderer' || process.type === 'browser') {
            try {
                const { Notification } = require('electron');
                new Notification({
                    title: notification.title,
                    body: notification.message,
                    silent: !this.options.sound
                }).show();
            } catch (error) {
                // Electron not available
            }
        }
    }
    
    /* Play notification sound
     */
    playSound() {
        // TODO: Implement sound playing
        // This would use 'sound-play' or similar package
    }
    
    /* Mark notification as read
     */
    markAsRead(id) {
        const notif = this.notifications.find(n => n.id === id);
        if (notif && !notif.read) {
            notif.read = true;
            this.unreadCount--;
            this.emit('read', notif);
        }
    }
    
    /* Mark all as read
     */
    markAllAsRead() {
        this.notifications.forEach(n => {
            if (!n.read) {
                n.read = true;
            }
        });
        this.unreadCount = 0;
        this.emit('allRead');
    }
    
    /* Get unread notifications
     */
    getUnread() {
        return this.notifications.filter(n => !n.read);
    }
    
    /* Get all notifications
     */
    getAll() {
        return this.notifications;
    }
    
    /* Clear all notifications
     */
    clear() {
        this.notifications = [];
        this.unreadCount = 0;
        this.emit('cleared');
    }
    
    /* Create success notification
     */
    success(title, message, data = {}) {
        return this.show({ type: 'success', title, message, data });
    }
    
    /* Create error notification
     */
    error(title, message, data = {}) {
        return this.show({ type: 'error', title, message, data });
    }
    
    /* Create warning notification
     */
    warning(title, message, data = {}) {
        return this.show({ type: 'warning', title, message, data });
    }
    
    /* Create info notification
     */
    info(title, message, data = {}) {
        return this.show({ type: 'info', title, message, data });
    }
}

module.exports = NotificationManager;