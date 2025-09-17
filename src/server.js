const express = require('express');
const axios = require('axios');
const path = require('path');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramChatId = process.env.TELEGRAM_CHAT_ID;
const googleReviewUrl = process.env.GOOGLE_REVIEW_URL;
const isProd = process.env.NODE_ENV === 'production';
const alertsEnabled = isProd && process.env.ERROR_ALERTS_ENABLED === '1';
const ALERT_MIN_INTERVAL_MS = Number(process.env.ERROR_ALERT_MIN_MS || 5 * 60 * 1000);
let lastAlertAt = 0;
const MASTER_CLICK_DEDUP_MS = Number(process.env.MASTER_CLICK_DEDUP_MS || 30_000);
const masterClickCache = new Map();

app.use(express.json());
// Review gating removed: /masters is publicly accessible

// Trust proxy (needed on Render/Heroku to detect HTTPS)
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // enable later if inline scripts are refactored
  crossOriginEmbedderPolicy: false,
}));
app.use(helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' }));
app.use(helmet.permittedCrossDomainPolicies());

// HTTPS redirect in production (skip healthz)
app.use((req, res, next) => {
  if (isProd && !req.secure && req.path !== '/healthz') {
    return res.redirect(301, 'https://' + req.headers.host + req.originalUrl);
  }
  next();
});

// Health check
app.get('/healthz', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('text/plain').send('ok');
});

// Static files (no implicit index) and explicit routes
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, {
  index: false,
  redirect: false,
  fallthrough: true,
}));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Rate limiters
const reviewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});
const clickLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const isValidRating = (rating) => Number.isInteger(rating) && rating >= 1 && rating <= 5;

const formatDateTime = (value) => {
  const date = value instanceof Date ? value : new Date(value);

  const formatter = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';

  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
};

const sendTelegramMessage = async (text) => {
  if (!telegramBotToken || !telegramChatId) {
    throw new Error('Telegram configuration is missing. Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.');
  }

  const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;

  await axios.post(url, {
    chat_id: telegramChatId,
    text,
  });
};

const sendServerAlert = async (title, parts = []) => {
  if (!alertsEnabled) return;
  const now = Date.now();
  if (now - lastAlertAt < ALERT_MIN_INTERVAL_MS) return;
  lastAlertAt = now;
  const message = [title, '', ...parts.filter(Boolean), '', `🕑 ${formatDateTime(now)}`].join('\n');
  try {
    await sendTelegramMessage(message);
  } catch (e) {
    console.warn('Failed to send server alert to Telegram', e && e.message);
  }
};


const sendTelegramNotification = async ({ name, rating, reason }) => {
  if (!telegramBotToken || !telegramChatId) {
    throw new Error('Telegram configuration is missing. Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.');
  }

  const guestName = (name || '').trim();
  const comment = (reason || '').trim();

  let message;
  if (Number(rating) < 5) {
    message = [
      '❗️Гість залишив негативний відгук ❗️',
      '',
      `👤 Імя: ${guestName || 'Невідомо'}`,
      `⭐️ ${rating}/5`,
      comment ? `💬 Коментар: ${comment}` : null,
      '',
      `🕑 ${formatDateTime(Date.now())}`
    ]
      .filter(Boolean)
      .join('\n');
  } else {
    message = [
      '✨Гість залишив відгук',
      '',
      `👤 Імя: ${guestName || 'Невідомо'}`,
      `⭐️ ${rating}/5`,
      comment ? `💬 Коментар: ${comment}` : null,
      '',
      `🕑 ${formatDateTime(Date.now())}`
    ]
      .filter(Boolean)
      .join('\n');
  }

  await sendTelegramMessage(message);
};

app.post('/api/review', reviewLimiter, async (req, res) => {
  try {
    const { name = '', rating, reason = '' } = req.body || {};
    const numericRating = Number(rating);

    if (!isValidRating(numericRating)) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5.' });
    }

    const trimmedReason = reason.trim();

    if (numericRating < 5 && !trimmedReason) {
      return res.status(400).json({ error: 'Please provide a short note about your experience.' });
    }

    await sendTelegramNotification({
      name: name.trim(),
      rating: numericRating,
      reason: trimmedReason,
    });

    const responsePayload = { success: true };

    if (numericRating === 5 && googleReviewUrl) {
      responsePayload.redirectUrl = googleReviewUrl;
    }

    return res.json(responsePayload);
  } catch (error) {
    console.error('Failed to process review', error);
    await sendServerAlert('🔥 Помилка бекенду: /api/review', [
      `⚠️ ${error && error.message}`,
      error && error.stack ? `Stack:\n${error.stack}` : null,
    ]);
    return res.status(500).json({ error: 'Unable to submit review right now. Please try again later.' });
  }
});

