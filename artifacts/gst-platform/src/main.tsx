import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { applySavedTheme } from "./components/ThemeToggle";
import { startTranslation } from "./lib/i18n";

applySavedTheme();
startTranslation();

createRoot(document.getElementById("root")!).render(<App />);
