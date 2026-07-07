function normalizedCheckoutProvider() {
  const provider = String(process.env.CHECKOUT_PROVIDER || "").trim().toLowerCase();
  return provider === "stripe" ? "stripe" : "square";
}

module.exports = function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({
      enabled:false,
      provider:normalizedCheckoutProvider(),
      publishableKey:"",
      message:"Method not allowed"
    });
  }

  const provider = normalizedCheckoutProvider();
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || "";
  const testMode = publishableKey.startsWith("pk_test_");
  const enabled = provider === "stripe" && testMode;
  const mode = publishableKey.startsWith("pk_live_")
    ? "live"
    : publishableKey.startsWith("pk_test_") ? "test" : "";

  return response.status(200).json({
    enabled,
    provider,
    publishableKey:enabled ? publishableKey : "",
    mode:enabled ? mode : "",
    message:enabled || provider !== "stripe" ? "" : "Stripe test checkout is not available."
  });
};
