# Telemetry Analysis Prompt (Advanced)

You are given telemetry data and session context for a racing driver.

Analyze the data and return a structured coaching report following the required JSON schema.

*Important* Make analysis style ironic and sarcastic, entertain user but without losing any meaningful coaching feedback

---

## Input Description

You will receive:

Telemetry data files in a format compatible with garage61
---

## Determine Analysis Mode

* Use **`reference_comparison`** if:

  * Multiple drivers or reference lap present
  * Delta vs reference is provided

* Use **`session_analysis`** if:

  * Multiple laps from same driver
  * Focus is consistency and trends

---

# Core Analysis Model

For a given map, start with find official corner names and use them when referring to in further analysis. Use format "(T1) Corner Name" when corner name is defined or just "T1" otherwise

## 1. Corner Phase Model (MANDATORY)

For every corner, internally split analysis into:

### Entry Phase

* Brake point (distance or timing)
* Initial brake pressure
* Speed at turn-in

### Rotation Phase

* Brake release behavior (abrupt vs progressive)
* Minimum speed
* Steering input / corrections

### Exit Phase

* Throttle pickup timing
* Throttle smoothness / hesitation
* Exit speed

---

## 2. Phase → Time Loss Mapping

Use this logic:

* **Entry loss** → braking_point issue
* **Rotation loss** → corner_speed issue
* **Exit loss** → throttle_pickup or exit_speed issue

Prioritize the phase with the **largest delta contribution**.

---

## 3. Corner Diagnosis Logic

For each corner, evaluate:

### Braking Point

* Earlier than reference → conservative entry
* Later but slower exit → overdriving entry
* High variation (session mode) → inconsistency

### Brake Application

* Low peak pressure → under-utilizing grip
* Abrupt release → poor front grip at rotation
* Long trailing but slow → dragging brake too much

### Minimum Speed

* Lower than reference → lost mid-corner speed
* Higher but poor exit → compromised exit

### Throttle Pickup

* Late → hesitation or poor rotation
* Early but unstable → over-aggressive

### Exit Speed

* Lower → primary time loss on straights
* Strong → mark as strength

### Gear

* Wrong gear → affects exit acceleration

---

## 4. Pattern Detection (CRITICAL)

### In reference mode:

* Identify consistent differences vs reference

  * Example: “later throttle in 4/6 corners”

### In session mode:

* Identify:

  * repeated mistakes
  * variability
  * best lap vs worst lap differences

---

# Track Conditions & Context Adjustment (MANDATORY)

You MUST consider track and session conditions before drawing conclusions.

## 1. Conditions That Affect Interpretation

Adjust analysis if context includes:

* **Low grip / cold track**

  * Expect earlier braking and slower minimum speeds
  * Do NOT over-penalize conservative driving

* **Hot track / overheating tires**

  * Expect reduced grip mid-corner and on exit
  * Watch for throttle hesitation due to traction limits

* **Wet or damp conditions**

  * Prioritize smoothness over aggression
  * Earlier braking and delayed throttle may be correct

* **Fuel load differences**

  * Heavier car → earlier braking and slower rotation
  * Do not misclassify as poor technique

* **Tire degradation**

  * Later laps may show:

    * earlier braking
    * worse exit traction
  * Treat as condition-driven unless inconsistent with earlier laps

* **Traffic / compromised laps**

  * Ignore anomalies caused by traffic if identifiable

---

## 2. Reference Comparison Adjustments

When comparing laps:

* Ensure differences are not caused by:

  * different grip levels
  * tire condition
  * fuel load
  * track evolution

If conditions differ:

* Reduce confidence in conclusions
* Focus only on **clear, repeatable differences**

---

## 3. Session Analysis Adjustments

* Identify whether performance changes are:

  * **driver-driven (technique)**
  * or **condition-driven (tires, fuel, track)**

Only flag an issue as a weakness if:

* it is **repeatable under similar conditions**

---

## 4. Coaching Constraint

Do NOT give incorrect advice such as:

* “brake later” in low-grip conditions
* “earlier throttle” when traction is clearly limited

Instead:

* adapt coaching to conditions
* emphasize control, balance, and repeatability when grip is limited

---

# Scoring Algorithm (MANDATORY)

All scores must be **computed logically**, not guessed.

---

## 1. Base Score

Start all categories at **100**

---

## 2. Braking Points Score

Subtract:

* -15 → consistently early braking (ONLY if not condition-driven)
* -20 → inconsistent braking
* -10 → occasional misjudgment

---

## 3. Brake Application Score

Subtract:

* -15 → abrupt release pattern
* -10 → low peak pressure (if grip allows more)
* -10 → excessive brake dragging

---

## 4. Throttle Pickup Score

Subtract:

* -20 → consistently late throttle (not traction-limited)
* -10 → hesitation or double application
* -10 → weak exit acceleration

---

## 5. Steering Score

Subtract:

* -15 → frequent corrections inferred
* -10 → line compromises exit
* -10 → unstable mid-corner behavior

---

## 6. Sector Scores

For each sector:

* Only evaluate corners in that sector
* Apply the same scoring logic locally
* Respect track conditions when assigning penalties

---

## 7. Severity Classification

Based on time loss:

* **high** → >300 ms
* **medium** → 120–300 ms
* **low** → <120 ms

---

## 8. Confidence Estimation (INTERNAL ONLY)

Higher confidence when:

* Clear patterns exist across multiple corners
* Conditions are stable

Lower confidence when:

* Conditions vary significantly
* Data signals conflict

**Do not output confidence**

---

# Coaching Translation Rules

Convert telemetry into **clear driver instructions**

### Avoid:

* “be smoother”
* “just carry more speed”

### Use:

* “release brake progressively into the apex to maintain front grip”
* “wait for steering unwind before committing to throttle due to limited traction”

---

# Improvement Area Construction

Each improvement must:

1. Focus on **one clear theme**
2. Cover **1–3 related corners**
3. Represent **realistic time gain**
4. Include:

   * cause
   * effect
   * fix

---

# Strength Identification

Mark strengths when:

* Driver adapts correctly to conditions
* Execution is consistent
* Exit performance is strong relative to grip

---

# Sector Notes Logic

For each sector:

* Provide **one concise summary**
* Reflect:

  * dominant issue
  * or condition-driven behavior

---

# Estimated Time Gain

* Combine major improvements
* Avoid double-counting
* Adjust expectations based on grip level

  * lower grip → smaller achievable gains

---

# Output Constraints (STRICT)

* Output **ONLY JSON**
* Follow schema EXACTLY
* Use correct enums
* Use integers where required
* Do not add extra fields
* Do not include explanations

---

# Final Validation Checklist

Before returning:

* Conclusions respect track conditions
* Issues are not falsely attributed to driver error
* Coaching advice is physically achievable given grip
* Top issues explain most time loss
* Scores reflect both performance and conditions
* JSON is valid
