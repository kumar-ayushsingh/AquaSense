/**
 * ============================================================================
 * AquaSense: AI-Powered Smart Water Leakage Detection
 * Core Application & Interactive Simulation Engine (ES6 / Canvas / Web Audio)
 * ============================================================================
 * Modules:
 *  1. AudioEngine        - Synthetic Web Audio buzzer / chimes for edge device alerts
 *  2. Config & State     - Physical constants, node telemetry buffers, global simulation state
 *  3. SignalGenerator    - Generates multi-modal sensor streams with realistic physical noise
 *  4. FusionEngine       - Persistence debounce, cross-modal corroboration, fusion scoring, trend slope
 *  5. LocalizationEngine - Time-Difference-of-Arrival (TDOA) acoustic cross-correlation
 *  6. ConventionalModel  - Legacy single-sensor baseline model for side-by-side comparison
 *  7. FloorplanRenderer  - HTML5 Canvas floor plan, pipe fluid dynamics, glowing nodes, leak ripples
 *  8. UtilityMapRenderer - 12-node Municipal District Metered Area (DMA) network
 *  9. ChartRenderer      - 4 synchronized scrolling canvas streams, gauge arc, ticket sparkline
 * 10. SimulationManager  - Scenario state machine, speed governor, auto-shutoff countdown loop
 * 11. UIManager          - UI controls, tooltips, event audit logger, service ticket & notifications
 * ============================================================================
 */

// ============================================================================
// 1. AUDIO ENGINE (Web Audio API)
// ============================================================================
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.lastBeepTime = 0;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  playClick() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.04, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.05);
  }

  playWarningPing() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const now = Date.now();
    if (now - this.lastBeepTime < 1500) return; // Debounce audio
    this.lastBeepTime = now;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(587.33, this.ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880, this.ctx.currentTime + 0.1); // A5
    gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.35);
  }

  playEmergencyBuzzer() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const now = Date.now();
    if (now - this.lastBeepTime < 800) return;
    this.lastBeepTime = now;

    // Double-pulse harsh edge buzzer
    for (let i = 0; i < 2; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      const startTime = this.ctx.currentTime + i * 0.16;
      osc.frequency.setValueAtTime(950, startTime);
      osc.frequency.setValueAtTime(750, startTime + 0.08);
      gain.gain.setValueAtTime(0.12, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.12);
    }
  }
}

// ============================================================================
// 2. CONFIG & STATE
// ============================================================================
const CONFIG = {
  // Physical pipe lengths in meters
  pipeDistanceN1N2: 12.0, // Distance between Kitchen N1 and Bathroom N2
  pipeDistanceN2N3: 8.0,  // Distance between Bathroom N2 and Utility N3
  
  // Acoustic wave speed in m/s
  waveSpeed: {
    metal: 1200.0, // Copper / Galvanized Steel (~1,200 m/s)
    pvc: 400.0     // PVC / PEX polymer pipe (~400 m/s)
  },

  // Sensor Normalization & Thresholds
  thresholds: {
    acoustic: 45.0,  // dB threshold (baseline ~18 dB)
    pressure: 42.0,  // PSI threshold (nominal 58 PSI; drops below 42 PSI on leak)
    flow: 12.0,      // LPM threshold (baseline 0 LPM, dishwasher 4-8 LPM, burst 35 LPM)
    moisture: 45.0   // % RH threshold (ambient 12-18%)
  },

  // Fusion Weights (sum = 1.0)
  weights: {
    acoustic: 0.30,
    moisture: 0.25,
    flow: 0.25,
    pressure: 0.20
  },

  // Consecutive ticks required to validate a modality vote (debouncing)
  persistenceTicksRequired: 6,

  // Maximum buffer history for scrolling line charts
  chartBufferLength: 120
};

// Global Simulation Runtime State
const state = {
  activeView: 'home',          // 'home' | 'utility'
  selectedNode: 'N1',          // 'N1' | 'N2' | 'N3'
  selectedMaterial: 'metal',   // 'metal' | 'pvc'
  simSpeed: 1,                 // 1x, 2x, 3x, 4x, 5x
  autoShutoffEnabled: true,
  compareMode: false,
  wifiConnected: true,
  activeScenario: 'normal',
  
  // Valve State: 'open' | 'closing' | 'closed'
  valveState: 'open',
  valveCountdown: 5.0,         // seconds countdown before auto shutoff
  valveTimerActive: false,

  // Calibration state
  calibrationProgress: 0,
  calibrationComplete: false,

  // Elapsed simulation seconds in current scenario
  scenarioElapsedSec: 0,

  // Nodes Data Store
  nodes: {
    N1: {
      name: 'Kitchen Sink / Dishwasher',
      acoustic: 18.0,
      pressure: 58.0,
      flow: 0.0,
      moisture: 14.0,
      history: { acoustic: [], pressure: [], flow: [], moisture: [] },
      votes: { acoustic: 0, pressure: 0, flow: 0, moisture: 0 },
      isVoting: { acoustic: false, pressure: false, flow: false, moisture: false },
      status: 'healthy' // 'healthy' | 'suspicious' | 'leak'
    },
    N2: {
      name: 'Mid-Pipe Riser (Bathroom)',
      acoustic: 17.5,
      pressure: 58.2,
      flow: 0.0,
      moisture: 12.0,
      history: { acoustic: [], pressure: [], flow: [], moisture: [] },
      votes: { acoustic: 0, pressure: 0, flow: 0, moisture: 0 },
      isVoting: { acoustic: false, pressure: false, flow: false, moisture: false },
      status: 'healthy'
    },
    N3: {
      name: 'Inlet & Water Heater (Utility)',
      acoustic: 19.0,
      pressure: 58.5,
      flow: 0.0,
      moisture: 15.0,
      history: { acoustic: [], pressure: [], flow: [], moisture: [] },
      votes: { acoustic: 0, pressure: 0, flow: 0, moisture: 0 },
      isVoting: { acoustic: false, pressure: false, flow: false, moisture: false },
      status: 'healthy'
    }
  },

  // Fusion & Alert State
  fusionScore: 12.0,
  scoreHistory: [],
  trendSlope: 0.0,
  trendDirection: 'steady',    // 'rising' | 'steady' | 'falling'
  severity: 'nominal',         // 'nominal' | 'seep' | 'drip' | 'moderate' | 'burst'
  activeVoteCount: 0,
  corroboratedAlert: false,

  // TDOA Localization Result
  tdoa: {
    active: false,
    delaySeconds: 0,
    distanceFromN1: 0,
    errorMargin: 0.35,
    nodePair: 'N1-N2',
    pipeXRatio: 0.358 // Relative x on floorplan pipe segment
  },

  // Service ticket
  serviceTicket: {
    id: '#AQ-8492',
    timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
    location: 'Residential Pipe Corridor',
    severity: 'NOMINAL',
    dispatched: false
  },

  // Conventional (Legacy) Detector State for Compare Mode
  conventional: {
    alarm: false,
    falseAlarm: false,
    missedLeak: false,
    statusText: 'NORMAL',
    desc: 'Monitoring acoustic threshold only. No cross-modal corroboration.'
  },

  // Utility DMA State
  utility: {
    nodesCount: 12,
    leakSegmentIndex: -1,
    leakActive: false,
    leakRateM3Day: 450,
    isolatedValves: []
  }
};

// Initialize empty rolling chart buffers
for (let n of ['N1', 'N2', 'N3']) {
  for (let k of ['acoustic', 'pressure', 'flow', 'moisture']) {
    state.nodes[n].history[k] = new Array(CONFIG.chartBufferLength).fill(0);
  }
}

// ============================================================================
// 3. SIGNAL GENERATOR (Physics & Stochastic Noise)
// ============================================================================
class SignalGenerator {
  static gaussianNoise(mean = 0, stdev = 1) {
    const u1 = Math.max(1e-6, Math.random());
    const u2 = Math.random();
    return mean + stdev * Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  }

