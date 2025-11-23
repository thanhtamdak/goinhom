const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static("public"));

io.on("connection", (socket) => {
    socket.on("join-room", (roomId, userId) => {
        socket.join(roomId);
        socket.to(roomId).emit("user-joined", userId);

        socket.on("signal", (data) => {
            socket.to(data.to).emit("signal", {
                from: data.from,
                signal: data.signal
            });
        });

        socket.on("start-share", (userId) => {
            socket.to(roomId).emit("start-share", userId);
        });

        socket.on("stop-share", (userId) => {
            socket.to(roomId).emit("stop-share", userId);
        });

        socket.on("disconnect", () => {
            io.to(roomId).emit("user-left", userId);
        });
    });
});

server.listen(3000, () => console.log("Server running on port 3000"));
