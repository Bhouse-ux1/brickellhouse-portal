const products = {
  svc1:{name:"Mailbox Key Copy",internalName:"Mailbox Key Copy - GL 4051-MAILBOX",glCode:"4051-MAILBOX",priceCents:100},
  svc2:{name:"Unit Key Copy",internalName:"Unit Key Copy - GL 4051-UNIT",glCode:"4051-UNIT",priceCents:3000},
  svc3:{name:"Smoke Detector Battery Replacement",internalName:"Smoke Detector Battery Replacement - GL 4083-SMOKE-BATT",glCode:"4083-SMOKE-BATT",priceCents:2500},
  svc4:{name:"AC Filter Replacement",internalName:"AC Filter Replacement - GL 4081-FILTER",glCode:"4081-FILTER",priceCents:5500},
  svc5:{name:"Trash Compactor Replacement",internalName:"Trash Compactor Replacement - GL 4084-COMPACTOR",glCode:"4084-COMPACTOR",priceCents:20000},
  svc6:{name:"Toilet or Sink Unclogged Service",internalName:"Toilet or Sink Unclogged Service - GL 4085-UNCLOG",glCode:"4085-UNCLOG",priceCents:3000},
  svc7:{name:"Lockout Assistance",internalName:"Lockout Assistance - GL 4086-LOCKOUT",glCode:"4086-LOCKOUT",priceCents:5000},
  svc8:{name:"Faucet Repair",internalName:"Faucet Repair - GL 4087-FAUCET",glCode:"4087-FAUCET",priceCents:12500},
  svc9:{name:"Thermostat Reset or System Check",internalName:"Thermostat Reset or System Check - GL 4088-THERMO-SVC",glCode:"4088-THERMO-SVC",priceCents:4000},
  svc10:{name:"Portable AC Unit Rental",internalName:"Portable AC Unit Rental - GL 4091-AC-RENTAL",glCode:"4091-AC-RENTAL",priceCents:30000},
  svc11:{name:"Thermostat Replacement",internalName:"Thermostat Replacement - GL 4088-THERMO-REPL",glCode:"4088-THERMO-REPL",priceCents:0},
  svc12:{name:"Annual AC Filter Subscription",internalName:"Annual AC Filter Subscription - GL 4092-FILTER-SUB",glCode:"4092-FILTER-SUB",priceCents:36000},
  svc13:{name:"Valet Service Subscription",internalName:"Valet Service Subscription - GL 4062-VALET-SUB",glCode:"4062-VALET-SUB",priceCents:25000},
  svc14:{name:"AC Drain Line Cleaning",internalName:"AC Drain Line Cleaning - GL 4081-DRAIN",glCode:"4081-DRAIN",priceCents:4500},
  svc15:{name:"Premium Resident Care Plan",internalName:"Premium Resident Care Plan - GL 4093-CARE-PLAN",glCode:"4093-CARE-PLAN",priceCents:96000}
};

function centsToDollars(value) {
  return +(Number(value || 0) / 100).toFixed(2);
}

function normalizeProductRow(row) {
  return {
    name:row.resident_name,
    internalName:row.internal_name,
    glCode:row.gl_code,
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
    catalog[id] = {...product, inventory:99, active:true};
  }
  const rows = await loadSupabaseProductRows();
  for (const row of rows) {
    catalog[row.id] = {
      ...(catalog[row.id] || {}),
      ...normalizeProductRow(row)
    };
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

module.exports = {products,getTrustedProductCatalog,getPublicProductCatalog};
