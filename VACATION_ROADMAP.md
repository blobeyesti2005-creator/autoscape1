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
- [x] Add browser-level smoke coverage for account creation, remembered login,
  keyboard behavior, death recovery, observation controls, and the learning lab;
  full save/load also has executable fixtures.
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
- [x] Dispatch bot jobs through prioritized task nodes using one shared decision
  frame and bounded, observable action contracts.
- [x] Confirm routed walking from measured forward progress and escalate four
  timed-out attempts into the existing route/search recovery system.
- [x] Confirm woodcutting and mining from inventory gains and temporarily avoid
  resources that repeatedly fail to produce logs or ore.
- [x] Confirm combat engagement from combat state and loot pickup from inventory
  gains, with bounded retries and temporary failed-target avoidance.
- [ ] Continue profiling the main loop and reduce avoidable object/inventory
  scans with measured safeguards.
- [ ] Harden navigation, bank choice, banker interaction, and stall recovery.
- [ ] Preserve existing command chains while prioritizing dependable individual
  gathering, processing, banking, combat, and supply jobs.
- [ ] Expand F2P items, equipment, monsters, NPCs, drops, shops, and skill loops.
- [ ] Improve mobile controls, accessibility, combat/loot balance, and death
  recovery.
- [x] Establish an opt-in, deterministic five-bot learning lab with independent
  adaptive policies, manual takeover, bounded telemetry, and no access to live
  character persistence.
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

### Confirmed Prayer command chains

- `npm test` (27 regression groups)
- Added `bury bones`, `bury 10 bones`, and `train prayer` intents that can run
  alone or as durable queued steps such as `kill 10 chickens, then bury 10 bones`.
- Prayer uses the native inventory command for regular bones and advances its
  counter only after the inventory confirms that a bone disappeared; sending a
  click or packet alone never counts as progress.
- Numbered jobs stop safely if bones run out, unnumbered jobs finish after all
  held regular bones are buried, and repeated unconfirmed actions trip a bounded
  anti-stall guard rather than clicking forever.
- Prayer state reuses existing job fields and storage keys, resumes after login,
  and leaves account, stats, inventory, bank, settings, and payload schemas
  unchanged.
- Executable tests verify the inventory packet, slot selection, confirmed-count
  accounting, persistence compatibility, queue routing, and recovery limit.
- Package and app-shell cache metadata advanced to `2.12.6` for the eventual
  reviewed release.

### Task-node controller and confirmed-action foundation

- `npm test` (28 regression groups)
- Replaced the monolithic top-level objective switch with prioritized task
  nodes for login waiting, banking, return travel, combat, mining, woodcutting,
  firemaking, and Prayer. The dispatcher fails closed if no node accepts a job
  or a selected node throws instead of silently looping.
- Every active bot cycle now builds one shared decision frame containing time,
  login state, position, hits, combat state, capacity, and one inventory
  snapshot. All five active skill loops consume that frame rather than building
  independent inventory views.
- Added a reusable action contract with preconditions, captured before-state,
  explicit confirmation, timeout, bounded retries, and terminal failure. Prayer
  is the first migrated action and only retries when the carried bone count does
  not confirm the native inventory action.
- Added a deduplicated on-screen decision trace plus a bounded 40-entry runtime
  history. It exposes the selected task and action states (`sent`, `waiting`,
  `confirmed`, `retry`, and `failed`) without adding storage writes or changing
  any account, character, or command-job payload.
- Starting, stopping, finishing, or replacing an objective clears pending action
  contracts so an old confirmation can never leak into a new job.
- Executable tests prove task priority selection, confirmation-before-progress,
  retry exhaustion, action cleanup, and shared-frame inventory reuse.
- Package and app-shell cache metadata advanced to `2.12.7` for the eventual
  reviewed release.

### Confirmed navigation actions

- `npm test` (29 regression groups)
- Routed walking now uses the shared action-contract engine. A walk is confirmed
  only when the next decision frame is closer to its issued destination or has
  reached the arrival radius; sideways collision shuffling and packet sends do
  not count as successful movement.
