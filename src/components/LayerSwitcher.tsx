import type { MapLayerMode } from '../types';
import { LAYER_MODES } from '../config/mapStyles';

const ICONS: Record<MapLayerMode, JSX.Element> = {
  default: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 2.1 6 2v11.8l-6-2V6.1Z" />
    </svg>
  ),
  satellite: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-1 2.07V8H8.2A7 7 0 0 1 11 5.07ZM5.07 11H8v2H5.07a7 7 0 0 1 0-2ZM8.2 16H11v2.93A7 7 0 0 1 8.2 16ZM13 18.93V16h2.8a7 7 0 0 1-2.8 2.93ZM16 13v-2h2.93a7 7 0 0 1 0 2H16Zm-.2-5H13V5.07A7 7 0 0 1 15.8 8ZM10 10h4v4h-4v-4Z" />
    </svg>
  ),
  terrain: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m14 6-3.75 5 2.85 3.8-1.6 1.2C9.81 13.75 7 10 7 10l-6 8h22L14 6Z" />
    </svg>
  ),
};

export default function LayerSwitcher({
  mode,
  onChange,
}: {
  mode: MapLayerMode;
  onChange(m: MapLayerMode): void;
}) {
  return (
    <div className="layer-switcher" role="radiogroup" aria-label="Map style (free)">
      {LAYER_MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          role="radio"
          aria-checked={mode === m.value}
          className={mode === m.value ? 'active' : ''}
          onClick={() => onChange(m.value)}
          title={`${m.label} — free`}
        >
          {ICONS[m.value]}
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  );
}