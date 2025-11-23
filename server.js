const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 8080;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Create HTTP server
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocket.Server({ server });

const rooms = {};

wss.on('connection', ws => {
  ws.id = Math.random().toString(36).substr(2,6);
  ws.roomId = null;

  ws.on('message', msg => {
    let data;
    try { data = JSON.parse(msg); } catch(e){ return; }

    if(data.type === 'join'){
      ws.roomId = data.room;
      if(!rooms[ws.roomId]) rooms[ws.roomId] = new Set();
      const peers = Array.from(rooms[ws.roomId]).map(s => s.id);
      ws.send(JSON.stringify({ type:'peers', peers }));
      rooms[ws.roomId].forEach(s => {
        s.send(JSON.stringify({ type:'new-peer', id: ws.id }));
      });
      rooms[ws.roomId].add(ws);
    }

    if(['offer','answer','ice'].includes(data.type)){
      const target = Array.from(rooms[ws.roomId]||[]).find(s => s.id===data.to);
      if(target) target.send(JSON.stringify(data));
    }

    if(data.type==='leave'){
      handleLeave(ws);
    }
  });

  ws.on('close', ()=> handleLeave(ws));

  function handleLeave(ws){
    if(!ws.roomId || !rooms[ws.roomId]) return;
    rooms[ws.roomId].delete(ws);
    rooms[ws.roomId].forEach(s=>{
      s.send(JSON.stringify({ type:'leave', id: ws.id }));
    });
  }
});

server.listen(PORT, ()=> console.log(`Server running on http://localhost:${PORT}`));
