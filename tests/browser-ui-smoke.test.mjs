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
    add(name) { values.add(name); },
    remove(name) { values.delete(name); },
    toggle(name, enabled) { enabled ? values.add(name) : values.delete(name); },
    contains(name) { return values.has(name); }
  };
}

test('Android keyboard viewport smoke keeps the game scale stable and exposes the inset', () => {
  const properties = new Map(), bodyClasses = fakeClassList();
  let now = 1_000;
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
  const factory = new Function('window', 'document', 'gameHost', 'Date', `
    let stableViewportHeight=window.innerHeight || document.documentElement.clientHeight || 346;
    let keyboardOpen=false,inputBlurredAt=0;
    ${functionSource(appHtml, 'textInputFocused')}
    ${functionSource(appHtml, 'keyboardTransitionActive')}
    ${functionSource(appHtml, 'syncMobileKeyboard')}
    ${functionSource(appHtml, 'fitGame')}
    return {
      syncMobileKeyboard,fitGame,stable:()=>stableViewportHeight,
      blur:at=>{inputBlurredAt=at;},keyboardOpen:()=>keyboardOpen
    };
  `);
  const ui = factory(window, document, gameHost, { now: () => now });

  ui.fitGame();
  assert.equal(gameHost.style.transform, 'translate(-50%,-50%) scale(1)');
  window.innerHeight = 430;
  ui.syncMobileKeyboard();
  ui.fitGame();
  assert.equal(properties.get('--keyboard-inset'), '40px');
  assert.equal(bodyClasses.contains('keyboard-open'), false, 'small browser chrome changes are not a keyboard');
  assert.equal(gameHost.style.transform, 'translate(-50%,-50%) scale(1)', 'focused viewport changes must not rescale the canvas');

  window.visualViewport.height = 300;
  window.visualViewport.offsetTop = 12;
  ui.syncMobileKeyboard();
  assert.equal(properties.get('--keyboard-inset'), '118px');
  assert.equal(properties.get('--keyboard-top'), '12px');
  assert.equal(properties.get('--keyboard-height'), '300px');
  assert.equal(bodyClasses.contains('keyboard-open'), true);
  assert.equal(ui.keyboardOpen(), true);

  // Blur fires before Android finishes closing its keyboard. The temporary
  // viewport must remain pinned and must not become the new canvas baseline.
  document.activeElement = { tagName: 'DIV', isContentEditable: false };
  ui.blur(now);
  now += 100;
  ui.syncMobileKeyboard();
  ui.fitGame();
  assert.equal(bodyClasses.contains('keyboard-open'), true);
  assert.equal(ui.stable(), 700);
  assert.equal(gameHost.style.transform, 'translate(-50%,-50%) scale(1)');

  now += 400;
  window.innerHeight = 700;
  window.visualViewport.height = 700;
  window.visualViewport.offsetTop = 0;
  ui.syncMobileKeyboard();
  assert.equal(properties.get('--keyboard-inset'), '0px');
  assert.equal(bodyClasses.contains('keyboard-open'), false);
  assert.equal(ui.stable(), 700);
});

test('mobile inventory tab changes once per tap and stays stable across render frames', () => {
  const updateMobileHudTab = new Function(
    `${functionSource(appHtml, 'updateMobileHudTab')}\nreturn updateMobileHudTab;`
  )();
  const client = {
    gameWidth: 512, gameHeight: 346,
    mouseX: 490, mouseY: 130, mouseButtonClick: 1,
    showUITab: 0, uiOpenX: 260, uiOpenY: 30, uiOpenWidth: 249, uiOpenHeight: 204
  };

  assert.equal(updateMobileHudTab(client), true);
  assert.equal(client.showUITab, 1, 'one inventory tap must open inventory');
  client.mouseButtonClick = 0;
  for (let frame = 0; frame < 30; frame += 1) updateMobileHudTab(client);
  assert.equal(client.showUITab, 1, 'the retained touch position must not toggle inventory on later frames');

  client.mouseButtonClick = 1;
  assert.equal(updateMobileHudTab(client), true);
  assert.equal(client.showUITab, 0, 'a separate tap on the selected tab must close it once');
  client.mouseButtonClick = 0;
  for (let frame = 0; frame < 30; frame += 1) updateMobileHudTab(client);
  assert.equal(client.showUITab, 0, 'the close tap must not reopen inventory on later frames');

  client.mouseButtonClick = 1;
  updateMobileHudTab(client);
  client.mouseX = 100; client.mouseY = 100; client.mouseButtonClick = 0;
  updateMobileHudTab(client);
  assert.equal(client.showUITab, 1, 'pointer movement without a tap must not close the panel');
  client.mouseButtonClick = 1;
  assert.equal(updateMobileHudTab(client), true);
  assert.equal(client.showUITab, 0, 'a real tap outside the open panel must close it');
});

