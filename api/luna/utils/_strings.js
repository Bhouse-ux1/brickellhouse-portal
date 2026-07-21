// Stateless text normalization helpers kept private from API route discovery.
function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function normalizeAliases(text) {
  const replacements = [
    [/\b(amenitie|amenites|amenitys|amenitis|ammenity|amenety|amenetys|amenit|amen)\b/g, "amenity"],
    [/\b(amenidade|amenida|ameniad)\b/g, "amenidad"],
    [/\b(pol|poool|plol|pooll)\b/g, "pool"],
    [/\b(piscna|picina|piscinaa)\b/g, "piscina"],
    [/\b(gim|gymm|gymn)\b/g, "gym"],
    [/\b(gimnacio|gimansio|jimnasio|gimnasioo)\b/g, "gimnasio"],
    [/\b(souna|suna|saunna)\b/g, "sauna"],
    [/\b(steem|steamm)\b/g, "steam"],
    [/\b(vapoor|bapor)\b/g, "vapor"],
    [/\b(massge|masage|massagee)\b/g, "massage"],
    [/\b(masajesa|masje)\b/g, "masaje"],
    [/\b(bbqq|barbeque|barbecue)\b/g, "bbq"],
    [/\b(pakage|packagee|packge|pacakge|paket)\b/g, "package"],
    [/\b(paqute|pakete|paquetee|paqete)\b/g, "paquete"],
    [/\b(recieving|receving|receivin|receivng)\b/g, "receiving"],
    [/\b(reciviendo|recibiendo|recepcion paquetes)\b/g, "receiving"],
    [/\b(parkng|parkin|parcking)\b/g, "parking"],
    [/\b(garag|garadge)\b/g, "garage"],
    [/\b(elevater|elevtor|elevatorr)\b/g, "elevator"],
    [/\b(fridge|frig|refridgerator|refrigator|refrigerater|refridger|refridg)\b/g, "refrigerator"],
    [/\b(refri|refrigerado|refrijerador)\b/g, "refrigerador"],
    [/\bdish\s+washer\b/g, "dishwasher"],
    [/\b(dishwahser|dishwaser)\b/g, "dishwasher"],
    [/\b(ac|a\/c|air conditioning|airconditioner|air cond|aircon)\b/g, "air conditioner"],
    [/\b(my air|air broke)\b/g, "my air conditioner"],
    [/\b(airee|aire malo)\b/g, "aire"],
    [/\b(maint|maintanance|maintenence|maintnance)\b/g, "maintenance"],
    [/\b(theatree)\b/g, "theater"],
    [/\b(loungee|owner lounge)\b/g, "owners lounge"],
    [/\b(clubroom|clubrm)\b/g, "club room"],
    [/\b(paqute|pakete|paqete)\b/g, "paquete"],
    [/\b(yave|labe|llabe|yavee)\b/g, "llave"],
    [/\b(buson)\b/g, "buzon"],
    [/\b(correoo|coreo)\b/g, "correo"],
    [/\b(unidadd|uniddad)\b/g, "unidad"],
    [/\b(lavadra|labadora)\b/g, "lavadora"],
    [/\b(secadoda|secadoraa)\b/g, "secadora"],
    [/\b(plomer)\b/g, "plomeria"],
    [/\b(electrisidad|electricida)\b/g, "electricidad"],
    [/\b(administracion|admin)\b/g, "administrador"],
    [/\b(resepcion)\b/g, "recepcion"],
    [/\b(fridge broke|my fridge)\b/g, "refrigerator not working"],
    [/\b(dishwasher broke|washer broke|dryer broke)\b/g, "$1 not working"],
    [/\b(my ac|my air conditioner|air conditioner broke)\b/g, "my air conditioner"],
    [/\blost key\b/g, "key"],
    [/\bmail key\b/g, "mailbox key"],
    [/\b(garage remote|parking remote|garage clicker|parking clicker)\b/g, "parking fob"],
    [/\b(mail room|package room|package locker|amazon locker)\b/g, "receiving package locker"],
    [/\b(se dano|se daño|no sirve|no prende|se rompio|se rompió)\b/g, "no funciona"],
    [/\b(no enfria|no enfría)\b/g, "no enfria"],
    [/\b(perdi la llave|perdí la llave)\b/g, "perdi mi llave"],
    [/\b(llave correo)\b/g, "llave del correo"],
    [/\b(llave buzon|llave buzón)\b/g, "llave del buzon"],
    [/\b(llave apartamento)\b/g, "llave del apartamento"],
    [/\b(paquete amazon|locker amazon)\b/g, "amazon locker package"]
  ];
  return replacements.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), text);
}

function foldText(value) {
  return normalizeAliases(normalizeText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
}

module.exports = {
  normalizeText,
  normalizeAliases,
  foldText
};
