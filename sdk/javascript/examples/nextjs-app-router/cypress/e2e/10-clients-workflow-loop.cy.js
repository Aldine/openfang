describe('Layer 10 — Client workflow loop', () => {
  let clientId;
  let planningTaskId;
  let approvalTaskId;

  before(() => {
    cy.request('POST', '/api/clients', {
      business_name: 'Cypress Client Workspace',
      industry: 'SaaS',
      main_goal: 'Increase conversions',
      offer: 'Revenue OS',
      customer: 'Operations leaders',
      approval_mode: 'conditional',
      approvers: [{ name: 'Dana Reviewer', email: 'dana@example.com' }],
    }).then(({ body }) => {
      clientId = body.client.id;

      cy.request('POST', '/api/wizard/generate-plan', {
        client_id: clientId,
        selected_task_types: ['prepare_weekly_task_plan', 'draft_outreach_emails'],
      }).then(({ body: planBody }) => {
        planningTaskId = planBody.tasks.find((task) => task.type === 'prepare_weekly_task_plan').id;
        approvalTaskId = planBody.tasks.find((task) => task.type === 'draft_outreach_emails').id;
      });
    });
  });

  it('loads, moves work, approves, runs, and shows the result', () => {
    cy.visit(`/clients/${clientId}`);
    cy.get('[data-cy="client-home-page"]', { timeout: 12000 }).should('be.visible');

    cy.visit(`/clients/${clientId}/plan`);
    cy.get('[data-cy="client-plan-page"]', { timeout: 12000 }).should('be.visible');
    cy.get(`[data-cy="task-${planningTaskId}-move"]`).select('this_week');
    cy.get('[data-cy="plan-column-this_week"]').within(() => {
      cy.get(`[data-cy="task-card-${planningTaskId}"]`).should('exist');
    });

    cy.visit(`/clients/${clientId}/approvals`);
    cy.get('[data-cy="client-approvals-page"]', { timeout: 12000 }).should('be.visible');
    cy.get(`[data-cy="approval-task-${approvalTaskId}-approve"]`).click();
    cy.get(`[data-cy="execution-card-${approvalTaskId}"]`, { timeout: 12000 }).should('contain.text', 'ready');
    cy.get(`[data-cy="execution-task-${approvalTaskId}-run"]`).click();
    cy.get(`[data-cy="execution-card-${approvalTaskId}"]`, { timeout: 12000 }).should('contain.text', 'completed');

    cy.visit(`/clients/${clientId}/results`);
    cy.get('[data-cy="client-results-page"]', { timeout: 12000 }).should('be.visible');
    cy.contains('Result for Draft outreach emails', { timeout: 12000 }).should('be.visible');
  });
});