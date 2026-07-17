const crypto = require("crypto");
const {supabaseRequest} = require("./_supabase");
const {enforceRateLimit} = require("./_rate-limit");

const ORIGINAL_BUCKET = "product-image-originals";
const FINAL_BUCKET = "product-images";
const MAX_ORIGINAL_BYTES = 8 * 1024 * 1024;
const MAX_DERIVATIVE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 12000;
const MAX_IMAGE_PIXELS = 40_000_000;
const DERIVATIVE_SIZE = 1200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FINAL_PATH_PATTERN = /^products\/[0-9a-f]{24}\/[0-9a-f-]{36}\.webp$/;
const ORIGINAL_PATH_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp)$/i;

function send(response, status, payload) {
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(payload);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function supabaseConfig() {
  return {
    url:requiredEnv("SUPABASE_URL").replace(/\/$/, ""),
    anonKey:requiredEnv("SUPABASE_ANON_KEY"),
    serviceRoleKey:requiredEnv("SUPABASE_SERVICE_ROLE_KEY")
  };
}

function bearerToken(request) {
  const header = request.headers.authorization || request.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1] : "";
}

async function requireApprovedManagement(request, response) {
  const token = bearerToken(request);
  if (!token) {
    send(response, 401, {success:false,message:"Management login required."});
    return null;
  }

  const {url, anonKey} = supabaseConfig();
  const userResponse = await fetch(`${url}/auth/v1/user`, {
    headers:{
      "apikey":anonKey,
      "Authorization":`Bearer ${token}`,
      "Accept":"application/json"
    }
  });
  if (!userResponse.ok) {
    send(response, 401, {success:false,message:"Management login required."});
    return null;
  }
  const user = await userResponse.json();
  if (!UUID_PATTERN.test(String(user?.id || ""))) {
    send(response, 401, {success:false,message:"Management login required."});
    return null;
  }

  const approvalResponse = await fetch(`${url}/rest/v1/rpc/is_management_user`, {
    method:"POST",
    headers:{
      "apikey":anonKey,
      "Authorization":`Bearer ${token}`,
      "Content-Type":"application/json",
      "Accept":"application/json"
    },
    body:"{}"
  });
  const approved = approvalResponse.ok ? await approvalResponse.json() : false;
  if (approved !== true) {
    send(response, 403, {success:false,message:"Approved Management access at the required authentication level is required."});
    return null;
  }
  return {token,user};
}

function readPng(buffer) {
  const signature = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(signature)) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let foundImageData = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > buffer.length) return null;
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) return null;
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
    }
    if (type === "IDAT") foundImageData = true;
    if (type === "IEND") {
      if (length !== 0 || !foundImageData || end !== buffer.length) return null;
      return {mime:"image/png",extension:"png",width,height};
    }
    offset = end;
  }
  return null;
}

function readJpeg(buffer) {
  if (buffer.length < 12 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  if (buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) return null;
  let offset = 2;
  let width = 0;
  let height = 0;
  let foundScan = false;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      if (length < 7) return null;
      height = buffer.readUInt16BE(offset + 3);
      width = buffer.readUInt16BE(offset + 5);
    }
    if (marker === 0xda) { foundScan = true; break; }
    offset += length;
  }
  return foundScan && width && height ? {mime:"image/jpeg",extension:"jpg",width,height} : null;
}

function readWebp(buffer) {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") return null;
  const declaredSize = buffer.readUInt32LE(4) + 8;
  if (declaredSize !== buffer.length || declaredSize < 30) return null;
  let offset = 12;
  let canvasWidth = 0;
  let canvasHeight = 0;
  while (offset + 8 <= declaredSize) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + size > declaredSize) return null;
    if (type === "VP8X" && size >= 10) {
      canvasWidth = 1 + buffer[data + 4] + (buffer[data + 5] << 8) + (buffer[data + 6] << 16);
      canvasHeight = 1 + buffer[data + 7] + (buffer[data + 8] << 8) + (buffer[data + 9] << 16);
    }
    if (type === "VP8 " && size >= 10 && buffer[data + 3] === 0x9d && buffer[data + 4] === 0x01 && buffer[data + 5] === 0x2a) {
      const image = {
        mime:"image/webp",extension:"webp",
        width:buffer.readUInt16LE(data + 6) & 0x3fff,
        height:buffer.readUInt16LE(data + 8) & 0x3fff
      };
      return canvasWidth && (canvasWidth !== image.width || canvasHeight !== image.height) ? null : image;
    }
    if (type === "VP8L" && size >= 5 && buffer[data] === 0x2f) {
      const b1 = buffer[data + 1], b2 = buffer[data + 2], b3 = buffer[data + 3], b4 = buffer[data + 4];
      const image = {
        mime:"image/webp",extension:"webp",
        width:1 + b1 + ((b2 & 0x3f) << 8),
        height:1 + ((b2 & 0xc0) >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10)
      };
      return canvasWidth && (canvasWidth !== image.width || canvasHeight !== image.height) ? null : image;
    }
    if (type === "ANIM" || type === "ANMF") return null;
    offset = data + size + (size % 2);
  }
  return null;
}

function inspectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw Object.assign(new Error("Image data is required."), {status:400});
  const image = readPng(buffer) || readJpeg(buffer) || readWebp(buffer);
  const width = Number(image?.width || 0);
  const height = Number(image?.height || 0);
  if (!image || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw Object.assign(new Error("The selected file is not a valid PNG, JPEG, or WebP image."), {status:400});
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    throw Object.assign(new Error("The selected image dimensions are too large."), {status:400});
  }
  return image;
}

function validateOriginal(buffer, expectedExtension = "") {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > MAX_ORIGINAL_BYTES) {
    throw Object.assign(new Error("The selected image is larger than 8 MB."), {status:400});
  }
  const image = inspectImage(buffer);
  if (expectedExtension && image.extension !== expectedExtension) {
    throw Object.assign(new Error("The selected file type does not match its image content."), {status:400});
  }
  return image;
}

function decodeDerivative(value) {
  const encoded = String(value || "");
  if (!encoded || encoded.length > Math.ceil(MAX_DERIVATIVE_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw Object.assign(new Error("The processed product image is invalid."), {status:400});
  }
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.length > MAX_DERIVATIVE_BYTES) {
    throw Object.assign(new Error("The processed product image is too large."), {status:400});
  }
  const image = inspectImage(buffer);
  if (image.mime !== "image/webp" || image.width !== DERIVATIVE_SIZE || image.height !== DERIVATIVE_SIZE) {
    throw Object.assign(new Error("The processed product image must be a 1200 by 1200 WebP image."), {status:400});
  }
  return buffer;
}

function validateCrop(value) {
  const crop = {
    version:Number(value?.version),
    zoom:Number(value?.zoom),
    x:Number(value?.x),
    y:Number(value?.y),
    aspect:String(value?.aspect || "")
  };
  if (crop.version !== 1 || crop.aspect !== "1:1" || !Number.isFinite(crop.zoom) || !Number.isFinite(crop.x) || !Number.isFinite(crop.y)
    || crop.zoom < 1 || crop.zoom > 4 || crop.x < -1 || crop.x > 1 || crop.y < -1 || crop.y > 1) {
    throw Object.assign(new Error("The image crop settings are invalid."), {status:400});
  }
  return {
    version:1,
    zoom:Math.round(crop.zoom * 10000) / 10000,
    x:Math.round(crop.x * 10000) / 10000,
    y:Math.round(crop.y * 10000) / 10000,
    aspect:"1:1"
  };
}

function encodeStoragePath(path) {
  return String(path).split("/").map(segment => encodeURIComponent(segment)).join("/");
}

