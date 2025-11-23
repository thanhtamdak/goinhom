const socket = io();
const peers = {};
let localStream;
let shareStream = null;

const videoGrid = document.getElementById("video-grid");
const chatBox = document.getElementById("chat-box");
const messages = document.getElementById("messages");

const USER_ID = Math.random().toString(36).substring(2, 9);
const NAME = "User_" + USER_ID;
const ROOM_ID = "room1";

async function startVideo() {
    localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
    });

    addVideo(USER_ID, NAME, localStream);
    
    socket.emit("join-room", ROOM_ID, USER_ID, NAME);
}

startVideo();

// ------- Khi một user mới vào ------
socket.on("user-joined", ({ userId, name }) => {
    callUser(userId);
});

// -------- Nhận tín hiệu WebRTC ------
socket.on("signal", async (data) => {
    if (!peers[data.from]) callUser(data.from);
    peers[data.from].signal(data.signal);
});

// -------- Khi ai đó rời phòng ------
socket.on("user-left", (userId) => {
    removeVideo(userId);
    if (peers[userId]) peers[userId].destroy();
    delete peers[userId];
});

// ================= VIDEO GRID UI ===================
function addVideo(id, name, stream) {
    removeVideo(id);
    const box = document.createElement("div");
    box.className = "video-container";
    box.id = "box-" + id;

    const video = document.createElement("video");
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;

    const tag = document.createElement("div");
    tag.className = "name-tag";
    tag.innerText = name;

    box.appendChild(video);
    box.appendChild(tag);
    videoGrid.appendChild(box);
}

function removeVideo(id) {
    const el = document.getElementById("box-" + id);
    if (el) el.remove();
}

// ================== SimplePeer ==================
function callUser(userId) {
    const peer = new SimplePeer({
        initiator: true,
        trickle: false,
        stream: shareStream || localStream
    });

    peer.on("signal", signal => {
        socket.emit("signal", { to: userId, from: USER_ID, signal });
    });

    peer.on("stream", stream => {
        addVideo(userId, "User_" + userId, stream);
    });

    peers[userId] = peer;
}

// ============= MIC / CAMERA / SHARE ====================
document.getElementById("btnMic").onclick = () => {
    let track = localStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
    socket.emit("toggle-mic", track.enabled);
};

document.getElementById("btnCam").onclick = () => {
    let track = localStream.getVideoTracks()[0];
    track.enabled = !track.enabled;
    socket.emit("toggle-cam", track.enabled);
};

document.getElementById("btnShare").onclick = async () => {
    shareStream = await navigator.mediaDevices.getDisplayMedia({ video: true });

    for (let id in peers) {
        let sender = peers[id]._pc.getSenders().find(s => s.track.kind === "video");
        sender.replaceTrack(shareStream.getVideoTracks()[0]);
    }

    socket.emit("start-share");

    shareStream.getVideoTracks()[0].onended = stopShare;
};

function stopShare() {
    for (let id in peers) {
        let sender = peers[id]._pc.getSenders().find(s => s.track.kind === "video");
        sender.replaceTrack(localStream.getVideoTracks()[0]);
    }
    shareStream = null;
    socket.emit("stop-share");
}

// ================ CHAT ================
document.getElementById("btnChat").onclick = () => {
    chatBox.classList.toggle("hidden");
};

document.getElementById("chatInput").onkeydown = (e) => {
    if (e.key === "Enter") {
        let msg = e.target.value;
        e.target.value = "";
        socket.emit("message", msg);
    }
};

socket.on("message", ({ userId, name, msg }) => {
    let div = document.createElement("div");
    div.innerHTML = `<b>${name}:</b> ${msg}`;
    messages.appendChild(div);
});

// Rời phòng
document.getElementById("btnLeave").onclick = () => {
    window.location.reload();
};
