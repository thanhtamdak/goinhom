import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 10000 });

let rooms = {}; // roomId → { users: Set, presenterId }

wss.on("connection", (ws) => {
    ws.on("message", (msg) => {
        const data = JSON.parse(msg);

        switch (data.type) {

            case "join":
                ws.userId = data.userId;
                ws.roomId = data.roomId;

                if (!rooms[data.roomId]) {
                    rooms[data.roomId] = { users: new Set(), presenterId: null };
                }

                rooms[data.roomId].users.add(ws);

                // gửi danh sách user hiện tại
                rooms[data.roomId].users.forEach(u => {
                    if (u !== ws) {
                        u.send(JSON.stringify({
                            type: "new-user",
                            userId: ws.userId
                        }));
                    }
                });

                // trả lại danh sách user cho người mới
                ws.send(JSON.stringify({
                    type: "users-list",
                    users: [...rooms[data.roomId].users].map(x => x.userId),
                    presenter: rooms[data.roomId].presenterId
                }));
                break;

            case "offer":
            case "answer":
            case "candidate":
                broadcastToUser(ws.roomId, data.to, data);
                break;

            case "start-present":
                rooms[data.roomId].presenterId = data.userId;
                broadcast(ws.roomId, { type: "presenter-start", userId: data.userId });
                break;

            case "stop-present":
                rooms[data.roomId].presenterId = null;
                broadcast(ws.roomId, { type: "presenter-stop" });
                break;
        }
    });

    ws.on("close", () => {
        let room = rooms[ws.roomId];
        if (!room) return;

        room.users.delete(ws);

        broadcast(ws.roomId, { type: "user-left", userId: ws.userId });

        if (room.users.size === 0) delete rooms[ws.roomId];
    });
});

function broadcast(roomId, data) {
    if (!rooms[roomId]) return;
    rooms[roomId].users.forEach(u => u.send(JSON.stringify(data)));
}

function broadcastToUser(roomId, userId, data) {
    rooms[roomId].users.forEach(u => {
        if (u.userId === userId) {
            u.send(JSON.stringify(data));
        }
    });
}

console.log("Signaling server running on port 10000");
