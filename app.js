const CATALOG_VERSION = "resident-services-2026-06-12-v2";
const LEGAL_NOTICE_VERSION = window.BH_LEGAL_NOTICE.version;
const CATEGORIES = ["Keys & Access", "Maintenance Services", "HVAC Services", "Subscriptions & Plans"];
window.managementAccessGranted = false;
let managementAuthClient = null;
let managementProfile = null;
let managementAccessPending = false;
let managementDataLoaded = false;

const seedProducts = [
  {id:"svc1",name:"Mailbox Key Copy",category:"Keys & Access",description:"Replacement key for your assigned mailbox.",price:1,inventory:99,glCode:"4051-MAILBOX",image:"offer-mailbox-key.webp",active:true},
  {id:"svc2",name:"Unit Key Copy",category:"Keys & Access",description:"Replacement of your unit door key.",price:30,inventory:99,glCode:"4051-UNIT",image:"offer-unit-key.webp",active:true},
  {id:"svc3",name:"Smoke Detector Battery Replacement",category:"Maintenance Services",description:"Includes battery and labor.",price:25,inventory:99,glCode:"4083-SMOKE-BATT",image:"offer-smoke-battery.webp",active:true},
  {id:"svc4",name:"AC Filter Replacement",category:"HVAC Services",description:"Includes filter and labor.",price:55,inventory:99,glCode:"4081-FILTER",image:"offer-filter-replacement.webp",active:true},
  {id:"svc5",name:"Trash Compactor Replacement",category:"Maintenance Services",description:"Includes parts and labor.",price:200,inventory:99,glCode:"4084-COMPACTOR",image:"offer-trash-compactor.webp",active:true},
  {id:"svc6",name:"Toilet or Sink Unclogged Service",category:"Maintenance Services",description:"Includes unclogging and labor for each individual sink or toilet.",price:30,inventory:99,glCode:"4085-UNCLOG",image:"offer-unclog-service.webp",active:true},
  {id:"svc7",name:"Lockout Assistance",category:"Keys & Access",description:"Includes access and labor.",price:50,inventory:99,glCode:"4086-LOCKOUT",image:"offer-lockout.webp",active:true},
  {id:"svc8",name:"Faucet Repair",category:"Maintenance Services",description:"Includes parts and labor.",price:125,inventory:99,glCode:"4087-FAUCET",image:"offer-faucet-repair.webp",active:true},
  {id:"svc9",name:"Thermostat Reset or System Check",category:"HVAC Services",description:"Includes minor adjustments and labor.",price:40,inventory:99,glCode:"4088-THERMO-SVC",image:"offer-thermostat-check.webp",active:true},
  {id:"svc10",name:"Portable AC Unit Rental",category:"HVAC Services",description:"$25.00 per day; requires a $300 refundable security deposit payable in advance.",price:300,inventory:10,glCode:"4091-AC-RENTAL",image:"offer-portable-ac.webp",active:true},
  {id:"svc11",name:"Thermostat Replacement",category:"HVAC Services",description:"Thermostat replacement provided at no charge.",price:0,inventory:99,glCode:"4088-THERMO-REPL",image:"offer-thermostat-replacement.webp",active:true},
  {id:"svc12",name:"Annual AC Filter Subscription",category:"Subscriptions & Plans",description:"Includes 12 scheduled AC filter replacements per year, one per month.",price:360,inventory:99,glCode:"4092-FILTER-SUB",image:"offer-annual-filter.webp",active:true},
  {id:"svc13",name:"Valet Service Subscription",category:"Subscriptions & Plans",description:"Includes unlimited valet parking for one month for each registered vehicle per unit.",price:250,inventory:99,glCode:"4062-VALET-SUB",image:"offer-valet-subscription.webp",active:true},
  {id:"svc14",name:"AC Drain Line Cleaning",category:"HVAC Services",description:"Includes cleaning and flushing the AC drain line to prevent overflow.",price:45,inventory:99,glCode:"4081-DRAIN",image:"offer-drain-cleaning.webp",active:true},
  {id:"svc15",name:"Premium Resident Care Plan",category:"Subscriptions & Plans",description:"Billed annually. Covers basic in-unit maintenance labor, including light bulbs, AC maintenance, filters, thermostat checks, unclogging, minor touch-ups, and general inspections.",price:960,inventory:99,glCode:"4093-CARE-PLAN",image:"offer-resident-care.webp",active:true}
];

const sampleOrders = [];

const catalogIsCurrent = localStorage.getItem("bh_catalog_version") === CATALOG_VERSION;
let products = catalogIsCurrent ? JSON.parse(localStorage.getItem("bh_products") || "null") || seedProducts : seedProducts;
let orders = sampleOrders;
let cart = catalogIsCurrent ? JSON.parse(localStorage.getItem("bh_cart") || "[]") : [];
let feeSettings = JSON.parse(localStorage.getItem("bh_fee_settings") || "null") || {
  enabled:true,type:"percent",amount:3,label:"Processing fee",glCode:"4090-PROCESSING"
};
let activeCategory = "All";
let orderSearchField = "unit";
let orderSearchQuery = "";