- Bank, gathering, return, combat, mining, and firemaking travel reuse the one
  position snapshot captured in the current decision frame instead of polling
  the player tile again inside each navigation helper.
- Walk attempts wait up to four seconds for measurable progress and stop after
  four unconfirmed attempts. Exhaustion feeds the existing route-rebuild or
  regional-target rotation guards instead of creating an unbounded click loop.
- The on-screen decision trace now exposes navigation `sent`, `confirmed`,
  `retry`, and `recovery` states, making a stuck destination diagnosable during
  a play test without adding persistent telemetry.
- Executable tests distinguish forward progress from sideways movement, enforce
  bounded escalation, and require every major routed travel loop to use both
  the confirmed walker and shared position snapshot.
- Account, character, inventory, bank, stats, settings, command-job payloads,
  persistence keys, and the live branch remain unchanged.
- Package and app-shell cache metadata advanced to `2.12.8` for the eventual
  reviewed release.

### Confirmed woodcutting and mining actions

- `npm test` (30 regression groups)
- Woodcutting and mining now share a gathering action contract that captures
  carried resource counts before the native object action and confirms success
  only after the next shared inventory snapshot contains another log or ore.
- Resource packets and animation attempts no longer reset the job's progress
  timer. Only an actual inventory gain advances the requested amount and clears
  gathering recovery state.
- A gather action waits nine seconds before retrying and stops retrying after
  four unconfirmed attempts. The failed tree or rock is ignored for 30 seconds
  while the bot selects another loaded resource or resumes regional searching.
- The temporary resource quarantine is runtime-only, self-expiring, and bounded
  to 40 entries. It is never written into account, character, or job saves.
- Vanished targets and full inventories explicitly cancel their pending gather
  action, preventing a delayed confirmation from leaking into travel or banking.
- Executable tests cover sent/waiting/confirmed inventory transitions, prevent
  resends after confirmation, verify quarantine expiry, and enforce use of the
  contract in both primary gathering loops.
- Package and app-shell cache metadata advanced to `2.12.9` for the eventual
  reviewed release.

### Confirmed combat and loot actions

- `npm test` (31 regression groups)
- Attack packets no longer count as meaningful progress. An engagement is
  confirmed only when the shared decision frame reports an active combat
  animation; combat progress and kill accounting retain their existing later
  confirmation boundaries.
- An attack waits 6.5 seconds before retrying and stops after three unconfirmed
  sends. The failed NPC server index is ignored for 20 seconds while the bot
  searches for another valid target.
- Ground-item packets no longer increment loot totals or protect an item for
  banking. Pickup is confirmed only when the matching item count increases in
  the next inventory snapshot.
- Loot retries are limited to three four-second attempts. A failed ground item
  is ignored for 15 seconds, while a vanished drop cancels its pending action
  so stale confirmation cannot leak into the next fight.
- Combat and loot exclusion maps are runtime-only, self-expiring, and bounded;
  no account, character, inventory, bank, settings, or job-save field changed.
- Executable tests prove attack sent-to-combat confirmation and pickup
  sent-to-inventory confirmation, including that packets alone do not advance
  either metric.
- Package and app-shell cache metadata advanced to `2.12.10` for the eventual
  reviewed release.

### Confirmed firemaking gathering and banking interactions

- `npm test` (32 regression groups)
- Continuous Firemaking now uses the shared gathering action contract and only
  treats chopping as successful after a regular log appears in the next shared
  inventory snapshot. Packet sends no longer advance the phase by themselves.
- A tree gets four nine-second chances to produce a log. A repeatedly silent
  tree is ignored for 30 seconds while the bot tries another loaded tree, and
  six exhausted resources stop the job safely instead of creating an endless
  action loop.
- Normal and combat banking now share explicit talk and open contracts. Banker
  speech is confirmed by the expected fresh dialogue menu; choosing its first
  option is confirmed only when the bank interface becomes visible.
