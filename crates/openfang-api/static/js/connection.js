// OpenFang WebSocket Connection Manager
// Standalone module — no Alpine dependency.
// Used by api.js (Alpine app) and importable by Next.js via window.OpenFangConnection.
//
// Fires CustomEvents on document:
//   openfang:ws-open           — WS connected (or reconnected)
//   openfang:ws-close          — WS closed cleanly (code 1000 or exhausted retries)
//   openfang:ws-message        — { detail: parsedObject }
//   openfang:ws-reconnecting   — attempting reconnect { detail: { attempt, maxAttempts } }
//   openfang:connection-state  — { detail: 'connected' | 'reconnecting' | 'disconnected' }
'use strict';

var OpenFangConnection = (function() {
  var _ws = null;
  var _agentId = null;
  var _callbacks = {};
  var _connected = false;
  var _reconnectTimer = null;
  var _reconnectAttempts = 0;
  var MAX_RECONNECT = 5;

  // Resolved at connect-time via getConfig()
  var _getBaseUrl = null;
  var _getToken = null;

  function _dispatch(name, detail) {
    document.dispatchEvent(new CustomEvent('openfang:' + name, detail !== undefined ? { detail: detail } : {}));
  }

  function _setState(state) {
    _dispatch('connection-state', state);
  }

  function connect(agentId, callbacks, opts) {
    disconnect();
    _agentId = agentId;
    _callbacks = callbacks || {};
    _reconnectAttempts = 0;
    // opts: { getBaseUrl: fn, getToken: fn }
    if (opts) {
      if (opts.getBaseUrl) _getBaseUrl = opts.getBaseUrl;
      if (opts.getToken) _getToken = opts.getToken;
    }
    _doConnect(agentId);
  }

  function _doConnect(agentId) {
    try {
      var base = (_getBaseUrl ? _getBaseUrl() : (window.location.origin)).replace(/^http/, 'ws');
      var token = _getToken ? _getToken() : '';
      var url = base + '/api/agents/' + agentId + '/ws';
      if (token) url += '?token=' + encodeURIComponent(token);

      _ws = new WebSocket(url);

      _ws.onopen = function() {
        _connected = true;
        var wasReconnect = _reconnectAttempts > 0;
        _reconnectAttempts = 0;
        _setState('connected');
        _dispatch('ws-open');
        if (wasReconnect && typeof OpenFangToast !== 'undefined') {
          OpenFangToast.success('Reconnected');
        }
        if (_callbacks.onOpen) _callbacks.onOpen();
      };

      _ws.onmessage = function(e) {
        try {
          var data = JSON.parse(e.data);
          _dispatch('ws-message', data);
          if (_callbacks.onMessage) _callbacks.onMessage(data);
        } catch(err) { /* ignore parse errors */ }
      };

      _ws.onclose = function(e) {
        _connected = false;
        _ws = null;

        if (_agentId && _reconnectAttempts < MAX_RECONNECT && e.code !== 1000) {
          _reconnectAttempts++;
          _setState('reconnecting');
          _dispatch('ws-reconnecting', { attempt: _reconnectAttempts, maxAttempts: MAX_RECONNECT });
          if (_reconnectAttempts === 1 && typeof OpenFangToast !== 'undefined') {
            OpenFangToast.warn('Connection lost, reconnecting…');
          }
          var delay = Math.min(1000 * Math.pow(2, _reconnectAttempts - 1), 10000);
          _reconnectTimer = setTimeout(function() { _doConnect(_agentId); }, delay);
          return;
        }

        if (_agentId && _reconnectAttempts >= MAX_RECONNECT) {
          _setState('disconnected');
          if (typeof OpenFangToast !== 'undefined') {
            OpenFangToast.error('Connection lost — switched to HTTP mode', 0);
          }
        }

        _dispatch('ws-close');
        if (_callbacks.onClose) _callbacks.onClose();
      };

      _ws.onerror = function() {
        _connected = false;
        if (_callbacks.onError) _callbacks.onError();
      };
    } catch(e) {
      _connected = false;
    }
  }

  function disconnect() {
    _agentId = null;
    _reconnectAttempts = MAX_RECONNECT; // prevent auto-reconnect
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
    if (_ws) { _ws.close(1000); _ws = null; }
    _connected = false;
  }

  function send(data) {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  function isConnected() { return _connected; }

  return { connect: connect, disconnect: disconnect, send: send, isConnected: isConnected };
})();
