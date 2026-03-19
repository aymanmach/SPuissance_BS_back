const { ROLES } = require("../config/constants");

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ message: "Authentification requise" });
  }

  next();
}

function requireRole(acceptedRoles = []) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ message: "Authentification requise" });
    }

    if (!acceptedRoles.includes(req.session.user.role)) {
      return res.status(403).json({ message: "Acces refuse" });
    }

    next();
  };
}

function socketRequireAuth(socket, next) {
  const user = socket.request?.session?.user;
  if (!user) {
    return next(new Error("Session invalide"));
  }

  socket.user = user;
  return next();
}

function socketHasRole(socket, roles = []) {
  return Boolean(socket.user && roles.includes(socket.user.role));
}

module.exports = {
  requireAuth,
  requireRole,
  socketRequireAuth,
  socketHasRole,
  ROLES,
};
