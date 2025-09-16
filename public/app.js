(() => {
  const form = document.getElementById('review-form');
  const stars = Array.from(document.querySelectorAll('.star'));
  const ratingInput = document.getElementById('rating-value');
  const nameInput = document.getElementById('guest-name');
  const feedbackInput = document.getElementById('feedback');
  const statusEl = document.querySelector('.form-status');
  const submitBtn = form.querySelector('.submit-btn');
  const rewardBanner = document.getElementById('reward-banner');
  const rewardLink = document.getElementById('reward-link');
  const tipsBanner = document.getElementById('tips-banner');
  const tipsLink = document.getElementById('tips-link');

  let selectedRating = null;
  let googleClickSent = false;
  let formLocked = false;

  const STORAGE_KEY = 'hataMasazhuReview';
  const REVIEW_TTL_MS = 72 * 60 * 60 * 1000;

  const safeParse = (raw) => {
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  };

  const getStoredReview = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }

      const parsed = safeParse(raw);

      if (!parsed) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }

      const submittedAt = parsed.submittedAt ? new Date(parsed.submittedAt).getTime() : null;

      if (!submittedAt || Number.isNaN(submittedAt)) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }

      if (Date.now() - submittedAt > REVIEW_TTL_MS) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }

      return parsed;
    } catch (error) {
      return null;
    }
  };

  const storeReview = (review) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(review));
    } catch (error) {
      // Якщо не вдалося зберегти — просто пропускаємо, обмеження браузера
    }
  };

  const disableForm = () => {
    formLocked = true;
    form.setAttribute('aria-disabled', 'true');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Відгук надіслано';

    stars.forEach((star) => {
      star.disabled = true;
      star.setAttribute('tabindex', '-1');
    });

    nameInput.setAttribute('disabled', 'disabled');
    feedbackInput.setAttribute('disabled', 'disabled');
  };

  const hydrateFromStorage = () => {
    const review = getStoredReview();

    if (!review) {
      return;
    }

    if (review.rating === 5 && !review.redirectUrl) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    nameInput.value = review.name || '';
    const ratingValue = Number(review.rating) || null;
    setRating(ratingValue, { preserveReward: true });

    const reviewReason = (review.reason || '').trim();
    feedbackInput.value = reviewReason;
    feedbackInput.required = ratingValue !== null && ratingValue < 5;

    googleClickSent = Boolean(review.googleClicked);

    if (review.redirectUrl) {
      showReward(review.redirectUrl, true);
    }

    if (review.googleClicked) {
      showTips();
    }
    setStatus('Ви вже залишили відгук. Дякуємо!', 'success');
    disableForm();
  };

  const updateStars = (rating) => {
    stars.forEach((star) => {
      const value = Number(star.dataset.value);
      star.classList.toggle('selected', rating !== null && value <= rating);
    });
  };

  const toggleFeedback = (rating) => {
    feedbackInput.required = rating !== null && rating < 5;
  };

  const hideReward = () => {
    if (rewardBanner) {
      rewardBanner.hidden = true;
    }

    if (rewardLink) {
      rewardLink.removeAttribute('href');
    }

    hideTips();
  };

  const showReward = (url, preserve = false) => {
    if (!rewardBanner || !rewardLink || !url) {
      return;
    }

    rewardLink.href = url;
    rewardBanner.hidden = false;

    if (!preserve) {
      setRating(5, { preserveReward: true });
    }
  };

  const hideTips = () => {
    if (tipsBanner) {
      tipsBanner.hidden = true;
    }
  };

  const showTips = () => {
    if (!tipsBanner || !tipsLink) {
      return;
    }

    tipsBanner.hidden = false;
  };

  const sendGoogleClickEvent = () => {
    if (googleClickSent) {
      return;
    }

    const storedReview = getStoredReview();
    const nameValue = (storedReview?.name || nameInput.value || '').trim();
    const ratingValue = storedReview?.rating ?? selectedRating;
    const payload = JSON.stringify({ name: nameValue, rating: ratingValue });
    const blob = new Blob([payload], { type: 'application/json' });

    const markClicked = () => {
      googleClickSent = true;
      if (storedReview) {
        storedReview.googleClicked = true;
        storeReview(storedReview);
      }
      showTips();
    };

    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/review/google-click', blob);
        markClicked();
        return;
      }
    } catch (error) {
      // sendBeacon недоступний або не спрацював, продовжуємо
    }

    fetch('/api/review/google-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    })
      .then(() => markClicked())
      .catch(() => {
        googleClickSent = storedReview?.googleClicked || false;
      });
  };

  const setStatus = (message, type) => {
    statusEl.textContent = message;
    statusEl.classList.remove('error', 'success');
    if (type) {
      statusEl.classList.add(type);
    }
  };

  const setRating = (rating, { preserveReward = false } = {}) => {
    selectedRating = rating;
    ratingInput.value = rating || '';
    updateStars(rating);
    toggleFeedback(rating);
    if (!preserveReward && rating !== 5) {
      hideReward();
    }
  };

  stars.forEach((star) => {
    star.addEventListener('click', () => {
      const value = Number(star.dataset.value);
      setRating(value);
      setStatus('', null);
    });

    star.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const value = Number(star.dataset.value);
        setRating(value);
      }
    });
  });

  if (rewardLink) {
    rewardLink.addEventListener('click', () => {
      void sendGoogleClickEvent();
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('', null);

    if (getStoredReview()) {
      setStatus('Ви вже залишили відгук. Дякуємо!', 'success');
      disableForm();
      return;
    }

    if (!selectedRating) {
      setStatus('Будь ласка, оберіть кількість зірок перед відправкою', 'error');
      return;
    }

    const nameValue = nameInput.value.trim();

    if (!nameValue) {
      setStatus('Будь ласка, вкажіть своє імʼя', 'error');
      nameInput.focus();
      return;
    }

    const reasonValue = feedbackInput.value.trim();

    const payload = {
      name: nameValue,
      rating: selectedRating,
      reason: reasonValue,
    };

    if (payload.reason.length === 0 && selectedRating < 5) {
      setStatus('Будь ласка, поділіться коротким коментарем, щоб ми могли Вам допомогти', 'error');
      feedbackInput.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Надсилаємо...';

    try {
      const response = await fetch('/api/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Не вдалось відправити відгук. Будь ласка, напишіть адміністратору');
      }

      const storedReview = {
        name: payload.name,
        rating: payload.rating,
        reason: payload.reason,
        submittedAt: new Date().toISOString(),
        redirectUrl: result.redirectUrl || null,
        googleClicked: false,
      };

      storeReview(storedReview);
      googleClickSent = Boolean(storedReview.googleClicked);
      if (storedReview.redirectUrl) {
        showReward(storedReview.redirectUrl);
      }
      disableForm();

      if (result.redirectUrl) {
        setStatus('Дякуємо! Натисніть кнопку, щоб залишити відгук у Google', 'success');
      } else {
        setStatus('Дякуємо за Ваш відгук! Ми передали його керівництву для вирішення', 'success');
      }
    } catch (error) {
      setStatus(error.message || 'Сталася помилка. Спробуйте ще раз', 'error');
    } finally {
      if (!formLocked) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Надіслати відгук';
      } else {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Відгук надіслано';
      }
    }
  });

  hydrateFromStorage();
})();
