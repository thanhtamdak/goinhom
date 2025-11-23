// server.js
const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 8080;

// serve client
app.use(express.static(path.join(__dirname, 'public')));

// create server and websocket server on same port
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

console.log('Starting server...');

const rooms = new Map(); // roomId -> Set(ws)
const idToMeta = new Map(); // ws.id -> { name }

function genId() {
  return Math.random().toString(36).slice(2, 9);
}

wss.on('connection', (ws, req) => {
  ws.id = genId();
  ws.roomId = null;
  idToMeta.set(ws.id, { name: 'Guest' });

  // send welcome (id)
  ws.send(JSON.stringify({ type: 'welcome', id: ws.id }));

  ws.on('message', (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch (e) { return; }

    // handle join
    if (data.type === 'join') {
      const { room, name } = data;
      ws.roomId = room;
      if (name) idToMeta.set(ws.id, { name });

      if (!rooms.has(room)) rooms.set(room, new Set());
      const set = rooms.get(room);

      // send peers list (ids + names)
      const peers = Array.from(set).map(s => ({ id: s.id, name: idToMeta.get(s.id)?.name || 'Guest' }));
      ws.send(JSON.stringify({ type: 'peers', peers }));

      // notify existing that new peer joined
      set.forEach(s => {
        s.send(JSON.stringify({ type: 'new-peer', id: ws.id, name: idToMeta.get(ws.id).name }));
      });

      set.add(ws);
      console.log(`User ${ws.id} (${name || 'Guest'}) joined room ${room}`);
      return;
    }

    // signaling: offer/answer/ice
    if (['offer', 'answer', 'ice', 'present-start', 'present-stop', 'chat'].includes(data.type)) {
      // data.to must be target peer id (for signaling messages)
      // For present-start/present-stop and chat we broadcast to everyone in room
      if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice') {
        const targetId = data.to;
        if (!ws.roomId || !rooms.has(ws.roomId)) return;
        const set = rooms.get(ws.roomId);
        const target = Array.from(set).find(s => s.id === targetId);
        if (target && target.readyState === WebSocket.OPEN) target.send(JSON.stringify(data));
      } else if (data.type === 'present-start') {
        // broadcast presenter id to room
        if (ws.roomId && rooms.has(ws.roomId)) {
          rooms.get(ws.roomId).forEach(s => {
            if (s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ type: 'present-start', presenter: ws.id }));
          });
        }
      } else if (data.type === 'present-stop') {
        if (ws.roomId && rooms.has(ws.roomId)) {
          rooms.get(ws.roomId).forEach(s => {
            if (s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ type: 'present-stop', presenter: ws.id }));
          });
        }
      } else if (data.type === 'chat') {
        if (ws.roomId && rooms.has(ws.roomId)) {
          const name = idToMeta.get(ws.id)?.name || 'Guest';
          rooms.get(ws.roomId).forEach(s => {
            if (s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ type: 'chat', from: ws.id, name, text: data.text }));
          });
        }
      }
      return;
    }

    // leave
    if (data.type === 'leave') {
      handleLeave(ws);
      return;
    }
  });

  ws.on('close', () => handleLeave(ws));
});

function handleLeave(ws) {
  if (!ws.roomId) return;
  const room = rooms.get(ws.roomId);
  if (!room) return;
  room.delete(ws);
  // notify remaining
  room.forEach(s => {
    if (s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ type: 'leave', id: ws.id }));
  });
  console.log(`User ${ws.id} left room ${ws.roomId}`);
  ws.roomId = null;
}

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
