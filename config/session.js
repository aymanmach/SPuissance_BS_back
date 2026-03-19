const session = require("express-session");

function buildSessionMiddleware() {
  const inProd = process.env.NODE_ENV === "production";

  return session({
    name: process.env.SESSION_COOKIE_NAME || "spuissance.sid",
    secret: process.env.SESSION_SECRET || "change-me",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: inProd,
      sameSite: inProd ? "strict" : "lax",
      maxAge: Number(process.env.SESSION_COOKIE_MAX_AGE || 1000 * 60 * 60 * 8),
    },
  });
}

function wrapExpressMiddleware(middleware) {
  return (socket, next) => middleware(socket.request, {}, next);
}

module.exports = {
  buildSessionMiddleware,
  wrapExpressMiddleware,
};
