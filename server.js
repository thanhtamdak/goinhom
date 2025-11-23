const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static("public"));

io.on("connection", (socket) => {

    socket.on("join-room", (roomId, userId, name) => {
        socket.join(roomId);
        socket.userId = userId;
        socket.name = name;

        socket.to(roomId).emit("user-joined", { userId, name });

        socket.on("signal", (data) => {
            socket.to(data.to).emit("signal", { from: data.from, signal: data.signal });
        });

        socket.on("toggle-mic", (state) => {
            socket.to(roomId).emit("toggle-mic", { userId, state });
        });

        socket.on("toggle-cam", (state) => {
            socket.to(roomId).emit("toggle-cam", { userId, state });
        });

        socket.on("start-share", () => {
            socket.to(roomId).emit("start-share", userId);
        });

        socket.on("stop-share", () => {
            socket.to(roomId).emit("stop-share", userId);
        });

        socket.on("message", (msg) => {
            io.to(roomId).emit("message", { userId, name, msg });
        });

        socket.on("disconnect", () => {
            io.to(roomId).emit("user-left", userId);
        });
    });

});

server.listen(3000, () => console.log("Server running on port 3000"));
