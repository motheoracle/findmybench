import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('resources');
fs.mkdirSync(outDir, { recursive: true });

// 1024x1024 app icon (full bleed so Android adaptive icons + iOS App Store icons have safe margin)
const iconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#244833"/>
      <stop offset="100%" stop-color="#172f21"/>
    </linearGradient>
    <filter id="softShadow" x="-15%" y="-15%" width="130%" height="130%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#09140e" flood-opacity="0.35"/>
    </filter>
  </defs>

  <rect width="1024" height="1024" fill="url(#bg)"/>

  <!-- Subtle compass/contour ring -->
  <circle cx="512" cy="512" r="345" fill="none" stroke="#f3ead8" stroke-opacity="0.08" stroke-width="6"/>

  <!-- Warm gold location beacon -->
  <circle cx="758" cy="262" r="88" fill="#e0a43a" filter="url(#softShadow)"/>
  <circle cx="758" cy="262" r="36" fill="#1f3d2b"/>

  <!-- Cream bench silhouette -->
  <g fill="#f3ead8" filter="url(#softShadow)">
    <!-- Backrest slat -->
    <rect x="216" y="376" width="592" height="74" rx="22"/>
    <!-- Seat slat -->
    <rect x="216" y="516" width="592" height="78" rx="22"/>
    <!-- Left leg -->
    <rect x="268" y="594" width="68" height="202" rx="18"/>
    <!-- Right leg -->
    <rect x="688" y="594" width="68" height="202" rx="18"/>
  </g>
</svg>
`;

// 2732x2732 splash screen (centered emblem + FindMyBench wordmark on deep forest green)
const splashSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2732 2732" width="2732" height="2732">
  <defs>
    <linearGradient id="splashBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#224430"/>
      <stop offset="100%" stop-color="#162d20"/>
    </linearGradient>
    <filter id="splashShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#08120c" flood-opacity="0.35"/>
    </filter>
  </defs>

  <rect width="2732" height="2732" fill="url(#splashBg)"/>

  <!-- Centered icon card -->
  <g transform="translate(1066, 940)">
    <rect width="600" height="600" rx="136" fill="#1f3d2b" stroke="#f3ead8" stroke-opacity="0.14" stroke-width="6" filter="url(#splashShadow)"/>
    <circle cx="446" cy="154" r="52" fill="#e0a43a"/>
    <circle cx="446" cy="154" r="20" fill="#1f3d2b"/>
    <g fill="#f3ead8">
      <rect x="126" y="220" width="348" height="44" rx="14"/>
      <rect x="126" y="302" width="348" height="46" rx="14"/>
      <rect x="158" y="348" width="40" height="120" rx="11"/>
      <rect x="402" y="348" width="40" height="120" rx="11"/>
    </g>
  </g>

  <!-- Brand title -->
  <text x="1366" y="1665" text-anchor="middle" fill="#f3ead8" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="92" font-weight="700" letter-spacing="-1">
    FindMyBench
  </text>
  <text x="1366" y="1748" text-anchor="middle" fill="#e0a43a" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="38" font-weight="600" letter-spacing="5">
    UK BENCH FINDER
  </text>
</svg>
`;

fs.writeFileSync(path.join(outDir, 'icon.svg'), iconSvg.trim() + '\n');
fs.writeFileSync(path.join(outDir, 'splash.svg'), splashSvg.trim() + '\n');
console.log('Wrote resources/icon.svg and resources/splash.svg');