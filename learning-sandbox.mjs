const ACTIONS = Object.freeze(['chop', 'mine', 'fight', 'bank', 'rest']);
const CONTEXTS = Object.freeze(['low-hp', 'full-inventory', 'low-energy', 'ready']);
const GOALS = Object.freeze(['woodcutting', 'mining', 'combat', 'banking', 'balanced']);
const INVENTORY_LIMIT = 8;
const MAX_HISTORY = 120;
const MAX_TELEMETRY = 1200;
const MAX_REPLAY_TEXT = 2_000_000;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function createRng(seed) {
  let state = (Number(seed) >>> 0) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function emptyPolicy() {
  return Object.fromEntries(CONTEXTS.map(context => [
    context,
    Object.fromEntries(ACTIONS.map(action => [action, 0]))
  ]));
}

function copyInventory(value) {
  return { logs: Number(value.logs) || 0, ores: Number(value.ores) || 0, bones: Number(value.bones) || 0 };
}

function normalizeInventory(value) {
  return Object.fromEntries(['logs', 'ores', 'bones'].map(key => [
    key, Math.trunc(clamp(value?.[key], 0, 1_000_000))
  ]));
}

function copyEvent(event) {
  return {
    ...event,
    before: { ...event.before, inventory: copyInventory(event.before.inventory), bank: copyInventory(event.before.bank) },
    after: { ...event.after, inventory: copyInventory(event.after.inventory), bank: copyInventory(event.after.bank) }
  };
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`Invalid replay ${label}.`);
  return number;
}

function normalizeReplayEvent(value, index, previousSequence) {
  if (!value || typeof value !== 'object') throw new TypeError(`Invalid replay event ${index}.`);
  const sequence = Math.trunc(finiteNumber(value.sequence, 'sequence'));
  const tick = Math.trunc(finiteNumber(value.tick, 'tick'));
  const botId = Math.trunc(finiteNumber(value.botId, 'bot ID'));
  if (sequence <= previousSequence || tick < 0 || botId < 1 || botId > 5) throw new TypeError(`Invalid replay event ordering at ${index}.`);
  if (!ACTIONS.includes(value.action) || !CONTEXTS.includes(value.context) || !['auto', 'manual'].includes(value.source)) {
    throw new TypeError(`Invalid replay action at ${index}.`);
  }
  if (!value.before || !value.after) throw new TypeError(`Invalid replay state at ${index}.`);
  return {
    sequence, tick, botId, source: value.source, context: value.context, action: value.action,
    explored: Boolean(value.explored), reward: finiteNumber(value.reward, 'reward'),
    qBefore: finiteNumber(value.qBefore, 'Q value'), qAfter: finiteNumber(value.qAfter, 'Q value'),
    detail: String(value.detail || '').slice(0, 240),
    before: {
      hp: clamp(value.before.hp, 0, 10), energy: clamp(value.before.energy, 0, 100),
      score: finiteNumber(value.before.score || 0, 'score'), actions: Math.max(0, Math.trunc(finiteNumber(value.before.actions || 0, 'action count'))),
      deaths: Math.max(0, Math.trunc(finiteNumber(value.before.deaths || 0, 'death count'))),
      inventory: normalizeInventory(value.before.inventory), bank: normalizeInventory(value.before.bank)
    },
    after: {
      hp: clamp(value.after.hp, 0, 10), energy: clamp(value.after.energy, 0, 100),
      score: finiteNumber(value.after.score ?? ((value.before.score || 0) + Number(value.reward || 0)), 'score'),
      actions: Math.max(0, Math.trunc(finiteNumber(value.after.actions ?? ((value.before.actions || 0) + 1), 'action count'))),
      deaths: Math.max(0, Math.trunc(finiteNumber(value.after.deaths ?? (value.before.deaths || 0), 'death count'))),
      inventory: normalizeInventory(value.after.inventory), bank: normalizeInventory(value.after.bank)
    }
  };
}

function minimalBot(bot) {
  return {
    id: bot.id, name: bot.name, goal: bot.goal, hp: bot.hp, energy: bot.energy,
    inventory: copyInventory(bot.inventory), bank: copyInventory(bot.bank)
  };
}

