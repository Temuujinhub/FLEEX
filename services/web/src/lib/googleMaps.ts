// Lazy-loads the Google Maps JS API (Maps JavaScript API) once per page
// load. We use this to back leaflet.gridlayer.googlemutant, which keeps
// the rest of the codebase on react-leaflet while satisfying the Oyu
// Tolgoi requirement of a Google satellite basemap.
//
// The API key is read at build time from VITE_GOOGLE_MAPS_API_KEY (set
// in docker-compose.yml from the runtime GOOGLE_MAPS_API_KEY env var).
// If the key is missing we resolve to null so callers can fall back to
// OSM / Esri without crashing.

declare global {
  interface Window {
    google?: { maps?: unknown };
  }
}

let loaderPromise: Promise<boolean> | null = null;

export function googleMapsApiKey(): string | undefined {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  return key && key.length > 0 ? key : undefined;
}

export function loadGoogleMaps(): Promise<boolean> {
  if (loaderPromise) return loaderPromise;

  const key = googleMapsApiKey();
  if (!key) {
    loaderPromise = Promise.resolve(false);
    return loaderPromise;
  }

  if (window.google?.maps) {
    loaderPromise = Promise.resolve(true);
    return loaderPromise;
  }

  loaderPromise = new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=quarterly&libraries=`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      // Don't cache a failed load — a transient network blip shouldn't
      // doom every subsequent map render in this tab.
      loaderPromise = null;
      resolve(false);
    };
    document.head.appendChild(script);
  });

  return loaderPromise;
}
