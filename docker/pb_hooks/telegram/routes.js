/// <reference path="../../pb_data/types.d.ts" />

/**
 * Telegram notifications, under PocketBase's own router.
 *
 * Every route acts on the caller's own row and nothing else, so `requireAuth`
 * is the whole of the access check: there is no record id in any path to
 * name somebody else's. The Bun server proxies these with the caller's token.
 */
module.exports.register = () => {
  const base = "/api/build/telegram";
  const auth = () => $apis.requireAuth("users");

  routerAdd("GET", base, e => require(`${__hooks}/lib/telegram.js`).status(e), auth());
  routerAdd("PUT", base, e => require(`${__hooks}/lib/telegram.js`).saveSettings(e), auth());
  routerAdd("PUT", `${base}/bot`, e => require(`${__hooks}/lib/telegram.js`).setBot(e), auth());
  routerAdd("POST", `${base}/pair`, e => require(`${__hooks}/lib/telegram.js`).pair(e), auth());
  routerAdd("POST", `${base}/pair/check`, e => require(`${__hooks}/lib/telegram.js`).checkPair(e), auth());
  routerAdd("DELETE", `${base}/chat`, e => require(`${__hooks}/lib/telegram.js`).unlink(e), auth());
  routerAdd("POST", `${base}/test`, e => require(`${__hooks}/lib/telegram.js`).test(e), auth());
  routerAdd("POST", `${base}/send`, e => require(`${__hooks}/lib/telegram.js`).send(e), auth());
};
