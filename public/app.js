// app.js - client-side
// Mesh WebRTC + WebSocket signaling (HTTP+WS same host)
// Works with server.js above

const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const statusEl = document.getElementById('status');

const participantsEl = document.getElementById('participants');
const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChat');

const videoGrid = document.getElementById('videoGrid');
const largeVideo = document.getElementById('largeVideo');
const presenterBanner = document.getElementById('presenterBanner');
const presenterNameEl = document.getElementById('presenterName');

const toggleAudioBtn = document.getElementById('toggleAudio');
const toggleVideoBtn = document.getElementById('toggleVideo');
const shareBtn = document.getElementById('shareBtn');
const stopShareBtn = document.getElementById('stopShareBtn');
const presentBtn = document.getElementById('presentBtn');

let localStream = null;
let localId = null;
let roomId = null;
let ws = null;
let presenterId = null;
let isPresenting = false;

const peers = {}; // peerId => { pc, tileEl, stream }

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
    // add TURN servers here for production
  ]
};

// WebSocket URL uses same host (works on Render/Railway)
const SIGNALING_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

// utilities
function log(...args){ console.log(...args); }
function setStatus(s){ statusEl.textContent = s; }
function makeId(len=6){ return Math.random().toString(36).slice(2, 2+len); }

// UI helpers
function addParticipantItem(id, name){
  const li = document.createElement('li');
  li.id = 'p-'+id;
  li.className = 'participant';
  li.innerHTML = `<div class="dot"></div><div style="flex:1">${name} <div id="muted-${id}" class="small-muted"></div></div>`;
  participantsEl.appendChild(li);
}
function removeParticipantItem(id){
  const el = document.getElementById('p-'+id);
  if(el) el.remove();
}

function addChatMessage(name, text, mine=false){
  const d = document.createElement('div');
  d.innerHTML = `<b>${name}</b>: ${text}`;
  d.style.padding = '6px 0';
  if(mine) d.style.opacity = '0.9';
  chatBox.appendChild(d);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function createTile(id, label){
  const wrapper = document.createElement('div');
  wrapper.className = 'tile';
  wrapper.id = 'tile-'+id;
  const v = document.createElement('video');
  v.autoplay = true; v.playsInline = true;
  v.id = 'video-'+id;
  const lbl = document.createElement('div'); lbl.className = 'label'; lbl.textContent = label || id;
  wrapper.appendChild(v); wrapper.appendChild(lbl);

  // click to spotlight local/remote in largeVideo
  wrapper.addEventListener('click', ()=> {
    setLargeVideo(id, label);
  });

  videoGrid.appendChild(wrapper);
  return { wrapper, videoEl: v, labelEl: lbl };
}

function removeTile(id){
  const el = document.getElementById('tile-'+id);
  if(el) el.remove();
  // if largeVideo currently showing this, clear
  const current = largeVideo.querySelector('video');
  if(current && current.id === 'video-'+id){
    largeVideo.innerHTML = '';
  }
}

function setLargeVideo(id, label){
  // remove existing
  largeVideo.innerHTML = '';
  // find tile video
  const video = document.getElementById('video-'+id);
  if(video){
    // clone stream into new video element to avoid moving DOM nodes
    const clone = document.createElement('video');
    clone.autoplay = true; clone.playsInline = true; clone.controls = false;
    clone.srcObject = video.srcObject;
    clone.id = 'large-'+id;
    largeVideo.appendChild(clone);
  } else {
    // maybe local
    if(id === localId && localStream){
      const v = document.createElement('video'); v.autoplay=true; v.playsInline=true; v.muted=true; v.srcObject = localStream;
      largeVideo.appendChild(v);
    }
  }
  // show presenter banner if presenter
  if(presenterId){
    presenterBanner.hidden = false;
    const name = (presenterId === localId) ? (nameInput.value || 'Bạn') : (peers[presenterId]?.name || 'Người trình bày');
    presenterNameEl.textContent = name;
  }
}

// signaling connect
function connectWS(){
  ws = new WebSocket(SIGNALING_URL);
  ws.onopen = () => {
    setStatus('Signaling connected');
    log('WS open');
  };
  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);
    // handle message types
    switch(msg.type){
      case 'welcome':
        localId = msg.id;
        log('Assigned id', localId);
        break;

      case 'peers':
        // list of existing peers when we joined
        for(const p of msg.peers){
          if(p.id === localId) continue;
          await createPeerAndOffer(p.id);
        }
        break;

      case 'new-peer':
        // someone else joined; create offer to them
        if(msg.id === localId) break;
        addParticipantItem(msg.id, msg.name || 'Guest');
        await createPeerAndOffer(msg.id);
        break;

      case 'offer':
        await handleOffer(msg);
        break;

      case 'answer':
        await handleAnswer(msg);
        break;

      case 'ice':
        await handleIce(msg);
        break;

      case 'leave':
        handlePeerLeave(msg.id);
        break;

      case 'present-start':
        presenterId = msg.presenter;
        highlightPresenter(presenterId);
        break;

      case 'present-stop':
        if(presenterId === msg.presenter) {
          presenterId = null;
          removePresenterHighlight();
        }
        break;

      case 'chat':
        addChatMessage(msg.name || msg.from, msg.text, msg.from === localId);
        break;

      default:
        console.warn('Unknown WS msg', msg);
    }
  };
  ws.onclose = ()=> setStatus('Signaling disconnected');
  ws.onerror = (e)=> console.error('WS error', e);
}