test('first online runtime load seeds a verified cache used by an offline restart', async () => {
  const statuses=[],warnings=[],entries=new Map();
  const makeResponse=text=>({
    ok:true,status:200,
    async text(){return text;},
    clone(){return makeResponse(text);}
  });
  const runtimeCache={
    async match(url){return entries.get(url)||null;},
    async put(url,response){entries.set(url,response);}
  };
  const cacheStorage={
    async open(name){assert.equal(name,'autoscape-runtime-v1');return runtimeCache;}
  };
  const factory=new Function('say','console','RUNTIME_CACHE_NAME', `
    ${functionSource(appHtml, 'fetchText').replace(/^function /,'async function ')}
    return fetchText;
  `);
  const fetchText=factory((...args)=>statuses.push(args),{warn(...args){warnings.push(args);}},'autoscape-runtime-v1');
  const url='https://runtime.invalid/client.js';
  const payload='verified-runtime'.repeat(100);
  let networkCalls=0;
  const online=async requested=>{networkCalls++;assert.equal(requested,url);return makeResponse(payload);};

  const first=await fetchText(url,null,null,'Classic client',online,cacheStorage);
  assert.equal(first.source,'network');
  assert.equal(first.text,payload);
  assert.equal(networkCalls,1);
  assert.ok(entries.has(url),'successful validation must seed the runtime cache');

  const offline=async()=>{networkCalls++;throw new Error('offline');};
  const second=await fetchText(url,null,null,'Classic client',offline,cacheStorage);
  assert.equal(second.source,'cache');
  assert.equal(second.text,payload);
  assert.equal(networkCalls,1,'a verified cached restart must not touch the network');
  assert.match(statuses.at(-1)[0],/offline cache/);

  entries.set(url,makeResponse('short'));
  const replacement='replacement-runtime'.repeat(80);
  const repaired=await fetchText(url,null,null,'Classic client',async()=>makeResponse(replacement),cacheStorage);
  assert.equal(repaired.source,'network','an invalid cache entry must fall back to the network');
  assert.equal(repaired.text,replacement);
  assert.equal(warnings.length,0);
});

