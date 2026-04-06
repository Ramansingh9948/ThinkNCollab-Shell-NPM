/**
  Join Command
 
  Usage: join <room-id> [password]
 
 Flow:
   1. REST call  → shell.api.joinRoom()  — validates membership + fetches room info
   2. WebSocket  → thinknsh:join         — registers socket in the room on the server
   3. Wait for   → thinknsh:joined       — server confirms + sends message history
 */

const chalk = require('chalk');

// How long to wait for thinknsh:joined after emitting thinknsh:join (ms)
const JOIN_TIMEOUT_MS = 8000;

module.exports = {
    name:         'join',
    description:  'Join a collaboration room',
    aliases:      ['enter', 'goto'],
    requiresAuth: true,

    async execute(args, shell) {
        if (args.length === 0) {
            console.log(chalk.red('❌ Usage: join <room-id> [password]'));
            return;
        }

        const roomId   = args[0];
        const password = args[1];

        // ── Step 1: auto-connect WebSocket if needed ──────────────────────
        if (!shell.ws.isConnected()) {
            console.log(chalk.dim('  Connecting...'));
            try {
                await shell.ws.connect();
            } catch (err) {
                console.log(chalk.red(`❌ WebSocket connect failed: ${err.message}`));
                return;
            }
        }

        console.log(chalk.cyan(`🔗 Joining room ${chalk.bold(roomId)}...`));

        // ── Step 2: REST call — validates membership, returns room meta ───
        let result;
        try {
            result = await shell.api.joinRoom(roomId, password);
        } catch (error) {
            if (error.message?.toLowerCase().includes('password')) {
                console.log(chalk.red(`❌ Room requires a password: join ${roomId} <password>`));
            } else if (error.message?.toLowerCase().includes('not found')) {
                console.log(chalk.red(`❌ Room not found: ${roomId}`));
                console.log(chalk.dim('   Type "rooms" to see available rooms'));
            } else if (error.message?.toLowerCase().includes('not a member') ||
                       error.message?.toLowerCase().includes('unauthorized')) {
                console.log(chalk.red(`❌ You are not a member of this room`));
            } else {
                console.log(chalk.red(`❌ Failed to join: ${error.message}`));
            }
            return;
        }

        const room = result.room || result;
        const user = shell.api.getUser?.() || {};

        // ── Step 3: emit thinknsh:join and wait for thinknsh:joined ──────
        await new Promise((resolve) => {
            const timer = setTimeout(() => {
                shell.ws.socket?.off('thinknsh:joined', onJoined);
                shell.ws.socket?.off('thinknsh:error',  onError);
                console.log(chalk.red('❌ Join timeout — server did not confirm. Try again.'));
                resolve();
            }, JOIN_TIMEOUT_MS);

            function onJoined(data) {
                clearTimeout(timer);
                shell.ws.socket?.off('thinknsh:error', onError);

                if (!data.success) {
                    console.log(chalk.red(`❌ Join rejected: ${data.message || 'unknown error'}`));
                    resolve();
                    return;
                }

                // ── Success output ────────────────────────────────────────
                console.log(chalk.green(`✅ Joined ${chalk.bold(room.name || roomId)}`));

                if (room.description)
                    console.log(chalk.dim(`   📝 ${room.description}`));

                const participants = result.participants || [];
                if (participants.length)
                    console.log(chalk.dim(`   👥 ${participants.length} participant(s)`));

                // Recent message history from thinknsh:joined payload
                const history = data.history || [];
                if (history.length) {
                    console.log(chalk.cyan('\n📜 Recent messages:'));
                    history.slice(-5).forEach(msg => {
                        const time  = new Date(msg.timestamp).toLocaleTimeString();
                        const isYou = msg.userId === user._id?.toString() || msg.userId === user.id?.toString();
                        const who   = isYou ? chalk.green('you') : chalk.cyan(msg.name || 'Unknown');
                        const src   = msg.source === 'shell' ? chalk.dim('[shell]') : '';
                        console.log(`  ${chalk.dim(`[${time}]`)} ${who}${src}: ${msg.message}`);
                    });
                }

                // Online participants
                const online = participants.filter(p => p.online);
                if (online.length) {
                    console.log(chalk.cyan('\n👥 Online:'));
                    online.forEach(p => {
                        const isYou = p.email === user.email ? chalk.green(' (you)') : '';
                        console.log(`  ${chalk.green('●')} ${p.name || p.email}${isYou}`);
                    });
                }

                console.log(chalk.dim('\n💡 say <message> to chat  |  leave to exit\n'));
                resolve();
            }

            function onError(data) {
                clearTimeout(timer);
                shell.ws.socket?.off('thinknsh:joined', onJoined);
                console.log(chalk.red(`❌ ${data.message || 'Join error'}`));
                resolve();
            }

            shell.ws.socket.once('thinknsh:joined', onJoined);
            shell.ws.socket.once('thinknsh:error',  onError);

            // Emit the WebSocket join event
            shell.ws.socket.emit('thinknsh:join', {
                roomId,
                userId:   user._id?.toString() || user.id?.toString(),
                name:     user.name || user.username || 'Unknown',
                userType: user.model || user.role || 'User',
            });
        });
    }
};