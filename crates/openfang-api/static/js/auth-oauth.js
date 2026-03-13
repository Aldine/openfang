// OpenFang GitHub OAuth Device Flow Module
// Standalone module — no Alpine dependency.
// Fires CustomEvents on document:
//   openfang:oauth-started   — { detail: { userCode, verificationUri } }
//   openfang:oauth-success   — { detail: { token, user } }
//   openfang:oauth-error     — { detail: { message } }
//   openfang:oauth-expired   — {}
'use strict';

var OpenFangOAuth = (function() {
  var _pollId = '';
  var _interval = 5;
  var _polling = false;

  function _dispatch(name, detail) {
    document.dispatchEvent(new CustomEvent('openfang:' + name, detail !== undefined ? { detail: detail } : {}));
  }

  function cancel() {
    _polling = false;
    _pollId = '';
  }

  async function start() {
    cancel();
    try {
      var flow = await OpenFangAPI.post('/api/auth/github/start', {});
      _pollId = flow.poll_id;
      _interval = flow.interval || 5;
      _polling = true;
      _dispatch('oauth-started', { userCode: flow.user_code, verificationUri: flow.verification_uri });
      _poll();
    } catch (e) {
      _dispatch('oauth-error', { message: e.message || 'Failed to start GitHub sign-in' });
    }
  }

  async function _poll() {
    if (!_pollId || !_polling) return;
    try {
      var status = await OpenFangAPI.get('/api/auth/github/poll/' + encodeURIComponent(_pollId));
      if (!status || status.status === 'pending') {
        var delay = (status && status.interval ? status.interval : _interval) * 1000;
        setTimeout(_poll, delay);
        return;
      }
      if (status.status === 'complete' && status.token) {
        _polling = false;
        _dispatch('oauth-success', { token: status.token, user: status.user || null });
        return;
      }
      if (status.status === 'denied' || status.status === 'expired' || status.status === 'error') {
        _polling = false;
        if (status.status === 'expired') {
          _dispatch('oauth-expired');
        } else {
          _dispatch('oauth-error', { message: status.error || ('GitHub sign-in ' + status.status) });
        }
      }
    } catch (e) {
      _polling = false;
      _dispatch('oauth-error', { message: e.message || 'GitHub sign-in failed' });
    }
  }

  return { start: start, cancel: cancel };
})();
