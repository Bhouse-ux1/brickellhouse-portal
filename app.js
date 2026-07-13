const CATALOG_VERSION = "resident-services-2026-06-12-v2";
const LEGAL_NOTICE_VERSION = window.BH_LEGAL_NOTICE.version;
const CATEGORIES = ["Keys & Access", "Maintenance Services", "HVAC Services", "Subscriptions & Plans"];
const PRODUCT_IMAGE_VERSION = "20260624-product-images1";

const seedProducts = [
  {id:"svc1",name:"Mailbox Key Copy",category:"Keys & Access",description:"Replacement key for your assigned mailbox.",price:1,inventory:99,image:"offer-mailbox-key.webp",active:true},
  {id:"svc2",name:"Unit Key Copy",category:"Keys & Access",description:"Replacement of your unit door key.",price:30,inventory:99,image:"offer-unit-key.webp",active:true},
  {id:"svc3",name:"Smoke Detector Battery Replacement",category:"Maintenance Services",description:"Includes battery and labor.",price:25,inventory:99,image:"offer-smoke-battery.webp",active:true},
  {id:"svc4",name:"AC Filter Replacement",category:"HVAC Services",description:"Includes filter and labor.",price:55,inventory:99,image:"offer-filter-replacement.webp",active:true},
  {id:"svc5",name:"Trash Compactor Replacement",category:"Maintenance Services",description:"Includes parts and labor.",price:200,inventory:99,image:"offer-trash-compactor.webp",active:true},
  {id:"svc6",name:"Toilet or Sink Unclogged Service",category:"Maintenance Services",description:"Includes unclogging and labor for each individual sink or toilet.",price:30,inventory:99,image:"offer-unclog-service.webp",active:true},
  {id:"svc7",name:"Lockout Assistance",category:"Keys & Access",description:"Includes access and labor.",price:50,inventory:99,image:"offer-lockout.webp",active:true},
  {id:"svc8",name:"Faucet Repair",category:"Maintenance Services",description:"Includes parts and labor.",price:125,inventory:99,image:"offer-faucet-repair.webp",active:true},
  {id:"svc9",name:"Thermostat Reset or System Check",category:"HVAC Services",description:"Includes minor adjustments and labor.",price:40,inventory:99,image:"offer-thermostat-check.webp",active:true},
  {id:"svc10",name:"Portable AC Unit Rental",category:"HVAC Services",description:"$25.00 per day; requires a $300 refundable security deposit payable in advance.",price:300,inventory:10,image:"offer-portable-ac.webp",active:true},
  {id:"svc11",name:"Thermostat Replacement",category:"HVAC Services",description:"Thermostat replacement provided at no charge.",price:0,inventory:99,image:"offer-thermostat-replacement.webp",active:true},
  {id:"svc12",name:"Annual AC Filter Subscription",category:"Subscriptions & Plans",description:"Includes 12 scheduled AC filter replacements per year, one per month.",price:360,inventory:99,image:"offer-annual-filter.webp",active:true},
  {id:"svc13",name:"Valet Service Subscription",category:"Subscriptions & Plans",description:"Includes unlimited valet parking for one month for each registered vehicle per unit.",price:250,inventory:99,image:"offer-valet-subscription.webp",active:true},
  {id:"svc14",name:"AC Drain Line Cleaning",category:"HVAC Services",description:"Includes cleaning and flushing the AC drain line to prevent overflow.",price:45,inventory:99,image:"offer-drain-cleaning.webp",active:true},
  {id:"svc15",name:"Premium Resident Care Plan",category:"Subscriptions & Plans",description:"Billed annually. Covers basic in-unit maintenance labor, including light bulbs, AC maintenance, filters, thermostat checks, unclogging, minor touch-ups, and general inspections.",price:960,inventory:99,image:"offer-resident-care.webp",active:true}
];

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const money = value => new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(value);
const todayISO = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const acceptanceDateTime = () => new Intl.DateTimeFormat("en-US", {
  month:"2-digit",day:"2-digit",year:"numeric",hour:"numeric",minute:"2-digit"
}).format(new Date());

function publicProduct(product = {}) {
  return {
    id:String(product.id || ""),
    name:String(product.name || ""),
    category:String(product.category || "Maintenance Services"),
    description:String(product.description || ""),
    price:Number(product.price || 0),
    inventory:Number(product.inventory || 0),
    image:String(product.image || ""),
    active:Boolean(product.active)
  };
}

function publicFeeSettings(value = {}) {
  return {
    enabled:value.enabled !== false,
    type:value.type === "fixed" ? "fixed" : "percent",
    amount:Number.isFinite(Number(value.amount)) ? Number(value.amount) : 3,
    label:String(value.label || "Processing fee")
  };
}

