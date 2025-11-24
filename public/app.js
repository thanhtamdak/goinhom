/* public/app.js
   Full client logic:
   - Signaling via socket.io
   - Mesh using SimplePeer
   - Screen share replacement that works for existing peers AND new peers
   - Show all participants' video
*/

const socket = io(); // connect to same host
const peers = {};    // peers[peerId] = { peer, stream, name, audio, video }
let localStream = null;
let cameraTrack = null;     // original camera track
let currentVideoTrack = null; // current local video track (camera or screen)
let screenStream = null;
let myName = '';
let myId = null;
let roomId = null;

// UI refs (adjust to your index.html ids/classes)
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const btnJoin = document.getElementById('btnJoin');
const btnLeave = document.getElementById('btnLeave');
const participantsList = document.getElementById('participantsList');
const thumbGrid = document.getElementById('thumbGrid');
const largeArea = document.getElementById('largeArea');
const presentBanner = document.getElementById('presentBanner');
const presenterName = document.getElementById('presenterName');

const btnMic = document.getElementById('btnMic');
const btnCam = document.getElementById('btnCam');
const btnShare = document.getElementById('btnShare');
const btnStopShare = document.getElementById('btnStopShare');
const btnPin = document.getElementById('btnPin');

const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const sendChat = document.getElementById('sendChat');

const toast = document.getElementById('toast');

const ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// utils
function log(...args){ console.log(...args); }
function toastMsg(s, t=3000){ if(!toast) return; toast.textContent = s; toast.classList.remove('hidden'); setTimeout(()=>toast.classList.add('hidden'), t); }
function uid(n=6){ return Math.random().toString(36).slice(2,2+n); }
function initials(name='User'){ return name.split(' ').map(p=>p[0]||'').join('').slice(0,2).toUpperCase(); }

// UI helpers
function addParticipantUI(id, name, audio=true, video=true){
  const existing = document.getElementById('part-'+id);
  if(existing) return;
  const li = document.createElement('li');
  li.id = 'part-'+id; li.className = 'participant';
  li.innerHTML = `<div class="avatar">${initials(name)}</div>
    <div class="part-meta"><div class="meta-top"><div>${name}</div><div id="badge-${id}" class="badge">${audio? 'Mic':'Muted'} • ${video? 'Cam':'No Cam'}</div></div></div>`;
  participantsList.appendChild(li);
}
function removeParticipantUI(id){ const e=document.getElementById('part-'+id); if(e) e.remove(); }
function updateParticipantBadge(id,audio,video){ const b=document.getElementById('badge-'+id); if(b) b.textContent = (audio? 'Mic':'Muted') + ' • ' + (video? 'Cam':'No Cam'); }

// video tiles
function createTile(id, label){
  removeTile(id);
  const wrapper = document.createElement('div'); wrapper.className='tile'; wrapper.id='tile-'+id;
  const v = document.createElement('video'); v.autoplay=true; v.playsInline=true; v.id='video-'+id;
  const overlay = document.createElement('div'); overlay.className='tile-overlay';
  const nameSpan = document.createElement('span'); nameSpan.textContent = label || id;
  const ind = document.createElement('span'); ind.className='badge-ind'; ind.id='ind-'+id; ind.textContent = '';
  overlay.appendChild(nameSpan); overlay.appendChild(ind);
  wrapper.appendChild(v); wrapper.appendChild(overlay);
  wrapper.addEventListener('click', ()=> pinUser(id));
  thumbGrid.appendChild(wrapper);
  return { wrapper, videoEl: v, overlay, ind };
}
function removeTile(id){ const e=document.getElementById('tile-'+id); if(e) e.remove(); }
function setTileStream(id, stream){
  const v = document.getElementById('video-'+id);
  if(v) v.srcObject = stream;
  else {
    const tile = createTile(id, (peers[id] && peers[id].name) || id);
    tile.videoEl.srcObject = stream;
  }
}
function showLarge(stream, id, name){
  largeArea.innerHTML = '';
  const v = document.createElement('video'); v.autoplay=true; v.playsInline=true; v.srcObject = stream;
  if(id === myId) v.muted = true;
  largeArea.appendChild(v);
  presenterName.textContent = name || id;
  presentBanner.classList.remove('hidden');
}
function clearLarge(){ largeArea.innerHTML = ''; presentBanner.classList.add('hidden'); }

// pin user
let pinnedId = null;
function pinUser(id){
  pinnedId = id;
  if(id === myId && localStream) showLarge(localStream, myId, myName);
  else if(peers[id] && peers[id].stream) showLarge(peers[id].stream, id, peers[id].name);
}

