import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoute.routes.js";
import userRoutes from "./routes/user.routes.js";
import { authMiddleware } from "./middleware/authMiddleware.js";
import conversationRoutes from "./routes/conversation.routes.js";
import messageRoutes from "./routes/message.routes.js";
import { createServer } from "http";
import { Server } from "socket.io";
import Conversation from "./models/Conversation.models.js";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST"],
  },
});

// Authenticate Socket.IO connections
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication error: Token missing"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    socket.userId = decoded.userId;

    next();
  } catch (error) {
    next(new Error("Authentication error: Invalid token"));
  }
});

app.set("io", io);

io.on("connection", (socket) => {
  console.log("Authenticated user connected:", socket.userId);

  // Join a conversation only if the user is a participant
  socket.on("joinConversation", async (conversationId) => {
    try {
      const conversation = await Conversation.findById(conversationId);

      if (!conversation) {
        return socket.emit("messageError", {
          message: "Conversation not found",
        });
      }

      const isParticipant = conversation.participants.some(
        (participant) => participant.toString() === String(socket.userId),
      );

      if (!isParticipant) {
        return socket.emit("messageError", {
          message: "You are not allowed to join this conversation",
        });
      }

      socket.join(conversationId);

      console.log("User joined conversation:", conversationId);
    } catch (error) {
      console.error("Join conversation error:", error.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.userId);
  });
});

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/messages", messageRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "Server is running",
  });
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  res.status(200).json({
    message: "Authentication successful",
    user: req.user,
  });
});

const PORT = process.env.PORT || 5000;

connectDB();

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
