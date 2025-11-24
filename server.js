// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Socket.IO server (same HTTP server) -> works on Render/Railway (HTTPS/WSS)
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// rooms: Map roomId => Map(socketId => { name })
const rooms = new Map();

io.on('connection', (socket) => {
  // console.log('connect', socket.id);

  socket.on('join', ({ roomId, name }) => {
    socket.join(roomId);
    socket.data.name = name || 'Guest';
    socket.data.roomId = roomId;

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const roomMap = rooms.get(roomId);

    // Send existing peers to the newcomer
    const peers = Array.from(roomMap.entries()).map(([id, meta]) => ({ id, name: meta.name }));
    socket.emit('all-users', peers);

    // Notify others about new user
    socket.to(roomId).emit('user-joined', { id: socket.id, name: socket.data.name });

    // Add to room map
    roomMap.set(socket.id, { name: socket.data.name });

    // Optional: if there is an active presenter flagged, the server could track it (not required)
    // Not storing presenter to keep server simple — presenters announced by events.
  });

  // Forward signaling messages (offer/answer/ice) from client to specific target
  socket.on('signal', (data) => {
    // data: { to, from, signal }
    if (!data || !data.to) return;
    io.to(data.to).emit('signal', data);
  });

  // Presentation events
  socket.on('start-present', () => {
    const roomId = socket.data.roomId;
    if (roomId) socket.to(roomId).emit('start-present', { id: socket.id, name: socket.data.name });
  });

  socket.on('stop-present', () => {
    const roomId = socket.data.roomId;
    if (roomId) socket.to(roomId).emit('stop-present', { id: socket.id });
  });

  // Media status updates (mic/cam)
  socket.on('media-update', (payload) => {
    const roomId = socket.data.roomId;
    if (roomId) socket.to(roomId).emit('media-update', { id: socket.id, ...payload });
  });

  // Chat
  socket.on('chat', (payload) => {
    const roomId = socket.data.roomId;
    if (roomId) io.to(roomId).emit('chat', { id: socket.id, name: socket.data.name, text: payload.text });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const name = socket.data.name;
    if (roomId && rooms.has(roomId)) {
      rooms.get(roomId).delete(socket.id);
      socket.to(roomId).emit('user-left', { id: socket.id, name });
      // Clean up empty room
      if (rooms.get(roomId).size === 0) rooms.delete(roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
