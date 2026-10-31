import express from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import User from "../models/User.models.js";

const router = express.Router();

// Get all users except the logged-in user
router.get("/", authMiddleware, async (req, res) => {
  try {
    const users = await User.find({
      _id: { $nin: [req.user.userId] },
    }).select("-password");

    res.status(200).json({
      message: "Users fetched successfully",
      users,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch users",
    });
  }
});

// Get the logged-in user's profile
router.get("/profile", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({
      message: "You are authorized",
      user,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch profile" });
  }
});

export default router;
