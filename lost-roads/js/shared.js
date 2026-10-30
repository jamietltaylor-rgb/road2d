// Small helpers shared by the game and the album page.
window.LR = (() => {
  const KEYS = {
    cards: 'lostroads.postcards',
    stats: 'lostroads.stats',
    journey: 'lostroads.journey',
    settings: 'lostroads.settings'
  };

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  return {
    KEYS,
    load,
    save,
    getCards: () => load(KEYS.cards, []),
    saveCards: (cards) => save(KEYS.cards, cards)
  };
})();
