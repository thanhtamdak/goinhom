// Basic WebRTC logic placeholder
const SIGNALING_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:3000`;
let localStream;
const peers = {};

const videoGrid = document.getElementById('videoGrid');
const joinBtn = document.getElementById('joinBtn');
const roomInput = document.getElementById('roomInput');
const statusDiv = document.getElementById('status');

const toggleAudioBtn = document.getElementById('toggleAudio');
const toggleVideoBtn = document.getElementById('toggleVideo');
const shareScreenBtn = document.getElementById('shareScreen');
const stopScreenBtn = document.getElementById('stopScreen');
const leaveRoomBtn = document.getElementById('leaveRoom');

let ws, roomId;

// Helpers
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

// Connect WebSocket
function connectWS(){
  ws = new WebSocket(SIGNALING_URL);
  ws.onopen = ()=> statusDiv.innerText = 'Connected to signaling server';
  ws.onmessage = async (msg)=>{
    const data = JSON.parse(msg.data);
    console.log('WS message', data);
    // TODO: handle offer/answer/ice/new-peer/leave
  };
}

// Join Room
joinBtn.onclick = async ()=>{
  if(!roomInput.value) return alert('Nhập Room ID');
  roomId = roomInput.value;
  await initLocalStream();
  connectWS();
  ws.onopen = ()=> {
    ws.send(JSON.stringify({ type:'join', room:roomId }));
  };
};

// Toggle controls
toggleAudioBtn.onclick = ()=> {
  localStream.getAudioTracks().forEach(t=> t.enabled = !t.enabled);
};
toggleVideoBtn.onclick = ()=> {
  localStream.getVideoTracks().forEach(t=> t.enabled = !t.enabled);
};
shareScreenBtn.onclick = async ()=>{
  const screenStream = await navigator.mediaDevices.getDisplayMedia({ video:true });
  const screenTrack = screenStream.getVideoTracks()[0];
  const videoTrack = localStream.getVideoTracks()[0];
  // Replace track logic placeholder
};
stopScreenBtn.onclick = ()=>{
  // Restore camera logic placeholder
};
leaveRoomBtn.onclick = ()=>{
  Object.keys(peers).forEach(id=>{/* close peer connections */});
  removeVideo('localVideo');
  ws.send(JSON.stringify({ type:'leave' }));
};