  static updateSignals(dt) {
    state.scenarioElapsedSec += dt * state.simSpeed;
    const t = state.scenarioElapsedSec;
    const isValveClosed = state.valveState === 'closed';

    // Baseline targets for each node
    for (let nodeKey of ['N1', 'N2', 'N3']) {
      const node = state.nodes[nodeKey];

      let targetAcoustic = 18.0 + SignalGenerator.gaussianNoise(0, 1.2);
      let targetPressure = isValveClosed ? 0.0 : (58.0 + SignalGenerator.gaussianNoise(0, 0.4));
      let targetFlow = isValveClosed ? 0.0 : (0.0 + Math.max(0, SignalGenerator.gaussianNoise(0, 0.05)));
      let targetMoisture = 14.0 + SignalGenerator.gaussianNoise(0, 0.8);

      // Apply Scenario Mutators
      switch (state.activeScenario) {
        case 'normal':
          // Standard tranquil baseline
          break;

        case 'slow_drip':
          // Slow drip at Kitchen N1:
          // Sub-meter flow (<0.05 LPM), steady micro-acoustic rise (~18 -> 48 dB),
          // localized moisture builds gradually from 14% to cross 45% threshold at ~38-40s.
          if (nodeKey === 'N1') {
            const acousticBase = Math.min(48.0, 18.0 + (t / 40.0) * 28.0);
            const dripCycle = (Math.sin(t * 3.5) > 0.6) ? 3.5 : 0;
            targetAcoustic = (isValveClosed ? 18.0 : acousticBase + dripCycle) + SignalGenerator.gaussianNoise(0, 0.8);
            
            // Moisture rises steadily; reaches 45% threshold right at t ≈ 38.5s
            const moistureRamp = Math.min(88.0, 14.0 + (t / 40.0) * 32.5 + Math.max(0, (t - 40.0) * 1.2));
            targetMoisture = moistureRamp + SignalGenerator.gaussianNoise(0, 0.4);

            // Flow stays negligible (undetectable by legacy meters < 0.05 LPM)
            targetFlow = isValveClosed ? 0.0 : 0.03 + Math.max(0, SignalGenerator.gaussianNoise(0, 0.008));
            targetPressure = isValveClosed ? 0.0 : 57.8 + SignalGenerator.gaussianNoise(0, 0.3);
          } else if (nodeKey === 'N2') {
            // N2 picks up faint acoustic pulse attenuated over distance
            targetAcoustic = (isValveClosed ? 17.5 : Math.min(24.0, 18.0 + (t / 40.0) * 6.0)) + SignalGenerator.gaussianNoise(0, 0.8);
          }
          break;

        case 'burst':
          // Catastrophic Pipe Burst at N3 / Utility line:
          // Sudden severe pressure drop to 20 PSI, flow surge to 36 LPM, violent acoustic roar ~82 dB.
          if (!isValveClosed) {
            targetAcoustic = 82.0 + SignalGenerator.gaussianNoise(0, 2.5);
            targetPressure = Math.max(18, 58.0 - Math.min(38, t * 15)) + SignalGenerator.gaussianNoise(0, 1.0);
            targetFlow = Math.min(36, t * 18) + SignalGenerator.gaussianNoise(0, 1.2);
            targetMoisture = Math.min(94, 20 + t * 25) + SignalGenerator.gaussianNoise(0, 1.0);
          } else {
            // Valve has closed! Flow immediately plummets to 0, pressure to 0, acoustic drops to quiet baseline
            targetAcoustic = 20.0 + SignalGenerator.gaussianNoise(0, 1.0);
            targetPressure = 2.0;
            targetFlow = 0.0;
            targetMoisture = Math.max(65, 94 - (t - 5) * 1.5); // moisture dries slowly
          }
          break;

        case 'dishwasher':
          // Dishwasher running at N1 (Kitchen) with NO LEAK:
          // High acoustic churn (~68-72 dB), periodic appliance fill flow (5-7 LPM).
          // CRITICAL: Moisture remains totally dry (13%), pressure fluctuates normally (52-56 PSI).
          if (nodeKey === 'N1') {
            const washPhase = Math.sin(t * 0.8);
            targetAcoustic = 68.0 + 6.0 * washPhase + SignalGenerator.gaussianNoise(0, 2.0);
            targetFlow = isValveClosed ? 0.0 : (5.5 + 1.5 * Math.cos(t * 0.8));
            targetPressure = isValveClosed ? 0.0 : (54.0 + 1.2 * Math.sin(t * 1.2));
            targetMoisture = 13.5 + SignalGenerator.gaussianNoise(0, 0.5); // DRY!
          } else if (nodeKey === 'N2') {
            targetAcoustic = 38.0 + SignalGenerator.gaussianNoise(0, 1.5);
          }
          break;

        case 'mid_leak':
          // Concealed pipe leak between N1 and N2 (corridor riser):
          // Acoustic waves propagate along pipe to both N1 and N2 with a time difference.
          // Moisture rises moderately near pipe passage, pressure dips slightly.
          if (nodeKey === 'N1' || nodeKey === 'N2') {
            const distFactor = nodeKey === 'N1' ? 1.0 : 0.85;
            targetAcoustic = (isValveClosed ? 18 : 62.0 * distFactor) + SignalGenerator.gaussianNoise(0, 2.0);
            targetPressure = isValveClosed ? 0.0 : (48.0 - (isValveClosed ? 0 : 9.0));
            targetFlow = isValveClosed ? 0.0 : 3.8 + SignalGenerator.gaussianNoise(0, 0.3);
            targetMoisture = 52.0 + SignalGenerator.gaussianNoise(0, 1.2);
          }
          break;

        case 'wifi_out':
          // Wi-Fi severed during active leak:
          // Pipe leak occurs, but cloud icon is dead; on-device TinyML handles alert locally.
          if (nodeKey === 'N2') {
            targetAcoustic = (isValveClosed ? 18 : 65.0) + SignalGenerator.gaussianNoise(0, 2.0);
            targetPressure = isValveClosed ? 0.0 : 38.0 + SignalGenerator.gaussianNoise(0, 1.0);
            targetFlow = isValveClosed ? 0.0 : 6.5;
            targetMoisture = 60.0;
          }
          break;

        case 'calibration':
          // PVC Pipe Calibration Mode:
          // Simulate machine learning baseline learning convergence.
          targetAcoustic = 22.0 + Math.sin(t * 2) * (1 - state.calibrationProgress / 100) * 8.0 + SignalGenerator.gaussianNoise(0, 1.0);
          targetPressure = 58.0 + SignalGenerator.gaussianNoise(0, 0.4);
          targetFlow = 0.0;
          targetMoisture = 14.0;
          break;
      }

      // Smooth Low-Pass Filter step to emulate transducer inertia
      const alpha = 0.25;
      node.acoustic += (targetAcoustic - node.acoustic) * alpha;
      node.pressure += (targetPressure - node.pressure) * alpha;
      node.flow += (targetFlow - node.flow) * alpha;
      node.moisture += (targetMoisture - node.moisture) * alpha;

      // Bound values
      node.acoustic = Math.max(0, Math.min(100, node.acoustic));
      node.pressure = Math.max(0, Math.min(80, node.pressure));
      node.flow = Math.max(0, Math.min(50, node.flow));
      node.moisture = Math.max(0, Math.min(100, node.moisture));

      // Append to rolling history
      node.history.acoustic.push(node.acoustic);
      node.history.acoustic.shift();
      node.history.pressure.push(node.pressure);
      node.history.pressure.shift();
      node.history.flow.push(node.flow);
      node.history.flow.shift();
      node.history.moisture.push(node.moisture);
      node.history.moisture.shift();
    }
  }
}

// ============================================================================
// 4. FUSION ENGINE (Cross-Modal Corroboration & Scoring)
// ============================================================================
class FusionEngine {
  static evaluate() {
    const inspected = state.nodes[state.selectedNode];
    const th = CONFIG.thresholds;
    const reqTicks = CONFIG.persistenceTicksRequired;

    // 1. Evaluate Individual Modality Voting Criteria
    // Acoustic: exceeds threshold
    const acousticExceeded = inspected.acoustic >= th.acoustic;
    inspected.votes.acoustic = acousticExceeded ? Math.min(reqTicks + 2, inspected.votes.acoustic + 1) : Math.max(0, inspected.votes.acoustic - 1);
    inspected.isVoting.acoustic = inspected.votes.acoustic >= reqTicks;

    // Pressure: drops below threshold (inverted check)
    const pressureExceeded = inspected.pressure <= th.pressure && state.valveState !== 'closed';
    inspected.votes.pressure = pressureExceeded ? Math.min(reqTicks + 2, inspected.votes.pressure + 1) : Math.max(0, inspected.votes.pressure - 1);
    inspected.isVoting.pressure = inspected.votes.pressure >= reqTicks;

    // Flow: exceeds flow threshold
    const flowExceeded = inspected.flow >= th.flow;
    inspected.votes.flow = flowExceeded ? Math.min(reqTicks + 2, inspected.votes.flow + 1) : Math.max(0, inspected.votes.flow - 1);
    inspected.isVoting.flow = inspected.votes.flow >= reqTicks;

    // Moisture: exceeds moisture threshold
    const moistureExceeded = inspected.moisture >= th.moisture;
    inspected.votes.moisture = moistureExceeded ? Math.min(reqTicks + 2, inspected.votes.moisture + 1) : Math.max(0, inspected.votes.moisture - 1);
    inspected.isVoting.moisture = inspected.votes.moisture >= reqTicks;

    // 2. Count Active Distinct Modality Votes
    let activeVotes = 0;
    if (inspected.isVoting.acoustic) activeVotes++;
    if (inspected.isVoting.pressure) activeVotes++;
    if (inspected.isVoting.flow) activeVotes++;
    if (inspected.isVoting.moisture) activeVotes++;
    state.activeVoteCount = activeVotes;

    // 3. Compute Weighted Multi-Modal Fusion Score (0 - 100)
    // Normalize each signal into 0-100 hazard scale
    const sAcoustic = Math.max(0, Math.min(100, (inspected.acoustic - 18) * 1.3));
    const sPressure = state.valveState === 'closed' ? 0 : Math.max(0, Math.min(100, (58 - inspected.pressure) * 2.5));
    const sFlow = Math.max(0, Math.min(100, inspected.flow * 2.8));
    const sMoisture = Math.max(0, Math.min(100, (inspected.moisture - 14) * 1.25));

    const w = CONFIG.weights;
    let rawScore = (sAcoustic * w.acoustic) + (sPressure * w.pressure) + (sFlow * w.flow) + (sMoisture * w.moisture);

    // Apply Corroboration Gating Rule:
    // If only 1 modality is voting, cap score at 48 (Suspicious, no alert!)
    if (activeVotes === 0) {
      rawScore = Math.min(28, rawScore);
    } else if (activeVotes === 1) {
      rawScore = Math.min(48, Math.max(32, rawScore));
    } else {
      // 2 or more modalities corroborate! Allow full scale
      rawScore = Math.max(52, rawScore);
    }

    state.fusionScore = Math.round(rawScore);
    state.scoreHistory.push(state.fusionScore);
    if (state.scoreHistory.length > 30) state.scoreHistory.shift();

    // 4. Calculate Rate of Change / Trend Slope (dS/dt)
    if (state.scoreHistory.length >= 6) {
      const recent = state.scoreHistory[state.scoreHistory.length - 1];
      const past = state.scoreHistory[state.scoreHistory.length - 6];
      state.trendSlope = (recent - past) / 1.5; // points per second approx
      if (state.trendSlope > 1.2) {
        state.trendDirection = 'rising';
      } else if (state.trendSlope < -1.2) {
        state.trendDirection = 'falling';
      } else {
        state.trendDirection = 'steady';
      }
    }

    // 5. Grade Severity
    if (state.activeVoteCount < 2) {
      if (state.activeVoteCount === 1) {
        state.severity = 'seep';
        inspected.status = 'suspicious';
      } else {
        state.severity = 'nominal';
        inspected.status = 'healthy';
      }
      state.corroboratedAlert = false;
    } else {
      // Confirmed Alert (>= 2 votes)
      inspected.status = 'leak';
      state.corroboratedAlert = true;

      if (state.fusionScore >= 85 || (inspected.isVoting.flow && inspected.isVoting.pressure)) {
        state.severity = 'burst';
      } else if (state.fusionScore >= 70) {
        state.severity = 'moderate';
      } else if (state.fusionScore >= 50) {
        state.severity = 'drip';
      } else {
        state.severity = 'seep';
      }
    }

    // Sync node status for all nodes
    for (let k of ['N1', 'N2', 'N3']) {
      if (k !== state.selectedNode) {
        const other = state.nodes[k];
        let votes = 0;
        if (other.acoustic >= th.acoustic) votes++;
        if (other.pressure <= th.pressure && state.valveState !== 'closed') votes++;
        if (other.flow >= th.flow) votes++;
        if (other.moisture >= th.moisture) votes++;
        other.status = votes >= 2 ? 'leak' : (votes === 1 ? 'suspicious' : 'healthy');
      }
    }
  }
}