products.forEach(product => {
  product.internalName ||= `${product.name} - GL ${product.glCode}`;
});
orders.forEach(order => {
  order.status ||= "Received";
  order.paymentStatus ||= "Historical";
  order.internalNote ||= "";
  order.publicNote ||= "";
  order.squareTransactionId ||= "";
});

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const isManagementPage = document.body.classList.contains("management-page");
const PRODUCT_IMAGE_VERSION = "20260624-product-images1";
const money = value => new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(value);
function escapeAdminHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[character]);
}
function normalizeProduct(product) {
  return {
    ...product,
    price:Number(product.price || 0),
    inventory:Number(product.inventory || 0),
    active:Boolean(product.active),
    internalName:product.internalName || `${product.name} - GL ${product.glCode || ""}`
  };
}
function productImageSrc(image) {
  const source = image || "product-documents.webp";
  if (/^(https?:|data:|blob:)/i.test(source) || source.includes("?")) return source;
  return `${source}?v=${PRODUCT_IMAGE_VERSION}`;
}
function displayText(value, fallback = "") {
  const text = String(value ?? "").trim();
  if (!text || /^(undefined|null)$/i.test(text)) return fallback;
  return text;
}
function productThumbnail(product) {
  const image = displayText(product.image);
  if (!image) return `<div class="admin-product-thumb placeholder">BH</div>`;
  return `<img class="admin-product-thumb" src="${escapeAdminHtml(productImageSrc(image))}" alt="${escapeAdminHtml(displayText(product.name, "Product"))}">`;
}
function productRowMarkup(product, index = 0) {
  const name = displayText(product.name, "Unnamed product");
  const description = displayText(product.description, "No description available.");
  const internalName = displayText(product.internalName);
  const category = displayText(product.category, "Uncategorized");
  const glCode = displayText(product.glCode, "Not set");
  const status = product.active ? "Active" : "Inactive";
  return `<tr class="admin-product-row" style="animation-delay:${Math.min(index * .035, .35)}s">
    <td>
      <div class="admin-product-cell">
        ${productThumbnail(product)}
        <div>
          <strong class="admin-product-name">${escapeAdminHtml(name)}</strong>
          <span class="admin-product-description">${escapeAdminHtml(description)}</span>
          ${internalName ? `<span class="admin-product-meta">${escapeAdminHtml(internalName)}</span>` : ""}
        </div>
      </div>
    </td>
    <td><span class="admin-category-pill">${escapeAdminHtml(category)}</span></td>
    <td><span class="admin-gl-code">${escapeAdminHtml(glCode)}</span></td>
    <td><strong class="admin-product-price">${product.price === 0 ? "Free" : money(product.price)}</strong></td>
    <td><span class="admin-inventory-count">${Number(product.inventory || 0)}</span></td>
    <td><span class="status admin-status ${product.active ? "" : "inactive"}">${status}</span></td>
    <td>
      <div class="admin-action-group">
        <button class="admin-action primary" data-edit="${escapeAdminHtml(product.id)}">Edit</button>
        <button class="admin-action secondary" data-toggle="${escapeAdminHtml(product.id)}">${product.active ? "Deactivate" : "Activate"}</button>
        <button class="admin-action danger" data-delete="${escapeAdminHtml(product.id)}">Remove</button>
      </div>
    </td>
  </tr>`;
}
const todayISO = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const formatDate = value => {
  if (!value) return "";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${month}/${day}/${year}`;
};
const fileDate = () => {
  const [year, month, day] = todayISO().split("-");
  return `${month}-${day}-${year}`;
};
const acceptanceDateTime = () => new Intl.DateTimeFormat("en-US", {
  month:"2-digit",day:"2-digit",year:"numeric",hour:"numeric",minute:"2-digit"
}).format(new Date());

function migrateOrderNumber(order) {
  const match = /^BH-(\d{2})(\d{2})(\d{2})-(.+)$/.exec(order.number || "");
  if (match) order.number = `BH-${match[2]}${match[3]}20${match[1]}-${match[4]}`;
}

orders.forEach(migrateOrderNumber);

function persist() {
  localStorage.setItem("bh_products", JSON.stringify(products));
  localStorage.removeItem("bh_orders");
  localStorage.setItem("bh_cart", JSON.stringify(cart));
  localStorage.setItem("bh_fee_settings", JSON.stringify(feeSettings));
  localStorage.setItem("bh_catalog_version", CATALOG_VERSION);
}

function reconcileCartWithCatalog() {
  cart = cart
    .map(item => {
      const product = products.find(candidate => candidate.id === item.id && candidate.active);
      if (!product) return null;
      const quantity = Math.min(Number(item.quantity || 0), Number(product.inventory || 0));
      return quantity > 0 ? {id:item.id, quantity} : null;
    })
    .filter(Boolean);
}

function cartSubtotal() {
  return cart.reduce((sum, item) => {
    const product = products.find(candidate => candidate.id === item.id);
    return sum + (product ? product.price * item.quantity : 0);
  }, 0);
}

function processingFee(subtotal) {
  if (!feeSettings.enabled) return 0;
  const amount = feeSettings.type === "fixed" ? feeSettings.amount : subtotal * feeSettings.amount / 100;
  return +amount.toFixed(2);
}

function revenueFor(list) {
  return list.reduce((sum, order) => sum + order.price * order.quantity + (+order.processingFee || 0), 0);
}

function centsToDollars(value) {
  return +(Number(value || 0) / 100).toFixed(2);
}

function generateOrderNumber() {
  const date = new Date();
  const prefix = `BH-${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}${date.getFullYear()}-`;
  const existing = new Set(orders.map(order => order.number));
  let number;
  do {
    const random = crypto.getRandomValues(new Uint32Array(2));
    const suffix = [...random].map(value => value.toString(36).padStart(7, "0")).join("").slice(0, 10).toUpperCase();
    number = prefix + suffix;
  } while (existing.has(number));
  return number;
}

function iconFor(category) {
  const paths = {
    "Access Devices":'<rect x="21" y="18" width="48" height="74" rx="9"/><circle cx="45" cy="39" r="9"/><path d="M45 48v25M35 66h20"/>',
    "Keys":'<circle cx="32" cy="39" r="17"/><path d="M44 51l30 30M61 68l9-9M69 76l9-9"/>',
    "Parking Services":'<rect x="18" y="17" width="64" height="76" rx="5"/><path d="M35 74V35h15c20 0 20 27 0 27H35"/>',
    "Building Services":'<path d="M20 88h60M27 88V37l23-19 23 19v51M39 88V60h22v28M38 43h6M56 43h6"/>',
    "Maintenance Items":'<path d="M58 20a21 21 0 0 0-19 30L19 70l12 12 20-20a21 21 0 0 0 29-25L65 52 49 36 64 21z"/>'
  };
  return `<div class="product-icon"><svg viewBox="0 0 100 110">${paths[category]}</svg></div>`;
}

function renderTabs() {
  if (!$("#categoryTabs")) return;
  $("#categoryTabs").innerHTML = ["All", ...CATEGORIES].map(category =>
    `<button class="${category === activeCategory ? "active" : ""}" data-cat="${category}">${category}</button>`
  ).join("");
  $$("#categoryTabs button").forEach(button => {
    button.onclick = () => {
      activeCategory = button.dataset.cat;
      renderTabs();
      renderProducts();
    };
  });
}

function renderProducts() {
  if (!$("#productGrid") || !$("#searchInput")) return;
  const query = $("#searchInput").value.trim().toLowerCase();
  const filtered = products.filter(product =>
    product.active &&
    (activeCategory === "All" || product.category === activeCategory) &&
    `${product.name} ${product.description}`.toLowerCase().includes(query)
  );
  $("#productGrid").innerHTML = filtered.map((product, index) =>
    `<article class="product-card" style="animation-delay:${Math.min(index * .05, .4)}s">
      <div class="product-image">
        <img src="${productImageSrc(product.image)}" alt="${product.name}">
        <span class="stock-badge ${product.inventory < 10 ? "low" : ""}">${product.inventory === 0 ? "Unavailable" : product.inventory < 10 ? `Only ${product.inventory} available` : "Available"}</span>
      </div>
      <div class="product-info">
        <span class="product-category">${product.category}</span>
        <h3>${product.name}</h3><p>${product.description}</p>
        <div class="product-bottom"><strong>${product.price === 0 ? "Free" : money(product.price)}</strong><button class="add-button" data-add="${product.id}" ${product.inventory === 0 ? "disabled" : ""} aria-label="Add ${product.name}">+</button></div>
      </div>
    </article>`
  ).join("");
  $("#emptyState").classList.toggle("hidden", filtered.length > 0);
  $$("[data-add]").forEach(button => button.onclick = () => addToCart(button.dataset.add));
}

async function loadPublicProductCatalog() {
  if (isManagementPage) return;
  try {
    const response = await fetch("/api/products", {headers:{"Accept":"application/json"}});
    const payload = await response.json();
    if (!response.ok || !payload.success || !Array.isArray(payload.products)) return;
    const existingById = new Map(products.map(product => [product.id, product]));
    products = payload.products.map(product => {
      const existing = existingById.get(product.id) || {};
      return normalizeProduct({
        ...existing,
        ...product,
        description:product.description || existing.description || "",
        image:product.image || existing.image || ""
      });
    });
    reconcileCartWithCatalog();
    persist();
    renderTabs();
    renderProducts();
    renderCart();
  } catch (error) {
    console.warn("Using local product catalog fallback", error);
  }
}

function addToCart(id) {
  const item = cart.find(candidate => candidate.id === id);
  const product = products.find(candidate => candidate.id === id);
  if (item) {
    if (item.quantity < product.inventory) item.quantity++;
  } else {
    cart.push({id, quantity:1});
  }
  persist();
  renderCart();
  toast(`${product.name} added to your bag`);
}

function renderCart() {
  if (!$("#cartCount") || !$("#cartItems")) return;
  const items = cart.map(item => ({...item, product:products.find(product => product.id === item.id)})).filter(item => item.product);
  updateCartSummary(items);
  $("#cartItems").innerHTML = items.map(item =>
    `<div class="cart-item">
      <div class="cart-thumb">BH</div>
      <div><h4>${item.product.name}</h4><div class="qty"><button data-qty="${item.id}" data-delta="-1">-</button><span>${item.quantity}</span><button data-qty="${item.id}" data-delta="1">+</button></div></div>
      <div><strong>${money(item.product.price * item.quantity)}</strong><button class="remove" data-remove="${item.id}">Remove</button></div>
    </div>`
  ).join("");
  bindCartControls();
}

function updateCartSummary(items = cart.map(item => ({...item, product:products.find(product => product.id === item.id)})).filter(item => item.product), {toggleEmptyState = true} = {}) {
  $("#cartCount").textContent = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartSubtotal();
  const fee = processingFee(subtotal);
  $("#cartTotal").textContent = money(subtotal);
  $("#checkoutSubtotal").textContent = money(subtotal);
  $("#checkoutFee").textContent = money(fee);
  $("#checkoutTotal").textContent = money(subtotal + fee);
  $("#checkoutFeeLabel").textContent = feeSettings.enabled && feeSettings.type === "percent" ? `${feeSettings.label} (${feeSettings.amount}%)` : feeSettings.label;
  if (toggleEmptyState) {
    $("#cartEmpty").classList.toggle("hidden", items.length > 0);
    $("#cartFooter").classList.toggle("hidden", !items.length);
  }
}

function bindCartControls() {
  $$("[data-qty]").forEach(button => button.onclick = () => changeQty(button.dataset.qty, +button.dataset.delta));
  $$("[data-remove]").forEach(button => button.onclick = () => {
    const row = button.closest(".cart-item");
    cart = cart.filter(item => item.id !== button.dataset.remove);
    persist();
    updateCartSummary(undefined, {toggleEmptyState:false});
    if (!row) {
      renderCart();
      return;
    }
    row.classList.add("removing");
    const finish = () => renderCart();
    row.addEventListener("transitionend", finish, {once:true});
    setTimeout(() => row.isConnected && finish(), 280);
  });
}

function renderLegalNotice() {
  if (!$("#legalVersion") || !$("#legalDocument")) return;
  $("#legalVersion").textContent = `Document version ${LEGAL_NOTICE_VERSION}`;
  $("#legalDocument").innerHTML = window.BH_LEGAL_NOTICE.sections.map((section, index) =>
    `<section><${index ? "h3" : "h2"}>${section.title}</${index ? "h3" : "h2"}><p>${section.body}</p></section>`
  ).join("");
}

function changeQty(id, delta) {
  const item = cart.find(candidate => candidate.id === id);
  const product = products.find(candidate => candidate.id === id);
  item.quantity = Math.max(0, Math.min(product.inventory, item.quantity + delta));
  if (!item.quantity) cart = cart.filter(candidate => candidate.id !== id);
  persist();
  renderCart();
}

function setDrawer(open) {
  if (!$("#cartDrawer") || !$("#drawerBackdrop")) return;
  $("#cartDrawer").classList.toggle("open", open);
  $("#drawerBackdrop").classList.toggle("open", open);
}

function openModal(selector) { $(selector)?.classList.add("open"); }
function closeModal(selector) { $(selector)?.classList.remove("open"); }
function toast(message) {
  const element = $("#toast");
  if (!element) return;
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2200);
}

async function auditManagement(action, recordType = "management", recordId = null, beforeData = null, afterData = null) {
  if (!managementAuthClient || !managementProfile) return;
  try {
    const {error} = await managementAuthClient.from("audit_logs").insert({
      actor_user_id:managementProfile.user_id,
      action,
      record_type:recordType,
      record_id:recordId,
      before_data:beforeData,
      after_data:afterData
    });
    if (error) console.warn("Management audit log unavailable", error);
  } catch (error) {
    console.warn("Management audit log unavailable", error);
  }
}
window.auditManagement = auditManagement;
window.recordManagementAudit = auditManagement;

if ($("#cartOpen")) $("#cartOpen").onclick = () => setDrawer(true);
if ($("#drawerBackdrop")) $("#drawerBackdrop").onclick = () => setDrawer(false);
if ($('[data-close="cart"]')) $('[data-close="cart"]').onclick = () => setDrawer(false);
if ($("#checkoutOpen")) $("#checkoutOpen").onclick = () => { setDrawer(false); openModal("#checkoutModal"); };
if ($("#searchInput")) $("#searchInput").oninput = renderProducts;
if ($("#legalNoticeOpen")) $("#legalNoticeOpen").onclick = () => openModal("#legalModal");
if ($("#legalAcceptance")) $("#legalAcceptance").onchange = event => {
  $("#checkoutSubmit").disabled = !event.target.checked;
};

$$("[data-close]").forEach(button => button.addEventListener("click", () => {
  if (button.dataset.close === "checkout") closeModal("#checkoutModal");
  if (button.dataset.close === "success") closeModal("#successModal");
  if (button.dataset.close === "product") closeModal("#productModal");
  if (button.dataset.close === "legal") closeModal("#legalModal");
}));

function renderAdmin() {
  if (!$("#adminOverview")) return;
  if (!window.managementAccessGranted) return;
  auditManagement("report_access", "management_report", "overview");
  const revenue = revenueFor(orders);
  const units = new Set(orders.map(order => order.unit)).size;
  const lowProducts = products.filter(product => product.active && product.inventory <= 15);
  const lowInventory = lowProducts.length;
  const monthly = {};
  orders.forEach(order => {
    const key = order.date.slice(0, 7);
    monthly[key] = (monthly[key] || 0) + order.price * order.quantity + (+order.processingFee || 0);
  });
  const monthRows = Object.entries(monthly).sort(([a], [b]) => b.localeCompare(a)).slice(0, 12);
  const largestMonth = Math.max(1, ...monthRows.map(([, value]) => value));

  $("#adminOverview").innerHTML = `
    <div class="metric-grid">
      <div class="metric"><span>Total orders</span><strong>${new Set(orders.map(order => order.number)).size}</strong></div>
      <div class="metric"><span>Collected revenue</span><strong>${money(revenue)}</strong></div>
      <div class="metric"><span>Resident units</span><strong>${units}</strong></div>
      <button class="metric metric-button" id="lowInventoryMetric"><span>Low inventory (15 or fewer)</span><strong>${lowInventory}</strong><small>View items</small></button>
    </div>
    <div class="admin-panel low-inventory-panel hidden" id="lowInventoryPanel">
      <h3>Low inventory items</h3>
      ${lowProducts.length ? `<div class="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Remaining</th><th>Price</th><th></th></tr></thead><tbody>${lowProducts.map(product =>
        `<tr><td><strong>${product.name}</strong></td><td>${product.category}</td><td><span class="inventory-count">${product.inventory}</span></td><td>${product.price === 0 ? "Free" : money(product.price)}</td><td><button class="table-action" data-low-edit="${product.id}">Edit inventory</button></td></tr>`
      ).join("")}</tbody></table></div>` : `<div class="inventory-ok">All active products have more than 15 items available.</div>`}
    </div>
    <div class="admin-panel">
      <h3>Revenue by period</h3>
      <div class="report-controls">
        <label><span>View by</span><select id="revenuePeriod"><option value="all">All time</option><option value="day">Day</option><option value="month">Month</option><option value="year">Year</option></select></label>
        <label id="revenueValueLabel" class="hidden"><span>Period</span><input id="revenueValue"></label>
        <button class="outline-button" id="applyRevenueFilter">Apply</button>
      </div>
      <div class="metric"><span id="filteredRevenueLabel">All-time revenue</span><strong id="filteredRevenue">${money(revenue)}</strong></div>
    </div>
    <div class="admin-panel">
      <h3>Monthly revenue</h3>
      <div class="monthly-bars">${monthRows.length ? monthRows.map(([key, value]) => {
        const [year, month] = key.split("-");
        return `<div class="monthly-row"><span>${month}/${year}</span><div class="monthly-track"><div class="monthly-fill" style="width:${value / largestMonth * 100}%"></div></div><strong>${money(value)}</strong></div>`;
      }).join("") : "<p>No revenue yet.</p>"}</div>
    </div>
    <div class="admin-panel">
      <h3>Recent resident orders</h3>
      <div class="table-wrap">${orders.length ? `<table><thead><tr><th>Order</th><th>Resident</th><th>Product</th><th>Total</th><th>Date</th></tr></thead><tbody>${orders.slice(-5).reverse().map(order =>
        `<tr><td>${order.number}</td><td><strong>${order.name}</strong>Unit ${order.unit}</td><td>${order.product}</td><td>${money(order.price * order.quantity + (+order.processingFee || 0))}</td><td>${formatDate(order.date)}</td></tr>`
      ).join("")}</tbody></table>` : "<p>No orders yet.</p>"}</div>
    </div>`;

  $("#productTable").innerHTML = products.map(productRowMarkup).join("");

  renderOrderTable();

  bindRevenueControls();
  populateFeeSettings();
  bindOrderSearch();
  const lowMetric = $("#lowInventoryMetric");
  if (lowMetric) lowMetric.onclick = () => {
    const panel = $("#lowInventoryPanel");
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) panel.scrollIntoView({behavior:"smooth",block:"start"});
  };
  $$("[data-low-edit]").forEach(button => button.onclick = () => {
    auditManagement("report_access", "management_report", "low_inventory");
    showAdminView("products");
    editProduct(button.dataset.lowEdit);
  });
  $$("[data-edit]").forEach(button => button.onclick = () => editProduct(button.dataset.edit));
  $$("[data-toggle]").forEach(button => button.onclick = async () => {
    const product = products.find(candidate => candidate.id === button.dataset.toggle);
    const before = {...product};
    product.active = !product.active;
    try {
      await saveProductToSupabase(product);
      persist(); renderProducts(); renderAdmin();
      auditManagement("product_status_change", "product", product.id, before, product);
    } catch (error) {
      Object.assign(product, before);
      toast(error.message || "Unable to update product");
    }
  });
  $$("[data-delete]").forEach(button => button.onclick = async () => {
    if (confirm("Remove this product from the catalog?")) {
      const removed = products.find(product => product.id === button.dataset.delete);
      try {
        await deleteProductFromSupabase(button.dataset.delete);
        products = products.filter(product => product.id !== button.dataset.delete);
        persist(); renderProducts(); renderAdmin();
        auditManagement("product_delete", "product", button.dataset.delete, removed, null);
      } catch (error) {
        toast(error.message || "Unable to remove product");
      }
    }
  });
}

function matchingOrders() {
  const query = orderSearchQuery.trim().toLowerCase();
  if (!query) return orders;
  return orders.filter(order => {
    if (orderSearchField === "all") {
      return [order.number,order.name,order.unit,order.email,order.phone,order.product,order.glCode,order.feeGlCode,formatDate(order.date)]
        .some(value => String(value || "").toLowerCase().includes(query));
    }
    return String(order[orderSearchField] || "").toLowerCase().includes(query);
  });
}

function renderOrderTable() {
  if (!$("#orderTable")) return;
  const matches = matchingOrders();
  $("#orderTable").innerHTML = matches.slice().reverse().map(order => {
    const subtotal = order.price * order.quantity;
    const fee = +order.processingFee || 0;
    const acceptance = order.legalAccepted
      ? `<strong>Yes</strong>${order.legalAcceptedAt || ""}<br><small>Version ${order.legalNoticeVersion || "Not recorded"}</small>`
      : `<span class="acceptance-missing">Not recorded</span>`;
    return `<tr><td>${order.number}</td><td><strong>${order.name}</strong>Unit ${order.unit}</td><td>${order.product}</td><td>${order.quantity}</td><td>${money(subtotal)}</td><td>${fee ? `${money(fee)}<br><small>${order.feeGlCode || ""}</small>` : "-"}</td><td>${money(subtotal + fee)}</td><td>${order.glCode}</td><td>${formatDate(order.date)}</td><td>${acceptance}</td></tr>`;
  }).join("") || `<tr><td colspan="10">No orders match this search.</td></tr>`;
  if ($("#orderSearchCount")) $("#orderSearchCount").textContent = `${matches.length} line item${matches.length === 1 ? "" : "s"} found`;
}

function bindOrderSearch() {
  const field = $("#orderSearchField");
  const input = $("#orderSearchInput");
  if (!field || !input) return;
  const placeholders = {unit:"Enter unit number",number:"Enter order number",name:"Enter resident name",email:"Enter email",phone:"Enter phone number",product:"Enter product name",glCode:"Enter GL code",all:"Search all order information"};
  field.value = orderSearchField;
  input.value = orderSearchQuery;
  input.placeholder = placeholders[orderSearchField];
  field.onchange = () => {
    orderSearchField = field.value;
    input.placeholder = placeholders[orderSearchField];
    renderOrderTable();
  };
  input.oninput = () => {
    orderSearchQuery = input.value;
    renderOrderTable();
  };
  $("#clearOrderSearch").onclick = () => {
    orderSearchQuery = "";
    input.value = "";
    renderOrderTable();
  };
}

function bindRevenueControls() {
  const period = $("#revenuePeriod");
  const label = $("#revenueValueLabel");
  const input = $("#revenueValue");
  if (!period) return;
  period.onchange = () => {
    const type = period.value;
    label.classList.toggle("hidden", type === "all");
    if (type === "day") { input.type = "date"; input.value = todayISO(); }
    if (type === "month") { input.type = "month"; input.value = todayISO().slice(0, 7); }
    if (type === "year") { input.type = "number"; input.min = "2000"; input.max = "2100"; input.value = new Date().getFullYear(); }
  };
  $("#applyRevenueFilter").onclick = () => {
    const type = period.value;
    const value = input.value;
    const filtered = orders.filter(order =>
      type === "all" ||
      type === "day" && order.date === value ||
      type === "month" && order.date.startsWith(value) ||
      type === "year" && order.date.startsWith(`${value}-`)
    );
    const labels = {
      all:"All-time revenue",
      day:`Revenue for ${formatDate(value)}`,
      month:`Revenue for ${value ? `${value.slice(5, 7)}/${value.slice(0, 4)}` : ""}`,
      year:`Revenue for ${value}`
    };
    $("#filteredRevenueLabel").textContent = labels[type];
    $("#filteredRevenue").textContent = money(revenueFor(filtered));
  };
}

function populateFeeSettings() {
  const form = $("#feeSettingsForm");
  if (!form) return;
  form.elements.type.value = feeSettings.type;
  form.elements.amount.value = feeSettings.amount;
  form.elements.label.value = feeSettings.label;
  form.elements.glCode.value = feeSettings.glCode;
  form.elements.enabled.checked = feeSettings.enabled;
}

function showAdminView(view) {
  if (!$(`#admin${view[0].toUpperCase() + view.slice(1)}`)) return;
  auditManagement("report_access", "management_view", view);
  $$(".admin-view").forEach(element => element.classList.add("hidden"));
  $(`#admin${view[0].toUpperCase() + view.slice(1)}`).classList.remove("hidden");
  $("#adminTitle").textContent = view[0].toUpperCase() + view.slice(1);
  $$("[data-admin-view]").forEach(button => button.classList.toggle("active", button.dataset.adminView === view));
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = [...document.scripts].find(script => script.src === src);
    if (existing) {
      if (window.supabase?.createClient) resolve();
      else existing.addEventListener("load", resolve, {once:true});
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Supabase login library could not load."));
    document.head.appendChild(script);
  });
}