const catalogIsCurrent = localStorage.getItem("bh_catalog_version") === CATALOG_VERSION;
const storedProducts = catalogIsCurrent ? JSON.parse(localStorage.getItem("bh_products") || "null") : null;
let products = (Array.isArray(storedProducts) ? storedProducts : seedProducts).map(publicProduct);
let cart = catalogIsCurrent ? JSON.parse(localStorage.getItem("bh_cart") || "[]") : [];
let feeSettings = publicFeeSettings(JSON.parse(localStorage.getItem("bh_fee_settings") || "null") || {});
let activeCategory = "All";
window.BH_CATALOG_STATE = {complete:false, success:false};

function productImageSrc(image) {
  const source = image || "product-documents.webp";
  if (/^(https?:|data:|blob:)/i.test(source) || source.includes("?")) return source;
  return `${source}?v=${PRODUCT_IMAGE_VERSION}`;
}

function persist() {
  localStorage.setItem("bh_products", JSON.stringify(products.map(publicProduct)));
  localStorage.removeItem("bh_orders");
  localStorage.setItem("bh_cart", JSON.stringify(cart));
  localStorage.setItem("bh_fee_settings", JSON.stringify(publicFeeSettings(feeSettings)));
  localStorage.setItem("bh_catalog_version", CATALOG_VERSION);
}

