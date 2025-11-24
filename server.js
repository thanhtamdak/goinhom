// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// serve static files
app.use(express.static(path.join(__dirname, 'public')));

// rooms: roomId -> Map(socketId -> { name })
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('join', ({ roomId, name }) => {
    socket.join(roomId);
    socket.data.name = name || 'Guest';
    socket.data.roomId = roomId;

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const roomMap = rooms.get(roomId);
    // send existing peers to newcomer
    const peers = Array.from(roomMap.entries()).map(([id, meta]) => ({ id, name: meta.name }));
    socket.emit('all-users', peers);

    // notify others
    socket.to(roomId).emit('user-joined', { id: socket.id, name: socket.data.name });

    // add to room map
    roomMap.set(socket.id, { name: socket.data.name });

    console.log(`${socket.data.name} joined ${roomId}`);
  });

  // generic signal forward (offer/answer/ice) used by simple-peer
  socket.on('signal', (data) => {
    // data: { to, from, signal }
    io.to(data.to).emit('signal', data);
  });

  socket.on('start-share', () => {
    const r = socket.data.roomId;
    if (r) socket.to(r).emit('start-share', { id: socket.id });
  });

  socket.on('stop-share', () => {
    const r = socket.data.roomId;
    if (r) socket.to(r).emit('stop-share', { id: socket.id });
  });

  socket.on('media-update', (payload) => {
    // { audio, video }
    const r = socket.data.roomId;
    if (r) socket.to(r).emit('media-update', { id: socket.id, audio: payload.audio, video: payload.video });
  });

  socket.on('chat', (payload) => {
    const r = socket.data.roomId;
    if (r) {
      io.to(r).emit('chat', { id: socket.id, name: socket.data.name, text: payload.text });
    }
  });

  socket.on('disconnect', () => {
    const r = socket.data.roomId;
    const name = socket.data.name;
    if (r && rooms.has(r)) {
      rooms.get(r).delete(socket.id);
      socket.to(r).emit('user-left', { id: socket.id, name });
      console.log(`${name} left ${r}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
