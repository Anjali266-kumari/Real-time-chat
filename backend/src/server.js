import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Track online users: userId -> Set of active socket IDs
const onlineUsers = new Map();

io.on("connection", async (socket) => {
  const userId = String(socket.userId);
  console.log("Authenticated user connected:", userId);

  // 1. Join user's personal room so events can be delivered directly to this user
  socket.join(userId);

  // 2. Track online users
  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }
  onlineUsers.get(userId).add(socket.id);

  // 3. Automatically join all conversation rooms the user participates in
  try {
    const userConvs = await Conversation.find({
      participants: socket.userId,
    }).select("_id");
    userConvs.forEach((conv) => {
      socket.join(conv._id.toString());
    });
  } catch (err) {
    console.error("Auto-joining conversations error:", err.message);
  }

  // 4. Broadcast updated list of online user IDs to all connected clients
  io.emit("getOnlineUsers", Array.from(onlineUsers.keys()));

  // Direct request handler for online users list
  socket.on("getOnlineUsers", () => {
    socket.emit("getOnlineUsers", Array.from(onlineUsers.keys()));
  });

  // Join a conversation room
  socket.on("joinConversation", async (conversationId) => {
    try {
      if (!conversationId) return;
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

      socket.join(conversationId.toString());

      console.log(`User ${socket.userId} joined conversation: ${conversationId}`);
    } catch (error) {
      console.error("Join conversation error:", error.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.userId);
    if (onlineUsers.has(userId)) {
      const userSockets = onlineUsers.get(userId);
      userSockets.delete(socket.id);
      if (userSockets.size === 0) {
        onlineUsers.delete(userId);
      }
    }
    io.emit("getOnlineUsers", Array.from(onlineUsers.keys()));
  });
});

app.use(cors({
  origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));
app.use(express.json());

// Serve uploaded files statically
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

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
