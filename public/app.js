// app.js — Meet Mini (advanced)
// Requires: socket.io client (served at /socket.io/socket.io.js) and simple-peer

const socket = io(); // connects to same host
const peers = {}; // peerId -> { peer, el, name, audio, video }
let localStream = null;
let shareStream = null;
let localId = null;
let roomId = null;
let pinnedId = null; // if pinned, show in large area
let presentingId = null;

// UI refs
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

// ICE - optionally add TURN servers here
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// ---------- utilities ----------
function toastMsg(txt, timeout=3000){
  toast.textContent = txt;
  toast.classList.remove('hidden');
  setTimeout(()=> toast.classList.add('hidden'), timeout);
}
function uid(){ return Math.random().toString(36).slice(2,9); }
function getInitials(name='User'){ return name.split(' ').map(s=>s[0]).join('').slice(0,2).toUpperCase(); }

// ---------- UI helpers ----------
function createParticipantItem(id, name, audio=true, video=true){
  removeParticipantItem(id);
  const li = document.createElement('li'); li.id = 'part-'+id; li.className='participant';
  const avatar = document.createElement('div'); avatar.className='avatar'; avatar.textContent = getInitials(name);
  const meta = document.createElement('div'); meta.className='part-meta';
  const top = document.createElement('div'); top.className='meta-top';
  const nm = document.createElement('div'); nm.textContent = name;
  const badge = document.createElement('div'); badge.className='badge';
  badge.id = 'badge-'+id; badge.textContent = (audio? 'Mic' : 'Muted') + ' • ' + (video? 'Cam' : 'No Cam');
  top.appendChild(nm); top.appendChild(badge);
  meta.appendChild(top);
  li.appendChild(avatar); li.appendChild(meta);
  participantsList.appendChild(li);
}
function removeParticipantItem(id){
  const e = document.getElementById('part-'+id); if(e) e.remove();
}
function updateParticipantBadge(id, audio, video){
  const b = document.getElementById('badge-'+id); if(b) b.textContent = (audio? 'Mic' : 'Muted') + ' • ' + (video? 'Cam' : 'No Cam');
}

// create thumbnail tile
function createTile(id, name){
  removeTile(id);
  const wrapper = document.createElement('div'); wrapper.className='tile'; wrapper.id='tile-'+id;
  const v = document.createElement('video'); v.autoplay=true; v.playsInline=true; v.id='video-'+id;
  const overlay = document.createElement('div'); overlay.className='tile-overlay';
  const nameSpan = document.createElement('span'); nameSpan.textContent = name || id;
  const ind = document.createElement('span'); ind.className='badge-ind'; ind.id='ind-'+id; ind.textContent = '';
  overlay.appendChild(nameSpan); overlay.appendChild(ind);
  wrapper.appendChild(v); wrapper.appendChild(overlay);

  // click to pin
  wrapper.addEventListener('click', ()=> {
    pinUser(id);
  });

  thumbGrid.appendChild(wrapper);
  return { wrapper, video: v, overlay, ind };
}
function removeTile(id){
  const el = document.getElementById('tile-'+id); if(el) el.remove();
  const vid = document.getElementById('video-'+id);
  if(vid && vid.srcObject) vid.srcObject = null;
}
function showLargeStream(stream, id, name){
  largeArea.innerHTML = '';
  const v = document.createElement('video'); v.autoplay=true; v.playsInline=true; v.controls=false;
  v.srcObject = stream;
  if(id === localId) v.muted = true;
  largeArea.appendChild(v);
  // banner
  presenterName.textContent = name || id;
  presentBanner.classList.remove('hidden');
}
function clearLarge(){
  largeArea.innerHTML = '';
  presentBanner.classList.add('hidden');
}

// ---------- signaling handlers ----------
socket.on('connect', ()=> {
  console.log('socket connected', socket.id);
});

socket.on('all-users', (peersList) => {
  // peersList: [{id,name}, ...] existing users in room
  for(const p of peersList){
    createParticipantItem(p.id, p.name, true, true);
    createPeer(p.id, true); // initiator = true -> create offer
  }
});

