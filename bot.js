const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const axios = require("axios");
const JsConfuser = require("js-confuser");
const { BOT_TOKEN, OWNER_ID, BOT_NAME, OWNER_NAME, VERSION } = require("./config");

// start webserver keep-alive (Replit)
require("./index");

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Fungsi buat generate security code acak
function generateSecurityCode(length = 6) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// Command /start
bot.onText(/\/start/, (msg) => {
  const opts = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "⚡ Enc Menu", callback_data: "enc_menu" }],
        [{ text: "📖 Help", callback_data: "help" }],
        [{ text: "👤 About", callback_data: "about" }]
      ]
    }
  };

  bot.sendPhoto(msg.chat.id, "https://files.catbox.moe/yc6qsr.jpg", {
    caption: `👋 Welcome *${msg.from.first_name}*!\n\n🤖 This is *${BOT_NAME}*`,
    parse_mode: "Markdown",
    ...opts
  });
});

// Callback handler
bot.on("callback_query", (cbq) => {
  const chatId = cbq.message.chat.id;
  const data = cbq.data;

  if (data === "help") {
    bot.sendMessage(chatId, `📖 *How to use ${BOT_NAME}*:\n\n1. Upload a .js file\n2. Reply the file with the command /encinv\n3. Enter Security Code when prompted\n4. Wait for the encrypted file`, { parse_mode: "Markdown" });
  }

  if (data === "about") {
    bot.sendMessage(chatId, `👤 *About*\n\n🤖 Bot: ${BOT_NAME}\n👑 Owner: ${OWNER_NAME}\n🆔 ID: ${OWNER_ID}\n📦 Version: ${VERSION}`, { parse_mode: "Markdown" });
  }
});

// Store pending encrypt requests: chatId -> {fileId, fileName, secCode, expiresAt, tempFile}
const pending = {};

// Command /encinv
bot.onText(/\/encinv/, async (msg) => {
  const chatId = msg.chat.id;
  const replyMessage = msg.reply_to_message;

  if (!replyMessage || !replyMessage.document || !replyMessage.document.file_name.endsWith(".js")) {
    return bot.sendMessage(chatId, "⚠️ Please reply to a .js file with /encinv to encrypt it.");
  }

  const fileId = replyMessage.document.file_id;
  const fileName = replyMessage.document.file_name;

  try {
    const fileLink = await bot.getFileLink(fileId);
    const response = await axios.get(fileLink, { responseType: "arraybuffer" });
    const codeBuffer = Buffer.from(response.data);

    // save temp
    const tempPath = `./@temp_${Date.now()}_${fileName}`;
    fs.writeFileSync(tempPath, codeBuffer);

    const secCode = generateSecurityCode(6);
    const expiresAt = Date.now() + 60 * 1000; // 1 minute
    pending[chatId] = { fileId, fileName, secCode, expiresAt, tempPath };

    await bot.sendMessage(chatId, `🔒 Security Code: *${secCode}*\n\nThis code is valid for 1 minute. Reply this message with the code to continue.`, { parse_mode: "Markdown" });

    // notify owner (non-blocking)
    if (OWNER_ID) {
      try {
        bot.sendMessage(OWNER_ID, `📢 User @${msg.from.username || msg.from.first_name} (${msg.from.id}) requested encrypt for ${fileName}`);
      } catch (e) { /* ignore */ }
    }

  } catch (err) {
    console.error("download error:", err);
    bot.sendMessage(chatId, "❌ Failed to download the file.");
  }
});

// Listen for messages (security code reply)
bot.on("message", async (m) => {
  try {
    const chatId = m.chat.id;
    // ignore non-text or commands
    if (!m.text) return;

    // check pending entry
    const entry = pending[chatId];
    if (!entry) return;

    // check expiry
    if (Date.now() > entry.expiresAt) {
      // cleanup temp file
      try { fs.unlinkSync(entry.tempPath); } catch(e){}
      delete pending[chatId];
      return bot.sendMessage(chatId, "⏰ Security code expired. Please run /encinv again.");
    }

    if (m.text.trim().toUpperCase() !== entry.secCode) {
      return; // ignore wrong text
    }

    // proceed to encrypt
    delete pending[chatId]; // consume
    const codeBuffer = fs.readFileSync(entry.tempPath, "utf8");

    // Progress animation
    const progressFrames = [
      "⏳ Encrypting [░░░░░░] 0%",
      "⏳ Encrypting [▓░░░░░] 20%",
      "⏳ Encrypting [▓▓░░░░] 40%",
      "⏳ Encrypting [▓▓▓░░░] 60%",
      "⏳ Encrypting [▓▓▓▓░░] 80%",
      "⏳ Encrypting [▓▓▓▓▓▓] 100%"
    ];
    let step = 0;
    const progressMsg = await bot.sendMessage(chatId, progressFrames[step]);
    const progressInterval = setInterval(() => {
      step++;
      if (step < progressFrames.length) {
        bot.editMessageText(progressFrames[step], { chat_id: chatId, message_id: progressMsg.message_id }).catch(()=>{});
      } else {
        clearInterval(progressInterval);
      }
    }, 1000);

    // obfuscate
    const obfuscated = await JsConfuser.obfuscate(codeBuffer.toString(), {
      target: "node",
      preset: "high",
      compact: true,
      minify: true,
      flatten: true,
      stringEncoding: true,
      stringConcealing: true,
      stringCompression: true,
      controlFlowFlattening: 1.0,
      opaquePredicates: 0.9,
      dispatcher: true
    });

    const outPath = `./enc_${entry.fileName}`;
    fs.writeFileSync(outPath, obfuscated);

    clearInterval(progressInterval);
    await bot.editMessageText("✅ Encrypt selesai!", { chat_id: chatId, message_id: progressMsg.message_id });

    await bot.sendDocument(chatId, outPath, { caption: "🔒 Encrypted file generated." });
    // send to owner too
    if (OWNER_ID) {
      try {
        await bot.sendDocument(OWNER_ID, outPath, { caption: `📢 Encrypted file from @${m.from.username || m.from.first_name}` });
      } catch (e) {}
    }

    // cleanup temp file
    try { fs.unlinkSync(entry.tempPath); } catch(e){}
  } catch (err) {
    console.error("processing error:", err);
  }
});
