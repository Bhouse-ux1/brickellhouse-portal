document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector(".mobile-menu-toggle");
  const header = toggle?.closest(".site-header");
  const menu = document.getElementById(toggle?.getAttribute("aria-controls"));
  if (!toggle || !header || !menu) return;

  const setOpen = open => {
    header.classList.toggle("mobile-menu-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };

  toggle.addEventListener("click", () => {
    setOpen(!header.classList.contains("mobile-menu-open"));
  });

  menu.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => setOpen(false));
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && header.classList.contains("mobile-menu-open")) {
      setOpen(false);
      toggle.focus();
    }
  });
});
