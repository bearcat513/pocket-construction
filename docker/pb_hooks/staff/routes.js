/// <reference path="../../pb_data/types.d.ts" />

/**
 * The staff list and the switch that changes it — see lib/staff.js. The Bun
 * server proxies both with the caller's own credential.
 */
module.exports.register = () => {
  routerAdd("GET", "/api/build/staff", e => require(`${__hooks}/lib/staff.js`).list(e), $apis.requireAuth("users"));
  routerAdd("POST", "/api/build/staff/{id}", e => require(`${__hooks}/lib/staff.js`).set(e), $apis.requireAuth("users"));
};
