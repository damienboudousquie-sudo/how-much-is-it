import { BlockList, isIP } from "node:net";

/**
 * Who is really calling. Caddy puts the address that connected to it in X-Forwarded-For.
 * That address is Cloudflare's when the visit goes through Cloudflare, and only then are
 * CF-Connecting-IP and CF-IPCountry to be believed: anyone who reaches the server by its
 * IP can write those headers themselves (to dodge the feedback limit, or skew the stats).
 *
 * Ranges from https://www.cloudflare.com/ips (November 2026).
 */
const CLOUDFLARE_V4 = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];
const CLOUDFLARE_V6 = ["2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"];

const cloudflare = new BlockList();
for (const range of CLOUDFLARE_V4) {
  const [network, prefix] = range.split("/");
  cloudflare.addSubnet(network, Number(prefix), "ipv4");
}
for (const range of CLOUDFLARE_V6) {
  const [network, prefix] = range.split("/");
  cloudflare.addSubnet(network, Number(prefix), "ipv6");
}

type Headers = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** "::ffff:1.2.3.4" is the IPv4 address 1.2.3.4. */
function plain(ip: string): string {
  return ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
}

export function isCloudflare(ip: string): boolean {
  const address = plain(ip);
  const family = isIP(address);
  if (family === 0) return false;
  return cloudflare.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** The address that connected to the reverse proxy (the last X-Forwarded-For entry), or to this server. */
function peer(headers: Headers, socketIp: string): string {
  const forwarded = first(headers["x-forwarded-for"]);
  const last = forwarded?.split(",").pop()?.trim();
  return plain(last && isIP(plain(last)) ? last : socketIp);
}

export interface Visitor {
  ip: string;
  /** Two-letter country from Cloudflare, only when the request really came through it. */
  country?: string;
}

export function visitor(headers: Headers, socketIp: string): Visitor {
  const from = peer(headers, socketIp);
  if (!isCloudflare(from)) return { ip: from };
  const real = first(headers["cf-connecting-ip"])?.trim();
  const country = first(headers["cf-ipcountry"]);
  return {
    ip: real && isIP(real) ? plain(real) : from,
    country: typeof country === "string" && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : undefined,
  };
}
