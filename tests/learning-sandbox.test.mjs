import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  analyzeLiveObservations, createLearningSession, createTelemetryReplay, evaluateLearningPolicies,
  parseLearningReplay, parseLiveObservations, serializeLearningReplay, serializeLiveObservations,
  LEARNING_ACTIONS, LEARNING_GOALS
} from '../learning-sandbox.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('learning lab is isolated, offline-capable, and discoverable', () => {
  const app = read('index.html'), lab = read('learning-lab.html');
  const engine = read('learning-sandbox.mjs'), worker = read('sw.js');

  assert.match(app, /id="labBtn"/);
  assert.match(app, /learning-lab\.html/);
  assert.match(worker, /\.\/learning-lab\.html/);
  assert.match(worker, /\.\/learning-sandbox\.mjs/);
  assert.match(lab, /Experimental and isolated/);
  for (const id of ['export', 'importFile', 'evaluate', 'replayControls', 'replayPosition', 'replayPrev', 'replayNext', 'replayExit']) {
    assert.match(lab, new RegExp(`id="${id}"`), `missing learning lab control #${id}`);
  }
  assert.doesNotMatch(`${lab}\n${engine}`, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(app, /from ['"]\.\/learning-sandbox\.mjs/);

  const ids = [...lab.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'learning lab IDs must be unique');
  const moduleScript = lab.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(moduleScript, 'learning lab controller is missing');
  const withoutImport = moduleScript.replace(/^\s*import[^;]+;\s*/m, '');
  assert.doesNotThrow(() => new vm.Script(withoutImport, { filename: 'learning-lab-inline.js' }));
  assert.match(moduleScript, /escapeHtml\(bot\.name\)/);
  assert.match(moduleScript, /escapeHtml\(bot\.decision\)/);
  assert.match(moduleScript, /escapeHtml\(episode\.target\)/);
  assert.match(moduleScript, /report\.diagnosticFlags\.map\(escapeHtml\)/);
});

test('five independent learners produce deterministic seeded sessions', () => {
  const first = createLearningSession({ seed: 12345, maxTicks: 300 });
  const second = createLearningSession({ seed: 12345, maxTicks: 300 });
  first.resume(); second.resume();
  for (let tick = 0; tick < 200; tick++) { first.step(); second.step(); }

  const one = first.snapshot(), two = second.snapshot();
  assert.equal(one.bots.length, 5);
  assert.deepEqual(one.bots.map(bot => bot.goal), LEARNING_GOALS);
  assert.deepEqual(one, two);
  assert.notStrictEqual(one.bots[0].policy, one.bots[1].policy);
  assert.ok(one.bots.every(bot => bot.experience === 200));
  assert.ok(one.bots.some(bot => Object.values(bot.policy.ready).some(value => value !== 0)));
  assert.ok(one.bots[3].bank.logs + one.bots[3].bank.ores + one.bots[3].bank.bones > 20, 'the banking learner must learn to gather before depositing');
});

test('learning telemetry and per-bot history stay bounded in long sessions', () => {
  const session = createLearningSession({ seed: 77, maxTicks: 1000 });
  session.resume();
  for (let tick = 0; tick < 500; tick++) session.step();
  const state = session.snapshot();

  assert.equal(state.tick, 500);
  assert.equal(state.telemetry.length, 1200);
  assert.ok(state.telemetry[0].sequence > 1);
  assert.ok(state.bots.every(bot => bot.history.length === 120));
  assert.ok(state.bots.every(bot => bot.epsilon >= 0.05 && bot.epsilon <= 0.24));
  const replay = createTelemetryReplay(session.exportReplay());
  replay.seek(replay.length);
  const replayed = replay.state();
  assert.deepEqual(replayed.bots.map(bot => bot.bank), state.bots.map(bot => bot.bank));
  assert.deepEqual(replayed.bots.map(bot => bot.score), state.bots.map(bot => bot.score));
  assert.ok(replayed.bots.every(bot => bot.actions === 500), 'a capped replay must retain its pre-window action baseline');
});

test('pause, manual takeover, demonstration, and bot return are explicit', () => {
  const session = createLearningSession({ seed: 91, maxTicks: 20 });
  session.step();
  assert.equal(session.snapshot().tick, 0, 'paused sessions must not advance');

  session.setManual(1, true);
  session.resume();
  session.step();
  let state = session.snapshot();
  assert.equal(state.bots[0].experience, 0);
  assert.ok(state.bots.slice(1).every(bot => bot.experience === 1));

  const event = session.manualAction(1, 'rest');
  assert.equal(event.source, 'manual');
  assert.equal(event.botId, 1);
  assert.equal(session.snapshot().bots[0].experience, 1);
  session.setManual(1, false);
  session.step();
  state = session.snapshot();
  assert.equal(state.bots[0].mode, 'auto');
  assert.equal(state.bots[0].experience, 2);
  assert.throws(() => session.manualAction(1, 'chop'), /Enable manual takeover/);
  assert.throws(() => session.setManual(99), /Unknown learner/);
  assert.throws(() => { session.setManual(1); session.manualAction(1, 'teleport'); }, /Unknown learning action/);
  assert.deepEqual(LEARNING_ACTIONS, ['chop', 'mine', 'fight', 'bank', 'rest']);
});

test('session summaries and exported telemetry can be replayed', () => {
  const session = createLearningSession({ seed: 44, maxTicks: 10 });
  session.resume();
  for (let tick = 0; tick < 4; tick++) session.step();
  session.pause();

  const summary = session.summary(), exported = session.exportReplay();
  assert.equal(summary.length, 5);
  assert.equal(exported.format, 'autoscape-learning-replay-v1');
  assert.equal(exported.events.length, 20);
  assert.equal(exported.initialBots.length, 5);
  const replay = createTelemetryReplay(exported);
  assert.equal(replay.length, 20);
  const first = replay.next();
  assert.equal(first.sequence, 1);
  first.after.inventory.logs = 999;
  replay.reset();
  assert.equal(replay.cursor, 0);
  assert.equal(replay.next().after.inventory.logs, exported.events[0].after.inventory.logs, 'replay events must be copied');
  for (let index = 1; index < 20; index++) replay.next();
  assert.equal(replay.next(), null);
  assert.throws(() => createTelemetryReplay({ format: 'wrong', events: [] }), /Invalid/);

  const snapshot = session.snapshot();
  if (snapshot.telemetry[0]) snapshot.telemetry[0].after.inventory.logs = 999;
  assert.notEqual(session.snapshot().telemetry[0]?.after.inventory.logs, 999, 'snapshots must not expose live telemetry');
});

test('learning replay JSON is bounded and rejects malformed actions', () => {
  const session = createLearningSession({ seed: 31337, maxTicks: 20 });
  session.resume();
  for (let tick = 0; tick < 5; tick++) session.step();
  const exported = session.exportReplay(), text = serializeLearningReplay(exported);
  const parsed = parseLearningReplay(text);
  assert.deepEqual(parsed.events, exported.events);
  assert.equal(parsed.initialBots.length, 5);
  assert.throws(() => parseLearningReplay('{broken'), /valid JSON/);
  assert.throws(() => parseLearningReplay('x'.repeat(2_000_001)), /exceeds 2 MB/);

  const badAction = structuredClone(exported);
  badAction.events[0].action = 'delete-character';
  assert.throws(() => parseLearningReplay(JSON.stringify(badAction)), /Invalid replay action/);
  const badOrder = structuredClone(exported);
  badOrder.events[1].sequence = badOrder.events[0].sequence;
  assert.throws(() => createTelemetryReplay(badOrder), /ordering/);
  const tooLong = structuredClone(exported);
  tooLong.events = Array.from({ length: 1201 }, (_, index) => ({ ...exported.events[0], sequence: index + 1 }));
  assert.throws(() => createTelemetryReplay(tooLong), /1,200-event/);
});

test('timeline seeking reconstructs recorded learner state without executing actions', () => {
  const session = createLearningSession({ seed: 88, maxTicks: 50 });
  session.resume();
  for (let tick = 0; tick < 10; tick++) session.step();
  const exported = session.exportReplay(), replay = createTelemetryReplay(exported);

  assert.equal(replay.state().cursor, 0);
  assert.equal(replay.state().bots.every(bot => bot.actions === 0), true);
  replay.seek(17);
  const middle = replay.state();
  assert.equal(middle.cursor, 17);
  assert.equal(middle.bots.reduce((total, bot) => total + bot.actions, 0), 17);
  assert.equal(replay.current().sequence, 17);
  replay.previous();
  assert.equal(replay.cursor, 16);
  replay.next();
  assert.equal(replay.cursor, 17);
  replay.seek(9999);
  assert.equal(replay.cursor, replay.length);
  assert.deepEqual(replay.state().bots.map(bot => bot.bank), session.snapshot().bots.map(bot => bot.bank));
});

test('multi-seed evaluation is deterministic, bounded, and productive', () => {
  const options = { seeds: [11, 22, 33, 44, 55], ticks: 200 };
  const first = evaluateLearningPolicies(options), second = evaluateLearningPolicies(options);
  assert.deepEqual(first, second);
  assert.equal(first.bots.length, 5);
  assert.deepEqual(first.bots.map(bot => bot.goal), LEARNING_GOALS);
  assert.ok(first.bots.every(bot => bot.measuredActions === 1000));
  assert.ok(first.bots.every(bot => bot.averageBanked > 20));
  assert.ok(first.bots.slice(0, 4).every(bot => bot.recentGoalActionRate > 0));
  const capped = evaluateLearningPolicies({ seeds: Array.from({ length: 30 }, (_, index) => index + 1), ticks: 1 });
  assert.equal(capped.seeds.length, 12);
  assert.equal(capped.ticks, 20);
});

function observation(sequence, elapsedMs, overrides = {}) {
  return {
    sequence, elapsedMs, loggedIn: true, tile: { x: 100, y: 600 }, hp: { current: 10, maximum: 10 },
    dead: false, fighting: false, inventory: { used: 2, maximum: 30, logs: 1, ores: 0, bones: 0, food: 1 },
    objective: { type: 'woodcutting', phase: 'gather', resource: 'normal', target: 'none', style: 'none', bankMode: 'safe', progress: 1, goal: 10 },
    taskNode: 'woodcutting', pendingActions: [], navigation: { active: false, routeIndex: 0, routeLength: 0, target: 'none', distance: 0, bestDistance: 0, retries: 0, stalls: 0, rebuilds: 0, recoveries: 0 }, ...overrides
  };
}

test('read-only game observations round-trip through a strict bounded format', () => {
  const data = { format: 'autoscape-live-observations-v1', observations: [observation(4, 0), observation(5, 1000)] };
  const parsed = parseLiveObservations(serializeLiveObservations(data));
  assert.equal(parsed.observations.length, 2);
  assert.deepEqual(Object.keys(parsed.observations[0]).sort(), ['dead', 'elapsedMs', 'fighting', 'hp', 'inventory', 'loggedIn', 'navigation', 'objective', 'pendingActions', 'sequence', 'taskNode', 'tile'].sort());
  assert.doesNotMatch(JSON.stringify(parsed), /username|password|credential|bank contents|serverindex/i);
  assert.throws(() => parseLiveObservations('{broken'), /valid JSON/);
  assert.throws(() => parseLiveObservations('x'.repeat(1_000_001)), /exceeds 1 MB/);
  const outOfOrder = structuredClone(data); outOfOrder.observations[1].sequence = 4;
  assert.throws(() => serializeLiveObservations(outOfOrder), /ordering/);
  const dangerous = structuredClone(data); dangerous.observations[0].taskNode = '<script>';
  assert.throws(() => serializeLiveObservations(dangerous), /task node/);
  dangerous.observations[0].taskNode = '__proto__';
  assert.throws(() => serializeLiveObservations(dangerous), /task node/);
  const invalidRoute = structuredClone(data); invalidRoute.observations[0].navigation = { routeLength: 2, routeIndex: 3 };
  assert.throws(() => serializeLiveObservations(invalidRoute), /route index/);
  const legacy = structuredClone(data); delete legacy.observations[0].navigation;
  assert.deepEqual(parseLiveObservations(JSON.stringify(legacy)).observations[0].navigation, { active: false, routeIndex: 0, routeLength: 0, target: 'none', distance: 0, bestDistance: 0, retries: 0, stalls: 0, rebuilds: 0, recoveries: 0 });
  const oversized = { ...data, observations: Array.from({ length: 601 }, (_, index) => observation(index + 1, index)) };
  assert.throws(() => serializeLiveObservations(oversized), /600-frame/);
});

test('observation analysis segments bounded navigation stall episodes', () => {
  const navigation = (overrides = {}) => ({ active: true, routeIndex: 1, routeLength: 3, target: 'lumbridge', distance: 20, bestDistance: 20, retries: 0, stalls: 0, rebuilds: 0, recoveries: 0, ...overrides });
  const frames = [
    observation(1, 0, { navigation: navigation() }),
    observation(2, 1000, { navigation: navigation() }),
    observation(3, 2000, { navigation: navigation() }),
    observation(4, 3000, { navigation: navigation({ retries: 1, stalls: 1 }) }),
    observation(5, 4000, { tile: { x: 101, y: 600 }, navigation: navigation({ distance: 19, bestDistance: 19 }) }),
    observation(6, 5000, { tile: { x: 101, y: 600 }, navigation: navigation({ distance: 19, bestDistance: 19 }) }),
    observation(7, 6000, { tile: { x: 101, y: 600 } })
  ];
  const report = analyzeLiveObservations({ format: 'autoscape-live-observations-v1', observations: frames });
  assert.equal(report.navigationFrames, 6); assert.equal(report.navigationMoves, 1);
  assert.equal(report.navigationMovementRate, 0.2); assert.equal(report.maxNavigationStationaryRun, 4);
  assert.equal(report.stallEpisodeCount, 1); assert.equal(report.stallEpisodes.length, 1);
  assert.equal(report.maxNavigationRetries, 1); assert.equal(report.maxNavigationStalls, 1);
  assert.deepEqual(report.stallTargets, { lumbridge: 1 });
  assert.deepEqual(report.diagnosticFlags, ['navigation-stalls-observed']);
  assert.deepEqual(report.stallEpisodes[0], { startSequence: 1, endSequence: 4, durationMs: 3000, frames: 4, taskNode: 'woodcutting', objective: 'woodcutting', target: 'lumbridge', maxRetries: 1, maxStalls: 1, rebuildDelta: 0, recoveryDelta: 0, resolvedBy: 'movement' });

  const many = [];
  for (let episode = 0; episode < 60; episode++) {
    const base = episode * 5, x = 100 + episode * 2;
    for (let offset = 0; offset < 4; offset++) many.push(observation(base + offset + 1, (base + offset) * 1000, { tile: { x, y: 600 }, navigation: navigation({ retries: offset === 3 ? 1 : 0 }) }));
    many.push(observation(base + 5, (base + 4) * 1000, { tile: { x: x + 1, y: 600 }, navigation: navigation() }));
  }
  const bounded = analyzeLiveObservations({ format: 'autoscape-live-observations-v1', observations: many });
  assert.equal(bounded.stallEpisodeCount, 60); assert.equal(bounded.stallEpisodes.length, 50);
  assert.equal(bounded.stallTargets.lumbridge, 60, 'aggregate counts must include episodes beyond the display cap');
});

test('observation analysis reports stalls and safety states deterministically', () => {
  const frames = [
    observation(1, 0),
    observation(2, 1000, { fighting: true, hp: { current: 3, maximum: 10 }, pendingActions: ['combat-attack'] }),
    observation(3, 2000, { dead: true, hp: { current: 0, maximum: 10 }, inventory: { used: 30, maximum: 30, logs: 28, ores: 0, bones: 1, food: 1 } }),
    observation(4, 3000, { tile: { x: 101, y: 600 }, taskNode: 'death-recovery', objective: null })
  ];
  const report = analyzeLiveObservations({ format: 'autoscape-live-observations-v1', observations: frames });
  assert.deepEqual(report, analyzeLiveObservations({ format: 'autoscape-live-observations-v1', observations: frames }));
  assert.equal(report.frames, 4); assert.equal(report.deaths, 1); assert.equal(report.fighting, 1);
  assert.equal(report.lowHp, 2); assert.equal(report.fullInventory, 1); assert.equal(report.movementTransitions, 1);
  assert.equal(report.maxStationaryRun, 3); assert.equal(report.pendingActions['combat-attack'], 1);
  assert.equal(report.byTaskNode.woodcutting, 3); assert.equal(report.byTaskNode['death-recovery'], 1);
});
