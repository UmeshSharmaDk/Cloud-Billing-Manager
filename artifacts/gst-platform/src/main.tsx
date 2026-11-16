import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { applySavedTheme } from "./components/ThemeToggle";

applySavedTheme();

createRoot(document.getElementById("root")!).render(<App />);
