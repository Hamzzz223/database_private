const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("🚀 Trickless Obf Bot is running...");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Webserver running on port ${PORT}`);
});
