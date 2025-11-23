let localStream;
const peers = {};
let ws, roomId;

const videoGrid = document.getElementById('videoGrid');
const joinBtn = document.getElementById('joinBtn');
const roomInput = document.getElementById('roomInput');
const statusDiv = document.getElementById('status');

const toggleAudioBtn = document.getElementById('toggleAudio');
const toggleVideoBtn = document.getElementById('toggleVideo');
const shareScreenBtn = document.getElementById('shareScreen');
const stopScreenBtn = document.getElementById('stopScreen');
const leaveRoomBtn = document.getElementById('leaveRoom');

// Use dynamic URL: works on Render/Railway
const SIGNALING_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

// Add video element
function addVideo(stream, id, muted=false){
  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.id = id;
  video.muted = muted;
  videoGrid.appendChild(video);
}
function removeVideo(id){
  const video = document.getElementById(id);
  if(video) video.remove();
}

// Get local media
async function initLocalStream(){
  localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
  addVideo(localStream, 'localVideo', true);
}

// WebSocket connect
function connectWS(){
  ws = new WebSocket(SIGNALING_URL);
  ws.onopen = ()=> statusDiv.innerText = 'Connected to signaling server';
  ws.onmessage = async (msg)=>{
    const data = JSON.parse(msg.data);
    // handle signaling messages here (offer/answer/ice/new-peer/leave)
    console.log('WS message:', data);
  };
}

// Join Room
joinBtn.onclick = async ()=>{
  if(!roomInput.value) return alert('Nhập Room ID');
  roomId = roomInput.value;
  await initLocalStream();
  connectWS();
  ws.onopen = ()=> ws.send(JSON.stringify({ type:'join', room:roomId }));
};

// Controls
toggleAudioBtn.onclick = ()=> localStream.getAudioTracks().forEach(t=> t.enabled=!t.enabled);
toggleVideoBtn.onclick = ()=> localStream.getVideoTracks().forEach(t=> t.enabled=!t.enabled);

shareScreenBtn.onclick = async ()=>{
  const screenStream = await navigator.mediaDevices.getDisplayMedia({ video:true });
  const screenTrack = screenStream.getVideoTracks()[0];
  const videoTrack = localStream.getVideoTracks()[0];
  localStream.removeTrack(videoTrack);
  localStream.addTrack(screenTrack);
  addVideo(screenStream, 'screenVideo', true);
  // TODO: replaceTrack for all peers
};

stopScreenBtn.onclick = ()=>{
  // TODO: replace back camera track
  removeVideo('screenVideo');
};

leaveRoomBtn.onclick = ()=>{
  Object.keys(peers).forEach(id=>{/* close peer connections */});
  removeVideo('localVideo');
  ws.send(JSON.stringify({ type:'leave' }));
};
