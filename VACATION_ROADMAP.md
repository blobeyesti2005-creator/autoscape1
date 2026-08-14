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
- [ ] Add browser-level smoke coverage for account creation and basic UI
  controls; remembered login and full save/load now have executable fixtures.
- [x] Reduce avoidable metrics DOM updates, unchanged camera-storage writes,
  and unchanged Quick Bank style writes without slowing bot decisions.
- [x] Reuse single-pass inventory summaries in active gathering, firemaking, and
  combat ticks, and capture loot-filter mode once per ground-item decision.
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
- [x] Rebuild stalled routes from the character's current location across bank,
  gathering, mining, firemaking, combat, and return travel modes.
- [x] Rotate past unreachable regional search tiles and continuously cycle local
  recovery directions for woodcutting, mining, firemaking, and combat.
- [x] Rotate blocked final bank approaches and engage the selected bank's loaded
  banker through native NPC action walking instead of orbiting one coordinate.
- [x] Execute command-job save/reload round trips covering queued steps, partial
  progress, combat style, no-bank intent, legacy defaults, and damaged input.
- [x] Execute server stat load/save behavior covering boosted, drained, and
  missing current levels without mutating live skills, inventory, or bank data.
- [x] Execute full browser account JSON checkpoints covering item stacks,
  equipped gear, bank quantities, settings, quests, appearance, and deep clones.
- [x] Keep the bot panel above Android's keyboard without rescaling flicker and
  route chicken training through the accessible Lumbridge farm gate.
- [x] Deduplicate unchanged command-job and bot preference writes while keeping
  progress checkpoints immediate and preserving every existing storage key.
- [x] Execute remembered-account login with valid, malformed, incomplete, and
  already-logged-in browser states without deleting credentials on failure.
- [x] Add explicit carried/gathered/loot banking steps to persistent command
  chains using nearest-bank routing and equipped-item protection.
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

### Consistent route rebuilding

- `npm test` (15 regression groups)
- All eight routed travel loops use the same progress-aware rebuild threshold.
- A rebuild discards stale waypoints, recalculates from the current character
  position, resets the route index and recovery watch, and records a diagnostic
  rebuild count without changing persisted save structure.
- Combat banking no longer rebuilds merely because it issued many successful
  walk commands; it now rebuilds only after measured lack of forward progress.
- App-shell cache advanced to `autoscape-app-v2.11.5` for the eventual reviewed
  release.

### Command-job persistence round trips

- `npm test` (16 regression groups)
- The existing `autoscape_job` schema and key are unchanged, but serialization
  and defensive loading now have named, executable functions.
- JSON round-trip tests preserve command order, partial target progress,
  Strength training, fight-to-the-death/no-bank mode, loot choice, and resource
  choice.
- Older saves missing newer fields receive backward-compatible defaults;
  malformed counts, enum values, and queue entries are safely normalized.
- App-shell cache advanced to `autoscape-app-v2.11.6` for the eventual reviewed
  release.

### Server stat save/load regression fixture

- `npm test` (17 regression groups)
- A runnable miniature server passes through the real gameplay transformer and
  verifies derived base levels plus boosted, drained, and missing current
  levels.
- Saving clones skill records before stripping derived base values, proving the
  live player stats remain unchanged while inventory, bank, appearance,
  experience, and current levels survive serialization.
- The test also executes disabled fatigue behavior and the transformer's
  fail-closed compatibility guard.
- Package metadata advanced to `2.11.7`; the app-shell cache remains `2.11.6`
  because this batch changes tests and documentation only.

### Regional search stall recovery

- `npm test` (18 regression groups)
- Woodcutting, mining, firemaking, and combat now abandon one unreachable
  regional search tile after the shared progress-aware retry limit, then move
  to the next point in their existing search pattern.
- Local collision-recovery offsets cycle continuously instead of becoming
  pinned forever to the final diagonal offset.
- Recovery counters remain runtime-only diagnostics; save keys, account data,
  stats, inventories, banks, settings, and queued jobs are unchanged.
- Package and app-shell cache metadata advanced to `2.11.8` for the eventual
  reviewed release.

### Bank-arrival and interaction recovery

- `npm test` (19 regression groups)
- Gathering and combat banking share five rotating final approach points; an
  unreachable bank coordinate can no longer trap either loop indefinitely.
- Once the correctly scoped banker is within 20 tiles, the bot uses the native
  NPC action walk and talk flow rather than requiring a fragile seven-tile
  straight-line threshold.
