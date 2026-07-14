document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector(".mobile-menu-toggle");
  const header = toggle?.closest(".site-header");
  const menu = document.getElementById(toggle?.getAttribute("aria-controls"));
  if (!toggle || !header || !menu) return;

  const setOpen = open => {
    header.classList.toggle("mobile-menu-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    const key = open ? "nav.closeMenu" : "nav.openMenu";
    toggle.setAttribute("aria-label", window.BH_I18N?.t(key) || (open ? "Close menu" : "Open menu"));
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
