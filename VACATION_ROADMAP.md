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