// ============================================================================
// 5. LOCALIZATION ENGINE (TDOA Cross-Correlation)
// ============================================================================
class LocalizationEngine {
  static compute() {
    // Check if inter-node leak scenario or multiple nodes have elevated acoustic signals
    const n1 = state.nodes.N1;
    const n2 = state.nodes.N2;

    if (state.activeScenario === 'mid_leak' || (n1.acoustic > 35 && n2.acoustic > 35)) {
      state.tdoa.active = true;
      const D = CONFIG.pipeDistanceN1N2; // 12.0 meters
      const v = CONFIG.waveSpeed[state.selectedMaterial]; // 1,200 or 400 m/s

      // Synthetic acoustic peak arrival delay:
      // Suppose leak is at x = 4.3 meters from N1.
      // Distance from N1 is x, distance from N2 is (D - x) = 7.7 m.
      // Time to N1: t1 = 4.3 / v. Time to N2: t2 = 7.7 / v.
      // Delta t = t2 - t1 = (7.7 - 4.3) / v = 3.4 / v.
      const trueX = 4.3;
      const theoreticalDt = (D - 2.0 * trueX) / v;
      // Add realistic measurement jitter (+- 0.15 ms)
      const measuredDt = theoreticalDt + SignalGenerator.gaussianNoise(0, 0.00015);

      // Solve for x: x = (D - v * dt) / 2
      const calculatedX = Math.max(0.5, Math.min(D - 0.5, (D - v * measuredDt) / 2.0));
      const margin = state.selectedMaterial === 'metal' ? 0.35 : 0.65; // PVC has higher dispersion

      state.tdoa.delaySeconds = measuredDt;
      state.tdoa.distanceFromN1 = calculatedX;
      state.tdoa.errorMargin = margin;
      state.tdoa.pipeXRatio = calculatedX / D;
    } else {
      state.tdoa.active = false;
    }
  }
}

// ============================================================================
// 6. CONVENTIONAL DETECTOR MODEL (Compare Mode)
// ============================================================================
class ConventionalModel {
  static update() {
    if (!state.compareMode) return;

    // The legacy single-sensor detector relies only on acoustic / single flow threshold
    const n1 = state.nodes.N1;
    const c = state.conventional;

    if (state.activeScenario === 'dishwasher') {
      // Dishwasher: Legacy detector raises FALSE ALARM because acoustic > 65 dB
      c.alarm = true;
      c.falseAlarm = true;
      c.missedLeak = false;
      c.statusText = 'FALSE ALARM!';
      c.desc = 'CRITICAL: Single acoustic/flow sensor tripped by dishwasher wash cycle. Nuisance shutoff triggered!';
    } else if (state.activeScenario === 'slow_drip') {
      // Slow drip: Legacy flow meter has cutoff at 0.05 LPM; misses drip entirely!
      c.alarm = false;
      c.falseAlarm = false;
      c.missedLeak = true;
      c.statusText = 'LEAK MISSED';
      c.desc = 'FAILURE: Flow < 0.05 LPM and puck is 2ft away on dry tile. Slow seep continues undetected for 4 months.';
    } else if (state.activeScenario === 'burst') {
      // Burst: Legacy detector takes 15-30 minutes of cloud analysis before sending an alert
      c.alarm = true;
      c.falseAlarm = false;
      c.missedLeak = false;
      c.statusText = 'CLOUD DELAY (18m)';
      c.desc = 'ALERT DELAYED: High flow sent to remote cloud. SMS queued after 18 minutes of flooding.';
    } else {
      c.alarm = false;
      c.falseAlarm = false;
      c.missedLeak = false;
      c.statusText = 'NORMAL';
      c.desc = 'Monitoring single acoustic threshold. No corroboration or localization capability.';
    }
  }
}

