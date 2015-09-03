'use strict';

/*
 * Request
 *
 * Copyright(c) 2014 Francois-Guillaume Ribreau <npm@fgribreau.com>
 * MIT Licensed
 *
 */
var request = require('request');
var _ = require('fg-lodash');
var RetryStrategies = require('./strategies');


var DEFAULTS = {
  maxAttempts: 5, // try 5 times
  retryDelay: 5000, // wait for 5s before trying again
};

function Request(options, f, maxAttempts, retryDelay) {
  this.maxAttempts = maxAttempts;
  this.retryDelay = retryDelay;

  /**
   * Option object
   * @type {Object}
   */
  this.options = options;

  /**
   * Return true if the request should be retried
   * @type {Function} (err, response) -> Boolean
   */
  this.retryStrategy = _.isFunction(options.retryStrategy) ? options.retryStrategy : RetryStrategies.HTTPOrNetworkError;

  this.f = _.once(f);
  this._timeout = null;
  this._req = null;
}

Request.request = request;

Request.prototype._tryUntilFail = function () {
  this.maxAttempts--;

  this._req = Request.request(this.options, function (err, response, body) {
    if (this.retryStrategy(err, response) && this.maxAttempts >= 0) {
      if (this.maxAttempts > 0) {
        Request.logger.log('[requestretry]', 'Retrying...', '(attempts remaining: ', this.maxAttempts, ', retryDelay: ', this.retryDelay, ')');
      } else if (this.maxAttempts == 0) {
        Request.logger.log('[requestretry]', 'Retrying... (last attempt!)');
      }
      this._timeout = setTimeout(this._tryUntilFail.bind(this), this.retryDelay);
      return;
    }
    if (this.retryStrategy(err, response)) {
      // still an error, but not retrying. Log that attempts have been exhausted
      Request.logger.log('[requestretry]', 'attempts exhausted. Return callback...');
    }

    return this.f(err, response, body);
  }.bind(this));
};

Request.prototype.abort = function () {
  if (this._req) {
    this._req.abort();
  }
  clearTimeout(this._timeout);
  this.f(new Error('Aborted'));
};

// expose request methods from RequestRetry
['end', 'on', 'emit', 'once', 'setMaxListeners', 'start', 'removeListener', 'pipe', 'write'].forEach(function (methodName) {
  Request.prototype[methodName] = makeGateway(methodName);
});

function makeGateway(methodName) {
  return function () {
    return this._req[methodName].apply(this._req, Array.prototype.slice.call(arguments));
  };
}

function Factory(options, f, logger) {
  Request.logger = _.isUndefined(logger) ? console : logger;
  f = _.isFunction(f) ? f : _.noop;
  var retry = _(options || {}).defaults(DEFAULTS).pick(Object.keys(DEFAULTS)).value();
  var req = new Request(options, f, retry.maxAttempts, retry.retryDelay);
  req._tryUntilFail();
  return req;
}

module.exports = Factory;

Factory.Request = Request;
Factory.RetryStrategies = RetryStrategies;
