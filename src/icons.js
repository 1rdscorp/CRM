'use strict';

// Small inline line icons (24x24 grid) so the app needs no icon font or CDN.
const PATHS = {
  dashboard:
    '<rect x="3" y="3" width="8" height="10" rx="1.5"/><rect x="13" y="3" width="8" height="6" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/><rect x="3" y="15" width="8" height="6" rx="1.5"/>',
  jobs: '<path d="M14.5 6.5a4 4 0 0 0 5 5L11 20a2.1 2.1 0 0 1-3-3l8.5-8.5"/><path d="M14.5 6.5 17 4a4 4 0 0 0-5.2 5.2"/>',
  customers:
    '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3-5.5 6.500-5.500s6 2 6.500 5.500"/><path d="M16 4.800a3.500 3.500 0 0 1 0 6.400"/><path d="M18.500 14.800c1.700.800 2.700 2.500 3 5.200"/>',
  invoices:
    '<path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14.500 3v4.500H19"/><path d="M8.500 12.500h7M8.500 16.500h7"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 2.500v3M12 18.500v3M2.500 12h3M18.500 12h3M5.300 5.300l2.100 2.100M16.600 16.600l2.100 2.100M5.300 18.700l2.100-2.100M16.600 7.400l2.100-2.100"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.500"/><path d="m16 16 4.500 4.500"/>',
  print:
    '<path d="M7 8V3.500h10V8"/><rect x="3" y="8" width="18" height="9" rx="1.500"/><path d="M7 14h10v6.500H7z"/>',
  download: '<path d="M12 3.500v11"/><path d="m7.500 10.500 4.500 4.500 4.500-4.500"/><path d="M4 20h16"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.500 7 8.500 6.500L20.500 7"/>',
  check: '<path d="m4.500 12.500 5 5L19.500 7"/>',
  trash:
    '<path d="M4 6.500h16"/><path d="M9 6.500V4h6v2.500"/><path d="M6.500 6.500 7.500 20h9l1-13.500"/><path d="M10 10.500v6M14 10.500v6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.500 6.500 4 4"/>',
  phone:
    '<path d="M5 3.500h3.500l1.500 4.500-2 1.500a12 12 0 0 0 6.500 6.500l1.500-2 4.500 1.500V19a1.500 1.500 0 0 1-1.500 1.500C10.500 20.500 3.500 13.500 3.500 5A1.500 1.500 0 0 1 5 3.500z"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  board:
    '<rect x="3.500" y="4" width="4.500" height="16" rx="1"/><rect x="9.750" y="4" width="4.500" height="11" rx="1"/><rect x="16" y="4" width="4.500" height="14" rx="1"/>',
  list: '<path d="M8.500 6.500h11M8.500 12h11M8.500 17.500h11"/><path d="M4.500 6.500h.01M4.500 12h.01M4.500 17.500h.01"/>',
  logout: '<path d="M10 4H5.500A1.500 1.500 0 0 0 4 5.500v13A1.500 1.500 0 0 0 5.500 20H10"/><path d="M9.500 12h11"/><path d="m16.500 8 4 4-4 4"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  alert: '<path d="M12 4 2.500 20h19z"/><path d="M12 10v4.500M12 17.500h.01"/>',
  cash: '<rect x="2.500" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.500"/><path d="M6 9.500v5M18 9.500v5"/>',
  back: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
};

/** Returns an inline SVG string. Use with <%- icon('name') %>. */
function icon(name, size = 18) {
  const body = PATHS[name];
  if (!body) return '';
  return (
    `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true">${body}</svg>`
  );
}

module.exports = icon;
