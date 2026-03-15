/**
 * commands/terminal/share.js
 *
 * Usage:
 *   share start       — start sharing current terminal
 *   share stop        — stop sharing
 *   share status      — show who's viewing / requesting
 *   share grant <uid> — grant write to a viewer
 *   share revoke <uid>— revoke write
 *   share kick <uid>  — kick a viewer
 */

const chalk = require('chalk');

module.exports = {
    name:         'share',
    description:  'Share your terminal with room members',
    aliases:      ['terminal-share', 'ts'],
    requiresAuth: true,
    requiresRoom: true,

    async execute(args, shell) {
        const sub = (args[0] || '').toLowerCase();

        switch (sub) {
            case 'start':  return cmdStart(shell);
            case 'stop':   return cmdStop(shell);
            case 'status': return cmdStatus(shell);
            case 'grant':  return cmdGrant(args[1], shell);
            case 'revoke': return cmdRevoke(args[1], shell);
            case 'kick':   return cmdKick(args[1], shell);
            default:
                printHelp();
        }
    }
};

// ── start ─────────────────────────────────────────────────────────────────────
async function cmdStart(shell) {
    if (shell._shareActive) {
        console.log(chalk.yellow('⚠️  Already sharing. Run "share stop" first.'));
        return;
    }

    const roomId = shell.ws.getCurrentRoom();
    if (!roomId) {
        console.log(chalk.red('❌ Join a room first: join <room-id>'));
        return;
    }

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            shell.ws.socket.off('terminal:share:started', onStarted);
            console.log(chalk.red('❌ Share start timeout'));
            resolve();
        }, 6000);

        function onStarted(data) {
            clearTimeout(timeout);
            shell._shareActive    = true;
            shell._shareSessionId = data.sessionId;

            console.log(chalk.green(`\n✅ Terminal sharing started`));
            console.log(chalk.dim(`   Session : ${data.sessionId}`));
            console.log(chalk.dim(`   Room    : ${roomId}`));
            console.log(chalk.dim(`   URL     : /terminal/${data.sessionId}`));
            console.log(chalk.dim(`\n   Room members can now view your terminal.`));
            console.log(chalk.dim(`   Use "share grant <userId>" to give write access.\n`));

            // Hook into shell output to stream it
            _hookOutput(shell, data.sessionId);

            resolve();
        }

        shell.ws.socket.once('terminal:share:started', onStarted);
        shell.ws.socket.emit('terminal:share:start', { roomId });
    });
}

// ── stop ──────────────────────────────────────────────────────────────────────
async function cmdStop(shell) {
    if (!shell._shareActive) {
        console.log(chalk.yellow('⚠️  No active share session.'));
        return;
    }

    shell.ws.socket.emit('terminal:share:stop');
    _unhookOutput(shell);
    shell._shareActive    = false;
    shell._shareSessionId = null;
    console.log(chalk.green('✅ Terminal sharing stopped.'));
}

// ── status ────────────────────────────────────────────────────────────────────
async function cmdStatus(shell) {
    if (!shell._shareActive || !shell._shareSessionId) {
        console.log(chalk.yellow('// No active share session'));
        return;
    }

    const mem = shell._shareViewers || {};
    const viewers = Object.values(mem);

    console.log(chalk.cyan(`\n  Terminal Share — ${shell._shareSessionId}`));
    console.log(chalk.dim('  ' + '─'.repeat(44)));

    if (!viewers.length) {
        console.log(chalk.dim('  No viewers yet.'));
    } else {
        viewers.forEach(v => {
            const access = v.canWrite ? chalk.blue('[write]') : chalk.dim('[read]');
            const req    = v.requested ? chalk.yellow(' ← requesting write') : '';
            console.log(`  ${chalk.green('●')} ${chalk.white(v.name)} ${access}${req}`);
            console.log(chalk.dim(`    userId: ${v.userId}`));
        });
    }
    console.log();
}

// ── grant ─────────────────────────────────────────────────────────────────────
async function cmdGrant(userId, shell) {
    if (!userId) { console.log(chalk.red('Usage: share grant <userId>')); return; }
    if (!shell._shareActive) { console.log(chalk.red('❌ No active share session')); return; }

    shell.ws.socket.emit('terminal:grant', {
        sessionId: shell._shareSessionId,
        userId,
    });

    // Update local viewer state
    if (shell._shareViewers?.[userId]) {
        shell._shareViewers[userId].canWrite  = true;
        shell._shareViewers[userId].requested = false;
    }

    console.log(chalk.green(`✅ Write access granted to ${userId}`));
}