function sendSignal(obj){
  if(!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(obj));
}

// joining
joinBtn.addEventListener('click', async ()=>{
  if(!roomInput.value.trim()) return alert('Nhập Room ID');
  if(!nameInput.value.trim()) nameInput.value = 'Guest-'+makeId(3);
  roomId = roomInput.value.trim();

  try{
    localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
  } catch(e){
    alert('Không thể truy cập camera/micro: '+e.message);
    return;
  }

  // show local tile
  const localTile = createTile('local-'+Math.random().toString(36).slice(2,6), `${nameInput.value} (Bạn)`);
  const localVideo = localTile.videoEl;
  localVideo.muted = true;
  localVideo.srcObject = localStream;
  setLargeVideo('local-'+Math.random().toString(36).slice(2,6)); // temporary empty

  connectWS();

  // once ws open we send join message - but ws may not be open yet, so wait
  const waitOpen = setInterval(()=>{
    if(ws && ws.readyState === WebSocket.OPEN && localId){
      clearInterval(waitOpen);
      sendSignal({ type:'join', room: roomId, name: nameInput.value });
      setStatus('Joined: '+roomId);
      joinBtn.disabled = true; leaveBtn.disabled = false;
      // add self to participants UI
      addParticipantItem(localId, nameInput.value + ' (Bạn)');
    }
  }, 200);
});

// leave
leaveBtn.addEventListener('click', ()=> leaveRoom());
function leaveRoom(){
  // close all RTCPeerConnections
  for(const pid in peers){
    try{ peers[pid].pc.close(); }catch(e){}
    removeTile(pid);
  }
  Object.keys(peers).forEach(k=> delete peers[k]);
  if(localStream) { localStream.getTracks().forEach(t=>t.stop()); localStream = null; }
  if(ws && ws.readyState === WebSocket.OPEN) sendSignal({ type:'leave' });
  if(ws) ws.close();
  setStatus('Offline');
  joinBtn.disabled = false; leaveBtn.disabled = true;
  // clear UI
  participantsEl.innerHTML = '';
  videoGrid.innerHTML = '';
  largeVideo.innerHTML = '';
  presenterBanner.hidden = true;
}

