// The work-status set's reads: the definitions and the programme's label bindings, through the pinned srs CLI.
import { srsCli, srs } from './cli.mjs';
import { BINDING_TYPE, workflowFrom } from '../practice/workflow.mjs';

export function loadWorkflow(repo, cli = srsCli(repo)) {
  const rows = srs(cli, repo, ['record', 'list', '--type', BINDING_TYPE]);
  return workflowFrom({
    lifecycles: srs(cli, repo, ['lifecycle', 'list']).lifecycles,
    vocabularies: srs(cli, repo, ['vocabulary', 'list']).vocabularies,
    bindings: (rows.records ?? rows.instances ?? []).map((r) => r.record.fieldValues ?? {}),
  });
}
