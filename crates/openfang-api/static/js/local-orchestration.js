// OpenFang Local Orchestration — worker-pool backed planner helpers
'use strict';

var OpenFangLocalOrchestration = (function() {
  var _taskId = 0;
  var _queue = [];
  var _workers = [];
  var _booted = false;
  var _workerPoolSize = 0;
  var _serviceBootPromise = null;
  var _policy = null;
  var _status = {
    reachable: false,
    selected_model: 'qwen3.5:9b',
    model_present: false,
    warm: false,
    last_error: '',
    ui_state: 'unavailable'
  };
  var _lastDecision = null;

  function supportsWorkers() {
    return typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
  }

  function supportsSharedWorker() {
    return typeof SharedWorker !== 'undefined';
  }

  function detectCapabilities() {
    var hardwareConcurrency = navigator.hardwareConcurrency || 4;
    var poolSize = Math.min(Math.max(2, hardwareConcurrency - 1), 6);
    return {
      workers: supportsWorkers(),
      sharedWorker: supportsSharedWorker(),
      webgpu: !!(navigator.gpu),
      hardwareConcurrency: hardwareConcurrency,
      poolSize: poolSize,
      mode: supportsWorkers() ? 'worker_pool' : 'main_thread'
    };
  }

  var _capabilities = detectCapabilities();

  function currentCapabilities() {
    return Object.assign({}, _capabilities, {
      activeWorkers: _workerPoolSize || 0,
      queuedTasks: _queue.length,
      policyModel: _policy && _policy.planner_model ? _policy.planner_model : null,
      localServerReachable: !!_status.reachable
    });
  }

  function setStatus(status, uiState) {
    _status = Object.assign({}, _status, status || {});
    _status.ui_state = uiState || deriveUiState(_status);
  }

  function deriveUiState(status) {
    if (status && status.reachable && status.model_present && status.warm) return 'ready';
    if (status && status.reachable && status.model_present && !status.warm) return 'warming_up';
    return 'unavailable';
  }

  function rememberDecision(decision) {
    _lastDecision = decision ? Object.assign({}, decision) : null;
  }

  function workerSource() {
    return [
      "'use strict';",
      'function normalizeText(text) {',
      '  return String(text || "").replace(/\\s+/g, " ").trim();',
      '}',
      'function countMatches(text, regex) {',
      '  var matches = text.match(regex);',
      '  return matches ? matches.length : 0;',
      '}',
      'function inferRecommendation(text) {',
      '  var lower = normalizeText(text).toLowerCase();',
      '  if (!lower) return null;',
      '  if (/(security|auth|audit|vuln|risk)/.test(lower)) return { name: "security-auditor", reason: "Local helper detected security review language.", confidence: "high" };',
      '  if (/(write|draft|copy|launch notes|blog|email)/.test(lower)) return { name: "writer", reason: "Local helper detected writing work.", confidence: "medium" };',
      '  if (/(translate|spanish|french|german|localize)/.test(lower)) return { name: "translator", reason: "Local helper detected translation work.", confidence: "high" };',
      '  if (/(test|qa|regression|spec|coverage)/.test(lower)) return { name: "test-engineer", reason: "Local helper detected testing work.", confidence: "medium" };',
      '  if (/(research|compare|investigate)/.test(lower)) return { name: "researcher", reason: "Local helper detected research work.", confidence: "medium" };',
      '  return null;',
      '}',
      'function normalizeCapture(payload) {',
      '  var normalized = normalizeText(payload && payload.text);',
      '  return {',
      '    normalized_text: normalized,',
      '    word_count: normalized ? normalized.split(/\\s+/).length : 0,',
      '    sentence_count: normalized ? Math.max(1, countMatches(normalized, /[.!?]/g)) : 0,',
      '    probably_project: countMatches(normalized.toLowerCase(), /\\b(and|then|after|also|plus|week|roadmap|launch|plan)\\b/g) >= 2',
      '  };',
      '}',
      'function clarifyPreview(payload) {',
      '  var normalized = normalizeText(payload && payload.text);',
      '  var lower = normalized.toLowerCase();',
      '  var predictedTaskCount = 1 + countMatches(lower, /\\b(and|then|after|plus|also)\\b/g);',
      '  if (predictedTaskCount > 4) predictedTaskCount = 4;',
      '  return {',
      '    normalized_text: normalized,',
      '    predicted_task_count: normalized ? predictedTaskCount : 0,',
      '    probably_project: predictedTaskCount > 1 || /(week|milestone|launch|roadmap|project)/.test(lower),',
      '    recommendation: inferRecommendation(normalized)',
      '  };',
      '}',
      'function cloneTask(task) {',
      '  var recommendation = task && task.agent_recommendation ? task.agent_recommendation : inferRecommendation(task && (task.title || task.next_action || ""));',
      '  var clone = Object.assign({}, task || {});',
      '  clone.agent_recommendation = recommendation || clone.agent_recommendation || null;',
      '  clone.local_meta = {',
      '    has_strong_recommendation: !!(clone.agent_recommendation && clone.agent_recommendation.confidence && clone.agent_recommendation.confidence !== "low")',
      '  };',
      '  return clone;',
      '}',
      'function hydrateInbox(payload) {',
      '  var items = payload && payload.items ? payload.items : [];',
      '  var clarified = 0;',
      '  var pending = 0;',
      '  var projectLike = 0;',
      '  var hydrated = items.map(function(item) {',
      '    var text = normalizeText(item && item.text);',
      '    var preview = clarifyPreview({ text: text });',
      '    var clone = Object.assign({}, item || {});',
      '    clone.tasks = Array.isArray(clone.tasks) ? clone.tasks.map(cloneTask) : [];',
      '    clone.local_preview = preview;',
      '    if (clone.status === "clarified") clarified += 1; else pending += 1;',
      '    if (preview.probably_project) projectLike += 1;',
      '    return clone;',
      '  });',
      '  return {',
      '    items: hydrated,',
      '    summary: {',
      '      total: hydrated.length,',
      '      clarified: clarified,',
      '      pending: pending,',
      '      project_like: projectLike,',
      '      status_text: hydrated.length ? "Local helper active for capture cleanup and clarify preview." : "Local helper ready for the next inbox capture."',
      '    }',
      '  };',
      '}',
      'function summarizeTasks(tasks) {',
      '  tasks = Array.isArray(tasks) ? tasks.map(cloneTask) : [];',
      '  var recommendationCount = 0;',
      '  tasks.forEach(function(task) {',
      '    if (task.local_meta && task.local_meta.has_strong_recommendation) recommendationCount += 1;',
      '  });',
      '  return { tasks: tasks, recommendation_count: recommendationCount };',
      '}',
      'function hydrateToday(payload) {',
      '  var plan = payload && payload.plan ? Object.assign({}, payload.plan) : null;',
      '  if (!plan) return { plan: null, summary: { status_text: "Local helper idle until a today plan is loaded." } };',
      '  var mustDo = summarizeTasks(plan.must_do);',
      '  var shouldDo = summarizeTasks(plan.should_do);',
      '  var couldDo = summarizeTasks(plan.could_do);',
      '  plan.must_do = mustDo.tasks;',
      '  plan.should_do = shouldDo.tasks;',
      '  plan.could_do = couldDo.tasks;',
      '  var focusTask = plan.focus_suggestion || (plan.must_do && plan.must_do[0]) || null;',
      '  return {',
      '    plan: plan,',
      '    summary: {',
      '      focus_title: focusTask ? (focusTask.title || "Focus task ready") : "No focus task selected",',
      '      focus_action: focusTask ? (focusTask.next_action || "Start with the next action.") : "Rebuild the plan after clarifying Inbox items.",',
      '      blocker_title: plan.blockers && plan.blockers.length ? "Blocked work detected" : "No blocker on deck",',
      '      blocker_detail: plan.blockers && plan.blockers.length ? plan.blockers[0] : "Blocked work is staying out of must-do.",',
      '      recommendation_count: mustDo.recommendation_count + shouldDo.recommendation_count + couldDo.recommendation_count,',
      '      status_text: "Local helper active for recommendation hydration and focus summaries."',
      '    }',
      '  };',
      '}',
      'function runTask(type, payload) {',
      '  if (type === "normalize_capture") return normalizeCapture(payload || {});',
      '  if (type === "clarify_preview") return clarifyPreview(payload || {});',
      '  if (type === "hydrate_inbox") return hydrateInbox(payload || {});',
      '  if (type === "hydrate_today") return hydrateToday(payload || {});',
      '  throw new Error("Unknown local orchestration task: " + type);',
      '}',
      'self.onmessage = function(event) {',
      '  var message = event.data || {};',
      '  try {',
      '    var result = runTask(message.type, message.payload || {});',
      '    self.postMessage({ id: message.id, ok: true, result: result });',
      '  } catch (error) {',
      '    self.postMessage({ id: message.id, ok: false, error: error && error.message ? error.message : String(error) });',
      '  }',
      '};'
    ].join('\n');
  }

  function mainThreadFallback(type, payload) {
    if (type === 'normalize_capture') {
      var normalized = String((payload && payload.text) || '').replace(/\s+/g, ' ').trim();
      return Promise.resolve({
        normalized_text: normalized,
        word_count: normalized ? normalized.split(/\s+/).length : 0,
        sentence_count: normalized ? Math.max(1, (normalized.match(/[.!?]/g) || []).length) : 0,
        probably_project: /\b(and|then|after|plus|also|week|roadmap|launch|plan)\b/i.test(normalized)
      });
    }
    if (type === 'clarify_preview') {
      var text = String((payload && payload.text) || '').replace(/\s+/g, ' ').trim();
      var predictedTaskCount = 1 + ((text.toLowerCase().match(/\b(and|then|after|plus|also)\b/g) || []).length);
      if (predictedTaskCount > 4) predictedTaskCount = 4;
      return Promise.resolve({
        normalized_text: text,
        predicted_task_count: text ? predictedTaskCount : 0,
        probably_project: predictedTaskCount > 1 || /\b(week|milestone|launch|roadmap|project)\b/i.test(text),
        recommendation: recommendationFromText(text)
      });
    }
    if (type === 'hydrate_inbox') {
      var items = payload && payload.items ? payload.items : [];
      return Promise.resolve({
        items: items,
        summary: {
          total: items.length,
          clarified: items.filter(function(item) { return item.status === 'clarified'; }).length,
          pending: items.filter(function(item) { return item.status !== 'clarified'; }).length,
          project_like: items.filter(function(item) { return /\b(and|then|after|plus|also|week|project)\b/i.test(item.text || ''); }).length,
          status_text: 'Local helper fallback active on the main thread.'
        }
      });
    }
    if (type === 'hydrate_today') {
      return Promise.resolve({
        plan: payload && payload.plan ? payload.plan : null,
        summary: {
          status_text: 'Local helper fallback active on the main thread.'
        }
      });
    }
    return Promise.reject(new Error('Unknown local orchestration task: ' + type));
  }

  function recommendationFromText(text) {
    var lower = String(text || '').toLowerCase();
    if (/(security|auth|audit|vuln|risk)/.test(lower)) return { name: 'security-auditor', reason: 'Local helper detected security review language.', confidence: 'high' };
    if (/(write|draft|copy|launch notes|blog|email)/.test(lower)) return { name: 'writer', reason: 'Local helper detected writing work.', confidence: 'medium' };
    if (/(translate|spanish|french|german|localize)/.test(lower)) return { name: 'translator', reason: 'Local helper detected translation work.', confidence: 'high' };
    if (/(test|qa|regression|spec|coverage)/.test(lower)) return { name: 'test-engineer', reason: 'Local helper detected testing work.', confidence: 'medium' };
    if (/(research|compare|investigate)/.test(lower)) return { name: 'researcher', reason: 'Local helper detected research work.', confidence: 'medium' };
    return null;
  }

  function hasStrongRecommendation(task) {
    return !!(task && task.agent_recommendation && task.agent_recommendation.confidence && task.agent_recommendation.confidence !== 'low');
  }

  async function bootService() {
    if (_serviceBootPromise) return _serviceBootPromise;
    _serviceBootPromise = (async function() {
      try {
        _policy = await OpenFangAPI.get('/api/local/policy');
        OpenFangFallbackPolicy.setPolicy(_policy);
      } catch (error) {
        console.warn('[OpenFang] Could not load local policy:', error && error.message ? error.message : error);
      }

      setStatus({
        selected_model: _policy && _policy.planner_model ? _policy.planner_model : _status.selected_model,
        last_error: ''
      }, 'warming_up');

      try {
        var status = await OpenFangAPI.get('/api/local/status?warm=true');
        setStatus(status);
        await OpenFangAPI.post('/api/local/capabilities', {
          shared_worker: _capabilities.sharedWorker,
          webgpu: _capabilities.webgpu,
          hardware_concurrency: _capabilities.hardwareConcurrency,
          localhost_models: _policy && _policy.planner_model ? [_policy.planner_model] : [],
          local_server_reachable: !!status.reachable
        });
      } catch (error) {
        setStatus({ reachable: false, model_present: false, warm: false, last_error: 'local_unreachable' }, 'unavailable');
        try {
          await OpenFangAPI.post('/api/local/capabilities', {
            shared_worker: _capabilities.sharedWorker,
            webgpu: _capabilities.webgpu,
            hardware_concurrency: _capabilities.hardwareConcurrency,
            localhost_models: _policy && _policy.planner_model ? [_policy.planner_model] : [],
            local_server_reachable: false
          });
        } catch (reportError) {
          console.warn('[OpenFang] Could not post local capabilities:', reportError && reportError.message ? reportError.message : reportError);
        }
      }

      return {
        policy: _policy,
        capabilities: currentCapabilities(),
        status: Object.assign({}, _status)
      };
    })();
    return _serviceBootPromise;
  }

  async function plannerTask(path, body) {
    await bootService();
    var response = await OpenFangAPI.post(path, body || {});
    rememberDecision(response);
    if (response && response.tier === 'localhost_model') {
      setStatus({ last_error: '', warm: true }, 'ready');
    } else if (response && response.fallback_reason) {
      setStatus({ last_error: response.fallback_reason }, _status.ui_state === 'ready' ? 'ready' : deriveUiState(_status));
    }
    return response;
  }

  async function localRecommendation(task) {
    task = task || {};
    var response = await plannerTask('/api/local/planner/recommend', {
      title: task.title || '',
      next_action: task.next_action || '',
      text: task.text || '',
      high_risk: !!task.high_risk
    });
    if (!response || !response.recommendation) return null;
    return {
      recommendation: response.recommendation,
      tier: response.tier || 'cloud_fallback',
      confidence: Number(response.confidence || 0.0),
      reason: response.fallback_reason || null,
      fallback_used: !!response.fallback_used,
      user_visible_outcome: response.user_visible_outcome || ''
    };
  }

  async function localSplit(text) {
    text = String(text || '').trim();
    if (!text) {
      return { predicted_task_count: 0, probably_project: false, tier: 'worker_pool', confidence: 1.0 };
    }
    var preview = await run('clarify_preview', { text: text });
    var response = await plannerTask('/api/local/planner/split', {
      text: text,
      high_risk: false
    });
    return {
      predicted_task_count: Number(response && response.predicted_task_count || preview.predicted_task_count || 1),
      probably_project: !!(response && response.probably_project),
      confidence: Number(response && response.confidence || 0.0),
      tier: response && response.tier ? response.tier : 'cloud_fallback',
      fallback_used: !!(response && response.fallback_used),
      fallback_reason: response && response.fallback_reason ? response.fallback_reason : null,
      user_visible_outcome: response && response.user_visible_outcome ? response.user_visible_outcome : ''
    };
  }

  async function translateShort(text, targetLanguage) {
    text = String(text || '').trim();
    if (!text) return { text: '', tier: 'worker_pool', confidence: 1.0 };
    var response = await plannerTask('/api/local/planner/translate', {
      text: text,
      target_language: targetLanguage || 'Spanish',
      high_risk: false,
      customer_facing: false
    });
    return {
      text: response && response.translation ? response.translation : text,
      confidence: Number(response && response.confidence || 0.0),
      tier: response && response.tier ? response.tier : 'cloud_fallback',
      fallback_used: !!(response && response.fallback_used),
      fallback_reason: response && response.fallback_reason ? response.fallback_reason : null,
      user_visible_outcome: response && response.user_visible_outcome ? response.user_visible_outcome : ''
    };
  }

  async function enrichTaskRecommendations(tasks) {
    await bootService();
    tasks = Array.isArray(tasks) ? tasks.slice() : [];
    for (var i = 0; i < tasks.length; i++) {
      var task = tasks[i] || {};
      if (hasStrongRecommendation(task)) continue;
      var local = await localRecommendation(task);
      if (local && local.recommendation) {
        tasks[i] = Object.assign({}, task, {
          agent_recommendation: local.recommendation,
          local_meta: Object.assign({}, task.local_meta || {}, {
            inference_tier: local.tier,
            inference_confidence: local.confidence,
            fallback_used: !!local.fallback_used,
            fallback_reason: local.reason,
            has_strong_recommendation: true
          })
        });
      }
    }
    return tasks;
  }

  function ensureWorkers() {
    if (_booted || !_capabilities.workers) return;
    _booted = true;
    _workerPoolSize = Math.min(_capabilities.poolSize, 4);
    for (var i = 0; i < _workerPoolSize; i++) {
      _workers.push(createWorkerHandle());
    }
  }

  function createWorkerHandle() {
    var blob = new Blob([workerSource()], { type: 'application/javascript' });
    var url = URL.createObjectURL(blob);
    var worker = new Worker(url);
    URL.revokeObjectURL(url);

    var handle = {
      worker: worker,
      busy: false,
      resolve: null,
      reject: null,
      taskId: null
    };

    worker.onmessage = function(event) {
      var message = event.data || {};
      if (!handle.busy || message.id !== handle.taskId) return;
      var resolve = handle.resolve;
      var reject = handle.reject;
      handle.busy = false;
      handle.resolve = null;
      handle.reject = null;
      handle.taskId = null;
      if (message.ok) resolve(message.result);
      else reject(new Error(message.error || 'Worker task failed'));
      pumpQueue();
    };

    worker.onerror = function(event) {
      var reject = handle.reject;
      handle.busy = false;
      handle.resolve = null;
      handle.reject = null;
      handle.taskId = null;
      if (reject) reject(new Error(event.message || 'Worker error'));
      pumpQueue();
    };

    return handle;
  }

  function pumpQueue() {
    if (!_queue.length) return;
    for (var i = 0; i < _workers.length; i++) {
      var handle = _workers[i];
      if (handle.busy) continue;
      var next = _queue.shift();
      if (!next) return;
      handle.busy = true;
      handle.resolve = next.resolve;
      handle.reject = next.reject;
      handle.taskId = next.id;
      handle.worker.postMessage({ id: next.id, type: next.type, payload: next.payload });
      if (!_queue.length) return;
    }
  }

  function run(type, payload) {
    if (!_capabilities.workers) return mainThreadFallback(type, payload);
    ensureWorkers();
    return new Promise(function(resolve, reject) {
      _queue.push({ id: ++_taskId, type: type, payload: payload, resolve: resolve, reject: reject });
      pumpQueue();
    }).catch(function(error) {
      console.warn('[OpenFang] Local orchestration worker failed, falling back:', error && error.message ? error.message : error);
      return mainThreadFallback(type, payload);
    });
  }

  function recommendationLabel(recommendation) {
    if (!recommendation || !recommendation.name) return '';
    return 'Suggested agent: ' + recommendation.name;
  }

  function showRecommendation(recommendation) {
    return !!(recommendation && recommendation.confidence && recommendation.confidence !== 'low');
  }

  return {
    capabilities: function() {
      return currentCapabilities();
    },
    boot: function() {
      return bootService();
    },
    normalizeCapture: function(text) {
      return run('normalize_capture', { text: text });
    },
    planClarify: function(text) {
      return localSplit(text);
    },
    hydrateInbox: function(response) {
      return run('hydrate_inbox', { items: response && response.items ? response.items : [] });
    },
    hydrateToday: function(response) {
      return run('hydrate_today', { plan: response && response.plan ? response.plan : null });
    },
    enrichTaskRecommendations: enrichTaskRecommendations,
    localRecommendation: localRecommendation,
    translateShort: translateShort,
    status: function() {
      return Object.assign({}, _status);
    },
    lastDecision: function() {
      return _lastDecision ? Object.assign({}, _lastDecision) : null;
    },
    policy: function() {
      return _policy ? Object.assign({}, _policy) : null;
    },
    availability: function() {
      return {
        reachable: !!_status.reachable,
        model: _status.selected_model,
        warm: !!_status.warm,
        lastError: _status.last_error || ''
      };
    },
    recommendationLabel: recommendationLabel,
    showRecommendation: showRecommendation
  };
})();