test('account creation and login hooks remember credentials through the shipped client patch', async () => {
  const patchStart = appHtml.indexOf('  function patchClient(code){');
  const patchEnd = appHtml.indexOf('  function patchServerResources(code){', patchStart);
  assert.ok(patchStart >= 0 && patchEnd > patchStart, 'client patch section is missing');
  const patchClient = new Function(`${appHtml.slice(patchStart, patchEnd)}\nreturn patchClient;`)();
  const fixture = `async function boot(args,mc,mcContainer){
    if (this.mouseActionTimeout > 4500 && this.combatTimeout === 0 && this.logoutTimeout === 0) {
      this.mouseActionTimeout -= 500; this.sendLogout(); return;
    }
    let j5 = 4;
    const fatigue = \`Fatigue: @yel@\${((this.statFatigue * 100) / 750) | 0}%\`;
    const options={mobile:false};
    mc.members = args[0] === 'members';
    window.mcOptions = mc.options;
    mc.server = args[1] ? args[1] : '127.0.0.1';
    document.body.appendChild(mcContainer);
    await this.login(this.loginUser, this.loginPass, false);
    await this.register(this.registerUser, this.registerPassword);
    return {j5,fatigue,options};
  }`;
  const patched = patchClient(fixture), stored = new Map(), appended = [];
  const localStorage = { setItem(key, value) { stored.set(key, value); } };
  const window = { __AUTOSCAPE_SERVER__: 'local-worker', matchMedia: () => ({ matches: false }) };
  const document = {
    body: { appendChild() { throw new Error('patched client must not append to body'); } },
    getElementById(id) { assert.equal(id, 'game-host'); return { appendChild(value) { appended.push(value); } }; }
  };
  const boot = new Function('window', 'document', 'localStorage', `${patched}\nreturn boot;`)(window, document, localStorage);
  const calls = [], client = {
    mouseActionTimeout: 5001, combatTimeout: 0, logoutTimeout: 0, statFatigue: 100,
    loginUser: 'returning-player', loginPass: 'saved-login', registerUser: 'new-player', registerPassword: 'saved-registration',
    async login(...args) { calls.push(['login', ...args]); }, async register(...args) { calls.push(['register', ...args]); }
  };
  const mc = { options: {}, server: '', members: false }, host = { id: 'canvas-host' };
  const result = await boot.call(client, ['members'], mc, host);

  assert.deepEqual(calls, [
    ['login', 'returning-player', 'saved-login', false],
    ['register', 'new-player', 'saved-registration']
  ]);
  assert.deepEqual(JSON.parse(stored.get('autoscape_credentials')), { u: 'new-player', p: 'saved-registration' });
  assert.deepEqual(appended, [host]);
  assert.equal(mc.server, 'local-worker');
  assert.equal(result.j5, 8);
  assert.equal(result.fatigue, 'Fatigue: @gre@Disabled');
  assert.equal(result.options.mobile, false);
});

test('remembered auto-login schedules once, reports failure, and remains retryable', async () => {
  const scheduled = [], status = { textContent: '' }, warnings = [], setStatuses = [];
  const factory = new Function('botStatus', 'console', 'setBotStatus', `
    ${functionSource(appHtml, 'loginRememberedCharacter').replace(/^function /, 'async function ')}
    ${functionSource(appHtml, 'scheduleRememberedAutoLogin')}
    return scheduleRememberedAutoLogin;
  `);
  const scheduleRememberedAutoLogin = factory(status, { warn(...args) { warnings.push(args); } }, value => setStatuses.push(value));
  const schedule = (callback, delay) => { scheduled.push({ callback, delay }); return 73; };
  const calls = [], client = { loggedIn: 0, async login(...args) { calls.push(args); } };

  assert.equal(scheduleRememberedAutoLogin({ u: 'player', p: 'pass' }, client, schedule), true);
  assert.equal(scheduleRememberedAutoLogin({ u: 'player', p: 'pass' }, client, schedule), false, 'a pending timer must suppress duplicate login attempts');
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 700);
  assert.match(status.textContent, /logging in/);
  await scheduled[0].callback();
  assert.deepEqual(calls, [['player', 'pass', false]]);
  assert.equal(client.__autoscapeAutoLoginTimer, 0);

  const failing = { loggedIn: 0, async login() { throw new Error('offline'); } };
  assert.equal(scheduleRememberedAutoLogin({ u: 'player', p: 'pass' }, failing, schedule), true);
  await scheduled.at(-1).callback();
  assert.equal(failing.__autoscapeAutoLoginTimer, 0);
  assert.match(setStatuses.at(-1), /account was not removed/);
  assert.equal(warnings.length, 1);
  assert.equal(scheduleRememberedAutoLogin({ u: 'player', p: 'pass' }, { loggedIn: 1 }, schedule), false);
  assert.equal(scheduleRememberedAutoLogin(null, { loggedIn: 0 }, schedule), false);
});