- Banker talk is capped at three nine-second attempts and bank opening at one
  six-second attempt per dialogue. Failure clears stale action state, rotates
  the selected bank's final approach, ignores the silent banker for 15 seconds,
  and resumes scoped banker acquisition. The exclusion is runtime-only and
  bounded to 20 entries.
- Banking and firemaking use the existing shared decision frame, so these hot
  paths do not add extra inventory or player-position snapshots per bot tick.
- Executable tests cover successful talk-to-menu-to-bank transitions, exhausted
  banker recovery, firemaking's confirmed-gather contract, and runtime-only
  resource quarantine. Account, character, inventory, bank, stats, settings,
  command-job payloads, and persistence keys remain unchanged.
- Package and app-shell cache metadata advanced to `2.12.11` for the eventual
  reviewed release.

### Confirmed fire placement and lighting

- `npm test` (33 regression groups)
- Dropping a regular log now uses an action contract that requires both an
  inventory decrease and a visible ground log at the captured player tile.
  Three packet sends without that outcome stop safely instead of advancing.
- Lighting now confirms only when a fire appears at the captured log tile or
  the shared decision frame reports increased Firemaking XP. A disappearing
  log by itself no longer counts as a successfully lit fire.
- Tinderbox use waits 4.5 seconds between retries and is capped at eight sends,
  preserving normal low-level failure retries without permitting click loops.
- Logs that disappear without fire/XP and inventory drops that never produce a
  visible ground log enter bounded recovery rather than incrementing fire or
  task progress totals.
- Stepping away from a completed fire now uses the shared confirmed-navigation
  contract and decision-frame position instead of a raw walk packet and an
  extra live position read.
- Executable tests prove that packet sends and log disappearance do not confirm
  progress, while ground placement, Firemaking XP, and visible fires do. No
  account, character, inventory, bank, stat, setting, command-job, or storage
  schema changed.
- Package and app-shell cache metadata advanced to `2.12.12` for the eventual
  reviewed release.

### Confirmed combat food and restocking

- `npm test` (35 regression groups)
- Eating now uses an action contract and increments the combat food metric only
  after the next shared inventory snapshot contains less food. The inventory
  command packet alone no longer resets progress or counts as survival work.
- Food use waits 3.5 seconds before retrying and stops safely after three
  unconfirmed attempts. Pending food actions are cancelled when food disappears
  or health recovers through another source, preventing stale confirmation.
- Combat bank withdrawal now keeps the bank open and the bot stationary until
  a shared inventory snapshot confirms that food arrived. It retries at
  four-second intervals and stops after three unconfirmed packets.
- Withdrawal packets no longer mark progress. Only a confirmed food-count gain
  advances the banking state and permits the bot to return to combat.
- Both decisions reuse the existing inventory and hit-point decision frame;
  they add no storage writes, save fields, or extra inventory scans per tick.
- Executable tests cover sent/waiting/confirmed/failed food consumption and
  withdrawal transitions, ensure raw packets cannot change confirmed metrics,
  and enforce cleanup after retry exhaustion.
- Package and app-shell cache metadata advanced to `2.12.13` for the eventual
  reviewed release.

### Confirmed bank deposits

- `npm test` (36 regression groups)
- Gathering, mining, explicit banking commands, and combat loot banking now
  share one deposit action contract. Deposit packets no longer count as
  successful banking or advance a job by themselves.
- A deposit confirms only when the next shared inventory snapshot shows every
  requested unequipped quantity removed. Equipped copies of the same item ID
  remain carried and are included in the expected post-deposit floor.
- Unchanged deposits wait four seconds before retrying and stop safely after
  three attempts. The bank remains open while confirmation is pending, avoiding
  the previous race between the 250 ms close timer and server inventory updates.
- Combat loot IDs remain protected for banking until their removal is confirmed;
  food and preserved equipment are still excluded from automatic deposits.
