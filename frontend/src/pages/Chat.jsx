import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { io } from "socket.io-client";
import "./Chat.css";
import EmojiPicker, { Theme } from "emoji-picker-react";

const API_BASE = "http://localhost:5000";

// Deterministic vibrant avatar background gradients
const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
  "linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)",
  "linear-gradient(135deg, #10b981 0%, #14b8a6 100%)",
  "linear-gradient(135deg, #f59e0b 0%, #f97316 100%)",
  "linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)",
  "linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%)",
];

function getAvatarGradient(name = "") {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[index];
}

function getInitials(name = "") {
  if (!name.trim()) return "U";
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatTime(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Chat() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const token = localStorage.getItem("token");

  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const stored = localStorage.getItem("user");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [conversations, setConversations] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(() => {
    try {
      const stored = localStorage.getItem("selectedConversation");
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      const userStored = localStorage.getItem("user");
      if (userStored && parsed?.participants) {
        const u = JSON.parse(userStored);
        const myId = u._id || u.id || u.userId;
        const isParticipant = parsed.participants.some(
          (p) => (p._id || p.id || p) === myId,
        );
        if (!isParticipant) return null;
      }
      return parsed;
    } catch {
      return null;
    }
  });
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState("");
  const [activeTab, setActiveTab] = useState("chats"); // "chats" | "users"
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null); // { file, previewUrl, type }
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsAbout, setSettingsAbout] = useState("");
  const [settingsPhoto, setSettingsPhoto] = useState(null); // { file, previewUrl }
  const [savingSettings, setSavingSettings] = useState(false);

  const socketRef = useRef(null);
  const selectedConversationRef = useRef(selectedConversation);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const settingsPhotoInputRef = useRef(null);
  const [showProfileView, setShowProfileView] = useState(false);

  // Check if a user is currently active/online
  const isUserOnline = (userId) => {
    if (!userId) return false;
    const idStr = String(userId);
    const myId = currentUser?._id || currentUser?.id || currentUser?.userId;
    if (myId && String(myId) === idStr) return true;
    return onlineUsers.includes(idStr);
  };

  // Keep selectedConversationRef in sync with state
  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
  }, [selectedConversation]);

  // Select a conversation and persist it to localStorage & URL query params
  const handleSelectConversation = (conv) => {
    setSelectedConversation(conv);
    if (conv?._id) {
      localStorage.setItem("selectedConversation", JSON.stringify(conv));
      setSearchParams({ id: conv._id }, { replace: true });
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit("joinConversation", conv._id);
      }
    } else {
      localStorage.removeItem("selectedConversation");
      setSearchParams({}, { replace: true });
    }
  };

  // Sync URL query param on mount if conversation was restored from localStorage
  useEffect(() => {
    if (selectedConversation?._id) {
      const urlId = searchParams.get("id");
      if (urlId !== selectedConversation._id) {
        setSearchParams({ id: selectedConversation._id }, { replace: true });
      }
    }
  }, []);

  // When conversations load or URL param changes, match conversation from URL param if present
  useEffect(() => {
    const urlId = searchParams.get("id");
    if (!urlId) return;
    if (conversations.length > 0) {
      const match = conversations.find((c) => c._id === urlId);
      if (match && match._id !== selectedConversation?._id) {
        handleSelectConversation(match);
      }
    }
  }, [searchParams, conversations]);

  // Lock body scroll so chat layout never scrolls outside its viewport
  useEffect(() => {
    document.body.style.overflow = "hidden";
    window.scrollTo(0, 0);
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!token) {
      navigate("/");
    }
  }, [token, navigate]);

  // Fetch current user profile if not in localStorage or to keep fresh
  useEffect(() => {
    if (!token) return;

    fetch(`${API_BASE}/api/users/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) {
          setCurrentUser(data.user);
          localStorage.setItem("user", JSON.stringify(data.user));
        }
      })
      .catch((err) => console.error("Profile fetch error:", err));
  }, [token]);

  // Setup Socket.IO connection
  useEffect(() => {
    if (!token) return;

    const socket = io(API_BASE, {
      transports: ["websocket", "polling"],
      auth: {
        token,
      },
    });

    socket.on("connect_error", (error) => {
      console.error("Socket connection error:", error.message);
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("Connected to chat socket:", socket.id);
      socket.emit("getOnlineUsers");
      if (selectedConversationRef.current?._id) {
        socket.emit("joinConversation", selectedConversationRef.current._id);
      }
    });

    socket.on("getOnlineUsers", (users) => {
      setOnlineUsers(Array.isArray(users) ? users.map(String) : []);
    });

    socket.on("receiveMessage", (receivedMsg) => {
      console.log("Message received through socket:", receivedMsg);
      if (!receivedMsg) return;

      const msgConvId = String(
        (typeof receivedMsg.conversationId === "object" &&
        receivedMsg.conversationId !== null
          ? receivedMsg.conversationId._id
          : receivedMsg.conversationId) || "",
      );

      const currentSelected = selectedConversationRef.current;
      const currentSelectedId = String(currentSelected?._id || "");

      // If the received message belongs to current open conversation, append it
      if (currentSelectedId && msgConvId === currentSelectedId) {
        setMessages((prev) => {
          if (prev.some((m) => String(m._id) === String(receivedMsg._id)))
            return prev;
          return [...prev, receivedMsg];
        });
      }

      // Update conversations last message snippet and sort newest to top
      setConversations((prev) => {
        const exists = prev.some((c) => String(c._id) === msgConvId);
        if (exists) {
          const updated = prev.map((conv) => {
            if (String(conv._id) === msgConvId) {
              return {
                ...conv,
                lastMessage: receivedMsg,
                updatedAt: receivedMsg.createdAt || new Date().toISOString(),
              };
            }
            return conv;
          });
          return updated.sort((a, b) => {
            const timeA = new Date(
              a.lastMessage?.createdAt || a.updatedAt || 0,
            ).getTime();
            const timeB = new Date(
              b.lastMessage?.createdAt || b.updatedAt || 0,
            ).getTime();
            return timeB - timeA;
          });
        }
        // If not in sidebar list yet, fetch all conversations immediately
        fetchConversations();
        return prev;
      });
    });

    socket.on("conversationCreated", () => {
      fetchConversations();
    });

    // Listen for message status updates (sent -> delivered)
    socket.on("messageStatusUpdate", ({ messageId, status }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          String(msg._id) === String(messageId) ? { ...msg, status } : msg,
        ),
      );
    });

    return () => {
      socket.disconnect();
    };
  }, [token]);

  // Fetch conversations
  const fetchConversations = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      const data = await res.json();
      if (data?.conversations) {
        setConversations(data.conversations);
        // Sync selected conversation with the freshly fetched list
        setSelectedConversation((current) => {
          if (!current?._id) return null;
          const fresh = data.conversations.find((c) => c._id === current._id);
          if (fresh) {
            localStorage.setItem("selectedConversation", JSON.stringify(fresh));
            return fresh;
          }
          return current;
        });
      }
    } catch (err) {
      console.error("Error fetching conversations:", err);
    }
  };

  // Fetch all users (for discovering and starting new conversations)
  const fetchAllUsers = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data?.users) {
        setAllUsers(data.users);
      }
    } catch (err) {
      console.error("Error fetching users:", err);
    }
  };

  useEffect(() => {
    fetchConversations();
    fetchAllUsers();
  }, [token]);

  // Whenever a conversation is selected, join socket room and fetch its messages
  useEffect(() => {
    if (!selectedConversation?._id) {
      setMessages([]);
      return;
    }
    if (!token) return;

    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("joinConversation", selectedConversation._id);
    }

    setLoadingMessages(true);
    fetch(`${API_BASE}/api/messages/${selectedConversation._id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.messages) {
          setMessages(data.messages);
        }
      })
      .catch((err) => console.error("Error fetching messages:", err))
      .finally(() => setLoadingMessages(false));
  }, [selectedConversation?._id, token]);

  // Focus input without scrolling page
  useEffect(() => {
    if (selectedConversation && inputRef.current) {
      inputRef.current.focus({ preventScroll: true });
    }
  }, [selectedConversation]);

  // Scroll messages container smoothly to bottom whenever messages update
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, loadingMessages]);

  // Helper to get recipient info from a conversation
  const getRecipient = (conv) => {
    if (!conv?.participants || !currentUser) return { name: "User", email: "" };
    const myId = String(
      currentUser._id || currentUser.id || currentUser.userId || "",
    );
    const recipient = conv.participants.find((p) => {
      const pId = String(p?._id || p?.id || p || "");
      return pId && pId !== myId;
    });
    return recipient || { name: "Chat User", email: "" };
  };

  // Start or open a conversation with a chosen user
  const handleStartConversation = async (user) => {
    try {
      const res = await fetch(`${API_BASE}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ receiverId: user._id }),
      });
      const data = await res.json();
      if (data?.conversation) {
        // If the conversation already has messages, make sure it's in the list
        if (data.conversation.lastMessage) {
          setConversations((prev) => {
            if (
              !prev.some((c) => String(c._id) === String(data.conversation._id))
            ) {
              return [data.conversation, ...prev];
            }
            return prev;
          });
        }
        handleSelectConversation(data.conversation);
        setActiveTab("chats");
        setSearchQuery("");
      }
    } catch (err) {
      console.error("Failed to start conversation:", err);
    }
  };

  // Handle file selection
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    const type = file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("audio/")
          ? "audio"
          : "document";
    setSelectedFile({ file, previewUrl, type });
    // Reset file input so same file can be re-selected
    e.target.value = "";
  };

  const clearSelectedFile = () => {
    if (selectedFile?.previewUrl) URL.revokeObjectURL(selectedFile.previewUrl);
    setSelectedFile(null);
  };

  // Send message
  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    if (
      (!inputMessage.trim() && !selectedFile) ||
      !selectedConversation?._id ||
      sending
    )
      return;

    const textToSend = inputMessage.trim();
    setInputMessage("");
    setShowEmojiPicker(false);
    const fileToSend = selectedFile;
    setSelectedFile(null);
    setSending(true);

    try {
      let res, data;

      if (fileToSend) {
        // Use FormData to send file + optional text
        const formData = new FormData();
        formData.append("file", fileToSend.file);
        if (textToSend) formData.append("text", textToSend);

        res = await fetch(
          `${API_BASE}/api/messages/${selectedConversation._id}`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          },
        );
      } else {
        res = await fetch(
          `${API_BASE}/api/messages/${selectedConversation._id}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ text: textToSend }),
          },
        );
      }

      data = await res.json();
      if (res.ok && data?.data) {
        const sentMsg = data.data;
        const msgConvId = String(
          (typeof sentMsg.conversationId === "object" &&
          sentMsg.conversationId !== null
            ? sentMsg.conversationId._id
            : sentMsg.conversationId) || selectedConversation._id,
        );

        // Append sent message to state if not already added by socket
        setMessages((prev) => {
          if (prev.some((m) => String(m._id) === String(sentMsg._id)))
            return prev;
          return [...prev, sentMsg];
        });

        // Add or update this conversation in the sidebar conversations list now that a message was sent
        setConversations((prev) => {
          const exists = prev.some((c) => String(c._id) === msgConvId);
          if (exists) {
            const updated = prev.map((c) =>
              String(c._id) === msgConvId
                ? {
                    ...c,
                    lastMessage: sentMsg,
                    updatedAt: sentMsg.createdAt || new Date().toISOString(),
                  }
                : c,
            );
            return updated.sort((a, b) => {
              const timeA = new Date(
                a.lastMessage?.createdAt || a.updatedAt || 0,
              ).getTime();
              const timeB = new Date(
                b.lastMessage?.createdAt || b.updatedAt || 0,
              ).getTime();
              return timeB - timeA;
            });
          } else {
            return [
              {
                ...selectedConversation,
                lastMessage: sentMsg,
                updatedAt: sentMsg.createdAt || new Date().toISOString(),
              },
              ...prev,
            ];
          }
        });
      }
    } catch (err) {
      console.error("Send message error:", err);
    } finally {
      setSending(false);
      if (fileToSend?.previewUrl) URL.revokeObjectURL(fileToSend.previewUrl);
    }
  };

  // Logout
  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("selectedConversation");
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    navigate("/");
  };

  // Only active conversations that have at least one message
  const activeConversations = conversations.filter((conv) => {
    if (!conv?.lastMessage) return false;
    const recipient = getRecipient(conv);
    if (!recipient || recipient.name === "Chat User") return false;
    return true;
  });

  // Filter conversations by search query
  const filteredConversations = activeConversations.filter((conv) => {
    const recipient = getRecipient(conv);
    return recipient.name?.toLowerCase().includes(searchQuery.toLowerCase());
  });

  // Filter users
  const filteredUsers = allUsers.filter((u) =>
    u.name?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const activeRecipient = selectedConversation
    ? getRecipient(selectedConversation)
    : null;

  const isActiveRecipientOnline = isUserOnline(
    activeRecipient?._id || activeRecipient?.id,
  );

  const currentUserId =
    currentUser?._id || currentUser?.id || currentUser?.userId;

  // ── Settings modal handlers ──
  const openSettings = () => {
    setSettingsAbout(currentUser?.about || "");
    setSettingsPhoto(null);
    setShowSettings(true);
  };

  const closeSettings = () => {
    if (settingsPhoto?.previewUrl)
      URL.revokeObjectURL(settingsPhoto.previewUrl);
    setSettingsPhoto(null);
    setShowSettings(false);
  };

  const handleSettingsPhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (settingsPhoto?.previewUrl)
      URL.revokeObjectURL(settingsPhoto.previewUrl);
    setSettingsPhoto({ file, previewUrl: URL.createObjectURL(file) });
    e.target.value = "";
  };

  const handleSaveSettings = async () => {
    if (savingSettings) return;
    setSavingSettings(true);
    try {
      const formData = new FormData();
      formData.append("about", settingsAbout);
      if (settingsPhoto?.file) {
        formData.append("profilePicture", settingsPhoto.file);
      }

      const res = await fetch(`${API_BASE}/api/users/profile`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data?.user) {
        setCurrentUser(data.user);
        localStorage.setItem("user", JSON.stringify(data.user));
        closeSettings();
      } else {
        alert(data?.message || "Failed to update profile");
      }
    } catch (err) {
      console.error("Save settings error:", err);
      alert("Failed to update profile");
    } finally {
      setSavingSettings(false);
    }
  };

  const quickEmojis = ["👋", "❤️", "😂", "👍", "🔥", "🎉", "🚀", "✨"];

  return (
    <div className="chat-layout">
      {/* Ambient background glows */}
      <div className="chat-ambient-glow chat-glow-1" />
      <div className="chat-ambient-glow chat-glow-2" />

      {/* ================= SIDEBAR ================= */}
      <aside
        className={`chat-sidebar ${
          selectedConversation ? "hidden-mobile" : ""
        }`}
      >
        {/* User Profile Bar */}
        <div className="sidebar-user-bar">
          <div className="sidebar-user-info">
            <div
              className="user-avatar"
              title="View profile"
              onClick={() => setShowProfileView(true)}
              style={{
                cursor: "pointer",
                background: currentUser?.profilePicture
                  ? "none"
                  : getAvatarGradient(currentUser?.name || "User"),
              }}
            >
              {currentUser?.profilePicture ? (
                <img
                  src={`${API_BASE}${currentUser.profilePicture}`}
                  alt={currentUser.name}
                  className="avatar-img"
                />
              ) : (
                getInitials(currentUser?.name || "User")
              )}
              <span className="online-dot" />
            </div>
            <div className="user-details">
              <span className="user-name">
                {currentUser?.name || "My Account"}
              </span>
              <span className="user-status">
                <span className="status-indicator-dot" />
                Online
              </span>
            </div>
          </div>
          <div className="sidebar-actions">
            <button
              className="icon-btn"
              title="Settings"
              onClick={openSettings}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <button
              className="icon-btn"
              title={activeTab === "chats" ? "Browse People" : "View Chats"}
              onClick={() =>
                setActiveTab(activeTab === "chats" ? "users" : "chats")
              }
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="16" x2="16" y2="11" />
              </svg>
            </button>
            <button
              className="icon-btn logout-btn"
              title="Logout"
              onClick={handleLogout}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search & Tabs */}
        <div className="sidebar-search-area">
          <div className="search-input-wrap">
            <svg
              className="search-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="search-input"
              placeholder={
                activeTab === "chats"
                  ? "Search conversations..."
                  : "Search people to chat..."
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchQuery("")}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <div className="sidebar-tabs">
            <button
              className={`sidebar-tab ${activeTab === "chats" ? "active" : ""}`}
              onClick={() => setActiveTab("chats")}
            >
              <span>Chats</span>
              {activeConversations.length > 0 && (
                <span className="tab-badge">{activeConversations.length}</span>
              )}
            </button>
            <button
              className={`sidebar-tab ${activeTab === "users" ? "active" : ""}`}
              onClick={() => setActiveTab("users")}
            >
              <span>People</span>
              {allUsers.length > 0 && (
                <span className="tab-badge">{allUsers.length}</span>
              )}
            </button>
          </div>
        </div>

        {/* List Content */}
        <div className="sidebar-list">
          {activeTab === "chats" ? (
            filteredConversations.length > 0 ? (
              filteredConversations.map((conv) => {
                const recipient = getRecipient(conv);
                const isSelected = selectedConversation?._id === conv._id;
                const lastMsgText = conv.lastMessage?.text
                  ? conv.lastMessage.text
                  : conv.lastMessage?.fileType === "image"
                    ? "📷 Photo"
                    : conv.lastMessage?.fileType === "video"
                      ? "🎥 Video"
                      : conv.lastMessage?.fileType === "audio"
                        ? "🎵 Audio"
                        : conv.lastMessage?.fileType === "document"
                          ? `📎 ${conv.lastMessage?.fileName || "File"}`
                          : "No messages yet";
                const lastMsgTime = conv.lastMessage?.createdAt
                  ? formatTime(conv.lastMessage.createdAt)
                  : "";

                const isRecipientOnline = isUserOnline(
                  recipient?._id || recipient?.id,
                );

                return (
                  <div
                    key={conv._id}
                    className={`conversation-item ${isSelected ? "active" : ""}`}
                    onClick={() => handleSelectConversation(conv)}
                  >
                    <div
                      className="user-avatar"
                      style={{
                        background: getAvatarGradient(recipient.name),
                      }}
                    >
                      {getInitials(recipient.name)}
                      {isRecipientOnline && <span className="online-dot" />}
                    </div>
                    <div className="conversation-details">
                      <div className="conversation-header-row">
                        <span className="contact-name">{recipient.name}</span>
                        {lastMsgTime && (
                          <span className="conversation-time">
                            {lastMsgTime}
                          </span>
                        )}
                      </div>
                      <span className="conversation-last-msg">
                        {lastMsgText}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="sidebar-empty-state">
                <div className="empty-state-icon-circle">
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <p>
                  No conversations yet.
                  <br />
                  Switch to <strong>People</strong> to begin!
                </p>
                <button
                  className="start-chat-pill-btn"
                  onClick={() => setActiveTab("users")}
                >
                  Find People
                </button>
              </div>
            )
          ) : filteredUsers.length > 0 ? (
            filteredUsers.map((user) => {
              const isOnline = isUserOnline(user._id || user.id);
              return (
                <div key={user._id} className="user-item">
                  <div className="user-item-left">
                    <div
                      className="user-avatar"
                      style={{ background: getAvatarGradient(user.name) }}
                    >
                      {getInitials(user.name)}
                      {isOnline && <span className="online-dot" />}
                    </div>
                    <div className="user-details">
                      <span className="user-name">{user.name}</span>
                      <span className="user-item-email">{user.email}</span>
                    </div>
                  </div>
                  <button
                    className="start-chat-btn"
                    onClick={() => handleStartConversation(user)}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    Chat
                  </button>
                </div>
              );
            })
          ) : (
            <div className="sidebar-empty-state">
              <div className="empty-state-icon-circle">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <p>No users found matching your search.</p>
            </div>
          )}
        </div>
      </aside>

      {/* ================= MAIN CHAT AREA ================= */}
      <main className="chat-main">
        {selectedConversation ? (
          <>
            {/* Top Chat Header */}
            <div className="chat-header">
              <div className="chat-header-left">
                <button
                  className="mobile-back-btn"
                  onClick={() => handleSelectConversation(null)}
                  title="Back to conversations"
                >
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <div
                  className="user-avatar"
                  style={{
                    background: getAvatarGradient(activeRecipient?.name),
                  }}
                >
                  {getInitials(activeRecipient?.name)}
                  {isActiveRecipientOnline && <span className="online-dot" />}
                </div>
                <div className="chat-header-info">
                  <span className="chat-header-name">
                    {activeRecipient?.name}
                  </span>
                  <span
                    className={`chat-header-status ${
                      isActiveRecipientOnline ? "online" : "offline"
                    }`}
                  >
                    <span
                      className={`chat-header-status-dot ${
                        isActiveRecipientOnline ? "" : "offline"
                      }`}
                    />
                    {isActiveRecipientOnline ? "Active Now" : "Offline"}
                  </span>
                </div>
              </div>

              <div className="chat-header-actions">
                <button
                  className="icon-btn"
                  title="Close conversation"
                  onClick={() => handleSelectConversation(null)}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Message Stream */}
            <div className="chat-messages-container" ref={messagesContainerRef}>
              {loadingMessages ? (
                <div className="sidebar-empty-state" style={{ margin: "auto" }}>
                  <svg
                    className="btn-spinner"
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  <p style={{ marginTop: "12px" }}>Loading messages...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="conversation-start-banner">
                  <div className="start-wave-icon">👋</div>
                  <h3 className="conversation-start-title">
                    Say Hello to {activeRecipient?.name}!
                  </h3>
                  <p className="conversation-start-desc">
                    Send a message to start this conversation. Everything is
                    synced in real-time.
                  </p>
                  <div className="quick-starters">
                    {[
                      `👋 Hey ${activeRecipient?.name?.split(" ")[0] || "there"}!`,
                      "How are you doing today?",
                      "Working on anything cool?",
                      "Let's connect! 🚀",
                    ].map((text, i) => (
                      <button
                        key={i}
                        type="button"
                        className="quick-starter-chip"
                        onClick={() => {
                          setInputMessage(text);
                          inputRef.current?.focus({ preventScroll: true });
                        }}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg) => {
                  const senderId = msg.sender?._id || msg.sender;
                  const isSentByMe =
                    currentUserId &&
                    senderId &&
                    senderId.toString() === currentUserId.toString();

                  return (
                    <div
                      key={msg._id || Math.random()}
                      className={`message-row ${
                        isSentByMe ? "sent" : "received"
                      }`}
                    >
                      {!isSentByMe && (
                        <div
                          className="msg-avatar"
                          style={{
                            background: getAvatarGradient(
                              activeRecipient?.name,
                            ),
                          }}
                        >
                          {getInitials(activeRecipient?.name)}
                        </div>
                      )}
                      <div
                        className={`message-bubble${
                          msg.fileType === "image" && !msg.text
                            ? " image-only"
                            : (msg.fileType === "document" ||
                                  msg.fileType === "video" ||
                                  msg.fileType === "audio") &&
                                !msg.text
                              ? " file-only"
                              : ""
                        }`}
                      >
                        {/* File attachment rendering */}
                        {msg.fileUrl && msg.fileType === "image" && (
                          <a
                            href={`${API_BASE}${msg.fileUrl}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="msg-image-link"
                          >
                            <img
                              src={`${API_BASE}${msg.fileUrl}`}
                              alt={msg.fileName || "image"}
                              className="msg-image"
                            />
                          </a>
                        )}
                        {msg.fileUrl && msg.fileType === "video" && (
                          <video
                            src={`${API_BASE}${msg.fileUrl}`}
                            controls
                            className="msg-video"
                          />
                        )}
                        {msg.fileUrl && msg.fileType === "audio" && (
                          <audio
                            src={`${API_BASE}${msg.fileUrl}`}
                            controls
                            className="msg-audio"
                          />
                        )}
                        {msg.fileUrl && msg.fileType === "document" && (
                          <a
                            href={`${API_BASE}${msg.fileUrl}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            download={msg.fileName}
                            className="msg-file-link"
                          >
                            <svg
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                            <span>{msg.fileName || "Download file"}</span>
                          </a>
                        )}
                        {msg.text && (
                          <div className="message-text">{msg.text}</div>
                        )}
                        <div className="message-meta">
                          <span>{formatTime(msg.createdAt)}</span>
                          {isSentByMe &&
                            (msg.status === "delivered" ? (
                              /* Double tick — recipient is/was online */
                              <svg
                                className="double-tick delivered"
                                width="18"
                                height="11"
                                viewBox="0 0 18 11"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                {/* First tick (back) */}
                                <polyline
                                  points="1,5.5 4.5,9 10,2"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                                {/* Second tick (front, offset right) */}
                                <polyline
                                  points="6,5.5 9.5,9 15,2"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            ) : (
                              /* Single tick — sent but not delivered */
                              <svg
                                className="single-tick"
                                width="14"
                                height="11"
                                viewBox="0 0 14 11"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <polyline
                                  points="1,5.5 4.5,9 12,2"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            ))}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input Bar */}
            <div className="chat-input-bar-container">
              {showEmojiPicker && (
                <div className="emoji-picker-popup">
                  <EmojiPicker
                    onEmojiClick={(emojiData) => {
                      setInputMessage((prev) => prev + emojiData.emoji);
                      inputRef.current?.focus({ preventScroll: true });
                    }}
                    theme={Theme.DARK}
                    colorScheme="dark"
                    lazyLoadEmojis
                    width={320}
                    height={420}
                    searchPlaceholder="Search emojis..."
                    previewConfig={{ showPreview: true }}
                  />
                </div>
              )}

              {/* File preview strip */}
              {selectedFile && (
                <div className="file-preview-strip">
                  {selectedFile.type === "image" ? (
                    <img
                      src={selectedFile.previewUrl}
                      alt="preview"
                      className="file-preview-img"
                    />
                  ) : (
                    <div className="file-preview-doc">
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      <span>{selectedFile.file.name}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    className="file-preview-remove"
                    onClick={clearSelectedFile}
                    title="Remove file"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: "none" }}
                onChange={handleFileSelect}
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar"
              />

              <form onSubmit={handleSendMessage} className="chat-input-form">
                <button
                  type="button"
                  className={`emoji-btn ${showEmojiPicker ? "active" : ""}`}
                  title="Insert emoji"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                    <line x1="9" y1="9" x2="9.01" y2="9" />
                    <line x1="15" y1="9" x2="15.01" y2="9" />
                  </svg>
                </button>

                {/* Attach file button */}
                <button
                  type="button"
                  className="attach-btn"
                  title="Attach file"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>

                <input
                  ref={inputRef}
                  type="text"
                  className="chat-input-field"
                  placeholder={`Message ${activeRecipient?.name || ""}... (Press Enter to send)`}
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                />

                <button
                  type="submit"
                  className="send-msg-btn"
                  disabled={(!inputMessage.trim() && !selectedFile) || sending}
                  title="Send message"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="no-chat-selected">
            <div className="empty-chat-icon-wrap">
              <svg
                width="42"
                height="42"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                <path d="M8 10h.01" />
                <path d="M12 10h.01" />
                <path d="M16 10h.01" />
              </svg>
            </div>
            <h2 className="no-chat-title">
              Welcome, {currentUser?.name || "Friend"}! 👋
            </h2>
            <p className="no-chat-subtitle">
              Select a conversation from the sidebar or click on People to find
              colleagues and start chatting in real time.
            </p>

            <div className="no-chat-features">
              <div className="feature-pill">⚡ Instant WebSocket Sync</div>
              <div className="feature-pill">🔒 Private Direct Chat</div>
              <div className="feature-pill">🟢 Live Presence</div>
            </div>

            <button
              className="btn-open-people"
              onClick={() => setActiveTab("users")}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="16" x2="16" y2="11" />
              </svg>
              Find People to Chat
            </button>
          </div>
        )}
      </main>
      {/* ================= SETTINGS MODAL ================= */}
      {showSettings && (
        <div className="settings-overlay" onClick={closeSettings}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-header">
              <h3>Profile Settings</h3>
              <button
                className="icon-btn"
                onClick={closeSettings}
                title="Close"
              >
                ✕
              </button>
            </div>

            {/* Profile photo picker */}
            <div className="settings-photo-section">
              <div
                className="settings-avatar"
                style={{
                  background:
                    settingsPhoto?.previewUrl || currentUser?.profilePicture
                      ? "none"
                      : getAvatarGradient(currentUser?.name || "User"),
                }}
                onClick={() => settingsPhotoInputRef.current?.click()}
                title="Change profile photo"
              >
                {settingsPhoto?.previewUrl ? (
                  <img
                    src={settingsPhoto.previewUrl}
                    alt="New profile"
                    className="avatar-img"
                  />
                ) : currentUser?.profilePicture ? (
                  <img
                    src={`${API_BASE}${currentUser.profilePicture}`}
                    alt={currentUser.name}
                    className="avatar-img"
                  />
                ) : (
                  getInitials(currentUser?.name || "User")
                )}
                <div className="settings-avatar-overlay">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  <span>Change</span>
                </div>
              </div>

              <input
                ref={settingsPhotoInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleSettingsPhotoSelect}
              />

              <button
                type="button"
                className="settings-upload-link"
                onClick={() => settingsPhotoInputRef.current?.click()}
              >
                Upload new photo
              </button>
            </div>

            {/* Fields */}
            <div className="settings-field">
              <label>Name</label>
              <input type="text" value={currentUser?.name || ""} disabled />
            </div>

            <div className="settings-field">
              <label>About</label>
              <textarea
                rows={3}
                maxLength={150}
                placeholder="Hey there! I'm using this chat."
                value={settingsAbout}
                onChange={(e) => setSettingsAbout(e.target.value)}
              />
              <span className="settings-counter">
                {settingsAbout.length}/150
              </span>
            </div>

            <div className="settings-actions">
              <button className="settings-cancel-btn" onClick={closeSettings}>
                Cancel
              </button>
              <button
                className="settings-save-btn"
                onClick={handleSaveSettings}
                disabled={savingSettings}
              >
                {savingSettings ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= PROFILE VIEW MODAL ================= */}
      {showProfileView && (
        <div
          className="settings-overlay"
          onClick={() => setShowProfileView(false)}
        >
          <div
            className="profile-view-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-btn profile-view-close"
              onClick={() => setShowProfileView(false)}
              title="Close"
            >
              ✕
            </button>

            <div
              className="profile-view-avatar"
              style={{
                background: currentUser?.profilePicture
                  ? "none"
                  : getAvatarGradient(currentUser?.name || "User"),
              }}
            >
              {currentUser?.profilePicture ? (
                <img
                  src={`${API_BASE}${currentUser.profilePicture}`}
                  alt={currentUser.name}
                />
              ) : (
                getInitials(currentUser?.name || "User")
              )}
            </div>

            <h3 className="profile-view-name">
              {currentUser?.name || "My Account"}
            </h3>
            <p className="profile-view-email">{currentUser?.email}</p>
            <p className="profile-view-about">
              {currentUser?.about || "Hey there! I'm using this chat."}
            </p>

            <button
              className="settings-save-btn"
              onClick={() => {
                setShowProfileView(false);
                openSettings();
              }}
            >
              Edit profile
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Chat;
