const { Server } = require('socket.io');
const config = require('./config');
const { query } = require('./db');
const { resolveActor } = require('./middleware/auth');
const realtime = require('./realtime');

function initSocket(httpServer) {
  const io = new Server(httpServer, { cors: { origin: config.origins, credentials: true } });
  realtime.setIO(io);

  // Every socket must carry a valid login token.
  io.use(async (socket, next) => {
    try { socket.actor = await resolveActor(socket.handshake.auth && socket.handshake.auth.token, 'main'); next(); }
    catch { next(new Error('unauthorized')); }
  });

  io.on('connection', (socket) => {
    const a = socket.actor;
    socket.join(`${a.kind}:${a.id}`);   // personal room: user:<id> or customer:<id>

    // Joining a chat room is allowed only for the two members of that conversation.
    socket.on('conversation:join', async (conversationId, ack) => {
      try {
        if (!/^[0-9a-f-]{36}$/i.test(String(conversationId))) throw new Error('bad id');
        const sql = a.role === 'customer'
          ? 'SELECT 1 FROM conversations WHERE id = $1 AND customer_id = $2'
          : 'SELECT 1 FROM conversations c JOIN providers p ON p.id = c.provider_id WHERE c.id = $1 AND p.user_id = $2';
        const { rows } = await query(sql, [conversationId, a.id]);
        if (!rows[0]) throw new Error('not a member');
        socket.join(`conv:${conversationId}`);
        if (typeof ack === 'function') ack({ ok: true });
      } catch { if (typeof ack === 'function') ack({ ok: false }); }
    });

    socket.on('conversation:leave', (id) => socket.leave(`conv:${id}`));
    socket.on('typing', ({ conversationId } = {}) => {
      if (socket.rooms.has(`conv:${conversationId}`)) socket.to(`conv:${conversationId}`).emit('typing', { conversationId, role: a.role });
    });
  });
  return io;
}

module.exports = { initSocket };