- Explicit banking commands finish only after confirmation or a verified empty
  deposit plan. Gathering jobs return to their resource area only after the
  matching resources leave inventory.
- Executable tests cover equipped-item filtering, multi-stack packet contents,
  waiting without packet spam, confirmed removal, timeout failure, metric
  integrity, and combat loot tracking.
- No persistence keys, account/save fields, inventory formats, bank formats, or
  queued-job schemas changed.
- Package and app-shell cache metadata advanced to `2.12.14` for the eventual
  reviewed release.

### Bounded long-session profiling and target reuse

- `npm test` (38 regression groups)
- Every bot tick now records wall-clock cost by selected task node, including
  average/max duration, slow-tick and error totals, active/idle counts, and a
  global summary. Slow ticks are reported to the existing decision trace at
  most once every 30 seconds to avoid new UI churn.
- Profiling storage is runtime-only and capped at 20 node summaries. Decision
  history remains capped at 40 entries and action diagnostics expose only
  bounded contract summaries.
- `window.AutoScape.getDiagnostics()` returns a plain, copied snapshot of the
  current goal, queue, task timing, pending actions, and recent decisions.
  `resetDiagnostics()` clears only runtime measurements; neither function reads
  or writes account/save storage.
- Pending woodcutting, mining, continuous-Firemaking, combat-attack, and loot
  actions now reuse their captured target during the confirmation window. This
  removes repeated full object, NPC, and ground-item scans on each one-second
  tick while waiting for the server.
- When an action reaches its retry timeout, the cached target is discarded and
  the live entity list is scanned again before another packet is sent. Existing
  retry limits, target quarantine, and disappearance handling remain intact.
- Executable tests simulate 5,003 profiled ticks, arbitrary task-node names,
  slow/error measurements, copied diagnostics, reset behavior, nested target
  copying, and timeout-triggered rescanning.
- No persistence key, account/save field, inventory/bank format, setting, or
  queued-job schema changed.
- Package and app-shell cache metadata advanced to `2.12.15` for the eventual
  reviewed release.

### Shared death and respawn recovery

- `npm test` (39 regression groups)
- A high-priority death-recovery task node now preempts banking, navigation,
  gathering, processing, Prayer, and combat whenever the native death screen,
  player-alive flag, or known hit-points state confirms defeat.
- Entering recovery clears pending action contracts, combat targets, navigation
  routes, and retry positions immediately. A death is counted once even while
  several consecutive ticks report the death screen.
- Unknown hit points during login are not treated as death. After the character
  becomes alive, two consecutive healthy decision frames are required before
  any job can send another gameplay action.
- Safe-banking combat resumes through a fresh nearest-bank trip for supplies.
  “Never bank” / “fight to the death” still stops immediately at defeat as the
  command promises.
- Mining, Woodcutting, Firemaking, explicit banking, and Prayer resume through
  fresh phases and routes rather than retaining stale pre-death destinations or
  interactions. Missing tools or supplies are then handled by their existing
  safe stop conditions.
- Recovery waits at most 60 seconds for respawn and otherwise stops with a clear
  explanation. Death and recovery counters remain runtime diagnostics only.
- Executable tests cover native death signals, false-death avoidance during
  login, action/route cleanup, single death accounting, stable-respawn gating,
  mining route reconstruction, and fight-to-the-death termination.
- No account/save fields, persistence keys, inventory/bank formats, settings, or
  queued-job schemas changed.
- Package and app-shell cache metadata advanced to `2.12.16` for the eventual
  reviewed release.

### Isolated five-bot learning lab foundation

- `npm test` (44 regression groups)
- Added an opt-in, standalone learning lab with exactly five independent bot
  profiles. It is deliberately disconnected from the live game client and does
  not read or write local storage, accounts, characters, inventory, banks,
  settings, or saved jobs.
- Each learner uses a transparent context/action value table, an individual
  goal, outcome-based rewards, and exploration that decays from 24% to a 5%
  floor. This provides measurable local adaptation before considering opaque or
  heavyweight machine-learning techniques.
