import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
  createHmac,
} from "node:crypto";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "request_failed",
  ) {
    super(message);
  }
}
export const hash = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
export const random = () => randomBytes(32).toString("base64url");
export function encrypt(value: string, key: string) {
  const k = Buffer.from(key, "base64");
  if (k.length !== 32)
    throw new HttpError(
      503,
      "Session encryption is not configured",
      "configuration",
    );
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
}
export function decrypt(value: string, key: string) {
  const b = Buffer.from(value, "base64");
  const c = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "base64"),
    b.subarray(0, 12),
  );
  c.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([c.update(b.subarray(28)), c.final()]).toString("utf8");
}
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function verifyHmac(body: Buffer, signature: string, secret: string) {
  return (
    Boolean(secret) &&
    equal(
      signature,
      `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    )
  );
}
export function canonicalRepo(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, "Use an HTTPS GitHub repository URL");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /%|\\/.test(value)
  )
    throw new HttpError(400, "Use an exact HTTPS github.com repository URL");
  const m = url.pathname.match(
    /^\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/?$/,
  );
  if (!m || m[2] === "." || m[2] === "..")
    throw new HttpError(400, "Expected github.com/owner/repository");
  return `${m[1]}/${m[2]}`;
}
export function redact(value: string) {
  return value
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)\b/g,
      "[redacted]",
    )
    .replace(
      /(authorization|api[_-]?key|token|password|secret)(["'\s:=]+)[^\s,"'}]+/gi,
      "$1$2[redacted]",
    )
    .replace(/https:\/\/[^\s/@]+:[^\s/@]+@/g, "https://[redacted]@");
}
