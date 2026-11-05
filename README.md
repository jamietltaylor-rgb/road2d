# Lost Roads

A slow driving game for the browser. You drive an old estate car through ten foggy landscapes while the day turns to night and the weather changes. Pick up hitchhikers to earn money, spend it on jerry cans, and keep an eye on the fuel. Fuel stations are far apart, filling up and pouring in a jerry can are both hands-on, and if you run dry with nothing in the boot, the journey's over. Photos you take go into a postcard album. Players can sign in so their progress follows them between devices, and the car has a touchscreen for playing your own Spotify.

The game is plain HTML, CSS and JavaScript, plus one small server file (`worker.js`) that runs on Cloudflare. It handles accounts, cloud saves and the leaderboard, and keeps them in Cloudflare's own storage. There's no Supabase or any other outside service.

## Files

```
index.html             the game
album.html             the postcard album
manifest.webmanifest   lets phones add the game to the home screen
favicon.svg, icons/    icons
css/style.css          all the styling
js/game.js             the game itself
js/audio.js            engine sounds, road, rain and the car radio
js/account.js          sign-in, cloud saves and the leaderboard (talks to worker.js)
js/leaderboard.js      the leaderboard page
leaderboard.html       furthest journeys
js/spotify.js          plays a pasted Spotify link
js/spotify-account.js  links a Spotify account
js/spotify-config.js   where your Spotify Client ID goes
js/carscreen.js        the in-car touchscreen for music
js/minigames.js        the roadside-job minigames
js/shared.js           saving on the device
js/album.js            the album page
worker.js              runs on Cloudflare: serves the game and stores accounts, saves and the leaderboard
wrangler.jsonc         Cloudflare settings, including the storage
.assetsignore          keeps the README, worker.js and settings out of the public site
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
| E | (context button) | Fill up at a pump, clear the road, get unstuck, change a tyre |
| G | Garage | The garage, at fuel stations |
| J | Use can | Pour a jerry can into the tank (stop first) |
| H | Horn | Honk (moves sheep along) |

**Controllers** (Xbox, PlayStation and so on) work on a computer: right trigger drives, left trigger brakes, X/Square takes a photo, Y/Triangle sets cruise control, and Start opens the settings.

## How the journey works

- **Fuel:** fuel is only used while you're pressing the accelerator. Coasting and braking are free, and cruise control uses a little, because it holds the accelerator for you. Fuel stations are unevenly spaced (roughly 1 to 2.5 miles apart). The first six on every journey are always open, giving you time to buy jerry cans. After that, about one in seven has shut down, but never two in a row. The HUD shows how far it is to the next one, and says "looks shut" when you're getting close to a shut one. A jerry can costs £20 and comes full. Refilling an empty one costs £3 at any open pump, either when you fill up or with **Fill cans** when your tank is already full.
- **Filling up is a minigame:** stop at the pump and press **E** (or tap **Fill up**). Hold the trigger (or hold Space) to pump. It speeds up the longer you hold, so let go when the needle reaches the green, before it overflows. Filling up also refills any empty jerry cans.
- **The garage:** stop at any fuel station and press **G** (or tap **Garage**) to buy:
  - **Jerry cans** (£20, up to 3). Each holds 60% of a tank, comes full, and refills whenever you fill up at a pump.
- **Using a jerry can is a minigame too:** stop the car and press **J** (or tap **Use can**). Hold Pour (or hold Space) to tip the can into the funnel. Pour in bursts, because if the funnel overflows you spill fuel. If you run out of fuel while driving, coast to a stop and pour a can in.
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


### Roadside events

Roadside jobs are dealt from a shuffled deck on every journey, so you'll meet every kind before any of them repeats. They come up roughly every mile or so. Every job has a "pay someone" option if you've got the money.

| Event | What you do |
| --- | --- |
| Fallen tree | Cut it into pieces with a chainsaw, then drag them off the road |
| Rockfall | Drag the boulders onto the verge (the big ones are heavy) |
| Sheep | Shoo them off the road (some wander back) |
| Deep mud | Rev at the right moment to rock the car free |
| Glass on the road | Fit the spare wheel: jack it up, undo the nuts, swap, tighten |
| Farm gate | Slide the stiff bolt back, then swing the gate open |
| Flooded ford | Keep the revs in the green band while you creep across |
| Muddy tractor | It sprays your windscreen, so stop and scrub it clean (or use the wipers) |
| Flat battery | The engine dies. Clip the jump leads on in the right order, then turn the key |

## The car screen

Everything that used to be a button on the screen now lives on the car's touchscreen. Open it with **N** or the **Car screen** button at the side of the screen (on phones, between Brake and Drive). Its home screen has these apps:

- **Music:** your Spotify, if it's connected.
- **Radio:** turn the car radio, Spotify link or Spotify on and off.
- **Photo:** take a postcard.
- **Cruise:** hold your current speed.
- **Horn**
- **Leaderboard:** the furthest journeys. Anyone can see it, signed in or not.
- **Album:** your postcards.
- **Garage:** only works when you're stopped at a fuel station.
- **Settings**
- **Sound:** turn all game sound on or off.

On phones, **Brake**, **Drive** and the context button (Fill up, Clear road and so on) stay on screen. Keyboard shortcuts (P, C, H, R, M, Esc) still work on a computer.

## Customising the car

The garage also sells:
- **Paint (£15 each):** oxide red, racing green, navy, cream, mustard, faded sky, charcoal or plum.
- **Body shapes:**
  - Hatchback: £25
  - Pickup (hitchhikers ride in the bed): £45
  - Coupé: £60
  - Camper van: £70

Paint and bodies you buy are **yours to keep**, even after the journey ends and you start a new one. They're saved with your account if you're signed in. Switching back to something you already own is free.

## Phones and computers

The game detects which you're on and adjusts:

- **Phones and tablets** get on-screen buttons and touch-sized settings. They draw at a lower resolution to save battery, show less rain, and keep the screen on while you drive. Turned sideways, the road moves up out of the way of the buttons. Settings → Display has a **Battery saver** option for older phones. On iPhone, use Share → Add to Home Screen to play full screen like an app. On Android, the full-screen option is in Settings.
- **Computers** get keyboard and controller support, sharper graphics, a bigger HUD on large screens, a mouse pointer that hides while you drive, and F for full screen.

## Accounts and the leaderboard

Progress always saves on the device first. When a player signs in (Settings → Account), their journey, distance, settings and postcards are also saved to their account:
- once a minute while driving
- when they leave the page
- whenever they take a postcard

Signing in on another phone or computer picks up where they left off. Their furthest single journey goes on the **leaderboard**. Anyone can view the leaderboard, signed in or not: in the game (Car screen → Leaderboard), on the game-over screen, or as its own page at `yoursite/leaderboard.html`. Only signed-in players appear on it.

Accounts are just a username and password, with no email address anywhere. Everything is stored in your Cloudflare project by `worker.js`, using a Durable Object, which is Cloudflare's small built-in database. Passwords are stored scrambled, never as plain text. A forgotten password can't be reset, and the game tells players this.

### Setup

There's nothing to set up. The first time the site deploys as a **Worker** with the deploy command `npx wrangler deploy`, Cloudflare creates the storage automatically. It's included in Cloudflare's free plan.

Accounts only work when the project is a **Worker**. A **Pages** project only publishes the files, so the game would say "Accounts aren't switched on for this site yet". Everything else still works.

Two things to check if the deploy fails:
- **Worker name:** the `"name"` in `wrangler.jsonc` is `lost-roads`. If your Worker in Cloudflare has a different name, change it in `wrangler.jsonc` to match, or Cloudflare may refuse the build.
- **Build log:** if the log mentions Durable Objects, make sure you're on Cloudflare's current free plan for Workers, which includes them.

### Looking after it

The data lives in the Durable Object `LostRoadsDB`, in the tables `players`, `sessions`, `saves` and `cards`. You can find it in Cloudflare under your Worker's Durable Objects section.

**About cheating:** distances are reported by the player's own browser, so a determined person could fake a score. For a game among friends that's normally fine. If someone does it, ask me (or whoever maintains the game) to add a way to remove a score.

**Moving from Supabase:** accounts made with the older Supabase version don't carry over, so players make a new account once. Their progress on each device is kept, and it uploads to the new account when they sign in.

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

Use a **Worker** project. A Pages project would show the game but not the accounts or the leaderboard (see Accounts above).

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

## Checking an update went live

The start screen shows the version number (for example "Version 16"). If you still see an older number after uploading:

1. Make sure the files went into the **top level** of the GitHub repo, replacing the old ones. `index.html` should sit next to the `js` and `css` folders, not inside a `lost-roads` folder.
2. In Cloudflare, open the project's Deployments and check that the newest commit has built successfully.
3. Hard-refresh the page (Ctrl+Shift+R, or Cmd+Shift+R on a Mac). On a phone, close the tab and open it again.

The `_headers` file and the `?v=` numbers on the script tags make browsers fetch the new files every time, so this should only be needed once.

## Dials and rain sound

- **Speedometer:** a small round dial in miles per hour (0 to 80), with a needle that swings up and settles like a real one. The word CRUISE lights up on the dial when cruise control is on.
- **Odometer:** a rolling mechanical counter under the needle. Five wheels count whole miles and the white wheel on the right counts tenths. The wheels roll over into each other, and you'll hear a soft tick every tenth of a mile.
- **Everything is in miles now:** speed, the next fuel station, the postcard stamp, the game-over screen and both leaderboards. The database still stores kilometres, so existing scores are fine.
- **Rain sound** (Settings, Rain): Gentle patter, Heavy downpour, Rain on the roof, or no rain sound, plus its own volume slider. Choosing one plays a short preview.

For testing, add `?t=0.8` to the address to jump to dusk, or `?km=5` to jump 5 km (about 3 miles) down the road.

## Visit counter for all four sites

`worker.js` also keeps a small anonymous visit counter for Jamie's four sites (Revise, Shared List, PackSmart and Lost Roads). Each site loads one script (`js/jt-stats.js`, called `stats.js` / `jt-stats.js` in the other repos) that reports one visit with a random id kept on the visitor's own device. No names, email addresses or IP numbers are stored. The numbers live in the Cloudflare D1 database `jamietaylor-stats` (binding `STATS` in `wrangler.jsonc`).

To see them, tap 5 times quickly in the very bottom-right corner of any of the four sites (there is no button) and type the admin password. The password box also lets you change the password and switch off counting on your own device.
