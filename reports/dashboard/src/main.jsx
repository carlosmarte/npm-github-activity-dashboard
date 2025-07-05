import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Report from "./report/developer_insights/main";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Report />
  </StrictMode>
);