// replace outgoing video track on all RTCPeerConnections
async function replaceOutgoingVideo(newTrack){
  currentVideoTrack = newTrack;
  // update localStream: remove old video track(s) and add newTrack if not present
  // remove existing video tracks from localStream
  try {
    const oldTracks = localStream.getVideoTracks();
    oldTracks.forEach(t => localStream.removeTrack(t));
  } catch(e){ /* ignore */ }

  if(newTrack) localStream.addTrack(newTrack);

  // For each peer, replace sender track
  for(const peerId in peers){
    try {
      const pc = peers[peerId].peer._pc; // simple-peer internal RTCPeerConnection
      if(!pc) continue;
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if(sender){
        await sender.replaceTrack(newTrack);
      } else if(newTrack){
        // fallback: add track
        pc.addTrack(newTrack, localStream);
      }
    } catch(err){
      console.warn('replaceOutgoingVideo error', err);
    }
  }
}

// create peer on demand
function createPeer(remoteId, initiator=false){
  if(peers[remoteId]) return peers[remoteId].peer;
  const p = new SimplePeer({ initiator, trickle: true, stream: localStream, config: ICE_CONFIG });
  peers[remoteId] = { peer: p, stream: null, name: remoteId, audio: true, video: true };

  p.on('signal', (data) => {
    socket.emit('signal', { to: remoteId, from: myId, signal: data });
  });

  p.on('stream', (stream) => {
    peers[remoteId].stream = stream;
    // show tile
    createTile(remoteId, peers[remoteId].name);
    setTileStream(remoteId, stream);
    // if someone is presenting and it's this id, show large
    if(presentingId === remoteId) showLarge(stream, remoteId, peers[remoteId].name);
  });

  p.on('close', ()=> {
    removeTile(remoteId);
    removeParticipantUI(remoteId);
    delete peers[remoteId];
  });

  p.on('error', e => console.warn('peer err', e));
  return p;
}

// handle incoming signals (offers/answers/ice)
socket.on('signal', (msg) => {
  const from = msg.from;
  const signal = msg.signal;
  if(!peers[from]){
    // create non-initiator peer to answer
    createPeer(from, false);
  }
  try {
    peers[from].peer.signal(signal);
  } catch(e){ console.warn('signal apply error', e); }
});

// when join: server will send all-users
socket.on('all-users', (users) => {
  // users: [{id,name}, ...]
  users.forEach(u=>{
    addParticipantUI(u.id, u.name);
    createPeer(u.id, true); // as newcomer, initiator true -> create offer
  });
});

// someone joined after us
socket.on('user-joined', ({ id, name }) => {
  addParticipantUI(id, name);
  // do NOT immediately create peer here; the new user will create offers to existing ones.
  // But to be safe, we can create a non-initiator so that we can answer offers.
  // createPeer(id, false);
  toastMsg(`${name} joined`);
});

// someone left
socket.on('user-left', ({ id, name }) => {
  if(peers[id]) {
    try{ peers[id].peer.destroy(); }catch(e){}
    delete peers[id];
  }
  removeTile(id);
  removeParticipantUI(id);
  toastMsg(`${name || id} left`);
  if(pinnedId === id){ pinnedId = null; clearLarge(); }
  if(presentingId === id){ presentingId = null; clearLarge(); }
});

// media update
socket.on('media-update', ({ id, audio, video }) => {
  if(peers[id]) {
    peers[id].audio = audio; peers[id].video = video;
  }
  updateParticipantBadge(id, audio, video);
});

// CHAT
socket.on('chat', ({ id, name, text }) => {
  const d = document.createElement('div'); d.innerHTML = `<b>${name}:</b> ${text}`; chatBox.appendChild(d); chatBox.scrollTop = chatBox.scrollHeight;
});

// present start/stop
let presentingId = null;
socket.on('start-share', ({ id }) => {
  presentingId = id;
  toastMsg('Đang trình bày: ' + id);
  // if we already have their stream, spotlight
  if(peers[id] && peers[id].stream) showLarge(peers[id].stream, id, peers[id].name);
});
socket.on('stop-share', ({ id }) => {
  if(presentingId === id) {
    presentingId = null;
    clearLarge();
  }
});

// UI: join flow
btnJoin.addEventListener('click', async () => {
  if(!roomInput.value.trim()) return alert('Enter Room ID');
  if(!nameInput.value.trim()) nameInput.value = 'Guest-'+uid(3);
  myName = nameInput.value.trim();
  roomId = roomInput.value.trim();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch(err){
    alert('Cannot access camera/mic: '+ err.message);
    return;
  }

  cameraTrack = localStream.getVideoTracks()[0];
  currentVideoTrack = cameraTrack;

  // show local tile
  const myTile = createTile('local-'+uid(3), myName + ' (You)');
  const v = myTile.videoEl || document.getElementById('video-local');
  // set local video (muted)
  myTile.videoEl.muted = true;
  myTile.videoEl.srcObject = localStream;

  // emit join; server will reply with all-users
  socket.emit('join', { roomId, name: myName });

  // set local id (socket id will be assigned on connect)
  myId = socket.id;

  btnJoin.disabled = true;
  btnLeave.disabled = false;
  addParticipantUI(myId, myName, true, true);
  toastMsg('Bạn đã tham gia phòng ' + roomId);
});

