import { io } from "socket.io-client";

const socket = io("https://real-time-chat-65gl.onrender.com", {
  autoConnect: false,
});

export default socket;
