// OAuth 2.0 redirect target for Pigeon web (PIGN-047): hands the redirect's query parameters to
// the Pigeon window that opened this popup (same origin only), then closes.
(function () {
  var params = {};
  new URLSearchParams(window.location.search).forEach(function (value, key) {
    params[key] = value;
  });
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage({ type: 'pigeon-oauth', params: params }, window.location.origin);
    window.close();
  } else {
    document.getElementById('status').textContent =
      'Pigeon is no longer open in the window that started sign-in. Start again from Pigeon.';
  }
})();
