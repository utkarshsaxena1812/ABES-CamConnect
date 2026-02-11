import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

/* -------- ENV VARIABLES -------- */

const EMAIL_USER = process.env.EMAIL_USER;   // your Gmail e.g. yourname@gmail.com
const EMAIL_PASS = process.env.EMAIL_PASS;   // Gmail App Password (16 chars, no spaces)
const JWT_SECRET = process.env.JWT_SECRET || "abes_camconnect_secret_2024";

/* -------- MAIL SETUP -------- */
// NOTE: You send FROM Gmail → TO college Outlook. That is correct.
// FIX: Added tls option for hosting compatibility
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS     // Must be a Gmail App Password, NOT your regular Gmail password
  },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 15000,
  tls: {
    rejectUnauthorized: false  // Helps on some hosting providers like Render
  }
});

// Verify mail connection on startup so you see the error immediately
transporter.verify((error) => {
  if (error) {
    console.error("❌ Mail transporter error:", error.message);
    console.error("   → Check EMAIL_USER and EMAIL_PASS env variables on Render");
  } else {
    console.log("✅ Mail transporter ready — emails will send");
  }
});

/* -------- OTP STORE -------- */
// FIX: Store OTP with 5-minute expiry
const otpStore = new Map();  // email -> { otp, expiresAt }

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateUsername() {
  const a = ["Silent","Cool","Brave","Swift","Lucky","Smart","Clever","Bold"];
  const b = ["Tiger","Wolf","Fox","Lion","Eagle","Panda","Hawk","Bear"];
  return a[Math.floor(Math.random()*a.length)] +
         b[Math.floor(Math.random()*b.length)];
}

/* -------- AUTH ROUTES -------- */