function normalizeInitialBots(value, goals) {
  if (!Array.isArray(value) || value.length !== 5) {
    return goals.map((goal, index) => ({
      id: index + 1, name: `Learner ${index + 1}`, goal, hp: 10, energy: 100,
      inventory: { logs: 0, ores: 0, bones: 0 }, bank: { logs: 0, ores: 0, bones: 0 }
    }));
  }
  return value.map((bot, index) => ({
    id: index + 1, name: String(bot?.name || `Learner ${index + 1}`).slice(0, 40), goal: goals[index],
    hp: clamp(bot?.hp, 0, 10), energy: clamp(bot?.energy, 0, 100),
    inventory: copyInventory(bot?.inventory || {}), bank: copyInventory(bot?.bank || {})
  }));
}

function normalizeReplayData(data) {
  if (!data || data.format !== 'autoscape-learning-replay-v1' || !Array.isArray(data.events)) {
    throw new TypeError('Invalid AutoScape learning replay.');
  }
  if (data.events.length > MAX_TELEMETRY) throw new RangeError('Learning replay exceeds the 1,200-event safety limit.');
  if (!Array.isArray(data.goals) || data.goals.length !== 5 || data.goals.some(goal => !GOALS.includes(goal))) {
    throw new TypeError('Invalid replay learner goals.');
  }
  let previousSequence = 0;
  const events = data.events.map((event, index) => {
    const normalized = normalizeReplayEvent(event, index, previousSequence);
    previousSequence = normalized.sequence;
    return normalized;
  });
  return {
    format: 'autoscape-learning-replay-v1', seed: Number(data.seed) >>> 0,
    ticks: Math.max(0, Math.trunc(finiteNumber(data.ticks, 'tick count'))),
    goals: [...data.goals], initialBots: normalizeInitialBots(data.initialBots, data.goals),
    summary: Array.isArray(data.summary) ? data.summary.map(row => ({ ...row })) : [], events
  };
}

function inventoryCount(inventory) {
  return inventory.logs + inventory.ores + inventory.bones;
}

function contextFor(bot) {
  if (bot.hp <= 3) return 'low-hp';
  if (inventoryCount(bot.inventory) >= INVENTORY_LIMIT) return 'full-inventory';
  if (bot.energy <= 15) return 'low-energy';
  return 'ready';
}

function goalBias(goal, action, context) {
  const preferred = {
    woodcutting: 'chop', mining: 'mine', combat: 'fight'
  }[goal];
  if (preferred === action) return 1.25;
  if (goal === 'banking') {
    if (context === 'full-inventory' && action === 'bank') return 1.25;
    if (context === 'ready' && ['chop', 'mine', 'fight'].includes(action)) return 0.35;
  }
  if (goal === 'balanced' && ['chop', 'mine', 'fight'].includes(action)) return 0.35;
  return 0;
}

function safetyBias(context, action) {
  if (context === 'low-hp') return action === 'rest' ? 4 : (action === 'fight' ? -5 : -1);
  if (context === 'full-inventory') return action === 'bank' ? 4 : -1.5;
  if (context === 'low-energy') return action === 'rest' ? 3.5 : -1;
  return action === 'bank' ? -0.25 : 0;
}

function bestAction(bot, context) {
  let best = ACTIONS[0], bestValue = -Infinity;
  for (const action of ACTIONS) {
    const value = bot.policy[context][action] + goalBias(bot.goal, action, context) + safetyBias(context, action);
    if (value > bestValue) { best = action; bestValue = value; }
  }
  return { action: best, value: bestValue };
}

function chooseAction(bot) {
  const context = contextFor(bot);
  const epsilon = clamp(0.24 - bot.experience * 0.002, 0.05, 0.24);
  const explored = bot.rng() < epsilon;
  const action = explored ? ACTIONS[Math.floor(bot.rng() * ACTIONS.length)] : bestAction(bot, context).action;
  return { action, context, explored, epsilon };
}

function rewardFor(bot, action, result) {
  let reward = result.reward;
  if (result.success && action === 'chop' && bot.goal === 'woodcutting') reward += 1;
  if (result.success && action === 'mine' && bot.goal === 'mining') reward += 1;
  if (result.success && action === 'fight' && bot.goal === 'combat') reward += 1.25;
  if (action === 'bank' && result.deposited > 0 && bot.goal === 'banking') reward += result.deposited * 0.5;
  if (bot.goal === 'balanced' && result.success) reward += 0.25;
  return Number(reward.toFixed(3));
}

