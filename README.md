# Lost Roads

A slow driving game for the browser. You drive an old estate car through ten foggy landscapes while the day turns to night and the weather changes. Pick up hitchhikers to earn money, spend it on jerry cans, and keep an eye on the fuel. Fuel stations are far apart and some have closed, so if you run dry with nothing in the boot, the journey's over. Photos you take go into a postcard album. Players can sign in so their progress follows them between devices, and the car has a touchscreen for playing your own Spotify.

The game is plain HTML, CSS and JavaScript. Accounts, cloud saves and the leaderboard use a free Supabase project. Cloudflare just publishes the files.

## Files

```
index.html             the game
album.html             the postcard album
manifest.webmanifest   lets phones add the game to the home screen
favicon.svg, icons/    icons
css/style.css          all the styling
js/game.js             the game itself
js/audio.js            engine sounds, road, rain and the car radio
js/account.js          sign-in, cloud saves and the leaderboard (talks to Supabase)
js/supabase-config.js  where your Supabase URL and key go
js/leaderboard.js      the leaderboard page
leaderboard.html       furthest journeys
supabase-setup.sql     paste into Supabase's SQL Editor once
js/spotify.js          plays a pasted Spotify link
js/spotify-account.js  links a Spotify account
js/spotify-config.js   where your Spotify Client ID goes
js/carscreen.js        the in-car touchscreen for music
js/minigames.js        the roadside-job minigames
js/shared.js           saving on the device
js/album.js            the album page
wrangler.jsonc         Cloudflare settings
.assetsignore          keeps the README, the SQL file and settings out of the public site
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
| E | (context button) | Garage at a fuel station, clear the road, get unstuck, change a tyre |
| J | Use can | Pour a jerry can into the tank |
| H | Horn | Honk (moves sheep along) |

**Controllers** (Xbox, PlayStation and so on) work on a computer: right trigger drives, left trigger brakes, X/Square takes a photo, Y/Triangle sets cruise control, and Start opens the settings.

## How the journey works

- **Fuel:** fuel is only used while you're pressing the accelerator. Coasting and braking are free, and cruise control uses a little, because it holds the accelerator for you. Fuel stations are unevenly spaced (roughly 1.5 to 4 km apart), and now and then one is **closed** ("SHUT" sign, boarded windows). The HUD shows how far it is to the next station.
- **The garage:** stop at any open fuel station and press **E** (or tap **Garage**) to buy:
  - **Jerry cans** (£20, up to 3). Each holds 60% of a tank, comes full, and refills free whenever you stop at an open station. If the tank runs dry, a full can is used automatically, or pour one in with J or Use can.
  - **Extra seats** for hitchhikers: a fold-down back seat (£40) and then a bench seat in the boot (£90). You can carry up to 3 passengers.
- **Hitchhikers** wait by the road holding a cardboard sign with where they're going. Stop next to one to pick them up, if you have a free seat. They chat as you drive, and each pays when you stop at their village. Longer rides pay more, sometimes with a tip. Drive past their stop and they only pay half.
- **Game over:** if you run out of fuel with no full jerry can, the journey ends. "Start a new journey" gives you a fresh road with new hitchhikers and events. Money, cans and seats reset; your postcards are kept.
- **Roadside jobs (minigames).** Stop at the problem and press **E** (or tap the button) to deal with it. Each one also has a "pay someone" option if you'd rather not, or **Not now** to leave it for a moment.
  - **Fallen tree:** hold the chainsaw on each marked line to cut through the trunk, then drag the pieces onto the verge. (Or wait for a farmer, £10.)
  - **Sheep on the road:** tap each sheep to shoo it off. Some wander back. (Or wait for the farmer, £5.)
  - **Rockfall:** drag the boulders off the road. Big ones are heavy. (Or a farmer, £10.)
  - **Stuck in the mud:** tap Rev (or press Space) when the needle's in the green, four times. (Or a tractor, £15.)
  - **Puncture:** sharp things on the road cause a flat, and the car limps along at walking pace. Stop, jack the car up, hold on each wheel nut to undo it, and then tighten the spare. (Or roadside recovery, £20.)
  - Hitting sheep, a tree or rocks at speed costs £10 to £15.
- **Other things on the road:** deer leaping across (mostly at night), £5 and £10 notes on the verge, **viewpoints** where a gallery buys your postcard for £6, and thunderstorms.
- **Landscapes (10):** Pine Valley, Heather Moor, Salt Coast, High Pass, Rust Woods, Birch Wood, Old Orchard, Wind Farm Ridge, Dune Road and Peat Bog.

## Phones and computers

The game detects which you're on and adjusts:

- **Phones and tablets** get on-screen buttons and touch-sized settings. They draw at a lower resolution to save battery, show less rain, and keep the screen on while you drive. Turned sideways, the road moves up out of the way of the buttons. Settings → Display has a **Battery saver** option for older phones. On iPhone, use Share → Add to Home Screen to play full screen like an app. On Android, the full-screen option is in Settings.
- **Computers** get keyboard and controller support, sharper graphics, a bigger HUD on large screens, a mouse pointer that hides while you drive, and F for full screen.

## Accounts and the leaderboard (Supabase)

Progress always saves on the device first. When a player signs in (Settings → Account), their journey, distance, settings and postcards are also saved to their account:
- once a minute while driving
- when they leave the page
- whenever they take a postcard

Signing in on another phone or computer picks up where they left off. Their furthest single journey goes on the **leaderboard** (`leaderboard.html`, linked from the game, the settings and the game-over screen).

Accounts are just a username and password, with no email. Behind the scenes each username becomes a stand-in address that's never emailed. A forgotten password can't be reset, and the game tells players this.

### One-time setup (about 5 minutes)

1. Go to **supabase.com** and sign in, then click **New project**. Any name and region will do. Note the database password somewhere, though the game doesn't need it.
2. When the project is ready, go to **SQL Editor → New query**. Open `supabase-setup.sql` from this folder, paste in the whole file and click **Run**. It creates the tables, the leaderboard and the security rules.
3. Go to **Authentication → Sign In / Providers → Email** (it may be called **Providers → Email**). Turn **Confirm email** OFF and save. This step is essential: the stand-in addresses can't receive emails, so with it on, nobody could finish signing up.
4. Go to **Project Settings → API** (or **Data API / API Keys**). Copy the **Project URL** and the **anon public** key. If you see "publishable key" instead, use that.
5. On GitHub, open `js/supabase-config.js`, click the pencil icon and paste them in:
   ```js
   window.SUPABASE_CONFIG = {
     url: 'https://abcdefghijklm.supabase.co',
     anonKey: 'eyJhbGciOi...'
   };
   ```
   Commit, and Cloudflare republishes automatically.
6. Test it: open the game, press Esc, and create an account under **Account**. Then open `leaderboard.html` on your site.

Both values in `supabase-config.js` are designed to be public. The security rules in `supabase-setup.sql` make sure each player can only read and change their own saves and postcards. Everyone can see the leaderboard, which only shows usernames and distances.

**About cheating:** distances are reported by the player's own browser, so a determined person could fake a score. For a game among friends that's normally fine. If someone does it, delete their row in Supabase under **Table Editor → profiles**.

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

Either kind of Cloudflare project works, because the site is just files.

**Worker** (the newer screen with a "Deploy command" box):
1. Go to **Workers & Pages → Create → Import a repository** and pick the repo.
2. Leave the **build command** blank.
3. Set the **deploy command** to `npx wrangler deploy`.
4. Click **Deploy**.

**Pages** (a "Build output directory" box, no deploy command):
1. Set **Framework preset** to None.
2. Leave the **build command** and **build output directory** blank.
3. Save and deploy.

To use your own domain, add it under the project's **Custom domains** (or **Domains & Routes**). Every change you commit to GitHub is published automatically.

## Tweaking

Near the top of `js/game.js`:

- `DAY_SECONDS`: length of a full day (9 minutes)
- `MAX_V`: top speed in metres per second
- `FUEL_RANGE`, `STATION_EVERY`: how far a tank lasts and how far apart fuel stops are
- `BIOMES`: colours and tree types for each landscape
- `CAR`: the car's colours (`body` is the paint)

Money, cans and seats are set near the top of the journey section in `js/game.js`: `CAN_PRICE`, `CAN_FUEL` (how much a can puts in), `MAX_CANS`, `SEAT_PRICES` and `MAX_SEATS`. The minigames live in `js/minigames.js`, and each one's "pay someone" price is in its `pay` line. Hitchhiker names and what they say are in `NAMES` and `CHAT`, so add your own.

For testing, add `?t=0.8` to the address to jump to dusk, or `?km=5` to jump 5 km down the road.
