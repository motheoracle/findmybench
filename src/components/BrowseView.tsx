import { useEffect, useMemo, useState } from 'react';
import type { User, ViewBench } from '../types';
import { difficultyLabel, isPaidTier, TAXONOMY } from '../config/taxonomy';
import { distanceM } from '../utils/geo';
import PaywallCard from './PaywallCard';

export type TierFilter = 'all' | 'urban' | 'scenic' | 'transit' | 'historic' | 'tricky' | 'obscure' | 'easy' | 'moderate' | 'hidden';

export default function BrowseView({
  benches,
  filter,
  onFilter,
  subscribed,
  user,
  onSelect,
  onLogBench,
  onUnlock,
}: {
  benches: ViewBench[];
  filter: TierFilter;
  onFilter(f: TierFilter): void;
  subscribed: boolean;
  user: User | null;
  onSelect(id: string): void;
  onLogBench(): void;
  onUnlock(): void;
}) {
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'newest' | 'nearest'>('name');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (sortBy !== 'nearest' || coords || !('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 60000 },
    );
  }, [sortBy, coords]);
  const paidCount = benches.filter((b) => isPaidTier(b.bench.difficulty)).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return benches
      .filter((v) => subscribed || (!v.locked && !isPaidTier(v.bench.difficulty)))
      .filter((v) => {
        if (filter === 'all') return true;
        if (filter === 'urban') return v.bench.difficulty === 'urban' || v.bench.difficulty === 'easy';
        if (filter === 'transit') return v.bench.difficulty === 'transit' || v.bench.difficulty === 'moderate';
        if (filter === 'obscure') return v.bench.difficulty === 'obscure' || v.bench.difficulty === 'hidden';
        return v.bench.difficulty === filter;
      })
      .filter(
        (v) =>
          !q ||
          v.bench.name.toLowerCase().includes(q) ||
          v.bench.region.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        if (sortBy === 'newest') return b.bench.createdAt.localeCompare(a.bench.createdAt);
        if (sortBy === 'nearest' && coords) {
          return (
            distanceM(coords, { lat: a.displayLat, lng: a.displayLng }) -
            distanceM(coords, { lat: b.displayLat, lng: b.displayLng })
          );
        }
        return a.bench.name.localeCompare(b.bench.name);
      });
  }, [benches, filter, query, subscribed, sortBy, coords]);

  const handleChipClick = (value: TierFilter) => {
    if (value !== 'all' && isPaidTier(value) && !subscribed) {
      onUnlock();
      return;
    }
    onFilter(value);
  };

  return (
    <div className="view">
      <div className="view-head">
        <button className="btn btn-primary btn-block btn-lg" onClick={onLogBench}>
          <span aria-hidden="true">+</span> Log a Bench
        </button>
        {!user && <p className="fine center">Free account needed to log benches. Browsing is open to all.</p>}
      </div>

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search benches or places..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search benches"
        />
        <div className="chips" role="tablist" aria-label="Filter by category">
          <button
            role="tab"
            aria-selected={filter === 'all'}
            className={`chip ${filter === 'all' ? 'active' : ''}`}
            onClick={() => handleChipClick('all')}
          >
            All
          </button>
          {TAXONOMY.map((item) => {
            const lockedChip = item.isPaid && !subscribed;
            return (
              <button
                key={item.value}
                role="tab"
                aria-selected={filter === item.value}
                className={`chip ${filter === item.value ? 'active' : ''} ${lockedChip ? 'locked' : ''}`}
                onClick={() => handleChipClick(item.value)}
              >
                {item.shortLabel} {lockedChip ? '(Pro)' : ''}
              </button>
            );
          })}
        </div>
      </div>

      {!subscribed && (
        <PaywallCard compact onUnlock={onUnlock} obscureCount={paidCount} />
      )}

        <div className="row-gap" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="muted small">{visible.length} {visible.length === 1 ? 'bench' : 'benches'}</span>
          <label className="small muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Sort
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'name' | 'newest' | 'nearest')}
              aria-label="Sort benches"
              style={{ borderRadius: 8, padding: '4px 8px', border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)' }}
            >
              <option value="name">A–Z</option>
              <option value="newest">Newest</option>
              <option value="nearest">Nearest</option>
            </select>
          </label>
        </div>
      <ul className="bench-list">
        {visible.map((v) => (
          <li key={v.bench.id}>
            <button className="bench-row" onClick={() => onSelect(v.bench.id)}>
              <i className={`dot ${v.bench.difficulty}`} />
              <div className="bench-row-main">
                <div className="bench-row-title">
                  {v.bench.name}
                  {v.bench.source === 'user' && <span className="tag">Community</span>}
                </div>
                <div className="bench-row-sub">
                  {v.bench.region} · {difficultyLabel(v.bench.difficulty)}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}