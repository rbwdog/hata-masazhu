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

const sendTelegramNotification = async ({ name, rating, reason }) => {
  if (!telegramBotToken || !telegramChatId) {
    throw new Error('Telegram configuration is missing. Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.');
  }

  const messageLines = [
    '\u2728 New massage review received!',
    `Rating: ${rating} star${rating === 1 ? '' : 's'}`,
  ];

  if (name) {
    messageLines.push(`Guest: ${name}`);
  }

  if (rating < 5 && reason) {
    messageLines.push('\nGuest feedback:');
    messageLines.push(reason);
  }

  const message = messageLines.join('\n');
  const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;

  await axios.post(url, {
    chat_id: telegramChatId,
    text: message,
  });
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

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
