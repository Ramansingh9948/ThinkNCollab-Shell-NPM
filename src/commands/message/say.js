/*
  Say Command
  Usage: say <message>
*/
const chalk = require('chalk');

module.exports = {
    name: 'say',
    description: 'Send a message to the current room',
    aliases: ['msg', 'm', 'send'],
    requiresAuth: true,
    requiresRoom: true,

    async execute(args, shell) {
        const message = args.join(' ').trim();
        if (!message) {
            console.log(chalk.red('❌ Usage: say <message>'));
            return;
        }

        const room = shell.ws.getCurrentRoom?.();
        if (!room) {
            console.log(chalk.red('❌ Not in any room. Use: join <room-id>'));
            return;
        }

        try {
            // Stop typing indicator if active
            if (shell.isTyping) {
                shell.ws.socket?.emit('thinknsh:typing', { roomId: room, typing: false });
                shell.isTyping = false;
                clearTimeout(shell.typingTimeout);
            }

            await shell.ws.sendMessage(message);

            const user = shell.api.getUser();
            const time = new Date().toLocaleTimeString();
            console.log(
                chalk.dim(`[${time}] `) +
                chalk.green(`${user?.name || 'You'}: `) +
                chalk.white(message)
            );

        } catch (error) {
            console.log(chalk.red(`❌ Failed to send: ${error.message}`));
        }
    }
};