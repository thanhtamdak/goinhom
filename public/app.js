// public/app.js
// Requires socket.io and simple-peer included in index.html
const socket = io(); // connects to same origin
const peers = {}; // peers[peerId] = { peer, name, stream }
let localStream = null;
let cameraTrack = null;       // keep original camera track
let currentVideoTrack = null; // current outgoing video (camera or screen)
let screenStream = null;
let myName = '';
let myId = null;
let roomId = null;
let presentingId = null;

// UI refs
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const statusDiv = document.getElementById('status');

const participantsList = document.getElementById('participants');
const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const sendChat = document.getElementById('sendChat');

const presentBanner = document.getElementById('presentBanner');
const presenterName = document.getElementById('presenterName');

const largeVideo = document.getElementById('largeVideo');
const videoGrid = document.getElementById('videoGrid');

const toggleAudioBtn = document.getElementById('toggleAudio');
const toggleVideoBtn = document.getElementById('toggleVideo');
const shareBtn = document.getElementById('shareBtn');
const stopShareBtn = document.getElementById('stopShareBtn');

// ICE servers (add TURN for production)
const ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// helpers
function uid(n=6){ return Math.random().toString(36).slice(2,2+n); }
function toast(msg){ console.log('[toast]', msg); /* optionally show UI toast */ }

// UI helpers
function addParticipantItem(id, name){
  removeParticipantItem(id);
  const li = document.createElement('li');
  li.id = 'part-'+id;
  li.className = 'participant';
  li.innerHTML = `<div class="avatar">${name.split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase()}</div>
    <div style="flex:1">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><strong>${name}</strong></div>
        <div id="media-${id}" class="badge" style="font-size:12px;color:var(--muted)">—</div>
      </div>
    </div>`;
  participantsList.appendChild(li);
}
function removeParticipantItem(id){ const e=document.getElementById('part-'+id); if(e) e.remove(); }
function updateParticipantMedia(id,audio,video){ const b=document.getElementById('media-'+id); if(b) b.textContent = (audio? 'Mic':'Muted') + ' • ' + (video? 'Cam':'No Cam'); }

// video grid
function createTile(id, label){
  removeTile(id);
  const wrapper = document.createElement('div');
  wrapper.className = 'tile';
  wrapper.id = 'tile-'+id;

  const v = document.createElement('video');
  v.autoplay = true; v.playsInline = true; v.id = 'video-'+id;

  const lbl = document.createElement('div');
  lbl.className = 'label';
  lbl.textContent = label || id;

  wrapper.appendChild(v);
  wrapper.appendChild(lbl);
  wrapper.addEventListener('click', ()=> {
    setLargeVideo(id, label);
  });

  videoGrid.appendChild(wrapper);
  return { wrapper, videoEl: v, lbl };
}
function removeTile(id){ const t=document.getElementById('tile-'+id); if(t) t.remove(); }
function setTileStream(id, stream){
  const v = document.getElementById('video-'+id);
  if(v) v.srcObject = stream;
  else {
    const tile = createTile(id, peers[id] && peers[id].name);
    tile.videoEl.srcObject = stream;
  }
}
function setLargeVideo(id, label){
  largeVideo.innerHTML = '';
  if(id === 'local'){
    if(localStream){
      const v = document.createElement('video'); v.autoplay=true; v.playsInline=true; v.muted=true; v.srcObject = localStream;
      largeVideo.appendChild(v);
      presenterName.textContent = label || 'Bạn';
      presentBanner.classList.remove('hidden');
    }
    return;
  }
  const vSrc = document.getElementById('video-'+id);
  if(vSrc && vSrc.srcObject){
    const clone = document.createElement('video'); clone.autoplay=true; clone.playsInline=true; clone.srcObject = vSrc.srcObject;
    largeVideo.appendChild(clone);
    presenterName.textContent = label || (peers[id] && peers[id].name) || id;
    presentBanner.classList.remove('hidden');
  }
}
function clearLarge(){ largeVideo.innerHTML=''; presentBanner.classList.add('hidden'); }

// signaling handlers
socket.on('connect', ()=> {
  myId = socket.id;
  console.log('socket connected', myId);
});

socket.on('all-users', (users) => {
  // users = [{id,name}, ...] existing in room
  users.forEach(u=>{
    addParticipantItem(u.id, u.name);
    // create peer as initiator (newcomer creates offers to existing users)
    createPeer(u.id, true);
  });
});

