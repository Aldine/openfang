// Planner Inbox page — live capture and clarify flow
'use strict';

function inboxPage() {
  return {
    isLoading: true,
    error: '',
    data: { items: [], summary: null },
    actionInFlight: '',
    captureText: '',
    localCapabilities: OpenFangLocalOrchestration.capabilities(),

    async loadData() {
      this.isLoading = true;
      this.error = '';
      try {
        await OpenFangLocalOrchestration.boot();
        var response = await OpenFangAPI.get('/api/planner/inbox');
        this.data = await OpenFangLocalOrchestration.hydrateInbox(response);
        await this.enrichRecommendations();
      } catch (e) {
        this.error = 'Could not load the inbox right now.';
      }
      this.isLoading = false;
    },

    async enrichRecommendations() {
      if (!this.data || !Array.isArray(this.data.items)) return;
      for (var i = 0; i < this.data.items.length; i++) {
        var item = this.data.items[i];
        if (!item || !Array.isArray(item.tasks) || !item.tasks.length) continue;
        item.tasks = await OpenFangLocalOrchestration.enrichTaskRecommendations(item.tasks);
      }
      this.localCapabilities = OpenFangLocalOrchestration.capabilities();
    },

    items() {
      return this.data && Array.isArray(this.data.items) ? this.data.items : [];
    },

    async captureItem() {
      var prepared = await OpenFangLocalOrchestration.normalizeCapture(this.captureText || '');
      var text = (prepared && prepared.normalized_text) || '';
      if (!text) return;

      this.actionInFlight = 'capture';
      this.error = '';
      try {
        await OpenFangAPI.post('/api/planner/inbox', { text: text });
        this.captureText = '';
        await this.loadData();
        OpenFangToast.success('Captured to Inbox');
      } catch (e) {
        this.error = 'Could not capture that inbox item.';
        OpenFangToast.error(this.error);
      }
      this.actionInFlight = '';
    },

    async clarifyItem(inboxItemId) {
      this.actionInFlight = 'clarify:' + inboxItemId;
      this.error = '';
      try {
        var item = this.items().find(function(entry) { return entry.id === inboxItemId; });
        var preview = await OpenFangLocalOrchestration.planClarify(item && item.text ? item.text : '');
        if (preview && preview.probably_project) {
          OpenFangToast.info('Local helper predicts project-shaped work before clarify.');
        } else {
          OpenFangToast.info('Local helper is preparing a narrow clarify pass.');
        }
        var response = await OpenFangAPI.post('/api/planner/clarify', {
          inbox_item_id: inboxItemId
        });
        await this.loadData();
        var taskCount = response && Array.isArray(response.tasks) ? response.tasks.length : 0;
        if (response && response.project && taskCount > 1) {
          OpenFangToast.success('Clarified into project work');
        } else if (response && response.project) {
          OpenFangToast.success('Clarified into project work');
        } else {
          OpenFangToast.success('Clarified into structured work');
        }
      } catch (e) {
        this.error = 'Could not clarify that inbox item.';
        OpenFangToast.error(this.error);
      }
      this.actionInFlight = '';
    },

    isClarifying(inboxItemId) {
      return this.actionInFlight === 'clarify:' + inboxItemId;
    },

    formatDate(value) {
      if (!value) return '';
      try {
        return new Date(value).toLocaleString();
      } catch (e) {
        return value;
      }
    },

    recommendationLabel(recommendation) {
      var label = OpenFangLocalOrchestration.recommendationLabel(recommendation);
      return label ? label.replace('Suggested agent: ', '') : '';
    },

    recommendationTitle(recommendation) {
      return recommendation && recommendation.reason ? recommendation.reason : '';
    },

    confidenceLabel(confidence) {
      if (!confidence) return 'medium';
      return confidence.replace('_', ' ');
    },

    confidenceBadgeClass(confidence) {
      if (confidence === 'high') return 'badge-success';
      if (confidence === 'low') return 'badge-muted';
      return 'badge-info';
    },

    showRecommendation(recommendation) {
      return OpenFangLocalOrchestration.showRecommendation(recommendation);
    },

    firstStrongRecommendation(task) {
      if (!task || !task.agent_recommendation) return null;
      return this.showRecommendation(task.agent_recommendation) ? task.agent_recommendation : null;
    },

    localStatusText() {
      var status = OpenFangLocalOrchestration.status();
      var decision = OpenFangLocalOrchestration.lastDecision();
      if (status && status.ui_state === 'warming_up') {
        return 'Local helper warming up.';
      }
      if (decision && decision.fallback_used) {
        return 'Fell back to cloud.';
      }
      if (status && status.reachable && status.model_present && status.warm) {
        return 'Local helper active. Using local model.';
      }
      if (status && !status.reachable) {
        return 'Local helper unavailable.';
      }
      if (this.data && this.data.summary && this.data.summary.status_text) {
        return this.data.summary.status_text;
      }
      if (this.localCapabilities.mode === 'worker_pool') {
        return 'Local helper ready with a browser worker pool.';
      }
      return 'Local helper running on the main thread.';
    }
  };
}
