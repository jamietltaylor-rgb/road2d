# Lost Roads

A slow driving game for the browser. You drive an old estate car through misty hills, moors, coast, mountain passes and autumn woods. The day turns to night, the weather changes, you stop for fuel, and you can take photos that go into a postcard album.

It's plain HTML, CSS and JavaScript, so there's nothing to install or build. All the sounds are generated in the browser too, so there are no audio files.

## Files

```
index.html      the game
album.html      the postcard album
favicon.svg     tab icon
css/style.css   all the styling
js/shared.js    saving and loading (uses the browser's local storage)
js/audio.js     engine, road, rain and radio sounds
js/game.js      the game itself
js/album.js     the album page
```

## Controls

| Key | What it does |
| --- | --- |
| ↑ / W | Accelerate |
| ↓ / S | Brake |
| C | Cruise control (holds your current speed) |
| P or Space | Take a postcard |
| R | Radio on/off |
| M | Sound on/off |
| T | Call a tow if you run out of fuel |

On phones and tablets, on-screen buttons appear instead.

## Put it on GitHub

1. Go to github.com, click **New repository**, call it `lost-roads` and click **Create repository**.
2. On the new repo page, click **uploading an existing file**.
3. Unzip `lost-roads.zip` on your computer, open the `lost-roads` folder, select **everything inside it** (not the folder itself) and drag it into the upload area. The `css` and `js` folders will upload with their contents.
4. Click **Commit changes**.

Check that `index.html` is at the top level of the repo, not inside another folder.

## Publish with Cloudflare Pages (free)

1. Log in to the Cloudflare dashboard and open **Workers & Pages**.
2. Click **Create** (or **Create application**), choose the **Pages** option, then **Connect to Git**.
3. Connect your GitHub account and pick the `lost-roads` repo.
4. Build settings:
   - Framework preset: **None**
   - Build command: leave it **blank**
   - Build output directory: leave it **blank** (or `/`)
5. Click **Save and Deploy**. After a minute you'll get a link like `lost-roads.pages.dev`.

From then on, every change you commit on GitHub is published automatically.

### Using your own domain

In the Pages project, go to **Custom domains → Set up a custom domain** and enter something like `drive.yourdomain.com`. If your domain's DNS is already on Cloudflare, it sets everything up for you. If not, Cloudflare tells you which CNAME record to add at your registrar.

## Tweaking it

Everything you'd want to change is near the top of `js/game.js`:

- `DAY_SECONDS`: how long a full day takes (currently 9 minutes)
- `MAX_V`: top speed in metres per second
- `FUEL_RANGE` and `STATION_EVERY`: how far a tank lasts and how far apart the fuel stops are
- `BIOMES`: colours and tree types for each landscape
- `CAR`: the car's colours (`body` is the paint)

For testing, add `?t=0.8` to the address to jump to dusk, or `?km=5` to jump 5 km down the road.

Progress, settings and postcards are saved in the player's own browser, so nothing needs a server or a database.
