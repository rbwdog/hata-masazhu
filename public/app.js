(() => {
  const form = document.getElementById('review-form');
  const stars = Array.from(document.querySelectorAll('.star'));
  const ratingInput = document.getElementById('rating-value');
  const nameInput = document.getElementById('guest-name');
  const feedbackGroup = document.getElementById('feedback-group');
  const feedbackInput = document.getElementById('feedback');
  const statusEl = document.querySelector('.form-status');
  const submitBtn = form.querySelector('.submit-btn');
  const rewardBanner = document.getElementById('reward-banner');
  const rewardLink = document.getElementById('reward-link');

  let selectedRating = null;

  const STORAGE_KEY = 'hataMasazhuReview';

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

      return safeParse(raw);
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
    form.setAttribute('aria-disabled', 'true');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Відгук залишено';

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

    if (review.redirectUrl) {
      showReward(review.redirectUrl, true);
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
    if (!rewardBanner) {
      return;
    }

    rewardBanner.hidden = true;

    if (rewardLink) {
      rewardLink.removeAttribute('href');
    }
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

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('', null);

    if (getStoredReview()) {
      setStatus('Ви вже залишили відгук. Дякуємо!', 'success');
      disableForm();
      return;
    }

    if (!selectedRating) {
      setStatus('Оберіть кількість зірок перед відправкою.', 'error');
      return;
    }

    const payload = {
      name: nameInput.value.trim(),
      rating: selectedRating,
      reason: feedbackInput.value.trim(),
    };

    if (payload.reason.length === 0 && selectedRating < 5) {
      setStatus('Поділіться коротким коментарем, щоб ми могли вам допомогти.', 'error');
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
        throw new Error(result.error || 'Не вдалось відправити відгук.');
      }

      const storedReview = {
        name: payload.name,
        rating: payload.rating,
        reason: payload.reason,
        submittedAt: new Date().toISOString(),
        redirectUrl: result.redirectUrl || null,
      };

      storeReview(storedReview);
      if (storedReview.redirectUrl) {
        showReward(storedReview.redirectUrl);
      }
      disableForm();

      if (result.redirectUrl) {
        setStatus('Дякуємо! Перенаправляємо на сторінку Google...', 'success');
        setTimeout(() => {
          window.location.href = result.redirectUrl;
        }, 1200);
      } else {
        setStatus('Дякуємо за відгук! Наша команда з вами звʼяжеться.', 'success');
      }
    } catch (error) {
      setStatus(error.message || 'Сталася помилка. Спробуйте ще раз.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Надіслати відгук';
    }
  });

  hydrateFromStorage();
})();
