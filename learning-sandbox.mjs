const ACTIONS = Object.freeze(['chop', 'mine', 'fight', 'bank', 'rest']);
const CONTEXTS = Object.freeze(['low-hp', 'full-inventory', 'low-energy', 'ready']);
const GOALS = Object.freeze(['woodcutting', 'mining', 'combat', 'banking', 'balanced']);
const INVENTORY_LIMIT = 8;
const MAX_HISTORY = 120;
const MAX_TELEMETRY = 1200;

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

function copyEvent(event) {
  return {
    ...event,
    before: { ...event.before, inventory: copyInventory(event.before.inventory), bank: copyInventory(event.before.bank) },
    after: { ...event.after, inventory: copyInventory(event.after.inventory), bank: copyInventory(event.after.bank) }
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

  function execute(bot, action, source, explored = false) {
    if (!ACTIONS.includes(action)) throw new RangeError(`Unknown learning action: ${action}`);
    const context = contextFor(bot), before = {
      hp: bot.hp, energy: bot.energy,
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
      before: { hp: before.hp, energy: before.energy, inventory: before.inventory, bank: before.bank },
      after: { hp: bot.hp, energy: bot.energy, inventory: copyInventory(bot.inventory), bank: copyInventory(bot.bank) }
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
      goals: state.bots.map(bot => bot.goal), summary: summary(),
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
  if (!data || data.format !== 'autoscape-learning-replay-v1' || !Array.isArray(data.events)) {
    throw new TypeError('Invalid AutoScape learning replay.');
  }
  const events = data.events.map(copyEvent);
  let cursor = 0;
  return {
    next() { return cursor < events.length ? copyEvent(events[cursor++]) : null; },
    reset() { cursor = 0; },
    get cursor() { return cursor; }, get length() { return events.length; }
  };
}

export const LEARNING_ACTIONS = ACTIONS;
export const LEARNING_GOALS = GOALS;
