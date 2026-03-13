// Planner Agent Catalog page — specialist registry and noise controls
'use strict';

function agentCatalogPage() {
  return {
    isLoading: true,
    error: '',
    agents: [],
    actionInFlight: '',
    savedState: {},

    async loadData() {
      this.isLoading = true;
      this.error = '';
      try {
        var response = await OpenFangAPI.get('/api/agents/catalog');
        this.agents = Array.isArray(response.agents) ? response.agents : [];
      } catch (e) {
        this.error = 'Could not load specialists right now.';
      }
      this.isLoading = false;
    },

    async toggleAgent(agent) {
      this.actionInFlight = agent.catalog_id;
      this.error = '';
      try {
        var response = await OpenFangAPI.put('/api/agents/catalog/' + encodeURIComponent(agent.catalog_id) + '/enabled', {
          enabled: !agent.enabled
        });
        if (response && response.agent) {
          for (var i = 0; i < this.agents.length; i++) {
            if (this.agents[i].catalog_id === response.agent.catalog_id) {
              this.agents.splice(i, 1, response.agent);
              break;
            }
          }
          if (response.agent.enabled) {
            OpenFangToast.success(response.agent.name + ' enabled');
          } else {
            OpenFangToast.success(response.agent.name + ' disabled');
          }
          this.savedState = this.savedState || {};
          this.savedState[response.agent.catalog_id] = response.agent.enabled
            ? response.agent.name + ' enabled. Future matching tasks can use this specialist again.'
            : response.agent.name + ' disabled. Future matching tasks will stay with Planner unless you turn this specialist back on.';
        }
      } catch (e) {
        this.error = 'Could not save that specialist preference.';
        OpenFangToast.error(this.error);
      }
      this.actionInFlight = '';
    },

    isUpdating(agentId) {
      return this.actionInFlight === agentId;
    },

    savedMessage(agentId) {
      return this.savedState && this.savedState[agentId] ? this.savedState[agentId] : '';
    }
  };
}
