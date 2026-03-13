// OpenFang Fallback Policy — local vs cloud routing rules for planner helpers
'use strict';

var OpenFangFallbackPolicy = (function() {
  var _policy = {
    enabled: true,
    mode: 'advisory',
    provider: 'ollama',
    base_url: 'http://127.0.0.1:11434',
    planner_model: 'qwen3.5:9b',
    embedding_model: 'nomic-embed-text',
    cloud_fallback: true,
    warmup_enabled: true,
    local_keep_threshold: 0.8,
    local_retry_threshold: 0.5,
    local_only_tasks: ['recommendation', 'split', 'classify', 'translate_short']
  };

  function setPolicy(policy) {
    _policy = Object.assign({}, _policy, policy || {});
  }

  function getPolicy() {
    return Object.assign({}, _policy);
  }

  function taskRisk(taskType, options) {
    if (options && options.highRisk) return 'high';
    if (taskType === 'translate_short' && options && options.customerFacing) return 'high';
    if (taskType === 'recommendation' || taskType === 'split' || taskType === 'classify') return 'low';
    return 'medium';
  }

  function decision(confidence, taskType, options) {
    var risk = taskRisk(taskType, options);
    if (!_policy.enabled) {
      return { route: 'cloud_fallback', reason: 'local inference disabled', risk: risk };
    }
    if (risk === 'high') {
      return { route: 'cloud_fallback', reason: 'task risk is high', risk: risk };
    }
    if (confidence >= _policy.local_keep_threshold) {
      return { route: 'keep_local', reason: 'local confidence above threshold', risk: risk };
    }
    if (confidence >= _policy.local_retry_threshold) {
      return { route: 'retry_local', reason: 'local confidence is ambiguous', risk: risk };
    }
    return { route: 'cloud_fallback', reason: 'local confidence below retry threshold', risk: risk };
  }

  return {
    setPolicy: setPolicy,
    getPolicy: getPolicy,
    decision: decision,
    taskRisk: taskRisk
  };
})();
