const OPENAI_MODEL = "gpt-5.4-mini";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_MESSAGE_LENGTH = 1500;
const SAFE_ERROR_MESSAGE = "Sorry, I could not respond right now. Please try again.";

const SYSTEM_INSTRUCTIONS = [
  "You are the BrickellHouse resident assistant.",
  "Answer resident questions in a friendly, professional, concise way.",
  "Help with general building information, resident portal guidance, services, amenities, parking/APS guidance, packages, maintenance-related general questions, and website navigation.",
  "Do not invent policies. If unsure, tell the resident to contact the management office.",
  "Do not provide legal, financial, medical, or emergency advice.",
  "Do not claim to access private resident records unless that functionality is explicitly provided by the backend.",
  "Do not ask for payment card details, passwords, Social Security numbers, or private account information.",
  "For urgent building matters, emergencies, or safety concerns, direct the resident to contact management, the front desk, or emergency services as appropriate."
].join(" ");

function send(response, status, payload) {
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(payload);
}

function extractAssistantText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const text = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") text.push(content.text);
    }
  }
  return text.join("\n").trim();
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return send(response, 405, {success:false,message:"Method not allowed"});
  }

  const message = String(request.body?.message || "").trim();
  if (!message) return send(response, 400, {success:false,message:"Please enter a message."});
  if (message.length > MAX_MESSAGE_LENGTH) {
    return send(response, 400, {success:false,message:`Please keep your message under ${MAX_MESSAGE_LENGTH} characters.`});
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OpenAI chat route is missing OPENAI_API_KEY.");
    return send(response, 503, {success:false,message:SAFE_ERROR_MESSAGE});
  }

  try {
    const openAiResponse = await fetch(OPENAI_RESPONSES_URL, {
      method:"POST",
      headers:{
        "Authorization":`Bearer ${apiKey}`,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        model:OPENAI_MODEL,
        instructions:SYSTEM_INSTRUCTIONS,
        input:message,
        max_output_tokens:450,
        text:{verbosity:"low"},
        reasoning:{effort:"low"}
      })
    });

    const payload = await openAiResponse.json().catch(() => ({}));
    if (!openAiResponse.ok) {
      console.error("OpenAI chat request failed", {
        status:openAiResponse.status,
        type:payload?.error?.type || "unknown"
      });
      return send(response, 502, {success:false,message:SAFE_ERROR_MESSAGE});
    }

    const reply = extractAssistantText(payload);
    if (!reply) return send(response, 502, {success:false,message:SAFE_ERROR_MESSAGE});
    return send(response, 200, {success:true,reply});
  } catch (error) {
    console.error("OpenAI chat route failed", error?.name || "Error");
    return send(response, 500, {success:false,message:SAFE_ERROR_MESSAGE});
  }
};
