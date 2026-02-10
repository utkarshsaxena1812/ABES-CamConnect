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

const JWT_SECRET = process.env.JWT_SECRET;

// OTP memory store
const otpStore = new Map();

// Gmail transporter using Render env variables
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
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

  console.log("OTP request for:", email);

  if (!email.endsWith("@abes.ac.in")) {
    return res.status(400).json({ error: "Use college email" });
  }

  const otp = generateOTP();
  otpStore.set(email, otp);

  try {
    console.log("Sending OTP from:", process.env.EMAIL_USER);

    await transporter.sendMail({
      from: `"ABES CamConnect" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your OTP",
      text: `Your OTP is ${otp}`
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Email error:", err);
    res.status(500).json({ error: "Email failed" });
  }
});

// Verify OTP + create JWT
app.post("/verify-otp", (req, res) => {
  const {
