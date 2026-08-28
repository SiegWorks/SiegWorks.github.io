// SiegWorks site maintenance switch
// false = normal operation / true = maintenance mode
const MAINTENANCE_MODE = false;

(() => {
  if (!MAINTENANCE_MODE) return;

  const maintenanceUrl = new URL("/maintenance.html", window.location.origin);
  if (window.location.pathname === maintenanceUrl.pathname) return;

  window.location.replace(maintenanceUrl.href);
})();
