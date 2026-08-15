import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const serviceWorker = read('sw.js');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `missing section start: ${start}`);
  assert.notEqual(to, -1, `missing section end: ${end}`);
  return source.slice(from, to);
}

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

test('all shipped JavaScript parses', () => {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length >= 2, 'expected application and stable-origin scripts');
  scripts.forEach((match, index) => {
    assert.doesNotThrow(
      () => new vm.Script(match[1], { filename: `index-inline-${index}.js` }),
      `inline script ${index} must parse`
    );
  });
  assert.doesNotThrow(() => new vm.Script(serviceWorker, { filename: 'sw.js' }));
});

test('required UI controls exist once and labels point to controls', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], []);

  const required = [
    'game-host', 'loader', 'bot', 'botStatus', 'botMetrics', 'queuePlan', 'botTrace',
    'botInput', 'resourceSelect', 'miningSelect', 'combatSelect',
    'combatStyleSelect', 'combatBankSelect', 'lootSelect', 'guidePanel',
    'observationToggle', 'observationDownload', 'observationStatus'
  ];
  required.forEach(id => assert.ok(ids.includes(id), `missing #${id}`));

  for (const match of html.matchAll(/<label\s+for="([^"]+)"/g)) {
    assert.ok(ids.includes(match[1]), `label points to missing #${match[1]}`);
  }
});

