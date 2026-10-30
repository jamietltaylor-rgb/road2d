# Lost Roads

A slow driving game for the browser. You drive an old estate car through misty hills, moors, coast, mountain passes and autumn woods. The day turns to night, the weather changes, you stop for fuel, and you take photos that go into a postcard album. Players can sign in so their progress follows them between devices, and the car has a touchscreen for playing your own Spotify.

The game is plain HTML, CSS and JavaScript. A small Cloudflare Worker (`worker.js`) handles accounts and cloud saves.

## Files

```
index.html             the game
album.html             the postcard album
manifest.webmanifest   lets phones add the game to the home screen
favicon.svg, icons/    icons
css/style.css          all the styling
js/game.js             the game itself
js/audio.js            engine sounds, road, rain and the car radio
js/account.js          sign-in and cloud saves (the game side)
js/spotify.js          plays a pasted Spotify link
js/spotify-account.js  links a Spotify account
js/spotify-config.js   where your Spotify Client ID goes
js/carscreen.js        the in-car touchscreen for music
js/shared.js           saving on the device
js/album.js            the album page
worker.js              accounts and cloud saves (the server side)
wrangler.jsonc         Cloudflare settings
.assetsignore          keeps worker.js, the README and settings out of the public site
```

## Controls

| Computer | Phone | What it does |
| --- | --- | --- |
| ↑ / W | Drive (hold) | Accelerate |
| ↓ / S | Brake (hold) | Brake |
| C | Cruise | Cruise control (keeps your speed) |
| P or Space | Photo | Take a postcard |
| N | Music (top right) | Open the car screen |
| R | | Radio on/off |
| M | | Sound on/off |
| Esc or O | Settings (top right) | Settings (the game pauses) |
| F | | Full screen |
| T | | Call a tow if you run out of fuel |

**Controllers** (Xbox, PlayStation and so on) work on a computer: right trigger drives, left trigger brakes, X/Square takes a photo, Y/Triangle sets cruise control, and Start opens the settings.

## Phones and computers

The game detects which you're on and adjusts:

- **Phones and tablets** get on-screen buttons and touch-sized settings. They draw at a lower resolution to save battery, show less rain, and keep the screen on while you drive. Turned sideways, the road moves up out of the way of the buttons. Settings → Display has a **Battery saver** option for older phones. On iPhone, use Share → Add to Home Screen to play full screen like an app. On Android, the full-screen option is in Settings.
- **Computers** get keyboard and controller support, sharper graphics, a bigger HUD on large screens, a mouse pointer that hides while you drive, and F for full screen.

## Accounts and cloud saves

Progress always saves on the device first. If a player signs in (Settings → Account), their journey, distance driven, settings and postcards are also copied to their account. That happens once a minute while driving, when they leave the page, and whenever they take a postcard. Signing in on another phone or computer picks up where they left off.

- Accounts are just a username and password. There's no email, so a forgotten password can't be reset. The game tells players this.
- Passwords are stored as salted PBKDF2 hashes, never as plain text. After 10 wrong password attempts, that username is locked for 15 minutes.
- Everything is stored in a free Cloudflare D1 database called `lost-roads-saves`.

**Setup:** nothing extra is needed. The first time Cloudflare deploys the site with `npx wrangler deploy`, it creates the database automatically, and the tables are created on the first sign-in.

If the deploy log shows an error about the database:
1. In the Cloudflare dashboard, go to **Storage & databases → D1** and create a database called `lost-roads-saves`.
2. Copy its database ID into `wrangler.jsonc`, under `"database_name"`, as `"database_id": "..."`.
3. Commit the change.

Sign-in only works on the deployed site, not when you open `index.html` straight from your computer.

## Music

Settings → Radio has four options:

1. **Off**
2. **Car radio:** generated, hazy music. Works for everyone.
3. **A Spotify link:** paste a playlist, album or song link. Works for everyone with no setup. Players who are logged in to Spotify in the same browser usually hear full songs. Otherwise Spotify plays 30-second previews.
4. **Your Spotify account:** connect Spotify and use the **car screen** (N, or Music at the top right). The car screen has Now Playing with album art, play/pause/skip and volume, plus your Playlists, Liked Songs and Search.

### Linking a Spotify account (one-time setup)

Spotify requires each website to register as an "app" before people can sign in with Spotify on it:

1. Go to **developer.spotify.com/dashboard**, log in, and click **Create app**.
2. Give it a name (for example "Lost Roads") and a short description.
3. Under **Redirect URIs**, add your site's address with a slash at the end. Add each address the game lives at, for example:
   - `https://drive.yourdomain.com/`
   - `https://lost-roads.yourname.workers.dev/`
4. Under the APIs section, tick **Web API** and **Web Playback SDK**. Agree to the terms and save.
5. Open the app's settings and copy the **Client ID**.
6. Paste it into `js/spotify-config.js` between the quotes, then commit.
7. Under **User Management** in the app's settings, add the name and Spotify email of anyone else who should be able to connect.

**Spotify's rules for apps like this:**
- The person who created the Spotify app must have **Premium**, and so must anyone who wants to play music through the car screen.
- Only the app owner plus up to **5 people** added under User Management can connect. Spotify only lets companies apply to lift this limit. Everyone else can still use **A Spotify link**.
- Music plays inside the game where the browser supports it (most desktop browsers). Where it doesn't (iPhone browsers, for example), the car screen controls whichever Spotify app you have open, such as the one on your phone, so keep Spotify open in the background.

## Put it on GitHub

1. Go to github.com, click **New repository**, call it `lost-roads` and click **Create repository**.
2. Click **uploading an existing file**. Drag in **everything inside** the `lost-roads` folder, not the folder itself. `.assetsignore` starts with a dot, so your computer may hide it. On a Mac, press Cmd+Shift+. in Finder to show it.
3. Click **Commit changes**.

## Publish on Cloudflare

1. In the Cloudflare dashboard, go to **Workers & Pages → Create** and connect the GitHub repo.
2. Leave the **build command** blank.
3. Set the **deploy command** to `npx wrangler deploy`.
4. Deploy. To use your own domain, add it under the project's **Settings → Domains & Routes**.

Every change you commit to GitHub is published automatically.

## Tweaking

Near the top of `js/game.js`:

- `DAY_SECONDS`: length of a full day (9 minutes)
- `MAX_V`: top speed in metres per second
- `FUEL_RANGE`, `STATION_EVERY`: how far a tank lasts and how far apart fuel stops are
- `BIOMES`: colours and tree types for each landscape
- `CAR`: the car's colours (`body` is the paint)

For testing, add `?t=0.8` to the address to jump to dusk, or `?km=5` to jump 5 km down the road.
