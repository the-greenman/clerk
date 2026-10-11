// The working groups chartered in the programme repo: read here, never hard-coded.
import { srsCli, srs } from './cli.mjs';
import { groupsFrom } from '../practice/groups.mjs';

const rows = (p) => p.records ?? p.instances ?? [];

export function loadGroups(repo, cli = srsCli(repo)) {
  const S = (a) => srs(cli, repo, a);
  const roles = rows(S(['record', 'list', '--type', 'governance/role']));
  if (!roles.some((r) => r.record.fieldValues?.group_label)) return []; // a repository without the group fields has no groups
  return groupsFrom(roles, rows(S(['record', 'list', '--type', 'com.mudemocracy.stewardship/agent'])),
    S(['relation', 'list', '--type', 'com.mudemocracy.stewardship/authorised-by']).relations ?? [], S(['container', 'list']).containers);
}
