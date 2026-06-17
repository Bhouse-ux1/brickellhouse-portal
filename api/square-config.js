module.exports = function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({enabled:false,message:"Method not allowed"});
  }

  const environment = (process.env.SQUARE_ENVIRONMENT || "sandbox").toLowerCase();
  const applicationId = process.env.SQUARE_APPLICATION_ID || "";
  const locationId = process.env.SQUARE_LOCATION_ID || "";
  const supportedEnvironment = environment === "sandbox" || environment === "production";
  const enabled = supportedEnvironment && Boolean(applicationId && locationId && process.env.SQUARE_ACCESS_TOKEN);

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({
    enabled,
    environment,
    applicationId:enabled ? applicationId : "",
    locationId:enabled ? locationId : "",
    processingFeePercent:Number(process.env.PROCESSING_FEE_PERCENT || "3"),
    message:supportedEnvironment ? "" : "Square environment must be sandbox or production",
    sdkUrl:environment === "production"
      ? "https://web.squarecdn.com/v1/square.js"
      : "https://sandbox.web.squarecdn.com/v1/square.js"
  });
};
