# AutoScape Classic

AutoScape is a private, browser-based RuneScape Classic-inspired world with
built-in woodcutting, mining, Firemaking, and combat automation. Character data is stored locally in
the browser on the site where the game is hosted.

## Play

Open [the playable GitHub Pages build](https://blobeyesti2005-creator.github.io/autoscape1/)
in Chrome, Edge, or Samsung Internet. The first
launch needs an internet connection to download the preservation client and
server. After the first successful launch, reload once while still online so the
service worker can verify its cache. Later launches can then work offline when
the browser keeps that cache.

For reliable character saves, always use the same HTTPS address. Opening a
downloaded `index.html` file directly creates a different, less durable storage
origin.

AutoScape v2.8 commits a new account to IndexedDB immediately and checkpoints
active characters every 15 seconds. A normal logout also saves. Browser storage
remains device- and browser-profile-specific, so private/incognito windows and a
different browser do not share the same local character database.

The v2.8 saver clones skill data before removing database-only fields, preventing
live levels from being mutated. Accounts affected by v2.7.1 rebuild base levels
from stored experience on login and repair invalid current levels automatically.

## Install on a phone

1. Open the hosted game once while connected to the internet.
2. Wait until the local world finishes loading, then reload it once while online.
3. Use the browser menu and choose **Add to Home screen** or **Install app**.
4. Launch AutoScape from the new home-screen icon.

The app can be installed only when it is hosted over HTTPS (or localhost during
development).

## Automated skills

- Woodcutting: normal, oak, willow, maple, yew, and magic trees. Each tree stays
  active for a short type-specific window, allowing multiple successful logs
  before its authentic respawn delay begins.
- Mining: copper, tin, iron, coal, and gold with repaired ore rewards, timed
  multi-yield veins, automatic mine travel, and banking.
- Firemaking: authentic Classic drop-and-light behavior for regular logs. The
  bot retries failed lighting rolls and moves clear of each fire. `burn logs`
  consumes held logs; `train firemaking` continuously chops and burns.
- Combat: safe automatic progression or rats, chickens, cows, men, goblins,
  dark wizards, barbarians, dwarves, and guards.
- Loot: native ground-item pickup with F2P, valuable-only, all, and leave-drop
  filters. Collected loot is banked before food is restocked.
- Guide: an in-game searchable reference for resource levels and timers,
  supported NPC combat targets, notable native drops, item IDs, starter tools,
  commands, and Classic Firemaking behavior.

Commands accept natural phrases such as `mine iron`, `get coal`, `cut willows`,
`fight barbarians`, `burn logs`, `train firemaking`, `kill guards`, or `train combat`. Active jobs and loot
preferences are saved locally and resume after login. Automated world actions
are paced and no longer draw false click crosses at the user's last pointer
position. Touch devices also get drag camera rotation, persistent pinch zoom,
tap-again-to-close HUD tabs, and equipped-item-safe Quick Bank controls.

Commands can be chained with commas, semicolons, arrows, or `then`, for example
`chop wood, firemake the logs`. Queued gathering steps fill the inventory without
banking before the next step begins. Command queues persist across login. Fatigue
is disabled, and players move at twice the original Classic walking speed while
NPC, combat, resource, and world timers retain their normal cadence.
