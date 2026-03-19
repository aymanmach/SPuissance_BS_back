function notFoundHandler(req, res) {
  res.status(404).json({ message: "Route introuvable" });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const status = error.status || 500;
  const message = error.message || "Erreur interne du serveur";

  res.status(status).json({
    message,
    stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
