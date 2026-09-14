import {
  READER_FONT_FAMILIES,
  READER_LIMITS,
  READER_THEMES,
  type ReaderSettings
} from '@core/domain/settings'
import { READER_FONT_LABELS, READER_THEME_LABELS } from './readerAppearance'

interface SettingsPanelProps {
  settings: ReaderSettings
  onChange: (patch: Partial<ReaderSettings>) => void
  onClose: () => void
}

interface StepperProps {
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  onStep: (delta: number) => void
}

/** 到边界就禁用按钮，避免用户点了没反应却不知道原因。 */
function Stepper({ label, value, display, min, max, step, onStep }: StepperProps): React.JSX.Element {
  return (
    <div className="setting-row">
      <span className="setting-row__label">{label}</span>
      <div className="setting-row__control">
        <button
          type="button"
          aria-label={`减小${label}`}
          disabled={value <= min}
          onClick={() => onStep(-step)}
        >
          −
        </button>
        <span className="setting-row__value">{display}</span>
        <button
          type="button"
          aria-label={`增大${label}`}
          disabled={value >= max}
          onClick={() => onStep(step)}
        >
          ＋
        </button>
      </div>
    </div>
  )
}

export default function SettingsPanel({
  settings,
  onChange,
  onClose
}: SettingsPanelProps): React.JSX.Element {
  return (
    <aside className="reader__drawer reader__drawer--settings" aria-label="阅读设置">
      <div className="reader__drawer-header">
        <h2>阅读设置</h2>
        <button type="button" onClick={onClose}>
          关闭设置
        </button>
      </div>

      <Stepper
        label="字号"
        value={settings.fontSize}
        display={`${settings.fontSize} px`}
        min={READER_LIMITS.fontSize.min}
        max={READER_LIMITS.fontSize.max}
        step={1}
        onStep={(delta) => onChange({ fontSize: settings.fontSize + delta })}
      />

      <Stepper
        label="行高"
        value={settings.lineHeight}
        display={settings.lineHeight.toFixed(1)}
        min={READER_LIMITS.lineHeight.min}
        max={READER_LIMITS.lineHeight.max}
        step={0.1}
        onStep={(delta) => onChange({ lineHeight: settings.lineHeight + delta })}
      />

      <Stepper
        label="页边距"
        value={settings.pageMargin}
        display={`${settings.pageMargin} px`}
        min={READER_LIMITS.pageMargin.min}
        max={READER_LIMITS.pageMargin.max}
        step={4}
        onStep={(delta) => onChange({ pageMargin: settings.pageMargin + delta })}
      />

      <div className="setting-row">
        <span className="setting-row__label">主题</span>
        <div className="setting-row__control">
          {READER_THEMES.map((theme) => (
            <button
              key={theme}
              type="button"
              aria-pressed={settings.theme === theme}
              onClick={() => onChange({ theme })}
            >
              {READER_THEME_LABELS[theme]}
            </button>
          ))}
        </div>
      </div>

      <div className="setting-row">
        <span className="setting-row__label">字体</span>
        <div className="setting-row__control">
          {READER_FONT_FAMILIES.map((fontFamily) => (
            <button
              key={fontFamily}
              type="button"
              aria-pressed={settings.fontFamily === fontFamily}
              onClick={() => onChange({ fontFamily })}
            >
              {READER_FONT_LABELS[fontFamily]}
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}
