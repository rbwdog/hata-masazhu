(() => {
  // Prevent desktop right-click save on background images
  document.addEventListener(
    'contextmenu',
    (event) => {
      if (event.target && event.target.closest('.photo-bg')) {
        event.preventDefault();
      }
    },
    true,
  );

  const links = Array.from(document.querySelectorAll('.btn.primary[data-master]'));
  if (!links.length) {
    return;
  }

  const STORAGE_KEY = 'hataMasazhuReview';
  const safeParse = (raw) => {
    try {
      return JSON.parse(raw);
    } catch (
      /** @type {unknown} */ _error
    ) {
      return null;
    }
  };

  const getStored = () => {
    try {
      return safeParse(localStorage.getItem(STORAGE_KEY));
    } catch (
      /** @type {unknown} */ _error
    ) {
      return null;
    }
  };

  const store = (payload) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (
      /** @type {unknown} */ _error
    ) {
      // ignore quota errors
    }
  };

  let masterClickSent = Boolean(getStored()?.masterClicked);

  const ping = (master) => {
    if (masterClickSent) {
      return;
    }

    const stored = getStored();
    if (stored?.masterClicked) {
      masterClickSent = true;
      return;
    }

    const name = (stored?.name || '').trim();
    const rating = stored?.rating ?? undefined;
    const payload = JSON.stringify({ master, name, rating });

    const markClicked = () => {
      masterClickSent = true;
      if (stored) {
        stored.masterClicked = true;
        store(stored);
      }
    };

    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/review/master-click', blob);
        markClicked();
        return;
      }
    } catch (
      /** @type {unknown} */ _error
    ) {
      // fallback to fetch path
    }

    fetch('/api/review/master-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    })
      .then(() => markClicked())
      .catch(() => {});
  };

  links.forEach((anchor) => {
    anchor.addEventListener(
      'click',
      () => ping(anchor.getAttribute('data-master')),
      { once: true },
    );
  });
})();