socket.on('user-joined', ({ id, name }) => {
  addParticipantItem(id, name);
  // create peer non-initiator? We'll let the new user create offers (the newcomer created offers above).
  // But to be robust createPeer(false) so we can accept signaling
  createPeer(id, false);
  toast(`${name} joined`);
});

socket.on('signal', (data) => {
  const from = data.from;
  if(!peers[from]) createPeer(from, false);
  try { peers[from].peer.signal(data.signal); } catch(e){ console.warn('signal apply err', e); }
});

socket.on('user-left', ({ id, name }) => {
  if(peers[id]) { try{ peers[id].peer.destroy(); } catch(e){} delete peers[id]; }
  removeTile(id);
  removeParticipantItem(id);
  toast(`${name || id} left`);
  if(presentingId === id){ presentingId = null; clearLarge(); }
});

socket.on('start-present', ({ id, name }) => {
  presentingId = id;
  presenterName.textContent = name || id;
  presentBanner.classList.remove('hidden');
  // if we already have their stream, spotlight it
  if(peers[id] && peers[id].stream) setLargeVideo(id, peers[id].name);
});

socket.on('stop-present', ({ id }) => {
  if(presentingId === id) {
    presentingId = null;
    clearLarge();
  }
});

socket.on('media-update', ({ id, audio, video }) => {
  updateParticipantMedia(id, audio, video);
});

socket.on('chat', ({ id, name, text }) => {
  const d = document.createElement('div'); d.innerHTML = `<b>${name}:</b> ${text}`;
  chatBox.appendChild(d); chatBox.scrollTop = chatBox.scrollHeight;
});

// Peer creation
function createPeer(peerId, initiator=false){
  if(peers[peerId]) return peers[peerId].peer;
  // create SimplePeer with current localStream
  const sp = new SimplePeer({ initiator, trickle: false, stream: localStream, config: ICE_CONFIG });
  peers[peerId] = { peer: sp, name: peerId, stream: null };

  sp.on('signal', data => {
    socket.emit('signal', { to: peerId, from: myId || socket.id, signal: data });
  });

  sp.on('stream', stream => {
    peers[peerId].stream = stream;
    createTile(peerId, peers[peerId].name);
    setTileStream(peerId, stream);
    // if presenter flag matches, show large
    if(presentingId === peerId) setLargeVideo(peerId, peers[peerId].name);
  });

  sp.on('close', ()=> {
    removeTile(peerId);
    removeParticipantItem(peerId);
    delete peers[peerId];
  });

  sp.on('error', err => console.warn('peer err', err));

  return sp;
}

// join / leave / UI flow
joinBtn.addEventListener('click', async () => {
  if(!roomInput.value.trim()) return alert('Nhập Room ID');
  if(!nameInput.value.trim()) nameInput.value = 'User-'+uid(3);
  myName = nameInput.value.trim();
  roomId = roomInput.value.trim();

  // get camera + mic
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch(e) {
    alert('Cần cấp quyền camera/micro: '+ e.message);
    return;
  }

  // store camera track
  cameraTrack = localStream.getVideoTracks()[0];
  currentVideoTrack = cameraTrack;

  // show local tile
  createTile('local', myName + ' (Bạn)');
  const v = document.getElementById('video-local');
  const localVideoEl = document.querySelector('#tile-local video') || document.querySelector('#video-local');
  // set local video (muted)
  const tile = document.getElementById('tile-local');
  if(tile){
    const vid = tile.querySelector('video');
    vid.muted = true;
    vid.srcObject = localStream;
  }

  // enable controls
  joinBtn.disabled = true;
  leaveBtn.disabled = false;
  statusDiv.textContent = 'Đã kết nối';

  // emit join
  socket.emit('join', { roomId, name: myName });
  myId = socket.id || myId;

  // add self to participant list
  addParticipantItem(myId, myName);
  updateParticipantMedia(myId, true, true);
});

// Leave
leaveBtn.addEventListener('click', () => {
  // close peers
  for(const id in peers){
    try{ peers[id].peer.destroy(); } catch(e){}
    removeTile(id);
  }
  if(localStream) localStream.getTracks().forEach(t=>t.stop());
  socket.disconnect();
  location.reload();
});

// toggles
toggleAudioBtn.addEventListener('click', () => {
  if(!localStream) return;
  const t = localStream.getAudioTracks()[0];
  if(!t) return;
  t.enabled = !t.enabled;
  socket.emit('media-update', { audio: t.enabled, video: (localStream.getVideoTracks()[0]||{}).enabled });
  updateParticipantMedia(myId, t.enabled, (localStream.getVideoTracks()[0]||{}).enabled);
});

