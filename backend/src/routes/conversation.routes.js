import express from "express";
import mongoose from "mongoose";
import { authMiddleware } from "../middleware/authMiddleware.js";
import Conversation from "../models/Conversation.models.js";
import User from "../models/User.models.js";
import Message from "../models/Message.models.js";

const router = express.Router();

// Create a conversation between two users
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { receiverId } = req.body;
    const currentUserId = req.user.userId;

    if (!mongoose.isValidObjectId(receiverId)) {
      return res.status(400).json({
        message: "Invalid receiver ID",
      });
    }

    if (receiverId === currentUserId) {
      return res.status(400).json({
        message: "You cannot start a conversation with yourself",
      });
    }

    const receiverExists = await User.findById(receiverId);

    if (!receiverExists) {
      return res.status(404).json({
        message: "Receiver not found",
      });
    }

    // Check whether a conversation already exists
    let conversation = await Conversation.findOne({
      participants: {
        $all: [currentUserId, receiverId],
        $size: 2,
      },
    }).populate("participants", "name email profilePicture");

    if (conversation) {
      return res.status(200).json({
        message: "Conversation already exists",
        conversation,
      });
    }

    conversation = await Conversation.create({
      participants: [currentUserId, receiverId],
    });

    conversation = await conversation.populate(
      "participants",
      "name email profilePicture",
    );

    return res.status(201).json({
      message: "Conversation created successfully",
      conversation,
    });
  } catch (error) {
    console.error("Create conversation error:", error);
    return res.status(500).json({
      message: "Failed to create conversation",
    });
  }
});

// Get all conversations of the logged-in user
router.get("/", authMiddleware, async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user.userId,
    })
      .populate("participants", "name email profilePicture")
      .populate("lastMessage")
      .sort({ updatedAt: -1 });

    return res.status(200).json({
      message: "Conversations fetched successfully",
      conversations,
    });
  } catch (error) {
    console.error("Fetch conversations error:", error);
    return res.status(500).json({
      message: "Failed to fetch conversations",
    });
  }
});

export default router;
