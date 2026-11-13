import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },

    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    text: {
      type: String,
      default: "",
      trim: true,
    },

    // File attachment fields
    fileUrl: {
      type: String,
      default: null,
    },
    fileName: {
      type: String,
      default: null,
    },
    fileType: {
      // "image" | "video" | "audio" | "document"
      type: String,
      default: null,
    },
    fileMime: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

const Message = mongoose.model("Message", messageSchema);

export default Message;
