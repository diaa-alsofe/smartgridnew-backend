require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// تخزين مؤقت للـ OTP وربط الهاتف بـ chatId
const otpStore = {}; // { phone: { otp, expiry } }
const phoneToChat = {}; // { phone: chatId }

// ===== البوت يستقبل رسائل المستخدمين =====
bot.onText(/\/start (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const phone = match[1]; // الرقم اللي أرسله التطبيق

  phoneToChat[phone] = chatId;

  bot.sendMessage(chatId,
    `مرحباً! 👋\nسيتم إرسال رمز التحقق الخاص بك هنا.\nرقمك المسجل: ${phone}`
  );
});

bot.onText(/\/start$/, (msg) => {
  bot.sendMessage(msg.chat.id,
    'مرحباً! هذا بوت التحقق لتطبيق SmartGrid.\nافتح التطبيق وأدخل رقمك لتلقي رمز التحقق.'
  );
});

// ===== API: ربط رقم الهاتف بـ chatId =====
app.post('/auth/link', (req, res) => {
  const { phone, chatId } = req.body;
  if (!phone || !chatId) {
    return res.status(400).json({ message: 'phone and chatId required' });
  }
  phoneToChat[phone] = chatId;
  res.json({ message: 'linked' });
});

// ===== API: إرسال OTP =====
app.post('/auth/send-otp', async (req, res) => {
  const { phone } = req.body;

  if (!phone || !phone.startsWith('+963')) {
    return res.status(400).json({ message: 'Syrian numbers only (+963)' });
  }

  const chatId = phoneToChat[phone];
  if (!chatId) {
    return res.status(404).json({
      message: 'not_linked',
      hint: 'User must open Telegram bot first'
    });
  }

  // توليد OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore[phone] = {
    otp,
    expiry: Date.now() + 5 * 60 * 1000 // 5 دقائق
  };

  try {
    await bot.sendMessage(chatId,
      `🔐 رمز التحقق الخاص بك:\n\n` +
      `*${otp}*\n\n` +
      `⏱ صالح لمدة 5 دقائق فقط.\n` +
      `❌ لا تشاركه مع أحد.`,
      { parse_mode: 'Markdown' }
    );
    res.json({ message: 'OTP sent' });
  } catch (e) {
    res.status(500).json({ message: 'Failed to send OTP', error: e.message });
  }
});

// ===== API: التحقق من OTP =====
app.post('/auth/verify-otp', (req, res) => {
  const { phone, otp } = req.body;

  const record = otpStore[phone];
  if (!record) {
    return res.status(400).json({ message: 'No OTP found for this number' });
  }

  if (Date.now() > record.expiry) {
    delete otpStore[phone];
    return res.status(400).json({ message: 'OTP expired' });
  }

  if (record.otp !== otp) {
    return res.status(400).json({ message: 'Invalid OTP' });
  }

  delete otpStore[phone];

  // إنشاء JWT
  const token = jwt.sign(
    { phone },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );

  res.json({ token, phone });
});

// ===== Health Check =====
app.get('/', (req, res) => {
  res.json({ status: 'SmartGrid Backend Running' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});