// create peer and offer
async function createPeerAndOffer(peerId){
  if(peers[peerId]) return;
  const pc = new RTCPeerConnection(ICE_SERVERS);
  const tile = createTile(peerId, 'Peer: '+peerId);
  peers[peerId] = { pc, tile, name: 'Peer' };

  // add our local tracks
  if(localStream) localStream.getTracks().forEach(t=> pc.addTrack(t, localStream));

  pc.ontrack = (ev) => {
    const stream = ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream([ev.track]);
    peers[peerId].tile.videoEl.srcObject = stream;
  };

  pc.onicecandidate = (ev) => {
    if(ev.candidate){
      sendSignal({ type:'ice', from: localId, to: peerId, candidate: ev.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    if(pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed'){
      handlePeerLeave(peerId);
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignal({ type:'offer', from: localId, to: peerId, sdp: pc.localDescription });
}

// handle offer
async function handleOffer(msg){
  const from = msg.from;
  if(peers[from]) {
    console.warn('Offer from existing peer', from);
    return;
  }
  const pc = new RTCPeerConnection(ICE_SERVERS);
  const tile = createTile(from, 'Peer: '+from);
  peers[from] = { pc, tile, name: 'Peer' };

  if(localStream) localStream.getTracks().forEach(t=> pc.addTrack(t, localStream));

  pc.ontrack = (ev) => {
    const stream = ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream([ev.track]);
    peers[from].tile.videoEl.srcObject = stream;
  };

  pc.onicecandidate = (ev) => {
    if(ev.candidate){
      sendSignal({ type:'ice', from: localId, to: from, candidate: ev.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    if(pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed'){
      handlePeerLeave(from);
    }
  };

  await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendSignal({ type:'answer', from: localId, to: from, sdp: pc.localDescription });
}

// handle answer
async function handleAnswer(msg){
  const from = msg.from;
  const rec = peers[from];
  if(!rec) return console.warn('Answer from unknown', from);
  await rec.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
}

// handle ice
async function handleIce(msg){
  const from = msg.from;
  const rec = peers[from];
  if(rec && rec.pc){
    try{ await rec.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); }catch(e){ console.warn(e); }
  }
}

// handle peer leave
function handlePeerLeave(peerId){
  if(peers[peerId]){
    try{ peers[peerId].pc.close(); }catch(e){}
    removeTile(peerId);
    removeParticipantItem(peerId);
    delete peers[peerId];
  }
  if(presenterId === peerId){
    presenterId = null;
    removePresenterHighlight();
  }
}

// PRESENTATION: start/stop presenting (local)
shareBtn.addEventListener('click', async ()=>{
  if(isPresenting) return;
  if(!navigator.mediaDevices.getDisplayMedia) return alert('Trình duyệt không hỗ trợ getDisplayMedia');
  try{
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video:true, audio:false });
    const screenTrack = screenStream.getVideoTracks()[0];

    // replace outgoing video sender track on each peer
    for(const pid in peers){
      const pc = peers[pid].pc;
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if(sender){
        await sender.replaceTrack(screenTrack);
      } else {
        try{ pc.addTrack(screenTrack); }catch(e){}
      }
    }

    // show screen locally as large video
    const scrTile = createTile('screen-local', 'Bạn (trình bày)');
    scrTile.videoEl.srcObject = screenStream;

    // notify server (broadcast) that this user is presenting
    sendSignal({ type:'present-start' });
    isPresenting = true;
    stopShareBtn.disabled = false;
    shareBtn.disabled = true;
    presenterId = localId;
    highlightPresenter(localId);

    // when user stops via browser UI
    screenTrack.onended = () => {
      stopPresenting();
    };
  }catch(e){
    console.warn('share canceled', e);
  }
});

stopShareBtn.addEventListener('click', ()=> stopPresenting());

async function stopPresenting(){
  // restore original camera track to all peers
  if(!localStream) return;
  const camTrack = localStream.getVideoTracks()[0];
  for(const pid in peers){
    const pc = peers[pid].pc;
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if(sender){
      try{ await sender.replaceTrack(camTrack); }catch(e){ console.warn(e); }
    }
  }
  // remove local screen tile if any
  removeTile('screen-local');
  sendSignal({ type:'present-stop' });
  isPresenting = false;
  stopShareBtn.disabled = true;
  shareBtn.disabled = false;
  presenterId = null;
  removePresenterHighlight();
}

// when server informs others that someone is presenting, spotlight them
function highlightPresenter(pId){
  // show banner
  presenterBanner.hidden = false;
  const name = (pId === localId) ? (nameInput.value || 'Bạn') : (peers[pId]?.name || ('User '+pId));
  presenterNameEl.textContent = name;
  // move presenter's tile to largeVideo
  // find video element (remote)
  const vid = document.getElementById('video-'+pId);
  if(vid){
    largeVideo.innerHTML = '';
    const clone = document.createElement('video');
    clone.autoplay = true; clone.playsInline = true;
    clone.srcObject = vid.srcObject;
    largeVideo.appendChild(clone);
  } else if(pId === localId){
    // show local stream
    largeVideo.innerHTML = '';
    const v = document.createElement('video'); v.autoplay=true; v.playsInline=true; v.muted=true; v.srcObject = localStream;
    largeVideo.appendChild(v);
  }
}

function removePresenterHighlight(){
  presenterBanner.hidden = true;
  presenterNameEl.textContent = '';
  largeVideo.innerHTML = '';
}

// CHAT
sendChatBtn.addEventListener('click', ()=> {
  const text = (chatInput && chatInput.value) ? chatInput.value.trim() : '';
  if(!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  sendSignal({ type:'chat', text });
  addChatMessage('Bạn', text, true);
  chatInput.value = '';
});

// toggles
toggleAudioBtn.addEventListener('click', ()=>{
  if(!localStream) return;
  const t = localStream.getAudioTracks()[0];
  if(!t) return;
  t.enabled = !t.enabled;
  toggleAudioBtn.textContent = t.enabled ? 'Mic Off' : 'Mic On';
});
toggleVideoBtn.addEventListener('click', ()=>{
  if(!localStream) return;
  const t = localStream.getVideoTracks()[0];
  if(!t) return;
  t.enabled = !t.enabled;
  toggleVideoBtn.textContent = t.enabled ? 'Cam Off' : 'Cam On';
});

// helper to add ourselves to participants list on join (server will notify others)
function addSelfToParticipants(){
  addParticipantItem(localId, nameInput.value + ' (Bạn)');
}

// When window unload, leave
window.addEventListener('beforeunload', ()=> {
  if(ws && ws.readyState === WebSocket.OPEN) sendSignal({ type:'leave' });
});

