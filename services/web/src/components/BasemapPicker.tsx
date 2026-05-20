import { useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.gridlayer.googlemutant';
import { googleMapsApiKey, loadGoogleMaps } from '../lib/googleMaps';

// Custom basemap chooser used by LiveMap / History / Places. We rolled
// our own instead of using LayersControl.BaseLayer because the Google
// layers (leaflet.gridlayer.googlemutant) need the Google Maps SDK to
// be loaded asynchronously, and react-leaflet's LayersControl expects
// children to be synchronously-instantiable layers. Doing it
// imperatively here lets us defer Google layer creation until the
// script finishes loading without losing the OSM / Esri fallbacks.
//
// Hybrid (satellite + labels) is the default when a Google key is
// configured because it's the best fit for mining-fleet ops — terrain
// is visible but road/rail labels stay readable.

type BasemapKey = 'google-hybrid' | 'google-satellite' | 'google-roadmap' | 'osm' | 'esri' | 'topo';

interface Option {
  key: BasemapKey;
  label: string;
  google?: boolean;
}

const ALL_OPTIONS: Option[] = [
  { key: 'google-hybrid', label: 'Хайбрид', google: true },
  { key: 'google-satellite', label: 'Хиймэл дагуул', google: true },
  { key: 'google-roadmap', label: 'Зам', google: true },
  { key: 'osm', label: 'OSM' },
  { key: 'esri', label: 'Esri' },
  { key: 'topo', label: 'Топо' },
];

function createLayer(key: BasemapKey): L.Layer | null {
  // The googleMutant factory is attached to L.gridLayer by the plugin
  // side-effect import. Cast through unknown rather than redefining the
  // Leaflet types globally.
  const mutant = (L.gridLayer as unknown as {
    googleMutant?: (opts: { type: string; maxZoom?: number }) => L.GridLayer;
  }).googleMutant;

  switch (key) {
    case 'google-hybrid':
      return mutant ? mutant({ type: 'hybrid', maxZoom: 22 }) : null;
    case 'google-satellite':
      return mutant ? mutant({ type: 'satellite', maxZoom: 22 }) : null;
    case 'google-roadmap':
      return mutant ? mutant({ type: 'roadmap', maxZoom: 22 }) : null;
    case 'osm':
      return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      });
    case 'esri':
      return L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
          maxZoom: 19,
        },
      );
    case 'topo':
      return L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution:
          'Map data: &copy; OpenStreetMap contributors, SRTM | Style: &copy; OpenTopoMap (CC-BY-SA)',
        maxZoom: 17,
      });
  }
}

export function BasemapPicker({ defaultKey }: { defaultKey?: BasemapKey }) {
  const map = useMap();
  const hasGoogle = !!googleMapsApiKey();
  const [googleReady, setGoogleReady] = useState<boolean>(!!window.google?.maps);
  const [active, setActive] = useState<BasemapKey>(defaultKey ?? (hasGoogle ? 'google-hybrid' : 'osm'));
  const currentLayerRef = useRef<L.Layer | null>(null);

  useEffect(() => {
    if (hasGoogle && !googleReady) {
      loadGoogleMaps().then((ok) => setGoogleReady(ok));
    }
  }, [hasGoogle, googleReady]);

  useEffect(() => {
    const isGoogle = active.startsWith('google-');
    if (isGoogle && !googleReady) {
      // Wait for the SDK; we'll re-run when googleReady flips.
      return;
    }
    const layer = createLayer(active);
    if (!layer) return;
    layer.addTo(map);
    const previous = currentLayerRef.current;
    currentLayerRef.current = layer;
    if (previous) map.removeLayer(previous);
    return () => {
      // Cleanup runs before the next effect; the next layer is added
      // *after* this teardown, so removing the previous layer here
      // would briefly show the default grey background. Defer to the
      // next-effect's swap above instead.
    };
  }, [active, googleReady, map]);

  const options = ALL_OPTIONS.filter((o) => !o.google || hasGoogle);

  return (
    <div className="leaflet-top leaflet-right" style={{ pointerEvents: 'auto' }}>
      <div className="leaflet-control bg-white shadow-md rounded-lg p-1 m-2 flex gap-0.5 text-xs border border-slate-200">
        {options.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setActive(opt.key)}
            className={`px-2 py-1 rounded transition ${
              active === opt.key
                ? 'bg-brand-600 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
