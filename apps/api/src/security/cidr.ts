export type ParsedCidr = {
  address: string;
  prefix: number;
  mask: number;
  network: number;
};

export function parseIpv4(value: string): number {
  const parts = value.split(".");

  if (parts.length !== 4) {
    throw new Error(`Invalid IPv4 address: ${value}`);
  }

  return parts.reduce((accumulator, part) => {
    if (!/^\d+$/.test(part)) {
      throw new Error(`Invalid IPv4 address: ${value}`);
    }

    const octet = Number(part);

    if (octet < 0 || octet > 255) {
      throw new Error(`Invalid IPv4 address: ${value}`);
    }

    return (accumulator << 8) + octet;
  }, 0) >>> 0;
}

export function parseCidr(value: string): ParsedCidr {
  const [address, prefixRaw] = value.includes("/") ? value.split("/") : [value, "32"];
  const prefix = Number(prefixRaw);

  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid CIDR prefix: ${value}`);
  }

  const parsedAddress = parseIpv4(address);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

  return {
    address,
    prefix,
    mask,
    network: parsedAddress & mask
  };
}

export function ipv4MatchesCidr(ipAddress: string, cidr: string) {
  const ip = parseIpv4(ipAddress);
  const parsed = parseCidr(cidr);
  return (ip & parsed.mask) === parsed.network;
}

export function normalizeClientIp(value: string | undefined) {
  if (!value) {
    return null;
  }

  const first = value.split(",")[0]?.trim();

  if (!first) {
    return null;
  }

  if (first.startsWith("::ffff:")) {
    return first.slice("::ffff:".length);
  }

  if (first === "::1") {
    return "127.0.0.1";
  }

  return first;
}
