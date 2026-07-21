// Package responders kept private from API route discovery.
const {normalizeText, foldText} = require("../utils/_strings");
const {isSpanish, shouldReplyInSpanish} = require("../utils/_language");

function createPackageResponders({buildContextText, alreadyTried, receivingEmail:approvedReceivingEmail}) {
  function hasPackageContext(message, history) {
    const text = normalizeText(buildContextText(message, history.slice(-4)));
    return /\b(package|packages|receiving|amazon|locker|paquete|paquetes|receiving office|recepción|recepcion)\b/.test(text);
  }

  function packageIntent(message) {
    return /\b(package|packages|package room|mail room|receiving|amazon locker|paquete|paquetes|cuarto de paquetes|recepcion de paquetes|recepción de paquetes|casillero)\b/.test(foldText(message));
  }

  function packageReply(message, history) {
    const text = normalizeText(message);
    const spanish = isSpanish(message);
    if (!hasPackageContext(message, history)) return null;
    if (/\b(food delivery|food order|comida|entrega de comida)\b/.test(text)) {
      return spanish
        ? "Las entregas de comida son manejadas por el Front Desk. Ellos te contactarán cuando llegue tu comida."
        : "Food deliveries are handled by the Front Desk. They'll contact you when your food arrives.";
    }
    if (alreadyTried(message)) {
      const firstFollowup = text.includes("what if")
        || text.includes("qué pasa")
        || text.includes("que pasa")
        || text.includes("pasa si no contestan");
      if (spanish) {
        return firstFollowup
          ? "Por favor permite algo de tiempo para que Receiving responda. Si todavía no recibes respuesta, el Front Desk puede ayudarte a dirigir la solicitud."
          : "Si ya contactaste a Receiving y no has recibido respuesta, por favor contacta al Front Desk para que puedan ayudarte a dirigir tu solicitud.";
      }
      return firstFollowup
        ? "Please allow some time for Receiving to respond. If you still don't hear back, the Front Desk can help point you in the right direction."
        : "If you already contacted Receiving and haven't received a response, please contact the Front Desk so they can help direct your request.";
    }
    if (/\b(email again|what'?s the email|their email|correo|email)\b/.test(text)) {
      const receivingEmail = approvedReceivingEmail;
      return spanish
        ? `El correo de Receiving es ${receivingEmail}.`
        : `The Receiving Office email is ${receivingEmail}.`;
    }
    if (/\b(can'?t find|cant find|missing|not found|no encuentro|no encuentro mi paquete|perdido)\b/.test(text)) {
      const receivingEmail = approvedReceivingEmail;
      return spanish
        ? `Por favor contacta a la oficina de Receiving en ${receivingEmail} para que puedan ayudarte.`
        : `Please contact the Receiving Office at ${receivingEmail} so they can assist you.`;
    }
    return null;
  }

  function packageContributionReply(message, history = []) {
    const existing = packageReply(message, history);
    if (existing) return existing;
    if (!packageIntent(message)) return null;
    const text = foldText(message);
    if (!/\b(where|location|find|donde|dónde|ubicacion|ubicación|package room|mail room|cuarto de paquetes)\b/.test(text)) return null;
    const receivingEmail = approvedReceivingEmail;
    return shouldReplyInSpanish(message, history)
      ? `Por favor contacta a la oficina de Receiving en ${receivingEmail} para que puedan ayudarte.`
      : `Please contact the Receiving Office at ${receivingEmail} so they can assist you.`;
  }

  return {
    hasPackageContext,
    packageIntent,
    packageReply,
    packageContributionReply
  };
}

module.exports = {createPackageResponders};
