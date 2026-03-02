/**
 * Logger for ThinkNCollab Shell
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');

class Logger {
    constructor(options = {}) {
        this.options = {
            logDir: options.logDir || path.join(os.homedir(), '.thinkncollab', 'logs'),
            level: options.level || 'info',
            maxFiles: options.maxFiles || 5,
            maxSize: options.maxSize || 10 * 1024 * 1024, // 10MB
            ...options
        };
        
        // Ensure log directory exists
        fs.ensureDirSync(this.options.logDir);
        
        this.levels = {
            debug: 0,
            info: 1,
            warn: 2,
            error: 3
        };
        
        this.currentLogFile = this.getLogFileName();
    }
    
    /**
     * Get log file name
     */
    getLogFileName() {
        const date = new Date().toISOString().split('T')[0];
        return path.join(this.options.logDir, `thinknsh-${date}.log`);
    }
    
    /**
     * Write to log file
     */
    async write(level, message, data = null) {
        if (this.levels[level] < this.levels[this.options.level]) {
            return;
        }
        
        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            data,
            pid: process.pid
        };
        
        const logLine = JSON.stringify(logEntry) + '\n';
        
        try {
            await fs.appendFile(this.currentLogFile, logLine);
            await this.rotateIfNeeded();
        } catch (error) {
            console.error('Failed to write log:', error);
        }
    }
    
    /**
     * Rotate log files if needed
     */
    async rotateIfNeeded() {
        try {
            const stat = await fs.stat(this.currentLogFile);
            
            if (stat.size > this.options.maxSize) {
                // Rename current file
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const rotatedFile = this.currentLogFile.replace('.log', `-${timestamp}.log`);
                await fs.rename(this.currentLogFile, rotatedFile);
                
                // Create new log file
                this.currentLogFile = this.getLogFileName();
                
                // Clean up old files
                await this.cleanOldLogs();
            }
        } catch (error) {
            // File might not exist yet
        }
    }
    
    /**
     * Clean old log files
     */
    async cleanOldLogs() {
        try {
            const files = await fs.readdir(this.options.logDir);
            const logFiles = files
                .filter(f => f.startsWith('thinknsh-') && f.endsWith('.log'))
                .map(f => ({
                    name: f,
                    path: path.join(this.options.logDir, f),
                    time: fs.statSync(path.join(this.options.logDir, f)).mtime.getTime()
                }))
                .sort((a, b) => b.time - a.time);
            
            // Keep only maxFiles most recent
            if (logFiles.length > this.options.maxFiles) {
                const toDelete = logFiles.slice(this.options.maxFiles);
                for (const file of toDelete) {
                    await fs.remove(file.path);
                }
            }
        } catch (error) {
            console.error('Failed to clean old logs:', error);
        }
    }
    
    /**
     * Debug log
     */
    debug(message, data = null) {
        return this.write('debug', message, data);
    }
    
    /**
     * Info log
     */
    info(message, data = null) {
        return this.write('info', message, data);
    }
    
    /**
     * Warn log
     */
    warn(message, data = null) {
        return this.write('warn', message, data);
    }
    
    /**
     * Error log
     */
    error(message, data = null) {
        return this.write('error', message, data);
    }
    
    /**
     * Get recent logs
     */
    async getRecentLogs(lines = 100) {
        try {
            if (!await fs.pathExists(this.currentLogFile)) {
                return [];
            }
            
            const content = await fs.readFile(this.currentLogFile, 'utf8');
            const logs = content
                .split('\n')
                .filter(line => line.trim())
                .map(line => JSON.parse(line))
                .slice(-lines);
            
            return logs;
        } catch (error) {
            console.error('Failed to read logs:', error);
            return [];
        }
    }
}

module.exports = Logger;