import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  createLearningSession, createTelemetryReplay, LEARNING_ACTIONS, LEARNING_GOALS
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
  assert.doesNotMatch(`${lab}\n${engine}`, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(app, /from ['"]\.\/learning-sandbox\.mjs/);

  const ids = [...lab.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'learning lab IDs must be unique');
  const moduleScript = lab.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(moduleScript, 'learning lab controller is missing');
  const withoutImport = moduleScript.replace(/^\s*import[^;]+;\s*/m, '');
  assert.doesNotThrow(() => new vm.Script(withoutImport, { filename: 'learning-lab-inline.js' }));
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
