import { useState, useEffect, createContext, useContext } from "react";
import Auth from "./components/Auth";
import VideoCall from "./components/VideoCall";

export const ThemeContext = createContext();

function App() {
  const [token, setToken] = useState(null);
  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark");

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (savedToken) setToken(savedToken);
  }, []);

  useEffect(() => {
    document.body.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  const handleLogout = () => {
    localStorage.removeItem("token");
    setToken(null);
  };

  if (!token) return (
    <ThemeContext.Provider value={{ dark, setDark }}>
      <Auth onLogin={setToken} />
    </ThemeContext.Provider>
  );

  return (
    <ThemeContext.Provider value={{ dark, setDark }}>
      <VideoCall token={token} onLogout={handleLogout} />
    </ThemeContext.Provider>
  );
}

export default App;