test('saved jobs wait for confirmed login and expire without touching stored state', () => {
  const scheduled=[],statuses=[];
  const factory=new Function('setBotStatus', `
    ${functionSource(appHtml, 'scheduleSavedJobResume')}
    return scheduleSavedJobResume;
  `);
  const scheduleSavedJobResume=factory(value=>statuses.push(value));
  let clock=1000,restores=0;
  const schedule=(callback,delay)=>{scheduled.push({callback,delay});return scheduled.length;};
  const client={loggedIn:0};

  assert.equal(scheduleSavedJobResume(()=>{restores++;},client,schedule,()=>clock,3000,1000),true);
  assert.equal(scheduleSavedJobResume(()=>{restores++;},client,schedule,()=>clock,3000,1000),false);
  assert.equal(scheduled[0].delay,500);
  scheduled.shift().callback();
  assert.equal(restores,0,'a login-screen client must not restore a bot objective');
  assert.equal(scheduled[0].delay,500);
  client.loggedIn=1;
  clock=2000;
  scheduled.shift().callback();
  assert.equal(restores,1);
  assert.equal(client.__autoscapeJobResumePending,false);

  client.loggedIn=0;
  assert.equal(scheduleSavedJobResume(()=>{restores++;},client,schedule,()=>clock,1000,0),true);
  clock=3000;
  scheduled.shift().callback();
  assert.equal(restores,1,'an expired startup must leave the saved job dormant');
  assert.match(statuses.at(-1),/still available/);
  assert.equal(client.__autoscapeJobResumePending,false);
});

test('damaged startup JSON is classified without deletion or replacement', () => {
  const readStoredJSON=new Function(`${functionSource(appHtml, 'readStoredJSON')}\nreturn readStoredJSON;`)();
  const storage={
    raw:'{"type":',writes:[],removals:[],
    getItem(key){assert.equal(key,'autoscape_job');return this.raw;},
    setItem(...args){this.writes.push(args);},
    removeItem(...args){this.removals.push(args);}
  };
  const result=readStoredJSON('autoscape_job',storage);
  assert.equal(result.state,'invalid');
  assert.equal(result.value,null);
  assert.equal(storage.raw,'{"type":');
  assert.deepEqual(storage.writes,[]);
  assert.deepEqual(storage.removals,[]);
  assert.match(appHtml,/raw saved job were not changed/);
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

test('manual backup control checkpoints, validates, and downloads without page-side save access', async () => {
  const sent = [], downloads = [], revoked = [];
  const worker = { postMessage(message) { sent.push(message); } };
  const backupDownload = { disabled: false };
  const backupStatus = { textContent: '', classList: fakeClassList() };
  const anchor = { href: '', download: '', click() { downloads.push({ href: this.href, download: this.download }); }, remove() {} };
  const document = {
    body: { appendChild(value) { assert.equal(value, anchor); } },
    createElement(tag) { assert.equal(tag, 'a'); return anchor; }
  };
  const MockURL = {
    createObjectURL(blob) { assert.ok(blob instanceof Blob); return 'blob:backup'; },
    revokeObjectURL(url) { revoked.push(url); }
  };
  const factory = new Function('worker', 'backupDownload', 'backupStatus', 'document', 'URL', 'setTimeout', 'location', `
    let backupRequestSequence=0,backupPendingId=0;
    ${functionSource(appHtml, 'validateCharacterBackupPayload')}
    async ${functionSource(appHtml, 'buildCharacterBackup')}
    ${functionSource(appHtml, 'saveCharacterBackupFile')}
    ${functionSource(appHtml, 'requestCharacterBackup')}
    async ${functionSource(appHtml, 'handleServerBackupMessage')}
    return {requestCharacterBackup,handleServerBackupMessage,get pending(){return backupPendingId;}};
  `);
  const backup = factory(worker, backupDownload, backupStatus, document, MockURL, callback => callback(), { origin: 'https://example.test' });
  assert.equal(backup.requestCharacterBackup(), true);
  assert.deepEqual(sent, [{ type: 'export-backup', requestId: 1 }]);
  assert.equal(backupDownload.disabled, true);
  assert.match(backupStatus.textContent, /Checkpointing and validating/);

  const players = [['tester', {
    id: 1, username: 'tester', password: 'private',
    inventory: [{ id: 14, amount: 3 }], bank: [{ id: 10, amount: 5 }], settings: { soundOn: 1 }
  }]];
  assert.equal(await backup.handleServerBackupMessage({ data: {
    type: 'backup-result', requestId: 1, success: true,
    payload: { playerID: 2, players: JSON.stringify(players) }
  } }), true);
  assert.equal(backupDownload.disabled, false);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].href, 'blob:backup');
  assert.match(downloads[0].download, /^autoscape-character-backup-/);
  assert.deepEqual(revoked, ['blob:backup']);
  assert.match(backupStatus.textContent, /1 character · keep it private/);
  assert.equal(backupStatus.classList.contains('bad'), false);
  assert.equal(sent[0].players, undefined, 'the page request must never contain account state');
});