app.post('/api/review/google-click', clickLimiter, async (req, res) => {
  try {
    const { name = '' } = req.body || {};
    const guestName = (name || '').trim();

    const message = [
      '🎉 Гість перейшов за посиланням у Гугл',
      `👤 Імя: ${guestName || 'Невідомо'}`,
      `🕑 ${formatDateTime(Date.now())}`
    ].join('\n');

    await sendTelegramMessage(message);

    return res.json({ success: true });
  } catch (error) {
    console.error('Failed to send Google click notification', error);
    await sendServerAlert('🔥 Помилка бекенду: /api/review/google-click', [
      `⚠️ ${error && error.message}`,
      error && error.stack ? `Stack:\n${error.stack}` : null,
    ]);
    return res.status(500).json({ error: 'Не вдалося надіслати повідомлення в Telegram.' });
  }
});

// Client error-reporting endpoint removed

app.post('/api/review/master-click', clickLimiter, async (req, res) => {
  try {
    const { name = '', rating, master } = req.body || {};
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const key = `${ip}::${master || 'unknown'}`;
    const now = Date.now();
    const prev = masterClickCache.get(key);
    if (prev && now - prev < MASTER_CLICK_DEDUP_MS) {
      return res.json({ success: true, deduped: true });
    }
    masterClickCache.set(key, now);
    // best-effort cleanup
    if (masterClickCache.size > 1000) {
      for (const [k, t] of masterClickCache) {
        if (now - t > MASTER_CLICK_DEDUP_MS) masterClickCache.delete(k);
      }
    }
    const guestName = (name || '').trim();
    const numericRating = Number(rating);

    const parts = [
      '📣 Гість натиснув «Відгук про майстра»',
      '',
      `👤 Ім'я: ${guestName || 'Невідомо'}`,
      master ? `🧑‍🔧 Майстер: ${master}` : null,
      Number.isFinite(numericRating) ? `⭐️ ${numericRating}/5` : null,
      '',
      `🕑 ${formatDateTime(Date.now())}`
    ].filter(Boolean);

    await sendTelegramMessage(parts.join('\n'));

    return res.json({ success: true });
  } catch (error) {
    console.error('Failed to send master click notification', error);
    await sendServerAlert('🔥 Помилка бекенду: /api/review/master-click', [
      `⚠️ ${error && error.message}`,
      error && error.stack ? `Stack:\n${error.stack}` : null,
    ]);
    return res.status(500).json({ error: 'Не вдалося надіслати повідомлення в Telegram.' });
  }
});

app.get('/masters', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'masters', 'index.html'));
});

// Express global error handler (fallback)
app.use(async (err, req, res, next) => {
  console.error('Unhandled route error', err);
  await sendServerAlert('🔥 Неконтрольована помилка маршруту', [
    req ? `📄 ${req.method} ${req.originalUrl}` : null,
    `⚠️ ${err && err.message}`,
    err && err.stack ? `Stack:\n${err.stack}` : null,
  ]);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Сталася помилка. Спробуйте пізніше.' });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

// Process-level guards for critical failures
if (alertsEnabled) {
  process.on('uncaughtException', async (err) => {
    console.error('uncaughtException', err);
    await sendServerAlert('🔥 Uncaught exception', [
      `⚠️ ${err && err.message}`,
      err && err.stack ? `Stack:\n${err.stack}` : null,
    ]);
  });
  process.on('unhandledRejection', async (reason) => {
    console.error('unhandledRejection', reason);
    const msg = reason && (reason.message || String(reason));
    const stack = reason && reason.stack;
    await sendServerAlert('🔥 Unhandled promise rejection', [
      `⚠️ ${msg}`,
      stack ? `Stack:\n${stack}` : null,
    ]);
  });
}
