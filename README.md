# AquaSense: AI-Powered Smart Water Leakage Detection

> **Next-Generation Multi-Modal Edge AI Water Telemetry, Cross-Modal Corroboration & Autonomous Mitigation**  
> *Design Thinking Capstone Project, 2026*

---

## 🌊 Overview

Existing residential and municipal water leak detectors rely on **a single isolated signal**—typically a floor moisture contact puck or an in-line impeller flow meter. Consequently:
- **They miss silent, catastrophic leaks**: Micro-fissures and wall seeps flow at rates below the flow meter's minimum physical measurement limit (< 0.05 LPM), remaining undetected for 3 to 6 months until mold rots the walls or water bills surge.
- **They trigger frequent nuisance false alarms**: Appliance wash cycles (dishwashers, washing machines, irrigation) or floor cleaning trip single thresholds, causing homeowners to unplug the detectors out of alarm fatigue.
- **Municipalities lose water at planetary scale**: Over **126 billion cubic meters** of treated drinking water are lost every year to distribution leaks before ever reaching a paying tap—a global Non-Revenue Water (NRW) crisis costing over **$39 Billion USD annually**.

**AquaSense** resolves this by embedding **multi-modal edge AI** on low-cost pipe clip-on sensor nodes. AquaSense synchronously fuses **piezo-acoustic vibration**, **in-line pressure**, **flow rate**, and **conductive moisture**. It requires **cross-modal corroboration** before raising an alert, grades risk with a **severity tier and real-time trend vector**, pinpoints the fissure via **TDOA acoustic cross-correlation**, and initiates a **5-second tap-to-cancel auto-shutoff** and **automated plumber diagnostic ticket**.

---

## 🚀 How to Run the Simulation

AquaSense is built with **100% vanilla web standards** (HTML5, modern CSS3, ES6 JavaScript, HTML5 Canvas, and the Web Audio API). There are **no build tools, no node dependencies, and zero external API calls**.

1. Double-click or open `index.html` directly in any modern web browser (Google Chrome, Microsoft Edge, Firefox, or Safari).
2. The simulation will boot instantly in dark mode at 60 fps.
3. Click **"Launch Simulation"** or scroll to the interactive workbench.

---

## 🧠 System Architecture: The 6-Stage Loop

```
[01 Sensor Capture] ──> [02 Edge AI Inference] ──> [03 Cross-Modal Corroboration]
  Acoustic (1-15kHz)       TinyML on Cortex-M4           ≥ 2 Modality Voting Rule
  Pressure (PSI)           12ms Local Latency            (Suppresses False Alarms)
  Flow (LPM)
  Moisture (RH%)
           │
           ▼
[06 Shutoff & Dispatch] <── [05 TDOA Localization] <── [04 Severity & Trend Scoring]
  5s Cancel Countdown        x = (D - v·Δt) / 2          Seep / Drip / Moderate / Burst
  Motorized Valve Actuation  ±0.35m Sub-Meter Pinpoint   Rate-of-Change Slope (dS/dt)
  Auto Plumber Ticket
```

1. **Stage 01: Multi-Modal Sensor Capture**: Four orthogonal physical streams sampled at 200 Hz.
2. **Stage 02: On-Device TinyML Inference**: Quantized 8-bit convolutional model running on low-power ARM Cortex-M4 (<100 mW) without cloud latency or dependency.
3. **Stage 03: Cross-Modal Corroboration Gate**: Alert prohibited unless $\ge 2$ distinct modalities independently exceed threshold for consecutive persistence cycles.
4. **Stage 04: Severity & Trend Scoring**: Computes a 0–100 weighted health index alongside a dynamic trend vector ($\frac{dS}{dt}$ slope).
5. **Stage 05: Acoustic TDOA Localization**: Measures microsecond phase shifts between adjacent pipe nodes to localize leak coordinates.
6. **Stage 06: Autonomous Shutoff & Plumber Dispatch**: Arms a 5-second countdown with tap-to-cancel safeguard before valve actuation and compiles a diagnostic service ticket.

---

## 📐 Mathematical & Detection Logic

### 1. Modality Debouncing & Persistence Filter
To prevent fleeting hydraulic transients from false-triggering a vote, each signal $s_i(t)$ must exceed its threshold $\theta_i$ for at least $N = 6$ consecutive execution cycles:
$$\text{Vote}_i = \begin{cases} 1 & \text{if } \sum_{k=0}^{N-1} \mathbb{I}(s_i(t - k) \ge \theta_i) = N \\ 0 & \text{otherwise} \end{cases}$$

### 2. Cross-Modal Corroboration Rule
An alert is granted **only if at least two orthogonal modalities** actively vote:
$$\text{Alert Triggered} \iff \sum_{i \in \{\text{Acoustic, Pressure, Flow, Moisture}\}} \text{Vote}_i \ge 2$$
- **0 Votes**: Healthy baseline (Green).
- **1 Vote**: Isolated modality anomaly (Amber, "Suspicious", alert suppressed).
- **2 to 4 Votes**: Corroborated leak alert (Red, notification & localization engaged).