function isLocalPrototypeHost() {
  return false;
}

async function loadManagementAuthClient() {
  if (managementAuthClient) return managementAuthClient;
  await loadScriptOnce("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
  if (!window.supabase?.createClient) throw new Error("Supabase login library is unavailable.");
  const response = await fetch("/api/supabase-config", {headers:{"Accept":"application/json"}});
  if (!response.ok) throw new Error("Supabase configuration route is unavailable.");
  const config = await response.json();
  if (!config.enabled) throw new Error("Supabase Auth is not configured.");
  managementAuthClient = window.supabase.createClient(config.url, config.anonKey, {
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  return managementAuthClient;
}

async function approvedManagementSession() {
  const client = await loadManagementAuthClient();
  const {data:{session}} = await client.auth.getSession();
  if (!session?.user) return null;
  const {data:{user}, error:userError} = await client.auth.getUser();
  if (userError || !user || user.id !== session.user.id) return null;
  const {data:profile, error:profileError} = await client
    .from("management_users")
    .select("user_id,email,role,active")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return null;
  managementProfile = profile;
  return {session, profile};
}

function mapSupabaseOrderRows(rows) {
  return (rows || []).flatMap(order => {
    const items = order.order_items || [];
    if (!items.length) {
      return [{
        id:order.id,number:order.order_number,date:(order.created_at || "").slice(0, 10),
        name:order.resident_name,unit:order.unit_number,email:order.email,phone:order.phone || "",
        product:"Order total",internalName:"No line items recorded",productId:"",
        quantity:1,price:centsToDollars(order.subtotal_cents),glCode:"",
        processingFee:centsToDollars(order.processing_fee_cents),feeLabel:feeSettings.label,feeGlCode:feeSettings.glCode,
        legalAccepted:order.legal_accepted,legalAcceptedAt:order.legal_accepted_at || "",
        legalNoticeVersion:order.legal_notice_version,termsVersion:order.terms_version,privacyPolicyVersion:order.privacy_policy_version,
        status:order.status,publicNote:order.public_note || "",internalNote:order.internal_note || "",
        paymentStatus:order.payment_status,squareTransactionId:order.square_payment_id || "",paymentDateTime:order.payment_at || ""
      }];
    }
    return items.map((item, index) => ({
      id:order.id,itemId:item.id,number:order.order_number,date:(order.created_at || "").slice(0, 10),
      name:order.resident_name,unit:order.unit_number,email:order.email,phone:order.phone || "",
      product:item.resident_name_snapshot,internalName:item.internal_name_snapshot,productId:item.product_id,
      quantity:item.quantity,price:centsToDollars(item.unit_price_cents),glCode:item.gl_code_snapshot,
      processingFee:index === 0 ? centsToDollars(order.processing_fee_cents) : 0,feeLabel:feeSettings.label,feeGlCode:feeSettings.glCode,
      legalAccepted:order.legal_accepted,legalAcceptedAt:order.legal_accepted_at || "",
      legalNoticeVersion:order.legal_notice_version,termsVersion:order.terms_version,privacyPolicyVersion:order.privacy_policy_version,
      status:order.status,publicNote:order.public_note || "",internalNote:order.internal_note || "",
      paymentStatus:order.payment_status,squareTransactionId:order.square_payment_id || "",paymentDateTime:order.payment_at || ""
    }));
  });
}

function mapSupabaseFeedbackRows(rows) {
  return (rows || []).map(record => ({
    id:record.id,
    name:record.resident_name,
    unit:record.unit_number,
    email:record.email || "",
    phone:record.phone || "",
    category:record.category,
    message:record.message,
    dateSubmitted:record.submitted_at,
    status:record.status,
    managementResponse:record.management_response || "",
    dateResponded:record.responded_at || "",
    internalNotes:record.internal_notes || ""
  }));
}

function mapSupabaseProductRows(rows) {
  return (rows || []).map(product => ({
    id:product.id,
    name:product.resident_name,
    internalName:product.internal_name,
    glCode:product.gl_code,
    description:product.description,
    category:product.category,
    price:centsToDollars(product.price_cents),
    inventory:product.inventory,
    image:product.image_url || "",
    active:product.active
  }));
}

function mergeManagedProductCatalog(supabaseProducts) {
  const supabaseById = new Map(supabaseProducts.map(product => [product.id, product]));
  const merged = seedProducts.map(seedProduct => ({
    ...seedProduct,
    ...(supabaseById.get(seedProduct.id) || {})
  }));
  supabaseProducts.forEach(product => {
    if (!seedProducts.some(seedProduct => seedProduct.id === product.id)) merged.push(product);
  });
  return merged;
}

async function loadManagementData() {
  if (!managementAuthClient || !window.managementAccessGranted) return;
  const [ordersResult, feedbackResult, productsResult, settingsResult] = await Promise.all([
    managementAuthClient.from("orders").select("*,order_items(*)").order("created_at", {ascending:true}),
    managementAuthClient.from("feedback").select("*").order("submitted_at", {ascending:true}),
    managementAuthClient.from("products").select("*").order("resident_name", {ascending:true}),
    managementAuthClient.from("portal_settings").select("*")
  ]);
  if (ordersResult.error) throw ordersResult.error;
  if (feedbackResult.error) throw feedbackResult.error;
  if (productsResult.error) throw productsResult.error;
  if (settingsResult.error) throw settingsResult.error;
  orders = mapSupabaseOrderRows(ordersResult.data);
  if (typeof feedbackRecords !== "undefined") feedbackRecords = mapSupabaseFeedbackRows(feedbackResult.data);
  const supabaseProducts = mapSupabaseProductRows(productsResult.data);
  products = mergeManagedProductCatalog(supabaseProducts);
  const feeSetting = (settingsResult.data || []).find(setting => setting.key === "processing_fee");
  if (feeSetting?.value) feeSettings = {...feeSettings, ...feeSetting.value};
  managementDataLoaded = true;
}

async function saveOrderToSupabase(number, changes) {
  if (!managementAuthClient) return;
  const payload = {};
  if ("status" in changes) payload.status = changes.status;
  if ("publicNote" in changes) payload.public_note = changes.publicNote;
  if ("internalNote" in changes) payload.internal_note = changes.internalNote;
  payload.updated_at = new Date().toISOString();
  const {error} = await managementAuthClient.from("orders").update(payload).eq("order_number", number);
  if (error) throw error;
}

async function saveFeedbackToSupabase(id, changes) {
  if (!managementAuthClient) return;
  const payload = {};
  if ("status" in changes) payload.status = changes.status;
  if ("managementResponse" in changes) payload.management_response = changes.managementResponse;
  if ("internalNotes" in changes) payload.internal_notes = changes.internalNotes;
  if ("dateResponded" in changes) payload.responded_at = changes.dateResponded || null;
  const {error} = await managementAuthClient.from("feedback").update(payload).eq("id", id);
  if (error) throw error;
}

async function deleteFeedbackFromSupabase(id) {
  if (!managementAuthClient) return;
  const {error} = await managementAuthClient.from("feedback").delete().eq("id", id);
  if (error) throw error;
}
async function saveProductToSupabase(product) {
  if (!managementAuthClient) return;
  const payload = {
    id:product.id,
    resident_name:product.name,
    internal_name:product.internalName,
    gl_code:product.glCode,
    description:product.description,
    category:product.category,
    price_cents:Math.round(Number(product.price || 0) * 100),
    inventory:Number(product.inventory || 0),
    active:Boolean(product.active),
    updated_at:new Date().toISOString()
  };
  const {error} = await managementAuthClient.from("products").upsert(payload, {onConflict:"id"});
  if (error) throw error;
}
async function deleteProductFromSupabase(id) {
  if (!managementAuthClient) return;
  const {error} = await managementAuthClient.from("products").delete().eq("id", id);
  if (error) throw error;
}
async function saveFeeSettingsToSupabase(settings) {
  if (!managementAuthClient) return;
  const {error} = await managementAuthClient.from("portal_settings").upsert({
    key:"processing_fee",
    value:settings,
    updated_at:new Date().toISOString(),
    updated_by:managementProfile?.user_id || null
  }, {onConflict:"key"});
  if (error) throw error;
}
window.saveOrderToSupabase = saveOrderToSupabase;
window.saveFeedbackToSupabase = saveFeedbackToSupabase;
window.deleteFeedbackFromSupabase = deleteFeedbackFromSupabase;

function openManagementLogin() {
  location.href = "/management/login.html?next=%2Fmanagement%2Fdashboard.html";
}

async function openAdminShell() {
  window.managementAccessGranted = true;
  $("#adminShell")?.classList.add("open");
  if (managementProfile?.email) $("#adminUserEmail").textContent = managementProfile.email;
  if (managementAuthClient) await loadManagementData();
  renderAdmin();
}

async function checkAndOpenManagement({silent = false} = {}) {
  if (managementAccessPending) return;
  managementAccessPending = true;
  if (!silent) toast("Checking management access...");
  try {
    const approved = await approvedManagementSession();
    if (!approved) {
      if (isManagementPage) {
        openManagementLogin();
        return;
      }
      if (!silent) openManagementLogin();
      else toast("Please use Management Login to access the dashboard.");
      return;
    }
    await openAdminShell();
  } catch (error) {
    toast(error.message || "Management access is unavailable.");
  } finally {
    managementAccessPending = false;
  }
}

if ($("#adminOpen")) $("#adminOpen").onclick = () => checkAndOpenManagement();
if ($("#adminClose")) $("#adminClose").onclick = () => $("#adminShell").classList.remove("open");
if ($("#adminLogout")) $("#adminLogout").onclick = async () => {
  try {
    if (managementAuthClient) await managementAuthClient.auth.signOut();
  } catch (error) {
    console.warn("Unable to sign out of management session", error);
  }
  managementProfile = null;
  window.managementAccessGranted = false;
  $("#adminShell").classList.remove("open");
  location.href = isManagementPage ? "/management/login.html" : "#home";
  $("#adminUserEmail").textContent = "Property Management";
  toast("Signed out of management");
};
if (isManagementPage && $("#adminShell")) checkAndOpenManagement({silent:true});
$$("[data-admin-view]").forEach(button => button.onclick = () => showAdminView(button.dataset.adminView));

const categorySelect = $('#productForm select[name="category"]');
if (categorySelect) categorySelect.innerHTML = CATEGORIES.map(category => `<option>${category}</option>`).join("");

if ($("#addProduct")) $("#addProduct").onclick = () => {
  $("#productForm").reset();
  $("#productForm [name=id]").value = "";
  $("#productForm [name=active]").checked = true;
  $("#productFormTitle").textContent = "Add product";
  openModal("#productModal");
};

function editProduct(id) {
  const product = products.find(candidate => candidate.id === id);
  const form = $("#productForm");
  Object.keys(product).forEach(key => {
    if (form.elements[key]) {
      if (form.elements[key].type === "checkbox") form.elements[key].checked = product[key];
      else form.elements[key].value = product[key] || "";
    }
  });
  $("#productFormTitle").textContent = "Edit product";
  openModal("#productModal");
}

if ($("#productForm")) $("#productForm").onsubmit = async event => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const index = products.findIndex(candidate => candidate.id === (data.id || ""));
  const before = index >= 0 ? {...products[index]} : null;
  const product = {
    id:data.id || `p${Date.now()}`,name:data.name,description:data.description,category:data.category,
    internalName:data.internalName,price:+data.price,inventory:+data.inventory,glCode:data.glCode,
    image:before?.image || "",active:form.elements.active.checked
  };
  try {
    await saveProductToSupabase(product);
    if (index >= 0) products[index] = product;
    else products.push(product);
    persist(); renderProducts(); renderAdmin(); closeModal("#productModal"); toast("Catalog updated");
    auditManagement(index >= 0 ? "product_update" : "product_create", "product", product.id, before, product);
  } catch (error) {
    toast(error.message || "Unable to save product");
  }
};

if ($("#feeSettingsForm")) $("#feeSettingsForm").onsubmit = async event => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const before = {...feeSettings};
  feeSettings = {enabled:form.elements.enabled.checked,type:data.type,amount:+data.amount,label:data.label,glCode:data.glCode};
  try {
    await saveFeeSettingsToSupabase(feeSettings);
    persist(); renderCart(); renderAdmin(); toast("Processing fee settings saved");
    auditManagement("checkout_settings_update", "portal_settings", "processing_fee", before, feeSettings);
  } catch (error) {
    feeSettings = before;
    toast(error.message || "Unable to save processing fee settings");
  }
};

if ($("#exportOrders")) $("#exportOrders").onclick = () => {
  const rows = [
    ["Order Number","Resident Name","Unit Number","Product","Quantity","Unit Price","Subtotal","Processing Fee","Fee GL Code","Total","Hidden Product GL Code","Date","Legal Notice Accepted","Acceptance Date/Time","Legal Notice Version","Terms Version","Privacy Policy Version"],
    ...orders.map(order => {
      const subtotal = order.price * order.quantity;
      const fee = +order.processingFee || 0;
      return [order.number,order.name,order.unit,order.product,order.quantity,order.price,subtotal,fee,order.feeGlCode || "",subtotal + fee,order.glCode,formatDate(order.date),order.legalAccepted ? "Yes" : "Not recorded",order.legalAcceptedAt || "",order.legalNoticeVersion || "",order.termsVersion || "",order.privacyPolicyVersion || ""];
    })
  ];
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `BrickellHouse-Orders-${fileDate()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  toast("Excel-compatible report exported");
  auditManagement("export_orders", "export", "orders", null, {rows:orders.length});
};

const observer = new IntersectionObserver(entries => entries.forEach(entry => entry.isIntersecting && entry.target.classList.add("visible")), {threshold:.12});
$$(".reveal").forEach(element => observer.observe(element));

let parallaxFrame = 0;
function updateParallax() {
  parallaxFrame = 0;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const viewportCenter = window.innerHeight / 2;
  $$(".parallax-image").forEach(image => {
    const rect = image.parentElement.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    const distance = rect.top + rect.height / 2 - viewportCenter;
    image.style.transform = `translate3d(0, ${distance * +image.dataset.parallax}px, 0) scale(1.04)`;
  });
  const heroImage = $(".hero-image");
  if (heroImage && window.scrollY < window.innerHeight * 1.2) {
    heroImage.style.transform = `translate3d(0, ${window.scrollY * .12}px, 0) scale(1.04)`;
  }
}
window.addEventListener("scroll", () => {
  if (!parallaxFrame) parallaxFrame = requestAnimationFrame(updateParallax);
}, {passive:true});
window.addEventListener("resize", updateParallax);

persist();
renderTabs();
renderProducts();
renderCart();
renderLegalNotice();
updateParallax();
loadPublicProductCatalog();