- Sessions are deterministic from a visible reset seed. The five default goals
  cover Woodcutting, Mining, combat, banking, and balanced behavior so policies
  can specialize independently under the same simulated conditions.
- Pause, resume, single-step, 100-tick acceleration, per-bot manual takeover,
  explicit manual actions, and immediate return to automatic policy control are
  available in the lab UI. Manual demonstrations remain visible in telemetry
  and update only that learner's policy.
- Every learner exposes its current context, chosen action, exploration rate,
  score, HP, energy, held/banked resources, deaths, and preferred next action.
  Session summaries compare score, actions, deaths, banked items, and learned
  ready-state preference.
- Per-bot history is capped at 120 events and session telemetry at 1,200 events.
  Exported telemetry can be replayed in order without retaining unbounded
  runtime state.
- The learning lab and engine are part of the offline app shell. Executable
  tests cover seed determinism, policy independence, bounded 500-tick sessions,
  pause behavior, manual takeover/return, demonstrations, summaries, replay,
  discoverability, offline caching, and the absence of persistence access.
- No account/save fields, persistence keys, inventory/bank formats, settings, or
  queued-job schemas changed.
- Package and app-shell cache metadata advanced to `2.12.17` for the eventual
  reviewed release.

### Portable learning sessions and evaluation

- `npm test` (47 regression groups)
- Learning sessions can now be downloaded as human-readable JSON and loaded
  back into the lab without touching browser storage. Imports are capped at 2
  MB and 1,200 events, then validated for format, five known goals, monotonic
  event ordering, known contexts/actions/sources, finite values, and safe
  inventory bounds before they are displayed.
- Replay mode is read-only and reconstructs all five learners from recorded
  before/after state. Previous, next, seek-slider, and exit controls show the
  selected action, outcome, reward, and Q-value change without executing a
  training action or replacing the active session.
- Replay events and nested inventories are copied at every public boundary.
  Mutating an inspected snapshot, imported object, or returned replay event
  cannot alter the underlying session or later timeline positions.
- The lab now runs a repeatable five-seed evaluation and compares average score,
  banked resources, deaths, and recent goal-action rate for each independent
  learner. Evaluation sessions are fresh, deterministic, capped, and discarded
  after aggregation.
- A fixed five-seed, 200-tick evaluation produced resources for every learner.
  Woodcutting, Mining, and combat specialists selected their goal actions for
  roughly 61–75% of the recent measured decisions; the banking learner gathered
  before depositing instead of repeatedly attempting an empty bank.
- A maximum-size 1,200-event training replay serialized to about 1.12 MB, below
  the import safety limit. Tests also cover malformed JSON, invalid actions,
  non-monotonic sequences, oversized files/event arrays, exact timeline state
  reconstruction, seek boundaries, deterministic evaluation, UI controls, and
  HTML escaping of imported labels and decisions.
- The normal game still does not import the learning engine. No live action
  bridge exists, and no account/save field, persistence key, inventory/bank
  format, setting, or queued-job schema changed.
- Package and app-shell cache metadata advanced to `2.12.18` for the eventual
  reviewed release.

### Opt-in live observation recorder and offline analysis

- `npm test` (50 regression groups)
- Added a manual, runtime-only recorder to the normal bot panel. Recording is
  off by default, starts a fresh session only when requested, stops explicitly,
  holds at most 600 one-second frames, and downloads only after a separate user
  action. It never writes observations to local storage, session storage, or an
  account/save record.
- Recording reuses the controller's existing decision frame rather than
  rescanning inventory, objects, NPCs, or ground items. Each frame contains only
  an allowlisted gameplay summary: sequence/elapsed time, world tile, HP and
  safety flags, aggregate inventory categories, sanitized objective fields,
  active task-node key, and sanitized pending-action keys.
