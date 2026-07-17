const crypto = require("crypto");
const {getPublicProductCatalog} = require("./_catalog");

function send(response, status, payload) {
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(payload);
}

function catalogEtag(payload) {
  const digest = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return `"${digest}"`;
}

function requestMatchesEtag(request, etag) {
  const header = String(request.headers?.["if-none-match"] || "");
  return header.split(",").some(value => value.trim() === etag || value.trim() === "*");
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return send(response, 405, {success:false,message:"Method not allowed"});
  }

  try {
    const products = await getPublicProductCatalog();
    const payload = {success:true,products};
    const etag = catalogEtag(payload);
    response.setHeader("Cache-Control", "private, no-cache, max-age=0, must-revalidate");
    response.setHeader("ETag", etag);
    response.setHeader("Vary", "Accept-Encoding");
    if (requestMatchesEtag(request, etag)) return response.status(304).end();
    return response.status(200).json(payload);
  } catch (error) {
    return send(response, error.status || 503, {
      success:false,
      message:"Product catalog is not available. Please try again."
    });
  }
};
