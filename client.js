const roomId = "room1";
const userId = "u" + Math.floor(Math.random() * 99999);

const SIGNALING_URL = "wss://<YOUR-RENDER-URL>.onrender.com";

const ws = new WebSocket(SIGNALING_URL);
let peers = {};
let localStream;
let shareStream;
let isPresenting = false;

const videos = document.getElementById("videos");
const presentation = document.getElementById("presentation");
const presentationVideo = document.getElementById("presentationVideo");

ws.onopen = () => {
    ws.send(JSON.stringify({ type: "join", roomId, userId }));
};

ws.onmessage = async (msg) => {
    const data = JSON.parse(msg.data);

    switch (data.type) {

        case "users-list":
            data.users.forEach(uid => {
                if (uid !== userId) createPeer(uid);
            });

            if (data.presenter) {
                presentation.style.display = "block";
            }
            break;

        case "new-user":
            createPeer(data.userId);
            break;

        case "offer":
            await peers[data.from].pc.setRemoteDescription(data.sdp);
            const answer = await peers[data.from].pc.createAnswer();
            await peers[data.from].pc.setLocalDescription(answer);

            ws.send(JSON.stringify({
                type: "answer",
                to: data.from,
                from: userId,
                sdp: answer,
                roomId
            }));
            break;

        case "answer":
            peers[data.from].pc.setRemoteDescription(data.sdp);
            break;

        case "candidate":
            peers[data.from].pc.addIceCandidate(data.candidate);
            break;

        case "presenter-start":
            presentation.style.display = "block";
            break;

        case "presenter-stop":
            presentation.style.display = "none";
            presentationVideo.srcObject = null;
            break;

        case "user-left":
            if (peers[data.userId]) {
                peers[data.userId].pc.close();
                document.getElementById("v" + data.userId)?.remove();
                delete peers[data.userId];
            }
            break;
    }
};

async function initMedia() {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

    addVideo(userId, localStream);

    Object.values(peers).forEach(p => {
        localStream.getTracks().forEach(t => p.pc.addTrack(t, localStream));
    });
}

initMedia();

function createPeer(remoteId) {
    const pc = new RTCPeerConnection();

    peers[remoteId] = { pc };

    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.onicecandidate = e => {
        if (e.candidate)
            ws.send(JSON.stringify({
                type: "candidate",
                to: remoteId,
                from: userId,
                candidate: e.candidate,
                roomId
            }));
    };

    pc.ontrack = e => {
        if (isPresenting && remoteId !== userId) {
            presentationVideo.srcObject = e.streams[0];
        } else {
            addVideo(remoteId, e.streams[0]);
        }
    };

    negotiate(remoteId);
}

async function negotiate(remoteId) {
    const pc = peers[remoteId].pc;

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    ws.send(JSON.stringify({
        type: "offer",
        to: remoteId,
        from: userId,
        sdp: offer,
        roomId
    }));
}

function addVideo(id, stream) {
    let v = document.getElementById("v" + id);
    if (!v) {
        v = document.createElement("video");
        v.id = "v" + id;
        v.autoplay = true;
        v.playsinline = true;
        videos.appendChild(v);
    }
    v.srcObject = stream;
}

async function startShare() {
    shareStream = await navigator.mediaDevices.getDisplayMedia({ video: true });

    isPresenting = true;
    presentationVideo.srcObject = shareStream;
    presentation.style.display = "block";

    Object.values(peers).forEach(p => {
        shareStream.getTracks().forEach(t => p.pc.addTrack(t, shareStream));
    });

    ws.send(JSON.stringify({ type: "start-present", roomId, userId }));

    shareStream.getVideoTracks()[0].onended = stopShare;
}

function stopShare() {
    if (!shareStream) return;

    shareStream.getTracks().forEach(t => t.stop());
    isPresenting = false;

    presentation.style.display = "none";

    ws.send(JSON.stringify({ type: "stop-present", roomId, userId }));
}