socket.on('user-joined', ({ id, name }) => {
  createParticipantItem(id, name, true, true);
  toastMsg(`${name} đã tham gia`);
  // createPeer(id, true) will be created by the new client as initiator, but to be safe we create offer
  createPeer(id, true);
});

socket.on('signal', async (data) => {
  const { from, signal } = data;
  if(!peers[from]) {
    // create peer (not initiator) to handle offer
    createPeer(from, false);
  }
  try {
    peers[from].peer.signal(signal);
  } catch(e){
    console.warn('signal error', e);
  }
});

socket.on('user-left', ({ id, name }) => {
  if(peers[id]){
    try{ peers[id].peer.destroy(); } catch(e){}
    delete peers[id];
  }
  removeTile(id);
  removeParticipantItem(id);
  toastMsg(`${name || id} đã rời`);
  if(pinnedId === id){ pinnedId = null; clearLarge(); }
  if(presentingId === id){ presentingId = null; clearLarge(); }
});

socket.on('update-media', ({ userId, audio, video }) => {
  if(peers[userId]){
    peers[userId].audio = audio;
    peers[userId].video = video;
    updateParticipantBadge(userId, audio, video);
    const ind = document.getElementById('ind-'+userId);
    if(ind) ind.textContent = (audio? '🎤':'🔇') + ' ' + (video? '':'🚫');
  }
});

socket.on('start-share', ({ userId }) => {
  presentingId = userId;
  toastMsg('Đang trình bày: ' + userId);
  // spotlight that user's stream into large
  if(peers[userId] && peers[userId].stream){
    showLargeStream(peers[userId].stream, userId, peers[userId].name);
  } else if(userId === localId && localStream){
    showLargeStream(localStream, localId, 'Bạn');
  }
});

socket.on('stop-share', ({ userId }) => {
  if(presentingId === userId){
    presentingId = null;
    clearLarge();
  }
});

socket.on('chat', ({ from, name, text }) => {
  const d = document.createElement('div'); d.innerHTML = `<b>${name}:</b> ${text}`; chatBox.appendChild(d); chatBox.scrollTop = chatBox.scrollHeight;
});

// ---------- Peer creation ----------
function createPeer(peerId, initiator=false){
  if(peers[peerId]) return;
  const p = new SimplePeer({ initiator, trickle: false, stream: localStream, config: ICE });
  peers[peerId] = { peer: p, name: 'User-'+peerId, audio: true, video: true, stream: null };

  // when SimplePeer creates signal (offer/answer)
  p.on('signal', data => {
    socket.emit('signal', { to: peerId, from: localId, signal: data });
  });

  // when remote stream arrives
  p.on('stream', (stream) => {
    peers[peerId].stream = stream;
    // show tile and participants
    const tile = createTile(peerId, peers[peerId].name);
    tile.video.srcObject = stream;
    updateParticipantBadge(peerId, peers[peerId].audio, peers[peerId].video);
    // if presenting currently, if this peer is presenter show large
    if(presentingId === peerId) showLargeStream(stream, peerId, peers[peerId].name);
  });

  p.on('close', ()=> {
    if(peers[peerId]) delete peers[peerId];
    removeTile(peerId);
    removeParticipantItem(peerId);
  });

  p.on('error', (e)=> console.warn('peer err', e));
  return p;
}

// ---------- UI actions ----------
btnJoin.addEventListener('click', async () => {
  if(!roomInput.value.trim()) return alert('Nhập Room ID');
  if(!nameInput.value.trim()) nameInput.value = 'User-'+uid();
  roomId = roomInput.value.trim();

  // get local media
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch(e){
    alert('Không thể truy cập camera/micro: ' + e.message);
    return;
  }

  // show local tile
  const localTile = createTile('local-'+uid(), nameInput.value + ' (Bạn)');
  localTile.video.muted = true;
  localTile.video.srcObject = localStream;

  // set localId after socket connects
  localId = socket.id || uid();
  // join server room
  socket.emit('join', { roomId, name: nameInput.value });

  btnJoin.disabled = true;
  btnLeave.disabled = false;
  toastMsg('Bạn đã vào phòng');
});