- Banker scoping, dialogue freshness checks, and retry timeouts remain intact.
- Arrival counters are runtime-only diagnostics and do not alter save schemas.
- Package and app-shell cache metadata advanced to `2.11.9` for the eventual
  reviewed release.

### Inventory and ground-loot hot paths

- `npm test` (20 regression groups)
- Active woodcutting, mining, firemaking, and combat decisions now build one
  inventory summary and reuse its counts, food, tools, slots, and capacity.
- Mining and woodcutting progress checks no longer rescan the same inventory
  after checking tools, and firemaking no longer allocates copied item arrays.
- Ground-loot selection reads the chosen loot mode once per decision and scans
  every loaded ground-item ID once while preserving distance and drop filters.
- Proxy-instrumented tests enforce the one-read-per-item behavior and validate
  the resulting tool, food, log, and loot decisions.
- Package and app-shell cache metadata advanced to `2.12.0` for the eventual
  reviewed release.

### Full browser account checkpoint round trip

- `npm test` (21 regression groups)
- The browser persistence compatibility guard now fails closed if the upstream
  deep-clone save contract changes unexpectedly.
- A complete character payload survives save, serialized Map storage, and
  reload with inventory item amounts/equipped state, large bank stacks, stats,
  settings, coordinates, friends/ignores, quests, nested cache state, and all
  appearance fields intact.
- Post-save mutations to live inventory, bank, quest, and nested cache objects
  are proven unable to alter the stored checkpoint.
- Existing persistence keys and payload fields are unchanged.
- Package and app-shell cache metadata advanced to `2.12.1` for the eventual
  reviewed release.

### Mobile keyboard and chicken-route recovery

- `npm test` (23 regression groups)
- The bot panel follows the visual viewport above Android's keyboard, remains
  scrollable on short screens, and temporarily hides unrelated top controls.
- Canvas scaling is frozen at its stable pre-keyboard height while a text field
  is focused; resize bursts are coalesced into one animation-frame update.
- The chicken travel waypoint now approaches the southern open gate at
  `(112, 619)` while the live-NPC search remains centred on the verified spawn
  area at `(119, 604)`.
- No account, save, inventory, bank, settings, or command-job schema changed.
- Package and app-shell cache metadata advanced to `2.12.2` for the eventual
  reviewed release.

### Command-state storage write reduction

- `npm test` (24 regression groups)
- The seven existing command-job and preference keys are read once into a
  runtime mirror when the bot installs; identical values no longer trigger
  synchronous browser storage writes on the main thread.
- Changed queue/progress state still saves immediately, and stopping a job
  removes its existing key exactly once.
- The job JSON payload, preference values, account database, inventory, bank,
  stats, and migration behavior are unchanged.
- Instrumented tests count writes/removals and enforce one write per changed
  value plus zero writes for identical values.
- Package and app-shell cache metadata advanced to `2.12.3` for the eventual
  reviewed release.

### Remembered-account login smoke fixture

- `npm test` (25 regression groups)
- Remembered credential parsing now rejects damaged, incomplete, or incorrectly
  typed local values without throwing during startup.
- A valid remembered account is passed once to the native client login method,
  including its existing reconnect flag, and an already logged-in character is
  never sent a duplicate login request.
- Transient login failures now give a useful on-screen retry message while
  deliberately retaining the local account credentials.
- Registration, account database, character saves, inventory, bank, stats,
  settings, command jobs, and all persistence keys remain unchanged.
- Package and app-shell cache metadata advanced to `2.12.4` for the eventual
  reviewed release.

### Explicit banking command chains

- `npm test` (26 regression groups)
- Added `bank inventory`, `deposit gathered resources`, and `bank loot` intents
  that can run alone or as queued steps after gathering and combat commands.
- Banking uses the existing weighted nearest-bank route, scoped banker,
  dialogue freshness, timeout, blocked-approach, and route-rebuild safeguards.
- Carried banking deposits every unequipped stack; gathered banking deposits
  logs and ores; loot banking uses the existing F2P loot filter while retaining
  food, equipped gear, and protected tools.
- Banking queue state reuses the existing `type`, `resource`, and queue fields;
  no save key or payload field was added, and older jobs remain compatible.
- Executable packet tests verify item amounts and prove equipped items are not
  included in bank-deposit packets.
- Package and app-shell cache metadata advanced to `2.12.5` for the eventual
  reviewed release.