async function storageRequest(bucket, path, {method = "GET", body, contentType = "application/octet-stream"} = {}) {
  const {url, serviceRoleKey} = supabaseConfig();
  const response = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeStoragePath(path)}`, {
    method,
    headers:{
      "apikey":serviceRoleKey,
      "Authorization":`Bearer ${serviceRoleKey}`,
      ...(body === undefined ? {} : {"Content-Type":contentType,"x-upsert":"false"})
    },
    body
  });
  if (!response.ok) {
    const error = new Error("Supabase Storage request failed");
    error.status = response.status;
    throw error;
  }
  return response;
}

async function removeStorageObject(bucket, path) {
  if (!path) return;
  const {url, serviceRoleKey} = supabaseConfig();
  const response = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}`, {
    method:"DELETE",
    headers:{
      "apikey":serviceRoleKey,
      "Authorization":`Bearer ${serviceRoleKey}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({prefixes:[path]})
  });
  if (!response.ok) throw new Error("Supabase Storage cleanup failed");
}

async function safeRemoveStorageObject(bucket, path) {
  try {
    await removeStorageObject(bucket, path);
  } catch (error) {
    console.error("Product image cleanup failed", {bucket,path,message:error?.message || "Error"});
  }
}

function stagedPathForUser(path, userId) {
  const match = String(path || "").match(ORIGINAL_PATH_PATTERN);
  if (!match || !String(path).startsWith(`${userId}/`)) {
    throw Object.assign(new Error("The staged product image path is invalid."), {status:400});
  }
  return {path:String(path),extension:match[1].toLowerCase()};
}

async function productRow(productId) {
  const rows = await supabaseRequest(`products?select=id,image_url,image_storage_path,image_original_path,image_crop&id=eq.${encodeURIComponent(productId)}&limit=1`, {prefer:""});
  return Array.isArray(rows) ? rows[0] : null;
}

async function finalizeImage(request, response, approved) {
  const productId = String(request.body?.productId || "").trim();
  if (!PRODUCT_ID_PATTERN.test(productId)) return send(response, 400, {success:false,message:"A valid product ID is required."});
  const product = await productRow(productId);
  if (!product) return send(response, 404, {success:false,message:"The product could not be found."});

  const crop = validateCrop(request.body?.crop);
  const derivative = decodeDerivative(request.body?.derivativeBase64);
  const replacingOriginal = Boolean(request.body?.stagedPath);
  let originalPath = String(product.image_original_path || "");

  if (replacingOriginal) {
    const staged = stagedPathForUser(request.body.stagedPath, approved.user.id);
    originalPath = staged.path;
    const originalResponse = await storageRequest(ORIGINAL_BUCKET, originalPath);
    const original = Buffer.from(await originalResponse.arrayBuffer());
    try {
      validateOriginal(original, staged.extension);
    } catch (error) {
      await safeRemoveStorageObject(ORIGINAL_BUCKET, originalPath);
      throw error;
    }
  } else {
    if (!ORIGINAL_PATH_PATTERN.test(originalPath)) {
      return send(response, 400, {success:false,message:"Choose an image file before saving this crop."});
    }
    const originalResponse = await storageRequest(ORIGINAL_BUCKET, originalPath);
    const original = Buffer.from(await originalResponse.arrayBuffer());
    validateOriginal(original, originalPath.split(".").pop().toLowerCase());
  }

  const productFolder = crypto.createHash("sha256").update(productId).digest("hex").slice(0, 24);
  const finalPath = `products/${productFolder}/${crypto.randomUUID()}.webp`;
  await storageRequest(FINAL_BUCKET, finalPath, {method:"POST",body:derivative,contentType:"image/webp"});
  const {url} = supabaseConfig();
  const publicUrl = `${url}/storage/v1/object/public/${FINAL_BUCKET}/${encodeStoragePath(finalPath)}`;

  let updated;
  try {
    const expectedStoragePath = product.image_storage_path
      ? `eq.${encodeURIComponent(product.image_storage_path)}`
      : "is.null";
    const rows = await supabaseRequest(`products?id=eq.${encodeURIComponent(productId)}&image_storage_path=${expectedStoragePath}&select=id,image_url,image_storage_path,image_original_path,image_crop`, {
      method:"PATCH",
      body:{
        image_url:publicUrl,
        image_storage_path:finalPath,
        image_original_path:originalPath,
        image_crop:crop,
        image_updated_by:approved.user.id,
        updated_at:new Date().toISOString()
      },
      prefer:"return=representation"
    });
    updated = Array.isArray(rows) ? rows[0] : null;
    if (!updated) throw Object.assign(new Error("The product image changed before this update completed."), {status:409});
  } catch (error) {
    await safeRemoveStorageObject(FINAL_BUCKET, finalPath);
    if (replacingOriginal) await safeRemoveStorageObject(ORIGINAL_BUCKET, originalPath);
    throw error;
  }

  if (FINAL_PATH_PATTERN.test(String(product.image_storage_path || "")) && product.image_storage_path !== finalPath) {
    await safeRemoveStorageObject(FINAL_BUCKET, product.image_storage_path);
  }
  if (replacingOriginal && ORIGINAL_PATH_PATTERN.test(String(product.image_original_path || "")) && product.image_original_path !== originalPath) {
    await safeRemoveStorageObject(ORIGINAL_BUCKET, product.image_original_path);
  }

  return send(response, 200, {
    success:true,
    image:{
      url:updated.image_url,
      storagePath:updated.image_storage_path,
      originalPath:updated.image_original_path,
      crop:updated.image_crop
    }
  });
}

async function discardStagedImage(request, response, approved) {
  const staged = stagedPathForUser(request.body?.stagedPath, approved.user.id);
  await safeRemoveStorageObject(ORIGINAL_BUCKET, staged.path);
  return send(response, 200, {success:true});
}

async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return send(response, 405, {success:false,message:"Method not allowed"});
  }

  try {
    enforceRateLimit(request, {namespace:"management-product-images",limit:20,windowMs:10 * 60 * 1000});
    const approved = await requireApprovedManagement(request, response);
    if (!approved) return;
    const action = String(request.body?.action || "finalize");
    if (action === "discard") return discardStagedImage(request, response, approved);
    if (action !== "finalize") return send(response, 400, {success:false,message:"Unsupported product image action."});
    return finalizeImage(request, response, approved);
  } catch (error) {
    const status = Number(error?.status || 500);
    if (status >= 400 && status < 500) return send(response, status, {success:false,message:error.message || "The product image request could not be completed."});
    console.error("Product image route failed", error?.message || "Error");
    return send(response, 500, {success:false,message:"The product image could not be saved. Please try again."});
  }
}

handler._test = {
  inspectImage,
  validateOriginal,
  decodeDerivative,
  validateCrop,
  stagedPathForUser,
  readPng,
  readJpeg,
  readWebp,
  constants:{MAX_ORIGINAL_BYTES,MAX_DERIVATIVE_BYTES,DERIVATIVE_SIZE}
};

module.exports = handler;
