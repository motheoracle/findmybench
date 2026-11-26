/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COUNTRY_CODE?: string;
  readonly VITE_MAP_STYLE_DEFAULT?: string;
  readonly VITE_SATELLITE_TILES?: string;
  readonly VITE_TOPO_TILES?: string;
  readonly VITE_DEM_TILES?: string;
  readonly VITE_GLYPHS_URL?: string;
  readonly VITE_ENABLE_DEV_TOOLS?: string;
  readonly VITE_SATELLITE_MAXZOOM?: string;
  readonly VITE_DEM_TILE_SIZE?: string;
  readonly VITE_DEM_MAXZOOM?: string;
  readonly VITE_DUPLICATE_RADIUS_M?: string;
  readonly VITE_MAX_PHOTOS_PER_USER_PER_BENCH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