test('mobile keyboard keeps bot controls visible without rescaling flicker', () => {
  assert.match(html, /--keyboard-inset,0px/);
  assert.match(html, /max-height:calc\(100dvh - 70px\)/);
  assert.match(html, /body\.keyboard-open #fsBtn/);

  const keyboardSource = functionSource(html, 'syncMobileKeyboard');
  assert.match(keyboardSource, /window\.visualViewport/);
  assert.match(keyboardSource, /--keyboard-inset/);
  assert.match(keyboardSource, /classList\.toggle\('keyboard-open'/);

  const fitSource = functionSource(html, 'fitGame');
  assert.match(fitSource, /textInputFocused\(\)\?stableViewportHeight:liveHeight/);
  assert.match(html, /visualViewport\?\.addEventListener\('resize',scheduleFitGame\)/);
  assert.match(html, /document\.addEventListener\('focusin',scheduleFitGame\)/);
});

test('chicken routing approaches the open Lumbridge farm gate', () => {
  assert.match(html, /lumbridgeFarm:\{x:112,y:619\}/);
  assert.match(html, /chicken:\{node:'lumbridgeFarm',centre:\{x:119,y:604\}/);
  assert.doesNotMatch(html, /lumbridgeFarm:\{x:119,y:605\}/);
});

test('manifest and offline shell stay internally consistent', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.start_url, './');
  assert.ok(['standalone', 'fullscreen'].includes(manifest.display));

  const shellMatch = serviceWorker.match(/const APP_SHELL = (\[[^;]+\]);/);
  assert.ok(shellMatch, 'APP_SHELL definition missing');
  const shell = JSON.parse(shellMatch[1].replaceAll("'", '"'));
  for (const entry of shell) {
    const relative = entry.replace(/^\.\//, '');
    if (!relative) continue;
    assert.ok(fs.existsSync(path.join(root, relative)), `${entry} is missing`);
  }

  assert.match(serviceWorker, /RUNTIME_CACHE/);
  assert.match(html, /const RUNTIME_CACHE_NAME='autoscape-runtime-v1'/);
  assert.match(functionSource(html, 'fetchText'), /runtimeCache\.put\(url,cacheCopy\)/);
  assert.match(functionSource(html, 'fetchText'), /source:'cache'/);
  assert.match(html, /first successful launch needs internet/);
  assert.match(serviceWorker, /migrateRuntimeEntries/);
  assert.match(serviceWorker, /request\.mode === 'navigate'/);
});

test('account, stat, and job persistence safeguards remain installed', () => {
  const required = [
    "await this.save();",
    'const PLAYER_SAVE_INTERVAL = 1000 * 15',
    'setTimeout(this.boundSaveAllPlayers, PLAYER_SAVE_INTERVAL)',
    'message.skills = Object.fromEntries(',
    'return [skillName, { ...skill }]',
    "localStorage.setItem('autoscape_credentials'",
    "persistLocalValue('autoscape_job'",
    'queue:[...queue]',
    'countProgress:Number(o.countProgress||0)',
    'window.__AUTOSCAPE_STABLE_ORIGIN_V24__=true'
  ];
  required.forEach(marker => assert.ok(html.includes(marker), `missing safeguard: ${marker}`));

  assert.match(html, /this\.fatigue = 0; \/\/ AutoScape has unlimited energy/);
  assert.match(html, /if \(false && useFatigue\)/);
  assert.match(html, /fatigue:false/);
});

test('server persistence patch performs durable registration and recurring saves', () => {
  const persistenceSource = section(
    html,
    '  function patchServerPersistence(code){',
    '  // RuneScape Classic predates the Lumbridge bank'
  );
  const patchServerPersistence = new Function(
    `${persistenceSource}\nreturn patchServerPersistence;`
  )();
  const fixture = `
        // { playerID: username }
        this.playerUsernames = new Map();
    async load() {
        const playerID = await idbKeyval.get('playerID');
        this.playerID = playerID ? Number(playerID) : 0;

        const players = await idbKeyval.get('players');
        this.players = players ? new Map(JSON.parse(players)) : new Map();

        for (const player of this.players.values()) {
            player.world = 0;
        }

        log.info(\`loaded \${this.players.size} players from local storage\`);
    }
    async save() {
        await idbKeyval.set('playerID', this.playerID);
        await idbKeyval.set(
            'players',
            JSON.stringify(Array.from(this.players.entries()))
        );
    }
                this.players.set(player.username, player);

                return {
                    success: true,
                    code: 2
                };
    async savePlayer(player) {
        player.password = this.players.get(player.username).password;
        this.players.set(player.username, JSON.parse(JSON.stringify(player)));
        await this.save();
    }
const PLAYER_SAVE_INTERVAL = 1000 * 60 * 5; // (5 mins)
        this.boundSaveAllPlayers = this.saveAllPlayers.bind(this);

        this.ticks = 0;
    async saveAllPlayers() {
        if (!this.players.length) {
            return;
        }`;
  const patched = patchServerPersistence(fixture);

  assert.match(patched, /this\.saveQueue = Promise\.resolve\(\)/);
  assert.match(patched, /this\.persistenceReady = false/);
  assert.match(patched, /Local character storage is damaged; no records were changed/);
  assert.match(patched, /Local character storage is not ready; checkpoint refused/);
  assert.match(patched, /const pending = this\.saveQueue\.then\(commit, commit\)/);
  assert.match(patched, /this\.saveQueue = pending\.catch\(\(\) => undefined\)/);
  assert.match(patched, /this\.players\.set\(player\.username, player\);\s*await this\.save\(\);/);
  assert.match(patched, /this\.players\.set\(player\.username, JSON\.parse\(JSON\.stringify\(player\)\)\)/);
  assert.match(patched, /const PLAYER_SAVE_INTERVAL = 1000 \* 15/);
  assert.match(patched, /this\.ticks = 0;\s*setTimeout\(this\.boundSaveAllPlayers, PLAYER_SAVE_INTERVAL\);/);
  assert.match(patched, /if \(!this\.players\.length\) \{\s*setTimeout\(this\.boundSaveAllPlayers, PLAYER_SAVE_INTERVAL\);\s*return;/);
  assert.throws(
    () => patchServerPersistence(fixture.replace('this.players.set(player.username, player);', 'this.players.add(player);')),
    /registration block changed/
  );
  assert.throws(
    () => patchServerPersistence(fixture.replace('JSON.parse(JSON.stringify(player))', '{ ...player }')),
    /player clone save changed/
  );
  assert.throws(
    () => patchServerPersistence(fixture.replace('this.playerUsernames = new Map();', 'this.playerUsernames = new Set();')),
    /browser data constructor changed/
  );
});

test('page lifecycle checkpoints serialize full saves without duplicating recurring timers', async () => {
  const lifecycleSource = section(
    html,
    '  function patchServerLifecycleCheckpoint(code){',
    '  // RuneScape Classic predates the Lumbridge bank'
  );
  const patchServerLifecycleCheckpoint = new Function(
    `${lifecycleSource}\nreturn patchServerLifecycleCheckpoint;`
  )();
  const fixture = `
class World {
    constructor() {
        this.players = { length: 1, getAll: () => this.testPlayers };
        this.testPlayers = [];
        this.boundSaveAllPlayers = this.saveAllPlayers.bind(this);
    }
    async saveAllPlayers() {
        if (!this.players.length) {
            setTimeout(this.boundSaveAllPlayers, PLAYER_SAVE_INTERVAL);
            return;
        }
        for (const player of this.players.getAll()) {
            await player.save();
        }
        setTimeout(this.boundSaveAllPlayers, PLAYER_SAVE_INTERVAL);
    }

    toString() {
        return 'world';
    }
}
const PLAYER_SAVE_INTERVAL = 1000 * 15;
const Server = require('./server');
(async () => {
        addEventListener('message', async (e) => {
            switch (e.data.type) {
                case 'start': {
                    const server = new Server(e.data.config);
                    await server.init();
                    postMessage({ type: 'ready' });
                    break;
                }
            }
        });
})();
return { World };`;
  const patched = patchServerLifecycleCheckpoint(fixture);
  assert.match(patched, /saveAllPlayers\(scheduleNext = true\)/);
  assert.match(patched, /server\.world\.saveAllPlayers\(false\)/);
  assert.match(patched, /checkpointQueue\.then\(save, save\)/);

  const timers = [];
  const messages = [];
  const listeners = [];
  class FakeServer {
    constructor() {
      this.world = new exposed.World();
      FakeServer.last = this;
    }
    async init() {}
  }
  let exposed;
  exposed = new Function('require', 'addEventListener', 'postMessage', 'setTimeout', patched)(
    () => FakeServer,
    (type, listener) => { if (type === 'message') listeners.push(listener); },
    message => messages.push(message),
    (callback, delay) => { timers.push({ callback, delay }); }
  );
  const dispatch = data => Promise.all(listeners.map(listener => listener({ data })));
  await dispatch({ type: 'start', config: {} });
  assert.deepEqual(messages.shift(), { type: 'ready' });

  const saveOrder = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  FakeServer.last.world.testPlayers = [{
    async save() {
      saveOrder.push('start');
      if (saveOrder.length === 1) await firstGate;
      saveOrder.push('finish');
    }
  }];
  const first = dispatch({ type: 'checkpoint', requestId: 1 });
  await Promise.resolve();
  const second = dispatch({ type: 'checkpoint', requestId: 2 });
  await Promise.resolve();
  assert.deepEqual(saveOrder, ['start'], 'the second explicit checkpoint must wait for the first');
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(saveOrder, ['start', 'finish', 'start', 'finish']);
  assert.equal(timers.length, 0, 'explicit lifecycle checkpoints must not create recurring save timers');
  assert.deepEqual(messages.map(message => [message.type, message.requestId, message.success]), [
    ['checkpoint-result', 1, true],
    ['checkpoint-result', 2, true]
  ]);

  await FakeServer.last.world.saveAllPlayers();
  assert.equal(timers.length, 1, 'the normal periodic save path still schedules exactly one successor');

  const requestSource = `${functionSource(html, 'requestServerCheckpoint')}\n${functionSource(html, 'handleServerCheckpointMessage')}`;
  let activeWorker = { sent: [], postMessage(message) { this.sent.push(message); } };
  const lifecycle = new Function('getWorker', 'console', `
    let checkpointRequestSequence=0,checkpointPendingId=0;
    let worker=getWorker();
    ${requestSource}
    return {requestServerCheckpoint,handleServerCheckpointMessage,get pending(){return checkpointPendingId;}};
  `)(() => activeWorker, { warn() {} });
  assert.equal(lifecycle.requestServerCheckpoint('hidden'), true);
  assert.equal(lifecycle.requestServerCheckpoint('pagehide'), false, 'hide/pagehide bursts coalesce while a save is pending');
  assert.deepEqual(activeWorker.sent, [{ type: 'checkpoint', requestId: 1, reason: 'hidden' }]);
  assert.equal(lifecycle.handleServerCheckpointMessage({ data: { type: 'checkpoint-result', requestId: 99, success: true } }), false);
  assert.equal(lifecycle.handleServerCheckpointMessage({ data: { type: 'checkpoint-result', requestId: 1, success: true } }), true);
  assert.equal(lifecycle.requestServerCheckpoint('hidden'), true, 'a later hide can request a fresh save after acknowledgement');
  assert.deepEqual(Object.keys(activeWorker.sent[0]).sort(), ['reason', 'requestId', 'type'], 'lifecycle messages must not expose account data');
  assert.match(html, /document\.addEventListener\('visibilitychange'/);
  assert.match(html, /window\.addEventListener\('pagehide'/);
});

test('browser save queue preserves checkpoint order and recovers after a failed commit', async () => {
  const persistenceSource = section(
    html,
    '  function patchServerPersistence(code){',
    '  // RuneScape Classic predates the Lumbridge bank'
  );
  const patchServerPersistence = new Function(
    `${persistenceSource}\nreturn patchServerPersistence;`
  )();
  const fixture = `
class BrowserDataClient {
    constructor() {
        // { playerID: username }
        this.playerUsernames = new Map();
        this.playerID = 1;
        this.players = new Map();
    }
    async load() {
        const playerID = await idbKeyval.get('playerID');
        this.playerID = playerID ? Number(playerID) : 0;

        const players = await idbKeyval.get('players');
        this.players = players ? new Map(JSON.parse(players)) : new Map();

        for (const player of this.players.values()) {
            player.world = 0;
        }

        log.info(\`loaded \${this.players.size} players from local storage\`);
    }
    async save() {
        await idbKeyval.set('playerID', this.playerID);
        await idbKeyval.set(
            'players',
            JSON.stringify(Array.from(this.players.entries()))
        );
    }
    async savePlayer(player) {
        player.password = this.players.get(player.username).password;
        this.players.set(player.username, JSON.parse(JSON.stringify(player)));
        await this.save();
    }
    async register(player) {
                this.players.set(player.username, player);

                return {
                    success: true,
                    code: 2
                };
    }
}
const PLAYER_SAVE_INTERVAL = 1000 * 60 * 5; // (5 mins)
class World {
    constructor() {
        this.boundSaveAllPlayers = this.saveAllPlayers.bind(this);

        this.ticks = 0;
    }
    async saveAllPlayers() {
        if (!this.players.length) {
            return;
        }
    }
}
return BrowserDataClient;`;
  const writes = [];
  let releaseFirst;
  let failNext = false;
  const gate = new Promise(resolve => { releaseFirst = resolve; });
  const idbKeyval = {
    async set(key, value) {
      writes.push({ key, value });
      if (writes.length === 1) await gate;
      if (failNext && key === 'players') {
        failNext = false;
        throw new Error('simulated quota interruption');
      }
    }
  };
  const Client = new Function('idbKeyval', 'log', patchServerPersistence(fixture))(idbKeyval, { info() {} });
  const client = new Client();
  client.persistenceReady = true;
  client.players.set('tester', { username: 'tester', password: 'secret', coins: 1 });
  const first = client.save();
  await Promise.resolve();
  client.playerID = 2;
  client.players.get('tester').coins = 2;
  const second = client.save();
  await Promise.resolve();
  assert.equal(writes.length, 1, 'newer checkpoint must wait for the active IndexedDB commit');
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(writes.map(write => write.key), ['playerID', 'players', 'playerID', 'players']);
  assert.equal(new Map(JSON.parse(writes[1].value)).get('tester').coins, 1);
  assert.equal(new Map(JSON.parse(writes[3].value)).get('tester').coins, 2);

  failNext = true;
  client.players.get('tester').coins = 3;
  await assert.rejects(client.save(), /simulated quota interruption/);
  client.players.get('tester').coins = 4;
  await client.save();
  const playerWrites = writes.filter(write => write.key === 'players');
  assert.equal(new Map(JSON.parse(playerWrites.at(-1).value)).get('tester').coins, 4);
  assert.ok(client.saveQueue instanceof Promise, 'queue remains usable after a rejected transaction');
});

test('browser load fails closed on damaged records and can retry without rewriting storage', async () => {
  const persistenceSource = section(
    html,
    '  function patchServerPersistence(code){',
    '  // RuneScape Classic predates the Lumbridge bank'
  );
  const patchServerPersistence = new Function(
    `${persistenceSource}\nreturn patchServerPersistence;`
  )();
  const fixture = `
class BrowserDataClient {
    constructor() {
        // { playerID: username }
        this.playerUsernames = new Map();
    }
    async load() {
        const playerID = await idbKeyval.get('playerID');
        this.playerID = playerID ? Number(playerID) : 0;

        const players = await idbKeyval.get('players');
        this.players = players ? new Map(JSON.parse(players)) : new Map();

        for (const player of this.players.values()) {
            player.world = 0;
        }

        log.info(\`loaded \${this.players.size} players from local storage\`);
    }
    async save() {
        await idbKeyval.set('playerID', this.playerID);
        await idbKeyval.set(
            'players',
            JSON.stringify(Array.from(this.players.entries()))
        );
    }
    async savePlayer(player) {
        player.password = this.players.get(player.username).password;
        this.players.set(player.username, JSON.parse(JSON.stringify(player)));
        await this.save();
    }
    async register(player) {
                this.players.set(player.username, player);

                return {
                    success: true,
                    code: 2
                };
    }
}
const PLAYER_SAVE_INTERVAL = 1000 * 60 * 5; // (5 mins)
class World {
    constructor() {
        this.boundSaveAllPlayers = this.saveAllPlayers.bind(this);

        this.ticks = 0;
    }
    async saveAllPlayers() {
        if (!this.players.length) {
            return;
        }
    }
}
return BrowserDataClient;`;
  const raw = {
    playerID: '2',
    players: '{damaged character data'
  };
  const writes = [];
  let readFailure = null;
  const idbKeyval = {
    async get(key) {
      if (readFailure) throw readFailure;
      return raw[key];
    },
    async set(key, value) { writes.push({ key, value }); }
  };
  const Client = new Function('idbKeyval', 'log', patchServerPersistence(fixture))(idbKeyval, { info() {} });
  const client = new Client();
  await assert.rejects(client.load(), /Local character storage is damaged; no records were changed/);
  assert.equal(client.persistenceReady, false);
  await assert.rejects(client.save(), /checkpoint refused/);
  assert.deepEqual(writes, [], 'a failed load and refused save must not mutate either legacy key');
  assert.equal(raw.players, '{damaged character data', 'damaged bytes remain available for recovery');

  const complete = [[
    'tester',
    {
      id: 1,
      username: 'tester',
      password: 'secret',
      world: 1,
      skills: { attack: { current: 12, experience: 1_500 } },
      inventory: [{ id: 132, amount: 7 }],
      bank: [{ id: 14, amount: 65_535 }],
      settings: { cameraAuto: 1, soundOn: 1 }
    }
  ]];
  raw.players = JSON.stringify(complete);
  await client.load();
  assert.equal(client.persistenceReady, true);
  assert.equal(client.playerID, 2);
  assert.deepEqual(client.players.get('tester'), { ...complete[0][1], world: 0 });
  assert.deepEqual(writes, [], 'successful validation must not rewrite compatible records');
  await client.save();
  assert.deepEqual(writes.map(write => write.key), ['playerID', 'players']);

  const invalidCases = [
    ['not an array', JSON.stringify({ tester: complete[0][1] }), '2'],
    ['duplicate username', JSON.stringify([complete[0], complete[0]]), '2'],
    ['username mismatch', JSON.stringify([['tester', { ...complete[0][1], username: 'other' }]]), '2'],
    ['invalid record id', JSON.stringify([['tester', { ...complete[0][1], id: -1 }]]), '2'],
    ['next id behind records', JSON.stringify(complete), '1'],
    ['invalid next id', JSON.stringify(complete), 'not-a-number']
  ];
  for (const [label, players, playerID] of invalidCases) {
    raw.players = players;
    raw.playerID = playerID;
    await assert.rejects(client.load(), /Local character storage is damaged/, label);
    assert.equal(client.persistenceReady, false, `${label} must close the write guard`);
  }

  raw.players = JSON.stringify(complete);
  raw.playerID = '2';
  readFailure = new Error('simulated blocked database');
  const writeCount = writes.length;
  await assert.rejects(client.load(), /storage could not be read; no records were changed/);
  assert.equal(client.persistenceReady, false);
  assert.equal(writes.length, writeCount, 'a read failure must never trigger storage repair writes');
});

test('browser account storage round-trips complete character state without aliases', async () => {
  const players = new Map([['tester', { username: 'tester', password: 'secret', world: 1 }]]);
  let serialized = '';
  const client = {
    players,
    async save() {
      serialized = JSON.stringify(Array.from(this.players.entries()));
    },
    async savePlayer(player) {
      player.password = this.players.get(player.username).password;
      this.players.set(player.username, JSON.parse(JSON.stringify(player)));
      await this.save();
    }
  };
  const live = {
    id: 42,
    username: 'tester',
    rank: 0,
    x: 124,
    y: 657,
    questPoints: 7,
    combatStyle: 2,
    fatigue: 0,
    cameraAuto: 1,
    oneMouseButton: 0,
    soundOn: 1,
    blockChat: 0,
    blockPrivateChat: 1,
    blockTrade: 0,
    blockDuel: 1,
    skulled: 250,
    muteEndDate: 0,
    world: 1,
    hairColour: 2,
    topColour: 8,
    trouserColour: 14,
    skinColour: 0,
    headSprite: 1,
    bodySprite: 2,
    friends: ['friend one'],
    ignores: ['ignored one'],
    questStages: { cooksAssistant: -1, demonSlayer: 3 },
    cache: { tutorial: { stage: 4 }, flags: [true, false] },
    skills: {
      attack: { current: 12, experience: 1_500 },
      hits: { current: 8, experience: 4_616 }
    },
    inventory: [
      { id: 87, equipped: true },
      { id: 132, amount: 7 },
      { id: 10, amount: 2_147_483_647 }
    ],
    bank: [
      { id: 14, amount: 65_535 },
      { id: 151, amount: 12_345 },
      { id: 166 }
    ]
  };
  const expected = structuredClone(live);
  expected.password = 'secret';
  await client.savePlayer(live);

  // Changes to the live player after the checkpoint must not leak backward
  // into the persisted account snapshot.
  live.inventory[1].amount = 0;
  live.bank.push({ id: 999, amount: 1 });
  live.questStages.cooksAssistant = 0;
  live.cache.flags[0] = false;

  const reloaded = new Map(JSON.parse(serialized));
  for (const player of reloaded.values())player.world = 0;
  const stored = reloaded.get('tester');
  assert.deepEqual(stored, { ...expected, world: 0 });
  assert.equal(stored.password, 'secret');
  assert.deepEqual(stored.inventory[0], { id: 87, equipped: true });
  assert.equal(stored.inventory[2].amount, 2_147_483_647);
  assert.equal(stored.bank[0].amount, 65_535);
  assert.equal(stored.skills.attack.current, 12);
  assert.equal(stored.skills.attack.experience, 1_500);
  assert.equal(stored.questStages.cooksAssistant, -1);
  assert.deepEqual(stored.cache.flags, [true, false]);
});

test('remembered browser login validates credentials and reuses the local account', async () => {
  const readStoredJSON = new Function(
    `${functionSource(html, 'readStoredJSON')}\nreturn readStoredJSON;`
  )();
  const readRememberedCredentials = new Function(
    `${functionSource(html, 'readStoredJSON')}\n${functionSource(html, 'readRememberedCredentials')}\nreturn readRememberedCredentials;`
  )();
  const loginSource = functionSource(html, 'loginRememberedCharacter').replace(/^function /,'async function ');
  const loginRememberedCharacter = new Function(
    `${loginSource}\nreturn loginRememberedCharacter;`
  )();

  const storage = value => ({ getItem: key => key === 'autoscape_credentials' ? value : null });
  assert.deepEqual(
    readRememberedCredentials(storage(JSON.stringify({ u: 'saved-player', p: 'local-pass' }))),
    { u: 'saved-player', p: 'local-pass' }
  );
  assert.equal(readRememberedCredentials(storage('{damaged')), null);
  assert.equal(readRememberedCredentials(storage(JSON.stringify({ u: 'saved-player' }))), null);
  assert.equal(readRememberedCredentials(storage(JSON.stringify({ u: 123, p: true }))), null);

  const damagedStorage={
    value:'{damaged',writes:0,removals:0,
    getItem(){return this.value;},
    setItem(){this.writes++;},
    removeItem(){this.removals++;}
  };
  const damaged=readStoredJSON('autoscape_job',damagedStorage);
  assert.equal(damaged.state,'invalid');
  assert.equal(damaged.value,null);
  assert.equal(damagedStorage.value,'{damaged');
  assert.equal(damagedStorage.writes,0);
  assert.equal(damagedStorage.removals,0);

  const calls=[];
  const client={
    loggedIn:0,
    async login(username,password,reconnect){calls.push({username,password,reconnect});}
  };
  assert.equal(
    await loginRememberedCharacter({u:'saved-player',p:'local-pass'},client),
    true
  );
  assert.equal(client.loginUser,'saved-player');
  assert.equal(client.loginPass,'local-pass');
  assert.deepEqual(calls,[{username:'saved-player',password:'local-pass',reconnect:false}]);

  client.loggedIn=1;
  assert.equal(await loginRememberedCharacter({u:'saved-player',p:'local-pass'},client),false);
  assert.equal(calls.length,1,'an already logged-in character must not receive another login request');

  assert.match(html,/your local account was not removed/);
  const scheduler = functionSource(html, 'scheduleRememberedAutoLogin');
  assert.match(scheduler,/__autoscapeAutoLoginTimer=schedule/);
  assert.match(scheduler,/client\.loggedIn===1\|\|client\.__autoscapeAutoLoginTimer/);
  assert.match(scheduler,/finally\{\s*client\.__autoscapeAutoLoginTimer=0/);
  assert.match(html,/scheduleRememberedAutoLogin\(rememberedCredentials\)/);
  assert.match(html,/storedStartupJob\.state!=='missing'\)scheduleSavedJobResume\(\(\)=>\{/);
  assert.doesNotMatch(html,/normalizeSavedJob\(JSON\.parse\(localStorage\.getItem\('autoscape_job'\)/);
});

test('server gameplay patch preserves live stats through load and save', () => {
  const gameplaySource = section(
    html,
    '  function patchServerGameplay(code){',
    '  function waitWorkerReady('
  );
  const patchServerGameplay = new Function(
    `${gameplaySource}\nreturn patchServerGameplay;`
  )();
  const fixture = `
function loadSkills(playerData, experienceToLevel) {
        this.skills = playerData.skills;

        for (const skillName of Object.keys(this.skills)) {
            this.skills[skillName].base = experienceToLevel(
                this.skills[skillName].experience
            );
        }
    return this.skills;
}
function savePlayer(message) {
        message = { ...message, ...this.appearance };

        for (const skillName of Object.keys(message.skills)) {
        delete message.skills[skillName].base;
    }
    return message;
}
function loadFatigue(playerData) {
        this.fatigue = playerData.fatigue;
    return this.fatigue;
}
function awardExperience(useFatigue) {
        if (useFatigue) {
        return 'fatigued';
    }
    return 'awarded';
}
function movePlayer() {
        if (this.walkQueue.length && !this.locked) {
            const { deltaX, deltaY } = this.walkQueue.shift();

            if (this.canWalk(deltaX, deltaY)) {
                this.walkTo(deltaX, deltaY);
            } else {
                this.following = null;
                this.walkQueue.length = 0;
                this.faceDirection(deltaX * -1, deltaY * -1);
            }
        }
}
return { loadSkills, savePlayer, loadFatigue, awardExperience, movePlayer };`;
  const patched = patchServerGameplay(fixture);
  const server = new Function(patched)();
  const originalSkills = {
    attack: { experience: 900, base: 1, current: 15 },
    strength: { experience: 400, base: 1 },
    hits: { experience: 1_600, base: 1, current: 7 }
  };
  const player = { appearance: { hairColour: 2 } };
  server.loadSkills.call(player, { skills: structuredClone(originalSkills) }, xp => Math.floor(Math.sqrt(xp) / 3) + 1);

  assert.equal(player.skills.attack.base, 11);
  assert.equal(player.skills.attack.current, 15, 'boosted current level must survive loading');
  assert.equal(player.skills.strength.base, 7);
  assert.equal(player.skills.strength.current, 7, 'missing current level should recover to base');
  assert.equal(player.skills.hits.base, 14);
  assert.equal(player.skills.hits.current, 7, 'drained current level must survive loading');

  const liveSnapshot = structuredClone(player.skills);
  const inventory = [{ id: 14, amount: 12 }];
  const bank = [{ id: 10, amount: 4_200 }];
  const saved = server.savePlayer.call(player, { skills: player.skills, inventory, bank });
  assert.deepEqual(player.skills, liveSnapshot, 'saving must never mutate live skill objects');
  assert.deepEqual(saved.inventory, inventory);
  assert.deepEqual(saved.bank, bank);
  assert.equal(saved.hairColour, 2);
  for (const skill of Object.values(saved.skills)) {
    assert.equal('base' in skill, false, 'serialized base remains derived from experience');
    assert.ok(Number.isFinite(skill.current));
    assert.ok(Number.isFinite(skill.experience));
  }

  assert.equal(server.loadFatigue.call({}, { fatigue: 700 }), 0);
  assert.equal(server.awardExperience(true), 'awarded');
  assert.throws(
    () => patchServerGameplay(fixture.replace('this.skills = playerData.skills;', 'this.skills = { ...playerData.skills };')),
    /skill initialization changed/
  );
});

test('natural-language command parser keeps key command chains usable', () => {
  const parserSource = section(html, '    function normalizeIntent(s){', '    function startSingle(s,intent){');
  const { parse } = new Function(`${parserSource}\nreturn { parse };`)();

  assert.deepEqual(parse('chop 10 logs'), { type: 'woodcutting', resource: null, amount: 10 });
  assert.deepEqual(parse('mine 20 iron ore'), { type: 'mining', resource: 'iron', amount: 20 });
  assert.deepEqual(parse('firemake the logs'), { type: 'firemaking', supply: 'held', amount: 0 });
  assert.deepEqual(parse('train firemaking'), { type: 'firemaking', supply: 'gather', amount: 0 });
  assert.deepEqual(parse('bank inventory'), { type: 'banking', mode: 'carried' });
  assert.deepEqual(parse('deposit gathered resources'), { type: 'banking', mode: 'gathered' });
  assert.deepEqual(parse('bank loot'), { type: 'banking', mode: 'loot' });
  assert.deepEqual(parse('bury 10 bones'), { type: 'prayer', resource: 'bones', amount: 10 });
  assert.deepEqual(parse('train prayer'), { type: 'prayer', resource: 'bones', amount: 0 });

  const strength = parse('train strength on chickens');
  assert.equal(strength.type, 'combat');
  assert.equal(strength.target, 'chicken');
  assert.equal(strength.combatStyle, 'strength');

  const noBank = parse('fight chickens to the death');
  assert.equal(noBank.target, 'chicken');
  assert.equal(noBank.bankMode, 'never');
  assert.deepEqual(parse('stop the bot'), { type: 'stop' });
});

test('saved command chains round-trip progress, style, and banking intent', () => {
  const persistenceSource = section(
    html,
    '    function serializeObjectiveState(o=objective,queue=commandQueue){',
    '    function saveObjective(){'
  );
  const { serializeObjectiveState, normalizeSavedJob } = new Function(
    'objective', 'commandQueue', 'lootSelect', 'combatStyleSelect',
    'combatBankSelect', 'activeCommandText',
    `${persistenceSource}\nreturn {serializeObjectiveState,normalizeSavedJob};`
  )(
    null,
    [],
    { value: 'valuable' },
    { value: 'controlled' },
    { value: 'safe' },
    ''
  );
  const objective = {
    type: 'combat', target: 'chicken', combatStyle: 'strength', bankMode: 'never',
    commandText: 'kill 12 chickens to the death then chop 10 logs',
    chainAdvance: true, countGoal: 12, countProgress: 5
  };
  const queue = ['chop 10 logs', 'firemake the logs'];
  const stored = JSON.parse(JSON.stringify(serializeObjectiveState(objective, queue)));
  const restored = normalizeSavedJob(stored);

  assert.equal(restored.type, 'combat');
  assert.equal(restored.target, 'chicken');
  assert.equal(restored.combatStyle, 'strength');
  assert.equal(restored.bankMode, 'never');
  assert.equal(restored.countGoal, 12);
  assert.equal(restored.countProgress, 5);
  assert.equal(restored.chainAdvance, true);
  assert.deepEqual(restored.queue, queue);
  assert.equal(restored.lootMode, 'valuable');

  const legacy = normalizeSavedJob({ type: 'woodcutting', active: true, resource: 'willow' });
  assert.equal(legacy.resource, 'willow');
  assert.equal(legacy.countGoal, 0);
  assert.equal(legacy.countProgress, 0);
  assert.equal(legacy.combatStyle, 'controlled');
  assert.equal(legacy.bankMode, 'safe');
  assert.deepEqual(legacy.queue, []);

  const damaged = normalizeSavedJob({
    type: 'combat', active: true, combatStyle: 'invalid', bankMode: 'invalid',
    countGoal: 10, countProgress: 99, queue: ['  chop logs  ', null, '']
  });
  assert.equal(damaged.combatStyle, 'controlled');
  assert.equal(damaged.bankMode, 'safe');
  assert.equal(damaged.countProgress, 10);
  assert.deepEqual(damaged.queue, ['chop logs']);
  assert.equal(normalizeSavedJob({ type: 'unknown', active: true }), null);

  const banking = normalizeSavedJob({
    type: 'banking', resource: 'loot', active: true,
    queue: ['fight chickens'], chainAdvance: true
  });
  assert.equal(banking.type, 'banking');
  assert.equal(banking.resource, 'loot');
  assert.deepEqual(banking.queue, ['fight chickens']);

  const prayer = normalizeSavedJob({
    type: 'prayer', resource: 'bones', active: true, countGoal: 10,
    countProgress: 4, queue: ['bank loot'], chainAdvance: true
  });
  assert.equal(prayer.type, 'prayer');
  assert.equal(prayer.resource, 'bones');
  assert.equal(prayer.countProgress, 4);
  assert.deepEqual(prayer.queue, ['bank loot']);

  assert.match(html, /const storedStartupJob=readStoredJSON\('autoscape_job'\)/);
  assert.match(html, /const savedJob=normalizeSavedJob\(storedJob\.value\)/);
  assert.match(functionSource(html, 'saveObjective'), /serializeObjectiveState\(\)/);
});

test('bank deposits require confirmed inventory removal and preserve equipped items', () => {
  const packets=[];
  let activePacket=null;
  const mc={
    showDialogBank:true,
    packetStream:{
      newPacket(id){activePacket={id,values:[]};packets.push(activePacket);},
      putShort(value){activePacket.values.push(value);},
      putInt(value){activePacket.values.push(value);},
      sendPacket(){}
    },
    inventoryItemId:[87,14,10,132],
    inventoryItemStackCount:[1,3,100,2],
    inventoryEquipped:[1,0,0,0]
  };
  const sessionStats={actions:0,deposits:0};
  let progress=0;
  const harness = new Function(
    'mc','inventorySlots','sessionStats','markProgress','renderMetrics','traceDecision',
    `const actionContracts=new Map();
     ${functionSource(html,'runActionContract')}
     ${functionSource(html,'bankDepositPlan')}
     ${functionSource(html,'sendBankDepositPlan')}
     ${functionSource(html,'runBankDepositContract')}
     ${functionSource(html,'depositItemsIfBankOpen')}
     return {depositItemsIfBankOpen,contracts:actionContracts};`
  )(mc,()=>4,sessionStats,()=>{progress+=1;},()=>{},()=>{});
  const frame=(now,counts)=>({now,inventory:{counts:new Map(counts)}});

  let result=harness.depositItemsIfBankOpen(frame(1000,[[87,1],[14,3],[10,100],[132,2]]),null);
  assert.equal(result.pending,true);
  const deposits=packets.filter(packet=>packet.id===23);
  assert.deepEqual(deposits.map(packet=>packet.values.slice(0,2)),[[14,3],[10,100],[132,2]]);
  assert.equal(deposits.some(packet=>packet.values[0]===87),false,'equipped gear must remain carried');
  assert.equal(sessionStats.deposits,0,'packet sends must not count as confirmed deposits');
  assert.equal(progress,0);
  result=harness.depositItemsIfBankOpen(frame(2000,[[87,1],[14,3],[10,100],[132,2]]),null);
  assert.equal(result.pending,true);
  assert.equal(packets.filter(packet=>packet.id===23).length,3,'unchanged inventory must wait without resending');
  result=harness.depositItemsIfBankOpen(frame(2100,[[87,1]]),null);
  assert.equal(result.reason,'deposited');
  assert.equal(result.stacks,3);
  assert.equal(result.amount,105);
  assert.equal(sessionStats.deposits,1);
  assert.equal(progress,1);
  assert.equal(harness.contracts.size,0);

  result=harness.depositItemsIfBankOpen(frame(5000,[[14,3],[10,100],[132,2]]),null);
  assert.equal(result.pending,true);
  assert.equal(harness.depositItemsIfBankOpen(frame(9001,[[14,3],[10,100],[132,2]]),null).pending,true);
  assert.equal(harness.depositItemsIfBankOpen(frame(13002,[[14,3],[10,100],[132,2]]),null).pending,true);
  result=harness.depositItemsIfBankOpen(frame(17003,[[14,3],[10,100],[132,2]]),null);
  assert.equal(result.failed,true);
  assert.equal(sessionStats.deposits,1,'failed deposits must not increment confirmed metrics');
  assert.equal(progress,1);
  assert.equal(harness.contracts.size,0);

  const advanceSource=functionSource(html,'advanceBankRoute');
  assert.match(advanceSource,/objective\.type==='banking'/);
  assert.match(advanceSource,/if\(result\.pending\)/);
  assert.match(advanceSource,/if\(result\.failed\)/);
  assert.match(advanceSource,/finishObjective\(result\.reason==='deposited'/);
  assert.match(html,/id:'bank-route'[\s\S]*objective\?\.type==='banking'/);
  assert.match(html,/savedJob\.type==='banking'/);
  assert.match(html,/GATHERED_BANK_IDS/);
  assert.match(html,/LOOT_BANK_IDS/);
});

test('combat loot stays tracked until its bank deposit is confirmed and reserves queued supplies', () => {
  const packets=[];
  let activePacket=null;
  const mc={
    showDialogBank:true,
    packetStream:{
      newPacket(id){activePacket={id,values:[]};packets.push(activePacket);},
      putShort(value){activePacket.values.push(value);},
      putInt(value){activePacket.values.push(value);},
      sendPacket(){}
    },
    inventoryItemId:[87,10,132,20],
    inventoryItemStackCount:[1,100,2,4],
    inventoryEquipped:[1,0,0,0]
  };
  const objective={collectedLootIds:new Set([87,10,132,20])};
  const sessionStats={actions:0,deposits:0};
  const harness=new Function(
    'mc','inventorySlots','sessionStats','markProgress','renderMetrics','traceDecision',
    'objective','COMBAT_PRESERVE_IDS','FOOD_HEALS','commandQueue','parse','BONE_IDS','AXE_IDS','PICKAXE_IDS',
    `const actionContracts=new Map();
     ${functionSource(html,'runActionContract')}
     ${functionSource(html,'bankDepositPlan')}
     ${functionSource(html,'sendBankDepositPlan')}
     ${functionSource(html,'runBankDepositContract')}
     ${functionSource(html,'queuedSupplyReservations')}
     ${functionSource(html,'depositCombatLootIfBankOpen')}
     return {depositCombatLootIfBankOpen,queuedSupplyReservations,contracts:actionContracts};`
  )(
    mc,()=>4,sessionStats,()=>{},()=>{},()=>{},objective,new Set([87]),{132:3},
    ['bury bones'],command=>command.includes('bones')?{type:'prayer'}:null,
    new Set([20]),new Set([87]),new Set([156])
  );
  const frame=(now,lootCount)=>({now,inventory:{counts:new Map([[87,1],[10,lootCount],[132,2],[20,4]])}});

  let result=harness.depositCombatLootIfBankOpen(frame(1000,100));
  assert.equal(result.pending,true);
  assert.deepEqual(packets.filter(packet=>packet.id===23).map(packet=>packet.values.slice(0,2)),[[10,100]]);
  assert.equal(objective.collectedLootIds.has(10),true,'sent packets must not clear tracked loot');
  assert.equal(sessionStats.deposits,0);
  result=harness.depositCombatLootIfBankOpen(frame(1500,0));
  assert.equal(result.reason,'deposited');
  assert.equal(objective.collectedLootIds.has(10),false);
  assert.equal(objective.collectedLootIds.has(87),true,'preserved equipment IDs remain tracked');
  assert.equal(objective.collectedLootIds.has(132),true,'food IDs remain tracked');
  assert.equal(objective.collectedLootIds.has(20),true,'bones reserved for the queued Prayer job remain tracked and carried');
  assert.equal(sessionStats.deposits,1);
  assert.equal(harness.contracts.size,0);

  const firemakingReservations=new Function(
    'COMBAT_PRESERVE_IDS','BONE_IDS','AXE_IDS','PICKAXE_IDS','parse','commandQueue',
    `${functionSource(html,'queuedSupplyReservations')}\nreturn queuedSupplyReservations;`
  )(
    new Set([87,156,166]),new Set([20]),new Set([87]),new Set([156]),
    command=>command.includes('firemake')?{type:'firemaking'}:null,['firemake logs']
  )();
  assert.deepEqual([...firemakingReservations].sort((a,b)=>a-b),[14,87,156,166]);

  const source=functionSource(html,'advanceCombatBanking');
  assert.match(source,/if\(deposit\.pending\)/);
  assert.match(source,/if\(deposit\.failed\)/);
  assert.match(source,/combatLootDeposited=true/);
});

test('prayer commands bury inventory bones and count only confirmed removals', () => {
  const packets=[];
  let activePacket=null;
  const mc={
    packetStream:{
      newPacket(id){activePacket={id,values:[]};packets.push(activePacket);},
      putShort(value){activePacket.values.push(value);},
      sendPacket(){}
    }
  };
  const sessionStats={actions:0,burials:0};
  const buryBone = new Function(
    'mc','sessionStats','renderMetrics',
    `${functionSource(html,'buryBone')}\nreturn buryBone;`
  )(mc,sessionStats,()=>{});
  assert.equal(buryBone(3),true);
  assert.deepEqual(packets,[{id:90,values:[3]}]);
  assert.equal(sessionStats.actions,1);

  const objective={type:'prayer',lastCount:3,countProgress:0,actionAttempts:2};
  const updatePrayerProgress = new Function(
    'objective','inventoryCountForIds','BONE_IDS','sessionStats','markProgress',
    'saveObjective','renderMetrics','inventorySnapshot',
    `${functionSource(html,'updatePrayerProgress')}\nreturn updatePrayerProgress;`
  )(
    objective,
    (_ids,snapshot)=>snapshot.counts.get(20)||0,
    new Set([20]),
    sessionStats,
    ()=>{},()=>{},()=>{},()=>({counts:new Map([[20,3]])})
  );
  assert.equal(updatePrayerProgress({counts:new Map([[20,2]])}),1);
  assert.equal(objective.countProgress,1);
  assert.equal(objective.lastCount,2);
  assert.equal(objective.actionAttempts,0);
  assert.equal(sessionStats.burials,1);

  const prayerSource=functionSource(html,'prayerTick');
  assert.match(prayerSource,/objectiveGoalReached\(\)/);
  assert.match(prayerSource,/no regular bones remain/);
  assert.match(prayerSource,/runActionContract\('prayer-bury'/);
  assert.match(prayerSource,/maxAttempts:5/);
  assert.match(html,/id:'prayer'[\s\S]*objective\?\.type==='prayer'/);
  assert.match(html,/savedJob\.type==='prayer'/);
});

test('task nodes prioritize valid work and action contracts require confirmation', () => {
  const trace=[];
  const selectTaskNode = new Function(
    'traceDecision',
    `let activeTaskNode='idle';${functionSource(html,'selectTaskNode')}\nreturn selectTaskNode;`
  )((...entry)=>trace.push(entry));
  const frame={now:100};
  const selected=selectTaskNode(frame,[
    {id:'low',priority:10,accept:()=>true},
    {id:'blocked',priority:100,accept:()=>false},
    {id:'high',label:'highest valid',priority:50,accept:()=>true}
  ]);
  assert.equal(selected.id,'high');
  assert.equal(trace.at(-1)[0],'high');
  assert.equal(trace.at(-1)[1],'selected');

  const contractTrace=[];
  const {runActionContract,actionContracts}=new Function(
    'traceDecision',
    `const actionContracts=new Map();${functionSource(html,'runActionContract')}\nreturn {runActionContract,actionContracts};`
  )((...entry)=>contractTrace.push(entry));
  let sends=0;
  const config={
    timeout:100,maxAttempts:2,interval:0,
    capture:current=>({count:current.count}),
    confirm:(current,state)=>current.count<state.before.count,
    execute:()=>{sends++;return true;}
  };
  assert.equal(runActionContract('confirmed',{now:100,count:3},config).status,'sent');
  assert.equal(runActionContract('confirmed',{now:150,count:3},config).status,'waiting');
  assert.equal(runActionContract('confirmed',{now:160,count:2},config).status,'confirmed');
  assert.equal(actionContracts.has('confirmed'),false);

  assert.equal(runActionContract('timeout',{now:300,count:3},config).status,'sent');
  assert.equal(runActionContract('timeout',{now:401,count:3},config).status,'sent');
  assert.equal(runActionContract('timeout',{now:502,count:3},config).status,'failed');
  assert.equal(sends,3);
  assert.ok(contractTrace.some(entry=>entry[1]==='confirmed'));
  assert.ok(contractTrace.some(entry=>entry[1]==='failed'));
});

test('death recovery preempts jobs, clears stale actions, and confirms respawn', () => {
  const characterDead=mc=>new Function(
    'mc',`${functionSource(html,'characterDead')}\nreturn characterDead;`
  )(mc);
  assert.equal(characterDead({playerStatCurrent:[1,1,1,5],deathScreenTimeout:0,world:{playerAlive:true}})(true,5,10),false);
  assert.equal(characterDead({playerStatCurrent:[1,1,1,0],deathScreenTimeout:0,world:{playerAlive:true}})(true,0,10),true);
  assert.equal(characterDead({playerStatCurrent:null,deathScreenTimeout:0,world:{playerAlive:true}})(true,0,10),false,'unknown login HP must not create a false death');
  assert.equal(characterDead({playerStatCurrent:[1,1,1,5],deathScreenTimeout:4,world:{playerAlive:true}})(true,5,10),true);
  assert.equal(characterDead({playerStatCurrent:[1,1,1,5],deathScreenTimeout:0,world:{playerAlive:false}})(true,5,10),true);

  const makeHarness=new Function(
    'initialObjective',
    `let objective=initialObjective,lastAction=99,status='',stopped='',saved=0;
     const calls={bank:'',travel:0,resource:0,progress:[]};
     const actionContracts=new Map([['combat-attack',{pending:true}]]);
     const deathRecovery={active:false,startedAt:0,stableTicks:0,origin:'',deathCount:0};
     const sessionStats={deaths:0,kills:3};
     const TREE_HUBS={yew:{}};
     function clearActionContracts(){actionContracts.clear();}
     function traceDecision(){}
     function renderMetrics(){}
     function setBotStatus(value){status=value;}
     function combatBankingEnabled(){return (objective?.bankMode||'safe')!=='never';}
     function beginCombatBanking(reason){calls.bank=reason;objective.phase='combat-bank';return true;}
     function beginCombatTravel(){calls.travel++;objective.phase='combat-travel';return true;}
     function desiredTreeType(){return objective?.resource||'normal';}
     function globalPlayerTile(){return {x:122,y:657};}
     function beginResourceTravel(){calls.resource++;objective.phase='resource-travel';return true;}
     function normalLogCount(inventory){return Number(inventory?.logs||0);}
     function prepareBankRoute(){objective.bankKey='lumbridge';return {key:'lumbridge'};}
     function markProgress(value){calls.progress.push(value);}
     function saveObjective(){saved++;}
     ${functionSource(html,'resetDeathRecovery')}
     function stop(message){stopped=message;resetDeathRecovery();}
     ${functionSource(html,'beginDeathRecovery')}
     ${functionSource(html,'resumeAfterDeath')}
     ${functionSource(html,'deathRecoveryTick')}
     return {
       tick:deathRecoveryTick,recovery:deathRecovery,contracts:actionContracts,stats:sessionStats,calls,
       get objective(){return objective;},setObjective(value){objective=value;resetDeathRecovery();stopped='';},
       get status(){return status;},get stopped(){return stopped;},get saved(){return saved;},get lastAction(){return lastAction;}
     };`
  );
  const harness=makeHarness({type:'mining',phase:'mine',resource:'iron',navRoute:[{x:1,y:1}],routeIndex:2});
  const dead=now=>({now,dead:true,inventory:{logs:0}}),alive=now=>({now,dead:false,inventory:{logs:0}});

  assert.equal(harness.tick(dead(1000)),'waiting');
  assert.equal(harness.recovery.active,true);
  assert.equal(harness.contracts.size,0);
  assert.equal(harness.stats.deaths,1);
  assert.equal(harness.lastAction,0);
  assert.deepEqual(harness.objective.navRoute,[]);
  assert.equal(harness.tick(dead(2000)),'waiting');
  assert.equal(harness.stats.deaths,1,'one death must be counted once across multiple dead ticks');
  assert.equal(harness.tick(alive(3000)),'stabilizing');
  assert.equal(harness.tick(alive(4000)),'resumed');
  assert.equal(harness.objective.phase,'mining-travel');
  assert.equal(harness.recovery.active,false);
  assert.equal(harness.calls.progress.at(-1),'respawn-recovered');
  assert.equal(harness.saved,1);

  harness.setObjective({type:'combat',phase:'fight',bankMode:'never'});
  assert.equal(harness.tick(dead(5000)),'stopped');
  assert.match(harness.stopped,/fought until defeated after 3 kills/);
  assert.equal(harness.stats.deaths,2);

  assert.match(functionSource(html,'buildDecisionFrame'),/dead:characterDead\(online,hits,max\)/);
  assert.match(html,/id:'death-recovery'[\s\S]*priority:990[\s\S]*frame\.dead\|\|deathRecovery\.active/);
  assert.match(functionSource(html,'stop'),/resetDeathRecovery\(\)/);
});

test('navigation actions confirm forward progress and escalate bounded timeouts', () => {
  const walkProgressConfirmed = new Function(
    'nodeDistance',
    `${functionSource(html,'walkProgressConfirmed')}\nreturn walkProgressConfirmed;`
  )((a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y));
  const state={before:{tile:{x:0,y:0},target:{x:10,y:0},distance:10}};

  assert.equal(walkProgressConfirmed({tile:{x:0,y:1}},state),false,'sideways shuffling is not progress');
  assert.equal(walkProgressConfirmed({tile:{x:2,y:0}},state),true,'moving closer confirms the action');
  assert.equal(walkProgressConfirmed({tile:{x:9,y:0}},state,1),true,'arrival confirms the action');

  const shortStepSource=functionSource(html,'shortStepToward');
  assert.match(shortStepSource,/runActionContract\('navigation-walk'/);
  assert.match(shortStepSource,/timeout:4000/);
  assert.match(shortStepSource,/maxAttempts:4/);
  assert.match(shortStepSource,/walkProgressConfirmed\(next,state,arrivalDistance\)/);
  assert.match(shortStepSource,/navWatch\.retries=Math\.max/);
  assert.match(shortStepSource,/navigationGoalChanged\(pendingWalk,target\)/);
  assert.match(shortStepSource,/goal:\{x:Number\(target\.x\),y:Number\(target\.y\)\}/);

  const traces=[],walks=[];
  const navigationHarness=new Function(
    'traceDecision',
    `const actionContracts=new Map();
     let currentDecisionFrame={now:1000,tile:{x:0,y:0}},lastAction=0;
     const objective={},navWatch={retries:0};const MAX_NAV_RETRIES=12;
     function globalPlayerTile(){return {...currentDecisionFrame.tile};}
     function navRetryTarget(target){return target;}
     function nodeDistance(a,b){return Math.abs(a.x-b.x)+Math.abs(a.y-b.y);}
     function walkGlobal(x,y){walks.push({x,y});return true;}
     const walks=[];
     ${functionSource(html,'cancelActionContract')}
     ${functionSource(html,'runActionContract')}
     ${functionSource(html,'walkProgressConfirmed')}
     ${functionSource(html,'navigationGoalChanged')}
     ${functionSource(html,'shortStepToward')}
     ${functionSource(html,'runNavigationStep')}
     return {shortStepToward,runNavigationStep,contracts:actionContracts,walks,setFrame:value=>{currentDecisionFrame=value;}};`
  )((...entry)=>traces.push(entry));
  navigationHarness.shortStepToward({x:30,y:0});
  assert.deepEqual(navigationHarness.contracts.get('navigation-walk').before.goal,{x:30,y:0});
  navigationHarness.setFrame({now:1500,tile:{x:0,y:0}});
  navigationHarness.shortStepToward({x:0,y:30});
  assert.deepEqual(navigationHarness.contracts.get('navigation-walk').before.goal,{x:0,y:30});
  assert.deepEqual(navigationHarness.walks,[{x:14,y:0},{x:0,y:14}]);
  assert.ok(traces.some(entry=>entry[0]==='navigation-walk'&&entry[1]==='cancelled'&&entry[2]==='destination changed'));

  navigationHarness.setFrame({now:3000,tile:{x:0,y:0}});
  let movement=navigationHarness.runNavigationStep({x:30,y:0});
  assert.equal(movement.sent,true,'a fresh navigation packet must be reported as sent');
  assert.equal(navigationHarness.walks.length,3);
  navigationHarness.setFrame({now:3500,tile:{x:0,y:0}});
  movement=navigationHarness.runNavigationStep({x:30,y:0});
  assert.equal(movement.sent,false,'polling a pending action must not invent another send');
  assert.equal(movement.pending,true);
  assert.equal(navigationHarness.walks.length,3);
  navigationHarness.setFrame({now:3600,tile:{x:2,y:0}});
  movement=navigationHarness.runNavigationStep({x:30,y:0});
  assert.equal(movement.sent,false,'confirmation must not be counted as a send');
  assert.equal(movement.pending,false);
  assert.equal(navigationHarness.walks.length,3);
  assert.ok(traces.some(entry=>entry[0]==='navigation-walk'&&entry[1]==='confirmed'));

  for(const name of [
    'advanceBankRoute','advanceResourceTravel','advanceReturnRoute',
    'advanceCombatTravel','advanceCombatBanking','advanceCombatReturn',
    'miningTick','firemakingGatherTick'
  ]){
    const source=functionSource(html,name);
    assert.match(source,/runNavigationStep\(/,`${name} must poll confirmed navigation actions every tick`);
    assert.doesNotMatch(source,/Date\.now\(\)-lastAction>ACTION_INTERVALS\.walk/,`${name} must not hide navigation confirmation behind an outer cooldown`);
    assert.match(source,/decisionTile\(\)/,`${name} must reuse the tick's position snapshot`);
  }
  assert.match(functionSource(html,'woodcuttingTick'),/advanceResourceTravel\(frame\)/);
  assert.match(functionSource(html,'woodcuttingTick'),/advanceReturnRoute\(frame\)/);
  assert.match(functionSource(html,'combatTick'),/advanceCombatTravel\(frame\)/);
  assert.match(functionSource(html,'combatTick'),/advanceCombatReturn\(frame\)/);
});

test('routed controllers poll navigation every tick without fake send accounting', () => {
  for(const name of [
    'advanceBankRoute','advanceResourceTravel','advanceReturnRoute',
    'advanceCombatTravel','advanceCombatBanking','advanceCombatReturn',
    'miningTick','firemakingGatherTick'
  ]){
    const source=functionSource(html,name);
    assert.match(source,/runNavigationStep\(/,`${name} must use the shared navigation result`);
    assert.doesNotMatch(source,/Date\.now\(\)-lastAction>ACTION_INTERVALS\.walk/,`${name} must not gate confirmation polling behind a wall-clock cooldown`);
  }
  const helper=functionSource(html,'runNavigationStep');
  assert.match(helper,/current!==previous/);
  assert.match(helper,/current\.attempts/);
  assert.match(helper,/current\.sentAt/);
  assert.match(functionSource(html,'rebuildRouteIfStalled'),/lastAction=Number\(decisionNow\)/);
});

test('gathering actions require inventory gains and quarantine failed resources', () => {
  const traces=[];
  const {runActionContract}=new Function(
    'traceDecision',
    `const actionContracts=new Map();${functionSource(html,'runActionContract')}\nreturn {runActionContract};`
  )((...entry)=>traces.push(entry));
  const inventoryCountForIds=(ids,snapshot)=>{
    let total=0;
    for(const id of ids)total+=Number(snapshot.counts.get(id)||0);
    return total;
  };
  const gather=new Function(
    'inventoryCountForIds','runActionContract','ACTION_INTERVALS',
    `let lastAction=0;${functionSource(html,'runGatherContract')}\nreturn {runGatherContract,last:()=>lastAction};`
  )(inventoryCountForIds,runActionContract,{gather:2800});
  const ids=new Set([150]),target={id:100,x:5,y:6};
  let sends=0;
  const frame=(now,count)=>({now,loggedIn:true,inventoryMax:30,inventory:{used:1,counts:new Map([[150,count]])}});

  assert.equal(gather.runGatherContract('mining',frame(3000,0),target,ids,'ore',()=>{sends++;return true;}).status,'sent');
  assert.equal(gather.runGatherContract('mining',frame(6000,0),target,ids,'ore',()=>{sends++;return true;}).status,'waiting');
  assert.equal(gather.runGatherContract('mining',frame(7000,1),target,ids,'ore',()=>{sends++;return true;}).status,'confirmed');
  assert.equal(sends,1,'confirmed gathering must not resend the resource action');

  assert.equal(gather.runGatherContract('woodcutting',frame(10000,0),target,ids,'log',()=>{sends++;return true;}).status,'sent');
  assert.equal(gather.runGatherContract('woodcutting',frame(19001,0),target,ids,'log',()=>{sends++;return true;}).status,'sent');
  assert.equal(gather.runGatherContract('woodcutting',frame(28002,0),target,ids,'log',()=>{sends++;return true;}).status,'sent');
  assert.equal(gather.runGatherContract('woodcutting',frame(37003,0),target,ids,'log',()=>{sends++;return true;}).status,'sent');
  assert.equal(gather.runGatherContract('woodcutting',frame(46004,0),target,ids,'log',()=>{sends++;return true;}).status,'failed');
  assert.equal(sends,5,'a failed resource must stop after four bounded sends');

  const blockHelpers=new Function(
    `${functionSource(html,'gatherTargetKey')}
     ${functionSource(html,'gatherTargetBlocked')}
     ${functionSource(html,'blockGatherTarget')}
     const blockedGatherTargets=new Map();
     return {gatherTargetBlocked,blockGatherTarget};`
  )();
  blockHelpers.blockGatherTarget('mining',target,100,30000);
  assert.equal(blockHelpers.gatherTargetBlocked('mining',target,200),true);
  assert.equal(blockHelpers.gatherTargetBlocked('mining',target,30100),false);

  for(const name of ['miningTick','woodcuttingTick','firemakingGatherTick']){
    const source=functionSource(html,name);
    assert.match(source,/runGatherContract\(/,`${name} must use a confirmed gather action`);
    assert.match(source,/blockGatherTarget\(/,`${name} must quarantine a repeatedly failing resource`);
    assert.match(source,/cancelActionContract\(/,`${name} must cancel stale gathering actions`);
  }
  assert.match(functionSource(html,'firemakingGatherTick'),/bestTree\('firemaking',frame\.world\)/);
  for(const name of ['mineRock','chop'])assert.doesNotMatch(functionSource(html,name),/markProgress\(/);
  assert.ok(traces.some(entry=>entry[1]==='confirmed'));
});

test('firemaking drop and light actions require observable outcomes', () => {
  const traces=[];
  let groundLog=false,fireVisible=false,dropSends=0,lightSends=0;
  const normalLogCount=snapshot=>Number(snapshot.counts.get(14)||0);
  const harness=new Function(
    'traceDecision','normalLogCount','groundNormalLogNear','fireAt','dropNormalLog','lightGroundLog',
    `const actionContracts=new Map();let lastAction=0;
     const ACTION_INTERVALS={gather:2800};
     ${functionSource(html,'runActionContract')}
     ${functionSource(html,'runFiremakingDropContract')}
     ${functionSource(html,'runFiremakingLightContract')}
     return {runFiremakingDropContract,runFiremakingLightContract};`
  )(
    (...entry)=>traces.push(entry),normalLogCount,()=>groundLog,()=>fireVisible,
    ()=>{dropSends+=1;return true;},()=>{lightSends+=1;return true;}
  );
  const tile={x:122,y:657};
  const frame=(now,logs,xp)=>({now,firemakingXp:xp,inventory:{counts:new Map([[14,logs]])}});

  assert.equal(harness.runFiremakingDropContract(frame(3000,1,100),tile).status,'sent');
  assert.equal(harness.runFiremakingDropContract(frame(3200,0,100),tile).status,'waiting','inventory loss alone must not confirm a ground drop');
  groundLog=true;
  assert.equal(harness.runFiremakingDropContract(frame(3300,0,100),tile).status,'confirmed');
  assert.equal(dropSends,1);

  const log={gx:122,gy:657};
  assert.equal(harness.runFiremakingLightContract(frame(5000,0,100),log).status,'sent');
  groundLog=false;
  assert.equal(harness.runFiremakingLightContract(frame(5200,0,100),null).status,'waiting','a vanished log must not count as a fire');
  assert.equal(harness.runFiremakingLightContract(frame(5300,0,110),null).status,'confirmed','Firemaking XP confirms success');
  assert.equal(lightSends,1);

  assert.ok(traces.some(entry=>entry[1]==='confirmed'));
  const tickSource=functionSource(html,'firemakingTick');
  assert.match(tickSource,/runFiremakingDropContract\(frame,tile\)/);
  assert.match(tickSource,/runFiremakingLightContract\(frame,log\)/);
  assert.match(tickSource,/const p=frame\.tile/);
  assert.match(tickSource,/runNavigationStep\(objective\.moveTarget,2,0,frame\)/);
  assert.doesNotMatch(tickSource,/\|\|\(!log/,'log disappearance must not count as a lit fire');
  assert.doesNotMatch(tickSource,/walkGlobal\(objective\.moveTarget/);
  assert.match(functionSource(html,'buildDecisionFrame'),/firemakingXp:/);
});

test('combat attacks and loot require observable game-state confirmation', () => {
  const traces=[];
  const attackHarness=new Function(
    'traceDecision','ACTION_INTERVALS','attackNpc',
    `const actionContracts=new Map();let lastAction=0;
     ${functionSource(html,'runActionContract')}
     ${functionSource(html,'confirmAttackStarted')}
     ${functionSource(html,'runAttackContract')}
     return {runAttackContract,confirmAttackStarted,contracts:actionContracts};`
  )((...entry)=>traces.push(entry),{combat:2200},()=>true);
  const target={name:'chicken',npc:{serverIndex:7}};
  assert.equal(attackHarness.runAttackContract({now:3000,fighting:false},target).status,'sent');
  assert.equal(attackHarness.confirmAttackStarted({now:3500,fighting:true}),true);
  assert.equal(attackHarness.contracts.has('combat-attack'),false);

  const objective={collectedLootIds:new Set(),lootUntil:0};
  const sessionStats={loot:0};
  let lootSends=0;
  const lootHarness=new Function(
    'traceDecision','ACTION_INTERVALS','takeGroundLoot','objective','sessionStats',
    'markProgress','renderMetrics','blockTimedTarget','blockedLootTargets','cancelActionContract',
    `const actionContracts=new Map();let lastAction=0;
     ${functionSource(html,'runActionContract')}
     ${functionSource(html,'recordConfirmedLoot')}
     ${functionSource(html,'runLootContract')}
     return {runLootContract};`
  )(
    (...entry)=>traces.push(entry),{loot:1400},()=>{lootSends++;return true;},objective,sessionStats,
    ()=>{},()=>{},()=>{},new Map(),()=>false
  );
  const item={id:10,x:2,y:3,name:'coins'};
  const lootFrame=(now,count)=>({now,inventoryMax:30,inventory:{used:1,counts:new Map([[10,count]])}});
  assert.equal(lootHarness.runLootContract(lootFrame(2000,0),item).status,'sent');
  assert.equal(sessionStats.loot,0,'a pickup packet alone must not count as loot');
  assert.equal(lootHarness.runLootContract(lootFrame(2500,1),item).status,'confirmed');
  assert.equal(sessionStats.loot,1);
  assert.equal(objective.collectedLootIds.has(10),true);
  assert.equal(lootSends,1);

  assert.doesNotMatch(functionSource(html,'attackNpc'),/markProgress\(/);
  assert.doesNotMatch(functionSource(html,'takeGroundLoot'),/sessionStats\.loot|markProgress\(/);
  assert.match(functionSource(html,'combatTick'),/confirmAttackStarted\(frame\)/);
  assert.match(functionSource(html,'combatTick'),/runAttackContract\(frame,target\)/);
  assert.match(functionSource(html,'combatTick'),/runLootContract\(frame,item\)/);
});

test('combat food use requires confirmed inventory consumption', () => {
  const packets=[];
  let active=null;
  const rawStats={actions:0,eats:0};
  const consumeFood=new Function(
    'mc','sessionStats','renderMetrics',
    `${functionSource(html,'consumeFood')}\nreturn consumeFood;`
  )(
    {packetStream:{newPacket(id){active={id,values:[]};packets.push(active);},putShort(value){active.values.push(value);},sendPacket(){}}},
    rawStats,()=>{}
  );
  assert.equal(consumeFood({slot:3,id:132,heal:3}),true);
  assert.deepEqual(packets,[{id:90,values:[3]}]);
  assert.equal(rawStats.actions,1);
  assert.equal(rawStats.eats,0,'sending the inventory command must not count as eating');

  const traces=[],sessionStats={eats:0};
  let sends=0,stopped='';
  const harness=new Function(
    'traceDecision','chooseFoodForMissingHits','inventoryFoodCount','consumeFood','sessionStats',
    'markProgress','renderMetrics','setBotStatus','stop',
    `const actionContracts=new Map();let lastAction=0;
     ${functionSource(html,'cancelActionContract')}
     ${functionSource(html,'runActionContract')}
     ${functionSource(html,'eatFoodIfNeeded')}
     return {eatFoodIfNeeded,contracts:actionContracts};`
  )(
    (...entry)=>traces.push(entry),snapshot=>snapshot.foods[0]||null,snapshot=>snapshot.foods.length,
    ()=>{sends+=1;return true;},sessionStats,()=>{},()=>{},()=>{},message=>{stopped=message;}
  );
  const food={slot:0,id:132,heal:3};
  const frame=(now,count,hits=2)=>({now,hits,maxHits:10,inventory:{foods:count?[food]:[]}});

  assert.equal(harness.eatFoodIfNeeded(frame(1000,1)),true);
  assert.equal(sessionStats.eats,0);
  assert.equal(harness.eatFoodIfNeeded(frame(1200,1)),true);
  assert.equal(sessionStats.eats,0,'an unchanged inventory must remain unconfirmed');
  assert.equal(harness.eatFoodIfNeeded(frame(1300,0)),true);
  assert.equal(sessionStats.eats,1);
  assert.equal(sends,1);

  assert.equal(harness.eatFoodIfNeeded(frame(5000,1)),true);
  assert.equal(harness.eatFoodIfNeeded(frame(8501,1)),true);
  assert.equal(harness.eatFoodIfNeeded(frame(12002,1)),true);
  assert.equal(harness.eatFoodIfNeeded(frame(15503,1)),true);
  assert.match(stopped,/three food-use attempts/);
  assert.equal(sessionStats.eats,1,'failed attempts must not increment confirmed food totals');
  assert.equal(harness.contracts.size,0);
  assert.ok(traces.some(entry=>entry[1]==='confirmed'));
  assert.ok(traces.some(entry=>entry[1]==='failed'));

  assert.doesNotMatch(functionSource(html,'consumeFood'),/sessionStats\.eats|markProgress/);
  assert.match(functionSource(html,'combatTick'),/eatFoodIfNeeded\(frame\)/);
});

test('combat bank restock waits for confirmed food withdrawal', () => {
  const traces=[];
  let sends=0,progress=0;
  const harness=new Function(
    'traceDecision','mc','inventoryFoodCount','chooseBankFood','withdrawBankItem','markProgress','renderMetrics',
    `const actionContracts=new Map();
     ${functionSource(html,'runActionContract')}
     ${functionSource(html,'restockCombatFood')}
     return {restockCombatFood,contracts:actionContracts};`
  )(
    (...entry)=>traces.push(entry),{showDialogBank:true},snapshot=>snapshot.foods.length,
    ()=>({id:132,amount:20,heal:3}),()=>{sends+=1;return true;},()=>{progress+=1;},()=>{}
  );
  const food={slot:0,id:132,heal:3};
  const frame=(now,count)=>({
    now,
    inventoryMax:30,
    inventory:{used:5+count,foods:Array.from({length:count},()=>food)}
  });

  let result=harness.restockCombatFood(frame(1000,0),10);
  assert.equal(result.pending,true);
  assert.equal(sends,1);
  assert.equal(progress,0,'withdraw packet must not mark progress');
  result=harness.restockCombatFood(frame(2000,0),10);
  assert.equal(result.pending,true);
  assert.equal(sends,1);
  result=harness.restockCombatFood(frame(2100,10),10);
  assert.equal(result.ok,true);
  assert.equal(result.reason,'withdrew');
  assert.equal(result.amount,10);
  assert.equal(progress,1);
  assert.equal(harness.contracts.size,0,'reaching the target must still confirm and clear the action');

  assert.equal(harness.restockCombatFood(frame(5000,0),10).pending,true);
  assert.equal(harness.restockCombatFood(frame(9001,0),10).pending,true);
  assert.equal(harness.restockCombatFood(frame(13002,0),10).pending,true);
  result=harness.restockCombatFood(frame(17003,0),10);
  assert.equal(result.failed,true);
  assert.equal(harness.contracts.size,0);
  assert.equal(progress,1,'failed withdrawals must not mark progress');
  assert.ok(traces.some(entry=>entry[1]==='failed'));

  assert.doesNotMatch(functionSource(html,'withdrawBankItem'),/markProgress/);
  assert.match(functionSource(html,'advanceCombatBanking'),/restockCombatFood\(frame,10\)/);
  assert.match(functionSource(html,'advanceCombatBanking'),/if\(result\.pending\)/);
});

test('navigation graph uses shortest travel distance for bank routes', () => {
  const dataSource = section(html, '    const NAV_NODES={', '    function prepareBankRoute(){');
  const { NAV_NODES, NAV_EDGES, BANKS, graphPath, graphPathDistance, nearestBank } = new Function(
    'globalPlayerTile',
    `${dataSource}\nreturn { NAV_NODES, NAV_EDGES, BANKS, graphPath, graphPathDistance, nearestBank };`
  )(() => ({ x: 122, y: 657 }));

  for (const [name, edges] of Object.entries(NAV_EDGES)) {
    assert.ok(NAV_NODES[name], `edge source ${name} has no node`);
    for (const destination of edges) {
      assert.ok(NAV_NODES[destination], `${name} points to missing ${destination}`);
    }
  }
  for (const [key, bank] of Object.entries(BANKS)) {
    assert.ok(NAV_NODES[bank.node], `bank ${key} points to missing ${bank.node}`);
    assert.ok(Number.isFinite(bank.x) && Number.isFinite(bank.y));
  }

  assert.equal(nearestBank({ x: 122, y: 657 }).key, 'lumbridge');
  for (const [key, bank] of Object.entries(BANKS)) {
    assert.equal(nearestBank({ x: bank.x, y: bank.y }).key, key);
  }

  const reached = new Set(['lumbridge']);
  const queue = ['lumbridge'];
  while (queue.length) {
    const current = queue.shift();
    for (const next of NAV_EDGES[current] || []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  assert.deepEqual([...Object.keys(NAV_NODES).filter(name => !reached.has(name))], []);

  // Independently calculate minimum graph costs and require the production
  // pathfinder to match for every pair, guarding against hop-count routing.
  const shortestCost = (start, end) => {
    const pending = new Set(Object.keys(NAV_NODES));
    const costs = new Map([[start, 0]]);
    while (pending.size) {
      const current = [...pending].reduce((best, name) =>
        (costs.get(name) ?? Infinity) < (costs.get(best) ?? Infinity) ? name : best
      );
      const cost = costs.get(current) ?? Infinity;
      if (current === end || cost === Infinity) return cost;
      pending.delete(current);
      for (const next of NAV_EDGES[current] || []) {
        if (!pending.has(next)) continue;
        const edge = Math.abs(NAV_NODES[current].x - NAV_NODES[next].x)
          + Math.abs(NAV_NODES[current].y - NAV_NODES[next].y);
        costs.set(next, Math.min(costs.get(next) ?? Infinity, cost + edge));
      }
    }
    return Infinity;
  };
  for (const start of Object.keys(NAV_NODES)) {
    for (const end of Object.keys(NAV_NODES)) {
      const route = graphPath(start, end);
      assert.equal(route[0], start);
      assert.equal(route.at(-1), end);
      assert.equal(graphPathDistance(route), shortestCost(start, end), `${start} -> ${end}`);
    }
  }
});

test('navigation recovery measures forward progress instead of any movement', () => {
  const recoverySource = section(
    html,
    '    let navWatch={x:null,y:null,lastMove:0,stalls:0,retries:0};',
    '    function nearestLoadedBanker(bank,world=null){'
  );
  let point = { x: 0, y: 0 };
  let now = 1_000;
  const { navRetryTarget, watch } = new Function(
    'globalPlayerTile', 'decisionTile', 'nodeDistance', 'Date',
    `${recoverySource}\nreturn {navRetryTarget,watch:()=>({...navWatch})};`
  )(
    () => point,
    () => point,
    (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
    { now: () => now }
  );
  const target = { x: 10, y: 0 };

  assert.deepEqual(navRetryTarget(target), target);
  point = { x: 0, y: 1 }; // moved, but no closer
  now += 3_600;
  assert.notDeepEqual(navRetryTarget(target), target);
  assert.equal(watch().retries, 1);

  point = { x: 2, y: 0 }; // genuine forward progress
  now += 100;
  assert.deepEqual(navRetryTarget(target), target);
  assert.equal(watch().retries, 0);
  assert.equal(watch().bestDistance, 8);

  const nextTarget = { x: 20, y: 0 };
  now += 100;
  assert.deepEqual(navRetryTarget(nextTarget), nextTarget);
  assert.equal(watch().targetKey, '20:0');
  assert.equal(watch().retries, 0);

  const shortStepSource = functionSource(html, 'shortStepToward');
  assert.match(shortStepSource, /navRetryTarget\(target,pp,/);
  assert.doesNotMatch(shortStepSource, /navRetryTarget\(\{x:tx,y:ty\}\)/);
});

test('all routed travel modes rebuild stalled routes from the current position', () => {
  const recoverySource = section(
    html,
    '    let navWatch={x:null,y:null,lastMove:0,stalls:0,retries:0};',
    '    function nearestLoadedBanker(bank,world=null){'
  );
  const objective = { navRoute: [{ name: 'stale' }], routeIndex: 4 };
  let makeRouteCalls = 0;
  const { rebuildRouteIfStalled, setRetries } = new Function(
    'globalPlayerTile', 'nodeDistance', 'Date', 'objective', 'makeRouteTo',
    `${recoverySource}\nreturn {
      rebuildRouteIfStalled,
      setRetries:value=>{navWatch.retries=value;}
    };`
  )(
    () => ({ x: 0, y: 0 }),
    (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
    { now: () => 10_000 },
    objective,
    target => { makeRouteCalls += 1; return [{ name: `current-to-${target}` }]; }
  );

  setRetries(11);
  assert.equal(rebuildRouteIfStalled('lumbridge'), false);
  assert.equal(makeRouteCalls, 0);
  setRetries(12);
  assert.equal(rebuildRouteIfStalled('lumbridge'), true);
  assert.deepEqual(objective.navRoute, [{ name: 'current-to-lumbridge' }]);
  assert.equal(objective.routeIndex, 0);
  assert.equal(objective.routeRebuilds, 1);

  const routedFunctions = [
    'advanceBankRoute', 'advanceResourceTravel', 'advanceReturnRoute',
    'advanceCombatTravel', 'advanceCombatBanking', 'advanceCombatReturn',
    'miningTick', 'firemakingGatherTick'
  ];
  for (const name of routedFunctions) {
    assert.match(
      functionSource(html, name),
      /rebuildRouteIfStalled\(/,
      `${name} must rebuild after progress-aware recovery is exhausted`
    );
  }
});

test('regional searches skip unreachable tiles and keep recovery directions moving', () => {
  const recoverySource = section(
    html,
    '    let navWatch={x:null,y:null,lastMove:0,stalls:0,retries:0};',
    '    function nearestLoadedBanker(bank,world=null){'
  );
  const objective = { searchIndex: 2 };
  const { advanceRegionalSearchIfStalled, navRetryTarget, setWatch, watch } = new Function(
    'globalPlayerTile', 'decisionTile', 'nodeDistance', 'Date', 'objective', 'makeRouteTo',
    `${recoverySource}\nreturn {
      advanceRegionalSearchIfStalled,
      navRetryTarget,
      setWatch:value=>{navWatch={...navWatch,...value};},
      watch:()=>({...navWatch})
    };`
  )(
    () => ({ x: 0, y: 0 }),
    () => ({ x: 0, y: 0 }),
    (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
    { now: () => 50_000 },
    objective,
    () => []
  );

  setWatch({ retries: 11 });
  assert.equal(advanceRegionalSearchIfStalled(4), false);
  assert.equal(objective.searchIndex, 2);
  setWatch({ retries: 12 });
  assert.equal(advanceRegionalSearchIfStalled(4), true);
  assert.equal(objective.searchIndex, 3);
  assert.equal(objective.searchRecoveries, 1);
  assert.equal(watch().retries, 0);

  // A ninth stalled retry cycles to the first offset instead of remaining
  // pinned to the eighth and repeatedly clicking the same blocked direction.
  setWatch({
    targetKey: '10:0', bestDistance: 10, lastMove: 46_000,
    stalls: 8, retries: 8
  });
  assert.deepEqual(navRetryTarget({ x: 10, y: 0 }), { x: 12, y: 0 });

  for (const name of [
    'advanceResourceTravel', 'advanceCombatTravel', 'miningTick',
    'firemakingGatherTick'
  ]) {
    assert.match(
      functionSource(html, name),
      /advanceRegionalSearchIfStalled\(/,
      `${name} must skip a regional target after exhausting recovery`
    );
  }
});

test('banker targeting stays scoped to the selected bank', () => {
  const bankerSource = functionSource(html, 'nearestLoadedBanker');
  const nearestLoadedBanker = new Function(
    'mc', 'BANKER_IDS', 'globalPlayerTile', 'decisionTile', 'nodeDistance', 'timedTargetBlocked', 'blockedBankers',
    `${functionSource(html, 'readLoadedNpcs')}\n${bankerSource}\nreturn nearestLoadedBanker;`
  )(
    {
      npcCount: 2,
      magicLoc: 128,
      regionX: 0,
      regionY: 0,
      npcs: [
        { npcId: 95, currentX: 124 * 128 + 64, currentY: 657 * 128 + 64, serverIndex: 1 },
        { npcId: 95, currentX: 220 * 128 + 64, currentY: 635 * 128 + 64, serverIndex: 2 }
      ]
    },
    new Set([95]),
    () => ({ x: 124, y: 657 }),
    () => ({ x: 124, y: 657 }),
    (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
    () => false,
    new Map()
  );

  assert.equal(nearestLoadedBanker({ x: 220, y: 635 }).npc.serverIndex, 2);
  assert.equal(nearestLoadedBanker({ x: 400, y: 400 }), null);
  for (const name of ['advanceBankRoute', 'advanceCombatBanking']) {
    const source = functionSource(html, name);
    assert.match(source, /nearestLoadedBanker\(bank,frame\.world\)/, `${name} must target the selected bank through the shared world snapshot`);
    assert.match(source, /bankDialogueOptionExpected\(/, `${name} must reject unrelated dialogue menus`);
  }
});

test('bank arrival rotates blocked approaches and engages scoped bankers nearby', () => {
  const recoverySource = section(
    html,
    '    let navWatch={x:null,y:null,lastMove:0,stalls:0,retries:0};',
    '    function nearestLoadedBanker(bank,world=null){'
  );
  const objective = { bankApproachIndex: 0 };
  const { bankArrivalTarget, advanceBankArrivalIfStalled, setRetries, watch } = new Function(
    'globalPlayerTile', 'nodeDistance', 'Date', 'objective', 'makeRouteTo',
    `${recoverySource}\nreturn {
      bankArrivalTarget,
      advanceBankArrivalIfStalled,
      setRetries:value=>{navWatch.retries=value;},
      watch:()=>({...navWatch})
    };`
  )(
    () => ({ x: 0, y: 0 }),
    (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
    { now: () => 80_000 },
    objective,
    () => []
  );
  const bank = { x: 124, y: 657 };

  assert.deepEqual(bankArrivalTarget(bank), bank);
  setRetries(11);
  assert.equal(advanceBankArrivalIfStalled(), false);
  setRetries(12);
  assert.equal(advanceBankArrivalIfStalled(), true);
  assert.deepEqual(bankArrivalTarget(bank), { x: 129, y: 657 });
  assert.equal(objective.bankArrivalRecoveries, 1);
  assert.equal(watch().retries, 0);

  assert.match(html, /const BANKER_TALK_DISTANCE=20/);
  for (const name of ['advanceBankRoute', 'advanceCombatBanking']) {
    const source = functionSource(html, name);
    assert.match(source, /banker\.d<=BANKER_TALK_DISTANCE/, `${name} must use native banker action walking nearby`);
    assert.match(source, /advanceBankArrivalIfStalled\(\)/, `${name} must rotate blocked final approaches`);
    assert.match(source, /bankArrivalTarget\(bank\)/, `${name} must use the selected bank approach`);
  }
});

test('bank dialogue choices require a recent bot-initiated banker conversation', () => {
  const expectedSource = functionSource(html, 'bankDialogueOptionExpected');
  const makeExpected = objective => new Function(
    'objective', `${expectedSource}\nreturn bankDialogueOptionExpected;`
  )(objective);
  const now = 50_000;

  assert.equal(makeExpected({ phase: 'bank-dialogue', bankTalkSentAt: now - 1_000 })(false, now), true);
  assert.equal(makeExpected({ phase: 'combat-bank-dialogue', bankTalkSentAt: now - 1_000 })(true, now), true);
  assert.equal(makeExpected({ phase: 'bank', bankTalkSentAt: now - 1_000 })(false, now), false);
  assert.equal(makeExpected({ phase: 'bank-dialogue', bankTalkSentAt: now - 16_000 })(false, now), false);
  assert.equal(makeExpected({ phase: 'bank-dialogue', bankTalkSentAt: 0 })(false, now), false);

});

test('bank actions require dialogue and interface confirmation with bounded recovery', () => {
  const traces=[];
  const objective={phase:'bank',bankApproachIndex:0,bankArrivalRecoveries:0};
  const mc={showOptionMenu:false,showDialogBank:false};
  let talkSends=0,optionSends=0;
  const harness=new Function(
    'traceDecision','objective','mc','sendTalkToBanker','chooseFirstDialogueOption',
    `const actionContracts=new Map(),blockedBankers=new Map();let lastAction=0;
     const ACTION_INTERVALS={walk:1200},BANKER_TALK_DISTANCE=20;
     const BANK_APPROACH_OFFSETS=[[0,0],[5,0],[0,5],[-5,0],[0,-5]];
     let navWatch={x:null,y:null,lastMove:0,stalls:0,retries:0};
     function blockTimedTarget(map,key,now,duration){if(key!==undefined)map.set(String(key),Number(now)+Number(duration));}
     ${functionSource(html,'cancelActionContract')}
     ${functionSource(html,'runActionContract')}
     ${functionSource(html,'bankDialogueOptionExpected')}
     ${functionSource(html,'bankContractKey')}
     ${functionSource(html,'resetBankInteraction')}
     ${functionSource(html,'runBankTalkContract')}
     ${functionSource(html,'runBankOpenContract')}
     return {runBankTalkContract,runBankOpenContract,contracts:actionContracts};`
  )(
    (...entry)=>traces.push(entry),objective,mc,
    ()=>{talkSends+=1;return true;},
    ()=>{if(!mc.showOptionMenu)return false;optionSends+=1;mc.showOptionMenu=false;return true;}
  );
  const banker={d:2,npc:{serverIndex:95}};

  assert.equal(harness.runBankTalkContract({now:2000},banker,false).status,'sent');
  assert.equal(objective.phase,'bank-dialogue');
  assert.equal(talkSends,1);
  mc.showOptionMenu=true;
  assert.equal(harness.runBankTalkContract({now:2200},banker,false).status,'confirmed');
  assert.equal(harness.runBankOpenContract({now:2200},false).status,'sent');
  assert.equal(objective.phase,'bank-open');
  assert.equal(optionSends,1);
  mc.showDialogBank=true;
  assert.equal(harness.runBankOpenContract({now:2300},false).status,'confirmed');

  mc.showDialogBank=false;
  objective.phase='bank';
  assert.equal(harness.runBankTalkContract({now:4000},banker,false).status,'sent');
  assert.equal(harness.runBankTalkContract({now:13001},banker,false).status,'sent');
  assert.equal(harness.runBankTalkContract({now:22002},banker,false).status,'sent');
  assert.equal(harness.runBankTalkContract({now:31003},banker,false).status,'failed');
  assert.equal(objective.phase,'bank');
  assert.equal(objective.bankTalkTimeouts,1);
  assert.equal(objective.bankApproachIndex,1,'a silent banker must rotate the final approach');
  assert.equal(harness.contracts.size,0);
  assert.ok(traces.some(entry=>entry[1]==='confirmed'));
  assert.ok(traces.some(entry=>entry[1]==='failed'));

  for(const name of ['advanceBankRoute','advanceCombatBanking']){
    const source=functionSource(html,name);
    assert.match(source,/runBankTalkContract\(frame,banker,/);
    assert.match(source,/runBankOpenContract\(frame,/);
    assert.doesNotMatch(source,/bankInteractionWaiting\(/);
  }
});

test('performance guards avoid unchanged UI and storage writes', () => {
  assert.match(html, /const METRICS_RENDER_INTERVAL=2000/);
  assert.match(html, /now-lastMetricsRenderAt<METRICS_RENDER_INTERVAL/);
  assert.match(html, /if\(zoom===savedZoom&&rotation===savedRotation\)return/);
  assert.match(html, /if\(bar\.style\.display!==display\)bar\.style\.display=display/);
});

test('long-session diagnostics remain bounded and expose per-node tick costs', () => {
  const traces=[];
  const decisionHistory=[{sequence:1,at:100,node:'combat',outcome:'sent',detail:'test'}];
  const actionContracts=new Map([['combat-attack',{pending:true,attempts:1,sentAt:90}]]);
  const objective={type:'combat',phase:'fight',target:'chicken',countProgress:2,countGoal:10};
  const commandQueue=['bank loot'];
  const activeTaskNode='combat';
  const botProfile={startedAt:0,ticks:0,activeTicks:0,idleTicks:0,totalMs:0,maxMs:0,slowTicks:0,errors:0,lastNode:'idle',lastSlowTraceAt:0,byNode:new Map()};
  const harness=new Function(
    'botProfile','decisionHistory','actionContracts','objective','commandQueue','activeTaskNode',
    'traceDecision','SLOW_TICK_MS','MAX_PROFILE_NODES',
    `${functionSource(html,'recordTickProfile')}
     ${functionSource(html,'diagnosticsSnapshot')}
     ${functionSource(html,'resetDiagnostics')}
     return {recordTickProfile,diagnosticsSnapshot,resetDiagnostics};`
  )(
    botProfile,decisionHistory,actionContracts,objective,commandQueue,activeTaskNode,
    (...entry)=>traces.push(entry),50,20
  );

  harness.recordTickProfile('combat',12,1000,'completed');
  harness.recordTickProfile('combat',88,2000,'error');
  harness.recordTickProfile('idle',1,3000,'completed');
  for(let i=0;i<5000;i++)harness.recordTickProfile(`synthetic-${i%30}`,i%7,4000+i,'completed');
  const snapshot=harness.diagnosticsSnapshot(10000);

  assert.equal(snapshot.profile.ticks,5003);
  assert.equal(snapshot.profile.errors,1);
  assert.equal(snapshot.profile.slowTicks,1);
  assert.equal(snapshot.profile.nodes.combat.ticks,2);
  assert.equal(snapshot.profile.nodes.combat.maxMs,88);
  assert.ok(Object.keys(snapshot.profile.nodes).length<=20,'arbitrary long sessions must not grow profile node storage without bound');
  assert.equal(snapshot.pendingActions[0].key,'combat-attack');
  assert.equal(snapshot.objective.target,'chicken');
  assert.deepEqual(snapshot.queue,['bank loot']);
  assert.ok(traces.some(entry=>entry[1]==='slow-tick'));

  snapshot.decisions[0].detail='mutated copy';
  assert.equal(decisionHistory[0].detail,'test','diagnostic snapshots must not expose mutable live history');
  harness.resetDiagnostics(12000);
  assert.equal(botProfile.ticks,0);
  assert.equal(botProfile.byNode.size,0);
  assert.equal(decisionHistory.length,0);

  assert.match(functionSource(html,'tick'),/finally\{[\s\S]*recordTickProfile\(/);
  assert.match(html,/getDiagnostics:diagnosticsSnapshot,resetDiagnostics/);
});

test('pending interactions reuse captured targets instead of rescanning hot entity lists', () => {
  const actionContracts=new Map([
    ['woodcutting-gather',{pending:true,sentAt:1000,before:{target:{id:1,x:2,y:3,tree:'normal'}}}],
    ['combat-attack',{pending:true,sentAt:1000,before:{target:{x:4,y:5,name:'chicken',npc:{serverIndex:9}}}}]
  ]);
  const waitingActionTarget=new Function(
    'actionContracts',`${functionSource(html,'waitingActionTarget')}\nreturn waitingActionTarget;`
  )(actionContracts);

  const tree=waitingActionTarget('woodcutting-gather',5000,9000);
  assert.equal(tree.tree,'normal');
  tree.x=99;
  assert.equal(actionContracts.get('woodcutting-gather').before.target.x,2,'callers receive a safe target copy');
  const npc=waitingActionTarget('combat-attack',5000,6500);
  npc.npc.serverIndex=100;
  assert.equal(actionContracts.get('combat-attack').before.target.npc.serverIndex,9,'nested NPC references are copied');
  assert.equal(waitingActionTarget('combat-attack',7500,6500),null,'a timed-out interaction must rescan before retrying');
  actionContracts.get('woodcutting-gather').pending=false;
  assert.equal(waitingActionTarget('woodcutting-gather',5000,9000),null);

  for(const [name,key,timeout] of [
    ['woodcuttingTick','woodcutting-gather',9000],
    ['miningTick','mining-gather',9000],
    ['firemakingGatherTick','firemaking-gather',9000],
    ['combatTick','combat-loot',4000],
    ['combatTick','combat-attack',6500]
  ]){
    assert.match(functionSource(html,name),new RegExp(`waitingActionTarget\\('${key}'[\\s\\S]*?${timeout}\\)`),`${name} must reuse ${key} while confirmation is pending`);
  }
});

test('job preferences skip identical synchronous storage writes', () => {
  const values = new Map([['autoscape_job', 'same']]);
  const calls = { set: 0, remove: 0 };
  const localStorage = {
    setItem(key, value) { calls.set += 1; values.set(key, String(value)); },
    removeItem(key) { calls.remove += 1; values.delete(key); }
  };
  const persistedLocalValues = new Map([['autoscape_job', 'same']]);
  const helpers = new Function(
    'localStorage', 'persistedLocalValues',
    `${functionSource(html, 'persistLocalValue')}
     ${functionSource(html, 'removePersistedValue')}
     return { persistLocalValue, removePersistedValue };`
  )(localStorage, persistedLocalValues);

  assert.equal(helpers.persistLocalValue('autoscape_job', 'same'), false);
  assert.equal(calls.set, 0, 'an unchanged job must not block the main thread with a write');
  assert.equal(helpers.persistLocalValue('autoscape_job', 'progress-1'), true);
  assert.equal(helpers.persistLocalValue('autoscape_job', 'progress-1'), false);
  assert.equal(calls.set, 1, 'changed progress should save exactly once');
  assert.equal(helpers.removePersistedValue('autoscape_job'), true);
  assert.equal(helpers.removePersistedValue('autoscape_job'), false);
  assert.equal(calls.remove, 1, 'stopping an already-cleared job must not rewrite storage');

  const saveSource = functionSource(html, 'saveObjective');
  assert.match(saveSource, /persistLocalValue\('autoscape_job'/);
  assert.doesNotMatch(saveSource, /localStorage\.setItem/);
});

test('hot target searches scan each loaded entity list only once', () => {
  const treeSource = functionSource(html, 'bestTree');
  let objectReads = 0;
  const objectIds = new Proxy([310, 310, 0, 1], {
    get(target, property) {
      if (/^\d+$/.test(String(property))) objectReads += 1;
      return target[property];
    }
  });
  const bestTree = new Function(
    'playerTile', 'wcLevel', 'objective', 'TREE_DEFS', 'mc', 'gatherTargetBlocked',
    `${functionSource(html, 'readLoadedObjects')}\n${treeSource}\nreturn bestTree;`
  )(
    () => ({ x: 0, y: 0 }),
    () => 99,
    { resource: 'auto' },
    [
      { ids: [310], level: 75, name: 'magic', log: 636 },
      { ids: [309], level: 60, name: 'yew', log: 635 },
      { ids: [0, 1], level: 1, name: 'normal', log: 14 }
    ],
    { objectCount: 4, objectId: objectIds, objectX: [20, 5, 8, 2], objectY: [0, 0, 0, 0], objectDirection: [] },
    () => false
  );
  const tree = bestTree();
  assert.equal(tree.tree, 'magic', 'must retain highest available tier priority');
  assert.equal(tree.index, 1, 'must retain nearest object within the chosen tier');
  assert.equal(objectReads, 4, 'woodcutting should read every loaded object ID once');

  const npcSource = functionSource(html, 'nearestCombatNpc');
  let npcReads = 0;
  const npcs = new Proxy([
    { npcId: 3, serverIndex:1, currentX: 8 * 128 + 64, currentY: 64 },
    { npcId: 6, serverIndex:2, currentX: 3 * 128 + 64, currentY: 64 },
    { npcId: 999, serverIndex:3, currentX: 128 + 64, currentY: 64 }
  ], {
    get(target, property) {
      if (/^\d+$/.test(String(property))) npcReads += 1;
      return target[property];
    }
  });
  const nearestCombatNpc = new Function(
    'chooseCombatTargetType', 'SAFE_COMBAT_TARGETS', 'playerTile', 'objective',
    'combatSelect', 'playerCombatEstimate', 'mc', 'timedTargetBlocked', 'blockedCombatTargets', `${functionSource(html, 'readLoadedNpcs')}\n${npcSource}\nreturn nearestCombatNpc;`
  )(
    () => 'guard',
    {
      chicken: { ids: [3], level: 3, name: 'chicken' },
      cow: { ids: [6], level: 8, name: 'cow' },
      guard: { ids: [65], level: 28, name: 'guard' }
    },
    () => ({ x: 0, y: 0 }),
    { target: 'auto' },
    { value: 'auto' },
    () => 10,
    { npcCount: 3, npcs, magicLoc: 128 },
    () => false,
    new Map()
  );
  assert.equal(nearestCombatNpc().name, 'cow', 'automatic fallback should remain nearest safe target');
  assert.equal(npcReads, 3, 'combat should read every loaded NPC once');
});

test('decision frames lazily share loaded world entities across task decisions', () => {
  const reads={objects:0,ground:0,npcs:0};
  const tracked=(values,key)=>new Proxy(values,{
    get(target,property){
      if(/^\d+$/.test(String(property)))reads[key]++;
      return target[property];
    }
  });
  const mc={
    regionX:100,regionY:200,magicLoc:128,
    objectCount:2,objectId:tracked([97,310],'objects'),objectX:[1,2],objectY:[3,4],objectDirection:[0,1],
    groundItemCount:2,groundItemID:tracked([14,20],'ground'),groundItemX:[5,6],groundItemY:[7,8],
    npcCount:2,npcs:tracked([
      {npcId:3,serverIndex:11,currentX:128+64,currentY:256+64,healthCurrent:2,healthMax:3},
      {npcId:95,serverIndex:12,currentX:384+64,currentY:512+64}
    ],'npcs')
  };
  const world=new Function(
    'mc',
    `${functionSource(html,'readLoadedObjects')}
     ${functionSource(html,'readLoadedGroundItems')}
     ${functionSource(html,'readLoadedNpcs')}
     ${functionSource(html,'createWorldSnapshot')}
     return createWorldSnapshot();`
  )(mc);

  assert.deepEqual(reads,{objects:0,ground:0,npcs:0},'creating a frame must not scan unused lists');
  assert.equal(world.objects,world.objects,'object snapshots must be reused');
  assert.equal(world.groundItems,world.groundItems,'ground-item snapshots must be reused');
  assert.equal(world.npcs,world.npcs,'NPC snapshots must be reused');
  assert.deepEqual(reads,{objects:2,ground:2,npcs:2},'each requested entity list must be read exactly once');
  assert.deepEqual(world.objects[0],{index:0,id:97,x:1,y:3,gx:101,gy:203,dir:0});
  assert.equal(world.groundItems[0].gx,105);
  assert.deepEqual(world.npcs[0],{index:0,npcId:3,serverIndex:11,lx:1,ly:2,x:101,y:202,healthCurrent:2,healthMax:3});

  assert.match(functionSource(html,'buildDecisionFrame'),/world:createWorldSnapshot\(\)/);
  assert.doesNotMatch(functionSource(html,'buildLiveObservation'),/frame\?*\.world|frame\.world/,'raw world entities must not enter exported observations');
  assert.match(functionSource(html,'advanceCombatTravel'),/nearestCombatNpc\(frame\.world\)/);
  assert.match(functionSource(html,'advanceBankRoute'),/nearestLoadedBanker\(bank,frame\.world\)/);
  assert.match(functionSource(html,'miningTick'),/bestRock\(frame\.world\)/);
  assert.match(functionSource(html,'firemakingTick'),/groundNormalLogNear\(objective\.fireTile,3,frame\.world\)/);
  assert.match(functionSource(html,'woodcuttingTick'),/bestTree\('woodcutting',frame\.world\)/);
  assert.match(html,/id:'return-route'[\s\S]*execute:frame=>advanceReturnRoute\(frame\)/);
});

test('hot inventory and ground-loot decisions use single-pass snapshots', () => {
  const snapshotSource = functionSource(html, 'inventorySnapshot');
  let inventoryIdReads = 0;
  const inventoryIds = new Proxy([87, 14, 166, 132, 156], {
    get(target, property) {
      if (/^\d+$/.test(String(property))) inventoryIdReads += 1;
      return target[property];
    }
  });
  const inventorySnapshot = new Function(
    'inventorySlots', 'mc', 'FOOD_HEALS', 'AXE_IDS', 'PICKAXE_IDS',
    `${snapshotSource}\nreturn inventorySnapshot;`
  )(
    () => 5,
    {
      inventoryItemId: inventoryIds,
      inventoryItemStackCount: [1, 3, 1, 2, 1],
      inventoryEquipped: [1, 0, 0, 0, 0]
    },
    { 132: 3 },
    new Set([87]),
    new Set([156])
  );
  const inventory = inventorySnapshot();
  assert.equal(inventoryIdReads, 5, 'each carried item ID should be read once');
  assert.equal(inventory.used, 5);
  assert.equal(inventory.counts.get(14), 3);
  assert.equal(inventory.normalLogSlot, 1);
  assert.equal(inventory.tinderboxSlot, 2);
  assert.equal(inventory.hasAxe, true);
  assert.equal(inventory.hasPickaxe, true);
  assert.deepEqual(inventory.foods, [{ slot: 3, id: 132, heal: 3 }]);

  let modeReads = 0, groundIdReads = 0;
  const groundIds = new Proxy([20, 999, 10], {
    get(target, property) {
      if (/^\d+$/.test(String(property))) groundIdReads += 1;
      return target[property];
    }
  });
  const nearestGroundLoot = new Function(
    'inventorySlots', 'mc', 'lootSelect', 'VALUABLE_LOOT_IDS', 'F2P_LOOT_IDS',
    'playerTile', 'objective', 'ITEM_NAMES', 'timedTargetBlocked', 'blockedLootTargets',
    `${functionSource(html, 'readLoadedGroundItems')}\n${functionSource(html, 'nearestGroundLoot')}\nreturn nearestGroundLoot;`
  )(
    () => 2,
    {
      inventoryMaxItemCount: 30,
      groundItemCount: 3,
      groundItemID: groundIds,
      groundItemX: [4, 1, 2],
      groundItemY: [0, 0, 0]
    },
    { get value() { modeReads += 1; return 'valuable'; } },
    new Set([10]),
    new Set([10, 20]),
    () => ({ x: 0, y: 0 }),
    { lastTargetTile: { x: 0, y: 0 } },
    { 10: 'coins' },
    () => false,
    new Map()
  );
  assert.equal(nearestGroundLoot().id, 10);
  assert.equal(modeReads, 1, 'loot mode should be captured once per decision');
  assert.equal(groundIdReads, 3, 'each loaded ground-item ID should be read once');

  assert.match(functionSource(html,'buildDecisionFrame'),/inventory:inventorySnapshot\(\)/);
  assert.match(functionSource(html,'tick'),/const frame=buildDecisionFrame\(\)/);
  for (const name of ['combatTick','miningTick','prayerTick','firemakingTick','woodcuttingTick']) {
    assert.doesNotMatch(functionSource(html,name),/inventorySnapshot\(\)/,`${name} must reuse the shared decision-frame inventory`);
    assert.match(functionSource(html,name),/frame\.inventory/,`${name} must consume the shared decision-frame inventory`);
  }
  assert.doesNotMatch(functionSource(html, 'miningTick'), /Array\.from\(mc\.inventoryItemId/);
  assert.doesNotMatch(functionSource(html, 'firemakingGatherTick'), /Array\.from\(mc\.inventoryItemId/);
});

test('resource depletion supports timed multi-yield gathering', () => {
  assert.match(html, /autoscapeResourceTimer/);
  for (const milliseconds of [18000, 24000, 30000, 36000, 42000, 48000]) {
    assert.ok(html.includes(String(milliseconds)), `tree window ${milliseconds} missing`);
  }
  for (const milliseconds of [22000, 26000, 32000, 38000]) {
    assert.ok(html.includes(String(milliseconds)), `ore window ${milliseconds} missing`);
  }
  assert.match(html, /if \(current !== gameObject\) return/);
  assert.match(html, /if \(live === depleted\)/);
});

test('bot-generated actions suppress stale pointer click markers', () => {
  assert.match(html, /function suppressBotClickMarker\(\)\{\s*mc\.mouseClickXStep=0;/);
  const automatedActions = ['walkGlobal', 'lightGroundLog', 'mineRock', 'sendTalkToBanker', 'chop'];
  for (const name of automatedActions) {
    const source = functionSource(html, name);
    assert.match(source, /suppressBotClickMarker\(\)/, `${name} must hide synthetic click markers`);
  }
});

test('live observation recording is opt-in, bounded, sanitized, and reuses the decision frame', () => {
  const build = functionSource(html, 'buildLiveObservation');
  const record = functionSource(html, 'recordLiveObservation');
  const start = functionSource(html, 'startLiveObservationRecording');
  const tick = functionSource(html, 'tick');
  const download = functionSource(html, 'downloadLiveObservations');

  assert.match(html, /LIVE_OBSERVATION_LIMIT=600/);
  assert.match(record, /if\(!liveObservationRecorder\.enabled\|\|!frame\)return null/);
  assert.match(record, /observations\.shift\(\)/);
  assert.match(start, /observations=\[\]/);
  assert.match(tick, /observationFrame=frame/);
  assert.match(tick, /recordLiveObservation\(observationFrame,profiledNode\)/);
  assert.equal((tick.match(/buildDecisionFrame\(\)/g)||[]).length, 1, 'the recorder must not build a second world snapshot');
  assert.doesNotMatch(build, /\bmc\.|inventorySnapshot\(|objectCount|npcCount|groundItemCount/);
  assert.doesNotMatch(`${build}\n${record}`, /username|password|credentials|bank contents|localStorage|sessionStorage|indexedDB/i);
  assert.match(download, /new Blob/);
  assert.match(build, /navigation:\{active:navigationActive/);
  assert.match(functionSource(html, 'getLiveObservations'), /navigation:\{\.\.\.item\.navigation\}/);
  assert.match(html, /createdBy:'AutoScape read-only recorder'/);
  assert.match(html, /startObservationRecording:startLiveObservationRecording/);
  assert.doesNotMatch(html, /startObservationRecording:[^,}]*(walk|attack|bank|chop)/);
});