// ── revoke ────────────────────────────────────────────────────────────────────
async function cmdRevoke(userId, shell) {
    if (!userId) { console.log(chalk.red('Usage: share revoke <userId>')); return; }
    if (!shell._shareActive) { console.log(chalk.red('❌ No active share session')); return; }

    shell.ws.socket.emit('terminal:revoke', {
        sessionId: shell._shareSessionId,
        userId,
    });

    if (shell._shareViewers?.[userId]) {
        shell._shareViewers[userId].canWrite = false;
    }

    console.log(chalk.green(`✅ Write access revoked from ${userId}`));
}

// ── kick ──────────────────────────────────────────────────────────────────────
async function cmdKick(userId, shell) {
    if (!userId) { console.log(chalk.red('Usage: share kick <userId>')); return; }
    if (!shell._shareActive) { console.log(chalk.red('❌ No active share session')); return; }

    shell.ws.socket.emit('terminal:kick', {
        sessionId: shell._shareSessionId,
        userId,
    });

    if (shell._shareViewers) delete shell._shareViewers[userId];
    console.log(chalk.green(`✅ ${userId} kicked from session`));
}

// ── Output hooking ────────────────────────────────────────────────────────────
// Intercept process.stdout.write to stream output to viewers

let _originalWrite = null;

function _hookOutput(shell, sessionId) {
    shell._shareViewers = {};
    _originalWrite = process.stdout.write.bind(process.stdout);

    // Remove any existing listeners to prevent duplicates on re-share
    shell.ws.socket.off('terminal:viewerJoined');
    shell.ws.socket.off('terminal:viewerLeft');
    shell.ws.socket.off('terminal:writeRequest');
    shell.ws.socket.off('terminal:input');

    process.stdout.write = function(chunk, encoding, callback) {
        const str = chunk.toString();
        // Send to viewers — stream everything including ANSI colors
        if (shell.ws.isConnected() && shell._shareActive) {
            shell.ws.socket.emit('terminal:output', {
                sessionId,
                data: str,
            });
        }
        // Still write to own terminal
        return _originalWrite(chunk, encoding, callback);
    };

    // Listen for viewer events
    shell.ws.socket.on('terminal:viewerJoined', (d) => {
        if (!shell._shareViewers) shell._shareViewers = {};
        shell._shareViewers[d.userId] = { userId: d.userId, name: d.name, canWrite: false, requested: false };
        console.log(chalk.dim(`\n  👁️  ${d.name} is now viewing your terminal`));
    });

    shell.ws.socket.on('terminal:viewerLeft', (d) => {
        if (shell._shareViewers) delete shell._shareViewers[d.userId];
        console.log(chalk.dim(`\n  👁️  ${d.name} stopped viewing`));
    });

    shell.ws.socket.on('terminal:writeRequest', (d) => {
        if (shell._shareViewers?.[d.userId]) shell._shareViewers[d.userId].requested = true;
        console.log(chalk.yellow(`\n  ✍️  ${d.name} is requesting write access`));
        console.log(chalk.dim(`     share grant ${d.userId}   or   share kick ${d.userId}\n`));
    });

    shell.ws.socket.on('terminal:input', (d) => {
        // A writer sent input — execute it in the shell
        console.log(chalk.blue(`\n  [${d.fromName}] → ${d.input}`));
        // The shell will process this as if the user typed it
        shell.execute(d.input.trim());
    });
}

function _unhookOutput(shell) {
    if (_originalWrite) {
        process.stdout.write = _originalWrite;
        _originalWrite = null;
    }
    shell.ws.socket.off('terminal:viewerJoined');
    shell.ws.socket.off('terminal:viewerLeft');
    shell.ws.socket.off('terminal:writeRequest');
    shell.ws.socket.off('terminal:input');
}

// ── Help ──────────────────────────────────────────────────────────────────────
function printHelp() {
    console.log(chalk.cyan('\n  Terminal Share Commands'));
    console.log(chalk.dim('  ' + '─'.repeat(40)));
    const rows = [
        ['share start',          'Start sharing your terminal'],
        ['share stop',           'Stop sharing'],
        ['share status',         'Show viewers and write requests'],
        ['share grant <userId>', 'Give write access to a viewer'],
        ['share revoke <userId>','Revoke write access'],
        ['share kick <userId>',  'Remove a viewer'],
    ];
    rows.forEach(([cmd, desc]) => {
        console.log(`  ${chalk.green(cmd.padEnd(26))} ${chalk.dim(desc)}`);
    });
    console.log();
}