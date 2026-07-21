// Parking responders kept private from API route discovery.
const {foldText} = require("../utils/_strings");
const {shouldReplyInSpanish} = require("../utils/_language");

function parkingIntent(message) {
  return /\b(parking|aps|valet|garage|parking attendant|estacionamiento|garaje|encargado de estacionamiento)\b/.test(foldText(message));
}

function parkingContributionReply(message, history = []) {
  if (!parkingIntent(message)) return null;
  const spanish = shouldReplyInSpanish(message, history);
  return spanish
    ? "El estacionamiento de BrickellHouse es administrado mediante APS. El encargado de estacionamiento está disponible las 24 horas, los 7 días de la semana."
    : "BrickellHouse parking is managed through APS. The Parking Attendant is available 24/7.";
}

module.exports = {
  parkingIntent,
  parkingContributionReply
};
