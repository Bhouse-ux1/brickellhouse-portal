const {getPublicProductCatalog} = require("./_catalog");

function send(response, status, payload) {
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(payload);
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return send(response, 405, {success:false,message:"Method not allowed"});
  }

  try {
    const products = await getPublicProductCatalog();
    return send(response, 200, {success:true,products});
  } catch (error) {
    return send(response, error.status || 503, {
      success:false,
      message:"Product catalog is not available. Please try again."
    });
  }
};
