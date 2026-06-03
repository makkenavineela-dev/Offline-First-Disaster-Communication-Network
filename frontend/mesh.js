/**
 * mesh.js — REMOVED (Socket.io WiFi mesh replaced by Bluetooth mesh)
 *
 * This stub exists only to prevent 404 errors on any cached page that still
 * references it. All messaging now goes through RESQ_BTMesh (bluetooth-mesh.js).
 */
(function () {
  // If bluetooth-mesh.js already loaded, RESQ_Mesh alias is already set there.
  // Nothing else to do.
  if (!window.RESQ_Mesh && window.RESQ_BTMesh) {
    window.RESQ_Mesh = window.RESQ_BTMesh;
  }
})();
