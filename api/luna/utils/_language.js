// Stateless Luna language helpers kept private from API route discovery.
const {normalizeText, foldText} = require("./_strings");

function isSpanish(message) {
  const text = normalizeText(message);
  return /[¿¡ñáéíóúü]/i.test(message)
    || /\b(me refiero|quise decir|ambos|ambas|el otro|la otra|el segundo|la segunda)\b/.test(text)
    || /\b(necesito|puedes|puedo|reservar|paquete|plomero|contesta|contestan|unidad|quien|quién|vive|hoy|proveedor|proveedores|gracias|hola|no encuentro|perdí|perdi|llave|correo|buzón|buzon|se puede|hablando|jefe|modelo|administra|junta|gimnasio|dime|soy|presidente|monto|saldo|cuenta|aceite|alfombra|recepción|recepcion|administrador|aire|enfria|enfría|lavadora|secadora|nevera|refrigerador|refri|lavaplatos|horno|microondas|plomeria|plomería|sirve|prende|daño|dano|rompio|rompió)\b/.test(text);
}

function preferredLanguage(message, history = []) {
  const current = foldText(message);
  if (/\b(let'?s continue in english|please answer in english|answer in english|speak english|english please)\b/.test(current)) return "en";
  if (/\b(solo hablo espanol|solo hablo español|solo hablo espa.ol|hablame en espanol|háblame en español|prefiero espanol|prefiero español|en espanol por favor|en español por favor)\b/.test(current)) return "es";
  for (const item of history.slice().reverse()) {
    if (item.role !== "user") continue;
    const text = foldText(item.content);
    if (/\b(let'?s continue in english|please answer in english|answer in english|speak english|english please)\b/.test(text)) return "en";
    if (/\b(solo hablo espanol|solo hablo español|solo hablo espa.ol|hablame en espanol|háblame en español|prefiero espanol|prefiero español|en espanol por favor|en español por favor)\b/.test(text)) return "es";
  }
  return null;
}

function shouldReplyInSpanish(message, history = []) {
  const preference = preferredLanguage(message, history);
  if (preference === "es") return true;
  if (preference === "en") return false;
  return isSpanish(message) || history.slice(-4).some(item => isSpanish(item.content));
}

function languagePreferenceReply(message) {
  const preference = preferredLanguage(message, []);
  if (preference === "es") return "Claro, seguimos en español.";
  if (preference === "en") return "Of course, we can continue in English.";
  return null;
}

module.exports = {
  isSpanish,
  preferredLanguage,
  shouldReplyInSpanish,
  languagePreferenceReply
};
