import { describe, expect, it } from "vitest";
import { ipv4MatchesCidr, normalizeClientIp, parseCidr, parseIpv4 } from "./cidr.js";

describe("CIDR utilities", () => {
  it("parses IPv4 addresses", () => {
    expect(parseIpv4("192.168.0.1")).toBe(3232235521);
  });

  it("parses CIDR notation", () => {
    expect(parseCidr("192.168.0.0/24")).toMatchObject({
      address: "192.168.0.0",
      prefix: 24
    });
  });

  it("matches IPv4 addresses inside a CIDR range", () => {
    expect(ipv4MatchesCidr("192.168.0.42", "192.168.0.0/24")).toBe(true);
    expect(ipv4MatchesCidr("192.168.1.42", "192.168.0.0/24")).toBe(false);
  });

  it("normalizes IPv6-mapped local addresses", () => {
    expect(normalizeClientIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeClientIp("::1")).toBe("127.0.0.1");
  });
});
