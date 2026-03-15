import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const FRONTEND_URL  = process.env.FRONTEND_URL  || "http://localhost:5173";
const JWT_SECRET    = process.env.JWT_SECRET    || "college_chat_secret_change_me";
const GMAIL_USER    = process.env.GMAIL_USER;
const GMAIL_PASS    = process.env.GMAIL_PASS;
const PORT          = process.env.PORT          || 3000;

app.use(cors({ origin: FRONTEND_URL, methods: ["GET", "POST"] }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: FRONTEND_URL, methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
});

// ─── Nodemailer transporter (Gmail SMTP) ──────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS,   // Gmail App Password (16 chars)
  },
});

const otpStore = new Map();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendEmail(to, otp) {
  await transporter.sendMail({
    from: `"CamConnect" <${GMAIL_USER}>`,
    to,
    subject: "Your CamConnect OTP",
    html: `
      <div style="font-family:sans-serif;max-width:400px;margin:auto;padding:32px;border-radius:12px;border:1px solid #e5e7eb">
        <h2 style="color:#3b55f6;margin-bottom:8px">◈ CamConnect</h2>
        <p style="color:#374151">Your one-time password is:</p>
        <div style="font-size:36px;font-weight:800;letter-spacing:8px;color:#0f1733;margin:16px 0">${otp}</div>
        <p style="color:#6b7280;font-size:13px">Expires in 10 minutes. Do not share this with anyone.</p>
      </div>
    `,
  });
}

// ─── HEALTH CHECK ─────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "CamConnect API running ✅" }));

/* ---------- AUTH ---------- */

app.post("/send-otp", async (req, res) => {
  const { email } = req.body;
  if (!email || !email.endsWith("@abes.ac.in"))
    return res.status(400).json({ error: "Use your @abes.ac.in college email" });

  const otp = generateOTP();
  otpStore.set(email, { otp, expires: Date.now() + 10 * 60 * 1000 });

  // Always log OTP to terminal for easy local testing
  console.log(`\n📧 OTP for ${email}: ${otp}\n`);

  try {
    await sendEmail(email, otp);
    res.json({ success: true });
  } catch (err) {
    console.error("Mail error:", err.message);
    // OTP is still stored — user can use the terminal log for testing
    res.status(500).json({ error: "Failed to send OTP email. Check terminal for OTP." });
  }
});

app.post("/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  const record = otpStore.get(email);
  if (!record) return res.status(400).json({ error: "No OTP requested for this email" });
  if (Date.now() > record.expires) {
    otpStore.delete(email);
    return res.status(400).json({ error: "OTP expired. Request a new one." });
  }
  if (record.otp !== otp) return res.status(400).json({ error: "Invalid OTP" });
  otpStore.delete(email);
  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token });
});

/* ---------- SOCKET ---------- */

let waitingUser = null;
const blockedPairs = new Set();

function blockedKey(a, b) { return [a, b].sort().join("|"); }

setInterval(() => { io.emit("online_count", io.engine.clientsCount); }, 2000);

io.on("connection", (socket) => {
  const token = socket.handshake.auth?.token;
  if (!token) return socket.disconnect();
  try {
    const user = jwt.verify(token, JWT_SECRET);
    socket.email = user.email;
  } catch { return socket.disconnect(); }

  socket.partner = null;

  function tryMatch() {
    if (!waitingUser || waitingUser.id === socket.id) {
      waitingUser = socket;
      socket.emit("waiting");
      return;
    }
    if (blockedPairs.has(blockedKey(socket.email, waitingUser.email))) {
      socket.emit("waiting");
      return;
    }
    const partner = waitingUser;
    waitingUser = null;
    socket.partner = partner.id;
    partner.partner = socket.id;
    socket.emit("matched", { initiator: true });
    partner.emit("matched", { initiator: false });
  }

  socket.on("join", () => tryMatch());

  socket.on("next", () => {
    if (socket.partner) {
      io.to(socket.partner).emit("partner_left");
      const p = io.sockets.sockets.get(socket.partner);
      if (p) p.partner = null;
      socket.partner = null;
    }
    if (waitingUser?.id === socket.id) waitingUser = null;
    tryMatch();
  });

  socket.on("offer",         (d) => socket.partner && io.to(socket.partner).emit("offer", d));
  socket.on("answer",        (d) => socket.partner && io.to(socket.partner).emit("answer", d));
  socket.on("ice-candidate", (d) => socket.partner && io.to(socket.partner).emit("ice-candidate", d));
  socket.on("chat",          (d) => socket.partner && io.to(socket.partner).emit("chat", d));

  socket.on("block", () => {
    if (socket.partner) {
      const p = io.sockets.sockets.get(socket.partner);
      if (p) {
        blockedPairs.add(blockedKey(socket.email, p.email));
        io.to(socket.partner).emit("partner_left");
        p.partner = null;
      }
      socket.partner = null;
    }
    socket.emit("blocked_ack");
  });

  socket.on("disconnect", () => {
    if (waitingUser?.id === socket.id) waitingUser = null;
    if (socket.partner) io.to(socket.partner).emit("partner_left");
  });
});

server.listen(PORT, () => {
  console.log(`✅ CamConnect running on http://localhost:${PORT}`);
  console.log(`📡 Accepting frontend from: ${FRONTEND_URL}`);
});
