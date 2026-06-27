// src/commands/tasks/task-status.js
const chalk = require('chalk');

const STATUS_MAP = {
  accept:       'accepted',
  start:        'inprogress',
  complete:     'completed',
  reject:       'rejected',
  done:         'completed',
  'task-status': null, // requires explicit arg
};

module.exports = {
  name:         'task-status',
  description:  'Update your task status',
  aliases:      ['accept', 'start', 'complete', 'reject', 'done'],
  requiresAuth: true,
  requiresRoom: true,

  async execute(args, shell, invokedAs) {
  const roomId = shell.ws.getCurrentRoom(); // ← top pe, ek baar
  const taskId = args[0];
  const verb   = invokedAs || shell._lastCommand || 'task-status';
  const status = STATUS_MAP[verb] ?? args[1];

  if (!taskId) {
    console.log(chalk.yellow('  Usage: accept <taskId> | start <taskId> | complete <taskId>'));
    return;
  }
  if (!status) {
    console.log(chalk.yellow('  Usage: task-status <taskId> <accepted|inprogress|completed|rejected>'));
    return;
  }

  try {
    const result = await shell.api._request(
      'POST',
      `/thinknsh/${roomId}/tasks/${taskId}/status`,
      { status }
    );

    const statusColors = {
      accepted:   chalk.green,
      inprogress: chalk.blue,
      completed:  chalk.green,
      rejected:   chalk.red,
    };

    const col = statusColors[status] || chalk.white;
    console.log(col(`\n  ✓ Task "${result.taskTitle}" → ${status}`));

    if (result.allCompleted) {
      console.log(chalk.green('  🎉 All assignees done — task fully completed!\n'));
    } else {
      console.log('');
    }

    // Socket emit
    if (shell.ws.isConnected?.() && shell.ws.socket) {
      shell.ws.socket.emit('task:' + (status === 'inprogress' ? 'started' : status), {
        roomId,
        taskId,
        taskTitle: result.taskTitle,
        userId:    shell.api.getUser()?._id,
      });
    }

  } catch (err) {
    console.log(chalk.red(`\n  ❌ ${err.message}\n`));
  }
  }
};