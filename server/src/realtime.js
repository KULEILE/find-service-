// Holds the Socket.IO server so any route can push live events.
let io = null;
module.exports = {
  setIO(server) { io = server; },
  getIO() { return io; },
  emitTo(room, event, payload) { if (io) io.to(room).emit(event, payload); },
};
