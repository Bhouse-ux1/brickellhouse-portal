module.exports = function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({enabled:false,message:"Method not allowed"});
  }

  const url = process.env.SUPABASE_URL || "";
  const anonKey = process.env.SUPABASE_ANON_KEY || "";
  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({
    enabled:Boolean(url && anonKey),
    url:url || "",
    anonKey:anonKey || ""
  });
};
