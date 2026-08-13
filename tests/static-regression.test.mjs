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
    "localStorage.setItem('autoscape_job'",
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
const PLAYER_SAVE_INTERVAL = 1000 * 60 * 5; // (5 mins)
        this.boundSaveAllPlayers = this.saveAllPlayers.bind(this);

        this.ticks = 0;
    async saveAllPlayers() {
        if (!this.players.length) {
            return;
        }`;
  const patched = patchServerPersistence(fixture);

  assert.match(patched, /this\.players\.set\(player\.username, player\);\s*await this\.save\(\);/);
  assert.match(patched, /const PLAYER_SAVE_INTERVAL = 1000 \* 15/);
  assert.match(patched, /this\.ticks = 0;\s*setTimeout\(this\.boundSaveAllPlayers, PLAYER_SAVE_INTERVAL\);/);
  assert.match(patched, /if \(!this\.players\.length\) \{\s*setTimeout\(this\.boundSaveAllPlayers, PLAYER_SAVE_INTERVAL\);\s*return;/);
  assert.throws(
    () => patchServerPersistence(fixture.replace('this.players.set(player.username, player);', 'this.players.add(player);')),
    /registration block changed/
  );
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

  assert.match(html, /normalizeSavedJob\(JSON\.parse\(localStorage\.getItem\('autoscape_job'\)/);
  assert.match(functionSource(html, 'saveObjective'), /serializeObjectiveState\(\)/);
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