// Send OTP
app.post("/send-otp", async (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ error: "Email required" });

  // FIX: Trim whitespace so "user@abes.ac.in " doesn't fail
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanEmail.endsWith("@abes.ac.in")) {
    return res.status(400).json({ error: "Only @abes.ac.in email allowed" });
  }

  // FIX: Rate limit — don't allow resend within 60 seconds
  const existing = otpStore.get(cleanEmail);
  if (existing && Date.now() < existing.expiresAt - 4 * 60 * 1000) {
    return res.status(429).json({ error: "Please wait 60 seconds before requesting a new OTP" });
  }

  const otp = generateOTP();
  otpStore.set(cleanEmail, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });

  try {
    await transporter.sendMail({
      from: `"ABES CamConnect" <${EMAIL_USER}>`,
      to: cleanEmail,
      subject: "Your ABES CamConnect OTP",
      text: `Your OTP is: ${otp}\n\nThis OTP expires in 5 minutes.\nDo not share this with anyone.`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:24px;
                    border:1px solid #dbeafe;border-radius:12px;background:#f8fbff;">
          <h2 style="color:#1d4ed8;text-align:center;margin-bottom:8px;">ABES CamConnect</h2>
          <p style="color:#334155;">Your One-Time Password:</p>
          <div style="font-size:36px;font-weight:bold;letter-spacing:10px;text-align:center;
                      background:#eff6ff;padding:20px;border-radius:8px;color:#1d4ed8;margin:16px 0;">
            ${otp}
          </div>
          <p style="color:#64748b;font-size:13px;">
            Expires in <strong>5 minutes</strong>. Do not share this OTP with anyone.
          </p>
        </div>
      `
    });

    console.log(`✅ OTP sent to: ${cleanEmail}`);
    res.json({ success: true, message: "OTP sent to your college email" });

  } catch (err) {
    console.error("❌ Mail send error:", err.message);
    otpStore.delete(cleanEmail);  // FIX: Clean up on failure
    res.status(500).json({
      error: "Failed to send email. Server mail config issue.",
      detail: err.message
    });
  }
});

// Verify OTP
app.post("/verify-otp", (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) return res.status(400).json({ error: "Email and OTP required" });

  const cleanEmail = email.trim().toLowerCase();
  const record = otpStore.get(cleanEmail);

  if (!record) {
    return res.status(400).json({ error: "No OTP found. Please request a new one." });
  }

  // FIX: Check expiry
  if (Date.now() > record.expiresAt) {
    otpStore.delete(cleanEmail);
    return res.status(400).json({ error: "OTP expired. Please request a new one." });
  }

  if (record.otp !== otp.trim()) {
    return res.status(400).json({ error: "Invalid OTP" });
  }

  otpStore.delete(cleanEmail);

  const token = jwt.sign({ email: cleanEmail }, JWT_SECRET, { expiresIn: "30d" });

  console.log(`✅ Login verified: ${cleanEmail}`);
  return res.json({ success: true, token });
});

// Validate token
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

// Health check — useful for Render to confirm server is alive
app.get("/", (req, res) => {
  res.json({ status: "ABES CamConnect backend running ✅" });
});

/* -------- SOCKET -------- */

let waitingUser = null;

setInterval(() => {
  io.emit("online_count", io.engine.clientsCount);
}, 3000);

io.on("connection", (socket) => {

  const token = socket.handshake.auth?.token;
  if (!token) { socket.disconnect(); return; }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.email = decoded.email;
    console.log("🔌 Connected:", socket.email);
  } catch {
    socket.disconnect();
    return;
  }

  socket.state = "idle";
  socket.partner = null;
  socket.username = generateUsername();

  socket.on("join", () => {
    if (socket.state !== "idle") return;

    // FIX: Ensure waiting user is still connected before pairing
    if (waitingUser && waitingUser.id !== socket.id && waitingUser.connected) {
      const partner = waitingUser;
      waitingUser = null;

      socket.state = "matched";
      partner.state = "matched";
      socket.partner = partner.id;
      partner.partner = socket.id;

      socket.emit("matched", { partnerName: partner.username, initiator: true });
      partner.emit("matched", { partnerName: socket.username, initiator: false });

    } else {
      waitingUser = socket;
      socket.state = "waiting";
      socket.emit("waiting");
    }
  });

  socket.on("next", () => {
    const partnerId = socket.partner;
    if (partnerId) {
      const partner = io.sockets.sockets.get(partnerId);
      if (partner) {
        partner.partner = null;
        partner.state = "idle";
        partner.emit("partner_left");
        partner.emit("rejoin");
      }
    }
    socket.partner = null;
    socket.state = "idle";
  });

  // WebRTC signaling
  socket.on("offer", (offer) => {
    const p = io.sockets.sockets.get(socket.partner);
    if (p) p.emit("offer", offer);
  });

  socket.on("answer", (answer) => {
    const p = io.sockets.sockets.get(socket.partner);
    if (p) p.emit("answer", answer);
  });

  socket.on("ice-candidate", (c) => {
    const p = io.sockets.sockets.get(socket.partner);
    if (p) p.emit("ice-candidate", c);
  });

  // Chat message relay
  socket.on("chat_message", (text) => {
    const p = io.sockets.sockets.get(socket.partner);
    if (p) p.emit("chat_message", { from: socket.username, text });
  });

  // Block partner
  socket.on("block", () => {
    const partnerId = socket.partner;
    if (partnerId) {
      const partner = io.sockets.sockets.get(partnerId);
      if (partner) {
        partner.partner = null;
        partner.state = "idle";
        partner.emit("partner_left");
      }
    }
    socket.partner = null;
    socket.state = "idle";
  });

  // Disconnect cleanup
  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.email);

    if (waitingUser && waitingUser.id === socket.id) {
      waitingUser = null;
    }

    const partnerId = socket.partner;
    if (partnerId) {
      const partner = io.sockets.sockets.get(partnerId);
      if (partner) {
        partner.partner = null;
        partner.state = "idle";
        partner.emit("partner_left");
      }
    }
  });
});

/* -------- START -------- */

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 ABES CamConnect server running on port ${PORT}`);
});