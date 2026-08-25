// Best-effort IP -> approximate city/country lookup for the "where are
// people playing from" map. Deliberately coarse: city-level at best (often
// less accurate for mobile/VPN traffic), never persisted beyond the
// in-memory active session, and only ever surfaced aggregated by location
// on the frontend - never as a per-visitor pin.

const PRIVATE_IP_RE =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::ffff:127\.|f[cd][0-9a-f]{2}:)/i;

// ip -> Promise<geo|null>, shared so concurrent heartbeats for the same
// not-yet-resolved IP don't fire duplicate lookups.
const cache = new Map();

export async function geoLookup(ip) {
  if (!ip || PRIVATE_IP_RE.test(ip)) return null;
  if (cache.has(ip)) return cache.get(ip);

  const promise = fetchGeo(ip);
  cache.set(ip, promise);
  return promise;
}

async function fetchGeo(ip) {
  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,city,lat,lon`
    );
    const data = await res.json();
    if (data.status !== "success") return null;
    return {
      country: data.country,
      countryCode: data.countryCode,
      city: data.city,
      lat: data.lat,
      lon: data.lon,
    };
  } catch {
    return null;
  }
}
