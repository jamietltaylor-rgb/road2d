(() => {
  const list = document.getElementById('board');
  const note = document.getElementById('boardNote');
  const me = Account.username.toLowerCase();

  function row(rank, name, km, mine) {
    const li = document.createElement('li');
    if (mine) li.className = 'mine';
    const r = document.createElement('span'); r.className = 'rank'; r.textContent = String(rank);
    const n = document.createElement('span'); n.className = 'who'; n.textContent = name;
    const k = document.createElement('span'); k.className = 'km'; k.textContent = `${Number(km).toFixed(1)} km`;
    li.append(r, n, k);
    return li;
  }

  async function load() {
    if (!Account.configured) {
      note.textContent = 'The leaderboard isn’t switched on for this site yet.';
      return;
    }
    note.textContent = 'Loading…';
    try {
      const rows = await Account.leaderboard(50);
      list.innerHTML = '';
      rows.forEach((p, i) => list.appendChild(row(i + 1, p.username, p.best_km, p.username.toLowerCase() === me)));
      if (!rows.length) note.textContent = 'No one’s on the board yet. Sign in from the game’s settings and go for a long drive.';
      else if (!Account.signedIn) note.textContent = 'To get on the board, sign in from the game’s settings. Your best journey is added automatically.';
      else note.textContent = `Signed in as ${Account.username}. Your best journey is updated as you drive.`;
    } catch (e) {
      note.textContent = e.message;
    }
  }

  load();
})();
