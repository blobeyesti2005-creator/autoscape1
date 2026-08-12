# AutoScape vacation roadmap

All vacation work stays on `codex/vacation-safe-mode` and in its draft pull
request. Nothing in this roadmap authorizes merging, publishing, force-pushing,
deleting history, or changing GitHub Pages.

## Safety rules

- Preserve account, character, stats, inventory, bank, settings, and job-save
  compatibility.
- Keep every commit independently playable and reviewable.
- Run `npm test` before each push and keep GitHub Actions green.
- Stop and document uncertain persistence changes instead of guessing.
- Use original implementation and assets; do not copy proprietary game code or
  art.

## Progress

- [x] Add zero-dependency static regression tests for shipped JavaScript,
  offline assets, persistence safeguards, commands, navigation, banking,
  resource depletion, and synthetic click markers.
- [x] Run the regression suite automatically on the vacation branch and pull
  requests.
- [ ] Add browser-level smoke coverage for account creation, save/load, and
  basic UI controls.
- [x] Reduce avoidable metrics DOM updates, unchanged camera-storage writes,
  and unchanged Quick Bank style writes without slowing bot decisions.
- [x] Choose banks by connected navigation-route cost instead of straight-line
  distance across obstacles.
- [x] Choose weighted shortest routes and scope banker interaction to the bank
  selected for the current trip.
- [x] Extend bank scoping to combat restocking and reject stale or unrelated
  dialogue menus before sending a bank option.
- [x] Collapse automatic combat and woodcutting target discovery to one loaded
  entity scan per decision while retaining target priority.
- [x] Measure navigation progress by distance gained toward the active waypoint
  so collision shuffling cannot indefinitely suppress obstacle recovery.
- [ ] Continue profiling the main loop and reduce avoidable object/inventory
  scans with measured safeguards.
- [ ] Harden navigation, bank choice, banker interaction, and stall recovery.
- [ ] Expand command chaining and intent handling across gathering, processing,
  banking, combat, and supplies.
- [ ] Expand F2P items, equipment, monsters, NPCs, drops, shops, and skill loops.
- [ ] Improve mobile controls, accessibility, combat/loot balance, and death
  recovery.
- [ ] Complete final regression, compatibility, and manual play-test audit.

## Verification log

### Safety-net foundation

- `npm test`
- Node syntax validation for every inline application script and `sw.js`
- Manifest/app-shell consistency validation
- Static compatibility checks for immediate registration saves, 15-second
  checkpoints, cloned skill serialization, persistent command queues, disabled
  fatigue, stable-origin storage, connected navigation, nearest Lumbridge bank,
  timed resource depletion, and bot click-marker suppression

### Performance and route-aware banking

- `npm test` (9 regression groups)
- Metrics rendering is capped at one update every two seconds while the action
  loop continues at its existing cadence.
- Mobile camera preferences write only after zoom or rotation changes.
- Quick Bank changes display style only when its visible state changes.
- Nearest-bank selection measures the connected navigation path and retains a
  high-cost fallback for any future temporarily disconnected node.
- App-shell cache advanced to `autoscape-app-v2.11.0` so the eventual reviewed
  release cannot retain an older `index.html`.

### Weighted navigation and banker targeting

- `npm test` (10 regression groups, including all-pairs shortest-path checks)
- Route construction now minimizes actual Manhattan travel distance instead of
  waypoint count.
- Loaded banker selection ignores bankers more than 20 tiles from the chosen
  bank, preventing interaction with a different nearby bank region.
- App-shell cache advanced to `autoscape-app-v2.11.1` for the eventual reviewed
  release.

### Bank-dialogue safety and executable persistence checks

- `npm test` (12 regression groups)
- Combat and gathering banking now both filter loaded bankers against the bank
  selected for the trip.
- Bank dialogue options are sent only after a recent bot-initiated banker talk;
  stale menus are cleared when a trip begins.
- Timed-out banker speech and bank-opening phases now reset explicitly to a
  retryable state and retain timeout counters for diagnosis.
- Registration durability and recurring 15-second saves are verified by
  executing the server persistence transformer against a representative source
  fixture, including its fail-closed compatibility guard.
- App-shell cache advanced to `autoscape-app-v2.11.2` for the eventual reviewed
  release.

### Single-pass hot-path targeting

- `npm test` (13 regression groups)
- Automatic woodcutting scans loaded objects once, records the nearest tree per
  eligible tier, then preserves the original highest-tier-first choice.
- Automatic combat scans loaded NPCs once for both the requested target and a
  level-safe nearest fallback instead of rescanning for every monster type.
- Executable instrumentation verifies one ID read per loaded object/NPC while
  also protecting target-selection behavior.
- App-shell cache advanced to `autoscape-app-v2.11.3` for the eventual reviewed
  release.

### Progress-aware obstacle recovery

- `npm test` (14 regression groups)
- Navigation recovery now resets only after the character gets closer to the
  active waypoint, rather than after any change in tile coordinates.
- Sideways collision movement now advances recovery offsets; genuine forward
  movement clears recovery state, and changing waypoints starts a clean watch.
- Short-step navigation watches the stable final waypoint instead of a newly
  calculated intermediate tile, allowing stall history to accumulate.
- App-shell cache advanced to `autoscape-app-v2.11.4` for the eventual reviewed
  release.
