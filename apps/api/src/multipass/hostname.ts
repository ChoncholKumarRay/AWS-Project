import { randomBytes } from "node:crypto";

const MAX_HOSTNAME_LENGTH = 63;
const SUFFIX_LENGTH = 4;

export function sanitizeHostnameBase(input: string): string {
  const sanitized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || "cloud-instance";
}

export function createUniqueInstanceName(input: string, suffix = createSuffix()) {
  const baseMaxLength = MAX_HOSTNAME_LENGTH - suffix.length - 1;
  const base = sanitizeHostnameBase(input)
    .slice(0, baseMaxLength)
    .replace(/-$/g, "");

  return `${base || "cloud-instance"}-${suffix}`;
}

function createSuffix() {
  return randomBytes(SUFFIX_LENGTH / 2).toString("hex");
}
