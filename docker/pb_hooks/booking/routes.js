/// <reference path="../../pb_data/types.d.ts" />

/**
 * Appointment booking, under PocketBase's own router.
 *
 * No `requireAuth`: the people booking have no account. What a stranger can
 * learn or do here is exactly what lib/booking.js hands back — busy times
 * without names, and one new visit that cannot overlap another.
 */
module.exports.register = () => {
  routerAdd("GET", "/api/build/booking/busy", e => require(`${__hooks}/lib/booking.js`).busy(e));
  routerAdd("POST", "/api/build/booking", e => require(`${__hooks}/lib/booking.js`).book(e));
};
