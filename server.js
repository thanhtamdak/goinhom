// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// serve client
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8080;
const rooms = new Map(); // roomId -> Map(socket.id -> {name})

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('join', ({ roomId, name }) => {
    socket.join(roomId);
    socket.data.name = name || 'Guest';
    socket.data.roomId = roomId;

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    rooms.get(roomId).set(socket.id, { name: socket.data.name });

    // send existing users to the new one
    const peers = Array.from(rooms.get(roomId).entries())
      .filter(([id]) => id !== socket.id)
      .map(([id, meta]) => ({ id, name: meta.name }));
    socket.emit('all-users', peers);

    // notify others
    socket.to(roomId).emit('user-joined', { id: socket.id, name: socket.data.name });
    console.log(`${socket.data.name} joined ${roomId}`);
  });

  // forwarding signaling messages: offer/answer/ice
  socket.on('signal', (data) => {
    // data: { to, from, signal }
    io.to(data.to).emit('signal', data);
  });

  // mic/cam toggle
  socket.on('update-media', (data) => {
    // data: { userId, audio, video }
    const roomId = socket.data.roomId;
    if (roomId) socket.to(roomId).emit('update-media', data);
  });

  socket.on('start-share', () => {
    const roomId = socket.data.roomId;
    if (roomId) socket.to(roomId).emit('start-share', { userId: socket.id });
  });

  socket.on('stop-share', () => {
    const roomId = socket.data.roomId;
    if (roomId) socket.to(roomId).emit('stop-share', { userId: socket.id });
  });

  socket.on('chat', (data) => {
    const roomId = socket.data.roomId;
    if (roomId) io.to(roomId).emit('chat', { from: socket.id, name: socket.data.name, text: data.text });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const name = socket.data.name;
    if (roomId && rooms.has(roomId)) {
      rooms.get(roomId).delete(socket.id);
      socket.to(roomId).emit('user-left', { id: socket.id, name });
      console.log(`${name} left ${roomId}`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
