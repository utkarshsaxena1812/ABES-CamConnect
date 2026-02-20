import { useEffect, useRef, useState, useContext } from "react";
import { io } from "socket.io-client";
import { ThemeContext } from "../App";

// ✅ Uses env variable — auto-switches between local and production
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export default function VideoCall({ token, onLogout }) {
  const { dark, setDark } = useContext(ThemeContext);

  const localVideoRef  = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef          = useRef(null);
  const socketRef      = useRef(null);
  const localStreamRef = useRef(null);
  const timerRef       = useRef(null);
  const chatEndRef     = useRef(null);

  const [status, setStatus]     = useState("idle");
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState("");
  const [onlineCount, setCount] = useState(0);
  const [camOn, setCamOn]       = useState(true);
  const [micOn, setMicOn]       = useState(true);
  const [callSeconds, setSecs]  = useState(0);
  const [blocked, setBlocked]   = useState(false);

  function fmtTime(s) {
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  function startTimer() {
    setSecs(0);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setSecs((p) => p + 1), 1000);
  }

  function stopTimer() {
    clearInterval(timerRef.current);
    setSecs(0);
  }

  function addMsg(from, text) {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages((prev) => [...prev, { from, text, time }]);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  function closePeer() {
    pcRef.current?.close();
    pcRef.current = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }

  useEffect(() => {
    const socket = io(SERVER_URL, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });
    socketRef.current = socket;

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      })
      .catch(() => {
        navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
          localStreamRef.current = stream;
        });
      });

    socket.on("online_count", setCount);
    socket.on("waiting",      () => setStatus("waiting"));

    socket.on("matched", async ({ initiator }) => {
      setStatus("connected");
      setBlocked(false);
      setMessages([]);
      startTimer();

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      localStreamRef.current?.getTracks().forEach((t) =>
        pc.addTrack(t, localStreamRef.current)
      );

      pc.ontrack = (e) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit("ice-candidate", e.candidate);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          setStatus("partner_left");
          stopTimer();
          closePeer();
        }
      };

      if (initiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("offer", offer);
      }
    });

    socket.on("offer", async (offer) => {
      if (!pcRef.current) return;
      await pcRef.current.setRemoteDescription(offer);
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      socket.emit("answer", answer);
    });

    socket.on("answer",        (a) => pcRef.current?.setRemoteDescription(a));
    socket.on("ice-candidate", (c) => pcRef.current?.addIceCandidate(c));
    socket.on("chat",          (msg) => addMsg("Partner", msg));

    socket.on("partner_left", () => {
      stopTimer();
      closePeer();
      setStatus("partner_left");
    });

    socket.on("blocked_ack", () => {
      stopTimer();
      closePeer();
      setStatus("idle");
    });

    socket.on("disconnect", (reason) => {
      if (reason === "io server disconnect") socket.connect();
    });

    return () => {
      socket.disconnect();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      stopTimer();
    };
  }, [token]);

  function handleJoin() {
    setStatus("waiting");
    setMessages([]);
    socketRef.current?.emit("join");
  }

  function handleNext() {
    stopTimer();
    setMessages([]);
    closePeer();
    socketRef.current?.emit("next");
    setStatus("waiting");
  }

  function handleBlock() {
    if (!window.confirm("Block this user? You won't be matched with them again.")) return;
    setBlocked(true);
    socketRef.current?.emit("block");
  }

  function sendChat() {
    if (!input.trim() || status !== "connected") return;
    socketRef.current?.emit("chat", input.trim());
    addMsg("You", input.trim());
    setInput("");
  }

  function toggleCam() {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) { track.enabled = !track.enabled; setCamOn(track.enabled); }
  }

  function toggleMic() {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; setMicOn(track.enabled); }
  }

  const statusMap = {
    idle:        { text: "Ready to connect", cls: "status-idle" },
    waiting:     { text: "🔍 Searching for a partner…", cls: "status-waiting" },
    connected:   { text: `🟢 Connected  ·  ${fmtTime(callSeconds)}`, cls: "status-connected" },
    partner_left:{ text: "Partner disconnected — find a new one!", cls: "status-left" },
  };
  const { text: statusText, cls: statusCls } = statusMap[status] || statusMap.idle;

  return (
    <div className="app-wrap">
      <header className="app-header">
        <div className="logo">
          <span className="logo-icon">◈</span>
          <span className="logo-text">CamConnect</span>
        </div>
        <div className="header-right">
          <span className="online-badge">⬤ {onlineCount} online</span>
          <button className="icon-btn" onClick={() => setDark((d) => !d)} title="Toggle theme">
            {dark ? "☀" : "☾"}
          </button>
          <button className="icon-btn danger" onClick={onLogout} title="Logout">⏻</button>
        </div>
      </header>

      <div className={`status-bar ${statusCls}`}>{statusText}</div>

      <main className="main-grid">
        <section className="video-section">
          <div className="video-grid">
            <div className="video-card">
              <span className="video-label">You {!camOn && "· Camera Off"}</span>
              <video ref={localVideoRef} autoPlay muted playsInline className={!camOn ? "cam-off" : ""} />
            </div>
            <div className="video-card remote">
              <span className="video-label">Partner</span>
              {status !== "connected"
                ? <div className="video-placeholder">
                    <span>{status === "waiting" ? "Searching…" : "No Partner"}</span>
                  </div>
                : <video ref={remoteVideoRef} autoPlay playsInline />
              }
            </div>
          </div>

          <div className="controls-row">
            {(status === "idle" || status === "partner_left") && (
              <button className="btn primary pulse" onClick={handleJoin}>
                {status === "partner_left" ? "🔄 Find New Partner" : "▶ Start Chat"}
              </button>
            )}
            {status === "waiting" && (
              <button className="btn secondary" disabled>⏳ Searching…</button>
            )}
            {status === "connected" && (
              <>
                <button className="btn secondary" onClick={handleNext}>⏭ Next</button>
                <button className={`btn icon-toggle ${camOn ? "" : "off"}`} onClick={toggleCam}>
                  {camOn ? "📷 Cam On" : "📷 Cam Off"}
                </button>
                <button className={`btn icon-toggle ${micOn ? "" : "off"}`} onClick={toggleMic}>
                  {micOn ? "🎤 Mic On" : "🎤 Muted"}
                </button>
                <button className="btn danger" onClick={handleBlock} disabled={blocked}>
                  🚫 Block
                </button>
              </>
            )}
          </div>
        </section>

        <section className="chat-section">
          <div className="chat-header">💬 Chat</div>
          <div className="messages">
            {messages.length === 0 && <p className="chat-empty">No messages yet. Say hi! 👋</p>}
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.from === "You" ? "msg-self" : "msg-other"}`}>
                <div className="msg-bubble">{m.text}</div>
                <div className="msg-meta">{m.from} · {m.time}</div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="chat-input-row">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendChat()}
              placeholder={status === "connected" ? "Type a message…" : "Connect first…"}
              disabled={status !== "connected"}
            />
            <button className="btn primary" onClick={sendChat} disabled={status !== "connected"}>Send</button>
          </div>
        </section>
      </main>
    </div>
  );
}