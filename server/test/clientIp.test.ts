import { describe, expect, it } from "vitest";
import { isCloudflare, visitor } from "../src/clientIp";
import { createLimiter } from "../src/rateLimit";

describe("visitor", () => {
  it("believes CF-Connecting-IP when the request came from Cloudflare", () => {
    const headers = { "x-forwarded-for": "172.68.10.20", "cf-connecting-ip": "203.0.113.7", "cf-ipcountry": "fr" };
    expect(visitor(headers, "172.18.0.3")).toEqual({ ip: "203.0.113.7", country: "FR" });
  });

  it("ignores Cloudflare headers written by someone reaching the server directly", () => {
    const headers = { "x-forwarded-for": "198.51.100.9", "cf-connecting-ip": "1.2.3.4", "cf-ipcountry": "US" };
    expect(visitor(headers, "172.18.0.3")).toEqual({ ip: "198.51.100.9" });
  });

  it("uses the last X-Forwarded-For entry (the one the proxy added)", () => {
    expect(visitor({ "x-forwarded-for": "6.6.6.6, 198.51.100.9" }, "10.0.0.1").ip).toBe("198.51.100.9");
  });

  it("falls back to the socket address without a proxy", () => {
    expect(visitor({}, "::ffff:127.0.0.1").ip).toBe("127.0.0.1");
    expect(visitor({ "x-forwarded-for": "not an ip" }, "127.0.0.1").ip).toBe("127.0.0.1");
  });

  it("knows Cloudflare ranges in IPv4 and IPv6", () => {
    expect(isCloudflare("104.16.1.1")).toBe(true);
    expect(isCloudflare("::ffff:162.158.5.5")).toBe(true);
    expect(isCloudflare("2606:4700::1")).toBe(true);
    expect(isCloudflare("8.8.8.8")).toBe(false);
    expect(isCloudflare("garbage")).toBe(false);
  });
});

describe("createLimiter", () => {
  it("allows max actions per key, then refuses", () => {
    const allow = createLimiter(2, 60_000);
    expect(allow("a")).toBe(true);
    expect(allow("a")).toBe(true);
    expect(allow("a")).toBe(false);
    expect(allow("b")).toBe(true);
  });

  it("forgets the oldest keys past its size", () => {
    const allow = createLimiter(1, 60_000, 2);
    allow("a");
    allow("b");
    allow("c");
    // "a" was dropped, so it starts again.
    expect(allow("a")).toBe(true);
    expect(allow("c")).toBe(false);
  });
});