- Usernames, passwords, credentials, raw client/action handles, native server
  indices, item-ID inventories, bank contents, and full character/save state
  are excluded from the export format. Returned snapshots are copied so callers
  cannot mutate the recorder's retained history.
- The isolated five-bot lab can load these observation files for read-only
  analysis. It reports movement rate, longest stationary run, fighting/death/
  low-HP/full-inventory frames, and task-node frequency without training a
  learner, changing a policy, or sending any live-game action.
- Observation imports accept only the versioned format, are limited to 1 MB and
  600 frames, and validate monotonic sequence/time, bounded numbers, safe token
  fields, objective shape, inventory ranges, and pending-action counts. Imported
  task labels are HTML-escaped before display.
- Tests cover opt-in behavior, the bounded queue, single-snapshot reuse,
  sensitive-field exclusion, copy/format boundaries, malformed and oversized
  input, ordering/token rejection, deterministic stall/safety analysis, UI
  controls, and the absence of an action bridge.
- No account/save fields, persistence keys, inventory/bank formats, settings, or
  queued-job schemas changed. The learner remains isolated from the live
  character and still has no authority to control it.
- Package and app-shell cache metadata advanced to `2.12.19` for the eventual
  reviewed release.

### Route-aware observation diagnostics

- `npm test` (51 regression groups)
- Extended each opt-in observation frame with a copied, aggregate navigation
  summary sourced from state the controller already calculated: route position
  and length, sanitized waypoint/phase label, current and best distance,
  retries, stalls, route rebuilds, and local recovery count. The recorder still
  performs no additional object, NPC, ground-item, inventory, or path scans.
- Observation parsing remains backward-compatible with the first v1 files;
  missing navigation summaries receive inert defaults. Present summaries are
  strictly bounded, route indices must fit the declared route, and every label
  passes the existing safe-token and prototype-key rejection boundary.
- Offline analysis now separates active navigation from ordinary stationary
  gameplay, calculates navigation-only movement rate, and segments consecutive
  non-moving route frames into diagnostic stall episodes. Four stationary
  frames, or an observed retry/stall counter, qualifies an episode.
- Each episode records only its sequence/time range, task/objective/target keys,
  peak retry/stall counts, rebuild/recovery deltas, and whether movement,
  navigation completion, or recording end closed it. Detailed episodes are
  capped at 50 while total and per-target counts remain accurate across the full
  600-frame recording.
- The lab report now highlights repeated stall targets, peak recovery counters,
  navigation progress rate, and transparent flags for low movement, stalls,
  route rebuilds, and local recovery. Imported labels and flags remain escaped;
  analysis still cannot train policies or send game actions.
- Tests cover moving versus idle/stalled classification, exact episode
  boundaries, resolution cause, aggregate counter accuracy beyond the 50-row
  display cap, backward compatibility, malformed route bounds, copied state,
  single-frame reuse, and the existing account/save isolation guarantees.
- No account/save fields, persistence keys, inventory/bank formats, settings, or
  queued-job schemas changed. Main, Pages, and release configuration remain out
  of scope.
- Package and app-shell cache metadata advanced to `2.12.20` for the eventual
  reviewed release.

### Executable browser and mobile UI smoke harnesses

- `npm test` (54 regression groups) and `npm run test:browser` (3 focused UI
  smoke groups)
- Added a dependency-free Android keyboard viewport harness that executes the
  shipped focus, keyboard-inset, and game-fit functions against a deterministic
  browser surface. It verifies that meaningful keyboard insets toggle the
  compact layout, browser-chrome changes do not, and the native game canvas
  keeps its pre-keyboard scale instead of flickering as viewport heights move.
- Added an executable live-recorder control harness. It verifies that recording
  is off until explicitly started, the UI state follows start/stop, the rolling
  window retains exactly the newest 600 frames, navigation diagnostics and
  aggregate inventory values reach the export, and returned objects cannot
  mutate retained observations. The boundary also checks that bank and
  credential fields are absent.
