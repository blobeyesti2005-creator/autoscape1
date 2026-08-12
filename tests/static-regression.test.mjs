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
    'queue:[...commandQueue]',
    'countProgress:Number(objective.countProgress||0)',
    'window.__AUTOSCAPE_STABLE_ORIGIN_V24__=true'
  ];
  required.forEach(marker => assert.ok(html.includes(marker), `missing safeguard: ${marker}`));

  assert.match(html, /this\.fatigue = 0; \/\/ AutoScape has unlimited energy/);
  assert.match(html, /if \(false && useFatigue\)/);
  assert.match(html, /fatigue:false/);
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

test('navigation graph and bank registry are connected and route-aware', () => {
  const dataSource = section(html, '    const NAV_NODES={', '    function prepareBankRoute(){');
  const { NAV_NODES, NAV_EDGES, BANKS, nearestBank } = new Function(
    'globalPlayerTile',
    `${dataSource}\nreturn { NAV_NODES, NAV_EDGES, BANKS, nearestBank };`
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
});

test('performance guards avoid unchanged UI and storage writes', () => {
  assert.match(html, /const METRICS_RENDER_INTERVAL=2000/);
  assert.match(html, /now-lastMetricsRenderAt<METRICS_RENDER_INTERVAL/);
  assert.match(html, /if\(zoom===savedZoom&&rotation===savedRotation\)return/);
  assert.match(html, /if\(bar\.style\.display!==display\)bar\.style\.display=display/);
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