function performAction(bot, action) {
  const result = { success: false, reward: -0.2, deposited: 0, detail: '' };
  if (action === 'rest') {
    const hpBefore = bot.hp, energyBefore = bot.energy;
    bot.hp = Math.min(10, bot.hp + 3);
    bot.energy = Math.min(100, bot.energy + 28);
    result.success = bot.hp > hpBefore || bot.energy > energyBefore;
    result.reward = result.success ? 0.2 : -0.2;
    result.detail = `restored ${bot.hp - hpBefore} hp and ${bot.energy - energyBefore} energy`;
    return result;
  }
  if (action === 'bank') {
    result.deposited = inventoryCount(bot.inventory);
    for (const key of ['logs', 'ores', 'bones']) {
      bot.bank[key] += bot.inventory[key];
      bot.inventory[key] = 0;
    }
    result.success = result.deposited > 0;
    result.reward = result.success ? result.deposited * 1.5 : -0.35;
    result.detail = result.success ? `banked ${result.deposited} items` : 'nothing to bank';
    return result;
  }
  if (inventoryCount(bot.inventory) >= INVENTORY_LIMIT) {
    result.reward = -1;
    result.detail = 'inventory full';
    return result;
  }
  const costs = { chop: 5, mine: 7, fight: 9 };
  if (bot.energy < costs[action]) {
    result.reward = -0.8;
    result.detail = 'not enough energy';
    return result;
  }
  bot.energy -= costs[action];
  if (action === 'chop') {
    result.success = bot.rng() < Math.min(0.9, 0.6 + bot.skills.woodcutting * 0.025);
    if (result.success) { bot.inventory.logs++; bot.skills.woodcuttingXp++; }
    result.reward = result.success ? 1 : -0.25;
    result.detail = result.success ? 'received a log' : 'tree resisted';
  } else if (action === 'mine') {
    result.success = bot.rng() < Math.min(0.88, 0.54 + bot.skills.mining * 0.025);
    if (result.success) { bot.inventory.ores++; bot.skills.miningXp++; }
    result.reward = result.success ? 1.2 : -0.3;
    result.detail = result.success ? 'received ore' : 'rock resisted';
  } else if (action === 'fight') {
    const damage = Math.floor(bot.rng() * 4);
    bot.hp = Math.max(0, bot.hp - damage);
    result.success = bot.rng() < Math.min(0.85, 0.5 + bot.skills.combat * 0.03);
    if (bot.hp === 0) {
      bot.deaths++;
      bot.inventory = { logs: 0, ores: 0, bones: 0 };
      bot.hp = 10;
      bot.energy = 70;
      result.success = false;
      result.reward = -7;
      result.detail = 'defeated and reset';
    } else if (result.success) {
      bot.inventory.bones++;
      bot.skills.combatXp++;
      result.reward = 1.8;
      result.detail = `won fight, took ${damage} damage`;
    } else {
      result.reward = -0.6;
      result.detail = `lost exchange, took ${damage} damage`;
    }
  }
  for (const skill of ['woodcutting', 'mining', 'combat']) {
    const xpKey = `${skill}Xp`;
    bot.skills[skill] = 1 + Math.floor(bot.skills[xpKey] / 8);
  }
  return result;
}

function botSnapshot(bot) {
  const context = contextFor(bot);
  return {
    id: bot.id, name: bot.name, goal: bot.goal, mode: bot.mode,
    hp: bot.hp, energy: bot.energy, score: Number(bot.score.toFixed(3)),
    experience: bot.experience, deaths: bot.deaths,
    inventory: copyInventory(bot.inventory), bank: copyInventory(bot.bank),
    skills: { ...bot.skills }, context, decision: bot.decision,
    epsilon: clamp(0.24 - bot.experience * 0.002, 0.05, 0.24),
    bestAction: bestAction(bot, context).action,
    policy: Object.fromEntries(CONTEXTS.map(key => [key, { ...bot.policy[key] }])),
    history: bot.history.map(copyEvent)
  };
}

function createBot(index, seed, goal) {
  return {
    id: index + 1, name: `Learner ${index + 1}`, goal, mode: 'auto',
    hp: 10, energy: 100, score: 0, experience: 0, deaths: 0,
    inventory: { logs: 0, ores: 0, bones: 0 },
    bank: { logs: 0, ores: 0, bones: 0 },
    skills: { woodcutting: 1, woodcuttingXp: 0, mining: 1, miningXp: 0, combat: 1, combatXp: 0 },
    policy: emptyPolicy(), history: [], decision: 'Ready', rng: createRng(seed + (index + 1) * 0x6d2b79f5)
  };
}

