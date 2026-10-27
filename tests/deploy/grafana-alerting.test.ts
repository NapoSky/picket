import { readFileSync } from 'node:fs';

interface AlertRule {
  uid: string;
  data: { datasourceUid: string; model: { datasource?: { type: string; uid: string } } }[];
}

const provisioning = JSON.parse(readFileSync(
  'deploy/monitoring/grafana/provisioning/alerting/rules.yml', 'utf8',
)) as { groups: { rules: AlertRule[] }[] };

describe('Grafana alerting provisioning', () => {
  const rules = provisioning.groups.flatMap((group) => group.rules);

  it.each(rules)('$uid identifies the internal expression datasource in its query model', (rule) => {
    const expressions = rule.data.filter((query: { datasourceUid: string }) => query.datasourceUid === '__expr__');

    expect(expressions.length).toBeGreaterThan(0);
    for (const expression of expressions) {
      expect(expression.model.datasource).toEqual({ type: '__expr__', uid: '__expr__' });
    }
  });
});