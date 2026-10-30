(() => {
  const list = document.getElementById('cards');
  const count = document.getElementById('count');

  function render() {
    const cards = LR.getCards();
    list.innerHTML = '';
    count.textContent = cards.length
      ? `${cards.length} postcard${cards.length === 1 ? '' : 's'} from the road`
      : 'Lost Roads';

    if (!cards.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.innerHTML = 'Nothing here yet. While you’re driving, press <em>P</em> (or tap <em>Postcard</em>) and the view will be sent here.';
      list.appendChild(p);
      return;
    }

    cards.forEach((c) => {
      const fig = document.createElement('figure');
      fig.className = 'card';

      const img = document.createElement('img');
      img.src = c.img;
      img.alt = `Postcard from ${c.place}`;
      img.loading = 'lazy';

      const cap = document.createElement('figcaption');
      const where = document.createElement('span');
      where.className = 'cap-place';
      where.textContent = c.place;

      const actions = document.createElement('span');
      actions.className = 'cap-actions';

      const dl = document.createElement('a');
      dl.href = c.img;
      dl.download = `lost-roads-${c.place.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`;
      dl.textContent = 'Save';

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'link';
      rm.textContent = 'Remove';
      rm.addEventListener('click', () => {
        if (!confirm(`Remove the postcard from ${c.place}?`)) return;
        LR.saveCards(LR.getCards().filter((x) => x.id !== c.id));
        if (window.Account) Account.deleteCard(c.id);
        render();
      });

      actions.append(dl, rm);
      cap.append(where, actions);
      fig.append(img, cap);
      list.appendChild(fig);
    });
  }

  render();
  // if signed in, fetch postcards taken on other devices
  if (window.Account && Account.signedIn) Account.pullCards().then((cards) => { if (cards) render(); });
})();
