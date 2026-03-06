#!/usr/bin/env node
/**
 * ThinkNCollab — Notification Window
 * Spawned automatically by the main shell as a separate terminal process.
 * Connects to the main shell via TCP and displays live notifications.
 */

const net   = require('net');
const chalk = require('chalk');

const PORT = parseInt(process.env.THINKNSH_NOTIFY_PORT || '7379');
const HOST = '127.0.0.1';

// ── UI ────────────────────────────────────────────────────────────────────────

function clearScreen() { process.stdout.write('\x1Bc'); }

function drawHeader() {
    const width = process.stdout.columns || 80;
    const title = ' 🔔 ThinkNCollab — Live Notifications ';
    const line  = '━'.repeat(width);
    console.log(chalk.cyan(line));
    console.log(chalk.cyan.bold(title.padStart(Math.floor((width + title.length) / 2))));
    console.log(chalk.cyan(line));
    console.log(chalk.dim(`  Port: ${PORT}  |  Notifications will appear here in real time.`));
    console.log(chalk.dim('  Close this window or press Ctrl+C to stop.\n'));
}

function beep() {
    // Terminal bell — works on Windows CMD, macOS Terminal, Linux
    process.stdout.write('\x07');
}

function printNotification(data) {
    const timestamp = new Date().toLocaleTimeString();
    const ts        = chalk.dim(`[${timestamp}]`);

    switch (data.type) {
        case 'task_assigned':
            beep();
            console.log(`${ts} 📋 ${chalk.yellow('Task assigned →')} ${chalk.white(data.taskTitle)} ${chalk.dim('by')} ${chalk.cyan(data.assignedBy)}`);
            break;
        case 'task_started':
            console.log(`${ts} ⚡ ${chalk.green(data.userName)} started working on ${chalk.white(data.taskTitle)}`);
            break;
        case 'task_completed':
            beep();
            console.log(`${ts} ✅ ${chalk.green(data.userName)} completed ${chalk.white(data.taskTitle)}`);
            break;
        case 'message':
            beep();
            console.log(`${ts} 💬 ${chalk.cyan(data.from)}: ${data.text}`);
            break;
        case 'userJoined':
            console.log(`${ts} 👤 ${chalk.green(data.username)} joined`);
            break;
        case 'userLeft':
            console.log(`${ts} 👤 ${chalk.yellow(data.username)} left`);
            break;
        case 'connected':
            console.log(`${ts} ${chalk.green('✅ Shell connected')}`);
            break;
        case 'disconnected':
            console.log(`${ts} ${chalk.yellow('⚠️  Shell disconnected')}`);
            break;
        case 'notification': {
            beep();
            const colors = { success: chalk.green, warning: chalk.yellow, error: chalk.red, info: chalk.blue };
            const color  = colors[data.level] || chalk.blue;
            console.log(`${ts} 📢 ${color(`${data.title}: ${data.message}`)}`);
            break;
        }
        case 'typing':
            process.stdout.write(`\r${chalk.dim(`✏️  ${data.username} is typing...    `)}`);
            break;
        case 'stoppedTyping':
            process.stdout.write('\r' + ' '.repeat(40) + '\r');
            break;
        default:
            console.log(`${ts} ${chalk.white(JSON.stringify(data))}`);
    }
}

// ── TCP Client ────────────────────────────────────────────────────────────────

function connect() {
    clearScreen();
    drawHeader();
    console.log(chalk.dim(`  Connecting to shell on port ${PORT}...`));

    const client = new net.Socket();
    let buffer   = '';

    client.connect(PORT, HOST, () => {
        console.log(chalk.green('  ✅ Connected to shell!\n'));
    });

    client.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); 

        lines.forEach(line => {
            if (!line.trim()) return;
            try {
                const data = JSON.parse(line);
                printNotification(data);
            } catch {
                console.log(chalk.dim(line));
            }
        });
    });

    client.on('close', () => {
        console.log(chalk.yellow('\n  Shell disconnected. Retrying in 3s...'));
        setTimeout(connect, 3000);
    });

    client.on('error', (err) => {
        if (err.code === 'ECONNREFUSED') {
            console.log(chalk.dim(`  Waiting for shell on port ${PORT}...`));
        } else {
            console.log(chalk.dim(`  Connection error: ${err.message}`));
        }
        setTimeout(connect, 3000);
    });
}

// ── Ctrl+C ────────────────────────────────────────────────────────────────────
process.on('SIGINT', () => {
    console.log(chalk.yellow('\n  Notification window closed.'));
    process.exit(0);
});

connect();