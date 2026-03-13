// Planner Today page — live today plan view
'use strict';

function todayPage() {
  return {
    isLoading: true,
    error: '',
    data: null,
    summary: null,
    actionInFlight: '',
    expandedTaskIds: {},
    localCapabilities: OpenFangLocalOrchestration.capabilities(),

    async loadData() {
      this.isLoading = true;
      this.error = '';
      try {
        await OpenFangLocalOrchestration.boot();
        var response = await OpenFangAPI.get('/api/planner/today');
        var hydrated = await OpenFangLocalOrchestration.hydrateToday(response);
        this.data = hydrated.plan || null;
        this.summary = hydrated.summary || null;
        await this.enrichRecommendations();
      } catch (e) {
        this.error = 'Could not load today right now.';
      }
      this.isLoading = false;
    },

    async rebuildPlan() {
      this.actionInFlight = 'rebuild';
      this.error = '';
      try {
        var response = await OpenFangAPI.post('/api/planner/today/rebuild', {});
        var hydrated = await OpenFangLocalOrchestration.hydrateToday(response);
        this.data = hydrated.plan || null;
        this.summary = hydrated.summary || null;
        await this.enrichRecommendations();
        OpenFangToast.success('Today refreshed');
      } catch (e) {
        this.error = 'Could not rebuild today right now.';
        OpenFangToast.error(this.error);
      }
      this.actionInFlight = '';
    },

    async enrichRecommendations() {
      if (!this.data) return;
      this.data.must_do = await OpenFangLocalOrchestration.enrichTaskRecommendations(this.data.must_do || []);
      this.data.should_do = await OpenFangLocalOrchestration.enrichTaskRecommendations(this.data.should_do || []);
      this.data.could_do = await OpenFangLocalOrchestration.enrichTaskRecommendations(this.data.could_do || []);
      this.localCapabilities = OpenFangLocalOrchestration.capabilities();
    },

    hasPlan() {
      if (!this.data) return false;
      return !!(
        this.data.daily_outcome ||
        (this.data.must_do && this.data.must_do.length) ||
        (this.data.should_do && this.data.should_do.length) ||
        (this.data.could_do && this.data.could_do.length) ||
        this.data.focus_suggestion ||
        (this.data.blockers && this.data.blockers.length)
      );
    },

    sectionItems(key) {
      if (!this.data || !Array.isArray(this.data[key])) return [];
      return this.data[key];
    },

    focusTitle() {
      if (this.summary && this.summary.focus_title) return this.summary.focus_title;
      return this.data && this.data.focus_suggestion
        ? this.data.focus_suggestion.title
        : 'No focus task selected';
    },

    focusAction() {
      if (this.summary && this.summary.focus_action) return this.summary.focus_action;
      return this.data && this.data.focus_suggestion
        ? this.data.focus_suggestion.next_action
        : 'Rebuild the plan after clarifying Inbox items.';
    },

    mainBlockerTitle() {
      if (this.summary && this.summary.blocker_title) return this.summary.blocker_title;
      return this.data && this.data.blockers && this.data.blockers.length
        ? 'Blocked work detected'
        : 'No blocker on deck';
    },

    mainBlockerDetail() {
      if (this.summary && this.summary.blocker_detail) return this.summary.blocker_detail;
      return this.data && this.data.blockers && this.data.blockers.length
        ? this.data.blockers[0]
        : 'Blocked work is staying out of must-do.';
    },

    priorityLabel(priority) {
      if (!priority) return 'Medium';
      return priority.charAt(0).toUpperCase() + priority.slice(1);
    },

    priorityBadgeClass(priority) {
      if (priority === 'urgent') return 'badge-error';
      if (priority === 'high') return 'badge-warn';
      if (priority === 'low') return 'badge-muted';
      return 'badge-info';
    },

    recommendationLabel(recommendation) {
      return OpenFangLocalOrchestration.recommendationLabel(recommendation);
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

    toggleRecommendation(taskId) {
      this.expandedTaskIds[taskId] = !this.expandedTaskIds[taskId];
    },

    recommendationExpanded(taskId) {
      return !!this.expandedTaskIds[taskId];
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
      if (this.summary && this.summary.status_text) return this.summary.status_text;
      if (this.localCapabilities.mode === 'worker_pool') {
        return 'Local helper ready with a browser worker pool.';
      }
      return 'Local helper running on the main thread.';
    }
  };
}
