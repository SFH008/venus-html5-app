/**
 * SettingsView.tsx
 * Marine2 Settings — edit Network and Display config on the Axiom touchscreen.
 *
 * Settings are persisted to localStorage and survive browser reload.
 * All views pick up changes immediately via useAppConfig() hook.
 *
 * Integration:
 *   1. Add SETTINGS = "settings" to AppViews.store.ts enum
 *   2. Import and add case to renderView() in Marine2.tsx
 *   3. Add nav item to Footer.tsx: { view: AppViews.SETTINGS, icon: "⚙", label: "Settings" }
 */

import React, { useState, useCallback } from "react"
import { useAppConfig } from "../../config/useAppConfig"
import { CONFIG_DEFAULTS } from "../../config/AppConfig"
import type { AppConfigShape } from "../../config/AppConfig"

// ─── STYLES ──────────────────────────────────────────────────────────────────
const C = {
  bg: "#000509",
  panel: "rgba(0,8,20,0.88)",
  border: "rgba(0,210,255,0.08)",
  borderHi: "rgba(0,210,255,0.25)",
  accent: "rgba(0,210,255,0.55)",
  accentDim: "rgba(0,210,255,0.25)",
  text: "#e8f8ff",
  textDim: "rgba(200,220,255,0.55)",
  textFaint: "rgba(200,220,255,0.3)",
  success: "#22c55e",
  warn: "#f59e0b",
  danger: "#ef4444",
  mono: "'Share Tech Mono', monospace",
  serif: "'Cinzel', serif",
}

// ─── FIELD COMPONENTS ────────────────────────────────────────────────────────
const FieldLabel = ({ label, hint }: { label: string; hint?: string }) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ fontSize: 14, color: C.accent, letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: 600 }}>
      {label}
    </div>
    {hint && (
      <div style={{ fontSize: 13, color: C.textDim, marginTop: 4, letterSpacing: "0.03em", lineHeight: 1.5 }}>
        {hint}
      </div>
    )}
  </div>
)

const TextInput = ({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) => (
  <input
    type="text"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    style={{
      width: "100%",
      boxSizing: "border-box",
      background: "rgba(0,0,0,0.5)",
      border: `1px solid ${C.borderHi}`,
      borderRadius: 8,
      padding: "14px 16px",
      fontSize: 17,
      color: C.text,
      fontFamily: C.mono,
      outline: "none",
      letterSpacing: "0.06em",
    }}
  />
)

const PasswordInput = ({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) => (
  <input
    type="password"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    style={{
      width: "100%",
      boxSizing: "border-box",
      background: "rgba(0,0,0,0.5)",
      border: `1px solid ${C.borderHi}`,
      borderRadius: 8,
      padding: "14px 16px",
      fontSize: 17,
      color: C.text,
      fontFamily: C.mono,
      outline: "none",
      letterSpacing: "0.06em",
    }}
  />
)

const NumberInput = ({
  value,
  onChange,
  min,
  max,
  step,
  unit,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step ?? 1}
      onChange={(e) => {
        const n = parseFloat(e.target.value)
        if (!isNaN(n)) onChange(n)
      }}
      style={{
        flex: 1,
        boxSizing: "border-box",
        background: "rgba(0,0,0,0.5)",
        border: `1px solid ${C.borderHi}`,
        borderRadius: 8,
        padding: "14px 16px",
        fontSize: 17,
        color: C.text,
        fontFamily: C.mono,
        outline: "none",
        letterSpacing: "0.06em",
      }}
    />
    {unit && <span style={{ fontSize: 14, color: C.textDim, fontFamily: C.mono, minWidth: 28 }}>{unit}</span>}
  </div>
)

const SliderInput = ({
  value,
  onChange,
  min,
  max,
  step,
  labels,
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  labels?: string[]
}) => (
  <div>
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: "rgba(0,210,255,0.9)", height: 6, cursor: "pointer" }}
      />
      <div
        style={{ fontSize: 20, fontWeight: 700, color: C.text, fontFamily: C.mono, minWidth: 52, textAlign: "right" }}
      >
        {value.toFixed(1)}×
      </div>
    </div>
    {labels && (
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        {labels.map((l) => (
          <span key={l} style={{ fontSize: 12, color: C.textDim }}>
            {l}
          </span>
        ))}
      </div>
    )}
  </div>
)

