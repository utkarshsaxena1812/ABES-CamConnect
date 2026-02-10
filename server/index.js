import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

/* ---------------- CONFIG ---------------- */

const JWT_SECRET = "college_chat_secret";

// OTP memory store
const otpStore = new Map();

// Gmail transporter (use App Password)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "collegechat.auth@gmail.com",
    pass: "tkhk ajmt detg wlnb"
  }
});

/* ---------------- HELPERS ---------------- */

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateUsername() {
  const a = ["Silent","Cool","Brave","Swift","Lucky","Smart"];
  const b = ["Tiger","Wolf","Fox","Lion","Eagle","Panda"];
  return a[Math.floor(Math.random()*a.length)] +
         b[Math.floor(Math.random()*b.length)];
}

/* ---------------- AUTH ROUTES ---------------- */

// Send OTP
app.post("/send-otp", async (req, res) => {
  const { email } = req.body;

  if (!email.endsWith("@abes.ac.in")) {
    return res.status(400).json({ error: "Use college email" });
  }

  const otp = generateOTP();
  otpStore.set(email, otp);

  try {
    await transporter.sendMail({
      from: "College Chat",
      to: email,
      subject: "Your OTP",
      text: `Your OTP is ${otp}`
    });

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Email failed" });
  }
});

// Verify OTP + create JWT
app.post("/verify-otp", (req, res) => {
  const { email, otp } = req.body;

  if (otpStore.get(email) === otp) {
    otpStore.delete(email);

    const token = jwt.sign(
      { email },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.json({ success: true, token });
  }

  res.status(400).json({ error: "Invalid OTP" });
});

// Validate existing token
app.get("/validate-token", (req, res) => {
  const token = req.headers.authorization;

  if (!token) return res.status(401).json({ valid: false });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, email: decoded.email });
  } catch {
    res.status(401).json({ valid: false });
  }
});

/* ---------------- SOCKET ---------------- */

let waitingUser = null;

// Send online user count every 2 seconds
setInterval(() => {
  io.emit("online_count", io.engine.clientsCount);
}, 2000);


io.on("connection", (socket) => {

  /* -------- JWT AUTH FROM CLIENT -------- */

  const token = socket.handshake.auth?.token;

  if (!token) {
    console.log("No token. Disconnecting...");
    socket.disconnect();
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.email = decoded.email;
    console.log("Connected:", socket.email);
  } catch (err) {
    console.log("Invalid token. Disconnecting...");
    socket.disconnect();
    return;
  }

  /* -------- USER STATE -------- */

  socket.state = "idle";
  socket.partner = null;
  socket.username = generateUsername();

  /* -------- MATCHMAKING -------- */

  socket.on("join", () => {
    if (socket.state !== "idle") return;

    if (waitingUser && waitingUser.state !== "waiting") {
      waitingUser = null;
    }

    if (!waitingUser) {
      waitingUser = socket;
      socket.state = "waiting";
      socket.emit("waiting");
    } else {
      const partner = waitingUser;
      waitingUser = null;

      socket.state = "matched";
      partner.state = "matched";

      socket.partner = partner.id;
      partner.partner = socket.id;

      console.log(socket.email, "matched with", partner.email);

      socket.emit("matched", {
      partnerName: partner.username,
      initiator: true
    });

      partner.emit("matched", {
      partnerName: socket.username,
      initiator: false
    });


      socket.emit("chat_ready");
      partner.emit("chat_ready");
    }
  });

  /* -------- NEXT -------- */

  socket.on("next", () => {
    if (socket.state !== "matched") return;

    const partnerSocket = io.sockets.sockets.get(socket.partner);
    if (partnerSocket) {
      partnerSocket.state = "idle";
      partnerSocket.partner = null;
      partnerSocket.emit("partner_left");
    }

    socket.state = "idle";
    socket.partner = null;
    socket.emit("rejoin");
  });

  /* -------- CHAT -------- */

  socket.on("chat_message", (msg) => {
    if (socket.state !== "matched") return;

    const partnerSocket = io.sockets.sockets.get(socket.partner);
    if (!partnerSocket) return;

    partnerSocket.emit("chat_message", {
      from: socket.username,
      text: msg
    });
  });

  /* -------- DISCONNECT -------- */

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.email);

    if (waitingUser && waitingUser.id === socket.id) {
      waitingUser = null;
    }

    if (socket.partner) {
      const partnerSocket = io.sockets.sockets.get(socket.partner);
      if (partnerSocket) {
        partnerSocket.state = "idle";
        partnerSocket.partner = null;
        partnerSocket.emit("partner_left");
      }
    }
  });
  // WebRTC signaling
  socket.on("offer", (offer) => {
    const partnerSocket = io.sockets.sockets.get(socket.partner);
    if (partnerSocket) {
    partnerSocket.emit("offer", offer);
    }
  });

  socket.on("answer", (answer) => {
    const partnerSocket = io.sockets.sockets.get(socket.partner);
    if (partnerSocket) {
      partnerSocket.emit("answer", answer);
    }
  });

  socket.on("ice-candidate", (candidate) => {
    const partnerSocket = io.sockets.sockets.get(socket.partner);
    if (partnerSocket) {
      partnerSocket.emit("ice-candidate", candidate);
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

