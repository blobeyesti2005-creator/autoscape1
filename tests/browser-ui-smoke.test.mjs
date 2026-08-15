import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  createLearningSession, createTelemetryReplay, evaluateLearningPolicies,
  parseLearningReplay, serializeLearningReplay, LEARNING_ACTIONS
} from '../learning-sandbox.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const appHtml = read('index.html');
const labHtml = read('learning-lab.html');

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated function ${name}`);
}

function fakeClassList() {
  const values = new Set();
  return {
    toggle(name, enabled) { enabled ? values.add(name) : values.delete(name); },
    contains(name) { return values.has(name); }
  };
}

test('Android keyboard viewport smoke keeps the game scale stable and exposes the inset', () => {
  const properties = new Map(), bodyClasses = fakeClassList();
  const document = {
    activeElement: { tagName: 'INPUT', isContentEditable: false },
    documentElement: {
      clientHeight: 700, clientWidth: 512,
      style: { setProperty(name, value) { properties.set(name, value); } }
    },
    body: { classList: bodyClasses }
  };
  const window = {
    innerWidth: 512, innerHeight: 700,
    visualViewport: { height: 390, offsetTop: 0 }
  };
  const gameHost = { style: {} };
  const factory = new Function('window', 'document', 'gameHost', `
    let stableViewportHeight=window.innerHeight || document.documentElement.clientHeight || 346;
    ${functionSource(appHtml, 'textInputFocused')}
    ${functionSource(appHtml, 'syncMobileKeyboard')}
    ${functionSource(appHtml, 'fitGame')}
    return {syncMobileKeyboard,fitGame,stable:()=>stableViewportHeight};
  `);
  const ui = factory(window, document, gameHost);

  ui.fitGame();
  assert.equal(gameHost.style.transform, 'translate(-50%,-50%) scale(1)');
  window.innerHeight = 430;
  ui.syncMobileKeyboard();
  ui.fitGame();
  assert.equal(properties.get('--keyboard-inset'), '40px');
  assert.equal(bodyClasses.contains('keyboard-open'), false, 'small browser chrome changes are not a keyboard');
  assert.equal(gameHost.style.transform, 'translate(-50%,-50%) scale(1)', 'focused viewport changes must not rescale the canvas');

  window.visualViewport.height = 300;
  ui.syncMobileKeyboard();
  assert.equal(properties.get('--keyboard-inset'), '130px');
  assert.equal(bodyClasses.contains('keyboard-open'), true);
  document.activeElement = { tagName: 'DIV', isContentEditable: false };
  window.innerHeight = 700;
  ui.syncMobileKeyboard();
  assert.equal(properties.get('--keyboard-inset'), '0px');
  assert.equal(bodyClasses.contains('keyboard-open'), false);
  assert.equal(ui.stable(), 700);
});

test('live recorder browser controls are opt-in, bounded, copied, and route-aware', () => {
  const observationToggle = { textContent: '' }, observationDownload = { disabled: true }, observationStatus = { textContent: '' };
  const factory = new Function('observationToggle', 'observationDownload', 'observationStatus', `
    const LIVE_OBSERVATION_LIMIT=600;
    const FOOD_HEALS={10:3},LOG_IDS=new Set([14]),ORE_IDS=new Set([151]),BONE_IDS=new Set([20]);
    const actionContracts=new Map(),navWatch={targetKey:'',bestDistance:9,retries:1,stalls:2};
    let activeTaskNode='navigate',objective={type:'combat',phase:'travel',resource:'none',target:'chicken',combatStyle:'strength',bankMode:'never',countProgress:2,countGoal:10,routeIndex:0,routeRebuilds:1,stallRecoveries:2,navRoute:[{name:'Lumbridge Farm',x:5,y:7}]};
    const liveObservationRecorder={enabled:false,startedAt:0,observations:[]};
    function inventoryCountForIds(ids,inventory){let total=0;for(const [id,amount] of inventory.counts)if(ids.has(Number(id)))total+=Number(amount)||0;return total;}
    function nodeDistance(a,b){return Math.abs(a.x-b.x)+Math.abs(a.y-b.y);}
    ${functionSource(appHtml, 'observationToken')}
    ${functionSource(appHtml, 'buildLiveObservation')}
    ${functionSource(appHtml, 'updateObservationControls')}
    ${functionSource(appHtml, 'startLiveObservationRecording')}
    ${functionSource(appHtml, 'stopLiveObservationRecording')}
    ${functionSource(appHtml, 'recordLiveObservation')}
    ${functionSource(appHtml, 'getLiveObservations')}
    return {startLiveObservationRecording,stopLiveObservationRecording,recordLiveObservation,getLiveObservations,recorder:liveObservationRecorder};
  `);
  const recorder = factory(observationToggle, observationDownload, observationStatus);
  const frame = sequence => ({
    sequence, now: 1_000 + sequence, loggedIn: true, tile: { x: 1, y: 2 }, hits: 7, maxHits: 10,
    dead: false, fighting: false, inventoryMax: 30,
    inventory: { used: 4, counts: new Map([[14, 2], [151, 1], [10, 1], [999, 500]]), foods: [] }
  });

  assert.equal(recorder.recordLiveObservation(frame(1)), null);
  recorder.startLiveObservationRecording();
  assert.equal(observationToggle.textContent, 'Stop recording');
  for (let sequence = 1; sequence <= 605; sequence += 1) recorder.recordLiveObservation(frame(sequence));
  const exported = recorder.stopLiveObservationRecording();
  assert.equal(exported.observations.length, 600);
  assert.equal(exported.observations[0].sequence, 6);
  assert.equal(exported.observations.at(-1).navigation.target, 'lumbridgefarm');
  assert.equal(exported.observations.at(-1).navigation.distance, 9);
  assert.deepEqual(exported.observations.at(-1).inventory, { used: 4, maximum: 30, logs: 2, ores: 1, bones: 0, food: 1 });
  assert.equal('bank' in exported.observations.at(-1), false);
  assert.equal('credentials' in exported.observations.at(-1), false);
  exported.observations[0].tile.x = 999;
  assert.equal(recorder.getLiveObservations().observations[0].tile.x, 1, 'download objects must not expose retained frames');
  assert.equal(observationDownload.disabled, false);
  assert.match(observationStatus.textContent, /600 frames ready/);
});

function createElement(id) {
  return {
    id, value: id === 'seed' ? '20260815' : '', files: [], hidden: false, disabled: false,
    textContent: '', innerHTML: '', dataset: {}, style: {},
    click() {}, append() {}, querySelector() { return null; }
  };
}

test('five-bot lab controller boots, advances, and analyzes observations without action access', async () => {
  const ids = [...labHtml.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const elements = Object.fromEntries(ids.map(id => [id, createElement(id)]));
  const document = {
    getElementById(id) { return elements[id] || null; },
    createElement(tag) { return createElement(tag); }
  };
  const mockReport = {
    frames: 4, durationMs: 3000, movementRate: 0, maxStationaryRun: 4,
    navigationMovementRate: 0, maxNavigationStationaryRun: 4,
    stallEpisodeCount: 1, maxNavigationRetries: 1, maxNavigationStalls: 1,
    maxRouteRebuilds: 0, maxStallRecoveries: 0, fighting: 0, deaths: 0, lowHp: 0, fullInventory: 0,
    byTaskNode: { navigate: 4 }, stallTargets: { '<img-onerror>': 1 },
    diagnosticFlags: ['<script-alert>'],
    stallEpisodes: [{ startSequence: 1, endSequence: 4, durationMs: 3000, taskNode: 'navigate', target: '<bad-target>', maxRetries: 1, resolvedBy: 'recording-ended' }]
  };
  const moduleScript = labHtml.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(moduleScript);
  const controller = moduleScript.replace(/^\s*import[^;]+;\s*/m, '');
  const context = vm.createContext({
    document, location: { href: 'https://example.test/learning-lab.html' }, URL, Blob,
    setInterval: () => 1, clearInterval() {}, setTimeout: callback => callback(),
    createLearningSession, createTelemetryReplay, evaluateLearningPolicies,
    parseLearningReplay, serializeLearningReplay, LEARNING_ACTIONS,
    parseLiveObservations: text => ({ text }), analyzeLiveObservations: () => mockReport
  });
  new vm.Script(controller, { filename: 'learning-lab-browser-smoke.js' }).runInContext(context);

  assert.equal((elements.bots.innerHTML.match(/class="bot"/g) || []).length, 5);
  assert.match(elements.status.textContent, /Paused at tick 0/);
  assert.equal(typeof elements.fast.onclick, 'function');
  elements.fast.onclick();
  assert.match(elements.status.textContent, /Paused at tick 100/);

  const actionHandler = elements.observationFile.onchange;
  assert.equal(typeof actionHandler, 'function');
  await actionHandler({ target: { files: [{ size: 100, text: async () => '{"safe":true}' }], value: 'trace.json' } });
  assert.match(elements.status.textContent, /No actions were executed/);
  assert.match(elements.observationReport.innerHTML, /&lt;img-onerror&gt;/);
  assert.match(elements.observationReport.innerHTML, /&lt;script-alert&gt;/);
  assert.match(elements.observationReport.innerHTML, /&lt;bad-target&gt;/);
  assert.doesNotMatch(elements.observationReport.innerHTML, /<img-onerror>|<script-alert>|<bad-target>/);
});
