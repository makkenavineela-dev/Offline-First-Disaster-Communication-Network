const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || err.status || (res.statusCode !== 200 ? res.statusCode : 500);
  const isProd = process.env.NODE_ENV === 'production';

  res.status(statusCode).json({
    // Hide internal error details on 500s in production
    message: (isProd && statusCode >= 500) ? 'Internal server error' : err.message,
    stack: isProd ? null : err.stack,
  });
};

module.exports = { errorHandler };