// leave
btnLeave.addEventListener('click', ()=> {
  // close peers
  for(const id in peers){
    try{ peers[id].peer.destroy(); }catch(e){}
    removeTile(id);
  }
  if(localStream) localStream.getTracks().forEach(t=>t.stop());
  socket.disconnect();
  location.reload();
});

// mic/cam toggles
btnMic.addEventListener('click', () => {
  if(!localStream) return;
  const t = localStream.getAudioTracks()[0];
  if(!t) return;
  t.enabled = !t.enabled;
  btnMic.querySelector('.material-icons')?.classList; // no icon
  socket.emit('update-media', { userId: localId, audio: t.enabled, video: (localStream.getVideoTracks()[0]||{}).enabled });
  updateParticipantBadge(localId, t.enabled, (localStream.getVideoTracks()[0]||{}).enabled);
});
btnCam.addEventListener('click', () => {
  if(!localStream) return;
  const t = localStream.getVideoTracks()[0];
  if(!t) return;
  t.enabled = !t.enabled;
  socket.emit('update-media', { userId: localId, audio: (localStream.getAudioTracks()[0]||{}).enabled, video: t.enabled });
  updateParticipantBadge(localId, (localStream.getAudioTracks()[0]||{}).enabled, t.enabled);
});

// screen share
btnShare.addEventListener('click', async () => {
  if(!localStream) return;
  try{
    shareStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = shareStream.getVideoTracks()[0];

    // replace each peer's sender track
    for(const id in peers){
      const pc = peers[id].peer._pc;
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if(sender) sender.replaceTrack(screenTrack);
    }

    // show large area local
    showLargeStream(shareStream, localId, nameInput.value + ' (Trình bày)');
    socket.emit('start-share');
    btnStopShare.disabled = false;
    btnShare.disabled = true;
    presentingId = localId;

    screenTrack.onended = ()=> {
      stopShare();
    };

  }catch(e){ console.warn('share failed', e); }
});

btnStopShare.addEventListener('click', stopShare);

async function stopShare(){
  if(!shareStream) return;
  // restore camera track
  const camTrack = localStream.getVideoTracks()[0];
  for(const id in peers){
    const pc = peers[id].peer._pc;
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if(sender) {
      try{ await sender.replaceTrack(camTrack); } catch(e){ console.warn(e); }
    }
  }
  // stop screen tracks
  shareStream.getTracks().forEach(t=>t.stop());
  shareStream = null;
  socket.emit('stop-share');
  btnStopShare.disabled = true;
  btnShare.disabled = false;
  presentingId = null;
  clearLarge();
}

// pin user (toggle)
btnPin.addEventListener('click', ()=> {
  if(!pinnedId) return;
  // unpin
  pinnedId = null;
  clearLarge();
});

// click tile pins user (handled in createTile -> pinUser)
function pinUser(id){
  pinnedId = id;
  // if local pinned, show local stream; else show peer stream
  if(id === localId){
    showLargeStream(localStream, localId, nameInput.value);
  } else if(peers[id] && peers[id].stream){
    showLargeStream(peers[id].stream, id, peers[id].name);
  }
}

// chat
sendChat.addEventListener('click', ()=> {
  const text = chatInput.value.trim();
  if(!text) return;
  socket.emit('chat', { text });
  const d = document.createElement('div'); d.innerHTML = `<b>Bạn:</b> ${text}`; chatBox.appendChild(d); chatBox.scrollTop = chatBox.scrollHeight;
  chatInput.value = '';
});

// When socket receives 'signal' we already handle above

// helper: when socket obtains own id (socket.id) after connect - capture it
socket.on('connect', ()=> {
  localId = socket.id;
});

// ensure that when 'all-users' arrives, their peers created
// handled above in socket.on('all-users')

