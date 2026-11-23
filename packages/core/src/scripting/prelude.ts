/**
 * The `pm` subset inside the sandbox (docs/compatibility.md, PIGN-043): plain JavaScript evaluated
 * before the user's script. It works on `__state` (JSON from the host) and collects `console`
 * output in `__logs`; the host reads both back as JSON. Calls Pigeon doesn't support throw
 * `NotSupportedInPigeon: <name>`.
 */
export const PRELUDE = String.raw`
"use strict";
var __logs = [];
(function () {
  var state = __state;
  var vars = state.variables;
  function str(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') { try { return JSON.stringify(value); } catch (e) { return String(value); } }
    return String(value);
  }
  function notSupported(name) {
    return function () { throw new Error('NotSupportedInPigeon: ' + name); };
  }
  function has(map, key) { return map !== null && Object.prototype.hasOwnProperty.call(map, key); }
  function scope(name, writable) {
    function map() { return vars[name]; }
    var api = {
      get: function (key) { var m = map(); return has(m, key) ? m[key] : undefined; },
      has: function (key) { return has(map(), key); },
      toObject: function () { return Object.assign({}, map() || {}); },
      set: function (key, value) {
        if (!writable) throw new Error('NotSupportedInPigeon: ' + name + '.set');
        if (map() === null) throw new Error('No environment is selected: pm.environment.set("' + key + '") has nowhere to go');
        var text = str(value);
        map()[key] = text;
        state.writes.push({ scope: name, key: String(key), value: text });
      },
      unset: function (key) {
        if (!writable) throw new Error('NotSupportedInPigeon: ' + name + '.unset');
        if (map() === null) return;
        delete map()[key];
        state.writes.push({ scope: name, key: String(key), value: null });
      },
      clear: notSupported('pm.' + name + '.clear'),
      replaceIn: function (template) { return pm.variables.replaceIn(template); }
    };
    return api;
  }
  function lookup(key) {
    var order = [vars.local, vars.environment, vars.folders, vars.collection, vars.globals];
    for (var i = 0; i < order.length; i++) if (has(order[i], key)) return order[i][key];
    return undefined;
  }
  var request = state.request;
  function headerIndex(name) {
    var lower = String(name).toLowerCase();
    for (var i = 0; i < request.headers.length; i++) {
      if (request.headers[i].key.toLowerCase() === lower) return i;
    }
    return -1;
  }
  function headerArg(header, value) {
    if (typeof header === 'string') {
      var at = header.indexOf(':');
      return value === undefined && at > 0
        ? { key: header.slice(0, at).trim(), value: header.slice(at + 1).trim() }
        : { key: header, value: str(value) };
    }
    return { key: String(header.key), value: str(header.value), disabled: header.disabled === true };
  }
  var headers = {
    get: function (name) { var i = headerIndex(name); return i === -1 ? undefined : request.headers[i].value; },
    has: function (name) { return headerIndex(name) !== -1; },
    add: function (header, value) { request.headers.push(headerArg(header, value)); },
    upsert: function (header, value) {
      var h = headerArg(header, value); var i = headerIndex(h.key);
      if (i === -1) request.headers.push(h); else request.headers[i] = h;
    },
    remove: function (name) {
      var lower = String(name).toLowerCase();
      request.headers = request.headers.filter(function (h) { return h.key.toLowerCase() !== lower; });
    },
    toObject: function () {
      var out = {};
      request.headers.forEach(function (h) { if (!h.disabled) out[h.key] = h.value; });
      return out;
    },
    each: function (fn) { request.headers.forEach(function (h) { fn({ key: h.key, value: h.value }); }); },
    count: function () { return request.headers.length; }
  };
  var url = {
    toString: function () { return request.url; },
    update: function (value) { request.url = str(value); },
    getHost: function () { var m = /^[a-z]+:\/\/([^/:?#]+)/i.exec(request.url); return m ? m[1] : ''; },
    getPath: function () { var m = /^[a-z]+:\/\/[^/?#]*([^?#]*)/i.exec(request.url); return m ? (m[1] || '/') : ''; }
  };
  var body = {
    get mode() { return request.body.mode; },
    get raw() { return request.body.raw; },
    set raw(value) {
      if (request.body.mode !== 'raw') throw new Error('NotSupportedInPigeon: changing a ' + request.body.mode + ' body');
      request.body.raw = str(value);
    },
    update: function (value) {
      if (typeof value === 'string') { body.raw = value; return; }
      if (value && value.mode === 'raw') { request.body.mode = 'raw'; request.body.raw = str(value.raw); return; }
      throw new Error('NotSupportedInPigeon: pm.request.body.update for ' + (value && value.mode));
    },
    toString: function () { return request.body.raw || ''; }
  };
  var pmRequest = {
    get method() { return request.method; },
    set method(value) { request.method = String(value).toUpperCase(); },
    get url() { return url; },
    set url(value) { request.url = str(value); },
    headers: headers,
    get body() { return body; },
    addHeader: function (header) { headers.add(header); },
    removeHeader: function (name) { headers.remove(name); }
  };
  var variables = {
    get: function (key) { return lookup(key); },
    has: function (key) { return lookup(key) !== undefined; },
    set: function (key, value) { vars.local[key] = str(value); },
    unset: function (key) { delete vars.local[key]; },
    toObject: function () {
      return Object.assign({}, vars.globals, vars.collection, vars.folders, vars.environment || {}, vars.local);
    },
    replaceIn: function (template) {
      return String(template).replace(/\{\{([^{}]+)\}\}/g, function (all, name) {
        var value = lookup(name.trim()); return value === undefined ? all : value;
      });
    }
  };
  var pm = {
    environment: scope('environment', true),
    collectionVariables: scope('collection', true),
    globals: scope('globals', true),
    variables: variables,
    request: pmRequest,
    info: { requestName: state.info.requestName, requestId: state.info.requestId, eventName: state.info.eventName, iteration: 0, iterationCount: 1 },
    sendRequest: notSupported('pm.sendRequest'),
    cookies: { get: notSupported('pm.cookies'), has: notSupported('pm.cookies'), jar: notSupported('pm.cookies.jar') },
    vault: { get: notSupported('pm.vault') },
    test: state.info.eventName === 'test' ? test : notSupported('pm.test in a pre-request script'),
    expect: expect,
    response: state.response ? response(state.response) : undefined,
    execution: { skipRequest: notSupported('pm.execution.skipRequest'), setNextRequest: notSupported('pm.execution.setNextRequest') }
  };
  // --- Tests (PIGN-044): pm.test, a chai-style pm.expect subset, pm.response -----------------
  function AssertionError(message) { this.name = 'AssertionError'; this.message = message; }
  AssertionError.prototype = Object.create(Error.prototype);
  AssertionError.prototype.constructor = AssertionError;
  function show(value) {
    if (typeof value === 'string') return "'" + value + "'";
    if (value === undefined) return 'undefined';
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
    try { var json = JSON.stringify(value); return json.length > 200 ? json.slice(0, 197) + '...' : json; } catch (e) { return String(value); }
  }
  function typeOf(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (value instanceof RegExp) return 'regexp';
    if (value instanceof Date) return 'date';
    return typeof value;
  }
  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a === 'number' && typeof b === 'number' && isNaN(a) && isNaN(b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(b, ka[i]) || !deepEqual(a[ka[i]], b[ka[i]])) return false;
    }
    return true;
  }
  function Assertion(value, message) {
    this._value = value;
    this._not = false;
    this._deep = false;
    this._message = message;
  }
  Assertion.prototype._assert = function (ok, positive, negative) {
    if (this._not ? ok : !ok) {
      var text = this._not ? negative : positive;
      throw new AssertionError((this._message ? this._message + ': ' : '') + text);
    }
    return this;
  };
  ['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'but', 'does', 'still', 'also'].forEach(function (word) {
    Object.defineProperty(Assertion.prototype, word, { get: function () { return this; } });
  });
  Object.defineProperty(Assertion.prototype, 'not', { get: function () { this._not = !this._not; return this; } });
  Object.defineProperty(Assertion.prototype, 'deep', { get: function () { this._deep = true; return this; } });
  function flag(name, check, words) {
    Object.defineProperty(Assertion.prototype, name, {
      get: function () {
        return this._assert(check(this._value), 'expected ' + show(this._value) + ' to ' + words, 'expected ' + show(this._value) + ' not to ' + words);
      }
    });
  }
  flag('true', function (v) { return v === true; }, 'be true');
  flag('false', function (v) { return v === false; }, 'be false');
  flag('null', function (v) { return v === null; }, 'be null');
  flag('undefined', function (v) { return v === undefined; }, 'be undefined');
  flag('NaN', function (v) { return typeof v === 'number' && isNaN(v); }, 'be NaN');
  flag('ok', function (v) { return !!v; }, 'be truthy');
  flag('exist', function (v) { return v !== null && v !== undefined; }, 'exist');
  flag('empty', function (v) {
    if (typeof v === 'string' || Array.isArray(v)) return v.length === 0;
    if (v && typeof v === 'object') return Object.keys(v).length === 0;
    return false;
  }, 'be empty');
  var A = Assertion.prototype;
  A.equal = A.equals = A.eq = function (expected) {
    var ok = this._deep ? deepEqual(this._value, expected) : this._value === expected;
    return this._assert(ok, 'expected ' + show(this._value) + ' to equal ' + show(expected), 'expected ' + show(this._value) + ' not to equal ' + show(expected));
  };
  A.eql = A.eqls = function (expected) {
    return this._assert(deepEqual(this._value, expected), 'expected ' + show(this._value) + ' to deeply equal ' + show(expected), 'expected ' + show(this._value) + ' not to deeply equal ' + show(expected));
  };
  A.include = A.includes = A.contain = A.contains = function (expected) {
    var v = this._value, ok;
    if (typeof v === 'string') ok = v.indexOf(expected) !== -1;
    else if (Array.isArray(v)) ok = v.some(function (item) { return deepEqual(item, expected); });
    else if (v && typeof v === 'object' && expected && typeof expected === 'object') {
      ok = Object.keys(expected).every(function (k) { return deepEqual(v[k], expected[k]); });
    } else ok = false;
    return this._assert(ok, 'expected ' + show(v) + ' to include ' + show(expected), 'expected ' + show(v) + ' not to include ' + show(expected));
  };
  A.a = A.an = function (type) {
    var actual = typeOf(this._value);
    var wanted = String(type).toLowerCase();
    return this._assert(actual === wanted, 'expected ' + show(this._value) + ' to be a ' + wanted + ' (got ' + actual + ')', 'expected ' + show(this._value) + ' not to be a ' + wanted);
  };
  A.property = function (name, value) {
    var v = this._value;
    var has = v !== null && v !== undefined && Object(v)[name] !== undefined;
    if (arguments.length < 2 || !has) {
      this._assert(has, 'expected ' + show(v) + ' to have property ' + show(name), 'expected ' + show(v) + ' not to have property ' + show(name));
      if (has && !this._not) this._value = Object(v)[name];
      return this;
    }
    var actual = Object(v)[name];
    var same = this._deep ? deepEqual(actual, value) : actual === value;
    return this._assert(same, 'expected ' + show(v) + ' to have property ' + show(name) + ' of ' + show(value) + ', but got ' + show(actual), 'expected ' + show(v) + ' not to have property ' + show(name) + ' of ' + show(value));
  };
  A.length = A.lengthOf = function (n) {
    var v = this._value;
    var len = v === null || v === undefined ? undefined : v.length !== undefined ? v.length : (typeof v === 'object' ? Object.keys(v).length : undefined);
    return this._assert(len === n, 'expected ' + show(v) + ' to have length ' + n + ' but got ' + len, 'expected ' + show(v) + ' not to have length ' + n);
  };
  function compare(name, test, words) {
    A[name] = function (n) {
      return this._assert(test(this._value, n), 'expected ' + show(this._value) + ' to be ' + words + ' ' + n, 'expected ' + show(this._value) + ' not to be ' + words + ' ' + n);
    };
  }
  compare('above', function (v, n) { return v > n; }, 'above');
  compare('below', function (v, n) { return v < n; }, 'below');
  compare('least', function (v, n) { return v >= n; }, 'at least');
  compare('most', function (v, n) { return v <= n; }, 'at most');
  A.gt = A.greaterThan = A.above; A.lt = A.lessThan = A.below; A.gte = A.least; A.lte = A.most;
  A.within = function (low, high) {
    return this._assert(this._value >= low && this._value <= high, 'expected ' + show(this._value) + ' to be within ' + low + '..' + high, 'expected ' + show(this._value) + ' not to be within ' + low + '..' + high);
  };
  A.match = A.matches = function (pattern) {
    return this._assert(pattern instanceof RegExp && pattern.test(String(this._value)), 'expected ' + show(this._value) + ' to match ' + String(pattern), 'expected ' + show(this._value) + ' not to match ' + String(pattern));
  };
  A.oneOf = function (list) {
    var v = this._value;
    return this._assert(list.some(function (item) { return deepEqual(item, v); }), 'expected ' + show(v) + ' to be one of ' + show(list), 'expected ' + show(v) + ' not to be one of ' + show(list));
  };
  A.keys = function () {
    var wanted = Array.isArray(arguments[0]) ? arguments[0] : Array.prototype.slice.call(arguments);
    var v = this._value || {};
    return this._assert(wanted.every(function (k) { return Object.prototype.hasOwnProperty.call(v, k); }), 'expected ' + show(v) + ' to have keys ' + show(wanted), 'expected ' + show(v) + ' not to have keys ' + show(wanted));
  };
  A.status = function (expected) {
    var res = this._value;
    var ok = typeof expected === 'number' ? res.code === expected : res.status === expected;
    return this._assert(ok, 'expected response to have status ' + show(expected) + ' but got ' + res.code + (res.status ? ' ' + res.status : ''), 'expected response not to have status ' + show(expected));
  };
  A.header = function (name, value) {
    var actual = this._value.headers.get(name);
    var ok = arguments.length < 2 ? actual !== undefined : actual === value;
    return this._assert(ok, 'expected response to have header ' + show(name) + (arguments.length < 2 ? '' : ' with value ' + show(value)), 'expected response not to have header ' + show(name));
  };
  A.jsonBody = function () {
    var ok = true; try { this._value.json(); } catch (e) { ok = false; }
    return this._assert(ok, 'expected response body to be JSON', 'expected response body not to be JSON');
  };
  function expect(value, message) { return new Assertion(value, message); }
  expect.fail = function (message) { throw new AssertionError(message || 'expect.fail()'); };

  function test(name, fn) {
    var result = { name: String(name), outcome: 'pass' };
    try {
      if (typeof fn === 'function') fn();
    } catch (e) {
      var assertion = e instanceof AssertionError || (e && e.name === 'AssertionError');
      result.outcome = assertion ? 'fail' : 'error';
      result.message = e && e.message !== undefined ? (assertion ? '' : (e.name || 'Error') + ': ') + e.message : String(e);
    }
    state.tests.push(result);
  }
  test.skip = function (name) { state.tests.push({ name: String(name), outcome: 'pass', message: 'skipped' }); };

  function response(raw) {
    var json;
    var res = {
      code: raw.code,
      status: raw.status,
      responseTime: raw.responseTime,
      responseSize: raw.responseSize,
      headers: {
        get: function (name) {
          var lower = String(name).toLowerCase();
          for (var i = 0; i < raw.headers.length; i++) if (raw.headers[i][0].toLowerCase() === lower) return raw.headers[i][1];
          return undefined;
        },
        has: function (name) { return res.headers.get(name) !== undefined; },
        toObject: function () { var out = {}; raw.headers.forEach(function (h) { out[h[0]] = h[1]; }); return out; },
        each: function (fn) { raw.headers.forEach(function (h) { fn({ key: h[0], value: h[1] }); }); }
      },
      text: function () { return raw.body; },
      json: function () {
        if (json === undefined) json = JSON.parse(raw.body);
        return json;
      }
    };
    Object.defineProperty(res, 'to', {
      get: function () {
        var assertion = new Assertion(res);
        Object.defineProperty(assertion, 'ok', { get: function () {
          return this._assert(res.code >= 200 && res.code < 300, 'expected response to be 2xx but got ' + res.code, 'expected response not to be 2xx');
        } });
        return assertion;
      }
    });
    return res;
  }
  if (!state.tests) state.tests = [];

  function format(args) {
    return Array.prototype.map.call(args, function (a) {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.name + ': ' + a.message;
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    }).join(' ');
  }
  function logger(level) {
    return function () {
      if (__logs.length >= 200) return;
      __logs.push({ level: level, message: format(arguments).slice(0, 10000), at: Date.now() });
    };
  }
  globalThis.pm = pm;
  globalThis.postman = { setEnvironmentVariable: function (k, v) { pm.environment.set(k, v); }, getEnvironmentVariable: function (k) { return pm.environment.get(k); }, setGlobalVariable: function (k, v) { pm.globals.set(k, v); }, getGlobalVariable: function (k) { return pm.globals.get(k); } };
  globalThis.console = { log: logger('log'), info: logger('info'), warn: logger('warn'), error: logger('error'), debug: logger('log') };
  globalThis.require = notSupported('require');
})();
`;
