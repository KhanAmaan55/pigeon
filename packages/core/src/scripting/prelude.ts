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
    test: notSupported('pm.test (test scripts arrive with PIGN-044)'),
    expect: notSupported('pm.expect (test scripts arrive with PIGN-044)'),
    response: undefined,
    execution: { skipRequest: notSupported('pm.execution.skipRequest'), setNextRequest: notSupported('pm.execution.setNextRequest') }
  };
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
