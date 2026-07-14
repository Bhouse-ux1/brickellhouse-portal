const CATALOG_VERSION = "resident-services-2026-06-12-v2";
const LEGAL_NOTICE_VERSION = window.BH_LEGAL_NOTICE.version;
const CATEGORIES = ["Keys & Access", "Maintenance Services", "HVAC Services", "Subscriptions & Plans"];
const ORDER_STATUSES = ["Received", "Processing", "Ready for Pickup", "Completed", "Cancelled"];
const FEEDBACK_STATUSES = ["New", "In Review", "Completed", "Closed"];
window.managementAccessGranted = false;
let managementAuthClient = null;
let managementProfile = null;
let managementAccessPending = false;
let managementDataLoaded = false;
let managementSupabaseProductIds = new Set();

const PRODUCT_TOGGLE_RECORD_ERROR = "This product could not be updated because no matching editable database record was found. Please refresh and try again.";

const seedProducts = [
  {id:"svc1",name:"Mailbox Key Copy",category:"Keys & Access",description:"Replacement key for your assigned mailbox.",price:1,inventory:99,glCode:"40090",image:"offer-mailbox-key.webp",active:true},
  {id:"svc2",name:"Unit Key Copy",category:"Keys & Access",description:"Replacement of your unit door key.",price:30,inventory:99,glCode:"40090",image:"offer-unit-key.webp",active:true},
  {id:"svc3",name:"Smoke Detector Battery Replacement",category:"Maintenance Services",description:"Includes battery and labor.",price:25,inventory:99,glCode:"40090",image:"offer-smoke-battery.webp",active:true},
  {id:"svc4",name:"AC Filter Replacement",category:"HVAC Services",description:"Includes filter and labor.",price:55,inventory:99,glCode:"40090",image:"offer-filter-replacement.webp",active:true},
  {id:"svc5",name:"Trash Compactor Replacement",category:"Maintenance Services",description:"Includes parts and labor.",price:200,inventory:99,glCode:"40090",image:"offer-trash-compactor.webp",active:true},
  {id:"svc6",name:"Toilet or Sink Unclogged Service",category:"Maintenance Services",description:"Includes unclogging and labor for each individual sink or toilet.",price:30,inventory:99,glCode:"40090",image:"offer-unclog-service.webp",active:true},
  {id:"svc7",name:"Lockout Assistance",category:"Keys & Access",description:"Includes access and labor.",price:50,inventory:99,glCode:"40090",image:"offer-lockout.webp",active:true},
  {id:"svc8",name:"Faucet Repair",category:"Maintenance Services",description:"Includes parts and labor.",price:125,inventory:99,glCode:"40090",image:"offer-faucet-repair.webp",active:true},
  {id:"svc9",name:"Thermostat Reset or System Check",category:"HVAC Services",description:"Includes minor adjustments and labor.",price:40,inventory:99,glCode:"40090",image:"offer-thermostat-check.webp",active:true},
  {id:"svc10",name:"Portable AC Unit Rental",category:"HVAC Services",description:"$25.00 per day; requires a $300 refundable security deposit payable in advance.",price:300,inventory:10,glCode:"40090",image:"offer-portable-ac.webp",active:true},
  {id:"svc11",name:"Thermostat Replacement",category:"HVAC Services",description:"Thermostat replacement provided at no charge.",price:0,inventory:99,glCode:"40090",image:"offer-thermostat-replacement.webp",active:true},
  {id:"svc12",name:"Annual AC Filter Subscription",category:"Subscriptions & Plans",description:"Includes 12 scheduled AC filter replacements per year, one per month.",price:360,inventory:99,glCode:"40090",image:"offer-annual-filter.webp",active:true},
  {id:"svc13",name:"Valet Service Subscription",category:"Subscriptions & Plans",description:"Includes unlimited valet parking for one month for each registered vehicle per unit.",price:250,inventory:99,glCode:"40033",image:"offer-valet-subscription.webp",active:true},
  {id:"svc14",name:"AC Drain Line Cleaning",category:"HVAC Services",description:"Includes cleaning and flushing the AC drain line to prevent overflow.",price:45,inventory:99,glCode:"40090",image:"offer-drain-cleaning.webp",active:true},
  {id:"svc15",name:"Premium Resident Care Plan",category:"Subscriptions & Plans",description:"Billed annually. Covers basic in-unit maintenance labor, including light bulbs, AC maintenance, filters, thermostat checks, unclogging, minor touch-ups, and general inspections.",price:960,inventory:99,glCode:"40090",image:"offer-resident-care.webp",active:true}
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
let revenueChartYear = String(new Date().getFullYear());
let lunaInsights = [];
let lunaInsightsError = "";
let lunaInsightFilters = {period:"month",language:"all",outcome:"all",search:""};
let selectedLunaConversationId = "";
let feedbackRecords = [];

function accountingGlCode(product) {
  const label = `${product.id || ""} ${product.name || ""} ${product.internalName || ""}`.toLowerCase();
  return label.includes("valet") ? "40033" : "40090";
}
function accountingName(product) {
  return `${product.name} GL-${accountingGlCode(product)}`;
}
function preservedInternalName(product, fallbackProduct = null) {
  const current = String(product?.internalName ?? "").trim();
  if (current && !/^(undefined|null)$/i.test(current)) return current;
  const fallback = String(fallbackProduct?.internalName ?? "").trim();
  if (fallback && !/^(undefined|null)$/i.test(fallback)) return fallback;
  return accountingName(product);
}
products.forEach(product => {
  product.glCode = accountingGlCode(product);
  product.internalName = preservedInternalName(product);
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
function normalizeProduct(product, fallbackProduct = null) {
  const normalized = {
    ...product,
    price:Number(product.price || 0),
    inventory:Number(product.inventory || 0),
    active:Boolean(product.active)
  };
  normalized.internalName = preservedInternalName(normalized, fallbackProduct);
  normalized.glCode = accountingGlCode(normalized);
  return {
    ...normalized
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

function orderProductRevenue(order) {
  return Number(order.price || 0) * Number(order.quantity || 0);
}

function monthKeyLabel(key, options = {}) {
  const [year, month] = String(key || "").split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(date.getTime())) return key || "";
  return date.toLocaleDateString("en-US", {month:options.short ? "short" : "long", year:options.year ? "numeric" : undefined});
}

function revenueYears() {
  const years = new Set([String(new Date().getFullYear())]);
  orders.forEach(order => {
    const year = String(order.date || "").slice(0, 4);
    if (/^\d{4}$/.test(year)) years.add(year);
  });
  return [...years].sort((a, b) => b.localeCompare(a));
}

function monthlyRevenueSeries(year) {
  return Array.from({length:12}, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    const key = `${year}-${month}`;
    const monthOrders = orders.filter(order => String(order.date || "").startsWith(key));
    return {
      key,
      label:monthKeyLabel(key, {short:true}),
      fullLabel:monthKeyLabel(key, {year:true}),
      revenue:revenueFor(monthOrders),
      orderCount:new Set(monthOrders.map(order => order.number)).size,
      lineCount:monthOrders.length
    };
  });
}

function productBreakdownForMonth(key) {
  const groups = new Map();
  orders
    .filter(order => String(order.date || "").startsWith(key))
    .forEach(order => {
      const product = displayText(order.product, "Unnamed product");
      if (!groups.has(product)) groups.set(product, {product, quantity:0, revenue:0, orders:new Set()});
      const group = groups.get(product);
      group.quantity += Number(order.quantity || 0);
      group.revenue += orderProductRevenue(order);
      if (order.number) group.orders.add(order.number);
    });
  return [...groups.values()]
    .map(group => ({...group, orderCount:group.orders.size}))
    .sort((a, b) => b.revenue - a.revenue || a.product.localeCompare(b.product));
}

function niceChartStep(value) {
  if (value <= 0) return 25;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

function revenueAxisMax(maxRevenue) {
  if (maxRevenue <= 0) return 100;
  const step = niceChartStep(maxRevenue * 1.06 / 4);
  return Math.max(step * 4, step);
}

function revenueAxisTicks(maxRevenue) {
  const axisMax = revenueAxisMax(maxRevenue);
  return Array.from({length:5}, (_, index) => axisMax - axisMax / 4 * index);
}

function revenueAxisLabel(value) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function revenueChartMarkup(year) {
  const series = monthlyRevenueSeries(year);
  const highestRevenue = Math.max(0, ...series.map(month => month.revenue));
  const axisMax = revenueAxisMax(highestRevenue);
  const leftTicks = revenueAxisTicks(highestRevenue);
  const rightTicks = [100, 75, 50, 25, 0];
  const yearTotal = series.reduce((sum, month) => sum + month.revenue, 0);
  const orderTotal = series.reduce((sum, month) => sum + month.orderCount, 0);
  const years = revenueYears();
  return `
    <div class="admin-panel revenue-chart-panel">
      <div class="revenue-chart-head">
        <div>
          <p class="eyebrow">Revenue intelligence</p>
          <h3>Monthly revenue</h3>
          <p>Review earned revenue by month and open a product-level breakdown for any period.</p>
        </div>
        <div class="revenue-chart-controls">
          <label><span>Year</span><select id="revenueChartYear">${years.map(option => `<option value="${option}" ${option === year ? "selected" : ""}>${option}</option>`).join("")}</select></label>
          <div class="revenue-chart-total"><span>${year} total</span><strong>${money(yearTotal)}</strong><small>${orderTotal} order${orderTotal === 1 ? "" : "s"}</small></div>
        </div>
      </div>
      <div class="revenue-analytics-chart" id="revenueChart">
        <div class="revenue-axis-title revenue-axis-title-left">Revenue</div>
        <div class="revenue-axis-title revenue-axis-title-right">Profit Margin (%)</div>
        <div class="revenue-axis revenue-axis-left">${leftTicks.map(tick => `<span>${revenueAxisLabel(tick)}</span>`).join("")}</div>
        <div class="revenue-axis revenue-axis-right">${rightTicks.map(tick => `<span>${tick}%</span>`).join("")}</div>
        <div class="revenue-plot" aria-label="Monthly revenue chart for ${year}">
          <div class="revenue-grid" aria-hidden="true">${leftTicks.map(() => "<span></span>").join("")}</div>
          <svg class="profit-margin-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
          <div class="revenue-bars">
            ${series.map((month, index) => {
              const height = month.revenue > 0 ? Math.max(3, month.revenue / axisMax * 100) : 0;
              return `<button class="revenue-bar-button ${month.revenue > 0 ? "has-revenue" : "is-empty"}" type="button" data-revenue-month="${month.key}" style="--bar-height:${height}%;--bar-delay:${index * .035}s" aria-label="${month.fullLabel}: ${money(month.revenue)} from ${month.orderCount} orders">
                <span class="revenue-bar-tooltip"><strong>${month.fullLabel}</strong><span>Revenue: ${money(month.revenue)}</span><span>Orders: ${month.orderCount}</span></span>
                <span class="revenue-bar-fill"></span>
                <span class="revenue-bar-label">${month.label}</span>
              </button>`;
            }).join("")}
          </div>
        </div>
        <div class="profit-margin-note">Profit margin line will appear here when verified cost and margin data is available.</div>
      </div>
      <div class="revenue-detail-panel" id="revenueMonthDetail">
        <p class="eyebrow">Month detail</p>
        <h4>Select a month to view products sold.</h4>
        <p>Click any bar above to see product quantities and revenue for that month.</p>
      </div>
    </div>`;
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
  if (button.dataset.close === "lunaReview") closeModal("#lunaReviewModal");
}));

function renderAdmin() {
  if (!$("#adminOverview")) return;
  if (!window.managementAccessGranted) return;
  auditManagement("report_access", "management_report", "overview");
  const revenue = revenueFor(orders);
  const units = new Set(orders.map(order => order.unit)).size;
  const lowProducts = products.filter(product => product.active && product.inventory <= 15);
  const lowInventory = lowProducts.length;
  const years = revenueYears();
  if (!years.includes(revenueChartYear)) revenueChartYear = years[0];

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
    ${revenueChartMarkup(revenueChartYear)}
    <div class="admin-panel">
      <h3>Recent resident orders</h3>
      <div class="table-wrap">${orders.length ? `<table><thead><tr><th>Order</th><th>Resident</th><th>Product</th><th>Total</th><th>Date</th></tr></thead><tbody>${orders.slice(-5).reverse().map(order =>
        `<tr><td>${order.number}</td><td><strong>${order.name}</strong>Unit ${order.unit}</td><td>${order.product}</td><td>${money(order.price * order.quantity + (+order.processingFee || 0))}</td><td>${formatDate(order.date)}</td></tr>`
      ).join("")}</tbody></table>` : "<p>No orders yet.</p>"}</div>
    </div>`;

  $("#productTable").innerHTML = products.map(productRowMarkup).join("");

  renderOrderTable();
  renderLunaInsights();

  bindRevenueControls();
  bindLunaInsightControls();
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
    if (!product) {
      toast(PRODUCT_TOGGLE_RECORD_ERROR);
      return;
    }
    const before = {...product};
    const nextActive = !product.active;
    try {
      const confirmedProduct = await saveProductStatusToSupabase(product, nextActive);
      product.active = confirmedProduct.active;
      persist(); renderProducts(); renderAdmin();
      auditManagement("product_status_change", "product", product.id, before, product);
      try {
        await reloadManagementProductCatalog(product.id);
        persist(); renderProducts(); renderAdmin();
        await verifyResidentProductCatalog(product.id);
      } catch (refreshError) {
        console.warn("[Management product toggle] The database update was confirmed, but catalog refresh verification failed.", {
          productId:product.id,
          message:refreshError?.message || "Unknown refresh error"
        });
        toast("Product updated, but the catalog refresh could not be verified. Please refresh and check again.");
      }
    } catch (error) {
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

function insightDate(row) {
  const date = new Date(row.created_at);
  return Number.isNaN(date.getTime()) ? null : date;
}

function insightPeriodStart(period) {
  const now = new Date();
  if (period === "week") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (period === "month") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (period === "year") return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  return null;
}

function formatInsightDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month:"short",
    day:"numeric",
    year:"numeric",
    hour:"numeric",
    minute:"2-digit"
  }).format(date);
}

function countBy(rows, key) {
  return rows.reduce((counts, row) => {
    const value = row[key] || "Unknown";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function insightMetric(label, value, helper = "") {
  return `<div class="metric luna-insight-metric"><span>${label}</span><strong>${value}</strong>${helper ? `<small>${helper}</small>` : ""}</div>`;
}

function legacyLunaInsightsRendererUnused() {
  const container = $("#lunaInsightsContent");
  if (!container) return;
  if (lunaInsightsError) {
    container.innerHTML = `<div class="inventory-ok">${escapeAdminHtml(lunaInsightsError)}</div>`;
    return;
  }
  const rows = filteredLunaInsights();
  const now = Date.now();
  const todayRows = lunaInsights.filter(row => {
    const date = insightDate(row);
    return date && new Date(date).toDateString() === new Date().toDateString();
  });
  const weekRows = lunaInsights.filter(row => {
    const date = insightDate(row);
    return date && now - date.getTime() <= 7 * 24 * 60 * 60 * 1000;
  });
  const monthRows = lunaInsights.filter(row => {
    const date = insightDate(row);
    return date && now - date.getTime() <= 30 * 24 * 60 * 60 * 1000;
  });
  const avgHistory = rows.length
    ? (rows.reduce((total, row) => total + Number(row.history_message_count || 0) + 1, 0) / rows.length).toFixed(1)
    : "0";
  const unknownCount = rows.filter(row => row.outcome === "unknown").length;
  const clarificationCount = rows.filter(row => row.clarification_requested).length;
  const categoryCounts = Object.entries(countBy(weekRows, "category"))
    .sort((a,b) => b[1] - a[1])
    .slice(0, 6);
  const unknownRows = rows
    .filter(row => row.redacted_question_snippet)
    .slice(0, 12);

  container.innerHTML = `
    <div class="metric-grid luna-insight-grid">
      ${insightMetric("Today", todayRows.length, "anonymous events")}
      ${insightMetric("Last 7 days", weekRows.length, "anonymous events")}
      ${insightMetric("Last 30 days", monthRows.length, "anonymous events")}
      ${insightMetric("Avg. context", avgHistory, "messages")}
    </div>
    <div class="luna-insight-panels">
      <div class="admin-panel luna-insight-panel">
        <div class="luna-insight-panel-head"><div><p class="eyebrow">Knowledge gaps</p><h3>Unknown and low-confidence questions</h3></div><span>${unknownCount} unknown · ${clarificationCount} clarifications</span></div>
        ${unknownRows.length ? `<div class="luna-insight-list">${unknownRows.map(row => `
          <article class="luna-insight-row">
            <div><strong>${escapeAdminHtml(row.redacted_question_snippet || "Redacted snippet unavailable")}</strong><small>${escapeAdminHtml(row.category)} · ${escapeAdminHtml(row.detected_language || "unknown")} · ${formatInsightDate(row.created_at)}</small></div>
            <span class="status-pill ${row.outcome === "unknown" || Number(row.confidence || 0) < 60 ? "new" : ""}">${escapeAdminHtml(row.outcome)}</span>
          </article>`).join("")}</div>` : `<div class="inventory-ok">No redacted unknown or low-confidence snippets match this filter.</div>`}
      </div>
      <div class="admin-panel luna-insight-panel">
        <div class="luna-insight-panel-head"><div><p class="eyebrow">Aggregate only</p><h3>Top categories this week</h3></div></div>
        ${categoryCounts.length ? `<div class="luna-category-list">${categoryCounts.map(([category,count]) => `
          <div><span>${escapeAdminHtml(category)}</span><strong>${count}</strong></div>`).join("")}</div>` : `<div class="inventory-ok">No Luna usage has been recorded this week.</div>`}
      </div>
    </div>
    <div class="admin-panel luna-insight-table-panel">
      <h3>Review log</h3>
      <p>Rows show privacy-safe analytics only. Normal answered questions are aggregate-only and do not include snippets.</p>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Language</th><th>Outcome</th><th>Confidence</th><th>Snippet</th></tr></thead><tbody>
        ${rows.length ? rows.slice(0, 80).map(row => `<tr><td>${formatInsightDate(row.created_at)}</td><td>${escapeAdminHtml(row.category)}</td><td>${escapeAdminHtml(row.detected_language || "unknown")}</td><td>${escapeAdminHtml(row.outcome)}</td><td>${Number(row.confidence || 0)}%</td><td>${row.redacted_question_snippet ? escapeAdminHtml(row.redacted_question_snippet) : "<em>Aggregate only</em>"}</td></tr>`).join("") : `<tr><td colspan="6">No insights match this filter.</td></tr>`}
      </tbody></table></div>
    </div>`;
}

function bindLunaInsightControls() {
  const period = $("#lunaInsightPeriod");
  const language = $("#lunaInsightLanguage");
  const outcome = $("#lunaInsightOutcome");
  const search = $("#lunaInsightSearch");
  const exportButton = $("#exportLunaInsights");
  if (period) {
    period.value = lunaInsightFilters.period;
    period.onchange = () => { lunaInsightFilters.period = period.value; renderLunaInsights(); };
  }
  if (language) {
    language.value = lunaInsightFilters.language;
    language.onchange = () => { lunaInsightFilters.language = language.value; renderLunaInsights(); };
  }
  if (outcome) {
    outcome.value = lunaInsightFilters.outcome;
    outcome.onchange = () => { lunaInsightFilters.outcome = outcome.value; renderLunaInsights(); };
  }
  if (search) {
    search.value = lunaInsightFilters.search;
    search.oninput = () => { lunaInsightFilters.search = search.value; renderLunaInsights(); };
  }
  if (exportButton) exportButton.onclick = exportLunaInsightsCsv;
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function legacyLunaInsightsCsvUnused() {
  const rows = filteredLunaInsights();
  const headers = ["created_at","category","detected_language","detected_topic","outcome","confidence","source","redacted_question_snippet","history_message_count"];
  const csv = [
    headers.join(","),
    ...rows.map(row => headers.map(header => csvEscape(row[header] || "")).join(","))
  ].join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `luna-insights-${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  auditManagement("export", "luna_insights", "redacted_csv");
}

function filteredLunaInsights() {
  const start = insightPeriodStart(lunaInsightFilters.period === "quarter" ? "quarter" : lunaInsightFilters.period);
  const search = lunaInsightFilters.search.trim().toLowerCase();
  return lunaInsights.filter(row => {
    const date = insightDate(row);
    if (start && (!date || date < start)) return false;
    if (lunaInsightFilters.language !== "all" && row.detected_language !== lunaInsightFilters.language) return false;
    if (lunaInsightFilters.outcome === "low" && Number(row.confidence || 0) >= 60) return false;
    if (lunaInsightFilters.outcome === "unknown" && (row.detected_topic || "unknown") !== "unknown" && row.category !== "Unknown") return false;
    if (!["all","low","unknown"].includes(lunaInsightFilters.outcome) && row.status !== lunaInsightFilters.outcome) return false;
    if (search) {
      const messages = Array.isArray(row.messages) ? row.messages.map(message => message.text || message.redacted_text || "").join(" ") : "";
      const haystack = [row.conversation_id,row.category,row.detected_topic,row.status,row.management_note,messages].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function insightDate(row) {
  const date = new Date(row.last_message_at || row.created_at);
  return Number.isNaN(date.getTime()) ? null : date;
}

function insightPeriodStart(period) {
  const now = new Date();
  if (period === "week") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (period === "month") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (period === "quarter") return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  return null;
}

function conversationPreview(row) {
  const messages = Array.isArray(row.messages) ? row.messages : [];
  const resident = messages.find(message => message.role === "resident" && (message.text || message.redacted_text));
  if (!resident) return "No reviewable message content.";
  return resident.text || resident.redacted_text || "";
}

function statusClass(status) {
  return String(status || "New").toLowerCase().replace(/\s+/g, "-");
}

function conversationById(id) {
  return lunaInsights.find(row => row.conversation_id === id);
}

function renderLunaInsights() {
  const container = $("#lunaInsightsContent");
  if (!container) return;
  if (lunaInsightsError) {
    container.innerHTML = `<div class="inventory-ok">${escapeAdminHtml(lunaInsightsError)}</div>`;
    return;
  }
  const rows = filteredLunaInsights();
  const now = Date.now();
  const activeRows = lunaInsights.filter(row => {
    const date = insightDate(row);
    return date && now - date.getTime() <= 90 * 24 * 60 * 60 * 1000;
  });
  const newCount = activeRows.filter(row => row.status === "New").length;
  const reviewedCount = activeRows.filter(row => row.status === "Reviewed").length;
  const resolvedCount = activeRows.filter(row => row.status === "Resolved").length;
  const spanishCount = activeRows.filter(row => row.detected_language === "es").length;
  const unknownCount = activeRows.filter(row => (row.detected_topic || "unknown") === "unknown" || row.category === "Unknown").length;
  const lowConfidenceCount = activeRows.filter(row => Number(row.confidence || 0) < 60).length;
  const categoryCounts = Object.entries(countBy(activeRows, "category"))
    .sort((a,b) => b[1] - a[1])
    .slice(0, 6);

  container.innerHTML = `
    <div class="metric-grid luna-insight-grid">
      ${insightMetric("Conversations", activeRows.length, "last 90 days")}
      ${insightMetric("New", newCount, "awaiting review")}
      ${insightMetric("Reviewed", reviewedCount, "management touched")}
      ${insightMetric("Resolved", resolvedCount, "closed items")}
    </div>
    <div class="luna-insight-panels">
      <div class="admin-panel luna-insight-panel">
        <div class="luna-insight-panel-head"><div><p class="eyebrow">Conversation review</p><h3>Luna conversations</h3></div><span>${spanishCount} Spanish · ${unknownCount} unknown · ${lowConfidenceCount} low confidence</span></div>
        ${rows.length ? `<div class="luna-review-list">${rows.map(row => `
          <button class="luna-review-card" type="button" data-luna-review="${escapeAdminHtml(row.conversation_id)}">
            <div>
              <strong>${escapeAdminHtml(conversationPreview(row))}</strong>
              <small>${escapeAdminHtml(row.category || "Unknown")} · ${escapeAdminHtml(row.detected_language || "unknown")} · ${formatInsightDate(row.last_message_at || row.created_at)}</small>
            </div>
            <span class="status-pill ${statusClass(row.status)}">${escapeAdminHtml(row.status || "New")}</span>
          </button>`).join("")}</div>` : `<div class="inventory-ok">No conversations match this filter.</div>`}
      </div>
      <div class="admin-panel luna-insight-panel">
        <div class="luna-insight-panel-head"><div><p class="eyebrow">90-day summary</p><h3>Top categories</h3></div></div>
        ${categoryCounts.length ? `<div class="luna-category-list">${categoryCounts.map(([category,count]) => `
          <div><span>${escapeAdminHtml(category)}</span><strong>${count}</strong></div>`).join("")}</div>` : `<div class="inventory-ok">No Luna conversations have been recorded in the review window.</div>`}
      </div>
    </div>
    <div class="inventory-ok luna-review-guardrail">Management review only. These records are temporary and cannot update Luna knowledge, prompts, model, or behavior.</div>`;
  bindLunaReviewCards();
}

function bindLunaReviewCards() {
  $$("[data-luna-review]").forEach(button => {
    button.onclick = () => openLunaReview(button.dataset.lunaReview);
  });
}

function openLunaReview(conversationId) {
  const row = conversationById(conversationId);
  const modal = $("#lunaReviewModal");
  if (!row || !modal) return;
  selectedLunaConversationId = conversationId;
  $("#lunaReviewId").textContent = conversationId;
  $("#lunaReviewMeta").textContent = `${row.category || "Unknown"} · ${row.detected_language || "unknown"} · ${Number(row.confidence || 0)}% confidence · ${formatInsightDate(row.last_message_at || row.created_at)}`;
  $("#lunaReviewStatus").value = row.status || "New";
  $("#lunaReviewNote").value = row.management_note || "";
  const messages = Array.isArray(row.messages) ? row.messages : [];
  $("#lunaReviewMessages").innerHTML = messages.length ? messages.map(message => `
    <div class="luna-review-message ${escapeAdminHtml(message.role || "")}">
      <span>${escapeAdminHtml(message.role === "luna" ? "Luna" : "Resident")}</span>
      <p>${escapeAdminHtml(message.text || message.redacted_text || "")}</p>
    </div>`).join("") : `<div class="inventory-ok">No messages are available for this conversation.</div>`;
  modal.classList.add("open");
}

async function saveLunaConversationReview() {
  const row = conversationById(selectedLunaConversationId);
  if (!row || !managementAuthClient) return;
  const status = $("#lunaReviewStatus").value;
  const managementNote = $("#lunaReviewNote").value;
  try {
    const {data:{session}} = await managementAuthClient.auth.getSession();
    if (!session?.access_token) throw new Error("Management login required.");
    const response = await fetch("/api/luna-insights", {
      method:"PATCH",
      headers:{
        "Content-Type":"application/json",
        "Accept":"application/json",
        "Authorization":`Bearer ${session.access_token}`
      },
      body:JSON.stringify({conversationId:selectedLunaConversationId,status,managementNote})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) throw new Error(payload.message || "Unable to save conversation review.");
    Object.assign(row, payload.conversation || {}, {
      status,
      management_note:managementNote
    });
    renderLunaInsights();
    closeModal("#lunaReviewModal");
    auditManagement("luna_conversation_review_update", "luna_conversation_review", selectedLunaConversationId, null, {status});
    toast("Conversation review saved");
  } catch (error) {
    toast(error.message || "Unable to save conversation review.");
  }
}

function exportLunaInsightsCsv() {
  const rows = filteredLunaInsights();
  const headers = ["conversation_id","created_at","last_message_at","category","detected_language","detected_topic","confidence","status","management_note","messages"];
  const csv = [
    headers.join(","),
    ...rows.map(row => headers.map(header => {
      if (header === "messages") {
        const messages = Array.isArray(row.messages) ? row.messages : [];
        return csvEscape(messages.map(message => `${message.role}: ${message.text || message.redacted_text || ""}`).join(" | "));
      }
      return csvEscape(row[header] || "");
    }).join(","))
  ].join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `luna-conversation-review-${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  auditManagement("export", "luna_conversation_reviews", "csv");
}

if ($("#saveLunaReview")) $("#saveLunaReview").onclick = saveLunaConversationReview;

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
  const yearSelect = $("#revenueChartYear");
  if (!yearSelect) return;
  yearSelect.onchange = () => {
    revenueChartYear = yearSelect.value;
    renderAdmin();
  };
  $$("[data-revenue-month]").forEach(button => {
    button.onclick = () => {
      $$("[data-revenue-month]").forEach(candidate => candidate.classList.toggle("active", candidate === button));
      renderRevenueMonthDetail(button.dataset.revenueMonth);
    };
  });
}

function renderRevenueMonthDetail(key) {
  const panel = $("#revenueMonthDetail");
  if (!panel) return;
  const breakdown = productBreakdownForMonth(key);
  const monthOrders = orders.filter(order => String(order.date || "").startsWith(key));
  const monthRevenue = revenueFor(monthOrders);
  const orderCount = new Set(monthOrders.map(order => order.number)).size;
  auditManagement("report_access", "management_report", `revenue_${key}`);
  panel.innerHTML = `
    <div class="revenue-detail-head">
      <div>
        <p class="eyebrow">Product detail</p>
        <h4>Products sold in ${monthKeyLabel(key, {year:true})}</h4>
      </div>
      <div class="revenue-detail-total"><span>Total revenue</span><strong>${money(monthRevenue)}</strong><small>${orderCount} order${orderCount === 1 ? "" : "s"}</small></div>
    </div>
    ${breakdown.length ? `<div class="revenue-product-list">${breakdown.map(item => `
      <div class="revenue-product-row">
        <strong>${escapeAdminHtml(item.product)}</strong>
        <span>${item.quantity} sold</span>
        <span>${item.orderCount} order${item.orderCount === 1 ? "" : "s"}</span>
        <b>${money(item.revenue)}</b>
      </div>`).join("")}</div>` : `<div class="inventory-ok">No products were sold during this period.</div>`}
  `;
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
  $("#adminTitle").textContent = view === "insights" ? "Luna Review" : view[0].toUpperCase() + view.slice(1);
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
    .select("user_id,email,role,active,mfa_required")
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
        paymentStatus:order.payment_status,
        squareTransactionId:order.square_payment_id || order.payment_processor_reference || order.stripe_payment_intent_id || order.stripe_checkout_session_id || "",
        paymentDateTime:order.payment_at || ""
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
      paymentStatus:order.payment_status,
      squareTransactionId:order.square_payment_id || order.payment_processor_reference || order.stripe_payment_intent_id || order.stripe_checkout_session_id || "",
      paymentDateTime:order.payment_at || ""
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
  return (rows || []).map(product => normalizeProduct({
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

function applyManagementProductRows(rows) {
  const supabaseProducts = mapSupabaseProductRows(rows);
  managementSupabaseProductIds = new Set(supabaseProducts.map(product => String(product.id)));
  const seedOnlyIds = seedProducts
    .map(product => String(product.id))
    .filter(id => !managementSupabaseProductIds.has(id));
  if (seedOnlyIds.length) {
    console.info("[Management products] Seed-only products are not backed by editable Supabase rows.", {
      productIds:seedOnlyIds
    });
  }
  products = mergeManagedProductCatalog(supabaseProducts);
  return supabaseProducts;
}

async function reloadManagementProductCatalog(requiredProductId = "") {
  const {data, error} = await managementAuthClient
    .from("products")
    .select("*")
    .order("resident_name", {ascending:true});
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  if (requiredProductId && !rows.some(row => String(row.id) === String(requiredProductId))) {
    throw new Error("The updated product was not returned when Management refreshed the catalog.");
  }
  applyManagementProductRows(rows);
}

async function logProductToggleDiagnostic({productId, rowCount, reason}) {
  let assuranceLevel = "unknown";
  let isManagementUser = "unknown";
  try {
    if (managementAuthClient?.auth?.mfa?.getAuthenticatorAssuranceLevel) {
      const {data, error} = await managementAuthClient.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!error && data?.currentLevel) assuranceLevel = data.currentLevel;
    }
  } catch {
    assuranceLevel = "unknown";
  }
  try {
    const {data, error} = await managementAuthClient.rpc("is_management_user");
    if (!error) isManagementUser = data === true;
  } catch {
    isManagementUser = "unknown";
  }
  console.warn("[Management product toggle] Supabase did not confirm one editable product row.", {
    productId:String(productId || ""),
    source:managementSupabaseProductIds.has(String(productId)) ? "supabase" : "seed-fallback",
    rowCount,
    reason,
    assuranceLevel,
    profileRequiresMfa:managementProfile?.mfa_required ?? "unknown",
    isManagementUser
  });
}

async function verifyResidentProductCatalog(productId) {
  const product = products.find(candidate => String(candidate.id) === String(productId));
  if (!product) throw new Error("The updated product is missing from the refreshed Management catalog.");
  const response = await fetch("/api/products", {
    cache:"no-store",
    headers:{"Accept":"application/json"}
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success || !Array.isArray(payload.products)) {
    throw new Error("The resident catalog endpoint is unavailable.");
  }
  const isPubliclyVisible = payload.products.some(candidate => String(candidate.id) === String(productId));
  const shouldBePubliclyVisible = Boolean(product.active) && Number(product.inventory || 0) > 0;
  if (isPubliclyVisible !== shouldBePubliclyVisible) {
    throw new Error("The resident catalog does not yet reflect the confirmed product status.");
  }
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
  applyManagementProductRows(productsResult.data);
  const feeSetting = (settingsResult.data || []).find(setting => setting.key === "processing_fee");
  if (feeSetting?.value) feeSettings = {...feeSettings, ...feeSetting.value};
  await loadLunaInsights();
  managementDataLoaded = true;
}

async function loadLunaInsights() {
  if (!managementAuthClient || !window.managementAccessGranted) return;
  try {
    const {data:{session}} = await managementAuthClient.auth.getSession();
    if (!session?.access_token) throw new Error("Management login required.");
    const response = await fetch("/api/luna-insights", {
      headers:{
        "Accept":"application/json",
        "Authorization":`Bearer ${session.access_token}`
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) throw new Error(payload.message || "Luna conversation review is unavailable.");
    lunaInsights = Array.isArray(payload.conversations) ? payload.conversations : [];
    lunaInsightsError = "";
  } catch (error) {
    lunaInsights = [];
    lunaInsightsError = error.message || "Luna conversation review is unavailable.";
  }
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
  const existingProduct = products.find(candidate => candidate.id === product.id);
  const internalName = preservedInternalName(product, existingProduct);
  const glCode = accountingGlCode({...product, internalName});
  const payload = {
    id:product.id,
    resident_name:product.name,
    internal_name:internalName,
    gl_code:glCode,
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
async function saveProductStatusToSupabase(product, nextActive) {
  if (!managementAuthClient) throw new Error("Management authentication is unavailable.");
  const productId = String(product?.id || "");
  if (!managementSupabaseProductIds.has(productId)) {
    await logProductToggleDiagnostic({
      productId,
      rowCount:0,
      reason:"seed-only product"
    });
    throw new Error(PRODUCT_TOGGLE_RECORD_ERROR);
  }
  const expectedActive = Boolean(nextActive);
  const {data, error} = await managementAuthClient.from("products").update({
    active:expectedActive,
    updated_at:new Date().toISOString()
  }).eq("id", productId).select("id,active,updated_at");
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  if (rows.length !== 1) {
    await logProductToggleDiagnostic({
      productId,
      rowCount:rows.length,
      reason:rows.length === 0 ? "zero-row update" : "multiple-row update"
    });
    throw new Error(PRODUCT_TOGGLE_RECORD_ERROR);
  }
  const confirmedProduct = rows[0];
  if (String(confirmedProduct.id) !== productId || confirmedProduct.active !== expectedActive) {
    await logProductToggleDiagnostic({
      productId,
      rowCount:rows.length,
      reason:"returned row did not match the requested product status"
    });
    throw new Error("Supabase returned an unexpected product status. Please refresh and try again.");
  }
  return confirmedProduct;
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
  const product = normalizeProduct({
    id:data.id || `p${Date.now()}`,name:data.name,description:data.description,category:data.category,
    internalName:data.internalName,price:+data.price,inventory:+data.inventory,glCode:data.glCode,
    image:before?.image || "",active:form.elements.active.checked
  }, before);
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

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
}[character]));

function downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function orderLines(number) {
  return orders.filter(order => order.number.toUpperCase() === number.toUpperCase());
}

async function updateOrder(number, changes) {
  const before = orderLines(number).map(order => ({...order}));
  orderLines(number).forEach(order => Object.assign(order, changes));
  await saveOrderToSupabase(number, changes);
  persist();
  auditManagement("order_update", "order", number, before, orderLines(number));
}

function orderPaymentClass(status) {
  const value = String(status || "").toLowerCase();
  if (value === "paid") return "paid";
  if (value.includes("fail")) return "failed";
  if (value.includes("pending")) return "pending";
  return "";
}

function renderManagementOrderTable() {
  if (!$("#orderTable")) return;
  const matches = matchingOrders();
  $("#orderTable").innerHTML = matches.slice().reverse().map(order => {
    const subtotal = order.price * order.quantity;
    const fee = +order.processingFee || 0;
    const acceptance = order.legalAccepted
      ? `<strong>Yes</strong>${escapeHtml(order.legalAcceptedAt)}<br><small>Version ${escapeHtml(order.legalNoticeVersion || "Not recorded")}</small>`
      : `<span class="acceptance-missing">Not recorded</span>`;
    const payment = `<span class="payment-pill ${orderPaymentClass(order.paymentStatus)}">${escapeHtml(order.paymentStatus || "Not recorded")}</span>${order.squareTransactionId ? `<br><small>${escapeHtml(order.squareTransactionId)}</small>` : ""}`;
    return `<tr>
      <td>${escapeHtml(order.number)}</td>
      <td><strong>${escapeHtml(order.name)}</strong>Unit ${escapeHtml(order.unit)}</td>
      <td>${escapeHtml(order.product)}<br><small>${escapeHtml(order.internalName || `${order.product} GL-${order.glCode}`)}</small></td>
      <td>${order.quantity}</td>
      <td>${money(subtotal + fee)}</td>
      <td>${payment}</td>
      <td>${escapeHtml(order.glCode)}</td>
      <td>${formatDate(order.date)}</td>
      <td><select class="order-status-select" data-order-status="${escapeHtml(order.number)}">${ORDER_STATUSES.map(status => `<option ${status === order.status ? "selected" : ""}>${status}</option>`).join("")}</select></td>
      <td>${acceptance}</td>
      <td class="order-notes">
        <textarea data-public-note="${escapeHtml(order.number)}" placeholder="Public pickup note">${escapeHtml(order.publicNote)}</textarea>
        <textarea data-internal-note="${escapeHtml(order.number)}" placeholder="Internal management note">${escapeHtml(order.internalNote)}</textarea>
        <button class="table-action" data-save-order="${escapeHtml(order.number)}">Save notes</button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="11">No orders match this search.</td></tr>`;
  if ($("#orderSearchCount")) $("#orderSearchCount").textContent = `${matches.length} line item${matches.length === 1 ? "" : "s"} found`;

  $$('[data-order-status]').forEach(select => {
    select.onchange = async () => {
      try {
        await updateOrder(select.dataset.orderStatus, {status:select.value});
        toast(`Order status updated to ${select.value}`);
      } catch (error) {
        toast(error.message || "Unable to update order status");
      }
      renderManagementOrderTable();
    };
  });
  $$('[data-save-order]').forEach(button => {
    button.onclick = async () => {
      const number = button.dataset.saveOrder;
      const publicNote = $(`[data-public-note="${CSS.escape(number)}"]`).value.trim();
      const internalNote = $(`[data-internal-note="${CSS.escape(number)}"]`).value.trim();
      try {
        await updateOrder(number, {publicNote, internalNote});
        toast("Order notes saved");
      } catch (error) {
        toast(error.message || "Unable to save order notes");
      }
    };
  });
}

renderOrderTable = renderManagementOrderTable;

function normalizeFeedbackStatus(status) {
  return status === "Answered" ? "Completed" : status;
}

function feedbackStatusClass(status) {
  return `status-${status.toLowerCase().replaceAll(" ", "-")}`;
}

function matchingFeedback() {
  const query = ($("#feedbackSearch")?.value || "").trim().toLowerCase();
  const status = $("#feedbackStatusFilter")?.value || "All";
  const category = $("#feedbackCategoryFilter")?.value || "All";
  const date = $("#feedbackDateFilter")?.value || "";
  return feedbackRecords.filter(record => {
    const recordStatus = normalizeFeedbackStatus(record.status);
    const matchesQuery = !query || [record.name,record.unit,record.email,record.phone,record.message]
      .some(value => String(value || "").toLowerCase().includes(query));
    return matchesQuery
      && (status === "All" || recordStatus === status)
      && (category === "All" || record.category === category)
      && (!date || record.dateSubmitted.slice(0, 10) === date);
  });
}

function formatResidentDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    month:"2-digit",day:"2-digit",year:"numeric",hour:"numeric",minute:"2-digit"
  }).format(new Date(value));
}

function renderManagementFeedback() {
  const container = $("#feedbackAdminList");
  if (!container) return;
  const matches = matchingFeedback().sort((a, b) => b.dateSubmitted.localeCompare(a.dateSubmitted));
  container.innerHTML = matches.map(record => {
    const status = normalizeFeedbackStatus(record.status);
    return `<article class="feedback-record" data-feedback-record="${record.id}">
      <button class="feedback-record-toggle" type="button" data-feedback-toggle="${record.id}" aria-expanded="false">
        <span><small>Unit</small><strong>${escapeHtml(record.unit)}</strong></span>
        <span><small>Resident</small><strong>${escapeHtml(record.name)}</strong></span>
        <span><small>Type</small><strong>${escapeHtml(record.category)}</strong></span>
        <span><small>Status</small><b class="status-pill feedback-status ${feedbackStatusClass(status)}">${escapeHtml(status)}</b></span>
        <span><small>Submitted</small><strong>${formatResidentDateTime(record.dateSubmitted)}</strong></span>
      </button>
      <div class="feedback-record-body">
        <div class="feedback-record-detail">
          <p><strong>Message</strong>${escapeHtml(record.message)}</p>
          <p><strong>Email</strong>${record.email ? escapeHtml(record.email) : "Not provided"}</p>
          <p><strong>Phone</strong>${record.phone ? escapeHtml(record.phone) : "Not provided"}</p>
        </div>
        <div class="feedback-record-grid">
          <label><span>Status</span><select data-feedback-status="${record.id}">${FEEDBACK_STATUSES.map(option => `<option ${option === status ? "selected" : ""}>${option}</option>`).join("")}</select></label>
          <label><span>Management response</span><textarea data-feedback-response="${record.id}">${escapeHtml(record.managementResponse)}</textarea></label>
          <label><span>Internal notes</span><textarea data-feedback-notes="${record.id}">${escapeHtml(record.internalNotes)}</textarea></label>
        </div>
        <div class="feedback-record-actions"><button class="table-action" data-delete-feedback="${record.id}">Delete</button><button class="primary-button" data-save-feedback="${record.id}">Save feedback record</button></div>
      </div>
    </article>`;
  }).join("") || `<div class="admin-panel">No feedback matches the current filters.</div>`;

  $$('[data-feedback-toggle]').forEach(button => {
    button.onclick = () => {
      const record = button.closest(".feedback-record");
      const expanded = record.classList.toggle("expanded");
      button.setAttribute("aria-expanded", String(expanded));
    };
  });
  $$('[data-save-feedback]').forEach(button => {
    button.onclick = async () => {
      const record = feedbackRecords.find(item => item.id === button.dataset.saveFeedback);
      const before = {...record};
      const status = $(`[data-feedback-status="${record.id}"]`).value;
      const changes = {
        status,
        managementResponse:$(`[data-feedback-response="${record.id}"]`).value.trim(),
        internalNotes:$(`[data-feedback-notes="${record.id}"]`).value.trim(),
        dateResponded:status === "Completed" && $(`[data-feedback-response="${record.id}"]`).value.trim()
          ? new Date().toISOString()
          : record.dateResponded
      };
      try {
        await saveFeedbackToSupabase(record.id, changes);
        Object.assign(record, changes);
        renderManagementFeedback();
        renderFeedbackMetric();
        toast("Feedback record saved");
        auditManagement("feedback_response_update", "feedback", record.id, before, record);
      } catch (error) {
        toast(error.message || "Unable to save feedback record");
      }
    };
  });
  $$('[data-delete-feedback]').forEach(button => {
    button.onclick = async () => {
      if (!confirm("Delete this feedback record?")) return;
      const deleted = feedbackRecords.find(record => record.id === button.dataset.deleteFeedback);
      try {
        await deleteFeedbackFromSupabase(button.dataset.deleteFeedback);
        feedbackRecords = feedbackRecords.filter(record => record.id !== button.dataset.deleteFeedback);
        renderManagementFeedback();
        renderFeedbackMetric();
        toast("Feedback record deleted");
        auditManagement("feedback_delete", "feedback", button.dataset.deleteFeedback, deleted, null);
      } catch (error) {
        toast(error.message || "Unable to delete feedback record");
      }
    };
  });
}

function renderFeedbackMetric() {
  const grid = $("#adminOverview .metric-grid");
  if (!grid) return;
  $("#feedbackMetric")?.remove();
  const newFeedback = feedbackRecords.filter(record => ["New", "In Review"].includes(normalizeFeedbackStatus(record.status))).length;
  grid.insertAdjacentHTML("beforeend", `<button class="metric metric-button" id="feedbackMetric"><span>New feedback</span><strong>${newFeedback}</strong><small>Review messages</small></button>`);
  $("#feedbackMetric").onclick = () => showAdminView("feedback");
}

const renderAdminBase = renderAdmin;
renderAdmin = function renderCompleteManagementDashboard() {
  if (!window.managementAccessGranted) return;
  renderAdminBase();
  renderManagementOrderTable();
  renderManagementFeedback();
  renderFeedbackMetric();
};

["feedbackSearch","feedbackStatusFilter","feedbackCategoryFilter","feedbackDateFilter"].forEach(id => {
  if ($(`#${id}`)) $(`#${id}`).addEventListener(id === "feedbackSearch" ? "input" : "change", renderManagementFeedback);
});

if ($("#exportFeedback")) $("#exportFeedback").onclick = () => {
  downloadCsv(`BrickellHouse-Feedback-${fileDate()}.csv`, [
    ["Feedback ID","Resident Name","Unit","Email","Phone","Category","Message","Date Submitted","Status","Management Response","Date Responded","Internal Notes"],
    ...feedbackRecords.map(record => [
      record.id,record.name,record.unit,record.email,record.phone,record.category,record.message,
      formatResidentDateTime(record.dateSubmitted),record.status,record.managementResponse,
      formatResidentDateTime(record.dateResponded),record.internalNotes
    ])
  ]);
  toast("Feedback report exported");
  auditManagement("export_feedback", "export", "feedback", null, {rows:feedbackRecords.length});
};

if ($("#exportOrders")) $("#exportOrders").onclick = () => {
  downloadCsv(`BrickellHouse-Orders-${fileDate()}.csv`, [
    ["Order Number","Resident Name","Unit Number","Product","Internal / Stripe Name","Quantity","Unit Price","Subtotal","Processing Fee","Fee GL Code","Total","Hidden Product GL Code","Date","Order Status","Public Note","Internal Note","Payment Status","Payment Transaction ID","Payment Date/Time","Legal Notice Accepted","Acceptance Date/Time","Legal Notice Version","Terms Version","Privacy Policy Version"],
    ...orders.map(order => {
      const subtotal = order.price * order.quantity;
      const fee = +order.processingFee || 0;
      return [
        order.number,order.name,order.unit,order.product,order.internalName || `${order.product} GL-${order.glCode}`,
        order.quantity,order.price,subtotal,fee,order.feeGlCode || "",subtotal + fee,order.glCode,
        formatDate(order.date),order.status,order.publicNote,order.internalNote,order.paymentStatus,
        order.squareTransactionId,order.paymentDateTime || "",order.legalAccepted ? "Yes" : "Not recorded",
        order.legalAcceptedAt || "",order.legalNoticeVersion || "",order.termsVersion || "",order.privacyPolicyVersion || ""
      ];
    })
  ]);
  toast("Excel-compatible report exported");
  auditManagement("export_orders", "export", "orders", null, {rows:orders.length});
};
