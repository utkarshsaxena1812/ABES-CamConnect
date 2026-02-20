import { useState, useContext } from "react";
import { ThemeContext } from "../App";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

export default function Auth({ onLogin }) {
  const { dark, setDark } = useContext(ThemeContext);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState("email"); // email | otp
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function sendOtp() {
    setError(""); setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStep("otp");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    setError(""); setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      localStorage.setItem("token", data.token);
      onLogin(data.token);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
          <button className="icon-btn" onClick={() => setDark(d => !d)} title="Toggle theme">
            {dark ? "☀" : "☾"}
          </button>
        </div>

        <div className="auth-logo">◈ <span>CamConnect</span></div>
        <p className="auth-sub">Connect with ABES students via video chat</p>

        {step === "email" ? (
          <>
            <input
              type="email"
              placeholder="yourname@abes.ac.in"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendOtp()}
            />
            <button
              className="btn primary"
              style={{ width: "100%", marginTop: "12px", justifyContent: "center", padding: "12px" }}
              onClick={sendOtp}
              disabled={loading || !email}
            >
              {loading ? "Sending…" : "Send OTP"}
            </button>
          </>
        ) : (
          <>
            <p style={{ fontSize: "13px", color: "var(--text2)", marginBottom: "12px" }}>
              OTP sent to <strong>{email}</strong>
            </p>
            <input
              type="text"
              placeholder="Enter 6-digit OTP"
              value={otp}
              onChange={e => setOtp(e.target.value)}
              onKeyDown={e => e.key === "Enter" && verifyOtp()}
              maxLength={6}
            />
            <button
              className="btn primary"
              style={{ width: "100%", marginTop: "12px", justifyContent: "center", padding: "12px" }}
              onClick={verifyOtp}
              disabled={loading || otp.length < 6}
            >
              {loading ? "Verifying…" : "Verify & Join"}
            </button>
            <button
              className="btn secondary"
              style={{ width: "100%", marginTop: "8px", justifyContent: "center" }}
              onClick={() => { setStep("email"); setError(""); }}
            >
              ← Back
            </button>
          </>
        )}

        {error && <p className="auth-error">⚠ {error}</p>}
      </div>
    </div>
  );
}