// ─── SECTION ─────────────────────────────────────────────────────────────────
const Section = ({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) => (
  <div
    style={{
      background: C.panel,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: "20px 24px",
      display: "flex",
      flexDirection: "column",
      gap: 24,
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        paddingBottom: 14,
        borderBottom: `1px solid rgba(0,210,255,0.12)`,
      }}
    >
      <span style={{ fontSize: 22, opacity: 0.8 }}>{icon}</span>
      <span
        style={{ fontSize: 13, color: C.accent, letterSpacing: "0.3em", textTransform: "uppercase", fontWeight: 600 }}
      >
        {title}
      </span>
    </div>
    {children}
  </div>
)

// FieldRow: label on top (full width), input below — better for narrow screens
const FieldRow = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <FieldLabel label={label} hint={hint} />
    <div>{children}</div>
  </div>
)

// ─── FONT PREVIEW ─────────────────────────────────────────────────────────────
const FontPreview = ({ scale }: { scale: number }) => {
  const fs = (b: number) => Math.round(b * scale)
  return (
    <div
      style={{
        background: "rgba(0,0,0,0.3)",
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 11, color: C.textFaint, letterSpacing: "0.2em", marginBottom: 4 }}>PREVIEW</div>
      <div style={{ fontSize: fs(20), fontFamily: C.serif, color: C.text, letterSpacing: "0.1em" }}>
        Dance Of The Spirits
      </div>
      <div style={{ fontSize: fs(15), fontFamily: C.mono, color: C.textDim }}>
        TWS &nbsp; 14.2 kn &nbsp; · &nbsp; TWD &nbsp; 245° SW
      </div>
      <div style={{ fontSize: fs(13), fontFamily: C.mono, color: C.textFaint, letterSpacing: "0.2em" }}>
        SIGNALK LIVE
      </div>
    </div>
  )
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
const Toast = ({ message, type }: { message: string; type: "success" | "error" }) => (
  <div
    style={{
      position: "fixed",
      bottom: 80,
      left: "50%",
      transform: "translateX(-50%)",
      background: type === "success" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
      border: `1px solid ${type === "success" ? C.success : C.danger}`,
      borderRadius: 8,
      padding: "10px 24px",
      fontSize: 15,
      color: type === "success" ? C.success : C.danger,
      fontFamily: C.mono,
      letterSpacing: "0.1em",
      zIndex: 100,
      pointerEvents: "none",
      animation: "fadeInUp 0.2s ease",
    }}
  >
    {type === "success" ? "✓" : "✗"} {message}
  </div>
)

// ─── DIFF HELPER ──────────────────────────────────────────────────────────────
function hasChanges(draft: AppConfigShape, saved: AppConfigShape): boolean {
  return (Object.keys(draft) as Array<keyof AppConfigShape>).some((k) => draft[k] !== saved[k])
}

function isDefault(draft: AppConfigShape): boolean {
  return (Object.keys(draft) as Array<keyof AppConfigShape>).every((k) => draft[k] === CONFIG_DEFAULTS[k])
}

// ─── MAIN VIEW ────────────────────────────────────────────────────────────────
const SettingsView = () => {
  const { config, save, reset } = useAppConfig()
  const [draft, setDraft] = useState<AppConfigShape>({ ...config })
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null)

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 2500)
  }

  const update = useCallback(<K extends keyof AppConfigShape>(key: K, value: AppConfigShape[K]) => {
    setDraft((prev: AppConfigShape) => ({ ...prev, [key]: value }))
  }, [])

  const handleSave = () => {
    if (!changed) {
      showToast("No changes to save", "error")
      return
    }
    if (!draft.signalkHost.trim()) {
      showToast("SignalK host cannot be empty", "error")
      return
    }
    if (draft.signalkPort < 1 || draft.signalkPort > 65535) {
      showToast("SignalK port must be between 1–65535", "error")
      return
    }
    if (draft.nodeRedPort < 1 || draft.nodeRedPort > 65535) {
      showToast("Node-RED port must be between 1–65535", "error")
      return
    }
    if (!draft.alarmPath.trim().startsWith("/")) {
      showToast("Alarm path must start with /", "error")
      return
    }
    save(draft)
    showToast("Settings saved — reconnecting…")
  }

  const handleDiscard = () => {
    if (!changed) {
      showToast("No changes to discard", "error")
      return
    }
    setDraft({ ...config })
    showToast("Changes discarded")
  }

  const handleReset = () => {
    const defaults = reset()
    setDraft({ ...defaults })
    showToast("Reset to defaults")
  }

  const changed = hasChanges(draft, config)
  const atDefault = isDefault(draft)

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600&family=Share+Tech+Mono&display=swap');
        @keyframes blink     { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes fadeInUp  { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        @keyframes scanLine  { from{top:0} to{top:100%} }
        input[type=range]::-webkit-slider-thumb { width:18px; height:18px; }
        input::placeholder { color: rgba(200,220,255,0.2); }
        input[type=number]::-webkit-inner-spin-button { opacity: 0.3; }
      `}</style>

      <div
        style={{
          width: "100%",
          height: "100vh",
          background: C.bg,
          display: "flex",
          flexDirection: "column",
          fontFamily: C.mono,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Scan line */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: 2,
            background:
              "linear-gradient(90deg,transparent,rgba(0,210,255,0.12) 40%,rgba(0,210,255,0.18) 50%,rgba(0,210,255,0.12) 60%,transparent)",
            animation: "scanLine 7s linear infinite",
            pointerEvents: "none",
            zIndex: 10,
          }}
        />

        {/* ── Header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 20px",
            flexShrink: 0,
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: C.accentDim, letterSpacing: "0.35em", textTransform: "uppercase" }}>
              Marine2 · Configuration
            </div>
            <div style={{ fontSize: 22, fontFamily: C.serif, color: C.text, letterSpacing: "0.12em", marginTop: 2 }}>
              Settings
            </div>
          </div>
          <div style={{ fontSize: 13, color: C.textDim, letterSpacing: "0.08em" }}>
            {atDefault ? "Default configuration" : "Custom configuration active"}
          </div>
        </div>

        {/* ── Content ── */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* ── Network ── */}
          <Section title="Network" icon="🌐">
            <FieldRow label="SignalK Host" hint="IP address of the SignalK server (NUC)">
              <TextInput
                value={draft.signalkHost}
                onChange={(v) => update("signalkHost", v)}
                placeholder={CONFIG_DEFAULTS.signalkHost}
              />
              <div style={{ fontSize: 13, color: C.textDim, marginTop: 8 }}>Default: {CONFIG_DEFAULTS.signalkHost}</div>
            </FieldRow>
            <FieldRow label="SignalK Port" hint="WebSocket port (typically 3000)">
              <NumberInput value={draft.signalkPort} onChange={(v) => update("signalkPort", v)} min={1} max={65535} />
              <div style={{ fontSize: 13, color: C.textDim, marginTop: 8 }}>Default: {CONFIG_DEFAULTS.signalkPort}</div>
            </FieldRow>
            <div
              style={{
                padding: "10px 12px",
                background: "rgba(0,210,255,0.03)",
                border: `1px solid ${C.border}`,
                borderRadius: 6,
              }}
            >
              <div style={{ fontSize: 13, color: C.textDim, letterSpacing: "0.03em", lineHeight: 1.9 }}>
                WebSocket:{" "}
                <span style={{ color: C.textDim }}>
                  ws://{draft.signalkHost}:{draft.signalkPort}/signalk/v1/stream
                </span>
                <br />
                REST API:{" "}
                <span style={{ color: C.textDim }}>
                  http://{draft.signalkHost}:{draft.signalkPort}/signalk/v1/api/
                </span>
              </div>
            </div>
          </Section>

          {/* ── Yarrboard ── */}
          <Section title="Yarrboard" icon="⚡">
            <FieldRow label="Yarrboard Host" hint="Hostname or IP of the Yarrboard DC power controller">
              <TextInput
                value={draft.yarrboardHost}
                onChange={(v) => update("yarrboardHost", v)}
                placeholder={CONFIG_DEFAULTS.yarrboardHost}
              />
            </FieldRow>
            <FieldRow label="Username" hint="Yarrboard API username">
              <TextInput value={draft.yarrboardUser} onChange={(v) => update("yarrboardUser", v)} placeholder="admin" />
            </FieldRow>
            <FieldRow label="Password" hint="Yarrboard API password">
              <PasswordInput
                value={draft.yarrboardPass}
                onChange={(v) => update("yarrboardPass", v)}
                placeholder="••••••"
              />
            </FieldRow>
          </Section>

          {/* ── Alarms ── */}
          <Section title="Alarms" icon="🔔">
            <FieldRow
              label="Notification Path"
              hint="SignalK notifications tree prefix — must start with 'notifications.'"
            >
              <TextInput
                value={draft.notifPrefix}
                onChange={(v) => update("notifPrefix", v)}
                placeholder={CONFIG_DEFAULTS.notifPrefix}
              />
              <div style={{ fontSize: 13, color: C.textDim, marginTop: 8 }}>
                Alarms are written to:{" "}
                <span style={{ color: C.text }}>
                  {draft.signalkHost}:{draft.signalkPort}/signalk/v1/api/vessels/self/
                  {draft.notifPrefix.split(".").join("/")}/[id]
                </span>
              </div>
            </FieldRow>

            <FieldRow label="Emergency repeat" hint="Seconds between repeated announcements (0 = no repeat)">
              <NumberInput
                value={draft.repeatEmergency}
                onChange={(v) => update("repeatEmergency", v)}
                min={0}
                max={300}
              />
            </FieldRow>
            <FieldRow label="Alarm repeat" hint="Seconds between repeated announcements (0 = no repeat)">
              <NumberInput value={draft.repeatAlarm} onChange={(v) => update("repeatAlarm", v)} min={0} max={600} />
            </FieldRow>

            <div
              style={{
                marginTop: 12,
                marginBottom: 4,
                fontSize: 13,
                color: C.textDim,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              Speaker volumes (0–100)
            </div>
            <FieldRow label="Emergency" hint="Volume for emergency announcements">
              <SliderInput
                value={draft.volEmergency}
                onChange={(v) => update("volEmergency", v)}
                min={0}
                max={100}
                step={5}
                labels={["0", "50", "100"]}
              />
            </FieldRow>
            <FieldRow label="Alarm" hint="Volume for alarm announcements">
              <SliderInput
                value={draft.volAlarm}
                onChange={(v) => update("volAlarm", v)}
                min={0}
                max={100}
                step={5}
                labels={["0", "50", "100"]}
              />
            </FieldRow>
            <FieldRow label="Warning" hint="Volume for warning announcements">
              <SliderInput
                value={draft.volWarn}
                onChange={(v) => update("volWarn", v)}
                min={0}
                max={100}
                step={5}
                labels={["0", "50", "100"]}
              />
            </FieldRow>
            <FieldRow label="Normal" hint="Volume for informational announcements">
              <SliderInput
                value={draft.volNormal}
                onChange={(v) => update("volNormal", v)}
                min={0}
                max={100}
                step={5}
                labels={["0", "50", "100"]}
              />
            </FieldRow>

            <div
              style={{
                marginTop: 8,
                padding: "10px 12px",
                background: "rgba(0,210,255,0.03)",
                border: `1px solid ${C.border}`,
                borderRadius: 6,
              }}
            >
              <div style={{ fontSize: 13, color: C.textDim, lineHeight: 2.0 }}>
                <span style={{ color: "#ef4444" }}>Emergency</span> — repeat every {draft.repeatEmergency}s · vol{" "}
                {draft.volEmergency}%<br />
                <span style={{ color: "#f97316" }}>Alarm</span> — repeat every {draft.repeatAlarm}s · vol{" "}
                {draft.volAlarm}%<br />
                <span style={{ color: "#fbbf24" }}>Warning</span> — once only · vol {draft.volWarn}%<br />
                <span style={{ color: "#38bdf8" }}>Normal</span> — once only · vol {draft.volNormal}%
              </div>
            </div>
          </Section>

          {/* ── PowerView ── */}
          <Section title="PowerView — Device Paths" icon="⚡">
            <div
              style={{
                padding: "8px 12px",
                marginBottom: 12,
                background: "rgba(251,191,36,0.05)",
                border: "1px solid rgba(251,191,36,0.2)",
                borderRadius: 6,
              }}
            >
              <div style={{ fontSize: 12, color: "rgba(251,191,36,0.8)", lineHeight: 1.8 }}>
                signalk-venus-plugin uses numeric Cerbo GX D-Bus instance IDs in paths.
                <br />
                Check{" "}
                <span style={{ color: C.text }}>
                  http://{draft.signalkHost}:{draft.signalkPort}/admin/#/databroker
                </span>{" "}
                to find your actual paths.
              </div>
            </div>
            <FieldRow label="Battery path" hint="SignalK path for house battery bank (BMV712 + REC BMS)">
              <TextInput
                value={draft.pvBatteryPath}
                onChange={(v) => update("pvBatteryPath", v)}
                placeholder="electrical.batteries.0"
              />
            </FieldRow>
            <FieldRow label="Solar charger path" hint="SignalK path for MPPT solar charger">
              <TextInput
                value={draft.pvSolarPath}
                onChange={(v) => update("pvSolarPath", v)}
                placeholder="electrical.solar.288"
              />
            </FieldRow>
            <FieldRow label="Inverter path" hint="SignalK path for Quattro inverter/charger">
              <TextInput
                value={draft.pvInverterPath}
                onChange={(v) => update("pvInverterPath", v)}
                placeholder="electrical.inverters.288"
              />
            </FieldRow>
            <FieldRow
              label="BMV712 relay path"
              hint="SignalK switch path for BMV712 aux relay (set to manual in VictronConnect first)"
            >
              <TextInput
                value={draft.pvBmvRelayPath}
                onChange={(v) => update("pvBmvRelayPath", v)}
                placeholder="electrical.switches.1"
              />
            </FieldRow>
            <FieldRow label="REC BMS WebSocket" hint="WebSocket URL for REC BMS WiFi module">
              <TextInput
                value={draft.pvRecBmsWsUrl}
                onChange={(v) => update("pvRecBmsWsUrl", v)}
                placeholder="ws://192.168.76.x:8080"
              />
            </FieldRow>
            <div style={{ marginTop: 8, marginBottom: 4, fontSize: 11, color: C.textDim, letterSpacing: "0.08em" }}>
              ALARM THRESHOLDS
            </div>
            <FieldRow label="Low SoC alarm" hint="Fire alarm when battery SoC falls below this value">
              <NumberInput
                value={draft.pvAlarmSocLow}
                onChange={(v) => update("pvAlarmSocLow", v)}
                min={5}
                max={50}
                step={1}
                unit="%"
              />
            </FieldRow>
            <FieldRow label="High SoC warn" hint="Fire warning when SoC exceeds this (overcharge / float damage risk)">
              <NumberInput
                value={draft.pvAlarmSocHigh}
                onChange={(v) => update("pvAlarmSocHigh", v)}
                min={80}
                max={100}
                step={1}
                unit="%"
              />
            </FieldRow>
            <FieldRow label="Cell delta warn" hint="Fire warning when REC BMS cell spread exceeds this value">
              <NumberInput
                value={draft.pvAlarmCellDelta}
                onChange={(v) => update("pvAlarmCellDelta", v)}
                min={10}
                max={200}
                step={5}
                unit="mV"
              />
            </FieldRow>
            <FieldRow label="Load limit warn" hint="Fire warning when Quattro AC output exceeds this wattage">
              <NumberInput
                value={draft.pvAlarmLoadWatts}
                onChange={(v) => update("pvAlarmLoadWatts", v)}
                min={500}
                max={8000}
                step={100}
                unit="W"
              />
            </FieldRow>
            <FieldRow label="Battery temp alarm" hint="Fire alarm when battery temperature exceeds this value">
              <NumberInput
                value={draft.pvAlarmTempHigh}
                onChange={(v) => update("pvAlarmTempHigh", v)}
                min={30}
                max={60}
                step={1}
                unit="°C"
              />
            </FieldRow>
          </Section>

          {/* ── Display ── */}
          <Section title="Display" icon="🖥">
            <FieldRow label="Font Scale" hint="Scales text size across all views (0.8 – 1.4)">
              <SliderInput
                value={draft.fontScale}
                onChange={(v) => update("fontScale", v)}
                min={0.8}
                max={1.4}
                step={0.05}
                labels={["0.8×  Small", "1.0×  Default", "1.4×  Large"]}
              />
            </FieldRow>
            <FontPreview scale={draft.fontScale} />
          </Section>
        </div>

        {/* ── Action bar ── */}
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            gap: 10,
            padding: "12px 20px",
            borderTop: `1px solid ${C.border}`,
            background: "rgba(0,4,12,0.95)",
          }}
        >
          {/* Reset */}
          <button
            onClick={handleReset}
            style={{
              padding: "14px 24px",
              borderRadius: 8,
              fontSize: 14,
              fontFamily: C.mono,
              letterSpacing: "0.1em",
              cursor: "pointer",
              background: "transparent",
              border: `1px solid ${atDefault ? "rgba(200,220,255,0.1)" : C.borderHi}`,
              color: atDefault ? C.textFaint : C.textDim,
            }}
          >
            ↺ Reset to Defaults
          </button>

          {/* Discard */}
          <button
            onClick={handleDiscard}
            style={{
              padding: "14px 24px",
              borderRadius: 8,
              fontSize: 14,
              fontFamily: C.mono,
              letterSpacing: "0.1em",
              cursor: "pointer",
              background: "transparent",
              border: `1px solid ${changed ? C.borderHi : "rgba(200,220,255,0.1)"}`,
              color: changed ? C.textDim : C.textFaint,
            }}
          >
            ✕ Discard Changes
          </button>

          <div style={{ flex: 1 }} />

          {/* Save */}
          <button
            onClick={handleSave}
            style={{
              padding: "14px 32px",
              borderRadius: 8,
              fontSize: 15,
              fontFamily: C.mono,
              letterSpacing: "0.15em",
              fontWeight: 700,
              cursor: "pointer",
              background: changed ? "rgba(0,210,255,0.12)" : "transparent",
              border: `1px solid ${changed ? "rgba(0,210,255,0.4)" : "rgba(200,220,255,0.1)"}`,
              color: changed ? "rgba(0,210,255,0.9)" : C.textFaint,
              boxShadow: changed ? "0 0 12px rgba(0,210,255,0.1)" : "none",
            }}
          >
            ✓ Save Settings
          </button>
        </div>

        {/* Toast */}
        {toast && <Toast message={toast.message} type={toast.type} />}
      </div>
    </>
  )
}

export default SettingsView
