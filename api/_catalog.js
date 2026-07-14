const products = {
  svc1:{name:"Mailbox Key Copy",priceCents:100},
  svc2:{name:"Unit Key Copy",priceCents:3000},
  svc3:{name:"Smoke Detector Battery Replacement",priceCents:2500},
  svc4:{name:"AC Filter Replacement",priceCents:5500},
  svc5:{name:"Trash Compactor Replacement",priceCents:20000,active:false},
  svc6:{name:"Toilet or Sink Unclogged Service",priceCents:3000},
  svc7:{name:"Lockout Assistance",priceCents:5000,active:false},
  svc8:{name:"Faucet Repair",priceCents:12500,active:false},
  svc9:{name:"Thermostat Reset or System Check",priceCents:4000},
  svc10:{name:"Portable AC Unit Rental",priceCents:30000,active:false},
  svc11:{name:"Thermostat Replacement",priceCents:0},
  svc12:{name:"Annual AC Filter Subscription",priceCents:36000,active:false},
  svc13:{name:"Valet Service Subscription",priceCents:25000},
  svc14:{name:"AC Drain Line Cleaning",priceCents:4500},
  svc15:{name:"Premium Resident Care Plan",priceCents:96000,active:false}
};

const RESIDENT_DISABLED_PRODUCT_IDS = new Set(
  Object.entries(products)
    .filter(([, product]) => product.active === false)
    .map(([id]) => id)
);

function accountingGlCode(id, product = {}) {
  const label = `${id || ""} ${product.name || ""} ${product.internalName || ""}`.toLowerCase();
  return label.includes("valet") ? "40033" : "40090";
}

function accountingName(name, glCode) {
  return `${name} GL-${glCode}`;
}

function centsToDollars(value) {
  return +(Number(value || 0) / 100).toFixed(2);
}

function normalizeProductRow(row) {
  const name = row.resident_name;
  const glCode = accountingGlCode(row.id, {name, internalName:row.internal_name});
  return {
    name,
    internalName:accountingName(name, glCode),
    glCode,
    description:row.description,
    category:row.category,
    priceCents:Number(row.price_cents || 0),
    inventory:Number(row.inventory || 0),
    image:row.image_url || "",
    active:Boolean(row.active)
  };
}

async function loadSupabaseProductRows() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
  const {supabaseRequest} = require("./_supabase");
  const rows = await supabaseRequest("products?select=id,resident_name,internal_name,gl_code,description,category,price_cents,inventory,image_url,active", {
    method:"GET",
    prefer:""
  });
  return Array.isArray(rows) ? rows : [];
}

async function getTrustedProductCatalog() {
  const catalog = {};
  for (const [id, product] of Object.entries(products)) {
    const glCode = accountingGlCode(id, product);
    catalog[id] = {...product, internalName:accountingName(product.name, glCode), glCode, inventory:99, active:product.active !== false};
  }
  const rows = await loadSupabaseProductRows();
  for (const row of rows) {
    catalog[row.id] = {
      ...(catalog[row.id] || {}),
      ...normalizeProductRow(row)
    };
    if (RESIDENT_DISABLED_PRODUCT_IDS.has(row.id)) catalog[row.id].active = false;
  }
  return catalog;
}

async function getPublicProductCatalog() {
  const catalog = await getTrustedProductCatalog();
  return Object.entries(catalog)
    .filter(([, product]) => product.active && product.inventory > 0)
    .map(([id, product]) => ({
      id,
      name:product.name,
      category:product.category || "Maintenance Services",
      description:product.description || "",
      price:centsToDollars(product.priceCents),
      inventory:product.inventory,
      image:product.image || "",
      active:true
    }));
}

module.exports = {products,getTrustedProductCatalog,getPublicProductCatalog,accountingGlCode,accountingName};
