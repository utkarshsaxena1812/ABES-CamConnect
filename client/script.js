window.addEventListener("DOMContentLoaded", () => {

/* ================= CONFIG ================= */

const BACKEND_URL = "https://abes-camconnect-backend.onrender.com"; // your Render URL

/* ================= ELEMENTS ================= */

const onlineCountText = document.getElementById("onlineCount");

const authDiv = document.getElementById("auth");
const appDiv = document.getElementById("chatApp");

const email = document.getElementById("email");
const otp = document.getElementById("otp");
const sendOtp = document.getElementById("sendOtp");
const verifyOtp = document.getElementById("verifyOtp");

const logoutBtn = document.getElementById("logoutBtn");

const joinBtn = document.getElementById("joinBtn");
const nextBtn = document.getElementById("nextBtn");
const status = document.getElementById("status");

const chatDiv = document.getElementById("chat");
const messages = document.getElementById("messages");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

/* ================= SOCKET ================= */

let socket = null;
let peerConnection = null;
let localStream = null;
let chatEnabled = false;

function connectSocket() {
  const token = localStorage.getItem("token");

  socket = io(BACKEND_URL, {
    auth: { token }
  });

  socket.on("online_count", (count) => {
    if (onlineCountText) {
      onlineCountText.innerText = count + " users online";
    }
  });

  socket.on("waiting", () => {
    status.innerText = "Waiting for someone...";
  });

  socket.on("matched", async (data) => {
    status.innerText = "Connected with " + data.partnerName;
    nextBtn.disabled = false;
    chatDiv.style.display = "block";

    createPeerConnection();

    if (data.initiator) {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit("offer", offer);
    }
  });

  socket.on("offer", async (offer) => {
    createPeerConnection();
    await peerConnection.setRemoteDescription(offer);

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit("answer", answer);
  });

  socket.on("answer", async (answer) => {
    await peerConnection.setRemoteDescription(answer);
  });

  socket.on("ice-candidate", async (candidate) => {
    if (peerConnection) {
      await peerConnection.addIceCandidate(candidate);
    }
  });

  socket.on("partner_left", () => {
    status.innerText = "Partner disconnected";
    chatDiv.style.display = "none";

    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    remoteVideo.srcObject = null;
  });

  socket.on("rejoin", () => {
    socket.emit("join");
  });

  socket.on("chat_message", (data) => {
    addMessage(data.from, data.text);
  });
}

/* ================= AUTH ================= */

window.onload = async () => {
  const token = localStorage.getItem("token");
  if (!token) return;

  const res = await fetch(BACKEND_URL + "/validate-token", {
    headers: { Authorization: token }
  });

  if (res.ok) {
    authDiv.style.display = "none";
    appDiv.style.display = "block";
    connectSocket();
    startCamera();
  } else {
    localStorage.removeItem("token");
  }
};

sendOtp.onclick = async () => {
  try {
    const res = await fetch(BACKEND_URL + "/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.value })
    });

    const data = await res.json();

    if (res.ok) {
      alert("OTP sent");
    } else {
      alert(data.error || "Failed");
    }
  } catch {
    alert("Server connection failed");
  }
};

verifyOtp.onclick = async () => {
  const res = await fetch(BACKEND_URL + "/verify-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.value, otp: otp.value })
  });

  if (res.ok) {
    const data = await res.json();
    localStorage.setItem("token", data.token);

    authDiv.style.display = "none";
    appDiv.style.display = "block";

    connectSocket();
    startCamera();
  } else {
    alert("Wrong OTP");
  }
};

logoutBtn.onclick = () => {
  localStorage.removeItem("token");
  location.reload();
};

/* ================= MATCH ================= */

joinBtn.onclick = () => {
  joinBtn.disabled = true;
  nextBtn.disabled = true;

  socket.emit("join");
  status.innerText = "Searching...";
};

nextBtn.onclick = () => {
  nextBtn.disabled = true;

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteVideo.srcObject = null;
  chatDiv.style.display = "none";

  socket.emit("next");
};

/* ================= CHAT ================= */

sendBtn.onclick = () => {
  const msg = msgInput.value.trim();
  if (!msg) return;

  addMessage("You", msg);
  socket.emit("chat_message", msg);
  msgInput.value = "";
};

function addMessage(sender, text) {
  const div = document.createElement("div");
  div.innerText = sender + ": " + text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

/* ================= CAMERA ================= */

async function startCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    localVideo.srcObject = localStream;
  } catch {
    alert("Camera permission denied");
  }
}

/* ================= WEBRTC ================= */

function createPeerConnection() {
  peerConnection = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" }
    ]
  });

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", event.candidate);
    }
  };

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });
}

});