export function createLearningSession(options = {}) {
  const seed = (Number(options.seed) >>> 0) || 20260815;
  const maxTicks = clamp(options.maxTicks || 10000, 1, 100000);
  const requestedGoals = Array.isArray(options.goals) ? options.goals : GOALS;
  const goals = Array.from({ length: 5 }, (_, index) => GOALS.includes(requestedGoals[index]) ? requestedGoals[index] : GOALS[index]);
  const state = {
    seed, maxTicks, tick: 0, paused: true, finished: false,
    bots: goals.map((goal, index) => createBot(index, seed, goal)), telemetry: []
  };
  const initialBots = state.bots.map(minimalBot);

  function execute(bot, action, source, explored = false) {
    if (!ACTIONS.includes(action)) throw new RangeError(`Unknown learning action: ${action}`);
    const context = contextFor(bot), before = {
      hp: bot.hp, energy: bot.energy,
      score: Number(bot.score.toFixed(3)), actions: bot.experience, deaths: bot.deaths,
      inventory: copyInventory(bot.inventory), bank: copyInventory(bot.bank)
    }, qBefore = bot.policy[context][action];
    const result = performAction(bot, action), reward = rewardFor(bot, action, result);
    const nextContext = contextFor(bot), nextBest = bestAction(bot, nextContext).value;
    bot.policy[context][action] = Number((qBefore + 0.24 * (reward + 0.82 * nextBest - qBefore)).toFixed(4));
    bot.score += reward;
    bot.experience++;
    bot.decision = `${source === 'manual' ? 'Manual' : 'Auto'} ${action}: ${result.detail}`;
    const event = {
      sequence: state.telemetry.length ? state.telemetry.at(-1).sequence + 1 : 1,
      tick: state.tick, botId: bot.id, source, context, action,
      explored: source === 'auto' ? Boolean(explored) : false,
      reward, qBefore, qAfter: bot.policy[context][action], detail: result.detail,
      before: { ...before, inventory: before.inventory, bank: before.bank },
      after: {
        hp: bot.hp, energy: bot.energy, score: Number(bot.score.toFixed(3)), actions: bot.experience, deaths: bot.deaths,
        inventory: copyInventory(bot.inventory), bank: copyInventory(bot.bank)
      }
    };
    bot.history.push(event);
    if (bot.history.length > MAX_HISTORY) bot.history.shift();
    state.telemetry.push(event);
    if (state.telemetry.length > MAX_TELEMETRY) state.telemetry.shift();
    return copyEvent(event);
  }

  function step() {
    if (state.paused || state.finished) return snapshot();
    state.tick++;
    for (const bot of state.bots) {
      if (bot.mode === 'manual') { bot.decision = 'Manual takeover — awaiting an action'; continue; }
      const choice = chooseAction(bot);
      execute(bot, choice.action, 'auto', choice.explored);
    }
    if (state.tick >= state.maxTicks) { state.finished = true; state.paused = true; }
    return snapshot();
  }

  function snapshot() {
    return {
      seed: state.seed, tick: state.tick, maxTicks: state.maxTicks,
      paused: state.paused, finished: state.finished,
      bots: state.bots.map(botSnapshot), telemetry: state.telemetry.map(copyEvent)
    };
  }

  function setManual(botId, manual = true) {
    const bot = state.bots.find(candidate => candidate.id === Number(botId));
    if (!bot) throw new RangeError(`Unknown learner: ${botId}`);
    bot.mode = manual ? 'manual' : 'auto';
    bot.decision = manual ? 'Manual takeover enabled' : 'Returned to adaptive policy';
    return botSnapshot(bot);
  }

  function manualAction(botId, action) {
    const bot = state.bots.find(candidate => candidate.id === Number(botId));
    if (!bot) throw new RangeError(`Unknown learner: ${botId}`);
    if (bot.mode !== 'manual') throw new Error('Enable manual takeover before sending an action.');
    return execute(bot, action, 'manual', false);
  }

  function summary() {
    return state.bots.map(bot => ({
      id: bot.id, name: bot.name, goal: bot.goal, score: Number(bot.score.toFixed(3)),
      actions: bot.experience, deaths: bot.deaths, banked: inventoryCount(bot.bank),
      bestReadyAction: bestAction(bot, 'ready').action
    }));
  }

  function exportReplay() {
    return {
      format: 'autoscape-learning-replay-v1', seed: state.seed, ticks: state.tick,
      goals: state.bots.map(bot => bot.goal), initialBots: initialBots.map(bot => ({ ...bot, inventory: copyInventory(bot.inventory), bank: copyInventory(bot.bank) })), summary: summary(),
      events: state.telemetry.map(copyEvent)
    };
  }

  return {
    step, snapshot, summary, exportReplay, setManual, manualAction,
    pause() { state.paused = true; return snapshot(); },
    resume() { if (!state.finished) state.paused = false; return snapshot(); },
    get paused() { return state.paused; }, get finished() { return state.finished; }
  };
}