toggleVideoBtn.addEventListener('click', () => {
  if(!localStream) return;
  const t = localStream.getVideoTracks()[0];
  if(!t) return;
  t.enabled = !t.enabled;
  socket.emit('media-update', { audio: (localStream.getAudioTracks()[0]||{}).enabled, video: t.enabled });
  updateParticipantMedia(myId, (localStream.getAudioTracks()[0]||{}).enabled, t.enabled);
});

// chat
sendChat.addEventListener('click', ()=> {
  const text = chatInput.value.trim();
  if(!text) return;
  socket.emit('chat', { text });
  const d = document.createElement('div'); d.innerHTML = `<b>Bạn:</b> ${text}`;
  chatBox.appendChild(d); chatBox.scrollTop = chatBox.scrollHeight;
  chatInput.value = '';
});

// Presentation (screen share)
shareBtn.addEventListener('click', async () => {
  if(!localStream) return;
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];

    // replace outgoing track for existing peers
    for(const pid in peers){
      const pc = peers[pid].peer._pc; // simple-peer internal RTCPeerConnection
      if(!pc) continue;
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if(sender) {
        try { sender.replaceTrack(screenTrack); } catch(e){ console.warn('replaceTrack err', e); }
      } else {
        try { pc.addTrack(screenTrack, localStream); } catch(e){}
      }
    }

    // update localStream: remove old video track(s) and add screenTrack so new peers get screen
    localStream.getVideoTracks().forEach(t => localStream.removeTrack(t));
    localStream.addTrack(screenTrack);
    currentVideoTrack = screenTrack;

    // show present (local)
    setLargeVideo('local', myName + ' (Trình bày)');
    presentingId = myId;
    socket.emit('start-present');

    // UI
    shareBtn.disabled = true;
    stopShareBtn.disabled = false;

    screenTrack.onended = () => {
      stopShare();
    };
  } catch(e){
    console.warn('share canceled', e);
  }
});

async function stopShare(){
  if(!screenStream) return;
  // restore camera: try to get new camera track (some browsers require re-get)
  try {
    const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
    const newCam = camStream.getVideoTracks()[0];

    // replace for peers
    for(const pid in peers){
      const pc = peers[pid].peer._pc;
      if(!pc) continue;
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if(sender) {
        try { await sender.replaceTrack(newCam); } catch(e){ console.warn('replace back err', e); }
      } else {
        try { pc.addTrack(newCam, localStream); } catch(e){}
      }
    }

    // update localStream tracks
    localStream.getVideoTracks().forEach(t => localStream.removeTrack(t));
    localStream.addTrack(newCam);
    currentVideoTrack = newCam;
  } catch(err){
    console.warn('restore cam failed', err);
  }

  // stop screenStream tracks
  try { screenStream.getTracks().forEach(t => t.stop()); } catch(e){}
  screenStream = null;
  socket.emit('stop-present');
  shareBtn.disabled = false;
  stopShareBtn.disabled = true;
  presentingId = null;
  clearLarge();
}

// utility: when new peer appears and we need to ensure they get current localStream (which might be screen)
socket.on('connect', ()=> {
  myId = socket.id;
});
///////////////////////////////
// ===== TOGGLE MIC / CAM ====
///////////////////////////////
const toggleAudioBtn = document.getElementById("toggleAudio");
const toggleVideoBtn = document.getElementById("toggleVideo");
const micIcon = document.getElementById("micIcon");
const camIcon = document.getElementById("camIcon");

let audioEnabled = true;
let videoEnabled = true;

// MIC
toggleAudioBtn.onclick = () => {
  audioEnabled = !audioEnabled;
  localStream.getAudioTracks()[0].enabled = audioEnabled;

  if(audioEnabled){
    toggleAudioBtn.classList.remove("off");
    micIcon.classList.remove("fa-microphone-slash");
    micIcon.classList.add("fa-microphone");
  } else {
    toggleAudioBtn.classList.add("off");
    micIcon.classList.remove("fa-microphone");
    micIcon.classList.add("fa-microphone-slash");
  }
}

// CAM
toggleVideoBtn.onclick = () => {
  videoEnabled = !videoEnabled;
  localStream.getVideoTracks()[0].enabled = videoEnabled;

  if(videoEnabled){
    toggleVideoBtn.classList.remove("off");
    camIcon.classList.remove("fa-video-slash");
    camIcon.classList.add("fa-video");
  } else {
    toggleVideoBtn.classList.add("off");
    camIcon.classList.remove("fa-video");
    camIcon.classList.add("fa-video-slash");
  }
}
