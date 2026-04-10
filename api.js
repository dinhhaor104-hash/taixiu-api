const express = require("express");
const { connect, getResults } = require("./ws-client");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/result", (req, res) => {
  const results = getResults();
  if (!results.length) return res.json({ status: "waiting", data: null });
  res.json({ status: "ok", data: results[0] });
});

app.get("/history", (req, res) => {
  const results = getResults();
  res.json({ status: "ok", count: results.length, data: results });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[API] Server chạy tại port ${PORT}`);
  connect();
});
