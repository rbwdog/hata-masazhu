const express = require('express');
const axios = require('axios');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramChatId = process.env.TELEGRAM_CHAT_ID;
const googleReviewUrl = process.env.GOOGLE_REVIEW_URL;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

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

const sendTelegramNotification = async ({ name, rating, reason }) => {
  if (!telegramBotToken || !telegramChatId) {
    throw new Error('Telegram configuration is missing. Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.');
  }

  const guestName = (name || '').trim();
  const comment = (reason || '').trim();

  const message = [
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

  await sendTelegramMessage(message);
};

app.post('/api/review', async (req, res) => {
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
    return res.status(500).json({ error: 'Unable to submit review right now. Please try again later.' });
  }
});

app.post('/api/review/google-click', async (req, res) => {
  try {
    const { name = '' } = req.body || {};
    const guestName = (name || '').trim();

    const message = [
      '🎉 Гість перейшов за посиланням у Гугл Відгук',
      '',
      `👤 Імя: ${guestName || 'Невідомо'}`,
      '',
      `🕑 ${formatDateTime(Date.now())}`
    ].join('\n');

    await sendTelegramMessage(message);

    return res.json({ success: true });
  } catch (error) {
    console.error('Failed to send Google click notification', error);
    return res.status(500).json({ error: 'Не вдалося надіслати повідомлення в Telegram.' });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