// Leave
btnLeave.addEventListener('click', () => {
  // close peers
  for(const id in peers){
    try{ peers[id].peer.destroy(); }catch(e){}
    removeTile(id);
  }
  if(localStream) localStream.getTracks().forEach(t=> t.stop());
  socket.disconnect();
  location.reload();
});

// toggles
btnMic.addEventListener('click', () => {
  if(!localStream) return;
  const t = localStream.getAudioTracks()[0];
  t.enabled = !t.enabled;
  socket.emit('media-update', { audio: t.enabled, video: (localStream.getVideoTracks()[0]||{}).enabled });
  updateParticipantBadge(myId, t.enabled, (localStream.getVideoTracks()[0]||{}).enabled);
});

btnCam.addEventListener('click', () => {
  if(!localStream) return;
  const t = localStream.getVideoTracks()[0];
  t.enabled = !t.enabled;
  socket.emit('media-update', { audio: (localStream.getAudioTracks()[0]||{}).enabled, video: t.enabled });
  updateParticipantBadge(myId, (localStream.getAudioTracks()[0]||{}).enabled, t.enabled);
});

// Screen share: replace localStream's video track and replace senders for existing peers
btnShare.addEventListener('click', async () => {
  if(!localStream) return;
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];

    // replace localStream video track
    // remove old video tracks
    localStream.getVideoTracks().forEach(t => localStream.removeTrack(t));
    localStream.addTrack(screenTrack);
    currentVideoTrack = screenTrack;

    // replace outgoing sender track for each existing peer
    for(const id in peers){
      const pc = peers[id].peer._pc;
      if(!pc) continue;
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if(sender){
        await sender.replaceTrack(screenTrack);
      } else {
        try{ pc.addTrack(screenTrack, localStream); } catch(e){ console.warn(e); }
      }
    }

    // locally show screen in large area
    showLarge(screenStream, myId, myName + ' (Presenting)');

    // notify others
    socket.emit('start-share');

    // handle end
    screenTrack.onended = () => {
      stopShare();
    };

    btnShare.disabled = true;
    btnStopShare.disabled = false;
  } catch(e){
    console.warn('screen share denied', e);
  }
});

async function stopShare(){
  if(!screenStream) return;
  // restore camera track: get a new camera track if needed
  try {
    const cam = await navigator.mediaDevices.getUserMedia({ video: true });
    const newCamTrack = cam.getVideoTracks()[0];
    // remove screen tracks from localStream and add cam
    localStream.getVideoTracks().forEach(t => localStream.removeTrack(t));
    localStream.addTrack(newCamTrack);
    currentVideoTrack = newCamTrack;

    // replace for peers
    for(const id in peers){
      const pc = peers[id].peer._pc;
      if(!pc) continue;
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if(sender){
        try{ await sender.replaceTrack(newCamTrack); } catch(e){ console.warn('replace back failed', e); }
      } else {
        try{ pc.addTrack(newCamTrack, localStream); } catch(e){}
      }
    }
  } catch(err){
    console.warn('restore camera failed', err);
  }

  // stop screen stream tracks
  try { screenStream.getTracks().forEach(t => t.stop()); } catch(e){}
  screenStream = null;
  socket.emit('stop-share');
  btnShare.disabled = false;
  btnStopShare.disabled = true;
  // clear large area if not pinned
  if(pinnedId !== myId) clearLarge();
}

// Pin/unpin logic: clicking tile calls pinUser(); Pin button toggles
btnPin.addEventListener('click', () => {
  if(!pinnedId) { toastMsg('Chọn 1 người để ghim bằng cách bấm vào ô'); return; }
  pinnedId = null; clearLarge();
});

// Chat
sendChat.addEventListener('click', () => {
  const txt = chatInput.value.trim();
  if(!txt) return;
  socket.emit('chat', { text: txt });
  const div = document.createElement('div'); div.innerHTML = `<b>Bạn:</b> ${txt}`; chatBox.appendChild(div); chatBox.scrollTop = chatBox.scrollHeight;
  chatInput.value = '';
});

// When socket connects, capture id
socket.on('connect', () => {
  myId = socket.id;
});
