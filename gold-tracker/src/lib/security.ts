export function sameOrigin(
  origin: string | null,
  host: string | null,
  protocol: string,
  configuredOrigin = process.env.APP_ORIGIN,
) {
  if (!origin || !host) return false;
  try {
    const target = new URL(`${protocol}//${host}`);
    if (configuredOrigin)
      return (
        origin === new URL(configuredOrigin).origin &&
        target.host === new URL(configuredOrigin).host
      );
    return (
      ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) &&
      origin === target.origin
    );
  } catch {
    return false;
  }
}
