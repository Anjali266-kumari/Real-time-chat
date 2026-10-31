import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import "./Chat.css";

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
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState("");
  const [activeTab, setActiveTab] = useState("chats"); // "chats" | "users"
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);

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
      if (selectedConversation?._id) {
        socket.emit("joinConversation", selectedConversation._id);
      }
    });

    socket.on("receiveMessage", (receivedMsg) => {
      // If the received message belongs to current conversation, append it
      console.log("Message received through socket:", receivedMsg);
      setSelectedConversation((currentSelected) => {
        if (
          currentSelected &&
          receivedMsg.conversationId === currentSelected._id
        ) {
          setMessages((prev) => {
            if (prev.some((m) => m._id === receivedMsg._id)) return prev;
            return [...prev, receivedMsg];
          });
        }
        return currentSelected;
      });

      // Update conversations last message snippet
      setConversations((prev) =>
        prev.map((conv) => {
          if (conv._id === receivedMsg.conversationId) {
            return {
              ...conv,
              lastMessage: receivedMsg,
              updatedAt: new Date().toISOString(),
            };
          }
          return conv;
        }),
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
    if (!selectedConversation?._id || !token) return;

    if (socketRef.current) {
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
    const currentId = currentUser._id || currentUser.id || currentUser.userId;
    const recipient = conv.participants.find(
      (p) => (p._id || p.id || p) !== currentId,
    );
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
        // If not already in conversations list, prepend it
        setConversations((prev) => {
          if (!prev.some((c) => c._id === data.conversation._id)) {
            return [data.conversation, ...prev];
          }
          return prev;
        });
        setSelectedConversation(data.conversation);
        setActiveTab("chats");
        setSearchQuery("");
      }
    } catch (err) {
      console.error("Failed to start conversation:", err);
    }
  };

  // Send message
  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    if (!inputMessage.trim() || !selectedConversation?._id || sending) return;

    const textToSend = inputMessage.trim();
    setInputMessage("");
    setShowEmojiPicker(false);
    setSending(true);

    try {
      const res = await fetch(
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

      const data = await res.json();
      if (res.ok && data?.data) {
        // Append sent message to state if not already added by socket
        setMessages((prev) => {
          if (prev.some((m) => m._id === data.data._id)) return prev;
          return [...prev, data.data];
        });
      }
    } catch (err) {
      console.error("Send message error:", err);
    } finally {
      setSending(false);
    }
  };

  // Logout
  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    navigate("/");
  };

  // Filter conversations
  const filteredConversations = conversations.filter((conv) => {
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

  const currentUserId =
    currentUser?._id || currentUser?.id || currentUser?.userId;

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
              style={{
                background: getAvatarGradient(currentUser?.name || "User"),
              }}
            >
              {getInitials(currentUser?.name || "User")}
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
              {conversations.length > 0 && (
                <span className="tab-badge">{conversations.length}</span>
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
                const lastMsgText = conv.lastMessage?.text || "No messages yet";
                const lastMsgTime = conv.lastMessage?.createdAt
                  ? formatTime(conv.lastMessage.createdAt)
                  : "";

                return (
                  <div
                    key={conv._id}
                    className={`conversation-item ${isSelected ? "active" : ""}`}
                    onClick={() => setSelectedConversation(conv)}
                  >
                    <div
                      className="user-avatar"
                      style={{
                        background: getAvatarGradient(recipient.name),
                      }}
                    >
                      {getInitials(recipient.name)}
                      <span className="online-dot" />
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
            filteredUsers.map((user) => (
              <div key={user._id} className="user-item">
                <div className="user-item-left">
                  <div
                    className="user-avatar"
                    style={{ background: getAvatarGradient(user.name) }}
                  >
                    {getInitials(user.name)}
                    <span className="online-dot" />
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
            ))
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
                  onClick={() => setSelectedConversation(null)}
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
                  <span className="online-dot" />
                </div>
                <div className="chat-header-info">
                  <span className="chat-header-name">
                    {activeRecipient?.name}
                  </span>
                  <span className="chat-header-status">
                    <span className="chat-header-status-dot" />
                    Active Now
                  </span>
                </div>
              </div>

              <div className="chat-header-actions">
                <button
                  className="icon-btn"
                  title="Close conversation"
                  onClick={() => setSelectedConversation(null)}
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
                      <div className="message-bubble">
                        <div className="message-text">{msg.text}</div>
                        <div className="message-meta">
                          <span>{formatTime(msg.createdAt)}</span>
                          {isSentByMe && (
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
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
                  {quickEmojis.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className="quick-emoji-item"
                      onClick={() => {
                        setInputMessage((prev) => prev + emoji);
                        setShowEmojiPicker(false);
                        inputRef.current?.focus({ preventScroll: true });
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

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
                  disabled={!inputMessage.trim() || sending}
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
    </div>
  );
}

export default Chat;
