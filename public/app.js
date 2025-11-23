const socket = io();
const peers = {};
let localStream;
let currentShareStream = null;

const videoGrid = document.getElementById("video-grid");

async function start() {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    addVideo("Bạn", localStream);

    const ROOM_ID = "room1";
    const USER_ID = Math.random().toString(36).substring(2, 10);

    socket.emit("join-room", ROOM_ID, USER_ID);

    socket.on("user-joined", (userId) => {
        callUser(userId);
    });

    socket.on("signal", async (data) => {
        if (!peers[data.from]) await callUser(data.from);
        peers[data.from].signal(data.signal);
    });

    socket.on("user-left", (userId) => {
        if (peers[userId]) {
            peers[userId].destroy();
            delete peers[userId];
        }
        removeVideo(userId);
    });

    // Khi có người bắt đầu chia sẻ
    socket.on("start-share", async (userId) => {
        console.log("User share:", userId);
    });

    // Khi người trình bày dừng chia sẻ
    socket.on("stop-share", async (userId) => {
        console.log("User stop sharing:", userId);
    });
}

start();

function callUser(userId) {
    const peer = new SimplePeer({
        initiator: true,
        trickle: false,
        stream: currentShareStream || localStream
    });

    peer.on("signal", (signal) => {
        socket.emit("signal", { to: userId, from: socket.id, signal });
    });

    peer.on("stream", (stream) => {
        addVideo(userId, stream);
    });

    peers[userId] = peer;
}

function addVideo(id, stream) {
    removeVideo(id);
    const video = document.createElement("video");
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    video.id = "video-" + id;
    videoGrid.appendChild(video);
}

function removeVideo(id) {
    const vid = document.getElementById("video-" + id);
    if (vid) vid.remove();
}

// ======== TRÌNH BÀY (Screen Share) ==========

async function startShare() {
    currentShareStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    
    for (let id in peers) {
        let sender = peers[id]._pc.getSenders().find(s => s.track.kind === "video");
        sender.replaceTrack(currentShareStream.getVideoTracks()[0]);
    }

    addVideo("Bạn (Share)", currentShareStream);
    socket.emit("start-share", socket.id);

    currentShareStream.getVideoTracks()[0].onended = stopShare;
}

function stopShare() {
    for (let id in peers) {
        let sender = peers[id]._pc.getSenders().find(s => s.track.kind === "video");
        sender.replaceTrack(localStream.getVideoTracks()[0]);
    }

    removeVideo("Bạn (Share)");
    currentShareStream = null;
    socket.emit("stop-share", socket.id);
}

document.getElementById("btnShare").onclick = startShare;
