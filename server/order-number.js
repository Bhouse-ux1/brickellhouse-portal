const crypto = require("crypto");

const PUBLIC_ORDER_NUMBER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PUBLIC_ORDER_NUMBER_LENGTH = 5;
const MAX_PUBLIC_ORDER_NUMBER_ATTEMPTS = 10;

function generatePublicOrderNumber() {
  const bytes = crypto.randomBytes(PUBLIC_ORDER_NUMBER_LENGTH);
  let code = "";
  for (const byte of bytes) code += PUBLIC_ORDER_NUMBER_ALPHABET[byte & 31];
  return `BH-${code}`;
}

function isUniqueViolation(error) {
  return error?.payload?.code === "23505";
}

async function insertOrderWithGeneratedNumber(insertOrder, options = {}) {
  const generate = options.generate || generatePublicOrderNumber;
  const maxAttempts = Number.isInteger(options.maxAttempts) && options.maxAttempts > 0
    ? options.maxAttempts
    : MAX_PUBLIC_ORDER_NUMBER_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const orderNumber = generate();
    try {
      const result = await insertOrder(orderNumber);
      return {orderNumber, result};
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      if (attempt === maxAttempts) {
        const exhausted = new Error("Unable to allocate an order reference. Please try again.");
        exhausted.status = 503;
        throw exhausted;
      }
    }
  }

  throw new Error("Unable to allocate an order reference.");
}

module.exports = {
  MAX_PUBLIC_ORDER_NUMBER_ATTEMPTS,
  PUBLIC_ORDER_NUMBER_ALPHABET,
  generatePublicOrderNumber,
  insertOrderWithGeneratedNumber
};