function reconcileCartWithCatalog() {
  cart = cart.map(item => {
    const product = products.find(candidate => candidate.id === item.id && candidate.active);
    if (!product) return null;
    const quantity = Math.min(Number(item.quantity || 0), Number(product.inventory || 0));
    return quantity > 0 ? {id:item.id, quantity} : null;
  }).filter(Boolean);
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

function generateOrderNumber() {
  const date = new Date();
  const prefix = `BH-${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}${date.getFullYear()}-`;
  const random = crypto.getRandomValues(new Uint32Array(2));
  const suffix = [...random].map(value => value.toString(36).padStart(7, "0")).join("").slice(0, 10).toUpperCase();
  return prefix + suffix;
}

function renderTabs() {
  const tabs = $("#categoryTabs");
  if (!tabs) return;
  tabs.innerHTML = ["All", ...CATEGORIES].map(category =>
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
  const grid = $("#productGrid");
  const search = $("#searchInput");
  if (!grid || !search) return;
  const query = search.value.trim().toLowerCase();
  const filtered = products.filter(product =>
    product.active
    && (activeCategory === "All" || product.category === activeCategory)
    && `${product.name} ${product.description}`.toLowerCase().includes(query)
  );
  grid.innerHTML = filtered.map((product, index) =>
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
  $("#emptyState")?.classList.toggle("hidden", filtered.length > 0);
  $$('[data-add]').forEach(button => button.onclick = () => addToCart(button.dataset.add));
}

async function loadPublicProductCatalog() {
  let loaded = false;
  try {
    const response = await fetch("/api/products", {headers:{"Accept":"application/json"}});
    const payload = await response.json();
    if (!response.ok || !payload.success || !Array.isArray(payload.products)) throw new Error("Product catalog is unavailable");
    const existingById = new Map(products.map(product => [product.id, product]));
    const fallbackById = new Map(seedProducts.map(product => [product.id, product]));
    products = payload.products.map(product => {
      const existing = existingById.get(product.id) || {};
      const fallback = fallbackById.get(product.id) || {};
      return publicProduct({
        ...product,
        image:product.image || existing.image || fallback.image || ""
      });
    });
    reconcileCartWithCatalog();
    persist();
    renderTabs();
    renderProducts();
    renderCart();
    loaded = true;
  } catch (error) {
    console.warn("Using local product catalog fallback", error);
  } finally {
    window.BH_CATALOG_STATE = {complete:true, success:loaded};
    document.dispatchEvent(new CustomEvent("bh:catalog-ready", {detail:{success:loaded}}));
  }
}

function addToCart(id) {
  const item = cart.find(candidate => candidate.id === id);
  const product = products.find(candidate => candidate.id === id);
  if (!product) return;
  if (item) {
    if (item.quantity < product.inventory) item.quantity++;
  } else {
    cart.push({id, quantity:1});
  }
  persist();
  renderCart();
  toast(`${product.name} added to your bag`);
}

function updateCartSummary(items = cart.map(item => ({...item, product:products.find(product => product.id === item.id)})).filter(item => item.product), {toggleEmptyState = true} = {}) {
  if (!$("#cartCount")) return;
  $("#cartCount").textContent = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartSubtotal();
  const fee = processingFee(subtotal);
  $("#cartTotal").textContent = money(subtotal);
  if ($("#checkoutSubtotal")) $("#checkoutSubtotal").textContent = money(subtotal);
  if ($("#checkoutFee")) $("#checkoutFee").textContent = money(fee);
  if ($("#checkoutTotal")) $("#checkoutTotal").textContent = money(subtotal + fee);
  if ($("#checkoutAmountDue")) $("#checkoutAmountDue").textContent = money(subtotal + fee);
  if ($("#checkoutFeeLabel")) {
    $("#checkoutFeeLabel").textContent = feeSettings.enabled && feeSettings.type === "percent"
      ? `${feeSettings.label} (${feeSettings.amount}%)`
      : feeSettings.label;
  }
  if (toggleEmptyState) {
    $("#cartEmpty").classList.toggle("hidden", items.length > 0);
    $("#cartFooter").classList.toggle("hidden", !items.length);
  }
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
  document.dispatchEvent(new CustomEvent("bh:cart-updated", {detail:{count:items.length}}));
}

function bindCartControls() {
  $$('[data-qty]').forEach(button => button.onclick = () => changeQty(button.dataset.qty, +button.dataset.delta));
  $$('[data-remove]').forEach(button => button.onclick = () => {
    const row = button.closest(".cart-item");
    cart = cart.filter(item => item.id !== button.dataset.remove);
    persist();
    updateCartSummary(undefined, {toggleEmptyState:false});
    if (!row) return renderCart();
    row.classList.add("removing");
    const finish = () => renderCart();
    row.addEventListener("transitionend", finish, {once:true});
    setTimeout(() => row.isConnected && finish(), 280);
  });
}

function changeQty(id, delta) {
  const item = cart.find(candidate => candidate.id === id);
  const product = products.find(candidate => candidate.id === id);
  if (!item || !product) return;
  item.quantity = Math.max(0, Math.min(product.inventory, item.quantity + delta));
  if (!item.quantity) cart = cart.filter(candidate => candidate.id !== id);
  persist();
  renderCart();
}

function renderLegalNotice() {
  if (!$("#legalVersion") || !$("#legalDocument")) return;
  $("#legalVersion").textContent = `Document version ${LEGAL_NOTICE_VERSION}`;
  $("#legalDocument").innerHTML = window.BH_LEGAL_NOTICE.sections.map((section, index) =>
    `<section><${index ? "h3" : "h2"}>${section.title}</${index ? "h3" : "h2"}><p>${section.body}</p></section>`
  ).join("");
}

function setDrawer(open) {
  $("#cartDrawer")?.classList.toggle("open", open);
  $("#drawerBackdrop")?.classList.toggle("open", open);
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

if ($("#cartOpen")) $("#cartOpen").onclick = () => setDrawer(true);
if ($("#drawerBackdrop")) $("#drawerBackdrop").onclick = () => setDrawer(false);
if ($('[data-close="cart"]')) $('[data-close="cart"]').onclick = () => setDrawer(false);
if ($("#checkoutOpen")) $("#checkoutOpen").onclick = () => {
  setDrawer(false);
  window.location.href = "checkout.html";
};
if ($("#searchInput")) $("#searchInput").oninput = renderProducts;
if ($("#legalNoticeOpen")) $("#legalNoticeOpen").onclick = () => openModal("#legalModal");
if ($("#legalAcceptance")) $("#legalAcceptance").onchange = event => {
  if (window.syncCheckoutSubmitState) window.syncCheckoutSubmitState();
  else $("#checkoutSubmit").disabled = !event.target.checked;
};

$$('[data-close]').forEach(button => button.addEventListener("click", () => {
  if (button.dataset.close === "checkout") closeModal("#checkoutModal");
  if (button.dataset.close === "success") closeModal("#successModal");
  if (button.dataset.close === "legal") closeModal("#legalModal");
}));

function updateParallax() {}

if (!document.body.classList.contains("checkout-page")) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => entry.isIntersecting && entry.target.classList.add("visible")), {threshold:.12});
  $$('.reveal').forEach(element => observer.observe(element));

  let parallaxFrame = 0;
  updateParallax = () => {
    parallaxFrame = 0;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const viewportCenter = window.innerHeight / 2;
    $$('.parallax-image').forEach(image => {
      const rect = image.parentElement.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      const distance = rect.top + rect.height / 2 - viewportCenter;
      image.style.transform = `translate3d(0, ${distance * +image.dataset.parallax}px, 0) scale(1.04)`;
    });
    const heroImage = $(".hero-image");
    if (heroImage && window.scrollY < window.innerHeight * 1.2) {
      heroImage.style.transform = `translate3d(0, ${window.scrollY * .12}px, 0) scale(1.04)`;
    }
  };

  window.addEventListener("scroll", () => {
    if (!parallaxFrame) parallaxFrame = requestAnimationFrame(updateParallax);
  }, {passive:true});
  window.addEventListener("resize", updateParallax);
}

reconcileCartWithCatalog();
persist();
renderTabs();
renderProducts();
renderCart();
renderLegalNotice();
updateParallax();
loadPublicProductCatalog();
