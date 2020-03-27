const express = require('express');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const compression = require('compression');
const cors = require('cors');
const http = require('http');
const _ = require('lodash');

function createErrorResponder(_opts) {
    const opts = _.merge({
        isErrorSafeToRespond: status => status < 500,
    }, _opts);

    // 4 params needed for Express to know it's a error handler middleware
    // eslint-disable-next-line
    return function errorResponder(err, req, res, next) {
        let message;
        const status = err.status ? err.status : 500;

        const httpMessage = http.STATUS_CODES[status];
        if (opts.isErrorSafeToRespond(status)) {
        // eslint-disable-next-line
        message = err.message;
        } else {
        message = httpMessage;
        }

        const isPrettyValidationErr = _.has(err, 'errors');
        const body = isPrettyValidationErr
        ? JSON.stringify(err)
        : { status, statusText: httpMessage, messages: [message] };

        res.status(status);
        res.send(body);
    };
}

const errorResponder = createErrorResponder;

const SLICE_THRESHOLD = 1000;

function createErrorLogger(_opts) {
  const opts = _.merge({
    logRequest: status => status >= 400 && status !== 404 && status !== 503,
    logStackTrace: status => status >= 500 && status !== 503,
  }, _opts);

  return function errorHandler(err, req, res, next) {
    const status = err.status ? err.status : 500;
    const logLevel = getLogLevel(status);
    const log = logger[logLevel];

    if (opts.logRequest(status)) {
      logRequestDetails(logLevel, req, status);
    }

    if (opts.logStackTrace(status)) {
      log(err, err.stack);
    } else {
      log(err.toString());
    }

    next(err);
  };
}

function getLogLevel(status) {
  return status >= 500 ? 'error' : 'warn';
}

function logRequestDetails(logLevel, req) {
  logger[logLevel]('Request headers:', deepSupressLongStrings(req.headers));
  logger[logLevel]('Request parameters:', deepSupressLongStrings(req.params));
  logger[logLevel]('Request body:', req.body);
}

function deepSupressLongStrings(obj) {
  const newObj = {};
  _.each(obj, (val, key) => {
    if (_.isString(val) && val.length > SLICE_THRESHOLD) {
      newObj[key] = `${val.slice(0, SLICE_THRESHOLD)} ... [CONTENT SLICED]`;
    } else if (_.isPlainObject(val)) {
      deepSupressLongStrings(val);
    } else {
      newObj[key] = val;
    }
  });

  return newObj;
}

const errorLogger = createErrorLogger;

function RequireHttps(req, res, next) {
  if (req.secure) {
    // Allow requests only over https
    return next();
  }

  const err = new Error('Only HTTPS allowed.');
  err.status = 403;
  next(err);
};

const requireHttps = RequireHttps;

const createRouter = require('./router');
const config = require('./config');

function createApp() {
  const app = express();
  // App is served behind Heroku's router.
  // This is needed to be able to use req.ip or req.secure
  app.enable('trust proxy', 1);
  app.disable('x-powered-by');

  if (config.NODE_ENV !== 'production') {
    app.use(morgan('dev'));
  }

  // if (!config.ALLOW_HTTP) {
  //   logger.info('All requests require HTTPS.');
  //   app.use(requireHttps());
  // } else {
  //   logger.info('ALLOW_HTTP=true, unsafe requests are allowed. Don\'t use this in production.');
  // }

  const corsOpts = {
    origin: config.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH'],
  };
  
  app.use(cors(corsOpts));

  // Limit to 10mb if HTML has e.g. inline images
  app.use(bodyParser.text({ limit: '10mb', type: 'text/html' }));
  app.use(bodyParser.json({ limit: '10mb' }));

  app.use(compression({
    // Compress everything over 10 bytes
    threshold: 10,
  }));

  // Initialize routes
  const router = createRouter();
  app.use('/', router);

  app.use(errorLogger());
  app.use(errorResponder());

  return app;
}

var app = createApp();
