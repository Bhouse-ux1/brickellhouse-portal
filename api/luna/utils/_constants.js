// Stateless Luna configuration constants kept private from API route discovery.
const OPENAI_MODEL = "gpt-5.6-luna";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_MESSAGE_LENGTH = 1500;
const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_MESSAGE_LENGTH = 900;
const MAX_RETRIEVED_MODULES = 4;
const OPENAI_MAX_OUTPUT_TOKENS = 450;
const SAFE_ERROR_MESSAGE = "Sorry, I could not respond right now. Please try again.";

module.exports = {
  OPENAI_MODEL,
  OPENAI_RESPONSES_URL,
  MAX_MESSAGE_LENGTH,
  MAX_HISTORY_MESSAGES,
  MAX_HISTORY_MESSAGE_LENGTH,
  MAX_RETRIEVED_MODULES,
  OPENAI_MAX_OUTPUT_TOKENS,
  SAFE_ERROR_MESSAGE
};
