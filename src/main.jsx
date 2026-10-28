import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import "@mantine/core/styles.css";
import "./fonts.css";
import App from "./App.jsx";

// Custom blue palette based on #4A8BDB (index 6 is the primary shade)
const customBlue = [
  "#edf4fc",
  "#dbe9f9",
  "#c4dcf5",
  "#a6caf0",
  "#82b3ea",
  "#639ee3",
  "#4A8BDB",
  "#3b77c4",
  "#2e63ad",
  "#234f91",
];

const theme = createTheme({
  primaryColor: "blue",
  colors: {
    blue: customBlue,
  },
  defaultRadius: "lg",
  radius: {
    xs: "6px",
    sm: "10px",
    md: "14px",
    lg: "18px",
    xl: "28px",
  },
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MantineProvider theme={theme}>
      <App />
    </MantineProvider>
  </React.StrictMode>
);