test('death recovery UI preempts stale work and visibly confirms a stable respawn', () => {
  const statuses = [], traces = [];
  const factory = new Function('setBotStatus', 'traceDecision', `
    let objective={type:'mining',phase:'mine',resource:'iron',navRoute:[{x:1,y:1}],routeIndex:1,searchIndex:4,attackSentAt:55,lastTargetTile:{x:2,y:2},lastTargetServerIndex:8};
    let lastAction=42,saved=0,stopped='';
    const actionContracts=new Map([['walk',{pending:true}],['mine',{pending:true}]]);
    const deathRecovery={active:false,startedAt:0,stableTicks:0,origin:'',deathCount:0};
    const sessionStats={deaths:0,kills:0},TREE_HUBS={};
    function clearActionContracts(){actionContracts.clear();}
    function renderMetrics(){}
    function combatBankingEnabled(){return true;}
    function beginCombatBanking(){objective.phase='combat-bank';}
    function beginCombatTravel(){objective.phase='combat-travel';}
    function desiredTreeType(){return 'normal';}
    function globalPlayerTile(){return {x:122,y:657};}
    function beginResourceTravel(){}
    function normalLogCount(){return 0;}
    function prepareBankRoute(){return null;}
    function markProgress(){}
    function saveObjective(){saved++;}
    ${functionSource(appHtml, 'resetDeathRecovery')}
    function stop(message){stopped=message;resetDeathRecovery();}
    ${functionSource(appHtml, 'beginDeathRecovery')}
    ${functionSource(appHtml, 'resumeAfterDeath')}
    ${functionSource(appHtml, 'deathRecoveryTick')}
    return {tick:deathRecoveryTick,contracts:actionContracts,recovery:deathRecovery,get objective(){return objective;},get saved(){return saved;},get stopped(){return stopped;}};
  `);
  const recovery = factory(value => statuses.push(value), (...args) => traces.push(args));

  assert.equal(recovery.tick({ now: 1000, dead: true, inventory: { counts: new Map() } }), 'waiting');
  assert.equal(recovery.contracts.size, 0);
  assert.deepEqual(recovery.objective.navRoute, []);
  assert.match(statuses.at(-1), /character defeated/);
  assert.equal(recovery.tick({ now: 2000, dead: false, inventory: { counts: new Map() } }), 'stabilizing');
  assert.match(statuses.at(-1), /checking respawn stability/);
  assert.equal(recovery.tick({ now: 3000, dead: false, inventory: { counts: new Map() } }), 'resumed');
  assert.equal(recovery.objective.phase, 'mining-travel');
  assert.match(statuses.at(-1), /respawn confirmed/);
  assert.equal(recovery.saved, 1);
  assert.ok(traces.some(entry => entry[0] === 'death-recovery' && entry[1] === 'detected'));
  assert.ok(traces.some(entry => entry[0] === 'death-recovery' && entry[1] === 'confirmed'));
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
