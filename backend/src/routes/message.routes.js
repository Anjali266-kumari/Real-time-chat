import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { authMiddleware } from "../middleware/authMiddleware.js";
import Conversation from "../models/Conversation.models.js";
import Message from "../models/Message.models.js";

const router = express.Router();

// ── Multer setup ────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Auto-create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log("Created uploads directory:", uploadsDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB limit
  fileFilter: (req, file, cb) => {
    // Allow images, videos, audio, and common documents
    const allowed = /image\/|video\/|audio\/|application\/pdf|application\/msword|application\/vnd\.|text\/|application\/zip|application\/x-rar/;
    if (allowed.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type "${file.mimetype}" is not allowed`));
    }
  },
});

// Classify MIME type into a broad category
function classifyMime(mime = "") {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

// ── POST /:conversationId — Send a message (text and/or file) ──────────────
router.post(
  "/:conversationId",
  authMiddleware,
  (req, res, next) => {
    // Run multer and catch its errors explicitly for clean JSON responses
    upload.single("file")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ message: "File too large. Maximum size is 50 MB." });
        }
        return res.status(400).json({ message: `Upload error: ${err.message}` });
      }
      if (err) {
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const { conversationId } = req.params;
      const { text } = req.body;
      const senderId = req.user.userId;

      if (!mongoose.isValidObjectId(conversationId)) {
        return res.status(400).json({ message: "Invalid conversation ID" });
      }

      const hasText = typeof text === "string" && text.trim().length > 0;
      const hasFile = !!req.file;

      if (!hasText && !hasFile) {
        return res
          .status(400)
          .json({ message: "Message must contain text or a file" });
      }

      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: senderId,
      });

      if (!conversation) {
        return res
          .status(404)
          .json({ message: "Conversation not found or access denied" });
      }

      // Determine if the recipient is online
      const onlineUsers = req.app.get("onlineUsers");
      const recipientId = conversation.participants.find(
        (p) => p.toString() !== senderId.toString(),
      );
      const isRecipientOnline =
        recipientId && onlineUsers && onlineUsers.has(recipientId.toString());

      const msgData = {
        conversationId,
        sender: senderId,
        text: hasText ? text.trim() : "",
        status: isRecipientOnline ? "delivered" : "sent",
      };

      if (hasFile) {
        msgData.fileUrl = `/uploads/${req.file.filename}`;
        msgData.fileName = req.file.originalname;
        msgData.fileMime = req.file.mimetype;
        msgData.fileType = classifyMime(req.file.mimetype);
      }

      const message = await Message.create(msgData);

      conversation.lastMessage = message._id;
      await conversation.save();

      const populatedMessage = await Message.findById(message._id).populate(
        "sender",
        "name email profilePicture",
      );

      const io = req.app.get("io");
      if (io) {
        const convIdStr = conversationId.toString();

        // Ensure both participants' sockets are in the conversation room
        conversation.participants.forEach((p) => {
          io.in(p.toString()).socketsJoin(convIdStr);
        });

        // 1. Emit to conversation room (for anyone who has conversation open)
        io.to(convIdStr).emit("receiveMessage", populatedMessage);

        // 2. Also emit to each participant's user room (guarantees delivery even if conversation room wasn't joined yet)
        conversation.participants.forEach((p) => {
          io.to(p.toString()).emit("receiveMessage", populatedMessage);
        });
      }

      return res.status(201).json({
        message: "Message sent successfully",
        data: populatedMessage,
      });
    } catch (error) {
      console.error("Send message error:", error);
      return res.status(500).json({ message: "Failed to send message" });
    }
  },
);

// ── GET /:conversationId — Fetch messages ──────────────────────────────────
router.get("/:conversationId", authMiddleware, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.userId;

    if (!mongoose.isValidObjectId(conversationId)) {
      return res.status(400).json({ message: "Invalid conversation ID" });
    }

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    });

    if (!conversation) {
      return res
        .status(404)
        .json({ message: "Conversation not found or access denied" });
    }

    const messages = await Message.find({ conversationId })
      .populate("sender", "name email profilePicture")
      .sort({ createdAt: 1 });

    return res.status(200).json({
      message: "Messages fetched successfully",
      messages,
    });
  } catch (error) {
    console.error("Fetch messages error:", error);
    return res.status(500).json({ message: "Failed to fetch messages" });
  }
});

export default router;