- Added an executable five-bot lab controller harness using the real learning
  session engine and a fake DOM. It boots all five learner cards, advances the
  100-tick control while returning to paused state, imports a read-only
  observation report, displays the no-actions-executed guarantee, and proves
  hostile report labels are escaped before entering the page.
- GitHub Actions now gives these browser/mobile checks their own named step
  before the complete regression suite. The harnesses use only Node's built-in
  test and VM modules, so CI gains controller-level coverage without browser
  downloads, network dependencies, or a new runtime package.
- This batch changes no account/save fields, persistence keys, inventory/bank
  formats, settings, queued-job schemas, bot policy state, or live game action
  code. Main, Pages, and release configuration remain out of scope.
- Package and app-shell cache metadata advanced to `2.12.21` for the eventual
  reviewed release.

### Account lifecycle and death-recovery browser smoke coverage

- `npm test` (57 regression groups) and `npm run test:browser` (6 focused UI
  smoke groups)
- Added an executable synthetic-client harness around the exact shipped client
  patch. It runs both returning-player login and new-character registration,
  verifies that each path captures the intended credentials, confirms the new
  character replaces the remembered login only after registration is invoked,
  and proves the client attaches to the isolated game host with the local
  worker, double-speed movement, and disabled-fatigue display intact.
- Extracted remembered auto-login scheduling into a small guarded controller.
  It refuses missing credentials, already-online clients, and duplicate pending
  timers; reports the existing non-destructive retry message on failure; and
  clears the timer after success or failure so a later launch can retry.
- Added executable controller coverage for the visible death sequence. A death
  clears pending work and navigation, shows the defeated state, requires two
  healthy frames, then shows a confirmed respawn and rebuilds the interrupted
  mining phase. Detection and confirmation traces are both required.
- The focused browser suite now covers keyboard viewport stability, account
  credential hooks, guarded remembered login, live observation controls,
  death/recovery UI, and the isolated five-bot lab controller. It remains
  dependency-free and is a named GitHub Actions step.
- No account/save fields, persistence keys, credential keys, inventory/bank
  formats, settings, queued-job schemas, or learner/live-action boundaries
  changed. Main, Pages, and release configuration remain out of scope.
- Package and app-shell cache metadata advanced to `2.12.22` for the eventual
  reviewed release.

### Destination-safe navigation and queued-supply reservations

- `npm test` (57 regression groups) and `npm run test:browser` (6 focused UI
  smoke groups)
- Every confirmed short navigation step now records both its immediate step and
  the higher-level destination that requested it. If a route advances,
  rebuilds, or rotates to a different recovery approach while that step is
  pending, the old contract is cancelled before any new movement is sent.
- Arrival now cancels the pending walk through the normal diagnostic boundary
  instead of silently deleting it. Decision traces therefore distinguish
  destination changes and completed arrivals from timeouts and collision
  recovery.
- Added an executable two-destination simulation proving a pending eastbound
  step is cancelled and replaced immediately when the controller switches to a
  northbound goal. The new contract contains only the new destination and the
  packet target moves in the correct direction.
- Automatic combat banking now calculates explicit supply reservations from up
  to eight queued jobs. Existing equipment, axes, pickaxes, and tinderboxes
  remain reserved; queued Prayer additionally reserves bones, while queued
  Firemaking reserves regular logs, a tinderbox, and an axe.
- Reservation filtering applies only to automatic combat-loot deposits. An
  explicit player-requested carried/gathered/loot bank command retains its
  documented meaning and is not silently weakened.
- Tests prove combat coins are deposited only after confirmation while food,
  equipment, and bones needed by queued Prayer remain carried and tracked. A
  Firemaking reservation fixture covers logs, tinderbox, axe, and pickaxe
  preservation.
- No account/save fields, persistence keys, inventory/bank formats, settings,
  queued-job schemas, or learner/live-action boundaries changed. Main, Pages,
  and release configuration remain out of scope.
- Package and app-shell cache metadata advanced to `2.12.23` for the eventual
  reviewed release.
