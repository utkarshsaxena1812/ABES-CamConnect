const BACKEND_URL = "https://abes-camconnect-backend.onrender.com";

let socket = null;

function connectSocket() {
  const token = localStorage.getItem("token");
  socket = io(BACKEND_URL, {
    auth: { token }
  });
}


const remoteVideo = document.getElementById("remoteVideo");

let peerConnection = null;

const config = {
  iceServers: [
    // Google STUN
    { urls: "stun:stun.l.google.com:19302" },

    // Free public TURN (for development)
    {
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp"
      ],
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ]
};


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
let localStream = null;


let chatEnabled = false;

/* ---------- AUTO LOGIN ---------- */

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

/* ---------- AUTH ---------- */

sendOtp.onclick = async () => {
  await fetch(BACKEND_URL + "/send-otp", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ email: email.value })
  });
  alert("OTP sent");
};

verifyOtp.onclick = async () => {
  const res = await fetch(BACKEND_URL + "/verify-otp", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ email: email.value, otp: otp.value })
  });

  if (res.ok) {
    const data = await res.json();
    localStorage.setItem("token", data.token);
    connectSocket();

    authDiv.style.display = "none";
    appDiv.style.display = "block";
    startCamera();
  } else {
    alert("Wrong OTP");
  }
};

logoutBtn.onclick = () => {
  localStorage.removeItem("token");
  location.reload();
};

/* ---------- MATCH ---------- */

joinBtn.onclick = () => {
  joinBtn.disabled = true;
  nextBtn.disabled = true;

  socket.emit("join");
  status.innerText = "Searching for users...";
};


nextBtn.onclick = () => {
  nextBtn.disabled = true;
  status.innerText = "Finding next user...";

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteVideo.srcObject = null;
  chat.style.display = "none";

  socket.emit("next");
};

socket.on("online_count", (count) => {
  onlineCountText.innerText = count + " users online";
});


socket.on("waiting", () => {
  status.innerText = "Waiting for someone...";
});

socket.on("matched", async (data) => {
  joinBtn.disabled = true;
  nextBtn.disabled = false;
  chat.style.display = "block";
  status.innerText = "Connected with " + data.partnerName;

  createPeerConnection();

  // Only initiator creates offer
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

socket.on("rejoin", () => {
  socket.emit("join");
});

socket.on("chat_ready", () => {
  chatEnabled = true;
});

socket.on("partner_left", () => {
  status.innerText = "Partner disconnected. Searching again...";
  nextBtn.disabled = true;
  joinBtn.disabled = true;
  chat.style.display = "none";

  // Clean video
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteVideo.srcObject = null;
});


/* ---------- CHAT ---------- */

sendBtn.onclick = () => {
  if (!chatEnabled) return;

  const msg = msgInput.value.trim();
  if (!msg) return;

  addMessage("You", msg);
  socket.emit("chat_message", msg);
  msgInput.value = "";
};

socket.on("chat_message", (data) => {
  addMessage(data.from, data.text);
});

function addMessage(sender, text) {
  const d = document.createElement("div");
  d.innerText = sender + ": " + text;
  messages.appendChild(d);
  messages.scrollTop = messages.scrollHeight;
}

async function startCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    localVideo.srcObject = localStream;
  } catch (err) {
    console.log("Camera error:", err);
    alert("Camera permission denied or not available");
  }
}

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(config);

  // Send ICE candidates to partner
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", event.candidate);
    }
  };

  // Receive remote stream
  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  // Add local tracks
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });
}


