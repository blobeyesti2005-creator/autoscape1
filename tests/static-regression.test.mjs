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
    'game-host', 'loader', 'bot', 'botStatus', 'botMetrics', 'queuePlan',
    'botInput', 'resourceSelect', 'miningSelect', 'combatSelect',
    'combatStyleSelect', 'combatBankSelect', 'lootSelect', 'guidePanel'
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
  const readRememberedCredentials = new Function(
    `${functionSource(html, 'readRememberedCredentials')}\nreturn readRememberedCredentials;`
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
  assert.match(html,/__autoscapeAutoLoginTimer=setTimeout/);
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

  assert.match(html, /normalizeSavedJob\(JSON\.parse\(localStorage\.getItem\('autoscape_job'\)/);
  assert.match(functionSource(html, 'saveObjective'), /serializeObjectiveState\(\)/);
});

test('explicit banking deposits selected unequipped items and advances chains', () => {
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
  const depositItemsIfBankOpen = new Function(
    'mc','inventorySlots','sessionStats','markProgress','renderMetrics','setTimeout',
    `${functionSource(html,'depositItemsIfBankOpen')}\nreturn depositItemsIfBankOpen;`
  )(mc,()=>4,sessionStats,()=>{},()=>{},callback=>callback());

  assert.equal(depositItemsIfBankOpen(null),true);
  const deposits=packets.filter(packet=>packet.id===23);
  assert.deepEqual(deposits.map(packet=>packet.values.slice(0,2)),[[14,3],[10,100],[132,2]]);
  assert.equal(deposits.some(packet=>packet.values[0]===87),false,'equipped gear must remain carried');
  assert.equal(sessionStats.deposits,1);

  const advanceSource=functionSource(html,'advanceBankRoute');
  assert.match(advanceSource,/objective\.type==='banking'/);
  assert.match(advanceSource,/finishObjective\(deposited/);
  assert.match(functionSource(html,'tick'),/objective\.type==='banking'/);
  assert.match(html,/savedJob\.type==='banking'/);
  assert.match(html,/GATHERED_BANK_IDS/);
  assert.match(html,/LOOT_BANK_IDS/);
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
  assert.match(prayerSource,/actionAttempts>8/);
  assert.match(functionSource(html,'tick'),/objective\.type==='prayer'/);
  assert.match(html,/savedJob\.type==='prayer'/);
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
    '    function nearestLoadedBanker(bank){'
  );
  let point = { x: 0, y: 0 };
  let now = 1_000;
  const { navRetryTarget, watch } = new Function(
    'globalPlayerTile', 'nodeDistance', 'Date',
    `${recoverySource}\nreturn {navRetryTarget,watch:()=>({...navWatch})};`
  )(
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
  assert.match(shortStepSource, /navRetryTarget\(target\)/);
  assert.doesNotMatch(shortStepSource, /navRetryTarget\(\{x:tx,y:ty\}\)/);
});

test('all routed travel modes rebuild stalled routes from the current position', () => {
  const recoverySource = section(
    html,
    '    let navWatch={x:null,y:null,lastMove:0,stalls:0,retries:0};',
    '    function nearestLoadedBanker(bank){'
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
    '    function nearestLoadedBanker(bank){'
  );
  const objective = { searchIndex: 2 };
  const { advanceRegionalSearchIfStalled, navRetryTarget, setWatch, watch } = new Function(
    'globalPlayerTile', 'nodeDistance', 'Date', 'objective', 'makeRouteTo',
    `${recoverySource}\nreturn {
      advanceRegionalSearchIfStalled,
      navRetryTarget,
      setWatch:value=>{navWatch={...navWatch,...value};},
      watch:()=>({...navWatch})
    };`
  )(
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
    'mc', 'BANKER_IDS', 'globalPlayerTile', 'nodeDistance',
    `${bankerSource}\nreturn nearestLoadedBanker;`
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
    (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
  );

  assert.equal(nearestLoadedBanker({ x: 220, y: 635 }).npc.serverIndex, 2);
  assert.equal(nearestLoadedBanker({ x: 400, y: 400 }), null);
  for (const name of ['advanceBankRoute', 'advanceCombatBanking']) {
    const source = functionSource(html, name);
    assert.match(source, /nearestLoadedBanker\(bank\)/, `${name} must target the selected bank`);
    assert.match(source, /bankDialogueOptionExpected\(/, `${name} must reject unrelated dialogue menus`);
  }
});

test('bank arrival rotates blocked approaches and engages scoped bankers nearby', () => {
  const recoverySource = section(
    html,
    '    let navWatch={x:null,y:null,lastMove:0,stalls:0,retries:0};',
    '    function nearestLoadedBanker(bank){'
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

  const waitingSource = functionSource(html, 'bankInteractionWaiting');
  const makeWaiting = objective => new Function(
    'objective', `${waitingSource}\nreturn bankInteractionWaiting;`
  )(objective);
  const active = { phase: 'bank-dialogue', bankTalkSentAt: now - 1_000 };
  assert.equal(makeWaiting(active)(false, now), true);
  assert.equal(active.phase, 'bank-dialogue');

  const expired = { phase: 'combat-bank-open', bankOptionSentAt: now - 7_000 };
  assert.equal(makeWaiting(expired)(true, now), false);
  assert.equal(expired.phase, 'combat-bank');
  assert.equal(expired.bankOptionSentAt, 0);
  assert.equal(expired.bankOptionTimeouts, 1);
});

test('performance guards avoid unchanged UI and storage writes', () => {
  assert.match(html, /const METRICS_RENDER_INTERVAL=2000/);
  assert.match(html, /now-lastMetricsRenderAt<METRICS_RENDER_INTERVAL/);
  assert.match(html, /if\(zoom===savedZoom&&rotation===savedRotation\)return/);
  assert.match(html, /if\(bar\.style\.display!==display\)bar\.style\.display=display/);
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
    'playerTile', 'wcLevel', 'objective', 'TREE_DEFS', 'mc',
    `${treeSource}\nreturn bestTree;`
  )(
    () => ({ x: 0, y: 0 }),
    () => 99,
    { resource: 'auto' },
    [
      { ids: [310], level: 75, name: 'magic', log: 636 },
      { ids: [309], level: 60, name: 'yew', log: 635 },
      { ids: [0, 1], level: 1, name: 'normal', log: 14 }
    ],
    { objectCount: 4, objectId: objectIds, objectX: [20, 5, 8, 2], objectY: [0, 0, 0, 0], objectDirection: [] }
  );
  const tree = bestTree();
  assert.equal(tree.tree, 'magic', 'must retain highest available tier priority');
  assert.equal(tree.index, 1, 'must retain nearest object within the chosen tier');
  assert.equal(objectReads, 4, 'woodcutting should read every loaded object ID once');

  const npcSource = functionSource(html, 'nearestCombatNpc');
  let npcReads = 0;
  const npcs = new Proxy([
    { npcId: 3, currentX: 8 * 128 + 64, currentY: 64 },
    { npcId: 6, currentX: 3 * 128 + 64, currentY: 64 },
    { npcId: 999, currentX: 128 + 64, currentY: 64 }
  ], {
    get(target, property) {
      if (/^\d+$/.test(String(property))) npcReads += 1;
      return target[property];
    }
  });
  const nearestCombatNpc = new Function(
    'chooseCombatTargetType', 'SAFE_COMBAT_TARGETS', 'playerTile', 'objective',
    'combatSelect', 'playerCombatEstimate', 'mc', `${npcSource}\nreturn nearestCombatNpc;`
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
    { npcCount: 3, npcs, magicLoc: 128 }
  );
  assert.equal(nearestCombatNpc().name, 'cow', 'automatic fallback should remain nearest safe target');
  assert.equal(npcReads, 3, 'combat should read every loaded NPC once');
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
    'playerTile', 'objective', 'ITEM_NAMES',
    `${functionSource(html, 'nearestGroundLoot')}\nreturn nearestGroundLoot;`
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
    { 10: 'coins' }
  );
  assert.equal(nearestGroundLoot().id, 10);
  assert.equal(modeReads, 1, 'loot mode should be captured once per decision');
  assert.equal(groundIdReads, 3, 'each loaded ground-item ID should be read once');

  for (const name of ['combatTick', 'miningTick', 'firemakingTick', 'tick']) {
    assert.match(functionSource(html, name), /inventorySnapshot\(\)/, `${name} must create one reusable inventory view`);
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
