// OpenFang Ollama Adapter — localhost small-model inference for planner helpers
'use strict';

var OpenFangOllamaAdapter = (function() {
  var _config = {
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3.5:9b',
    temperature: 0.2,
    timeoutMs: 4000,
    warmupEnabled: true
  };
  var _warmPromise = null;
  var _availability = { reachable: false, lastError: '', checkedAt: null };

  function configure(policy) {
    policy = policy || {};
    _config.baseUrl = (policy.base_url || _config.baseUrl).replace(/\/$/, '');
    _config.model = policy.planner_model || _config.model;
    _config.warmupEnabled = policy.warmup_enabled !== false;
  }

  function availability() {
    return Object.assign({}, _availability, { model: _config.model, baseUrl: _config.baseUrl });
  }

  async function request(path, body, timeoutMs) {
    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, timeoutMs || _config.timeoutMs);
    try {
      var response = await fetch(_config.baseUrl + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) throw new Error('Ollama error: ' + response.status);
      _availability.reachable = true;
      _availability.lastError = '';
      _availability.checkedAt = new Date().toISOString();
      return response.json();
    } catch (error) {
      _availability.reachable = false;
      _availability.lastError = error && error.message ? error.message : String(error);
      _availability.checkedAt = new Date().toISOString();
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function warmPlannerModel() {
    if (!_config.warmupEnabled) return availability();
    if (_warmPromise) return _warmPromise;
    _warmPromise = request('/api/generate', {
      model: _config.model,
      prompt: '',
      stream: false
    }, Math.min(_config.timeoutMs, 2500)).catch(function(error) {
      _warmPromise = null;
      throw error;
    });
    try {
      await _warmPromise;
    } catch (error) {
      return availability();
    }
    return availability();
  }

  async function chatLocal(messages, options) {
    options = options || {};
    return request('/api/chat', {
      model: options.model || _config.model,
      stream: false,
      messages: messages,
      options: {
        temperature: options.temperature == null ? _config.temperature : options.temperature
      }
    }, options.timeoutMs || _config.timeoutMs);
  }

  async function plannerJson(taskType, prompt, schemaHint) {
    var response = await chatLocal([
      { role: 'system', content: 'You are a narrow planner helper. Reply with minified JSON only. No markdown.' },
      { role: 'user', content: prompt + '\nReturn JSON matching this schema hint: ' + schemaHint }
    ]);
    var content = response && response.message && response.message.content ? response.message.content : '';
    try {
      return JSON.parse(content);
    } catch (error) {
      throw new Error('Local model returned invalid JSON for ' + taskType);
    }
  }

  return {
    configure: configure,
    availability: availability,
    warmPlannerModel: warmPlannerModel,
    chatLocal: chatLocal,
    plannerJson: plannerJson
  };
})();
