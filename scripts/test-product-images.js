const assert = require("assert");
const fs = require("fs");
const path = require("path");
const handler = require("../api/product-images");

const {inspectImage,validateOriginal,decodeDerivative,validateCrop,stagedPathForUser,constants} = handler._test;
const root = path.resolve(__dirname, "..");

function expectFailure(operation, pattern) {
  assert.throws(operation, pattern);
}

function jsonResponse(status, payload) {
  return {
    ok:status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

async function callHandler({authorization = "", fetchResponses = [], body = {productId:"bad/id"}} = {}) {
  const originalFetch = global.fetch;
  const queue = [...fetchResponses];
  global.fetch = async () => {
    assert(queue.length, "Unexpected upstream fetch");
    return queue.shift();
  };
  try {
    return await new Promise((resolve, reject) => {
      const response = {
        setHeader() {},
        statusCode:200,
        status(value) { this.statusCode = value; return this; },
        json(payload) { resolve({status:this.statusCode,payload}); return payload; }
      };
      Promise.resolve(handler({
        method:"POST",
        headers:authorization ? {authorization} : {},
        socket:{remoteAddress:`test-${Math.random()}`},
        body
      }, response)).catch(reject);
    });
  } finally {
    global.fetch = originalFetch;
  }
}

async function main() {
  process.env.SUPABASE_URL ||= "https://test-project.supabase.co";
  process.env.SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const png = fs.readFileSync(path.join(root, "product-fob.png"));
  const jpeg = fs.readFileSync(path.join(root, "brickell-skyline.jpg"));
  const webp = fs.readFileSync(path.join(root, "product-access.webp"));

  assert.deepStrictEqual(inspectImage(png), {mime:"image/png",extension:"png",width:383,height:387});
  assert.strictEqual(inspectImage(jpeg).mime, "image/jpeg");
  assert.deepStrictEqual(inspectImage(webp), {mime:"image/webp",extension:"webp",width:753,height:1201});
  expectFailure(() => inspectImage(Buffer.from("<html>not an image</html>")), /valid PNG, JPEG, or WebP/);
  expectFailure(() => inspectImage(png.subarray(0, png.length - 12)), /valid PNG, JPEG, or WebP/);
  expectFailure(() => inspectImage(jpeg.subarray(0, jpeg.length - 2)), /valid PNG, JPEG, or WebP/);
  expectFailure(() => inspectImage(webp.subarray(0, webp.length - 8)), /valid PNG, JPEG, or WebP/);
  expectFailure(() => validateOriginal(Buffer.alloc(constants.MAX_ORIGINAL_BYTES + 1)), /larger than 8 MB/);
  expectFailure(() => validateOriginal(png, "jpg"), /does not match/);
  expectFailure(() => decodeDerivative(webp.toString("base64")), /1200 by 1200/);

  assert.deepStrictEqual(validateCrop({version:1,zoom:2.125,x:-0.25,y:0.5,aspect:"1:1"}), {
    version:1,zoom:2.125,x:-0.25,y:0.5,aspect:"1:1"
  });
  expectFailure(() => validateCrop({version:1,zoom:8,x:0,y:0,aspect:"1:1"}), /crop settings/);
  expectFailure(() => validateCrop({version:1,zoom:1,x:2,y:0,aspect:"1:1"}), /crop settings/);

  const userId = "11111111-1111-4111-8111-111111111111";
  const stagedPath = `${userId}/22222222-2222-4222-8222-222222222222.png`;
  assert.deepStrictEqual(stagedPathForUser(stagedPath, userId), {path:stagedPath,extension:"png"});
  expectFailure(() => stagedPathForUser("../escape.png", userId), /staged product image path/);
  expectFailure(() => stagedPathForUser("33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222.png", userId), /staged product image path/);

  const noSession = await callHandler();
  assert.strictEqual(noSession.status, 401);
  const invalidSession = await callHandler({authorization:"Bearer invalid",fetchResponses:[jsonResponse(401,{})]});
  assert.strictEqual(invalidSession.status, 401);

  for (const label of ["unapproved", "inactive", "mfa-required-aal1"]) {
    const denied = await callHandler({
      authorization:`Bearer ${label}`,
      fetchResponses:[jsonResponse(200,{id:userId}),jsonResponse(200,false)]
    });
    assert.strictEqual(denied.status, 403, `${label} must be denied`);
  }

  const authorized = await callHandler({
    authorization:"Bearer authorized-aal2",
    fetchResponses:[jsonResponse(200,{id:userId}),jsonResponse(200,true)]
  });
  assert.strictEqual(authorized.status, 400);
  assert.match(authorized.payload.message, /valid product ID/);

  console.log("Product image validation and authorization checks passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