export function createTelemetryReplay(data) {
  const normalized = normalizeReplayData(data), events = normalized.events.map(copyEvent);
  let cursor = 0;
  function current() { return cursor > 0 ? copyEvent(events[cursor - 1]) : null; }
  function state() {
    const bots = normalized.initialBots.map(bot => ({
      ...bot, inventory: copyInventory(bot.inventory), bank: copyInventory(bot.bank),
      score: 0, actions: 0, decision: 'Session start', lastAction: '', source: ''
    }));
    for (const bot of bots) {
      const first = events.find(event => event.botId === bot.id);
      if (!first) continue;
      bot.hp = first.before.hp; bot.energy = first.before.energy; bot.score = first.before.score;
      bot.actions = first.before.actions; bot.deaths = first.before.deaths;
      bot.inventory = copyInventory(first.before.inventory); bot.bank = copyInventory(first.before.bank);
    }
    let tick = 0;
    for (let index = 0; index < cursor; index++) {
      const event = events[index], bot = bots[event.botId - 1];
      tick = Math.max(tick, event.tick); bot.hp = event.after.hp; bot.energy = event.after.energy;
      bot.inventory = copyInventory(event.after.inventory); bot.bank = copyInventory(event.after.bank);
      bot.score = event.after.score; bot.actions = event.after.actions; bot.deaths = event.after.deaths;
      bot.lastAction = event.action; bot.source = event.source; bot.decision = event.detail;
    }
    return { seed: normalized.seed, tick, cursor, length: events.length, bots };
  }
  return {
    next() { return cursor < events.length ? copyEvent(events[cursor++]) : null; },
    previous() { if (cursor === 0) return null; cursor--; return current(); },
    seek(position) { cursor = Math.trunc(clamp(position, 0, events.length)); return current(); },
    current, state,
    reset() { cursor = 0; },
    get cursor() { return cursor; }, get length() { return events.length; }
  };
}

export function parseLearningReplay(text) {
  if (typeof text !== 'string' || text.length > MAX_REPLAY_TEXT) throw new RangeError('Learning replay file is empty or exceeds 2 MB.');
  let data;
  try { data = JSON.parse(text); } catch { throw new TypeError('Learning replay is not valid JSON.'); }
  return normalizeReplayData(data);
}

export function serializeLearningReplay(data) {
  return JSON.stringify(normalizeReplayData(data), null, 2);
}

export function evaluateLearningPolicies(options = {}) {
  const seeds = Array.isArray(options.seeds) && options.seeds.length
    ? options.seeds.slice(0, 12).map(seed => Number(seed) >>> 0)
    : [101, 202, 303, 404, 505];
  const ticks = Math.trunc(clamp(options.ticks || 200, 20, 2000));
  const rows = GOALS.map((goal, index) => ({
    id: index + 1, goal, score: 0, banked: 0, deaths: 0, actions: 0, goalActions: 0
  }));
  for (const seed of seeds) {
    const session = createLearningSession({ seed, maxTicks: ticks });
    session.resume();
    for (let tick = 0; tick < ticks; tick++) session.step();
    const snapshot = session.snapshot();
    for (const bot of snapshot.bots) {
      const row = rows[bot.id - 1], preferred = { woodcutting: 'chop', mining: 'mine', combat: 'fight', banking: 'bank' }[bot.goal];
      row.score += bot.score; row.banked += inventoryCount(bot.bank); row.deaths += bot.deaths; row.actions += bot.experience;
      if (preferred) row.goalActions += bot.history.filter(event => event.action === preferred).length;
    }
  }
  return {
    seeds: [...seeds], ticks,
    bots: rows.map(row => ({
      id: row.id, goal: row.goal,
      averageScore: Number((row.score / seeds.length).toFixed(2)),
      averageBanked: Number((row.banked / seeds.length).toFixed(2)),
      averageDeaths: Number((row.deaths / seeds.length).toFixed(2)),
      measuredActions: row.actions,
      recentGoalActionRate: row.goalActions ? Number((row.goalActions / Math.min(row.actions, seeds.length * MAX_HISTORY)).toFixed(3)) : null
    }))
  };
}

export const LEARNING_ACTIONS = ACTIONS;
export const LEARNING_GOALS = GOALS;