// ============================================================================
// 7. FLOORPLAN RENDERER (Canvas & Fluid Dynamics)
// ============================================================================
class FloorplanRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fluidPhase = 0;
    this.rippleRadius = 0;
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // 1. Draw Architectural Floor Plan Layout
    this.drawRooms(ctx, w, h);

    // 2. Draw Pipes & Water Fluid Particle Flow
    this.drawPipes(ctx, w, h);

    // 3. Draw Sensor Nodes (N1, N2, N3)
    this.drawNodes(ctx, w, h);

    // 4. Draw Leak Localization Marker if Active
    this.drawLeakMarker(ctx, w, h);

    // Advance fluid animation phase if valve is open
    if (state.valveState === 'open') {
      this.fluidPhase += 0.08 * state.simSpeed;
    }
    this.rippleRadius = (this.rippleRadius + 0.6 * state.simSpeed) % 28;
  }

  drawRooms(ctx, w, h) {
    // Background Grid lines
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Room Boundaries (Walls)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 2;

    // Kitchen Room (Top Left)
    ctx.strokeRect(30, 30, 280, 180);
    // Bathroom / Corridor (Top Right)
    ctx.strokeRect(330, 30, 320, 180);
    // Utility Room (Bottom Left)
    ctx.strokeRect(30, 230, 380, 160);
    // Living / Main Hall (Bottom Right)
    ctx.strokeRect(430, 230, 220, 160);

    // Doors / Passages
    ctx.fillStyle = '#060e1a';
    ctx.fillRect(150, 208, 40, 6);
    ctx.fillRect(480, 208, 40, 6);
  }

  drawPipes(ctx, w, h) {
    // Pipe Coordinates:
    // Main supply enters at Utility Room N3: (80, 310)
    // Runs right to corridor junction: (380, 310)
    // Runs upward through bathroom N2: (380, 120)
    // Branches left to kitchen sink N1: (170, 120)

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Outer Pipe Casement
    ctx.strokeStyle = '#0A1F3D';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(80, 310);
    ctx.lineTo(380, 310);
    ctx.lineTo(380, 120);
    ctx.lineTo(170, 120);
    ctx.stroke();

    // Inner Water Channel
    const isClosed = state.valveState === 'closed';
    ctx.strokeStyle = isClosed ? '#0E2A52' : '#1072BB';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(80, 310);
    ctx.lineTo(380, 310);
    ctx.lineTo(380, 120);
    ctx.lineTo(170, 120);
    ctx.stroke();

    // Water Flow Pulse / Dashes (halted when valve closed)
    if (!isClosed) {
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 4;
      ctx.setLineDash([8, 14]);
      ctx.lineDashOffset = -this.fluidPhase * 14;
      ctx.beginPath();
      ctx.moveTo(80, 310);
      ctx.lineTo(380, 310);
      ctx.lineTo(380, 120);
      ctx.lineTo(170, 120);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Main Valve Symbol at (110, 310)
    this.drawValveGraphic(ctx, 110, 310, isClosed);

    ctx.restore();
  }

  drawValveGraphic(ctx, x, y, isClosed) {
    ctx.save();
    ctx.fillStyle = isClosed ? '#F93E5E' : '#02CE80';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;

    // Draw butterfly valve hourglass
    ctx.beginPath();
    ctx.moveTo(x - 12, y - 10);
    ctx.lineTo(x + 12, y + 10);
    ctx.lineTo(x + 12, y - 10);
    ctx.lineTo(x - 12, y + 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Valve stem
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 14);
    ctx.stroke();

    ctx.fillStyle = isClosed ? '#F93E5E' : '#02CE80';
    ctx.beginPath();
    ctx.arc(x, y - 15, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  drawNodes(ctx, w, h) {
    // Node Locations:
    // N1: (170, 120) Kitchen Sink
    // N2: (380, 120) Bathroom / Corridor Riser
    // N3: (80, 310)  Utility / Inlet
    const coords = {
      N1: { x: 170, y: 120 },
      N2: { x: 380, y: 120 },
      N3: { x: 80, y: 310 }
    };

    for (let key of ['N1', 'N2', 'N3']) {
      const pt = coords[key];
      const node = state.nodes[key];
      const isSelected = state.selectedNode === key;

      // Determine color from node status (aquasense.tech palette)
      let color = '#02CE80'; // healthy green
      if (node.status === 'suspicious') color = '#F2994A'; // amber
      if (node.status === 'leak') color = '#F93E5E';       // red

      ctx.save();

      // Selected Halo
      if (isSelected) {
        ctx.strokeStyle = '#2F80ED';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 22, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Outer Glowing Ring
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 14, 0, Math.PI * 2);
      ctx.fill();

      // Solid Center Core
      ctx.globalAlpha = 1.0;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Node Label
      ctx.font = 'bold 11px SF Mono, monospace';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(key, pt.x, pt.y - 16);

      ctx.restore();
    }
  }

  drawLeakMarker(ctx, w, h) {
    if (!state.corroboratedAlert && !state.tdoa.active && state.activeScenario !== 'slow_drip') return;

    let leakX = 170;
    let leakY = 120;

    if (state.activeScenario === 'burst') {
      leakX = 80;
      leakY = 310;
    } else if (state.tdoa.active) {
      // Pipe runs between N1 (170, 120) and N2 (380, 120)
      // distance D = 12m. calculatedX from N1
      const xOffset = (state.tdoa.distanceFromN1 / CONFIG.pipeDistanceN1N2) * (380 - 170);
      leakX = 170 + xOffset;
      leakY = 120;
    }

    ctx.save();

    // Pulsing acoustic/water ripples
    ctx.strokeStyle = '#F93E5E';
    ctx.lineWidth = 2;
    ctx.globalAlpha = Math.max(0, 1 - this.rippleRadius / 28);
    ctx.beginPath();
    ctx.arc(leakX, leakY, this.rippleRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(leakX, leakY, Math.max(0, this.rippleRadius - 10), 0, Math.PI * 2);
    ctx.stroke();

    // Cross-hair marker
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(leakX - 10, leakY);
    ctx.lineTo(leakX + 10, leakY);
    ctx.moveTo(leakX, leakY - 10);
    ctx.lineTo(leakX, leakY + 10);
    ctx.stroke();

    // TDOA Confidence Bracket if TDOA is active
    if (state.tdoa.active) {
      const marginPx = (state.tdoa.errorMargin / CONFIG.pipeDistanceN1N2) * (380 - 170);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
      ctx.fillStyle = 'rgba(16, 114, 187, 0.18)';
      ctx.strokeRect(leakX - marginPx, leakY - 12, marginPx * 2, 24);
      ctx.fillRect(leakX - marginPx, leakY - 12, marginPx * 2, 24);

      // Bracket Label
      ctx.font = '10px SF Mono, monospace';
      ctx.fillStyle = '#38BDF8';
      ctx.textAlign = 'center';
      ctx.fillText(`±${state.tdoa.errorMargin}m (${state.tdoa.distanceFromN1.toFixed(1)}m from N1)`, leakX, leakY + 28);
    }

    ctx.restore();
  }
}

// ============================================================================
// 8. UTILITY MAP RENDERER (District Metered Area DMA)
// ============================================================================
class UtilityMapRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pulsePhase = 0;

    // 12 DMA Distribution Nodes
    this.nodes = [
      { id: 'J1', x: 80, y: 80, name: 'Reservoir Station' },
      { id: 'J2', x: 220, y: 80, name: 'North Trunk A' },
      { id: 'J3', x: 380, y: 80, name: 'North Trunk B' },
      { id: 'J4', x: 560, y: 80, name: 'Northeast Station' },
      { id: 'J5', x: 80, y: 210, name: 'West Commercial' },
      { id: 'J6', x: 220, y: 210, name: 'Central Sector 1' },
      { id: 'J7', x: 380, y: 210, name: 'Central Sector 2' },
      { id: 'J8', x: 560, y: 210, name: 'East Residential' },
      { id: 'J9', x: 80, y: 340, name: 'Southwest Pump' },
      { id: 'J10', x: 220, y: 340, name: 'South Spine A' },
      { id: 'J11', x: 380, y: 340, name: 'South Spine B' },
      { id: 'J12', x: 560, y: 340, name: 'Southeast Sub' }
    ];

    // Pipe Segments Connecting Nodes
    this.segments = [
      [0, 1], [1, 2], [2, 3],
      [4, 5], [5, 6], [6, 7],
      [8, 9], [9, 10], [10, 11],
      [0, 4], [4, 8],
      [1, 5], [5, 9],
      [2, 6], [6, 10],
      [3, 7], [7, 11]
    ];
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Grid backdrop
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Draw Main Pipes
    this.segments.forEach(([idxA, idxB], segIdx) => {
      const a = this.nodes[idxA];
      const b = this.nodes[idxB];
      const isLeaking = state.utility.leakActive && state.utility.leakSegmentIndex === segIdx;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = isLeaking ? 7 : 4;
      ctx.strokeStyle = isLeaking ? '#F93E5E' : '#1072BB';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      if (isLeaking) {
        // Acoustic shock wave emission along pipe
        ctx.strokeStyle = '#FFB539';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 8]);
        ctx.lineDashOffset = -this.pulsePhase * 8;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    });

    // Draw 12 DMA Nodes
    this.nodes.forEach((n, idx) => {
      ctx.save();
      const isNearLeak = state.utility.leakActive && 
        this.segments[state.utility.leakSegmentIndex] && 
        this.segments[state.utility.leakSegmentIndex].includes(idx);

      ctx.fillStyle = isNearLeak ? '#F93E5E' : '#2F80ED';
      ctx.beginPath();
      ctx.arc(n.x, n.y, isNearLeak ? 9 : 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Node ID Label
      ctx.font = 'bold 10px SF Mono, monospace';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(n.id, n.x, n.y - 12);

      ctx.restore();
    });

    this.pulsePhase += 0.08 * state.simSpeed;
  }

  injectLeak(segmentIdx = 5) {
    state.utility.leakActive = true;
    state.utility.leakSegmentIndex = segmentIdx;
    const seg = this.segments[segmentIdx];
    const nA = this.nodes[seg[0]].id;
    const nB = this.nodes[seg[1]].id;
    document.getElementById('dma-isolated-segment').textContent = `Segment ${nA} ↔ ${nB} (Loss: 450 m³/day)`;
    UIManager.logEvent(`[DMA Sector 7] Main rupture injected on trunk ${nA} ↔ ${nB}. Cross-correlating wave fronts...`, 'alarm');
  }

  reset() {
    state.utility.leakActive = false;
    state.utility.leakSegmentIndex = -1;
    document.getElementById('dma-isolated-segment').textContent = 'None (Grid Nominal)';
    UIManager.logEvent('[DMA Sector 7] Grid pressure normalized across all 12 nodes.', 'success');
  }
}

// ============================================================================
// 9. CHART RENDERER (4 Synchronized Canvas Streams & Gauge)
// ============================================================================
class ChartRenderer {
  static drawStream(canvasId, dataBuffer, threshold, minVal, maxVal, colorHex, unitLabel) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Subtle horizontal gridlines (3 lines)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.25); ctx.lineTo(w, h * 0.25);
    ctx.moveTo(0, h * 0.50); ctx.lineTo(w, h * 0.50);
    ctx.moveTo(0, h * 0.75); ctx.lineTo(w, h * 0.75);
    ctx.stroke();

    // Dashed Threshold Line
    const threshRatio = (threshold - minVal) / (maxVal - minVal);
    const threshY = Math.max(4, Math.min(h - 4, h - threshRatio * h));

    ctx.save();
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.45)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, threshY);
    ctx.lineTo(w, threshY);
    ctx.stroke();
    ctx.restore();

    // Plot Data Line
    const len = dataBuffer.length;
    if (len < 2) return;

    ctx.save();
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let i = 0; i < len; i++) {
      const x = (i / (len - 1)) * w;
      const normalized = (dataBuffer[i] - minVal) / (maxVal - minVal);
      const y = Math.max(2, Math.min(h - 2, h - normalized * h));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Soft gradient under the curve
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, colorHex + '33');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fill();

    // Leading Edge Dot
    const latestVal = dataBuffer[len - 1];
    const latestNorm = (latestVal - minVal) / (maxVal - minVal);
    const leadY = Math.max(2, Math.min(h - 2, h - latestNorm * h));

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(w - 3, leadY, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  static drawGauge(canvasId, score) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h - 14;
    const radius = 64;
    const startAngle = Math.PI * 0.9;
    const endAngle = Math.PI * 2.1;

    // Background track arc
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.stroke();

    // Score fill arc
    const scoreRatio = Math.max(0, Math.min(100, score)) / 100;
    const fillEnd = startAngle + (endAngle - startAngle) * scoreRatio;

    let arcColor = '#02CE80'; // Green
    if (score >= 80) arcColor = '#F93E5E'; // Red
    else if (score >= 60) arcColor = '#F2994A'; // Orange
    else if (score >= 40) arcColor = '#FFB539'; // Amber
    else if (score >= 25) arcColor = '#1072BB'; // Cyan

    ctx.strokeStyle = arcColor;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, fillEnd);
    ctx.stroke();

    ctx.restore();
  }

  static drawSparkline(canvasId, buffer) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const len = buffer.length;
    if (len < 2) return;

    ctx.strokeStyle = '#1072BB';
    ctx.lineWidth = 1.8;
    ctx.beginPath();

    for (let i = 0; i < len; i++) {
      const x = (i / (len - 1)) * w;
      const y = h - (buffer[i] / 100) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// ============================================================================
// 10. SIMULATION MANAGER (Scenarios & Timing Loop)
// ============================================================================
class SimulationManager {
  constructor() {
    this.floorplanRenderer = null;
    this.utilityRenderer = null;
    this.lastFrameTime = performance.now();
    this.audio = new AudioEngine();
  }

  init() {
    const fpCanvas = document.getElementById('floorplan-canvas');
    if (fpCanvas) this.floorplanRenderer = new FloorplanRenderer(fpCanvas);

    const utilCanvas = document.getElementById('utility-map-canvas');
    if (utilCanvas) this.utilityRenderer = new UtilityMapRenderer(utilCanvas);

    // Start 60fps Loop
    requestAnimationFrame((t) => this.tick(t));
  }

  setScenario(name) {
    state.activeScenario = name;
    state.scenarioElapsedSec = 0;
    state.valveState = 'open';
    state.valveCountdown = 5.0;
    state.valveTimerActive = false;

    // Reset node buffers for smooth transition
    for (let k of ['N1', 'N2', 'N3']) {
      state.nodes[k].votes = { acoustic: 0, pressure: 0, flow: 0, moisture: 0 };
      state.nodes[k].isVoting = { acoustic: false, pressure: false, flow: false, moisture: false };
      state.nodes[k].status = 'healthy';
    }

    // Wi-Fi status handle
    if (name === 'wifi_out') {
      state.wifiConnected = false;
      UIManager.setWifiStatus(false);
      UIManager.logEvent('[Wi-Fi Disconnected] Cloud unreachable. Node switched to 100% on-device TinyML autonomy.', 'warn');
    } else {
      if (!state.wifiConnected) {
        state.wifiConnected = true;
        UIManager.setWifiStatus(true);
        UIManager.logEvent('[Wi-Fi Restored] Cloud sync resumed. Local event buffer offloaded successfully.', 'success');
      }
    }

    // Calibration scenario handle
    const calibCard = document.getElementById('calibration-card');
    if (name === 'calibration') {
      state.calibrationProgress = 0;
      state.calibrationComplete = false;
      if (calibCard) calibCard.classList.remove('hidden');
      UIManager.logEvent('[Calibration Started] Initializing 48-hr adaptive baseline on PVC pipe...', 'info');
    } else {
      if (calibCard) calibCard.classList.add('hidden');
    }

    // Hide burst countdown banner if active
    const countdownBanner = document.getElementById('burst-countdown-banner');
    if (countdownBanner) countdownBanner.classList.add('hidden');

    UIManager.updateScenarioUI(name);
    UIManager.logEvent(`Scenario switched to: ${name.toUpperCase().replace('_', ' ')}`, 'info');
    this.audio.playClick();
  }

  tick(currentTime) {
    const dt = Math.min(0.1, (currentTime - this.lastFrameTime) / 1000.0);
    this.lastFrameTime = currentTime;

    // 1. Update Physics and Telemetry
    SignalGenerator.updateSignals(dt);

    // 2. Evaluate Fusion & Corroboration Engine
    FusionEngine.evaluate();

    // 3. Compute TDOA Localization
    LocalizationEngine.compute();

    // 4. Update Conventional Model for Compare Mode
    ConventionalModel.update();

    // 5. Handle Calibration Progress in Calibration Mode
    if (state.activeScenario === 'calibration' && !state.calibrationComplete) {
      state.calibrationProgress += dt * 8.0 * state.simSpeed;
      if (state.calibrationProgress >= 100) {
        state.calibrationProgress = 100;
        state.calibrationComplete = true;
        UIManager.logEvent('[Calibration Complete] Ambient noise floor locked at 22.4 dB. Adaptive threshold established.', 'success');
      }
      UIManager.updateCalibrationUI();
    }

    // 6. Handle Burst Countdown & Auto Shutoff
    this.handleAutoShutoff(dt);

    // 7. Render Active Canvas Views
    if (state.activeView === 'home' && this.floorplanRenderer) {
      this.floorplanRenderer.render();
    } else if (state.activeView === 'utility' && this.utilityRenderer) {
      this.utilityRenderer.render();
    }

    // 8. Render Synchronized Scrolling Telemetry Charts
    this.renderTelemetryCharts();

    // 9. Update UI Dashboard & Notification Displays
    UIManager.updateDashboard();

    // Continue loop
    requestAnimationFrame((t) => this.tick(t));
  }

  handleAutoShutoff(dt) {
    const banner = document.getElementById('burst-countdown-banner');
    const isBurst = state.severity === 'burst' && state.valveState === 'open';

    if (isBurst && state.autoShutoffEnabled) {
      if (!state.valveTimerActive) {
        state.valveTimerActive = true;
        state.valveCountdown = 5.0;
        if (banner) banner.classList.remove('hidden');
        UIManager.logEvent('[CRITICAL BURST] Autonomous shutoff armed! 5-second countdown started.', 'alarm');
        this.audio.playEmergencyBuzzer();
      }

      state.valveCountdown -= dt * state.simSpeed;
      if (state.valveCountdown <= 0) {
        state.valveCountdown = 0;
        state.valveState = 'closed';
        state.valveTimerActive = false;
        if (banner) banner.classList.add('hidden');
        UIManager.setValveUI(false);
        UIManager.logEvent('[EMERGENCY SHUTOFF] Motorized main valve CLOSED. Zero flow verified.', 'alarm');
        this.audio.playWarningPing();
      }

      // Update countdown banner text and progress fill
      const secDigit = document.getElementById('countdown-seconds');
      const fillBar = document.getElementById('countdown-progress-fill');
      if (secDigit) secDigit.textContent = state.valveCountdown.toFixed(1);
      if (fillBar) fillBar.style.width = `${(state.valveCountdown / 5.0) * 100}%`;
    } else {
      if (state.valveTimerActive && (!isBurst || !state.autoShutoffEnabled)) {
        state.valveTimerActive = false;
        if (banner) banner.classList.add('hidden');
      }
    }
  }

  renderTelemetryCharts() {
    const node = state.nodes[state.selectedNode];
    const th = CONFIG.thresholds;

    // Draw the 4 live canvas lines
    ChartRenderer.drawStream('chart-acoustic', node.history.acoustic, th.acoustic, 0, 100, '#2F80ED', 'dB');
    ChartRenderer.drawStream('chart-pressure', node.history.pressure, th.pressure, 0, 80, '#8B5CF6', 'PSI');
    ChartRenderer.drawStream('chart-flow', node.history.flow, th.flow, 0, 45, '#38bdf8', 'LPM');
    ChartRenderer.drawStream('chart-moisture', node.history.moisture, th.moisture, 0, 100, '#02CE80', '% RH');

    // Draw Fusion Score Gauge
    ChartRenderer.drawGauge('gauge-canvas', state.fusionScore);

    // Draw mini sparkline in Service Ticket
    ChartRenderer.drawSparkline('ticket-sparkline', node.history.acoustic);
  }
}

// ============================================================================
// 11. UI MANAGER (DOM Bindings & Component Controls)
// ============================================================================
class UIManager {
  static eventLogs = [];

  static init(sim) {
    UIManager.sim = sim;

    // View Tabs (Home vs Utility DMA)
    const tabHome = document.getElementById('tab-home-btn');
    const tabUtility = document.getElementById('tab-utility-btn');
    const homeView = document.getElementById('home-view-container');
    const utilView = document.getElementById('utility-view-container');

    tabHome.addEventListener('click', () => {
      state.activeView = 'home';
      tabHome.classList.add('active');
      tabUtility.classList.remove('active');
      homeView.classList.remove('hidden');
      utilView.classList.add('hidden');
      sim.audio.playClick();
    });

    tabUtility.addEventListener('click', () => {
      state.activeView = 'utility';
      tabUtility.classList.add('active');
      tabHome.classList.remove('active');
      homeView.classList.add('hidden');
      utilView.classList.remove('hidden');
      sim.audio.playClick();
    });

    // Material Selector (Metal vs PVC)
    const matSelect = document.getElementById('pipe-material-select');
    matSelect.addEventListener('change', (e) => {
      state.selectedMaterial = e.target.value;
      UIManager.logEvent(`Pipe wave velocity updated to ${CONFIG.waveSpeed[state.selectedMaterial]} m/s (${state.selectedMaterial.toUpperCase()})`, 'info');
      sim.audio.playClick();
    });

    // Simulation Speed Slider
    const speedSlider = document.getElementById('sim-speed-slider');
    const speedVal = document.getElementById('speed-val');
    speedSlider.addEventListener('input', (e) => {
      state.simSpeed = parseInt(e.target.value, 10);
      speedVal.textContent = `${state.simSpeed}x`;
    });

    // Auto-Shutoff Toggle
    const autoShutoffToggle = document.getElementById('auto-shutoff-toggle');
    autoShutoffToggle.addEventListener('change', (e) => {
      state.autoShutoffEnabled = e.target.checked;
      UIManager.logEvent(`Autonomous shutoff valve: ${state.autoShutoffEnabled ? 'ENABLED' : 'DISABLED'}`, 'info');
      sim.audio.playClick();
    });

    // Compare Mode Toggle
    const compareToggle = document.getElementById('compare-mode-toggle');
    const comparePanel = document.getElementById('compare-mode-panel');
    compareToggle.addEventListener('change', (e) => {
      state.compareMode = e.target.checked;
      if (state.compareMode) {
        comparePanel.classList.remove('hidden');
        UIManager.logEvent('Side-by-side Benchmark mode activated (Single-Sensor vs AquaSense).', 'info');
      } else {
        comparePanel.classList.add('hidden');
      }
      sim.audio.playClick();
    });

    // Audio Buzzer Toggle
    const audioBtn = document.getElementById('audio-toggle-btn');
    const iconOn = document.getElementById('audio-icon-on');
    const iconOff = document.getElementById('audio-icon-off');
    audioBtn.addEventListener('click', () => {
      const isEnabled = sim.audio.toggle();
      iconOn.classList.toggle('hidden', !isEnabled);
      iconOff.classList.toggle('hidden', isEnabled);
      UIManager.logEvent(`Edge buzzer audio sound ${isEnabled ? 'UNMUTED' : 'MUTED'}.`, 'info');
    });

    // Scenario Buttons
    document.querySelectorAll('.scenario-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const scenario = btn.getAttribute('data-scenario');
        sim.setScenario(scenario);
      });
    });

    // Node Selector Pills
    document.querySelectorAll('.node-pill-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const node = btn.getAttribute('data-node');
        state.selectedNode = node;
        document.querySelectorAll('.node-pill-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('chart-node-label').textContent = `${node} (${state.nodes[node].name})`;
        sim.audio.playClick();
      });
    });

    // Burst Countdown Cancel & Immediate Shutoff Buttons
    const cancelShutoffBtn = document.getElementById('cancel-shutoff-btn');
    if (cancelShutoffBtn) {
      cancelShutoffBtn.addEventListener('click', () => {
        state.valveTimerActive = false;
        state.autoShutoffEnabled = false;
        document.getElementById('auto-shutoff-toggle').checked = false;
        document.getElementById('burst-countdown-banner').classList.add('hidden');
        UIManager.logEvent('[USER OVERRIDE] Auto-shutoff CANCELLED by homeowner. Valve remains open.', 'warn');
        sim.audio.playClick();
      });
    }

    const immShutoffBtn = document.getElementById('immediate-shutoff-btn');
    if (immShutoffBtn) {
      immShutoffBtn.addEventListener('click', () => {
        state.valveCountdown = 0;
        state.valveState = 'closed';
        state.valveTimerActive = false;
        document.getElementById('burst-countdown-banner').classList.add('hidden');
        UIManager.setValveUI(false);
        UIManager.logEvent('[USER OVERRIDE] Manual valve closure confirmed immediately.', 'alarm');
        sim.audio.playWarningPing();
      });
    }

    // Floorplan Valve Toggle Widget
    const valveWidget = document.getElementById('valve-widget');
    if (valveWidget) {
      valveWidget.addEventListener('click', () => {
        if (state.valveState === 'open') {
          state.valveState = 'closed';
          UIManager.setValveUI(false);
          UIManager.logEvent('[Main Valve] Manually closed by user.', 'warn');
        } else {
          state.valveState = 'open';
          UIManager.setValveUI(true);
          UIManager.logEvent('[Main Valve] Manually reopened by user. Pressure restoring...', 'success');
        }
        sim.audio.playClick();
      });
    }

    // Floorplan Interactive Click (Select node or inspect segment)
    const fpCanvas = document.getElementById('floorplan-canvas');
    if (fpCanvas) {
      fpCanvas.addEventListener('click', (e) => {
        const rect = fpCanvas.getBoundingClientRect();
        const scaleX = fpCanvas.width / rect.width;
        const scaleY = fpCanvas.height / rect.height;
        const clickX = (e.clientX - rect.left) * scaleX;
        const clickY = (e.clientY - rect.top) * scaleY;

        // Check if clicked near N1, N2, or N3
        const distN1 = Math.hypot(clickX - 170, clickY - 120);
        const distN2 = Math.hypot(clickX - 380, clickY - 120);
        const distN3 = Math.hypot(clickX - 80, clickY - 310);

        if (distN1 < 36) UIManager.selectNode('N1');
        else if (distN2 < 36) UIManager.selectNode('N2');
        else if (distN3 < 36) UIManager.selectNode('N3');
      });
    }

    // Utility District DMA Buttons
    const injectUtilBtn = document.getElementById('inject-utility-leak-btn');
    if (injectUtilBtn) {
      injectUtilBtn.addEventListener('click', () => {
        sim.utilityRenderer.injectLeak(5);
        sim.audio.playEmergencyBuzzer();
      });
    }

    const resetUtilBtn = document.getElementById('reset-utility-btn');
    if (resetUtilBtn) {
      resetUtilBtn.addEventListener('click', () => {
        sim.utilityRenderer.reset();
        sim.audio.playClick();
      });
    }

    // Pipeline Step Click Inspector
    document.querySelectorAll('.pipeline-step').forEach((step) => {
      step.addEventListener('click', () => {
        const stepNum = parseInt(step.getAttribute('data-step'), 10);
        UIManager.selectPipelineStep(stepNum, true);
        sim.audio.playClick();
      });
    });

    // Start Sequential Auto-Highlight of Pipeline
    UIManager.startPipelineAutoCycle();

    // Clear Audit Log Button
    const clearLogBtn = document.getElementById('clear-log-btn');
    if (clearLogBtn) {
      clearLogBtn.addEventListener('click', () => {
        UIManager.eventLogs = [];
        document.getElementById('event-log-stream').innerHTML = '';
        document.getElementById('log-count-badge').textContent = '0 events';
      });
    }

    // Service Ticket Actions
    const dispatchPlumberBtn = document.getElementById('dispatch-plumber-btn');
    if (dispatchPlumberBtn) {
      dispatchPlumberBtn.addEventListener('click', () => {
        state.serviceTicket.dispatched = true;
        const statusPill = document.getElementById('dispatch-status-pill');
        statusPill.textContent = '✓ Dispatched: AquaPro Plumbers (ETA 20m)';
        statusPill.classList.add('dispatched');
        UIManager.showToast('Plumber Dispatched', `Service ticket ${state.serviceTicket.id} transmitted to rapid response team with sub-meter leak coordinates.`);
        UIManager.logEvent(`[Service Dispatch] Service request ${state.serviceTicket.id} sent to emergency dispatch queue.`, 'success');
        sim.audio.playClick();
      });
    }

    const downloadTicketBtn = document.getElementById('download-ticket-btn');
    if (downloadTicketBtn) {
      downloadTicketBtn.addEventListener('click', () => {
        UIManager.showToast('Diagnostic Exported', 'Acoustic waveform trace, TDOA offset & pressure history logged to diagnostic file.');
        sim.audio.playClick();
      });
    }

    // Phone Notification Actions
    const notifShutoff = document.getElementById('notif-confirm-shutoff');
    if (notifShutoff) {
      notifShutoff.addEventListener('click', () => {
        state.valveState = 'closed';
        UIManager.setValveUI(false);
        UIManager.logEvent('[Mobile App] Homeowner triggered valve shutoff via push alert.', 'alarm');
        sim.audio.playWarningPing();
      });
    }

    const notifDismiss = document.getElementById('notif-dismiss');
    if (notifDismiss) {
      notifDismiss.addEventListener('click', () => {
        UIManager.showToast('Alert Dismissed', 'Notification dismissed on mobile client.');
        sim.audio.playClick();
      });
    }

    // Setup Custom Tooltips
    UIManager.setupTooltips();

    // Initial log
    UIManager.logEvent('AquaSense Core Engine initialized. 4 edge transducers active at 200 Hz.', 'success');
  }

  static selectNode(nodeKey) {
    state.selectedNode = nodeKey;
    document.querySelectorAll('.node-pill-btn').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-node') === nodeKey);
    });
    document.getElementById('chart-node-label').textContent = `${nodeKey} (${state.nodes[nodeKey].name})`;
    UIManager.sim.audio.playClick();
  }

  static userPausedPipeline = false;
  static userPausedTimer = 0;
  static currentPipelineStep = 1;

  static startPipelineAutoCycle() {
    setInterval(() => {
      if (UIManager.userPausedPipeline) {
        UIManager.userPausedTimer--;
        if (UIManager.userPausedTimer <= 0) {
          UIManager.userPausedPipeline = false;
        }
        return;
      }
      UIManager.currentPipelineStep = (UIManager.currentPipelineStep % 6) + 1;
      UIManager.selectPipelineStep(UIManager.currentPipelineStep, false);
    }, 3800);
  }

  static selectPipelineStep(stepNum, fromUser = false) {
    UIManager.currentPipelineStep = stepNum;
    if (fromUser) {
      UIManager.userPausedPipeline = true;
      UIManager.userPausedTimer = 5; // Pause auto-rotation for 5 cycles (~19s)
    }

    document.querySelectorAll('.pipeline-step').forEach((s) => {
      s.classList.toggle('active', parseInt(s.getAttribute('data-step'), 10) === stepNum);
    });

    const badge = document.getElementById('detail-step-badge');
    const sub = document.getElementById('detail-subtitle');
    const title = document.getElementById('detail-title');
    const desc = document.getElementById('detail-desc');
    const meta = document.getElementById('detail-meta');

    const details = [
      {
        badge: 'Stage 01',
        sub: 'High-Fidelity Edge Telemetry Ingestion',
        title: 'Continuous Multi-Physical Data Acquisition',
        desc: 'Four orthogonal sensor streams are sampled at 200 Hz: piezo-acoustic pipe vibrations (1–15 kHz), inline strain pressure (PSI), differential magnetic turbine flow (LPM), and galvanic moisture pins (RH%).',
        meta: ['Sampling: 200 Hz', 'Sensors: Piezo + Piezoresistive + Hall + Conductive', 'Power: 85 mW (Solar/Battery)']
      },
      {
        badge: 'Stage 02',
        sub: 'Ultra-Low-Power Neural Inference',
        title: 'On-Device TinyML Pattern Recognition',
        desc: 'Quantized 8-bit convolutional model runs on an ARM Cortex-M4 microcontroller without cloud access. Separates continuous hydrodynamic noise from pipe fissure harmonics in under 12 milliseconds.',
        meta: ['Memory: 64 KB RAM', 'Latency: 12 ms', 'Model: 8-bit INT Quantized CNN']
      },
      {
        badge: 'Stage 03',
        sub: 'Multi-Modal Corroboration Engine',
        title: 'Zero False-Alarm Corroboration Rule (≥ 2 Modalities)',
        desc: 'Strict logical gate: an alert is prohibited unless at least two distinct modalities independently vote. Single-sensor spikes (e.g. dishwasher cycles or mopped floors) are instantly suppressed.',
        meta: ['Voting Rule: ≥ 2 Modalities Required', 'False Alarms: 0.18%', 'Debounce: 6 Consecutive Cycles']
      },
      {
        badge: 'Stage 04',
        sub: 'Severity & Dynamic Trend Scoring',
        title: 'Continuous Risk Grading & Rate-of-Change Slope (dS/dt)',
        desc: 'Replaces crude binary alarms with a 4-tier health scale (Seep, Drip, Moderate, Burst) combined with a real-time trend vector (Rising ↗, Steady →, Falling ↘) to prioritize critical leaks.',
        meta: ['Tiers: Seep (30-49) → Burst (85-100)', 'Trend: dS/dt Slope Vector', 'Confidence: 99.8%']
      },
      {
        badge: 'Stage 05',
        sub: 'Time-Difference-of-Arrival (TDOA)',
        title: 'Sub-Meter Acoustic Localization Along Pipe Walls',
        desc: 'By measuring the microsecond acoustic delay between adjacent nodes using x = (D - v·Δt) / 2, AquaSense computes the exact leak coordinates along copper (1,200 m/s) or PVC (400 m/s) with sub-meter accuracy.',
        meta: ['Formula: x = (D - v·Δt) / 2', 'Accuracy: ±0.35 meters', 'Material Profiles: Metal & PVC']
      },
      {
        badge: 'Stage 06',
        sub: 'Closed-Loop Mitigation & Service Dispatch',
        title: 'Fail-Safe Motorized Shutoff & Automated Diagnostic Ticket',
        desc: 'On burst alerts, a 5-second countdown allows homeowner cancellation before autonomous valve closure. Simultaneously creates a diagnostic dispatch ticket with localized coordinates for plumbing technicians.',
        meta: ['Shutoff Delay: < 5.0 Seconds', 'Countdown: Tap-to-Cancel', 'Dispatch: Automated Plumber PDF']
      }
    ];

    const d = details[stepNum - 1];
    if (d) {
      badge.textContent = d.badge;
      sub.textContent = d.sub;
      title.textContent = d.title;
      desc.textContent = d.desc;
      meta.innerHTML = d.meta.map((m) => `<span class="meta-pill">${m}</span>`).join('');
    }
  }

  static updateScenarioUI(name) {
    document.querySelectorAll('.scenario-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-scenario') === name);
    });
    const badge = document.getElementById('active-scenario-badge');
    if (badge) badge.textContent = name.toUpperCase().replace('_', ' ');
  }

  static updateCalibrationUI() {
    const pct = Math.round(state.calibrationProgress);
    const fillBar = document.getElementById('calib-fill-bar');
    const pctText = document.getElementById('calib-pct-text');
    const phaseText = document.getElementById('calib-phase-text');
    const floorText = document.getElementById('calib-floor-text');
    const threshText = document.getElementById('calib-threshold-text');

    if (fillBar) fillBar.style.width = `${pct}%`;
    if (pctText) pctText.textContent = `${pct}%`;

    if (pct < 30) {
      if (phaseText) phaseText.textContent = 'Listening to ambient acoustic background...';
      if (floorText) floorText.textContent = 'Measuring...';
      if (threshText) threshText.textContent = 'Default (45 dB)';
    } else if (pct < 80) {
      if (phaseText) phaseText.textContent = 'Profiling diurnal pressure cycles...';
      if (floorText) floorText.textContent = '21.8 dB';
      if (threshText) threshText.textContent = 'Adapting (38.5 dB)';
    } else {
      if (phaseText) phaseText.textContent = 'Optimal PVC baseline locked in ROM.';
      if (floorText) floorText.textContent = '22.4 dB (±1.1)';
      if (threshText) threshText.textContent = 'Calibrated (36.0 dB)';
    }
  }

  static setValveUI(isOpen) {
    const icon = document.getElementById('valve-icon');
    const text = document.getElementById('valve-state-text');
    if (icon) icon.className = isOpen ? 'valve-icon' : 'valve-icon closed';
    if (text) {
      text.className = isOpen ? 'valve-state open' : 'valve-state closed';
      text.textContent = isOpen ? 'OPEN (100%)' : 'CLOSED (0%)';
    }
  }

  static setWifiStatus(isConnected) {
    const widget = document.getElementById('wifi-widget');
    const label = document.getElementById('wifi-label-text');
    if (widget) widget.classList.toggle('disconnected', !isConnected);
    if (label) label.textContent = isConnected ? 'Edge Connected' : 'Wi-Fi Severed (Offline Mode)';
  }

  static updateDashboard() {
    const inspected = state.nodes[state.selectedNode];

    // Readout numbers above live charts
    const aVal = document.getElementById('val-trace-acoustic');
    const pVal = document.getElementById('val-trace-pressure');
    const fVal = document.getElementById('val-trace-flow');
    const mVal = document.getElementById('val-trace-moisture');

    if (aVal) aVal.textContent = `${inspected.acoustic.toFixed(1)} dB`;
    if (pVal) pVal.textContent = `${inspected.pressure.toFixed(1)} PSI`;
    if (fVal) fVal.textContent = `${inspected.flow.toFixed(1)} LPM`;
    if (mVal) mVal.textContent = `${inspected.moisture.toFixed(0)}% RH`;

    // Chart Row Voting Pills
    UIManager.setPillState('vote-pill-acoustic', inspected.isVoting.acoustic);
    UIManager.setPillState('vote-pill-pressure', inspected.isVoting.pressure);
    UIManager.setPillState('vote-pill-flow', inspected.isVoting.flow);
    UIManager.setPillState('vote-pill-moisture', inspected.isVoting.moisture);

    // Corroboration 4-Modality Matrix Badges
    UIManager.setModalBadge('modal-badge-acoustic', inspected.isVoting.acoustic, `m-val-acoustic`, `${inspected.acoustic.toFixed(0)} dB (Th: >45)`);
    UIManager.setModalBadge('modal-badge-pressure', inspected.isVoting.pressure, `m-val-pressure`, `${inspected.pressure.toFixed(0)} PSI (Th: <42)`);
    UIManager.setModalBadge('modal-badge-flow', inspected.isVoting.flow, `m-val-flow`, `${inspected.flow.toFixed(1)} LPM (Th: >12)`);
    UIManager.setModalBadge('modal-badge-moisture', inspected.isVoting.moisture, `m-val-moisture`, `${inspected.moisture.toFixed(0)}% RH (Th: >45)`);

    // Vote Summary Bar
    const voteCount = document.getElementById('vote-count-text');
    const voteStatusTag = document.getElementById('vote-status-tag');
    if (voteCount) voteCount.textContent = `${state.activeVoteCount} / 4 ${state.activeVoteCount >= 2 ? '(ALERT)' : (state.activeVoteCount === 1 ? '(Suspicious)' : '(Safe)')}`;
    if (voteStatusTag) {
      if (state.activeVoteCount >= 2) {
        voteStatusTag.className = 'vote-status-tag alert';
        voteStatusTag.textContent = 'CONFIRMED LEAK';
      } else if (state.activeVoteCount === 1) {
        voteStatusTag.className = 'vote-status-tag suspicious';
        voteStatusTag.textContent = 'SUSPICIOUS (SUPPRESSED)';
      } else {
        voteStatusTag.className = 'vote-status-tag safe';
        voteStatusTag.textContent = 'NORMAL';
      }
    }

    // Fusion Score Number & Severity Badges
    const gaugeNum = document.getElementById('gauge-number');
    const sevPill = document.getElementById('severity-badge-pill');
    const trendPill = document.getElementById('trend-badge-pill');

    if (gaugeNum) gaugeNum.textContent = state.fusionScore;
    if (sevPill) {
      sevPill.className = `severity-badge-pill ${state.severity}`;
      sevPill.textContent = state.severity.toUpperCase();
    }
    if (trendPill) {
      trendPill.className = `trend-badge-pill ${state.trendDirection}`;
      const arrow = state.trendDirection === 'rising' ? '↗ Rising' : (state.trendDirection === 'falling' ? '↘ Falling' : '→ Steady');
      trendPill.textContent = arrow;
    }

    // Top Sim Status Bar
    const topDot = document.getElementById('sim-overall-status-dot');
    const topText = document.getElementById('sim-overall-status-text');
    if (topDot && topText) {
      if (state.corroboratedAlert) {
        topDot.className = 'badge-status-dot red';
        topText.textContent = `CRITICAL ALERT • ${state.severity.toUpperCase()} DETECTED (${inspected.name})`;
      } else if (state.activeVoteCount === 1) {
        topDot.className = 'badge-status-dot amber';
        topText.textContent = `EVALUATING • SINGLE MODALITY SPIKE SUPPRESSED (${inspected.name})`;
      } else {
        topDot.className = 'badge-status-dot green';
        topText.textContent = 'SYSTEM ONLINE • NORMAL OPERATION';
      }
    }

    // TDOA Localization Metric Readout
    const tdoaVal = document.getElementById('tdoa-val-display');
    if (tdoaVal) {
      if (state.tdoa.active) {
        tdoaVal.textContent = `Δt = ${(state.tdoa.delaySeconds * 1000).toFixed(2)} ms | x = ${state.tdoa.distanceFromN1.toFixed(2)} m (±${state.tdoa.errorMargin}m from N1)`;
      } else {
        tdoaVal.textContent = 'No acoustic wave delta between nodes';
      }
    }

    // Compare Mode Panel Sync
    if (state.compareMode) {
      UIManager.updateCompareModeUI();
    }

    // Phone Notification & Service Ticket Sync
    UIManager.updateNotificationAndTicket();
  }

  static setPillState(id, isVoting) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = isVoting ? 'VOTING' : 'NORMAL';
    el.className = isVoting ? 'vote-state-pill active' : 'vote-state-pill';
  }

  static setModalBadge(badgeId, isVoting, textId, textVal) {
    const badge = document.getElementById(badgeId);
    const textEl = document.getElementById(textId);
    if (badge) badge.classList.toggle('voting', isVoting);
    if (textEl) textEl.textContent = textVal;
  }

  static updateCompareModeUI() {
    const c = state.conventional;
    const legStatus = document.getElementById('legacy-status-pill');
    const legDesc = document.getElementById('legacy-behavior-desc');
    const legAlarm = document.getElementById('legacy-alarm-text');
    const legRisk = document.getElementById('legacy-risk-text');

    if (legStatus) legStatus.textContent = c.statusText;
    if (legDesc) legDesc.textContent = c.desc;
    if (legAlarm) legAlarm.textContent = c.alarm ? 'YES (Triggered)' : 'NO';
    if (legRisk) legRisk.textContent = c.falseAlarm ? 'CRITICAL (False Alarm!)' : (c.missedLeak ? 'SEVERE (Leak Missed!)' : 'Moderate');

    const aquaStatus = document.getElementById('aqua-status-pill');
    const aquaDesc = document.getElementById('aqua-behavior-desc');
    const aquaCorr = document.getElementById('aqua-corr-text');
    const aquaLoc = document.getElementById('aqua-loc-text');

    if (aquaStatus) aquaStatus.textContent = state.corroboratedAlert ? 'CONFIRMED' : (state.activeVoteCount === 1 ? 'SUPPRESSED' : 'NORMAL');
    if (aquaDesc) {
      if (state.activeScenario === 'dishwasher') {
        aquaDesc.textContent = 'Acoustic spike isolated; moisture & pressure dry. False alarm suppressed!';
      } else if (state.activeScenario === 'slow_drip') {
        aquaDesc.textContent = 'Micro-acoustic pulses corroborate rising galvanic moisture wick. Drip flagged.';
      } else {
        aquaDesc.textContent = '4-modality fusion active. Zero false triggers under normal ambient noise.';
      }
    }
    if (aquaCorr) aquaCorr.textContent = `${state.activeVoteCount}/4 Votes (${state.activeVoteCount >= 2 ? 'Alerting' : 'Safe'})`;
    if (aquaLoc) aquaLoc.textContent = state.tdoa.active ? `Locked (±${state.tdoa.errorMargin}m)` : 'Armed';
  }

  static updateNotificationAndTicket() {
    const clock = document.getElementById('phone-clock');
    if (clock) {
      const now = new Date();
      clock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    const notifTitle = document.getElementById('notif-title-text');
    const notifTag = document.getElementById('notif-severity-tag');
    const notifMsg = document.getElementById('notif-message-text');
    const notifLoc = document.getElementById('notif-loc-text');
    const notifConf = document.getElementById('notif-conf-text');

    const ticketLoc = document.getElementById('ticket-location-text');
    const ticketDist = document.getElementById('ticket-distance-text');
    const ticketSev = document.getElementById('ticket-severity-pill');
    const ticketTrend = document.getElementById('ticket-trend-text');
    const ticketRemedy = document.getElementById('ticket-remedy-text');

    if (state.corroboratedAlert) {
      const locName = state.tdoa.active ? `Corridor Pipe Riser (Between N1 & N2)` : state.nodes[state.selectedNode].name;
      if (notifTitle) notifTitle.textContent = `${state.severity.toUpperCase()} Alert Confirmed`;
      if (notifTag) {
        notifTag.className = 'severity-tag alert';
        notifTag.textContent = state.severity.toUpperCase();
      }
      if (notifMsg) notifMsg.textContent = `Cross-modal criteria confirmed leak at ${locName}. Immediate attention recommended.`;
      if (notifLoc) notifLoc.textContent = locName;
      if (notifConf) notifConf.textContent = '99.8%';

      // Service Ticket update
      if (ticketLoc) ticketLoc.textContent = locName;
      if (ticketDist) ticketDist.textContent = state.tdoa.active ? `Exact offset: ${state.tdoa.distanceFromN1.toFixed(1)}m from N1 (±${state.tdoa.errorMargin}m)` : 'Direct node attachment';
      if (ticketSev) {
        ticketSev.className = `severity-badge-pill ${state.severity}`;
        ticketSev.textContent = state.severity.toUpperCase();
      }
      if (ticketTrend) ticketTrend.textContent = `Trend slope: ${state.trendSlope >= 0 ? '+' : ''}${state.trendSlope.toFixed(1)}/s (${state.trendDirection})`;
      if (ticketRemedy) {
        if (state.severity === 'burst') ticketRemedy.textContent = 'Critical rupture detected. Motorized valve shutoff actuated. Dispatch certified plumber immediately.';
        else ticketRemedy.textContent = 'Localized pipe fitting seep. Inspect joint seal or compression ring within 24 hours.';
      }
    } else {
      if (notifTitle) notifTitle.textContent = state.activeVoteCount === 1 ? 'Single Sensor Noise Suppressed' : 'Water Infrastructure Nominal';
      if (notifTag) {
        notifTag.className = 'severity-tag nominal';
        notifTag.textContent = state.activeVoteCount === 1 ? 'FILTERED' : 'NORMAL';
      }
      if (notifMsg) notifMsg.textContent = state.activeVoteCount === 1 ? 'Single modality spike detected (e.g. appliance noise). No leak corroborated.' : 'All nodes operating within normal baselines. Zero leaks detected.';
      if (notifLoc) notifLoc.textContent = 'Whole Home Grid';
      if (notifConf) notifConf.textContent = '100%';

      if (ticketLoc) ticketLoc.textContent = 'Residential Pipe Corridor';
      if (ticketDist) ticketDist.textContent = 'Whole system healthy';
      if (ticketSev) {
        ticketSev.className = 'severity-badge-pill nominal';
        ticketSev.textContent = 'NOMINAL';
      }
      if (ticketTrend) ticketTrend.textContent = 'Rate of change: 0.0%/s (Steady)';
      if (ticketRemedy) ticketRemedy.textContent = 'No maintenance required. Pipe integrity verified across all acoustic and pressure transducers.';
    }
  }

  static logEvent(message, type = 'info') {
    const timestamp = new Date().toTimeString().split(' ')[0];
    const entry = { time: timestamp, msg: message, type: type };
    UIManager.eventLogs.unshift(entry);
    if (UIManager.eventLogs.length > 50) UIManager.eventLogs.pop();

    const stream = document.getElementById('event-log-stream');
    const badge = document.getElementById('log-count-badge');
    if (!stream) return;

    const row = document.createElement('div');
    row.className = 'log-entry';
    row.innerHTML = `<span class="log-time">[${timestamp}]</span> <span class="log-msg ${type}">${message}</span>`;
    stream.insertBefore(row, stream.firstChild);

    if (badge) badge.textContent = `${UIManager.eventLogs.length} events`;
  }

  static showToast(title, desc) {
    const modal = document.getElementById('toast-modal');
    const tTitle = document.getElementById('toast-title');
    const tDesc = document.getElementById('toast-desc');
    const closeBtn = document.getElementById('toast-close-btn');

    if (!modal) return;
    if (tTitle) tTitle.textContent = title;
    if (tDesc) tDesc.textContent = desc;

    modal.classList.remove('hidden');

    const hide = () => modal.classList.add('hidden');
    closeBtn.onclick = hide;
    setTimeout(hide, 4500);
  }

  static setupTooltips() {
    const tooltip = document.getElementById('dynamic-tooltip');
    if (!tooltip) return;

    document.querySelectorAll('.help-tooltip').forEach((el) => {
      el.addEventListener('mouseenter', (e) => {
        const text = el.getAttribute('data-tooltip');
        if (!text) return;
        tooltip.textContent = text;
        tooltip.classList.add('show');
        const rect = el.getBoundingClientRect();
        tooltip.style.left = `${Math.min(window.innerWidth - 300, rect.left + 15)}px`;
        tooltip.style.top = `${rect.top - 10}px`;
      });

      el.addEventListener('mouseleave', () => {
        tooltip.classList.remove('show');
      });
    });
  }
}

// ============================================================================
// BOOTSTRAP APPLICATION
// ============================================================================
window.addEventListener('DOMContentLoaded', () => {
  const sim = new SimulationManager();
  sim.init();
  UIManager.init(sim);
});
