# AutoScape Classic

AutoScape is a private, browser-based RuneScape Classic-inspired world with
built-in woodcutting, mining, and combat automation. Character data is stored locally in
the browser on the site where the game is hosted.

## Play

Open the GitHub Pages deployment in Chrome, Edge, or Samsung Internet. The first
launch needs an internet connection to download the preservation client and
server. After the first successful launch, reload once while still online so the
service worker can verify its cache. Later launches can then work offline when
the browser keeps that cache.

For reliable character saves, always use the same HTTPS address. Opening a
downloaded `index.html` file directly creates a different, less durable storage
origin.

## Install on a phone

1. Open the hosted game once while connected to the internet.
2. Wait until the local world finishes loading, then reload it once while online.
3. Use the browser menu and choose **Add to Home screen** or **Install app**.
4. Launch AutoScape from the new home-screen icon.

The app can be installed only when it is hosted over HTTPS (or localhost during
development).

## Automated skills

- Woodcutting: normal, oak, willow, maple, yew, and magic trees
- Mining: copper, tin, iron, coal, and gold with automatic mine travel and banking
- Combat: safe automatic targeting or chickens, cows, and goblins

Commands accept natural phrases such as `mine iron`, `get coal`, `cut willows`,
or `train combat`. Active jobs are saved locally and resume after login.
