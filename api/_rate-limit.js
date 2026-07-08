const buckets = new Map();

function requestIp(request) {
  const forwardedFor = request.headers["x-forwarded-for"];
  const forwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const candidate = String(forwarded || request.headers["x-real-ip"] || request.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
  return candidate || "unknown";
}

function prune(now) {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function enforceRateLimit(request, {namespace, limit, windowMs}) {
  const now = Date.now();
  prune(now);
  const key = `${namespace}:${requestIp(request)}`;
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, {count:1, resetAt:now + windowMs});
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    const error = new Error("Too many requests. Please try again later.");
    error.status = 429;
    throw error;
  }
}

module.exports = {enforceRateLimit, requestIp};