### 3. Weighted Multi-Modal Fusion Score ($S$)
The holistic fusion score (0 to 100) is calculated as:
$$S = w_a \cdot \tilde{s}_a + w_p \cdot \tilde{s}_p + w_f \cdot \tilde{s}_f + w_m \cdot \tilde{s}_m$$
Where:
- $w_a = 0.30$ (Acoustic vibration)
- $w_p = 0.20$ (Inverted pressure drop)
- $w_f = 0.25$ (Volumetric flow rate)
- $w_m = 0.25$ (Galvanic surface moisture)

### 4. Trend Slope & Severity Tiering
The derivative $\frac{dS}{dt}$ is computed over rolling 1.5-second windows:
- **$\frac{dS}{dt} > +1.2$**: "Rising ↗"
- **$\frac{dS}{dt} < -1.2$**: "Falling ↘"
- **$|\frac{dS}{dt}| \le 1.2$**: "Steady →"

| Score Range | Severity Tier | Typical Physical Manifestation | Recommended Action |
|:---:|:---:|:---|:---|
| **0 – 29** | **Nominal** | Quiet background noise floor | None (All Nominal) |
| **30 – 49** | **Seep** | Faint micro-vibration, slow humidity rise | Inspect fitting within 7 days |
| **50 – 69** | **Drip** | Periodic acoustic drop pulse + localized moisture wick | Service within 24 hours |
| **70 – 84** | **Moderate** | Sustained hiss + pressure attenuation | Immediate plumber dispatch |
| **85 – 100** | **Burst** | Flow surge + pressure plummet + violent acoustic roar | Autonomous valve closure in < 5s |

### 5. Time-Difference-of-Arrival (TDOA) Localization
For two sensors placed along a pipe at distance $D$, acoustic pressure waves emitted by the fissure travel at propagation velocity $v$:
- Copper / Steel pipes: $v \approx 1,200\text{ m/s}$
- PVC / PEX pipes: $v \approx 400\text{ m/s}$

The distance $x$ from Node 1 is derived from the measured arrival time difference $\Delta t = t_2 - t_1$:
$$x = \frac{D - v \cdot \Delta t}{2}$$
AquaSense displays this location directly on the pipe diagram with an accuracy of $\pm 0.35\text{ meters}$.

---

## 🎮 Simulation Scenarios & Test Suite

| Scenario Preset | Simulated Dynamics | AquaSense Corroboration | Legacy Single-Sensor Result |
|:---|:---|:---|:---|
| **1. Normal Operation** | Random stochastic baseline noise | 0 Votes active; nominal | Quiet (Pass) |
| **2. Slow Drip (Faucet)** | Acoustic & moisture rise gradually over 40s; flow is < 0.05 LPM | Acoustic + Moisture (2/4) triggers low alert at ~40s | **MISSED** (Flow below 0.05 LPM meter cutoff) |
| **3. Burst Pipe** | Flow spikes to 36 LPM, pressure plummets to 20 PSI, 82 dB roar | Flow + Pressure + Acoustic (3/4) | Cloud delay (18-minute SMS queue) |
| **4. Dishwasher Running** | Acoustic churn ~70 dB, 6 LPM periodic fill; moisture is 13% (dry) | Acoustic only (1/4 < 2) $\rightarrow$ **Suppressed!** | **FALSE ALARM** (Nuisance shutoff triggered) |
| **5. Inter-Node Leak** | Acoustic waves propagate to N1 & N2 with time delay $\Delta t$ | TDOA computes $x = 4.3\text{m} \pm 0.35\text{m}$ | Drywall must be cut open to find |
| **6. Wi-Fi Disconnected** | Internet cloud icon severed during active leak | 100% on-device TinyML sounds buzzer & shuts valve | **TOTAL FAILURE** (Cloud unreachable) |
| **7. PVC Calibration** | Dynamic baseline adaptation over 48h (sped up) | ML noise floor adapts from 45 dB to 36 dB | Static rigid threshold only |

---

## 🕹️ Interactive Controls

- **Residential vs District DMA Tabs**: Toggle between a 3-node residential floor plan and a 12-node Municipal District Metered Area grid.
- **Node Selector Pills / Interactive Canvas**: Click **N1**, **N2**, or **N3** to focus charts and telemetry on that node.
- **Pipe Material Selector**: Switch between **Copper (1,200 m/s)** and **PVC (400 m/s)** to witness wave speed changes in real time.
- **Speed Slider (1x to 5x)**: Accelerate simulated time.
- **Auto-Shutoff Toggle**: Enable/disable motorized valve actuation.
- **Compare Mode Switch**: Displays a side-by-side benchmark comparing legacy single-sensor detectors against AquaSense in real time.
- **Audio Buzzer Toggle**: Activates synthetic Web Audio alerts and emergency warning beeps.
- **Interactive Tooltips**: Hover over marked terms (**TinyML**, **Federated Learning**, **TDOA Cross-Correlation**, **Edge Autonomy**, **Non-Revenue Water**) to view technical explainers.

---

## 📂 Project Structure

```
aquasense/
├── index.html       # Clean semantic single-page layout & visual UI
├── styles.css       # Oceanic dark-mode styles, responsive layout & animations
├── app.js           # Multi-modal physics, fusion engine, TDOA, canvas renderers
└── README.md        # Technical documentation, formulas & scenario guide
```

*Designed and engineered for the 2026 Design Thinking Capstone Project.*
